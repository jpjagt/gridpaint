/**
 * thumbnail.ts
 *
 * Captures the live drawing canvas to a small PNG dataURL for the gallery.
 * The editor registers its canvas element here on mount; the save path calls
 * captureThumbnail() on content-change saves only.
 */

// Single active editor canvas at a time (the app has one canvas per session).
let registeredCanvas: HTMLCanvasElement | null = null

/** Editor registers (or clears) its canvas element. */
export function registerThumbnailCanvas(canvas: HTMLCanvasElement | null): void {
  registeredCanvas = canvas
}

/** Max thumbnail edge in px. Keeps metadata small. */
const THUMB_MAX = 240

/**
 * Capture the registered canvas, downscaled to fit THUMB_MAX, as a PNG dataURL.
 * Returns undefined if no canvas is registered or capture fails.
 *
 * Assumes the canvas already reflects the latest edit. This holds because
 * capture runs inside the debounced save (~1s after the last edit), well after
 * the canvas has repainted.
 */
export function captureThumbnail(): string | undefined {
  const src = registeredCanvas
  if (!src || src.width === 0 || src.height === 0) return undefined
  try {
    const scale = Math.min(1, THUMB_MAX / Math.max(src.width, src.height))
    const w = Math.max(1, Math.round(src.width * scale))
    const h = Math.max(1, Math.round(src.height * scale))
    const off = document.createElement("canvas")
    off.width = w
    off.height = h
    const ctx = off.getContext("2d")
    if (!ctx) return undefined
    ctx.drawImage(src, 0, 0, w, h)
    return off.toDataURL("image/png")
  } catch (err) {
    console.error("[thumbnail] capture failed", err)
    return undefined
  }
}
