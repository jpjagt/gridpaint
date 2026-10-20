/**
 * ModelViewerCanvas - Three.js canvas for rendering the 3D model preview.
 *
 * The renderer/scene live as long as the canvas; the model is rebuilt only
 * when its inputs change, and thickness changes just rescale it.
 */

import { useEffect, useRef, useState } from "react"
import * as THREE from "three"
import {
  createSceneSetup,
  fitCameraToContent,
  createLayeredModel,
  updateLayerThickness,
  LAYER_THICKNESS_OPTIONS,
  type LayerThickness,
  type CameraSyncGroup,
  type SceneSetup,
} from "@/lib/threejs"
import { CustomThicknessInput } from "@/components/CustomThicknessInput"
import type { Layer, CanvasViewState } from "@/stores/drawingStores"
import type { ExportRect } from "@/types/gridpaint"
import { resolveRectMmPerUnit } from "@/lib/export/rectSettings"

interface ModelViewerCanvasProps {
  layers: Layer[]
  exportRect: ExportRect
  canvasView: CanvasViewState
  layerThickness: LayerThickness
  onThicknessChange?: (thickness: LayerThickness) => void
  reverseLayers?: boolean
  onReverseLayersChange?: (reverse: boolean) => void
  /** When false, cutout holes are omitted from the 3D geometry. Defaults to true. */
  includeCutouts?: boolean
  /** Hide the bottom controls bar (thickness picker, mirror checkbox). Defaults to false. */
  hideControls?: boolean
  /** When set, this viewer's camera is kept in sync with the group's other members. */
  cameraSync?: CameraSyncGroup | null
}

export function ModelViewerCanvas({
  layers,
  exportRect,
  canvasView,
  layerThickness,
  onThicknessChange,
  reverseLayers = false,
  onReverseLayersChange,
  includeCutouts = true,
  hideControls = false,
  cameraSync = null,
}: ModelViewerCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [setup, setSetup] = useState<SceneSetup | null>(null)
  const modelGroupRef = useRef<THREE.Group | null>(null)

  const effectiveMmPerUnit = resolveRectMmPerUnit(
    exportRect,
    canvasView.mmPerUnit,
  )
  // Read by the model build without making thickness a rebuild trigger
  const thicknessRef = useRef(layerThickness)
  thicknessRef.current = layerThickness

  // Renderer, scene, controls and render loop: created once per canvas.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const sceneSetup = createSceneSetup({ container })
    setSetup(sceneSetup)

    let frame = 0
    const animate = () => {
      frame = requestAnimationFrame(animate)
      sceneSetup.controls.update()
      sceneSetup.renderer.render(sceneSetup.scene, sceneSetup.camera)
    }
    animate()

    const handleResize = () => {
      const { clientWidth, clientHeight } = container
      sceneSetup.camera.aspect = clientWidth / clientHeight
      sceneSetup.camera.updateProjectionMatrix()
      sceneSetup.renderer.setSize(clientWidth, clientHeight)
    }
    window.addEventListener("resize", handleResize)

    return () => {
      window.removeEventListener("resize", handleResize)
      cancelAnimationFrame(frame)
      sceneSetup.dispose()
      setSetup(null)
    }
  }, [])

  // (Re)build the model when its inputs change and frame it.
  useEffect(() => {
    if (!setup) return

    const result = createLayeredModel({
      layers,
      exportRect,
      canvasView,
      layerThickness: thicknessRef.current,
      reverseLayers,
      includeCutouts,
    })

    if (result && result.group) {
      setup.scene.add(result.group)
      modelGroupRef.current = result.group
      centerModel(result.group)

      const distance = 100
      const angleRight = 30 * (Math.PI / 180)
      const angleUp = 10 * (Math.PI / 180)
      setup.camera.position.set(
        distance * Math.sin(angleRight),
        distance * Math.sin(angleUp),
        distance * Math.cos(angleRight)
      )
      setup.camera.lookAt(0, 0, 0)

      const newBoundingBox = new THREE.Box3().setFromObject(result.group)
      fitCameraToContent(setup.camera, setup.controls, newBoundingBox, 2)
    } else {
      setup.camera.position.set(50, 20, 80)
      setup.camera.lookAt(0, 0, 0)
    }

    return () => {
      if (result) {
        setup.scene.remove(result.group)
        disposeObject(result.group)
      }
      modelGroupRef.current = null
    }
  }, [setup, layers, exportRect, canvasView, reverseLayers, includeCutouts])

  // Camera sync registration for this canvas's camera/controls.
  useEffect(() => {
    if (!cameraSync || !setup) return

    const member = { camera: setup.camera, controls: setup.controls }
    const unregister = cameraSync.register(member)
    const handleChange = () => cameraSync.broadcast(member)
    setup.controls.addEventListener("change", handleChange)

    return () => {
      setup.controls.removeEventListener("change", handleChange)
      unregister()
    }
  }, [setup, cameraSync])

  // Thickness only rescales the stack; keep the model centred on the target.
  useEffect(() => {
    const group = modelGroupRef.current
    if (!group) return
    updateLayerThickness(group, layerThickness, effectiveMmPerUnit)
    centerModel(group)
  }, [setup, layerThickness, effectiveMmPerUnit])

  return (
    <div className='flex flex-col h-full'>
      <div ref={containerRef} className='flex-1 min-h-0' />
      {!hideControls && (
        <div className='flex items-center justify-center gap-4 py-3 border-t border-border bg-muted/30'>
          <div className='flex items-center gap-2'>
            <span className='text-xs text-muted-foreground font-mono'>
              Thickness:
            </span>
            {LAYER_THICKNESS_OPTIONS.map((t) => (
              <button
                key={t}
                type='button'
                onClick={() => onThicknessChange?.(t)}
                className={`px-3 py-1 text-xs font-mono rounded transition-colors ${
                  layerThickness === t
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted hover:bg-muted/80 text-muted-foreground"
                }`}
              >
                {t}mm
              </button>
            ))}
            <CustomThicknessInput
              thickness={layerThickness}
              onThicknessChange={onThicknessChange}
            />
          </div>
          <div className='w-px h-4 bg-border' />
          <label className='flex items-center gap-2 text-xs text-muted-foreground font-mono cursor-pointer'>
            <input
              type='checkbox'
              checked={reverseLayers}
              onChange={(e) => onReverseLayersChange?.(e.target.checked)}
              className='w-3 h-3'
            />
            Mirror
          </label>
        </div>
      )}
    </div>
  )
}

/** Centre the model's bounding box on the origin (the orbit target) */
function centerModel(group: THREE.Group): void {
  group.position.set(0, 0, 0)
  const center = new THREE.Box3().setFromObject(group).getCenter(new THREE.Vector3())
  group.position.copy(center).negate()
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
      object.geometry.dispose()
      const materials: THREE.Material[] = Array.isArray(object.material)
        ? object.material
        : [object.material]
      materials.forEach((m) => m.dispose())
    }
  })
}
