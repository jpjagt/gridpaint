import { map } from 'nanostores'

export type ImageSource = ImageBitmap | HTMLImageElement

export interface ImageTransform {
  // Image center in grid units
  cx: number
  cy: number
  // Grid units per image pixel
  scale: number
  // Rotation in degrees, about image center
  rotationDeg: number
}

export interface LightnessMappingConfig {
  // Luminance above this (near white) is ignored
  whiteCutoff: number // 0..1, default 0.98
  // Gamma to apply to darkness (1 - luminance)
  gamma: number // >= 0, default 1.0
  // Number of layer bins to map into (1..6)
  bins: number
  // If true, darkest maps to top (layer 1); if false, darkest maps to bottom
  darkestTop: boolean
  // Cubic Bezier curve control for mapping t->[0..1], endpoints fixed at (0,0) and (1,1)
  curve: { p1: { x: number; y: number }; p2: { x: number; y: number } }
}

export interface ImageImportState {
  isActive: boolean
  image: ImageSource | null
  imageSize: { width: number; height: number } | null
  transform: ImageTransform
  opacity: number
  config: LightnessMappingConfig
  // Preview points per layer index 1..6 stored at array index 0..5
  preview: Array<Set<string>>
  isComputing: boolean
  // Timestamp of last preview compute request (for throttling)
  lastComputeAt: number
}

export const DEFAULT_IMAGE_IMPORT_STATE: ImageImportState = {
  isActive: false,
  image: null,
  imageSize: null,
  transform: { cx: 0, cy: 0, scale: 0.2, rotationDeg: 0 },
  opacity: 0.5,
  config: {
    whiteCutoff: 0.98,
    gamma: 1.0,
    bins: 6,
    darkestTop: true,
    curve: { p1: { x: 0.25, y: 0.25 }, p2: { x: 0.75, y: 0.75 } },
  },
  preview: [new Set(), new Set(), new Set(), new Set(), new Set(), new Set()],
  isComputing: false,
  lastComputeAt: 0,
}

export const $imageImport = map<ImageImportState>({
  ...DEFAULT_IMAGE_IMPORT_STATE,
})

export function resetImageImport() {
  $imageImport.set({ ...DEFAULT_IMAGE_IMPORT_STATE })
}

export function setImageImportActive(active: boolean) {
  $imageImport.setKey('isActive', active)
}

export function setImageSource(image: ImageSource, size: { width: number; height: number }) {
  $imageImport.setKey('image', image)
  $imageImport.setKey('imageSize', size)
}

export function setTransform(transform: Partial<ImageTransform>) {
  const current = $imageImport.get()
  $imageImport.setKey('transform', { ...current.transform, ...transform })
}

export function setOpacity(opacity: number) {
  $imageImport.setKey('opacity', Math.max(0, Math.min(1, opacity)))
}

export function setConfig(config: Partial<LightnessMappingConfig>) {
  const current = $imageImport.get()
  $imageImport.setKey('config', { ...current.config, ...config })
}

export function setPreview(preview: Array<Set<string>>) {
  $imageImport.setKey('preview', preview)
}

export function setComputing(isComputing: boolean) {
  $imageImport.setKey('isComputing', isComputing)
}

export function noteComputeRequested() {
  $imageImport.setKey('lastComputeAt', Date.now())
}
