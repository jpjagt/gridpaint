/// <reference lib="webworker" />
/**
 * Runs world generation and meshing off the main thread. Slices are cached
 * so rebuilding a chunk at a finer LOD only re-meshes.
 */

import type { SliceGrid, WorkerChunkResponse, WorkerRequest } from "@/types/runner"
import { buildChunkMesh } from "./mesher"
import { WorldGenerator } from "./world/generator"

const MAX_CACHED_SLICES = 768

let gen: WorldGenerator | null = null
const cache = new Map<number, SliceGrid>()

function slice(k: number): SliceGrid {
  let g = cache.get(k)
  if (g) {
    // refresh LRU position
    cache.delete(k)
    cache.set(k, g)
    return g
  }
  g = gen!.createGrid()
  gen!.fillSlice(k, g)
  cache.set(k, g)
  if (cache.size > MAX_CACHED_SLICES) {
    const oldest = cache.keys().next().value as number
    cache.delete(oldest)
  }
  return g
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data
  if (msg.type === "init") {
    gen = new WorldGenerator(msg.params)
    cache.clear()
    return
  }
  if (msg.type === "build" && gen) {
    const t0 = performance.now()
    const n = gen.params.chunkSlices
    const k0 = msg.chunk * n
    const slices: SliceGrid[] = []
    for (let k = k0 - 1; k < k0 + n; k++) slices.push(slice(k))
    const mesh = buildChunkMesh(slices, gen.params.sliceDepth, msg.arcSegments, msg.colLimit)
    const res: WorkerChunkResponse = {
      type: "chunk",
      chunk: msg.chunk,
      lod: msg.lod,
      generation: msg.generation,
      mesh,
      biome: gen.biomeNameAt((k0 + n / 2) * gen.params.sliceDepth),
      ms: performance.now() - t0,
    }
    ;(self as unknown as DedicatedWorkerGlobalScope).postMessage(res, [
      mesh.fronts.buffer,
      mesh.sides.buffer,
      mesh.outlines.buffer,
      mesh.seams.buffer,
    ])
  }
}
