// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// The logic of the part tree (UX v3, E2b), one place for both viewers and free of the page, so that it can be tested without a browser:
//   rows        [{ depth, name, meshes: number[] (every part below the row), group: boolean }]  the data form of the STEP viewer's tree
//   rowsFromPaths   the Model Viewer's flat list of parts (each with the named groups above it) turned into the same rows
//   visibleRows     which rows are on screen: a folded group hides what is below it; a filter shows every match whatever is folded
//   rowState / navTarget   tri-state of a row (checkbox, selection) and the arrow keys of a tree (WAI-ARIA "tree")
export const MAX_ROWS = 1000

/** Rows from a flat list of parts. items: [{ label, named?, path: [{ id, name }] }], `path` = the named groups above the part, outermost first (a group is told apart by `id`, not by name).
 *  A group becomes a row of its own (group: true) in front of the parts below it; its `meshes` hold every part index below it. Depth = number of groups above.
 *  A group with only ONE part below it gets no row (a named wrapper around one mesh, like a chain "root > scene > node": it would only add a level); the nearest such wrapper names the part, unless the part has a name of its own (`named: true`). */
export function rowsFromPaths(items) {
  const count = new Map() // group id -> how many parts are below it
  for (const it of items) for (const g of it.path || []) count.set(g.id, (count.get(g.id) || 0) + 1)
  const rows = []
  let open = [] // [{ id, row }] the groups the previous part sat in
  items.forEach((it, idx) => {
    const full = Array.isArray(it.path) ? it.path : []
    const path = full.filter((g) => count.get(g.id) > 1)
    let k = 0
    while (k < open.length && k < path.length && open[k].id === path[k].id) k++
    open = open.slice(0, k)
    for (let d = k; d < path.length; d++) {
      const row = { depth: d, name: path[d].name, src: 'file', meshes: [], group: true }
      rows.push(row)
      open.push({ id: path[d].id, row })
    }
    for (const o of open) o.row.meshes.push(idx)
    // the nearest group is a wrapper around this one part (no row of its own): its name names the part, as the STEP viewer names a node with one mesh after the node
    const wrapper = !it.named && full.length && count.get(full.at(-1).id) === 1 && String(full.at(-1).name || '').trim() ? full.at(-1).name : null
    rows.push({ depth: path.length, name: wrapper || it.label, ...(wrapper ? { src: 'file' } : {}), meshes: [idx], group: false })
  })
  return rows
}

/** True when the row at `i` has rows below it (the next row is deeper): only such a row can be folded. */
export const hasKids = (rows, i) => !!(rows[i] && rows[i].group && rows[i + 1] && rows[i + 1].depth > rows[i].depth)

/** The indices of the rows whose text contains the query (case-insensitive, trimmed); an empty query keeps all. `texts[i]` is what the filter looks at for row i. */
export function matchRows(texts, query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return texts.map((_, i) => i)
  return texts.flatMap((t, i) => (String(t).toLowerCase().includes(q) ? [i] : []))
}

/** The rows on screen, in order. `collapsed` = Set of folded row indices. With a filter every match is shown whatever is folded (and without fold buttons). */
export function visibleRows(rows, { collapsed = new Set(), texts = null, query = '' } = {}) {
  const filtering = String(query || '').trim() !== ''
  if (filtering) return matchRows(texts || rows.map((r) => r.name), query)
  const out = []
  let hideBelow = Infinity
  rows.forEach((r, i) => {
    if (r.depth <= hideBelow) hideBelow = Infinity
    if (r.depth > hideBelow) return
    if (hasKids(rows, i) && collapsed.has(i)) hideBelow = r.depth
    out.push(i)
  })
  return out
}

/** Tri-state of a row against a set of part indices: 0 none of its parts is in the set, 1 some, 2 all (a row with no parts is 0). */
export function rowState(row, set) {
  if (!row || !row.meshes.length) return 0
  let n = 0
  for (const k of row.meshes) if (set.has(k)) n++
  return n === 0 ? 0 : n === row.meshes.length ? 2 : 1
}

/** The groups above row `i`, nearest first (for unfolding the way to a row and for "Left" = go to the parent). */
export function ancestors(rows, i) {
  const out = []
  let need = rows[i] ? rows[i].depth : 0
  for (let k = i - 1; k >= 0 && need > 0; k--) {
    if (rows[k].depth < need) {
      need = rows[k].depth
      out.push(k)
    }
  }
  return out
}

/** The parent row of row `i` (-1 for a root row). */
export const parentOf = (rows, i) => {
  const a = ancestors(rows, i)
  return a.length ? a[0] : -1
}

/**
 * What a key does in the tree. `vis` = the rows on screen (visibleRows), `cur` = the row that has the focus (a row index), `collapsed` = Set.
 * Returns { focus?: row index, fold?: { row, collapse: boolean } } or null for a key the tree does not use.
 * With `filtering` the rows are matches, not a tree: Left and Right fold nothing and move nothing.
 * Down / Up: the next / previous row on screen; Home / End: the first / last; Right: unfold a folded group, else go to its first child; Left: fold an open group, else go to the parent.
 */
export function navTarget(rows, vis, cur, key, collapsed = new Set(), { filtering = false } = {}) {
  if (!vis.length) return null
  const at = vis.indexOf(cur)
  switch (key) {
    case 'ArrowDown':
      return { focus: vis[Math.min(vis.length - 1, at < 0 ? 0 : at + 1)] }
    case 'ArrowUp':
      return { focus: vis[Math.max(0, at < 0 ? 0 : at - 1)] }
    case 'Home':
      return { focus: vis[0] }
    case 'End':
      return { focus: vis[vis.length - 1] }
    case 'ArrowRight':
      if (filtering || !hasKids(rows, cur)) return { focus: cur } // a filter shows matches only: no folding, no going into a group
      if (collapsed.has(cur)) return { focus: cur, fold: { row: cur, collapse: false } }
      return { focus: vis[at + 1] !== undefined && rows[vis[at + 1]].depth > rows[cur].depth ? vis[at + 1] : cur }
    case 'ArrowLeft':
      if (filtering) return { focus: cur }
      if (hasKids(rows, cur) && !collapsed.has(cur)) return { focus: cur, fold: { row: cur, collapse: true } }
      return { focus: vis.includes(parentOf(rows, cur)) ? parentOf(rows, cur) : cur }
    default:
      return null
  }
}

/** The row the one tab stop of the tree belongs to: the remembered one if it is on screen, else the first selected one on screen, else the first. */
export function rovingRow(vis, remembered, selectedRows = []) {
  if (vis.includes(remembered)) return remembered
  const s = vis.find((i) => selectedRows.includes(i))
  return s !== undefined ? s : vis.length ? vis[0] : -1
}
