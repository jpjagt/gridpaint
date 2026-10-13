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
  float fogFactor(float d) {
    return pow(clamp((d - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0), uFogExp);
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
        gl_FragColor = vec4(mix(col, uFogColor, fogFactor(length(vViewPos))), 1.0);
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
        gl_FragColor = vec4(mix(uColor, uFogColor, fogFactor(d)), a);
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
        gl_FragColor = vec4(mix(col, uFogColor, fogFactor(length(vViewPos))), 1.0);
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
 * Load an HDRI and bake it to an 8-bit grayscale, tone-mapped texture with
 * mipmaps (cheap to sample, blur via LOD). Black-and-white suits the look.
 */
export async function loadGrayscaleEnv(url: string): Promise<THREE.DataTexture> {
  const { HDRLoader } = await import("three/examples/jsm/loaders/HDRLoader.js")
  const loader = new HDRLoader().setDataType(THREE.FloatType)
  const hdr = await loader.loadAsync(url)
  const { data, width, height } = hdr.image as { data: Float32Array; width: number; height: number }
  const out = new Uint8Array(width * height * 4)
  for (let i = 0, j = 0; i < width * height; i++, j += 4) {
    const lum = 0.2126 * data[j] + 0.7152 * data[j + 1] + 0.0722 * data[j + 2]
    const mapped = 1 - Math.exp(-lum * 1.6)
    const v = Math.round(Math.pow(mapped, 1 / 2.2) * 255)
    out[j] = out[j + 1] = out[j + 2] = v
    out[j + 3] = 255
  }
  hdr.dispose()
  return envTexture(out, width, height)
}
