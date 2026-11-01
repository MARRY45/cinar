/** Procedural plane tree. The whole tree is fixed by the seed; growth only reveals it. */

export interface Branch {
  x0: number
  y0: number
  cx: number
  cy: number
  x1: number
  y1: number
  width: number
  birth: number
  span: number
}

export interface LeafSlot {
  x: number
  y: number
  angle: number
  size: number
  birth: number
  death: number
  /** Stable shuffle value used to decide whose leaf this is. */
  mix: number
}

export interface TreeModel {
  branches: Branch[]
  leaves: LeafSlot[]
}

const GROUND_Y = 540
const ROOT_X = 300
const MAX_DEPTH = 8

function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s >>>= 0
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s / 4294967296
  }
}

export function buildTree(seed: number): TreeModel {
  const r = rng(seed)
  const branches: Branch[] = []
  const leaves: LeafSlot[] = []

  const grow = (x: number, y: number, angle: number, len: number, width: number, depth: number, birth: number) => {
    const span = depth === 0 ? 0.2 : 0.08 + r() * 0.025
    const bend = (r() - 0.5) * 0.5
    const x1 = x + Math.cos(angle) * len
    const y1 = y + Math.sin(angle) * len
    const cx = x + Math.cos(angle + bend) * len * 0.55
    const cy = y + Math.sin(angle + bend) * len * 0.55
    branches.push({ x0: x, y0: y, cx, cy, x1, y1, width, birth, span })

    const end = birth + span
    const count = depth === 0 ? 7 : depth <= 2 ? 4 : depth >= MAX_DEPTH - 1 ? 3 : 2
    for (let i = 0; i < count; i++) {
      const t = depth === 0 ? 0.04 + (i / count) * 0.9 : 0.3 + r() * 0.7
      const mt = 1 - t
      const leafBirth = birth + span * t
      leaves.push({
        x: mt * mt * x + 2 * mt * t * cx + t * t * x1 + (r() - 0.5) * (depth === 0 ? 3 : 12),
        y: mt * mt * y + 2 * mt * t * cy + t * t * y1 + (r() - 0.5) * (depth === 0 ? 3 : 12),
        angle: depth === 0 ? -Math.PI / 2 + (i % 2 ? 0.9 : -0.9) + (r() - 0.5) * 0.5 : r() * Math.PI * 2,
        size: 5 + r() * 3.6,
        birth: leafBirth,
        // Leaves on the trunk and first limbs fall once the crown has taken over.
        death: depth <= 2 ? leafBirth + 0.3 : 2,
        mix: r(),
      })
    }
    if (depth >= MAX_DEPTH) return

    const third = depth > 0 && depth < MAX_DEPTH - 1 && r() < 0.42
    const spread = 0.32 + r() * 0.3
    // Plane trees open wide, so the crown is pulled gently outward rather than straight up.
    const lean = (-Math.PI / 2 - angle) * 0.1
    const shrink = depth === 0 ? 0.74 : 0.72 + r() * 0.1
    const nextWidth = width * (depth === 0 ? 0.72 : 0.7)
    grow(x1, y1, angle + lean - spread, len * shrink, nextWidth, depth + 1, end - 0.01)
    grow(x1, y1, angle + lean + spread * (0.8 + r() * 0.5), len * (shrink - 0.04), nextWidth * 0.92, depth + 1, end + r() * 0.03)
    if (third) grow(x1, y1, angle + lean + (r() - 0.5) * 0.3, len * (shrink - 0.08), nextWidth * 0.8, depth + 1, end + 0.02 + r() * 0.05)
  }

  grow(ROOT_X, GROUND_Y, -Math.PI / 2 + (r() - 0.5) * 0.08, 118, 12, 0, 0.004)
  leaves.sort((a, b) => a.birth - b.birth)
  return { branches, leaves }
}

/** Points to growth in 0..1. Fast at first so the first week is visibly rewarding. */
export function growthFor(points: number): number {
  return Math.min(1, Math.log(1 + Math.max(0, points) / 40) / Math.log(1 + 24000 / 40))
}

export const STAGES = [
  { min: 0, name: 'Tohum' },
  { min: 10, name: 'Filiz' },
  { min: 150, name: 'Fidan' },
  { min: 700, name: 'Genç çınar' },
  { min: 2500, name: 'Çınar' },
  { min: 8000, name: 'Yaşlı çınar' },
  { min: 20000, name: 'Ulu çınar' },
]

export function stageFor(points: number) {
  let index = 0
  STAGES.forEach((stage, i) => {
    if (points >= stage.min) index = i
  })
  return { ...STAGES[index], index, next: STAGES[index + 1] ?? null }
}

/** Reveals the fixed tree at a growth value. Output is SVG path data, grouped by weight. */
export function renderBranches(model: TreeModel, growth: number) {
  const groups = new Map<number, string[]>()
  // Young trees are slender, so thickness also depends on growth.
  const girth = 0.4 + growth * 0.6
  for (const b of model.branches) {
    const t = (growth - b.birth) / b.span
    if (t <= 0) continue
    const f = Math.min(1, t)
    // Quadratic Bezier truncated at f (de Casteljau).
    const cx = b.x0 + (b.cx - b.x0) * f
    const cy = b.y0 + (b.cy - b.y0) * f
    const mx = b.cx + (b.x1 - b.cx) * f
    const my = b.cy + (b.y1 - b.cy) * f
    const ex = cx + (mx - cx) * f
    const ey = cy + (my - cy) * f
    const weight = Math.max(0.55, Math.round(b.width * girth * 4) / 4)
    const d = `M${b.x0.toFixed(1)} ${b.y0.toFixed(1)}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`
    const list = groups.get(weight)
    if (list) list.push(d)
    else groups.set(weight, [d])
  }
  return [...groups.entries()].map(([weight, parts]) => ({ weight, d: parts.join('') }))
}

export function leafPath(leaf: LeafSlot, scale = 1): string {
  const s = leaf.size * scale
  const dx = Math.cos(leaf.angle)
  const dy = Math.sin(leaf.angle)
  const tx = leaf.x + dx * s * 1.4
  const ty = leaf.y + dy * s * 1.4
  const nx = -dy * s * 0.55
  const ny = dx * s * 0.55
  const mx = leaf.x + dx * s * 0.7
  const my = leaf.y + dy * s * 0.7
  return `M${leaf.x.toFixed(1)} ${leaf.y.toFixed(1)}Q${(mx + nx).toFixed(1)} ${(my + ny).toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)}Q${(mx - nx).toFixed(1)} ${(my - ny).toFixed(1)} ${leaf.x.toFixed(1)} ${leaf.y.toFixed(1)}Z`
}

export const TREE_VIEWBOX = '0 0 600 560'
export const TREE_GROUND_Y = GROUND_Y
export const TREE_ROOT_X = ROOT_X
