import { useEffect, useState } from 'react'
import type { PresenceEntry, Snapshot } from '../../shared/types.ts'
import { api } from '../api.ts'
import { Rise, useReveals } from '../motion.tsx'

const POLL_MS = 20_000
const STATUS: Record<PresenceEntry['status'], string> = { focus: 'Çalışıyor', break: 'Molada', idle: 'Masada' }

interface Props {
  snap: Snapshot
  hasPartner: boolean
  act: (type: string, payload?: Record<string, unknown>) => Promise<boolean>
}

export function People({ snap, hasPartner, act }: Props) {
  const root = useReveals<HTMLElement>()
  const [online, setOnline] = useState<PresenceEntry[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const load = () =>
      api
        .online()
        .then((res) => {
          setOnline(res.online)
          setFailed(false)
        })
        .catch(() => setFailed(true))
    void load()
    const timer = window.setInterval(load, POLL_MS)
    return () => window.clearInterval(timer)
  }, [])

  const others = online?.filter((p) => p.username !== snap.username) ?? []
  const invited = new Set(snap.invitesOut.map((i) => i.to))

  return (
    <main className="page" ref={root}>
      <header className="page-head">
        <h1>
          <Rise>Kişiler</Rise>
        </h1>
        <p data-fade>Şu an Çınar'da olanlar. Burada yalnızca ad ve durum görünür, ne çalıştığın görünmez.</p>
      </header>

      <section className="people">
        {failed && <p className="empty">Liste okunamadı, tekrar deneniyor.</p>}
        {online && others.length === 0 && <p className="empty">Şu an senden başka kimse yok.</p>}
        <ul>
          {others.map((person) => (
            <li key={person.username} style={{ '--who': `var(--${person.ink})` } as React.CSSProperties}>
              <i className="who-dot" />
              <span className="people-name">
                <strong>{person.name}</strong>
                <small>
                  @{person.username}, {STATUS[person.status].toLocaleLowerCase('tr')}
                </small>
              </span>
              {!hasPartner &&
                person.available &&
                (invited.has(person.username) ? (
                  <span className="clock-note">Davet gitti</span>
                ) : (
                  <button className="btn" onClick={() => act('invite.send', { username: person.username })}>
                    Davet et
                  </button>
                ))}
            </li>
          ))}
        </ul>
        <label className="check people-toggle">
          <input type="checkbox" checked={!snap.me.hidden} onChange={(e) => act('presence.hide', { hidden: !e.target.checked })} />
          Beni bu listede göster
        </label>
      </section>
    </main>
  )
}
