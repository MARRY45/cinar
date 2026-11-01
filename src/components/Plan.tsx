import { useState, type FormEvent } from 'react'
import type { Member, PlanItem, Snapshot } from '../../shared/types.ts'
import { addDays, duration, shortDay, weekdayName, weekStart } from '../format.ts'
import { Rise, useReveals } from '../motion.tsx'

interface Props {
  snap: Snapshot
  me: Member
  partner?: Member
  today: string
  act: (type: string, payload?: Record<string, unknown>) => Promise<boolean>
}

function AddItem({ date, act }: { date: string; act: Props['act'] }) {
  const [title, setTitle] = useState('')
  const [hours, setHours] = useState('1')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!title.trim()) return
    const minutes = Math.round(Number(hours.replace(',', '.')) * 60) || 60
    if (await act('plan.add', { date, title, minutes })) setTitle('')
  }

  return (
    <form className="plan-add" onSubmit={submit}>
      <input value={title} maxLength={60} placeholder="Ne çalışılacak?" aria-label={`${shortDay(date)} için plan`} onChange={(e) => setTitle(e.target.value)} />
      <label className="plan-hours">
        <input inputMode="decimal" value={hours} aria-label="Saat" onChange={(e) => setHours(e.target.value)} />
        sa
      </label>
      <button className="btn plan-submit" disabled={!title.trim()}>
        Ekle
      </button>
    </form>
  )
}

export function Plan({ snap, me, partner, today, act }: Props) {
  const root = useReveals<HTMLElement>()
  const [offset, setOffset] = useState(0)
  const start = addDays(weekStart(today), offset * 7)
  const dates = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  const mine = snap.me.plans
  const theirs = snap.partner?.plans ?? []

  const row = (item: PlanItem, owner: Member, editable: boolean) => (
    <li
      key={item.id}
      className={item.done ? 'plan-item is-done' : 'plan-item'}
      style={{ '--who': `var(--${owner.ink})` } as React.CSSProperties}
      draggable={editable}
      onDragStart={(e) => e.dataTransfer.setData('text/plain', item.id)}
    >
      {editable ? (
        <input type="checkbox" aria-label={`${item.title} tamamlandı`} checked={item.done} onChange={() => act('plan.toggle', { id: item.id })} />
      ) : (
        <i className="who-dot" />
      )}
      <span>
        {item.title}
        <small>{duration(item.minutes * 60)}</small>
      </span>
      {editable && (
        <button className="task-x" aria-label={`${item.title} planını sil`} onClick={() => act('plan.remove', { id: item.id })}>
          ×
        </button>
      )}
    </li>
  )

  return (
    <main className="page page-wide" ref={root}>
      <header className="page-head">
        <h1>
          <Rise>Plan</Rise>
        </h1>
        <p data-fade>Haftanı planla, kartları günler arasında sürükle. Arkadaşının planı da burada görünür.</p>
      </header>
      <div className="day-nav plan-nav">
        <button className="link" disabled={offset <= 0} onClick={() => setOffset(offset - 1)}>
          Önceki hafta
        </button>
        <h2>
          {shortDay(dates[0])} – {shortDay(dates[6])}
        </h2>
        <button className="link" onClick={() => setOffset(offset + 1)}>
          Sonraki hafta
        </button>
      </div>
      <div className="plan-week" data-fade>
        {dates.map((date) => (
          <section
            key={date}
            className={date === today ? 'plan-day is-today' : 'plan-day'}
            aria-label={shortDay(date)}
            onDragOver={(e) => {
              if (date >= today) e.preventDefault()
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (date >= today) void act('plan.move', { id: e.dataTransfer.getData('text/plain'), date })
            }}
          >
            <h3>
              {weekdayName(date)} <small>{shortDay(date)}</small>
            </h3>
            {snap.pair.exams
              .filter((exam) => exam.date === date)
              .map((exam) => (
                <p key={exam.id} className="plan-exam">
                  {exam.title}
                </p>
              ))}
            <ul>
              {mine.filter((p) => p.date === date).map((p) => row(p, me, true))}
              {partner && theirs.filter((p) => p.date === date).map((p) => row(p, partner, false))}
            </ul>
            {date >= today && <AddItem date={date} act={act} />}
          </section>
        ))}
      </div>
    </main>
  )
}
