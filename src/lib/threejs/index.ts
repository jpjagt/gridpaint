/**
 * Three.js utilities for the GridPaint model viewer.
 */

export {
  createExtrudeGeometryFromSvg,
  type SvgToShapesOptions,
} from "./pathToShape"

export {
  createSceneSetup,
  fitCameraToContent,
  type SceneSetup,
  type SceneSetupOptions,
} from "./sceneSetup"

export { CameraSyncGroup } from "./cameraSync"

export {
  createLayeredModel,
  updateLayerThickness,
  LAYER_THICKNESS_OPTIONS,
  type LayeredModelOptions,
  type LayeredModelResult,
  type LayerThickness,
} from "./LayeredModel"
