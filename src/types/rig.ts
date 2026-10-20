/**
 * Assembly rig: a 3D-printable jig the metal layers of an export rect drop
 * into one by one (pillars), plus glue spots per layer interface.
 * See docs/superpowers/specs/2026-10-20-assembly-rig-design.md.
 */

/** A point in mm (or grid units, where noted), SVG frame (y down). */
export interface Vec2 {
  x: number
  y: number
}

/** A closed ring of points; outers and holes are told apart by orientation. */
export type Ring = Vec2[]

/** A region: rings combined with the non-zero fill rule. */
export type Region = Ring[]

/** A pillar placed by the user, at a canvas grid point. */
export interface RigPillar {
  x: number
  y: number
}

/** Rig settings stored on an export rect. */
export interface ExportRectRig {
  pillars: RigPillar[]
  /** Assemble face-down: layer 1 goes in first (mirrors the rig). */
  reverse?: boolean
}

/**
 * A glue spot for the interface between `layerId` and the next lower
 * visible layer id. `x, y` are canvas grid units in steps of 0.5.
 */
export interface GlueSpot {
  layerId: number
  x: number
  y: number
  /** Spot diameter (mm) when smaller than the print setup's default */
  diameter?: number
}

/** Printer-specific settings, shared across all drawings (per browser). */
export interface PrintSetup {
  /** Gap between metal and rig wall (mm) */
  clearance: number
  /** Floor plate under the bottom layer (mm) */
  basePlateThickness: number
  /** Thinnest pillar section that still prints (mm) */
  minWall: number
  /** Glue stencil plate thickness (mm) */
  stencilThickness: number
  /** Glue spot diameter (mm) */
  glueDiameter: number
  /** Preferred distance from a glue spot to the overlap edge (mm) */
  glueMargin: number
  /** Engrave triangles on pillars pointing at nearby glue spots */
  glueMarkers: boolean
  /** Engrave every layer's outline into the top of the base plate */
  plateOutlines: boolean
  /** Depth of those outline grooves (mm); one print layer is enough */
  outlineDepth: number
}

export type RigToolMode = "pillars" | "glue"

export interface RigToolSettings {
  mode: RigToolMode
  /** Export rect the rig is edited for; null = first rect */
  rectId: string | null
}

/** One separate shape of a layer: a loose part that must be held on its own. */
export interface RigPiece {
  /** Footprint in mm (outer ring plus its holes) */
  footprint: Region
  /** Point on the outline with its outward normal, for contact tests */
  samples: { p: Vec2; n: Vec2 }[]
  /** Centroid and radius used to weigh rotation against translation */
  center: Vec2
  radius: number
}

/** One layer as it goes into the rig. */
export interface RigLayer {
  layerId: number
  /** Position in assembly order (0 = first in, on the floor) */
  order: number
  /** Footprint in mm */
  footprint: Region
  /** Separate shapes of this layer inside the rect */
  pieces: RigPiece[]
}

/** Analysis of one pillar position. */
export interface PillarInfo {
  x: number
  y: number
  /** Cross-section per band (index = assembly order), until it ends */
  sections: Region[]
  /** Layer ids this pillar holds, in assembly order */
  touches: number[]
  /** Highest band index the pillar reaches (-1 = none) */
  topBand: number
  /**
   * Section of the short cap above the top band (lets the glue stencil
   * register too); null when the next band's section isn't printable
   */
  capSection: Region | null
  /** Blocked motion directions, per piece (index into the flat piece list) */
  blocked: Map<number, Uint8Array>
  /** Printed volume (mm³), used to prefer cheap pillars */
  volume: number
  placed: boolean
}

export interface LayerLockStatus {
  layerId: number
  /** Fraction of in-plane motions blocked for its loosest piece (1 = locked) */
  blockedFraction: number
  locked: boolean
  pieces: number
  lockedPieces: number
}

export type GlueSpotIssue = "uncovered" | "tight" | null

export interface GlueSpotInfo {
  layerId: number
  x: number
  y: number
  /** Diameter used (may be smaller than the setting for tiny overlaps) */
  diameter: number
  placed: boolean
  issue: GlueSpotIssue
}

/** A pair of neighbouring layers glued together. */
export interface GlueInterface {
  /** Higher id of the pair; spots are stored under this id */
  layerId: number
  lowerId: number
  /** The layer that is placed first; glue goes on top of it */
  baseLayerId: number
  overlap: Region
}

export interface RigAnalysis {
  rectId: string
  mmPerUnit: number
  thickness: number
  layers: RigLayer[]
  pillars: PillarInfo[]
  suggestedPillars: PillarInfo[]
  locks: LayerLockStatus[]
  /** Pieces not yet held in place, for highlighting */
  loosePieces: { layerId: number; footprint: Region }[]
  interfaces: GlueInterface[]
  glueSpots: GlueSpotInfo[]
  suggestedGlueSpots: GlueSpotInfo[]
}
