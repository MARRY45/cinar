import { dayKey } from '../shared/logic.ts'
import type { DayStat, Goal, Live, Member, Snapshot, UserView } from '../shared/types.ts'
import { elapsedAt, isFocusing, pointsFor } from '../shared/logic.ts'

let skewMs = 0

export function setServerTime(serverNow: number) {
  skewMs = serverNow - Date.now()
}

/** Current server time. All timers render from this, never from the local clock alone. */
export const serverNow = () => Date.now() + skewMs

export function clock(totalSec: number): string {
  const sec = Math.max(0, Math.ceil(totalSec))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function duration(totalSec: number): string {
  const min = Math.round(totalSec / 60)
  if (min < 60) return `${min} dk`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} sa ${m} dk` : `${h} sa`
}

const timeFormat = new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' })
export const hourMinute = (ms: number) => timeFormat.format(ms)

const fullDate = new Intl.DateTimeFormat('tr-TR', { timeZone: 'UTC', day: 'numeric', month: 'long', weekday: 'long' })
const shortDate = new Intl.DateTimeFormat('tr-TR', { timeZone: 'UTC', day: 'numeric', month: 'short' })
const weekdayFormat = new Intl.DateTimeFormat('tr-TR', { timeZone: 'UTC', weekday: 'short' })

const keyToUtc = (key: string) => {
  const [y, m, d] = key.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

export const longDay = (key: string) => fullDate.format(keyToUtc(key))
export const shortDay = (key: string) => shortDate.format(keyToUtc(key))
export const weekdayName = (key: string) => weekdayFormat.format(keyToUtc(key))

export function addDays(key: string, n: number): string {
  return new Date(keyToUtc(key) + n * 86400_000).toISOString().slice(0, 10)
}

export function daysBetween(from: string, to: string): number {
  return Math.round((keyToUtc(to) - keyToUtc(from)) / 86400_000)
}

/** Monday of the week containing the given day. */
export function weekStart(key: string): string {
  const weekday = (new Date(keyToUtc(key)).getUTCDay() + 6) % 7
  return addDays(key, -weekday)
}

export const todayKey = () => dayKey(serverNow())

/** Minutes since Istanbul midnight, used to place things on the day strip. */
export function minuteOfDay(ms: number, dateKey: string): number {
  const midnightUtc = keyToUtc(dateKey) - 3 * 3600_000
  return (ms - midnightUtc) / 60_000
}

export type Days = Record<string, DayStat>

/** Adds the running session to a day map so totals stay live between records. */
export function withLive(days: Days, view: UserView | null, partnerLive: Live | null, now: number): Days {
  const live = view?.live
  if (!live || live.mode !== 'focus') return days
  const today = dayKey(now)
  const elapsed = elapsedAt(live, now)
  const base = days[today] ?? { s: 0, g: 0, p: 0, n: 0, t: {} }
  const extraTogether = isFocusing(partnerLive, now) ? Math.max(0, elapsed - live.creditedSec) : 0
  const key = live.topic || 'Konusuz'
  return {
    ...days,
    [today]: {
      ...base,
      s: base.s + elapsed,
      g: base.g + live.togetherSec + extraTogether,
      t: { ...base.t, [key]: (base.t[key] ?? 0) + elapsed },
    },
  }
}

/** Points including the session still in progress, for the tree. */
export function livePoints(view: UserView | null, partnerLive: Live | null, now: number) {
  if (!view) return { points: 0, together: 0 }
  let points = view.totals.points
  let together = view.totals.togetherSec
  const live = view.live
  if (live?.mode === 'focus') {
    const elapsed = elapsedAt(live, now)
    const extra = isFocusing(partnerLive, now) ? Math.max(0, elapsed - live.creditedSec) : 0
    points += pointsFor(elapsed, live.togetherSec + extra, false, live.plannedSec)
    together += live.togetherSec + extra
  }
  return { points, together }
}

export function periodRange(goal: Goal, today: string): { from: string; to: string; label: string } {
  if (goal.period === 'day') return { from: today, to: today, label: 'bugün' }
  if (goal.period === 'week') return { from: weekStart(today), to: addDays(weekStart(today), 6), label: 'bu hafta' }
  if (goal.period === 'month') return { from: `${today.slice(0, 8)}01`, to: `${today.slice(0, 8)}31`, label: 'bu ay' }
  const left = daysBetween(today, goal.until!)
  const from = new Date(goal.createdAt + 3 * 3600_000).toISOString().slice(0, 10)
  return {
    from,
    to: goal.until!,
    label: left > 0 ? `${left} gün kaldı` : left === 0 ? 'son gün bugün' : 'süresi doldu',
  }
}

const sameTopic = (a: string, b: string) => a.toLocaleLowerCase('tr') === b.toLocaleLowerCase('tr')

function sumRange(days: Days, goal: Goal, from: string, to: string): number {
  let sec = 0
  for (const [date, stat] of Object.entries(days)) {
    if (date < from || date > to) continue
    if (goal.metric === 'together') sec += stat.g
    else if (goal.topic) {
      for (const [topic, value] of Object.entries(stat.t)) if (sameTopic(topic, goal.topic)) sec += value
    } else sec += stat.s
  }
  return sec
}

export function goalProgress(goal: Goal, sources: Days[], today: string): number {
  const { from, to } = periodRange(goal, today)
  const values = sources.map((days) => sumRange(days, goal, from, to))
  // Time together is shared, so the two sides are one figure rather than a sum.
  return goal.metric === 'together' ? Math.max(0, ...values) : values.reduce((a, b) => a + b, 0)
}

/** Consecutive days ending today (or yesterday, if today is still open) that pass the test. */
export function streak(test: (date: string) => boolean, today: string): number {
  let date = test(today) ? today : addDays(today, -1)
  let count = 0
  while (test(date)) {
    count++
    date = addDays(date, -1)
  }
  return count
}

export function monthStart(key: string) {
  return `${key.slice(0, 8)}01`
}

export function monthDays(start: string): number {
  let n = 28
  while (addDays(start, n).slice(0, 7) === start.slice(0, 7)) n++
  return n
}

/** Longest run of consecutive days passing the test, among the given days. */
export function longestStreak(dates: string[], test: (date: string) => boolean): number {
  let best = 0
  let run = 0
  let previous = ''
  for (const date of [...dates].sort()) {
    if (!test(date)) {
      run = 0
      continue
    }
    run = previous && addDays(previous, 1) === date ? run + 1 : 1
    previous = date
    best = Math.max(best, run)
  }
  return best
}

/** A joint-streak day has at least this much time studied at the same moment. */
export const JOINT_DAY_SEC = 10 * 60

export const memberOf = (snap: Snapshot, id: string): Member | undefined => snap.pair.members.find((m) => m.id === id)
