/**
 * primitivePaths — world-space path emission for blob primitives.
 *
 * All primitives of a layer are appended into ONE path and filled with a
 * single nonzero-winding fill. That is what makes the result seam-free: a
 * single fill rasterizes coincident subpath edges together, so abutting
 * primitives can share exact edge coordinates with no antialiasing seam and
 * no outward "feather" expansion. Removing the feather is also what makes the
 * quarter circles exactly tangent to the straight edges they continue.
 *
 * Two invariants every emitted subpath must hold (see primitivePaths.test.ts):
 *
 *  1. Uniform winding (clockwise in y-down screen space, matching the
 *     SvgPathRenderer convention). Merged half-offset groups can produce
 *     overlapping primitives; under nonzero winding, equal orientations make
 *     overlaps fill solid while an opposite-wound subpath would punch a hole.
 *
 *  2. Exact coordinates on quadrant boundaries. Curve endpoints sit on the
 *     cell-edge midpoints with axis-aligned tangents; rectangles cover their
 *     quadrant exactly.
 *
 * Coordinates are computed directly in world space using exact 90° integer
 * rotations — no canvas transforms, no trigonometry, no per-primitive state.
 */

import type { BlobPrimitive, PathSink, Quadrant } from "../types"
import { magicNr } from "@/lib/constants"

// Rotation basis per quadrant: world = center + [a b; c d] · local.
// Quadrant rotations are 0°/90°/180°/270°, so entries are exact integers
// (canvas rotate(θ): (x,y) → (x·cosθ − y·sinθ, x·sinθ + y·cosθ)).
const ROT: Record<Quadrant, readonly [number, number, number, number]> = {
  0: [1, 0, 0, 1], // SE: identity
  1: [0, -1, 1, 0], // SW: 90°
  2: [-1, 0, 0, -1], // NW: 180°
  3: [0, 1, -1, 0], // NE: 270°
}

/**
 * Append the world-space outline of a primitive to a path sink.
 *
 * Local frame: the primitive's quadrant maps to the unit square (0,0)-(s,s)
 * with (0,0) at the cell center. `relOffset` (renderQuadrant − quadrant)
 * selects which corner of that square the quarter circle replaces/bulges
 * toward, mirroring the previous canvas-transform implementation.
 */
export function appendPrimitivePath(
  sink: PathSink,
  primitive: BlobPrimitive,
  gridSize: number,
): void {
  const cx = primitive.center.x * gridSize + gridSize / 2
  const cy = primitive.center.y * gridSize + gridSize / 2
  const [a, b, c, d] = ROT[primitive.quadrant]

  const move = (x: number, y: number) =>
    sink.moveTo(cx + a * x + b * y, cy + c * x + d * y)
  const line = (x: number, y: number) =>
    sink.lineTo(cx + a * x + b * y, cy + c * x + d * y)
  const curve = (
    c1x: number,
    c1y: number,
    c2x: number,
    c2y: number,
    x: number,
    y: number,
  ) =>
    sink.bezierCurveTo(
      cx + a * c1x + b * c1y,
      cy + c * c1x + d * c1y,
      cx + a * c2x + b * c2y,
      cy + c * c2x + d * c2y,
      cx + a * x + b * y,
      cy + c * x + d * y,
    )

  const s = primitive.size
  const cp = s * magicNr
  const rq = primitive.renderQuadrant ?? primitive.quadrant
  const rel = (((rq - primitive.quadrant) % 4) + 4) % 4

  switch (primitive.type) {
    case "rectangle":
      move(0, 0)
      line(s, 0)
      line(s, s)
      line(0, s)
      sink.closePath()
      return

    case "roundedCorner":
      // The quadrant square with one corner replaced by a quarter circle.
      // rel selects the replaced corner: 0→(s,s), 1→(0,s), 2→(0,0), 3→(s,0).
      if (rel === 0) {
        move(0, 0)
        line(s, 0)
        curve(s, cp, cp, s, 0, s)
      } else if (rel === 1) {
        move(0, 0)
        line(s, 0)
        line(s, s)
        curve(s - cp, s, 0, cp, 0, 0)
      } else if (rel === 2) {
        move(s, s)
        line(0, s)
        curve(0, s - cp, s - cp, 0, s, 0)
      } else {
        move(0, 0)
        curve(cp, 0, s, s - cp, s, s)
        line(0, s)
      }
      sink.closePath()
      return

    case "diagonalBridge":
      // The area between the same quarter circle and the corner it bulges
      // toward — the complement side of the roundedCorner's curve.
      if (rel === 0) {
        move(s, s)
        line(0, s)
        curve(cp, s, s, cp, s, 0)
      } else if (rel === 1) {
        move(0, 0)
        curve(0, cp, s - cp, s, s, s)
        line(0, s)
      } else if (rel === 2) {
        move(0, 0)
        line(s, 0)
        curve(s - cp, 0, 0, s - cp, 0, s)
      } else {
        move(s, s)
        curve(s, s - cp, cp, 0, 0, 0)
        line(s, 0)
      }
      sink.closePath()
      return
  }
}

/**
 * Append every primitive of a list to a path sink. Convenience wrapper used
 * by renderers when building per-tile or per-layer paths.
 */
export function appendPrimitivesPath(
  sink: PathSink,
  primitives: readonly BlobPrimitive[],
  gridSize: number,
): void {
  for (const primitive of primitives) {
    appendPrimitivePath(sink, primitive, gridSize)
  }
}
