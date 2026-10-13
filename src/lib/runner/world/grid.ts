import type { SliceGrid } from "@/types/runner"
import { MIN_ROW } from "../config"

export function createSliceGrid(halfWidth: number, maxRow: number): SliceGrid {
  const cols = halfWidth * 2 + 1
  const rows = maxRow - MIN_ROW + 1
  return { cols, rows, halfWidth, cells: new Uint8Array(cols * rows) }
}

export function cellIndex(grid: SliceGrid, col: number, row: number): number {
  return (row - MIN_ROW) * grid.cols + (col + grid.halfWidth)
}

export function inGrid(grid: SliceGrid, col: number, row: number): boolean {
  return (
    col >= -grid.halfWidth &&
    col <= grid.halfWidth &&
    row >= MIN_ROW &&
    row < MIN_ROW + grid.rows
  )
}

export function setCell(grid: SliceGrid, col: number, row: number, v: number) {
  if (inGrid(grid, col, row)) grid.cells[cellIndex(grid, col, row)] = v
}

export function getCell(grid: SliceGrid, col: number, row: number): number {
  return inGrid(grid, col, row) ? grid.cells[cellIndex(grid, col, row)] : 0
}

export function maxRowOf(grid: SliceGrid): number {
  return MIN_ROW + grid.rows - 1
}
