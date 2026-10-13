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
