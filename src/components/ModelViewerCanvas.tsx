/**
 * ModelViewerCanvas - Three.js canvas for rendering the 3D model preview.
 */

import { useEffect, useRef, useCallback } from "react"
import * as THREE from "three"
import {
  createSceneSetup,
  fitCameraToContent,
  createLayeredModel,
  updateLayerThickness,
  LAYER_THICKNESS_OPTIONS,
  type LayerThickness,
  type CameraSyncGroup,
} from "@/lib/threejs"
import { CustomThicknessInput } from "@/components/CustomThicknessInput"
import type { Layer, CanvasViewState } from "@/stores/drawingStores"
import type { ExportRect } from "@/types/gridpaint"

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
  const setupRef = useRef<ReturnType<typeof createSceneSetup> | null>(null)
  const modelGroupRef = useRef<THREE.Group | null>(null)
  const animationRef = useRef<number>(0)

  const initScene = useCallback(() => {
    if (!containerRef.current) return

    if (setupRef.current) {
      setupRef.current.dispose()
    }

    const setup = createSceneSetup({
      container: containerRef.current,
    })
    setupRef.current = setup

    const result = createLayeredModel({
      layers,
      exportRect,
      canvasView,
      layerThickness,
      reverseLayers,
      includeCutouts,
    })

    if (result && result.group) {
      setup.scene.add(result.group)
      modelGroupRef.current = result.group

      const center = new THREE.Vector3()
      result.boundingBox.getCenter(center)
      result.group.position.x -= center.x
      result.group.position.y -= center.y
      result.group.position.z -= center.z

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

    const animate = () => {
      animationRef.current = requestAnimationFrame(animate)
      setup.controls.update()
      setup.renderer.render(setup.scene, setup.camera)
    }
    animate()
  }, [layers, exportRect, canvasView, layerThickness, reverseLayers, includeCutouts])

  useEffect(() => {
    initScene()

    const handleResize = () => {
      if (!containerRef.current || !setupRef.current) return

      const { clientWidth, clientHeight } = containerRef.current
      const { camera, renderer } = setupRef.current

      if (camera instanceof THREE.PerspectiveCamera) {
        camera.aspect = clientWidth / clientHeight
        camera.updateProjectionMatrix()
      }

      renderer.setSize(clientWidth, clientHeight)
    }

    window.addEventListener("resize", handleResize)

    return () => {
      window.removeEventListener("resize", handleResize)
      if (setupRef.current) {
        setupRef.current.controls.enabled = false
      }
      cancelAnimationFrame(animationRef.current)
      setupRef.current?.dispose()
      setupRef.current = null
      modelGroupRef.current = null
    }
  }, [initScene])

  // Camera sync registration. Runs after the init effect above (declaration
  // order), so setupRef.current holds the current scene setup. `initScene` is
  // a dep so a rebuilt scene re-registers its new camera/controls.
  useEffect(() => {
    const setup = setupRef.current
    if (!cameraSync || !setup) return

    const member = { camera: setup.camera, controls: setup.controls }
    const unregister = cameraSync.register(member)
    const handleChange = () => cameraSync.broadcast(member)
    setup.controls.addEventListener("change", handleChange)

    return () => {
      setup.controls.removeEventListener("change", handleChange)
      unregister()
    }
  }, [initScene, cameraSync])

  useEffect(() => {
    if (modelGroupRef.current) {
      const effectiveMmPerUnit = exportRect.customMmPerUnit && exportRect.customMmPerUnit > 0
        ? exportRect.customMmPerUnit
        : canvasView.mmPerUnit
      updateLayerThickness(modelGroupRef.current, layerThickness, effectiveMmPerUnit)
    }
  }, [layerThickness, exportRect.customMmPerUnit, canvasView.mmPerUnit])

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
