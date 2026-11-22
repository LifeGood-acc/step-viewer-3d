// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// "Mesh over the surface" (Appearance > Advanced): the closed surface and the mesh lines at the same time. The lines are drawn by a second
// object per mesh that shares the geometry of the part (no copy of the points). The objects live in a group of their own next to the model
// (never inside it: the exports and the part numbers do not see them) and follow the part's world matrix and visibility before every frame.
// The surface itself is pushed back a little (polygon offset, set by the viewer on its materials) so that the lines do not flicker.

/**
 * opts: { THREE, parent (a group of the scene that is not exported: the helpers), getMeshes() -> every mesh of the shown parts }
 * Returns { set(on), isOn(), setSuppressed(bool), sync(), setClip(planes|null), install(scene), dispose() }.
 */
export function createMeshOverlay({ THREE, parent, getMeshes }) {
  const group = new THREE.Group()
  group.name = 'mesh-over'
  group.visible = false
  parent.add(group)
  const material = new THREE.MeshBasicMaterial({ color: 0x14233a, wireframe: true, transparent: true, opacity: 0.5, depthWrite: false })
  const lines = new Map() // source mesh -> the object with its lines
  let on = false
  let suppressed = false
  let disposed = false
  let hooked = null // { scene, prev }: what install() replaced
  const shown = (o) => {
    for (let p = o; p; p = p.parent) if (!p.visible) return false
    return true
  }
  function drop(src) {
    const o = lines.get(src)
    if (o) group.remove(o)
    lines.delete(src)
  }
  function sync() {
    const show = on && !suppressed && !disposed
    group.visible = show
    if (!show) {
      for (const src of [...lines.keys()]) drop(src) // off: the meshes are let go (a new file must not be kept alive by them)
      return
    }
    const seen = new Set()
    for (const src of getMeshes() || []) {
      // an instanced or skinned mesh is drawn the way it is made (many matrices): not outlined
      if (!src || !src.isMesh || src.isInstancedMesh || src.isSkinnedMesh || !src.geometry) continue
      seen.add(src)
      let o = lines.get(src)
      if (o && o.geometry !== src.geometry) {
        drop(src)
        o = null
      }
      if (!o) {
        o = new THREE.Mesh(src.geometry, material)
        o.name = 'mesh-over-lines'
        o.matrixAutoUpdate = false
        o.matrixWorldAutoUpdate = false // set below from the part
        o.frustumCulled = false
        o.renderOrder = 2
        group.add(o)
        lines.set(src, o)
      }
      src.updateWorldMatrix(true, false)
      o.matrixWorld.copy(src.matrixWorld)
      o.visible = shown(src)
    }
    for (const src of [...lines.keys()]) if (!seen.has(src)) drop(src)
  }
  return {
    set(v) {
      on = !!v
      sync()
    },
    isOn: () => on,
    /** Off while another way of drawing makes the lines pointless (the mesh view itself). */
    setSuppressed(v) {
      suppressed = !!v
      sync()
    },
    sync,
    /** The lines are as strong as the surface is solid (the opacity slider of the view). */
    setOpacity(v) {
      material.opacity = 0.5 * Math.max(0.1, Math.min(1, v)) // (the slider of the view goes down to 0.1)
    },
    setClip(planes) {
      material.clippingPlanes = planes || null
    },
    /** Before every drawn frame (the renderer calls scene.onBeforeRender after it has updated the matrices). */
    install(scene) {
      const prev = scene.onBeforeRender
      hooked = { scene, prev, mine: null }
      hooked.mine = function (...args) {
        sync()
        if (prev) prev.apply(this, args)
      }
      scene.onBeforeRender = hooked.mine
    },
    dispose() {
      disposed = true
      if (hooked && hooked.scene.onBeforeRender === hooked.mine) hooked.scene.onBeforeRender = hooked.prev // the hook that was there before comes back
      hooked = null
      for (const src of [...lines.keys()]) drop(src)
      parent.remove(group)
      material.dispose()
    }
  }
}
