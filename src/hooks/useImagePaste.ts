import { useEffect } from 'react'
import { useStore } from '@nanostores/react'
import { $canvasView } from '@/stores/drawingStores'
import {
  $imageImport,
  setImageImportActive,
  setImageSource,
  setTransform,
  resetImageImport,
} from '@/stores/imageImport'

async function imageBitmapFromBlob(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(blob)
    } catch (_) {
      // Fallback below
    }
  }
  return await new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = URL.createObjectURL(blob)
  })
}

export function useImagePaste() {
  const canvasView = useStore($canvasView)
  const imageImport = useStore($imageImport)

  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      // If overlay already active, allow replacing the image
      const items = e.clipboardData?.items
      if (!items) return
      const imgItem = Array.from(items).find(i => i.type.startsWith('image/'))
      if (!imgItem) return
      e.preventDefault()

      try {
        const blob = imgItem.getAsFile()
        if (!blob) return
        const bitmap = await imageBitmapFromBlob(blob)
        const size = ('width' in bitmap && 'height' in bitmap)
          ? { width: (bitmap as ImageBitmap).width, height: (bitmap as ImageBitmap).height }
          : { width: (bitmap as HTMLImageElement).naturalWidth, height: (bitmap as HTMLImageElement).naturalHeight }

        setImageSource(bitmap, size)
        setImageImportActive(true)

        // Center on current viewport center
        const viewportCenterX = window.innerWidth / 2
        const viewportCenterY = window.innerHeight / 2
        const { panOffset, zoom, gridSize } = canvasView
        const worldX = (viewportCenterX - panOffset.x) / (zoom * gridSize)
        const worldY = (viewportCenterY - panOffset.y) / (zoom * gridSize)

        // Initial scale so image width ~ 60% of viewport width in grid units
        const targetWorldWidth = (window.innerWidth * 0.6) / gridSize / zoom
        const scale = Math.max(0.01, targetWorldWidth / size.width)

        // Use center-of-cell coordinates (add 0.5) so image aligns with cell centers
        setTransform({ cx: worldX + 0.5, cy: worldY + 0.5, scale, rotationDeg: 0 })
      } catch (err) {
        console.error('Failed to handle pasted image', err)
        resetImageImport()
      }
    }

    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [canvasView, imageImport.isActive])
}
