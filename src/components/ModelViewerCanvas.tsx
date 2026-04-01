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
} from "@/lib/threejs"
import type { Layer, CanvasViewState } from "@/stores/drawingStores"
import type { ExportRect } from "@/types/gridpaint"

interface ModelViewerCanvasProps {
  layers: Layer[]
  exportRect: ExportRect
  canvasView: CanvasViewState
  layerThickness: LayerThickness
  onThicknessChange: (thickness: LayerThickness) => void
  reverseLayers?: boolean
  onReverseLayersChange?: (reverse: boolean) => void
}

export function ModelViewerCanvas({
  layers,
  exportRect,
  canvasView,
  layerThickness,
  onThicknessChange,
  reverseLayers = false,
  onReverseLayersChange,
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
  }, [layers, exportRect, canvasView, layerThickness, reverseLayers])

  useEffect(() => {
    initScene()

    const handleResize = () => {
      if (!containerRef.current || !setupRef.current) return

      const { clientWidth, clientHeight } = containerRef.current
      const { camera, renderer } = setupRef.current

      const aspect = clientWidth / clientHeight
      const frustumSize = 100

      if (camera instanceof THREE.OrthographicCamera) {
        camera.left = (frustumSize * aspect) / -2
        camera.right = (frustumSize * aspect) / 2
        camera.top = frustumSize / 2
        camera.bottom = frustumSize / -2
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
      <div className='flex items-center justify-center gap-4 py-3 border-t border-border bg-muted/30'>
        <div className='flex items-center gap-2'>
          <span className='text-xs text-muted-foreground font-mono'>
            Thickness:
          </span>
          {LAYER_THICKNESS_OPTIONS.map((t) => (
            <button
              key={t}
              type='button'
              onClick={() => onThicknessChange(t)}
              className={`px-3 py-1 text-xs font-mono rounded transition-colors ${
                layerThickness === t
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted hover:bg-muted/80 text-muted-foreground"
              }`}
            >
              {t}mm
            </button>
          ))}
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
    </div>
  )
}
