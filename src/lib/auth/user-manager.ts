/**
 * User session management
 * 
 * Handles passphrase login/logout and persistence to LocalStorage
 */

import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase/firestore'
import { deriveCredentials } from './crypto'
import type { UserProfile, LoginResult } from '@/types/auth'

const STORAGE_KEYS = {
  USER_ID: 'gridpaint:userId',
  WRITE_TOKEN: 'gridpaint:writeToken',
  PASSPHRASE: 'gridpaint:passphrase', // Keep in localStorage for convenience
}

/**
 * Login with passphrase
 * Checks if user exists in Firestore, creates if not
 * 
 * @param passphrase - User's passphrase
 * @returns Login result with user info
 */
export async function loginWithPassphrase(
  passphrase: string
): Promise<LoginResult> {
  // Derive credentials from passphrase
  const { userId, writeToken } = await deriveCredentials(passphrase)
  
  // Check if user document exists
  const userRef = doc(db, 'users', userId)
  const userSnap = await getDoc(userRef)
  
  if (!userSnap.exists()) {
    // New user - create document
    const newUser: UserProfile = {
      userId,
      writeToken,
      drawing_ids: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    
    await setDoc(userRef, newUser)
    
    // Store credentials locally
    storeCredentials(userId, writeToken, passphrase)
    
    console.log('[Auth] New user created:', userId.substring(0, 8) + '...')
    
    return {
      type: 'new-user',
      userId,
      writeToken,
      drawingCount: 0,
    }
  }
  
  // Existing user
  const userData = userSnap.data() as UserProfile
  
  // Store credentials locally
  storeCredentials(userId, writeToken, passphrase)
  
  console.log('[Auth] Existing user logged in:', userId.substring(0, 8) + '...')
  
  return {
    type: 'existing-user',
    userId,
    writeToken,
    drawingCount: userData.drawing_ids.length,
  }
}

/**
 * Check if user has existing session
 * @returns Credentials if found, null otherwise
 */
export function getStoredCredentials(): {
  userId: string
  writeToken: string
  passphrase: string
} | null {
  const userId = localStorage.getItem(STORAGE_KEYS.USER_ID)
  const writeToken = localStorage.getItem(STORAGE_KEYS.WRITE_TOKEN)
  const passphrase = localStorage.getItem(STORAGE_KEYS.PASSPHRASE)
  
  if (!userId || !writeToken || !passphrase) {
    return null
  }
  
  return { userId, writeToken, passphrase }
}

/**
 * Store credentials in localStorage
 */
function storeCredentials(
  userId: string,
  writeToken: string,
  passphrase: string
): void {
  localStorage.setItem(STORAGE_KEYS.USER_ID, userId)
  localStorage.setItem(STORAGE_KEYS.WRITE_TOKEN, writeToken)
  localStorage.setItem(STORAGE_KEYS.PASSPHRASE, passphrase)
}

/**
 * Clear stored credentials (logout)
 */
export function logout(): void {
  localStorage.removeItem(STORAGE_KEYS.USER_ID)
  localStorage.removeItem(STORAGE_KEYS.WRITE_TOKEN)
  localStorage.removeItem(STORAGE_KEYS.PASSPHRASE)
  console.log('[Auth] Logged out')
}

/**
 * Check if a user exists in Firestore
 * Useful for collision detection before creating account
 * 
 * @param passphrase - Passphrase to check
 * @returns True if user exists
 */
export async function checkUserExists(passphrase: string): Promise<boolean> {
  const { userId } = await deriveCredentials(passphrase)
  const userRef = doc(db, 'users', userId)
  const userSnap = await getDoc(userRef)
  return userSnap.exists()
}
