# GridPaint Blob Rendering Mathematical Specification

## Abstract

GridPaint implements a **grid-based morphological blob tessellation system** that converts discrete 2D point sets into continuous vector shapes with C¹ continuity (smooth tangent connections). This system is designed for laser cutting applications requiring clean vector paths.

## Mathematical Framework

### 1. Grid Space Definition

- **Grid G**: Integer lattice Z² with unit spacing
- **Point Set P**: Finite subset P ⊆ G of "filled" grid positions  
- **Neighborhood N(p)**: 3×3 Moore neighborhood around point p ∈ G

```
N(p) = {(x+dx, y+dy) | dx,dy ∈ {-1,0,1}} where p = (x,y)
```

### 2. Local Topology Classification

For each point p ∈ P, define **local connectivity function**:

```
C(p, direction) = 1 if (p + direction) ∈ P, else 0
```

Where direction vectors are:
- **Orthogonal**: {(0,1), (1,0), (0,-1), (-1,0)} (N,E,S,W)
- **Diagonal**: {(1,1), (1,-1), (-1,-1), (-1,1)} (NE,SE,SW,NW)

### 3. Geometric Primitive Decomposition

Each filled point p gets decomposed into **4 quadrants**, each rendered as one of three primitive types:

#### Primitive Type Classification (per quadrant):

**Element 0 (Rectangle)**: Orthogonal connection exists
```
Has orthogonal neighbor in quadrant direction OR adjacent orthogonal neighbors
```

**Element 1 (Rounded Corner)**: No connections in quadrant
```  
No neighbors in quadrant's 3 cells (orthogonal + diagonal + adjacent orthogonal)
```

**Element 2 (Diagonal Bridge)**: Only diagonal connection
```
Diagonal neighbor exists AND opposite diagonal also exists (bridge condition)
```

### 4. Quadrant Processing

For point p = (x,y), process 4 quadrants with rotations:

```
Quadrant SE (0°):   Check neighbors (E, SE, S)
Quadrant SW (90°):  Check neighbors (S, SW, W)  
Quadrant NW (180°): Check neighbors (W, NW, N)
Quadrant NE (270°): Check neighbors (N, NE, E)
```

### 5. Geometric Rendering Rules

#### Element 0 (Rectangle):
```
Rectangle from center to quadrant corner: [0,0] → [r,r]
where r = gridSize/2 + borderWidth
```

#### Element 1 (Rounded Corner with Bézier):
```
Path: [0,0] → [r,0] → Bézier([r,r×k], [r×k,r]) → [0,r] → close
where k = 0.553 (≈ 4×(√2-1)/3, circle approximation constant)
```

#### Element 2 (Diagonal Bridge):
```  
Path: [r,0] → Bézier([r,r×k], [r×k,r]) → [0,r] → [r,r] → close
```

## Topology Theorems

### Theorem 1: Connectivity Preservation
Connected components in grid space P map to connected regions in rendered space.

### Theorem 2: C¹ Continuity  
Adjacent primitives share tangent vectors at connection points due to Bézier curve parameterization.

### Theorem 3: Boundary Smoothness
The system generates **Jordan curves** (simple closed curves) for each connected component.

## For Laser Cutting: Path Extraction

Current implementation renders **filled shapes**. For laser cutting, we need **boundary paths**:

### Path Extraction Algorithm:
1. **Marching Squares** on the grid to extract outer boundaries
2. **Bézier Curve Fitting** to match blob aesthetic  
3. **Path Optimization** to minimize cuts

### Key Insight:
Instead of filling quadrants, trace the **boundary** of the blob shape using the same geometric rules but generating **stroke paths** instead of **fill regions**.

## Implementation Notes

- **Grid Size**: Physical size of each grid cell
- **Border Width**: Stroke width for tiled rendering mode  
- **Magic Number 0.553**: Mathematically derived constant for circular Bézier approximation
- **Layer Compositing**: Bottom-to-top rendering (Z-buffer style)

## Aesthetic Properties

This system creates **"pixel art that flows"** - maintaining grid-based structure while achieving organic, smooth connections that feel natural for both digital display and physical cutting.

The mathematical beauty is in the **local-to-global coherence**: simple neighborhood rules produce globally smooth, aesthetically pleasing shapes suitable for both visual rendering and precise fabrication.