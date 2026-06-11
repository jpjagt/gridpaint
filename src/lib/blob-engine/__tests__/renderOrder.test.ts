import { describe, it, expect } from "vitest"

// renderOrder = -id. Layers are sorted ascending by renderOrder, producing the
// composite array (same convention as the legacy `6 - id`). Ascending by -id
// means the highest id comes first in the array and the lowest id comes last;
// the renderer keeps the legacy stacking, so this ordering must match what
// `6 - id` produced for the 1..6 range.
function renderOrder(id: number): number {
  return -id
}

function sortByRenderOrder(ids: number[]): number[] {
  return [...ids].sort((a, b) => renderOrder(a) - renderOrder(b))
}

describe("layer render order", () => {
  it("orders by id descending across negative ids (highest id first)", () => {
    expect(sortByRenderOrder([3, -2, 0, 10, -5])).toEqual([10, 3, 0, -2, -5])
  })

  it("matches legacy `6 - id` ordering for the default 1..6 range", () => {
    const byNewFormula = sortByRenderOrder([1, 2, 3, 4, 5, 6])
    const byLegacyFormula = [1, 2, 3, 4, 5, 6].sort(
      (a, b) => 6 - a - (6 - b),
    )
    expect(byNewFormula).toEqual(byLegacyFormula)
    expect(byNewFormula).toEqual([6, 5, 4, 3, 2, 1])
  })
})
