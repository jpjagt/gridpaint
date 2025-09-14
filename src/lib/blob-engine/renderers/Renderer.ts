/**
 * Abstract Renderer interface for blob geometry rendering
 * 
 * This interface defines the contract for all blob renderers (Canvas2D, SVG, etc.)
 * enabling consistent rendering across different output formats.
 */

import type { 
  BlobGeometry, 
  BlobPrimitive, 
  CompositeGeometry, 
  RenderStyle, 
  GridPoint 
} from '../types'

export interface ViewportTransform {
  zoom: number
  panOffset: GridPoint
  viewportWidth: number
  viewportHeight: number
}

export interface RenderOptions {
  style: RenderStyle
  transform: ViewportTransform
  clipToViewport?: boolean
  showDebugInfo?: boolean
}

/**
 * Abstract base class for all renderers
 */
export abstract class Renderer {
  protected debugMode: boolean = false

  constructor(debugMode: boolean = false) {
    this.debugMode = debugMode
  }

  /**
   * Render complete composite geometry (all layers)
   * This is the main method used by canvas components
   */
  abstract renderComposite(
    geometry: CompositeGeometry, 
    options: RenderOptions
  ): void | string  // void for Canvas2D, string for SVG

  /**
   * Render a single layer's geometry
   */
  abstract renderLayer(
    geometry: BlobGeometry, 
    style: RenderStyle, 
    transform: ViewportTransform
  ): void | string

  /**
   * Render a single primitive
   */
  abstract renderPrimitive(
    primitive: BlobPrimitive, 
    style: RenderStyle, 
    transform: ViewportTransform
  ): void

  /**
   * Clear the rendering surface
   */
  abstract clear(): void

  /**
   * Set debug mode for development
   */
  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled
  }

  /**
   * Calculate world coordinates from grid coordinates
   */
  protected gridToWorld(gridPoint: GridPoint, gridSize: number): GridPoint {
    return {
      x: gridPoint.x * gridSize + gridSize / 2,
      y: gridPoint.y * gridSize + gridSize / 2
    }
  }

  /**
   * Apply viewport transform to world coordinates
   */
  protected worldToScreen(worldPoint: GridPoint, transform: ViewportTransform): GridPoint {
    return {
      x: (worldPoint.x * transform.zoom) + transform.panOffset.x,
      y: (worldPoint.y * transform.zoom) + transform.panOffset.y
    }
  }

  /**
   * Check if a primitive is visible in the current viewport
   */
  protected isPrimitiveVisible(
    primitive: BlobPrimitive, 
    transform: ViewportTransform
  ): boolean {
    const worldPos = this.gridToWorld(primitive.center, 0) // Use size 0 for quick check
    const screenPos = this.worldToScreen(worldPos, transform)
    const size = primitive.size * transform.zoom

    // Simple bounding box check
    return screenPos.x + size >= 0 && 
           screenPos.x - size <= transform.viewportWidth &&
           screenPos.y + size >= 0 && 
           screenPos.y - size <= transform.viewportHeight
  }

  /**
   * Get performance statistics (override in specific renderers)
   */
  getStats(): { [key: string]: any } {
    return {
      debugMode: this.debugMode
    }
  }
}

/**
 * Utility functions for all renderers
 */
export class RenderUtils {
  /**
   * Calculate bounding box for a set of primitives in screen space
   */
  static calculateScreenBounds(
    primitives: BlobPrimitive[], 
    gridSize: number,
    transform: ViewportTransform
  ): { minX: number, minY: number, maxX: number, maxY: number } {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

    for (const primitive of primitives) {
      const worldX = primitive.center.x * gridSize + gridSize / 2
      const worldY = primitive.center.y * gridSize + gridSize / 2
      const screenX = (worldX * transform.zoom) + transform.panOffset.x
      const screenY = (worldY * transform.zoom) + transform.panOffset.y
      const size = primitive.size * transform.zoom

      minX = Math.min(minX, screenX - size)
      minY = Math.min(minY, screenY - size)
      maxX = Math.max(maxX, screenX + size)
      maxY = Math.max(maxY, screenY + size)
    }

    return { minX, minY, maxX, maxY }
  }

  /**
   * Cull primitives that are outside the viewport
   */
  static cullPrimitives(
    primitives: BlobPrimitive[], 
    gridSize: number,
    transform: ViewportTransform,
    margin: number = 50  // Extra margin for safety
  ): BlobPrimitive[] {
    return primitives.filter(primitive => {
      const worldX = primitive.center.x * gridSize + gridSize / 2
      const worldY = primitive.center.y * gridSize + gridSize / 2
      const screenX = (worldX * transform.zoom) + transform.panOffset.x
      const screenY = (worldY * transform.zoom) + transform.panOffset.y
      const size = primitive.size * transform.zoom + margin

      return screenX + size >= -margin && 
             screenX - size <= transform.viewportWidth + margin &&
             screenY + size >= -margin && 
             screenY - size <= transform.viewportHeight + margin
    })
  }

  /**
   * Convert HSL color string to RGB values
   */
  static parseHSLColor(hslString: string): { r: number, g: number, b: number } | null {
    const match = hslString.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/)
    if (!match) return null

    const h = parseInt(match[1]) / 360
    const s = parseInt(match[2]) / 100
    const l = parseInt(match[3]) / 100

    const c = (1 - Math.abs(2 * l - 1)) * s
    const x = c * (1 - Math.abs((h * 6) % 2 - 1))
    const m = l - c / 2

    let r, g, b
    if (h < 1/6) {
      r = c; g = x; b = 0
    } else if (h < 2/6) {
      r = x; g = c; b = 0
    } else if (h < 3/6) {
      r = 0; g = c; b = x
    } else if (h < 4/6) {
      r = 0; g = x; b = c
    } else if (h < 5/6) {
      r = x; g = 0; b = c
    } else {
      r = c; g = 0; b = x
    }

    return {
      r: Math.round((r + m) * 255),
      g: Math.round((g + m) * 255),
      b: Math.round((b + m) * 255)
    }
  }
}