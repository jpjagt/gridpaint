/**
 * LocalStorage implementation of DrawingStore
 */

import type { DrawingStore } from './store'
import type {
  DrawingMetadata,
  DrawingDocument,
  InnerDrawingDocument,
  LayerData,
} from './types'
import type { Layer } from '@/stores/drawingStores'
import type { PointModifications } from '@/types/gridpaint'

const STORAGE_KEY = 'gridpaint:drawings'

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
        `[LocalStore] readStorage: no data for key ${this.storageKey}`,
      )
      return {}
    }
    try {
      const data = JSON.parse(json) as Record<string, InnerDrawingDocument>
      console.log('[LocalStore] readStorage:', data)
      return data
    } catch {
      console.warn(
        'Failed to parse drawings from localStorage, resetting storage',
      )
      localStorage.removeItem(this.storageKey)
      return {}
    }
  }

  private writeStorage(data: Record<string, InnerDrawingDocument>): void {
    console.log('[LocalStore] writeStorage:', data)
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

    // Deserialize layers, migrating legacy "points" format to "groups"
    const layers: Layer[] = doc.layers.map((layer) => {
      let groups: Layer["groups"]
      if (layer.groups && layer.groups.length > 0) {
        // New format: deserialize groups (points array -> Set)
        groups = layer.groups.map((g) => ({
          id: g.id,
          name: g.name,
          points: new Set(g.points),
        }))
      } else if (layer.points) {
        // Legacy format: migrate flat points to a single default group
        const pointsArray = Array.isArray(layer.points)
          ? layer.points
          : Array.from(layer.points)
        groups = [{ id: "default", points: new Set(pointsArray) }]
      } else {
        groups = [{ id: "default", points: new Set<string>() }]
      }

      // Deserialize pointModifications (Record -> Map), with migration for
      // old CircularCutout format that stored `radius` (grid units) instead
      // of `radiusMm` (millimetres).
      let pointModifications: Map<string, PointModifications> | undefined
      if (layer.pointModifications) {
        const mmPerUnit: number = (doc as { mmPerUnit?: number }).mmPerUnit ?? 5
        pointModifications = new Map(
          Object.entries(layer.pointModifications).map(([key, mods]) => {
            const migratedMods: PointModifications = { ...mods }
            if (mods.cutouts) {
              migratedMods.cutouts = mods.cutouts.map((c) => {
                const legacy = c as unknown as Record<string, unknown>
                // Migration: old format had `radius` in grid units; new format uses `radiusMm`
                if (!('radiusMm' in legacy) && typeof legacy.radius === 'number') {
                  return { ...c, radiusMm: legacy.radius * mmPerUnit }
                }
                return c
              })
            }
            return [key, migratedMods]
          })
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

  async save(doc: DrawingDocument): Promise<void> {
    console.log('[LocalStore] save:', doc)
    const data = this.readStorage()

    // Serialize layers (groups with Set -> array, Map -> Record)
    const serializedDoc: InnerDrawingDocument = {
      ...doc,
      updatedAt: Date.now(),
      layers: doc.layers.map((layer): LayerData => {
        const serialized: LayerData = {
          id: layer.id,
          isVisible: layer.isVisible,
          renderStyle: layer.renderStyle,
          groups: layer.groups.map((g) => ({
            id: g.id,
            name: g.name,
            points: Array.from(g.points),
          })),
        }
        if (layer.pointModifications && layer.pointModifications.size > 0) {
          serialized.pointModifications = Object.fromEntries(layer.pointModifications)
        }
        return serialized
      }),
    }

    data[doc.id] = serializedDoc
    this.writeStorage(data)
    console.log('[LocalStore] saved:', doc.id)
  }

  async delete(id: string): Promise<void> {
    console.log('[LocalStore] delete:', id)
    const data = this.readStorage()
    if (data[id]) {
      delete data[id]
      this.writeStorage(data)
      console.log('[LocalStore] deleted:', id)
    }
  }

  async clear(): Promise<void> {
    localStorage.removeItem(this.storageKey)
  }
}
