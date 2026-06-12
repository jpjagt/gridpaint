import { describe, it, expect } from "vitest"
import { recognizeSelectionPayload } from "@/hooks/useSelection"

const bounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 }
const layers = [{ layerId: 1, groups: [{ id: "g1", points: ["0,0"] }] }]

describe("recognizeSelectionPayload", () => {
  it("accepts the canonical payload", () => {
    const text = JSON.stringify({
      type: "gridpaint-selection",
      version: "2.0.0",
      data: { layers, bounds, timestamp: 1 },
    })
    expect(recognizeSelectionPayload(text)).toEqual({ layers, bounds })
  })

  it("accepts a payload with a different version via shape", () => {
    const text = JSON.stringify({
      type: "gridpaint-selection",
      version: "9.9.9",
      data: { layers, bounds },
    })
    expect(recognizeSelectionPayload(text)).toEqual({ layers, bounds })
  })

  it("accepts a payload missing type but with the right shape", () => {
    const text = JSON.stringify({ data: { layers, bounds } })
    expect(recognizeSelectionPayload(text)).toEqual({ layers, bounds })
  })

  it("rejects unrelated JSON", () => {
    expect(recognizeSelectionPayload(JSON.stringify({ foo: 1 }))).toBeNull()
  })

  it("rejects non-JSON text", () => {
    expect(recognizeSelectionPayload("hello world")).toBeNull()
  })

  it("rejects a payload missing bounds", () => {
    expect(recognizeSelectionPayload(JSON.stringify({ data: { layers } }))).toBeNull()
  })
})
