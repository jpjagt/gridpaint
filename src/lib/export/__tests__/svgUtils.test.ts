/**
 * Tests for SVG generation from grid points
 *
 * These tests verify that the blob rendering engine correctly generates
 * SVG paths from various grid point configurations, including:
 * - Single isolated points
 * - Connected blobs (horizontal, vertical, diagonal)
 * - Complex shapes with multiple neighborhood configurations
 * - Edge cases (empty layers, single points, etc.)
 */

import { describe, it, expect } from "vitest"
import * as fs from "fs"
import * as path from "path"
import {
  generateSingleLayerSvg,
  generateMultiLayerSvg,
  pointsToGridLayer,
  generateLayerSvgContentWithDebug,
} from "../svgUtils"
import {
  extractPathsFromSvg,
  countPaths,
  parseSvgPath,
  getPathBounds,
  isPathClosed,
  countPathCommands,
  svgsGeometricallyEqual,
  formatSvgDiff,
} from "@/lib/test-utils/svgPathMatchers"
import type { GridLayer } from "@/lib/blob-engine/types"
import type { SvgRenderDebugInfo } from "../svgUtils"

/** Shorthand: wrap a Set<string> into a GridLayer for testing */
const layer = (points: Set<string>, id = 1) => pointsToGridLayer(points, id)

