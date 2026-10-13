/**
 * RunnerEngine — the realtime part. The camera and character stay at the
 * origin; chunks of world are streamed in from a worker and slide toward the
 * camera. Distance travelled is kept as a double and only small chunk-
 * relative offsets ever reach the GPU, so it can run forever without float
 * jitter.
 *
 * Smoothness measures:
 *  - all generation/meshing happens in a small pool of workers
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
  createFallbackEnv,
  createGroundMask,
  createGroundPlaneMaterial,
  createLineMaterial,
  GROUND_MASK_SIZE,
  createMetalMaterial,
  hexToVec3,
  loadGrayscaleEnv,
} from "./materials"
import { activePalette } from "./palettes"

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

/** Background threads for generation + meshing (leave cores for the page) */
const WORKER_COUNT = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 2))
const MAX_IN_FLIGHT = 2 * WORKER_COUNT
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
  private metalFrontMat = createMetalMaterial(true)
  private metalSideMat = createMetalMaterial(false)
  private envName = ""
  private groundMask = createGroundMask()
  private groundMat = createGroundPlaneMaterial(this.groundMask)
  private groundPlane: THREE.Mesh
  private env: THREE.Texture = createFallbackEnv()

  private workers: Worker[] = []
  private generation = 0
  private worldKey = ""
  private chunks = new Map<number, ChunkEntry>()
  private pending = new Map<number, PendingBuild>()
  private arrivals: WorkerChunkResponse[] = []
  private buildTimes: number[] = []

  /** Tiles travelled. A double; never sent to the GPU directly. */
  private distance = 0
  private paused = false
  private boostTarget = 1
  private boostCurrent = 1
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
  private pixelRatio = 1
  private adaptFrames = 0
  private adaptSlow = 0
  private adaptElapsed = 0
  private vsyncMs = Infinity

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
    this.pixelRatio = Math.min(window.devicePixelRatio, config.render.maxPixelRatio)
    this.renderer.setPixelRatio(this.pixelRatio)
    this.renderer.domElement.style.display = "block"
    container.appendChild(this.renderer.domElement)

    this.camera = new THREE.PerspectiveCamera(config.camera.fov, 1, 0.05, 400)
    this.scene.add(this.world)
    this.groundPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.groundMat)
    this.groundPlane.rotation.x = -Math.PI / 2
    this.groundPlane.frustumCulled = false
    this.scene.add(this.groundPlane)
    this.character = new RunnerCharacter(this.config)
    this.scene.add(this.character.group)

    for (let i = 0; i < WORKER_COUNT; i++) {
      const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })
      worker.onmessage = (e: MessageEvent<WorkerChunkResponse>) => {
        if (e.data.generation === this.generation) this.arrivals.push(e.data)
      }
      this.workers.push(worker)
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

  /** Hold-to-boost: speed eases to `boost.factor` × while on */
  setBoost(on: boolean) {
    this.boostTarget = on ? this.config.boost.factor : 1
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
    for (const w of this.workers) w.terminate()
    for (const entry of this.chunks.values()) this.disposeChunk(entry)
    this.chunks.clear()
    this.character.dispose()
    for (const m of this.allMaterials()) m.dispose()
    this.env.dispose()
    this.groundMask.dispose()
    this.groundPlane.geometry.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  // --- Config -------------------------------------------------------------

  private applyConfig(config: RunnerConfig) {
    this.config = config
    const c = activePalette(config)

    for (const m of this.allMaterials()) {
      applyFog(m, config)
      m.uniforms.uInvert.value = 0
    }
    for (const m of [this.metalFrontMat, this.metalSideMat]) m.uniforms.uInvert.value = c.invertMetal ? 1 : 0
    this.applyMetal(config)
    hexToVec3(c.front, this.frontMat.uniforms.uColor.value)
    hexToVec3(c.front, this.frontMat.uniforms.uColorTop.value)
    hexToVec3(c.side, this.sideMat.uniforms.uColor.value)
    hexToVec3(c.sideTop, this.groundMat.uniforms.uColor.value)
    this.groundMat.uniforms.uInnerX.value = config.world.halfWidth
    this.groundMat.uniforms.uChunkLength.value = config.world.chunkSlices * config.world.sliceDepth
    // Ground plane: from just behind the camera to past the far plane, very wide
    const near = config.camera.back + 2
    const far = config.world.viewDistance + 80
    this.groundPlane.scale.set(8000, near + far, 1)
    this.groundPlane.position.set(0, 0, (near - far) / 2)
    hexToVec3(c.sideTop, this.sideMat.uniforms.uColorTop.value)
    hexToVec3(c.line, this.outlineMat.uniforms.uColor.value)
    hexToVec3(c.seam, this.seamMat.uniforms.uColor.value)
    this.seamMat.uniforms.uOpacity.value = config.lines.seamOpacity
    this.seamMat.uniforms.uFadeStart.value = config.lines.seamFadeStart
    this.seamMat.uniforms.uFadeEnd.value = Math.max(config.lines.seamFadeEnd, config.lines.seamFadeStart + 0.01)
    this.outlineMat.visible = config.lines.outlines
    this.seamMat.visible = config.lines.seams

    this.renderer.setClearColor(new THREE.Color().setHex(hexToHexNumber(c.fog), THREE.SRGBColorSpace))
    const ratio = Math.min(window.devicePixelRatio, config.render.maxPixelRatio)
    if (ratio !== this.pixelRatio) {
      this.pixelRatio = ratio
      this.renderer.setPixelRatio(ratio)
    }

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
    for (const m of [this.metalFrontMat, this.metalSideMat]) {
      m.uniforms.uViewToWorld.value.setFromMatrix4(this.camera.matrixWorld)
    }

    this.character.applyConfig(config)

    const key = JSON.stringify(toWorldGenParams(config))
    if (key !== this.worldKey) {
      this.worldKey = key
      this.resetWorld()
    }
  }

  private allMaterials() {
    return [
      this.frontMat,
      this.sideMat,
      this.outlineMat,
      this.seamMat,
      this.metalFrontMat,
      this.metalSideMat,
      this.groundMat,
    ]
  }

  private applyMetal(config: RunnerConfig) {
    const m = config.metal
    for (const mat of [this.metalFrontMat, this.metalSideMat]) {
      const u = mat.uniforms
      u.uEnv.value = this.env
      u.uBlur.value = m.blur
      u.uExposure.value = m.exposure
      u.uContrast.value = m.contrast
      hexToVec3(m.tint, u.uTint.value)
    }
    if (m.envMap !== this.envName) {
      this.envName = m.envMap
      const name = m.envMap
      loadGrayscaleEnv(name)
        .then((tex) => {
          if (this.envName !== name) return tex.dispose()
          this.env.dispose()
          this.env = tex
          for (const mat of [this.metalFrontMat, this.metalSideMat]) mat.uniforms.uEnv.value = tex
        })
        .catch((err) => console.warn("Runner: failed to load environment map", err))
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
    for (const w of this.workers) w.postMessage(msg)
  }

  private resize() {
    if (this.offline) return
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

  /** Advance the simulation by dt seconds */
  step(dt: number) {
    if (this.warmingUp && this.isWorldReady()) this.warmingUp = false
    const moving = !this.paused && !this.warmingUp
    // ease toward the boost target: ~95% of the way after rampSeconds
    const tau = Math.max(0.01, this.config.boost.rampSeconds / 3)
    this.boostCurrent += (this.boostTarget - this.boostCurrent) * (1 - Math.exp(-dt / tau))
    if (moving) this.distance += this.config.speed * this.boostCurrent * dt
    this.character.update(this.distance, this.config.world.loopLength)
    this.integrateArrivals()
    this.manageChunks()
    this.positionChunks()
  }

  getDistance() {
    return this.distance
  }


  private chunkLength() {
    return this.config.world.chunkSlices * this.config.world.sliceDepth
  }

  private positionChunks() {
    const len = this.chunkLength()
    this.groundMat.uniforms.uDistance.value = this.distance % (GROUND_MASK_SIZE * len)
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
    // a chunk always goes to the same worker, so LOD rebuilds hit its slice cache
    const w = this.workers.length
    this.workers[((chunk % w) + w) % w].postMessage(msg)
  }

  private integrateArrivals(unlimited = false) {
    // Nothing is moving while warming up, so upload faster
    let budget = unlimited ? Infinity : this.warmingUp ? 8 : this.config.render.chunksPerFrame
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
      const slot = (((res.chunk % GROUND_MASK_SIZE) + GROUND_MASK_SIZE) % GROUND_MASK_SIZE) * 4
      const maskData = this.groundMask.image.data as Uint8Array
      const v = res.ground >= 0.5 ? 255 : 0
      if (maskData[slot] !== v) {
        maskData[slot] = maskData[slot + 1] = maskData[slot + 2] = v
        this.groundMask.needsUpdate = true
      }
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
    add(m.metalFronts, this.metalFrontMat, false)
    if (m.metalSides.length > 0) {
      const geo = new THREE.BufferGeometry()
      geo.setAttribute("position", new THREE.BufferAttribute(m.metalSides, 3))
      geo.setAttribute("normal", new THREE.BufferAttribute(m.metalSideNormals, 3))
      const mesh = new THREE.Mesh(geo, this.metalSideMat)
      mesh.frustumCulled = false
      mesh.matrixAutoUpdate = false
      group.add(mesh)
    }
    this.world.add(group)
    return {
      index: res.chunk,
      group,
      lod: pend.lod,
      colLimit: pend.colLimit,
      triangles: (m.fronts.length + m.sides.length + m.metalFronts.length + m.metalSides.length) / 9,
      lineSegments: (m.outlines.length + m.seams.length) / 6,
      biome: res.biome,
    }
  }

  private disposeChunk(entry: ChunkEntry) {
    this.world.remove(entry.group)
    for (const child of entry.group.children) {
      const obj = child as THREE.Mesh
      obj.geometry.dispose()
    }
  }

  /** True once every chunk the camera can see has arrived */
  // --- Offline rendering (frame-exact video export) -----------------------

  private offline = false

  /** Stop the realtime loop and render at a fixed output size */
  beginOffline(width: number, height: number) {
    this.stop()
    this.offline = true
    this.renderer.setPixelRatio(1)
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  endOffline() {
    this.offline = false
    this.renderer.setPixelRatio(this.pixelRatio)
    this.resize()
    this.start()
  }

  /** Render the frame at a given distance once everything in view is fully built */
  async renderAt(distance: number): Promise<void> {
    this.distance = distance
    for (;;) {
      this.manageChunks()
      this.integrateArrivals(true)
      if (this.pending.size === 0 && this.isFullyBuilt()) break
      await new Promise((r) => setTimeout(r, 1))
    }
    this.character.update(this.distance, this.config.world.loopLength)
    this.positionChunks()
    this.renderer.render(this.scene, this.camera)
  }

  /** Every visible chunk present at the LOD and width it should have */
  private isFullyBuilt(): boolean {
    const len = this.chunkLength()
    const first = Math.floor((this.distance - this.config.camera.back - 1) / len)
    const last = Math.floor((this.distance + this.config.world.viewDistance) / len)
    for (let c = first; c <= last; c++) {
      const e = this.chunks.get(c)
      if (!e) return false
      const lod = this.lodFor(c * len - this.distance)
      if (e.lod > lod || e.colLimit < this.colLimitFor(lod)) return false
    }
    return true
  }

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
    this.adaptResolution(ms)
    this.statsTimer += ms
    if (this.statsTimer < 500 || !this.onStats) return
    this.statsTimer = 0
    this.onStats(this.getStats())
  }

  /**
   * If more than 8% of frames over a few seconds take noticeably longer
   * than a vsync interval, drop the pixel ratio a notch (never below 1).
   */
  private adaptResolution(ms: number) {
    if (!this.config.render.adaptiveResolution || this.warmingUp) return
    if (ms > 4) this.vsyncMs = Math.min(this.vsyncMs, ms)
    this.adaptFrames++
    if (ms > this.vsyncMs * 1.4) this.adaptSlow++
    this.adaptElapsed += ms
    if (this.adaptElapsed < 3000) return
    if (this.adaptSlow / this.adaptFrames > 0.08 && this.pixelRatio > 1) {
      this.pixelRatio = Math.max(1, this.pixelRatio - 0.25)
      this.renderer.setPixelRatio(this.pixelRatio)
      this.resize()
    }
    this.adaptFrames = 0
    this.adaptSlow = 0
    this.adaptElapsed = 0
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
      pixelRatio: this.pixelRatio,
      palette: this.config.palette,
    }
  }
}

function hexToHexNumber(hex: string): number {
  return new THREE.Color().setStyle(hex).getHex()
}
