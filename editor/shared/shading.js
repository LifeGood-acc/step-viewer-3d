// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// The "Shading" choices that replace a part's own material: solid gray, normals, X-ray, matcap, flat, vertex colors.
import * as THREE from 'three'

export const SHADING_KEYS = ['original', 'solid', 'normals', 'xray', 'matcap', 'flat', 'vertex']

// A matcap picture made on the spot: a soft gray sphere with a highlight (no file to ship).
function matcapTexture() {
  const cv = document.createElement('canvas')
  cv.width = cv.height = 128
  const g = cv.getContext('2d')
  const grad = g.createRadialGradient(46, 40, 6, 64, 64, 64)
  grad.addColorStop(0, '#ffffff')
  grad.addColorStop(0.35, '#c9ced6')
  grad.addColorStop(0.8, '#5d6470')
  grad.addColorStop(1, '#2b2f37')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** The shared materials and the per-part ones. `shared` must be part of the viewer's material set (side, section and disposal apply to them). */
export function createShading() {
  const solid = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.9, metalness: 0 })
  const normals = new THREE.MeshNormalMaterial()
  const xray = new THREE.MeshBasicMaterial({ color: 0x6fa8dc, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide })
  xray.userData.keepSide = true // an x-ray shows the backs by its nature: the "Back faces" switch does not turn them off
  const matcap = new THREE.MeshMatcapMaterial({ matcap: matcapTexture() })
  const vertex = new THREE.MeshBasicMaterial({ vertexColors: true })
  const flat = new WeakMap() // original material -> flat shaded clone
  const flatSet = new Set() // the same clones, to put them into a viewer's material set again
  return {
    solid,
    normals,
    xray,
    flatSet,
    shared: [solid, normals, xray, matcap, vertex],
    /**
     * The material for a part under `kind`, or null when the part keeps its own ('original'). `register(m)` is told about a material made
     * here. p = { obj, orig }.
     */
    forPart(kind, p, register) {
      if (kind === 'solid') return solid
      if (kind === 'normals') return normals
      if (kind === 'xray') return xray
      if (kind === 'matcap') return matcap
      if (kind === 'vertex') return p.obj.geometry.getAttribute('color') ? vertex : solid
      if (kind === 'flat') {
        const base = Array.isArray(p.orig) ? p.orig[0] : p.orig
        if (!flat.has(base)) {
          const keep = base.userData
          base.userData = {} // clone() serializes userData, and the viewers keep textures there
          const m = base.clone()
          base.userData = keep
          // the clone starts from the material as the file had it, not from what the view had done to it (opacity, no texture)
          if (keep.o) {
            m.transparent = keep.o.transparent
            m.opacity = keep.o.opacity
            m.depthWrite = keep.o.depthWrite
          }
          if (keep.map0 !== undefined) m.map = keep.map0
          m.flatShading = true
          m.needsUpdate = true
          flat.set(base, m)
          flatSet.add(m)
          register(m)
        }
        return flat.get(base)
      }
      return null
    }
  }
}
