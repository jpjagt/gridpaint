/**
 * Hybrid storage implementation
 * 
 * Orchestrates between LocalStorage (fast, immediate) and Firestore (cloud, synced)
 * - Writes go to LocalStorage immediately for responsiveness
 * - Syncs to Firestore in background with debouncing
 * - Reads prefer LocalStorage, fall back to Firestore
 * - Handles conflict resolution using last-write-wins (updatedAt timestamp)
 */

import type { DrawingStore } from './store'
import type { DrawingMetadata, DrawingDocument } from './types'
import { LocalStorageDrawingStore } from './local-store'
import { FirestoreDrawingStore } from './firestore-store'
import { setSyncStatus } from '@/stores/authStores'

/**
 * Debounce delay for syncing to Firestore (ms)
 * Waits this long after last change before syncing
 */
const SYNC_DEBOUNCE_MS = 2000

/**
 * Hybrid implementation that uses both LocalStorage and Firestore
 */
export class HybridDrawingStore implements DrawingStore {
  private localStore: LocalStorageDrawingStore
  private cloudStore: FirestoreDrawingStore | null
  private syncTimeouts: Map<string, NodeJS.Timeout>
  private enabled: boolean

  constructor(userId?: string, writeToken?: string) {
    this.localStore = new LocalStorageDrawingStore()
    this.cloudStore = userId && writeToken 
      ? new FirestoreDrawingStore(userId, writeToken)
      : null
    this.syncTimeouts = new Map()
    this.enabled = true
    
    console.log('[HybridStore] Initialized', 
      this.cloudStore ? 'with cloud sync' : 'local-only'
    )
  }

  /**
   * Enable/disable cloud sync
   */
  setCloudSync(userId: string | null, writeToken: string | null): void {
    if (userId && writeToken) {
      this.cloudStore = new FirestoreDrawingStore(userId, writeToken)
      console.log('[HybridStore] Cloud sync enabled')
    } else {
      this.cloudStore = null
      console.log('[HybridStore] Cloud sync disabled')
    }
  }

  /**
   * List all drawings (merge local and cloud)
   */
  async list(): Promise<DrawingMetadata[]> {
    try {
      const localDrawings = await this.localStore.list()
      
      if (!this.cloudStore) {
        return localDrawings
      }
      
      const cloudDrawings = await this.cloudStore.list()
      
      // Merge by ID, preferring newer timestamp
      const merged = new Map<string, DrawingMetadata>()
      
      for (const drawing of localDrawings) {
        merged.set(drawing.id, drawing)
      }
      
      for (const drawing of cloudDrawings) {
        const existing = merged.get(drawing.id)
        if (!existing || drawing.updatedAt > existing.updatedAt) {
          merged.set(drawing.id, drawing)
        }
      }
      
      return Array.from(merged.values())
    } catch (error) {
      console.error('[HybridStore] Error listing drawings:', error)
      // Fall back to local on error
      return this.localStore.list()
    }
  }

  /**
   * Get a drawing (try local first, then cloud)
   */
  async get(id: string): Promise<DrawingDocument | null> {
    try {
      // Try local first (fast)
      const localDoc = await this.localStore.get(id)
      
      if (!this.cloudStore) {
        return localDoc
      }
      
      // Try cloud
      const cloudDoc = await this.cloudStore.get(id)
      
      // If only one exists, use it
      if (!localDoc) return cloudDoc
      if (!cloudDoc) return localDoc
      
      // Both exist - use newer one (last-write-wins)
      const newerDoc = cloudDoc.updatedAt > localDoc.updatedAt ? cloudDoc : localDoc
      
      // If cloud was newer, update local
      if (newerDoc === cloudDoc) {
        await this.localStore.save(cloudDoc)
        console.log('[HybridStore] Updated local from cloud:', id)
      }
      
      return newerDoc
    } catch (error) {
      console.error('[HybridStore] Error getting drawing:', error)
      // Fall back to local on error
      return this.localStore.get(id)
    }
  }

