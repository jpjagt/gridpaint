/**
 * Single source of truth for the editor's single-key shortcuts. Buttons show
 * these labels, the key handlers read them, and the shortcuts modal lists them,
 * so the three can't drift apart.
 *
 * Global tool keys must never collide with the tool-specific keys below, since
 * both are live at the same time.
 *
 * Quadrant keys use the 2×2 block on the right hand, laid out like the
 * quadrants they select:
 *
 *    I O      NW NE
 *    K L      SW SE
 *
 * In the override tool, Shift picks the complement of the shape within its
 * quadrant: full ↔ empty, convex ↔ concave.
 */

import type { Tool } from "@/stores/ui"
import type { CutoutAnchor, QuadrantState } from "@/types/gridpaint"

export const TOOL_KEYS: Record<Tool, string> = {
  draw: "D",
  erase: "E",
  pan: "P",
  select: "S",
  shape: "R",
  cutout: "H",
  override: "V",
  measure: "T",
  export: "X",
  rig: "A",
}

/** Corner key → compass corner, in keyboard layout order (I O / K L) */
export const QUADRANT_KEYS = {
  I: "nw",
  O: "ne",
  K: "sw",
  L: "se",
} as const

export type Corner = (typeof QUADRANT_KEYS)[keyof typeof QUADRANT_KEYS]

export const FULL_KEY = "F"

/** Display label for an override shape, e.g. "I" or "⇧I" */
export function overrideKeyLabel(shape: QuadrantState): string {
  if (shape === "full") return FULL_KEY
  if (shape === "empty") return `⇧${FULL_KEY}`
  const [kind, corner] = shape.split("-") as ["convex" | "concave", Corner]
  const key = cornerKey(corner)
  return kind === "concave" ? `⇧${key}` : key
}

function cornerKey(corner: Corner): string {
  return Object.entries(QUADRANT_KEYS).find(([, c]) => c === corner)![0]
}

/** Override shape for a keydown, or null if the key isn't an override key */
export function overrideShapeForKey(e: KeyboardEvent): QuadrantState | null {
  const key = e.key.toUpperCase()
  if (key === FULL_KEY) return e.shiftKey ? "empty" : "full"
  const corner = QUADRANT_KEYS[key as keyof typeof QUADRANT_KEYS]
  if (!corner) return null
  return `${e.shiftKey ? "concave" : "convex"}-${corner}`
}

/**
 * Cutout anchor for a keydown, or null: corners on I O K L, and F (the whole
 * cell, as in the override tool) for the centre
 */
export function cutoutAnchorForKey(e: KeyboardEvent): CutoutAnchor | null {
  if (e.shiftKey) return null
  const key = e.key.toUpperCase()
  if (key === FULL_KEY) return "center"
  return QUADRANT_KEYS[key as keyof typeof QUADRANT_KEYS] ?? null
}

/** Display label for a cutout anchor's key, if it has one */
export function cutoutAnchorKeyLabel(anchor: CutoutAnchor): string | null {
  if (anchor === "center") return FULL_KEY
  const entry = Object.entries(QUADRANT_KEYS).find(([, c]) => c === anchor)
  return entry ? entry[0] : null
}

/** True when a key event should be left alone: typing, or a browser chord */
export function isIgnorableKeyEvent(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return true
  const t = e.target
  return (
    t instanceof HTMLInputElement ||
    t instanceof HTMLTextAreaElement ||
    t instanceof HTMLSelectElement ||
    (t instanceof HTMLElement && t.isContentEditable)
  )
}
