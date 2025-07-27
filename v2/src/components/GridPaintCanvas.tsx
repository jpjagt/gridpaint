import { useEffect, useRef, forwardRef, useImperativeHandle, useCallback } from 'react';

interface GridPaintCanvasProps {
  onBrushColorChange?: (color: string) => void;
}

export interface GridPaintCanvasMethods {
  reset: () => void;
  setGridSize: (operation: '+' | '-') => void;
  setColor: () => void;
  setBorderWidth: (width: number) => void;
  saveIMG: () => void;
  setActiveLayer: (layerId: number | null) => void;
  toggleLayerVisibility: (layerId: number) => void;
  createNewLayer: () => boolean;
  deleteLayer: (layerId: number) => void;
  getLayerState: () => { layers: Layer[], activeLayerId: number | null };
}

interface GridPoint {
  x: number;
  y: number;
  active: boolean;
}

interface Layer {
  id: number;
  points: Set<string>; // Store "x,y" strings for active points
  visible: boolean;
}

class RasterPoint {
  x: number;
  y: number;
  neighbors: boolean[][] = [];
  
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
    // Initialize 3x3 neighbor grid
    for (let i = 0; i < 3; i++) {
      this.neighbors[i] = [false, false, false];
    }
  }
  
  updateNeighbors(layers: Layer[], gridSize: number) {
    // Check all active layers for neighbors in 3x3 grid
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = this.x + dx;
        const ny = this.y + dy;
        const key = `${nx},${ny}`;
        
        let hasNeighbor = false;
        for (const layer of layers) {
          if (layer.visible && layer.points.has(key)) {
            hasNeighbor = true;
            break;
          }
        }
        
        this.neighbors[dx + 1][dy + 1] = hasNeighbor;
      }
    }
  }
  
  renderBlobBorderOnly(ctx: CanvasRenderingContext2D, gridSize: number, color: string, borderWidth: number) {
    const centerX = this.x * gridSize + gridSize / 2;
    const centerY = this.y * gridSize + gridSize / 2;
    const elementSize = gridSize / 2;
    const magicNr = 0.553; // Bezier magic number for quarter circles
    
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.strokeStyle = color;
    ctx.lineWidth = borderWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    
    const isCenter = this.neighbors[1][1];
    
    if (isCenter) {
      // This point is active - render 4 quadrants based on exact neighbor positions
      
      // DOWN RIGHT quadrant (0 degrees)
      ctx.save();
      if (this.neighbors[2][1] || this.neighbors[2][2] || this.neighbors[1][2]) {
        this.drawElement0BorderOnly(ctx, elementSize, borderWidth);
      } else {
        this.drawElement1BorderOnly(ctx, elementSize, magicNr, borderWidth);
      }
      ctx.restore();
      
      // DOWN LEFT quadrant (90 degrees)
      ctx.save();
      ctx.rotate(Math.PI / 2);
      if (this.neighbors[0][1] || this.neighbors[0][2] || this.neighbors[1][2]) {
        this.drawElement0BorderOnly(ctx, elementSize, borderWidth);
      } else {
        this.drawElement1BorderOnly(ctx, elementSize, magicNr, borderWidth);
      }
      ctx.restore();
      
      // UP LEFT quadrant (180 degrees)
      ctx.save();
      ctx.rotate(Math.PI);
      if (this.neighbors[0][1] || this.neighbors[0][0] || this.neighbors[1][0]) {
        this.drawElement0BorderOnly(ctx, elementSize, borderWidth);
      } else {
        this.drawElement1BorderOnly(ctx, elementSize, magicNr, borderWidth);
      }
      ctx.restore();
      
      // UP RIGHT quadrant (270 degrees)
      ctx.save();
      ctx.rotate(3 * Math.PI / 2);
      if (this.neighbors[1][0] || this.neighbors[2][0] || this.neighbors[2][1]) {
        this.drawElement0BorderOnly(ctx, elementSize, borderWidth);
      } else {
        this.drawElement1BorderOnly(ctx, elementSize, magicNr, borderWidth);
      }
      ctx.restore();
      
    } else {
      // This point is inactive - check for diagonal bridges
      
      // DOWN RIGHT bridge
      if (this.neighbors[2][1] && this.neighbors[1][2]) {
        ctx.save();
        this.drawElement2BorderOnly(ctx, elementSize, magicNr, borderWidth);
        ctx.restore();
      }
      
      // DOWN LEFT bridge
      if (this.neighbors[1][2] && this.neighbors[0][1]) {
        ctx.save();
        ctx.rotate(Math.PI / 2);
        this.drawElement2BorderOnly(ctx, elementSize, magicNr, borderWidth);
        ctx.restore();
      }
      
      // UP LEFT bridge
      if (this.neighbors[0][1] && this.neighbors[1][0]) {
        ctx.save();
        ctx.rotate(Math.PI);
        this.drawElement2BorderOnly(ctx, elementSize, magicNr, borderWidth);
        ctx.restore();
      }
      
      // UP RIGHT bridge
      if (this.neighbors[1][0] && this.neighbors[2][1]) {
        ctx.save();
        ctx.rotate(3 * Math.PI / 2);
        this.drawElement2BorderOnly(ctx, elementSize, magicNr, borderWidth);
        ctx.restore();
      }
    }
    
    ctx.restore();
  }

  renderBlob(ctx: CanvasRenderingContext2D, gridSize: number, color: string, borderWidth: number) {
    const centerX = this.x * gridSize + gridSize / 2;
    const centerY = this.y * gridSize + gridSize / 2;
    const elementSize = gridSize / 2;
    const magicNr = 0.553; // Bezier magic number for quarter circles
    
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = borderWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    
    const isCenter = this.neighbors[1][1];
    
    if (isCenter) {
      // This point is active - render 4 quadrants based on exact neighbor positions
      
      // DOWN RIGHT quadrant (0 degrees)
      ctx.save();
      if (this.neighbors[2][1] || this.neighbors[2][2] || this.neighbors[1][2]) {
        this.drawElement0(ctx, elementSize, borderWidth);
      } else {
        this.drawElement1(ctx, elementSize, magicNr, borderWidth);
      }
      ctx.restore();
      
      // DOWN LEFT quadrant (90 degrees)
      ctx.save();
      ctx.rotate(Math.PI / 2);
      if (this.neighbors[0][1] || this.neighbors[0][2] || this.neighbors[1][2]) {
        this.drawElement0(ctx, elementSize, borderWidth);
      } else {
        this.drawElement1(ctx, elementSize, magicNr, borderWidth);
      }
      ctx.restore();
      
      // UP LEFT quadrant (180 degrees)
      ctx.save();
      ctx.rotate(Math.PI);
      if (this.neighbors[0][1] || this.neighbors[0][0] || this.neighbors[1][0]) {
        this.drawElement0(ctx, elementSize, borderWidth);
      } else {
        this.drawElement1(ctx, elementSize, magicNr, borderWidth);
      }
      ctx.restore();
      
      // UP RIGHT quadrant (270 degrees)
      ctx.save();
      ctx.rotate(3 * Math.PI / 2);
      if (this.neighbors[1][0] || this.neighbors[2][0] || this.neighbors[2][1]) {
        this.drawElement0(ctx, elementSize, borderWidth);
      } else {
        this.drawElement1(ctx, elementSize, magicNr, borderWidth);
      }
      ctx.restore();
      
    } else {
      // This point is inactive - check for diagonal bridges
      
      // DOWN RIGHT bridge
      if (this.neighbors[2][1] && this.neighbors[1][2]) {
        ctx.save();
        this.drawElement2(ctx, elementSize, magicNr, borderWidth);
        ctx.restore();
      }
      
      // DOWN LEFT bridge
      if (this.neighbors[1][2] && this.neighbors[0][1]) {
        ctx.save();
        ctx.rotate(Math.PI / 2);
        this.drawElement2(ctx, elementSize, magicNr, borderWidth);
        ctx.restore();
      }
      
      // UP LEFT bridge
      if (this.neighbors[0][1] && this.neighbors[1][0]) {
        ctx.save();
        ctx.rotate(Math.PI);
        this.drawElement2(ctx, elementSize, magicNr, borderWidth);
        ctx.restore();
      }
      
      // UP RIGHT bridge
      if (this.neighbors[1][0] && this.neighbors[2][1]) {
        ctx.save();
        ctx.rotate(3 * Math.PI / 2);
        this.drawElement2(ctx, elementSize, magicNr, borderWidth);
        ctx.restore();
      }
    }
    
    ctx.restore();
  }
  
  drawElement0(ctx: CanvasRenderingContext2D, elementSize: number, borderWidth: number) {
    // Fill the rectangle
    ctx.fillRect(0, 0, elementSize, elementSize);
    
    // Stroke the rectangle border for laser cutting
    if (borderWidth > 0) {
      ctx.beginPath();
      ctx.rect(0, 0, elementSize, elementSize);
      ctx.stroke();
    }
  }
  
  drawElement1(ctx: CanvasRenderingContext2D, elementSize: number, magicNr: number, borderWidth: number) {
    // Create the curved quarter path
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(elementSize, 0);
    ctx.bezierCurveTo(
      elementSize,
      elementSize * magicNr,
      elementSize * magicNr,
      elementSize,
      0,
      elementSize
    );
    ctx.closePath();
    
    // Fill and stroke for both visual and laser cutting
    ctx.fill();
    if (borderWidth > 0) {
      ctx.stroke();
    }
  }
  
  drawElement2(ctx: CanvasRenderingContext2D, elementSize: number, magicNr: number, borderWidth: number) {
    // Create the diagonal bridge path
    ctx.beginPath();
    ctx.moveTo(elementSize, 0);
    ctx.bezierCurveTo(
      elementSize,
      elementSize * magicNr,
      elementSize * magicNr,
      elementSize,
      0,
      elementSize
    );
    ctx.lineTo(elementSize, elementSize);
    ctx.closePath();
    
    // Fill and stroke for both visual and laser cutting
    ctx.fill();
    if (borderWidth > 0) {
      ctx.stroke();
    }
  }

  drawElement0BorderOnly(ctx: CanvasRenderingContext2D, elementSize: number, borderWidth: number) {
    // Stroke the rectangle border only
    ctx.beginPath();
    ctx.rect(0, 0, elementSize, elementSize);
    ctx.stroke();
  }
  
  drawElement1BorderOnly(ctx: CanvasRenderingContext2D, elementSize: number, magicNr: number, borderWidth: number) {
    // Create the curved quarter path - border only
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(elementSize, 0);
    ctx.bezierCurveTo(
      elementSize,
      elementSize * magicNr,
      elementSize * magicNr,
      elementSize,
      0,
      elementSize
    );
    ctx.closePath();
    ctx.stroke();
  }
  
  drawElement2BorderOnly(ctx: CanvasRenderingContext2D, elementSize: number, magicNr: number, borderWidth: number) {
    // Create the diagonal bridge path - border only
    ctx.beginPath();
    ctx.moveTo(elementSize, 0);
    ctx.bezierCurveTo(
      elementSize,
      elementSize * magicNr,
      elementSize * magicNr,
      elementSize,
      0,
      elementSize
    );
    ctx.lineTo(elementSize, elementSize);
    ctx.closePath();
    ctx.stroke();
  }
}

