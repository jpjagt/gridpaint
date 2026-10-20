# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

**Core Development:**
- `pnpm dev` - Start development server with hot reload
- `pnpm build` - Build for production (runs TypeScript compilation + Vite build)
- `pnpm lint` - Run ESLint with TypeScript support
- `pnpm preview` - Preview production build locally

**Package Management:**
- Uses `pnpm` as package manager (pnpm-lock.yaml present)

## Architecture Overview

GridPaint is a React-based pixel art/grid drawing application implementing a **multi-layer grid painting system** with advanced blob rendering and comprehensive tool support.

**Project Status: Phases 1-3 COMPLETED ✅**
Based on the original roadmap, the core foundation (layers, tools, viewport) is fully implemented.

**State Management:**
- Uses **Nanostores** for reactive state management (`@nanostores/react`)
- Core stores located in `src/stores/drawingStores.ts`:
  - `$loadingState` - Application loading state
  - `$drawingMeta` - Drawing metadata (id, name, timestamps)
  - `$canvasView` - Canvas view state (grid size, pan, zoom, border width)
  - `$layersState` - Layer management state with up to 6 layers

**Core Components (IMPLEMENTED):**
- `GridPaintCanvas` - Main P5.js-based drawing canvas with full multi-layer support
- `LayerControls` - Complete layer management UI (create, visibility, render styles)
- `GridPaintControls` - Drawing controls (reset, download, grid size, border width)
- `ToolSelection` - Tool selection interface (draw, erase, pan modes)

**Layer System (FULLY IMPLEMENTED):**
- **Multi-layer support** (up to 6 layers) with individual visibility controls
- **Layer rendering pipeline** with proper grayscale tinting for inactive layers
- **Active layer highlighting** with outline effects
- **Bottom-to-top compositing** (layers 6→1)
- **Keyboard shortcuts** for layer switching (1-6 keys), creation (+), visibility (Shift+1-6)

**Tool System (FULLY IMPLEMENTED):**
- **Draw, Erase, Pan tools** with visual indicators
- **Keyboard shortcuts**: D (draw), E (erase), P (pan), C (center canvas)
- **Temporary erase mode** (Alt/Option + mouse)
- **Zoom controls** (Cmd/Ctrl + plus/minus)

**Viewport & Navigation (FULLY IMPLEMENTED):**
- **Mouse wheel zoom** with grid alignment preservation
- **Pan functionality** with drag
- **Smart bounds calculation** from all visible layers
- **Center canvas functionality**

**Data Persistence (IMPLEMENTED):**
- `src/lib/storage/store.ts` - LocalStorage-based drawing persistence
- `src/lib/storage/types.ts` - Type definitions for stored data
- **Document structure** with metadata, layer data, and canvas settings
- **Auto-save functionality** integrated

**Routing (IMPLEMENTED):**
- Uses React Router with HashRouter
- Routes: `/` (home), `/grids/:drawingId` (editor)

## Remaining TODO Items (Phases 4-7)

**Phase 5: Homepage & Gallery (PARTIALLY IMPLEMENTED)**
- ✅ Basic homepage exists (`src/components/Home.tsx`)
- ❌ Drawing gallery with thumbnails
- ❌ Thumbnail generation system
- ❌ Drawing management (create, duplicate, delete)

**Phase 6: Export System (PARTIALLY IMPLEMENTED)**
- ✅ Basic export utilities exist (`src/lib/export/exportUtils.ts`)
- ❌ Advanced SVG export with path tracing
- ❌ Multi-layer export options
- ❌ Export UI/dialog

**Phase 7: Performance & Polish**
- ❌ Rendering optimization and caching
- ❌ Memory management improvements
- ❌ Enhanced UX and accessibility

## Technology Stack

**Frontend Framework:**
- React 18 with TypeScript
- Vite for build tooling and development server

**Styling:**
- Tailwind CSS with custom theme configuration
- Styled Components with Twin.macro for CSS-in-JS
- Radix UI for accessible component primitives
- Next-themes for dark/light mode support

**Canvas/Graphics:**
- P5.js for 2D drawing and canvas manipulation

