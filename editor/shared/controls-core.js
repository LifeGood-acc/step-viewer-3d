// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// One pure function says which control is shown, which one works and why one does not. The viewers apply the answer; nobody sets a
// "hidden" or "disabled" flag of a switch from a second place. No DOM, no three.js: tested in Node (controls-core.test.mjs).

export const SHADINGS = ['original', 'solid', 'normals', 'xray', 'matcap', 'flat', 'vertex']

/** The looks in which the section "Studio" light reaches the surface (the others draw unlit or by normal, so lights change nothing). */
export const LIT_SHADINGS = ['original', 'solid', 'flat']
/** The looks that draw the picture of a material. */
export const TEXTURE_SHADINGS = ['original', 'flat']

const ok = { visible: true, enabled: true, reason: null }
const hide = { visible: false, enabled: false, reason: null }
const off = (reason) => ({ visible: true, enabled: false, reason })

/**
 * input: { kind: 'none'|'mesh'|'points'|'splat'|'gcode'|'lines', partCount, hasTextures, hasVertexColors, hasAnimation, shading,
 *          studioActive, selection (number of selected parts), step (STEP viewer), loading }
 * returns { [control]: { visible, enabled, reason } } where reason is the key of a string that explains a disabled control.
 */
export function controlsState(input = {}) {
  const i = { kind: 'none', partCount: 0, shading: 'original', selection: 0, ...input }
  const has = i.kind !== 'none'
  const surface = i.kind === 'mesh'
  const points = i.kind === 'points' || i.kind === 'splat'
  const out = {}
  out.surface = surface ? ok : hide // the Surface | Mesh button: points, splats and G-code have no surface to switch
  out.texture = surface && i.hasTextures ? (TEXTURE_SHADINGS.includes(i.shading) ? ok : off('tip_texture_shading')) : hide
  out.tint = surface && i.partCount >= 2 ? (i.shading === 'original' ? ok : off('tip_tint_shading')) : hide
  out.vertexShading = surface && i.hasVertexColors ? ok : hide
  out.studioLight = has && !points ? (LIT_SHADINGS.includes(i.shading) ? ok : off('studio_unlit')) : hide
  out.studioNoShadow = points ? off('studio_points_no_shadow') : ok // a hint, not a switch
  out.backFaces = surface ? ok : hide
  out.edges = i.step && surface ? ok : hide
  out.opacity = surface ? ok : hide
  out.pointControls = points ? ok : hide
  out.clip = has && i.kind !== 'gcode' ? ok : hide
  out.layers = i.kind === 'gcode' ? ok : hide
  out.animation = i.hasAnimation ? ok : hide
  out.partsTab = has && (i.partCount >= 2 || i.step) ? ok : hide
  out.partCard = i.selection > 0 ? ok : hide
  out.fitSelected = i.selection > 0 ? ok : off('tip_needs_selection')
  out.measureParts = i.partCount >= 2 ? ok : hide
  out.editTab = surface || i.kind === 'lines' ? ok : hide
  out.partTools = surface && i.partCount >= 2 ? ok : hide
  out.simplify = surface ? ok : hide
  out.checkMesh = surface ? ok : hide
  out.exportMesh = surface ? ok : hide
  out.background = ok // always works, in every look and shading
  return out
}
