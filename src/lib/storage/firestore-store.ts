/**
 * Firestore implementation of DrawingStore
 * 
 * Handles cloud storage of drawings with write-token based authentication
 */

import {
  doc,
  getDoc,
  deleteDoc,
  arrayUnion,
  arrayRemove,
  updateDoc,
  runTransaction,
  deleteField,
} from 'firebase/firestore'
import { db } from '@/lib/firebase/firestore'
import { removeUndefined } from '@/lib/firebase/utils'
import { serializeDocument, deserializeDocument } from "./serialization"
import type { DrawingStore } from './store'
import type {
  DrawingMetadata,
  DrawingDocument,
  InnerDrawingDocument,
} from './types'
import type { DrawingMetaEntry, UserProfile } from '@/types/auth'

/** Max parallel drawing-doc reads when listing legacy drawings. */
const LEGACY_FETCH_CONCURRENCY = 6

/** Run `fn` over `items` with at most `limit` in flight; preserves order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  )
  return results
}

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
      
      const metaMap = userData.drawing_meta || {}
      const metadata: DrawingMetadata[] = []
      const legacyIds: string[] = []
      for (const id of drawingIds) {
        const meta = metaMap[id]
        if (meta) {
          metadata.push({
            id,
            name: meta.name,
            createdAt: meta.createdAt,
            updatedAt: meta.updatedAt,
          })
        } else {
          legacyIds.push(id)
        }
      }

      // Legacy drawings (saved before drawing_meta existed): read their docs
      // in parallel, then backfill drawing_meta so the next list is cheap.
      if (legacyIds.length > 0) {
        const fetched = await mapWithConcurrency(
          legacyIds,
          LEGACY_FETCH_CONCURRENCY,
          async (id) => {
            const drawingSnap = await getDoc(doc(db, 'drawings', id))
            if (!drawingSnap.exists()) return null
            const data = drawingSnap.data() as InnerDrawingDocument
            return {
              id,
              name: data.name,
              createdAt: data.createdAt,
              updatedAt: data.updatedAt,
            } satisfies DrawingMetadata
          },
        )
        const backfill: Record<string, DrawingMetaEntry> = {}
        for (const m of fetched) {
          if (!m) continue
          metadata.push(m)
          backfill[`drawing_meta.${m.id}`] = {
            name: m.name,
            createdAt: m.createdAt,
            updatedAt: m.updatedAt,
          }
        }
        if (Object.keys(backfill).length > 0) {
          try {
            await updateDoc(userRef, backfill)
          } catch (error) {
            console.warn('[FirestoreStore] drawing_meta backfill failed:', error)
          }
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
      return deserializeDocument(data)
    } catch (error) {
      console.error('[FirestoreStore] Error getting drawing:', error)
      throw error
    }
  }

  /**
   * Save or update a drawing
   */
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

    let didWrite = false
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
      didWrite = true
    })

    if (didWrite) {
      const userRef = doc(db, "users", this.userId)
      await updateDoc(userRef, {
        drawing_ids: arrayUnion(drawingDoc.id),
        [`drawing_meta.${drawingDoc.id}`]: {
          name: drawingDoc.name,
          createdAt: drawingDoc.createdAt,
          updatedAt: drawingDoc.updatedAt,
        } satisfies DrawingMetaEntry,
        updatedAt: Date.now(),
      })
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
        [`drawing_meta.${id}`]: deleteField(),
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
        drawing_meta: {},
        updatedAt: Date.now(),
      })
      
      console.log('[FirestoreStore] Cleared', drawingIds.length, 'drawings')
    } catch (error) {
      console.error('[FirestoreStore] Error clearing drawings:', error)
      throw error
    }
  }
}
