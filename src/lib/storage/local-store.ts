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
