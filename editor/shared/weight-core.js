// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// The weight ESTIMATE (UX v3, stage E3). It is only ever shown when the person asks for it (a density chosen from a short list of guide values),
// only for a STEP file whose unit was read from the file, only where the mesh is closed (so it has a volume), and always with the mark "Estimate".
// Pure functions, no DOM. Mesh volume (in the file's unit cubed) × density (g/cm³) = grams.

/** Guide values (g/cm³): typical for the material in general, NOT read from the file. The names are strings in partinfo-strings.js (pc_dens_<k>). */
export const DENSITIES = [
  { k: 'steel', v: 7.85 },
  { k: 'stainless', v: 7.9 },
  { k: 'aluminium', v: 2.7 },
  { k: 'brass', v: 8.5 },
  { k: 'copper', v: 8.96 },
  { k: 'pla', v: 1.24 },
  { k: 'abs', v: 1.04 }
]

/** Centimetres in one unit of length (the short names the viewers use). */
export const CM_PER_UNIT = { 'µm': 1e-4, mm: 0.1, cm: 1, m: 100, in: 2.54, ft: 30.48 }

/** planUnit() modes (STEP viewer) in which the unit comes from the file: found in it ("file"), or found and converted by the converter ("converted"). "default" means it was not found; "tool" means the person set it. */
export const UNIT_FROM_FILE_MODES = ['file', 'converted']
export const unitFromFile = (mode) => UNIT_FROM_FILE_MODES.includes(mode)

/** Cubic centimetres in `volume` (a mesh volume in unit³), or null for a unit this does not know or a volume that is not a positive finite number. */
export function volumeCm3(volume, unit) {
  const k = CM_PER_UNIT[unit]
  if (!k || typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0) return null
  return volume * k * k * k
}

/** The density record for a key, or null. */
export const densityOf = (key) => DENSITIES.find((d) => d.k === key) || null

/** Grams, or null when there is no basis: no volume (an open mesh), a unit that is not from the file, an unknown unit or no density chosen. */
export function weightGrams({ volume, unit, mode, density }) {
  const d = typeof density === 'string' ? densityOf(density) : density
  if (!d || !unitFromFile(mode)) return null
  const cm3 = volumeCm3(volume, unit)
  return cm3 === null ? null : cm3 * d.v
}

/** Why there is no estimate, for the card: 'unit' (not from the file), 'volume' (no closed mesh), or null (an estimate is possible once a density is chosen). */
export function whyNoEstimate({ volume, mode }) {
  if (!unitFromFile(mode)) return 'unit'
  if (volume === null || volume === undefined || !Number.isFinite(volume)) return 'volume'
  return null
}

/**
 * { value, unit: 'g' | 'kg', digits } for a weight in grams: kilograms from 1 kg, grams with two decimals under 10 g, whole grams above. The limits are decided on
 * the ROUNDED value, so that 999.6 g reads "1.00 kg" and not "1000 g", and 9.996 g reads "10 g" and not "10.00 g".
 */
export function scaleWeight(grams) {
  const r = (v, d) => Math.round(v * 10 ** d) / 10 ** d
  if (r(grams, 0) >= 1000) return { value: grams / 1000, unit: 'kg', digits: 2 }
  if (r(grams, 2) >= 10) return { value: grams, unit: 'g', digits: 0 }
  return { value: grams, unit: 'g', digits: 2 }
}
