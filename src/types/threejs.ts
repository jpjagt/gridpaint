import type * as THREE from "three"
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"

/** One viewer participating in cross-canvas camera sync (see CameraSyncGroup). */
export interface CameraSyncMember {
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
}

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
