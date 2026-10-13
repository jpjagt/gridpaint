/**
 * RunnerEngine — the realtime part. The camera and character stay at the
 * origin; chunks of world are streamed in from a worker and slide toward the
 * camera. Distance travelled is kept as a double and only small chunk-
 * relative offsets ever reach the GPU, so it can run forever without float
 * jitter.
 *
 * Smoothness measures:
 *  - all generation/meshing happens in a worker
 *  - at most `chunksPerFrame` new chunks are handed to the GPU per frame
 *  - near chunks are rebuilt with finer arcs but only as wide as the camera
 *    can see up close; far chunks are wide but coarse
 *  - no per-frame allocations in the steady state
 */

import * as THREE from "three"
import type {
  ChunkMeshData,
  RunnerConfig,
  RunnerStats,
  WorkerChunkResponse,
  WorkerRequest,
} from "@/types/runner"
import { CHARACTER_ROW, cloneConfig, toWorldGenParams } from "./config"
import { RunnerCharacter } from "./character"
import {
  applyFog,
  createFaceMaterial,
  createLineMaterial,
  hexToVec3,
} from "./materials"

interface ChunkEntry {
  index: number
  group: THREE.Group
  lod: number
  colLimit: number
  triangles: number
  lineSegments: number
  biome: string
}

interface PendingBuild {
  lod: number
  colLimit: number
}

const MAX_IN_FLIGHT = 2
const FRAME_HISTORY = 240

export class RunnerEngine {
  private config: RunnerConfig
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private world = new THREE.Group()
  private character: RunnerCharacter

  private frontMat = createFaceMaterial()
  private sideMat = createFaceMaterial()
  private outlineMat = createLineMaterial(false)
  private seamMat = createLineMaterial(true)

  private worker: Worker
  private generation = 0
  private worldKey = ""
  private chunks = new Map<number, ChunkEntry>()
  private pending = new Map<number, PendingBuild>()
  private arrivals: WorkerChunkResponse[] = []
  private buildTimes: number[] = []

  /** Tiles travelled. A double; never sent to the GPU directly. */
  private distance = 0
  private paused = false
  /** Hold still until everything in view has loaded (after start / world reset) */
  private warmingUp = true
  private running = false
  private raf = 0
  private lastTime = -1
  private frameTimes = new Float32Array(FRAME_HISTORY)
  private frameCursor = 0
  private frameCount = 0
  private statsTimer = 0
  private resizeObserver: ResizeObserver

  onStats?: (stats: RunnerStats) => void

