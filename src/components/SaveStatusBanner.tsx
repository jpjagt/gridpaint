import { useStore } from "@nanostores/react"
import { $saveStatus } from "@/stores/authStores"

/**
 * Persistent banner shown when a local save fails (e.g. storage quota
 * exhausted). Replaces the old silent console.error so the user is never led to
 * believe work was saved when it was not. It clears automatically once a
 * subsequent save succeeds (hybrid-store resets $saveStatus on success).
 */
export function SaveStatusBanner() {
  const status = useStore($saveStatus)
  if (!status.failed) return null
  return (
    <div
      role='alert'
      aria-live='assertive'
      className='fixed top-0 inset-x-0 z-[100] bg-destructive text-destructive-foreground px-4 py-2 text-sm text-center shadow-md'
    >
      Couldn't save your latest changes{status.error ? ` (${status.error})` : ""}.
      Your work is still on screen — keep this tab open and make another edit to
      retry.
    </div>
  )
}
