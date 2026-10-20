/**
 * Flatten the SVG paths gridpaint emits (M, L, A with rx = ry, Z) into
 * rings, without a DOM, so outlines can be computed anywhere (workers,
 * node tests). Arcs are split finely enough for sub-0.01 mm accuracy at
 * typical mm-per-unit sizes.
 */

import type { Ring, Vec2 } from "@/types/rig"

/** Max angle per arc segment (radians) */
const MAX_ARC_STEP = Math.PI / 32

export function svgPathRings(svg: string): Ring[] {
  const rings: Ring[] = []
  for (const match of svg.matchAll(/\sd="([^"]*)"/g)) {
    rings.push(...pathRings(match[1]))
  }
  return rings
}

export function pathRings(d: string): Ring[] {
  const tokens = d.match(/[MLAZmlaz]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? []
  const rings: Ring[] = []
  let ring: Ring = []
  let i = 0
  const num = () => parseFloat(tokens[i++])
  let cur: Vec2 = { x: 0, y: 0 }
  let cmd = ""
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++]
    switch (cmd) {
      case "M": {
        if (ring.length >= 3) rings.push(ring)
        cur = { x: num(), y: num() }
        ring = [cur]
        cmd = "L"
        break
      }
      case "L": {
        cur = { x: num(), y: num() }
        ring.push(cur)
        break
      }
      case "A": {
        const r = num()
        num() // ry (always equal to rx here)
        num() // x-axis rotation
        const large = num()
        const sweep = num()
        const end = { x: num(), y: num() }
        ring.push(...arcPoints(cur, end, r, large === 1, sweep === 1))
        cur = end
        break
      }
      case "Z":
      case "z": {
        if (ring.length >= 3) rings.push(ring)
        ring = []
        cmd = ""
        break
      }
      default:
        // Unsupported command: skip a token to avoid looping forever
        i++
    }
  }
  if (ring.length >= 3) rings.push(ring)
  // Drop a closing point that repeats the start
  return rings.map((r) => {
    const a = r[0]
    const b = r[r.length - 1]
    return Math.hypot(a.x - b.x, a.y - b.y) < 1e-9 ? r.slice(0, -1) : r
  })
}

/** Points along a circular arc from a to b (excluding a, including b). */
function arcPoints(a: Vec2, b: Vec2, rIn: number, large: boolean, sweep: boolean): Vec2[] {
  const dx = (b.x - a.x) / 2
  const dy = (b.y - a.y) / 2
  const half = Math.hypot(dx, dy)
  if (half < 1e-12) return []
  const r = Math.max(rIn, half)
  // Centre: midpoint offset along the chord's normal
  const h = Math.sqrt(Math.max(0, r * r - half * half))
  const sign = large === sweep ? -1 : 1
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  const cx = mx + (sign * h * -dy) / half
  const cy = my + (sign * h * dx) / half
  const a0 = Math.atan2(a.y - cy, a.x - cx)
  let a1 = Math.atan2(b.y - cy, b.x - cx)
  // sweep = 1 means increasing angle in SVG's y-down frame
  if (sweep && a1 <= a0) a1 += Math.PI * 2
  if (!sweep && a1 >= a0) a1 -= Math.PI * 2
  const steps = Math.max(2, Math.ceil(Math.abs(a1 - a0) / MAX_ARC_STEP))
  const out: Vec2[] = []
  for (let s = 1; s < steps; s++) {
    const t = a0 + ((a1 - a0) * s) / steps
    out.push({ x: cx + Math.cos(t) * r, y: cy + Math.sin(t) * r })
  }
  out.push(b)
  return out
}
