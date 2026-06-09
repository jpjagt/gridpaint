import "fake-indexeddb/auto"
import { describe, it, expect } from "vitest"
import { chooseNewer } from "@/lib/storage/hybrid-store"
import type { DrawingDocument } from "@/lib/storage/types"

function doc(updatedAt: number): DrawingDocument {
  return {
    id: "a", name: "a", createdAt: 0, updatedAt,
    gridSize: 75, borderWidth: 0.5, panOffset: { x: 0, y: 0 }, zoom: 1, mmPerUnit: 5,
    layers: [],
  }
}

import { HybridDrawingStore } from "@/lib/storage/hybrid-store"
import { $saveStatus } from "@/stores/authStores"

describe("chooseNewer reconciliation", () => {
  it("returns cloud when cloud is strictly newer", () => {
    expect(chooseNewer(doc(100), doc(200))).toBe("cloud")
  })
  it("returns local when local is newer", () => {
    expect(chooseNewer(doc(300), doc(200))).toBe("local")
  })
  it("returns local when equal (never clobber local with same-age cloud)", () => {
    expect(chooseNewer(doc(200), doc(200))).toBe("local")
  })
})

describe("hybrid-store local save failure", () => {
  it("sets $saveStatus.failed and rethrows when local save fails", async () => {
    const store = new HybridDrawingStore() // local-only (no cloud)
    // @ts-expect-error reach into private for the test
    store.localStore = {
      save: async () => {
        throw new Error("quota exceeded")
      },
    }
    $saveStatus.set({ failed: false, error: null })

    await expect(store.save(doc(1))).rejects.toThrow("quota exceeded")
    expect($saveStatus.get().failed).toBe(true)
    expect($saveStatus.get().error).toBe("quota exceeded")
  })
})
