/**
 * RigPanel - side panel of the assembly rig tool: which rect, pillars vs
 * glue mode, per-layer lock status, glue warnings, print setup and export.
 */

import { useEffect, useState } from "react"
import { useStore } from "@nanostores/react"
import { Loader2 } from "lucide-react"
import { $currentTool } from "@/stores/ui"
import {
  $drawingMeta,
  $exportRects,
  $glueSpots,
  $layersState,
} from "@/stores/drawingStores"
import {
  $printSetup,
  $rigAnalysis,
  $rigAnalyzing,
  $rigToolSettings,
  addGlueSpots,
  getRig,
  rigRect,
  startRigAnalysis,
  updateRig,
} from "@/stores/rigStores"
import { buildRigParts } from "@/lib/rig/mesh"
import { export3mf, exportStlZip } from "@/lib/rig/exportRig"
import { spotFrom } from "@/lib/rig/rigInteraction"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { PrintSetup } from "@/types/rig"

export function RigPanel() {
  const currentTool = useStore($currentTool)
  if (currentTool !== "rig") return null
  return <RigPanelContent />
}

function RigPanelContent() {
  const exportRects = useStore($exportRects)
  const settings = useStore($rigToolSettings)
  const analysis = useStore($rigAnalysis)
  const analyzing = useStore($rigAnalyzing)
  const layersState = useStore($layersState)
  const setup = useStore($printSetup)
  const drawingMeta = useStore($drawingMeta)
  const [showSetup, setShowSetup] = useState(false)

  useEffect(() => startRigAnalysis(), [])

  const rect = rigRect(exportRects, settings.rectId)
  const rig = rect ? getRig(rect) : null
  const activeLayerId = layersState.activeLayerId
  const current = analysis && rect && analysis.rectId === rect.id ? analysis : null

  const iface = current?.interfaces.find((i) => i.layerId === activeLayerId)
  const activeSpots = current?.glueSpots.filter((s) => s.layerId === activeLayerId) ?? []
  const uncovered = current?.glueSpots.filter((s) => s.issue === "uncovered") ?? []
  const tight = current?.glueSpots.filter((s) => s.issue === "tight") ?? []

  if (!rect || !rig) {
    return (
      <Panel>
        <p className='text-xs text-muted-foreground font-mono'>
          Draw an export rect first (X), then come back to build its rig.
        </p>
      </Panel>
    )
  }

  const fileName = [drawingMeta.name, rect.name, "rig"].filter(Boolean).join("-")
  const exportParts = (format: "3mf" | "stl") => {
    if (!current) return
    const built = buildRigParts(current, setup, rig.reverse ?? false)
    if (format === "3mf") export3mf(built, fileName)
    else exportStlZip(built, fileName)
  }

  const firstLayer = current?.layers[0]?.layerId

  return (
    <Panel>
      <div className='flex items-center justify-between'>
        <span className='text-xs font-mono font-semibold'>Assembly rig</span>
        {analyzing && <Loader2 className='w-3.5 h-3.5 animate-spin text-muted-foreground' />}
      </div>

      {exportRects.length > 1 && (
        <Row label='Rect'>
          <Segmented
            value={rect.id}
            options={exportRects.map((r, i) => ({
              value: r.id,
              label: r.name || `#${i + 1}`,
            }))}
            onChange={(id) => $rigToolSettings.setKey("rectId", id)}
          />
        </Row>
      )}

      <Row label='Edit'>
        <Segmented
          value={settings.mode}
          options={[
            { value: "pillars", label: "Pillars" },
            { value: "glue", label: "Glue" },
          ]}
          onChange={(mode) => $rigToolSettings.setKey("mode", mode)}
        />
      </Row>

      <Row label='Place'>
        <Segmented
          value={rig.reverse ? "down" : "up"}
          options={[
            { value: "up", label: "Face up" },
            { value: "down", label: "Face down" },
          ]}
          onChange={(v) =>
            updateRig(rect.id, (r) => ({ ...r, reverse: v === "down" }))
          }
        />
      </Row>
      {firstLayer !== undefined && (
        <p className='text-[10px] text-muted-foreground font-mono'>
          Order: {current?.layers.map((l) => l.layerId).join(" → ")} (layer{" "}
          {firstLayer} first)
        </p>
      )}

      <div className='h-px bg-border' />

      {settings.mode === "pillars" ? (
        <>
          <div className='flex flex-col gap-0.5'>
            {current?.locks.map((lock) => (
              <div
                key={lock.layerId}
                className='flex items-center justify-between text-xs font-mono'
              >
                <span>Layer {lock.layerId}</span>
                <span
                  className={cn(
                    lock.locked ? "text-green-600" : "text-orange-500",
                  )}
                >
                  {lock.locked
                    ? lock.pieces > 1
                      ? `${lock.pieces} pieces held ✓`
                      : "held ✓"
                    : lock.pieces > 1
                      ? `${lock.lockedPieces}/${lock.pieces} pieces held ⚠`
                      : `${Math.round(lock.blockedFraction * 100)}% held ⚠`}
                </span>
              </div>
            ))}
          </div>
          <p className='text-[10px] text-muted-foreground font-mono'>
            {rig.pillars.length} placed · {current?.suggestedPillars.length ?? 0}{" "}
            suggested. Click a cell to add/remove a pillar; labels list the
            layers it holds.
          </p>
          {current?.suggestedPillars.length === 0 &&
            current.locks.some((l) => !l.locked) && (
              <p className='text-[10px] text-orange-500 font-mono'>
                No pillar position can hold the remaining layers any better.
              </p>
            )}
          <div className='flex gap-1.5'>
            <Button
              size='sm'
              variant='secondary'
              className='h-7 text-xs flex-1'
              disabled={!current || current.suggestedPillars.length === 0}
              onClick={() =>
                current &&
                updateRig(rect.id, (r) => ({
                  ...r,
                  pillars: [
                    ...r.pillars,
                    ...current.suggestedPillars.map(({ x, y }) => ({ x, y })),
                  ],
                }))
              }
            >
              Accept suggestions
            </Button>
            <Button
              size='sm'
              variant='ghost'
              className='h-7 text-xs'
              disabled={rig.pillars.length === 0}
              onClick={() => updateRig(rect.id, (r) => ({ ...r, pillars: [] }))}
            >
              Clear
            </Button>
          </div>
        </>
      ) : (
        <>
          {iface ? (
            <p className='text-xs font-mono'>
              Layer {iface.lowerId} ↔ {iface.layerId}: glue goes on layer{" "}
              {iface.baseLayerId}. {activeSpots.length} spot
              {activeSpots.length === 1 ? "" : "s"}.
            </p>
          ) : (
            <p className='text-xs text-muted-foreground font-mono'>
              Select the upper layer of a glued pair (layer 2 = glue between 1
              and 2).
            </p>
          )}
          {uncovered.length > 0 && (
            <p className='text-xs text-red-500 font-mono'>
              ⚠ {uncovered.length} glue spot{uncovered.length === 1 ? "" : "s"} not
              covered by both layers (layer{" "}
              {[...new Set(uncovered.map((s) => s.layerId))].join(", ")})
            </p>
          )}
          {tight.length > 0 && (
            <p className='text-[10px] text-orange-500 font-mono'>
              {tight.length} spot{tight.length === 1 ? "" : "s"} closer than{" "}
              {setup.glueMargin}mm to an edge
            </p>
          )}
          <p className='text-[10px] text-muted-foreground font-mono'>
            Click to add/remove a spot; dashed rings are suggestions.
          </p>
          <div className='flex gap-1.5'>
            <Button
              size='sm'
              variant='secondary'
              className='h-7 text-xs flex-1'
              disabled={
                !current ||
                !current.suggestedGlueSpots.some((s) => s.layerId === activeLayerId)
              }
              onClick={() =>
                current &&
                addGlueSpots(
                  current.suggestedGlueSpots
                    .filter((s) => s.layerId === activeLayerId)
                    .map((s) => spotFrom(s, setup.glueDiameter)),
                )
              }
            >
              Accept
            </Button>
            <Button
              size='sm'
              variant='secondary'
              className='h-7 text-xs flex-1'
              disabled={!current || current.suggestedGlueSpots.length === 0}
              onClick={() =>
                current &&
                addGlueSpots(
                  current.suggestedGlueSpots.map((s) => spotFrom(s, setup.glueDiameter)),
                )
              }
            >
              Accept all layers
            </Button>
            <Button
              size='sm'
              variant='ghost'
              className='h-7 text-xs'
              disabled={activeSpots.length === 0}
              onClick={() =>
                $glueSpots.set(
                  $glueSpots.get().filter(
                    (s) =>
                      !activeSpots.some(
                        (a) => a.layerId === s.layerId && a.x === s.x && a.y === s.y,
                      ),
                  ),
                )
              }
            >
              Clear
            </Button>
          </div>
        </>
      )}

      <div className='h-px bg-border' />

      <button
        type='button'
        onClick={() => setShowSetup((v) => !v)}
        className='text-left text-xs font-mono text-muted-foreground hover:text-foreground'
      >
        {showSetup ? "▾" : "▸"} Print setup
        <span className='text-[10px]'> (all drawings)</span>
      </button>
      {showSetup && <PrintSetupFields setup={setup} />}

      <div className='flex gap-1.5'>
        <Button
          size='sm'
          className='h-7 text-xs flex-1'
          disabled={!current || current.pillars.length === 0}
          onClick={() => exportParts("3mf")}
        >
          Download 3MF
        </Button>
        <Button
          size='sm'
          variant='secondary'
          className='h-7 text-xs'
          disabled={!current || current.pillars.length === 0}
          onClick={() => exportParts("stl")}
        >
          STLs
        </Button>
      </div>
    </Panel>
  )
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className='fixed top-20 right-5 w-72 max-h-[calc(100vh-10rem)] overflow-y-auto bg-background/90 backdrop-blur-sm border border-border rounded-lg p-3 shadow-lg z-10 flex flex-col gap-2'
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className='flex items-center gap-2'>
      <span className='w-10 text-[10px] text-muted-foreground font-mono shrink-0'>
        {label}
      </span>
      {children}
    </div>
  )
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className='flex flex-wrap gap-0.5'>
      {options.map((o) => (
        <button
          key={o.value}
          type='button'
          onClick={() => onChange(o.value)}
          className={cn(
            "text-xs font-mono px-2 py-0.5 rounded transition-colors",
            value === o.value
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

const SETUP_FIELDS: { key: keyof PrintSetup; label: string; step: number }[] = [
  { key: "clearance", label: "Clearance", step: 0.05 },
  { key: "basePlateThickness", label: "Base plate", step: 0.2 },
  { key: "minWall", label: "Min wall", step: 0.1 },
  { key: "stencilThickness", label: "Stencil", step: 0.1 },
  { key: "glueDiameter", label: "Glue spot ⌀", step: 0.1 },
  { key: "glueMargin", label: "Glue margin", step: 0.1 },
  { key: "outlineDepth", label: "Outline depth", step: 0.1 },
]

function PrintSetupFields({ setup }: { setup: PrintSetup }) {
  return (
    <div className='flex flex-col gap-1'>
      {SETUP_FIELDS.map(({ key, label, step }) => (
        <label
          key={key}
          className='flex items-center justify-between text-xs font-mono text-muted-foreground'
        >
          {label}
          <span className='flex items-center gap-1'>
            <input
              type='number'
              min={0}
              step={step}
              value={setup[key] as number}
              onChange={(e) => {
                const v = parseFloat(e.target.value)
                if (Number.isFinite(v) && v >= 0) $printSetup.setKey(key, v)
              }}
              onKeyDown={(e) => e.stopPropagation()}
              className='w-16 bg-muted/50 text-xs text-foreground border border-border rounded px-1.5 py-0.5 font-mono outline-none'
            />
            mm
          </span>
        </label>
      ))}
      {(
        [
          ["glueMarkers", "Glue markers on pillars"],
          ["plateOutlines", "Shape outlines on base plate"],
        ] as const
      ).map(([key, label]) => (
        <label
          key={key}
          className='flex items-center gap-1.5 text-xs font-mono text-muted-foreground cursor-pointer select-none'
        >
          <input
            type='checkbox'
            checked={setup[key]}
            onChange={(e) => $printSetup.setKey(key, e.target.checked)}
            className='w-3 h-3'
          />
          {label}
        </label>
      ))}
    </div>
  )
}