export const GridPaintCanvas = forwardRef<GridPaintCanvasMethods, GridPaintCanvasProps>(
  ({ onBrushColorChange }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const stateRef = useRef({
      gridSize: 75,
      borderWidth: 2, // Configurable border width for blob shapes
      currentTool: 'draw' as 'draw' | 'erase',
      layers: [
        { id: 1, points: new Set<string>(), visible: true }
      ] as Layer[],
      activeLayerId: 1 as number | null,
      rasterPoints: new Map<string, RasterPoint>(),
      isDragging: false
    });

    const initializeCanvas = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      
      const pixelRatio = window.devicePixelRatio || 1;
      const displayWidth = window.innerWidth;
      const displayHeight = window.innerHeight;
      
      // Set high-resolution canvas
      canvas.width = displayWidth * pixelRatio;
      canvas.height = displayHeight * pixelRatio;
      canvas.style.width = displayWidth + 'px';
      canvas.style.height = displayHeight + 'px';
      
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.scale(pixelRatio, pixelRatio);
      }
      
      // Initialize raster points grid based on display size
      const gridCols = Math.ceil(displayWidth / stateRef.current.gridSize) + 2;
      const gridRows = Math.ceil(displayHeight / stateRef.current.gridSize) + 2;
      
      stateRef.current.rasterPoints.clear();
      for (let x = -1; x < gridCols; x++) {
        for (let y = -1; y < gridRows; y++) {
          const key = `${x},${y}`;
          stateRef.current.rasterPoints.set(key, new RasterPoint(x, y));
        }
      }
    }, []);

    const updateNeighbors = useCallback(() => {
      const { layers, rasterPoints, gridSize } = stateRef.current;
      
      rasterPoints.forEach(point => {
        point.updateNeighbors(layers, gridSize);
      });
    }, []);

    const render = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      const displayWidth = window.innerWidth;
      const displayHeight = window.innerHeight;
      
      // Clear canvas
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, displayWidth, displayHeight);
      
      updateNeighbors();
      
      const { layers, rasterPoints, activeLayerId } = stateRef.current;
      
      // Render layers from bottom to top (6 -> 1)
      const sortedLayers = [...layers].sort((a, b) => b.id - a.id);
      
      // First pass: render all layers with their gray colors (fill only)
      sortedLayers.forEach(layer => {
        if (!layer.visible) return;
        
        // All layers use grayscale tinting based on depth
        const intensity = Math.max(100, 220 - (layer.id - 1) * 20);
        const color = `rgb(${intensity}, ${intensity}, ${intensity})`;
        
        // We need to check all raster points for this layer to render bridges properly
        rasterPoints.forEach(point => {
          // Create a temporary layer state with only this layer's points
          const tempLayers = [{ 
            id: layer.id, 
            points: layer.points, 
            visible: true 
          }];
          
          point.updateNeighbors(tempLayers, stateRef.current.gridSize);
          
          // Check if this point should render anything for this layer
          const pointKey = `${point.x},${point.y}`;
          const isActive = layer.points.has(pointKey);
          const hasActiveNeighbors = point.neighbors.some(row => row.some(cell => cell));
          
          if (isActive || hasActiveNeighbors) {
            point.renderBlob(ctx, stateRef.current.gridSize, color, 0); // No border for fill pass
          }
        });
      });
      
      // Second pass: render active layer borders on top
      if (activeLayerId !== null) {
        const activeLayer = layers.find(l => l.id === activeLayerId);
        if (activeLayer && activeLayer.visible) {
          rasterPoints.forEach(point => {
            const tempLayers = [{ 
              id: activeLayer.id, 
              points: activeLayer.points, 
              visible: true 
            }];
            
            point.updateNeighbors(tempLayers, stateRef.current.gridSize);
            
            const pointKey = `${point.x},${point.y}`;
            const isActive = activeLayer.points.has(pointKey);
            const hasActiveNeighbors = point.neighbors.some(row => row.some(cell => cell));
            
            if (isActive || hasActiveNeighbors) {
              point.renderBlobBorderOnly(ctx, stateRef.current.gridSize, '#000000', stateRef.current.borderWidth + 1);
            }
          });
        }
      }
    }, [updateNeighbors]);

    const getGridCoordinates = useCallback((clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      
      const gridX = Math.floor(x / stateRef.current.gridSize);
      const gridY = Math.floor(y / stateRef.current.gridSize);
      
      return { x: gridX, y: gridY };
    }, []);

    const paintAtPosition = useCallback((clientX: number, clientY: number) => {
      const coords = getGridCoordinates(clientX, clientY);
      if (!coords) return;
      
      const { activeLayerId, layers, currentTool } = stateRef.current;
      
      // Only allow painting if there's an active layer
      if (activeLayerId === null) return;
      
      const activeLayer = layers.find(l => l.id === activeLayerId);
      if (!activeLayer) return;
      
      const key = `${coords.x},${coords.y}`;
      
      if (currentTool === 'draw') {
        activeLayer.points.add(key);
      } else if (currentTool === 'erase') {
        activeLayer.points.delete(key);
      }
      
      render();
    }, [getGridCoordinates, render]);

    useEffect(() => {
      initializeCanvas();
      render();
      
      const handleResize = () => {
        initializeCanvas();
        render();
      };
      
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }, [initializeCanvas, render]);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const handleMouseDown = (e: MouseEvent) => {
        stateRef.current.isDragging = true;
        paintAtPosition(e.clientX, e.clientY);
      };

      const handleMouseMove = (e: MouseEvent) => {
        if (stateRef.current.isDragging) {
          paintAtPosition(e.clientX, e.clientY);
        }
      };

      const handleMouseUp = () => {
        stateRef.current.isDragging = false;
      };

      canvas.addEventListener('mousedown', handleMouseDown);
      canvas.addEventListener('mousemove', handleMouseMove);
      canvas.addEventListener('mouseup', handleMouseUp);
      canvas.addEventListener('mouseleave', handleMouseUp);

      return () => {
        canvas.removeEventListener('mousedown', handleMouseDown);
        canvas.removeEventListener('mousemove', handleMouseMove);
        canvas.removeEventListener('mouseup', handleMouseUp);
        canvas.removeEventListener('mouseleave', handleMouseUp);
      };
    }, [paintAtPosition]);

    useImperativeHandle(ref, () => ({
      reset: () => {
        stateRef.current.layers.forEach(layer => {
          layer.points.clear();
        });
        render();
      },

      setGridSize: (operation: '+' | '-') => {
        const currentSize = stateRef.current.gridSize;
        const step = 25;
        const newSize = operation === '+' 
          ? Math.min(150, currentSize + step)
          : Math.max(25, currentSize - step);
        
        stateRef.current.gridSize = newSize;
        initializeCanvas();
        render();
      },

      setColor: () => {
        const newTool = stateRef.current.currentTool === 'draw' ? 'erase' : 'draw';
        stateRef.current.currentTool = newTool;
        onBrushColorChange?.(newTool === 'draw' ? '#000000' : '#ffffff');
      },

      setBorderWidth: (width: number) => {
        stateRef.current.borderWidth = Math.max(0, Math.min(10, width)); // Clamp between 0-10
        render();
      },

      saveIMG: () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        
        const link = document.createElement('a');
        link.download = 'gridpaint.png';
        link.href = canvas.toDataURL();
        link.click();
      },

      setActiveLayer: (layerId: number | null) => {
        stateRef.current.activeLayerId = layerId;
        render();
      },

      toggleLayerVisibility: (layerId: number) => {
        const layer = stateRef.current.layers.find(l => l.id === layerId);
        if (layer) {
          layer.visible = !layer.visible;
          render();
        }
      },

      createNewLayer: () => {
        const { layers } = stateRef.current;
        if (layers.length >= 6) return false;
        
        const newLayerId = Math.max(...layers.map(l => l.id)) + 1;
        const newLayer: Layer = {
          id: newLayerId,
          points: new Set<string>(),
          visible: true
        };
        
        layers.push(newLayer);
        stateRef.current.activeLayerId = newLayerId;
        render();
        return true;
      },

      deleteLayer: (layerId: number) => {
        const { layers } = stateRef.current;
        if (layers.length <= 1) return; // Keep at least one layer
        
        const layerIndex = layers.findIndex(l => l.id === layerId);
        if (layerIndex === -1) return;
        
        layers.splice(layerIndex, 1);
        
        // Update active layer if the deleted layer was active
        if (stateRef.current.activeLayerId === layerId) {
          stateRef.current.activeLayerId = layers.length > 0 ? layers[0].id : null;
        }
        
        render();
      },

      getLayerState: () => ({
        layers: [...stateRef.current.layers],
        activeLayerId: stateRef.current.activeLayerId
      })
    }));

    return (
      <canvas 
        ref={canvasRef}
        className="w-full h-full cursor-crosshair"
        style={{ display: 'block' }}
      />
    );
  }
);