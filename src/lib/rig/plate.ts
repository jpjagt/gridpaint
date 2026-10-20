/**
 * Base plate of the rig: the combined footprint of the layers and pillars,
 * grown by a margin, with narrow gaps closed and separate islands joined
 * by straight bridges so it prints as one part.
 */

import type { Region, Vec2 } from "@/types/rig"
import { isEmpty, offset, pieces, union } from "@/lib/rig/clip"

/** Plate margin around everything it carries (mm) */
export const PLATE_MARGIN = 2
/** Gaps narrower than this between plate parts are filled (mm) */
const CLOSE_GAP = 3
/** Width of bridges joining separate plate islands (mm) */
export const BRIDGE_WIDTH = 4

export function basePlate(carried: Region): Region {
  if (isEmpty(carried)) return []
  // Grow past the margin and back to fill narrow gaps, then add the margin
  const closed = offset(offset(carried, PLATE_MARGIN + CLOSE_GAP / 2), -CLOSE_GAP / 2)
  return connect(closed)
}

/** Join islands with bridges along a minimum spanning tree of gaps. */
function connect(region: Region): Region {
  const islands = pieces(region)
  if (islands.length <= 1) return region

  // Closest pair of outline points between every two islands
  const edges: { i: number; j: number; a: Vec2; b: Vec2; d: number }[] = []
  for (let i = 0; i < islands.length; i++)
    for (let j = i + 1; j < islands.length; j++) {
      const best = closestPoints(islands[i].outer, islands[j].outer)
      edges.push({ i, j, ...best })
    }
  edges.sort((x, y) => x.d - y.d)

  // Kruskal
  const parent = islands.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const bridges: Region[] = []
  for (const e of edges) {
    const ri = find(e.i)
    const rj = find(e.j)
    if (ri === rj) continue
    parent[ri] = rj
    bridges.push(bar(e.a, e.b, BRIDGE_WIDTH))
  }
  return union(region, ...bridges)
}

function closestPoints(p: Vec2[], q: Vec2[]): { a: Vec2; b: Vec2; d: number } {
  let best = { a: p[0], b: q[0], d: Infinity }
  for (const a of p)
    for (const b of q) {
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      if (d < best.d) best = { a, b, d }
    }
  return best
}

/** A straight bar from a to b, reaching width/2 past both ends. */
function bar(a: Vec2, b: Vec2, width: number): Region {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  const ux = (b.x - a.x) / len
  const uy = (b.y - a.y) / len
  const h = width / 2
  // Normal (-uy, ux); extend along u by h at both ends so it overlaps
  const s = { x: a.x - ux * h, y: a.y - uy * h }
  const e = { x: b.x + ux * h, y: b.y + uy * h }
  return union([
    [
      { x: s.x - uy * h, y: s.y + ux * h },
      { x: e.x - uy * h, y: e.y + ux * h },
      { x: e.x + uy * h, y: e.y - ux * h },
      { x: s.x + uy * h, y: s.y - ux * h },
    ],
  ])
}
