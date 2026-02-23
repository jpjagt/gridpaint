/**
 * Import Drawing Dialog
 * 
 * Allows users to import a drawing by ID and add it to their collection
 */

import { useState } from 'react'
import { toast } from 'sonner'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase/firestore'
import type { InnerDrawingDocument } from '@/lib/storage/types'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface ImportDrawingDialogProps {
  isOpen: boolean
  onClose: () => void
  onImport: (drawingId: string) => void
}

export function ImportDrawingDialog({
  isOpen,
  onClose,
  onImport,
}: ImportDrawingDialogProps) {
  const [drawingId, setDrawingId] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const handleImport = async () => {
    if (!drawingId.trim()) {
      toast.error('Please enter a drawing ID')
      return
    }

    setIsLoading(true)
    try {
      // Check if drawing exists
      const drawingRef = doc(db, 'drawings', drawingId.trim())
      const drawingSnap = await getDoc(drawingRef)

      if (!drawingSnap.exists()) {
        toast.error('Drawing not found. Please check the ID and try again.')
        setIsLoading(false)
        return
      }

      const drawingData = drawingSnap.data() as InnerDrawingDocument
      
      toast.success(`Found drawing: "${drawingData.name}"`)
      onImport(drawingId.trim())
      onClose()
    } catch (error) {
      console.error('Error importing drawing:', error)
      toast.error('Failed to import drawing. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import Drawing</DialogTitle>
          <DialogDescription>
            Enter the ID of a drawing to import it into your collection. The
            drawing will be duplicated with a new ID.
          </DialogDescription>
        </DialogHeader>

        <Input
          type="text"
          value={drawingId}
          onChange={(e) => setDrawingId(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleImport()
          }}
          placeholder="e.g., 550e8400-e29b-41d4-a716-446655440000"
          className="font-mono text-sm"
          disabled={isLoading}
        />

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={isLoading}>
            {isLoading ? 'Importing...' : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
