import { useRef, useState, useEffect } from "react"
import {
  Routes,
  Route,
  useParams,
  useNavigate,
  useSearchParams,
} from "react-router-dom"
import Home from "@/components/Home"
import {
  GridPaintCanvas,
  type GridPaintCanvasMethods,
} from "@/components/GridPaintCanvas"
import { GridPaintControls } from "@/components/GridPaintControls"
import { LayerControls } from "@/components/LayerControls"
import { ToolSelection, type Tool } from "@/components/ToolSelection"
import type { Layer } from "@/stores/drawingStores"
import { drawingStore } from "@/lib/storage/store"
import { generateSingleLayerSvg, generateLayerSvgContent, convertLayersToGridLayers } from "@/lib/export/svgUtils"

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

// SVG export route for specific layer
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

        // Use centralized SVG utility with margin and centering for util routes
        const svgOutput = generateSingleLayerSvg(
          layer.points,
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

// SVG test route for arbitrary points
function TestSvgRoute() {
  const [searchParams] = useSearchParams()
  const [svg, setSvg] = useState<string>("")
  const [error, setError] = useState<string>("")

  useEffect(() => {
    const generateSvg = async () => {
      try {
        const pointsParam = searchParams.get("points")
        if (!pointsParam) {
          setError("Missing points parameter. Use ?points=x1,y1;x2,y2;...")
          return
        }

        // Parse points from "x1,y1;x2,y2;..." format
        const pointsArray = pointsParam.split(";").map((pointStr) => {
          const [x, y] = pointStr.trim().split(",").map(Number)
          if (isNaN(x) || isNaN(y)) {
            throw new Error(`Invalid point: ${pointStr}`)
          }
          return { x, y }
        })

        if (pointsArray.length === 0) {
          setError("No valid points provided")
          return
        }

        // Use centralized SVG utility with margin and centering for util routes
        const svgOutput = generateSingleLayerSvg(
          pointsArray,
          50,        // Default grid size
          2,         // Default border width
          undefined, // use default style
          true       // add margin and centering
        )

        setSvg(svgOutput)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error")
      }
    }

    generateSvg()
  }, [searchParams])

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
  return (
    <Routes>
      <Route path='/layer' element={<TestSvgRoute />} />
      <Route path='/grids/:drawingId' element={<EditorPage />} />
      <Route
        path='/grids/:drawingId/layers/:layerIndex'
        element={<LayerSvgRoute />}
      />
      <Route path='/' element={<Home />} />
    </Routes>
  )
}
