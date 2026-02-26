import { atom } from "nanostores"
import { $layersState } from "@/stores/drawingStores"
import type { Layer } from "@/stores/drawingStores"

const MAX_HISTORY = 50

interface HistoryState {
  snapshots: Layer[][]
  cursor: number // index of the current state in snapshots
}

export const $history = atom<HistoryState>({
  snapshots: [],
  cursor: -1,
})

/** Deep-clone layers so mutations to Sets/Maps don't affect stored snapshots. */
function cloneLayers(layers: Layer[]): Layer[] {
  return layers.map((layer) => ({
    ...layer,
    groups: layer.groups.map((g) => ({ ...g, points: new Set(g.points) })),
    pointModifications: layer.pointModifications
      ? new Map(
          Array.from(layer.pointModifications.entries()).map(([k, v]) => [
            k,
            {
              ...v,
              cutouts: v.cutouts ? v.cutouts.map((c) => ({ ...c })) : undefined,
              quadrantOverrides: v.quadrantOverrides ? { ...v.quadrantOverrides } : undefined,
            },
          ]),
        )
      : undefined,
  }))
}

/**
 * Push the current layers onto the history stack at the cursor position,
 * discarding any snapshots ahead of the cursor (redo history).
 * Call this BEFORE mutating $layersState.
 */
export function pushHistory(layers: Layer[]): void {
  const { snapshots, cursor } = $history.get()

  // Truncate everything after cursor (branch off)
  const kept = snapshots.slice(0, cursor + 1)

  // Enforce max size by dropping oldest entries
  const trimmed = kept.length >= MAX_HISTORY ? kept.slice(kept.length - MAX_HISTORY + 1) : kept

  const newSnapshots = [...trimmed, cloneLayers(layers)]
  $history.set({
    snapshots: newSnapshots,
    cursor: newSnapshots.length - 1,
  })
}

/** Undo: move cursor back one step and restore $layersState. */
export function undo(): void {
  const { snapshots, cursor } = $history.get()
  if (cursor <= 0) return

  const newCursor = cursor - 1
  $history.set({ snapshots, cursor: newCursor })
  $layersState.setKey("layers", cloneLayers(snapshots[newCursor]))
}

/** Redo: move cursor forward one step and restore $layersState. */
export function redo(): void {
  const { snapshots, cursor } = $history.get()
  if (cursor >= snapshots.length - 1) return

  const newCursor = cursor + 1
  $history.set({ snapshots, cursor: newCursor })
  $layersState.setKey("layers", cloneLayers(snapshots[newCursor]))
}

/** Derived helpers for UI (avoid reading $history directly in components). */
export function canUndo(): boolean {
  const { cursor } = $history.get()
  return cursor > 0
}

export function canRedo(): boolean {
  const { snapshots, cursor } = $history.get()
  return cursor < snapshots.length - 1
}

/**
 * Clear all history — call this when loading a new drawing so stale
 * history from a previous document can't bleed through.
 */
export function clearHistory(): void {
  $history.set({ snapshots: [], cursor: -1 })
}
