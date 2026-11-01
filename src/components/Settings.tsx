import { useEffect, useState } from 'react'
import type { Member, Snapshot } from '../../shared/types.ts'
import { api, setToken } from '../api.ts'
import { Rise, useReveals } from '../motion.tsx'
import type { Prefs } from '../prefs.ts'
import { ALARMS, bell, setAlarm, type AlarmId } from '../audio.ts'
import { savePhoto, type EffectId, type SceneId } from '../prefs.ts'
import { InkPicker, INKS } from './InkPicker.tsx'

export const SCENES: { id: SceneId; name: string }[] = [
  { id: 'none', name: 'Sade' },
  { id: 'fantasy', name: 'Masal' },
  { id: 'pastel', name: 'Pastel' },
  { id: 'lofi', name: 'Lo-fi' },
  { id: 'cyber', name: 'Neon' },
  { id: 'photo', name: 'Fotoğrafım' },
]

const EFFECTS: { id: EffectId; name: string }[] = [
  { id: 'off', name: 'Kapalı' },
  { id: 'motes', name: 'Toz' },
  { id: 'stars', name: 'Yıldız' },
  { id: 'rain', name: 'Yağmur' },
  { id: 'bubbles', name: 'Baloncuk' },
]

async function shrinkPhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 1920 / bitmap.width)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('photo'))), 'image/jpeg', 0.85))
}

let installEvent: (Event & { prompt: () => Promise<void> }) | null = null
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault()
  installEvent = event as typeof installEvent
})

interface Props {
  snap: Snapshot
  me: Member
  partner?: Member
  prefs: Prefs
  setPrefs: (patch: Partial<Prefs>) => void
  act: (type: string, payload?: Record<string, unknown>) => Promise<boolean>
  onSignedOut: () => void
}

function urlKey(base64: string) {
  const normal = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(normal), (c) => c.charCodeAt(0))
}

function Notifications({ snap, act }: Pick<Props, 'snap' | 'act'>) {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  const [endpoint, setEndpoint] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!supported) return
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setEndpoint(sub?.endpoint ?? null))
      .catch(() => setEndpoint(null))
  }, [supported])

  async function enable() {
    setMessage(null)
    try {
      if ((await Notification.requestPermission()) !== 'granted') {
        setMessage('Tarayıcı izin vermedi. Site ayarlarından açabilirsin.')
        return
      }
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlKey(snap.vapid!) })
      if (await act('push.subscribe', { subscription: sub.toJSON() })) {
        setEndpoint(sub.endpoint)
        setMessage('Açıldı. Çağrılar uygulama kapalıyken de bu cihaza gelir.')
      }
    } catch {
      setMessage('Bu tarayıcı bildirim aboneliğini tamamlayamadı.')
    }
  }

  async function disable() {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub) {
      await act('push.unsubscribe', { endpoint: sub.endpoint })
      await sub.unsubscribe()
    }
    setEndpoint(null)
    setMessage(null)
  }

  if (!supported) return <p className="empty">Bu tarayıcı bildirim desteklemiyor. iPhone'da önce ana ekrana eklemek gerekir.</p>
  if (!snap.vapid) return <p className="empty">Bildirimler sunucuda henüz ayarlanmadı.</p>
  return (
    <>
      <p className="setting-note">Arkadaşın seni derse çağırınca uygulama kapalı olsa da haber verir.</p>
      {endpoint ? (
        <button className="btn" onClick={disable}>
          Bu cihazda kapat
        </button>
      ) : (
        <button className="btn btn-solid" onClick={enable}>
          Bu cihazda aç
        </button>
      )}
      {message && <p className="clock-note">{message}</p>}
    </>
  )
}

