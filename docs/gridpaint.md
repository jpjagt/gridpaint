# GridPaint Application Specification

## Overview

GridPaint is a multi-layer pixel art application that renders discrete grid points as connected blob shapes. It features a homepage for managing drawings, layered editing with visual feedback, and SVG export capabilities.

## Application Structure

### Homepage
- **Drawing Gallery**: Grid layout showing drawing thumbnails (4:3 aspect ratio)
- **Thumbnail Generation**: Auto-generated previews showing combined layer content
- **Drawing Management**: Click to open, create new, duplicate, or delete drawings
- **Local Storage**: All drawings persist in browser localStorage
- **Grid Layout**: Responsive thumbnail grid that adapts to screen size

### Drawing Editor
Full-screen canvas editor with layer management and tool controls.

## Core Canvas Concept

### Grid System
- Canvas divided into a regular grid of interaction points
- Grid size configurable (e.g., 25px, 50px, 75px spacing)
- Each grid point can be either "active" (painted) or "inactive" (empty)
- User can only paint at discrete grid locations, not freeform

### Blob Rendering Algorithm
Grid points don't render as simple squares or circles. Instead, each point analyzes its 8-directional neighborhood (3x3 grid) and renders quarter-circle segments that seamlessly connect with neighbors.

**Shape Types:**
- **Isolated points**: Render as perfect circles
- **Adjacent horizontal/vertical**: Merge into pill/capsule shapes
- **Diagonal connections**: Create organic bridges between offset points
- **Complex clusters**: Form smooth, continuous blob shapes

## Data Structure

### Drawing Document
Each drawing contains:
- Unique identifier and metadata (name, creation date, modified date)
- Canvas dimensions and grid size settings
- Array of layers (maximum 6 layers)
- Viewport state (zoom level, pan offset)

### Grid State
Each grid point maintains:
- Position (x, y coordinates in grid space)
- Active state (boolean: painted or empty)
- Neighbor map (3x3 boolean array of surrounding points)

### Layer System
- **Maximum 6 layers** per drawing
- Each layer contains independent grid state
- **Layer Ordering**: Layer 1 (top) to Layer 6 (bottom)
- **Visual Tinting**: Each layer renders with different grayscale values
  - Layer 1: Light gray tint
  - Layer 6: Dark gray tint
  - Active layer: Black color with outline highlight
- **Layer Visibility**: Individual toggle per layer
- **Active Layer**: Only one layer active for editing (or none)
- **Layer Compositing**: Visible layers overlay from bottom to top

## Rendering Specification

### Neighbor Detection
For each grid point, analyze 8 surrounding positions:
```
[NW] [N ] [NE]
[W ] [C ] [E ]
[SW] [S ] [SE]
```

Where C is the current point being rendered.

### Shape Generation
Each active point renders 4 quarter-segments (quadrants) based on neighbor patterns:

**Connected Quadrant (element0)**: 
- Renders when neighbors exist in that direction
- Creates rectangular quarter-segment for seamless connection

**Rounded Quadrant (element1)**:
- Renders when no neighbors in that direction  
- Creates bezier-curved quarter-segment for smooth endpoints

**Bridge Quadrant (element2)**:
- Renders on inactive points when diagonal neighbors are both active
- Creates connecting bridge shape between offset diagonal points

### Mathematical Constants
- Magic number for bezier curves: 0.553 (approximates quarter-circle)
- Quarter-segment size: gridSize / 2

## User Interface

### Layer Controls (Top Left)
- **Layer Buttons**: Small square buttons numbered 1-6
- **Active Layer Indicator**: Highlighted button shows current active layer
- **New Layer Button**: "+" button to create new layer (max 6)
- **Layer Visibility**: Eye icons below each layer button
- **No Active Layer**: Possible to have no layer selected for viewing only

### Tool Selection (Center Bottom)
- **Draw Mode**: Paint black blobs on active layer (default)
- **Erase Mode**: Remove painted areas from active layer
- **Pan Mode**: Navigate canvas without painting
- **Tool Icons**: Visual indicators for current mode selection

### Drawing Area
- **Layer Compositing**: All visible layers render simultaneously
- **Visual Hierarchy**: Active layer renders in black with outline highlight
- **Inactive Layers**: Render with grayscale tints (light to dark, top to bottom)
- **Grid Alignment**: All painting snaps to discrete grid positions

## User Interaction

