import { Button } from "@/components/ui/button"
import { Brush, Eraser, Hand, MousePointer, Circle, Layers } from "lucide-react"
import { useStore } from "@nanostores/react"
import { $currentTool, setCurrentTool, type Tool } from "@/stores/ui"

interface ToolSelectionProps {
  currentTool?: Tool // kept for backward compat but ignored if omitted
  onToolSelect?: (tool: Tool) => void // kept for backward compat
}

export type { Tool }

export const ToolSelection = ({ onToolSelect }: ToolSelectionProps) => {
  const currentTool = useStore($currentTool)

  const tools = [
    { id: "draw" as const, icon: Brush, label: "Draw", shortcut: "D" },
    { id: "erase" as const, icon: Eraser, label: "Erase", shortcut: "E" },
    { id: "pan" as const, icon: Hand, label: "Pan", shortcut: "P" },
    { id: "select" as const, icon: MousePointer, label: "Select", shortcut: "S" },
    { id: "cutout" as const, icon: Circle, label: "Cutout", shortcut: "O" },
    { id: "override" as const, icon: Layers, label: "Override", shortcut: "V" },
  ]

  const handleSelect = (tool: Tool) => {
    setCurrentTool(tool)
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
