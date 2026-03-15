/**
 * DxfPreview — renders DXF content in a fixed-size canvas using dxf-viewer (WebGL/Three.js).
 * Accepts the DXF as a raw string; creates a temporary Blob URL internally.
 */
import { useEffect, useRef, useState } from "react"

interface DxfPreviewProps {
  dxfContent: string
  width?: number
  height?: number
  className?: string
}

export function DxfPreview({
  dxfContent,
  width = 400,
  height = 400,
  className,
}: DxfPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const viewerRef = useRef<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!containerRef.current) return

    const container = containerRef.current
    setError(null)
    setLoading(true)

    let cancelled = false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let viewer: any = null

    const blob = new Blob([dxfContent], { type: "application/dxf" })
    const blobUrl = URL.createObjectURL(blob)

    import("dxf-viewer")
      .then(({ DxfViewer }) => {
        if (cancelled) return

        try {
          viewer = new DxfViewer(container, {
            canvasWidth: width,
            canvasHeight: height,
            autoResize: false,
            blackWhiteInversion: false,
          })
          viewerRef.current = viewer
        } catch (e) {
          console.error("DxfPreview: failed to create viewer", e)
          setError("WebGL unavailable")
          setLoading(false)
          return
        }

        return viewer.Load({ url: blobUrl })
      })
      .then(() => {
        if (!cancelled) setLoading(false)
      })
      .catch((err: unknown) => {
        console.error("DxfPreview: failed to load DXF", err)
        if (!cancelled) {
          setError("Failed to render DXF")
          setLoading(false)
        }
      })
      .finally(() => {
        URL.revokeObjectURL(blobUrl)
      })

    return () => {
      cancelled = true
      // blobUrl is revoked in the .finally() handler above
      try {
        viewer?.Destroy()
      } catch (_) {
        // ignore cleanup errors
      }
      viewerRef.current = null
      // Destroy() does not remove the canvas from the DOM; clear it manually
      // so the next effect run starts with an empty container.
      while (container.firstChild) {
        container.removeChild(container.firstChild)
      }
    }
    // Re-run when content or size changes
  }, [dxfContent, width, height])

  return (
    <div
      style={{ width, height, position: "relative", overflow: "hidden" }}
      className={className}
    >
      <div ref={containerRef} style={{ width, height }} />
      {loading && !error && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          className='text-xs text-muted-foreground font-mono'
        >
          loading…
        </div>
      )}
      {error && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          className='text-xs text-destructive font-mono'
        >
          {error}
        </div>
      )}
    </div>
  )
}
