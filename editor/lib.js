// Pure helpers: strings, number formats, STEP unit detection, assembly tree, quality presets. No DOM, no three.js,
// so `orca plugin test` can run them in Node.

import { EXPORT_STRINGS } from './shared/export-strings.js'
import { TOOLS_STRINGS } from './shared/tools-strings.js'
import { SESSION_STRINGS } from './shared/session-strings.js'
import { STUDIO_STRINGS } from './shared/studio-strings.js'
import { PARTINFO_STRINGS } from './shared/partinfo-strings.js'
import { MEASURE_STRINGS } from './shared/measure-strings.js'
import { CHROME_STRINGS } from './shared/chrome-strings.js'

// ---------- strings ----------
export const STRINGS = {
  en: {
    background: 'Background',
    bg_auto: 'like Orca',
    bg_light: 'light',
    bg_dark: 'dark',
    bg_look: 'like the look',
    surface: 'Surface',
    mesh: 'Mesh',
    tip_mesh_on: 'Surface shown. Click for the mesh (W)',
    tip_surface_on: 'Show the surface again (W)',
    reset_prefs: 'Reset all',
    edges: 'Edges',
    edges_changed: 'A tool replaced the triangles of some parts; their edges are now the sharp edges (over 30 degrees), because the faces are not known any more.',
    edges_skipped: '{n} part(s) are too large (or ran out of memory) to get edges.',
    row_expand: 'Expand {name}',
    row_collapse: 'Collapse {name}',
    grid: 'Grid',
    axes: 'Axes',
    box: 'Box',
    over: 'Mesh over',
    backfaces: 'Backfaces',
    panel: 'Sidebar',
    tip_background: 'Next background (B)',
    tip_edges: 'CAD edges: the lines where two faces of the part meet',
    tip_grid: 'Floor grid (G)',
    tip_axes: 'X (red), Y (green), Z (blue) axes at the origin',
    tip_box: 'Bounding box',
    tip_over: 'Draws the mesh lines over the closed surface',
    tip_backfaces: 'Draw the back side of surfaces',
    tip_panel: 'Show or hide the sidebar (P)',
    quality: 'Mesh quality',
    q_coarse: 'Coarse (fast)',
    q_normal: 'Normal',
    q_fine: 'Fine (slow, large)',
    quality_hint: 'STEP holds exact surfaces. They are turned into triangles when the file is read; finer means more triangles, more time and more memory.',
    cancel: 'Cancel',
    load_anyway: 'Load anyway',
    stats: 'Details',
    orientation: 'Orientation',
    up_is: 'Up is',
    up_y: '+Y up',
    up_z: '+Z up (CAD)',
    hint_y: 'Y-up data is shown as it is.',
    hint_z: 'CAD convention: +Z is up (turned −90° about the X axis for display).',
    parts: 'Parts',
    parts_visible: '{v} / {n} visible',
    all: 'All',
    none: 'None',
    invert: 'Invert',
    color_by_part: 'Color by part',
    tip_color_by_part: 'Give every part its own color',
    tip_tint_shading: 'Colors per part show in the Original look only',
    studio_unlit: 'This look is not lit: studio lights change nothing here',
    studio_points_no_shadow: 'Points and splats cast no shadow',
    tip_needs_selection: 'Select a part first',
    parts_hint: 'Click a part in the view to select it. Double-click a row to show only that part. Indented rows belong to the assembly above.',
    parts_more: '… and {n} more (list limited to {max}; the buttons beside the list apply to all parts).',
    visible_label: 'Visible: {name}',
    part_n: 'Part {n}',
    s_size: 'File size',
    s_parts: 'Parts',
    s_faces: 'Faces (B-rep)',
    s_triangles: 'Triangles',
    s_extent: 'Size X × Y × Z',
    s_height: 'Height range',
    s_grid: 'Grid step',
    s_unit: 'Unit',
    s_read: 'Read time',
    s_memory: 'Converter memory',
    s_quality: 'Mesh quality',
    unit_file: '{name} (from file)',
    unit_converted: '{name} (file unit {orig} converted)',
    unit_default: '{name} (file unit not found)',
    u_millimeter: 'millimeters',
    u_centimeter: 'centimeters',
    u_meter: 'meters',
    u_inch: 'inches',
    u_foot: 'feet',
    u_micron: 'micrometers',
    u_kilometer: 'kilometers',
    preset: 'View',
    pv_all: 'Show all (R)',
    pv_hero: 'Hero',
    pv_iso: 'Isometric',
    pv_front: 'Front',
    pv_back: 'Back',
    pv_left: 'Left',
    pv_right: 'Right',
    pv_top: 'Top',
    pv_bottom: 'Bottom',
    tip_preset: 'Pick a view (keys 1 to 8, R shows all)',
    measure: 'Measure',
    tip_measure: 'Measure the distance between two points on the surface (M)',
    measure_hint: 'Click two points on the surface. Click again to start over, Esc to leave.',
    m_distance: 'Distance',
    m_delta: 'Along X, Y, Z',
    save_image: 'Save image',
    tip_save_image: 'Save the current view as a PNG file',
    save_failed: 'The image could not be saved here.',
    section_title: 'Section',
    sec_off: 'Off',
    sec_axis: 'Cut along',
    sec_pos: 'Position',
    sec_flip: 'Flip side',
    shading_title: 'Appearance',
    shading: 'Shading',
    sh_original: 'Original',
    sh_solid: 'Solid gray',
    sh_normals: 'Normals',
    sh_xray: 'X-ray',
    sh_matcap: 'Matcap',
    sh_flat: 'Flat',
    sh_vertex: 'Vertex colors',
    opacity: 'Opacity',
    filter: 'Filter parts',
    filter_ph: 'Filter by name',
    filter_none: 'No part matches.',
    gl_lost: 'The graphics context was lost (for example after a GPU reset). The view returns when the system restores it.',
    gl_unavailable: 'WebGL is not available here, so 3D models cannot be drawn.',
    canvas_label: '3D view. Arrow keys move the view, plus and minus zoom, R resets.',
    drop_title: 'Drop a STEP file here',
    drop_title_replace: 'Drop to open this file',
    drop_formats: 'Supported: {list}',
    drop_hint: 'You can drag a file in from Finder or any folder, one after another: each one replaces the view.',
    pick_file: 'Choose file…',
    open_file: 'Open another file…',
    tip_open_file: 'Open a file from anywhere (or drop it onto the view)',
    unsupported_file: 'The format .{ext} is not supported here. Supported: {list}.',
    unsupported_other: '.{ext} files open in the companion plugin 3D Model Viewer (GLB, PLY, OBJ, STL, 3MF). Install it and open the file there.',
    drop_more: '{n} more file(s) were ignored: drop files one at a time.',
    drop_nothing: 'Nothing to open: the drop contained no files.',
    too_big: 'This STEP file is {size}. The converter needs roughly 40 times that in memory and WebAssembly stops at 4 GB, so files above about {max} cannot be read.',
    read_failed: 'The file could not be read: {why}',
    s_name: 'File',
    loading: 'Loading {type} ({size}) …',
    toolbar_label: 'Toolbar',
    side_title: 'Sidebar',
    side_close: 'Close sidebar',
    side_empty: 'Open a file to see its details and settings here.',
    more: 'More ▾',
    more_tip: 'More: open a folder, reset everything',
    resizer_label: 'Resize the sidebar (arrow keys; double-click resets)',
    waiting: 'Waiting for the file …',
    starting: 'Starting the converter …',
    reading: 'Reading the STEP file … {s} s',
    reading_hint: 'The converter cannot report how far it is. Large or detailed files take a while and a lot of memory. Cancel stops it at once.',
    building: 'Building the view …',
    cancelled: 'Cancelled. Choose a quality or press Load to try again.',
    empty: 'The file is empty (0 bytes). It may still be written, or the writer stopped early.',
    not_step: 'This does not look like a STEP file (it should start with ISO-10303-21).',
    cannot_read: 'This STEP file ({size}) cannot be read: {why}',
    unexpected_error: 'Something went wrong: {why}',
    converter_failed: 'The converter could not read it (not a valid STEP file, or an unsupported schema).',
    no_shapes: 'The STEP file was read, but it contains no solid or surface shapes to show.',
    bad_coords: 'The model has no valid coordinates (empty or not finite).',
    worker_failed: 'The converter stopped unexpectedly (probably out of memory). Try Coarse quality, or a smaller file.',
    no_worker: 'A background worker is not available here, so the file is read in the page: the view stays busy until it is done.',
    memory_warn: 'This file ({size}) may need roughly {gb} GB of memory and take a minute or more to read (measured: 0.5 GB for a 4 MB file, 1.5 GB for a 35 MB file). Orca could slow down or run out of memory.',
    memory_warn_fine: 'Fine quality needs clearly more time and memory.',
    warn_big_mesh: 'Large mesh ({n} triangles): orbiting may stutter. Keep the mesh off.'
  },
  de: {
    background: 'Hintergrund',
    bg_auto: 'wie Orca',
    bg_light: 'hell',
    bg_dark: 'dunkel',
    bg_look: 'wie der Look',
    surface: 'Fläche',
    mesh: 'Mesh',
    tip_mesh_on: 'Fläche wird gezeigt. Klick: Mesh (W)',
    tip_surface_on: 'Wieder die Fläche zeigen (W)',
    reset_prefs: 'Alles zurücksetzen',
    edges: 'Kanten',
    edges_changed: 'Ein Werkzeug hat die Dreiecke einiger Teile ersetzt; deren Kanten sind jetzt die scharfen Kanten (über 30 Grad), weil die Flächen nicht mehr bekannt sind.',
    edges_skipped: '{n} Teil(e) sind zu groß (oder der Speicher reichte nicht), um Kanten zu bekommen.',
    row_expand: '{name} aufklappen',
    row_collapse: '{name} zuklappen',
    grid: 'Raster',
    axes: 'Achsen',
    box: 'Box',
    over: 'Netz drüber',
    backfaces: 'Rückseiten',
    panel: 'Seitenleiste',
    tip_background: 'Nächster Hintergrund (B)',
    tip_edges: 'CAD-Kanten: wo zwei Flächen zusammentreffen',
    tip_grid: 'Bodenraster (G)',
    tip_axes: 'Achsen X (rot), Y (grün), Z (blau) am Ursprung',
    tip_box: 'Umgebungsbox',
    tip_over: 'Zeichnet die Netzlinien über die geschlossene Fläche',
    tip_backfaces: 'Rückseiten der Flächen zeichnen',
    tip_panel: 'Seitenleiste ein- oder ausblenden (P)',
    quality: 'Netzqualität',
    q_coarse: 'Grob (schnell)',
    q_normal: 'Normal',
    q_fine: 'Fein (langsam, groß)',
    quality_hint: 'STEP enthält exakte Flächen. Beim Einlesen werden sie in Dreiecke zerlegt; feiner heißt mehr Dreiecke, mehr Zeit und mehr Speicher.',
    cancel: 'Abbrechen',
    load_anyway: 'Trotzdem laden',
    stats: 'Kennzahlen',
    orientation: 'Ausrichtung',
    up_is: 'Oben ist',
    up_y: '+Y oben',
    up_z: '+Z oben (CAD)',
    hint_y: 'Y-oben-Daten werden unverändert gezeigt.',
    hint_z: 'CAD-Konvention: +Z ist oben (zur Anzeige um −90° um die X-Achse gedreht).',
    parts: 'Teile',
    parts_visible: '{v} / {n} sichtbar',
    all: 'Alle',
    none: 'Keine',
    invert: 'Umkehren',
    color_by_part: 'Farbe je Teil',
    tip_color_by_part: 'Jedes Teil in einer eigenen Farbe',
    tip_tint_shading: 'Farbe je Teil gibt es nur im Look Original',
    studio_unlit: 'Dieser Look ist unbeleuchtet: Studio-Lichter ändern hier nichts',
    studio_points_no_shadow: 'Punkte und Splats werfen keinen Schatten',
    tip_needs_selection: 'Wähle zuerst ein Teil',
    parts_hint: 'Klick ins Bild wählt ein Teil. Doppelklick auf eine Zeile zeigt nur dieses Teil. Eingerückte Zeilen gehören zur Baugruppe darüber.',
    parts_more: '… und {n} weitere (Liste auf {max} begrenzt; die Knöpfe neben der Liste gelten für alle Teile).',
    visible_label: 'Sichtbar: {name}',
    part_n: 'Teil {n}',
    s_size: 'Dateigröße',
    s_parts: 'Teile',
    s_faces: 'Flächen (B-Rep)',
    s_triangles: 'Dreiecke',
    s_extent: 'Ausdehnung X × Y × Z',
    s_height: 'Höhenbereich',
    s_grid: 'Rasterweite',
    s_unit: 'Einheit',
    s_read: 'Lesezeit',
    s_memory: 'Speicher des Konverters',
    s_quality: 'Netzqualität',
    unit_file: '{name} (laut Datei)',
    unit_converted: '{name} (Dateieinheit {orig} umgerechnet)',
    unit_default: '{name} (Dateieinheit nicht gefunden)',
    u_millimeter: 'Millimeter',
    u_centimeter: 'Zentimeter',
    u_meter: 'Meter',
    u_inch: 'Zoll',
    u_foot: 'Fuß',
    u_micron: 'Mikrometer',
    u_kilometer: 'Kilometer',
    preset: 'Blick',
    pv_all: 'Alles zeigen (R)',
    pv_hero: 'Hero',
    pv_iso: 'Isometrisch',
    pv_front: 'Vorne',
    pv_back: 'Hinten',
    pv_left: 'Links',
    pv_right: 'Rechts',
    pv_top: 'Oben',
    pv_bottom: 'Unten',
    tip_preset: 'Blick wählen (Tasten 1 bis 8, R zeigt alles)',
    measure: 'Messen',
    tip_measure: 'Abstand zwischen zwei Punkten auf der Oberfläche messen (M)',
    measure_hint: 'Zwei Punkte auf der Oberfläche anklicken. Erneut klicken beginnt neu, Esc beendet.',
    m_distance: 'Abstand',
    m_delta: 'Entlang X, Y, Z',
    save_image: 'Bild speichern',
    tip_save_image: 'Die aktuelle Ansicht als PNG-Datei speichern',
    save_failed: 'Das Bild konnte hier nicht gespeichert werden.',
    section_title: 'Schnitt',
    sec_off: 'Aus',
    sec_axis: 'Schnitt entlang',
    sec_pos: 'Lage',
    sec_flip: 'Seite wechseln',
    shading_title: 'Darstellung',
    shading: 'Schattierung',
    sh_original: 'Original',
    sh_solid: 'Einfarbig grau',
    sh_normals: 'Normalen',
    sh_xray: 'Röntgen',
    sh_matcap: 'Matcap',
    sh_flat: 'Facettiert',
    sh_vertex: 'Vertexfarben',
    opacity: 'Deckkraft',
    filter: 'Teile filtern',
    filter_ph: 'Nach Name filtern',
    filter_none: 'Kein Teil passt.',
    gl_lost: 'Der Grafikkontext ging verloren (z. B. nach einem GPU-Reset). Die Ansicht kommt zurück, sobald das System ihn wiederherstellt.',
    gl_unavailable: 'WebGL ist hier nicht verfügbar, 3D-Modelle können nicht gezeichnet werden.',
    canvas_label: '3D-Ansicht. Pfeiltasten verschieben die Ansicht, Plus und Minus zoomen, R setzt sie zurück.',
    drop_title: 'Eine STEP-Datei hier ablegen',
    drop_title_replace: 'Zum Öffnen dieser Datei ablegen',
    drop_formats: 'Unterstützt: {list}',
    drop_hint: 'Dateien lassen sich aus dem Finder oder jedem Ordner hereinziehen, auch nacheinander: jede ersetzt die Ansicht.',
    pick_file: 'Datei wählen …',
    open_file: 'Andere Datei öffnen …',
    tip_open_file: 'Eine Datei von überall öffnen (oder auf die Ansicht ziehen)',
    unsupported_file: 'Das Format .{ext} wird hier nicht unterstützt. Unterstützt: {list}.',
    unsupported_other: '.{ext}-Dateien öffnen im Begleit-Plugin 3D Model Viewer (GLB, PLY, OBJ, STL, 3MF). Installieren und die Datei dort öffnen.',
    drop_more: '{n} weitere Datei(en) wurden ignoriert: Dateien einzeln ablegen.',
    drop_nothing: 'Nichts zu öffnen: Das Abgelegte enthielt keine Dateien.',
    too_big: 'Diese STEP-Datei ist {size} groß. Der Konverter braucht etwa das 40-Fache an Speicher und WebAssembly endet bei 4 GB; Dateien über etwa {max} lassen sich nicht lesen.',
    read_failed: 'Die Datei konnte nicht gelesen werden: {why}',
    s_name: 'Datei',
    loading: 'Lade {type} ({size}) …',
    toolbar_label: 'Werkzeugleiste',
    side_title: 'Seitenleiste',
    side_close: 'Seitenleiste schließen',
    side_empty: 'Eine Datei öffnen, um hier Kennzahlen und Einstellungen zu sehen.',
    more: 'Mehr ▾',
    more_tip: 'Mehr: Ordner öffnen, alles zurücksetzen',
    resizer_label: 'Seitenleiste verbreitern (Pfeiltasten; Doppelklick: zurück)',
    waiting: 'Warte auf die Datei …',
    starting: 'Starte den Konverter …',
    reading: 'Lese die STEP-Datei … {s} s',
    reading_hint: 'Der Konverter kann keinen Fortschritt melden. Große oder detailreiche Dateien brauchen Zeit und viel Speicher. „Abbrechen“ stoppt sofort.',
    building: 'Baue die Ansicht …',
    cancelled: 'Abgebrochen. Qualität wählen oder „Laden“ drücken, um es erneut zu versuchen.',
    empty: 'Die Datei ist leer (0 Byte). Sie wird vielleicht noch geschrieben, oder das Schreiben brach ab.',
    not_step: 'Das sieht nicht nach einer STEP-Datei aus (sie sollte mit ISO-10303-21 beginnen).',
    cannot_read: 'Diese STEP-Datei ({size}) lässt sich nicht lesen: {why}',
    unexpected_error: 'Etwas ist schiefgegangen: {why}',
    converter_failed: 'Der Konverter konnte sie nicht lesen (keine gültige STEP-Datei oder ein nicht unterstütztes Schema).',
    no_shapes: 'Die STEP-Datei wurde gelesen, enthält aber keine Körper oder Flächen zum Anzeigen.',
    bad_coords: 'Das Modell hat keine gültigen Koordinaten (leer oder nicht endlich).',
    worker_failed: 'Der Konverter ist unerwartet abgebrochen (vermutlich zu wenig Speicher). Es mit „Grob“ oder einer kleineren Datei versuchen.',
    no_worker: 'Ein Hintergrund-Worker ist hier nicht verfügbar, die Datei wird daher in der Seite gelesen: die Ansicht reagiert bis zum Ende nicht.',
    memory_warn: 'Diese Datei ({size}) braucht vermutlich etwa {gb} GB Speicher und eine Minute oder mehr zum Einlesen (gemessen: 0,5 GB bei einer 4-MB-Datei, 1,5 GB bei einer 35-MB-Datei). Orca kann langsam werden oder der Speicher ausgehen.',
    memory_warn_fine: 'Bei „Fein“ steigen Zeit und Speicher deutlich.',
    warn_big_mesh: 'Großes Netz ({n} Dreiecke): Drehen kann ruckeln. Das Mesh aus lassen.'
  }
}
Object.assign(STRINGS.en, EXPORT_STRINGS.en) // the export section is shared with the model viewer
Object.assign(STRINGS.de, EXPORT_STRINGS.de)
Object.assign(STRINGS.en, TOOLS_STRINGS.en) // the Edit tab is shared with the other viewer
Object.assign(STRINGS.de, TOOLS_STRINGS.de)
Object.assign(STRINGS.en, SESSION_STRINGS.en) // the kept-file note is shared with the other viewer
Object.assign(STRINGS.de, SESSION_STRINGS.de)
Object.assign(STRINGS.en, STUDIO_STRINGS.en) // the Studio section is shared with the other viewer
Object.assign(STRINGS.de, STUDIO_STRINGS.de)
Object.assign(STRINGS.en, PARTINFO_STRINGS.en) // the part card and measuring parts are shared with the other viewer
Object.assign(STRINGS.de, PARTINFO_STRINGS.de)
Object.assign(STRINGS.en, MEASURE_STRINGS.en) // Measure+ (list, chain, tab) is shared with the other viewer
Object.assign(STRINGS.de, MEASURE_STRINGS.de)
Object.assign(STRINGS.en, CHROME_STRINGS.en) // the toolbar, tabs and measuring bar are shared with the other viewer
Object.assign(STRINGS.de, CHROME_STRINGS.de)

