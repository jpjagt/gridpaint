# SVG Path Generation for Laser Cutting

## Problem Statement

Convert GridPaint blob geometry into **clean cutting paths** that trace the boundary of shapes rather than filling them. The output must maintain the same aesthetic (rounded corners, diagonal bridges) while generating optimal paths for laser cutting.

## Boundary Tracing Algorithm

### 1. Edge Detection Phase

Instead of rendering filled quadrants, we trace the **boundary edges** between filled and empty cells:

```typescript
interface BoundaryEdge {
  from: GridPoint
  to: GridPoint  
  direction: 'N' | 'E' | 'S' | 'W'
  cellInside: GridPoint  // which cell is "inside" the shape
}

class BoundaryTracer {
  findBoundaryEdges(layer: GridLayer): BoundaryEdge[]
  traceContinuousPaths(edges: BoundaryEdge[]): BoundaryPath[]
}
```

### 2. Edge Classification

Each boundary edge gets classified based on the **local geometry** of its endpoints:

```typescript
enum EdgeType {
  STRAIGHT,      // Normal straight edge
  ROUND_CONVEX,  // Rounded outward corner
  ROUND_CONCAVE, // Rounded inward corner  
  DIAGONAL_BRIDGE // Diagonal connection
}

class EdgeClassifier {
  classifyEdge(edge: BoundaryEdge, layer: GridLayer): EdgeType
}
```

### 3. Path Segment Generation

Convert each classified edge into an SVG path segment:

#### Straight Edge:
```svg
L x,y
```

#### Rounded Convex Corner:
```svg
C x1,y1 x2,y2 x,y
```
Using the same Bézier parameters as blob rendering (k=0.553)

#### Rounded Concave Corner:  
```svg
C x1,y1 x2,y2 x,y
```
Inverted curvature from convex case

#### Diagonal Bridge:
```svg
C x1,y1 x2,y2 x,y L x3,y3 C x4,y4 x5,y5 x6,y6
```
Traces the curved bridge connection

## Detailed Algorithm

### Step 1: Grid Boundary Detection

```typescript
function findBoundaryEdges(points: Set<string>): BoundaryEdge[] {
  const edges: BoundaryEdge[] = []
  
  points.forEach(pointKey => {
    const [x, y] = pointKey.split(',').map(Number)
    
    // Check each cardinal direction
    const directions = [
      { dx: 0, dy: -1, dir: 'N' },  // North
      { dx: 1, dy: 0,  dir: 'E' },  // East  
      { dx: 0, dy: 1,  dir: 'S' },  // South
      { dx: -1, dy: 0, dir: 'W' }   // West
    ]
    
    directions.forEach(({ dx, dy, dir }) => {
      const neighborKey = `${x + dx},${y + dy}`
      if (!points.has(neighborKey)) {
        // This is a boundary edge
        edges.push({
          from: edgeStart(x, y, dir),
          to: edgeEnd(x, y, dir),
          direction: dir,
          cellInside: { x, y }
        })
      }
    })
  })
  
  return edges
}
```

### Step 2: Corner Detection and Classification

```typescript
function classifyCorner(
  prevEdge: BoundaryEdge, 
  nextEdge: BoundaryEdge,
  layer: GridLayer
): EdgeType {
  const corner = prevEdge.to // Corner point
  
  // Analyze 3x3 neighborhood around corner
  const neighborhood = getNeighborhood(corner, layer)
  
  // Check for diagonal bridge pattern
  if (hasDiagonalBridge(neighborhood)) {
    return EdgeType.DIAGONAL_BRIDGE
  }
  
  // Determine if corner is convex or concave
  const turnDirection = getTurnDirection(prevEdge, nextEdge)
  
  if (turnDirection === 'left') {
    return EdgeType.ROUND_CONVEX
  } else if (turnDirection === 'right') {
    return EdgeType.ROUND_CONCAVE  
  } else {
    return EdgeType.STRAIGHT
  }
}
```

### Step 3: SVG Path Construction

```typescript
function generateSVGPath(boundaryPath: BoundaryPath): string {
  let pathData = `M ${boundaryPath.edges[0].from.x},${boundaryPath.edges[0].from.y}`
  
  for (let i = 0; i < boundaryPath.edges.length; i++) {
    const edge = boundaryPath.edges[i]
    const nextEdge = boundaryPath.edges[(i + 1) % boundaryPath.edges.length]
    
    const cornerType = classifyCorner(edge, nextEdge, boundaryPath.layer)
    
    switch (cornerType) {
      case EdgeType.STRAIGHT:
        pathData += ` L ${edge.to.x},${edge.to.y}`
        break
        
      case EdgeType.ROUND_CONVEX:
        const convexControl = calculateConvexControl(edge, nextEdge)
        pathData += ` C ${convexControl.x1},${convexControl.y1} ${convexControl.x2},${convexControl.y2} ${edge.to.x},${edge.to.y}`
        break
        
      case EdgeType.ROUND_CONCAVE:
        const concaveControl = calculateConcaveControl(edge, nextEdge)  
        pathData += ` C ${concaveControl.x1},${concaveControl.y1} ${concaveControl.x2},${concaveControl.y2} ${edge.to.x},${edge.to.y}`
        break
        
      case EdgeType.DIAGONAL_BRIDGE:
        const bridgeSegments = calculateBridgeSegments(edge, nextEdge)
        pathData += bridgeSegments.map(seg => ` ${seg.type} ${seg.coords.join(',')}`).join('')
        break
    }
  }
  
  pathData += ' Z' // Close path
  return pathData
}
```

## Mathematical Correspondence

The boundary tracing algorithm maintains **exact correspondence** with the blob rendering:

### Blob Quadrant → Boundary Segment Mapping:

| Blob Primitive | Boundary Equivalent |
|----------------|-------------------|
| Rectangle quadrant | Straight edge |
| Rounded corner quadrant | Curved corner (convex/concave) |
| Diagonal bridge quadrant | Bridge path segment |

### Geometric Parameters:
- **Grid size**: Same as blob rendering
- **Border width**: Becomes stroke width (not path offset)
- **Magic number 0.553**: Same Bézier control point calculation

## Output Format

```svg
<svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
  <g stroke="black" stroke-width="0.1" fill="none">
    <!-- Each connected component becomes one path -->
    <path d="M 50,50 C 55,50 60,55 60,60 L 60,100 C 60,105 55,110 50,110 L 10,110 C 5,110 0,105 0,100 L 0,60 C 0,55 5,50 10,50 Z"/>
    <path d="M 150,75 C 155,75 160,80 160,85 L 160,95 C 160,100 155,105 150,105 Z"/>
  </g>
</svg>
```

## Laser Cutting Optimizations

1. **Path Direction**: Ensure consistent winding (clockwise for outer boundaries)
2. **Nesting Order**: Cut inner shapes before outer to prevent drop-outs  
3. **Lead-in/Lead-out**: Add small entry/exit segments to prevent burn marks
4. **Bridge Connections**: For complex shapes, add temporary bridges to hold pieces

## Implementation Priority

1. **Phase 1**: Basic boundary tracing with straight edges
2. **Phase 2**: Add rounded corners matching blob aesthetic  
3. **Phase 3**: Implement diagonal bridge tracing
4. **Phase 4**: Laser cutting optimizations

This approach ensures that your laser cut pieces will have the **exact same visual aesthetic** as the on-screen blobs, but as proper cutting paths rather than filled shapes.