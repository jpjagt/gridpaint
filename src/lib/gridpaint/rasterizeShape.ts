import type { ShapeKind, ShapeStyle, ShapeMeta } from "@/types/gridpaint"
import type { ClipboardData } from "@/types/gridpaint"

/**
 * Rasterize a superellipse into relative grid-cell keys ("x,y"), bbox top-left
 * at (0,0). width/height are in grid cells (clamped >= 1). `exponent` is the
 * superellipse n: ~8 ⇒ sharp rectangle, 2 ⇒ true ellipse, 1 ⇒ diamond.
 * `kind` is accepted for call-site clarity but does not change the math — only
 * the exponent does (the caller picks the kind-appropriate default exponent).
 */
export function rasterizeShape(
  _kind: ShapeKind,
  style: ShapeStyle,
  width: number,
  height: number,
  exponent: number,
): string[] {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const n = Math.max(1, exponent)

  const fill = superellipseFillCells(w, h, n)
  if (style === "fill") return [...fill]

  if (w <= 2 || h <= 2) return [...fill]

  const edge: string[] = []
  for (const key of fill) {
    const [x, y] = key.split(",").map(Number)
    const interior =
      fill.has(`${x - 1},${y}`) &&
      fill.has(`${x + 1},${y}`) &&
      fill.has(`${x},${y - 1}`) &&
      fill.has(`${x},${y + 1}`)
    if (!interior) edge.push(key)
  }
  return edge
}

/**
 * Build a single-layer/single-group ClipboardData from shape params, targeting
 * the given layerId/groupId. Bounds cover the full bbox (origin 0,0).
 */
export function buildShapeClipboard(
  kind: ShapeKind,
  style: ShapeStyle,
  width: number,
  height: number,
  exponent: number,
  layerId: number,
  groupId: string,
): ClipboardData {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const points = rasterizeShape(kind, style, w, h, exponent)
  return {
    layers: [{ layerId, groups: [{ id: groupId, points }] }],
    bounds: { minX: 0, minY: 0, maxX: w - 1, maxY: h - 1 },
  }
}

/**
 * Minimal shape-float shape used by {@link rebuildShapeFloatState}. Matches the
 * relevant fields of `FloatingPaste` (defined in @/stores/ui) structurally so
 * this leaf module stays free of a store import. Extra fields (e.g. `lifted`)
 * are preserved by the caller's spread.
 */
export interface ShapeFloatState {
  data: ClipboardData
  origin: { x: number; y: number }
  offset: { x: number; y: number }
  shape?: ShapeMeta
}

/**
 * Pure transform: given the current shape float, a patch of shape params, and an
 * optional origin shift (used when dragging NW/N/W handles so the opposite edge
 * stays anchored), return the next float with re-rasterized `data`. Returns
 * `null` when the float carries no shape meta (caller should no-op).
 *
 * Width/height are clamped to >= 1. The target layer/group are taken from the
 * float's existing data so the float keeps targeting whatever it already did.
 */
export function rebuildShapeFloatState<T extends ShapeFloatState>(
  fp: T,
  patch: Partial<ShapeMeta>,
  originDelta: { x: number; y: number } = { x: 0, y: 0 },
): T | null {
  if (!fp.shape) return null
  const next: ShapeMeta = {
    ...fp.shape,
    ...patch,
    width: Math.max(1, Math.round(patch.width ?? fp.shape.width)),
    height: Math.max(1, Math.round(patch.height ?? fp.shape.height)),
  }
  const layerId = fp.data.layers[0]?.layerId ?? 0
  const groupId = fp.data.layers[0]?.groups[0]?.id ?? "default"
  return {
    ...fp,
    shape: next,
    origin: { x: fp.origin.x + originDelta.x, y: fp.origin.y + originDelta.y },
    data: buildShapeClipboard(
      next.kind,
      next.style,
      next.width,
      next.height,
      next.exponent,
      layerId,
      groupId,
    ),
  }
}

/**
 * At/above this exponent the superellipse is treated as a true sharp rectangle
 * (full bbox). A finite `Math.pow` superellipse never fully includes the corners
 * for large shapes — the required n grows with size — so a sharp rectangle needs
 * this explicit cutoff rather than "a big number".
 */
export const SHARP_RECT_EXPONENT = 16

/** Cells whose center satisfies |nx|^n + |ny|^n <= 1 for the w×h bbox. */
function superellipseFillCells(w: number, h: number, n: number): Set<string> {
  const cells = new Set<string>()
  // Sharp rectangle: fill the whole bbox (corners included at any size).
  if (n >= SHARP_RECT_EXPONENT) {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) cells.add(`${x},${y}`)
    return cells
  }
  const a = w / 2
  const b = h / 2
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = Math.abs((x + 0.5 - a) / a)
      const ny = Math.abs((y + 0.5 - b) / b)
      if (Math.pow(nx, n) + Math.pow(ny, n) <= 1) cells.add(`${x},${y}`)
    }
  }
  return cells
}
