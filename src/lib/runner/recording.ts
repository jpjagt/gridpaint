/**
 * Realtime canvas recording to WebM via MediaRecorder. Good enough for
 * quick clips; for perfectly even frames use offline capture instead.
 */

import type { Recording } from "@/types/runner"

export function startRecording(canvas: HTMLCanvasElement, name: string): Recording {
  const stream = canvas.captureStream(60)
  const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) =>
    MediaRecorder.isTypeSupported(m),
  )
  const recorder = new MediaRecorder(stream, {
    mimeType: mime,
    videoBitsPerSecond: 24_000_000,
  })
  const parts: Blob[] = []
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) parts.push(e.data)
  }
  recorder.onstop = () => {
    const blob = new Blob(parts, { type: mime ?? "video/webm" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${name}-${Date.now()}.webm`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
    for (const t of stream.getTracks()) t.stop()
  }
  recorder.start(1000)
  return {
    stop: () => {
      if (recorder.state !== "inactive") recorder.stop()
    },
  }
}
