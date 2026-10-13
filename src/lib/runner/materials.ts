/**
 * Flat, unlit materials with distance fog. Colors are passed through as raw
 * sRGB values so the config hex codes land on screen exactly.
 */

import * as THREE from "three"
import type { RunnerConfig } from "@/types/runner"

export function hexToVec3(hex: string, out = new THREE.Vector3()): THREE.Vector3 {
  const c = new THREE.Color()
  // getHex() returns the sRGB hex regardless of color management
  c.setStyle(hex)
  const h = c.getHex()
  return out.set(((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255)
}

const FOG_UNIFORMS_GLSL = /* glsl */ `
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uFogExp;
  uniform float uInvert;
  float fogFactor(float d) {
    return pow(clamp((d - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0), uFogExp);
  }
  // Night mode: world colors are inverted (the character opts out)
  vec3 outColor(vec3 c) {
    return mix(c, 1.0 - c, uInvert);
  }
`

const VIEW_POS_VERT = /* glsl */ `
  varying vec3 vViewPos;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewPos = mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`

function fogUniforms() {
  return {
    uFogColor: { value: new THREE.Vector3() },
    uFogNear: { value: 10 },
    uFogFar: { value: 100 },
    uFogExp: { value: 1 },
    uInvert: { value: 0 },
  }
}

/** Layer faces. Up/down-facing surfaces can get their own color (`uColorTop`). */
export function createFaceMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...fogUniforms(),
      uColor: { value: new THREE.Vector3() },
      uColorTop: { value: new THREE.Vector3() },
      uUpView: { value: new THREE.Vector3(0, 1, 0) },
    },
    vertexShader: VIEW_POS_VERT,
    fragmentShader: /* glsl */ `
      ${FOG_UNIFORMS_GLSL}
      uniform vec3 uColor;
      uniform vec3 uColorTop;
      uniform vec3 uUpView;
      varying vec3 vViewPos;
      void main() {
        vec3 n = normalize(cross(dFdx(vViewPos), dFdy(vViewPos)));
        float up = abs(dot(n, uUpView));
        vec3 col = mix(uColor, uColorTop, smoothstep(0.6, 0.95, up));
        gl_FragColor = vec4(outColor(mix(col, uFogColor, fogFactor(length(vViewPos)))), 1.0);
      }
    `,
    side: THREE.DoubleSide,
    // Push faces back a little so the outlines drawn on their edges win
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  })
}

export function createLineMaterial(transparent: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...fogUniforms(),
      uColor: { value: new THREE.Vector3() },
      uOpacity: { value: 1 },
      uFadeStart: { value: 1e6 },
      uFadeEnd: { value: 2e6 },
    },
    vertexShader: VIEW_POS_VERT,
    fragmentShader: /* glsl */ `
      ${FOG_UNIFORMS_GLSL}
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uFadeStart;
      uniform float uFadeEnd;
      varying vec3 vViewPos;
      void main() {
        float d = length(vViewPos);
        float a = uOpacity * (1.0 - smoothstep(uFadeStart, uFadeEnd, d));
        gl_FragColor = vec4(outColor(mix(uColor, uFogColor, fogFactor(d))), a);
      }
    `,
    transparent,
    depthWrite: !transparent,
  })
}

/**
 * Character: two-tone toon shading with "seam" rings so rolling is visible.
 * Rings are in object space; they rotate with the ball.
 */