**State & Data:**
- Nanostores for reactive state management
- LocalStorage for data persistence

**UI Components:**
- Custom components built on Radix UI primitives
- Lucide React for icons
- Sonner for toast notifications

## Import Conventions

- Use `@/` prefix for imports from src folder (configured in vite.config.ts and tsconfig.json)
- Types and interfaces should be placed in `src/types/*.ts` files
- Component-specific Props types are kept inline with components

## Key Files to Understand

**Core Architecture:**
- `src/stores/drawingStores.ts` - Central state management and drawing operations
- `src/components/GridPaintCanvas.tsx` - Main canvas component with P5.js integration
- `src/lib/storage/store.ts` - Data persistence layer
- `src/App.tsx` - Main routing and editor page structure

**Implemented Components:**
- `src/components/LayerControls.tsx` - Complete layer management UI
- `src/components/ToolSelection.tsx` - Tool selection interface
- `src/components/GridPaintControls.tsx` - Drawing controls and settings
- `src/components/Home.tsx` - Homepage component (basic implementation)

**Drawing System:**
- `src/lib/gridpaint/drawActiveOutline.ts` - Active layer outline rendering
- `src/lib/export/exportUtils.ts` - Export functionality
- `src/types/gridpaint.ts` - Core type definitions

## Development Notes

**Current State:** The core drawing application (Phases 1-3) is fully functional with:
- Complete multi-layer system (up to 6 layers)
- Full tool suite (draw, erase, pan) with keyboard shortcuts
- Zoom/pan viewport with smart bounds
- LocalStorage persistence
- Blob rendering with neighbor detection

**Next Development Priorities:**
1. **Homepage Gallery** - Implement thumbnail grid and drawing management
2. **Advanced Export** - SVG export with path tracing algorithms  
3. **Performance** - Rendering optimization for large grids

**Implementation Philosophy:**
- Grid-based coordinate system for pixel art precision
- Blob rendering algorithm for smooth connected shapes
- Layer compositing from bottom-to-top (6→1)
- Reactive state management with Nanostores

## Theming System

**Semantic Canvas Theming:**
GridPaint implements a semantic theming system that follows shadcn/ui conventions for consistent styling across light and dark modes.

**Canvas-Specific Color Tokens:**
- `--canvas-background` - Main canvas background color
- `--canvas-grid-line` - Grid line color (if implemented)
- `--canvas-layer-1` - Layer 1 color (lightest grey)
- `--canvas-layer-2` - Layer 2 color
- `--canvas-layer-3` - Layer 3 color
- `--canvas-layer-4` - Layer 4 color
- `--canvas-layer-5` - Layer 5 color
- `--canvas-layer-6` - Layer 6 color (darkest grey)
- `--canvas-layer-border` - Border color for tiled layer rendering
- `--canvas-outline-active` - Active layer outline color
- `--canvas-outline-bridge` - Bridge outline color

**Layer Color System:**
- Each layer (1-6) has its own dedicated color variable for consistent visual hierarchy
- Layer 1 uses the lightest grey (86% lightness), Layer 6 uses the darkest (36% lightness)
- Grey values remain the same in both light and dark modes for consistency
- Only borders and outlines switch between black (light mode) and white (dark mode)

**Usage Guidelines:**
- Canvas components use `getCanvasColor()` helper to retrieve theme-aware colors at runtime
- Each layer references its specific color token: `getCanvasColor('--canvas-layer-${layer.id}')`
- Export functionality (SVG/PNG) deliberately ignores theming and uses hardcoded colors for consistency
- Theme colors are defined in `src/globals.css` with separate light/dark mode values
- All color tokens follow HSL format for easy manipulation
## Infinite Runner (`#/runner`)

A promo tool: a ball runs forever through generated landscapes built from the same blob shapes, cut into layers along the direction of travel. Code in `src/lib/runner/`, page in `src/components/runner/RunnerPage.tsx`, types in `src/types/runner.ts`, all defaults in `src/lib/runner/config.ts`.

