import { Button } from "@/components/ui/button"
import { Brush, Eraser, Hand, MousePointer, Circle, Layers, Ruler, BoxSelect, Square, Fence } from "lucide-react"
import { useStore } from "@nanostores/react"
import { $currentTool, selectTool, type Tool } from "@/stores/ui"
import { TOOL_KEYS } from "@/lib/keymap"

interface ToolSelectionProps {
  currentTool?: Tool // kept for backward compat but ignored if omitted
  onToolSelect?: (tool: Tool) => void // kept for backward compat
}

export type { Tool }

export const ToolSelection = ({ onToolSelect }: ToolSelectionProps) => {
  const currentTool = useStore($currentTool)

  const tools = [
    { id: "draw" as const, icon: Brush, label: "Draw" },
    { id: "erase" as const, icon: Eraser, label: "Erase" },
    { id: "pan" as const, icon: Hand, label: "Pan" },
    { id: "select" as const, icon: MousePointer, label: "Select" },
    { id: "cutout" as const, icon: Circle, label: "Cutout" },
    { id: "override" as const, icon: Layers, label: "Override" },
    { id: "shape" as const, icon: Square, label: "Shape" },
    { id: "measure" as const, icon: Ruler, label: "Measure" },
    { id: "export" as const, icon: BoxSelect, label: "Export" },
    { id: "rig" as const, icon: Fence, label: "Assembly rig" },
  ].map((t) => ({ ...t, shortcut: TOOL_KEYS[t.id] }))

  const handleSelect = (tool: Tool) => {
    selectTool(tool)
    onToolSelect?.(tool)
  }

  return (
    <div className="fixed bottom-5 left-1/2 transform -translate-x-1/2 flex gap-2">
      {tools.map(({ id, icon: Icon, label, shortcut }) => (
        <Button
          key={id}
          size="icon"
          variant={currentTool === id ? "default" : "ghost"}
          onClick={() => handleSelect(id)}
          title={`${label} (${shortcut})`}
          kbShortcut={shortcut}
        >
          <Icon className="w-5 h-5" />
        </Button>
      ))}
    </div>
  )
}
