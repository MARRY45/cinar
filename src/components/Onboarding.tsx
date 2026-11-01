import { useRef, useState, type FormEvent } from 'react'
import type { Ink } from '../../shared/types.ts'
import { api, setToken } from '../api.ts'
import { clock } from '../format.ts'
import { Digits, Rise, Scramble, scrollToElement, useReveals, useScrub } from '../motion.tsx'
import { InkPicker } from './InkPicker.tsx'
import { TreeView } from './TreeView.tsx'

const STORY_SEED = 20261102
const STORY_POINTS = 5200

const CHAPTERS = [
  { title: 'Bir tohumla başlar.', body: 'Odaklandığın her dakika bir puan. Puanlar ikinizin ortak ağacına gider.' },
  { title: 'İki saat, tek masa.', body: 'Arkadaşının saati karşında canlı işler. Ne çalıştığını, ne zaman mola verdiğini görürsün.' },
  { title: 'Birlikteyken daha hızlı.', body: 'Aynı anda çalıştığınız dakikalar 1,5 kat sayılır ve dallarda çiçek açar.' },
  { title: 'Geçmişe yazılmaz.', body: 'Süreyi yalnızca sunucu sayar. Elle kayıt yok, bağlantının koptuğu süre de sayılmaz.' },
]

const FEATURES = [
  { name: 'Derse çağır', text: 'Tek dokunuşla çağır. Kabul edince iki saat aynı anda başlar, uygulama kapalıysa bildirim gider.' },
  { name: 'Ortak hedefler', text: 'Kişisel ve ikinize ait hedefler. İsterseniz yalnızca aynı anda çalıştığınız süreyi sayın.' },
  { name: 'Sınav takvimi', text: 'Yaklaşan sınavlar gün gün sayılır, hedefler tarihine göre ilerler.' },
  { name: 'Radyo ve yağmur', text: 'Sakin radyolar, üstüne yağmur ya da şömine. Arkadaşının ne dinlediğini görüp aynısını açarsın.' },
  { name: 'Defter', text: 'Her oturum, konusu ve notuyla yazılır. Haftanız, konularınız ve son altı ayınız bir bakışta.' },
]

const STEPS = [
  { name: 'Görevi seç', text: 'Sıradaki tek işi belirle.' },
  { name: '25 dakika odaklan', text: 'Bir pomodoro boyunca yalnızca o iş.' },
  { name: 'Kısa mola', text: 'Beş dakika masadan kalk.' },
  { name: 'Dört kez tekrarla', text: 'Dört oturumun ardından uzun bir mola ver.' },
]

const FAQ = [
  { q: 'Neden iki kişilik?', a: 'Karşında çalışan biri olunca masaya oturmak kolaylaşıyor. Birbirinizin saatini canlı görür, derse çağırır, birlikte çalıştığınız dakikalarda daha çok puan alırsınız.' },
  { q: 'Tek başıma kullanabilir miyim?', a: 'Evet. Davet göndermeden de saat, görevler, hedefler ve defter çalışır.' },
  { q: 'Geçmişe süre ekleyebilir miyim?', a: 'Hayır. Süreyi yalnızca sunucu sayar. Bu yüzden ağacınız gerçekten çalıştığınız kadar büyür.' },
  { q: 'Sekmeyi değiştirirsem saat durur mu?', a: 'Durmaz. Bilgisayar uykuya geçer ya da bağlantı uzun süre koparsa o süre sayılmaz, geri dönünce kaldığın yerden sürer.' },
  { q: 'Saati diğer pencerelerin üstünde tutabilir miyim?', a: 'Destekleyen tarayıcılarda oturum sırasında "Küçük saat" düğmesi çıkar.' },
  { q: 'Kendi arka planımı ve müziğimi kullanabilir miyim?', a: 'Evet. Fotoğrafını yükleyebilir, YouTube ya da Spotify bağlantısı yapıştırabilirsin. Bunlar yalnızca senin cihazında kalır.' },
  { q: 'Telefona kurulur mu?', a: 'Evet, tarayıcı menüsünden ana ekrana ekleyebilirsin. Ayarlar sayfasında masaüstü için kurulum düğmesi de var.' },
]

