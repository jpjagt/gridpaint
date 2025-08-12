export interface RasterPoint {
  x: number;
  y: number;
  selected: boolean;
}

export interface GridPaintState {
  gridSize: number;
  gridSizePreset: number;
  gridSizeSteps: number;
  brushColor: string;
  gridElementColor: string;
  bgColor: string;
  rasterPoints: RasterPoint[];
  gridXElements: number;
  gridYElements: number;
}

export interface GridPaintActions {
  reset: () => void;
  setGridSize: (operation: '+' | '-') => void;
  setColor: () => void;
  saveIMG: () => void;
}