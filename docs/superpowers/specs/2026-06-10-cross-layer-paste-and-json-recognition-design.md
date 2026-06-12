# Cross-layer duplication + robust JSON paste

Date: 2026-06-10

## Problem

Two loosely related selection/clipboard improvements:

1. **Cross-layer duplication.** With the select tool active and a live selection, the
   user wants to duplicate that selection's content (groups, point modifications,
   overrides) from one layer onto another layer.
2. **Flaky cross-tab JSON paste.** Pasting a valid `gridpaint-selection` JSON payload
   into another tab "works only sometimes" or does nothing. It should always work when
   a valid payload is on the clipboard, and be ignored otherwise.

## Current behavior (baseline)

- **Copy** (`cmd+c`, select tool + selection): `copySelection` in
  `src/hooks/useSelection.ts` collects points across **all** layers within the
  selection bounds, tags each chunk with its source `layerId`, and writes a JSON
  payload (`type: "gridpaint-selection"`, `version: "2.0.0"`) via
  `navigator.clipboard.writeText`.
- **Paste** (`cmd+v`): the keydown handler in `GridPaintCanvas.tsx` calls
  `pasteSelection`, which `navigator.clipboard.readText()` → `JSON.parse` →
  accepts only `parsed.type === "gridpaint-selection"`, then enters "floating paste"
  mode at the cursor grid position.
- **Bake / cancel** (`bakeFloatingPaste`, `cancelFloatingPaste`): map clipboard data
  back to layers by stored `layerId` (`layers.find(l => l.id === clipGroup.layerId)`).
- **Move / delete** already use the convention: **active layer only** by default,
  **all layers** with `Shift`.
- Image paste is handled separately in `useImagePaste` via the **native `paste`
  event**.

### Flakiness root causes

1. `if (e.target !== document.body) return` in the keydown handler — bails whenever
   focus is on anything other than `<body>`.
2. `if (currentTool === "select")` guard — paste silently no-ops unless the select
   tool is active.
3. Async `navigator.clipboard.readText()` — racy / permission-dependent, decoupled
   from the actual paste gesture.

## Design

### Part 1 — Copy semantics: active vs. all layers

Make copy symmetric with the existing move/delete convention.

- `cmd+c` → copy **active layer only** within the selection (common case).
- `cmd+shift+c` → copy **all layers** (today's behavior).

`copySelection` gains an `activeLayerOnly: boolean` parameter. When `true`, it
iterates only the active layer, producing a clipboard with exactly **one**
`ClipboardLayer`. Payload format is unchanged — only the number of layers it
contains differs.

### Part 2 — Paste targeting by clipboard shape

One rule, applied in `pasteSelection` / `bakeFloatingPaste` / `cancelFloatingPaste`:

- **Single-layer clip** (`data.layers.length === 1`) → retarget that layer's content
  onto the **currently active layer** (ignore the stored `layerId`).
- **Multi-layer clip** → honor original `layerId`s (current behavior).

Implementation: when resolving the target layer for each clip layer, use
`activeLayerId` if the clip is single-layer, else `clipLayer.layerId`. Group and
`pointModifications` re-keying is otherwise unchanged (target group = matching id or
first group on the resolved layer).

**Resulting cross-layer flow:** `cmd+c` → switch layer (number keys 1–6) → paste →
arrow-key position → `Enter`. No picker, no new concept.

Note: a lifted float (`lifted: true`, produced by arrow-move) is single-layer when the
move was active-layer-only. Its cancel path must restore to the **original** layer, not
the active one. Guard the retarget so it only applies to clipboard pastes
(`lifted` falsy), preserving lift/restore correctness.

### Part 3 — Robust JSON paste via a shared paste dispatcher

Replace the synthetic `cmd+v` keydown branch with handling on the **native `paste`
event**. Generalize `useImagePaste` into a shared paste dispatcher (e.g.
`usePasteDispatcher`, or keep the file and add a JSON branch) that, on native paste:

1. If `e.clipboardData` contains an image item → existing image-import flow.
2. Else read `e.clipboardData.getData("text")` and attempt `JSON.parse`.
3. **Recognition** — treat as a gridpaint selection if:
   `parsed.type === "gridpaint-selection"` **OR**
   (`Array.isArray(parsed.data?.layers)` **and** `parsed.data?.bounds` is present).
   This tolerates version drift / minor variants while ignoring unrelated JSON.
4. If recognized → `e.preventDefault()`, enter floating-paste mode positioned at
   **viewport center**, regardless of active tool or focus.
5. If not valid JSON / not recognized → do nothing; let the event pass through.

**Removed:** the `cmd+v` keydown branch and its guards (`e.target !== document.body`,
`currentTool === "select"`, async `readText`). `cmd+c` / `cmd+shift+c` stay on keydown
(copy has no native-event hook we need).

**Viewport-center positioning:** compute the center grid cell from `$canvasView`
(`panOffset`, `zoom`, `gridSize`) using the same math `useImagePaste` already uses, and
set it as the floating paste `origin` with `offset {0,0}`.

## Components touched

- `src/hooks/useSelection.ts` — `copySelection(activeLayerOnly)`; single-layer retarget
  in `pasteSelection` / `bakeFloatingPaste` / `cancelFloatingPaste`; a
  `pasteData(clipboardData, atGrid)` entry point usable by the dispatcher (so paste no
  longer needs to read the clipboard itself).
- `src/hooks/useImagePaste.ts` → shared paste dispatcher with image + JSON branches and
  the recognition predicate.
- `src/components/GridPaintCanvas.tsx` — remove the `cmd+v` keydown branch; add
  `cmd+shift+c` for all-layers copy; keep arrow/Enter/Escape floating-paste handling.

## Testing

- `copySelection(true)` yields a single-layer clip containing only active-layer points.
- `copySelection(false)` yields the multi-layer clip (unchanged).
- Single-layer clip pastes onto the active layer even when active != source layer.
- Multi-layer clip pastes onto original layers.
- Lifted active-layer float cancels back to its original layer (retarget guard).
- Recognition predicate: accepts canonical payload, accepts a payload with a different
  `version` and the layers/bounds shape, rejects unrelated JSON and non-JSON text.
- Paste fires regardless of active tool and focused element (native paste event).

## Out of scope

- Layer-picker UI / context menu for choosing a target layer.
- Changing the clipboard payload format or version.
- Multi-rectangle / non-rectangular selections.
