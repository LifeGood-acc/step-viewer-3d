import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CHROME_STRINGS } from '../editor/shared/chrome-strings.js'
import { STRINGS } from '../editor/lib.js'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '..', 'editor', 'shared', 'chrome-layout.js'), 'utf8')

test('every string the toolbar, tabs and dialogs ask for exists in both languages', () => {
  const keys = new Set([...src.matchAll(/\bt\('([a-z0-9_]+)'/g)].map((m) => m[1]))
  for (const m of ['distance', 'angle', 'circle', 'edge', 'parts']) keys.add(`ch_m_${m}`) // built with a template
  for (const m of ['look', 'orca', 'light', 'dark', 'white', 'gradient', 'transparent']) keys.add(`ch_bg_${m}`)
  assert.ok(keys.size > 40)
  for (const k of keys) {
    if (!k.startsWith('ch_')) continue // the others belong to the viewers' own string tables
    assert.ok(CHROME_STRINGS.en[k], `en.${k} is missing`)
    assert.ok(CHROME_STRINGS.de[k], `de.${k} is missing`)
  }
})

test('both languages have the same keys', () => {
  assert.deepEqual(Object.keys(CHROME_STRINGS.en).sort(), Object.keys(CHROME_STRINGS.de).sort())
})

test('every tooltip text is one short sentence (60 characters at most) in both languages', () => {
  const long = []
  for (const lang of ['en', 'de']) {
    for (const [k, v] of Object.entries(STRINGS[lang])) if (/(^tip_|_tip$|^ch_bgt_|^resizer_label$)/.test(k) && typeof v === 'string' && v.length > 60) long.push(`${lang}.${k} (${v.length})`)
  }
  for (const lang of ['en', 'de']) for (const [k, v] of Object.entries(CHROME_STRINGS[lang])) if (/(^tip_|_tip$|^ch_bgt_)/.test(k) && v.length > 60) long.push(`${lang}.${k} (${v.length})`)
  assert.deepEqual(long, [], 'shorten these tooltips (a tooltip is a hint of a few words; the explanation belongs in the panel or the shortcut list)')
})

test('the hint of the Parts tab is one sentence', () => {
  for (const lang of ['en', 'de']) {
    const h = CHROME_STRINGS[lang].ch_p_hint
    assert.ok(h.length <= 70, `${lang}: ${h.length} characters`)
    assert.equal(h.replace(/(Ctrl|Strg)\/⌘/g, '').split(/[.!?](\s|$)/).filter((x) => x.trim()).length, 1, `${lang}: more than one sentence`)
  }
})

// The words that are the same in German (a name, a loan word). One list for both viewers: a key a viewer does not have is ignored. Adding a text that
// is the same in both languages means adding its key here (and nowhere else).
const SAME_IN_GERMAN = new Set(['ch_b_diag', 'ch_v_iso', 'pc_name', 'pc_dens_aluminium', 'pc_dens_pla', 'pc_dens_abs', 'pc_q_normal', 'pc_w_optional', 'anim_clip', 'anim_pause', 'anim_title', 'box', 'ch_bgs_orca', 'ch_ex_film', 'ch_s_zoom', 'ch_ex_title', 'ch_l_original', 'ch_st_film', 'ch_studio', 'ch_tab_export', 'ch_tab_info', 'ch_tab_studio', 'ex_fmt_3mf', 'ex_fmt_glb', 'ex_fmt_obj', 'ex_fmt_ply', 'ex_fmt_stl', 'ex_format', 'ex_progress', 'ex_ready', 'ex_sec_n', 'ex_torus', 'export_btn', 'mesh', 'mp_col_name', 'mp_name', 'ms_radius', 'pc_computing', 'pc_material', 'pc_position', 'pv_hero', 'q_normal', 's_vertices', 'sh_matcap', 'sh_normals', 'sh_original', 'sm_splat', 'st_spin_start', 'st_title', 'st_tone_agx', 'st_tone_neutral', 'tl_detail', 'tl_detail_normal', 'u_meter'])
test('German strings are translated, not copied (except words that are the same in German)', () => {
  for (const k of Object.keys(STRINGS.en)) {
    if (STRINGS.en[k] === STRINGS.de[k]) assert.ok(SAME_IN_GERMAN.has(k), `de.${k} is still English: ${STRINGS.en[k]}`)
  }
  for (const k of Object.keys(CHROME_STRINGS.en)) {
    if (CHROME_STRINGS.en[k] === CHROME_STRINGS.de[k]) assert.ok(SAME_IN_GERMAN.has(k), `de.${k} (chrome) is still English: ${CHROME_STRINGS.en[k]}`)
  }
})
