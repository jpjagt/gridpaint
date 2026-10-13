/**
 * Placeholder character: a rolling ball or a hovering arrow, plus a soft
 * shadow. Always sits at the origin; the world moves past it.
 */

import * as THREE from "three"
import type { RunnerConfig } from "@/types/runner"
import {
  applyFog,
  createCharacterMaterial,
  createShadowMaterial,
  createSolidMaterial,
  hexToVec3,
} from "./materials"

/**
 * Phase in [0, 2π) that completes once per `period` tiles. With a loop
 * length, the period is stretched slightly so a whole number of cycles fits
 * in one loop.
 */
function loopPhase(distance: number, period: number, loopLength: number): number {
  if (loopLength > 0) {
    const cycles = Math.max(1, Math.round(loopLength / period))
    const d = ((distance % loopLength) + loopLength) % loopLength
    return ((d * cycles) / loopLength) * Math.PI * 2
  }
  const d = ((distance % period) + period) % period
  return (d / period) * Math.PI * 2
}

export class RunnerCharacter {
  readonly group = new THREE.Group()
  private body = new THREE.Group()
  private bodyMat = createCharacterMaterial()
  private outlineMat = createSolidMaterial(THREE.BackSide)
  private shadowMat = createShadowMaterial()
  private shadow: THREE.Mesh
  private geometries: THREE.BufferGeometry[] = []
  private kind = ""
  private radius = 0

  constructor(config: RunnerConfig) {
    const shadowGeo = new THREE.PlaneGeometry(1, 1)
    this.geometries.push(shadowGeo)
    this.shadow = new THREE.Mesh(shadowGeo, this.shadowMat)
    this.shadow.rotation.x = -Math.PI / 2
    this.shadow.position.y = 0.004
    this.shadow.renderOrder = 1
    this.group.add(this.shadow, this.body)
    this.applyConfig(config)
  }

  applyConfig(config: RunnerConfig) {
    const c = config.character
    if (c.kind !== this.kind || c.radius !== this.radius) this.rebuild(c.kind, c.radius)
    for (const m of [this.bodyMat, this.outlineMat, this.shadowMat]) applyFog(m, config)
    hexToVec3(config.colors.characterBody, this.bodyMat.uniforms.uBody.value)
    hexToVec3(config.colors.characterShade, this.bodyMat.uniforms.uShade.value)
    hexToVec3(config.colors.characterLine, this.bodyMat.uniforms.uLine.value)
    hexToVec3(config.colors.characterLine, this.outlineMat.uniforms.uColor.value)
    // in night mode the ground is dark, so the shadow goes black
    hexToVec3(config.night ? "#000000" : config.colors.shadow, this.shadowMat.uniforms.uColor.value)
    this.bodyMat.uniforms.uRadius.value = c.radius
    this.bodyMat.uniforms.uRings.value = c.kind === "ball" ? 1 : 0
    this.shadow.visible = c.shadow
    this.shadow.scale.setScalar(c.radius * 2.6)
  }

  private rebuild(kind: string, radius: number) {
    this.kind = kind
    this.radius = radius
    this.body.clear()
    for (const g of this.geometries.splice(1)) g.dispose()

    let geo: THREE.BufferGeometry
    if (kind === "arrow") {
      const s = new THREE.Shape()
      const r = radius
      s.moveTo(0, -r * 1.4)
      s.lineTo(r * 1.1, r * 0.9)
      s.lineTo(0, r * 0.35)
      s.lineTo(-r * 1.1, r * 0.9)
      s.closePath()
      geo = new THREE.ExtrudeGeometry(s, { depth: r * 0.45, bevelEnabled: false })
      geo.translate(0, 0, -r * 0.225)
      geo.rotateX(Math.PI / 2) // lie flat, tip toward -Z (direction of travel)
    } else {
      geo = new THREE.SphereGeometry(radius, 40, 20)
    }
    this.geometries.push(geo)
    const mesh = new THREE.Mesh(geo, this.bodyMat)
    const outline = new THREE.Mesh(geo, this.outlineMat)
    outline.scale.setScalar(1.07)
    this.body.add(mesh, outline)
    this.body.position.y = radius
    this.body.rotation.set(0, 0, 0)
  }

  /**
   * Motion is derived from distance, not time, so it repeats exactly when
   * the world loops.
   */
  update(distance: number, loopLength: number) {
    if (this.kind === "ball") {
      // The ring pattern repeats every quarter turn
      this.body.rotation.x = -loopPhase(distance, (Math.PI / 2) * this.radius, loopLength) / 4
    } else {
      const phase = loopPhase(distance, 2.5, loopLength)
      const bob = Math.sin(phase) * 0.06
      this.body.position.y = this.radius * 1.3 + bob
      this.body.rotation.z = Math.sin(phase / 2) * 0.06
      this.shadow.scale.setScalar(this.radius * (2.6 - bob * 2))
    }
  }

  dispose() {
    for (const g of this.geometries) g.dispose()
    this.bodyMat.dispose()
    this.outlineMat.dispose()
    this.shadowMat.dispose()
  }
}
