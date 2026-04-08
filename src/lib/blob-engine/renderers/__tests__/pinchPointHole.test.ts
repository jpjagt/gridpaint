/**
 * Tests for pinch-point hole detection — the case where two filled regions
 * touch at a single grid vertex, producing an inner void that should be
 * classified as a hole by the containment check.
 *
 * Bug: the stitcher was merging the two loops into a single self-intersecting
 * figure-8 path, and even when two paths were produced, `isFullyContained`
 * failed because the one shared vertex caused a sampled point to land exactly
 * on the outer polygon boundary (numerically degenerate ray-cast).
 *
 * Fix:
 *   1. SvgPathRenderer.stitchEdgesIntoPaths — angle-based "hardest right turn"
 *      selection at multi-edge (pinch) vertices.
 *   2. pathUtils.isFullyContained — allows up to 1 outside/boundary point
 *      among the 50 sampled points.
 */

import { describe, it, expect } from "vitest"
import { BlobEngine } from "@/lib/blob-engine/BlobEngine"
import { SvgPathRenderer } from "@/lib/blob-engine/renderers/SvgPathRenderer"
import { createPathGroups } from "@/lib/export/pathUtils"
import type { GridLayer } from "@/lib/blob-engine/types"
import type { PointModifications } from "@/types/gridpaint" // used by the single-group override tests

const GRID_SIZE = 50
const BORDER_WIDTH = 2

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderLayer(layer: GridLayer) {
  const engine = new BlobEngine({ enableCaching: false })
  const geometry = engine.generateLayerGeometry(layer, GRID_SIZE, BORDER_WIDTH)
  // debugMode=true so _lastDebugInfo is populated
  const renderer = new SvgPathRenderer(true)
  renderer.renderLayer(
    geometry,
    { strokeColor: "#000", strokeWidth: 0.5, fillColor: "none" },
    { zoom: 1, panOffset: { x: 0, y: 0 }, viewportWidth: 100, viewportHeight: 100 },
    layer,
  )
  return renderer.getLastDebugInfo()
}

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

