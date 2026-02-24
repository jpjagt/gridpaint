/**
 * Firestore implementation of DrawingStore
 * 
 * Handles cloud storage of drawings with write-token based authentication
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  query,
  where,
  arrayUnion,
  arrayRemove,
  updateDoc,
} from 'firebase/firestore'
import { db } from '@/lib/firebase/firestore'
import { removeUndefined } from '@/lib/firebase/utils'
import type { DrawingStore } from './store'
import type {
  DrawingMetadata,
  DrawingDocument,
  InnerDrawingDocument,
  LayerData,
} from './types'
import type { Layer } from '@/stores/drawingStores'
import type { PointModifications } from '@/types/gridpaint'
import type { UserProfile } from '@/types/auth'

/**
 * Firestore-backed implementation of DrawingStore
 * Requires user authentication (userId + writeToken)
 */
export class FirestoreDrawingStore implements DrawingStore {
  private userId: string
  private writeToken: string

  constructor(userId: string, writeToken: string) {
    this.userId = userId
    this.writeToken = writeToken
  }

  /**
   * List all drawings owned by this user
   */
  async list(): Promise<DrawingMetadata[]> {
    try {
      // Get user's drawing IDs
      const userRef = doc(db, 'users', this.userId)
      const userSnap = await getDoc(userRef)
      
      if (!userSnap.exists()) {
        console.log('[FirestoreStore] User document not found')
        return []
      }
      
      const userData = userSnap.data() as UserProfile
      const drawingIds = userData.drawing_ids || []
      
      if (drawingIds.length === 0) {
        return []
      }
      
      // Fetch all drawings
      const metadata: DrawingMetadata[] = []
      for (const id of drawingIds) {
        const drawingRef = doc(db, 'drawings', id)
        const drawingSnap = await getDoc(drawingRef)
        
        if (drawingSnap.exists()) {
          const data = drawingSnap.data() as InnerDrawingDocument
          metadata.push({
            id: data.id,
            name: data.name,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
          })
        }
      }
      
      console.log('[FirestoreStore] Listed', metadata.length, 'drawings')
      return metadata
    } catch (error) {
      console.error('[FirestoreStore] Error listing drawings:', error)
      throw error
    }
  }

  /**
   * Get a drawing by ID
   */
  async get(id: string): Promise<DrawingDocument | null> {
    try {
      const drawingRef = doc(db, 'drawings', id)
      const drawingSnap = await getDoc(drawingRef)
      
      if (!drawingSnap.exists()) {
        console.log('[FirestoreStore] Drawing not found:', id)
        return null
      }
      
      const data = drawingSnap.data() as InnerDrawingDocument
      
      // Deserialize layers, migrating legacy "points" format to "groups"
      const layers: Layer[] = data.layers.map((layer) => {
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

        // Deserialize pointModifications, with migration for old CircularCutout
        // formats:
        //   v1: `radius` (grid units) → v2: `radiusMm` (mm) → v3: `diameterMm` (mm)
        let pointModifications: Map<string, PointModifications> | undefined
        if (layer.pointModifications) {
          const mmPerUnit: number = (data as { mmPerUnit?: number }).mmPerUnit ?? 5
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
                    return { ...c, diameterMm: (legacy.radiusMm as number) * 2 }
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
      
      console.log('[FirestoreStore] Retrieved drawing:', id)
      return { ...data, layers }
    } catch (error) {
      console.error('[FirestoreStore] Error getting drawing:', error)
      throw error
    }
  }

  /**
   * Save or update a drawing
   */
  async save(drawingDoc: DrawingDocument): Promise<void> {
    try {
      console.log('[FirestoreStore] Saving drawing:', drawingDoc.id)
      
      // Serialize layers (groups with Set -> array, Map -> Record)
      const serializedDoc: InnerDrawingDocument = {
        id: drawingDoc.id,
        name: drawingDoc.name,
        createdAt: drawingDoc.createdAt,
        updatedAt: Date.now(),
        gridSize: drawingDoc.gridSize,
        borderWidth: drawingDoc.borderWidth,
        panOffset: drawingDoc.panOffset,
        zoom: drawingDoc.zoom,
        mmPerUnit: drawingDoc.mmPerUnit,
        ownerId: this.userId,
        writeToken: this.writeToken,
        layers: drawingDoc.layers.map((layer): LayerData => {
          const serialized: LayerData = {
            id: layer.id,
            isVisible: layer.isVisible,
            renderStyle: layer.renderStyle,
            groups: layer.groups.map((g) => {
              const group: { id: string; name?: string; points: string[] } = {
                id: g.id,
                points: Array.from(g.points),
              }
              // Only include name if it's defined
              if (g.name !== undefined) {
                group.name = g.name
              }
              return group
            }),
          }
          if (layer.pointModifications && layer.pointModifications.size > 0) {
            serialized.pointModifications = Object.fromEntries(layer.pointModifications)
          }
          return serialized
        }),
      }
      
      // Remove undefined values (Firestore doesn't accept them)
      const cleanedDoc = removeUndefined(serializedDoc)
      
      // Save drawing document
      const drawingRef = doc(db, 'drawings', drawingDoc.id)
      await setDoc(drawingRef, cleanedDoc)
      
      // Add drawing ID to user's list if not already present
      const userRef = doc(db, 'users', this.userId)
      await updateDoc(userRef, {
        drawing_ids: arrayUnion(drawingDoc.id),
        updatedAt: Date.now(),
      })
      
      console.log('[FirestoreStore] Saved drawing:', drawingDoc.id)
    } catch (error) {
      console.error('[FirestoreStore] Error saving drawing:', error)
      throw error
    }
  }

  /**
   * Delete a drawing
   */
  async delete(id: string): Promise<void> {
    try {
      console.log('[FirestoreStore] Deleting drawing:', id)
      
      // Remove from user's drawing list
      const userRef = doc(db, 'users', this.userId)
      await updateDoc(userRef, {
        drawing_ids: arrayRemove(id),
        updatedAt: Date.now(),
      })
      
      // Delete the drawing document
      const drawingRef = doc(db, 'drawings', id)
      await deleteDoc(drawingRef)
      
      console.log('[FirestoreStore] Deleted drawing:', id)
    } catch (error) {
      console.error('[FirestoreStore] Error deleting drawing:', error)
      throw error
    }
  }

  /**
   * Clear all drawings for this user
   */
  async clear(): Promise<void> {
    try {
      console.log('[FirestoreStore] Clearing all drawings for user')
      
      // Get all drawing IDs
      const userRef = doc(db, 'users', this.userId)
      const userSnap = await getDoc(userRef)
      
      if (!userSnap.exists()) {
        return
      }
      
      const userData = userSnap.data() as UserProfile
      const drawingIds = userData.drawing_ids || []
      
      // Delete all drawings
      for (const id of drawingIds) {
        const drawingRef = doc(db, 'drawings', id)
        await deleteDoc(drawingRef)
      }
      
      // Clear user's drawing list
      await updateDoc(userRef, {
        drawing_ids: [],
        updatedAt: Date.now(),
      })
      
      console.log('[FirestoreStore] Cleared', drawingIds.length, 'drawings')
    } catch (error) {
      console.error('[FirestoreStore] Error clearing drawings:', error)
      throw error
    }
  }
}