export function pickLocale(tag) {
  return /^de(\b|-|_)/i.test(String(tag || '')) ? 'de' : 'en'
}

/** t(key, vars): the key in the locale, else English, else the key itself. */
export function makeT(locale) {
  const table = STRINGS[locale] || STRINGS.en
  return (key, vars) =>
    String(table[key] ?? STRINGS.en[key] ?? key).replace(/\{(\w+)\}/g, (_, n) => (vars && vars[n] !== undefined ? String(vars[n]) : ''))
}

// ---------- number formats ----------
const SMALLER = { m: ['cm', 100], cm: ['mm', 10], in: ['mm', 25.4], ft: ['in', 12] } // the next smaller unit and how many of it make one
function volumeText(v, u, power, tag) {
  const sig = (x) => {
    const a = Math.abs(x)
    if (!(a >= 1e-9)) return '0'
    const d = a >= 100 ? 0 : Math.min(9, Math.max(0, 2 - Math.floor(Math.log10(a))))
    return Number(x.toFixed(d)).toLocaleString(tag, { maximumFractionDigits: d })
  }
  const small = SMALLER[u]
  if (small && Math.abs(v) > 0 && Math.abs(v) < (power === 3 ? 0.01 : 0.001)) return `${sig(v * small[1] ** power)} ${small[0]}${power === 3 ? '³' : '²'}`
  return `${sig(v)} ${u}${power === 3 ? '³' : '²'}`
}

