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
import { setSyncStatus, setSaveStatus } from '@/stores/authStores'

/**
 * Debounce delay for syncing to Firestore (ms)
 * Waits this long after last change before syncing
 */
const SYNC_DEBOUNCE_MS = 2000

/**
 * Reconciliation rule. With single-source `updatedAt`, equal timestamps mean
 * identical content, so we keep local on ties — an older cloud copy must never
 * overwrite newer-or-equal local content.
 */
export function chooseNewer(
  local: DrawingDocument,
  cloud: DrawingDocument,
): "local" | "cloud" {
  return cloud.updatedAt > local.updatedAt ? "cloud" : "local"
}

/**
 * Hybrid implementation that uses both LocalStorage and Firestore
 */
export class HybridDrawingStore implements DrawingStore {
  private localStore: LocalStorageDrawingStore
  private cloudStore: FirestoreDrawingStore | null
  private syncTimeouts: Map<string, NodeJS.Timeout>

  constructor(userId?: string, writeToken?: string) {
    this.localStore = new LocalStorageDrawingStore()
    this.cloudStore = userId && writeToken
      ? new FirestoreDrawingStore(userId, writeToken)
      : null
    this.syncTimeouts = new Map()

    console.log('[HybridStore] Initialized', 
      this.cloudStore ? 'with cloud sync' : 'local-only'
    )
  }

  /**
   * Enable/disable cloud sync
   */
  setCloudSync(userId: string | null, writeToken: string | null): void {
    // Cancel pending syncs queued against the previous cloud store.
    for (const timeout of this.syncTimeouts.values()) clearTimeout(timeout)
    this.syncTimeouts.clear()

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
      const localDoc = await this.localStore.get(id)
      if (!this.cloudStore) return localDoc

      const cloudDoc = await this.cloudStore.get(id)
      if (!localDoc) return cloudDoc
      if (!cloudDoc) return localDoc

      if (chooseNewer(localDoc, cloudDoc) === "cloud") {
        await this.localStore.save(cloudDoc)
        console.log("[HybridStore] Adopted newer cloud version:", id)
        return cloudDoc
      }
      return localDoc
    } catch (error) {
      console.error("[HybridStore] Error getting drawing:", error)
      return this.localStore.get(id)
    }
  }

  /**
   * Save a drawing (immediate to local, debounced to cloud)
   */
  async save(doc: DrawingDocument): Promise<void> {
    try {
      await this.localStore.save(doc)
      setSaveStatus({ failed: false, error: null })
    } catch (error) {
      console.error("[HybridStore] LOCAL save failed:", error)
      setSaveStatus({
        failed: true,
        error: error instanceof Error ? error.message : "Save failed",
      })
      throw error
    }

    if (!this.cloudStore) return

    const existingTimeout = this.syncTimeouts.get(doc.id)
    if (existingTimeout) clearTimeout(existingTimeout)

    const timeout = setTimeout(async () => {
      try {
        setSyncStatus({ isSyncing: true, error: null })
        // Read the CURRENT doc from local at fire time — never a stale closure.
        const current = await this.localStore.get(doc.id)
        if (current) await this.cloudStore!.save(current)
        setSyncStatus({ isSyncing: false, lastSyncAt: Date.now(), error: null })
      } catch (error) {
        console.error("[HybridStore] Error syncing to cloud:", error)
        setSyncStatus({
          isSyncing: false,
          error: error instanceof Error ? error.message : "Sync failed",
        })
      } finally {
        this.syncTimeouts.delete(doc.id)
      }
    }, SYNC_DEBOUNCE_MS)

    this.syncTimeouts.set(doc.id, timeout)
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
