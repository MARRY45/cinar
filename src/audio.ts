/** Radio streams, synthesized ambience layers and the bell. Nothing here needs a backend. */

/** CC0 tracks shipped with the app; see public/music/CREDITS.txt. */
const LOCAL_TRACKS = ['cup-of-tea', 'cat-caffe', 'morning-rain', 'oceanside', 'countryside', 'florist', 'chill-lofi', 'first-snow']
export const LOCAL_STATION = 'cinar-lofi'

export const STATIONS = [
  { id: LOCAL_STATION, name: 'Çınar Lo-fi', desc: 'Telifsiz parçalar, reklamsız' },
  { id: 'groovesalad', name: 'Groove Salad', desc: 'Sakin, ritimli downtempo' },
  { id: 'fluid', name: 'Fluid', desc: 'Enstrümantal hip-hop, lo-fi havası' },
  { id: 'lush', name: 'Lush', desc: 'Yumuşak vokaller, elektronik' },
  { id: 'dronezone', name: 'Drone Zone', desc: 'Ritimsiz, derin ambient' },
  { id: 'deepspaceone', name: 'Deep Space One', desc: 'Uzak, uzay ambient' },
] as const

export type AmbienceId = 'yagmur' | 'kahverengi' | 'ruzgar' | 'somine'

export const AMBIENCES: { id: AmbienceId; name: string }[] = [
  { id: 'yagmur', name: 'Yağmur' },
  { id: 'ruzgar', name: 'Rüzgâr' },
  { id: 'somine', name: 'Şömine' },
  { id: 'kahverengi', name: 'Düşük uğultu' },
]

let context: AudioContext | null = null

function audio(): AudioContext {
  context ??= new AudioContext()
  if (context.state === 'suspended') void context.resume()
  return context
}

const LOOP_SEC = 12

/** Equal-power crossfade at the seam so the loop has no audible click. */
function makeLoop(ctx: BaseAudioContext, fill: (out: Float32Array, rate: number) => void): AudioBuffer {
  const rate = ctx.sampleRate
  const fade = Math.floor(rate * 0.5)
  const length = Math.floor(rate * LOOP_SEC)
  const buffer = ctx.createBuffer(2, length, rate)
  for (let ch = 0; ch < 2; ch++) {
    const raw = new Float32Array(length + fade)
    fill(raw, rate)
    const out = buffer.getChannelData(ch)
    for (let i = 0; i < length; i++) out[i] = raw[i]
    for (let i = 0; i < fade; i++) {
      const t = i / fade
      out[i] = raw[i] * Math.sqrt(t) + raw[length + i] * Math.sqrt(1 - t)
    }
  }
  return buffer
}

function white(out: Float32Array) {
  for (let i = 0; i < out.length; i++) out[i] = Math.random() * 2 - 1
}

function brown(out: Float32Array, gain = 3.2) {
  let last = 0
  for (let i = 0; i < out.length; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02
    out[i] = last * gain
  }
}

function crackle(out: Float32Array, rate: number) {
  brown(out, 1.6)
  const pops = Math.floor((out.length / rate) * 7)
  for (let p = 0; p < pops; p++) {
    const at = Math.floor(Math.random() * (out.length - 1200))
    const amp = 0.08 + Math.random() ** 3 * 0.55
    const decay = 40 + Math.random() * 360
    for (let i = 0; i < 1200; i++) out[at + i] += (Math.random() * 2 - 1) * amp * Math.exp(-i / decay)
  }
}

/** Builds one ambience graph on any context, so it can also be rendered offline for checking. */
export function buildAmbience(ctx: BaseAudioContext, id: AmbienceId, output: AudioNode): () => void {
  const source = ctx.createBufferSource()
  source.loop = true
  const stops: (() => void)[] = [() => source.stop()]

  if (id === 'yagmur') {
    source.buffer = makeLoop(ctx, white)
    const high = ctx.createBiquadFilter()
    high.type = 'highpass'
    high.frequency.value = 700
    const low = ctx.createBiquadFilter()
    low.type = 'lowpass'
    low.frequency.value = 7200
    const level = ctx.createGain()
    level.gain.value = 0.32
    source.connect(high).connect(low).connect(level).connect(output)
  } else if (id === 'kahverengi') {
    source.buffer = makeLoop(ctx, (o) => brown(o))
    const low = ctx.createBiquadFilter()
    low.type = 'lowpass'
    low.frequency.value = 500
    const level = ctx.createGain()
    level.gain.value = 0.9
    source.connect(low).connect(level).connect(output)
  } else if (id === 'ruzgar') {
    source.buffer = makeLoop(ctx, (o) => brown(o, 3.6))
    const band = ctx.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = 420
    band.Q.value = 0.6
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.07
    const depth = ctx.createGain()
    depth.gain.value = 220
    lfo.connect(depth).connect(band.frequency)
    lfo.start()
    stops.push(() => lfo.stop())
    const level = ctx.createGain()
    level.gain.value = 1.3
    source.connect(band).connect(level).connect(output)
  } else {
    source.buffer = makeLoop(ctx, crackle)
    const low = ctx.createBiquadFilter()
    low.type = 'lowpass'
    low.frequency.value = 5200
    const level = ctx.createGain()
    level.gain.value = 0.8
    source.connect(low).connect(level).connect(output)
  }

  source.start()
  return () => stops.forEach((stop) => stop())
}

