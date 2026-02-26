import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

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
            <KbdRow keys="D" description="Draw — paint points on the active group" />
            <KbdRow keys="E" description="Erase — remove points (also clears overrides + cutouts)" />
            <KbdRow keys="P" description="Pan — drag to pan the canvas" />
            <KbdRow keys="S" description="Select — rectangle select, copy/paste/delete" />
            <KbdRow keys="O" description="Cutout — add circular cutouts to existing points" />
            <KbdRow keys="V" description="Override — paint per-quadrant shape overrides" />
            <KbdRow keys="T" description="Measure — drag to measure distance in mm" />
            <KbdRow keys="X" description="Export — draw rects to define SVG export regions" />
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

          <Section title="Viewport">
            <KbdRow keys="C" description="Center canvas to content" />
            <KbdRow keys="M" description="Toggle measuring overlay (mm grid)" />
            <KbdRow keys="ctrl + scroll" description="Zoom toward cursor" />
            <KbdRow keys="scroll / two-finger drag" description="Pan" />
          </Section>

          <Section title="Copy / Paste / Selection">
            <KbdRow keys={["cmd/ctrl", "C"]} description="Copy selection (select tool)" />
            <KbdRow keys={["cmd/ctrl", "V"]} description="Paste at cursor — enters floating mode (select tool)" />
            <KbdRow keys="↑ ↓ ← →" description="Lift selection into floating mode and nudge 1 grid unit; or move floating paste 1 grid unit" />
            <KbdRow keys={["shift", "↑ ↓ ← →"]} description="Lift/move active layer only (selection); or move floating paste 10 grid units" />
            <KbdRow keys={["alt", "↑ ↓ ← →"]} description="Lift and nudge 10 grid units" />
            <KbdRow keys="drag inside selection" description="Lift and drag selected points (all layers); bakes on release" />
            <KbdRow keys={["shift", "drag"]} description="Lift and drag active layer only; bakes on release" />
            <KbdRow keys="Enter" description="Place / bake floating paste" />
            <KbdRow keys="Escape" description="Cancel floating paste / clear selection" />
            <KbdRow keys={["Delete", "/ Backspace"]} description="Delete selected points from current layer" />
            <KbdRow keys={["shift", "Delete"]} description="Delete selected points from all layers" />
          </Section>

          <Section title="Cutout Tool (O)">
            <KbdRow keys="Q" description="Anchor: center" />
            <KbdRow keys="X" description="Anchor: SE" />
            <KbdRow keys="Z" description="Anchor: SW" />
            <KbdRow keys="A" description="Anchor: NW" />
            <KbdRow keys="W" description="Anchor: NE" />
            <KbdRow keys="alt + click" description="Clear all cutouts on a point" />
          </Section>

          <Section title="Override Tool (V)">
            <KbdRow keys="F" description="Shape: full" />
            <KbdRow keys="R" description="Shape: empty" />
            <KbdRow keys="T" description="Shape: convex-SE" />
            <KbdRow keys="G" description="Shape: convex-SW" />
            <KbdRow keys="B" description="Shape: convex-NW" />
            <KbdRow keys="Y" description="Shape: convex-NE" />
            <KbdRow keys="H" description="Shape: concave-SE" />
            <KbdRow keys="N" description="Shape: concave-SW" />
            <KbdRow keys="U" description="Shape: concave-NW" />
            <KbdRow keys="J" description="Shape: concave-NE" />
            <KbdRow keys="alt + click" description="Clear override on a quadrant" />
          </Section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
