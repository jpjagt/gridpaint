import type * as THREE from "three"

/**
 * A classified solid region extracted from a layer's SVG loops, in SVG
 * coordinates (y-down), before any Y-flip into Three.js space.
 *
 * `contour` is the outer boundary (CW in SVG coords per the SvgPathRenderer
 * orientation guarantee); `holes` are the CCW loops assigned to this contour.
 */
export interface ClassifiedSvgShape {
  contour: THREE.Vector2[]
  holes: THREE.Vector2[][]
  /** Absolute shoelace area of the contour, in SVG units². */
  area: number
}
