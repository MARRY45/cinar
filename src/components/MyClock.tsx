import { useEffect, useRef, useState, type FormEvent } from 'react'
import { elapsedAt, GRACE_SEC, isFocusing } from '../../shared/logic.ts'
import type { Live, Mood, SessionRec, Snapshot, Task } from '../../shared/types.ts'
import { clock, duration, hourMinute, serverNow } from '../format.ts'
import { Digits } from '../motion.tsx'
import type { Prefs } from '../prefs.ts'
import { useNow } from '../useApp.ts'

const PRESETS = [25, 45, 60]

const QUOTES = [
  'Başlamak, işin yarısıdır.',
  'Bugün tek bir sayfa da sayılır.',
  'Odak bir yetenek değil, tekrardır.',
  'Küçük oturumlar büyük sınavları geçirir.',
  'Telefon bekleyebilir, sınav beklemez.',
  'Yorulunca bırakma, mola ver.',
  'Yirmi beş dakika kimseyi öldürmedi.',
  'Ağaç bir günde büyümez, sen de.',
]

function Quote() {
  const hour = Math.floor(Date.now() / 3600_000)
  return <p className="quote">{QUOTES[hour % QUOTES.length]}</p>
}

function Breath() {
  const now = useNow(250)
  const t = (now / 1000) % 14
  const phase = t < 4 ? { word: 'Nefes al', scale: 0.55 + (t / 4) * 0.45 } : t < 8 ? { word: 'Tut', scale: 1 } : { word: 'Ver', scale: 1 - ((t - 8) / 6) * 0.45 }
  return (
    <div className="breath" aria-label="Nefes rehberi">
      <i style={{ transform: `scale(${phase.scale})` }} />
      <span>{phase.word}</span>
    </div>
  )
}

function Tasks({ snap, act, prefs, setPrefs, selected, onSelect, inSession }: { snap: Snapshot; act: Props['act']; prefs: Prefs; setPrefs: Props['setPrefs']; selected?: string; onSelect?: (id: string, title: string) => void; inSession?: boolean }) {
  const [title, setTitle] = useState('')
  const [est, setEst] = useState('')
  const pomodoros = (t: Task) => Math.floor(t.sec / (prefs.focusMinutes * 60))
  const left = (tasks: Task[]) => tasks.filter((t) => !t.done && t.est).reduce((sum, t) => sum + Math.max(0, t.est! - pomodoros(t)), 0)
  const myLeft = left(snap.me.tasks)
  const theirLeft = left(snap.partner?.tasks ?? [])
  const finish = serverNow() + myLeft * (prefs.focusMinutes + prefs.shortBreak) * 60_000
  const open = snap.me.tasks.filter((t) => !t.done)
  const done = snap.me.tasks.filter((t) => t.done)
  return (
    <div className="tasks">
      <p className="tasks-head">Görevler</p>
      <ul>
        {[...open, ...done].map((task) => (
          <li key={task.id} className={task.id === selected ? 'task is-current' : task.done ? 'task is-done' : 'task'}>
            <input type="checkbox" aria-label={`${task.title} tamamlandı`} checked={task.done} onChange={() => act('task.toggle', { id: task.id })} />
            {onSelect && !task.done ? (
              <button type="button" className="task-title" onClick={() => onSelect(task.id, task.title)}>
                {task.title}
              </button>
            ) : (
              <span className="task-title">{task.title}</span>
            )}
            {task.est ? <small>{pomodoros(task)}/{task.est}</small> : null}
            {task.sec >= 60 && <small>{duration(task.sec)}</small>}
            <button type="button" className="task-x" aria-label={`${task.title} görevini sil`} onClick={() => act('task.remove', { id: task.id })}>
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="nudge-form">
        <input
          value={title}
          maxLength={80}
          placeholder="Görev ekle"
          aria-label="Yeni görev"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && title.trim()) {
              e.preventDefault()
              void act('task.add', { title, est })
              setTitle('')
              setEst('')
            }
          }}
        />
        <input className="task-est" inputMode="numeric" value={est} placeholder="Pomodoro" aria-label="Tahmini pomodoro" onChange={(e) => setEst(e.target.value.replace(/\D/g, '').slice(0, 2))} />
      </div>
      {(myLeft > 0 || theirLeft > 0) && (
        <p className="clock-note">
          {myLeft > 0 && `${myLeft} pomodoro kaldı, tahmini bitiş ${hourMinute(finish)}. `}
          {theirLeft > 0 && `Arkadaşının ${theirLeft} pomodorosu var.`}
        </p>
      )}
      {!inSession && <div className="chips templates">
        {prefs.templates.map((template) => (
          <span key={template.name} className="chip">
            <button
              type="button"
              onClick={async () => {
                for (const task of template.tasks) await act('task.add', { title: task.title, est: task.est })
              }}
            >
              {template.name}
            </button>
            <button type="button" className="task-x" aria-label={`${template.name} şablonunu sil`} onClick={() => setPrefs({ templates: prefs.templates.filter((t) => t !== template) })}>
              ×
            </button>
          </span>
        ))}
        {open.length > 0 && (
          <button
            type="button"
            className="link"
            onClick={() =>
              setPrefs({
                templates: [
                  ...prefs.templates,
                  { name: `${open[0].title.slice(0, 16)}${open.length > 1 ? ` +${open.length - 1}` : ''}`, tasks: open.map((t) => ({ title: t.title, est: t.est })) },
                ].slice(-6),
              })
            }
          >
            Şablon olarak sakla
          </button>
        )}
      </div>}
    </div>
  )
}