### Mouse/Touch Input
- **Click**: Activate/deactivate single grid point on active layer
- **Drag**: Paint continuous stroke across multiple grid points
- **Draw Mode**: Activates grid points (paints blobs)
- **Erase Mode**: Deactivates grid points (removes blobs)
- **Pan Mode**: Drag to move viewport (no painting)

### Keyboard Shortcuts
- **1-6 Keys**: Switch to layer 1-6 (or deactivate if already active)
- **+ Key**: Create new layer (if under 6 layers)
- **Shift + 1-6**: Toggle visibility of layer 1-6
- **Option/Alt + Mouse**: Temporarily switch to erase mode while held
- **Cmd/Ctrl + (plus)**: Zoom in
- **Cmd/Ctrl + (minus)**: Zoom out
- **C Key**: Center canvas on drawing bounds (all visible layers)

### Viewport Controls
- **Mouse Wheel**: Zoom in/out (preserve grid alignment)
- **Pan/Scroll**: Navigate large canvases
- **Smart Centering**: Auto-calculate bounds from all visible layers
- **Grid Size Adjustment**: Regenerates entire grid layout

## Data Persistence

### Local Storage Architecture
- **Drawing Index**: Master list of all drawings with metadata
- **Individual Drawings**: Separate storage entries per drawing
- **Thumbnail Cache**: Pre-generated preview images for homepage
- **Settings**: User preferences (default grid size, tool selection)
- **Auto-Save**: Periodic saving during editing to prevent data loss

### Drawing Serialization
- **Compact Format**: Store only active grid points per layer (sparse representation)
- **Version Control**: Future-proof format for application updates
- **Import/Export**: JSON format for sharing drawings between devices

## Export Requirements

### SVG Generation
The blob shapes must be exportable as true vector graphics:

**Multi-Layer Export**: Each layer exports as separate SVG file or combined file with layer groups
- Individual layer files: `drawing-layer-1.svg`, `drawing-layer-2.svg`, etc.
- Combined file: Single SVG with grouped layers for editing in vector software
- Layer metadata: Preserve layer names and visibility state

**Shape Merging**: Adjacent blob segments should be combined into single SVG path elements, not overlapping shapes. This requires:
- Path tracing algorithms to find continuous shape boundaries
- Bezier curve optimization for smooth connections
- Elimination of internal overlapping geometry

**Coordinate System**: Export uses absolute coordinates, not grid-relative positioning, ensuring:
- Scalable vector output independent of original grid size
- Proper positioning when imported into other applications
- Maintains shape proportions across different grid densities

**Export Options**:
- All layers as separate files
- Combined multi-layer SVG file
- Selected layers only
- Current viewport region vs. full drawing bounds

## Performance Considerations

### Rendering Optimization
- Only recalculate neighbor detection when grid state changes
- Cache shape geometry for unchanged grid regions
- Efficient hit-testing for mouse interaction on large grids
- Layer compositing optimization for smooth real-time editing

### Memory Management
- Store only active grid points (sparse representation for large canvases)
- Efficient layer switching without full re-computation
- Reasonable limits on canvas size and layer count (max 6 layers)
- Thumbnail generation and caching for homepage performance

### Interaction Responsiveness
- Immediate visual feedback for tool mode changes
- Smooth zoom/pan operations that maintain grid alignment
- Efficient keyboard shortcut handling for layer switching
- Minimal delay for layer visibility toggling

## Technical Implementation Notes

### Coordinate Systems
- **Grid Coordinates**: Integer grid positions (0,0), (1,0), (1,1)...
- **Canvas Coordinates**: Pixel positions for rendering with zoom/pan transforms
- **Export Coordinates**: Absolute vector coordinates for SVG output

### Shape Precision
- Bezier curves must align precisely at grid boundaries
- Quarter-segments must tessellate without gaps or overlaps
- Consistent curve radius regardless of grid size
- Active layer outline renders on top of all blob shapes

### Layer Rendering Pipeline
1. Render layers bottom-to-top (6 → 1) with grayscale tints
2. Apply active layer highlighting (black color + outline)
3. Composite visible layers only
4. Apply viewport transforms (zoom/pan)
5. Overlay UI elements (layer controls, tool selection)

### State Management
- **Drawing State**: Current drawing data, active layer, tool mode
- **UI State**: Layer visibility, zoom level, pan offset, tool selection
- **Application State**: Homepage vs. editor mode, current drawing ID
- **Persistent State**: Auto-save intervals, localStorage synchronization