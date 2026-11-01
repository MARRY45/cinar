import { useState, type FormEvent } from 'react'
import { rankFor } from '../../shared/logic.ts'
import { Rise, useReveals } from '../motion.tsx'
import type { Goal, Member, Snapshot } from '../../shared/types.ts'
import { daysBetween, duration, JOINT_DAY_SEC, longestStreak, goalProgress, longDay, periodRange, shortDay, streak, todayKey, type Days } from '../format.ts'

interface Props {
  snap: Snapshot
  me: Member
  partner?: Member
  myDays: Days
  theirDays: Days
  today: string
  act: (type: string, payload?: Record<string, unknown>) => Promise<boolean>
}

const PERIODS: { id: Goal['period']; label: string }[] = [
  { id: 'day', label: 'Her gün' },
  { id: 'week', label: 'Her hafta' },
  { id: 'month', label: 'Her ay' },
  { id: 'until', label: 'Tarihe kadar' },
]

function ProgressRow({ goal, sec, onRemove, ink }: { goal: Goal; sec: number; onRemove?: () => void; ink?: string }) {
  const { label } = periodRange(goal, todayKey())
  const ratio = sec / (goal.targetMin * 60)
  return (
    <li className="goal" style={ink ? ({ '--who': `var(--${ink})` } as React.CSSProperties) : undefined}>
      <div className="goal-line">
        <span className="goal-title">{goal.title}</span>
        <span className="goal-figure">
          {duration(sec)} / {duration(goal.targetMin * 60)}
        </span>
      </div>
      <div className="hairbar">
        <i style={{ width: `${Math.min(100, ratio * 100)}%` }} />
      </div>
      <div className="goal-meta">
        <span>
          {goal.period === 'until' ? `${shortDay(goal.until!)}, ${label}` : label}
          {goal.metric === 'together' && ', birlikte geçen süre'}
          {goal.topic && `, ${goal.topic}`}
          {ratio >= 1 && ' · tamam'}
        </span>
        {onRemove && (
          <button className="link" onClick={onRemove}>
            Kaldır
          </button>
        )}
      </div>
    </li>
  )
}