export function createCharacterMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...fogUniforms(),
      uBody: { value: new THREE.Vector3() },
      uShade: { value: new THREE.Vector3() },
      uLine: { value: new THREE.Vector3() },
      uRadius: { value: 0.4 },
      uRings: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vViewPos;
      varying vec3 vNormal;
      varying vec3 vObj;
      void main() {
        vObj = position;
        vNormal = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewPos = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      ${FOG_UNIFORMS_GLSL}
      uniform vec3 uBody;
      uniform vec3 uShade;
      uniform vec3 uLine;
      uniform float uRadius;
      uniform float uRings;
      varying vec3 vViewPos;
      varying vec3 vNormal;
      varying vec3 vObj;
      void main() {
        vec3 l = normalize(vec3(-0.4, 0.8, 0.5));
        float lit = dot(normalize(vNormal), l);
        vec3 col = lit > 0.15 ? uBody : uShade;
        if (uRings > 0.5) {
          float w = uRadius * 0.07;
          if (abs(vObj.y) < w || abs(vObj.z) < w) col = uLine;
        }
        gl_FragColor = vec4(mix(col, uFogColor, fogFactor(length(vViewPos))), 1.0);
      }
    `,
  })
}

export function createSolidMaterial(side: THREE.Side): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...fogUniforms(), uColor: { value: new THREE.Vector3() } },
    vertexShader: VIEW_POS_VERT,
    fragmentShader: /* glsl */ `
      ${FOG_UNIFORMS_GLSL}
      uniform vec3 uColor;
      varying vec3 vViewPos;
      void main() {
        gl_FragColor = vec4(mix(uColor, uFogColor, fogFactor(length(vViewPos))), 1.0);
      }
    `,
    side,
  })
}

/** Soft round blob shadow */
export function createShadowMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...fogUniforms(), uColor: { value: new THREE.Vector3() }, uOpacity: { value: 0.5 } },
    vertexShader: /* glsl */ `
      varying vec3 vViewPos;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewPos = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      ${FOG_UNIFORMS_GLSL}
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec3 vViewPos;
      varying vec2 vUv;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        float a = uOpacity * (1.0 - smoothstep(0.55, 1.0, r)) * (1.0 - fogFactor(length(vViewPos)));
        gl_FragColor = vec4(uColor, a);
      }
    `,
    transparent: true,
    depthWrite: false,
  })
}

/** Copy fog settings from config into any of the materials above */
export function applyFog(mat: THREE.ShaderMaterial, config: RunnerConfig) {
  const u = mat.uniforms
  hexToVec3(config.colors.fog, u.uFogColor.value)
  u.uFogNear.value = config.fog.near
  u.uFogFar.value = Math.max(config.fog.far, config.fog.near + 0.01)
  u.uFogExp.value = config.fog.exponent
}

/**
 * Mirror-ish metal: reflects a grayscale equirectangular environment map.
 * `uBlur` picks a mip level (0 = sharp mirror, higher = brushed). Normals come
 * from the geometry for side walls; fronts use a constant +Z normal.
 */
export function createMetalMaterial(flatFront: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    defines: flatFront ? { FLAT_FRONT: "" } : {},
    uniforms: {
      ...fogUniforms(),
      uEnv: { value: null as THREE.Texture | null },
      uViewToWorld: { value: new THREE.Matrix3() },
      uBlur: { value: 1.5 },
      uExposure: { value: 1 },
      uContrast: { value: 1 },
      uTint: { value: new THREE.Vector3(1, 1, 1) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vViewPos;
      varying vec3 vNormalV;
      void main() {
        #ifdef FLAT_FRONT
          vNormalV = normalize(normalMatrix * vec3(0.0, 0.0, 1.0));
        #else
          vNormalV = normalize(normalMatrix * normal);
        #endif
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewPos = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      ${FOG_UNIFORMS_GLSL}
      uniform sampler2D uEnv;
      uniform mat3 uViewToWorld;
      uniform float uBlur;
      uniform float uExposure;
      uniform float uContrast;
      uniform vec3 uTint;
      varying vec3 vViewPos;
      varying vec3 vNormalV;
      void main() {
        vec3 n = normalize(vNormalV);
        vec3 v = normalize(vViewPos);
        if (dot(n, v) > 0.0) n = -n;
        vec3 r = normalize(uViewToWorld * reflect(v, n));
        vec2 uv = vec2(atan(r.z, r.x) * 0.15915494 + 0.5, 0.5 - asin(clamp(r.y, -1.0, 1.0)) * 0.31830989);
        // explicit LOD: no seam where atan wraps around
        vec3 env = textureLod(uEnv, uv, uBlur).rgb;
        vec3 col = clamp(pow(env, vec3(uContrast)) * uExposure, 0.0, 1.0) * uTint;
        gl_FragColor = vec4(outColor(mix(col, uFogColor, fogFactor(length(vViewPos)))), 1.0);
      }
    `,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  })
}

/** Placeholder environment until the HDRI arrives: bright sky, dark ground */
export function createFallbackEnv(): THREE.DataTexture {
  const w = 64
  const h = 32
  const data = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    const t = y / (h - 1)
    const v = t < 0.5 ? 235 - t * 120 : 90 - (t - 0.5) * 100
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      data[i] = data[i + 1] = data[i + 2] = v
      data[i + 3] = 255
    }
  }
  return envTexture(data, w, h)
}

function envTexture(data: Uint8Array, w: number, h: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = true
  tex.needsUpdate = true
  return tex
}

/**
 * Environment maps offered for metal. "_soft" variants are the same HDRI
 * baked blurry and low-detail: shapes of the landscape, not a photo.
 */
export const RUNNER_ENV_MAPS: Record<string, { file: string; soft: boolean }> = {
  studio_small_08_1k: { file: "studio_small_08_1k", soft: false },
  kloppenheim_soft: { file: "kloppenheim_06_2k", soft: true },
  kloppenheim_06_2k: { file: "kloppenheim_06_2k", soft: false },
  quattro_canti_soft: { file: "quattro_canti_2k", soft: true },
  quattro_canti_2k: { file: "quattro_canti_2k", soft: false },
  potsdamer_platz_2k: { file: "potsdamer_platz_2k", soft: false },
}

/**
 * Load an HDRI and bake it to an 8-bit grayscale, tone-mapped texture with
 * mipmaps (cheap to sample, blur via LOD). Black-and-white suits the look.
 */
