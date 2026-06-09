/**
 * serialization.ts
 *
 * Shared (de)serialization for drawing documents, used by both the
 * LocalStorage and Firestore stores. Converts between the in-memory
 * DrawingDocument (Sets, Maps) and the JSON-safe InnerDrawingDocument
 * (arrays, Records), and migrates legacy on-disk formats on load:
 *   - layers: legacy flat `points` -> single "default" group
 *   - cutouts: v1 `radius` (grid units) -> v2 `radiusMm` (mm) -> v3 `diameterMm` (mm)
 */

import type { Layer } from "@/stores/drawingStores"
import type { CircularCutout, PointModifications } from "@/types/gridpaint"
import type {
  DrawingDocument,
  InnerDrawingDocument,
  LayerData,
} from "./types"

/**
 * Serialize an in-memory DrawingDocument into a JSON-safe InnerDrawingDocument
 * (groups with Set -> array, pointModifications Map -> Record).
 */
export function serializeDocument(doc: DrawingDocument): InnerDrawingDocument {
  return {
    ...doc,
    layers: doc.layers.map((layer): LayerData => {
      const serialized: LayerData = {
        id: layer.id,
        isVisible: layer.isVisible,
        renderStyle: layer.renderStyle,
        groups: layer.groups.map((g) => ({
          id: g.id,
          ...(g.name !== undefined ? { name: g.name } : {}),
          points: Array.from(g.points),
          ...(g.offsetPhase !== undefined ? { offsetPhase: g.offsetPhase } : {}),
        })),
      }
      if (layer.pointModifications && layer.pointModifications.size > 0) {
        serialized.pointModifications = Object.fromEntries(layer.pointModifications)
      }
      if (layer.scale) {
        serialized.scale = layer.scale
      }
      return serialized
    }),
  }
}

/**
 * Deserialize a JSON-safe InnerDrawingDocument into an in-memory
 * DrawingDocument, migrating legacy layer and cutout formats.
 */
export function deserializeDocument(doc: InnerDrawingDocument): DrawingDocument {
  const layers: Layer[] = doc.layers.map((layer) => {
    let groups: Layer["groups"]
    if (layer.groups && layer.groups.length > 0) {
      // New format: deserialize groups (points array -> Set)
      groups = layer.groups.map((g) => ({
        id: g.id,
        name: g.name,
        points: new Set(g.points),
        offsetPhase: g.offsetPhase,
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
    // old CircularCutout formats:
    //   v1: `radius` (grid units) → v2: `radiusMm` (mm) → v3: `diameterMm` (mm)
    let pointModifications: Map<string, PointModifications> | undefined
    if (layer.pointModifications) {
      const mmPerUnit: number = (doc as { mmPerUnit?: number }).mmPerUnit ?? 5
      pointModifications = new Map(
        Object.entries(layer.pointModifications).map(([key, mods]) => {
          const migratedMods: PointModifications = { ...mods }
          if (mods.cutouts) {
            migratedMods.cutouts = mods.cutouts.map((c) => {
              const legacy = c as unknown as Record<string, unknown>
              // v1→v2: old format had `radius` in grid units
              if (!('radiusMm' in legacy) && !('diameterMm' in legacy) && typeof legacy.radius === 'number') {
                return { ...c, diameterMm: legacy.radius * mmPerUnit * 2 }
              }
              // v2→v3: old format used `radiusMm`; new format uses `diameterMm`
              if ('radiusMm' in legacy && !('diameterMm' in legacy) && typeof legacy.radiusMm === 'number') {
                return { ...c, diameterMm: (legacy.radiusMm as number) * 2 } as CircularCutout
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
      scale: layer.scale,
    }
  })

  return { ...doc, layers }
}
