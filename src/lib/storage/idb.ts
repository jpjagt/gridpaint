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

import { createStore, get, set, del, update, type UseStore } from "idb-keyval"
import type { InnerDrawingDocument, DrawingMetadata } from "./types"

const store: UseStore = createStore("gridpaint-drawings", "drawings")
const INDEX_KEY = "__index__"

function drawingKey(id: string): string {
  return `drawing:${id}`
}

export async function idbGetDrawing(id: string): Promise<InnerDrawingDocument | null> {
  const doc = await get<InnerDrawingDocument>(drawingKey(id), store)
  return doc ?? null
}

export async function idbGetIndex(): Promise<Record<string, DrawingMetadata>> {
  const index = await get<Record<string, DrawingMetadata>>(INDEX_KEY, store)
  return index ?? {}
}

export async function idbPutDrawing(doc: InnerDrawingDocument, meta: DrawingMetadata): Promise<void> {
  // Write content first, then atomically update the index so concurrent
  // saves can't clobber each other's entries.
  await set(drawingKey(doc.id), doc, store)
  await update<Record<string, DrawingMetadata>>(
    INDEX_KEY,
    (index) => ({ ...(index ?? {}), [doc.id]: meta }),
    store,
  )
}

export async function idbDeleteDrawing(id: string): Promise<void> {
  await del(drawingKey(id), store)
  await update<Record<string, DrawingMetadata>>(
    INDEX_KEY,
    (index) => {
      const next = { ...(index ?? {}) }
      delete next[id]
      return next
    },
    store,
  )
}

export async function idbClear(): Promise<void> {
  const index = await idbGetIndex()
  await Promise.all(Object.keys(index).map((id) => del(drawingKey(id), store)))
  await del(INDEX_KEY, store)
}
