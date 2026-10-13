/**
 * World palettes. The character keeps its own colors (config.colors).
 * Add one here and it shows up in the switcher (C cycles, X makes a random one).
 */

import type { RunnerConfig, RunnerPalette } from "@/types/runner"

export const DEFAULT_PALETTES: Record<string, RunnerPalette> = {
  day: {
    front: "#ededed",
    side: "#919191",
    sideTop: "#c9c9c9",
    line: "#999999",
    seam: "#999999",
    fog: "#ffffff",
    shadow: "#b8b8b8",
    invertMetal: false,
  },
  // the inverse of a light grey palette; metal reflections are inverted too
  night: {
    front: "#525252",
    side: "#757575",
    sideTop: "#2b2b2b",
    line: "#666666",
    seam: "#666666",
    fog: "#0f0f0f",
    shadow: "#000000",
    invertMetal: true,
  },
  fog: {
    front: "#f4f4f4",
    side: "#dcdcdc",
    sideTop: "#e8e8e8",
    line: "#c2c2c2",
    seam: "#cecece",
    fog: "#f7f7f7",
    shadow: "#d4d4d4",
    invertMetal: false,
  },
  ink: {
    front: "#ffffff",
    side: "#f0f0f0",
    sideTop: "#f7f7f7",
    line: "#111111",
    seam: "#6b6b6b",
    fog: "#ffffff",
    shadow: "#cfcfcf",
    invertMetal: false,
  },
  dusk: {
    front: "#ebe3d9",
    side: "#a3968a",
    sideTop: "#c9bdb0",
    line: "#8a7d70",
    seam: "#8a7d70",
    fog: "#f4eadf",
    shadow: "#b3a594",
    invertMetal: false,
  },
  blueprint: {
    front: "#1f3a5f",
    side: "#152b48",
    sideTop: "#24456e",
    line: "#a9c8ef",
    seam: "#6f95c4",
    fog: "#0f2038",
    shadow: "#08121f",
    invertMetal: true,
  },
  terminal: {
    front: "#0c1a10",
    side: "#0f2415",
    sideTop: "#13301b",
    line: "#41f07c",
    seam: "#1f8f45",
    fog: "#040a06",
    shadow: "#000000",
    invertMetal: true,
  },
  vapor: {
    front: "#f6e8f2",
    side: "#c4b0e3",
    sideTop: "#e0d1f2",
    line: "#8f7bb8",
    seam: "#a796cc",
    fog: "#fdf4fb",
    shadow: "#cbb6d8",
    invertMetal: false,
  },
}

export function activePalette(config: RunnerConfig): RunnerPalette {
  return config.palettes[config.palette] ?? Object.values(config.palettes)[0] ?? DEFAULT_PALETTES.day
}

/** Name of the palette after the current one */
export function nextPaletteName(config: RunnerConfig): string {
  const names = Object.keys(config.palettes)
  const i = names.indexOf(config.palette)
  return names[(i + 1) % names.length]
}

function hsl(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const hex = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0")
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`
}

/**
 * Semi-random palette: one hue, mostly desaturated, light or dark, with
 * the same structure as the hand-made ones (fronts near the fog, sides
 * darker, tops in between, lines contrasting).
 */
export function randomPalette(random: () => number = Math.random): RunnerPalette {
  const h = random() * 360
  const s = random() < 0.6 ? random() * 0.15 : 0.15 + random() * 0.35
  const dark = random() < 0.4
  // lightness levels for light palettes; mirrored for dark ones
  const L = (v: number) => (dark ? 1 - v : v)
  const contrast = 0.15 + random() * 0.3
  const lineAccent = random() < 0.3
  const lineHue = lineAccent ? (h + 120 + random() * 120) % 360 : h
  const lineSat = lineAccent ? 0.5 + random() * 0.4 : s
  return {
    front: hsl(h, s, L(0.93 - random() * 0.05)),
    side: hsl(h, s, L(0.9 - contrast - 0.15)),
    sideTop: hsl(h, s, L(0.9 - contrast * 0.5)),
    line: hsl(lineHue, lineSat, L(lineAccent ? 0.45 : 0.55 - random() * 0.15)),
    seam: hsl(lineHue, lineSat * 0.7, L(0.62)),
    fog: hsl(h, s * 0.6, L(0.97)),
    shadow: hsl(h, s, L(dark ? 0.99 : 0.7)),
    invertMetal: dark,
  }
}
