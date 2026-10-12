/**
 * Client for the lab's python HTTP API (lab/gridlab/server.py, proxied by vite
 * at /api/lab) plus small browser helpers (pinned designs, downloads).
 */

import type { LabDesign, LabGallery, LabRecipe } from "@/types/lab"

const API = "/api/lab"

export async function fetchGallery(): Promise<LabGallery> {
  const res = await fetch(`${import.meta.env.BASE_URL}lab/gallery.json`, { cache: "no-cache" })
  if (!res.ok) throw new Error(`gallery.json: HTTP ${res.status}`)
  return (await res.json()) as LabGallery
}

/** Returns null when the server is not reachable. */
export async function fetchRecipes(): Promise<LabRecipe[] | null> {
  try {
    const res = await fetch(`${API}/recipes`, { signal: AbortSignal.timeout(2500) })
    if (!res.ok) return null
    const ct = res.headers.get("content-type") ?? ""
    if (!ct.includes("json")) return null // e.g. SPA fallback HTML
    const data = (await res.json()) as unknown
    return Array.isArray(data) ? (data as LabRecipe[]) : null
  } catch {
    return null
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`${path}: HTTP ${res.status} ${text.slice(0, 200)}`)
  }
  return (await res.json()) as T
}

export function runRecipe(
  recipe: string,
  params: Record<string, unknown>,
  seed: number,
): Promise<LabDesign> {
  return post<LabDesign>("run", { recipe, params, seed })
}

export function runVariants(
  recipe: string,
  params: Record<string, unknown>,
  seeds: number[],
): Promise<LabDesign[]> {
  return post<LabDesign[]>("variants", { recipe, params, seeds })
}

const PINNED_KEY = "gridlab-pinned-v1"

export function loadPinned(): LabDesign[] {
  try {
    const raw = localStorage.getItem(PINNED_KEY)
    const data = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(data) ? (data as LabDesign[]) : []
  } catch {
    return []
  }
}

export function savePinned(designs: LabDesign[]): void {
  try {
    localStorage.setItem(PINNED_KEY, JSON.stringify(designs))
  } catch {
    // quota / private mode: pinning is best-effort
  }
}

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 100000)
}
