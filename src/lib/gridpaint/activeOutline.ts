/**
 * Active-group outline: the exact boundary of the filled blob shape, traced
 * from the same primitives the canvas fills. Follows curves, quadrant
 * overrides and half offsets because it never re-derives the shape — it
 * keeps every primitive edge (see primitiveToEdges) that isn't cancelled by
 * an opposite edge of a neighbouring primitive.
 *
 * Built per geometry tile so an edit only re-traces the tiles around it:
 * a tile considers primitives from its neighbours too (so edges on its border
 * cancel correctly) but only emits the edges inside its own cell range, so
 * every boundary edge is drawn exactly once.
 */

import type { BlobGeometry, BlobPrimitive, GeometryTile, PathSink } from "@/lib/blob-engine/types"
import { GEOMETRY_TILE_CELLS } from "@/lib/blob-engine/types"
import { primitiveToEdges, type Edge } from "@/lib/blob-engine/renderers/SvgPathRenderer"

// Edge keys pack coordinates (stored ×2 as integers) into one number: no
// string allocation in the hot loop. Coordinates must stay within ±2^19 cells.
const OFFSET = 1 << 20
const pack = (x2: number, y2: number) => (x2 + OFFSET) * 2 * OFFSET + (y2 + OFFSET)

/** Undirected identity of an edge (lines and quarter arcs are unit-sized) */
function edgeKey(e: Edge): number {
  if (e.kind === "line") {
    const aFirst = e.a.x2 < e.b.x2 || (e.a.x2 === e.b.x2 && e.a.y2 < e.b.y2)
    const min = aFirst ? e.a : e.b
    return pack(min.x2, min.y2) * 8 + (e.a.y2 === e.b.y2 ? 0 : 1)
  }
  // Which quarter of the circle around `center` the arc covers
  const sx = e.a.x2 + e.b.x2 > 2 * e.center.x2 ? 1 : 0
  const sy = e.a.y2 + e.b.y2 > 2 * e.center.y2 ? 1 : 0
  return pack(e.center.x2, e.center.y2) * 8 + 2 + sx * 2 + sy
}

/** +1/−1 for the two traversal directions of the same edge */
function edgeSign(e: Edge): number {
  if (e.kind === "arc") return e.sweep === 1 ? 1 : -1
  return e.a.x2 < e.b.x2 || (e.a.x2 === e.b.x2 && e.a.y2 < e.b.y2) ? 1 : -1
}

/**
 * Boundary edges of `primitives` whose midpoint lies in the half-open cell
 * range [x0 − ½, x1 + ½) × [y0 − ½, y1 + ½) (subgrid coords, cell centers at
 * integers). Pass every primitive within 1.5 cells of the range so edges on
 * its border cancel correctly.
 */
export function ownedBoundaryEdges(
  primitives: readonly BlobPrimitive[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Edge[] {
  const tallies = new Map<number, { net: number; edge: Edge }>()
  for (const p of primitives) {
    for (const e of primitiveToEdges(p)) {
      const key = edgeKey(e)
      const t = tallies.get(key)
      if (t) t.net += edgeSign(e)
      else tallies.set(key, { net: edgeSign(e), edge: e })
    }
  }
  // Midpoints ×2 in subgrid units ×2: range [2·x0 − 1, 2·x1 + 1)
  const lo = (v: number) => 2 * (2 * v - 1)
  const hi = (v: number) => 2 * (2 * v + 1)
  const out: Edge[] = []
  for (const { net, edge } of tallies.values()) {
    if (net === 0) continue
    const mx = edge.a.x2 + edge.b.x2
    const my = edge.a.y2 + edge.b.y2
    if (mx >= lo(x0) && mx < hi(x1) && my >= lo(y0) && my < hi(y1)) out.push(edge)
  }
  return out
}

/** Append edges as world-space strokes (cell x spans [x·gs, (x+1)·gs]) */
export function appendEdges(sink: PathSink, edges: readonly Edge[], gridSize: number): void {
  const w = (v2: number) => (v2 / 2 + 0.5) * gridSize
  for (const e of edges) {
    sink.moveTo(w(e.a.x2), w(e.a.y2))
    if (e.kind === "line") {
      sink.lineTo(w(e.b.x2), w(e.b.y2))
    } else {
      const cx = w(e.center.x2)
      const cy = w(e.center.y2)
      const a0 = Math.atan2(w(e.a.y2) - cy, w(e.a.x2) - cx)
      const a1 = Math.atan2(w(e.b.y2) - cy, w(e.b.x2) - cx)
      // sweep 1 = clockwise on screen = increasing canvas angle
      sink.arc(cx, cy, gridSize / 2, a0, a1, e.sweep === 0)
    }
  }
}

interface TileOutline {
  /** The 3×3 neighbourhood of tiles this outline was traced from */
  deps: (GeometryTile | undefined)[]
  path: Path2D
}

/** Caches per-tile outline paths across geometry versions */
export class TiledOutline {
  private tiles = new Map<string, TileOutline>()
  private gridSize = 0
  private merged = new WeakMap<BlobGeometry, Path2D>()

  /** The outline of a tiled geometry as one Path2D (cached per geometry) */
  path(geometry: BlobGeometry): Path2D {
    const hit = this.merged.get(geometry)
    if (hit) return hit
    if (geometry.gridSize !== this.gridSize) {
      this.tiles.clear()
      this.gridSize = geometry.gridSize
    }

    const tiles = geometry.tiles ?? new Map<string, GeometryTile>()
    const next = new Map<string, TileOutline>()
    const merged = new Path2D()
    for (const [key, tile] of tiles) {
      const deps: (GeometryTile | undefined)[] = []
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          deps.push(tiles.get(`${tile.tileX + dx},${tile.tileY + dy}`))
        }
      }
      let entry = this.tiles.get(key)
      if (!entry || entry.deps.some((d, i) => d !== deps[i])) {
        entry = { deps, path: this.traceTile(tile, deps, geometry.gridSize) }
      }
      next.set(key, entry)
      merged.addPath(entry.path)
    }
    this.tiles = next
    this.merged.set(geometry, merged)
    return merged
  }

  private traceTile(
    tile: GeometryTile,
    deps: (GeometryTile | undefined)[],
    gridSize: number,
  ): Path2D {
    const x0 = tile.tileX * GEOMETRY_TILE_CELLS
    const y0 = tile.tileY * GEOMETRY_TILE_CELLS
    const x1 = x0 + GEOMETRY_TILE_CELLS - 1
    const y1 = y0 + GEOMETRY_TILE_CELLS - 1
    const nearby: BlobPrimitive[] = []
    for (const dep of deps) {
      if (!dep) continue
      for (const p of dep.primitives) {
        const { x, y } = p.center
        if (x >= x0 - 1.5 && x <= x1 + 1.5 && y >= y0 - 1.5 && y <= y1 + 1.5) nearby.push(p)
      }
    }
    const path = new Path2D()
    appendEdges(path, ownedBoundaryEdges(nearby, x0, y0, x1, y1), gridSize)
    return path
  }
}
