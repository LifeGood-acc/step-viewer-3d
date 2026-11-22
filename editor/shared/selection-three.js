// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// The frame of the selection: a dashed blue box in the view's space around everything that is selected (it shows which way X, Y and Z run),
// kept apart from the bounding box of the whole file (orange, in the display settings).
import * as THREE from 'three'

/** `helpers` is the Group the page keeps its helper objects in. `set(box3 | null)` shows or hides the frame, `dispose()` removes it. */
export function createSelectionBox(helpers) {
  let line = null
  const drop = () => {
    if (!line) return
    helpers.remove(line)
    line.geometry.dispose()
    line.material.dispose()
    line = null
  }
  return {
    set(box) {
      drop()
      if (!box || box.isEmpty()) return
      const min = box.min
      const max = box.max
      const c = (x, y, z) => new THREE.Vector3(x ? max.x : min.x, y ? max.y : min.y, z ? max.z : min.z)
      const edges = [[c(0, 0, 0), c(1, 0, 0)], [c(0, 1, 0), c(1, 1, 0)], [c(0, 0, 1), c(1, 0, 1)], [c(0, 1, 1), c(1, 1, 1)], [c(0, 0, 0), c(0, 1, 0)], [c(1, 0, 0), c(1, 1, 0)], [c(0, 0, 1), c(0, 1, 1)], [c(1, 0, 1), c(1, 1, 1)], [c(0, 0, 0), c(0, 0, 1)], [c(1, 0, 0), c(1, 0, 1)], [c(0, 1, 0), c(0, 1, 1)], [c(1, 1, 0), c(1, 1, 1)]]
      const pts = edges.flat()
      const diag = max.clone().sub(min).length() || 1
      const mat = new THREE.LineDashedMaterial({ color: 0x2563eb, dashSize: diag / 40, gapSize: diag / 60, depthTest: false })
      line = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), mat)
      line.computeLineDistances()
      line.renderOrder = 11
      helpers.add(line)
    },
    get object() {
      return line
    },
    dispose: drop
  }
}
