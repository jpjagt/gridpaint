import "fake-indexeddb/auto"
import { describe, it, expect, beforeEach } from "vitest"
import { LocalStorageDrawingStore } from "@/lib/storage/local-store"
import type { DrawingDocument } from "@/lib/storage/types"

function baseDoc(id: string, updatedAt = 1000): DrawingDocument {
  return {
    id, name: `Drawing ${id}`, createdAt: 500, updatedAt,
    gridSize: 75, borderWidth: 0.5, panOffset: { x: 0, y: 0 }, zoom: 1, mmPerUnit: 5,
    layers: [
      { id: 1, isVisible: true, renderStyle: "default",
        groups: [{ id: "default", points: new Set(["0,0"]) }] },
    ],
  }
}

describe("LocalStorageDrawingStore (IndexedDB)", () => {
  let store: LocalStorageDrawingStore
  beforeEach(async () => {
    store = new LocalStorageDrawingStore()
    await store.clear()
  })

  it("saves and gets a drawing with Set round-trip", async () => {
    await store.save(baseDoc("a"))
    const got = await store.get("a")
    expect(got?.layers[0].groups[0].points).toEqual(new Set(["0,0"]))
  })

  it("list returns metadata including thumbnail, without content", async () => {
    const doc = baseDoc("a")
    doc.thumbnail = "data:image/png;base64,AAA"
    await store.save(doc)
    const list = await store.list()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe("a")
    expect(list[0].thumbnail).toBe("data:image/png;base64,AAA")
    expect((list[0] as unknown as Record<string, unknown>).layers).toBeUndefined()
  })

  it("does not persist cloud credentials (ownerId/writeToken) to local storage", async () => {
    await store.save({ ...baseDoc("a"), ownerId: "owner1", writeToken: "secret" })
    const got = (await store.get("a")) as unknown as Record<string, unknown>
    expect(got.ownerId).toBeUndefined()
    expect(got.writeToken).toBeUndefined()
  })

  it("one drawing's save does not affect another", async () => {
    await store.save(baseDoc("a"))
    await store.save(baseDoc("b"))
    await store.save({ ...baseDoc("a", 9999), name: "renamed" })
    const b = await store.get("b")
    expect(b?.name).toBe("Drawing b")
    const list = await store.list()
    expect(list).toHaveLength(2)
  })

  it("delete removes content and index entry", async () => {
    await store.save(baseDoc("a"))
    await store.delete("a")
    expect(await store.get("a")).toBeNull()
    expect(await store.list()).toHaveLength(0)
  })
})

describe("LocalStorageDrawingStore legacy migration", () => {
  beforeEach(async () => {
    localStorage.clear()
    await new LocalStorageDrawingStore().clear()
  })

  function legacyBlob() {
    return JSON.stringify({
      x: {
        id: "x", name: "Legacy", createdAt: 1, updatedAt: 2,
        gridSize: 75, borderWidth: 0.5, panOffset: { x: 0, y: 0 }, zoom: 1, mmPerUnit: 5,
        layers: [{ id: 1, isVisible: true, renderStyle: "default", groups: [{ id: "default", points: ["1,1"] }] }],
      },
    })
  }

  it("migrates legacy drawings into IndexedDB and sets the flag", async () => {
    localStorage.setItem("gridpaint:drawings", legacyBlob())
    const store = new LocalStorageDrawingStore()
    const list = await store.list()
    expect(list.map((d) => d.id)).toContain("x")
    const got = await store.get("x")
    expect(got?.layers[0].groups[0].points).toEqual(new Set(["1,1"]))
    expect(localStorage.getItem("gridpaint:migrated-to-idb")).toBe("1")
  })

  it("leaves the legacy localStorage key in place after migration", async () => {
    localStorage.setItem("gridpaint:drawings", legacyBlob())
    await new LocalStorageDrawingStore().list()
    expect(localStorage.getItem("gridpaint:drawings")).not.toBeNull()
  })

  it("does not re-migrate when the flag is already set", async () => {
    localStorage.setItem("gridpaint:migrated-to-idb", "1")
    localStorage.setItem("gridpaint:drawings", legacyBlob())
    const store = new LocalStorageDrawingStore()
    expect(await store.list()).toHaveLength(0)
  })

  it("tolerates a malformed legacy blob without throwing", async () => {
    localStorage.setItem("gridpaint:drawings", "{not json")
    const store = new LocalStorageDrawingStore()
    await expect(store.list()).resolves.toEqual([])
    expect(localStorage.getItem("gridpaint:migrated-to-idb")).toBe("1")
  })
})
