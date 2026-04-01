/// <reference types="vite/client" />

declare module "point-in-svg-path" {
  export function pointInSvgPath(path: string, x: number, y: number): boolean
}