  constructor(
    private container: HTMLElement,
    config: RunnerConfig,
  ) {
    this.config = cloneConfig(config)
    this.distance = config.startDistance
    this.renderer = new THREE.WebGLRenderer({
      antialias: config.render.antialias,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, config.render.maxPixelRatio))
    this.renderer.domElement.style.display = "block"
    container.appendChild(this.renderer.domElement)

    this.camera = new THREE.PerspectiveCamera(config.camera.fov, 1, 0.05, 400)
    this.scene.add(this.world)
    this.character = new RunnerCharacter(this.config)
    this.scene.add(this.character.group)

    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })
    this.worker.onmessage = (e: MessageEvent<WorkerChunkResponse>) => {
      if (e.data.generation === this.generation) this.arrivals.push(e.data)
    }

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()
    this.applyConfig(this.config)
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement
  }

  start() {
    if (this.running) return
    this.running = true
    this.lastTime = -1
    this.raf = requestAnimationFrame(this.tick)
  }

  stop() {
    this.running = false
    cancelAnimationFrame(this.raf)
  }

  setPaused(paused: boolean) {
    this.paused = paused
  }

  isPaused() {
    return this.paused
  }

  isWarmingUp() {
    return this.warmingUp
  }

  /** Apply a new config. Rebuilds the world only if generation inputs changed. */
  updateConfig(config: RunnerConfig) {
    this.applyConfig(cloneConfig(config))
  }

  dispose() {
    this.stop()
    this.resizeObserver.disconnect()
    this.worker.terminate()
    for (const entry of this.chunks.values()) this.disposeChunk(entry)
    this.chunks.clear()
    this.character.dispose()
    for (const m of [this.frontMat, this.sideMat, this.outlineMat, this.seamMat]) m.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  // --- Config -------------------------------------------------------------

  private applyConfig(config: RunnerConfig) {
    this.config = config
    const c = config.colors

    for (const m of [this.frontMat, this.sideMat, this.outlineMat, this.seamMat]) applyFog(m, config)
    hexToVec3(c.front, this.frontMat.uniforms.uColor.value)
    hexToVec3(c.front, this.frontMat.uniforms.uColorTop.value)
    hexToVec3(c.side, this.sideMat.uniforms.uColor.value)
    hexToVec3(c.sideTop, this.sideMat.uniforms.uColorTop.value)
    hexToVec3(c.line, this.outlineMat.uniforms.uColor.value)
    hexToVec3(c.seam, this.seamMat.uniforms.uColor.value)
    this.seamMat.uniforms.uOpacity.value = config.lines.seamOpacity
    this.seamMat.uniforms.uFadeStart.value = config.lines.seamFadeStart
    this.seamMat.uniforms.uFadeEnd.value = Math.max(config.lines.seamFadeEnd, config.lines.seamFadeStart + 0.01)
    this.outlineMat.visible = config.lines.outlines
    this.seamMat.visible = config.lines.seams

    this.renderer.setClearColor(new THREE.Color().setHex(hexToHexNumber(c.fog), THREE.SRGBColorSpace))
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, config.render.maxPixelRatio))

    const cam = config.camera
    this.camera.fov = cam.fov
    this.camera.far = config.world.viewDistance + cam.back + 60
    this.camera.position.set(0, CHARACTER_ROW + 0.5 + cam.up, cam.back)
    this.camera.lookAt(0, CHARACTER_ROW + 0.5 + cam.lookUp, -cam.lookAhead)
    this.camera.updateProjectionMatrix()
    this.camera.updateMatrixWorld()
    // world-up in view space, for top-face coloring
    const up = new THREE.Vector3(0, 1, 0).transformDirection(this.camera.matrixWorldInverse)
    this.frontMat.uniforms.uUpView.value.copy(up)
    this.sideMat.uniforms.uUpView.value.copy(up)

    this.character.applyConfig(config)

    const key = JSON.stringify(toWorldGenParams(config))
    if (key !== this.worldKey) {
      this.worldKey = key
      this.resetWorld()
    }
  }

  private resetWorld() {
    this.generation++
    for (const entry of this.chunks.values()) this.disposeChunk(entry)
    this.chunks.clear()
    this.pending.clear()
    this.arrivals.length = 0
    this.warmingUp = true
    const msg: WorkerRequest = { type: "init", params: toWorldGenParams(this.config) }
    this.worker.postMessage(msg)
  }

  private resize() {
    const w = Math.max(1, this.container.clientWidth)
    const h = Math.max(1, this.container.clientHeight)
    this.renderer.setSize(w, h, true)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  // --- Frame loop -----------------------------------------------------------

  private tick = (time: number) => {
    if (!this.running) return
    this.raf = requestAnimationFrame(this.tick)
    const dt = this.lastTime < 0 ? 0 : Math.min((time - this.lastTime) / 1000, 1 / 20)
    if (this.lastTime >= 0) this.recordFrame(time - this.lastTime)
    this.lastTime = time
    this.step(dt)
    this.renderer.render(this.scene, this.camera)
  }

  /** Advance the simulation by dt seconds (also used for offline capture) */
  step(dt: number) {
    if (this.warmingUp && this.isWorldReady()) this.warmingUp = false
    const speed = this.paused || this.warmingUp ? 0 : this.config.speed
    this.distance += speed * dt
    this.character.update(dt, speed)
    this.integrateArrivals()
    this.manageChunks()
    this.positionChunks()
  }

  renderFrame() {
    this.renderer.render(this.scene, this.camera)
  }

  private chunkLength() {
    return this.config.world.chunkSlices * this.config.world.sliceDepth
  }

  private positionChunks() {
    const len = this.chunkLength()
    for (const entry of this.chunks.values()) {
      // difference of doubles first, so the GPU only sees small numbers
      entry.group.position.z = this.distance - entry.index * len
    }
  }

  // --- Chunk streaming ------------------------------------------------------

  private lodFor(nearEdge: number): number {
    const d = this.config.world.lodDistances
    for (let i = 0; i < d.length; i++) if (nearEdge < d[i]) return i
    return d.length
  }

  /** Columns the camera can possibly see for a chunk in a given LOD band */
  private colLimitFor(lod: number): number {
    const w = this.config.world
    if (lod >= w.lodDistances.length) return w.halfWidth
    const tanH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.aspect
    const farEdge = w.lodDistances[lod] + this.chunkLength() + this.config.camera.back
    return Math.min(w.halfWidth, Math.ceil(farEdge * tanH) + 4)
  }

  private manageChunks() {
    const w = this.config.world
    const len = this.chunkLength()
    const first = Math.floor((this.distance - this.config.camera.back - 1) / len)
    const last = Math.floor((this.distance + w.viewDistance) / len)

    for (const [index, entry] of this.chunks) {
      if (index < first || index > last + 1) {
        this.disposeChunk(entry)
        this.chunks.delete(index)
      }
    }

    if (this.pending.size >= MAX_IN_FLIGHT) return
    // Missing chunks first (nearest first), then LOD upgrades (nearest first)
    for (let pass = 0; pass < 2 && this.pending.size < MAX_IN_FLIGHT; pass++) {
      for (let c = first; c <= last && this.pending.size < MAX_IN_FLIGHT; c++) {
        if (this.pending.has(c)) continue
        const entry = this.chunks.get(c)
        if (pass === 0 && entry) continue
        if (pass === 1 && !entry) continue
        const lod = this.lodFor(c * len - this.distance)
        const colLimit = this.colLimitFor(lod)
        if (entry && entry.lod <= lod && entry.colLimit >= colLimit) continue
        this.request(c, lod, colLimit)
      }
    }
  }

  private request(chunk: number, lod: number, colLimit: number) {
    const segs = this.config.world.arcSegments
    const msg: WorkerRequest = {
      type: "build",
      chunk,
      lod,
      arcSegments: segs[Math.min(lod, segs.length - 1)],
      colLimit,
      generation: this.generation,
    }
    this.pending.set(chunk, { lod, colLimit })
    this.worker.postMessage(msg)
  }

  private integrateArrivals() {
    // Nothing is moving while warming up, so upload faster
    let budget = this.warmingUp ? 8 : this.config.render.chunksPerFrame
    while (budget > 0 && this.arrivals.length > 0) {
      const res = this.arrivals.shift()!
      const pend = this.pending.get(res.chunk)
      this.pending.delete(res.chunk)
      if (!pend) continue
      const old = this.chunks.get(res.chunk)
      if (old) {
        this.disposeChunk(old)
        this.chunks.delete(res.chunk)
      }
      const len = this.chunkLength()
      const nearEdge = res.chunk * len - this.distance
      if (nearEdge + len < -this.config.camera.back - 1) continue
      this.chunks.set(res.chunk, this.createChunk(res, pend))
      this.buildTimes.push(res.ms)
      if (this.buildTimes.length > 60) this.buildTimes.shift()
      budget--
    }
  }

  private createChunk(res: WorkerChunkResponse, pend: PendingBuild): ChunkEntry {
    const group = new THREE.Group()
    const m: ChunkMeshData = res.mesh
    const add = (data: Float32Array, mat: THREE.ShaderMaterial, lines: boolean) => {
      if (data.length === 0) return
      const geo = new THREE.BufferGeometry()
      geo.setAttribute("position", new THREE.BufferAttribute(data, 3))
      const obj = lines ? new THREE.LineSegments(geo, mat) : new THREE.Mesh(geo, mat)
      // Chunks span the whole view; skip bounding-sphere work on the main thread
      obj.frustumCulled = false
      obj.matrixAutoUpdate = false
      if (lines) obj.renderOrder = mat.transparent ? 2 : 1
      group.add(obj)
    }
    add(m.fronts, this.frontMat, false)
    add(m.sides, this.sideMat, false)
    add(m.outlines, this.outlineMat, true)
    add(m.seams, this.seamMat, true)
    this.world.add(group)
    return {
      index: res.chunk,
      group,
      lod: pend.lod,
      colLimit: pend.colLimit,
      triangles: (m.fronts.length + m.sides.length) / 9,
      lineSegments: (m.outlines.length + m.seams.length) / 6,
      biome: res.biome,
    }
  }

  private disposeChunk(entry: ChunkEntry) {
    this.world.remove(entry.group)
    for (const child of entry.group.children) {
      ;(child as THREE.Mesh).geometry.dispose()
    }
  }

  /** True once every chunk the camera can see has arrived */
  isWorldReady(): boolean {
    const len = this.chunkLength()
    const first = Math.floor((this.distance - this.config.camera.back - 1) / len)
    const last = Math.floor((this.distance + this.config.world.viewDistance) / len)
    for (let c = first; c <= last; c++) if (!this.chunks.has(c)) return false
    return true
  }

  // --- Stats ----------------------------------------------------------------

  private recordFrame(ms: number) {
    this.frameTimes[this.frameCursor] = ms
    this.frameCursor = (this.frameCursor + 1) % FRAME_HISTORY
    this.frameCount = Math.min(this.frameCount + 1, FRAME_HISTORY)
    this.statsTimer += ms
    if (this.statsTimer < 500 || !this.onStats) return
    this.statsTimer = 0
    this.onStats(this.getStats())
  }

  getStats(): RunnerStats {
    const n = this.frameCount
    const sorted = Array.from(this.frameTimes.subarray(0, n)).sort((a, b) => a - b)
    const avg = n ? sorted.reduce((s, v) => s + v, 0) / n : 0
    let triangles = 0
    let lineSegments = 0
    for (const e of this.chunks.values()) {
      triangles += e.triangles
      lineSegments += e.lineSegments
    }
    const here = this.chunks.get(Math.floor(this.distance / this.chunkLength()))
    return {
      fps: avg > 0 ? 1000 / avg : 0,
      worstFrameMs: n ? sorted[n - 1] : 0,
      p99FrameMs: n ? sorted[Math.min(n - 1, Math.floor(n * 0.99))] : 0,
      chunks: this.chunks.size,
      triangles,
      lineSegments,
      avgChunkBuildMs: this.buildTimes.length
        ? this.buildTimes.reduce((s, v) => s + v, 0) / this.buildTimes.length
        : 0,
      distance: this.distance,
      biome: here?.biome ?? "…",
    }
  }
}

function hexToHexNumber(hex: string): number {
  return new THREE.Color().setStyle(hex).getHex()
}
