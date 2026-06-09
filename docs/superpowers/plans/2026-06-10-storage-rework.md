# Storage Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix silent data loss (caused by the localStorage ~5MB quota error) and the slow homepage, by moving the local drawing store to IndexedDB, making save failures loud, storing thumbnails in metadata, and making cloud reconciliation safe against stale-device clobbering.

**Architecture:** Keep the existing `DrawingStore` interface and `HybridDrawingStore` orchestration. Replace the localStorage backend with a per-drawing IndexedDB store plus a small metadata index. Extract the duplicated serialize/deserialize/migration logic into one module. Stamp `updatedAt` once at the save entry point and make cloud writes conditional (transaction) so an older copy can never overwrite a newer one. Surface save failures via a `$saveStatus` store + an editor banner. Store a viewport-PNG thumbnail in metadata, refreshed only on content changes.

**Tech Stack:** TypeScript, React 18, Nanostores, Vitest + jsdom, Firebase Firestore, `idb-keyval` (new dependency) for IndexedDB.

**Spec:** `docs/superpowers/specs/2026-06-10-storage-rework-design.md`

---

## File Structure

**New files:**
- `src/lib/storage/serialization.ts` — pure serialize/deserialize + legacy migration (extracted from local-store & firestore-store).
- `src/lib/storage/idb.ts` — thin IndexedDB wrapper around `idb-keyval` (drawing content + metadata index).
- `src/lib/storage/thumbnail.ts` — capture the live canvas to a small dataURL.
- `src/lib/storage/__tests__/serialization.test.ts`
- `src/lib/storage/__tests__/local-store.test.ts`
- `src/lib/storage/__tests__/hybrid-store.test.ts`
- `src/components/SaveStatusBanner.tsx` — blocking retry banner in the editor.

**Modified files:**
- `src/lib/storage/types.ts` — add `thumbnail?` to metadata; export serialized doc shape.
- `src/lib/storage/local-store.ts` — IndexedDB backend; uses `serialization.ts`.
- `src/lib/storage/firestore-store.ts` — uses `serialization.ts`; conditional transactional write; stop re-rolling `updatedAt`.
- `src/lib/storage/hybrid-store.ts` — reconcile by single-source `updatedAt`; drain reads current doc; surface save failures.
- `src/lib/storage/store.ts` — extend `DrawingStore` with `saveStatus` exposure if needed (kept minimal).
- `src/stores/authStores.ts` — add `$saveStatus` store + setter.
- `src/types/auth.ts` — add `SaveStatus` type.
- `src/stores/drawingStores.ts` — `saveDrawingState` stamps `updatedAt` once; reports content-vs-position change; sets thumbnail.
- `src/hooks/useDrawingState.ts` — pass a content-change flag through to the save.
- `src/components/Home.tsx` — render `metadata.thumbnail`; delete `generatePreview`; stop fetching full docs.
- `src/components/GridPaintCanvas.tsx` — register the canvas element for thumbnail capture.
- `src/App.tsx` — mount `SaveStatusBanner` in the editor.

---

## Task 1: Add `idb-keyval` dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the dependency**

Run: `pnpm add idb-keyval`
Expected: `idb-keyval` appears in `package.json` dependencies, `pnpm-lock.yaml` updated.

- [ ] **Step 2: Verify it imports**

Run: `node -e "import('idb-keyval').then(m => console.log(Object.keys(m).slice(0,5)))"`
Expected: prints exported names including `get`, `set`, `del`, `keys` (or similar). If `node` can't import ESM directly, skip — the real check is the build in later tasks.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add idb-keyval for IndexedDB drawing storage"
```

---

## Task 2: Extract serialization module

Move the duplicated layer serialize/deserialize + legacy migration logic (currently identical in `local-store.ts:63-157` and `firestore-store.ts:95-236`) into one pure module. No behavior change — this is a refactor with tests locking in current behavior.

**Files:**
- Create: `src/lib/storage/serialization.ts`
- Create: `src/lib/storage/__tests__/serialization.test.ts`
- Modify: `src/lib/storage/types.ts`

- [ ] **Step 1: Write failing tests for round-trip + migrations**

Create `src/lib/storage/__tests__/serialization.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { serializeDocument, deserializeDocument } from "@/lib/storage/serialization"
import type { DrawingDocument } from "@/lib/storage/types"

function baseDoc(overrides: Partial<DrawingDocument> = {}): DrawingDocument {
  return {
    id: "d1",
    name: "Test",
    createdAt: 1000,
    updatedAt: 2000,
    gridSize: 75,
    borderWidth: 0.5,
    panOffset: { x: 0, y: 0 },
    zoom: 1,
    mmPerUnit: 5,
    layers: [
      {
        id: 1,
        isVisible: true,
        renderStyle: "default",
        groups: [{ id: "default", points: new Set(["0,0", "1,1"]) }],
      },
    ],
    ...overrides,
  }
}

