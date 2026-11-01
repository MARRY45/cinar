import { useRef } from 'react'
import { isFocusing } from '../../shared/logic.ts'
import type { Member, SessionRec, Snapshot } from '../../shared/types.ts'
import { duration, livePoints } from '../format.ts'
import { Rise, scrollToElement, useReveals, useScrub } from '../motion.tsx'
import type { Prefs } from '../prefs.ts'
import { stageFor } from '../tree.ts'
import { useNow } from '../useApp.ts'
import { DayStrip } from './DayStrip.tsx'
import { MyClock } from './MyClock.tsx'
import { PartnerPanel } from './PartnerPanel.tsx'
import { TreeView } from './TreeView.tsx'

interface Props {
  snap: Snapshot
  me: Member
  partner?: Member
  prefs: Prefs
  setPrefs: (patch: Partial<Prefs>) => void
  finished: SessionRec | null
  dismissFinished: () => void
  act: (type: string, payload?: Record<string, unknown>) => Promise<boolean>
  onFocusStart: () => void
  breakMinutes: number
}

const number = (value: number) => Math.round(value).toLocaleString('tr-TR')

export function Desk({ snap, me, partner, prefs, setPrefs, finished, dismissFinished, act, onFocusStart, breakMinutes }: Props) {
  const root = useReveals<HTMLElement>()
  const now = useNow(5000)
  const groveRef = useRef<HTMLDivElement>(null)
  const [scrubRef, progress] = useScrub<HTMLElement>()

  const mine = livePoints(snap.me, snap.partner?.live ?? null, now)
  const theirs = livePoints(snap.partner, snap.me.live, now)
  const total = mine.points + theirs.points
  const stage = stageFor(total)
  const together = Math.max(mine.together, theirs.together)
  const bothFocus = isFocusing(snap.me.live, now) && isFocusing(snap.partner?.live, now)
  const myToday = snap.me.today.sessions.reduce((sum, s) => sum + s.sec, 0)
  // The tree replays its growth from the seed up to today's real size as you scroll in.
  const reveal = Math.min(1, progress / 0.72)
  const eased = reveal ** 1.8

  return (
    <main className="desk" ref={root}>
      <section className="desk-hero">
        <div className="lane lane-me" style={{ '--who': `var(--${me.ink})` } as React.CSSProperties} aria-label="Senin saatin">
          <MyClock snap={snap} prefs={prefs} setPrefs={setPrefs} finished={finished} dismissFinished={dismissFinished} act={act} onFocusStart={onFocusStart} breakMinutes={breakMinutes} />
        </div>
        <div className="lane lane-partner" style={{ '--who': `var(--${partner?.ink ?? 'visne'})` } as React.CSSProperties} aria-label="Çalışma arkadaşın">
          <PartnerPanel snap={snap} partnerMember={partner} act={act} callMinutes={prefs.focusMinutes} />
        </div>
        <button className="tree-cue" onClick={() => scrollToElement(groveRef.current)}>
          <span>
            Ortak ağacınız: {stage.name}, {number(total)} puan
          </span>
          <svg viewBox="0 0 12 16" width="10" height="14" aria-hidden="true">
            <path d="M6 1v13M1.5 9.5 6 14l4.5-4.5" fill="none" stroke="currentColor" />
          </svg>
        </button>
      </section>

      <section className="grove" ref={scrubRef} aria-label="Ortak ağaç">
        <div className="grove-stage" ref={groveRef}>
          <div className="grove-title">
            <p className="grove-kicker">{bothFocus ? 'Birlikte çalışıyorsunuz' : 'Ortak ağaç'}</p>
            <h2>{stage.name}</h2>
          </div>
          <div className="grove-tree">
            <TreeView
              seed={snap.pair.seed}
              mine={mine.points * eased}
              theirs={theirs.points * eased}
              together={together * eased}
              myInk={me.ink}
              theirInk={partner?.ink ?? 'visne'}
              ghostPoints={Math.max(stage.next?.min ?? total, 2500)}
              scrubbed={reveal < 1}
              birds={snap.me.birds.length + (snap.partner?.birds.length ?? 0)}
            />
          </div>
          <dl className="grove-figures">
            <div>
              <dt>Toplam</dt>
              <dd>{number(total * eased)}</dd>
            </div>
            <div>
              <dt>{me.name}</dt>
              <dd>{number(mine.points * eased)}</dd>
            </div>
            {partner && (
              <div>
                <dt>{partner.name}</dt>
                <dd>{number(theirs.points * eased)}</dd>
              </div>
            )}
            {stage.next && (
              <div>
                <dt>{stage.next.name} için</dt>
                <dd>{number(stage.next.min - total)}</dd>
              </div>
            )}
          </dl>
          <p className="grove-explain">
            Odaklanılan dakika 1 puan, aynı anda çalışılan dakika 1,5 puan ve çiçek. 15 dakikadan uzun bir oturumu tamamlamak 5 puan daha getirir. İnce çizgiler ağacın varacağı hâli gösterir.
          </p>
        </div>
      </section>

      <div className="desk-rest">
        <DayStrip snap={snap} me={me} partner={partner} />
        <p className="desk-foot">
          <Rise>
            Bugün {duration(myToday)}, hedefin {duration(me.dailyGoalMin * 60)}. Boşluk tuşu duraklatır, F sade görünüme geçer.
          </Rise>
        </p>
      </div>
    </main>
  )
}
