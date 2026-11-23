// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// The numbers of the view (UX v3, E4), worked out from the camera alone and free of the page, so that they can be tested without a browser:
//   pixelsPerUnit  how many screen pixels one model unit is, IN THE PLANE OF THE ORBIT TARGET (the camera is a perspective camera: a scale bar is true there and nowhere else)
//   niceLength     the length of the scale bar: the largest value of the series 1-2-5 (1, 2, 5, 10, 20, 50, ...) that still fits in the given pixels
//   zoomPercent    100 % is "show all"; twice as close is 200 %

/** Pixels per model unit at distance `distance` from a perspective camera (`fovDeg` is the vertical field of view, `viewH` the height of the view in pixels). null when it is not defined. */
export function pixelsPerUnit({ fovDeg, viewH, distance }) {
  if (![fovDeg, viewH, distance].every(Number.isFinite) || fovDeg <= 0 || fovDeg >= 180 || viewH <= 0 || distance <= 0) return null
  return viewH / 2 / (Math.tan((fovDeg * Math.PI) / 360) * distance)
}

/** The 1-2-5 length for a scale: { length (model units), px }. The bar is at most `maxPx` and, as the steps of the series are at most 2.5 apart, at least maxPx / 2.5. null when ppu is not usable. */
export function niceLength(ppu, { maxPx = 140 } = {}) {
  if (!Number.isFinite(ppu) || ppu <= 0 || !(maxPx > 0)) return null
  const limit = maxPx / ppu // the longest length that fits
  const e = Math.floor(Math.log10(limit))
  let best = null
  for (const k of [e - 1, e, e + 1]) for (const m of [1, 2, 5]) {
    const length = Number((m * 10 ** k).toPrecision(12)) // 0.1 * 3 is 0.30000000000000004: the series is exact
    if (length <= limit * (1 + 1e-12) && (!best || length > best)) best = length
  }
  return best === null ? null : { length: best, px: best * ppu }
}

/** Zoom in percent: the distance of "show all" over the distance of the camera. null when not defined. */
export function zoomPercent(fitDistance, distance) {
  if (!Number.isFinite(fitDistance) || !Number.isFinite(distance) || fitDistance <= 0 || distance <= 0) return null
  return Math.round((fitDistance / distance) * 100)
}

/** A length as text without float noise: at most `digits` significant digits, in the locale. */
export function lengthText(value, locale, digits = 6) {
  return Number(value.toPrecision(digits)).toLocaleString(locale || undefined, { maximumSignificantDigits: digits, useGrouping: true }) // significant digits: 0.0000000005 stays 0.0000000005, never "0"
}