/** Keeps a small always-on-top clock open, where the browser supports it. */
function usePopOut(read: () => string) {
  const latest = useRef(read)
  latest.current = read
  const supported = 'documentPictureInPicture' in window
  async function open() {
    const pip = await (window as unknown as { documentPictureInPicture: { requestWindow: (o: object) => Promise<Window> } }).documentPictureInPicture.requestWindow({ width: 280, height: 130 })
    const dark = document.documentElement.dataset.theme === 'night'
    pip.document.body.style.cssText = `margin:0;display:grid;place-items:center;height:100vh;background:${dark ? '#131614' : '#f1f2ec'};color:${dark ? '#e2e4da' : '#1a201c'};font:300 64px Georgia,serif;font-variant-numeric:tabular-nums`
    const update = () => {
      pip.document.body.textContent = latest.current()
    }
    update()
    const timer = window.setInterval(update, 1000)
    pip.addEventListener('pagehide', () => window.clearInterval(timer))
  }
  return { supported, open }
}

interface Props {
  snap: Snapshot
  prefs: Prefs
  finished: SessionRec | null
  dismissFinished: () => void
  act: (type: string, payload?: Record<string, unknown>) => Promise<boolean>
  onFocusStart: () => void
  breakMinutes: number
  setPrefs: (patch: Partial<Prefs>) => void
}

export function MyClock({ snap, prefs, setPrefs, finished, dismissFinished, act, onFocusStart, breakMinutes }: Props) {
  if (snap.me.live) return <Running live={snap.me.live} snap={snap} act={act} prefs={prefs} setPrefs={setPrefs} />
  if (finished) return <Finished rec={finished} dismiss={dismissFinished} act={act} breakMinutes={breakMinutes} />
  return <Setup snap={snap} prefs={prefs} setPrefs={setPrefs} act={act} onFocusStart={onFocusStart} breakMinutes={breakMinutes} />
}