function AuthForm({ onDone, initial = 'register' }: { onDone: () => void; initial?: 'register' | 'login' }) {
  const [mode, setMode] = useState(initial)
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [ink, setInk] = useState<Ink>('civit')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const registering = mode === 'register'
  const ready = username.length >= 3 && password.length > 0 && (!registering || name.trim().length > 0)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    try {
      const { token } = registering ? await api.register(username, name, password, ink) : await api.login(username, password)
      setToken(token)
      window.history.replaceState(null, '', '/')
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bağlantı sorunu.')
      setBusy(false)
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <div className="seg" role="radiogroup" aria-label="Giriş türü">
        <button type="button" role="radio" aria-checked={registering} className={registering ? 'is-on' : ''} onClick={() => setMode('register')}>
          Profil oluştur
        </button>
        <button type="button" role="radio" aria-checked={!registering} className={!registering ? 'is-on' : ''} onClick={() => setMode('login')}>
          Giriş yap
        </button>
      </div>
      {registering && (
        <label className="field">
          <span>Adın</span>
          <input value={name} maxLength={24} autoComplete="given-name" onChange={(e) => setName(e.target.value)} />
        </label>
      )}
      <label className="field">
        <span>Kullanıcı adı</span>
        <span className="at-input">
          <i>@</i>
          <input
            value={username}
            maxLength={20}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, ''))}
          />
        </span>
      </label>
      <label className="field">
        <span>Şifre</span>
        <input type="password" value={password} autoComplete={registering ? 'new-password' : 'current-password'} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {registering && (
        <div className="field">
          <span>Rengin</span>
          <InkPicker value={ink} onChange={setInk} />
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <button className="btn btn-solid" disabled={!ready || busy}>
        {registering ? 'Profili oluştur' : 'Giriş yap'}
      </button>
    </form>
  )
}

function Story() {
  const [ref, progress] = useScrub<HTMLElement>()
  const points = STORY_POINTS * progress ** 2.2
  const chapter = Math.min(CHAPTERS.length - 1, Math.floor(progress * CHAPTERS.length))
  const left = 25 * 60 * (1 - progress)

  return (
    <section className="story" ref={ref} aria-label="Çınar nasıl çalışır">
      <div className="story-stage">
        <div className="story-copy">
          {CHAPTERS.map((item, i) => (
            <div key={item.title} className={i === chapter ? 'chapter is-on' : i < chapter ? 'chapter is-past' : 'chapter'} aria-hidden={i !== chapter}>
              <p className="chapter-index">{i === chapter ? <Scramble text={`0${i + 1}`} /> : `0${i + 1}`}</p>
              <h2>
                <span className="mask">
                  <span>{item.title}</span>
                </span>
              </h2>
              <p className="chapter-body">{item.body}</p>
            </div>
          ))}
        </div>
        <div className="story-tree">
          <TreeView
            seed={STORY_SEED}
            mine={points * 0.54}
            theirs={points * 0.46}
            together={progress > 0.5 ? (progress - 0.5) * 2 * 40000 : 0}
            myInk="civit"
            theirInk="visne"
            scrubbed
            ghostPoints={STORY_POINTS}
          />
        </div>
        <div className="story-clocks" aria-hidden="true">
          <p>
            <i style={{ background: 'var(--civit)' }} />
            Sen
          </p>
          <Digits className="story-digits" value={clock(left)} />
          <p>
            <i style={{ background: 'var(--visne)' }} />
            Arkadaşın
          </p>
          <Digits className="story-digits" value={clock(left)} />
          <div className="story-bar">
            <i style={{ transform: `scaleX(${progress})` }} />
          </div>
        </div>
      </div>
    </section>
  )
}

