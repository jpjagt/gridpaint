import { describe, it, expect, beforeEach } from "vitest"
import { $canvasView, setLayerRange } from "@/stores/drawingStores"
import { DEFAULT_LAYER_RANGE } from "@/types/layers"

describe("layerRange store", () => {
  beforeEach(() => {
    $canvasView.setKey("layerRange", DEFAULT_LAYER_RANGE)
  })

  it("defaults to 1..6", () => {
    expect($canvasView.get().layerRange).toEqual({ min: 1, max: 6 })
  })

  it("setLayerRange updates the store", () => {
    setLayerRange({ min: -3, max: 10 })
    expect($canvasView.get().layerRange).toEqual({ min: -3, max: 10 })
  })
})
