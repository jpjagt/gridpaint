/**
 * Firestore Instance Configuration
 * 
 * Sets up Firestore with offline persistence enabled
 */

import {
  getFirestore,
  enableIndexedDbPersistence,
  type Firestore,
} from 'firebase/firestore'
import { app } from './config'

// Initialize Firestore
export const db: Firestore = getFirestore(app)

// Enable offline persistence
enableIndexedDbPersistence(db).catch((err) => {
  if (err.code === 'failed-precondition') {
    console.warn(
      '[Firestore] Persistence failed: Multiple tabs open. ' +
      'Only one tab can have persistence enabled at a time.'
    )
  } else if (err.code === 'unimplemented') {
    console.warn(
      '[Firestore] Persistence not available in this browser.'
    )
  } else {
    console.error('[Firestore] Error enabling persistence:', err)
  }
})

console.log('[Firestore] Initialized with offline persistence')
