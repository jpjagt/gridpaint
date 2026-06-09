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
    if (typeof localStorage === "undefined") {
      this.migrated = true
      return
    }
    if (localStorage.getItem(MIGRATION_FLAG)) {
      this.migrated = true
      return
    }

    const json = localStorage.getItem(LEGACY_KEY)
    let entries: InnerDrawingDocument[] = []
    if (json) {
      try {
        const data = JSON.parse(json) as Record<string, InnerDrawingDocument>
        // Skip malformed entries rather than writing broken records.
        entries = Object.values(data).filter(
          (d): d is InnerDrawingDocument =>
            !!d && typeof d.id === "string" && Array.isArray(d.layers),
        )
      } catch {
        console.warn("[LocalStore] Failed to parse legacy storage; skipping migration")
        // A syntactically broken blob is unrecoverable — mark migrated so we
        // don't retry forever, and leave the legacy key in place.
        localStorage.setItem(MIGRATION_FLAG, "1")
        this.migrated = true
        return
      }
    }

    // Writes are outside the parse try/catch: if one fails, the exception
    // propagates and neither flag is set, so a later call/reload retries.
    for (const inner of entries) {
      await idbPutDrawing(inner, metaFromInner(inner))
    }
    if (entries.length > 0) {
      console.log(`[LocalStore] Migrated ${entries.length} legacy drawings to IndexedDB`)
    }
    // Keep the legacy key in place as a fallback (do not remove yet).
    localStorage.setItem(MIGRATION_FLAG, "1")
    this.migrated = true
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
    await idbPutDrawing(inner, metaFromInner(inner))
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
function metaFromInner(inner: InnerDrawingDocument): DrawingMetadata {
  return {
    id: inner.id,
    name: inner.name,
    createdAt: inner.createdAt,
    updatedAt: inner.updatedAt,
    ...(inner.thumbnail !== undefined ? { thumbnail: inner.thumbnail } : {}),
  }
}
