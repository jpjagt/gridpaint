/**
 * useAuthInit hook
 * 
 * Initializes authentication on app load
 * - Checks for stored credentials
 * - Sets up cloud sync if authenticated
 * - Defaults to local storage if no credentials found
 */

import { useEffect, useState } from 'react'
import { getStoredCredentials } from '@/lib/auth/user-manager'
import { setAuthState } from '@/stores/authStores'
import { enableCloudSync } from '@/lib/storage/storage-manager'

export function useAuthInit() {
  const [isInitialized, setIsInitialized] = useState(false)

  useEffect(() => {
    // Check for stored credentials
    const credentials = getStoredCredentials()
    
    if (credentials) {
      // User is logged in - restore session
      setAuthState({
        isAuthenticated: true,
        userId: credentials.userId,
        writeToken: credentials.writeToken,
        passphrase: credentials.passphrase,
      })
      
      // Enable cloud sync
      enableCloudSync(credentials.userId, credentials.writeToken)
      
      console.log('[Auth] Restored session from localStorage')
    }
    // No credentials: stay with local storage (default)
    
    setIsInitialized(true)
  }, [])

  return {
    isInitialized,
  }
}
