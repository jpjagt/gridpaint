/**
 * Storage Manager
 * 
 * Manages the drawing store instance and handles switching between
 * local-only and hybrid (local + cloud) storage
 */

import { HybridDrawingStore } from './hybrid-store'
import type { DrawingStore } from './store'

// Global store instance
let storeInstance: HybridDrawingStore | null = null

/**
 * Initialize or get the drawing store
 * 
 * @param userId - Optional user ID for cloud sync
 * @param writeToken - Optional write token for cloud sync
 * @returns DrawingStore instance
 */
export function getDrawingStore(
  userId?: string,
  writeToken?: string
): DrawingStore {
  if (!storeInstance) {
    storeInstance = new HybridDrawingStore(userId, writeToken)
  } else if (userId && writeToken) {
    // Update cloud sync if credentials provided
    storeInstance.setCloudSync(userId, writeToken)
  }
  
  return storeInstance
}

/**
 * Enable cloud sync on existing store
 */
export function enableCloudSync(userId: string, writeToken: string): void {
  if (storeInstance) {
    storeInstance.setCloudSync(userId, writeToken)
  }
}

/**
 * Disable cloud sync
 */
export function disableCloudSync(): void {
  if (storeInstance) {
    storeInstance.setCloudSync(null, null)
  }
}

/**
 * Force immediate sync to cloud
 */
export async function forceSyncNow(): Promise<void> {
  if (storeInstance) {
    await storeInstance.syncNow()
  }
}