  /**
   * Save a drawing (immediate to local, debounced to cloud)
   */
  async save(doc: DrawingDocument): Promise<void> {
    try {
      // Immediate save to local for responsiveness
      await this.localStore.save(doc)
      
      if (!this.cloudStore) {
        return
      }
      
      // Cancel any pending sync for this drawing
      const existingTimeout = this.syncTimeouts.get(doc.id)
      if (existingTimeout) {
        clearTimeout(existingTimeout)
      }
      
      // Schedule debounced sync to cloud
      const timeout = setTimeout(async () => {
        try {
          setSyncStatus({ isSyncing: true, error: null })
          await this.cloudStore!.save(doc)
          setSyncStatus({ 
            isSyncing: false, 
            lastSyncAt: Date.now(),
            error: null 
          })
          console.log('[HybridStore] Synced to cloud:', doc.id)
        } catch (error) {
          console.error('[HybridStore] Error syncing to cloud:', error)
          setSyncStatus({ 
            isSyncing: false,
            error: error instanceof Error ? error.message : 'Sync failed'
          })
        } finally {
          this.syncTimeouts.delete(doc.id)
        }
      }, SYNC_DEBOUNCE_MS)
      
      this.syncTimeouts.set(doc.id, timeout)
    } catch (error) {
      console.error('[HybridStore] Error saving drawing:', error)
      throw error
    }
  }

  /**
   * Delete a drawing (from both local and cloud)
   */
  async delete(id: string): Promise<void> {
    try {
      // Cancel any pending sync
      const existingTimeout = this.syncTimeouts.get(id)
      if (existingTimeout) {
        clearTimeout(existingTimeout)
        this.syncTimeouts.delete(id)
      }
      
      // Delete from local
      await this.localStore.delete(id)
      
      // Delete from cloud if available
      if (this.cloudStore) {
        try {
          await this.cloudStore.delete(id)
        } catch (error) {
          console.error('[HybridStore] Error deleting from cloud:', error)
          // Continue even if cloud delete fails
        }
      }
      
      console.log('[HybridStore] Deleted:', id)
    } catch (error) {
      console.error('[HybridStore] Error deleting drawing:', error)
      throw error
    }
  }

  /**
   * Clear all drawings (from both local and cloud)
   */
  async clear(): Promise<void> {
    try {
      // Cancel all pending syncs
      for (const timeout of this.syncTimeouts.values()) {
        clearTimeout(timeout)
      }
      this.syncTimeouts.clear()
      
      // Clear local
      await this.localStore.clear()
      
      // Clear cloud if available
      if (this.cloudStore) {
        try {
          await this.cloudStore.clear()
        } catch (error) {
          console.error('[HybridStore] Error clearing cloud:', error)
          // Continue even if cloud clear fails
        }
      }
      
      console.log('[HybridStore] Cleared all drawings')
    } catch (error) {
      console.error('[HybridStore] Error clearing drawings:', error)
      throw error
    }
  }

  /**
   * Force immediate sync to cloud (useful for logout/cleanup)
   */
  async syncNow(): Promise<void> {
    if (!this.cloudStore) {
      return
    }
    
    try {
      setSyncStatus({ isSyncing: true, error: null })
      
      // Get all local drawings
      const localDrawings = await this.localStore.list()
      
      // Sync each one
      for (const metadata of localDrawings) {
        const doc = await this.localStore.get(metadata.id)
        if (doc) {
          await this.cloudStore.save(doc)
        }
      }
      
      setSyncStatus({ 
        isSyncing: false,
        lastSyncAt: Date.now(),
        error: null
      })
      
      console.log('[HybridStore] Force synced', localDrawings.length, 'drawings')
    } catch (error) {
      console.error('[HybridStore] Error force syncing:', error)
      setSyncStatus({ 
        isSyncing: false,
        error: error instanceof Error ? error.message : 'Sync failed'
      })
      throw error
    }
  }
}