function Landing({ onDone }: { onDone: () => void }) {
  const root = useReveals<HTMLElement>()
  const formRef = useRef<HTMLElement>(null)

  return (
    <main className="landing" ref={root}>
      <section className="hero">
        <header className="hero-top">
          <p data-fade>İki kişilik çalışma masası</p>
          <button className="link hero-login" data-fade onClick={() => scrollToElement(formRef.current)}>
            Giriş yap
          </button>
        </header>
        <h1 className="giant" aria-label="Çınar">
          {[...'Çınar'].map((letter, i) => (
            <span className="mask" key={i} aria-hidden="true">
              <span data-rise>{letter}</span>
            </span>
          ))}
        </h1>
        <div className="hero-foot">
          <div className="rule" data-rule />
          <div className="hero-row">
            <p className="hero-lede">
              <Rise>Saatler canlı işler, geçmişe kayıt girilmez.</Rise>
              <Rise>Siz çalıştıkça ortak ağacınız büyür.</Rise>
            </p>
            <button className="btn btn-solid hero-cta" data-fade onClick={() => scrollToElement(formRef.current)}>
              Profil oluştur
            </button>
          </div>
        </div>
      </section>

      <Story />

      <section className="manifesto" aria-label="Çınar'ın fikri">
        <div className="manifesto-text">
          <p>
            Yalnız çalışmak zor.
            <br />
            Karşında biri varken <b>başlamak</b> kolay.
          </p>
        </div>
        <div className="manifesto-photos" aria-hidden="true">
          {['lofi', 'fantasy', 'cyber', 'pastel'].map((scene) => (
            <img key={scene} src={`/scenes/${scene}.webp`} alt="" loading="lazy" />
          ))}
        </div>
      </section>

      <section className="features">
        <div className="rule" data-rule />
        <ul>
          {FEATURES.map((feature) => (
            <li key={feature.name}>
              <span className="feature-index">
                <Scramble text={`A—${FEATURES.indexOf(feature) + 1}`} />
              </span>
              <h3>
                <Rise>{feature.name}</Rise>
              </h3>
              <p data-fade>{feature.text}</p>
              <div className="rule" data-rule />
            </li>
          ))}
        </ul>
      </section>

      <section className="method">
        <h2 className="method-title">
          <Rise>Dört oturum,</Rise>
          <Rise>sonra gerçek bir mola.</Rise>
        </h2>
        <p className="method-lede" data-fade>
          Pomodoro tekniğini 1980'lerin sonunda Francesco Cirillo geliştirdi. Fikir basit: kısa ve belirli süreler başlamayı kolaylaştırır, düzenli molalar da dikkati taze tutar.
        </p>
        <ol className="steps">
          {STEPS.map((step, i) => (
            <li key={step.name} data-fade>
              <span>0{i + 1}</span>
              <h3>{step.name}</h3>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="faq">
        <h2>Sık sorulanlar</h2>
        {FAQ.map((item) => (
          <details key={item.q} data-fade>
            <summary>{item.q}</summary>
            <p>{item.a}</p>
          </details>
        ))}
      </section>

      <section className="closing" ref={formRef}>
        <h2 className="closing-title">
          <Rise>Profilini oluştur,</Rise>
          <Rise>arkadaşını <b>çağır.</b></Rise>
        </h2>
        <div data-fade>
          <AuthForm onDone={onDone} />
          <p className="setting-note closing-note">Profilini oluştur, arkadaşını kullanıcı adıyla bul. Davetin ekranına canlı düşer.</p>
        </div>
      </section>
      <div className="footer-mark" aria-hidden="true">Çınar</div>
    </main>
  )
}

export function Onboarding({ onDone }: { onDone: () => void }) {
  return <Landing onDone={onDone} />
}
