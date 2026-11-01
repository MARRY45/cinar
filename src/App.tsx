import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { elapsedAt } from '../shared/logic.ts'
import type { SessionRec, Signal } from '../shared/types.ts'
import { setToken, getToken } from './api.ts'
import { bell, setAlarm } from './audio.ts'
import { SceneLayer } from './components/SceneLayer.tsx'
import { Desk } from './components/Desk.tsx'
import { Goals } from './components/Goals.tsx'
import { Ledger } from './components/Ledger.tsx'
import { Onboarding } from './components/Onboarding.tsx'
import { People } from './components/People.tsx'
import { Plan } from './components/Plan.tsx'
import { Player } from './components/Player.tsx'
import { Settings } from './components/Settings.tsx'
import { clock, hourMinute, longDay, JOINT_DAY_SEC, memberOf, serverNow, streak, todayKey, withLive, type Days } from './format.ts'
import { scrollToTop, useSmoothScroll } from './motion.tsx'
import { resolveTheme, usePrefs } from './prefs.ts'
import { useApp, useNow } from './useApp.ts'

type Page = 'masa' | 'plan' | 'kisiler' | 'hedefler' | 'defter' | 'ayarlar'
const PAGES: { id: Page; label: string }[] = [
  { id: 'masa', label: 'Masa' },
  { id: 'plan', label: 'Plan' },
  { id: 'kisiler', label: 'Kişiler' },
  { id: 'hedefler', label: 'Hedefler' },
  { id: 'defter', label: 'Defter' },
  { id: 'ayarlar', label: 'Ayarlar' },
]

const CALL_WINDOW_MS = 10 * 60_000
const SEEN_FINISH_KEY = 'cinar.seenFinish'

function readStored(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Worst case the finish summary shows once more after a reload.
  }
}

function claimLoginFromUrl() {
  const match = window.location.hash.match(/^#giris=(.+)$/)
  if (match) {
    setToken(match[1])
    window.history.replaceState(null, '', '/')
  }
}

export function App() {
  claimLoginFromUrl()
  const [signedIn, setSignedIn] = useState(() => !!getToken())
  const [prefs, setPrefs] = usePrefs()
  const now = useNow(60000)
  useSmoothScroll()
  const [onBreak, setOnBreak] = useState(false)
  const scene = onBreak && prefs.breakScene !== 'same' ? prefs.breakScene : prefs.scene

  useLayoutEffect(() => {
    const theme = resolveTheme(prefs.theme, now)
    document.documentElement.dataset.theme = scene === 'none' ? theme : 'night'
    document.documentElement.dataset.scene = scene
    if (prefs.accent === 'ink') document.documentElement.style.removeProperty('--accent')
    else document.documentElement.style.setProperty('--accent', `var(--${prefs.accent})`)
    setAlarm(prefs.alarm, prefs.alarmVolume)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'night' ? '#131614' : '#f1f2ec')
  }, [prefs.theme, scene, prefs.accent, prefs.alarm, prefs.alarmVolume, now])

  useEffect(() => {
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => undefined)
  }, [])

  return (
    <>
      <SceneLayer prefs={{ ...prefs, scene }} />
      {signedIn ? <Signed prefs={prefs} setPrefs={setPrefs} onBreakChange={setOnBreak} onSignedOut={() => setSignedIn(false)} /> : <Onboarding onDone={() => setSignedIn(true)} />}
    </>
  )
}

