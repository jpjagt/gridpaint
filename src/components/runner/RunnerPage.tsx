import { useEffect, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import GUI from "lil-gui"
import type { Recording, RunnerConfig, RunnerStats } from "@/types/runner"
import { RunnerEngine } from "@/lib/runner/RunnerEngine"
import {
  DEFAULT_RUNNER_CONFIG,
  applyUrlOverrides,
  cloneConfig,
} from "@/lib/runner/config"
import { startRecording } from "@/lib/runner/recording"
import { downloadBlob, exportVideo, videoExportSupported } from "@/lib/runner/videoExport"
import { RUNNER_ENV_MAPS } from "@/lib/runner/materials"
import { nextPaletteName, randomPalette } from "@/lib/runner/palettes"

/**
 * Infinite runner through a generated GridPaint-style landscape.
 *
 * Keys: hold Space boost · P pause · C next palette · X random palette
 *       H stats · G settings · F fullscreen
 *       R record realtime WebM · V export frame-exact MP4 (one loop when looping)
 * URL:  #/runner?seed=4&speed=9&depth=1&seams=0&fog=140&ui=0
 *       &biome=dream,ruins  &at=500  &loop=140&record=loop  &res=3840x2160
 */
export default function RunnerPage() {
  const containerRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<RunnerEngine | null>(null)
  const [params] = useSearchParams()
  const showUi = params.get("ui") !== "0"
  const [stats, setStats] = useState<RunnerStats | null>(null)
  const [hud, setHud] = useState(showUi)
  const [paused, setPaused] = useState(false)
  const [warming, setWarming] = useState(true)
  const [recording, setRecording] = useState(false)
  const [exportState, setExportState] = useState("")

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const config = applyUrlOverrides(cloneConfig(DEFAULT_RUNNER_CONFIG), params)
    const engine = new RunnerEngine(container, config)
    engineRef.current = engine
    engine.onStats = (s) => {
      setStats(s)
      setWarming(engine.isWarmingUp())
    }
    engine.start()


    let rec: Recording | null = null
    const recordName = `gridpaint-runner-seed${config.world.seed}`

    // Frame-exact MP4 export (V, or ?record=loop to export one loop on load).
    // With a loop length it renders exactly one loop: frame N would equal
    // frame 0, so the file loops seamlessly.
    let exporting = false
    const runExport = async () => {
      if (exporting) return
      if (!videoExportSupported()) {
        setExportState("this browser can't encode video (needs WebCodecs)")
        return
      }
      exporting = true
      const cap = config.capture
      const L = config.world.loopLength
      const distance = engine.getDistance()
      const loop = L > 0
      const frames = loop
        ? Math.max(1, Math.round((L / config.speed) * cap.fps))
        : Math.round(cap.seconds * cap.fps)
      const options = {
        width: cap.width,
        height: cap.height,
        fps: cap.fps,
        bitrate: cap.mbps * 1e6,
        startDistance: loop ? Math.ceil(distance / L) * L : distance,
        frames,
        tilesPerFrame: loop ? L / frames : config.speed / cap.fps,
      }
      try {
        const blob = await exportVideo(engine, options, (done, total) =>
          setExportState(`exporting ${done}/${total} frames`),
        )
        const name = loop ? `${recordName}-loop${L}` : `${recordName}-at${Math.round(distance)}`
        downloadBlob(blob, `${name}-${cap.width}x${cap.height}.mp4`)
        setExportState("")
      } catch (err) {
        setExportState(`export failed: ${String(err)}`)
      } finally {
        exporting = false
      }
    }
    if (params.get("record") === "loop") {
      const wait = () => (engine.isWarmingUp() ? setTimeout(wait, 100) : void runExport())
      wait()
    }

    const { gui, refreshPalette } = buildGui(
      config,
      (next) => engine.updateConfig(next),
      () => void runExport(),
    )
    if (!showUi) gui.hide()
    const setPalette = (name: string) => {
      config.palette = name
      engine.updateConfig(config)
      refreshPalette()
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      if (e.code === "Space") {
        e.preventDefault()
        if (!e.repeat) engine.setBoost(true)
      } else if (e.key === "p" || e.key === "P") {
        engine.setPaused(!engine.isPaused())
        setPaused(engine.isPaused())
      } else if (e.key === "h" || e.key === "H") {
        setHud((v) => !v)
      } else if (e.key === "g" || e.key === "G") {
        gui._hidden ? gui.show() : gui.hide()
      } else if (e.key === "f" || e.key === "F") {
        if (document.fullscreenElement) void document.exitFullscreen()
        else void container.requestFullscreen()
      } else if (e.key === "c" || e.key === "C") {
        setPalette(nextPaletteName(config))
      } else if (e.key === "x" || e.key === "X") {
        config.palettes.random = randomPalette()
        setPalette("random")
      } else if (e.key === "v" || e.key === "V") {
        void runExport()
      } else if (e.key === "r" || e.key === "R") {
        if (rec) {
          rec.stop()
          rec = null
          setRecording(false)
        } else {
          rec = startRecording(engine.canvas, recordName)
          setRecording(true)
        }
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") engine.setBoost(false)
    }
    const onBlur = () => engine.setBoost(false)
    window.addEventListener("keydown", onKey)
    window.addEventListener("keyup", onKeyUp)
    window.addEventListener("blur", onBlur)

    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("keyup", onKeyUp)
      window.removeEventListener("blur", onBlur)
      rec?.stop()
      gui.destroy()
      engine.dispose()
      engineRef.current = null
    }
    // Engine is created once; URL params are read at mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      ref={containerRef}
      style={{
        position: "fixed",
        inset: 0,
        overflow: "hidden",
        background: DEFAULT_RUNNER_CONFIG.palettes[DEFAULT_RUNNER_CONFIG.palette].fog,
      }}
    >
      {hud && stats && (
        <div
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            padding: "8px 10px",
            font: "11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
            color: "#555",
            background: "rgba(240,240,240,0.75)",
            border: "1px solid #bbb",
            pointerEvents: "none",
            whiteSpace: "pre",
          }}
        >
          {[
            `${stats.fps.toFixed(0)} fps   p99 ${stats.p99FrameMs.toFixed(1)}ms   worst ${stats.worstFrameMs.toFixed(1)}ms`,
            `${stats.chunks} chunks   ${(stats.triangles / 1000).toFixed(0)}k tris   ${(stats.lineSegments / 1000).toFixed(0)}k lines`,
            `chunk build ${stats.avgChunkBuildMs.toFixed(1)}ms (worker)   ${stats.pixelRatio}x res`,
            `${stats.distance.toFixed(0)} tiles   ${stats.biome}   palette: ${stats.palette}`,
            warming ? "loading world…" : paused ? "paused" : "",
            recording ? "● recording (R to stop)" : "",
            exportState,
            "hold space boost · p pause · c palette · x random palette",
            "h stats · g settings · f fullscreen",
            "r record (realtime webm) · v export mp4 (frame-exact)",
          ]
            .filter(Boolean)
            .join("\n")}
        </div>
      )}
    </div>
  )
}

