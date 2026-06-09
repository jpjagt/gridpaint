import { describe, it, expect, beforeEach } from "vitest"
import { LocalStorageDrawingStore } from "@/lib/storage/local-store"
import type { DrawingDocument } from "@/lib/storage/types"

function makeDoc(): DrawingDocument {
  return {
    id: "test-1",
    name: "t",
    createdAt: 0,
    updatedAt: 0,
    gridSize: 10,
    borderWidth: 0,
    panOffset: { x: 0, y: 0 },
    zoom: 1,
    mmPerUnit: 5,
    layers: [
      {
        id: 1,
        isVisible: true,
        renderStyle: "default",
        groups: [
          { id: "n", points: new Set(["0,0"]) },
          { id: "h", points: new Set(["1,1"]), offsetPhase: "half" },
        ],
        scale: { num: 1, den: 2 },
      },
    ],
  }
}

describe("persist offsetPhase + scale", () => {
  beforeEach(() => localStorage.clear())

  it("round-trips offsetPhase and scale through save/get", async () => {
    const store = new LocalStorageDrawingStore()
    await store.save(makeDoc())
    const loaded = await store.get("test-1")
    expect(loaded).not.toBeNull()
    const layer = loaded!.layers[0]
    expect(layer.scale).toEqual({ num: 1, den: 2 })
    expect(layer.groups.find((g) => g.id === "h")!.offsetPhase).toBe("half")
    expect(layer.groups.find((g) => g.id === "n")!.offsetPhase).toBeUndefined()
  })

  it("loads a legacy doc without the fields as defaults", async () => {
    const legacy = makeDoc()
    delete legacy.layers[0].scale
    legacy.layers[0].groups.forEach((g) => delete g.offsetPhase)
    const store = new LocalStorageDrawingStore()
    await store.save(legacy)
    const loaded = await store.get("test-1")
    expect(loaded!.layers[0].scale).toBeUndefined()
    expect(loaded!.layers[0].groups[0].offsetPhase).toBeUndefined()
  })
})
