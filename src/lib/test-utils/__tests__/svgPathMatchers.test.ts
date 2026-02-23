/**
 * Tests for SVG path comparison utilities
 * 
 * These tests demonstrate how the path matchers handle various
 * representations of the same shape, including different start points,
 * formatting variations, and precision differences.
 */

import { describe, it, expect } from "vitest"
import {
  parseSvgPath,
  numbersMatch,
  commandsMatch,
  pathsMatch,
  getPathBounds,
  isPathClosed,
  countPathCommands,
} from "../svgPathMatchers"

describe("SVG Path Matchers", () => {
  describe("parseSvgPath", () => {
    it("should parse simple move and line commands", () => {
      const path = "M 10 20 L 30 40"
      const commands = parseSvgPath(path)
      
      expect(commands).toHaveLength(2)
      expect(commands[0]).toEqual({ type: "M", coords: [10, 20] })
      expect(commands[1]).toEqual({ type: "L", coords: [30, 40] })
    })

    it("should handle comma-separated coordinates", () => {
      const path = "M 10,20 L 30,40"
      const commands = parseSvgPath(path)
      
      expect(commands).toHaveLength(2)
      expect(commands[0]).toEqual({ type: "M", coords: [10, 20] })
      expect(commands[1]).toEqual({ type: "L", coords: [30, 40] })
    })

    it("should normalize whitespace", () => {
      const path1 = "M 10 20   L   30 40"
      const path2 = "M10 20L30 40"
      
      const commands1 = parseSvgPath(path1)
      const commands2 = parseSvgPath(path2)
      
      expect(commands1).toEqual(commands2)
    })

    it("should parse cubic bezier curves", () => {
      const path = "M 10 20 C 15 25 25 35 30 40"
      const commands = parseSvgPath(path)
      
      expect(commands).toHaveLength(2)
      expect(commands[0]).toEqual({ type: "M", coords: [10, 20] })
      expect(commands[1]).toEqual({ type: "C", coords: [15, 25, 25, 35, 30, 40] })
    })

    it("should parse close path command", () => {
      const path = "M 10 20 L 30 40 Z"
      const commands = parseSvgPath(path)
      
      expect(commands).toHaveLength(3)
      expect(commands[2]).toEqual({ type: "Z", coords: [] })
    })
  })

  describe("numbersMatch", () => {
    it("should match exact numbers", () => {
      expect(numbersMatch(10, 10)).toBe(true)
      expect(numbersMatch(0, 0)).toBe(true)
      expect(numbersMatch(-5, -5)).toBe(true)
    })

    it("should match numbers within epsilon", () => {
      expect(numbersMatch(10.0001, 10.0002, 0.001)).toBe(true)
      expect(numbersMatch(5.999, 6.0, 0.01)).toBe(true)
    })

    it("should not match numbers outside epsilon", () => {
      expect(numbersMatch(10, 10.1, 0.001)).toBe(false)
      expect(numbersMatch(5, 6, 0.5)).toBe(false)
    })

    it("should handle negative numbers", () => {
      expect(numbersMatch(-10.001, -10.002, 0.01)).toBe(true)
      expect(numbersMatch(-5, -5.1, 0.001)).toBe(false)
    })
  })

  describe("commandsMatch", () => {
    it("should match identical commands", () => {
      const cmd1 = { type: "M", coords: [10, 20] }
      const cmd2 = { type: "M", coords: [10, 20] }
      
      expect(commandsMatch(cmd1, cmd2)).toBe(true)
    })

    it("should match commands with minor precision differences", () => {
      const cmd1 = { type: "L", coords: [10.0001, 20.0002] }
      const cmd2 = { type: "L", coords: [10.0000, 20.0000] }
      
      expect(commandsMatch(cmd1, cmd2, 0.001)).toBe(true)
    })

    it("should not match different command types", () => {
      const cmd1 = { type: "M", coords: [10, 20] }
      const cmd2 = { type: "L", coords: [10, 20] }
      
      expect(commandsMatch(cmd1, cmd2)).toBe(false)
    })

    it("should not match different coordinate counts", () => {
      const cmd1 = { type: "L", coords: [10, 20] }
      const cmd2 = { type: "L", coords: [10, 20, 30] }
      
      expect(commandsMatch(cmd1, cmd2)).toBe(false)
    })

    it("should be case-insensitive for command type", () => {
      const cmd1 = { type: "m", coords: [10, 20] }
      const cmd2 = { type: "M", coords: [10, 20] }
      
      expect(commandsMatch(cmd1, cmd2)).toBe(true)
    })
  })

  describe("pathsMatch", () => {
    it("should match identical paths", () => {
      const path1 = "M 10 20 L 30 40 Z"
      const path2 = "M 10 20 L 30 40 Z"
      
      const result = pathsMatch(path1, path2)
      expect(result.match).toBe(true)
    })

    it("should match paths with different formatting", () => {
      const path1 = "M 10 20 L 30 40 Z"
      const path2 = "M10,20L30,40Z"
      
      const result = pathsMatch(path1, path2)
      expect(result.match).toBe(true)
    })

    it("should match paths with minor precision differences", () => {
      const path1 = "M 10.0000 20.0000 L 30.0000 40.0000"
      const path2 = "M 10.0001 20.0002 L 30.0001 40.0002"
      
      const result = pathsMatch(path1, path2, 0.001)
      expect(result.match).toBe(true)
    })

    it("should not match paths with different shapes", () => {
      const path1 = "M 10 20 L 30 40"
      const path2 = "M 10 20 L 50 60"
      
      const result = pathsMatch(path1, path2)
      expect(result.match).toBe(false)
      expect(result.reason).toContain("differs")
    })

    it("should not match paths with different command counts", () => {
      const path1 = "M 10 20 L 30 40"
      const path2 = "M 10 20 L 30 40 L 50 60"
      
      const result = pathsMatch(path1, path2)
      expect(result.match).toBe(false)
      expect(result.reason).toContain("Different number of commands")
    })
  })

  describe("getPathBounds", () => {
    it("should calculate bounds for simple path", () => {
      const path = "M 10 20 L 30 40 L 50 60"
      const bounds = getPathBounds(path)
      
      expect(bounds).toBeTruthy()
      expect(bounds?.minX).toBe(10)
      expect(bounds?.minY).toBe(20)
      expect(bounds?.maxX).toBe(50)
      expect(bounds?.maxY).toBe(60)
      expect(bounds?.width).toBe(40)
      expect(bounds?.height).toBe(40)
    })

    it("should handle paths with negative coordinates", () => {
      const path = "M -10 -20 L 30 40"
      const bounds = getPathBounds(path)
      
      expect(bounds?.minX).toBe(-10)
      expect(bounds?.minY).toBe(-20)
      expect(bounds?.maxX).toBe(30)
      expect(bounds?.maxY).toBe(40)
    })

    it("should return null for empty path", () => {
      const path = ""
      const bounds = getPathBounds(path)
      
      expect(bounds).toBeNull()
    })

    it("should ignore Z command", () => {
      const path = "M 10 20 L 30 40 Z"
      const bounds = getPathBounds(path)
      
      expect(bounds?.minX).toBe(10)
      expect(bounds?.maxX).toBe(30)
    })

    it("should handle cubic bezier curves", () => {
      const path = "M 10 20 C 15 25 25 35 30 40"
      const bounds = getPathBounds(path)
      
      expect(bounds).toBeTruthy()
      expect(bounds?.minX).toBe(10)
      expect(bounds?.maxX).toBe(30)
    })
  })

  describe("isPathClosed", () => {
    it("should detect paths closed with Z", () => {
      const path = "M 10 20 L 30 40 L 50 30 Z"
      expect(isPathClosed(path)).toBe(true)
    })

    it("should detect paths closed with z (lowercase)", () => {
      const path = "M 10 20 L 30 40 L 50 30 z"
      expect(isPathClosed(path)).toBe(true)
    })

    it("should detect paths that return to start point", () => {
      const path = "M 10 20 L 30 40 L 10 20"
      expect(isPathClosed(path)).toBe(true)
    })

    it("should not detect open paths as closed", () => {
      const path = "M 10 20 L 30 40 L 50 60"
      expect(isPathClosed(path)).toBe(false)
    })

    it("should handle empty paths", () => {
      const path = ""
      expect(isPathClosed(path)).toBe(false)
    })
  })

  describe("countPathCommands", () => {
    it("should count commands excluding Z", () => {
      const path = "M 10 20 L 30 40 L 50 60 Z"
      expect(countPathCommands(path)).toBe(3)
    })

    it("should count multiple move and line commands", () => {
      const path = "M 10 20 L 30 40 M 50 60 L 70 80"
      expect(countPathCommands(path)).toBe(4)
    })

    it("should count bezier curves", () => {
      const path = "M 10 20 C 15 25 25 35 30 40 L 50 60"
      expect(countPathCommands(path)).toBe(3)
    })

    it("should return 0 for empty path", () => {
      const path = ""
      expect(countPathCommands(path)).toBe(0)
    })
  })

  describe("Different Start Points (Same Shape)", () => {
    it("should recognize paths have same bounds even with different start points", () => {
      // Square starting at different corners
      const path1 = "M 0 0 L 10 0 L 10 10 L 0 10 Z"
      const path2 = "M 10 10 L 0 10 L 0 0 L 10 0 Z"
      
      const bounds1 = getPathBounds(path1)
      const bounds2 = getPathBounds(path2)
      
      expect(bounds1).toEqual(bounds2)
    })

    it("should have same command count for rotated paths", () => {
      const path1 = "M 0 0 L 10 0 L 10 10 L 0 10 Z"
      const path2 = "M 10 10 L 0 10 L 0 0 L 10 0 Z"
      
      expect(countPathCommands(path1)).toBe(countPathCommands(path2))
    })

    it("should both be closed paths", () => {
      const path1 = "M 0 0 L 10 0 L 10 10 L 0 10 Z"
      const path2 = "M 10 10 L 0 10 L 0 0 L 10 0 Z"
      
      expect(isPathClosed(path1)).toBe(true)
      expect(isPathClosed(path2)).toBe(true)
    })
  })
})
