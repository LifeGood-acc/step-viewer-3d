// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// The background of the view, one model for both: the mode is one of BG_MODES (prefs-core.js). It always works, in every look and shading.
//   look: the studio look's own background when a look is on, else like Orca   orca: the theme of Orca   light, dark, white, gradient, transparent
import * as THREE from 'three'
import { gradientTexture } from './studio.js'
import { bgIsDark } from './prefs-core.js'

const LIGHT = 0xeceef1
const DARK = 0x15171a

/** ctx: { scene, canvas, studio() -> the studio ui or null, themeDark() -> boolean }. */
export function createBackground(ctx) {
  let mode = 'look'
  let tex = null
  let texKey = ''
  const lookBg = () => (ctx.studio() && ctx.studio().isActive() ? ctx.studio().studio.background() : undefined) // undefined: no look decides
  const grad = (a, b) => {
    const key = `${a}|${b}`
    if (!tex || texKey !== key) {
      if (tex) tex.dispose()
      tex = gradientTexture(a, b)
      texKey = key
    }
    return tex
  }
  const api = {
    get mode() {
      return mode
    },
    set(m) {
      mode = m
    },
    /** Whether the background shown is dark (the grid and the CAD edges are drawn to contrast with it). */
    dark() {
      const s = ctx.studio()
      const active = !!(s && s.isActive())
      return bgIsDark(mode, { themeDark: ctx.themeDark(), studioDark: s ? s.studio.isDark() : null, lookTransparent: active && lookBg() === null })
    },
    /** Puts the background on the scene (a Color, a gradient texture or null) and the checker pattern behind a transparent canvas. */
    apply() {
      let bg
      if (mode === 'look') {
        const lb = lookBg()
        bg = lb !== undefined ? lb : new THREE.Color(ctx.themeDark() ? DARK : LIGHT)
      } else if (mode === 'orca') bg = new THREE.Color(ctx.themeDark() ? DARK : LIGHT)
      else if (mode === 'light') bg = new THREE.Color(LIGHT)
      else if (mode === 'dark') bg = new THREE.Color(DARK)
      else if (mode === 'white') bg = new THREE.Color(0xffffff)
      else if (mode === 'gradient') bg = grad('#eceef1', '#8e949c')
      else bg = null
      ctx.scene.background = bg
      ctx.canvas.classList.toggle('studio-clear', bg === null)
      if (mode !== 'gradient' && tex && bg !== tex) {
        // a texture the studio made is the studio's; ours is only freed when we leave the gradient
        if (texKey) {
          tex.dispose()
          tex = null
          texKey = ''
        }
      }
    },
    dispose() {
      if (tex) tex.dispose()
    }
  }
  return api
}
