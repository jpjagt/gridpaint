import { useCallback, useMemo, useRef, useState } from 'react'
import { useStore } from '@nanostores/react'
import { $imageImport, setConfig } from '@/stores/imageImport'

function clamp01(v: number) { return Math.max(0, Math.min(1, v)) }

export function ImageCurveEditor() {
  const imageImport = useStore($imageImport)
  const size = 180
  const padding = 16
  const inner = size - padding * 2
  const p1 = imageImport.config.curve.p1
  const p2 = imageImport.config.curve.p2
  const bins = Math.max(1, Math.min(6, imageImport.config.bins))
  const darkestTop = imageImport.config.darkestTop !== false

  const toSvg = (x: number, y: number) => ({
    x: padding + x * inner,
    y: padding + (1 - y) * inner,
  })

  const fromSvg = (clientX: number, clientY: number, el: SVGElement) => {
    const rect = el.getBoundingClientRect()
    const x = clamp01((clientX - rect.left - padding) / inner)
    const y = 1 - clamp01((clientY - rect.top - padding) / inner)
    return { x, y }
  }

  const [dragging, setDragging] = useState<'p1' | 'p2' | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  const onPointerDown = (e: React.PointerEvent, target: 'p1' | 'p2') => {
    setDragging(target)
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging || !svgRef.current) return
    const pos = fromSvg(e.clientX, e.clientY, svgRef.current)
    const key = dragging === 'p1' ? 'p1' : 'p2'
    setConfig({ curve: { ...imageImport.config.curve, [key]: pos } })
  }
  const onPointerUp = (e: React.PointerEvent) => {
    setDragging(null)
    try { (e.currentTarget as Element).releasePointerCapture(e.pointerId) } catch {}
  }

  const sp = toSvg(0, 0)
  const ep = toSvg(1, 1)
  const cp1 = toSvg(p1.x, p1.y)
  const cp2 = toSvg(p2.x, p2.y)

  return (
    <div className="absolute bottom-4 left-4 bg-white/80 dark:bg-black/50 backdrop-blur-md rounded-md p-2 shadow min-w-[220px]">
      <div className="flex items-center gap-2 mb-2 justify-between">
        <div className="text-xs text-foreground/80">
          Mapping: <span className="font-mono">{darkestTop ? 'darkest → top' : 'darkest → bottom'}</span>
        </div>
        <label className="text-xs text-foreground/80">Layers</label>
        <select
          className="text-xs bg-transparent border rounded px-1 py-0.5"
          value={imageImport.config.bins}
          onChange={(e) => setConfig({ bins: Math.max(1, Math.min(6, parseInt(e.target.value))) })}
        >
          {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      <svg
        ref={svgRef}
        width={size}
        height={size}
        className="touch-none select-none bg-white/60 dark:bg-white/10 rounded"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {/* Background grid box */}
        <rect x={padding} y={padding} width={inner} height={inner} fill="none" stroke="rgba(0,0,0,0.2)"/>

        {/* Horizontal bin guides */}
        {Array.from({ length: bins + 1 }).map((_, i) => {
          const y = toSvg(0, i / bins).y
          return (
            <line key={`h-${i}`} x1={padding} y1={y} x2={padding + inner} y2={y}
              stroke={i === 0 || i === bins ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.15)'}
              strokeDasharray={i === 0 || i === bins ? '0' : '4 3'} />
          )
        })}

        {/* Identity diagonal y=x for reference */}
        <line x1={sp.x} y1={sp.y} x2={ep.x} y2={ep.y} stroke="rgba(0,0,0,0.25)" strokeDasharray="4 4" />

        {/* Curve */}
        <path d={`M ${sp.x} ${sp.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${ep.x} ${ep.y}`} stroke="blue" fill="none" strokeWidth={2} />
        {/* control lines */}
        <line x1={sp.x} y1={sp.y} x2={cp1.x} y2={cp1.y} stroke="rgba(0,0,255,0.3)" />
        <line x1={ep.x} y1={ep.y} x2={cp2.x} y2={cp2.y} stroke="rgba(0,0,255,0.3)" />
        {/* handles */}
        <circle cx={cp1.x} cy={cp1.y} r={6} fill="white" stroke="blue" onPointerDown={(e) => onPointerDown(e, 'p1')} />
        <circle cx={cp2.x} cy={cp2.y} r={6} fill="white" stroke="blue" onPointerDown={(e) => onPointerDown(e, 'p2')} />

        {/* Axes */}
        <line x1={padding} y1={padding + inner} x2={padding + inner} y2={padding + inner} stroke="currentColor" strokeWidth={1} />
        <line x1={padding} y1={padding + inner} x2={padding} y2={padding} stroke="currentColor" strokeWidth={1} />

        {/* X axis ticks */}
        {([0, 0.25, 0.5, 0.75, 1]).map((t, i) => {
          const x = toSvg(t, 0).x
          const y = padding + inner
          return (
            <g key={`xt-${i}`}>
              <line x1={x} y1={y} x2={x} y2={y + 4} stroke="currentColor" />
              <text x={x} y={y + 12} fontSize="10" textAnchor="middle" fill="currentColor">{t}</text>
            </g>
          )
        })}

        {/* Y axis bin labels */}
        {Array.from({ length: bins + 1 }).map((_, i) => {
          const y = toSvg(0, i / bins).y
          return (
            <text key={`yl-${i}`} x={padding - 6} y={y + 3} fontSize="9" textAnchor="end" fill="currentColor">{i}</text>
          )
        })}

        {/* Axis titles */}
        <text x={padding + inner / 2} y={padding + inner + 28} fontSize="11" textAnchor="middle" fill="currentColor">darkness (light → dark)</text>
        <text x={padding - 34} y={padding + inner / 2} fontSize="11" textAnchor="middle" fill="currentColor" transform={`rotate(-90 ${padding - 34},${padding + inner / 2})`}>
          bins (bottom → top)
        </text>
      </svg>
    </div>
  )
}