export function makeFormat(locale) {
  const tag = locale === 'de' ? 'de-DE' : 'en-US'
  const nf = new Intl.NumberFormat(tag)
  return {
    int: (n) => nf.format(Math.round(n)),
    mb: (b) => (b < 1e6 ? (b / 1e3).toLocaleString(tag, { maximumFractionDigits: 1 }) + ' KB' : (b / 1e6).toLocaleString(tag, { maximumFractionDigits: 2 }) + ' MB'),
    // three significant digits (never fewer than the whole part), so 0.045 m stays 0.045 and 1.2e-4 stays 0.00012; noise below a micro-unit is zero
    len: (v) => {
      const a = Math.abs(v)
      if (Number.isNaN(v)) return '–' // not a number: say so, not 0
      if (!(a >= 1e-6)) return '0'
      const digits = a >= 100 ? 0 : Math.min(9, Math.max(0, 2 - Math.floor(Math.log10(a))))
      const r = Number(v.toFixed(digits))
      return (r === 0 ? 0 : r).toLocaleString(tag, { maximumFractionDigits: digits })
    },
    // a volume or an area in the model's unit; a small one in the next smaller unit (0.00012 m3 is 120 cm3)
    vol: (v, u) => volumeText(v, u, 3, tag),
    area: (v, u) => volumeText(v, u, 2, tag),
    dur: (ms) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toLocaleString(tag, { maximumFractionDigits: 1 })} s`),
    dec: (v, d = 1) => v.toLocaleString(tag, { maximumFractionDigits: d })
  }
}

/** A round grid step (1, 2, 5 x 10^n) giving roughly a dozen cells across `extent`. */
export function niceStep(extent) {
  const raw = Math.max(extent, 1e-9) / 12
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  const f = raw / p
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p
}

/** Hue (0..1) of part i: golden-angle steps keep neighbours apart. */
export function partHue(i) {
  return ((i * 137.508) % 360) / 360
}

// ---------- quality ----------
/** Deflections handed to the converter. linearDeflection is a ratio of the average bounding box. */
export const QUALITY = {
  coarse: { linearDeflection: 0.004, angularDeflection: 0.8 },
  normal: { linearDeflection: 0.001, angularDeflection: 0.5 },
  fine: { linearDeflection: 0.00025, angularDeflection: 0.25 }
}

export function converterParams(quality, linearUnit) {
  const q = QUALITY[quality] || QUALITY.normal
  return { linearUnit, linearDeflectionType: 'bounding_box_ratio', linearDeflection: q.linearDeflection, angularDeflection: q.angularDeflection }
}

/** Measured at Normal quality (converter heap): 0.5 GB for a 4.3 MB file, 1.5 GB for a 34.6 MB file. A line through
 *  those points, 0.3 GB + 40 times the file size, is the rough warning figure, not a promise (it depends on the content). */
export const MEMORY_BASE_GB = 0.3
export const MEMORY_FACTOR = 40
export const WARN_BYTES = 15e6
export function memoryEstimateGB(bytes) {
  return MEMORY_BASE_GB + (bytes * MEMORY_FACTOR) / 1e9
}

// ---------- STEP file ----------
export function looksLikeStep(bytes) {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 512)))
  return /^\s*ISO-10303-21/.test(head)
}

const SI_PREFIX = { MILLI: 'millimeter', CENTI: 'centimeter', MICRO: 'micron', KILO: 'kilometer' }
/** The converter can output these; others are converted to millimeters. */
export const OUTPUT_UNITS = { millimeter: 'mm', centimeter: 'cm', meter: 'm', inch: 'in', foot: 'ft' }

/** Finds the file's length unit: SI_UNIT(.MILLI.,.METRE.) or CONVERSION_BASED_UNIT('INCH', ...).
 *  Returns { name, found } with name one of millimeter, centimeter, meter, inch, foot, micron, kilometer. */
export function detectStepUnit(bytes) {
  const text = new TextDecoder('latin1').decode(bytes)
  const re = /LENGTH_UNIT\s*\(\s*\)/g
  let m
  let si = null
  while ((m = re.exec(text))) {
    const start = text.lastIndexOf(';', m.index) + 1
    const end = text.indexOf(';', m.index)
    const stmt = text.slice(start, end < 0 ? undefined : end)
    // an explicit conversion-based unit (inch, foot) is the file's unit; the SI unit it is defined from may come first
    const cb = /CONVERSION_BASED_UNIT\s*\(\s*'([^']*)'/i.exec(stmt)
    if (cb) {
      const n = cb[1].toLowerCase()
      if (n.startsWith('inch')) return { name: 'inch', found: true }
      if (n.startsWith('foot') || n.startsWith('feet')) return { name: 'foot', found: true }
    }
    const siMatch = /SI_UNIT\s*\(\s*(?:\.(\w+)\.|\$)?\s*,\s*\.METRE\.\s*\)/i.exec(stmt)
    if (siMatch && !si) si = { name: siMatch[1] ? SI_PREFIX[siMatch[1].toUpperCase()] || 'millimeter' : 'meter', found: true }
  }
  return si || { name: 'millimeter', found: false }
}

/** What the converter is asked for and how the unit is described afterwards. */
export function planUnit(detected) {
  const out = detected.name in OUTPUT_UNITS ? detected.name : 'millimeter'
  const mode = !detected.found ? 'default' : out === detected.name ? 'file' : 'converted'
  return { linearUnit: out, short: OUTPUT_UNITS[out], mode, fileUnit: detected.name }
}

// ---------- assembly tree ----------
/** Turns the converter's node tree into list rows. A node with children (or several meshes) is an assembly row, its
 *  children and meshes are the rows below it, indented. A nameless wrapper node is skipped.
 *  rows: [{ depth, name, src: 'file' | 'ui' (who named it), meshes: number[] (all meshes below), group: boolean }]. `meshNames[i]` names mesh i. */
export function buildRows(root, meshNames, partName) {
  const meshCount = meshNames.length
  const named = (s) => !!(s && String(s).trim())
  const prep = (n) => {
    const kids = (n.children || []).map(prep)
    const own = Array.isArray(n.meshes) ? n.meshes.filter((i) => Number.isInteger(i) && i >= 0 && i < meshCount) : []
    return { node: n, own, kids, all: [...own, ...kids.flatMap((k) => k.all)] }
  }
  const rows = []
  let counter = 0
  // a name the file gives is the file's (src 'file'); a "Part 3" the viewer makes up is its own (src 'ui'): the list says which, so that the honesty check can tell them apart
  const lab = (s) => (named(s) ? { name: String(s).trim(), src: 'file' } : { name: partName(++counter), src: 'ui' })
  const emit = (c, depth) => {
    if (c.all.length === 0) return
    if (!named(c.node.name) && c.own.length === 0 && c.kids.length > 0) {
      for (const k of c.kids) emit(k, depth) // nameless wrapper: its children take its place
      return
    }
    const hasKids = c.kids.some((k) => k.all.length > 0)
    const group = hasKids || c.own.length > 1
    if (c.own.length === 1 && !hasKids) {
      rows.push({ depth, ...(named(c.node.name) ? lab(c.node.name) : lab(meshNames[c.own[0]])), meshes: c.own.slice(), group: false })
      return
    }
    rows.push({ depth, ...lab(c.node.name), meshes: c.all, group })
    if (c.own.length > 1 || (c.own.length === 1 && hasKids)) for (const i of c.own) rows.push({ depth: depth + 1, ...lab(meshNames[i]), meshes: [i], group: false })
    for (const k of c.kids) emit(k, depth + 1)
  }
  emit(prep(root || {}), 0)
  const seen = new Set(rows.flatMap((r) => r.meshes))
  for (let i = 0; i < meshCount; i++) if (!seen.has(i)) rows.push({ depth: 0, ...lab(meshNames[i]), meshes: [i], group: false })
  return rows
}

// ---------- views ----------
export const PRESETS = ['iso', 'front', 'back', 'left', 'right', 'top', 'bottom', 'hero']
const PRESET_DIR = { iso: [0.7, 0.55, 0.9], front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0], top: [0, 1, 0.0001], bottom: [0, -1, 0.0001], hero: [0.45, 0.16, 1] }
/** Unit direction from the model towards the camera, in view space (+Y is up, front looks along -Z). */
/** How much of the fitting distance a view keeps: the hero shot stands a little closer. */
export const presetScale = (name) => (name === 'hero' ? 0.82 : 1)

export function presetDirection(name) {
  const d = PRESET_DIR[name] || PRESET_DIR.iso
  const l = Math.hypot(...d)
  return d.map((v) => v / l)
}

/** Totals over the parts of a model: triangles, vertices (of meshes and lines), points and B-rep faces (STEP). */
export function summarizeParts(parts) {
  let tris = 0
  let verts = 0
  let pts = 0
  let faces = 0
  for (const p of parts) {
    tris += p.tris || 0
    faces += p.faces || 0
    if (p.kind === 'points') pts += p.verts || 0
    else verts += p.verts || 0
  }
  return { tris, verts, pts, faces }
}

/** How far the camera must be from the center of a sphere of `radius` for all of it to be seen: in the narrower of the vertical and the horizontal field of view
 *  (a tall, narrow view is the narrow one), with a margin. */
export function fitDistance(radius, fovDeg, aspect, margin = 1.08) {
  const v = (fovDeg * Math.PI) / 180
  const h = 2 * Math.atan(Math.tan(v / 2) * Math.max(aspect, 0.05))
  return (radius * margin) / Math.sin(Math.min(v, h) / 2)
}

/** The clipping plane for an axis ('x' | 'y' | 'z', in view space), a position 0..1 across the box and a side.
 *  Points with normal . p + constant < 0 are cut away. Returns { normal, constant }. */
export function clipPlane(axis, t, min, max, flip) {
  const i = { x: 0, y: 1, z: 2 }[axis]
  if (i === undefined) return null
  const pos = min[i] + (max[i] - min[i]) * Math.min(1, Math.max(0, t))
  const n = [0, 0, 0]
  n[i] = flip ? -1 : 1
  return { normal: n, constant: flip ? pos : -pos }
}

/** Distance between two points and the parts along the file's own axes (the same vectors, turned back by the model rotation). */
export function measureInfo(a, b) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  return { distance: Math.hypot(...d), delta: d }
}

/** Which view-space axis a file axis ends up on after the "up is" rotation, and whether it points the same way.
 *  up 'y': none; '-y': x stays, y and z reverse; 'z': y -> z (file z becomes view y, file y becomes view -z). */
export function fileAxisToView(axis, up) {
  if (up === 'z') return { x: { axis: 'x', sign: 1 }, y: { axis: 'z', sign: -1 }, z: { axis: 'y', sign: 1 } }[axis] || null
  if (up === '-y') return { x: { axis: 'x', sign: 1 }, y: { axis: 'y', sign: -1 }, z: { axis: 'z', sign: -1 } }[axis] || null
  return { x: { axis: 'x', sign: 1 }, y: { axis: 'y', sign: 1 }, z: { axis: 'z', sign: 1 } }[axis] || null
}


// ---------- opening files by drop or picker ----------
export const SUPPORTED_EXT = ['step', 'stp']
/** Measured: the converter held about 43 times the file size (1.5 GB for 34.6 MB) and WebAssembly memory ends at 4 GB. */
export const HARD_MAX_BYTES = 90e6

export function extOf(name) {
  const m = /\.([A-Za-z0-9]+)$/.exec(String(name || ''))
  return m ? m[1].toLowerCase() : ''
}

/** From a drop or a picker: the first file with a supported extension; `ignored` counts the other files. */
export function pickFile(files, supported) {
  const list = Array.from(files || [])
  const ok = list.filter((f) => supported.includes(extOf(f.name)))
  return { file: ok[0] || null, ignored: Math.max(0, list.length - (ok[0] ? 1 : 0)), unsupported: list.filter((f) => !supported.includes(extOf(f.name))).map((f) => f.name) }
}

/** The start file Orca opens for "new STEP viewer" (a tiny text file): first line is the marker. */
export function isStartText(text) {
  return /^\uFEFF?\s*stepview-start\b/.test(String(text).slice(0, 64))
}

/** One line of state that an agent can read with `orca plugin logs`: what is on screen. */
export function stateLine(plugin, info) {
  return `${plugin}-state ${JSON.stringify(info)}`
}
