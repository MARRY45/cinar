import { useCallback, useEffect, useState } from 'react'
import type { AlarmId, AmbienceId } from './audio.ts'

export interface Prefs {
  theme: 'auto' | 'day' | 'night'
  sound: boolean
  autoBreak: boolean
  autoMusic: boolean
  focusMinutes: number
  shortBreak: number
  longBreak: number
  station: string
  volume: number
  ambience: Partial<Record<AmbienceId, number>>
  autoFocus: boolean
  alarm: AlarmId
  alarmVolume: number
  scene: SceneId
  accent: string
  effect: EffectId
  links: string[]
  strict: boolean
  breakScene: SceneId | 'same'
  templates: { name: string; tasks: { title: string; est?: number }[] }[]
  photoRev: number
  counters: { date: string; focus: number; short: number; long: number }
}

export type SceneId = 'none' | 'fantasy' | 'pastel' | 'lofi' | 'cyber' | 'photo'
export type EffectId = 'off' | 'motes' | 'stars' | 'rain' | 'bubbles'

const DEFAULTS: Prefs = {
  theme: 'auto',
  sound: true,
  autoBreak: false,
  autoMusic: false,
  focusMinutes: 25,
  shortBreak: 5,
  longBreak: 15,
  station: 'cinar-lofi',
  volume: 0.6,
  ambience: {},
  autoFocus: false,
  alarm: 'kase',
  alarmVolume: 1,
  scene: 'none',
  accent: 'ink',
  effect: 'off',
  links: [],
  strict: false,
  breakScene: 'same',
  templates: [],
  photoRev: 0,
  counters: { date: '', focus: 0, short: 0, long: 0 },
}

const KEY = 'cinar.prefs'

function load(): Prefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return DEFAULTS
  }
}

export function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs>(load)
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs))
    } catch {
      // Preferences are a convenience; the app works with defaults.
    }
  }, [prefs])
  const update = useCallback((patch: Partial<Prefs>) => setPrefs((p) => ({ ...p, ...patch })), [])
  return [prefs, update] as const
}

const PHOTO_DB = 'cinar'
const PHOTO_STORE = 'photos'

function photoDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(PHOTO_DB, 1)
    open.onupgradeneeded = () => open.result.createObjectStore(PHOTO_STORE)
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
  })
}

/** The viewer's own background photo. It stays on this device and is never uploaded. */
export async function savePhoto(photo: Blob) {
  const db = await photoDb()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, 'readwrite')
    tx.objectStore(PHOTO_STORE).put(photo, 'background')
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
}

export async function loadPhoto(): Promise<Blob | null> {
  const db = await photoDb()
  return new Promise((resolve, reject) => {
    const get = db.transaction(PHOTO_STORE).objectStore(PHOTO_STORE).get('background')
    get.onsuccess = () => resolve((get.result as Blob) ?? null)
    get.onerror = () => reject(get.error)
  })
}

/** Night runs from 19:00 to 07:00 in Istanbul when the theme is automatic. */
export function resolveTheme(theme: Prefs['theme'], now: number): 'day' | 'night' {
  if (theme !== 'auto') return theme
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', hour: '2-digit', hourCycle: 'h23' }).format(now))
  return hour >= 19 || hour < 7 ? 'night' : 'day'
}
