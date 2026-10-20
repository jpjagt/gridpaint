import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { FULL_KEY, TOOL_KEYS } from "@/lib/keymap"

interface ShortcutsModalProps {
  isOpen: boolean
  onClose: () => void
}

function KbdRow({ keys, description }: { keys: string | string[]; description: string }) {
  const keyList = Array.isArray(keys) ? keys : [keys]
  return (
    <tr className="border-b border-border/40 last:border-0">
      <td className="py-1.5 pr-4 whitespace-nowrap">
        <span className="flex gap-1">
          {keyList.map((k) => (
            <kbd
              key={k}
              className="px-1.5 py-0.5 text-xs font-mono bg-muted border border-border rounded"
            >
              {k}
            </kbd>
          ))}
        </span>
      </td>
      <td className="py-1.5 text-sm text-muted-foreground">{description}</td>
    </tr>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
        {title}
      </h3>
      <table className="w-full">
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export function ShortcutsModal({ isOpen, onClose }: ShortcutsModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-5 mt-2">
          <Section title="Tools">
            <KbdRow keys={TOOL_KEYS.draw} description="Draw — paint points on the active group" />
            <KbdRow keys={TOOL_KEYS.erase} description="Erase — remove points (also clears overrides + cutouts)" />
            <KbdRow keys={TOOL_KEYS.pan} description="Pan — drag to pan the canvas" />
            <KbdRow keys={TOOL_KEYS.select} description="Select — rectangle select, copy/paste/delete" />
            <KbdRow keys={TOOL_KEYS.shape} description="Shape — drag a rectangle or ellipse, then place it" />
            <KbdRow keys={TOOL_KEYS.cutout} description="Cutout (hole) — add circle or pill cutouts to existing points" />
            <KbdRow keys={TOOL_KEYS.override} description="Override — paint per-quadrant shape overrides" />
            <KbdRow keys={TOOL_KEYS.measure} description="Measure (tape) — drag to measure distance in mm" />
            <KbdRow keys={TOOL_KEYS.export} description="Export — drag rects to define export regions" />
          </Section>

          <Section title="Drawing">
            <KbdRow keys="alt + drag" description="Invert draw/erase (temporary erase while drawing)" />
            <KbdRow keys={["cmd/ctrl", "Z"]} description="Undo" />
            <KbdRow keys={["cmd/ctrl", "shift", "Z"]} description="Redo" />
          </Section>

          <Section title="Layers">
            <KbdRow keys={["1", "–", "6"]} description="Switch to layer (creates if it doesn't exist)" />
            <KbdRow keys="[ already active ]" description="Deactivate layer (view-only mode)" />
          </Section>

          <Section title="Interaction Groups">
            <KbdRow keys="]" description="Next group (creates new if current group is non-empty)" />
            <KbdRow keys="[" description="Previous group (collapses empty trailing groups)" />
          </Section>

          <Section title="Layer & Group Options (Layer Controls)">
            <KbdRow
              keys="½ button"
              description="Half-offset (per group): shifts the group's drawn shapes by half a grid cell in both directions. Each group is its own offset, so you can mix normal and half-offset regions on one layer. Half-offset shapes fuse with normal shapes where they meet."
            />
            <KbdRow
              keys="scale ⅓–3×"
              description="Layer scale (per layer): renders the whole layer — shapes and corner radii — larger or smaller. ⅓/½ shrink, 2×/3× enlarge, 1× is default. Applies to canvas, SVG, and DXF export."
            />
          </Section>

          <Section title="Viewport">
            <KbdRow keys="C" description="Center canvas to content" />
            <KbdRow keys="M" description="Toggle measuring overlay (mm grid)" />
            <KbdRow keys="ctrl + scroll" description="Zoom toward cursor" />
            <KbdRow keys="scroll / two-finger drag" description="Pan" />
          </Section>

          <Section title="Copy / Paste / Selection">
            <KbdRow keys={["cmd/ctrl", "C"]} description="Copy active layer's selection (select tool)" />
            <KbdRow keys={["cmd/ctrl", "shift", "C"]} description="Copy all layers' selection (select tool)" />
            <KbdRow keys={["cmd/ctrl", "V"]} description="Paste — floats at viewport center; paste to active layer for single-layer copies (any tool)" />
            <KbdRow keys="↑ ↓ ← →" description="Lift selection into floating mode and nudge 1 grid unit; or move floating paste 1 grid unit" />
            <KbdRow keys={["shift", "↑ ↓ ← →"]} description="Lift/move all layers (selection); or move floating paste 10 grid units" />
            <KbdRow keys={["alt", "↑ ↓ ← →"]} description="Lift and nudge 10 grid units" />
            <KbdRow keys="drag inside selection" description="Lift and drag selected points (active layer only); bakes on release" />
            <KbdRow keys={["shift", "drag"]} description="Lift and drag all layers; bakes on release" />
            <KbdRow keys="Enter" description="Place / bake floating paste" />
            <KbdRow keys="Escape" description="Cancel floating paste / clear selection" />
            <KbdRow keys="G (hold)" description="Display Center of Gravity for visible layers in selection" />
            <KbdRow keys={["Delete", "/ Backspace"]} description="Delete selected points from current layer" />
            <KbdRow keys={["shift", "Delete"]} description="Delete selected points from all layers" />
          </Section>

          <Section title={`Cutout Tool (${TOOL_KEYS.cutout})`}>
            <KbdRow keys={["I", "O", "K", "L"]} description="Anchor: NW, NE, SW, SE corner (laid out like the corners)" />
            <KbdRow keys="click" description="Place circle, or set first / second pill center" />
            <KbdRow keys="Escape" description="Cancel unfinished pill" />
            <KbdRow keys={["shift", "click"]} description="Add cutout to all layers with point" />
            <KbdRow keys={["alt", "click"]} description="Remove hovered cutout from active layer" />
            <KbdRow keys={["alt", "shift", "click"]} description="Clear all cutouts at point from all layers" />
          </Section>

          <Section title={`Override Tool (${TOOL_KEYS.override})`}>
            <KbdRow keys={FULL_KEY} description="Shape: full" />
            <KbdRow keys={["shift", FULL_KEY]} description="Shape: empty" />
            <KbdRow keys={["I", "O", "K", "L"]} description="Shape: convex NW, NE, SW, SE (laid out like the quadrants)" />
            <KbdRow keys={["shift", "I O K L"]} description="Shape: concave NW, NE, SW, SE" />
            <KbdRow keys="alt + click" description="Clear override on a quadrant" />
          </Section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
