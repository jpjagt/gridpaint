/**
 * CameraSyncGroup - mirrors the camera pose across multiple 3D viewers so
 * orbiting/panning/zooming one canvas moves all of them together.
 *
 * Each viewer registers its camera + OrbitControls and broadcasts on its
 * controls' "change" event. Followers get position/target copied and their
 * controls updated; a guard flag prevents feedback loops (a follower's
 * controls.update() fires its own "change" event).
 */

import type { CameraSyncMember } from "@/types/threejs"

export class CameraSyncGroup {
  private members = new Set<CameraSyncMember>()
  private broadcasting = false

  /** Add a viewer to the group. Returns an unregister function. */
  register(member: CameraSyncMember): () => void {
    this.members.add(member)
    return () => {
      this.members.delete(member)
    }
  }

  /** Copy `source`'s camera pose to every other member. */
  broadcast(source: CameraSyncMember): void {
    if (this.broadcasting) return
    this.broadcasting = true
    try {
      for (const member of this.members) {
        if (member === source) continue
        member.camera.position.copy(source.camera.position)
        // Near/far were fitted to each member's own model distance; at the
        // synced distance the source's planes are the ones that fit.
        member.camera.near = source.camera.near
        member.camera.far = source.camera.far
        member.camera.updateProjectionMatrix()
        member.controls.target.copy(source.controls.target)
        member.controls.update()
      }
    } finally {
      this.broadcasting = false
    }
  }
}
