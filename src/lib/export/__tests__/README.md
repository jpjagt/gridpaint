# SVG Export Tests

This directory contains tests for the SVG rendering and export functionality.

## Running Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test

# Run tests once (CI mode)
pnpm test:run

# Run tests with UI
pnpm test:ui
```

## Test Strategy

### Handling SVG Path Variations

SVG paths can represent the same shape in multiple ways:
- Different floating-point precision (`1.0` vs `1.000`)
- Different whitespace and formatting
- Different command grouping
- **Different start/end points for closed paths**
- Clockwise vs counter-clockwise traversal

#### Our Testing Approach

Instead of comparing exact path strings (brittle), we test **properties of the output**:

1. **Structural validation**: Verify paths are well-formed and closed
2. **Bounding box comparison**: Check paths cover the expected area
3. **Command count**: Ensure shape complexity is consistent
4. **Semantic parsing**: Parse and compare numerically with tolerance

Our test utilities (`src/lib/test-utils/svgPathMatchers.ts`) provide:
- `parseSvgPath()` - Parse paths into normalized command structures
- `pathsMatch()` - Compare coordinates numerically with tolerance (default ±0.001)
- `getPathBounds()` - Calculate bounding box for area comparison
- `isPathClosed()` - Verify paths form closed shapes
- `countPathCommands()` - Count shape complexity

#### Example: Testing Same Shape, Different Start Points

```typescript
// These represent the same square, starting at different corners
const path1 = "M 0 0 L 10 0 L 10 10 L 0 10 Z"
const path2 = "M 10 10 L 0 10 L 0 0 L 10 0 Z"

// Instead of: expect(path1).toBe(path2) ❌

// We test properties:
const bounds1 = getPathBounds(path1)
const bounds2 = getPathBounds(path2)
expect(bounds1).toEqual(bounds2) // ✅ Same area

expect(countPathCommands(path1)).toBe(countPathCommands(path2)) // ✅ Same complexity
expect(isPathClosed(path1)).toBe(true) // ✅ Both closed
```

This approach is **robust against**:
- Rendering optimizations changing command order
- Different SVG generators producing equivalent paths
- Floating-point rounding differences
- Path normalization algorithms

### Test Coverage

The test suite (`svgUtils.test.ts`) verifies:

1. **Basic shapes**: Single points, lines, squares, L-shapes, T-shapes, plus signs
2. **Complex patterns**: Your provided example with 70+ points, various neighborhood configurations
3. **Edge cases**: Empty layers, negative coordinates, very large coordinates, sparse points
4. **Multi-layer support**: Multiple layers, invisible layers, empty layers
5. **SVG structure**: XML declaration, xmlns, viewBox, physical dimensions (mm)
6. **Styling**: Default and custom stroke/fill/opacity settings
7. **Neighborhood configurations**: 3×3 blocks, diagonal bridges, checkerboards, hollow squares

### Example Test

```typescript
it("should generate SVG for a 2x2 square", () => {
  const points = new Set(["5,5", "6,5", "5,6", "6,6"])
  const svg = generateSingleLayerSvg(points, 50, 2)
  
  expect(svg).toContain("<svg")
  expect(countPaths(svg)).toBeGreaterThan(0)
  
  // Verify all paths are valid
  const paths = extractPathsFromSvg(svg)
  paths.forEach(path => {
    const commands = parseSvgPath(path.d)
    expect(commands.length).toBeGreaterThan(0)
  })
})
```

### Test Utilities

#### `parseSvgPath(pathString)`
Parses an SVG path `d` attribute into normalized commands with coordinates.

#### `pathsMatch(actual, expected, epsilon?)`
Semantically compares two SVG paths, returning `{ match: boolean, reason?: string }`.

#### `extractPathsFromSvg(svg)`
Extracts all `<path>` elements from SVG markup with their attributes.

#### `countPaths(svg)`
Counts the number of `<path>` elements in an SVG.

## Adding New Tests

When adding new test cases:

1. **Use descriptive names** that explain what shape/pattern is being tested
2. **Include your input data** as inline Sets for reproducibility
3. **Test the structure** rather than exact path strings (unless regression testing)
4. **Use the utilities** for robust path comparison

Example:
```typescript
it("should generate SVG for [your shape description]", () => {
  const points = new Set(["x1,y1", "x2,y2", ...])
  const svg = generateSingleLayerSvg(points, gridSize, borderWidth)
  
  // Structural assertions
  expect(svg).toContain("<svg")
  expect(countPaths(svg)).toBeGreaterThan(0)
  
  // Validate path content
  const paths = extractPathsFromSvg(svg)
  paths.forEach(path => {
    const commands = parseSvgPath(path.d)
    expect(commands.length).toBeGreaterThan(0)
  })
})
```

## Test Data

The complex example test case comes from real user-generated GridPaint data and includes:
- 70 points across various neighborhoods
- Most possible shape combinations in blob rendering
- Mix of convex corners, straight edges, and bridge primitives

This ensures the SVG renderer handles real-world complexity.
