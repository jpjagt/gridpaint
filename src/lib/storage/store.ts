/**
 * store.ts
 *
 * Storage interface for gridpaint drawings
 *
 * Primary responsibilities:
 * - Define DrawingStore interface
 * - Export default store instance
 */

import type {
  DrawingMetadata,
  DrawingDocument,
} from './types'
import { getDrawingStore } from './storage-manager'

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

/**
 * Default store instance for application usage
 * Uses HybridDrawingStore that syncs between LocalStorage and Firestore
 */
export const drawingStore: DrawingStore = getDrawingStore()