function buildGui(
  config: RunnerConfig,
  onChange: (c: RunnerConfig) => void,
  onExport: () => void,
): { gui: GUI; refreshPalette: () => void } {
  const gui = new GUI({ title: "runner" })
  gui.close()
  const apply = () => onChange(config)

  gui.add(config, "speed", 0, 40, 0.5).onChange(apply)
  const boost = gui.addFolder("boost (hold space)").close()
  boost.add(config.boost, "factor", 1, 5, 0.1).onChange(apply)
  boost.add(config.boost, "rampSeconds", 0.05, 3, 0.05).onChange(apply)

  // Palette: a picker plus the active palette's colors (rebuilt on switch)
  let paletteFolder: GUI | null = null
  let paletteOpen = false
  const refreshPalette = () => {
    if (paletteFolder) {
      paletteOpen = !paletteFolder._closed
      paletteFolder.destroy()
    }
    const folder = gui.addFolder(`palette: ${config.palette}`)
    paletteFolder = folder
    if (!paletteOpen) folder.close()
    folder
      .add(config, "palette", Object.keys(config.palettes))
      .name("palette (C)")
      .onChange(() => {
        apply()
        refreshPalette()
      })
    const p = config.palettes[config.palette]
    if (p) {
      for (const key of ["front", "side", "sideTop", "line", "seam", "fog", "shadow"] as const) {
        folder.addColor(p, key).onChange(apply)
      }
      folder.add(p, "invertMetal").onChange(apply)
    }
    folder
      .add(
        {
          random: () => {
            config.palettes.random = randomPalette()
            config.palette = "random"
            apply()
            refreshPalette()
          },
        },
        "random",
      )
      .name("random (X)")
    // keep the palette folder near the top
    const domParent = folder.domElement.parentElement
    const anchor = gui.folders[0]?.domElement
    if (domParent && anchor && anchor !== folder.domElement) domParent.insertBefore(folder.domElement, anchor)
  }
  refreshPalette()

  const characterColors = gui.addFolder("character colors").close()
  for (const key of Object.keys(config.colors) as (keyof RunnerConfig["colors"])[]) {
    characterColors.addColor(config.colors, key).onChange(apply)
  }

  const fog = gui.addFolder("fog").close()
  fog.add(config.fog, "near", 0, 200, 1).onChange(apply)
  fog.add(config.fog, "far", 1, 400, 1).onChange(apply)
  fog.add(config.fog, "exponent", 0.2, 4, 0.05).onChange(apply)

  const lines = gui.addFolder("lines").close()
  lines.add(config.lines, "outlines").onChange(apply)
  lines.add(config.lines, "seams").onChange(apply)
  lines.add(config.lines, "seamOpacity", 0, 1, 0.01).onChange(apply)
  lines.add(config.lines, "seamFadeStart", 0, 200, 1).onChange(apply)
  lines.add(config.lines, "seamFadeEnd", 0, 300, 1).onChange(apply)

  const cam = gui.addFolder("camera").close()
  cam.add(config.camera, "up", 1, 12, 0.5).onFinishChange(apply)
  cam.add(config.camera, "back", 1, 20, 0.5).onChange(apply)
  cam.add(config.camera, "lookAhead", 0, 40, 0.5).onChange(apply)
  cam.add(config.camera, "lookUp", -5, 10, 0.25).onChange(apply)
  cam.add(config.camera, "fov", 20, 100, 1).onChange(apply)

  const ch = gui.addFolder("character").close()
  ch.add(config.character, "kind", ["ball", "arrow"]).onChange(apply)
  ch.add(config.character, "radius", 0.15, 0.5, 0.01).onChange(apply)
  ch.add(config.character, "shadow").onChange(apply)

  const world = gui.addFolder("world (rebuilds)").close()
  world.add(config.world, "seed", 0, 99999, 1).onFinishChange(apply)
  world.add(config.world, "sliceDepth", [0.25, 0.5, 1, 2]).onChange(apply)
  world.add(config.world, "viewDistance", 20, 300, 5).onFinishChange(apply)
  world.add(config.world, "zoneLength", 40, 1000, 10).onFinishChange(apply)
  world.add(config.world, "transitionLength", 0, 200, 5).onFinishChange(apply)
  const weights = world.addFolder("biome weights").close()
  for (const key of Object.keys(config.world.biomeWeights) as (keyof RunnerConfig["world"]["biomeWeights"])[]) {
    weights.add(config.world.biomeWeights, key, 0, 5, 0.1).onFinishChange(apply)
  }

  const metal = gui.addFolder("metal").close()
  metal.add(config.world, "metalFraction", 0, 1, 0.05).name("share (rebuilds)").onFinishChange(apply)
  metal
    .add(config.metal, "envMap", Object.keys(RUNNER_ENV_MAPS))
    .onChange(apply)
  metal.add(config.metal, "blur", 0, 6, 0.1).onChange(apply)
  metal.add(config.metal, "exposure", 0.2, 3, 0.05).onChange(apply)
  metal.add(config.metal, "contrast", 0.3, 3, 0.05).onChange(apply)
  metal.addColor(config.metal, "tint").onChange(apply)

  const r = gui.addFolder("render").close()
  r.add(config.render, "maxPixelRatio", 0.5, 3, 0.25).onChange(apply)
  r.add(config.render, "adaptiveResolution").onChange(apply)

  const ex = gui.addFolder("export mp4").close()
  ex.add(config.world, "loopLength", 0, 1000, 10).name("loop length (0 = off)").onFinishChange(apply)
  ex.add(config.capture, "width", 320, 3840, 2)
  ex.add(config.capture, "height", 240, 2160, 2)
  ex.add(config.capture, "fps", [24, 25, 30, 50, 60])
  ex.add(config.capture, "mbps", 2, 100, 1)
  ex.add(config.capture, "seconds", 1, 120, 1).name("seconds (no loop)")
  ex.add({ onExport }, "onExport").name("export (V)")

  gui.add(
    {
      copy: () => void navigator.clipboard.writeText(JSON.stringify(config, null, 2)),
    },
    "copy",
  ).name("copy config JSON")
  return { gui, refreshPalette }
}
