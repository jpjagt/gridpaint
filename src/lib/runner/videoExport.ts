/**
 * Frame-exact MP4 export: render each frame offline (waiting for every chunk
 * in view), encode with WebCodecs (H.264) and mux with mp4-muxer. Output is
 * independent of how fast the machine is.
 */

import { ArrayBufferTarget, Muxer } from "mp4-muxer"
import type { VideoExportOptions } from "@/types/runner"
import type { RunnerEngine } from "./RunnerEngine"

const CODECS = ["avc1.640034", "avc1.640033", "avc1.640028", "avc1.4d0034", "avc1.42003e"]

async function pickCodec(o: VideoExportOptions): Promise<string> {
  for (const codec of CODECS) {
    const { supported } = await VideoEncoder.isConfigSupported({
      codec,
      width: o.width,
      height: o.height,
      bitrate: o.bitrate,
      framerate: o.fps,
    })
    if (supported) return codec
  }
  throw new Error(`No H.264 encoder for ${o.width}×${o.height} in this browser`)
}

export function videoExportSupported(): boolean {
  return typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined"
}

export async function exportVideo(
  engine: RunnerEngine,
  options: VideoExportOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const o = { ...options, width: options.width & ~1, height: options.height & ~1 }
  const codec = await pickCodec(o)
  const target = new ArrayBufferTarget()
  const muxer = new Muxer({
    target,
    video: { codec: "avc", width: o.width, height: o.height, frameRate: o.fps },
    fastStart: "in-memory",
  })
  let failure: unknown = null
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      failure = e
    },
  })
  encoder.configure({
    codec,
    width: o.width,
    height: o.height,
    bitrate: o.bitrate,
    framerate: o.fps,
    avc: { format: "avc" },
  })

  engine.beginOffline(o.width, o.height)
  try {
    const frameUs = 1e6 / o.fps
    for (let i = 0; i < o.frames; i++) {
      if (failure) throw failure
      await engine.renderAt(o.startDistance + i * o.tilesPerFrame)
      const frame = new VideoFrame(engine.canvas, {
        timestamp: Math.round(i * frameUs),
        duration: Math.round(frameUs),
      })
      encoder.encode(frame, { keyFrame: i % (o.fps * 2) === 0 })
      frame.close()
      while (encoder.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 1))
      onProgress?.(i + 1, o.frames)
    }
    await encoder.flush()
    if (failure) throw failure
    muxer.finalize()
  } finally {
    if (encoder.state !== "closed") encoder.close()
    engine.endOffline()
  }
  return new Blob([target.buffer], { type: "video/mp4" })
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
