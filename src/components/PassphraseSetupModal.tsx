/**
 * Passphrase Setup Modal
 * 
 * Handles user login/signup with passphrase
 * Shows collision detection and drawing count for existing users
 */

import { useState } from 'react'
import { toast } from 'sonner'
import { loginWithPassphrase } from '@/lib/auth/user-manager'
import { setAuthState } from '@/stores/authStores'
import type { LoginResult } from '@/types/auth'
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

interface PassphraseSetupModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (result: LoginResult) => void
}

export function PassphraseSetupModal({
  isOpen,
  onClose,
  onSuccess,
}: PassphraseSetupModalProps) {
  const [passphrase, setPassphrase] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [loginResult, setLoginResult] = useState<LoginResult | null>(null)

  const handleCheckPassphrase = async () => {
    if (!passphrase.trim()) {
      toast.error('Please enter a passphrase')
      return
    }

    setIsLoading(true)
    try {
      const result = await loginWithPassphrase(passphrase)
      setLoginResult(result)
      
      if (result.type === 'new-user') {
        toast.success('New account created!')
      }
    } catch (error) {
      console.error('Error checking passphrase:', error)
      toast.error('Failed to check passphrase. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleConfirm = () => {
    if (!loginResult) return

    // Update auth state
    setAuthState({
      isAuthenticated: true,
      userId: loginResult.userId,
      writeToken: loginResult.writeToken,
      passphrase,
    })

    toast.success(
      loginResult.type === 'new-user'
        ? 'Welcome! Your drawings will now sync across devices.'
        : `Welcome back! Found ${loginResult.drawingCount} drawings.`
    )

    onSuccess(loginResult)
    onClose()
  }

  const handleCancel = () => {
    setLoginResult(null)
    setPassphrase('')
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {loginResult ? 'Confirm Login' : 'Enter Passphrase'}
          </DialogTitle>
          <DialogDescription>
            {!loginResult ? (
              'Enter a passphrase to sync your drawings across devices. This can be any text you\'ll remember.'
            ) : loginResult.type === 'existing-user' ? (
              <>
                Found <strong>{loginResult.drawingCount} drawings</strong> for
                this passphrase. Is this you? If not, please choose a different passphrase.
              </>
            ) : (
              'This passphrase is available! Your drawings will be synced to this account.'
            )}
          </DialogDescription>
        </DialogHeader>

        {!loginResult ? (
          <>
            <Input
              type="text"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCheckPassphrase()
              }}
              placeholder="e.g., my-secret-phrase"
              disabled={isLoading}
            />

            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={isLoading}>
                Cancel
              </Button>
              <Button onClick={handleCheckPassphrase} disabled={isLoading}>
                {isLoading ? 'Checking...' : 'Continue'}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleCancel}
            >
              {loginResult.type === 'existing-user'
                ? 'No, different passphrase'
                : 'Cancel'}
            </Button>
            <Button onClick={handleConfirm}>
              {loginResult.type === 'existing-user'
                ? 'Yes, this is me'
                : 'Create Account'}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
