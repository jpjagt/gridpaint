# Repository Guidelines for AI Coding Agents

## What is GridPaint?

**GridPaint** is a multi-layer pixel art application that renders discrete grid points as connected blob shapes. Users paint on a grid, but instead of squares/circles, adjacent points merge into smooth organic shapes using Bezier curves. Features:
- **Multi-layer editing** (up to 6 layers) with visual hierarchy
- **Blob rendering engine** that analyzes 3×3 neighborhoods to generate smooth connected shapes
- **Drawing tools** (draw, erase, pan) with keyboard shortcuts
- **LocalStorage persistence** with auto-save
- **SVG export** capabilities

See `docs/gridpaint.md` for full specification.

## Project Structure

```
src/
├── components/           # React components (PascalCase)
│   ├── ui/              # Shadcn/ui primitives
│   └── GridPaintCanvas.tsx, LayerControls.tsx, etc.
├── lib/
│   ├── blob-engine/     # Core rendering: NeighborhoodAnalyzer, PrimitiveGenerator, BlobEngine
│   ├── storage/         # LocalStorage persistence
│   ├── export/          # SVG/PNG export utilities
│   └── gridpaint/       # Drawing utilities
├── stores/              # Nanostores: drawingStores.ts, ui.ts
├── types/               # TypeScript type definitions
├── hooks/               # Custom React hooks
└── main.tsx, App.tsx, globals.css
```

## Build, Test, and Development Commands

**Package Manager**: `pnpm` (preferred)

**Core Commands**:
```bash
pnpm install                    # Install dependencies
pnpm dev                        # Start Vite dev server with HMR
pnpm build                      # TypeScript check + Vite production build
pnpm preview                    # Preview production build locally
pnpm lint                       # Run ESLint on TS/TSX files
```

**Testing**:
- **No formal test framework** configured yet
- Ad-hoc testing: Create `test-*.js` scripts in project root (e.g., `node test-blob-primitives.js`)
- **Future recommendation**: Vitest + React Testing Library; place specs under `src/**/__tests__/`
- Keep tests deterministic with logged expected results

**Running a Single Test**:
- Currently: `node test-<specific-test>.js` for individual test scripts
- When test framework added: `pnpm test <test-file-pattern>` or `pnpm test -- -t "test name"`

## Coding Style & Naming Conventions

**Language**: TypeScript (strict). React 18 with Vite.

**Naming**:
- **Files/Components**: PascalCase (e.g., `GridPaintCanvas.tsx`)
- **Variables/functions**: camelCase
- **Constants**: SCREAMING_SNAKE_CASE (when global)
- **Types**: PascalCase (e.g., `LayerState`, `CanvasView`)

**Import Conventions** (CRITICAL):
```typescript
// ✅ ALWAYS use @ alias for src imports
import { something } from "@/lib/utils"
import type { LayerState } from "@/types/gridpaint"

// ❌ NEVER use relative imports to parent directories
import { something } from "../../lib/utils"  // WRONG!
```

**Type Organization**:
- **Always** place types and interfaces in `src/types/*.ts` files
- **Exception**: Component `Props` types can be kept inline with components

**Formatting**:
- **No Prettier** configured; follow ESLint rules in `.eslintrc.cjs`
- **Indentation**: 2 spaces
- **Semicolons**: Optional (project is consistent without them)
- **Line length**: Keep reasonable (<120 chars preferred)

**ESLint**: Standard config with `@typescript-eslint` and `react-hooks` plugins

## State Management & Architecture

**Nanostores** (`@nanostores/react`):
- Core stores: `$loadingState`, `$drawingMeta`, `$canvasView`, `$layersState` (in `src/stores/drawingStores.ts`)
- Use `useStore($storeName)` hook; update with `$storeName.set(newValue)`

**Styling**:
- Tailwind CSS (primary), Styled Components + Twin.macro, Radix UI, Shadcn/ui (New York style)
- Theme: CSS variables in `globals.css` (`--canvas-layer-1` through `--canvas-layer-6`, etc.)
- Use `getCanvasColor()` helper for theme-aware colors

