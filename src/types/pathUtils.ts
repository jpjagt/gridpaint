/**
 * Types for SVG path grouping / hole detection.
 */

export interface PathGroup {
  /** The outermost enclosing path (SVG d-string). */
  outer: string
  /** Paths that are fully contained inside the outer path (SVG d-strings). */
  holes: string[]
}
