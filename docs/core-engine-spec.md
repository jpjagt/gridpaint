# GridPaint Core Drawing Engine Specification

## Overview

The GridPaint Core Engine separates blob geometry calculation from rendering, enabling clean SVG paths for laser cutting while maintaining visual consistency across different output formats.

## Architecture

```
Grid Data → Blob Engine → Geometry Primitives → Renderers
                                               ├─ Canvas2D
                                               ├─ SVG 
                                               └─ LaserPath
```

## Core Components

### 1. Grid Data Model

```typescript
interface GridPoint {
  x: number
  y: number
}

interface GridLayer {
  id: number
  points: Set<string>  // "x,y" format
  isVisible: boolean
  renderStyle: 'default' | 'tiles'
}

interface GridDocument {
  layers: GridLayer[]
  gridSize: number
  borderWidth: number
}
```

### 2. Blob Geometry Engine

```typescript
interface BlobPrimitive {
  type: 'rectangle' | 'roundedCorner' | 'diagonalBridge'
  center: GridPoint
  quadrant: 0 | 1 | 2 | 3  // 0=SE, 1=SW, 2=NW, 3=NE
  size: number
}

interface BlobGeometry {
  primitives: BlobPrimitive[]
  boundingBox: { min: GridPoint, max: GridPoint }
}

class BlobEngine {
  generateGeometry(layer: GridLayer, gridSize: number): BlobGeometry
  optimizeForLaserCutting(geometry: BlobGeometry): LaserPath[]
}
```

### 3. Renderer Interface

```typescript
interface Renderer {
  render(geometry: BlobGeometry, style: RenderStyle): void
}

interface RenderStyle {
  fillColor?: string
  strokeColor?: string  
  strokeWidth?: number
  opacity?: number
}
```

## Key Algorithms

### 1. Neighborhood Analysis
```typescript
class NeighborhoodAnalyzer {
  getNeighbors(point: GridPoint, layer: GridLayer): boolean[][]
  classifyQuadrant(neighbors: boolean[][], quadrant: number): PrimitiveType
}
```

### 2. Primitive Generation
```typescript
class PrimitiveGenerator {
  generateRectangle(center: GridPoint, quadrant: number, size: number): Rectangle
  generateRoundedCorner(center: GridPoint, quadrant: number, size: number): BezierPath
  generateDiagonalBridge(center: GridPoint, quadrant: number, size: number): BezierPath
}
```

### 3. Path Optimization (for Laser Cutting)
```typescript
interface LaserPath {
  path: SVGPath
  isClosed: boolean
  cuttingOrder: number
}

class LaserOptimizer {
  // Convert filled primitives to boundary paths
  extractBoundaryPaths(geometry: BlobGeometry): SVGPath[]
  
  // Optimize cutting order to minimize travel time
  optimizeCuttingOrder(paths: SVGPath[]): LaserPath[]
  
  // Merge adjacent/overlapping paths
  mergePaths(paths: SVGPath[]): SVGPath[]
}
```

## Implementation Strategy

### Phase 1: Extract Blob Engine
1. Create standalone `BlobEngine` class
2. Move neighborhood logic from `RasterPoint` 
3. Generate primitive objects instead of immediate rendering

### Phase 2: Renderer Abstraction  
1. Create `Canvas2DRenderer` (current visual output)
2. Create `SVGRenderer` for export
3. Maintain visual consistency between renderers

### Phase 3: Laser Path Generation
1. Implement boundary extraction using **Marching Squares** variant
2. Create `LaserPathRenderer` that generates cutting paths
3. Add path optimization for minimal travel time

### Phase 4: Advanced Features
1. **Tolerance-based curve fitting** for smoother paths
2. **Island detection** for nested shapes
3. **Bridge insertion** for structurally sound cuts

## Example Usage

```typescript
// Core engine usage
const engine = new BlobEngine()
const geometry = engine.generateGeometry(layer, gridSize)

// Visual rendering
const canvasRenderer = new Canvas2DRenderer(canvas)
canvasRenderer.render(geometry, { fillColor: '#666' })

// SVG export
const svgRenderer = new SVGRenderer() 
const svgContent = svgRenderer.render(geometry, { fillColor: '#000' })

// Laser cutting paths
const laserOptimizer = new LaserOptimizer()
const cuttingPaths = laserOptimizer.extractBoundaryPaths(geometry)
const optimizedPaths = laserOptimizer.optimizeCuttingOrder(cuttingPaths)
```

## Benefits of This Architecture

### 1. **Separation of Concerns**
- Geometry calculation is pure (no side effects)
- Rendering is modular and testable
- Laser cutting logic is isolated

### 2. **Consistency**
- Same geometry engine for all outputs
- Visual preview matches final cuts
- Predictable results across formats

### 3. **Performance**  
- Geometry can be cached and reused
- Only recalculate when grid data changes
- Optimized rendering for each backend

### 4. **Extensibility**
- Easy to add new renderers (WebGL, Cairo, etc.)
- Laser cutting optimizations don't affect visual rendering
- Can add features like **G-code generation** later

## Laser Cutting Specific Requirements

### Path Generation Rules:
1. **Closed Paths**: Each connected component becomes one closed cutting path
2. **No Overlaps**: Eliminate redundant cuts where shapes touch
3. **Optimal Order**: Cut inner shapes before outer (prevent drop-outs)
4. **Clean Joins**: Smooth connections at path intersections
5. **Tolerance**: Configurable precision for curve approximation

### Output Format:
```svg
<svg>
  <path d="M10,10 C15,10 20,15 20,20 L20,30 C20,35 15,40 10,40 Z" 
        fill="none" 
        stroke="black" 
        stroke-width="0.1"/>
</svg>
```

This architecture will solve your current bugs by making the blob logic predictable and testable, while enabling the clean vector paths you need for laser cutting.