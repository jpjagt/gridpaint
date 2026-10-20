/**
 * TiledLayerGeometry — incremental blob geometry for one layer.
 *
 * Every primitive depends only on its cell's 3×3 neighbourhood (plus a half
 * cell shift for half-offset groups and the overrides at that cell). So
 * after an edit, only primitives near changed cells can change. This class
 * keeps a layer's primitives bucketed into GEOMETRY_TILE_CELLS² tiles. On
 * update it diffs the new layer against the previous one (by identity first:
 * the store replaces only what changed) and regenerates just the dirty tiles,
 * each from a window of the layer with a safety margin. Untouched tiles keep
 * their object identity, which lets renderers keep per-tile path caches.
 *
 * A paint stroke on a large drawing therefore costs a few tiles of work
 * instead of a full-layer regeneration.
 */

import type {
  BlobGeometry,
  BlobPrimitive,
  GeometryTile,
  GridLayer,
} from "./types"
import { GEOMETRY_TILE_CELLS } from "./types"
import type { BlobEngine } from "./BlobEngine"
import type { InteractionGroup, PointModifications } from "@/types/gridpaint"

/** Cells of context around a tile window (neighbourhood 1 + half shift + slack) */
const WINDOW_MARGIN = 3
/** Cells around a changed cell whose primitives may change */
const DIRTY_RADIUS = 2
/** Above this share of dirty tiles a full regeneration is cheaper */
const FULL_REGEN_RATIO = 0.4

const tileOf = (cell: number) => Math.floor(cell / GEOMETRY_TILE_CELLS)
const tileKey = (tx: number, ty: number) => `${tx},${ty}`

export class TiledLayerGeometry {
  private prev: GridLayer | null = null
  private gridSize = 0
  private borderWidth = 0
  private tiles = new Map<string, GeometryTile>()
  private geometry: BlobGeometry | null = null

  constructor(private engine: BlobEngine) {}

  /** Geometry for `layer`, reusing unchanged tiles from the previous call */
  update(layer: GridLayer, gridSize: number, borderWidth: number): BlobGeometry {
    if (
      this.geometry &&
      this.prev === layer &&
      this.gridSize === gridSize &&
      this.borderWidth === borderWidth
    ) {
      return this.geometry
    }

    const dirty =
      this.prev && this.gridSize === gridSize && this.borderWidth === borderWidth
        ? dirtyTiles(this.prev, layer)
        : "all"

    if (
      dirty === "all" ||
      dirty.size > Math.max(8, this.tiles.size * FULL_REGEN_RATIO)
    ) {
      this.regenerateAll(layer, gridSize, borderWidth)
    } else {
      const forceGroupMerge = this.engine.needsGroupMerge(layer)
      for (const key of dirty) {
        const [tx, ty] = key.split(",").map(Number)
        const tile = this.generateTile(layer, tx, ty, gridSize, borderWidth, forceGroupMerge)
        if (tile) this.tiles.set(key, tile)
        else this.tiles.delete(key)
      }
    }

    this.prev = layer
    this.gridSize = gridSize
    this.borderWidth = borderWidth
    this.geometry = this.assemble(gridSize, borderWidth)
    return this.geometry
  }

  private regenerateAll(layer: GridLayer, gridSize: number, borderWidth: number) {
    const full = this.engine.generateLayerGeometry(layer, gridSize, borderWidth)
    const buckets = new Map<string, BlobPrimitive[]>()
    for (const p of full.primitives) {
      const key = tileKey(tileOf(Math.floor(p.center.x)), tileOf(Math.floor(p.center.y)))
      let bucket = buckets.get(key)
      if (!bucket) buckets.set(key, (bucket = []))
      bucket.push(p)
    }
    this.tiles = new Map()
    for (const [key, primitives] of buckets) {
      const [tx, ty] = key.split(",").map(Number)
      this.tiles.set(key, makeTile(tx, ty, primitives))
    }
  }

