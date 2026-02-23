/**
 * Firestore utility functions
 */

/**
 * Recursively remove undefined values from an object
 * Firestore doesn't accept undefined values - they must be omitted or null
 * 
 * @param obj - Object to clean
 * @returns Clean object without undefined values
 */
export function removeUndefined<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map(removeUndefined) as T
  }

  if (typeof obj === 'object') {
    const cleaned: any = {}
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        cleaned[key] = removeUndefined(value)
      }
    }
    return cleaned
  }

  return obj
}
