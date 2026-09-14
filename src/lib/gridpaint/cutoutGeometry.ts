import { CUTOUT_ANCHOR_OFFSETS } from "@/types/gridpaint"
import type { Cutout, CutoutGeometry, CutoutVertex } from "@/types/gridpaint"

/** Resolve physical size only at render time, using the caller's effective export scale. */
export function getCutoutGeometry(cutout: Cutout, x: number, y: number, mmPerUnit: number): CutoutGeometry {
  const anchor = cutout.anchor === "custom"
    ? (cutout.customOffset ?? { x: 0, y: 0 })
    : CUTOUT_ANCHOR_OFFSETS[cutout.anchor]
  const start = {
    x: x + anchor.x + (cutout.offset?.x ?? 0),
    y: y + anchor.y + (cutout.offset?.y ?? 0),
  }
  const delta = cutout.shape === "pill" ? cutout.endOffset : undefined
  const diameter = cutout.sizeUnit === "grid"
    ? (cutout.diameterGrid ?? 0.5)
    : cutout.diameterMm / mmPerUnit
  return {
    start,
    end: { x: start.x + (delta?.x ?? 0), y: start.y + (delta?.y ?? 0) },
    radius: Math.max(0.0001, Number.isFinite(diameter) ? diameter / 2 : 0.0001),
  }
}

/** A closed CCW hole: two semicircles, with tangent straight sides for pills. */
export function getCutoutVertices({ start, end, radius }: CutoutGeometry): CutoutVertex[] {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  if (length < 1e-9) {
    return [
      { x: start.x + radius, y: start.y, bulge: -1 },
      { x: start.x - radius, y: start.y, bulge: -1 },
    ]
  }
  const nx = -dy / length * radius
  const ny = dx / length * radius
  return [
    { x: start.x - nx, y: start.y - ny, bulge: -1 },
    { x: start.x + nx, y: start.y + ny, bulge: 0 },
    { x: end.x + nx, y: end.y + ny, bulge: -1 },
    { x: end.x - nx, y: end.y - ny, bulge: 0 },
  ]
}

export function cutoutSvgPath(geometry: CutoutGeometry): string {
  const vertices = getCutoutVertices(geometry)
  const fmt = (n: number) => String(Math.round(n * 1e6) / 1e6)
  const r = fmt(geometry.radius)
  let path = `M ${fmt(vertices[0].x)} ${fmt(vertices[0].y)}`
  vertices.forEach((vertex, index) => {
    const next = vertices[(index + 1) % vertices.length]
    path += vertex.bulge ? ` A ${r} ${r} 0 0 0` : " L"
    path += ` ${fmt(next.x)} ${fmt(next.y)}`
  })
  return `${path} Z`
}

/** Append without beginPath, so callers can combine holes in a clipping path. */
export function appendCutoutPath(path: CanvasRenderingContext2D | Path2D, geometry: CutoutGeometry): void {
  const vertices = getCutoutVertices(geometry)
  path.moveTo(vertices[0].x, vertices[0].y)
  vertices.forEach((vertex, index) => {
    const next = vertices[(index + 1) % vertices.length]
    if (vertex.bulge) {
      const cx = (vertex.x + next.x) / 2
      const cy = (vertex.y + next.y) / 2
      const angle = Math.atan2(vertex.y - cy, vertex.x - cx)
      path.arc(cx, cy, geometry.radius, angle, angle - Math.PI, true)
    } else {
      path.lineTo(next.x, next.y)
    }
  })
  path.closePath()
}

export function cutoutContainsPoint(geometry: CutoutGeometry, x: number, y: number): boolean {
  const { start, end, radius } = geometry
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    ((x - start.x) * dx + (y - start.y) * dy) / lengthSquared,
  ))
  return Math.hypot(x - start.x - t * dx, y - start.y - t * dy) <= radius
}
