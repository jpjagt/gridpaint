import "fake-indexeddb/auto"
import { describe, it, expect, vi, beforeEach } from "vitest"

// In-memory fake of the bits of firebase/firestore the stores use.
const fs = vi.hoisted(() => {
  const docs = new Map<string, Record<string, unknown>>()
  const getDocCalls: string[] = []
  const updateCalls: { path: string; data: Record<string, unknown> }[] = []
  const DELETE = { __delete: true }
  return { docs, getDocCalls, updateCalls, DELETE }
})

vi.mock("@/lib/firebase/config", () => ({ app: {} }))
vi.mock("@/lib/firebase/firestore", () => ({ db: {} }))
vi.mock("firebase/firestore", () => {
  const snap = (path: string) => {
    const data = fs.docs.get(path)
    return { exists: () => data !== undefined, data: () => data }
  }
  return {
    doc: (_db: unknown, col: string, id: string) => ({ path: `${col}/${id}` }),
    getDoc: async (ref: { path: string }) => {
      fs.getDocCalls.push(ref.path)
      return snap(ref.path)
    },
    deleteDoc: async (ref: { path: string }) => {
      fs.docs.delete(ref.path)
    },
    arrayUnion: (...v: unknown[]) => ({ __union: v }),
    arrayRemove: (...v: unknown[]) => ({ __remove: v }),
    deleteField: () => fs.DELETE,
    updateDoc: async (ref: { path: string }, data: Record<string, unknown>) => {
      fs.updateCalls.push({ path: ref.path, data })
      const cur = structuredClone(fs.docs.get(ref.path) ?? {}) as Record<string, any>
      for (const [k, v] of Object.entries(data)) {
        const parts = k.split(".")
        let o = cur
        for (const p of parts.slice(0, -1)) o = o[p] ??= {}
        const last = parts[parts.length - 1]
        const val = v as any
        if (val === fs.DELETE) delete o[last]
        else if (val?.__union) o[last] = [...new Set([...(o[last] ?? []), ...val.__union])]
        else if (val?.__remove) o[last] = (o[last] ?? []).filter((x: unknown) => !val.__remove.includes(x))
        else o[last] = val
      }
      fs.docs.set(ref.path, cur)
    },
    runTransaction: async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
      const tx = {
        get: async (ref: { path: string }) => snap(ref.path),
        set: (ref: { path: string }, data: Record<string, unknown>) => {
          fs.docs.set(ref.path, data)
        },
      }
      await fn(tx)
    },
  }
})

import { FirestoreDrawingStore } from "@/lib/storage/firestore-store"
import { HybridDrawingStore } from "@/lib/storage/hybrid-store"
import { LocalStorageDrawingStore } from "@/lib/storage/local-store"
import type { DrawingDocument } from "@/lib/storage/types"

function drawing(id: string, updatedAt: number, thumbnail?: string): DrawingDocument {
  return {
    id, name: `D ${id}`, createdAt: 1, updatedAt,
    gridSize: 75, borderWidth: 0.5, panOffset: { x: 0, y: 0 }, zoom: 1, mmPerUnit: 5,
    layers: [
      { id: 1, isVisible: true, renderStyle: "default",
        groups: [{ id: "default", points: new Set(["0,0"]) }] },
    ],
    ...(thumbnail ? { thumbnail } : {}),
  }
}

function cloudDoc(id: string, updatedAt: number, thumbnail?: string) {
  return {
    id, name: `D ${id}`, createdAt: 1, updatedAt,
    gridSize: 75, borderWidth: 0.5, panOffset: { x: 0, y: 0 }, zoom: 1, mmPerUnit: 5,
    layers: [{ id: 1, isVisible: true, renderStyle: "default",
      groups: [{ id: "default", points: ["0,0"] }] }],
    ownerId: "u", writeToken: "t",
    ...(thumbnail ? { thumbnail } : {}),
  }
}

beforeEach(async () => {
  fs.docs.clear()
  fs.getDocCalls.length = 0
  fs.updateCalls.length = 0
  await new LocalStorageDrawingStore().clear()
})