export function Goals({ snap, me, partner, myDays, theirDays, today, act }: Props) {
  const root = useReveals<HTMLElement>()
  const [scope, setScope] = useState<'me' | 'group'>('group')
  const [title, setTitle] = useState('')
  const [period, setPeriod] = useState<Goal['period']>('week')
  const [hours, setHours] = useState('10')
  const [metric, setMetric] = useState<Goal['metric']>('total')
  const [topic, setTopic] = useState('')
  const [until, setUntil] = useState('')
  const [examTitle, setExamTitle] = useState('')
  const [examDate, setExamDate] = useState('')

  const [challengeMin, setChallengeMin] = useState(snap.me.challenge?.targetMin ?? 120)
  const todayChallenge = snap.me.challenge?.date === today ? snap.me.challenge : null
  const myStreak = streak((d) => (myDays[d]?.s ?? 0) >= 60, today)
  const rank = rankFor(snap.me.totals.sec)
  const isJointDay = (d: string) => Math.max(myDays[d]?.g ?? 0, theirDays[d]?.g ?? 0) >= JOINT_DAY_SEC
  const jointStreak = partner ? streak(isJointDay, today) : 0
  const myBest = longestStreak(Object.keys(myDays), (d) => (myDays[d]?.s ?? 0) >= 60)
  const jointBest = partner ? longestStreak([...Object.keys(myDays), ...Object.keys(theirDays)], isJointDay) : 0
  const myToday = myDays[today]?.s ?? 0
  const theirToday = theirDays[today]?.s ?? 0

  async function addGoal(event: FormEvent) {
    event.preventDefault()
    const ok = await act('goal.add', {
      scope,
      title,
      period,
      targetMin: Math.round(Number(hours.replace(',', '.')) * 60),
      metric: scope === 'group' ? metric : 'total',
      topic: metric === 'together' && scope === 'group' ? '' : topic,
      until,
    })
    if (ok) {
      setTitle('')
      setTopic('')
    }
  }

  async function addExam(event: FormEvent) {
    event.preventDefault()
    if (await act('exam.add', { title: examTitle, date: examDate })) {
      setExamTitle('')
      setExamDate('')
    }
  }

  return (
    <main className="page" ref={root}>
      <header className="page-head">
        <h1>
          <Rise>Hedefler</Rise>
        </h1>
        <p data-fade>Süreler yalnızca canlı oturumlardan gelir, elle eklenemez.</p>
      </header>

      <section className="columns" data-fade>
        <div>
          <h2>Bugün</h2>
          <ul className="goals">
            <ProgressRow
              ink={me.ink}
              sec={myToday}
              goal={{ id: 'd1', title: me.name, period: 'day', targetMin: me.dailyGoalMin, metric: 'total', createdAt: 0 }}
            />
            {partner && (
              <ProgressRow
                ink={partner.ink}
                sec={theirToday}
                goal={{ id: 'd2', title: partner.name, period: 'day', targetMin: partner.dailyGoalMin, metric: 'total', createdAt: 0 }}
              />
            )}
          </ul>
          <h2 className="h2-next">Günün sözü</h2>
          {todayChallenge?.won ? (
            <p className="challenge-won">Sözünü tuttun. Ağacına bir <em>{todayChallenge.won}</em> kondu, 10 puan da senin.</p>
          ) : (
            <div className="challenge">
              {todayChallenge && (
                <div className="hairbar" style={{ '--who': `var(--${me.ink})` } as React.CSSProperties}>
                  <i style={{ width: `${Math.min(100, (myToday / (todayChallenge.targetMin * 60)) * 100)}%` }} />
                </div>
              )}
              <p className="setting-note">{todayChallenge ? `Bugün ${duration(todayChallenge.targetMin * 60)} sözün var. Tutarsan ağacına bir kuş konar.` : 'Bugün ne kadar odaklanacağına söz ver, tutarsan ağacına bir kuş konar.'}</p>
              <div className="stepper">
                <button type="button" aria-label="30 dakika azalt" onClick={() => setChallengeMin((m) => Math.max(15, m - 30))}>−</button>
                <span>{duration(challengeMin * 60)}</span>
                <button type="button" aria-label="30 dakika artır" onClick={() => setChallengeMin((m) => Math.min(960, m + 30))}>+</button>
                <button type="button" className="btn" onClick={() => act('challenge.set', { minutes: challengeMin })}>
                  {todayChallenge ? 'Güncelle' : 'Söz veriyorum'}
                </button>
              </div>
            </div>
          )}
          {snap.me.birds.length > 0 && <p className="figure-note birds">Kuşların: {snap.me.birds.join(', ')}</p>}
          <dl className="figures">
            <div>
              <dt>Rütben (toplam saate göre)</dt>
              <dd>{rank.name}</dd>
              {rank.next && <p className="figure-note">{rank.next.name} için {Math.ceil(rank.next.hours - snap.me.totals.sec / 3600)} saat</p>}
            </div>
            <div>
              <dt>Tek başına seri</dt>
              <dd>{myStreak} gün</dd>
              <p className="figure-note">En uzun {myBest} gün</p>
            </div>
            {partner && (
              <div>
                <dt>Arkadaşla seri</dt>
                <dd>{jointStreak} gün</dd>
                <p className="figure-note">En uzun {jointBest} gün. Günde en az 10 dakika aynı anda.</p>
              </div>
            )}
          </dl>
        </div>

        <div>
          <h2>Birlikte</h2>
          {snap.pair.goals.length === 0 && <p className="empty">Henüz ortak hedef yok. “Bu hafta 20 saat” gibi bir tane koyun.</p>}
          <ul className="goals">
            {snap.pair.goals.map((goal) => (
              <ProgressRow key={goal.id} goal={goal} sec={goalProgress(goal, [myDays, theirDays], today)} onRemove={() => act('goal.remove', { id: goal.id })} />
            ))}
          </ul>

          <h2 className="h2-next">Kişisel</h2>
          {snap.me.goals.length === 0 && (snap.partner?.goals.length ?? 0) === 0 && <p className="empty">Kişisel hedef yok.</p>}
          <ul className="goals">
            {snap.me.goals.map((goal) => (
              <ProgressRow key={goal.id} ink={me.ink} goal={goal} sec={goalProgress(goal, [myDays], today)} onRemove={() => act('goal.remove', { id: goal.id })} />
            ))}
            {partner &&
              snap.partner?.goals.map((goal) => (
                <ProgressRow key={goal.id} ink={partner.ink} goal={{ ...goal, title: `${partner.name}: ${goal.title}` }} sec={goalProgress(goal, [theirDays], today)} />
              ))}
          </ul>
        </div>

        <div>
          <h2>Yeni hedef</h2>
          <form className="form" onSubmit={addGoal}>
            <div className="seg" role="radiogroup" aria-label="Kimin hedefi">
              <button type="button" role="radio" aria-checked={scope === 'group'} className={scope === 'group' ? 'is-on' : ''} onClick={() => setScope('group')}>
                Ortak
              </button>
              <button type="button" role="radio" aria-checked={scope === 'me'} className={scope === 'me' ? 'is-on' : ''} onClick={() => setScope('me')}>
                Kişisel
              </button>
            </div>
            <label className="field">
              <span>Ad</span>
              <input value={title} maxLength={60} placeholder="Hafta sonuna kadar 20 saat" onChange={(e) => setTitle(e.target.value)} />
            </label>
            <div className="field-row">
              <label className="field">
                <span>Süre (saat)</span>
                <input inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} />
              </label>
              <label className="field">
                <span>Dönem</span>
                <select value={period} onChange={(e) => setPeriod(e.target.value as Goal['period'])}>
                  {PERIODS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {period === 'until' && (
              <label className="field">
                <span>Son tarih</span>
                <input type="date" min={today} value={until} onChange={(e) => setUntil(e.target.value)} />
              </label>
            )}
            {scope === 'group' && (
              <label className="field">
                <span>Ne sayılsın?</span>
                <select value={metric} onChange={(e) => setMetric(e.target.value as Goal['metric'])}>
                  <option value="total">İkimizin toplam süresi</option>
                  <option value="together">Yalnızca aynı anda çalıştığımız süre</option>
                </select>
              </label>
            )}
            {!(scope === 'group' && metric === 'together') && (
              <label className="field">
                <span>Tek bir konuyla sınırla</span>
                <input value={topic} maxLength={40} placeholder="İsteğe bağlı" onChange={(e) => setTopic(e.target.value)} />
              </label>
            )}
            <button className="btn btn-solid" disabled={!title.trim()}>
              Hedefi ekle
            </button>
          </form>

          <h2 className="h2-next">Sınavlar</h2>
          <ul className="exams">
            {snap.pair.exams.map((exam) => {
              const left = daysBetween(today, exam.date)
              return (
                <li key={exam.id}>
                  <span className="exam-days">{left <= 0 ? 'Bugün' : `${left} gün`}</span>
                  <span>
                    {exam.title}
                    <small>{longDay(exam.date)}</small>
                  </span>
                  <button className="link" onClick={() => act('exam.remove', { id: exam.id })}>
                    Kaldır
                  </button>
                </li>
              )
            })}
          </ul>
          <form className="form form-tight" onSubmit={addExam}>
            <div className="field-row">
              <label className="field">
                <span>Sınav</span>
                <input value={examTitle} maxLength={50} onChange={(e) => setExamTitle(e.target.value)} />
              </label>
              <label className="field">
                <span>Tarih</span>
                <input type="date" min={today} value={examDate} onChange={(e) => setExamDate(e.target.value)} />
              </label>
            </div>
            <button className="btn" disabled={!examTitle.trim() || !examDate}>
              Sınavı ekle
            </button>
          </form>
        </div>
      </section>
    </main>
  )
}
