/**
 * Runs rig analysis off the main thread. Requests carry an id; only the
 * answer to the latest request matters to the caller.
 */

import { analyzeRig, type RigInputs } from "@/lib/rig/analyze"

self.onmessage = (event: MessageEvent<{ id: number; inputs: RigInputs }>) => {
  const { id, inputs } = event.data
  try {
    self.postMessage({ id, analysis: analyzeRig(inputs) })
  } catch (error) {
    self.postMessage({ id, error: String(error) })
  }
}
