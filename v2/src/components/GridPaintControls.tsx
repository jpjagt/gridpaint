import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { 
  RefreshCcw, 
  Download, 
  HelpCircle, 
  Plus, 
  Minus, 
  Circle, 
  CircleDot 
} from 'lucide-react';

interface GridPaintControlsProps {
  onReset: () => void;
  onDownload: () => void;
  onGridSizeChange: (operation: '+' | '-') => void;
  onColorToggle: () => void;
  onBorderWidthChange: (width: number) => void;
  currentColor: string;
}

export const GridPaintControls = ({
  onReset,
  onDownload,
  onGridSizeChange,
  onColorToggle,
  onBorderWidthChange,
  currentColor
}: GridPaintControlsProps) => {
  const [borderWidth, setBorderWidth] = useState(2);
  
  const handleBorderWidthChange = (delta: number) => {
    const newWidth = Math.max(0, Math.min(10, borderWidth + delta));
    setBorderWidth(newWidth);
    onBorderWidthChange(newWidth);
  };
  
  const openTutorial = () => {
    window.open('https://schultzschultz.com/tools/gridPaint/tutorial', '_blank');
  };

  return (
    <>
      {/* Top right controls */}
      <div className="fixed top-5 right-5 flex gap-2">
        <Button
          size="icon"
          variant="ghost"
          onClick={onReset}
          className="w-8 h-8 bg-white/10 hover:bg-white/20 backdrop-blur-sm"
        >
          <RefreshCcw className="w-4 h-4" />
        </Button>
        
        <Button
          size="icon"
          variant="ghost"
          onClick={onDownload}
          className="w-8 h-8 bg-white/10 hover:bg-white/20 backdrop-blur-sm"
        >
          <Download className="w-4 h-4" />
        </Button>
        
        <Button
          size="icon"
          variant="ghost"
          onClick={openTutorial}
          className="w-8 h-8 bg-white/10 hover:bg-white/20 backdrop-blur-sm"
        >
          <HelpCircle className="w-4 h-4" />
        </Button>
      </div>

      {/* Bottom right controls */}
      <div className="fixed bottom-5 right-5 flex flex-col gap-2">
        {/* Grid size controls */}
        <Button
          size="icon"
          variant="ghost"
          onClick={() => onGridSizeChange('+')}
          className="w-8 h-8 bg-white/10 hover:bg-white/20 backdrop-blur-sm"
        >
          <Plus className="w-4 h-4" />
        </Button>
        
        <Button
          size="icon"
          variant="ghost"
          onClick={() => onGridSizeChange('-')}
          className="w-8 h-8 bg-white/10 hover:bg-white/20 backdrop-blur-sm"
        >
          <Minus className="w-4 h-4" />
        </Button>
        
        {/* Border width control */}
        <div className="bg-white/10 backdrop-blur-sm rounded-md p-2 flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => handleBorderWidthChange(-1)}
            className="w-6 h-6 hover:bg-white/20"
          >
            <Minus className="w-3 h-3" />
          </Button>
          
          <div className="text-xs text-white font-mono w-6 text-center">{borderWidth}</div>
          
          <Button
            size="icon"
            variant="ghost"
            onClick={() => handleBorderWidthChange(1)}
            className="w-6 h-6 hover:bg-white/20"
          >
            <Plus className="w-3 h-3" />
          </Button>
        </div>
        
        {/* Color toggle */}
        <Button
          size="icon"
          variant="ghost"
          onClick={onColorToggle}
          className="w-10 h-10 bg-white/10 hover:bg-white/20 backdrop-blur-sm"
        >
          {currentColor === '#ffffff' ? (
            <Circle className="w-6 h-6" />
          ) : (
            <CircleDot className="w-6 h-6" />
          )}
        </Button>
      </div>
    </>
  );
};