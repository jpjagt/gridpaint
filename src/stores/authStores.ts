/**
 * Auth and Sync state stores
 * 
 * Nanostores for managing authentication and sync status
 */

import { atom } from 'nanostores'
import type { AuthState, SyncStatus } from '@/types/auth'

/**
 * Authentication state
 * Tracks whether user is logged in and their credentials
 */
export const $authState = atom<AuthState>({
  isAuthenticated: false,
  userId: null,
  writeToken: null,
  passphrase: null,
})

/**
 * Sync status for cloud storage
 * Tracks syncing state and errors
 */
export const $syncStatus = atom<SyncStatus>({
  isSyncing: false,
  lastSyncAt: null,
  error: null,
})

/**
 * Update auth state (helper)
 */
export function setAuthState(state: Partial<AuthState>): void {
  $authState.set({
    ...$authState.get(),
    ...state,
  })
}

/**
 * Update sync status (helper)
 */
export function setSyncStatus(status: Partial<SyncStatus>): void {
  $syncStatus.set({
    ...$syncStatus.get(),
    ...status,
  })
}
