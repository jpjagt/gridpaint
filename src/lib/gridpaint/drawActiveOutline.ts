const DEBUG_OUTLINE = false

interface RasterPoint {
  x: number
  y: number
  neighbors: boolean[][]
}

export function drawActiveLayerOutline(
  ctx: CanvasRenderingContext2D,
  point: RasterPoint,
  gridSize: number,
  color: string,
  borderWidth: number,
) {
  // Only render outline segments for the actual perimeter of the shape
  // This means we only draw edges that face empty space (no neighbors)
  const centerX = point.x * gridSize + gridSize / 2
  const centerY = point.y * gridSize + gridSize / 2
  const elementSize = gridSize / 2
  const magicNr = 0.553

  ctx.save()
  ctx.translate(centerX, centerY)
  ctx.lineWidth = borderWidth
  ctx.lineJoin = "round"
  ctx.lineCap = "round"

  const isCenter = point.neighbors[1][1]

  const hasBottomRightBridge =
    !isCenter && point.neighbors[2][1] && point.neighbors[1][2]
  const hasBottomLeftBridge =
    !isCenter && point.neighbors[1][2] && point.neighbors[0][1]
  const hasTopLeftBridge =
    !isCenter && point.neighbors[0][1] && point.neighbors[1][0]
  const hasTopRightBridge =
    !isCenter && point.neighbors[1][0] && point.neighbors[2][1]

  if (isCenter) {
    // Extract all neighbor-based conditions for active points
    const shouldDrawBottomRightCorner =
      !point.neighbors[2][1] && !point.neighbors[1][2] && !point.neighbors[2][2]
    const shouldDrawBottomLeftCorner =
      !point.neighbors[0][1] && !point.neighbors[1][2] && !point.neighbors[0][2]
    const shouldDrawTopLeftCorner =
      !point.neighbors[0][1] && !point.neighbors[1][0] && !point.neighbors[0][0]
    const shouldDrawTopRightCorner =
      !point.neighbors[2][1] && !point.neighbors[1][0] && !point.neighbors[2][0]

    const hasRightNeighbor = point.neighbors[2][1]
    const hasBottomNeighbor = point.neighbors[1][2]
    const hasLeftNeighbor = point.neighbors[0][1]
    const hasTopNeighbor = point.neighbors[1][0]

    const hasTopConnections = point.neighbors[1][0] || point.neighbors[2][0]
    const hasBottomConnections = point.neighbors[1][2] || point.neighbors[2][2]
    const hasLeftTopConnections = point.neighbors[1][0] || point.neighbors[0][0]
    const hasLeftBottomConnections =
      point.neighbors[1][2] || point.neighbors[0][2]
    const hasBottomLeftConnections =
      point.neighbors[0][1] || point.neighbors[0][2]
    const hasBottomRightConnections =
      point.neighbors[2][1] || point.neighbors[2][2]
    const hasTopLeftConnections = point.neighbors[0][1] || point.neighbors[0][0]
    const hasTopRightConnections =
      point.neighbors[2][1] || point.neighbors[2][0]

    // Check for bridges in adjacent empty pixels that would make our edges redundant
    // For right edge: check if bottom-right empty pixel has a bridge
    const hasAdjacentBottomRightBridge = !point.neighbors[2][2] && point.neighbors[2][1] && point.neighbors[1][2]
    // For bottom edge: check if bottom-right empty pixel has a bridge  
    const hasAdjacentBottomRightBridgeForBottom = !point.neighbors[2][2] && point.neighbors[2][1] && point.neighbors[1][2]
    // For top edge: check if top-right empty pixel has a bridge
    const hasAdjacentTopRightBridge = !point.neighbors[2][0] && point.neighbors[2][1] && point.neighbors[1][0]
    // For left edge: check if top-left empty pixel has a bridge
    const hasAdjacentTopLeftBridge = !point.neighbors[0][0] && point.neighbors[0][1] && point.neighbors[1][0]
    // For left edge: check if bottom-left empty pixel has a bridge
    const hasAdjacentBottomLeftBridge = !point.neighbors[0][2] && point.neighbors[0][1] && point.neighbors[1][2]

    // For active points, only draw the curves/edges that face empty space

    // Corner curves
    if (shouldDrawBottomRightCorner) {
      ctx.strokeStyle = DEBUG_OUTLINE ? "#ff0000" : "#000000"
      ctx.setLineDash(DEBUG_OUTLINE ? [] : [])
      ctx.beginPath()
      ctx.moveTo(elementSize, 0)
      ctx.bezierCurveTo(
        elementSize,
        elementSize * magicNr,
        elementSize * magicNr,
        elementSize,
        0,
        elementSize,
      )
      ctx.stroke()
    }

    if (shouldDrawBottomLeftCorner) {
      ctx.strokeStyle = DEBUG_OUTLINE ? "#ff0000" : "#000000"
      ctx.setLineDash(DEBUG_OUTLINE ? [] : [])
      ctx.beginPath()
      ctx.moveTo(0, elementSize)
      ctx.bezierCurveTo(
        -elementSize * magicNr,
        elementSize,
        -elementSize,
        elementSize * magicNr,
        -elementSize,
        0,
      )
      ctx.stroke()
    }

    if (shouldDrawTopLeftCorner) {
      ctx.strokeStyle = DEBUG_OUTLINE ? "#ff0000" : "#000000"
      ctx.setLineDash(DEBUG_OUTLINE ? [] : [])
      ctx.beginPath()
      ctx.moveTo(-elementSize, 0)
      ctx.bezierCurveTo(
        -elementSize,
        -elementSize * magicNr,
        -elementSize * magicNr,
        -elementSize,
        0,
        -elementSize,
      )
      ctx.stroke()
    }

    if (shouldDrawTopRightCorner) {
      ctx.strokeStyle = DEBUG_OUTLINE ? "#ff0000" : "#000000"
      ctx.setLineDash(DEBUG_OUTLINE ? [] : [])
      ctx.beginPath()
      ctx.moveTo(0, -elementSize)
      ctx.bezierCurveTo(
        elementSize * magicNr,
        -elementSize,
        elementSize,
        -elementSize * magicNr,
        elementSize,
        0,
      )
      ctx.stroke()
    }

    // Straight edges
    // Right edge
    if (!hasRightNeighbor) {
      ctx.strokeStyle = DEBUG_OUTLINE ? "#0000ff" : "#000000"

      if (hasTopConnections) {
        // Top is connected, draw from top
        ctx.setLineDash(DEBUG_OUTLINE ? [] : [])
        ctx.beginPath()
        ctx.moveTo(elementSize, -elementSize)
        ctx.lineTo(elementSize, 0)
        ctx.stroke()
      }
      if (hasBottomConnections && !hasAdjacentBottomRightBridge) {
        // Bottom is connected, draw to bottom
        // BUT suppress if there's a bridge in the bottom-right empty pixel
        ctx.setLineDash(DEBUG_OUTLINE ? [5, 5] : [])
        ctx.beginPath()
        ctx.moveTo(elementSize, 0)
        ctx.lineTo(elementSize, elementSize)
        ctx.stroke()
      }
    }

    // Bottom edge
    if (!hasBottomNeighbor) {
      ctx.strokeStyle = DEBUG_OUTLINE ? "#00ff00" : "#000000"
      ctx.setLineDash(DEBUG_OUTLINE ? [5, 5] : [])

      if (hasBottomLeftConnections && !hasAdjacentBottomLeftBridge) {
        // Left is connected, but suppress if there's a bridge in bottom-left empty pixel
        ctx.beginPath()
        ctx.moveTo(-elementSize, elementSize)
        ctx.lineTo(0, elementSize)
        ctx.stroke()
      }
      if (hasBottomRightConnections && !hasAdjacentBottomRightBridgeForBottom) {
        // Right is connected, but suppress if there's a bridge in bottom-right empty pixel
        ctx.beginPath()
        ctx.moveTo(0, elementSize)
        ctx.lineTo(elementSize, elementSize)
        ctx.stroke()
      }
    }

    // Left edge
    if (!hasLeftNeighbor) {
      ctx.strokeStyle = DEBUG_OUTLINE ? "#ffff00" : "#000000"

      if (hasLeftTopConnections && !hasAdjacentTopLeftBridge) {
        // Top is connected, but suppress if there's a bridge in top-left empty pixel
        ctx.setLineDash(DEBUG_OUTLINE ? [] : [])
        ctx.beginPath()
        ctx.moveTo(-elementSize, -elementSize)
        ctx.lineTo(-elementSize, 0)
        ctx.stroke()
      }
      if (hasLeftBottomConnections && !hasAdjacentBottomLeftBridge) {
        // Bottom is connected, but suppress if there's a bridge in bottom-left empty pixel
        ctx.setLineDash(DEBUG_OUTLINE ? [5, 5] : [])
        ctx.beginPath()
        ctx.moveTo(-elementSize, 0)
        ctx.lineTo(-elementSize, elementSize)
        ctx.stroke()
      }
    }

    // Top edge
    if (!hasTopNeighbor) {
      ctx.strokeStyle = DEBUG_OUTLINE ? "#ff00ff" : "#000000"
      ctx.setLineDash(DEBUG_OUTLINE ? [] : [])

      if (hasTopLeftConnections && !hasAdjacentTopLeftBridge) {
        // Left is connected, but suppress if there's a bridge in top-left empty pixel
        ctx.beginPath()
        ctx.moveTo(-elementSize, -elementSize)
        ctx.lineTo(0, -elementSize)
        ctx.stroke()
      }
      if (hasTopRightConnections && !hasAdjacentTopRightBridge) {
        // Right is connected, but suppress if there's a bridge in top-right empty pixel
        ctx.beginPath()
        ctx.moveTo(0, -elementSize)
        ctx.lineTo(elementSize, -elementSize)
        ctx.stroke()
      }
    }
  } else {
    // Bridge curves
    ctx.strokeStyle = DEBUG_OUTLINE ? "#00ffff" : "#000000"
    ctx.setLineDash(DEBUG_OUTLINE ? [] : [])
    ctx.lineWidth = DEBUG_OUTLINE ? borderWidth + 2 : borderWidth

    // Bottom-right bridge
    if (hasBottomRightBridge) {
      ctx.beginPath()
      ctx.moveTo(elementSize, 0)
      ctx.bezierCurveTo(
        elementSize,
        elementSize * magicNr,
        elementSize * magicNr,
        elementSize,
        0,
        elementSize,
      )
      ctx.stroke()
    }

    // Bottom-left bridge
    if (hasBottomLeftBridge) {
      ctx.save()
      ctx.rotate(Math.PI / 2)
      ctx.beginPath()
      ctx.moveTo(elementSize, 0)
      ctx.bezierCurveTo(
        elementSize,
        elementSize * magicNr,
        elementSize * magicNr,
        elementSize,
        0,
        elementSize,
      )
      ctx.stroke()
      ctx.restore()
    }

    // Top-left bridge
    if (hasTopLeftBridge) {
      ctx.save()
      ctx.rotate(Math.PI)
      ctx.beginPath()
      ctx.moveTo(elementSize, 0)
      ctx.bezierCurveTo(
        elementSize,
        elementSize * magicNr,
        elementSize * magicNr,
        elementSize,
        0,
        elementSize,
      )
      ctx.stroke()
      ctx.restore()
    }

    // Top-right bridge
    if (hasTopRightBridge) {
      ctx.save()
      ctx.rotate((3 * Math.PI) / 2)
      ctx.beginPath()
      ctx.moveTo(elementSize, 0)
      ctx.bezierCurveTo(
        elementSize,
        elementSize * magicNr,
        elementSize * magicNr,
        elementSize,
        0,
        elementSize,
      )
      ctx.stroke()
      ctx.restore()
    }
  }

  ctx.restore()
}
