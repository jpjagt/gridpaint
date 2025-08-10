import { useRef, useState, useEffect } from "react"
import { Routes, Route, useParams, useNavigate } from "react-router-dom"
import Home from "@/components/Home"
import {
  GridPaintCanvas,
  type GridPaintCanvasMethods,
} from "@/components/GridPaintCanvas"
import { GridPaintControls } from "@/components/GridPaintControls"
import { LayerControls } from "@/components/LayerControls"
import { ToolSelection, type Tool } from "@/components/ToolSelection"
import type { Layer } from "@/stores/drawingStores"

// Editor page for a given drawing ID
function EditorPage() {
  const navigate = useNavigate()
  const { drawingId } = useParams<{ drawingId: string }>()
  const canvasRef = useRef<GridPaintCanvasMethods>(null)
  const [layers, setLayers] = useState<Layer[]>([])
  const [activeLayerId, setActiveLayerId] = useState<number | null>(null)
  const [currentTool, setCurrentTool] = useState<Tool>("draw")
  const [drawingName, setDrawingName] = useState<string>("")

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
  const handleToolSelect = (t: Tool) => setCurrentTool(t)
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
        currentTool={currentTool}
        drawingId={drawingId!}
        onNameChange={setDrawingName}
      />
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
        name={drawingName}
        onNameChange={(n) => {
          setDrawingName(n)
          canvasRef.current?.setName(n)
        }}
        onHome={() => navigate("/")}
      />
      <ToolSelection
        currentTool={currentTool}
        onToolSelect={handleToolSelect}
      />
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path='/' element={<Home />} />
      <Route path='/grids/:drawingId' element={<EditorPage />} />
    </Routes>
  )
}