function Running({ live, snap, act, prefs, setPrefs }: { live: Live; snap: Snapshot; act: Props['act']; prefs: Prefs; setPrefs: Props['setPrefs'] }) {
  const now = useNow()
  const elapsed = elapsedAt(live, now)
  const paused = live.pausedAt != null
  const partnerLive = snap.partner?.live
  const partnerName = snap.pair.members.find((m) => m.id !== snap.meId)?.name
  const lost = !paused && (now - live.lastBeat) / 1000 > GRACE_SEC
  const together = live.mode === 'focus' && isFocusing(snap.partner?.live, now)
  const shown = (at: number) => (live.stopwatch ? elapsedAt(live, at) : live.plannedSec - elapsedAt(live, at))
  const popOut = usePopOut(() => clock(shown(serverNow())))

  return (
    <div className="clock" data-mode={live.mode}>
      <p className="clock-label">
        {live.mode === 'break' ? 'Mola' : live.topic || 'Odak'}
        {paused && <em> · duraklatıldı</em>}
      </p>
      <p className={paused ? 'numerals is-paused' : 'numerals'} role="timer">
        <Digits value={clock(shown(now))} />
      </p>
      <div className="hairbar" aria-hidden="true">
        <i style={{ width: live.stopwatch ? '100%' : `${(elapsed / live.plannedSec) * 100}%` }} />
      </div>
      {live.intent && <p className="clock-intent">{live.intent}</p>}
      {live.mode === 'break' && <Breath />}
      {live.withered && <p className="clock-note">Uygulamadan uzun süre çıktın, ağaç soldu. Bu oturum yarım puan getirir.</p>}
      {lost && <p className="clock-note">Bağlantı koptu. Geri gelene kadar süre işlemiyor.</p>}
      {!lost && live.gapSec > 30 && (
        <p className="clock-note">{duration(live.gapSec)} kopuk geçti, o süre sayılmadı.</p>
      )}
      {together && <p className="clock-note clock-together">Birlikte. Bu dakikalar 1,5 kat sayılıyor.</p>}
      <div className="clock-actions">
        <button className="btn btn-solid" onClick={() => act(paused ? 'resume' : 'pause')}>
          {paused ? 'Sürdür' : 'Duraklat'}
        </button>
        <button className="btn" onClick={() => act('stop')}>
          {live.mode === 'break' ? 'Molayı bitir' : elapsed < 60 ? 'Vazgeç' : 'Şimdi bitir'}
        </button>
      </div>
      <div className="clock-view">
        <button className="link" onClick={() => window.dispatchEvent(new Event('cinar:plain'))}>
          Tam ekran
        </button>
        {popOut.supported && (
          <button className="link" onClick={() => void popOut.open()}>
            Küçük saat
          </button>
        )}
      </div>
      {partnerLive && partnerName && (
        <p className="partner-line">
          {partnerName} · <Digits value={clock(partnerLive.stopwatch ? elapsedAt(partnerLive, now) : partnerLive.plannedSec - elapsedAt(partnerLive, now))} />
          {partnerLive.mode === 'break' ? ' · Molada' : partnerLive.topic ? ` · ${partnerLive.topic}` : ''}
        </p>
      )}
      {live.mode === 'focus' && <Tasks snap={snap} act={act} prefs={prefs} setPrefs={setPrefs} selected={live.taskId} inSession />}
    </div>
  )
}

const MOODS: { id: Mood; label: string }[] = [
  { id: 'dagnik', label: 'Dağınık' },
  { id: 'normal', label: 'Normal' },
  { id: 'akici', label: 'Akıcı' },
]

