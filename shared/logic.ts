import type { DayStat, Live, SessionRec, Totals, UserDoc } from './types.ts'

/** A gap between heartbeats longer than this is not counted as study time. */
export const GRACE_SEC = 150
/** A session with no heartbeat for this long is closed with what it earned. */
export const STALE_SEC = 900
export const PAUSED_STALE_SEC = 1800
/** Sessions shorter than this leave no record. */
export const MIN_COUNT_SEC = 60
/** Heartbeats closer together than this are not written, to spare the store. */
export const BEAT_WRITE_SEC = 10
export const TOGETHER_BONUS = 0.5
export const COMPLETE_BONUS = 5
export const COMPLETE_BONUS_MIN_SEC = 15 * 60
export const CHALLENGE_BONUS = 10
export const BIRDS = ['Serçe', 'Bülbül', 'İspinoz', 'Kırlangıç', 'Baştankara', 'Sığırcık', 'Ardıç kuşu', 'Çalı kuşu', 'Karatavuk', 'Saka']

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Istanbul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Calendar day in Istanbul as YYYY-MM-DD. */
export const dayKey = (ms: number) => dayFormat.format(ms)

export const RANKS = [
  { hours: 0, name: 'Çırak' },
  { hours: 10, name: 'Kalfa' },
  { hours: 50, name: 'Usta' },
  { hours: 200, name: 'Üstat' },
  { hours: 500, name: 'Bilge' },
]

/** Title earned by total focused time. */
export function rankFor(sec: number) {
  const hours = sec / 3600
  let index = 0
  RANKS.forEach((rank, i) => {
    if (hours >= rank.hours) index = i
  })
  return { ...RANKS[index], next: RANKS[index + 1] ?? null }
}

export function emptyTotals(): Totals {
  return { sec: 0, togetherSec: 0, points: 0, pomodoros: 0, sessions: 0 }
}

/** True while a session is receiving heartbeats and is not paused. */
export function isRunning(live: Live | null | undefined, now: number): boolean {
  return !!live && live.pausedAt == null && (now - live.lastBeat) / 1000 <= GRACE_SEC
}

export function isFocusing(live: Live | null | undefined, now: number): boolean {
  return !!live && live.mode === 'focus' && isRunning(live, now)
}

/** Credits the time since the last heartbeat. The client never supplies a duration. */
export function advance(live: Live, now: number, partnerFocusing: boolean): void {
  const delta = (now - live.lastBeat) / 1000
  if (delta <= 0) return
  if (live.pausedAt != null) {
    live.lastBeat = now
    return
  }
  if (delta > GRACE_SEC) {
    live.gapSec += delta
    live.segs.push([now, now])
  } else {
    const credit = Math.min(delta, Math.max(0, live.plannedSec - live.creditedSec))
    live.creditedSec += credit
    if (partnerFocusing && live.mode === 'focus') live.togetherSec += credit
    live.segs[live.segs.length - 1][1] = live.lastBeat + credit * 1000
  }
  live.lastBeat = now
}

export function isDone(live: Live): boolean {
  return live.creditedSec >= live.plannedSec - 0.5
}

/** Seconds of the session elapsed at `now`, as both clients should display it. */
export function elapsedAt(live: Live, now: number): number {
  if (live.pausedAt != null) return live.creditedSec
  const delta = (now - live.lastBeat) / 1000
  if (delta > GRACE_SEC || delta < 0) return live.creditedSec
  return Math.min(live.plannedSec, live.creditedSec + delta)
}

export function pointsFor(sec: number, togetherSec: number, complete: boolean, plannedSec: number): number {
  const base = sec / 60 + (togetherSec / 60) * TOGETHER_BONUS
  const bonus = complete && plannedSec >= COMPLETE_BONUS_MIN_SEC ? COMPLETE_BONUS : 0
  return Math.round(base + bonus)
}

/** Moves yesterday's sessions out of the doc. Returns them so the caller can archive them. */
export function rollToday(doc: UserDoc, now: number): { date: string; sessions: SessionRec[] } | null {
  const date = dayKey(now)
  if (doc.today.date === date) return null
  const old = doc.today
  doc.today = { date, sessions: [] }
  return old.sessions.length ? old : null
}

/** Ends the live session. A focus session long enough to count becomes a record. */
export function closeLive(doc: UserDoc, now: number): SessionRec | null {
  const live = doc.live
  doc.live = null
  if (!live || live.mode !== 'focus' || live.creditedSec < MIN_COUNT_SEC) return null

  const complete = isDone(live)
  const sec = Math.round(live.creditedSec)
  const togetherSec = Math.round(live.togetherSec)
  const rec: SessionRec = {
    id: live.id,
    topic: live.topic,
    intent: live.intent,
    startedAt: live.startedAt,
    endedAt: now,
    sec,
    togetherSec,
    gapSec: Math.round(live.gapSec),
    points: Math.ceil(pointsFor(sec, togetherSec, complete && !live.stopwatch, live.plannedSec) / (live.withered ? 2 : 1)),
    withered: live.withered,
    complete,
    plannedSec: live.plannedSec,
    segs: live.segs.filter(([a, b]) => b > a),
  }

  doc.today.sessions.push(rec)
  const day: DayStat = doc.days[doc.today.date] ?? { s: 0, g: 0, p: 0, n: 0, t: {} }
  day.s += sec
  day.g += togetherSec
  day.p += rec.points
  if (complete) day.n += 1
  const topic = rec.topic || 'Konusuz'
  day.t[topic] = (day.t[topic] ?? 0) + sec
  doc.days[doc.today.date] = day

  const task = doc.tasks.find((t) => t.id === live.taskId)
  if (task) task.sec += sec

  const challenge = doc.challenge
  if (challenge && challenge.date === doc.today.date && !challenge.won && day.s >= challenge.targetMin * 60) {
    challenge.won = BIRDS[doc.birds.length % BIRDS.length]
    doc.birds.push(challenge.won)
    doc.totals.points += CHALLENGE_BONUS
    day.p += CHALLENGE_BONUS
  }

  doc.totals.sec += sec
  doc.totals.togetherSec += togetherSec
  doc.totals.points += rec.points
  doc.totals.sessions += 1
  if (complete) doc.totals.pomodoros += 1
  doc.lastFinished = rec
  return rec
}

/** Applies time-based transitions: credit, completion, stale closure, day rollover. */
export function settle(
  doc: UserDoc,
  now: number,
  partnerFocusing: boolean,
): { archived: { date: string; sessions: SessionRec[] } | null; changed: boolean } {
  let changed = false
  const live = doc.live
  if (live) {
    const delta = (now - live.lastBeat) / 1000
    const stale = live.pausedAt != null ? delta > PAUSED_STALE_SEC : delta > STALE_SEC
    if (stale) {
      closeLive(doc, live.lastBeat)
      changed = true
    } else if (live.pausedAt == null) {
      const wouldFinish = delta <= GRACE_SEC && live.creditedSec + delta >= live.plannedSec - 0.5
      if (delta >= BEAT_WRITE_SEC || wouldFinish) {
        advance(live, now, partnerFocusing)
        changed = true
        if (isDone(live)) closeLive(doc, now)
      }
    }
  }
  const archived = rollToday(doc, now)
  return { archived, changed: changed || !!archived }
}
