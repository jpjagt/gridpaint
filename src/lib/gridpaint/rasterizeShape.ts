import type { ShapeKind, ShapeStyle } from "@/types/gridpaint"
import type { ClipboardData } from "@/hooks/useSelection"

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

/** Cells whose center satisfies |nx|^n + |ny|^n <= 1 for the w×h bbox. */
function superellipseFillCells(w: number, h: number, n: number): Set<string> {
  const a = w / 2
  const b = h / 2
  const cells = new Set<string>()
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = Math.abs((x + 0.5 - a) / a)
      const ny = Math.abs((y + 0.5 - b) / b)
      if (Math.pow(nx, n) + Math.pow(ny, n) <= 1) cells.add(`${x},${y}`)
    }
  }
  return cells
}
