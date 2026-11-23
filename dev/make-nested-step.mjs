#!/usr/bin/env node
// Writes a synthetic STEP assembly whose tree is THREE levels deep (the sample files of the plugin are flat): the fixture of the part-tree tests (E2b).
//   Machine
//   ├─ Base plate                      a part
//   ├─ Frame                           a sub-assembly
//   │   ├─ Leg A, Leg B, Top plate     parts
//   └─ Cover                           a sub-assembly
//       ├─ Lid                          a part
//       └─ Fixing                       a sub-assembly (the third level below the machine)
//           └─ Knob, Pin                parts
// What the converter (occt-import-js 0.0.23, measured) makes of it: root "" > Machine > its components; a component that is itself an assembly (Frame, Cover)
// comes out as ONE node holding all the meshes below it (it does not hand over the deeper levels), so the part list shows three levels of rows:
// Machine (0) > Base plate, Frame, Cover (1) > Leg A, Leg B, Top plate / Lid, Knob, Pin (2). `EXPECTED_ROWS` says so; the tests check the list against it.
// Only boxes (planes and straight edges), every product with its own shape and every use of it with a placement (NEXT_ASSEMBLY_USAGE_OCCURRENCE +
// CONTEXT_DEPENDENT_SHAPE_REPRESENTATION), the way other CAD systems write an assembly. Units: millimetres.
//   node dev/make-nested-step.mjs <out.step>
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** The tree: { name, box?: { size: [w, d, h] }, at?: [x, y, z] (placement in the parent), kids?: [] }. */
export const NESTED_TREE = {
  name: 'Machine',
  kids: [
    { name: 'Base plate', at: [0, 0, 0], box: { size: [80, 50, 6] } },
    {
      name: 'Frame',
      at: [0, 0, 6],
      kids: [
        { name: 'Leg A', at: [4, 4, 0], box: { size: [6, 6, 30] } },
        { name: 'Leg B', at: [70, 4, 0], box: { size: [6, 6, 30] } },
        { name: 'Top plate', at: [0, 0, 30], box: { size: [80, 50, 4] } }
      ]
    },
    { name: 'Handle', at: [60, 20, 40], kids: [{ name: 'Grip', at: [0, 0, 0], box: { size: [8, 8, 12] } }] }, // an assembly of ONE part: the list shows one row, named after the node
    {
      name: 'Cover',
      at: [10, 10, 40],
      kids: [
        { name: 'Lid', at: [0, 0, 0], box: { size: [60, 30, 3] } },
        {
          name: 'Fixing',
          at: [25, 10, 3],
          kids: [
            { name: 'Knob', at: [0, 0, 0], box: { size: [10, 10, 8] } },
            { name: 'Pin', at: [3, 3, 8], box: { size: [4, 4, 6] } }
          ]
        }
      ]
    }
  ]
}

/** The rows the part list shows for this file (depth, name, group): what the viewer builds from the converter's tree (see above). */
export const EXPECTED_ROWS = [
  [0, 'Machine', true],
  [1, 'Base plate', false],
  [1, 'Frame', true],
  [2, 'Leg A', false],
  [2, 'Leg B', false],
  [2, 'Top plate', false],
  [1, 'Handle', false],
  [1, 'Cover', true],
  [2, 'Lid', false],
  [2, 'Knob', false],
  [2, 'Pin', false]
]

/** The number of parts (leaves) and of nodes in the tree: what the tests expect. */
export function treeCounts(node = NESTED_TREE) {
  if (!node.kids) return { parts: 1, nodes: 1, depth: 1 }
  const k = node.kids.map((n) => treeCounts(n))
  return { parts: k.reduce((a, b) => a + b.parts, 0), nodes: 1 + k.reduce((a, b) => a + b.nodes, 0), depth: 1 + Math.max(...k.map((b) => b.depth)) }
}

const num = (v) => (Number.isInteger(v) ? `${v}.` : String(v))
const vec = (p) => `(${p.map(num).join(',')})`

