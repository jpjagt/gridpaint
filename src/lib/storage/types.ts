/**
 * types.ts
 *
 * Storage schema types for gridpaint drawings
 *
 * Primary responsibilities:
 * - Define data shapes for persistence: LayerData, DrawingMetadata, DrawingDocument
 */

import type { Layer } from "@/stores/drawingStores"
import type { CircularCutout, ExportRect, QuadrantOverrides } from "@/types/gridpaint"

// === Serialized Types (JSON-safe) ===

export interface SerializedInteractionGroup {
  id: string
  name?: string
  points: string[]
}

export interface SerializedPointModifications {
  cutouts?: CircularCutout[]
  quadrantOverrides?: QuadrantOverrides
}

/**
 * Serialized representation of a drawing layer.
 * Supports both legacy format (points array) and new format (groups array).
 */
export interface LayerData {
  id: number
  /** Whether this layer is visible */
  isVisible: boolean
  /** Rendering style for this layer */
  renderStyle: "default" | "tiles"
  /** New format: interaction groups with their points */
  groups?: SerializedInteractionGroup[]
  /** Per-point modifications keyed by "x,y" */
  pointModifications?: Record<string, SerializedPointModifications>
  /** @deprecated Legacy format: flat array/set of "x,y" strings. Migrated to groups on load. */
  points?: string[] | Set<string>
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
  /** Export rectangles — regions of the grid to include in SVG export */
  exportRects?: ExportRect[]
  /** Owner user ID (hashed passphrase) - for cloud storage */
  ownerId?: string
  /** Write token for authentication - for cloud storage */
  writeToken?: string
}

export interface InnerDrawingDocument extends Omit<DrawingDocument, "layers"> {
  layers: LayerData[]
}
