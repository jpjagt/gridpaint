/**
 * Runner defaults. Everything visual or positional lives here; tweak freely.
 * URL params can override a few of these at runtime (see parseUrlOverrides).
 */

import type { RunnerConfig, WorldGenParams } from "@/types/runner"

/** Lowest generated row. Rows -2 and -1 are the ground; the character runs on row 0. */
export const MIN_ROW = -2

/** Row the character occupies (sits on the ground, centre at y = 0.5) */
export const CHARACTER_ROW = 0

export const DEFAULT_RUNNER_CONFIG: RunnerConfig = {
  speed: 7,
  startDistance: 0,
  colors: {
    front: "#ededed",
    side: "#d7d7d7",
    sideTop: "#d7d7d7",
    line: "#999999",
    seam: "#999999",
    fog: "#e7e7e7",
    characterBody: "#f6f6f6",
    characterShade: "#d0d0d0",
    characterLine: "#777777",
    shadow: "#b8b8b8",
  },
  fog: {
    near: 12,
    far: 95,
    exponent: 0.85,
  },
  lines: {
    outlines: true,
    seams: true,
    seamOpacity: 0.55,
    seamFadeStart: 15,
    seamFadeEnd: 55,
  },
  camera: {
    up: 4,
    back: 7,
    lookAhead: 10,
    lookUp: 0.5,
    fov: 55,
  },
  character: {
    kind: "ball",
    radius: 0.38,
    shadow: true,
  },
  world: {
    seed: 1337,
    sliceDepth: 0.5,
    chunkSlices: 16,
    halfWidth: 90,
    maxRow: 34,
    viewDistance: 100,
    arcSegments: [6, 3, 2],
    lodDistances: [28, 60],
    zoneLength: 260,
    transitionLength: 60,
    biomeWeights: {
      desert: 1,
      ruins: 1,
      dream: 1,
      plains: 0.8,
      megacity: 0.8,
    },
    loopLength: 0,
  },
  render: {
    maxPixelRatio: 2,
    antialias: true,
    chunksPerFrame: 1,
    adaptiveResolution: true,
  },
  capture: {
    width: 1920,
    height: 1080,
    fps: 60,
    mbps: 24,
    seconds: 12,
  },
}

/** Rows that must stay empty so the camera always has a clear tunnel */
export function cameraTunnelRows(config: RunnerConfig): number[] {
  const y = CHARACTER_ROW + 0.5 + config.camera.up
  const rows = new Set([Math.floor(y - 0.45), Math.floor(y + 0.45)])
  return [...rows]
}

export function toWorldGenParams(config: RunnerConfig): WorldGenParams {
  const w = config.world
  return {
    seed: w.seed,
    sliceDepth: w.sliceDepth,
    chunkSlices: w.chunkSlices,
    halfWidth: w.halfWidth,
    maxRow: w.maxRow,
    zoneLength: w.zoneLength,
    transitionLength: w.transitionLength,
    biomeWeights: { ...w.biomeWeights },
    loopLength: w.loopLength,
    tunnels: [
      [0, CHARACTER_ROW],
      ...cameraTunnelRows(config).map((r) => [0, r] as [number, number]),
    ],
    doorHeight: Math.max(...cameraTunnelRows(config)) + 2,
  }
}

/** Deep-ish clone so live edits never mutate the defaults */
export function cloneConfig(config: RunnerConfig): RunnerConfig {
  return JSON.parse(JSON.stringify(config)) as RunnerConfig
}

/**
 * Supported URL params (hash query, e.g. `#/runner?seed=4&speed=9&ui=0`):
 * seed, speed, depth (slice depth), seams (0/1), fog (far distance),
 * at (start distance), biome (only these biomes, comma-separated),
 * loop (loop length in tiles; the world repeats seamlessly),
 * quality (low | high), res (export size, e.g. 3840x2160), fps (export).
 */
export function applyUrlOverrides(
  config: RunnerConfig,
  params: URLSearchParams,
): RunnerConfig {
  const num = (key: string) => {
    const v = params.get(key)
    if (v === null || v === "") return undefined
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  const seed = num("seed")
  if (seed !== undefined) config.world.seed = seed
  const speed = num("speed")
  if (speed !== undefined) config.speed = speed
  const depth = num("depth")
  if (depth !== undefined && depth > 0) config.world.sliceDepth = depth
  const seams = num("seams")
  if (seams !== undefined) config.lines.seams = seams !== 0
  const fog = num("fog")
  if (fog !== undefined && fog > config.fog.near) config.fog.far = fog
  const quality = params.get("quality")
  if (quality === "low") {
    // For weaker GPUs: fewer pixels, coarser arcs, shorter view
    config.render.maxPixelRatio = 1
    config.render.antialias = false
    config.world.arcSegments = [4, 2, 1]
    config.world.viewDistance = Math.min(config.world.viewDistance, 80)
    config.fog.far = Math.min(config.fog.far, 78)
  } else if (quality === "high") {
    // For recording on a fast machine
    config.render.maxPixelRatio = 3
    config.render.adaptiveResolution = false
    config.world.arcSegments = [10, 6, 3]
  }
  const res = params.get("res")?.match(/^(\d+)x(\d+)$/)
  if (res) {
    config.capture.width = Number(res[1])
    config.capture.height = Number(res[2])
  }
  const fps = num("fps")
  if (fps !== undefined && fps > 0) config.capture.fps = fps
  const loop = num("loop")
  if (loop !== undefined && loop >= 0) config.world.loopLength = loop
  const at = num("at")
  if (at !== undefined) config.startDistance = at
  const biomes = params.get("biome")
  if (biomes) {
    const wanted = new Set(biomes.split(","))
    const weights = config.world.biomeWeights
    if ([...wanted].some((b) => b in weights)) {
      for (const key of Object.keys(weights) as (keyof typeof weights)[]) {
        weights[key] = wanted.has(key) ? Math.max(weights[key], 1) : 0
      }
    }
  }
  return config
}
