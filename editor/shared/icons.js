// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// The symbols of the toolbar, the status bar and the cards: our own drawings on a 24 x 24 grid (stroke 1.8, round ends, drawn with `currentColor`),
// so that no outside symbol set (and no licence) is involved. The markup is plain SVG shapes only (path, circle, rect): icons.test.mjs enforces that.
// `icon(name)` makes the element; it carries no text: the button next to it (or its aria-label) says what it does.

export const ICONS = {
  open: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  front: '<rect x="5" y="5" width="14" height="14" rx="1.5"/><path d="M5 9.5h14"/>',
  measure: '<path d="M3.5 16.5l13-13 4 4-13 13z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>',
  cut: '<path d="M3 12h18"/><path d="M6 8l6-4 6 4M6 16l6 4 6-4"/>',
  look: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none" opacity=".5"/>',
  studio: '<circle cx="12" cy="12" r="3.6"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/>',
  export: '<path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/>',
  more: '<circle cx="5.5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18.5" cy="12" r="1.2"/>',
  side: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M14.5 4.5v15"/>',
  home: '<path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4"/><rect x="9" y="9" width="6" height="6" rx="1"/>',
  iso: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12L4 7.5M12 12v9"/>',
  isolate: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>',
  invert: '<path d="M7 7h10l-3-3M17 17H7l3 3"/>',
  multi: '<path d="M4 7l2 2 3-3M4 16l2 2 3-3"/><path d="M12 8h8M12 17h8"/>',
  none: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  hide: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/><path d="M4 4l16 16"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  zoom: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  group: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/>',
  part: '<rect x="5" y="5" width="14" height="14" rx="2.5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  edit: '<path d="M4 20l4-1 11-11-3-3L5 16z"/>',
  check: '<path d="M5 12l4.5 4.5L19 7"/>',
  drop: '<path d="M12 15V4M8 8l4-4 4 4"/><path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r=".6" fill="currentColor"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.7a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.2 1-1.2 1.9"/><circle cx="12" cy="16.7" r=".6" fill="currentColor"/>',
  tree: '<rect x="4" y="4" width="5.5" height="5" rx="1.2"/><path d="M6.7 9v9.5H14M6.7 12.5H14"/><rect x="14" y="10.5" width="6" height="4" rx="1.2"/><rect x="14" y="16.5" width="6" height="4" rx="1.2"/>',
  volume: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5v9l-8-4.5z" fill="currentColor" stroke="none" opacity=".35"/>',
  weight: '<path d="M7.2 8.5h9.6L19 19.5H5z"/><circle cx="12" cy="5.8" r="2"/>',
  // round 5 (the Modeler's bar and cards): undo, redo, new file, the card heads Parameters, Steps, Recipe, and the warning of a hint
  undo: '<path d="M9 7L4.5 11.5 9 16"/><path d="M5 11.5h9a5 5 0 0 1 0 10h-2"/>',
  redo: '<path d="M15 7l4.5 4.5L15 16"/><path d="M19 11.5h-9a5 5 0 0 0 0 10h2"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  steps: '<rect x="4" y="4" width="16" height="4.5" rx="1.2"/><rect x="4" y="10" width="16" height="4.5" rx="1.2"/><rect x="4" y="16" width="16" height="4.5" rx="1.2"/>',
  code: '<path d="M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5"/><path d="M13.5 5.5l-3 13"/>'
}

const NS = 'http://www.w3.org/2000/svg'

/** An <svg class="i"> with the symbol `name` (an unknown name is a mistake in the code and throws, so that no button stays blank unnoticed). The size comes from the CSS (`svg.i`). */
export function icon(name, className = '') {
  const markup = ICONS[name]
  if (!markup) throw new Error(`unknown icon: ${name}`)
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('class', `i${className ? ` ${className}` : ''}`)
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  svg.innerHTML = markup // our own constant markup, never user text
  return svg
}