function Signed({ prefs, setPrefs, onBreakChange, onSignedOut }: { prefs: ReturnType<typeof usePrefs>[0]; setPrefs: ReturnType<typeof usePrefs>[1]; onBreakChange: (value: boolean) => void; onSignedOut: () => void }) {
  const { snap, ledger, offline, error, setError, act } = useApp(onSignedOut)
  const [page, setPage] = useState<Page>('masa')
  const [plain, setPlain] = useState(false)
  const [finished, setFinished] = useState<SessionRec | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [playSignal, setPlaySignal] = useState(0)
  const [dismissedCalls, setDismissedCalls] = useState<string[]>([])
  const now = useNow()

  const prev = useRef<typeof snap>(null)
  const seenSignals = useRef(new Set<string>())
  const toastTimer = useRef(0)
  const firstLoad = useRef(true)

  const me = snap ? memberOf(snap, snap.meId) : undefined
  const partner = snap ? snap.pair.members.find((m) => m.id !== snap.meId) : undefined

  const say = useCallback((text: string) => {
    setToast(text)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 5200)
  }, [])

  const ring = useCallback(
    (kind: 'end' | 'call' | 'soft') => {
      if (prefs.sound) bell(kind)
    },
    [prefs.sound],
  )

  const bump = (key: 'focus' | 'short' | 'long') => {
    const date = todayKey()
    const base = prefs.counters.date === date ? prefs.counters : { date, focus: 0, short: 0, long: 0 }
    setPrefs({ counters: { ...base, [key]: base[key] + 1 } })
  }

  const completedToday = snap?.me.today.sessions.filter((s) => s.complete).length ?? 0
  const breakMinutes = completedToday > 0 && completedToday % 4 === 0 ? prefs.longBreak : prefs.shortBreak

  // Reacts to what changed between two snapshots: finishes, partner moves, answers.
  useEffect(() => {
    if (!snap || !partner) {
      if (snap) prev.current = snap
    }
    if (!snap) return
    const before = prev.current
    const name = partner?.name ?? ''

    const last = snap.me.lastFinished
    if (last && readStored(SEEN_FINISH_KEY) !== last.id) {
      writeStored(SEEN_FINISH_KEY, last.id)
      if (firstLoad.current) {
        // The session closed while this device was away.
        if (Date.now() - last.endedAt < 6 * 3600_000) setFinished(last)
      } else {
        setFinished(last)
        if (last.complete) {
          bump('focus')
          ring('end')
          if (document.visibilityState === 'hidden' && 'Notification' in window && Notification.permission === 'granted') {
            void navigator.serviceWorker.ready.then((reg) => reg.showNotification('Oturum tamamlandı', { body: `+${last.points} puan`, tag: last.id, icon: '/icon-192.png' }))
          }
          if (prefs.autoBreak) void act('start', { mode: 'break', minutes: breakMinutes })
        }
      }
    }

    if (before?.me.live?.mode === 'break' && !snap.me.live && elapsedAt(before.me.live, serverNow()) >= before.me.live.plannedSec - 2) {
      ring('end')
      say('Mola bitti.')
      bump(before.me.live.plannedSec === prefs.longBreak * 60 ? 'long' : 'short')
      if (prefs.autoFocus) void act('start', { mode: 'focus', minutes: prefs.focusMinutes, topic: snap.me.topics[0] ?? '' })
    }

    if (before?.partner && snap.partner) {
      const a = before.partner.live
      const b = snap.partner.live
      if (a?.mode !== 'focus' && b?.mode === 'focus') {
        ring('soft')
        say(`${name} ${b.topic ? `${b.topic} çalışmaya` : 'çalışmaya'} başladı.`)
      } else if (a?.mode === 'focus' && !b) {
        say(`${name} oturumunu bitirdi.`)
      }
      for (const signal of snap.me.outbox) {
        const answer = snap.partner.responses[signal.id]
        if (answer && !before.partner.responses[signal.id]) {
          ring('soft')
          say(answer.resp === 'accept' ? `${name} geliyor.` : answer.resp === 'later' ? `${name} birazdan geliyor.` : `${name} şu an gelemiyor.`)
        }
      }
    }

    for (const signal of snap.partner?.outbox ?? []) {
      if (signal.kind !== 'nudge' || seenSignals.current.has(signal.id)) continue
      seenSignals.current.add(signal.id)
      if (!firstLoad.current && serverNow() - signal.at < CALL_WINDOW_MS) {
        ring('soft')
        say(`${name}: ${signal.text}`)
      }
    }

    firstLoad.current = false
    prev.current = snap
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap])

  const incoming: Signal | undefined = snap?.partner?.outbox.find(
    (s) => s.kind === 'call' && serverNow() - s.at < CALL_WINDOW_MS && !snap.me.responses[s.id] && !dismissedCalls.includes(s.id),
  )

  const ringedCall = useRef<string | null>(null)
  useEffect(() => {
    if (incoming && ringedCall.current !== incoming.id) {
      ringedCall.current = incoming.id
      ring('call')
    }
  }, [incoming, ring])

  const live = snap?.me.live
  useEffect(() => {
    if (live) {
      const left = clock(live.stopwatch ? elapsedAt(live, now) : live.plannedSec - elapsedAt(live, now))
      document.title = `${left} · ${live.mode === 'break' ? 'Mola' : live.topic || 'Odak'}`
    } else if (incoming && partner) {
      document.title = `${partner.name} çağırıyor`
    } else {
      document.title = 'Çınar'
    }
  }, [live, now, incoming, partner])

  const liveMode = live?.mode
  useEffect(() => onBreakChange(liveMode === 'break'), [liveMode, onBreakChange])

  // Strict mode: leaving the app for 30 seconds during focus withers the session.
  const canWither = prefs.strict && liveMode === 'focus' && live?.pausedAt == null && !live?.withered
  useEffect(() => {
    if (!canWither) return
    let timer = 0
    const watch = () => {
      window.clearTimeout(timer)
      if (document.visibilityState === 'hidden') timer = window.setTimeout(() => void act('wither'), 30_000)
    }
    watch()
    document.addEventListener('visibilitychange', watch)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', watch)
    }
  }, [canWither, act])

  // Keeps a phone awake during focus, since a sleeping device stops the clock.
  const running = live && live.pausedAt == null
  useEffect(() => {
    if (!running || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    let cancelled = false
    const acquire = () => {
      if (document.visibilityState !== 'visible') return
      navigator.wakeLock
        .request('screen')
        .then((sentinel) => {
          if (cancelled) void sentinel.release()
          else lock = sentinel
        })
        .catch(() => undefined)
    }
    acquire()
    document.addEventListener('visibilitychange', acquire)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', acquire)
      void lock?.release()
    }
  }, [running])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)) return
      if (event.code === 'Space') {
        event.preventDefault()
        if (live) void act(live.pausedAt != null ? 'resume' : 'pause')
        else window.dispatchEvent(new Event('cinar:start'))
      }
      const modes: Record<string, string> = { KeyP: 'focus', KeyK: 'short', KeyU: 'long' }
      if (event.altKey && modes[event.code]) {
        event.preventDefault()
        window.dispatchEvent(new CustomEvent('cinar:mode', { detail: modes[event.code] }))
      }
      if (event.altKey && event.code === 'KeyR' && live) {
        event.preventDefault()
        void act('stop')
      }
      if (event.key.toLowerCase() === 'f' && !event.altKey && !event.ctrlKey && !event.metaKey) togglePlain()
      if (event.key === 'Escape') setPlain(false)
    }
    const togglePlain = () =>
      setPlain((value) => {
        if (value) void document.exitFullscreen?.().catch(() => undefined)
        else void document.documentElement.requestFullscreen?.().catch(() => undefined)
        return !value
      })
    window.addEventListener('keydown', onKey)
    window.addEventListener('cinar:plain', togglePlain)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('cinar:plain', togglePlain)
    }
  }, [live, act])

  const today = snap ? snap.me.today.date : todayKey()
  const myDays: Days = useMemo(
    () => (snap ? withLive(ledger?.days[snap.meId] ?? {}, snap.me, snap.partner?.live ?? null, now) : {}),
    [snap, ledger, now],
  )
  const theirDays: Days = useMemo(
    () => (snap && partner ? withLive(ledger?.days[partner.id] ?? {}, snap.partner, snap.me.live, now) : {}),
    [snap, ledger, partner, now],
  )

  const myStreak = streak((d) => (myDays[d]?.s ?? 0) >= 60, today)
  const jointStreak = partner ? streak((d) => Math.max(myDays[d]?.g ?? 0, theirDays[d]?.g ?? 0) >= JOINT_DAY_SEC, today) : 0

  if (!snap || !me) {
    return <div className="loading">{offline ? 'Bağlanılamıyor, tekrar deneniyor…' : 'Masa hazırlanıyor…'}</div>
  }

  const rev = snap.me.totals.sessions + (snap.partner?.totals.sessions ?? 0)

  return (
    <div className={plain ? 'shell is-plain' : 'shell'}>
      <header className="top">
        <span className="wordmark">Çınar</span>
        <nav aria-label="Sayfalar">
          {PAGES.map((item) => (
            <button key={item.id} className={page === item.id ? 'nav-item is-on' : 'nav-item'} aria-current={page === item.id ? 'page' : undefined} onClick={() => {
              scrollToTop()
              setPage(item.id)
            }}>
              {item.label}
            </button>
          ))}
        </nav>
        <p className="top-date">
          {myStreak > 0 && <span className="top-streak">Tek {myStreak} gün · </span>}
          {jointStreak > 0 && <span className="top-streak">Birlikte {jointStreak} gün · </span>}
          {longDay(today)}, {hourMinute(now)}
          {offline && <em> · bağlantı yok</em>}
        </p>
      </header>

      {incoming && partner && (
        <div className="call" role="alertdialog" aria-label="Derse çağrı" style={{ '--who': `var(--${partner.ink})` } as React.CSSProperties}>
          <p>
            <strong>{partner.name} seni derse çağırıyor.</strong> {incoming.minutes} dakika{incoming.topic ? `, ${incoming.topic}` : ''}.
          </p>
          <div className="call-actions">
            <button
              className="btn btn-solid"
              onClick={() => {
                if (prefs.autoMusic) setPlaySignal((n) => n + 1)
                void act('respond', { signalId: incoming.id, resp: 'accept' })
              }}
            >
              Geliyorum
            </button>
            <button className="btn" onClick={() => act('respond', { signalId: incoming.id, resp: 'later' })}>
              Birazdan
            </button>
            <button className="btn btn-quiet" onClick={() => act('respond', { signalId: incoming.id, resp: 'no' })}>
              Şimdi olmaz
            </button>
            <button className="link" onClick={() => setDismissedCalls((list) => [...list, incoming.id])}>
              Gizle
            </button>
          </div>
        </div>
      )}

      {snap.invitesIn.slice(0, 1).map((invite) => (
        <div className="call" key={invite.id} role="alertdialog" aria-label="Masa daveti">
          <p>
            <strong>{invite.fromName} seni masasına davet ediyor.</strong> @{invite.from}
          </p>
          <div className="call-actions">
            <button className="btn btn-solid" onClick={() => act('invite.accept', { id: invite.id })}>
              Masaya otur
            </button>
            <button className="btn btn-quiet" onClick={() => act('invite.decline', { id: invite.id })}>
              Şimdilik hayır
            </button>
          </div>
        </div>
      ))}

      {page === 'masa' && (
        <Desk
          snap={snap}
          me={me}
          partner={partner}
          prefs={prefs}
          setPrefs={setPrefs}
          finished={finished}
          dismissFinished={() => setFinished(null)}
          act={act}
          onFocusStart={() => {
            if (prefs.autoMusic) setPlaySignal((n) => n + 1)
          }}
          breakMinutes={breakMinutes}
        />
      )}
      {page === 'plan' && <Plan snap={snap} me={me} partner={partner} today={today} act={act} />}
      {page === 'kisiler' && <People snap={snap} hasPartner={!!partner} act={act} />}
      {page === 'hedefler' && <Goals snap={snap} me={me} partner={partner} myDays={myDays} theirDays={theirDays} today={today} act={act} />}
      {page === 'defter' && <Ledger me={me} partner={partner} myDays={myDays} theirDays={theirDays} today={today} rev={rev} />}
      {page === 'ayarlar' && <Settings snap={snap} me={me} partner={partner} prefs={prefs} setPrefs={setPrefs} act={act} onSignedOut={onSignedOut} />}

      <div className="toasts" aria-live="polite">
        {error && (
          <button className="toast toast-error" onClick={() => setError(null)}>
            {error}
          </button>
        )}
        {toast && <p className="toast">{toast}</p>}
      </div>

      <Player snap={snap} partner={partner} prefs={prefs} setPrefs={setPrefs} act={act} playSignal={playSignal} />
    </div>
  )
}
