/**
 * types.ts
 *
 * Storage schema types for gridpaint drawings
 *
 * Primary responsibilities:
 * - Define data shapes for persistence: LayerData, DrawingMetadata, DrawingDocument
 */

import type { Layer } from "@/stores/drawingStores"

/**
 * Serialized representation of a drawing layer
 */
export interface LayerData {
  id: number
  /** Array of "x,y" strings representing active points */
  points: Set<string>
  /** Whether this layer is visible */
  isVisible: boolean
  /** Rendering style for this layer */
  renderStyle: "default" | "tiles"
}

/**
 * Metadata for a saved drawing
 */
export interface DrawingMetadata {
  /** Unique identifier for the drawing */
  id: string
  /** User-defined name of the drawing */
  name: string
  /** Timestamp (ms since epoch) when created */
  createdAt: number
  /** Timestamp (ms since epoch) when last updated */
  updatedAt: number
}

/**
 * Full document for a saved drawing, including content and metadata
 */
export interface DrawingDocument extends DrawingMetadata {
  /** Grid cell size */
  gridSize: number
  /** Width of the blob border */
  borderWidth: number
  /** Pan offset for viewport positioning */
  panOffset: { x: number; y: number }
  /** Current zoom factor */
  zoom: number
  /** How many millimeters each grid unit represents */
  mmPerUnit: number
  /** All layers in this drawing */
  layers: Layer[]
}

export interface InnerDrawingDocument extends Omit<DrawingDocument, "layers"> {
  layers: LayerData[]
}
