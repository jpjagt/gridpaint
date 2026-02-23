import React, { useEffect, useState } from "react"
import { drawingStore } from "@/lib/storage/store"
import type { DrawingMetadata, DrawingDocument } from "@/lib/storage/types"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Plus, Trash2, Download, User } from "lucide-react"
import { ImportDrawingDialog } from "@/components/ImportDrawingDialog"
import { PassphraseSetupModal } from "@/components/PassphraseSetupModal"
import { useStore } from "@nanostores/react"
import { $authState } from "@/stores/authStores"
import { enableCloudSync, forceSyncNow } from "@/lib/storage/storage-manager"
import { toast } from "sonner"

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
  const allPoints: string[] = drawing.layers
    .filter((layer) => layer.isVisible)
    .flatMap((layer) => {
      const pts: string[] = []
      for (const group of layer.groups) {
        for (const p of group.points) pts.push(p)
      }
      return pts
    })

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
  const [isLoading, setIsLoading] = useState(true)
  const [deleteDialogId, setDeleteDialogId] = useState<string | null>(null)
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [showPassphraseModal, setShowPassphraseModal] = useState(false)
  const authState = useStore($authState)

  useEffect(() => {
    async function loadDrawings() {
      setIsLoading(true)
      const metadata = await drawingStore.list()
      // Sort by last modified descending
      const sorted = [...metadata].sort((a, b) => b.updatedAt - a.updatedAt)
      setDrawings(sorted)

      // Load full drawing documents for previews
      const fullDocs = await Promise.all(
        sorted.map(async (meta) => {
          const doc = await drawingStore.get(meta.id)
          return doc
        }),
      )
      setFullDrawings(fullDocs.filter(Boolean) as DrawingDocument[])
      setIsLoading(false)
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

  const handleImport = async (drawingId: string) => {
    try {
      // Get the drawing from Firestore
      const drawing = await drawingStore.get(drawingId)
      if (!drawing) {
        toast.error('Drawing not found')
        return
      }

      // Create a new ID for the duplicate
      const newId = crypto.randomUUID?.() ?? Math.random().toString(36).substr(2, 9)
      const newDrawing = {
        ...drawing,
        id: newId,
        name: `${drawing.name} (imported)`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      // Save the duplicate
      await drawingStore.save(newDrawing)
      
      // Reload drawings list
      const metadata = await drawingStore.list()
      setDrawings(metadata)
      
      toast.success('Drawing imported successfully!')
      
      // Navigate to the new drawing
      window.location.hash = `/grids/${newId}`
    } catch (error) {
      console.error('Error importing drawing:', error)
      toast.error('Failed to import drawing')
    }
  }

  return (
    <div className='p-8'>
      <div className='flex items-center justify-between mb-6'>
        <h1 className='text-2xl font-medium'>your grids</h1>
        <div className='flex gap-2'>
          {authState.isAuthenticated && (
            <Button 
              onClick={() => setShowImportDialog(true)} 
              variant='outline'
              className='flex items-center'
            >
              <Download className='mr-2 w-4 h-4' /> import
            </Button>
          )}
          <Button 
            onClick={() => setShowPassphraseModal(true)}
            variant='outline'
            className='flex items-center'
            title={authState.isAuthenticated ? 'Change passphrase' : 'Set passphrase for cloud sync'}
          >
            <User className='mr-2 w-4 h-4' />
            {authState.isAuthenticated ? 'account' : 'login'}
          </Button>
          <Button onClick={createNew} className='flex items-center'>
            <Plus className='mr-2 w-4 h-4' /> new grid
          </Button>
        </div>
      </div>

      <div className='grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4'>
        {isLoading
          ? Array.from({ length: 8 }, (_, i) => `skeleton-${i}`).map((key) => (
              <div
                key={key}
                className='rounded-lg border border-border bg-card shadow-sm'
              >
                <div className='aspect-square p-4'>
                  <Skeleton className='w-full h-full rounded' />
                </div>
                <div className='p-3 border-t border-border space-y-2'>
                  <Skeleton className='h-4 w-3/4' />
                  <Skeleton className='h-3 w-1/2' />
                </div>
              </div>
            ))
          : drawings.map((drawing) => {
              const fullDrawing = fullDrawings.find((fd) => fd.id === drawing.id)
              return (
                <div
                  key={drawing.id}
                  className='group relative bg-card rounded-lg border border-border shadow-sm hover:shadow-md transition-shadow'
                >
                  {/* Preview */}
                  <div className='aspect-square p-4'>
                    {fullDrawing ? (
                      <img
                        src={generatePreview(fullDrawing)}
                        alt={`Preview of ${drawing.name}`}
                        className='w-full h-full object-contain bg-muted rounded border border-border'
                      />
                    ) : (
                      <Skeleton className='w-full h-full rounded' />
                    )}
                  </div>

                  {/* Title and metadata */}
                  <div className='p-3 border-t border-border'>
                    <a
                      href={`#/grids/${drawing.id}`}
                      className='block font-medium text-card-foreground hover:underline transition-colors mb-1'
                    >
                      {drawing.name}
                    </a>
                    <p className='text-sm text-muted-foreground'>
                      {new Date(drawing.updatedAt).toLocaleString()}
                    </p>
                  </div>

                  {/* Delete button */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault()
                      setDeleteDialogId(drawing.id)
                    }}
                    className='absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-2 bg-card rounded-full shadow-sm hover:shadow-md border border-border hover:bg-destructive/10 hover:border-destructive/30'
                    title='delete grid'
                  >
                    <Trash2 className='w-4 h-4 text-muted-foreground hover:text-destructive' />
                  </button>
                </div>
              )
            })}
      </div>

      {!isLoading && drawings.length === 0 && (
        <div className='text-center py-12'>
          <p className='text-muted-foreground mb-4'>No grids yet</p>
          <Button onClick={createNew} variant='outline'>
            <Plus className='mr-2 w-4 h-4' /> Create your first grid
          </Button>
        </div>
      )}

      {/* Delete confirmation dialog */}
      {deleteDialogId && (
        <div className='fixed inset-0 bg-black/50 flex items-center justify-center z-50'>
          <div className='bg-card text-card-foreground rounded-lg p-6 max-w-sm mx-4 border border-border'>
            <h3 className='text-lg font-semibold mb-3'>delete grid</h3>
            <p className='text-muted-foreground mb-4'>
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

      {/* Import drawing dialog */}
      <ImportDrawingDialog
        isOpen={showImportDialog}
        onClose={() => setShowImportDialog(false)}
        onImport={handleImport}
      />

      {/* Passphrase setup modal */}
      <PassphraseSetupModal
        isOpen={showPassphraseModal}
        onClose={() => setShowPassphraseModal(false)}
        onSuccess={async (result) => {
          enableCloudSync(result.userId, result.writeToken)
          setShowPassphraseModal(false)
          
          // Sync existing LocalStorage drawings to cloud
          try {
            toast.info('Syncing drawings to cloud...')
            await forceSyncNow()
            toast.success('Drawings synced successfully!')
          } catch (error) {
            console.error('Failed to sync drawings:', error)
            toast.error('Failed to sync some drawings')
          }
          
          // Reload drawings to include cloud drawings
          drawingStore.list().then(setDrawings)
        }}
      />
    </div>
  )
}
