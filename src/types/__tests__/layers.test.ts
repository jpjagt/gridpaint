import { describe, it, expect } from "vitest"
import {
  DEFAULT_LAYER_RANGE,
  layerRangeIds,
  isValidLayerRange,
  clampRangeToContent,
} from "@/types/layers"

describe("layerRange helpers", () => {
  it("default range is 1..6", () => {
    expect(DEFAULT_LAYER_RANGE).toEqual({ min: 1, max: 6 })
  })

  it("layerRangeIds lists every id inclusive, including negatives", () => {
    expect(layerRangeIds({ min: -2, max: 1 })).toEqual([-2, -1, 0, 1])
  })

  it("isValidLayerRange requires min <= max", () => {
    expect(isValidLayerRange({ min: 1, max: 6 })).toBe(true)
    expect(isValidLayerRange({ min: 6, max: 1 })).toBe(false)
    expect(isValidLayerRange({ min: 0.5, max: 6 })).toBe(false) // integers only
  })

  it("clampRangeToContent widens the range to cover drawn layer ids", () => {
    // user wants 1..3 but layers -1 and 5 have content → widen to cover them
    expect(clampRangeToContent({ min: 1, max: 3 }, [-1, 2, 5])).toEqual({
      min: -1,
      max: 5,
    })
  })

  it("clampRangeToContent leaves range untouched when it already covers content", () => {
    expect(clampRangeToContent({ min: -3, max: 10 }, [0, 4])).toEqual({
      min: -3,
      max: 10,
    })
  })
})
