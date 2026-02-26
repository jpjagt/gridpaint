import { useRef, useState, useEffect } from "react"
import {
  Routes,
  Route,
  useParams,
  useNavigate,
} from "react-router-dom"
import Home from "@/components/Home"
import {
  GridPaintCanvas,
  type GridPaintCanvasMethods,
} from "@/components/GridPaintCanvas"
import { GridPaintControls } from "@/components/GridPaintControls"
import { ShortcutsModal } from "@/components/ShortcutsModal"
import { LayerControls } from "@/components/LayerControls"
import { ToolSelection } from "@/components/ToolSelection"
import { ToolOptionsPanel } from "@/components/ToolOptionsPanel"
import { MeasuringBars } from "@/components/MeasuringBars"
import { MeasuringTapeOverlay } from "@/components/MeasuringTapeOverlay"
import { ImageImportOverlay } from "@/components/ImageImportOverlay"
import { useImagePaste } from "@/hooks/useImagePaste"
import { useAuthInit } from "@/hooks/useAuthInit"
import type { Layer } from "@/stores/drawingStores"
import { drawingStore } from "@/lib/storage/store"
import { generateSingleLayerSvg, convertLayerToGridLayer } from "@/lib/export/svgUtils"
import { useStore } from "@nanostores/react"
import { $canvasView, $drawingMeta, $layersState, $exportRects } from "@/stores/drawingStores"

// Editor page for a given drawing ID
function EditorPage() {
  const navigate = useNavigate()
  const { drawingId } = useParams<{ drawingId: string }>()
  const canvasRef = useRef<GridPaintCanvasMethods>(null)
  const [layers, setLayers] = useState<Layer[]>([])
  const [activeLayerId, setActiveLayerId] = useState<number | null>(null)
  const [showMeasuringBars, setShowMeasuringBars] = useState<boolean>(false)
  const [showShortcuts, setShowShortcuts] = useState<boolean>(false)
  const canvasView = useStore($canvasView)
  const drawingMeta = useStore($drawingMeta)
  const layersState = useStore($layersState)
  // Enable paste-to-import
  useImagePaste()

  // M key: toggle measuring bars overlay
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target !== document.body) return
      if (!e.metaKey && !e.ctrlKey && !e.altKey && (e.key === "m" || e.key === "M")) {
        e.preventDefault()
        setShowMeasuringBars((v) => !v)
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [])

  // Sync layer state
  useEffect(() => {
    const updateLayerState = () => {
      const layerState = canvasRef.current?.getLayerState()
      if (layerState) {
        setLayers(layerState.layers)
        setActiveLayerId(layerState.activeLayerId)
      }
    }
    updateLayerState()
    const interval = setInterval(updateLayerState, 100)
    return () => clearInterval(interval)
  }, [])

  // Handlers
  const handleReset = () => canvasRef.current?.reset()
  const handleDownload = () => canvasRef.current?.saveIMG()
  const handleGridSizeChange = (op: "+" | "-") =>
    canvasRef.current?.setGridSize(op)
  const handleBorderWidthChange = (w: number) =>
    canvasRef.current?.setBorderWidth(w)
  const handleMmPerUnitChange = (mmPerUnit: number) =>
    canvasRef.current?.setMmPerUnit(mmPerUnit)
  const handleLayerSelect = (id: number | null) =>
    canvasRef.current?.setActiveLayer(id)
  const handleVisibilityToggle = (id: number) =>
    canvasRef.current?.toggleLayerVisibility(id)
  const handleCreateLayer = () => canvasRef.current?.createNewLayer()
  const handleRenderToggle = (id: number) =>
    canvasRef.current?.toggleLayerRenderStyle(id)
  const handleCreateOrActivateLayer = (id: number) =>
    canvasRef.current?.createOrActivateLayer(id)

  return (
    <div className='w-screen h-screen overflow-hidden relative'>
      <GridPaintCanvas
        ref={canvasRef}
        drawingId={drawingId!}
      />
      {/* Image import overlay renders above the canvas when active */}
      <ImageImportOverlay />
      <LayerControls
        layers={layers}
        activeLayerId={activeLayerId}
        onLayerSelect={handleLayerSelect}
        onLayerVisibilityToggle={handleVisibilityToggle}
        onCreateLayer={handleCreateLayer}
        onLayerRenderStyleToggle={handleRenderToggle}
        onCreateOrActivateLayer={handleCreateOrActivateLayer}
      />
      <GridPaintControls
        onReset={handleReset}
        onDownload={handleDownload}
        onGridSizeChange={handleGridSizeChange}
        onBorderWidthChange={handleBorderWidthChange}
        onMmPerUnitChange={handleMmPerUnitChange}
        name={drawingMeta.name}
        onNameChange={(n) => {
          canvasRef.current?.setName(n)
        }}
        onHome={() => navigate("/")}
        mmPerUnit={canvasView.mmPerUnit}
        showMeasuringBars={showMeasuringBars}
        onToggleMeasuringBars={() => setShowMeasuringBars((v) => !v)}
        onShowShortcuts={() => setShowShortcuts(true)}
      />
      <ShortcutsModal
        isOpen={showShortcuts}
        onClose={() => setShowShortcuts(false)}
      />
      <ToolSelection />
      <ToolOptionsPanel
        mmPerUnit={canvasView.mmPerUnit}
        layers={layersState.layers}
        canvasView={canvasView}
        drawingName={drawingMeta.name}
        onClearExportRects={() => $exportRects.set([])}
      />
      <MeasuringBars show={showMeasuringBars} />
      <MeasuringTapeOverlay />
    </div>
  )
}

// SVG export route for specific layer — preserves groups, cutouts, and quadrant overrides
function LayerSvgRoute() {
  const { drawingId, layerIndex } = useParams<{
    drawingId: string
    layerIndex: string
  }>()
  const [svg, setSvg] = useState<string>("")
  const [error, setError] = useState<string>("")

  useEffect(() => {
    const generateSvg = async () => {
      try {
        if (!drawingId || !layerIndex) {
          setError("Missing drawingId or layerIndex")
          return
        }

        const drawing = await drawingStore.get(drawingId)
        if (!drawing) {
          setError("Drawing not found")
          return
        }

        const layerId = parseInt(layerIndex, 10)
        if (isNaN(layerId)) {
          setError("Invalid layer ID")
          return
        }

        const layer = drawing.layers.find(l => l.id === layerId)
        if (!layer) {
          setError(`Layer with ID ${layerId} not found`)
          return
        }

        // Convert to GridLayer preserving groups, cutouts, and quadrant overrides
        const gridLayer = convertLayerToGridLayer(layer)

        const svgOutput = generateSingleLayerSvg(
          gridLayer,
          drawing.gridSize,
          drawing.borderWidth,
          undefined, // use default style
          true       // add margin and centering
        )

        setSvg(svgOutput)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error")
      }
    }

    generateSvg()
  }, [drawingId, layerIndex])

  if (error) {
    return <div>Error: {error}</div>
  }

  return (
    <div
      style={{ fontFamily: "monospace" }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

export default function App() {
  const { isInitialized } = useAuthInit()

  if (!isInitialized) {
    // Show loading while initializing
    return (
      <div className="w-screen h-screen flex items-center justify-center">
        <div className="text-gray-600 dark:text-gray-400">Loading...</div>
      </div>
    )
  }

  return (
    <Routes>
      <Route path='/grids/:drawingId' element={<EditorPage />} />
      <Route
        path='/grids/:drawingId/layers/:layerIndex'
        element={<LayerSvgRoute />}
      />
      <Route path='/' element={<Home />} />
    </Routes>
  )
}
