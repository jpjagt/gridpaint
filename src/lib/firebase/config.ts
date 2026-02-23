/**
 * Firebase Configuration
 * 
 * Initializes Firebase app with environment variables
 */

import { initializeApp, type FirebaseApp } from 'firebase/app'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

// Validate required config
const requiredKeys = [
  'apiKey',
  'authDomain', 
  'projectId',
  'storageBucket',
  'messagingSenderId',
  'appId',
]

for (const key of requiredKeys) {
  if (!firebaseConfig[key as keyof typeof firebaseConfig]) {
    throw new Error(
      `Missing Firebase config: VITE_FIREBASE_${key.toUpperCase()}. ` +
      `Please add it to your .env.local file.`
    )
  }
}

// Initialize Firebase
export const app: FirebaseApp = initializeApp(firebaseConfig)

console.log('[Firebase] Initialized with project:', firebaseConfig.projectId)
