/**
 * Mathematical constants for blob rendering
 */

// Magic number for quarter-circle Bézier approximation
// Derived from (4/3) × (√2 - 1) ≈ 0.552786
export const magicNr = 0.553

// Default physical sizing
export const DEFAULT_MM_PER_UNIT = 5.0 // 5mm per grid unit
export const DEFAULT_LAYER_THICKNESS = 1 // mm of metal per layer
/** Thickness presets offered in the UI (mm); any positive value is allowed. */
export const LAYER_THICKNESS_PRESETS = [0.5, 1, 1.5, 2]