- **Corner tiles** (`tiles.ts`): the blob rule re-expressed as 16 tiles centred on grid corners (marching-squares style), each depending only on the 4 surrounding cells. Verified against `NeighborhoodAnalyzer` in `__tests__/tiles.test.ts`. Outlines never fall on tile borders, so tiled shapes are seamless.
- **Mesher** (`mesher.ts`): builds chunk buffers (fronts, side walls, outlines, layer seams, metal faces with normals). Culls fronts hidden by the slice in front, merges walls along Z, and limits near chunks to the columns the camera can see. A tile's case byte carries shape bits 0-15 plus `METAL_BIT`.
- **World** (`world/`): `generator.ts` (biome zones with noise-mask cross-fades, ground/walkway, tunnels, optional seamless loop), `biomes.ts` (desert, ruins, dream, plains, megacity), `structures.ts` (lattice-placed, optionally mirror-symmetric shapes; off-path structures are pushed off the path, on-path ones get a doorway).
- **Engine** (`RunnerEngine.ts`): generation and meshing run in `worker.ts`. The camera and character stay at the origin and chunks move (distance is a double, so no float drift). At most one chunk is uploaded per frame, with distance-based LOD and adaptive resolution. `renderAt()` drives the offline export.
- **Output**: `R` records a realtime WebM; `V` / `?record=loop` exports a frame-exact MP4 via WebCodecs (`videoExport.ts`), exactly one loop when `loop` is set.
- **URL params**: `seed, speed, depth, seams, fog, at, biome, loop, metal, env, palette, night, quality=low|high, res=WxH, fps, record=loop, ui=0`. Keys: hold Space boost, P pause, C next palette, X random palette, G settings, H stats, V export, R record.
- **Far ground**: past the grid, a flat plane (masked per chunk by a ground ring-buffer texture) continues to the horizon. Rows run from `MIN_ROW` (-36, the void) to `maxRow`.

## Assembly Rig (tool `A`)

Generates a 3D-printable jig for gluing an export rect's metal layers, plus glue stencils. Code in `src/lib/rig/`, state in `src/stores/rigStores.ts`, panel `src/components/RigPanel.tsx`, types in `src/types/rig.ts`, design in `docs/superpowers/specs/2026-10-20-assembly-rig-design.md`.

- **Thickness**: `$canvasView.layerThickness` (per drawing, default 1mm) with `ExportRect.customThickness` override; resolve with `resolveRectThickness` / `resolveRectMmPerUnit` (`src/lib/export/rectSettings.ts`). Used by the 3D preview, STL export and the rig.
- **Assembly order**: highest layer id first (face up), `rig.reverse` = face down (mirrors the rig in x).
- **Pillars** (`analyze.ts`): a pillar at grid point (x, y) is its cell minus the clearance-grown union of all layers placed so far, per band, so every layer drops straight in. It holds the layers whose outline it hugs; a layer is "locked" when its contacts block ≥95% of sampled in-plane motions (translation + rotation). Suggestions are greedy (most newly blocked motion per plastic), then pruned.
- **Glue spots**: stored per drawing in `$glueSpots`, keyed by the higher layer id of a pair (layer 2 = glue between 1 and 2); glue goes on whichever of the pair is placed first. Spots not covered by both layers are flagged.
- **Geometry**: mm, SVG frame (grid point centred at x·mmPerUnit). Outlines come from `svgRings.ts` (DOM-free SVG path flattening) so analysis runs in `worker.ts`. Polygon booleans/offsets via `clipper-lib` wrapped in `clip.ts`.
- **Base plate** (`plate.ts`): union of layer footprints and pillar feet, grown by 2mm with narrow gaps closed; separate islands are joined by 4mm bridges (minimum spanning tree).
- **Export** (`mesh.ts`, `exportRig.ts`): 3MF with the rig and one stencil per glued pair as separate objects, or a zip of STLs. Pillars get triangular slots pointing at nearby glue spots, cut from the pillar top down to the glued layer's top.
- **Print setup** (clearance, base plate, min wall, stencil thickness, glue spot size/margin) is per browser in localStorage (`$printSetup`).

