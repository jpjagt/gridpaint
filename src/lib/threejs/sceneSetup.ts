/**
 * Three.js scene setup utilities for the model viewer.
 *
 * Provides isometric-style orthographic camera, lighting, and OrbitControls.
 */

import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { CubeTextureLoader } from "three"

export interface SceneSetup {
  scene: THREE.Scene
  camera: THREE.OrthographicCamera
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

let cachedEnvMap: THREE.CubeTexture | null = null

function getEnvMap(): THREE.CubeTexture | null {
  if (cachedEnvMap) return cachedEnvMap

  const loader = new CubeTextureLoader()
  const basePath = "/three-assets/textures/cube/myskybox/"
  const urls = [
    "px.jpg", "nx.jpg",
    "py.jpg", "ny.jpg",
    "pz.jpg", "nz.jpg",
  ]
  
  try {
    cachedEnvMap = loader.load(urls.map(u => basePath + u))
  } catch {
    console.warn("Failed to load environment map, using fallback")
  }
  
  return cachedEnvMap
}

export function createSceneSetup(options: SceneSetupOptions): SceneSetup {
  const { container } = options

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(getThemeBackgroundColor())

  const envMap = getEnvMap()
  if (cachedEnvMap) {
    scene.environment = cachedEnvMap
  }

  const aspect = container.clientWidth / container.clientHeight
  const frustumSize = 100
  const camera = new THREE.OrthographicCamera(
    (frustumSize * aspect) / -2,
    (frustumSize * aspect) / 2,
    frustumSize / 2,
    frustumSize / -2,
    0.1,
    1000,
  )

  camera.position.set(100, 100, 100)
  camera.lookAt(0, 0, 0)
  camera.zoom = 1
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
  camera: THREE.OrthographicCamera,
  controls: OrbitControls,
  boundingBox: THREE.Box3,
  offset: number = 1.5,
): void {
  const size = new THREE.Vector3()
  boundingBox.getSize(size)

  const center = new THREE.Vector3()
  boundingBox.getCenter(center)

  const maxDim = Math.max(size.x, size.y, size.z)
  const aspect = camera.right / camera.top
  const frustumHeight = maxDim * offset
  const frustumWidth = frustumHeight * aspect

  camera.left = -frustumWidth / 2
  camera.right = frustumWidth / 2
  camera.top = frustumHeight / 2
  camera.bottom = -frustumHeight / 2
  camera.near = 0.1
  camera.far = 1000
  camera.updateProjectionMatrix()

  controls.target.copy(center)
  controls.update()
}
