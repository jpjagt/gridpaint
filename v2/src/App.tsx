import { useRef, useState } from 'react';
import { GridPaintCanvas, type GridPaintCanvasMethods } from '@/components/GridPaintCanvas';
import { GridPaintControls } from '@/components/GridPaintControls';

function App() {
  const canvasRef = useRef<GridPaintCanvasMethods>(null);
  const [currentColor, setCurrentColor] = useState('#ffffff');
  
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

  return (
    <div className="w-screen h-screen overflow-hidden relative">
      <GridPaintCanvas 
        ref={canvasRef}
        onBrushColorChange={setCurrentColor}
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
