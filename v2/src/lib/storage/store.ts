/**
 * store.ts
 *
 * Storage implementation for gridpaint drawings
 *
 * Primary responsibilities:
 * - Define DrawingStore interface
 * - Provide LocalStorageDrawingStore implementation
 */

import type {
  DrawingMetadata,
  DrawingDocument,
  InnerDrawingDocument,
  LayerData,
} from "./types"

/**
 * Interface for persistent drawing storage operations
 */
export interface DrawingStore {
  /** List all saved drawing metadata */
  list(): Promise<DrawingMetadata[]>
  /** Retrieve a full drawing document by ID */
  get(id: string): Promise<DrawingDocument | null>
  /** Save or update a drawing document */
  save(doc: DrawingDocument): Promise<void>
  /** Delete a drawing by ID */
  delete(id: string): Promise<void>
  /** Clear all saved drawings */
  clear(): Promise<void>
}

const STORAGE_KEY = "gridpaint:drawings"

/**
 * LocalStorage-backed implementation of DrawingStore
 */
export class LocalStorageDrawingStore implements DrawingStore {
  private storageKey: string

  constructor(storageKey: string = STORAGE_KEY) {
    this.storageKey = storageKey
  }

  private readStorage(): Record<string, InnerDrawingDocument> {
    const json = localStorage.getItem(this.storageKey)
    if (!json) {
      console.log(
        `[DrawingStore] readStorage: no data for key ${this.storageKey}`,
      )
      return {}
    }
    try {
      const data = JSON.parse(json) as Record<string, InnerDrawingDocument>
      console.log("[DrawingStore] readStorage:", data)
      return data
    } catch {
      console.warn(
        "Failed to parse drawings from localStorage, resetting storage",
      )
      localStorage.removeItem(this.storageKey)
      return {}
    }
  }

  private writeStorage(data: Record<string, InnerDrawingDocument>): void {
    console.log("[DrawingStore] writeStorage:", data)
    localStorage.setItem(this.storageKey, JSON.stringify(data))
  }

  async list(): Promise<DrawingMetadata[]> {
    const data = this.readStorage()
    return Object.values(data).map(({ id, name, createdAt, updatedAt }) => ({
      id,
      name,
      createdAt,
      updatedAt,
    }))
  }

  async get(id: string): Promise<DrawingDocument | null> {
    const data = this.readStorage()
    const doc = data[id]
    if (!doc) return null

    // Convert points arrays back to Sets for runtime use
    return {
      ...doc,
      layers: doc.layers.map((layer) => ({
        ...layer,
        points: new Set(layer.points),
      })),
    }
  }

  async save(doc: DrawingDocument): Promise<void> {
    console.log("[DrawingStore] save:", doc)
    const data = this.readStorage()

    // Create a serializable version of the document
    const serializedDoc: InnerDrawingDocument = {
      ...doc,
      updatedAt: Date.now(),
      layers: doc.layers.map((layer) => ({
        ...layer,
        // Ensure points is an array for storage
        points: Array.isArray(layer.points)
          ? layer.points
          : Array.from(layer.points),
      })) as LayerData[],
    }

    data[doc.id] = serializedDoc
    this.writeStorage(data)
    console.log("[DrawingStore] saved:", doc.id)
  }

  async delete(id: string): Promise<void> {
    console.log("[DrawingStore] delete:", id)
    const data = this.readStorage()
    if (data[id]) {
      delete data[id]
      this.writeStorage(data)
      console.log("[DrawingStore] deleted:", id)
    }
  }

  async clear(): Promise<void> {
    localStorage.removeItem(this.storageKey)
  }
}

/**
 * Default store instance for application usage
 */
export const drawingStore: DrawingStore = new LocalStorageDrawingStore()