export function Settings({ snap, me, partner, prefs, setPrefs, act, onSignedOut }: Props) {
  const root = useReveals<HTMLElement>()
  const [name, setName] = useState(me.name)
  const [goalHours, setGoalHours] = useState(String(me.dailyGoalMin / 60).replace('.', ','))
  const [deviceLink, setDeviceLink] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [installHint, setInstallHint] = useState(false)

  async function saveProfile() {
    const dailyGoalMin = Math.round(Number(goalHours.replace(',', '.')) * 60)
    if (await act('profile', { name, dailyGoalMin })) {
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2000)
    }
  }

  async function makeDeviceLink() {
    const { token } = await api.deviceLink()
    setDeviceLink(`${window.location.origin}/#giris=${token}`)
  }

  async function signOut() {
    await api.logout().catch(() => undefined)
    setToken(null)
    onSignedOut()
  }

  const [photoNote, setPhotoNote] = useState<string | null>(null)

  async function usePhoto(file: File | undefined) {
    if (!file) return
    try {
      await savePhoto(await shrinkPhoto(file))
      setPrefs({ scene: 'photo', photoRev: Date.now() })
      setPhotoNote('Fotoğraf yalnızca bu cihazda duruyor.')
    } catch {
      setPhotoNote('Bu dosya açılamadı.')
    }
  }

  const toggle = (key: 'sound' | 'autoBreak' | 'autoFocus' | 'autoMusic' | 'strict', label: string) => (
    <label className="check">
      <input type="checkbox" checked={prefs[key]} onChange={(e) => setPrefs({ [key]: e.target.checked })} />
      {label}
    </label>
  )

  const minuteField = (key: 'focusMinutes' | 'shortBreak' | 'longBreak', label: string, max: number) => (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        min={1}
        max={max}
        value={prefs[key]}
        onChange={(e) => setPrefs({ [key]: Math.min(max, Math.max(1, Number(e.target.value) || 1)) })}
      />
    </label>
  )

  return (
    <main className="page page-narrow" ref={root}>
      <header className="page-head">
        <h1>
          <Rise>Ayarlar</Rise>
        </h1>
      </header>

      <section className="setting">
        <h2>Sen</h2>
        <p className="setting-note">Kullanıcı adın @{snap.username}. Arkadaşın seni bununla bulur.</p>
        <div className="form">
          <div className="field-row">
            <label className="field">
              <span>Adın</span>
              <input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="field">
              <span>Günlük hedef (saat)</span>
              <input inputMode="decimal" value={goalHours} onChange={(e) => setGoalHours(e.target.value)} />
            </label>
          </div>
          <button className="btn" onClick={saveProfile}>
            {saved ? 'Kaydedildi' : 'Kaydet'}
          </button>
          <div className="field">
            <span>Rengin</span>
            <InkPicker value={me.ink} disabled={partner?.ink} onChange={(ink) => void act('profile', { ink })} />
          </div>
        </div>
      </section>

      <section className="setting">
        <h2>Saat</h2>
        <div className="form">
          <div className="field-row field-row-3">
            {minuteField('focusMinutes', 'Odak (dk)', 180)}
            {minuteField('shortBreak', 'Kısa mola (dk)', 60)}
            {minuteField('longBreak', 'Uzun mola (dk)', 60)}
          </div>
          <div className="seg" role="group" aria-label="Hazır süreler">
            {(
              [
                ['Klasik', 25, 5, 15],
                ['Uzun', 50, 10, 30],
                ['Animedoro', 40, 20, 20],
              ] as const
            ).map(([name, focusMinutes, shortBreak, longBreak]) => (
              <button
                key={name}
                className={prefs.focusMinutes === focusMinutes && prefs.shortBreak === shortBreak ? 'is-on' : ''}
                onClick={() => setPrefs({ focusMinutes, shortBreak, longBreak })}
              >
                {name}
              </button>
            ))}
          </div>
          <p className="setting-note">Dört tamamlanan oturumda bir uzun mola önerilir.</p>
          {toggle('strict', 'Katı mod: 30 saniyeden uzun uygulamadan çıkarsam ağaç solsun')}
          <p className="setting-note">Katı modda oturumun puanı yarıya iner ve arkadaşına haber gider. Kitaptan çalışırken sekme arka planda kalacaksa kapalı tut.</p>
          {toggle('autoBreak', 'Oturum bitince mola kendiliğinden başlasın')}
          {toggle('autoFocus', 'Mola bitince odak kendiliğinden başlasın')}
          <button className="link align-start" onClick={() => setPrefs({ counters: { date: '', focus: 0, short: 0, long: 0 } })}>
            Sayaçları sıfırla
          </button>
          {toggle('sound', 'Zil sesleri')}
          {toggle('autoMusic', 'Oturum başlayınca müziği aç')}
        </div>
      </section>

      <section className="setting">
        <h2>Alarm</h2>
        <div className="seg" role="radiogroup" aria-label="Alarm sesi">
          {ALARMS.map((alarm) => (
            <button
              key={alarm.id}
              role="radio"
              aria-checked={prefs.alarm === alarm.id}
              className={prefs.alarm === alarm.id ? 'is-on' : ''}
              onClick={() => {
                setPrefs({ alarm: alarm.id as AlarmId })
                setAlarm(alarm.id, prefs.alarmVolume)
                bell('end')
              }}
            >
              {alarm.name}
            </button>
          ))}
        </div>
        <label className="slider">
          <span>Alarm sesi</span>
          <input type="range" min={0} max={1} step={0.05} value={prefs.alarmVolume} onChange={(e) => setPrefs({ alarmVolume: Number(e.target.value) })} />
        </label>
      </section>

      <section className="setting">
        <h2>Görünüm</h2>
        <p className="setting-note">Sahne ve efekt seçimleri yalnızca bu cihazda geçerlidir.</p>
        <div className="scene-grid" role="radiogroup" aria-label="Arka plan">
          {SCENES.map((scene) => (
            <button
              key={scene.id}
              role="radio"
              aria-checked={prefs.scene === scene.id}
              className={prefs.scene === scene.id ? 'scene-card is-on' : 'scene-card'}
              style={scene.id !== 'none' && scene.id !== 'photo' ? { backgroundImage: `url(/scenes/${scene.id}.webp)` } : undefined}
              onClick={() => setPrefs({ scene: scene.id })}
            >
              <span>{scene.name}</span>
            </button>
          ))}
        </div>
        <label className="btn align-start">
          Fotoğraf yükle
          <input type="file" accept="image/*" hidden onChange={(e) => void usePhoto(e.target.files?.[0])} />
        </label>
        {photoNote && <p className="clock-note">{photoNote}</p>}
        <label className="field">
          <span>Molada sahne</span>
          <select value={prefs.breakScene} onChange={(e) => setPrefs({ breakScene: e.target.value as Prefs['breakScene'] })}>
            <option value="same">Değişmesin</option>
            {SCENES.map((scene) => (
              <option key={scene.id} value={scene.id}>
                {scene.name}
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          <span>Efekt</span>
          <div className="seg" role="radiogroup" aria-label="Efekt">
            {EFFECTS.map((effect) => (
              <button key={effect.id} role="radio" aria-checked={prefs.effect === effect.id} className={prefs.effect === effect.id ? 'is-on' : ''} onClick={() => setPrefs({ effect: effect.id })}>
                {effect.name}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>Vurgu rengi</span>
          <div className="inks">
            {[{ id: 'ink', name: 'Varsayılan' }, ...INKS].map((accent) => (
              <button key={accent.id} className={prefs.accent === accent.id ? 'ink is-on' : 'ink'} onClick={() => setPrefs({ accent: accent.id })}>
                <i style={{ background: `var(--${accent.id})` }} />
                {accent.name}
              </button>
            ))}
          </div>
        </div>
        <span className="setting-note">Tema</span>
        <div className="seg" role="radiogroup" aria-label="Tema">
          {(
            [
              ['auto', 'Saate göre'],
              ['day', 'Gündüz'],
              ['night', 'Gece'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} role="radio" aria-checked={prefs.theme === id} className={prefs.theme === id ? 'is-on' : ''} onClick={() => setPrefs({ theme: id })}>
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="setting">
        <h2>Bildirimler</h2>
        <Notifications snap={snap} act={act} />
      </section>

      <section className="setting">
        <h2>Kısayollar</h2>
        <ul className="shortcuts">
          <li><kbd>Boşluk</kbd> Başlat, duraklat, sürdür</li>
          <li><kbd>Alt P</kbd> Odak</li>
          <li><kbd>Alt K</kbd> Kısa mola</li>
          <li><kbd>Alt U</kbd> Uzun mola</li>
          <li><kbd>Alt R</kbd> Oturumu bitir</li>
          <li><kbd>F</kbd> Tam ekran sade görünüm</li>
        </ul>
      </section>

      <section className="setting">
        <h2>Uygulama olarak kur</h2>
        <p className="setting-note">Kendi penceresinde açılır, görev çubuğunda durur. Çalışmak için internet gerekir, çünkü saatler canlı işler.</p>
        <button
          className="btn"
          onClick={() => {
            if (installEvent) void installEvent.prompt()
            else setInstallHint(true)
          }}
        >
          Şimdi kur
        </button>
        {installHint && <p className="clock-note">Tarayıcı menüsünden "Uygulamayı yükle" ya da "Ana ekrana ekle" seçeneğini kullan.</p>}
      </section>

      <section className="setting">
        <h2>Başka cihaz</h2>
        <p className="setting-note">Telefonunda da aynı hesapla açmak için giriş bağlantısı üret. Bu bağlantı senin hesabına girer, kimseyle paylaşma.</p>
        {deviceLink ? (
          <input className="invite-link" readOnly value={deviceLink} aria-label="Cihaz bağlantısı" onFocus={(e) => e.target.select()} />
        ) : (
          <button className="btn" onClick={makeDeviceLink}>
            Giriş bağlantısı üret
          </button>
        )}
      </section>

      {partner && (
        <section className="setting">
          <h2>Masa</h2>
          <p className="setting-note">{partner.name} ile aynı masadasın. Ayrılırsan süren ve puanların seninle gelir, ortak ağaç ve ortak hedefler masada kalır.</p>
          {leaving ? (
            <div className="clock-actions">
              <button className="btn btn-solid" onClick={() => act('pair.leave')}>
                Evet, masadan ayrıl
              </button>
              <button className="btn btn-quiet" onClick={() => setLeaving(false)}>
                Vazgeç
              </button>
            </div>
          ) : (
            <button className="btn" onClick={() => setLeaving(true)}>
              Masadan ayrıl
            </button>
          )}
        </section>
      )}

      <section className="setting">
        <h2>Çıkış</h2>
        <p className="setting-note">Kayıtların silinmez. Yalnızca bu cihazın girişi kapanır, kullanıcı adın ve şifrenle geri dönersin.</p>
        <button className="btn" onClick={signOut}>
          Bu cihazdan çık
        </button>
      </section>

      <p className="credit">
        Radyo yayınları <a href="https://somafm.com" target="_blank" rel="noreferrer">SomaFM</a> tarafından, dinleyici bağışlarıyla sağlanır. Çınar Lo-fi parçaları TAD, omfgdude ve Holizna'nın CC0 eserleridir (<a href="https://opengameart.org" target="_blank" rel="noreferrer">OpenGameArt</a>).
      </p>
    </main>
  )
}
