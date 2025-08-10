import React, { useEffect, useState } from "react"
import { drawingStore } from "@/lib/storage/store"
import type { DrawingMetadata, DrawingDocument } from "@/lib/storage/types"
import { Button } from "@/components/ui/button"
import { Plus, Trash2 } from "lucide-react"

// Generate a simple preview thumbnail from drawing data
function generatePreview(drawing: DrawingDocument): string {
  const size = 120
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext("2d")!

  // Background
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, size, size)

  // Find bounds of all points
  const allPoints = drawing.layers
    .filter((layer) => layer.isVisible)
    .flatMap((layer) => Array.from(layer.points))

  if (allPoints.length === 0) {
    // Empty drawing - show grid pattern
    ctx.strokeStyle = "#f0f0f0"
    ctx.lineWidth = 1
    const gridSpacing = size / 8
    for (let i = 0; i <= 8; i++) {
      const pos = i * gridSpacing
      ctx.beginPath()
      ctx.moveTo(pos, 0)
      ctx.lineTo(pos, size)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(0, pos)
      ctx.lineTo(size, pos)
      ctx.stroke()
    }
    return canvas.toDataURL()
  }

  const coords = allPoints.map((point) => {
    const [x, y] = point.split(",").map(Number)
    return { x, y }
  })

  const minX = Math.min(...coords.map((c) => c.x))
  const maxX = Math.max(...coords.map((c) => c.x))
  const minY = Math.min(...coords.map((c) => c.y))
  const maxY = Math.max(...coords.map((c) => c.y))

  const rangeX = maxX - minX || 1
  const rangeY = maxY - minY || 1
  const padding = 10
  const scale = (size - padding * 2) / Math.max(rangeX, rangeY)

  // Draw points
  ctx.fillStyle = "#000000"
  coords.forEach(({ x, y }) => {
    const pixelX = padding + (x - minX) * scale
    const pixelY = padding + (y - minY) * scale
    ctx.fillRect(
      pixelX,
      pixelY,
      Math.max(1, scale * 0.8),
      Math.max(1, scale * 0.8),
    )
  })

  return canvas.toDataURL()
}

/**
 * Home
 *
 * Displays a gallery of saved drawings
 *
 * Primary responsibilities:
 * - List saved drawings with preview cards
 * - Provide a way to create a new drawing
 * - Allow deleting existing drawings
 */
export default function Home() {
  const [drawings, setDrawings] = useState<DrawingMetadata[]>([])
  const [fullDrawings, setFullDrawings] = useState<DrawingDocument[]>([])
  const [deleteDialogId, setDeleteDialogId] = useState<string | null>(null)

  useEffect(() => {
    async function loadDrawings() {
      const metadata = await drawingStore.list()
      setDrawings(metadata)

      // Load full drawing documents for previews
      const fullDocs = await Promise.all(
        metadata.map(async (meta) => {
          const doc = await drawingStore.get(meta.id)
          return doc
        }),
      )
      setFullDrawings(fullDocs.filter(Boolean) as DrawingDocument[])
    }
    loadDrawings()
  }, [])

  const createNew = () => {
    const id = crypto.randomUUID?.() ?? Math.random().toString(36).substr(2, 9)
    window.location.hash = `/grids/${id}`
  }

  const handleDelete = async (id: string) => {
    await drawingStore.delete(id)
    setDrawings(drawings.filter((d) => d.id !== id))
    setFullDrawings(fullDrawings.filter((d) => d.id !== id))
    setDeleteDialogId(null)
  }

  return (
    <div className='p-8'>
      <div className='flex items-center justify-between mb-6'>
        <h1 className='text-2xl font-medium'>your grids</h1>
        <Button onClick={createNew} className='flex items-center'>
          <Plus className='mr-2 w-4 h-4' /> new grid
        </Button>
      </div>

      <div className='grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4'>
        {drawings.map((drawing) => {
          const fullDrawing = fullDrawings.find((fd) => fd.id === drawing.id)
          return (
            <div
              key={drawing.id}
              className='group relative bg-white rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow'
            >
              {/* Preview */}
              <div className='aspect-square p-4'>
                {fullDrawing ? (
                  <img
                    src={generatePreview(fullDrawing)}
                    alt={`Preview of ${drawing.name}`}
                    className='w-full h-full object-contain bg-gray-50 rounded border'
                  />
                ) : (
                  <div className='w-full h-full bg-gray-100 rounded border flex items-center justify-center'>
                    <span className='text-gray-400 text-sm'>Loading...</span>
                  </div>
                )}
              </div>

              {/* Title and metadata */}
              <div className='p-3 border-t border-gray-100'>
                <a
                  href={`#/drawings/${drawing.id}`}
                  className='block font-medium text-gray-900 hover:underline transition-colors mb-1'
                >
                  {drawing.name}
                </a>
                <p className='text-sm text-gray-500'>
                  {new Date(drawing.updatedAt).toLocaleString()}
                </p>
              </div>

              {/* Delete button */}
              <button
                onClick={(e) => {
                  e.preventDefault()
                  setDeleteDialogId(drawing.id)
                }}
                className='absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-2 bg-white rounded-full shadow-sm hover:shadow-md border border-gray-200 hover:bg-red-50 hover:border-red-200'
                title='delete grid'
              >
                <Trash2 className='w-4 h-4 text-gray-600 hover:text-red-600' />
              </button>
            </div>
          )
        })}
      </div>

      {drawings.length === 0 && (
        <div className='text-center py-12'>
          <p className='text-gray-500 mb-4'>No grids yet</p>
          <Button onClick={createNew} variant='outline'>
            <Plus className='mr-2 w-4 h-4' /> Create your first grid
          </Button>
        </div>
      )}

      {/* Delete confirmation dialog */}
      {deleteDialogId && (
        <div className='fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50'>
          <div className='bg-white rounded-lg p-6 max-w-sm mx-4'>
            <h3 className='text-lg font-semibold mb-3'>delete grid</h3>
            <p className='text-gray-600 mb-4'>
              Are you sure you want to delete "
              {drawings.find((d) => d.id === deleteDialogId)?.name}"? This
              action cannot be undone.
            </p>
            <div className='flex gap-3 justify-end'>
              <Button variant='outline' onClick={() => setDeleteDialogId(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => handleDelete(deleteDialogId)}
                className='bg-red-600 hover:bg-red-700'
              >
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
