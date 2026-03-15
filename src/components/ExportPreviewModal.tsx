/**
 * ExportPreviewModal — shows a preview of all export-rect shapes before downloading.
 *
 * For each export rect, displays:
 *  - Name + quantity (semibold)
 *  - One row per (rect × layer): SVG preview and DXF preview side by side
 */
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { Layer, CanvasViewState } from "@/stores/drawingStores"
import type { ExportRect } from "@/types/gridpaint"
import { buildSvgFiles } from "@/lib/export/exportRectsSvg"
import { buildDxfFiles } from "@/lib/export/exportRectsDxf"
import { DxfPreview } from "@/components/DxfPreview"
import { useMemo } from "react"

interface ExportPreviewModalProps {
  isOpen: boolean
  onClose: () => void
  exportRects: ExportRect[]
  layers: Layer[]
  canvasView: CanvasViewState
  drawingName: string
}

const PREVIEW_SIZE = 400

interface RectPreviewItem {
  rectId: string
  rectLabel: string
  quantity: number
  layers: {
    layerId: number
    svgContent: string
    dxfContent: string | null
  }[]
}

function SvgPreview({
  svgContent,
  size,
}: {
  svgContent: string
  size: number
}) {
  const dataUrl = useMemo(() => {
    const blob = new Blob([svgContent], { type: "image/svg+xml" })
    return URL.createObjectURL(blob)
  }, [svgContent])

  return (
    <img
      src={dataUrl}
      alt='SVG preview'
      width={size}
      height={size}
      style={{ width: size, height: size, objectFit: "contain", background: "#fff" }}
    />
  )
}

export function ExportPreviewModal({
  isOpen,
  onClose,
  exportRects,
  layers,
  canvasView,
  drawingName,
}: ExportPreviewModalProps) {
  const { gridSize, borderWidth, mmPerUnit } = canvasView

  const previewItems = useMemo<RectPreviewItem[]>(() => {
    if (!isOpen || exportRects.length === 0) return []

    const svgFiles = buildSvgFiles(
      exportRects,
      layers,
      gridSize,
      borderWidth,
      drawingName,
      mmPerUnit,
      { strokeColor: "#000", strokeWidth: 0.1, fillColor: "transparent", opacity: 1 },
    )

    const dxfFiles = buildDxfFiles(
      exportRects,
      layers,
      gridSize,
      borderWidth,
      drawingName,
      mmPerUnit,
    )

    return exportRects.map((rect, rectIdx) => {
      const rectLabel = rect.name ? rect.name : `rect${rectIdx + 1}`

      // Collect SVGs for this rect
      const svgsForRect = svgFiles.filter((f) =>
        f.filename.includes(` - ${rectLabel} - `),
      )

      // Collect DXFs for this rect
      const dxfsForRect = dxfFiles.filter((f) =>
        f.filename.includes(` - ${rectLabel} - `),
      )

      // Match by layer id extracted from filename
      const layerItems = svgsForRect.map((svgFile) => {
        const layerMatch = svgFile.filename.match(/layer-(\d+)/)
        const layerId = layerMatch ? parseInt(layerMatch[1], 10) : 0
        const dxfFile = dxfsForRect.find((d) =>
          d.filename.includes(`layer-${layerId}`),
        )
        return {
          layerId,
          svgContent: svgFile.content,
          dxfContent: dxfFile?.content ?? null,
        }
      })

      return {
        rectId: rect.id,
        rectLabel,
        quantity: rect.quantity,
        layers: layerItems,
      }
    })
  }, [
    isOpen,
    exportRects,
    layers,
    gridSize,
    borderWidth,
    drawingName,
    mmPerUnit,
  ])

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className='p-0 overflow-hidden flex flex-col'
        style={{
          maxWidth: "calc(100vw - 40px)",
          width: "calc(100vw - 40px)",
          maxHeight: "calc(100vh - 40px)",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
        }}
      >
        <DialogHeader className='px-6 py-4 border-b border-border shrink-0'>
          <DialogTitle className='font-mono text-sm'>
            Export Preview
          </DialogTitle>
        </DialogHeader>

        <div className='overflow-y-auto flex-1 px-6 py-4'>
          {previewItems.length === 0 ? (
            <p className='text-sm text-muted-foreground font-mono'>
              No export rects defined.
            </p>
          ) : (
            <div className='flex flex-col gap-8'>
              {previewItems.map((item) => (
                <div key={item.rectId}>
                  <p className='font-semibold text-sm mb-3'>
                    {item.rectLabel}
                    <span className='text-muted-foreground font-normal ml-2'>
                      ×{item.quantity}
                    </span>
                  </p>

                  {item.layers.map((layer) => (
                    <div key={layer.layerId} className='mb-4'>
                      <p className='text-xs text-muted-foreground font-mono mb-2'>
                        layer-{layer.layerId}
                      </p>
                      <div className='flex gap-4 flex-wrap'>
                        {/* SVG Preview */}
                        <div className='flex flex-col gap-1'>
                          <span className='text-xs text-muted-foreground font-mono'>
                            .svg
                          </span>
                          <div
                            className='border border-border'
                            style={{
                              width: PREVIEW_SIZE,
                              height: PREVIEW_SIZE,
                            }}
                          >
                            <SvgPreview
                              svgContent={layer.svgContent}
                              size={PREVIEW_SIZE}
                            />
                          </div>
                        </div>

                        {/* DXF Preview */}
                        <div className='flex flex-col gap-1'>
                          <span className='text-xs text-muted-foreground font-mono'>
                            .dxf
                          </span>
                          <div
                            className='border border-border'
                            style={{
                              width: PREVIEW_SIZE,
                              height: PREVIEW_SIZE,
                            }}
                          >
                            {layer.dxfContent ? (
                              <DxfPreview
                                dxfContent={layer.dxfContent}
                                width={PREVIEW_SIZE}
                                height={PREVIEW_SIZE}
                              />
                            ) : (
                              <div
                                style={{
                                  width: PREVIEW_SIZE,
                                  height: PREVIEW_SIZE,
                                }}
                                className='flex items-center justify-center text-xs text-muted-foreground font-mono bg-muted/20'
                              >
                                no DXF
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