const layers = new Map<AmbienceId, { gain: GainNode; stop: () => void }>()

export function setAmbience(id: AmbienceId, volume: number) {
  const existing = layers.get(id)
  if (volume <= 0) {
    if (!existing) return
    const ctx = audio()
    existing.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.12)
    layers.delete(id)
    window.setTimeout(existing.stop, 800)
    return
  }
  const ctx = audio()
  if (existing) {
    existing.gain.gain.setTargetAtTime(volume, ctx.currentTime, 0.08)
    return
  }
  const gain = ctx.createGain()
  gain.gain.value = 0
  gain.connect(ctx.destination)
  gain.gain.setTargetAtTime(volume, ctx.currentTime, 0.4)
  layers.set(id, { gain, stop: buildAmbience(ctx, id, gain) })
}

let radio: HTMLAudioElement | null = null

export function playRadio(id: string, volume: number, onError: () => void): Promise<void> {
  stopRadio()
  if (id === LOCAL_STATION) {
    let index = Math.floor(Math.random() * LOCAL_TRACKS.length)
    const element = new Audio(`/music/${LOCAL_TRACKS[index]}.mp3`)
    element.onended = () => {
      index = (index + 1) % LOCAL_TRACKS.length
      element.src = `/music/${LOCAL_TRACKS[index]}.mp3`
      void element.play()
    }
    radio = element
    radio.volume = volume
    radio.onerror = onError
    return radio.play()
  }
  radio = new Audio(`https://ice1.somafm.com/${id}-128-mp3`)
  radio.preload = 'none'
  radio.volume = volume
  radio.onerror = onError
  return radio.play()
}

export function setRadioVolume(volume: number) {
  if (radio) radio.volume = volume
}

export function stopRadio() {
  if (!radio) return
  radio.onerror = null
  radio.onended = null
  radio.pause()
  radio.removeAttribute('src')
  radio.load()
  radio = null
}

function bellPartial(ctx: AudioContext, at: number, freq: number, level: number, decay: number) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0, at)
  gain.gain.linearRampToValueAtTime(level, at + 0.006)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + decay)
  osc.connect(gain).connect(ctx.destination)
  osc.start(at)
  osc.stop(at + decay + 0.05)
}

export type AlarmId = 'kase' | 'cingirak' | 'ziller' | 'dijital'

export const ALARMS: { id: AlarmId; name: string }[] = [
  { id: 'kase', name: 'Kâse' },
  { id: 'ziller', name: 'Zil' },
  { id: 'cingirak', name: 'Çıngırak' },
  { id: 'dijital', name: 'Dijital' },
]

let alarmChoice: AlarmId = 'kase'
let alarmVolume = 1

export function setAlarm(id: AlarmId, volume: number) {
  alarmChoice = id
  alarmVolume = volume
}

function playAlarm(ctx: AudioContext, now: number, strike: (at: number, base: number, level: number) => void) {
  const v = alarmVolume
  if (alarmChoice === 'kase') {
    strike(now, 392, 0.2 * v)
    strike(now + 1.1, 293.66, 0.18 * v)
  } else if (alarmChoice === 'ziller') {
    ;[1046.5, 1318.5, 1568].forEach((f, i) => bellPartial(ctx, now + i * 0.28, f, 0.14 * v, 1.6))
  } else if (alarmChoice === 'cingirak') {
    for (let i = 0; i < 10; i++) bellPartial(ctx, now + i * 0.09, i % 2 ? 2093 : 1760, 0.07 * v, 0.28)
  } else {
    for (let i = 0; i < 6; i++) {
      const at = now + i * 0.22
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'square'
      osc.frequency.value = 1320
      gain.gain.value = i % 3 === 2 ? 0 : 0.05 * v
      osc.connect(gain).connect(ctx.destination)
      osc.start(at)
      osc.stop(at + 0.11)
    }
  }
}

/** A struck singing-bowl sound; inharmonic partials keep it from sounding like a phone. */
export function bell(kind: 'end' | 'call' | 'soft' = 'end') {
  try {
    const ctx = audio()
    const now = ctx.currentTime + 0.02
    const strike = (at: number, base: number, level: number) => {
      bellPartial(ctx, at, base, level, 3.2)
      bellPartial(ctx, at, base * 2.71, level * 0.42, 2.1)
      bellPartial(ctx, at, base * 5.18, level * 0.14, 1.1)
    }
    if (kind === 'end') {
      playAlarm(ctx, now, strike)
    } else if (kind === 'call') {
      strike(now, 523.25, 0.16)
      strike(now + 0.32, 659.25, 0.16)
      strike(now + 1.5, 523.25, 0.14)
      strike(now + 1.82, 659.25, 0.14)
    } else {
      strike(now, 587.33, 0.08)
    }
  } catch {
    // Audio can be unavailable before the first user gesture; the visual cue still shows.
  }
}
