import { useMemo, useRef } from 'react'
import type { Ink } from '../../shared/types.ts'
import { buildTree, growthFor, leafPath, renderBranches, TREE_GROUND_Y, TREE_ROOT_X, TREE_VIEWBOX } from '../tree.ts'

interface Props {
  seed: number
  mine: number
  theirs: number
  together: number
  myInk: Ink
  theirInk: Ink
  /** Faint outline of the tree at this many points: what it is growing into. */
  ghostPoints?: number
  /** Driven by scrolling: skips the entrance animation for new leaves. */
  scrubbed?: boolean
  birds?: number
}

/** One leaf per this many points, so a focused minute visibly adds to the tree. */
const POINTS_PER_LEAF = 1.5
const TOGETHER_SEC_PER_BLOSSOM = 10 * 60

export function TreeView({ seed, mine, theirs, together, myInk, theirInk, ghostPoints, scrubbed, birds = 0 }: Props) {
  const model = useMemo(() => buildTree(seed), [seed])
  const points = Math.floor(mine + theirs)
  const myShare = mine + theirs > 0 ? mine / (mine + theirs) : 0.5
  const blossomCount = Math.floor(together / TOGETHER_SEC_PER_BLOSSOM)
  const prevCount = useRef<number | null>(null)

  const ghost = useMemo(() => (ghostPoints ? renderBranches(model, growthFor(ghostPoints)) : null), [model, ghostPoints])

  const art = useMemo(() => {
    const growth = growthFor(points)
    const alive = model.leaves.filter((leaf) => leaf.birth <= growth && leaf.death > growth)
    const shown = alive.slice(0, Math.ceil(points / POINTS_PER_LEAF))
    const blossoms = shown.filter((_, i) => i % 3 === 0).slice(0, blossomCount)
    return { branches: renderBranches(model, growth), shown, blossoms }
  }, [model, points, blossomCount])

  const { settled, fresh } = useMemo(() => {
    const previous = prevCount.current
    prevCount.current = art.shown.length
    const added = previous === null || scrubbed ? 0 : Math.max(0, Math.min(12, art.shown.length - previous))
    return { settled: art.shown.slice(0, art.shown.length - added), fresh: art.shown.slice(art.shown.length - added) }
  }, [art.shown, scrubbed])

  const pathsFor = useMemo(() => {
    const mineParts: string[] = []
    const theirParts: string[] = []
    for (const leaf of settled) (leaf.mix < myShare ? mineParts : theirParts).push(leafPath(leaf))
    return { mine: mineParts.join(''), theirs: theirParts.join('') }
  }, [settled, myShare])

  return (
    <svg className="tree" viewBox={TREE_VIEWBOX} role="img" aria-label={`Ortak ağaç, ${points} puan`}>
      <line className="tree-ground" x1="60" x2="540" y1={TREE_GROUND_Y} y2={TREE_GROUND_Y} />
      {ghost?.map(({ weight, d }) => (
        <path key={`g${weight}`} className="tree-ghost" d={d} fill="none" strokeWidth={Math.min(weight, 1)} />
      ))}
      {points < 10 && <ellipse cx={TREE_ROOT_X} cy={TREE_GROUND_Y - 3.5} rx="6" ry="3.5" fill="var(--ink)" />}
      {art.branches.map(({ weight, d }) => (
        <path key={weight} d={d} fill="none" stroke="var(--ink)" strokeWidth={weight} strokeLinecap="round" />
      ))}
      <path d={pathsFor.mine} fill={`var(--${myInk})`} opacity="0.88" />
      <path d={pathsFor.theirs} fill={`var(--${theirInk})`} opacity="0.88" />
      {fresh.map((leaf, i) => (
        <path
          key={`${leaf.x}-${leaf.y}`}
          className="leaf-fresh"
          style={{ animationDelay: `${i * 90}ms` }}
          d={leafPath(leaf)}
          fill={`var(--${leaf.mix < myShare ? myInk : theirInk})`}
        />
      ))}
      {art.blossoms.map((leaf) => (
        <circle key={`b-${leaf.x}-${leaf.y}`} cx={leaf.x} cy={leaf.y} r={2.6} fill="var(--bloom)" stroke="var(--paper)" strokeWidth="1" />
      ))}
      {Array.from({ length: birds }, (_, i) => art.shown[Math.floor(((i + 1) * art.shown.length) / (birds + 1))]).map(
        (leaf, i) =>
          leaf && (
            <path
              key={`bird-${i}`}
              fill="var(--ink)"
              transform={`translate(${leaf.x.toFixed(1)} ${(leaf.y - 8).toFixed(1)}) scale(${i % 2 ? -1 : 1} 1)`}
              d="M-6 1C-4-3 0-4 3-3L5-5 5.6-2.6 8-2 5.4-1C5 2 1 4-2 3L-7 5Z"
            />
          ),
      )}
    </svg>
  )
}
