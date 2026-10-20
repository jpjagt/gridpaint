/**
 * Canvas overlay for the assembly rig tool: the rect being rigged, placed
 * and suggested pillars (with the layers they hold), and glue spots with
 * the overlap they must sit in.
 */

import type { CanvasViewState } from "@/stores/drawingStores"
import type { ExportRect } from "@/types/gridpaint"
import type { GlueSpotInfo, PillarInfo, Region, RigAnalysis, RigToolMode } from "@/types/rig"

const COLORS = {
  rect: "rgba(96, 165, 250, 0.8)",
  pillar: "rgba(234, 179, 8, 0.85)",
  loose: "rgba(249, 115, 22, 0.9)",
  pillarStroke: "rgba(133, 77, 14, 0.95)",
  suggestion: "rgba(234, 179, 8, 0.28)",
  overlap: "rgba(34, 197, 94, 0.22)",
  spot: "rgba(22, 163, 74, 0.95)",
  tight: "rgba(249, 115, 22, 0.95)",
  uncovered: "rgba(239, 68, 68, 0.95)",
  label: "rgba(30, 30, 30, 0.95)",
}

interface OverlayOptions {
  analysis: RigAnalysis | null
  rect: ExportRect
  mode: RigToolMode
  activeLayerId: number | null
  canvasView: CanvasViewState
}

export function renderRigOverlay(
  ctx: CanvasRenderingContext2D,
  { analysis, rect, mode, activeLayerId, canvasView }: OverlayOptions,
): void {
  const { gridSize, zoom, panOffset } = canvasView
  ctx.save()
  ctx.translate(panOffset.x, panOffset.y)
  ctx.scale(zoom, zoom)
  const px = 1 / zoom

  // The rect (pillars may also sit just outside it)
  ctx.setLineDash([6 * px, 4 * px])
  ctx.strokeStyle = COLORS.rect
  ctx.lineWidth = 1.5 * px
  ctx.strokeRect(
    rect.minX * gridSize,
    rect.minY * gridSize,
    (rect.maxX - rect.minX + 1) * gridSize,
    (rect.maxY - rect.minY + 1) * gridSize,
  )
  ctx.setLineDash([])

  if (analysis && analysis.rectId === rect.id) {
    const m = analysis.mmPerUnit
    // mm (SVG frame, point centred at its coordinate) → world px
    const toWorld = (v: number) => (v / m + 0.5) * gridSize
    const tracePath = (region: Region) => {
      ctx.beginPath()
      for (const ring of region) {
        ring.forEach((p, i) =>
          i === 0
            ? ctx.moveTo(toWorld(p.x), toWorld(p.y))
            : ctx.lineTo(toWorld(p.x), toWorld(p.y)),
        )
        ctx.closePath()
      }
    }

    const drawPillar = (p: PillarInfo, placed: boolean) => {
      const base = p.sections[0]
      if (!base) return
      tracePath(base)
      ctx.fillStyle = placed ? COLORS.pillar : COLORS.suggestion
      ctx.fill("nonzero")
      ctx.strokeStyle = COLORS.pillarStroke
      ctx.lineWidth = (placed ? 1.5 : 1) * px
      if (!placed) ctx.setLineDash([4 * px, 3 * px])
      ctx.stroke()
      ctx.setLineDash([])
      // Top step, to show how far the pillar steps back as it rises
      const top = p.sections[p.sections.length - 1]
      if (placed && top && p.sections.length > 1) {
        tracePath(top)
        ctx.lineWidth = 1 * px
        ctx.stroke()
      }
      // Layers held, in assembly order
      const label = p.touches.length > 0 ? p.touches.join("·") : "–"
      ctx.font = `${Math.max(9 * px, gridSize * 0.24)}px ui-monospace, monospace`
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.fillStyle = COLORS.label
      ctx.fillText(label, (p.x + 0.5) * gridSize, (p.y + 0.5) * gridSize)
    }

    const drawSpot = (s: GlueSpotInfo, faint = false) => {
      const r = Math.max((s.diameter / 2 / m) * gridSize, 3 * px)
      const cx = (s.x + 0.5) * gridSize
      const cy = (s.y + 0.5) * gridSize
      const color =
        s.issue === "uncovered"
          ? COLORS.uncovered
          : s.issue === "tight"
            ? COLORS.tight
            : COLORS.spot
      ctx.globalAlpha = faint ? 0.3 : 1
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      if (s.placed) {
        ctx.fillStyle = color
        ctx.fill()
      } else {
        ctx.setLineDash([3 * px, 2 * px])
        ctx.strokeStyle = color
        ctx.lineWidth = 1.5 * px
        ctx.stroke()
        ctx.setLineDash([])
      }
      if (s.placed && s.issue === "uncovered" && !faint) {
        // Ring to make bad spots impossible to miss
        ctx.beginPath()
        ctx.arc(cx, cy, r + 4 * px, 0, Math.PI * 2)
        ctx.strokeStyle = COLORS.uncovered
        ctx.lineWidth = 2 * px
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }

    if (mode === "pillars") {
      // Pieces that can still shift: dashed orange outline
      ctx.setLineDash([5 * px, 3 * px])
      ctx.strokeStyle = COLORS.loose
      ctx.lineWidth = 2 * px
      for (const piece of analysis.loosePieces) {
        tracePath(piece.footprint)
        ctx.stroke()
      }
      ctx.setLineDash([])
      for (const p of analysis.suggestedPillars) drawPillar(p, false)
      for (const p of analysis.pillars) drawPillar(p, true)
    } else {
      const iface = analysis.interfaces.find((i) => i.layerId === activeLayerId)
      if (iface) {
        tracePath(iface.overlap)
        ctx.fillStyle = COLORS.overlap
        ctx.fill("nonzero")
      }
      for (const s of analysis.suggestedGlueSpots)
        if (s.layerId === activeLayerId) drawSpot(s)
      for (const s of analysis.glueSpots) drawSpot(s, s.layerId !== activeLayerId)
    }

  }

  ctx.restore()
}