  /** Regenerate one tile from a window of the layer around it */
  private generateTile(
    layer: GridLayer,
    tx: number,
    ty: number,
    gridSize: number,
    borderWidth: number,
    forceGroupMerge: boolean,
  ): GeometryTile | null {
    const x0 = tx * GEOMETRY_TILE_CELLS
    const y0 = ty * GEOMETRY_TILE_CELLS
    const x1 = x0 + GEOMETRY_TILE_CELLS - 1
    const y1 = y0 + GEOMETRY_TILE_CELLS - 1
    const wx0 = x0 - WINDOW_MARGIN
    const wy0 = y0 - WINDOW_MARGIN
    const wx1 = x1 + WINDOW_MARGIN
    const wy1 = y1 + WINDOW_MARGIN

    const windowGroups: InteractionGroup[] = layer.groups.map((g) => ({
      ...g,
      points: windowSet(g.points, wx0, wy0, wx1, wy1),
    }))
    let windowMods: Map<string, PointModifications> | undefined
    if (layer.pointModifications && layer.pointModifications.size > 0) {
      windowMods = new Map()
      for (const [key, mods] of layer.pointModifications) {
        const [x, y] = key.split(",").map(Number)
        if (x >= wx0 && x <= wx1 && y >= wy0 && y <= wy1) windowMods.set(key, mods)
      }
    }

    const windowLayer: GridLayer = {
      ...layer,
      groups: windowGroups,
      pointModifications: windowMods,
    }
    const { primitives } = this.engine.generateLayerGeometry(
      windowLayer,
      gridSize,
      borderWidth,
      undefined,
      { forceGroupMerge },
    )

    const inTile = primitives.filter((p) => {
      const cx = Math.floor(p.center.x)
      const cy = Math.floor(p.center.y)
      return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1
    })
    return inTile.length > 0 ? makeTile(tx, ty, inTile) : null
  }

  private assemble(gridSize: number, borderWidth: number): BlobGeometry {
    const primitives: BlobPrimitive[] = []
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity
    for (const tile of this.tiles.values()) {
      for (const p of tile.primitives) primitives.push(p)
      minX = Math.min(minX, tile.boundingBox.min.x)
      minY = Math.min(minY, tile.boundingBox.min.y)
      maxX = Math.max(maxX, tile.boundingBox.max.x)
      maxY = Math.max(maxY, tile.boundingBox.max.y)
    }
    return {
      primitives,
      boundingBox:
        primitives.length > 0
          ? { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } }
          : { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } },
      gridSize,
      borderWidth,
      // Snapshot: later updates replace entries in this.tiles
      tiles: new Map(this.tiles),
    }
  }
}

function makeTile(tileX: number, tileY: number, primitives: BlobPrimitive[]): GeometryTile {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const p of primitives) {
    if (p.center.x < minX) minX = p.center.x
    if (p.center.y < minY) minY = p.center.y
    if (p.center.x > maxX) maxX = p.center.x
    if (p.center.y > maxY) maxY = p.center.y
  }
  return {
    tileX,
    tileY,
    primitives,
    boundingBox: { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } },
  }
}

/** The members of `points` inside a cell window */
function windowSet(
  points: Set<string>,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Set<string> {
  const out = new Set<string>()
  const area = (x1 - x0 + 1) * (y1 - y0 + 1)
  if (points.size < area) {
    for (const key of points) {
      const [x, y] = key.split(",").map(Number)
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) out.add(key)
    }
  } else {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const key = `${x},${y}`
        if (points.has(key)) out.add(key)
      }
    }
  }
  return out
}

/**
 * Tiles whose primitives may differ between two versions of a layer, or "all"
 * when the change isn't local (groups added/removed/re-phased).
 */
export function dirtyTiles(prev: GridLayer, next: GridLayer): Set<string> | "all" {
  if (prev.groups.length !== next.groups.length) return "all"

  const changedCells: string[] = []
  for (let i = 0; i < next.groups.length; i++) {
    const a = prev.groups[i]
    const b = next.groups[i]
    if (a === b) continue
    if (
      a.id !== b.id ||
      a.offsetPhaseX !== b.offsetPhaseX ||
      a.offsetPhaseY !== b.offsetPhaseY
    ) {
      return "all"
    }
    if (a.points === b.points) continue
    for (const key of b.points) if (!a.points.has(key)) changedCells.push(key)
    for (const key of a.points) if (!b.points.has(key)) changedCells.push(key)
  }

  const ma = prev.pointModifications
  const mb = next.pointModifications
  if (ma !== mb) {
    if (mb) for (const [key, mods] of mb) if (ma?.get(key) !== mods) changedCells.push(key)
    if (ma) for (const key of ma.keys()) if (!mb?.has(key)) changedCells.push(key)
  }

  const dirty = new Set<string>()
  for (const key of changedCells) {
    const [x, y] = key.split(",").map(Number)
    for (let ty = tileOf(y - DIRTY_RADIUS); ty <= tileOf(y + DIRTY_RADIUS); ty++) {
      for (let tx = tileOf(x - DIRTY_RADIUS); tx <= tileOf(x + DIRTY_RADIUS); tx++) {
        dirty.add(tileKey(tx, ty))
      }
    }
  }
  return dirty
}
