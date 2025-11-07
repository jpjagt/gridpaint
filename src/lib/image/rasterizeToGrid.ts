import type { ImageSource, ImageTransform, LightnessMappingConfig } from '@/stores/imageImport'

// Compute inverse-affine mapping from grid space (grid units) to image pixel space
// Grid point p_g = (gx, gy). Local image coords p_i = R^-1 * ((p_g - C) / s) + (0,0)
// where C is center in grid units, s is grid units per pixel, R is rotation about center.

function degToRad(deg: number) { return (deg * Math.PI) / 180 }

function invertPointToImagePixels(
  gx: number,
  gy: number,
  transform: ImageTransform,
): { x: number; y: number } {
  const { cx, cy, scale, rotationDeg } = transform
  const dx = gx - cx
  const dy = gy - cy
  const theta = degToRad(-rotationDeg)
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  // Undo rotation
  const rx = dx * cos - dy * sin
  const ry = dx * sin + dy * cos
  // Undo scale (grid units per pixel)
  const px = rx / scale
  const py = ry / scale
  return { x: px, y: py }
}

function luminanceFromRGBA(r: number, g: number, b: number): number {
  // sRGB relative luminance (approx)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

export interface RasterizeParams {
  image: ImageSource
  imageSize: { width: number; height: number }
  transform: ImageTransform
  gridSize: number // size of a grid cell in screen pixels (not used directly, we work in grid units)
  config: LightnessMappingConfig
  // Optional to speed up: restrict to these grid bounds, else compute from corners
  bounds?: { minX: number; minY: number; maxX: number; maxY: number }
}

// Draw image to an offscreen canvas and return ImageData for sampling
function getImageData(image: ImageSource, size: { width: number; height: number }): ImageData {
  const { width, height } = size
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(image as CanvasImageSource, 0, 0)
  return ctx.getImageData(0, 0, width, height)
}

function transformCornersToGrid(
  size: { width: number; height: number },
  transform: ImageTransform,
): { minX: number; minY: number; maxX: number; maxY: number } {
  // Map four image corners from image pixels to grid units
  const corners = [
    { x: 0, y: 0 },
    { x: size.width, y: 0 },
    { x: 0, y: size.height },
    { x: size.width, y: size.height },
  ]
  const theta = degToRad(transform.rotationDeg)
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const c of corners) {
    // Scale from pixels to grid units
    const sx = c.x * transform.scale
    const sy = c.y * transform.scale
    // Rotate around origin then translate to center
    const rx = sx * cos - sy * sin
    const ry = sx * sin + sy * cos
    const gx = transform.cx + rx
    const gy = transform.cy + ry
    minX = Math.min(minX, gx)
    minY = Math.min(minY, gy)
    maxX = Math.max(maxX, gx)
    maxY = Math.max(maxY, gy)
  }
  return { minX, minY, maxX, maxY }
}

function cubicBezierY(t: number, p1: {x:number;y:number}, p2: {x:number;y:number}): number {
  // Endpoints (0,0) and (1,1)
  const u = 1 - t
  // y(t) = 3*u^2*t*p1.y + 3*u*t^2*p2.y + t^3
  return 3*u*u*t*p1.y + 3*u*t*t*p2.y + t*t*t
}

export function rasterizeImageToGridLayers(params: RasterizeParams): Array<Set<string>> {
  const { image, imageSize, transform, config } = params
  const data = getImageData(image, imageSize)

  // Determine grid coverage bounds in grid units
  const bounds = params.bounds ?? transformCornersToGrid(imageSize, transform)

  // Iterate integer grid cells covering bounds
  const startX = Math.floor(bounds.minX)
  const startY = Math.floor(bounds.minY)
  const endX = Math.ceil(bounds.maxX)
  const endY = Math.ceil(bounds.maxY)

  const layers: Array<Set<string>> = [new Set(), new Set(), new Set(), new Set(), new Set(), new Set()]

  const whiteCutoff = Math.max(0, Math.min(1, config.whiteCutoff))
  const gamma = Math.max(0.0001, config.gamma)
  const bins = Math.max(1, Math.min(6, config.bins))
  const darkestTop = config.darkestTop !== false
  const p1 = { x: Math.max(0, Math.min(1, config.curve.p1.x)), y: Math.max(0, Math.min(1, config.curve.p1.y)) }
  const p2 = { x: Math.max(0, Math.min(1, config.curve.p2.x)), y: Math.max(0, Math.min(1, config.curve.p2.y)) }
  const width = imageSize.width
  const height = imageSize.height
  const arr = data.data

  for (let gy = startY; gy < endY; gy++) {
    for (let gx = startX; gx < endX; gx++) {
      // Sample at grid cell center
      const cx = gx + 0.5
      const cy = gy + 0.5
      const p = invertPointToImagePixels(cx, cy, transform)

      // Nearest neighbor sampling
      const ix = Math.floor(p.x)
      const iy = Math.floor(p.y)
      if (ix < 0 || iy < 0 || ix >= width || iy >= height) continue

      const idx = (iy * width + ix) * 4
      const r = arr[idx]
      const g = arr[idx + 1]
      const b = arr[idx + 2]
      const a = arr[idx + 3] / 255

      if (a <= 0) continue

      const Y = luminanceFromRGBA(r, g, b)
      if (Y >= whiteCutoff) continue

      // Darkness 0..1
      let d = 1 - Y
      // Apply gamma and alpha
      d = Math.pow(d, gamma) * a
      if (d <= 0) continue

      // Map via curve
      const u = cubicBezierY(Math.max(0, Math.min(1, d)), p1, p2) // 0..1
      // Map to discrete bins
      const rawBin = Math.max(1, Math.min(bins, Math.ceil(u * bins)))
      // Orientation
      const layerLocal = darkestTop ? (bins - rawBin + 1) : rawBin

      const key = `${gx},${gy}`
      // Cumulative fill to lower layers (include from chosen layer downwards within bins)
      for (let id = layerLocal; id <= bins; id++) {
        layers[id - 1].add(key)
      }
    }
  }

  return layers
}