describe("Pinch-point hole detection", () => {
  /**
   * Plus/cross shape (0,1  1,0  1,1  1,2  2,1) with the NE quadrant (q3) of
   * the centre point (1,1) forced empty. This creates a small inner void whose
   * only contact with the outer boundary is the single shared corner vertex at
   * the top-right of (1,1).
   *
   * This is the exact example from the bug report.
   */
  it("plus shape with empty NE quadrant — stitcher produces 2 separate closed loops", () => {
    const layer: GridLayer = {
      id: 1,
      isVisible: true,
      renderStyle: "default",
      groups: [{ id: "default", points: new Set(["0,1", "1,0", "1,1", "1,2", "2,1"]) }],
        pointModifications: new Map<string, PointModifications>([
        ["1,1", { quadrantOverrides: { 3: "empty" } }],
      ]),
    }

    const debug = renderLayer(layer)
    expect(debug).not.toBeNull()

    // Should produce exactly 2 closed loops: the outer shape + the inner void
    expect(debug!.stitchedPaths).toHaveLength(2)
    for (const path of debug!.stitchedPaths) {
      const first = path[0].a
      const last = path[path.length - 1].b
      expect(last.x2).toBe(first.x2)
      expect(last.y2).toBe(first.y2)
    }
  })

  it("plus shape with empty NE quadrant — createPathGroups classifies inner loop as a hole", () => {
    const layer: GridLayer = {
      id: 1,
      isVisible: true,
      renderStyle: "default",
      groups: [{ id: "default", points: new Set(["0,1", "1,0", "1,1", "1,2", "2,1"]) }],
        pointModifications: new Map<string, PointModifications>([
        ["1,1", { quadrantOverrides: { 3: "empty" } }],
      ]),
    }

    const debug = renderLayer(layer)
    expect(debug).not.toBeNull()
    expect(debug!.svgPaths.length).toBeGreaterThanOrEqual(2)

    const groups = createPathGroups(debug!.svgPaths)

    // Exactly 1 outer group that contains the hole
    expect(groups).toHaveLength(1)
    expect(groups[0].holes).toHaveLength(1)
  })

  /**
   * Two diagonal blobs connected via a diagonalBridge form a single connected
   * bowtie/figure-8 shape — one closed loop, not two. Neither lobe is a hole
   * of the other; this tests that the containment check doesn't produce false
   * hole classifications for the bowtie case.
   */
  it("two diagonal blobs (bowtie) — 1 path, no false hole classification", () => {
    // Points (1,1) and (2,2) are diagonally connected via a diagonalBridge.
    // The blob engine treats them as one connected shape (a bowtie). The
    // stitcher should produce 1 closed loop (not a split), and createPathGroups
    // should classify it as a single outer shape with no holes.
    const layer: GridLayer = {
      id: 1,
      isVisible: true,
      renderStyle: "default",
      groups: [{ id: "default", points: new Set(["1,1", "2,2"]) }],
    }

    const debug = renderLayer(layer)
    expect(debug).not.toBeNull()

    // Connected blob → 1 closed loop
    expect(debug!.stitchedPaths).toHaveLength(1)

    // Single outer shape, no holes
    const groups = createPathGroups(debug!.svgPaths)
    expect(groups).toHaveLength(1)
    expect(groups[0].holes).toHaveLength(0)
  })

  /**
   * Donut / hollow square: a 3×3 ring of points with the centre empty.
   * This is the classic donut case — must produce 1 outer + 1 inner hole.
   */
  it("hollow square ring — 1 outer path + 1 hole", () => {
    const ring = new Set([
      "5,5", "6,5", "7,5",
      "5,6",         "7,6",
      "5,7", "6,7", "7,7",
    ])
    const layer: GridLayer = {
      id: 1,
      isVisible: true,
      renderStyle: "default",
      groups: [{ id: "default", points: ring }],
    }

    const debug = renderLayer(layer)
    expect(debug).not.toBeNull()

    const groups = createPathGroups(debug!.svgPaths)
    expect(groups).toHaveLength(1)
    expect(groups[0].holes).toHaveLength(1)
  })

  /**
   * Solid blob (no hole): a 2×2 square should produce exactly 1 outer path
   * with no holes.
   */
  it("solid 2×2 square — 1 outer path, 0 holes", () => {
    const layer: GridLayer = {
      id: 1,
      isVisible: true,
      renderStyle: "default",
      groups: [{ id: "default", points: new Set(["1,1", "2,1", "1,2", "2,2"]) }],
    }

    const debug = renderLayer(layer)
    expect(debug).not.toBeNull()

    const groups = createPathGroups(debug!.svgPaths)
    expect(groups).toHaveLength(1)
    expect(groups[0].holes).toHaveLength(0)
  })

  /**
   * Two disconnected solid blobs — should produce 2 separate outer paths,
   * no holes.
   */
  it("two disconnected blobs — 2 outer paths, 0 holes each", () => {
    const layer: GridLayer = {
      id: 1,
      isVisible: true,
      renderStyle: "default",
      groups: [{ id: "default", points: new Set(["1,1", "10,10"]) }],
    }

    const debug = renderLayer(layer)
    expect(debug).not.toBeNull()

    const groups = createPathGroups(debug!.svgPaths)
    expect(groups).toHaveLength(2)
    expect(groups.every((g) => g.holes.length === 0)).toBe(true)
  })

  /**
   * Multi-group layer: two groups whose rendered blob-shapes touch at exactly
   * one subgrid vertex (a pinch point), enclosing an inner void.
   *
   * Group 1 (arch): {0,1  1,0  2,1} — a blob arch. Group-isolated, so it has
   *   rounded corners where it doesn't see group-2 neighbors.
   * Group 2 (L):    {0,1  0,2  1,2  2,2} — an L-shape along the bottom-left.
   *   Shared point (0,1) is in both groups but rendered independently in each.
   *
   * The right arm of the arch (2,1) and the right end of the L (2,2) are in
   * different groups and don't blob — their rounded corners meet at a single
   * subgrid vertex (2,1.5), the pinch point.
   *
   * The arch curves over the top while the L runs along the bottom.  Together
   * they enclose a hole: the concave space inside the arch above the L's top
   * edge.
   *
   * Expected: stitcher produces 2 closed loops (outer perimeter + inner void),
   * createPathGroups classifies them as 1 outer path with 1 hole.
   */
  it("multi-group two touching blobs — stitcher splits at pinch, hole correctly detected", () => {
    const layer: GridLayer = {
      id: 1,
      isVisible: true,
      renderStyle: "default",
      groups: [
        { id: "default",  points: new Set(["0,1", "1,0", "2,1"]) },
        { id: "group-2",  points: new Set(["0,1", "0,2", "1,2", "2,2"]) },
      ],
    }

    const debug = renderLayer(layer)
    expect(debug).not.toBeNull()

    // The stitcher must split the self-touching boundary at the pinch point
    // into 2 closed loops rather than one merged figure-8
    expect(debug!.stitchedPaths).toHaveLength(2)

    // Both loops must be closed
    for (const path of debug!.stitchedPaths) {
      const first = path[0].a
      const last  = path[path.length - 1].b
      expect(last.x2).toBe(first.x2)
      expect(last.y2).toBe(first.y2)
    }

    // The arch + L together enclose a hole: 1 outer shape, 1 inner hole
    const groups = createPathGroups(debug!.svgPaths)
    expect(groups).toHaveLength(1)
    expect(groups[0].holes).toHaveLength(1)
  })
})
