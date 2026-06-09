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
