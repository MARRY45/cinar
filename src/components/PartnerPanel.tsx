import { useEffect, useState, type FormEvent } from 'react'
import { elapsedAt, GRACE_SEC, rankFor } from '../../shared/logic.ts'
import type { Member, Snapshot } from '../../shared/types.ts'
import { api, type UserCard } from '../api.ts'
import { clock, duration, hourMinute, serverNow } from '../format.ts'
import { Digits } from '../motion.tsx'
import { useNow } from '../useApp.ts'

const NUDGES = ['Hadi, masaya', 'Aferin sana', 'Mola bitti', 'Buradayım']

interface Props {
  snap: Snapshot
  partnerMember?: Member
  act: (type: string, payload?: Record<string, unknown>) => Promise<boolean>
  callMinutes: number
}

export function PartnerPanel({ snap, partnerMember, act, callMinutes }: Props) {
  const now = useNow()
  const [sent, setSent] = useState<string | null>(null)
  const [text, setText] = useState('')

  if (!snap.partner || !partnerMember) return <Invite snap={snap} act={act} />

  const partner = snap.partner
  const live = partner.live
  const name = partnerMember.name
  const seenRecently = serverNow() - partner.lastSeen < 90_000
  const lost = !!live && live.pausedAt == null && (now - live.lastBeat) / 1000 > GRACE_SEC

  const activeCall = snap.me.outbox.find((s) => s.kind === 'call' && now - s.at < 10 * 60_000)
  const callAnswer = activeCall ? partner.responses[activeCall.id] : undefined
  const waiting = activeCall && !callAnswer

  async function nudge(value: string) {
    if (!value.trim()) return
    if (await act('signal', { kind: 'nudge', text: value })) {
      setSent(value)
      setText('')
      window.setTimeout(() => setSent(null), 2600)
    }
  }

  return (
    <div className="clock clock-partner">
      <p className="clock-label">
        <i className="who-dot" />
        {name}
      </p>
      {live ? (
        <>
          <p className={live.pausedAt != null || lost ? 'numerals numerals-small is-paused' : 'numerals numerals-small'} role="timer">
            <Digits value={clock(live.stopwatch ? elapsedAt(live, now) : live.plannedSec - elapsedAt(live, now))} />
          </p>
          <div className="hairbar" aria-hidden="true">
            <i style={{ width: live.stopwatch ? '100%' : `${(elapsedAt(live, now) / live.plannedSec) * 100}%` }} />
          </div>
          <p className="clock-sub">
            {lost
              ? 'Bağlantısı koptu, süresi işlemiyor.'
              : live.pausedAt != null
                ? 'Duraklattı.'
                : live.mode === 'break'
                  ? 'Molada.'
                  : live.topic
                    ? `${live.topic} çalışıyor.`
                    : 'Çalışıyor.'}
          </p>
          {live.intent && <p className="clock-intent">{live.intent}</p>}
        </>
      ) : (
        <>
          <p className="status-word">{seenRecently ? 'Masada' : 'Uzakta'}</p>
          <p className="clock-sub">{seenRecently ? 'Şu an çalışmıyor.' : `En son ${hourMinute(partner.lastSeen)} sularında buradaydı.`}</p>
        </>
      )}

      {snap.me.live?.mode !== 'focus' && live?.mode !== 'focus' && (
        <button className="btn btn-solid" disabled={!!waiting} onClick={() => act('signal', { kind: 'call', minutes: callMinutes })}>
          {waiting ? 'Çağrı gitti, yanıt bekleniyor' : 'Derse çağır'}
        </button>
      )}
      {snap.me.live?.mode !== 'focus' && live?.mode === 'focus' && (
        <button className="btn btn-solid" disabled={!!waiting} onClick={() => act('signal', { kind: 'call', minutes: callMinutes })}>
          {waiting ? 'Haber verildi' : `${name} ile çalışmak istiyorum`}
        </button>
      )}
      {callAnswer && activeCall && live?.mode !== 'focus' && (
        <p className="clock-note">
          {callAnswer.resp === 'accept' ? `${name} çağrını kabul etti.` : callAnswer.resp === 'later' ? `${name} birazdan geliyor.` : `${name} şu an gelemiyor.`}
        </p>
      )}

      {partner.lastFinished?.intent && !partner.lastFinished.verdict && now - partner.lastFinished.endedAt < 3600_000 && (
        <div className="verdict">
          <p className="clock-note">{name} şunu bitireceğini söylemişti:</p>
          <p className="clock-intent">{partner.lastFinished.intent}</p>
          <div className="chips">
            {(
              [
                ['yes', 'Yaptı'],
                ['partly', 'Kısmen'],
                ['no', 'Yapmadı'],
              ] as const
            ).map(([value, label]) => (
              <button key={value} className="chip" onClick={() => act('verdict', { sessionId: partner.lastFinished!.id, value })}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="nudges">
        {NUDGES.map((value) => (
          <button key={value} className="chip" onClick={() => nudge(value)}>
            {value}
          </button>
        ))}
      </div>
      <form
        className="nudge-form"
        onSubmit={(e) => {
          e.preventDefault()
          void nudge(text)
        }}
      >
        <input value={text} maxLength={60} placeholder="Kısa bir not yaz" aria-label={`${name} için not`} onChange={(e) => setText(e.target.value)} />
        <button className="btn btn-quiet" disabled={!text.trim()}>
          Gönder
        </button>
      </form>
      {sent && <p className="clock-note">“{sent}” gitti.</p>}
      <p className="clock-sub partner-today">Bugün {duration(partner.today.sessions.reduce((sum, s) => sum + s.sec, 0))} · {rankFor(partner.totals.sec).name}</p>
    </div>
  )
}

function Invite({ snap, act }: Pick<Props, 'snap' | 'act'>) {
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<UserCard | null>(null)
  const [missing, setMissing] = useState(false)
  const [copied, setCopied] = useState(false)
  const clean = query.trim().replace(/^@/, '').toLowerCase()

  useEffect(() => {
    setFound(null)
    setMissing(false)
    if (clean.length < 3 || clean === snap.username) return
    let alive = true
    const timer = window.setTimeout(() => {
      api
        .lookup(clean)
        .then((card) => alive && setFound(card))
        .catch(() => alive && setMissing(true))
    }, 280)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [clean, snap.username])

  async function send(event: FormEvent) {
    event.preventDefault()
    if (found && (await act('invite.send', { username: found.username }))) setQuery('')
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(`@${snap.username}`)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="clock clock-partner">
      <p className="clock-label">Karşı sandalye boş</p>
      <p className="status-word">Kimi çağıralım?</p>
      <form className="invite-search" onSubmit={send}>
        <label className="field">
          <span>Arkadaşının kullanıcı adını yaz, profili çıkınca davet et</span>
          <span className="at-input">
            <i>@</i>
            <input value={clean} maxLength={20} autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(e) => setQuery(e.target.value)} />
          </span>
        </label>
        {found && (
          <div className="found" style={{ '--who': `var(--${found.ink})` } as React.CSSProperties}>
            <p className="clock-label">
              <i className="who-dot" />
              {found.name}
            </p>
            {found.available ? <button className="btn btn-solid">Davet et</button> : <p className="clock-note">Başka bir masada oturuyor.</p>}
          </div>
        )}
        {missing && <p className="clock-note">Bu kullanıcı adıyla bir profil yok.</p>}
      </form>

      {snap.invitesOut.length > 0 && (
        <ul className="invites-out">
          {snap.invitesOut.map((invite) => (
            <li key={invite.id}>
              <span>{invite.toName} yanıt bekleniyor</span>
              <button className="link" onClick={() => act('invite.cancel', { id: invite.id })}>
                Geri al
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="partner-today clock-sub">
        Senin kullanıcı adın <button className="handle" onClick={copy}>@{snap.username}</button>
        {copied && ' kopyalandı'}
      </p>
    </div>
  )
}
