// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// The element ids the end-to-end tests (dev/e2e-*.mjs) and the scripts depend on. A page that loses one of them breaks those tests
// without any other warning, so ui-ids.test.mjs checks them against index.html and panel.html. Remove an id here when its control goes.

/** In the pages of both viewers. */
export const COMMON_IDS = [
  'b-axes',
  'b-bg',
  'b-copy-details',
  'b-ex-make',
  'b-ex-save',
  'b-close',
  'b-grid',
  'b-measure',
  'b-resetprefs',
  'b-wire',
  'ex-format',
  'ex-png-bg',
  'ex-png-hint',
  'ex-result',
  'file-input',
  'gl',
  'keep-row',
  'keep-text',
  'measure-mode',
  'measure-out',
  'msg-text',
  'shading',
  'stats',
  'tl-check',
  'tl-detail',
  'tl-keep',
  'tl-result',
  'tl-unit'
]

/** Only in the 3D Model Viewer. */
export const MODEL_IDS = [
  'anim-sec',
  'b-ex-cancel',
  'b-export',
  'b-tex',
  'drop',
  'drop-explain',
  'drop-gate',
  'drop-gate-text',
  'drop-note',
  'ex-notes',
  'explode',
  'filter',
  'part-opacity',
  'splat-mode',
  'splat-row',
  'stage',
  'tl-cv-after',
  'tl-cv-before',
  'tl-mirror',
  'tl-rotate',
  'tl-scale',
  'tl-scale-go',
  'tl-status',
  'tl-thumbs',
  'up',
  'warn'
]

/** Only in the STEP Viewer 3D. */
export const STEP_IDS = [
  'b-edges',
  'parts',
  'sec-axis',
  'stats-sec',
  'tl-parts-group'
]

/** Built by studio-ui.js (the section is made in script, not in the page). */
export const STUDIO_IDS = ['studio-sec', 'st-preset', 'st-bg', 'st-color', 'st-floor', 'st-shadow', 'st-lights', 'st-exposure', 'st-tone', 'st-quality', 'st-speed', 'st-spin', 'st-reset', 'st-note']

/** Built by part-card.js (the card in the Parts section and the chip in the view). */
export const PARTCARD_IDS = ['part-card', 'sel-chip']

/** Built by chrome-layout.js (the toolbar's new buttons, the side tabs, the measuring bar). */
export const CHROME_IDS = ['b-card-edit', 'b-cut-off', 'b-sel-clear', 'tree-wrap', 'tree-strip', 'card-files', 'b-files-open', 'b-files-close', 'file-row', 'b-view', 'b-open-bar', 'b-diag', 'b-front', 'b-cut', 'm-cut', 'status', 'status-slot', 'b-look', 'b-studio', 'b-viewall', 'b-viewfit', 'side-tabs', 'measure-bar', 'b-measure-clear', 'b-measure-done', 'b-folder-more', 'info-title', 'info-selected', 'stats-adv', 'stats-more', 'studio-anchor', 'pop-view', 'pop-look', 'pop-studio', 'st-bgmode', 'st-bg-swatches', 'st-bg-custom', 'st-bg-note', 'st-why', 'b-surf', 'b-mesh', 'm-studio', 'm-export', 'parts-cap', 'st-unlit', 'st-unlit-fix', 'b-film', 'st-foot', 'export-dialog', 'export-kind', 'b-ex-edit', 'b-shot-open', 'ex-adv', 'b-ex-go', 'b-ex-close2', 'ex-small', 'export-orig']

/** Built by shell.js (the left column of the three-column layout). */
export const SHELL_IDS = ['col-l']
