/**
 * Three.js scene setup utilities for the model viewer.
 *
 * Provides isometric-style orthographic camera, lighting, and OrbitControls.
 */

import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js"

// Field of view for the isometric-style perspective camera. A perspective
// camera (unlike a true orthographic one) makes view rays diverge, so the
// near-mirror metal reflects a *range* of the env map across each flat face
// instead of a single flat colour. Lower FOV = flatter/more orthographic look
// but flatter reflections; higher = richer reflections but more perspective
// distortion. 10° reads as strongly isometric (near-parallel projection).
export const ISO_CAMERA_FOV = 10

export interface SceneSetup {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  controls: OrbitControls
  dispose: () => void
}

export interface SceneSetupOptions {
  container: HTMLElement
}

function getThemeBackgroundColor(): number {
  const isDark = document.documentElement.classList.contains("dark")
  return isDark ? 0x27272a : 0xf4f4f5
}

// HDRI used for image-based reflections on the glossy metal material. With the
// material at metalness=1 / roughness~0, the surface is a near-mirror, so this
// reflection IS most of the look — a DARK hdri makes the object read as black.
// Swap the constant below to change the reflected scene (all ported from the
// flowers repo). What matters for a near-mirror is how much of the sphere is
// bright vs dark (measured median luminance / % dark pixels in parens):
//   kloppenheim_06_2k  – bright open sky; brightest & most even (25% dark)  ← default
//   studio_small_08_1k – soft studio softbox, product look (dark surround, 47% dark)
//   quattro_canti_2k   – sunlit city street; moodier, feature-rich (49% dark)
//   potsdamer_platz_2k – night city; mostly black (59% dark — flowers "wet-black" look)
const HDRI_URL = "/three-assets/hdri/kloppenheim_06_2k.hdr"

// Equirectangular HDR texture, cached across scene setups. We cache the raw
// texture (which keeps its CPU-side pixel data) rather than a PMREM-processed
// one: PMREM output is a render-target texture tied to the GPU context of the
// renderer that generated it, so it silently renders black once that renderer
// is disposed (close preview → reopen). With EquirectangularReflectionMapping,
// three.js runs PMREM internally per renderer, so the cached texture works for
// every new context. Loaded async, so scene.environment is set in a callback;
// the render loop picks it up on the next frame.
let cachedEnvTexture: THREE.Texture | null = null

function applyEnvMap(scene: THREE.Scene): void {
  if (cachedEnvTexture) {
    scene.environment = cachedEnvTexture
    return
  }

  new HDRLoader().load(
    HDRI_URL,
    (hdr) => {
      hdr.mapping = THREE.EquirectangularReflectionMapping
      cachedEnvTexture = hdr
      scene.environment = hdr
    },
    undefined,
    (err) => {
      console.warn("Failed to load HDRI environment map", err)
    },
  )
}

export function createSceneSetup(options: SceneSetupOptions): SceneSetup {
  const { container } = options

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(getThemeBackgroundColor())

  const aspect = container.clientWidth / container.clientHeight
  const camera = new THREE.PerspectiveCamera(ISO_CAMERA_FOV, aspect, 0.1, 5000)

  // Isometric viewing direction (equal x/y/z); distance is set by
  // fitCameraToContent once the model bounds are known.
  camera.position.set(100, 100, 100)
  camera.lookAt(0, 0, 0)
  camera.updateProjectionMatrix()

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
  })
  renderer.setSize(container.clientWidth, container.clientHeight)
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.0
  container.appendChild(renderer.domElement)

  // Image-based reflections for the glossy metal material.
  applyEnvMap(scene)

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.9)
  scene.add(ambientLight)

  const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0)
  directionalLight.position.set(50, 100, 50)
  scene.add(directionalLight)

  const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.5)
  directionalLight2.position.set(-50, 50, -50)
  scene.add(directionalLight2)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.05
  controls.screenSpacePanning = true
  controls.minDistance = 10
  controls.maxDistance = 500

  const dispose = () => {
    controls.enabled = false
    controls.dispose()
    renderer.dispose()
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose()
        if (Array.isArray(object.material)) {
          object.material.forEach((m) => m.dispose())
        } else {
          object.material.dispose()
        }
      }
    })
    if (renderer.domElement.parentElement === container) {
      container.removeChild(renderer.domElement)
    }
  }

  return { scene, camera, renderer, controls, dispose }
}

export function fitCameraToContent(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  boundingBox: THREE.Box3,
  offset: number = 1.5,
): void {
  const size = new THREE.Vector3()
  boundingBox.getSize(size)

  const center = new THREE.Vector3()
  boundingBox.getCenter(center)

  // Fit the bounding sphere so framing is stable as the model is orbited.
  const radius = size.length() / 2
  const vFov = (camera.fov * Math.PI) / 180
  const fitHeightDist = radius / Math.sin(vFov / 2)
  // Horizontal FOV is derived from the vertical FOV and aspect ratio.
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect)
  const fitWidthDist = radius / Math.sin(hFov / 2)
  const distance = offset * Math.max(fitHeightDist, fitWidthDist)

  // Keep the current viewing direction (the isometric angle), just re-distance.
  const dir = camera.position.clone().sub(center)
  if (dir.lengthSq() === 0) dir.set(1, 1, 1)
  dir.normalize()

  camera.position.copy(center).addScaledVector(dir, distance)
  camera.near = Math.max(distance / 100, 0.01)
  camera.far = distance * 100
  camera.updateProjectionMatrix()

  controls.target.copy(center)
  controls.update()
}