describe("FirestoreDrawingStore.list", () => {
  it("uses drawing_meta without fetching drawing docs", async () => {
    fs.docs.set("users/u", {
      drawing_ids: ["a", "b"],
      drawing_meta: {
        a: { name: "A", createdAt: 1, updatedAt: 10 },
        b: { name: "B", createdAt: 2, updatedAt: 20 },
      },
    })
    const list = await new FirestoreDrawingStore("u", "t").list()
    expect(list.map((d) => d.id).sort()).toEqual(["a", "b"])
    expect(list.find((d) => d.id === "b")).toEqual({ id: "b", name: "B", createdAt: 2, updatedAt: 20 })
    expect(fs.getDocCalls).toEqual(["users/u"])
    expect(fs.updateCalls).toHaveLength(0)
  })

  it("fetches legacy ids and backfills drawing_meta in one update", async () => {
    fs.docs.set("users/u", {
      drawing_ids: ["a", "legacy1", "legacy2", "gone"],
      drawing_meta: { a: { name: "A", createdAt: 1, updatedAt: 10 } },
    })
    fs.docs.set("drawings/legacy1", cloudDoc("legacy1", 30, "data:thumb"))
    fs.docs.set("drawings/legacy2", cloudDoc("legacy2", 40))
    const list = await new FirestoreDrawingStore("u", "t").list()
    expect(list.map((d) => d.id).sort()).toEqual(["a", "legacy1", "legacy2"])
    // Cloud list metadata never carries thumbnails.
    expect(list.every((d) => d.thumbnail === undefined)).toBe(true)
    expect(fs.getDocCalls).not.toContain("drawings/a")
    expect(fs.updateCalls).toHaveLength(1)
    const meta = (fs.docs.get("users/u") as any).drawing_meta
    expect(meta.legacy1).toEqual({ name: "D legacy1", createdAt: 1, updatedAt: 30 })
    expect(meta.legacy2).toEqual({ name: "D legacy2", createdAt: 1, updatedAt: 40 })
    expect(meta.gone).toBeUndefined()
  })

  it("swallows backfill errors", async () => {
    fs.docs.set("users/u", { drawing_ids: ["legacy1"] })
    fs.docs.set("drawings/legacy1", cloudDoc("legacy1", 30))
    const firestore = await import("firebase/firestore")
    const spy = vi.spyOn(firestore, "updateDoc").mockRejectedValueOnce(new Error("denied"))
    const list = await new FirestoreDrawingStore("u", "t").list()
    expect(list.map((d) => d.id)).toEqual(["legacy1"])
    spy.mockRestore()
  })

  it("save writes drawing_meta and delete removes it", async () => {
    fs.docs.set("users/u", { drawing_ids: [], writeToken: "t" })
    const store = new FirestoreDrawingStore("u", "t")
    await store.save(drawing("a", 50, "data:thumb"))
    let user = fs.docs.get("users/u") as any
    expect(user.drawing_ids).toEqual(["a"])
    expect(user.drawing_meta.a).toEqual({ name: "D a", createdAt: 1, updatedAt: 50 })
    await store.delete("a")
    user = fs.docs.get("users/u") as any
    expect(user.drawing_ids).toEqual([])
    expect(user.drawing_meta.a).toBeUndefined()
  })
})

describe("HybridDrawingStore with cloud", () => {
  it("list keeps the local thumbnail when the newer cloud entry lacks one", async () => {
    await new LocalStorageDrawingStore().save(drawing("a", 10, "data:local-thumb"))
    fs.docs.set("users/u", {
      drawing_ids: ["a"],
      drawing_meta: { a: { name: "Renamed", createdAt: 1, updatedAt: 99 } },
    })
    const store = new HybridDrawingStore("u", "t")
    const list = await store.list()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe("Renamed")
    expect(list[0].updatedAt).toBe(99)
    expect(list[0].thumbnail).toBe("data:local-thumb")
  })

  it("listLocal returns only local metadata without touching the cloud", async () => {
    await new LocalStorageDrawingStore().save(drawing("a", 10))
    fs.docs.set("users/u", { drawing_ids: ["b"], drawing_meta: { b: { name: "B", createdAt: 1, updatedAt: 1 } } })
    const list = await new HybridDrawingStore("u", "t").listLocal()
    expect(list.map((d) => d.id)).toEqual(["a"])
    expect(fs.getDocCalls).toHaveLength(0)
  })

  it("get caches cloud-only docs locally", async () => {
    fs.docs.set("drawings/c", cloudDoc("c", 77, "data:cloud-thumb"))
    const store = new HybridDrawingStore("u", "t")
    const got = await store.get("c")
    expect(got?.id).toBe("c")
    const localList = await new LocalStorageDrawingStore().list()
    expect(localList.map((d) => d.id)).toEqual(["c"])
    expect(localList[0].thumbnail).toBe("data:cloud-thumb")
    const local = (await new LocalStorageDrawingStore().get("c")) as unknown as Record<string, unknown>
    expect(local.writeToken).toBeUndefined()
  })
})