function Finished({ rec, dismiss, act, breakMinutes }: { rec: SessionRec; dismiss: () => void; act: Props['act']; breakMinutes: number }) {
  const [mood, setMood] = useState<Mood | undefined>(rec.mood)
  const [note, setNote] = useState('')

  async function save() {
    if (mood || note.trim()) await act('rate', { sessionId: rec.id, mood, note })
  }

  return (
    <div className="clock">
      <p className="clock-label">{rec.complete ? 'Tamamlandı' : 'Erken bitti'}</p>
      <p className="numerals numerals-result">+{rec.points}</p>
      <p className="clock-sub">
        {duration(rec.sec)} {rec.topic || 'odak'}
        {rec.togetherSec >= 30 && `, ${duration(rec.togetherSec)} birlikte`}
      </p>
      <div className="seg" role="radiogroup" aria-label="Nasıl geçti">
        {MOODS.map((m) => (
          <button key={m.id} type="button" role="radio" aria-checked={mood === m.id} className={mood === m.id ? 'is-on' : ''} onClick={() => setMood(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      <label className="field">
        <span>Deftere bir not</span>
        <input value={note} maxLength={240} placeholder="İsteğe bağlı" onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="clock-actions">
        <button
          className="btn btn-solid"
          onClick={async () => {
            await save()
            dismiss()
            await act('start', { mode: 'break', minutes: breakMinutes })
          }}
        >
          {breakMinutes} dakika mola
        </button>
        <button
          className="btn"
          onClick={async () => {
            await save()
            dismiss()
          }}
        >
          Sonraki oturum
        </button>
      </div>
    </div>
  )
}

function Setup({ snap, prefs, setPrefs, act, onFocusStart, breakMinutes: _breakMinutes }: Omit<Props, 'finished' | 'dismissFinished'>) {
  const [topic, setTopic] = useState(snap.me.topics[0] ?? '')
  const [intent, setIntent] = useState('')
  const [minutes, setMinutes] = useState(prefs.focusMinutes)
  const [custom, setCustom] = useState(!PRESETS.includes(prefs.focusMinutes))
  const [calling, setCalling] = useState(false)
  const [mode, setMode] = useState<'focus' | 'watch' | 'short' | 'long'>('focus')
  const [taskId, setTaskId] = useState<string | undefined>()
  const counters = prefs.counters.date === snap.me.today.date ? prefs.counters : { focus: 0, short: 0, long: 0 }

  async function start(event: FormEvent) {
    event.preventDefault()
    if (mode === 'short' || mode === 'long') {
      await act('start', { mode: 'break', minutes: mode === 'short' ? prefs.shortBreak : prefs.longBreak })
      return
    }
    onFocusStart()
    await act('start', { mode: 'focus', minutes, topic, intent, taskId, stopwatch: mode === 'watch' })
  }

  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    const pick = (event: Event) => setMode((event as CustomEvent<'focus' | 'short' | 'long'>).detail)
    const go = () => formRef.current?.requestSubmit()
    window.addEventListener('cinar:mode', pick)
    window.addEventListener('cinar:start', go)
    return () => {
      window.removeEventListener('cinar:mode', pick)
      window.removeEventListener('cinar:start', go)
    }
  }, [])

  async function callTogether() {
    setCalling(true)
    await act('signal', { kind: 'call', minutes, topic })
    setCalling(false)
  }

  return (
    <form className="clock" onSubmit={start} ref={formRef}>
      <div className="mode-tabs" role="tablist" aria-label="Oturum türü">
        {(
          [
            ['focus', 'Odak', counters.focus],
            ['watch', 'Kronometre', null],
            ['short', 'Kısa mola', counters.short],
            ['long', 'Uzun mola', counters.long],
          ] as const
        ).map(([id, label, count]) => (
          <button key={id} type="button" role="tab" aria-selected={mode === id} className={mode === id ? 'is-on' : ''} onClick={() => setMode(id)}>
            {label} {count !== null && <small>{count}</small>}
          </button>
        ))}
      </div>
      <p className="numerals numerals-idle">
        <Digits value={clock((mode === 'focus' ? minutes : mode === 'watch' ? 0 : mode === 'short' ? prefs.shortBreak : prefs.longBreak) * 60)} />
      </p>
      {mode === 'short' || mode === 'long' ? (
        <div className="clock-actions">
          <button className="btn btn-solid">Molayı başlat</button>
        </div>
      ) : (
        <>
      <div className={mode === 'watch' ? 'seg is-gone' : 'seg'} role="radiogroup" aria-label="Süre">
        {PRESETS.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={!custom && minutes === value}
            className={!custom && minutes === value ? 'is-on' : ''}
            onClick={() => {
              setCustom(false)
              setMinutes(value)
            }}
          >
            {value}
          </button>
        ))}
        {custom ? (
          <input
            className="seg-input"
            type="number"
            min={1}
            max={180}
            value={minutes}
            autoFocus
            aria-label="Dakika"
            onChange={(e) => setMinutes(Math.min(180, Math.max(1, Number(e.target.value) || 1)))}
          />
        ) : (
          <button type="button" onClick={() => setCustom(true)}>
            Başka
          </button>
        )}
      </div>
      <label className="field">
        <span>Ne çalışıyorsun?</span>
        <input value={topic} maxLength={40} list="topics" placeholder="Matematik, Tarih…" onChange={(e) => setTopic(e.target.value)} />
        <datalist id="topics">
          {snap.me.topics.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </label>
      {snap.me.topics.length > 1 && (
        <div className="chips">
          {snap.me.topics.slice(0, 5).map((t) => (
            <button key={t} type="button" className={t === topic ? 'chip is-on' : 'chip'} onClick={() => setTopic(t)}>
              {t}
            </button>
          ))}
        </div>
      )}
      <label className="field">
        <span>Bu oturumun sonunda ne bitmiş olacak?</span>
        <input value={intent} maxLength={80} placeholder="İsteğe bağlı" onChange={(e) => setIntent(e.target.value)} />
      </label>
      <div className="clock-actions">
        <button className="btn btn-solid">Başla</button>
        {snap.partner && (
          <button type="button" className="btn" disabled={calling} onClick={callTogether}>
            Birlikte başlayalım
          </button>
        )}
      </div>
      <Tasks
        snap={snap}
        act={act}
        prefs={prefs}
        setPrefs={setPrefs}
        selected={taskId}
        onSelect={(id, title) => {
          setTaskId(id === taskId ? undefined : id)
          if (id !== taskId) setIntent(title)
        }}
      />
        </>
      )}
      <Quote />
    </form>
  )
}
