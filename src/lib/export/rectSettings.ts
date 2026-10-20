/**
 * Per-export-rect overrides of drawing-wide physical settings. A rect value
 * of undefined/0 means "use the drawing's global value".
 */

import type { ExportRect } from "@/types/gridpaint"

export function resolveRectMmPerUnit(
  rect: Pick<ExportRect, "customMmPerUnit">,
  globalMmPerUnit: number,
): number {
  return rect.customMmPerUnit && rect.customMmPerUnit > 0
    ? rect.customMmPerUnit
    : globalMmPerUnit
}

export function resolveRectThickness(
  rect: Pick<ExportRect, "customThickness">,
  globalThickness: number,
): number {
  return rect.customThickness && rect.customThickness > 0
    ? rect.customThickness
    : globalThickness
}
