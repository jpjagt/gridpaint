/**
 * Cryptographic functions for passphrase-based authentication
 * 
 * Uses two different hash functions to ensure security:
 * - SHA-256 for userId (fast, visible in documents but can't be reversed)
 * - PBKDF2 for writeToken (slow, prevents brute force attacks)
 */

/**
 * Hash passphrase to generate userId using SHA-256
 * This is a one-way hash that can't be reversed
 * 
 * @param passphrase - User's passphrase
 * @returns Hex string of SHA-256 hash
 */
export async function hashPassphrase(passphrase: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(passphrase)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Derive write token from passphrase using PBKDF2
 * This uses a different algorithm than hashPassphrase, so even if
 * an attacker sees the userId (SHA-256 hash), they can't compute
 * the writeToken without knowing the original passphrase
 * 
 * @param passphrase - User's passphrase
 * @returns Hex string of PBKDF2 derived key
 */
export async function deriveWriteToken(passphrase: string): Promise<string> {
  const encoder = new TextEncoder()
  
  // Import passphrase as key material
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  )
  
  // Derive token with high iteration count (protection against brute force)
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: encoder.encode('gridpaint-write-token'), // Fixed salt for consistency
      iterations: 100000, // High iteration count for security
      hash: 'SHA-256'
    },
    keyMaterial,
    256
  )
  
  // Convert to hex string
  return Array.from(new Uint8Array(derivedBits))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Derive both userId and writeToken from passphrase
 * Convenience function for common operation
 * 
 * @param passphrase - User's passphrase
 * @returns Object with userId and writeToken
 */
export async function deriveCredentials(passphrase: string): Promise<{
  userId: string
  writeToken: string
}> {
  // Run both derivations in parallel for performance
  const [userId, writeToken] = await Promise.all([
    hashPassphrase(passphrase),
    deriveWriteToken(passphrase)
  ])
  
  return { userId, writeToken }
}
