import { Button } from "@/components/ui/button"
import { Brush, Eraser, Hand } from "lucide-react"

export type Tool = "draw" | "erase" | "pan"

interface ToolSelectionProps {
  currentTool: Tool
  onToolSelect: (tool: Tool) => void
}

export const ToolSelection = ({ currentTool, onToolSelect }: ToolSelectionProps) => {
  const tools = [
    { id: "draw" as const, icon: Brush, label: "Draw" },
    { id: "erase" as const, icon: Eraser, label: "Erase" },
    { id: "pan" as const, icon: Hand, label: "Pan" },
  ]

  return (
    <div className="fixed bottom-5 left-1/2 transform -translate-x-1/2 flex gap-2">
      {tools.map(({ id, icon: Icon, label }) => (
        <Button
          key={id}
          size="icon"
          variant={currentTool === id ? "default" : "ghost"}
          onClick={() => onToolSelect(id)}
          title={label}
        >
          <Icon className="w-5 h-5" />
        </Button>
      ))}
    </div>
  )
}