# GridPaint Implementation TODOs

Based on the specification in `v2/docs/gridpaint.md` and current implementation in `v2/src/components/`, here are the remaining features grouped by implementation phase:

## Phase 1: Core Layer System ✅ COMPLETED
**Priority: High - Foundation for all other features**

- [x] **Layer Management UI**
  - [x] Layer buttons (1-6) in top-left corner
  - [x] Active layer highlighting
  - [x] Add new layer button (+ button, max 6 layers)
  - [x] Layer visibility toggles (eye icons)
  - [x] Support for no active layer (view-only mode)

- [x] **Multi-Layer State Management**
  - [x] Expand from single layer to 6-layer system
  - [x] Layer switching logic (1-6 keys)
  - [x] Layer creation/deletion
  - [x] Active layer tracking

- [x] **Layer Rendering Pipeline**
  - [x] Proper grayscale tinting for inactive layers
  - [x] Active layer highlighting (black with outline)
  - [x] Bottom-to-top layer compositing (6→1)
  - [x] Layer visibility filtering

## Phase 2: Tool System & Interaction ✅ COMPLETED
**Priority: High - Essential user interaction**

- [x] **Tool Selection UI**
  - [x] Tool buttons in center-bottom position
  - [x] Visual indicators for current tool
  - [x] Tool mode switching

- [x] **Enhanced Drawing Tools**
  - [x] Pan mode implementation (no painting while panning)
  - [x] Tool state management
  - [x] Proper cursor indicators per tool

- [x] **Keyboard Shortcuts**
  - [x] Layer switching (1-6 keys)
  - [x] Layer creation (+ key)
  - [x] Layer visibility toggle (Shift + 1-6)
  - [x] Tool shortcuts (D for draw, E for erase, P for pan)
  - [x] Center canvas (C key)
  - [x] Temporary erase mode (Option/Alt + mouse)
  - [x] Zoom controls (Cmd/Ctrl + plus/minus)

## Phase 3: Viewport & Navigation
**Priority: Medium - Enhanced usability**

- [x] **Zoom & Pan System**
  - [x] Mouse wheel zoom with grid alignment preservation
  - [x] Pan functionality with drag
  - [x] Viewport state management
  - [x] Smart bounds calculation from all visible layers

## Phase 4: Data Management
**Priority: Medium - Document system foundation**

- [ ] **Drawing Document Structure**
  - [ ] Document metadata (name, dates, ID)
  - [ ] Canvas dimensions and grid size storage
  - [ ] Multi-layer data serialization
  - [ ] Viewport state persistence

- [ ] **Local Storage System**
  - [ ] Drawing index management
  - [ ] Individual drawing storage
  - [ ] Auto-save functionality
  - [ ] Settings persistence

## Phase 5: Homepage & Gallery
**Priority: Medium - Application shell**

- [ ] **Homepage Interface**
  - [ ] Drawing gallery with 4:3 thumbnails
  - [ ] Responsive grid layout
  - [ ] Drawing management (create, duplicate, delete)
  - [ ] Click to open drawings

- [ ] **Thumbnail Generation**
  - [ ] Combined layer thumbnail rendering
  - [ ] Thumbnail caching system
  - [ ] Preview updates on save

- [ ] **Navigation System**
  - [ ] Homepage ↔ Editor transitions
  - [ ] Current drawing state management
  - [ ] Back to gallery functionality

## Phase 6: Export System
**Priority: Low - Advanced functionality**

- [ ] **SVG Export Foundation**
  - [ ] Path tracing algorithms for shape boundaries
  - [ ] Shape merging for continuous paths
  - [ ] Coordinate system conversion (grid → absolute)

- [ ] **Export Options**
  - [ ] Individual layer SVG files
  - [ ] Combined multi-layer SVG
  - [ ] Selected layers export
  - [ ] Viewport vs. full bounds export

- [ ] **Export UI**
  - [ ] Export dialog/controls
  - [ ] Format selection
  - [ ] Layer selection for export
  - [ ] Export progress feedback

## Phase 7: Performance & Polish
**Priority: Low - Optimization**

- [ ] **Rendering Optimization**
  - [ ] Neighbor detection caching
  - [ ] Shape geometry caching
  - [ ] Efficient hit-testing for large grids
  - [ ] Sparse grid representation

- [ ] **Memory Management**
  - [ ] Efficient layer switching
  - [ ] Canvas size limits
  - [ ] Thumbnail memory optimization

- [ ] **User Experience**
  - [ ] Loading states
  - [ ] Error handling
  - [ ] Responsive design improvements
  - [ ] Accessibility features

## Current Implementation Status

### ✅ Completed
- Basic blob rendering algorithm with neighbor detection
- Single layer drawing and erasing
- Grid-based painting system
- Canvas setup and mouse interaction
- Basic controls (reset, download, grid size, border width, draw/erase toggle)

### 🔄 In Progress
- Border width controls (partially implemented)

### ❌ Missing Critical Features
- Multi-layer system (currently only 1 layer)
- Layer management UI
- Tool selection UI
- Keyboard shortcuts
- Homepage/gallery system
- Drawing document management
- SVG export functionality

## Implementation Notes

- **Start with Phase 1** - The layer system is fundamental and affects all other features
- **Phase 2** should follow immediately as it builds on the layer foundation
- **Phases 5-7** can be implemented in parallel once core functionality is stable
- The current single-layer implementation provides a good foundation for the multi-layer system
- Blob rendering algorithm is solid and matches specification requirements
