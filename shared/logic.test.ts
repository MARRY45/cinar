import assert from 'node:assert/strict'
import { test } from 'node:test'
import { advance, closeLive, dayKey, elapsedAt, emptyTotals, GRACE_SEC, pointsFor, settle, STALE_SEC } from './logic.ts'
import type { Live, UserDoc } from './types.ts'

const T0 = Date.UTC(2026, 10, 2, 9, 0, 0)

function live(overrides: Partial<Live> = {}): Live {
  return {
    id: 'a',
    mode: 'focus',
    topic: 'Matematik',
    intent: '',
    plannedSec: 1500,
    startedAt: T0,
    lastBeat: T0,
    creditedSec: 0,
    togetherSec: 0,
    gapSec: 0,
    pausedAt: null,
    segs: [[T0, T0]],
    ...overrides,
  }
}

function doc(l: Live | null): UserDoc {
  return {
    id: 'u',
    live: l,
    music: null,
    lastSeen: T0,
    today: { date: dayKey(T0), sessions: [] },
    days: {},
    totals: emptyTotals(),
    topics: [],
    goals: [],
    tasks: [],
    challenge: null,
    birds: [],
    plans: [],
    outbox: [],
    responses: {},
    lastFinished: null,
    pushSubs: [],
  }
}

test('heartbeats credit real elapsed time', () => {
  const l = live()
  advance(l, T0 + 30_000, false)
  advance(l, T0 + 60_000, false)
  assert.equal(l.creditedSec, 60)
  assert.equal(l.togetherSec, 0)
})

test('a gap past the grace period earns nothing', () => {
  const l = live()
  advance(l, T0 + 30_000, false)
  advance(l, T0 + 30_000 + (GRACE_SEC + 1) * 1000, false)
  assert.equal(l.creditedSec, 30)
  assert.equal(l.gapSec, GRACE_SEC + 1)
  assert.equal(l.segs.length, 2)
})

test('together time accrues only while the partner is focusing', () => {
  const l = live()
  advance(l, T0 + 60_000, true)
  advance(l, T0 + 120_000, false)
  assert.equal(l.togetherSec, 60)
  assert.equal(l.creditedSec, 120)
})

test('paused time is never credited', () => {
  const l = live({ pausedAt: T0 })
  advance(l, T0 + 600_000, false)
  assert.equal(l.creditedSec, 0)
  assert.equal(elapsedAt(l, T0 + 900_000), 0)
})

test('credit is capped at the planned length', () => {
  const l = live({ plannedSec: 60, creditedSec: 50, lastBeat: T0 })
  advance(l, T0 + 100_000, false)
  assert.equal(l.creditedSec, 60)
})

test('points: one per minute, half extra together, bonus for completing', () => {
  assert.equal(pointsFor(1500, 0, true, 1500), 30)
  assert.equal(pointsFor(1500, 1500, true, 1500), 43)
  assert.equal(pointsFor(600, 0, false, 1500), 10)
  assert.equal(pointsFor(600, 0, true, 600), 10)
})

test('closing a session writes it once into today, days and totals', () => {
  const d = doc(live({ creditedSec: 1500, togetherSec: 600 }))
  const rec = closeLive(d, T0 + 1_500_000)!
  assert.equal(rec.complete, true)
  assert.equal(d.today.sessions.length, 1)
  assert.equal(d.days[dayKey(T0)].s, 1500)
  assert.equal(d.days[dayKey(T0)].t.Matematik, 1500)
  assert.equal(d.totals.pomodoros, 1)
  assert.equal(d.live, null)
})

test('session time is added to its task', () => {
  const d = doc(live({ creditedSec: 600, taskId: 't1' }))
  d.tasks.push({ id: 't1', title: 'Türev', done: false, sec: 60 })
  closeLive(d, T0 + 600_000)
  assert.equal(d.tasks[0].sec, 660)
})

test('reaching the daily challenge earns one bird and bonus points, once', () => {
  const d = doc(live({ creditedSec: 1800 }))
  d.challenge = { date: dayKey(T0), targetMin: 30 }
  closeLive(d, T0 + 1_800_000)
  assert.equal(d.birds.length, 1)
  assert.equal(d.challenge.won, d.birds[0])
  const pointsAfterFirst = d.totals.points
  d.live = live({ id: 'b', creditedSec: 120 })
  closeLive(d, T0 + 2_000_000)
  assert.equal(d.birds.length, 1)
  assert.equal(d.totals.points, pointsAfterFirst + 2)
})

test('a withered session earns half', () => {
  const d = doc(live({ plannedSec: 600, creditedSec: 600, withered: true }))
  assert.equal(closeLive(d, T0 + 600_000)!.points, 5)
})

test('a stopwatch session earns no completion bonus', () => {
  const d = doc(live({ plannedSec: 1800, creditedSec: 1800, stopwatch: true }))
  assert.equal(closeLive(d, T0 + 1_800_000)!.points, 30)
})

test('under a minute leaves no record', () => {
  const d = doc(live({ creditedSec: 59 }))
  assert.equal(closeLive(d, T0 + 59_000), null)
  assert.equal(d.totals.sessions, 0)
})

test('settle finishes a session when the planned time is reached', () => {
  const d = doc(live({ plannedSec: 100, creditedSec: 95, lastBeat: T0 }))
  const r = settle(d, T0 + 6_000, false)
  assert.equal(r.changed, true)
  assert.equal(d.live, null)
  assert.equal(d.totals.sessions, 1)
})

test('settle closes an abandoned session with only what it earned', () => {
  const d = doc(live({ creditedSec: 300, lastBeat: T0 }))
  settle(d, T0 + (STALE_SEC + 1) * 1000, false)
  assert.equal(d.live, null)
  assert.equal(d.totals.sec, 300)
})

test('a new day archives the previous sessions', () => {
  const d = doc(null)
  d.today.sessions.push({ id: 'x' } as never)
  const r = settle(d, T0 + 24 * 3600_000, false)
  assert.equal(r.archived?.sessions.length, 1)
  assert.equal(d.today.sessions.length, 0)
})

test('days roll over at Istanbul midnight', () => {
  assert.equal(dayKey(Date.UTC(2026, 10, 2, 20, 59)), '2026-11-02')
  assert.equal(dayKey(Date.UTC(2026, 10, 2, 21, 1)), '2026-11-03')
})
