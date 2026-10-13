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

/**
 * Infinite runner through a generated GridPaint-style landscape.
 *
 * Keys: Space pause · H stats · G settings · R record video · F fullscreen
 * URL:  #/runner?seed=4&speed=9&depth=1&seams=0&fog=140&ui=0
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

    const gui = buildGui(config, (next) => engine.updateConfig(next))
    if (!showUi) gui.hide()

    let rec: Recording | null = null
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      if (e.code === "Space") {
        e.preventDefault()
        engine.setPaused(!engine.isPaused())
        setPaused(engine.isPaused())
      } else if (e.key === "h" || e.key === "H") {
        setHud((v) => !v)
      } else if (e.key === "g" || e.key === "G") {
        gui._hidden ? gui.show() : gui.hide()
      } else if (e.key === "f" || e.key === "F") {
        if (document.fullscreenElement) void document.exitFullscreen()
        else void container.requestFullscreen()
      } else if (e.key === "r" || e.key === "R") {
        if (rec) {
          rec.stop()
          rec = null
          setRecording(false)
        } else {
          rec = startRecording(engine.canvas, `gridpaint-runner-seed${config.world.seed}`)
          setRecording(true)
        }
      }
    }
    window.addEventListener("keydown", onKey)

    return () => {
      window.removeEventListener("keydown", onKey)
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
        background: DEFAULT_RUNNER_CONFIG.colors.fog,
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
            `chunk build ${stats.avgChunkBuildMs.toFixed(1)}ms (worker)`,
            `${stats.distance.toFixed(0)} tiles   ${stats.biome}`,
            warming ? "loading world…" : paused ? "paused" : "",
            recording ? "● recording (R to stop)" : "",
            "space pause · h stats · g settings · r record · f fullscreen",
          ]
            .filter(Boolean)
            .join("\n")}
        </div>
      )}
    </div>
  )
}

function buildGui(config: RunnerConfig, onChange: (c: RunnerConfig) => void): GUI {
  const gui = new GUI({ title: "runner" })
  gui.close()
  const apply = () => onChange(config)

  gui.add(config, "speed", 0, 30, 0.5).onChange(apply)

  const colors = gui.addFolder("colors").close()
  for (const key of Object.keys(config.colors) as (keyof RunnerConfig["colors"])[]) {
    colors.addColor(config.colors, key).onChange(apply)
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

  const r = gui.addFolder("render").close()
  r.add(config.render, "maxPixelRatio", 0.5, 3, 0.25).onChange(apply)

  gui.add(
    {
      copy: () => void navigator.clipboard.writeText(JSON.stringify(config, null, 2)),
    },
    "copy",
  ).name("copy config JSON")
  return gui
}
