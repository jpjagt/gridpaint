import { useRef, useState, useEffect } from 'react';
import { GridPaintCanvas, type GridPaintCanvasMethods } from '@/components/GridPaintCanvas';
import { GridPaintControls } from '@/components/GridPaintControls';
import { LayerControls } from '@/components/LayerControls';

interface Layer {
  id: number;
  points: Set<string>;
  visible: boolean;
}

function App() {
  const canvasRef = useRef<GridPaintCanvasMethods>(null);
  const [currentColor, setCurrentColor] = useState('#ffffff');
  const [layers, setLayers] = useState<Layer[]>([]);
  const [activeLayerId, setActiveLayerId] = useState<number | null>(null);
  
  // Handler functions
  const handleReset = () => {
    canvasRef.current?.reset();
  };

  const handleDownload = () => {
    canvasRef.current?.saveIMG();
  };

  const handleGridSizeChange = (operation: '+' | '-') => {
    canvasRef.current?.setGridSize(operation);
  };

  const handleColorToggle = () => {
    canvasRef.current?.setColor();
  };

  const handleBorderWidthChange = (width: number) => {
    canvasRef.current?.setBorderWidth(width);
  };

  const handleLayerSelect = (layerId: number | null) => {
    canvasRef.current?.setActiveLayer(layerId);
  };

  const handleLayerVisibilityToggle = (layerId: number) => {
    canvasRef.current?.toggleLayerVisibility(layerId);
  };

  const handleCreateLayer = () => {
    canvasRef.current?.createNewLayer();
  };

  // Sync layer state from canvas
  useEffect(() => {
    const updateLayerState = () => {
      const layerState = canvasRef.current?.getLayerState();
      if (layerState) {
        setLayers(layerState.layers);
        setActiveLayerId(layerState.activeLayerId);
      }
    };
    
    // Update layer state initially and on interval
    updateLayerState();
    const interval = setInterval(updateLayerState, 100);
    
    return () => clearInterval(interval);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Layer switching (1-6 keys)
      const keyNum = parseInt(e.key);
      if (keyNum >= 1 && keyNum <= 6 && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        const layerExists = layers.some(l => l.id === keyNum);
        if (layerExists) {
          // Toggle layer if it's already active, otherwise activate it
          handleLayerSelect(activeLayerId === keyNum ? null : keyNum);
        }
        return;
      }
      
      // Layer visibility toggle (Shift + 1-6)
      if (e.shiftKey && keyNum >= 1 && keyNum <= 6 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        const layerExists = layers.some(l => l.id === keyNum);
        if (layerExists) {
          handleLayerVisibilityToggle(keyNum);
        }
        return;
      }
      
      // Create new layer (+ key)
      if (e.key === '+' || (e.shiftKey && e.key === '=')) {
        e.preventDefault();
        handleCreateLayer();
        return;
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [layers, activeLayerId, handleLayerSelect, handleLayerVisibilityToggle, handleCreateLayer]);

  return (
    <div className="w-screen h-screen overflow-hidden relative">
      <GridPaintCanvas 
        ref={canvasRef}
        onBrushColorChange={setCurrentColor}
      />
      
      <LayerControls
        layers={layers}
        activeLayerId={activeLayerId}
        onLayerSelect={handleLayerSelect}
        onLayerVisibilityToggle={handleLayerVisibilityToggle}
        onCreateLayer={handleCreateLayer}
      />
      
      <GridPaintControls
        onReset={handleReset}
        onDownload={handleDownload}
        onGridSizeChange={handleGridSizeChange}
        onColorToggle={handleColorToggle}
        onBorderWidthChange={handleBorderWidthChange}
        currentColor={currentColor}
      />
    </div>
  );
}

export default App;
