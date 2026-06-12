import type { LayerRange } from "@/types/layers"

type Hsl = [h: number, s: number, l: number]

/** Read a `--token` whose value is an HSL triple like "214 32% 91%". */
function readHslToken(varName: string): Hsl {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim()
  return parseHslTriple(raw)
}

export function parseHslTriple(raw: string): Hsl {
  // "214.3 31.8% 91.4%" → [214.3, 31.8, 91.4]
  const parts = raw.replace(/%/g, "").split(/\s+/).map(Number)
  if (parts.length < 3 || parts.some(Number.isNaN)) return [0, 0, 0]
  return [parts[0], parts[1], parts[2]]
}

export function interpolateHsl(a: Hsl, b: Hsl, t: number): string {
  const h = a[0] + (b[0] - a[0]) * t
  const s = a[1] + (b[1] - a[1]) * t
  const l = a[2] + (b[2] - a[2]) * t
  const fmt = (n: number) => String(Math.round(n * 100) / 100)
  return `hsl(${fmt(h)} ${fmt(s)}% ${fmt(l)}%)`
}

/** Fill color for a layer id, interpolated across the configured range. */
export function getLayerFillColor(id: number, range: LayerRange): string {
  const lightest = readHslToken("--canvas-layer-lightest")
  const darkest = readHslToken("--canvas-layer-darkest")
  const span = range.max - range.min
  const t = span === 0 ? 0 : (id - range.min) / span
  return interpolateHsl(lightest, darkest, Math.max(0, Math.min(1, t)))
}
