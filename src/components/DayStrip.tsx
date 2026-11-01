import { useState } from 'react'
import type { Live, Member, SessionRec, Snapshot } from '../../shared/types.ts'
import { duration, hourMinute, minuteOfDay } from '../format.ts'
import { useNow } from '../useApp.ts'

const DAY_MIN = 24 * 60
const TICKS = [0, 3, 6, 9, 12, 15, 18, 21, 24]

interface Bar {
  from: number
  to: number
  label: string
  start: number
  end: number
  sec: number
}

function barsFor(sessions: SessionRec[], live: Live | null | undefined, date: string, now: number): Bar[] {
  const bars: Bar[] = []
  const add = (segs: [number, number][], label: string, sec: number) => {
    for (const [a, b] of segs) {
      const from = Math.max(0, minuteOfDay(a, date))
      const to = Math.min(DAY_MIN, minuteOfDay(b, date))
      if (to > from) bars.push({ from, to, label, start: a, end: b, sec })
    }
  }
  sessions.forEach((s) => add(s.segs, s.topic || 'Konusuz', s.sec))
  if (live?.mode === 'focus') {
    const segs = live.segs.map(([a, b], i) => [a, i === live.segs.length - 1 && live.pausedAt == null ? Math.max(b, now) : b] as [number, number])
    add(segs, live.topic || 'Konusuz', live.creditedSec)
  }
  return bars
}

function overlaps(a: Bar[], b: Bar[]): { from: number; to: number }[] {
  const result: { from: number; to: number }[] = []
  for (const x of a) {
    for (const y of b) {
      const from = Math.max(x.from, y.from)
      const to = Math.min(x.to, y.to)
      if (to > from) result.push({ from, to })
    }
  }
  return result
}

const pct = (minute: number) => `${(minute / DAY_MIN) * 100}%`

export function DayStrip({ snap, me, partner }: { snap: Snapshot; me: Member; partner?: Member }) {
  const now = useNow(15000)
  const [tip, setTip] = useState<{ x: number; text: string } | null>(null)
  const date = snap.me.today.date
  const myBars = barsFor(snap.me.today.sessions, snap.me.live, date, now)
  const theirBars = snap.partner ? barsFor(snap.partner.today.sessions, snap.partner.live, date, now) : []
  const shared = overlaps(myBars, theirBars)
  const nowMinute = minuteOfDay(now, date)

  const lane = (member: Member, bars: Bar[]) => (
    <div className="strip-row" key={member.id} style={{ '--who': `var(--${member.ink})` } as React.CSSProperties}>
      <span className="strip-name">{member.name}</span>
      <div className="strip-lane">
        {bars.map((bar) => (
          <i
            key={`${bar.start}`}
            className="strip-bar"
            style={{ left: pct(bar.from), width: `max(3px, ${pct(bar.to - bar.from)})` }}
            onMouseEnter={() =>
              setTip({
                x: (bar.from + bar.to) / 2 / DAY_MIN,
                text: `${member.name}: ${bar.label}, ${hourMinute(bar.start)}–${hourMinute(bar.end)}`,
              })
            }
            onMouseLeave={() => setTip(null)}
          />
        ))}
      </div>
    </div>
  )

  const sharedMinutes = shared.reduce((sum, s) => sum + (s.to - s.from), 0)

  return (
    <section className="strip" aria-label="Bugünün şeridi">
      <div className="strip-head">
        <h2>Bugün saat saat</h2>
        <p>
          {sharedMinutes >= 1 ? (
            <>
              <i className="bloom-dot" />
              {duration(sharedMinutes * 60)} aynı anda
            </>
          ) : (
            'Şerit yalnızca canlı oturumlarla dolar'
          )}
        </p>
      </div>
      <div className="strip-plot">
        {lane(me, myBars)}
        {partner && (
          <div className="strip-row strip-row-shared" aria-hidden="true">
            <span className="strip-name" />
            <div className="strip-lane strip-lane-thin">
              {shared.map((s) => (
                <i key={s.from} className="strip-shared" style={{ left: pct(s.from), width: `max(3px, ${pct(s.to - s.from)})` }} />
              ))}
            </div>
          </div>
        )}
        {partner && lane(partner, theirBars)}
        <div className="strip-row strip-axis" aria-hidden="true">
          <span className="strip-name" />
          <div className="strip-lane">
            {TICKS.map((hour) => (
              <span key={hour} style={{ left: pct(hour * 60) }}>
                {String(hour).padStart(2, '0')}
              </span>
            ))}
            <i className="strip-now" style={{ left: pct(nowMinute) }} />
            {tip && (
              <div className="strip-tip" style={{ left: `${tip.x * 100}%` }}>
                {tip.text}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