**Error Handling**:
- Try-catch for async/storage operations
- Log with context: `console.error("Failed to...", error)`
- User-facing errors via Sonner toasts

## Architecture & Key Concepts

**Blob Engine** (`src/lib/blob-engine/`):
1. **NeighborhoodAnalyzer**: Classifies 3×3 cell neighborhoods, determines per-quadrant primitive type (external, bridge, none)
2. **PrimitiveGenerator**: Generates Bezier curve segments for each quadrant based on classification
3. **GeometryCache**: Caches computed geometry for performance
4. **BlobEngine**: Orchestrates analysis → primitive generation → rendering
5. **Renderers**: Canvas2D and SVG path generation

**Layer System**:
- Multi-layer support (up to 6 layers)
- Bottom-to-top compositing (layers 6→1)
- Individual visibility and render style controls
- Keyboard shortcuts: 1-6 (switch layer), + (create), Shift+1-6 (toggle visibility)

**Tool System**:
- Draw, Erase, Pan tools with keyboard shortcuts: D, E, P
- Center canvas: C key
- Temporary erase: Alt/Option + mouse
- Zoom: Cmd/Ctrl + plus/minus, mouse wheel

**Data Persistence**:
- LocalStorage-based (`src/lib/storage/store.ts`)
- Auto-save functionality
- Document structure with metadata, layer data, canvas settings

## UI Controls & Components

The canvas editor UI is composed of four control components. **Keep this list up to date when adding, removing, or moving any tool, button, or control.**

| File | Location | Purpose |
|------|----------|---------|
| `src/components/GridPaintControls.tsx` | Top-right + bottom-right overlays | Title input, home/download/shortcuts/theme buttons, sync status, grid size (+/−), mm-per-unit input, measuring bars toggle |
| `src/components/LayerControls.tsx` | Top-left overlay | Layer select buttons (1–6), visibility toggle, render style toggle, group indicator; also owns keyboard shortcuts for layer switching (`1–6`, `[`, `]`) and tool selection (`D/E/P/S/O/V`) |
| `src/components/ToolSelection.tsx` | Bottom-center overlay | Tool picker buttons: Draw, Erase, Pan, Select, Cutout, Override |
| `src/components/ToolOptionsPanel.tsx` | Bottom-center overlay (above tool bar, context-sensitive) | Extra options for active tool: cutout anchor/diameter, override shape selector |

## Keyboard Shortcuts

All keyboard shortcuts are documented in two places that **must be kept in sync**:

1. **`README.org`** — the `* controls` section (org-mode tables)
2. **`src/components/ShortcutsModal.tsx`** — the in-app help modal (opened via the `?` button in the top-right toolbar)

**When modifying keyboard shortcut behaviour**, always update both of the above locations.

## Commit & Pull Request Guidelines

**Commit Format**: Conventional Commits (`feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`)
- Keep commits small and focused
- Clear scope and motivation in commit body when non-trivial
- Update docs/scripts when behavior changes

**Pull Requests**:
- Concise description with rationale
- Before/after screenshots for UI changes
- Steps to verify the changes

## Security & Configuration

- Never commit secrets; use environment variables for API keys
- Firebase/hosting config in `firebase.json` and `.firebaserc`

## Development Notes

**Current Implementation Status**:
- ✅ Core drawing application (Phases 1-3): Multi-layer system, tools, viewport
- ✅ LocalStorage persistence with auto-save
- ⚠️ Homepage gallery: Basic structure exists, needs thumbnail system
- ⚠️ Export system: Basic utilities exist, needs advanced SVG/path tracing
- ❌ Performance optimization: Needs rendering cache improvements

**Key Implementation Philosophy**:
- Grid-based coordinate system for pixel art precision
- Blob rendering for smooth connected shapes
- Layer compositing from bottom-to-top (6→1)
- Reactive state with Nanostores for clean separation of concerns
