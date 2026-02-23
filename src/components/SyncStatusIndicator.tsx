/**
 * Sync Status Indicator
 * 
 * Shows cloud sync status in the corner of the screen
 */

import { useStore } from '@nanostores/react'
import { $syncStatus, $authState } from '@/stores/authStores'
import { Cloud, CloudOff, Loader2, AlertCircle } from 'lucide-react'

export function SyncStatusIndicator() {
  const syncStatus = useStore($syncStatus)
  const authState = useStore($authState)

  // Don't show if not authenticated
  if (!authState.isAuthenticated) {
    return null
  }

  return (
    <div className="fixed bottom-4 right-4 z-40">
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-lg shadow-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700"
        title={
          syncStatus.error
            ? `Sync error: ${syncStatus.error}`
            : syncStatus.isSyncing
            ? 'Syncing...'
            : syncStatus.lastSyncAt
            ? `Last synced: ${new Date(syncStatus.lastSyncAt).toLocaleTimeString()}`
            : 'Connected'
        }
      >
        {syncStatus.error ? (
          <>
            <AlertCircle className="w-4 h-4 text-red-500" />
            <span className="text-xs text-red-500">Sync error</span>
          </>
        ) : syncStatus.isSyncing ? (
          <>
            <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
            <span className="text-xs text-gray-600 dark:text-gray-400">
              Syncing...
            </span>
          </>
        ) : (
          <>
            <Cloud className="w-4 h-4 text-green-500" />
            <span className="text-xs text-gray-600 dark:text-gray-400">
              Synced
            </span>
          </>
        )}
      </div>
    </div>
  )
}
