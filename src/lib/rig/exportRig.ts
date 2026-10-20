/**
 * Download rig parts as one 3MF (each part a separate named object, so a
 * slicer keeps them apart) or as a zip of STLs.
 */

import * as THREE from "three"
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js"
import { strToU8, zipSync } from "fflate"
import type { RigPart } from "@/lib/rig/mesh"

function download(data: Uint8Array, fileName: string, type: string): void {
  const blob = new Blob([data], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

function meshXml(geometry: THREE.BufferGeometry): string {
  const pos = geometry.getAttribute("position")
  const index = geometry.getIndex()
  const fmt = (v: number) => Number(v.toFixed(4)).toString()
  const vertices: string[] = []
  for (let i = 0; i < pos.count; i++) {
    vertices.push(
      `<vertex x="${fmt(pos.getX(i))}" y="${fmt(pos.getY(i))}" z="${fmt(pos.getZ(i))}"/>`,
    )
  }
  const triangles: string[] = []
  const count = index ? index.count : pos.count
  const at = (i: number) => (index ? index.getX(i) : i)
  for (let i = 0; i < count; i += 3) {
    const a = at(i)
    const b = at(i + 1)
    const c = at(i + 2)
    if (a === b || b === c || a === c) continue
    triangles.push(`<triangle v1="${a}" v2="${b}" v3="${c}"/>`)
  }
  return `<mesh><vertices>${vertices.join("")}</vertices><triangles>${triangles.join("")}</triangles></mesh>`
}

export function build3mf(parts: RigPart[]): Uint8Array {
  const objects = parts
    .map(
      (part, i) =>
        `<object id="${i + 1}" type="model" name="${escapeXml(part.name)}">${meshXml(part.geometry)}</object>`,
    )
    .join("")
  const items = parts.map((_, i) => `<item objectid="${i + 1}"/>`).join("")
  const model =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">` +
    `<resources>${objects}</resources><build>${items}</build></model>`
  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>` +
    `</Types>`
  const rels =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>` +
    `</Relationships>`
  return zipSync({
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(rels),
    "3D/3dmodel.model": strToU8(model),
  })
}

export function export3mf(parts: RigPart[], fileName: string): void {
  download(build3mf(parts), `${fileName}.3mf`, "model/3mf")
}

export function exportStlZip(parts: RigPart[], fileName: string): void {
  const exporter = new STLExporter()
  const files: Record<string, Uint8Array> = {}
  for (const part of parts) {
    const mesh = new THREE.Mesh(part.geometry)
    const view = exporter.parse(mesh, { binary: true }) as DataView
    const name = part.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")
    files[`${name}.stl`] = new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
  }
  download(zipSync(files), `${fileName}-stl.zip`, "application/zip")
}
