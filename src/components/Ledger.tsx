import { useEffect, useMemo, useState } from 'react'
import type { Member, Mood, SessionRec } from '../../shared/types.ts'
import { api } from '../api.ts'
import { addDays, duration, hourMinute, longDay, monthDays, monthStart, shortDay, weekdayName, weekStart, type Days } from '../format.ts'
import { Rise, useReveals } from '../motion.tsx'

interface Props {
  me: Member
  partner?: Member
  myDays: Days
  theirDays: Days
  today: string
  rev: number
}

const MOOD_LABEL: Record<Mood, string> = { dagnik: 'Dağınık', normal: 'Normal', akici: 'Akıcı' }

function sumWeek(days: Days, start: string, length = 7) {
  let s = 0
  let g = 0
  for (let i = 0; i < length; i++) {
    const stat = days[addDays(start, i)]
    s += stat?.s ?? 0
    g += stat?.g ?? 0
  }
  return { s, g }
}

/** Grouped daily bars for one week. One y-scale, both people in their own ink. */
function WeekChart({ me, partner, myDays, theirDays, start, length, today }: Omit<Props, 'rev'> & { start: string; length: number }) {
  const [hover, setHover] = useState<string | null>(null)
  const dates = Array.from({ length }, (_, i) => addDays(start, i))
  const max = Math.max(3600, ...dates.flatMap((d) => [myDays[d]?.s ?? 0, theirDays[d]?.s ?? 0]))
  const axisHours = Math.ceil(max / 3600)

  return (
    <figure className="week">
      <div className="week-plot" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${length}, 1fr)` }}>
        <span className="week-axis">{axisHours} sa</span>
        {dates.map((date) => {
          const mine = myDays[date]?.s ?? 0
          const theirs = theirDays[date]?.s ?? 0
          return (
            <div
              key={date}
              className={date === today ? 'week-day is-today' : 'week-day'}
              onMouseEnter={() => setHover(date)}
              onMouseLeave={() => setHover(null)}
            >
              <div className="week-bars" data-grow>
                <i style={{ height: `${(mine / (axisHours * 3600)) * 100}%`, background: `var(--${me.ink})` }} />
                {partner && <i style={{ height: `${(theirs / (axisHours * 3600)) * 100}%`, background: `var(--${partner.ink})` }} />}
              </div>
              <span className="week-label">{length === 7 ? weekdayName(date) : Number(date.slice(8)) % 5 === 0 ? Number(date.slice(8)) : ''}</span>
              {hover === date && (
                <div className="week-tip">
                  <strong>{shortDay(date)}</strong>
                  <span>
                    {me.name}: {duration(mine)}
                  </span>
                  {partner && (
                    <span>
                      {partner.name}: {duration(theirs)}
                    </span>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <figcaption className="legend">
        <span>
          <i style={{ background: `var(--${me.ink})` }} />
          {me.name}
        </span>
        {partner && (
          <span>
            <i style={{ background: `var(--${partner.ink})` }} />
            {partner.name}
          </span>
        )}
      </figcaption>
      <table className="sr-only">
        <caption>Günlük çalışma süreleri</caption>
        <tbody>
          {dates.map((date) => (
            <tr key={date}>
              <th>{shortDay(date)}</th>
              <td>{duration(myDays[date]?.s ?? 0)}</td>
              {partner && <td>{duration(theirDays[date]?.s ?? 0)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

/** Six months of days. Darkness is time studied, in the person's own ink. */
function YearRow({ member, days, today, select, selected }: { member: Member; days: Days; today: string; select: (date: string) => void; selected: string }) {
  const firstMonday = weekStart(addDays(today, -7 * 26))
  const weeks = useMemo(() => {
    const out: string[][] = []
    for (let start = firstMonday; start <= today; start = addDays(start, 7)) {
      out.push(Array.from({ length: 7 }, (_, i) => addDays(start, i)))
    }
    return out
  }, [firstMonday, today])

  const level = (sec: number) => (sec <= 0 ? 0 : sec < 3600 ? 1 : sec < 2 * 3600 ? 2 : sec < 4 * 3600 ? 3 : 4)

  return (
    <div className="year-row" style={{ '--who': `var(--${member.ink})` } as React.CSSProperties}>
      <span className="year-name">{member.name}</span>
      <div className="year-grid">
        {weeks.map((week) => (
          <div key={week[0]} className="year-week">
            {week.map((date) =>
              date > today ? (
                <i key={date} className="cell cell-future" />
              ) : (
                <button
                  key={date}
                  className={date === selected ? 'cell is-selected' : 'cell'}
                  data-level={level(days[date]?.s ?? 0)}
                  title={`${shortDay(date)}: ${duration(days[date]?.s ?? 0)}`}
                  aria-label={`${shortDay(date)}, ${member.name}: ${duration(days[date]?.s ?? 0)}`}
                  onClick={() => select(date)}
                />
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function TopicBars({ me, partner, myDays, theirDays, from, to }: { me: Member; partner?: Member; myDays: Days; theirDays: Days; from: string; to: string }) {
  const rows = useMemo(() => {
    const totals = new Map<string, { mine: number; theirs: number }>()
    const collect = (days: Days, side: 'mine' | 'theirs') => {
      for (const [date, stat] of Object.entries(days)) {
        if (date < from || date > to) continue
        for (const [topic, sec] of Object.entries(stat.t)) {
          const row = totals.get(topic) ?? { mine: 0, theirs: 0 }
          row[side] += sec
          totals.set(topic, row)
        }
      }
    }
    collect(myDays, 'mine')
    collect(theirDays, 'theirs')
    return [...totals.entries()].map(([topic, v]) => ({ topic, ...v, total: v.mine + v.theirs })).sort((a, b) => b.total - a.total).slice(0, 8)
  }, [myDays, theirDays, from, to])

  if (rows.length === 0) return <p className="empty">Bu hafta henüz konu kaydı yok.</p>
  const max = rows[0].total

  return (
    <ul className="topics">
      {rows.map((row) => (
        <li key={row.topic}>
          <div className="goal-line">
            <span>{row.topic}</span>
            <span className="goal-figure">{duration(row.total)}</span>
          </div>
          <div className="stack" style={{ width: `${(row.total / max) * 100}%` }}>
            {row.mine > 0 && <i style={{ flexGrow: row.mine, background: `var(--${me.ink})` }} title={`${me.name}: ${duration(row.mine)}`} />}
            {partner && row.theirs > 0 && <i style={{ flexGrow: row.theirs, background: `var(--${partner.ink})` }} title={`${partner.name}: ${duration(row.theirs)}`} />}
          </div>
        </li>
      ))}
    </ul>
  )
}

function DayLog({ date, me, partner, rev }: { date: string; me: Member; partner?: Member; rev: number }) {
  const [sessions, setSessions] = useState<Record<string, SessionRec[]> | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    setFailed(false)
    api
      .day(date)
      .then((res) => alive && setSessions(res.sessions))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [date, rev])

  if (failed) return <p className="empty">Bu gün okunamadı, bağlantını kontrol et.</p>
  if (!sessions) return <p className="empty">Okunuyor…</p>

  const members = partner ? [me, partner] : [me]
  const rows = members
    .flatMap((member) => (sessions[member.id] ?? []).map((rec) => ({ member, rec })))
    .sort((a, b) => a.rec.startedAt - b.rec.startedAt)

  if (rows.length === 0) return <p className="empty">Bu gün için kayıt yok.</p>

  return (
    <ol className="log">
      {rows.map(({ member, rec }) => (
        <li key={rec.id} style={{ '--who': `var(--${member.ink})` } as React.CSSProperties}>
          <time>
            {hourMinute(rec.startedAt)}
            <small>{hourMinute(rec.endedAt)}</small>
          </time>
          <div>
            <p className="log-title">
              <i className="who-dot" />
              {member.name}, {rec.topic || 'konusuz'}
            </p>
            {rec.intent && <p className="log-intent">{rec.intent}</p>}
            {rec.note && <p className="log-note">{rec.note}</p>}
            <p className="log-meta">
              {duration(rec.sec)}
              {rec.togetherSec >= 30 && `, ${duration(rec.togetherSec)} birlikte`}
              {!rec.complete && ', erken bitti'}
              {rec.gapSec > 30 && `, ${duration(rec.gapSec)} kopuk`}
              {rec.mood && `, ${MOOD_LABEL[rec.mood].toLocaleLowerCase('tr')}`}
              {rec.withered && ', ağaç soldu'}
              {rec.verdict && `, hedef: ${{ yes: 'yaptı', partly: 'kısmen', no: 'yapmadı' }[rec.verdict]}`}
            </p>
          </div>
          <span className="log-points">+{rec.points}</span>
        </li>
      ))}
    </ol>
  )
}

export function Ledger({ me, partner, myDays, theirDays, today, rev }: Props) {
  const root = useReveals<HTMLElement>()
  const [selected, setSelected] = useState(today)
  const [period, setPeriod] = useState<'week' | 'month'>('week')
  const isWeek = period === 'week'
  const start = isWeek ? weekStart(today) : monthStart(today)
  const length = isWeek ? 7 : monthDays(start)
  const lastStart = isWeek ? addDays(start, -7) : monthStart(addDays(start, -1))
  const lastLength = isWeek ? 7 : monthDays(lastStart)
  const my = sumWeek(myDays, start, length)
  const their = sumWeek(theirDays, start, length)
  const lastTotal = sumWeek(myDays, lastStart, lastLength).s + sumWeek(theirDays, lastStart, lastLength).s
  const label = isWeek ? 'hafta' : 'ay'
  const total = my.s + their.s
  const together = Math.max(my.g, their.g)

  return (
    <main className="page" ref={root}>
      <header className="page-head">
        <h1>
          <Rise>Defter</Rise>
        </h1>
        <p data-fade>Buraya yalnızca canlı oturumlar yazılır. Geriye dönük kayıt yoktur.</p>
      </header>

      <div className="seg period-seg" role="radiogroup" aria-label="Dönem">
        <button role="radio" aria-checked={isWeek} className={isWeek ? 'is-on' : ''} onClick={() => setPeriod('week')}>
          Hafta
        </button>
        <button role="radio" aria-checked={!isWeek} className={!isWeek ? 'is-on' : ''} onClick={() => setPeriod('month')}>
          Ay
        </button>
      </div>

      <dl className="figures figures-row" data-fade>
        <div>
          <dt>Bu {label} toplam</dt>
          <dd>{duration(total)}</dd>
          {lastTotal > 0 && <p className="figure-note">Geçen {label} {duration(lastTotal)}</p>}
        </div>
        <div>
          <dt>Aynı anda</dt>
          <dd>{duration(together)}</dd>
        </div>
        <div>
          <dt>{me.name}</dt>
          <dd>{duration(my.s)}</dd>
        </div>
        {partner && (
          <div>
            <dt>{partner.name}</dt>
            <dd>{duration(their.s)}</dd>
          </div>
        )}
      </dl>

      <section className="columns columns-2">
        <div>
          <h2>Bu {label}</h2>
          <WeekChart me={me} partner={partner} myDays={myDays} theirDays={theirDays} start={start} length={length} today={today} />
        </div>
        <div>
          <h2>Konular</h2>
          <TopicBars me={me} partner={partner} myDays={myDays} theirDays={theirDays} from={start} to={addDays(start, length - 1)} />
        </div>
      </section>

      <section>
        <h2>Son altı ay</h2>
        <div className="year" data-fade>
          <YearRow member={me} days={myDays} today={today} select={setSelected} selected={selected} />
          {partner && <YearRow member={partner} days={theirDays} today={today} select={setSelected} selected={selected} />}
        </div>
        <p className="figure-note">Koyuluk çalışılan süreyi gösterir: 1 saatin altı, 1, 2 ve 4 saatin üstü. Bir güne tıklayınca kayıtları açılır.</p>
      </section>

      <section className="day-log">
        <div className="day-nav">
          <button className="link" onClick={() => setSelected(addDays(selected, -1))}>
            Önceki gün
          </button>
          <h2>{longDay(selected)}</h2>
          <button className="link" disabled={selected >= today} onClick={() => setSelected(addDays(selected, 1))}>
            Sonraki gün
          </button>
        </div>
        <DayLog date={selected} me={me} partner={partner} rev={rev} />
      </section>
    </main>
  )
}
