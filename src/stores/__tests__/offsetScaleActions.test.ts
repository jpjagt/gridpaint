import { describe, it, expect, beforeEach, vi } from "vitest"

// Mock firebase modules to prevent env var errors
vi.mock("@/lib/firebase/config", () => ({ app: {} }))
vi.mock("@/lib/firebase/firestore", () => ({ db: {} }))

import {
  $layersState,
  createDefaultLayer,
  toggleGroupOffsetPhase,
  setLayerScale,
} from "@/stores/drawingStores"

describe("offset/scale store actions", () => {
  beforeEach(() => {
    const layer = createDefaultLayer(1)
    $layersState.set({ layers: [layer], activeLayerId: 1 })
  })

  it("toggleGroupOffsetPhase flips a group between normal and half", () => {
    const groupId = $layersState.get().layers[0].groups[0].id
    toggleGroupOffsetPhase(1, groupId)
    expect($layersState.get().layers[0].groups[0].offsetPhase).toBe("half")
    toggleGroupOffsetPhase(1, groupId)
    expect($layersState.get().layers[0].groups[0].offsetPhase).toBe("normal")
  })

  it("setLayerScale sets and clears a layer's scale", () => {
    setLayerScale(1, { num: 2, den: 1 })
    expect($layersState.get().layers[0].scale).toEqual({ num: 2, den: 1 })
    setLayerScale(1, undefined)
    expect($layersState.get().layers[0].scale).toBeUndefined()
  })
})