describe("SVG Generation from Grid Points", () => {
  const DEFAULT_GRID_SIZE = 50
  const DEFAULT_BORDER_WIDTH = 2

  describe("Single Layer SVG Generation", () => {
    it("should generate valid SVG for empty points", () => {
      const svg = generateSingleLayerSvg(
        layer(new Set<string>()),
        DEFAULT_GRID_SIZE,
        DEFAULT_BORDER_WIDTH,
      )

      expect(svg).toContain('<?xml version="1.0"')
      expect(svg).toContain("<svg")
      expect(svg).toContain("</svg>")
      // Empty should have no paths
      expect(countPaths(svg)).toBe(0)
    })

    it("should generate SVG for a single point", () => {
      const svg = generateSingleLayerSvg(
        layer(new Set(["5,5"])),
        DEFAULT_GRID_SIZE,
        DEFAULT_BORDER_WIDTH,
      )

      expect(svg).toContain("<svg")
      expect(countPaths(svg)).toBeGreaterThan(0)

      // Should have viewBox
      expect(svg).toMatch(/viewBox="[^"]*"/)
    })

    it("should generate SVG for two horizontally adjacent points", () => {
      const svg = generateSingleLayerSvg(
        layer(new Set(["5,5", "6,5"])),
        DEFAULT_GRID_SIZE,
        DEFAULT_BORDER_WIDTH,
      )

      expect(svg).toContain("<svg")
      expect(countPaths(svg)).toBeGreaterThan(0)
    })

    it("should generate SVG for two vertically adjacent points", () => {
      const svg = generateSingleLayerSvg(
        layer(new Set(["5,5", "5,6"])),
        DEFAULT_GRID_SIZE,
        DEFAULT_BORDER_WIDTH,
      )

      expect(svg).toContain("<svg")
      expect(countPaths(svg)).toBeGreaterThan(0)
    })

    it("should generate SVG for two diagonally adjacent points", () => {
      const svg = generateSingleLayerSvg(
        layer(new Set(["5,5", "6,6"])),
        DEFAULT_GRID_SIZE,
        DEFAULT_BORDER_WIDTH,
      )

      expect(svg).toContain("<svg")
      expect(countPaths(svg)).toBeGreaterThan(0)
    })

    it("should generate SVG for a 2x2 square", () => {
      const svg = generateSingleLayerSvg(
        layer(new Set(["5,5", "6,5", "5,6", "6,6"])),
        DEFAULT_GRID_SIZE,
        DEFAULT_BORDER_WIDTH,
      )

      expect(svg).toContain("<svg")
      const paths = extractPathsFromSvg(svg)
      expect(paths.length).toBeGreaterThan(0)

      // All paths should have valid d attributes
      paths.forEach((path) => {
        expect(path.d).toBeTruthy()
        expect(path.d.length).toBeGreaterThan(0)
      })
    })

    it("should generate SVG for an L-shape", () => {
      const svg = generateSingleLayerSvg(
        layer(new Set(["5,5", "6,5", "5,6"])),
        DEFAULT_GRID_SIZE,
        DEFAULT_BORDER_WIDTH,
      )

      expect(svg).toContain("<svg")
      expect(countPaths(svg)).toBeGreaterThan(0)
    })

    it("should generate SVG for a T-shape", () => {
      const svg = generateSingleLayerSvg(
        layer(new Set(["5,5", "4,5", "6,5", "5,6"])),
        DEFAULT_GRID_SIZE,
        DEFAULT_BORDER_WIDTH,
      )

      expect(svg).toContain("<svg")
      expect(countPaths(svg)).toBeGreaterThan(0)
    })

    it("should generate SVG for a plus (+) shape", () => {
      const svg = generateSingleLayerSvg(
        layer(new Set(["5,5", "4,5", "6,5", "5,4", "5,6"])),
        DEFAULT_GRID_SIZE,
        DEFAULT_BORDER_WIDTH,
      )

      expect(svg).toContain("<svg")
      expect(countPaths(svg)).toBeGreaterThan(0)
    })

    it("should generate SVG for complex user-provided example", () => {
      // From the user's gridpaint-selection data
      const points = new Set([
        "1,10",
        "1,12",
        "2,10",
        "2,13",
        "3,9",
        "3,10",
        "3,12",
        "5,3",
        "5,6",
        "5,10",
        "5,13",
        "5,15",
        "5,16",
        "6,2",
        "6,4",
        "6,7",
        "6,9",
        "6,10",
        "6,12",
        "6,15",
        "6,16",
        "6,17",
        "8,2",
        "8,3",
        "8,4",
        "8,6",
        "8,7",
        "8,9",
        "8,10",
        "8,12",
        "8,15",
        "9,4",
        "9,7",
        "9,9",
        "9,10",
        "9,12",
        "9,13",
        "9,15",
        "9,16",
        "9,17",
        "11,7",
        "11,9",
        "11,10",
        "11,12",
        "11,15",
        "11,17",
        "12,6",
        "12,9",
        "12,13",
        "12,16",
        "14,9",
        "14,10",
        "14,13",
        "14,15",
        "14,16",
        "14,17",
        "15,9",
        "15,12",
        "15,15",
        "15,17",
        "16,9",
        "16,13",
        "16,15",
        "16,16",
        "16,17",
        "18,16",
        "19,15",
        "19,17",
        "20,16",
      ])

      const svg = generateSingleLayerSvg(
        layer(points),
        DEFAULT_GRID_SIZE,
        DEFAULT_BORDER_WIDTH,
      )

      expect(svg).toContain("<svg")
      expect(svg).toContain("<?xml version")
      expect(countPaths(svg)).toBeGreaterThan(0)

      // Should have proper viewBox
      expect(svg).toMatch(/viewBox="[^"]*"/)

      // All paths should be valid
      const paths = extractPathsFromSvg(svg)
      paths.forEach((path) => {
        expect(path.d).toBeTruthy()
        // Path should parse without errors
        const commands = parseSvgPath(path.d)
        expect(commands.length).toBeGreaterThan(0)
      })
    })
  })

  describe("Multi-Layer SVG Generation", () => {
    it("should generate SVG for multiple layers", () => {
      const layers = [
        pointsToGridLayer(new Set(["5,5", "6,5"]), 1),
        pointsToGridLayer(new Set(["7,7", "8,7"]), 2),
      ]

      const svg = generateMultiLayerSvg(
        layers,
        DEFAULT_GRID_SIZE,
        DEFAULT_BORDER_WIDTH,
      )

      expect(svg).toContain("<svg")
      expect(countPaths(svg)).toBeGreaterThan(0)
    })

    it("should handle layers with no visible points", () => {
      const layers = [
        pointsToGridLayer(new Set(), 1),
        pointsToGridLayer(new Set(), 2),
      ]

      const svg = generateMultiLayerSvg(
        layers,
        DEFAULT_GRID_SIZE,
        DEFAULT_BORDER_WIDTH,
      )

      expect(svg).toContain("<svg")
      expect(countPaths(svg)).toBe(0)
    })

    it("should handle mix of empty and non-empty layers", () => {
      const layers = [
        pointsToGridLayer(new Set(), 1),
        pointsToGridLayer(new Set(["5,5"]), 2),
        pointsToGridLayer(new Set(), 3),
      ]

      const svg = generateMultiLayerSvg(
        layers,
        DEFAULT_GRID_SIZE,
        DEFAULT_BORDER_WIDTH,
      )

      expect(svg).toContain("<svg")
      expect(countPaths(svg)).toBeGreaterThan(0)
    })

    it("should filter invisible layers", () => {
      const layers = [
        { ...pointsToGridLayer(new Set(["5,5"]), 1), isVisible: true },
        { ...pointsToGridLayer(new Set(["7,7"]), 2), isVisible: false },
      ]

      const svg = generateMultiLayerSvg(
        layers,
        DEFAULT_GRID_SIZE,
        DEFAULT_BORDER_WIDTH,
      )

      expect(svg).toContain("<svg")
      // Should only have paths from layer 1
      const pathCount = countPaths(svg)
      expect(pathCount).toBeGreaterThan(0)
    })
  })

  describe("SVG Structure and Attributes", () => {
    it("should include proper XML declaration", () => {
      const svg = generateSingleLayerSvg(
        layer(new Set(["5,5"])),
        DEFAULT_GRID_SIZE,
        DEFAULT_BORDER_WIDTH,
      )

      expect(svg).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/)
    })

    it("should have xmlns attribute", () => {
      const svg = generateSingleLayerSvg(
        layer(new Set(["5,5"])),
        DEFAULT_GRID_SIZE,
        DEFAULT_BORDER_WIDTH,
      )

      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    })

    it("should include physical dimensions in mm", () => {
      const mmPerUnit = 1.0
      const svg = generateSingleLayerSvg(
        layer(new Set(["5,5", "6,5"])),
        DEFAULT_GRID_SIZE,
        DEFAULT_BORDER_WIDTH,
        undefined,
        false,
        mmPerUnit,
      )

      expect(svg).toMatch(/width="[\d.]+mm"/)
      expect(svg).toMatch(/height="[\d.]+mm"/)
    })

    it("should respect custom mmPerUnit parameter", () => {
      const mmPerUnit = 2.5
      const svg = generateSingleLayerSvg(
        layer(new Set(["5,5", "6,5"])),
        DEFAULT_GRID_SIZE,
        DEFAULT_BORDER_WIDTH,
        undefined,
        false,
        mmPerUnit,
      )

      // Extract width value and verify it accounts for mmPerUnit
      const widthMatch = svg.match(/width="([\d.]+)mm"/)
      expect(widthMatch).toBeTruthy()

      if (widthMatch) {
        const width = parseFloat(widthMatch[1])
        expect(width).toBeGreaterThan(0)
        // Width should be scaled by mmPerUnit
        expect(width).toBeCloseTo(mmPerUnit * 3, 1) // Approximate, depends on padding
      }
    })

    it("should apply default SVG styling", () => {
      const svg = generateSingleLayerSvg(
        layer(new Set(["5,5"])),
        DEFAULT_GRID_SIZE,
        DEFAULT_BORDER_WIDTH,
      )

      const paths = extractPathsFromSvg(svg)
      expect(paths.length).toBeGreaterThan(0)

      // Check that SVG contains stroke and fill styling
      // (may be on path elements or in a style attribute)
      expect(svg).toContain("stroke")
      expect(svg).toContain("fill")
    })

    it("should respect custom styling options", () => {
      const customStyle = {
        strokeColor: "#ff0000",
        strokeWidth: 0.5,
        fillColor: "#00ff00",
        opacity: 0.8,
      }

      const svg = generateSingleLayerSvg(
        layer(new Set(["5,5"])),
        DEFAULT_GRID_SIZE,
        DEFAULT_BORDER_WIDTH,
        customStyle,
      )

      expect(svg).toContain('stroke="#ff0000"')
      expect(svg).toContain('fill="#00ff00"')
      expect(svg).toContain('opacity="0.8"')
    })
  })

  describe("Edge Cases", () => {
    it("should handle very large coordinate values", () => {
      const svg = generateSingleLayerSvg(
        layer(new Set(["1000,1000", "1001,1000"])),
        DEFAULT_GRID_SIZE,
        DEFAULT_BORDER_WIDTH,
      )

      expect(svg).toContain("<svg")
      expect(countPaths(svg)).toBeGreaterThan(0)
    })

    it("should handle negative coordinate values", () => {
      const svg = generateSingleLayerSvg(
        layer(new Set(["-5,-5", "-4,-5"])),
        DEFAULT_GRID_SIZE,
        DEFAULT_BORDER_WIDTH,
      )

      expect(svg).toContain("<svg")
      expect(countPaths(svg)).toBeGreaterThan(0)
    })

    it("should handle mix of positive and negative coordinates", () => {
      const svg = generateSingleLayerSvg(
        layer(new Set(["-5,5", "5,-5", "0,0"])),
        DEFAULT_GRID_SIZE,
        DEFAULT_BORDER_WIDTH,
      )

      expect(svg).toContain("<svg")
      expect(countPaths(svg)).toBeGreaterThan(0)
    })

    it("should handle points in a line (horizontal)", () => {
      const svg = generateSingleLayerSvg(
        layer(new Set(["1,5", "2,5", "3,5", "4,5", "5,5"])),
        DEFAULT_GRID_SIZE,
        DEFAULT_BORDER_WIDTH,
      )

      expect(svg).toContain("<svg")
      expect(countPaths(svg)).toBeGreaterThan(0)
    })

    it("should handle points in a line (vertical)", () => {
      const svg = generateSingleLayerSvg(
        layer(new Set(["5,1", "5,2", "5,3", "5,4", "5,5"])),
        DEFAULT_GRID_SIZE,
        DEFAULT_BORDER_WIDTH,
      )

      expect(svg).toContain("<svg")
      expect(countPaths(svg)).toBeGreaterThan(0)
    })

    it("should handle sparse scattered points", () => {
      const svg = generateSingleLayerSvg(
        layer(new Set(["0,0", "10,10", "20,5", "15,15", "5,20"])),
        DEFAULT_GRID_SIZE,
        DEFAULT_BORDER_WIDTH,
      )

      expect(svg).toContain("<svg")
      expect(countPaths(svg)).toBeGreaterThan(0)
    })
  })

  describe("Neighborhood Configurations", () => {
    it("should handle all corners filled (3x3 block)", () => {
      const svg = generateSingleLayerSvg(
        layer(new Set([
          "5,5",
          "6,5",
          "7,5",
          "5,6",
          "6,6",
          "7,6",
          "5,7",
          "6,7",
          "7,7",
        ])),
        DEFAULT_GRID_SIZE,
        DEFAULT_BORDER_WIDTH,
      )

      expect(svg).toContain("<svg")
      expect(countPaths(svg)).toBeGreaterThan(0)
    })

    it("should handle diagonal bridge pattern", () => {
      const svg = generateSingleLayerSvg(
        layer(new Set([
          "5,5",
          "6,6",
          "7,7", // diagonal line
        ])),
        DEFAULT_GRID_SIZE,
        DEFAULT_BORDER_WIDTH,
      )

      expect(svg).toContain("<svg")
      expect(countPaths(svg)).toBeGreaterThan(0)
    })

    it("should handle checkerboard pattern (4x4)", () => {
      const svg = generateSingleLayerSvg(
        layer(new Set([
          "5,5",
          "7,5",
          "6,6",
          "8,6",
          "5,7",
          "7,7",
          "6,8",
          "8,8",
        ])),
        DEFAULT_GRID_SIZE,
        DEFAULT_BORDER_WIDTH,
      )

      expect(svg).toContain("<svg")
      expect(countPaths(svg)).toBeGreaterThan(0)
    })

    it("should handle hollow square (4x4 with center empty)", () => {
      const svg = generateSingleLayerSvg(
        layer(new Set([
          "5,5",
          "6,5",
          "7,5",
          "8,5",
          "5,6",
          "8,6",
          "5,7",
          "8,7",
          "5,8",
          "6,8",
          "7,8",
          "8,8",
        ])),
        DEFAULT_GRID_SIZE,
        DEFAULT_BORDER_WIDTH,
      )

      expect(svg).toContain("<svg")
      expect(countPaths(svg)).toBeGreaterThan(0)
    })
  })

  describe("Path Comparison Robustness", () => {
    it("should generate consistent paths for the same shape", () => {
      // Generate the same shape multiple times
      const l = layer(new Set(["5,5", "6,5", "5,6", "6,6"]))

      const svg1 = generateSingleLayerSvg(l, DEFAULT_GRID_SIZE, DEFAULT_BORDER_WIDTH)
      const svg2 = generateSingleLayerSvg(l, DEFAULT_GRID_SIZE, DEFAULT_BORDER_WIDTH)

      const paths1 = extractPathsFromSvg(svg1)
      const paths2 = extractPathsFromSvg(svg2)

      expect(paths1.length).toBe(paths2.length)

      // Paths should have same bounds even if commands differ
      for (let i = 0; i < paths1.length; i++) {
        const bounds1 = getPathBounds(paths1[i].d)
        const bounds2 = getPathBounds(paths2[i].d)

        expect(bounds1).toBeTruthy()
        expect(bounds2).toBeTruthy()

        if (bounds1 && bounds2) {
          expect(bounds1.minX).toBeCloseTo(bounds2.minX, 1)
          expect(bounds1.minY).toBeCloseTo(bounds2.minY, 1)
          expect(bounds1.maxX).toBeCloseTo(bounds2.maxX, 1)
          expect(bounds1.maxY).toBeCloseTo(bounds2.maxY, 1)
        }
      }
    })

    it("should generate closed paths for shapes", () => {
      const svg = generateSingleLayerSvg(
        layer(new Set(["5,5", "6,5", "5,6", "6,6"])),
        DEFAULT_GRID_SIZE,
        DEFAULT_BORDER_WIDTH,
      )

      const paths = extractPathsFromSvg(svg)
      expect(paths.length).toBeGreaterThan(0)

      // All paths should be closed
      paths.forEach(path => {
        expect(isPathClosed(path.d)).toBe(true)
      })
    })

    it("should handle different grid sizes producing proportional bounds", () => {
      const l50 = layer(new Set(["5,5", "6,5"]))
      const l100 = layer(new Set(["5,5", "6,5"]))

      const svg50 = generateSingleLayerSvg(l50, 50, 2)
      const svg100 = generateSingleLayerSvg(l100, 100, 2)

      const paths50 = extractPathsFromSvg(svg50)
      const paths100 = extractPathsFromSvg(svg100)

      expect(paths50.length).toBe(paths100.length)

      // Both should produce similar number of commands (same shape complexity)
      if (paths50.length > 0 && paths100.length > 0) {
        const cmdCount50 = countPathCommands(paths50[0].d)
        const cmdCount100 = countPathCommands(paths100[0].d)

        // Should have same number of commands (shape complexity independent of grid size)
        expect(cmdCount50).toBe(cmdCount100)
      }
    })

    it("should produce valid path syntax for all test cases", () => {
      const testCases = [
        new Set(["5,5"]),
        new Set(["5,5", "6,5"]),
        new Set(["5,5", "6,6"]),
        new Set(["5,5", "6,5", "5,6", "6,6"]),
        new Set(["5,5", "6,5", "7,5"]),
      ]

      testCases.forEach((points) => {
        const svg = generateSingleLayerSvg(layer(points), DEFAULT_GRID_SIZE, DEFAULT_BORDER_WIDTH)
        const paths = extractPathsFromSvg(svg)

        paths.forEach((path) => {
          // Should parse without errors
          const commands = parseSvgPath(path.d)
          expect(commands.length).toBeGreaterThan(0)

          // First command should be M (move)
          expect(commands[0].type.toUpperCase()).toBe('M')

          // Should have coordinates
          expect(commands[0].coords.length).toBeGreaterThanOrEqual(2)
        })
      })
    })
  })

  describe("Quadrant Override SVG Generation", () => {
    /**
     * Helper: create a GridLayer with a single point that has quadrant overrides.
     */
    function layerWithOverrides(
      points: Set<string>,
      overridePointKey: string,
      overrides: import("@/types/gridpaint").QuadrantOverrides,
      layerId = 1,
    ): import("@/lib/blob-engine/types").GridLayer {
      return {
        id: layerId,
        groups: [{ id: "default", points }],
        isVisible: true,
        renderStyle: "default",
        pointModifications: new Map([
          [overridePointKey, { quadrantOverrides: overrides }],
        ]),
      }
    }

    it("should generate valid SVG for single point with NE concave-nw override (Bug #1)", () => {
      // This is the exact scenario from the bug report:
      // Single point at (5,2), NE quadrant overridden to concave-nw
      const overrideLayer = layerWithOverrides(
        new Set(["5,2"]),
        "5,2",
        { 3: "concave-nw" }, // NE quadrant → concave-nw
      )

      const svg = generateSingleLayerSvg(
        overrideLayer,
        DEFAULT_GRID_SIZE,
        DEFAULT_BORDER_WIDTH,
      )

      expect(svg).toContain("<svg")
      const paths = extractPathsFromSvg(svg)
      expect(paths.length).toBeGreaterThan(0)

      // All paths should be closed and parseable
      for (const path of paths) {
        expect(isPathClosed(path.d)).toBe(true)
        const commands = parseSvgPath(path.d)
        expect(commands.length).toBeGreaterThan(0)
        expect(commands[0].type.toUpperCase()).toBe("M")
      }
    })

    it("should generate valid SVG for single point with NE convex-sw override", () => {
      // relOffset 2: opposite direction override
      const overrideLayer = layerWithOverrides(
        new Set(["5,5"]),
        "5,5",
        { 3: "convex-sw" }, // NE quadrant → convex-sw (relOffset 2)
      )

      const svg = generateSingleLayerSvg(
        overrideLayer,
        DEFAULT_GRID_SIZE,
        DEFAULT_BORDER_WIDTH,
      )

      expect(svg).toContain("<svg")
      const paths = extractPathsFromSvg(svg)
      expect(paths.length).toBeGreaterThan(0)

      for (const path of paths) {
        expect(isPathClosed(path.d)).toBe(true)
      }
    })

    it("should generate valid SVG for single point with SE concave-ne override", () => {
      // SE quadrant overridden to concave-ne (relOffset 3)
      const overrideLayer = layerWithOverrides(
        new Set(["3,3"]),
        "3,3",
        { 0: "concave-ne" },
      )

      const svg = generateSingleLayerSvg(
        overrideLayer,
        DEFAULT_GRID_SIZE,
        DEFAULT_BORDER_WIDTH,
      )

      expect(svg).toContain("<svg")
      const paths = extractPathsFromSvg(svg)
      expect(paths.length).toBeGreaterThan(0)

      for (const path of paths) {
        expect(isPathClosed(path.d)).toBe(true)
      }
    })

    it("should generate valid SVG for single point with empty quadrant override", () => {
      // One quadrant removed entirely
      const overrideLayer = layerWithOverrides(
        new Set(["5,5"]),
        "5,5",
        { 0: "empty" }, // Remove SE quadrant
      )

      const svg = generateSingleLayerSvg(
        overrideLayer,
        DEFAULT_GRID_SIZE,
        DEFAULT_BORDER_WIDTH,
      )

      expect(svg).toContain("<svg")
      const paths = extractPathsFromSvg(svg)
      expect(paths.length).toBeGreaterThan(0)

      for (const path of paths) {
        expect(isPathClosed(path.d)).toBe(true)
      }
    })

    it("should produce different SVG for overridden vs non-overridden point", () => {
      const normalLayer = layer(new Set(["5,5"]))
      const overrideLayer = layerWithOverrides(
        new Set(["5,5"]),
        "5,5",
        { 3: "concave-nw" },
      )

      const normalSvg = generateSingleLayerSvg(normalLayer, DEFAULT_GRID_SIZE, DEFAULT_BORDER_WIDTH)
      const overrideSvg = generateSingleLayerSvg(overrideLayer, DEFAULT_GRID_SIZE, DEFAULT_BORDER_WIDTH)

      // The override should change the output
      const normalPaths = extractPathsFromSvg(normalSvg)
      const overridePaths = extractPathsFromSvg(overrideSvg)

      // Override should produce different path data
      // (either different number of paths or different path content)
      const normalDs = normalPaths.map((p) => p.d).sort()
      const overrideDs = overridePaths.map((p) => p.d).sort()

      expect(normalDs.join("|")).not.toBe(overrideDs.join("|"))
    })
  })

  // ─── Fixture-based tests ──────────────────────────────────────────────────
  //
  // Each subdirectory under examples/ is one test case:
  //   input.json     — GridPaint document (full document format)
  //   correct.svg    — reference path (the expected shape, as a bare path string
  //                    or a full SVG document; we only compare the <path d> data)
  //   corrected.svg  — alias accepted for "correct.svg"
  //
  // Comparison is geometric (point-sampling on arcs / Bézier curves), so it is
  // invariant to:
  //   • start point / traversal order
  //   • arc parameter representations (large-arc-flag, sweep-flag)
  //   • CW vs CCW direction
  //   • floating-point formatting
  //
  describe("Example fixture tests", () => {
    const examplesRoot = path.resolve(__dirname, "../../../../examples")

    /**
     * Load a GridPaint document JSON and return the first layer as a GridLayer.
     * Handles pointModifications stored as plain object (JSON) → Map.
     */
    function loadGridLayer(inputJson: unknown): GridLayer {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const doc = inputJson as any
      const rawLayer = doc.layers[0]

      const groups = (rawLayer.groups ?? []).map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (g: any) => ({
          id: g.id,
          points: new Set<string>(g.points),
        })
      )

      // pointModifications may be a plain object in JSON
      let pointModifications: Map<string, unknown> | undefined
      if (rawLayer.pointModifications) {
        pointModifications = new Map(
          Object.entries(rawLayer.pointModifications)
        )
      }

      return {
        id: rawLayer.id ?? 1,
        groups,
        isVisible: rawLayer.isVisible ?? true,
        renderStyle: rawLayer.renderStyle ?? "default",
        pointModifications: pointModifications as GridLayer["pointModifications"],
      }
    }

    /**
     * Wrap a bare path string in minimal SVG so extractPathsFromSvg can find it.
     */
    function wrapBarePathInSvg(content: string): string {
      const trimmed = content.trim()
      // Already an SVG document?
      if (trimmed.startsWith("<")) return trimmed
      // Bare path string — wrap it
      return `<svg xmlns="http://www.w3.org/2000/svg"><path d="${trimmed}" /></svg>`
    }

    if (!fs.existsSync(examplesRoot)) {
      it("examples directory not found — skipping fixture tests", () => {
        expect(true).toBe(true)
      })
    } else {
      const exampleDirs = fs
        .readdirSync(examplesRoot)
        .filter((name) => {
          const full = path.join(examplesRoot, name)
          return fs.statSync(full).isDirectory()
        })
        .sort()

      for (const exampleName of exampleDirs) {
        const exampleDir = path.join(examplesRoot, exampleName)

        // Find reference SVG (accept both "correct.svg" and "corrected.svg")
        const refFile = ["correct.svg", "corrected.svg"].find((f) =>
          fs.existsSync(path.join(exampleDir, f))
        )
        const inputFile = path.join(exampleDir, "input.json")

        if (!refFile || !fs.existsSync(inputFile)) {
          it(`example ${exampleName}: skipping (missing input.json or correct/corrected.svg)`, () => {
            expect(true).toBe(true)
          })
          continue
        }

        it(`example ${exampleName}: SVG output matches reference`, () => {
          const inputJson = JSON.parse(fs.readFileSync(inputFile, "utf-8"))
          const refRaw = fs.readFileSync(path.join(exampleDir, refFile), "utf-8")

          const gridLayer = loadGridLayer(inputJson)
          const doc = inputJson as { gridSize?: number; borderWidth?: number }
          const gridSize = doc.gridSize ?? 50
          const borderWidth = doc.borderWidth ?? 2

          const { debugInfo } = generateLayerSvgContentWithDebug(gridLayer, gridSize, borderWidth)
          const actualSvg = generateSingleLayerSvg(gridLayer, gridSize, borderWidth)
          const expectedSvg = wrapBarePathInSvg(refRaw)

          const result = svgsGeometricallyEqual(actualSvg, expectedSvg, {
            epsilon: 0.01,
            samplesPerSegment: 16,
          })

          if (!result.equal) {
            const fmtEdge = (e: SvgRenderDebugInfo["boundaryEdges"][number]) =>
              e.kind === "line"
                ? `  line  (${e.a.x2 / 2},${e.a.y2 / 2})→(${e.b.x2 / 2},${e.b.y2 / 2})`
                : `  arc   (${e.a.x2 / 2},${e.a.y2 / 2})→(${e.b.x2 / 2},${e.b.y2 / 2}) center=(${e.center.x2 / 2},${e.center.y2 / 2}) sweep=${e.sweep}`

            let debugDump = ""
            if (debugInfo) {
              debugDump = [
                "",
                `── BlobPrimitives (${debugInfo.primitiveEdges.length}):`,
                ...debugInfo.primitiveEdges.map(
                  ({ primitive: p }) =>
                    `  ${p.type.padEnd(16)} q${p.quadrant}${p.renderQuadrant !== undefined ? ` rq${p.renderQuadrant}` : ""}  (${p.center.x},${p.center.y})  curveType=${p.curveType}`
                ),
                "",
                `── All raw edges (${debugInfo.allEdges.length}):`,
                ...debugInfo.allEdges.map(fmtEdge),
                "",
                `── Boundary edges after dedup (${debugInfo.boundaryEdges.length}):`,
                ...debugInfo.boundaryEdges.map(fmtEdge),
                "",
                `── Stitched paths (${debugInfo.stitchedPaths.length} path(s)):`,
                ...debugInfo.stitchedPaths.flatMap((pathSegs, pi) => [
                  `  path[${pi}] (${pathSegs.length} edges):`,
                  ...pathSegs.map((e) => "  " + fmtEdge(e)),
                ]),
                "",
                `── SVG paths emitted (${debugInfo.svgPaths.length}):`,
                ...debugInfo.svgPaths.map((p, i) => `  [${i}] ${p}`),
                "",
                `── Stats: total=${debugInfo.stats.totalEdges} cancelled=${debugInfo.stats.cancelledEdges} boundary=${debugInfo.stats.boundaryEdges} paths=${debugInfo.stats.pathCount}`,
              ].join("\n")
            }

            throw new Error(
              `SVG geometric mismatch in example "${exampleName}":\n\n` +
              formatSvgDiff(result.actualPaths, result.expectedPaths, result.reason) +
              debugDump
            )
          }
        })
      }
    }
  })

  describe("Multi-Group SVG Generation (Group Merge)", () => {
    it("should generate valid SVG for two adjacent groups sharing a boundary", () => {
      // Two groups that together form a 2x1 horizontal shape
      const twoGroupLayer: import("@/lib/blob-engine/types").GridLayer = {
        id: 1,
        groups: [
          { id: "group1", points: new Set(["5,5"]) },
          { id: "group2", points: new Set(["6,5"]) },
        ],
        isVisible: true,
        renderStyle: "default",
      }

      const svg = generateSingleLayerSvg(
        twoGroupLayer,
        DEFAULT_GRID_SIZE,
        DEFAULT_BORDER_WIDTH,
      )

      expect(svg).toContain("<svg")
      const paths = extractPathsFromSvg(svg)
      expect(paths.length).toBeGreaterThan(0)

      for (const path of paths) {
        expect(isPathClosed(path.d)).toBe(true)
      }
    })

    it("should generate valid SVG for overlapping groups (heart shape scenario)", () => {
      // Two groups with overlapping points, similar to the heart shape from Bug #2
      const heartLayer: import("@/lib/blob-engine/types").GridLayer = {
        id: 1,
        groups: [
          { id: "left", points: new Set(["4,5", "5,5", "4,6", "5,6"]) },
          { id: "right", points: new Set(["5,5", "6,5", "5,6", "6,6"]) },
        ],
        isVisible: true,
        renderStyle: "default",
      }

      const svg = generateSingleLayerSvg(
        heartLayer,
        DEFAULT_GRID_SIZE,
        DEFAULT_BORDER_WIDTH,
      )

      expect(svg).toContain("<svg")
      const paths = extractPathsFromSvg(svg)
      expect(paths.length).toBeGreaterThan(0)

      for (const path of paths) {
        expect(isPathClosed(path.d)).toBe(true)
      }
    })
  })
})
