/**
 * Authentication and user types
 */

export interface UserProfile {
  userId: string // SHA-256 hash of passphrase
  writeToken: string // PBKDF2 derived from passphrase
  drawing_ids: string[] // Array of drawing UUIDs
  createdAt: number
  updatedAt: number
}

export interface AuthState {
  isAuthenticated: boolean
  userId: string | null // Hashed passphrase
  writeToken: string | null // PBKDF2 token for writes
  passphrase: string | null // Original passphrase (kept in memory for deriving tokens)
}

export interface LoginResult {
  type: 'new-user' | 'existing-user'
  userId: string
  writeToken: string
  drawingCount?: number
}

export interface SyncStatus {
  isSyncing: boolean
  lastSyncAt: number | null
  error: string | null
}

export interface SaveStatus {
  /** True when the most recent local save failed and has not yet succeeded. */
  failed: boolean
  /** Human-readable reason for the failure (e.g. quota exceeded). */
  error: string | null
}
