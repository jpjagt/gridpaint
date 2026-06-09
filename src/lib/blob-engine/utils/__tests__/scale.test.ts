import { describe, it, expect } from "vitest"
import { scaleToFactor } from "@/lib/blob-engine/utils/scale"

describe("scaleToFactor", () => {
  it("returns 1 for undefined", () => {
    expect(scaleToFactor(undefined)).toBe(1)
  })
  it("returns num/den for bigger", () => {
    expect(scaleToFactor({ num: 2, den: 1 })).toBe(2)
  })
  it("returns num/den for smaller", () => {
    expect(scaleToFactor({ num: 1, den: 2 })).toBe(0.5)
  })
  it("returns 1 for 1/1", () => {
    expect(scaleToFactor({ num: 1, den: 1 })).toBe(1)
  })
})