export function nestedStep(tree = NESTED_TREE) {
  const lines = []
  let n = 0
  const add = (s) => {
    lines.push(`#${++n}=${s};`)
    return n
  }
  const pt = (p) => add(`CARTESIAN_POINT('',${vec(p)})`)
  const dir = (d) => add(`DIRECTION('',${vec(d)})`)
  const axis = (o, z = [0, 0, 1], x = [1, 0, 0]) => add(`AXIS2_PLACEMENT_3D('',#${pt(o)},#${dir(z)},#${dir(x)})`)
  const app = add("APPLICATION_CONTEXT('managed model based 3d engineering')")
  add(`APPLICATION_PROTOCOL_DEFINITION('international standard','ap242_managed_model_based_3d_engineering',2014,#${app})`)
  const pctx = add(`PRODUCT_CONTEXT('',#${app},'mechanical')`)
  const pdctx = add(`PRODUCT_DEFINITION_CONTEXT('part definition',#${app},'design')`)
  const len = add('(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))')
  const ang = add('(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))')
  const sol = add('(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())')
  const unc = add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(2.E-5),#${len},'distance_accuracy_value','confusion accuracy')`)
  const ctx = add(`(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${unc}))GLOBAL_UNIT_ASSIGNED_CONTEXT((#${len},#${ang},#${sol}))REPRESENTATION_CONTEXT('Context','3D Context with UNIT and UNCERTAINTY'))`)

  /** A box solid with its corner at the origin of its own coordinate system: planes and straight edges. */
  function boxSolid(name, [w, d, h]) {
    const V = []
    for (let i = 0; i < 8; i++) V.push([i & 1 ? w : 0, i & 2 ? d : 0, i & 4 ? h : 0])
    const vp = V.map((p) => add(`VERTEX_POINT('',#${pt(p)})`))
    const edgeOf = new Map() // "a-b" (a < b) -> { id, from, to }
    for (let a = 0; a < 8; a++)
      for (let b = a + 1; b < 8; b++) {
        const x = a ^ b
        if (x !== 1 && x !== 2 && x !== 4) continue // an edge joins corners that differ in one coordinate
        const dv = V[b].map((c, i) => c - V[a][i])
        const length = Math.hypot(...dv)
        const line = add(`LINE('',#${pt(V[a])},#${add(`VECTOR('',#${dir(dv.map((c) => c / length))},${num(length)})`)})`)
        edgeOf.set(`${a}-${b}`, { id: add(`EDGE_CURVE('',#${vp[a]},#${vp[b]},#${line},.T.)`), from: a, to: b })
      }
    const faces = []
    const planeFaces = [
      { n: [0, 0, -1], v: [0, 1, 3, 2] },
      { n: [0, 0, 1], v: [4, 5, 7, 6] },
      { n: [0, -1, 0], v: [0, 1, 5, 4] },
      { n: [0, 1, 0], v: [2, 3, 7, 6] },
      { n: [-1, 0, 0], v: [0, 2, 6, 4] },
      { n: [1, 0, 0], v: [1, 3, 7, 5] }
    ]
    for (const f of planeFaces) {
      // the corners in the order that runs counter-clockwise seen from outside (the normal points to the viewer)
      let order = f.v
      const [p0, p1, p2] = order.map((i) => V[i])
      const cross = [(p1[1] - p0[1]) * (p2[2] - p0[2]) - (p1[2] - p0[2]) * (p2[1] - p0[1]), (p1[2] - p0[2]) * (p2[0] - p0[0]) - (p1[0] - p0[0]) * (p2[2] - p0[2]), (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0])]
      if (cross[0] * f.n[0] + cross[1] * f.n[1] + cross[2] * f.n[2] < 0) order = [...order].reverse()
      const oriented = order.map((a, i) => {
        const b = order[(i + 1) % 4]
        const e = edgeOf.get(`${Math.min(a, b)}-${Math.max(a, b)}`)
        return add(`ORIENTED_EDGE('',*,*,#${e.id},${e.from === a ? '.T.' : '.F.'})`)
      })
      const loop = add(`EDGE_LOOP('',(${oriented.map((o) => `#${o}`).join(',')}))`)
      const bound = add(`FACE_OUTER_BOUND('',#${loop},.T.)`)
      const refX = Math.abs(f.n[0]) === 1 ? [0, 1, 0] : [1, 0, 0]
      const plane = add(`PLANE('',#${axis(V[order[0]], f.n, refX)})`)
      faces.push(add(`ADVANCED_FACE('',(#${bound}),#${plane},.T.)`))
    }
    const shell = add(`CLOSED_SHELL('',(${faces.map((f) => `#${f}`).join(',')}))`)
    return add(`MANIFOLD_SOLID_BREP('${name}',#${shell})`)
  }

  /** One product: its definition, its shape (the solid or the placements of its children) and the shape of each use of a child. Returns { pdef, rep }. */
  function product(node, parent) {
    const prod = add(`PRODUCT('${node.name}','${node.name}','',(#${pctx}))`)
    const pdf = add(`PRODUCT_DEFINITION_FORMATION('','',#${prod})`)
    const pdef = add(`PRODUCT_DEFINITION('design','',#${pdf},#${pdctx})`)
    const pds = add(`PRODUCT_DEFINITION_SHAPE('','',#${pdef})`)
    const origin = axis([0, 0, 0])
    const items = [origin]
    const childReps = []
    let rep
    if (node.box) {
      items.push(boxSolid(node.name, node.box.size))
      rep = add(`ADVANCED_BREP_SHAPE_REPRESENTATION('${node.name}',(${items.map((i) => `#${i}`).join(',')}),#${ctx})`)
    } else {
      const kids = node.kids.map((k) => ({ k, ...product(k, node) }))
      const placed = kids.map(({ k }) => axis(k.at || [0, 0, 0]))
      rep = add(`SHAPE_REPRESENTATION('${node.name}',(${[origin, ...placed].map((i) => `#${i}`).join(',')}),#${ctx})`)
      kids.forEach(({ pdef: kd, rep: kr, origin: ko }, i) => {
        const nauo = add(`NEXT_ASSEMBLY_USAGE_OCCURRENCE('${i + 1}','${node.kids[i].name}','',#${pdef},#${kd},$)`)
        const useShape = add(`PRODUCT_DEFINITION_SHAPE('','',#${nauo})`)
        const idt = add(`ITEM_DEFINED_TRANSFORMATION('','',#${ko},#${placed[i]})`)
        const rel = add(`(REPRESENTATION_RELATIONSHIP('','',#${kr},#${rep})REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(#${idt})SHAPE_REPRESENTATION_RELATIONSHIP())`)
        add(`CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(#${rel},#${useShape})`)
      })
    }
    add(`SHAPE_DEFINITION_REPRESENTATION(#${pds},#${rep})`)
    add(`PRODUCT_RELATED_PRODUCT_CATEGORY('${node.box ? 'part' : 'assembly'}','',(#${prod}))`)
    return { pdef, rep, origin }
  }
  product(tree, null)
  return ['ISO-10303-21;', 'HEADER;', "FILE_DESCRIPTION(('Synthetic nested assembly'),'2;1');", "FILE_NAME('nested.step','',(''),(''),'','sample generator','');", "FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF { 1 0 10303 442 1 1 4 }'));", 'ENDSEC;', 'DATA;', ...lines, 'ENDSEC;', 'END-ISO-10303-21;', ''].join('\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2]
  if (!out) {
    console.error('usage: node dev/make-nested-step.mjs <out.step>')
    process.exit(2)
  }
  writeFileSync(out, nestedStep())
  console.log(`wrote ${out} (${JSON.stringify(treeCounts())})`)
}