describe("serialization round-trip", () => {
  it("preserves a basic document through serialize -> deserialize", () => {
    const doc = baseDoc()
    const round = deserializeDocument(serializeDocument(doc))
    expect(round.id).toBe("d1")
    expect(round.layers[0].groups[0].points).toEqual(new Set(["0,0", "1,1"]))
  })

  it("serializes groups Set to array and back", () => {
    const ser = serializeDocument(baseDoc())
    expect(ser.layers[0].groups![0].points).toEqual(["0,0", "1,1"])
  })

  it("migrates legacy flat points to a default group", () => {
    const legacy = {
      ...serializeDocument(baseDoc()),
      layers: [
        { id: 1, isVisible: true, renderStyle: "default" as const, points: ["2,2", "3,3"] },
      ],
    }
    const round = deserializeDocument(legacy)
    expect(round.layers[0].groups[0].id).toBe("default")
    expect(round.layers[0].groups[0].points).toEqual(new Set(["2,2", "3,3"]))
  })

  it("migrates cutout radius (v1, grid units) to diameterMm", () => {
    const ser = serializeDocument(baseDoc({ mmPerUnit: 5 }))
    ser.layers[0].pointModifications = {
      "0,0": { cutouts: [{ radius: 2 } as never] },
    }
    const round = deserializeDocument(ser)
    const cutout = round.layers[0].pointModifications!.get("0,0")!.cutouts![0]
    // radius 2 grid units * mmPerUnit 5 * 2 = 20mm diameter
    expect((cutout as { diameterMm: number }).diameterMm).toBe(20)
  })

  it("migrates cutout radiusMm (v2) to diameterMm (v3)", () => {
    const ser = serializeDocument(baseDoc())
    ser.layers[0].pointModifications = {
      "0,0": { cutouts: [{ radiusMm: 5 } as never] },
    }
    const round = deserializeDocument(ser)
    const cutout = round.layers[0].pointModifications!.get("0,0")!.cutouts![0]
    expect((cutout as { diameterMm: number }).diameterMm).toBe(10)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:run src/lib/storage/__tests__/serialization.test.ts`
Expected: FAIL — module `serialization` does not exist.

- [ ] **Step 3: Create the serialization module**

Create `src/lib/storage/serialization.ts`. Copy the logic verbatim from the current `local-store.ts` (`get` deserialize block at lines 69-123, `save` serialize block at lines 133-152) into two pure functions:

```typescript
/**
 * serialization.ts
 *
 * Pure (storage-backend-agnostic) serialization between the in-memory
 * DrawingDocument (Sets, Maps) and the JSON-safe InnerDrawingDocument.
 * Includes legacy-format migration. Used by both the local (IndexedDB) and
 * Firestore stores so the logic lives in exactly one place.
 */

import type { Layer } from "@/stores/drawingStores"
import type { CircularCutout, PointModifications } from "@/types/gridpaint"
import type {
  DrawingDocument,
  InnerDrawingDocument,
  LayerData,
} from "./types"

/** Serialize an in-memory document to the JSON-safe shape (Set -> array, Map -> Record). */
export function serializeDocument(doc: DrawingDocument): InnerDrawingDocument {
  return {
    ...doc,
    layers: doc.layers.map((layer): LayerData => {
      const serialized: LayerData = {
        id: layer.id,
        isVisible: layer.isVisible,
        renderStyle: layer.renderStyle,
        groups: layer.groups.map((g) => {
          const group: { id: string; name?: string; points: string[] } = {
            id: g.id,
            points: Array.from(g.points),
          }
          if (g.name !== undefined) group.name = g.name
          return group
        }),
      }
      if (layer.pointModifications && layer.pointModifications.size > 0) {
        serialized.pointModifications = Object.fromEntries(layer.pointModifications)
      }
      return serialized
    }),
  }
}

/** Deserialize a JSON-safe document back to in-memory form, migrating legacy formats. */
export function deserializeDocument(doc: InnerDrawingDocument): DrawingDocument {
  const layers: Layer[] = doc.layers.map((layer) => {
    let groups: Layer["groups"]
    if (layer.groups && layer.groups.length > 0) {
      groups = layer.groups.map((g) => ({
        id: g.id,
        name: g.name,
        points: new Set(g.points),
      }))
    } else if (layer.points) {
      const pointsArray = Array.isArray(layer.points)
        ? layer.points
        : Array.from(layer.points)
      groups = [{ id: "default", points: new Set(pointsArray as string[]) }]
    } else {
      groups = [{ id: "default", points: new Set<string>() }]
    }

    let pointModifications: Map<string, PointModifications> | undefined
    if (layer.pointModifications) {
      const mmPerUnit: number = (doc as { mmPerUnit?: number }).mmPerUnit ?? 5
      pointModifications = new Map(
        Object.entries(layer.pointModifications).map(([key, mods]) => {
          const migratedMods: PointModifications = { ...mods }
          if (mods.cutouts) {
            migratedMods.cutouts = mods.cutouts.map((c) => {
              const legacy = c as unknown as Record<string, unknown>
              if (
                !("radiusMm" in legacy) &&
                !("diameterMm" in legacy) &&
                typeof legacy.radius === "number"
              ) {
                return { ...c, diameterMm: legacy.radius * mmPerUnit * 2 }
              }
              if (
                "radiusMm" in legacy &&
                !("diameterMm" in legacy) &&
                typeof legacy.radiusMm === "number"
              ) {
                return { ...c, diameterMm: (legacy.radiusMm as number) * 2 } as CircularCutout
              }
              return c
            })
          }
          return [key, migratedMods]
        }),
      )
    }

    return {
      id: layer.id,
      isVisible: layer.isVisible,
      renderStyle: layer.renderStyle,
      groups,
      pointModifications,
    }
  })

  return { ...doc, layers }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:run src/lib/storage/__tests__/serialization.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/storage/serialization.ts src/lib/storage/__tests__/serialization.test.ts
git commit -m "refactor: extract drawing serialization into one module with tests"
```

---

## Task 3: Add `thumbnail` to metadata types

**Files:**
- Modify: `src/lib/storage/types.ts:47-56`

- [ ] **Step 1: Add the field**

In `src/lib/storage/types.ts`, add to `DrawingMetadata`:

```typescript
export interface DrawingMetadata {
  /** Unique identifier for the drawing */
  id: string
  /** User-defined name of the drawing */
  name: string
  /** Timestamp (ms since epoch) when created */
  createdAt: number
  /** Timestamp (ms since epoch) when last updated */
  updatedAt: number
  /** Small viewport PNG dataURL for the gallery; refreshed only on content changes */
  thumbnail?: string
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `pnpm exec tsc --noEmit`
Expected: no new errors related to `thumbnail`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/storage/types.ts
git commit -m "feat: add thumbnail field to DrawingMetadata"
```

---

## Task 4: IndexedDB wrapper

A thin module over `idb-keyval` holding per-drawing serialized documents plus a metadata index. The index lets `list()` avoid loading content.

**Files:**
- Create: `src/lib/storage/idb.ts`

- [ ] **Step 1: Write the wrapper**

Create `src/lib/storage/idb.ts`:

```typescript
/**
 * idb.ts
 *
 * Thin IndexedDB wrapper for drawing storage. Stores one record per drawing
 * (key `drawing:{id}`) plus a single metadata index (`__index__`) so listing
 * drawings never loads full content.
 *
 * Uses a dedicated idb-keyval store so it does not collide with Firestore's
 * own IndexedDB databases.
 */

import { createStore, get, set, del, type UseStore } from "idb-keyval"
import type { InnerDrawingDocument, DrawingMetadata } from "./types"

const store: UseStore = createStore("gridpaint-drawings", "drawings")
const INDEX_KEY = "__index__"

function drawingKey(id: string): string {
  return `drawing:${id}`
}

export async function idbGetDrawing(
  id: string,
): Promise<InnerDrawingDocument | null> {
  const doc = await get<InnerDrawingDocument>(drawingKey(id), store)
  return doc ?? null
}

export async function idbGetIndex(): Promise<Record<string, DrawingMetadata>> {
  const index = await get<Record<string, DrawingMetadata>>(INDEX_KEY, store)
  return index ?? {}
}

export async function idbPutDrawing(
  doc: InnerDrawingDocument,
  meta: DrawingMetadata,
): Promise<void> {
  // Write content first, then the index entry. If content write fails, the
  // index is not updated, so list() never points at a missing record.
  await set(drawingKey(doc.id), doc, store)
  const index = await idbGetIndex()
  index[doc.id] = meta
  await set(INDEX_KEY, index, store)
}

export async function idbDeleteDrawing(id: string): Promise<void> {
  await del(drawingKey(id), store)
  const index = await idbGetIndex()
  delete index[id]
  await set(INDEX_KEY, index, store)
}

export async function idbClear(): Promise<void> {
  const index = await idbGetIndex()
  await Promise.all(Object.keys(index).map((id) => del(drawingKey(id), store)))
  await del(INDEX_KEY, store)
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `pnpm exec tsc --noEmit`
Expected: no errors. (`idb-keyval` ships its own types.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/storage/idb.ts
git commit -m "feat: add IndexedDB wrapper for per-drawing storage + metadata index"
```

---

## Task 5: Rewrite local-store on IndexedDB

Replace the localStorage backend with the IndexedDB wrapper, using `serialization.ts`. Add a one-time migration from the old `gridpaint:drawings` localStorage blob. The `thumbnail` is carried in the metadata index.

**Files:**
- Modify: `src/lib/storage/local-store.ts` (full rewrite)
- Create: `src/lib/storage/__tests__/local-store.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/storage/__tests__/local-store.test.ts`. `idb-keyval` works in jsdom only with a fake IndexedDB; use the `fake-indexeddb` auto-register. First add the dev dep:

Run: `pnpm add -D fake-indexeddb`

Then the test:

```typescript
import "fake-indexeddb/auto"
import { describe, it, expect, beforeEach } from "vitest"
import { LocalStorageDrawingStore } from "@/lib/storage/local-store"
import type { DrawingDocument } from "@/lib/storage/types"

function baseDoc(id: string, updatedAt = 1000): DrawingDocument {
  return {
    id,
    name: `Drawing ${id}`,
    createdAt: 500,
    updatedAt,
    gridSize: 75,
    borderWidth: 0.5,
    panOffset: { x: 0, y: 0 },
    zoom: 1,
    mmPerUnit: 5,
    layers: [
      {
        id: 1,
        isVisible: true,
        renderStyle: "default",
        groups: [{ id: "default", points: new Set(["0,0"]) }],
      },
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
    expect((list[0] as Record<string, unknown>).layers).toBeUndefined()
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:run src/lib/storage/__tests__/local-store.test.ts`
Expected: FAIL — store still uses localStorage / no thumbnail in list.

- [ ] **Step 3: Rewrite local-store.ts**

Replace the entire contents of `src/lib/storage/local-store.ts`:

```typescript
/**
 * LocalStorage implementation of DrawingStore — now backed by IndexedDB.
 *
 * Each drawing is stored as its own record so a single large drawing can never
 * block saves for the others (the old single-blob design hit the localStorage
 * ~5MB quota and silently dropped writes). A metadata index keeps list() fast.
 *
 * On first use it migrates any drawings from the legacy `gridpaint:drawings`
 * localStorage blob into IndexedDB.
 */

import type { DrawingStore } from "./store"
import type {
  DrawingMetadata,
  DrawingDocument,
  InnerDrawingDocument,
} from "./types"
import { serializeDocument, deserializeDocument } from "./serialization"
import {
  idbGetDrawing,
  idbGetIndex,
  idbPutDrawing,
  idbDeleteDrawing,
  idbClear,
} from "./idb"

const LEGACY_KEY = "gridpaint:drawings"
const MIGRATION_FLAG = "gridpaint:migrated-to-idb"

export class LocalStorageDrawingStore implements DrawingStore {
  private migrated = false

  /** One-time migration of the legacy single-blob localStorage store. */
  private async migrateLegacyIfNeeded(): Promise<void> {
    if (this.migrated) return
    this.migrated = true
    if (typeof localStorage === "undefined") return
    if (localStorage.getItem(MIGRATION_FLAG)) return

    const json = localStorage.getItem(LEGACY_KEY)
    if (json) {
      try {
        const data = JSON.parse(json) as Record<string, InnerDrawingDocument>
        for (const inner of Object.values(data)) {
          await idbPutDrawing(inner, metaFromInner(inner))
        }
        console.log("[LocalStore] Migrated legacy drawings to IndexedDB")
      } catch {
        console.warn("[LocalStore] Failed to parse legacy storage; skipping migration")
      }
    }
    // Mark done. Keep the legacy key in place as a fallback (do not remove yet).
    localStorage.setItem(MIGRATION_FLAG, "1")
  }

  async list(): Promise<DrawingMetadata[]> {
    await this.migrateLegacyIfNeeded()
    const index = await idbGetIndex()
    return Object.values(index)
  }

  async get(id: string): Promise<DrawingDocument | null> {
    await this.migrateLegacyIfNeeded()
    const inner = await idbGetDrawing(id)
    if (!inner) return null
    return deserializeDocument(inner)
  }

  async save(doc: DrawingDocument): Promise<void> {
    await this.migrateLegacyIfNeeded()
    const inner = serializeDocument(doc)
    await idbPutDrawing(inner, metaFromInner(inner, doc.thumbnail))
  }

  async delete(id: string): Promise<void> {
    await this.migrateLegacyIfNeeded()
    await idbDeleteDrawing(id)
  }

  async clear(): Promise<void> {
    await idbClear()
  }
}

/** Build the metadata index entry from a serialized doc. */
function metaFromInner(
  inner: InnerDrawingDocument,
  thumbnail?: string,
): DrawingMetadata {
  return {
    id: inner.id,
    name: inner.name,
    createdAt: inner.createdAt,
    updatedAt: inner.updatedAt,
    ...(thumbnail !== undefined
      ? { thumbnail }
      : inner.thumbnail !== undefined
        ? { thumbnail: inner.thumbnail }
        : {}),
  }
}
```

Note: `InnerDrawingDocument` includes `thumbnail?` because it extends `DrawingMetadata` via `DrawingDocument`. No type change needed.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:run src/lib/storage/__tests__/local-store.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/storage/local-store.ts src/lib/storage/__tests__/local-store.test.ts package.json pnpm-lock.yaml
git commit -m "feat: back local drawing store with IndexedDB + legacy migration"
```

---

## Task 6: SaveStatus store and type

**Files:**
- Modify: `src/types/auth.ts`
- Modify: `src/stores/authStores.ts`

- [ ] **Step 1: Add the type**

In `src/types/auth.ts`, add:

```typescript
export interface SaveStatus {
  /** True when the most recent local save failed and has not yet succeeded. */
  failed: boolean
  /** Human-readable reason for the failure (e.g. quota exceeded). */
  error: string | null
}
```

- [ ] **Step 2: Add the store + setter**

In `src/stores/authStores.ts`, add (after `$syncStatus`):

```typescript
import type { AuthState, SyncStatus, SaveStatus } from '@/types/auth'

// ...existing code...

/**
 * Local save status. `failed: true` means the latest local (IndexedDB) write
 * did not persist and is being retried. Drives a blocking editor banner so a
 * failed save is never silent.
 */
export const $saveStatus = atom<SaveStatus>({
  failed: false,
  error: null,
})

export function setSaveStatus(status: Partial<SaveStatus>): void {
  $saveStatus.set({ ...$saveStatus.get(), ...status })
}
```

(Adjust the existing `import type { AuthState, SyncStatus }` line to include `SaveStatus`.)

- [ ] **Step 3: Verify type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/types/auth.ts src/stores/authStores.ts
git commit -m "feat: add saveStatus store for surfacing save failures"
```

---

## Task 7: Single-source updatedAt + reconciliation fix + loud failures (hybrid-store)

Make `firestore-store` and `local-store` stop re-rolling `updatedAt`; stamp it once in `saveDrawingState` (Task 9). Fix `HybridDrawingStore.get` reconciliation, make the cloud drain read the current doc, make the cloud write conditional, and report local save failures via `$saveStatus`.

**Files:**
- Modify: `src/lib/storage/firestore-store.ts:173-236` (save: remove `updatedAt: Date.now()`, make conditional/transactional)
- Modify: `src/lib/storage/hybrid-store.ts`
- Create: `src/lib/storage/__tests__/hybrid-store.test.ts`

- [ ] **Step 1: Write failing reconciliation tests**

Create `src/lib/storage/__tests__/hybrid-store.test.ts`. Test the reconcile choice via a small extracted pure helper so we don't need real Firestore:

```typescript
import { describe, it, expect } from "vitest"
import { chooseNewer } from "@/lib/storage/hybrid-store"
import type { DrawingDocument } from "@/lib/storage/types"

function doc(updatedAt: number): DrawingDocument {
  return {
    id: "a",
    name: "a",
    createdAt: 0,
    updatedAt,
    gridSize: 75,
    borderWidth: 0.5,
    panOffset: { x: 0, y: 0 },
    zoom: 1,
    mmPerUnit: 5,
    layers: [],
  }
}

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:run src/lib/storage/__tests__/hybrid-store.test.ts`
Expected: FAIL — `chooseNewer` not exported.

- [ ] **Step 3: Add `chooseNewer` and fix `get` in hybrid-store.ts**

In `src/lib/storage/hybrid-store.ts`, add this exported helper near the top (after imports):

```typescript
/**
 * Reconciliation rule. With single-source `updatedAt`, equal timestamps mean
 * identical content, so we keep local on ties — an older cloud copy must never
 * overwrite newer-or-equal local content.
 */
export function chooseNewer(
  local: DrawingDocument,
  cloud: DrawingDocument,
): "local" | "cloud" {
  return cloud.updatedAt > local.updatedAt ? "cloud" : "local"
}
```

Replace the body of `get` (lines 96-127) so reconciliation uses `chooseNewer`:

```typescript
  async get(id: string): Promise<DrawingDocument | null> {
    try {
      const localDoc = await this.localStore.get(id)
      if (!this.cloudStore) return localDoc

      const cloudDoc = await this.cloudStore.get(id)
      if (!localDoc) return cloudDoc
      if (!cloudDoc) return localDoc

      if (chooseNewer(localDoc, cloudDoc) === "cloud") {
        await this.localStore.save(cloudDoc)
        console.log("[HybridStore] Adopted newer cloud version:", id)
        return cloudDoc
      }
      return localDoc
    } catch (error) {
      console.error("[HybridStore] Error getting drawing:", error)
      return this.localStore.get(id)
    }
  }
```

- [ ] **Step 4: Make the cloud drain read the current doc + surface save failures**

Replace the body of `save` (lines 132-174) in `hybrid-store.ts`:

```typescript
  async save(doc: DrawingDocument): Promise<void> {
    try {
      await this.localStore.save(doc)
      setSaveStatus({ failed: false, error: null })
    } catch (error) {
      // The local write is the durable one. If it failed, the data did NOT
      // persist — surface it loudly and do not report success.
      console.error("[HybridStore] LOCAL save failed:", error)
      setSaveStatus({
        failed: true,
        error: error instanceof Error ? error.message : "Save failed",
      })
      throw error
    }

    if (!this.cloudStore) return

    const existingTimeout = this.syncTimeouts.get(doc.id)
    if (existingTimeout) clearTimeout(existingTimeout)

    const timeout = setTimeout(async () => {
      try {
        setSyncStatus({ isSyncing: true, error: null })
        // Read the CURRENT doc from local at fire time — never a stale closure.
        const current = await this.localStore.get(doc.id)
        if (current) await this.cloudStore!.save(current)
        setSyncStatus({ isSyncing: false, lastSyncAt: Date.now(), error: null })
      } catch (error) {
        console.error("[HybridStore] Error syncing to cloud:", error)
        setSyncStatus({
          isSyncing: false,
          error: error instanceof Error ? error.message : "Sync failed",
        })
      } finally {
        this.syncTimeouts.delete(doc.id)
      }
    }, SYNC_DEBOUNCE_MS)

    this.syncTimeouts.set(doc.id, timeout)
  }
```

Add the import at the top of `hybrid-store.ts`:

```typescript
import { setSyncStatus, setSaveStatus } from "@/stores/authStores"
```

- [ ] **Step 5: Make the Firestore write conditional and stop re-rolling updatedAt**

In `src/lib/storage/firestore-store.ts`:

(a) Change the import line to add `runTransaction`:

```typescript
import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc, query, where,
  arrayUnion, arrayRemove, updateDoc, runTransaction,
} from 'firebase/firestore'
```

(b) Replace the `save` method body. Use `serializeDocument` from the new module, **do not** call `Date.now()` (preserve `drawingDoc.updatedAt`), and write conditionally in a transaction so a stale device cannot overwrite a newer cloud copy:

```typescript
  async save(drawingDoc: DrawingDocument): Promise<void> {
    const inner = serializeDocument(drawingDoc)
    const serializedDoc: InnerDrawingDocument = {
      ...inner,
      // updatedAt is single-source: preserve what the caller stamped.
      ownerId: this.userId,
      writeToken: this.writeToken,
    }
    const cleanedDoc = removeUndefined(serializedDoc)
    const drawingRef = doc(db, "drawings", drawingDoc.id)

    await runTransaction(db, async (tx) => {
      const snap = await tx.get(drawingRef)
      if (snap.exists()) {
        const existing = snap.data() as InnerDrawingDocument
        // Conditional write: never overwrite a strictly-newer cloud version.
        if (existing.updatedAt > drawingDoc.updatedAt) {
          console.warn(
            "[FirestoreStore] Skipping write — cloud is newer:",
            drawingDoc.id,
          )
          return
        }
      }
      tx.set(drawingRef, cleanedDoc)
    })

    const userRef = doc(db, "users", this.userId)
    await updateDoc(userRef, {
      drawing_ids: arrayUnion(drawingDoc.id),
      updatedAt: Date.now(),
    })
  }
```

(c) Replace the `get` deserialize block (lines 105-163) to use the shared module:

```typescript
      const data = drawingSnap.data() as InnerDrawingDocument
      return deserializeDocument(data)
```

(d) Add the import at the top of `firestore-store.ts`:

```typescript
import { serializeDocument, deserializeDocument } from "./serialization"
```

Remove now-unused imports (`LayerData`, `Layer`, `PointModifications`, `CircularCutout`) if the linter flags them.

- [ ] **Step 6: Remove updatedAt re-roll from local-store**

In `src/lib/storage/serialization.ts` `serializeDocument` we already preserve `updatedAt` (we copy `...doc`). Confirm `local-store.save` (Task 5) does not stamp `Date.now()` — it does not. Nothing to change here; this step is a verification.

Run: `grep -n "Date.now" src/lib/storage/local-store.ts src/lib/storage/serialization.ts`
Expected: no matches.

- [ ] **Step 7: Add a save-failure test for hybrid-store**

The spec requires asserting that a failed local write sets `$saveStatus.failed` and does not report success. Append to `src/lib/storage/__tests__/hybrid-store.test.ts`:

```typescript
import { HybridDrawingStore } from "@/lib/storage/hybrid-store"
import { $saveStatus } from "@/stores/authStores"

describe("hybrid-store local save failure", () => {
  it("sets $saveStatus.failed and rethrows when local save fails", async () => {
    const store = new HybridDrawingStore() // local-only (no cloud)
    // Force the underlying local store to throw.
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
```

- [ ] **Step 8: Run the save-failure test**

Run: `pnpm test:run src/lib/storage/__tests__/hybrid-store.test.ts`
Expected: PASS — including the new failure test.

- [ ] **Step 9: Run all storage tests**

Run: `pnpm test:run src/lib/storage`
Expected: PASS (serialization + local-store + hybrid-store).

- [ ] **Step 10: Commit**

```bash
git add src/lib/storage/hybrid-store.ts src/lib/storage/firestore-store.ts src/lib/storage/__tests__/hybrid-store.test.ts
git commit -m "fix: single-source updatedAt, conditional cloud write, loud save failures"
```

---

## Task 8: Thumbnail capture module + canvas registration

Capture the live canvas to a small dataURL. The canvas is a plain `HTMLCanvasElement` in `GridPaintCanvas` (`canvasRef`). Register it via a module-level setter so the save path can grab a thumbnail without prop-drilling.

**Files:**
- Create: `src/lib/storage/thumbnail.ts`
- Modify: `src/components/GridPaintCanvas.tsx` (register canvas on mount)

- [ ] **Step 1: Write the thumbnail module**

Create `src/lib/storage/thumbnail.ts`:

```typescript
/**
 * thumbnail.ts
 *
 * Captures the live drawing canvas to a small PNG dataURL for the gallery.
 * The editor registers its canvas element here on mount; the save path calls
 * captureThumbnail() on content-change saves only.
 */

let registeredCanvas: HTMLCanvasElement | null = null

/** Editor registers (or clears) its canvas element. */
export function registerThumbnailCanvas(canvas: HTMLCanvasElement | null): void {
  registeredCanvas = canvas
}

/** Max thumbnail edge in px. Keeps metadata small. */
const THUMB_MAX = 240

/**
 * Capture the registered canvas, downscaled to fit THUMB_MAX, as a PNG dataURL.
 * Returns undefined if no canvas is registered or capture fails.
 */
export function captureThumbnail(): string | undefined {
  const src = registeredCanvas
  if (!src || src.width === 0 || src.height === 0) return undefined
  try {
    const scale = Math.min(1, THUMB_MAX / Math.max(src.width, src.height))
    const w = Math.max(1, Math.round(src.width * scale))
    const h = Math.max(1, Math.round(src.height * scale))
    const off = document.createElement("canvas")
    off.width = w
    off.height = h
    const ctx = off.getContext("2d")
    if (!ctx) return undefined
    ctx.drawImage(src, 0, 0, w, h)
    return off.toDataURL("image/png")
  } catch (err) {
    console.error("[thumbnail] capture failed", err)
    return undefined
  }
}
```

- [ ] **Step 2: Register the canvas in GridPaintCanvas**

In `src/components/GridPaintCanvas.tsx`, import the setter:

```typescript
import { registerThumbnailCanvas } from "@/lib/storage/thumbnail"
```

Add an effect (near the other mount effects, after `canvasRef` is assigned in the init effect). Add a dedicated effect:

```typescript
  // Register the canvas element so the save path can capture gallery thumbnails.
  useEffect(() => {
    registerThumbnailCanvas(canvasRef.current)
    return () => registerThumbnailCanvas(null)
  }, [])
```

- [ ] **Step 3: Verify type-check + build**

Run: `pnpm exec tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/storage/thumbnail.ts src/components/GridPaintCanvas.tsx
git commit -m "feat: thumbnail capture module + register editor canvas"
```

---

## Task 9: Wire content-change detection + thumbnail into saveDrawingState

`saveDrawingState` must stamp `updatedAt` once and, only when content changed (not pan/zoom), refresh the thumbnail. We track the last-saved content signature to decide.

**Files:**
- Modify: `src/stores/drawingStores.ts:215-239` (`saveDrawingState`)

- [ ] **Step 1: Add a content signature + thumbnail logic**

In `src/stores/drawingStores.ts`, add the import:

```typescript
import { captureThumbnail } from "@/lib/storage/thumbnail"
```

Add a module-level tracker and a signature helper above `saveDrawingState`:

```typescript
/** Last persisted content signature, to decide when to refresh the thumbnail. */
let lastContentSignature = ""
/** Last captured thumbnail, reused across position-only saves. */
let lastThumbnail: string | undefined

/**
 * Cheap signature of content that affects the rendered drawing. Excludes
 * pan/zoom so position-only saves don't trigger a thumbnail refresh.
 */
function contentSignature(layers: Layer[], exportRects: ExportRect[]): string {
  const layerPart = layers
    .map(
      (l) =>
        `${l.id}:${l.isVisible}:${l.renderStyle}:` +
        l.groups.map((g) => `${g.id}#${g.points.size}`).join("|") +
        `:${l.pointModifications ? l.pointModifications.size : 0}`,
    )
    .join(";")
  return `${layerPart}__${exportRects.length}`
}
```

Replace `saveDrawingState`:

```typescript
export async function saveDrawingState(): Promise<void> {
  const meta = $drawingMeta.get()
  const canvasView = $canvasView.get()
  const layersState = $layersState.get()
  const exportRects = $exportRects.get()

  if (!meta.id) return

  // Refresh the thumbnail only when content (not pan/zoom) changed.
  const sig = contentSignature(layersState.layers, exportRects)
  if (sig !== lastContentSignature) {
    const captured = captureThumbnail()
    if (captured !== undefined) lastThumbnail = captured
    lastContentSignature = sig
  }

  const updatedAt = Date.now()
  const document: DrawingDocument = {
    ...meta,
    ...canvasView,
    layers: layersState.layers,
    exportRects,
    exportMode: $exportMode.get(),
    exportFormat: $exportFormat.get(),
    deselectedExportRectIds: Array.from($selectedExportRectIds.get()),
    updatedAt,
    thumbnail: lastThumbnail,
  }

  try {
    await drawingStore.save(document)
    $drawingMeta.setKey("updatedAt", updatedAt)
  } catch (error) {
    // hybrid-store already set $saveStatus.failed; do not swallow silently.
    console.error("Failed to save drawing:", error)
  }
}
```

Reset trackers in `initializeDrawingState` so switching drawings doesn't reuse a stale thumbnail. At the start of `initializeDrawingState` (after `$loadingState.set("loading")`):

```typescript
  lastContentSignature = ""
  lastThumbnail = undefined
```

- [ ] **Step 2: Verify type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Run full test suite**

Run: `pnpm test:run`
Expected: PASS (existing 70 + new storage tests).

- [ ] **Step 4: Commit**

```bash
git add src/stores/drawingStores.ts
git commit -m "feat: single-source updatedAt + content-gated thumbnail in saveDrawingState"
```

---

## Task 10: SaveStatusBanner component + mount in editor

**Files:**
- Create: `src/components/SaveStatusBanner.tsx`
- Modify: `src/App.tsx` (mount in editor return)

- [ ] **Step 1: Write the banner**

Create `src/components/SaveStatusBanner.tsx`:

```typescript
import { useStore } from "@nanostores/react"
import { $saveStatus } from "@/stores/authStores"

/**
 * Blocking, persistent banner shown when a local save fails (e.g. storage
 * quota exhausted). Replaces the old silent console.error so the user is never
 * led to believe work was saved when it was not. Clears automatically when the
 * next save succeeds (hybrid-store resets $saveStatus on success).
 */
export function SaveStatusBanner() {
  const status = useStore($saveStatus)
  if (!status.failed) return null
  return (
    <div className='fixed top-0 inset-x-0 z-[100] bg-destructive text-destructive-foreground px-4 py-2 text-sm text-center shadow-md'>
      Couldn't save your latest changes{status.error ? ` (${status.error})` : ""}.
      Your work is still on screen — retrying. Avoid closing this tab.
    </div>
  )
}
```

- [ ] **Step 2: Mount it in the editor**

In `src/App.tsx`, import and render it inside the editor's returned tree (top of the `<div className='w-screen h-screen ...'>`):

```typescript
import { SaveStatusBanner } from "@/components/SaveStatusBanner"
```

Add as the first child inside the editor root div:

```tsx
      <SaveStatusBanner />
      <GridPaintCanvas ref={canvasRef} drawingId={drawingId!} />
```

- [ ] **Step 3: Verify build + type-check**

Run: `pnpm exec tsc --noEmit && pnpm build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/SaveStatusBanner.tsx src/App.tsx
git commit -m "feat: blocking save-failure banner in editor"
```

---

## Task 11: Homepage uses stored thumbnails, no full-doc fetch

Remove `generatePreview` and the `fullDrawings` full-document fetch. Render `metadata.thumbnail` directly with a placeholder fallback.

**Files:**
- Modify: `src/components/Home.tsx`

- [ ] **Step 1: Remove full-doc loading and generatePreview**

In `src/components/Home.tsx`:

(a) Delete the entire `generatePreview` function (lines 14-96).

(b) Remove `fullDrawings` state and its loading. Replace the `useEffect` load block:

```typescript
  useEffect(() => {
    async function loadDrawings() {
      setIsLoading(true)
      const metadata = await drawingStore.list()
      const sorted = [...metadata].sort((a, b) => b.updatedAt - a.updatedAt)
      setDrawings(sorted)
      setIsLoading(false)
    }
    loadDrawings()
  }, [])
```

(c) Remove the `fullDrawings` `useState`, the `DrawingDocument` import if now unused (it is still used by `handleImport`, so keep the import), and the `setFullDrawings` calls in `handleDelete`.

`handleDelete` becomes:

```typescript
  const handleDelete = async (id: string) => {
    await drawingStore.delete(id)
    setDrawings(drawings.filter((d) => d.id !== id))
    setDeleteDialogId(null)
  }
```

(d) Replace the preview block in the card render (the `fullDrawing ? <img .../> : <Skeleton/>` block):

```tsx
                  {/* Preview */}
                  <div className='aspect-square p-4'>
                    {drawing.thumbnail ? (
                      <img
                        src={drawing.thumbnail}
                        alt={`Preview of ${drawing.name}`}
                        className='w-full h-full object-contain bg-muted rounded border border-border'
                      />
                    ) : (
                      <div className='w-full h-full rounded border border-border bg-muted flex items-center justify-center text-xs text-muted-foreground'>
                        no preview
                      </div>
                    )}
                  </div>
```

Remove the now-unused `const fullDrawing = fullDrawings.find(...)` line inside `.map`.

- [ ] **Step 2: Verify build + type-check**

Run: `pnpm exec tsc --noEmit && pnpm build`
Expected: build succeeds; no unused-variable lint errors (`pnpm lint`).

- [ ] **Step 3: Commit**

```bash
git add src/components/Home.tsx
git commit -m "perf: homepage renders stored thumbnails, no full-document fetch"
```

---

## Task 12: Manual verification

**Files:** none (manual).

- [ ] **Step 1: Migration + basic flow**

Run: `pnpm dev`. With existing localStorage drawings present, load the homepage. Expected: drawings appear (migrated to IndexedDB), gallery loads fast. In DevTools → Application → IndexedDB, confirm a `gridpaint-drawings` DB with `drawing:*` keys and `__index__`.

- [ ] **Step 2: Thumbnail refresh on content change only**

Open a drawing, draw something, return home. Expected: thumbnail reflects the drawing. Open it again, only pan/zoom (no drawing), return home. Expected: thumbnail unchanged (no flicker / same image).

- [ ] **Step 3: Save-failure banner (forced)**

Temporarily make the local write throw to confirm the banner appears and is blocking. In `src/lib/storage/local-store.ts` `save`, add a temporary first line `throw new Error("forced quota test")`, run `pnpm dev`, open a drawing, and draw. Expected: the red banner appears at the top ("Couldn't save your latest changes (forced quota test)…") and stays until removed. Then **revert** the temporary throw and confirm the banner clears on the next successful save.

- [ ] **Step 4: Cloud sync round-trip (if passphrase configured)**

Set passphrase, draw, wait ~3s, confirm SyncStatus shows synced. Reload. Expected: drawing intact. In a second browser profile with the same passphrase, open the drawing. Expected: it appears and matches.

- [ ] **Step 5: Final full check**

Run: `pnpm test:run && pnpm lint && pnpm build`
Expected: all green.

---

## Notes for the implementer

- The two bugs being fixed: (1) localStorage quota error silently dropped saves → IndexedDB removes the ceiling and the banner makes any remaining failure loud; (2) `updatedAt` was re-rolled at each store layer so stale cloud could clobber newer local → it is now stamped once and cloud writes are conditional.
- Do not delete the legacy `gridpaint:drawings` localStorage key in this plan — it is the migration fallback.
- The full conflict-resolution model (rev/outbox/conflict modal) is intentionally deferred — see the spec's "Deferred: full sync model".