export async function loadGrayscaleEnv(name: string): Promise<THREE.DataTexture> {
  const entry = RUNNER_ENV_MAPS[name] ?? { file: name, soft: false }
  const { HDRLoader } = await import("three/examples/jsm/loaders/HDRLoader.js")
  const loader = new HDRLoader().setDataType(THREE.FloatType)
  const hdr = await loader.loadAsync(`/three-assets/hdri/${entry.file}.hdr`)
  const { data, width, height } = hdr.image as { data: Float32Array; width: number; height: number }

  // Tone-mapped luminance, 0..1
  let w = width
  let h = height
  let lum = new Float32Array(w * h)
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    const l = 0.2126 * data[j] + 0.7152 * data[j + 1] + 0.0722 * data[j + 2]
    lum[i] = Math.pow(1 - Math.exp(-l * 1.6), 1 / 2.2)
  }
  hdr.dispose()

  if (entry.soft) {
    // Downsample to ~512 wide and blur: the landscape survives as soft
    // masses (a light blur for form, mixed with a broader one), no photo detail
    const f = Math.max(1, Math.round(w / 512))
    ;[lum, w, h] = downsample(lum, w, h, f)
    const broad = boxBlur(lum, w, h, 5, 2)
    const form = boxBlur(lum, w, h, 1, 2)
    for (let i = 0; i < lum.length; i++) lum[i] = broad[i] * 0.45 + form[i] * 0.55
  }

  const out = new Uint8Array(w * h * 4)
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    const v = Math.round(Math.min(1, lum[i]) * 255)
    out[j] = out[j + 1] = out[j + 2] = v
    out[j + 3] = 255
  }
  return envTexture(out, w, h)
}

function downsample(src: Float32Array, w: number, h: number, f: number): [Float32Array, number, number] {
  const nw = Math.floor(w / f)
  const nh = Math.floor(h / f)
  const out = new Float32Array(nw * nh)
  for (let y = 0; y < nh; y++)
    for (let x = 0; x < nw; x++) {
      let sum = 0
      for (let dy = 0; dy < f; dy++)
        for (let dx = 0; dx < f; dx++) sum += src[(y * f + dy) * w + x * f + dx]
      out[y * nw + x] = sum / (f * f)
    }
  return [out, nw, nh]
}

/** Repeated separable box blur (≈ gaussian); wraps horizontally like the panorama */
function boxBlur(src: Float32Array, w: number, h: number, r: number, passes: number): Float32Array {
  let a = src.slice()
  let b = new Float32Array(a.length)
  const n = 2 * r + 1
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0
        for (let k = -r; k <= r; k++) sum += a[y * w + ((x + k + w) % w)]
        b[y * w + x] = sum / n
      }
    }
    [a, b] = [b, a]
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0
        for (let k = -r; k <= r; k++) sum += a[Math.min(h - 1, Math.max(0, y + k)) * w + x]
        b[y * w + x] = sum / n
      }
    }
    [a, b] = [b, a]
  }
  return a
}

/** Number of chunks the ground-plane mask remembers (a ring buffer) */
export const GROUND_MASK_SIZE = 256

/**
 * Flat ground continuing past the generated grid to the horizon. A ring
 * buffer texture (one texel per chunk) says where the landscape has ground,
 * so it disappears over the void in walkway-only biomes.
 */
export function createGroundPlaneMaterial(mask: THREE.DataTexture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...fogUniforms(),
      uColor: { value: new THREE.Vector3() },
      uMask: { value: mask },
      /** distance travelled, modulo the mask period (keeps float precision) */
      uDistance: { value: 0 },
      uChunkLength: { value: 8 },
      /** the grid's own ground covers |x| below this */
      uInnerX: { value: 120 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vViewPos;
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vec4 mv = viewMatrix * w;
        vViewPos = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      ${FOG_UNIFORMS_GLSL}
      uniform vec3 uColor;
      uniform sampler2D uMask;
      uniform float uDistance;
      uniform float uChunkLength;
      uniform float uInnerX;
      varying vec3 vViewPos;
      varying vec3 vWorld;
      void main() {
        if (abs(vWorld.x) < uInnerX) discard;
        float period = ${GROUND_MASK_SIZE.toFixed(1)} * uChunkLength;
        float d = mod(uDistance - vWorld.z, period);
        float ground = texture2D(uMask, vec2((floor(d / uChunkLength) + 0.5) / ${GROUND_MASK_SIZE.toFixed(1)}, 0.5)).r;
        if (ground < 0.5) discard;
        gl_FragColor = vec4(outColor(mix(uColor, uFogColor, fogFactor(length(vViewPos)))), 1.0);
      }
    `,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
  })
}

export function createGroundMask(): THREE.DataTexture {
  const tex = new THREE.DataTexture(
    new Uint8Array(GROUND_MASK_SIZE * 4).fill(255),
    GROUND_MASK_SIZE,
    1,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  )
  tex.minFilter = THREE.NearestFilter
  tex.magFilter = THREE.NearestFilter
  tex.needsUpdate = true
  return tex
}
