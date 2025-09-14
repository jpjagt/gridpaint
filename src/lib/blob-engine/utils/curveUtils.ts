/**
 * Curve path generation utilities for blob rendering
 * Generates bezier curves and geometric paths between arbitrary points
 */

import type { CurveType, GridPoint, SubgridPoint } from '../types'
import { magicNr } from '@/lib/constants'

export interface GeometricPath {
  type: 'rectangle' | 'bezierPath'
  points: number[]  // Flat array of x,y coordinates
  operations: ('moveTo' | 'lineTo' | 'bezierCurveTo' | 'closePath')[]
}

/**
 * Generate a bezier curve path between two arbitrary points with specified curve type
 */
export function generateCurvePath(
  startPoint: GridPoint | SubgridPoint,
  endPoint: GridPoint | SubgridPoint,
  curveType: CurveType,
  size: number
): GeometricPath {
  const startX = typeof startPoint.x === 'string' ? parseFloat(startPoint.x) : startPoint.x
  const startY = typeof startPoint.y === 'string' ? parseFloat(startPoint.y) : startPoint.y
  const endX = typeof endPoint.x === 'string' ? parseFloat(endPoint.x) : endPoint.x
  const endY = typeof endPoint.y === 'string' ? parseFloat(endPoint.y) : endPoint.y

  switch (curveType) {
    case 'convex-south-east':
    case 'convex-south-west':
    case 'convex-north-west':
    case 'convex-north-east':
      return generateConvexCurve(startX, startY, endX, endY, curveType, size)

    case 'line-south':
    case 'line-east':
    case 'line-west':
    case 'line-north':
      return generateStraightLine(startX, startY, endX, endY)

    case 'none':
      return generateStraightLine(startX, startY, endX, endY)

    default:
      throw new Error(`Unsupported curve type: ${curveType}`)
  }
}

/**
 * Generate a convex bezier curve (rounded corner style)
 */
function generateConvexCurve(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  curveType: CurveType,
  size: number
): GeometricPath {
  const controlPoint = size * magicNr

  // Calculate control points based on curve direction
  let cp1X: number, cp1Y: number, cp2X: number, cp2Y: number

  switch (curveType) {
    case 'convex-south-east':
      cp1X = startX + controlPoint
      cp1Y = startY
      cp2X = endX
      cp2Y = endY - controlPoint
      break
    case 'convex-south-west':
      cp1X = startX - controlPoint
      cp1Y = startY
      cp2X = endX
      cp2Y = endY - controlPoint
      break
    case 'convex-north-west':
      cp1X = startX - controlPoint
      cp1Y = startY
      cp2X = endX
      cp2Y = endY + controlPoint
      break
    case 'convex-north-east':
      cp1X = startX + controlPoint
      cp1Y = startY
      cp2X = endX
      cp2Y = endY + controlPoint
      break
    default:
      throw new Error(`Invalid convex curve type: ${curveType}`)
  }

  return {
    type: 'bezierPath',
    points: [
      startX, startY,
      cp1X, cp1Y, cp2X, cp2Y, endX, endY
    ],
    operations: ['moveTo', 'bezierCurveTo']
  }
}

/**
 * Generate a straight line path
 */
function generateStraightLine(
  startX: number,
  startY: number,
  endX: number,
  endY: number
): GeometricPath {
  return {
    type: 'rectangle',
    points: [startX, startY, endX, endY],
    operations: ['moveTo', 'lineTo']
  }
}

/**
 * Generate rounded corner path (Element 1) with arbitrary positioning
 * Path: [startX,startY] → [endX,startY] → Bézier([endX,startY+controlPoint], [endX-controlPoint,endY]) → [startX,endY] → close
 */
export function generateRoundedCornerPath(
  startX: number = 0,
  startY: number = 0,
  size: number
): GeometricPath {
  const controlPoint = size * magicNr

  return {
    type: 'bezierPath',
    points: [
      startX, startY,
      startX + size, startY,
      startX + size, startY + controlPoint,
      startX + controlPoint, startY + size,
      startX, startY + size
    ],
    operations: ['moveTo', 'lineTo', 'bezierCurveTo', 'closePath']
  }
}

/**
 * Generate diagonal bridge path (Element 2) with arbitrary positioning
 * Uses convex curve from the empty point's perspective
 * Path: [startX+size,startY] → Bézier([startX+size,startY+controlPoint], [startX+controlPoint,startY+size]) → [startX,startY+size] → [startX+size,startY+size] → close
 */
export function generateDiagonalBridgePath(
  startX: number = 0,
  startY: number = 0,
  size: number
): GeometricPath {
  const controlPoint = size * magicNr

  return {
    type: 'bezierPath',
    points: [
      startX + size, startY,
      startX + size, startY + controlPoint,
      startX + controlPoint, startY + size,
      startX, startY + size,
      startX + size, startY + size
    ],
    operations: ['moveTo', 'bezierCurveTo', 'lineTo', 'closePath']
  }
}

/**
 * Generate rectangle path with arbitrary positioning
 */
export function generateRectanglePath(
  startX: number = 0,
  startY: number = 0,
  width: number,
  height: number = width
): GeometricPath {
  return {
    type: 'rectangle',
    points: [startX, startY, width, height],
    operations: ['moveTo', 'lineTo', 'lineTo', 'lineTo', 'closePath']
  }
}