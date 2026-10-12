import { useEffect, useRef, useState } from "react"
import { renderDesignToCanvas, renderedSize } from "@/lib/lab/renderDesign"
import type { LabDesign, LabPalette } from "@/types/lab"

interface DesignCanvasProps {
  design: LabDesign
  palette: LabPalette
  /** Fit into a fixed box (CSS px); otherwise use cellPx. */
  fit?: { width: number; height: number }
  cellPx?: number
  padding?: number
  layerIds?: number[]
  frameIndex?: number
  /** Only render once scrolled into view. */
  lazy?: boolean
  className?: string
}

/** Canvas rendering of a gridlab design (blob engine). */
export function DesignCanvas({
  design,
  palette,
  fit,
  cellPx,
  padding = 8,
  layerIds,
  frameIndex,
  lazy = false,
  className,
}: DesignCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(!lazy)

  useEffect(() => {
    if (!lazy || visible) return
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true)
          io.disconnect()
        }
      },
      { rootMargin: "400px" },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [lazy, visible])

  const fitW = fit?.width
  const fitH = fit?.height
  const layerKey = layerIds?.join(",")

  useEffect(() => {
    const el = ref.current
    if (!el || !visible) return
    renderDesignToCanvas(el, design, {
      fit: fitW !== undefined && fitH !== undefined ? { width: fitW, height: fitH } : undefined,
      cellPx,
      padding,
      layerIds: layerKey !== undefined ? layerKey.split(",").filter(Boolean).map(Number) : undefined,
      frameIndex,
      palette,
    })
  }, [visible, design, palette, fitW, fitH, cellPx, padding, layerKey, frameIndex])

  // Reserve the size before the first render so the layout does not jump.
  const size = renderedSize(design, { fit, cellPx, padding })
  return (
    <canvas
      ref={ref}
      className={className}
      style={{ width: size.width, height: size.height, background: palette.background }}
    />
  )
}
