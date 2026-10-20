import { useCallback, useEffect, useRef, useState } from "react"
import { drawingStore } from "@/lib/storage/store"
import type { DrawingMetadata } from "@/lib/storage/types"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Plus, Trash2, Download, User, Footprints } from "lucide-react"
import { ImportDrawingDialog } from "@/components/ImportDrawingDialog"
import { PassphraseSetupModal } from "@/components/PassphraseSetupModal"
import { useStore } from "@nanostores/react"
import { $authState } from "@/stores/authStores"
import { enableCloudSync, forceSyncNow } from "@/lib/storage/storage-manager"
import { toast } from "sonner"

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
/**
 * How long the merged (cloud) list may take before the local list is shown
 * on its own. Showing local first means a visible reorder when cloud lands.
 */
const CLOUD_LIST_GRACE_MS = 1200

/** Parallel full-doc fetches when backfilling cloud-only thumbnails. */
const THUMBNAIL_FETCH_CONCURRENCY = 3

export default function Home() {
  const [drawings, setDrawings] = useState<DrawingMetadata[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [deleteDialogId, setDeleteDialogId] = useState<string | null>(null)
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [showPassphraseModal, setShowPassphraseModal] = useState(false)
  const authState = useStore($authState)

  const [isCloudLoading, setIsCloudLoading] = useState(false)
  // Bumped on every refresh and on unmount; async work from an older
  // generation must not touch state.
  const loadGenRef = useRef(0)

  // Two-phase load: local metadata first (instant), then the merged
  // local+cloud list, then lazily fetch thumbnails for cloud-only drawings.
  const refreshDrawings = useCallback(async () => {
    const gen = ++loadGenRef.current
    const isCurrent = () => loadGenRef.current === gen
    const sortDesc = (list: DrawingMetadata[]) =>
      [...list].sort((a, b) => b.updatedAt - a.updatedAt)

    // Start the merged (local + cloud) list right away, and give it a short
    // head start: when it lands in time, it's the first thing shown and the
    // grid never reorders. Only a slow cloud gets the local list shown first.
    setIsCloudLoading(true)
    const mergedPromise = drawingStore.list().finally(() => {
      if (isCurrent()) setIsCloudLoading(false)
    })

    let local: DrawingMetadata[] = []
    let localIds = new Set<string>()
    if (drawingStore.listLocal) {
      try {
        local = await drawingStore.listLocal()
        if (!isCurrent()) return
        localIds = new Set(local.map((d) => d.id))
        const mergedInTime = await Promise.race([
          mergedPromise.then(
            () => true,
            () => true,
          ),
          new Promise<false>((r) => setTimeout(() => r(false), CLOUD_LIST_GRACE_MS)),
        ])
        if (!isCurrent()) return
        if (!mergedInTime) {
          setDrawings(sortDesc(local))
          setIsLoading(false)
        }
      } catch (error) {
        console.error("Failed to list local drawings:", error)
      }
    }

    let merged: DrawingMetadata[]
    try {
      merged = await mergedPromise
    } catch (error) {
      console.error("Failed to list drawings:", error)
      merged = local
    }
    if (!isCurrent()) return
    setDrawings(sortDesc(merged))
    setIsLoading(false)

    // Cloud-only drawings have no thumbnail in the list; fetch the full docs
    // in the background (get() also caches them locally for next time).
    const missing = merged
      .filter((d) => !d.thumbnail && !localIds.has(d.id))
      .map((d) => d.id)
    let next = 0
    const worker = async () => {
      while (next < missing.length && isCurrent()) {
        const id = missing[next++]
        try {
          const full = await drawingStore.get(id)
          const thumbnail = full?.thumbnail
          if (!thumbnail || !isCurrent()) continue
          setDrawings((prev) =>
            prev.map((d) => (d.id === id ? { ...d, thumbnail } : d)),
          )
        } catch (error) {
          console.warn("Failed to fetch thumbnail for", id, error)
        }
      }
    }
    // Not awaited: callers (e.g. import) shouldn't wait on thumbnails.
    void Promise.all(
      Array.from(
        { length: Math.min(THUMBNAIL_FETCH_CONCURRENCY, missing.length) },
        worker,
      ),
    )
  }, [])

  useEffect(() => {
    let mounted = true
    setIsLoading(true)
    refreshDrawings()
      .catch((error) => console.error("Failed to load drawings:", error))
      .finally(() => {
        if (mounted) setIsLoading(false)
      })
    return () => {
      mounted = false
      // Invalidate in-flight loads so nothing sets state after unmount.
      loadGenRef.current++
    }
  }, [refreshDrawings])

  const createNew = () => {
    const id = crypto.randomUUID?.() ?? Math.random().toString(36).substr(2, 9)
    window.location.hash = `/grids/${id}`
  }

  const handleDelete = async (id: string) => {
    await drawingStore.delete(id)
    setDrawings(drawings.filter((d) => d.id !== id))
    setDeleteDialogId(null)
  }

  const handleImport = async (drawingId: string) => {
    try {
      // Get the drawing from Firestore
      const drawing = await drawingStore.get(drawingId)
      if (!drawing) {
        toast.error("Drawing not found")
        return
      }

      // Create a new ID for the duplicate
      const newId =
        crypto.randomUUID?.() ?? Math.random().toString(36).substr(2, 9)
      const newDrawing = {
        ...drawing,
        id: newId,
        name: `${drawing.name} (imported)`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      // Save the duplicate
      await drawingStore.save(newDrawing)

      // Reload drawings list (sorted)
      await refreshDrawings()

      toast.success("Drawing imported successfully!")

      // Navigate to the new drawing
      window.location.hash = `/grids/${newId}`
    } catch (error) {
      console.error("Error importing drawing:", error)
      toast.error("Failed to import drawing")
    }
  }

  return (
    <div className='p-8'>
      <div className='flex items-center justify-between mb-6'>
        <h1 className='text-2xl font-medium'>
          your grids
          {isCloudLoading && !isLoading && (
            <span className='ml-3 text-sm font-normal text-muted-foreground animate-pulse'>
              syncing…
            </span>
          )}
        </h1>
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
            onClick={() => {
              window.location.hash = "#/runner"
            }}
            variant='outline'
            className='flex items-center'
            title='Run through an endless generated landscape'
          >
            <Footprints className='mr-2 w-4 h-4' /> runner
          </Button>
          <Button
            onClick={() => setShowPassphraseModal(true)}
            variant='outline'
            className='flex items-center'
            title={
              authState.isAuthenticated
                ? "Change passphrase"
                : "Set passphrase for cloud sync"
            }
          >
            <User className='mr-2 w-4 h-4' />
            {authState.isAuthenticated ? "account" : "login"}
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
                <div className='aspect-[16/9] p-4'>
                  <Skeleton className='w-full h-full rounded' />
                </div>
                <div className='p-3 border-t border-border space-y-2'>
                  <Skeleton className='h-4 w-3/4' />
                  <Skeleton className='h-3 w-1/2' />
                </div>
              </div>
            ))
          : drawings.map((drawing) => {
              return (
                <div
                  key={drawing.id}
                  className='group relative bg-card rounded-lg border border-border shadow-sm hover:shadow-md transition-shadow'
                >
                  {/* Preview */}
                  <div className='aspect-[16/9] p-4'>
                    {drawing.thumbnail ? (
                      <img
                        src={drawing.thumbnail}
                        alt={`Preview of ${drawing.name}`}
                        loading='lazy'
                        decoding='async'
                        className='w-full h-full object-contain bg-muted rounded border border-border'
                      />
                    ) : (
                      <div className='w-full h-full rounded border border-border bg-muted flex items-center justify-center text-xs text-muted-foreground'>
                        no preview
                      </div>
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
                    type='button'
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
      <AlertDialog
        open={deleteDialogId !== null}
        onOpenChange={(open) => !open && setDeleteDialogId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>delete grid</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "
              {drawings.find((d) => d.id === deleteDialogId)?.name}"? This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteDialogId && handleDelete(deleteDialogId)}
              className={buttonVariants({ variant: "destructive" })}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
            toast.info("Syncing drawings to cloud...")
            await forceSyncNow()
            toast.success("Drawings synced successfully!")
          } catch (error) {
            console.error("Failed to sync drawings:", error)
            toast.error("Failed to sync some drawings")
          }

          // Reload drawings to include cloud drawings
          await refreshDrawings()
        }}
      />
    </div>
  )
}
