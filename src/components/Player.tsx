import { useEffect, useRef, useState } from 'react'
import type { Member, Snapshot } from '../../shared/types.ts'
import { AMBIENCES, playRadio, setAmbience, setRadioVolume, STATIONS, stopRadio } from '../audio.ts'
import type { Prefs } from '../prefs.ts'

interface Props {
  snap: Snapshot
  partner?: Member
  prefs: Prefs
  setPrefs: (patch: Partial<Prefs>) => void
  act: (type: string, payload?: Record<string, unknown>) => Promise<boolean>
  /** Incremented by the app to start the music from a user gesture elsewhere. */
  playSignal: number
}

/** Turns a pasted YouTube or Spotify link into its official embed address. */
function embedFor(link: string): string | null {
  const youtube = link.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|live\/|shorts\/)|youtu\.be\/)([\w-]{6,})/)
  if (youtube) return `https://www.youtube.com/embed/${youtube[1]}`
  const list = link.match(/youtube\.com\/playlist\?(?:.*&)?list=([\w-]+)/)
  if (list) return `https://www.youtube.com/embed/videoseries?list=${list[1]}`
  const spotify = link.match(/open\.spotify\.com\/(?:intl-\w+\/)?(track|album|playlist|episode|show)\/(\w+)/)
  if (spotify) return `https://open.spotify.com/embed/${spotify[1]}/${spotify[2]}`
  return null
}

const stationName = (id: string) => STATIONS.find((s) => s.id === id)?.name ?? id

export function Player({ snap, partner, prefs, setPrefs, act, playSignal }: Props) {
  const [open, setOpen] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [failed, setFailed] = useState(false)
  const [linkInput, setLinkInput] = useState('')
  const [linkError, setLinkError] = useState(false)
  const [activeLink, setActiveLink] = useState<string | null>(null)
  const handled = useRef(playSignal)

  function play(station = prefs.station) {
    setFailed(false)
    setPlaying(true)
    const fail = () => {
      setFailed(true)
      setPlaying(false)
    }
    playRadio(station, prefs.volume, fail).catch(fail)
    for (const ambience of AMBIENCES) setAmbience(ambience.id, prefs.ambience[ambience.id] ?? 0)
    void act('music', { id: station })
  }

  function stop() {
    stopRadio()
    for (const ambience of AMBIENCES) setAmbience(ambience.id, 0)
    setPlaying(false)
    void act('music', { id: '' })
  }

  useEffect(() => {
    if (playSignal !== handled.current) {
      handled.current = playSignal
      if (!playing) play()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playSignal])

  function chooseStation(id: string) {
    setPrefs({ station: id })
    play(id)
  }

  const theirStation = snap.partner?.music?.id
  const suggest = theirStation && (!playing || theirStation !== prefs.station) ? theirStation : null

  return (
    <footer className="player">
      {(
        <div className={open ? 'player-panel' : 'player-panel is-closed'} data-lenis-prevent>
          <div>
            <h2>Radyo</h2>
            <ul className="stations">
              {STATIONS.map((station) => (
                <li key={station.id}>
                  <button className={playing && prefs.station === station.id ? 'station is-on' : 'station'} onClick={() => chooseStation(station.id)}>
                    <span>{station.name}</span>
                    <small>{station.desc}</small>
                  </button>
                </li>
              ))}
            </ul>
            <label className="slider">
              <span>Radyo sesi</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={prefs.volume}
                onChange={(e) => {
                  const volume = Number(e.target.value)
                  setPrefs({ volume })
                  setRadioVolume(volume)
                }}
              />
            </label>
          </div>
          <div>
            <h2>Ortam sesi</h2>
            <p className="setting-note">Radyonun üstüne ya da tek başına.</p>
            {AMBIENCES.map((ambience) => (
              <label className="slider" key={ambience.id}>
                <span>{ambience.name}</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={prefs.ambience[ambience.id] ?? 0}
                  onChange={(e) => {
                    const volume = Number(e.target.value)
                    setPrefs({ ambience: { ...prefs.ambience, [ambience.id]: volume } })
                    setAmbience(ambience.id, volume)
                  }}
                />
              </label>
            ))}
          </div>
          <div className="links-col">
            <h2>Bağlantıların</h2>
            <p className="setting-note">YouTube ya da Spotify bağlantısı yapıştır. Bu cihazda kalır.</p>
            <form
              className="nudge-form"
              onSubmit={(e) => {
                e.preventDefault()
                if (!embedFor(linkInput)) {
                  setLinkError(true)
                  return
                }
                setLinkError(false)
                setPrefs({ links: [linkInput.trim(), ...prefs.links.filter((l) => l !== linkInput.trim())].slice(0, 8) })
                setActiveLink(embedFor(linkInput))
                setLinkInput('')
              }}
            >
              <input value={linkInput} placeholder="https://…" aria-label="Müzik bağlantısı" onChange={(e) => setLinkInput(e.target.value)} />
              <button className="btn btn-quiet">Aç</button>
            </form>
            {linkError && <p className="clock-note">Bu bağlantıyı tanıyamadım.</p>}
            <ul className="links">
              {prefs.links.map((link) => (
                <li key={link}>
                  <button className="link" onClick={() => setActiveLink(embedFor(link))}>
                    {link.replace(/^https?:\/\/(www\.)?/, '').slice(0, 34)}
                  </button>
                  <button className="task-x" aria-label="Bağlantıyı sil" onClick={() => setPrefs({ links: prefs.links.filter((l) => l !== link) })}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
            {activeLink && (
              <>
                <iframe className="embed" src={activeLink} title="Müzik oynatıcı" allow="autoplay; encrypted-media" />
                <button className="link" onClick={() => setActiveLink(null)}>
                  Oynatıcıyı kapat
                </button>
              </>
            )}
          </div>
        </div>
      )}
      <div className="player-bar">
        <button className="player-toggle" aria-label={playing ? 'Müziği durdur' : 'Müziği başlat'} onClick={() => (playing ? stop() : play())}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            {playing ? <path d="M4 2.5h2.6v11H4zM9.4 2.5H12v11H9.4z" fill="currentColor" /> : <path d="M4.5 2.2 13 8l-8.5 5.8z" fill="currentColor" />}
          </svg>
        </button>
        <button className="player-name" aria-expanded={open} onClick={() => setOpen(!open)}>
          {failed ? 'Yayına bağlanılamadı' : stationName(prefs.station)}
          <small>{open ? 'Kapat' : 'Sesler'}</small>
        </button>
        {suggest && partner && (
          <button className="player-suggest" onClick={() => chooseStation(suggest)}>
            {partner.name} {stationName(suggest)} dinliyor. Sen de aç
          </button>
        )}
      </div>
    </footer>
  )
}
