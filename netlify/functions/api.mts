import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { getStore } from '@netlify/blobs'
import type { Config } from '@netlify/functions'
import webpush from 'web-push'
import {
  advance,
  closeLive,
  dayKey,
  elapsedAt,
  emptyTotals,
  isFocusing,
  isRunning,
  settle,
} from '../../shared/logic.ts'
import type {
  PresenceEntry,
  Account,
  DeskInvite,
  Exam,
  Goal,
  Ink,
  Ledger,
  Live,
  Member,
  Mode,
  Mood,
  PairMeta,
  PushSub,
  Signal,
  SignalResponse,
  Snapshot,
  UserDoc,
  UserView,
  Verdict,
} from '../../shared/types.ts'

const INKS: Ink[] = ['civit', 'visne', 'yosun', 'hardal', 'murdum']
const MOODS: Mood[] = ['dagnik', 'normal', 'akici']
const SEEN_WRITE_MS = 45_000
const SIGNAL_KEEP_MS = 24 * 3600_000

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

const store = () => getStore({ name: 'cinar', consistency: 'strong' })
const metaKey = (pairId: string) => `pair/${pairId}/meta`
const userKey = (pairId: string, userId: string) => `pair/${pairId}/user/${userId}`
const logKey = (pairId: string, userId: string, date: string) => `pair/${pairId}/log/${userId}/${date}`
const accountKey = (username: string) => `account/${username}`
const presenceKey = (username: string) => `presence/${username}`
const ONLINE_WINDOW_MS = 150_000
const STOPWATCH_CEILING_MIN = 8 * 60

const USERNAME_RE = /^[a-z0-9_.]{3,20}$/
const MIN_PASSWORD = 6
const MAX_FAILED_LOGINS = 6
const LOCK_MS = 10 * 60_000
const INVITE_KEEP_MS = 7 * 24 * 3600_000
const scryptAsync = promisify(scrypt) as (password: string, salt: string, length: number) => Promise<Buffer>

const newId = (bytes = 9) => randomBytes(bytes).toString('base64url')
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')
const clip = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

function intInRange(value: unknown, min: number, max: number, label: string): number {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${label} ${min} ile ${max} arasında olmalı.`)
  return n
}

const keyLocks = new Map<string, Promise<unknown>>()

/**
 * Compare-and-swap update. Returns the stored value after the write.
 * The per-key queue covers one instance; the local Blobs emulator returns no
 * ETag, so there this queue is the only protection against lost updates.
 */
function mutate<T>(key: string, fn: (current: T) => T | null): Promise<T> {
  const run = (keyLocks.get(key) ?? Promise.resolve()).then(
    () => casUpdate(key, fn),
    () => casUpdate(key, fn),
  )
  const tail = run.catch(() => undefined).finally(() => {
    if (keyLocks.get(key) === tail) keyLocks.delete(key)
  })
  keyLocks.set(key, tail)
  return run
}

async function casUpdate<T>(key: string, fn: (current: T) => T | null): Promise<T> {
  const blobs = store()
  for (let attempt = 0; attempt < 8; attempt++) {
    const found = await blobs.getWithMetadata(key, { type: 'json' })
    if (!found) throw new HttpError(404, 'Kayıt bulunamadı.')
    if (!found.etag && process.env.NETLIFY_DEV !== 'true') console.error('blob read returned no etag', key)
    const next = fn(found.data as T)
    if (next === null) return found.data as T
    const result = await blobs.setJSON(key, next, { onlyIfMatch: found.etag })
    if (result.modified) return next
    await new Promise((resolve) => setTimeout(resolve, 40 + Math.random() * 120 * (attempt + 1)))
  }
  throw new HttpError(409, 'Kayıt şu an meşgul, tekrar dene.')
}

function newUserDoc(id: string, now: number): UserDoc {
  return {
    id,
    live: null,
    music: null,
    lastSeen: now,
    today: { date: dayKey(now), sessions: [] },
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

function toView(doc: UserDoc, now: number): UserView {
  const { days: _days, pushSubs, ...rest } = doc
  const today = doc.today.date === dayKey(now) ? doc.today : { date: dayKey(now), sessions: [] }
  return { ...rest, today, pushCount: pushSubs.length }
}

async function issueToken(username: string): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await store().setJSON(`token/${hashToken(token)}`, { username })
  return token
}

interface Auth {
  pairId: string
  userId: string
  tokenHash: string
  account: Account
}

async function authenticate(req: Request): Promise<Auth> {
  const header = req.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) throw new HttpError(401, 'Giriş gerekli.')
  const tokenHash = hashToken(token)
  const found = (await store().get(`token/${tokenHash}`, { type: 'json' })) as { username?: string } | null
  const account = found?.username ? ((await store().get(accountKey(found.username), { type: 'json' })) as Account | null) : null
  if (!account) throw new HttpError(401, 'Bu cihazın girişi geçerli değil.')
  return { pairId: account.pairId, userId: account.userId, tokenHash, account }
}

async function readContext(auth: Auth) {
  const blobs = store()
  const meta = (await blobs.get(metaKey(auth.pairId), { type: 'json' })) as PairMeta | null
  if (!meta) throw new HttpError(404, 'Çift bulunamadı.')
  const partnerId = meta.members.find((m) => m.id !== auth.userId)?.id ?? null
  const partner = partnerId
    ? ((await blobs.get(userKey(auth.pairId, partnerId), { type: 'json' })) as UserDoc | null)
    : null
  return { meta, partnerId, partner }
}

function sendPush(partner: UserDoc | null, pairId: string, payload: { title: string; body: string; tag: string }) {
  const publicKey = process.env.VAPID_PUBLIC
  const privateKey = process.env.VAPID_PRIVATE
  if (!partner || !publicKey || !privateKey || partner.pushSubs.length === 0) return Promise.resolve()
  webpush.setVapidDetails('mailto:noreply@cinar.app', publicKey, privateKey)
  return Promise.all(
    partner.pushSubs.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 600, urgency: 'high' })
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) {
          await mutate<UserDoc>(userKey(pairId, partner.id), (doc) => {
            doc.pushSubs = doc.pushSubs.filter((s) => s.endpoint !== sub.endpoint)
            return doc
          })
        } else {
          console.error('push failed', status)
        }
      }
    }),
  ).then(() => undefined)
}

function newLive(now: number, mode: Mode, minutes: number, topic: string, intent: string): Live {
  return {
    id: newId(),
    mode,
    topic,
    intent,
    plannedSec: minutes * 60,
    startedAt: now,
    lastBeat: now,
    creditedSec: 0,
    togetherSec: 0,
    gapSec: 0,
    pausedAt: null,
    segs: [[now, now]],
  }
}

function rememberTopic(doc: UserDoc, topic: string) {
  if (!topic) return
  doc.topics = [topic, ...doc.topics.filter((t) => t.toLocaleLowerCase('tr') !== topic.toLocaleLowerCase('tr'))].slice(0, 12)
}

function readGoal(body: Record<string, unknown>, now: number): Goal {
  const period = body.period as Goal['period']
  if (!['day', 'week', 'month', 'until'].includes(period)) throw new HttpError(400, 'Hedef dönemi geçersiz.')
  const until = clip(body.until, 10)
  if (period === 'until' && !/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new HttpError(400, 'Hedef için bir bitiş tarihi seç.')
  const title = clip(body.title, 60)
  if (!title) throw new HttpError(400, 'Hedefe bir ad ver.')
  return {
    id: newId(),
    title,
    period,
    targetMin: intInRange(body.targetMin, 5, 100000, 'Hedef süresi'),
    metric: body.metric === 'together' ? 'together' : 'total',
    topic: clip(body.topic, 40) || undefined,
    until: period === 'until' ? until : undefined,
    createdAt: now,
  }
}

/** Runs the time-based transitions for the caller and archives finished days. */
async function syncDoc(auth: Auth, partner: UserDoc | null, change?: (doc: UserDoc, now: number) => void): Promise<UserDoc> {
  let archived: { date: string; sessions: UserDoc['today']['sessions'] } | null = null
  const doc = await mutate<UserDoc>(userKey(auth.pairId, auth.userId), (current) => {
    const now = Date.now()
    const partnerFocusing = isFocusing(partner?.live, now)
    const result = settle(current, now, partnerFocusing)
    if (result.archived) archived = result.archived
    let dirty = result.changed
    if (change) {
      change(current, now)
      dirty = true
    }
    if (now - current.lastSeen > SEEN_WRITE_MS) {
      current.lastSeen = now
      dirty = true
    }
    return dirty ? current : null
  })
  if (archived) {
    const { date, sessions } = archived as { date: string; sessions: UserDoc['today']['sessions'] }
    await store().setJSON(logKey(auth.pairId, auth.userId, date), sessions)
  }
  return doc
}

function snapshot(auth: Auth, meta: PairMeta, me: UserDoc, partner: UserDoc | null): Snapshot {
  const now = Date.now()
  return {
    now,
    meId: auth.userId,
    username: auth.account.username,
    invitesIn: auth.account.invitesIn.filter((i) => now - i.at < INVITE_KEEP_MS),
    invitesOut: auth.account.invitesOut.filter((i) => now - i.at < INVITE_KEEP_MS),
    pair: meta,
    me: toView(me, now),
    partner: partner ? toView(partner, now) : null,
    vapid: process.env.VAPID_PUBLIC ?? null,
  }
}

/** Public status only: who is around and whether they are studying, never what. */
async function writePresence(auth: Auth, meta: PairMeta, me: UserDoc) {
  const blobs = store()
  if (me.hidden) {
    await blobs.delete(presenceKey(auth.account.username))
    return
  }
  const member = meta.members.find((m) => m.id === auth.userId)
  if (!member) return
  const entry: PresenceEntry = {
    username: auth.account.username,
    name: member.name,
    ink: member.ink,
    status: !me.live ? 'idle' : me.live.mode === 'break' ? 'break' : 'focus',
    available: meta.members.length < 2,
    at: Date.now(),
  }
  await blobs.setJSON(presenceKey(auth.account.username), entry)
}

async function listOnline(): Promise<PresenceEntry[]> {
  const blobs = store()
  const { blobs: rows } = await blobs.list({ prefix: 'presence/' })
  const now = Date.now()
  const entries = await Promise.all(rows.slice(0, 200).map((row) => blobs.get(row.key, { type: 'json' }) as Promise<PresenceEntry | null>))
  const online: PresenceEntry[] = []
  await Promise.all(
    entries.map(async (entry, i) => {
      if (entry && now - entry.at < ONLINE_WINDOW_MS) online.push(entry)
      else await blobs.delete(rows[i].key)
    }),
  )
  return online.sort((a, b) => a.name.localeCompare(b.name, 'tr'))
}

async function readAccount(username: string): Promise<Account | null> {
  return (await store().get(accountKey(username), { type: 'json' })) as Account | null
}

const dropInvites = (list: DeskInvite[], test: (invite: DeskInvite) => boolean) => list.filter((invite) => !test(invite))

/** Moves one person's document and day logs to another pair. */
async function moveUser(fromPair: string, toPair: string, userId: string, doc: UserDoc) {
  const blobs = store()
  await blobs.setJSON(userKey(toPair, userId), doc)
  const { blobs: logs } = await blobs.list({ prefix: `pair/${fromPair}/log/${userId}/` })
  for (const log of logs) {
    const date = log.key.split('/').pop()!
    const sessions = await blobs.get(log.key, { type: 'json' })
    await blobs.setJSON(logKey(toPair, userId, date), sessions)
    await blobs.delete(log.key)
  }
  await blobs.delete(userKey(fromPair, userId))
}

async function sendInvite(auth: Auth, meta: PairMeta, rawUsername: unknown) {
  const to = clip(rawUsername, 30).replace(/^@/, '').toLowerCase()
  if (meta.members.length >= 2) throw new HttpError(409, 'Masan dolu. Önce masadan ayrılman gerekir.')
  if (to === auth.account.username) throw new HttpError(400, 'Kendini davet edemezsin.')
  const target = USERNAME_RE.test(to) ? await readAccount(to) : null
  if (!target) throw new HttpError(404, 'Bu kullanıcı adıyla bir profil yok.')
  if (auth.account.invitesOut.some((i) => i.to === to)) throw new HttpError(409, 'Bu kişiye zaten davet gönderdin.')
  const targetMeta = (await store().get(metaKey(target.pairId), { type: 'json' })) as PairMeta
  if (targetMeta.members.length >= 2) throw new HttpError(409, `@${to} başka bir masada oturuyor.`)
  const me = meta.members.find((m) => m.id === auth.userId)!
  const toName = targetMeta.members.find((m) => m.id === target.userId)!.name
  const invite: DeskInvite = { id: newId(), from: auth.account.username, fromName: me.name, to, toName, at: Date.now() }
  await mutate<Account>(accountKey(to), (account) => {
    account.invitesIn = [invite, ...account.invitesIn].slice(0, 20)
    return account
  })
  auth.account = await mutate<Account>(accountKey(auth.account.username), (account) => {
    account.invitesOut = [invite, ...account.invitesOut].slice(0, 20)
    return account
  })
  const targetDoc = (await store().get(userKey(target.pairId, target.userId), { type: 'json' })) as UserDoc | null
  await sendPush(targetDoc, target.pairId, { title: 'Çınar', body: `${me.name} seni çalışma masasına davet ediyor.`, tag: invite.id })
}

/** Withdraws everything else either person had pending once they sit down together. */
async function clearPendingInvites(account: Account) {
  for (const invite of account.invitesIn) {
    await mutate<Account>(accountKey(invite.from), (other) => {
      other.invitesOut = dropInvites(other.invitesOut, (i) => i.id === invite.id)
      return other
    })
  }
  for (const invite of account.invitesOut) {
    await mutate<Account>(accountKey(invite.to), (other) => {
      other.invitesIn = dropInvites(other.invitesIn, (i) => i.id === invite.id)
      return other
    })
  }
  return mutate<Account>(accountKey(account.username), (current) => {
    current.invitesIn = []
    current.invitesOut = []
    return current
  })
}

/** The accepter's document moves to the inviter's pair, so the inviter's tree seed is kept. */
async function acceptInvite(auth: Auth, meta: PairMeta, inviteId: string) {
  const invite = auth.account.invitesIn.find((i) => i.id === inviteId)
  if (!invite) throw new HttpError(404, 'Bu davet artık geçerli değil.')
  if (meta.members.length >= 2) throw new HttpError(409, 'Masan dolu. Önce masadan ayrılman gerekir.')
  const inviter = await readAccount(invite.from)
  if (!inviter) throw new HttpError(404, 'Bu davet artık geçerli değil.')
  const blobs = store()
  const myDoc = (await blobs.get(userKey(auth.pairId, auth.userId), { type: 'json' })) as UserDoc
  const me = meta.members.find((m) => m.id === auth.userId)!

  await mutate<PairMeta>(metaKey(inviter.pairId), (target) => {
    if (target.members.length >= 2) throw new HttpError(409, `@${invite.from} başka biriyle masaya oturmuş.`)
    const taken = target.members[0]?.ink
    const ink = me.ink === taken ? INKS.find((i) => i !== taken)! : me.ink
    target.members.push({ ...me, ink })
    target.goals = [...target.goals, ...meta.goals].slice(-20)
    target.exams = [...target.exams, ...meta.exams].sort((a, b) => a.date.localeCompare(b.date)).slice(-12)
    return target
  })
  const oldPair = auth.pairId
  await moveUser(oldPair, inviter.pairId, auth.userId, myDoc)
  await mutate<Account>(accountKey(auth.account.username), (account) => {
    account.pairId = inviter.pairId
    return account
  })
  await blobs.delete(metaKey(oldPair))
  await clearPendingInvites(inviter)
  auth.account = await clearPendingInvites((await readAccount(auth.account.username))!)
  auth.pairId = inviter.pairId
}

async function leavePair(auth: Auth, meta: PairMeta) {
  if (meta.members.length < 2) throw new HttpError(409, 'Masada zaten yalnızsın.')
  const blobs = store()
  const me = meta.members.find((m) => m.id === auth.userId)!
  const doc = (await blobs.get(userKey(auth.pairId, auth.userId), { type: 'json' })) as UserDoc
  const newPairId = newId()
  const fresh: PairMeta = { id: newPairId, createdAt: Date.now(), seed: randomBytes(4).readUInt32BE(0), members: [me], goals: [], exams: [] }
  await blobs.setJSON(metaKey(newPairId), fresh)
  await moveUser(auth.pairId, newPairId, auth.userId, { ...doc, outbox: [], responses: {} })
  await mutate<PairMeta>(metaKey(auth.pairId), (old) => {
    old.members = old.members.filter((m) => m.id !== auth.userId)
    return old
  })
  auth.account = await mutate<Account>(accountKey(auth.account.username), (account) => {
    account.pairId = newPairId
    return account
  })
  auth.pairId = newPairId
}

async function handleDeskAction(auth: Auth, type: string, body: Record<string, unknown>, meta: PairMeta) {
  const id = clip(body.id, 40)
  if (type === 'invite.send') await sendInvite(auth, meta, body.username)
  else if (type === 'invite.accept') await acceptInvite(auth, meta, id)
  else if (type === 'pair.leave') await leavePair(auth, meta)
  else if (type === 'invite.decline') {
    const invite = auth.account.invitesIn.find((i) => i.id === id)
    if (invite) {
      await mutate<Account>(accountKey(invite.from), (other) => {
        other.invitesOut = dropInvites(other.invitesOut, (i) => i.id === id)
        return other
      })
    }
    auth.account = await mutate<Account>(accountKey(auth.account.username), (account) => {
      account.invitesIn = dropInvites(account.invitesIn, (i) => i.id === id)
      return account
    })
  } else {
    const invite = auth.account.invitesOut.find((i) => i.id === id)
    if (invite) {
      await mutate<Account>(accountKey(invite.to), (other) => {
        other.invitesIn = dropInvites(other.invitesIn, (i) => i.id === id)
        return other
      })
    }
    auth.account = await mutate<Account>(accountKey(auth.account.username), (account) => {
      account.invitesOut = dropInvites(account.invitesOut, (i) => i.id === id)
      return account
    })
  }
}

async function handleAction(auth: Auth, body: Record<string, unknown>): Promise<Snapshot> {
  const type = String(body.type ?? '')
  if (['invite.send', 'invite.accept', 'invite.decline', 'invite.cancel', 'pair.leave'].includes(type)) {
    const context = await readContext(auth)
    await handleDeskAction(auth, type, body, context.meta)
    const { meta, partner } = await readContext(auth)
    const me = await syncDoc(auth, partner)
    await writePresence(auth, meta, me)
    return snapshot(auth, meta, me, partner)
  }
  let { meta, partner } = await readContext(auth)
  const myMember = meta.members.find((m) => m.id === auth.userId)!
  let change: ((doc: UserDoc, now: number) => void) | undefined
  let after: (() => Promise<void>) | undefined

  switch (type) {
    case 'start': {
      const mode: Mode = body.mode === 'break' ? 'break' : 'focus'
      const stopwatch = mode === 'focus' && body.stopwatch === true
      const minutes = stopwatch ? STOPWATCH_CEILING_MIN : intInRange(body.minutes, 1, mode === 'focus' ? 180 : 60, 'Süre')
      const topic = clip(body.topic, 40)
      const intent = clip(body.intent, 80)
      const taskId = clip(body.taskId, 40)
      change = (doc, now) => {
        if (doc.live?.mode === 'focus') throw new HttpError(409, 'Zaten devam eden bir oturumun var.')
        doc.live = newLive(now, mode, minutes, topic, intent)
        if (stopwatch) doc.live.stopwatch = true
        if (mode === 'focus' && doc.tasks.some((t) => t.id === taskId)) doc.live.taskId = taskId
        if (mode === 'focus') rememberTopic(doc, topic)
      }
      break
    }
    case 'pause':
      change = (doc, now) => {
        if (!doc.live || doc.live.pausedAt != null) return
        advance(doc.live, now, isFocusing(partner?.live, now))
        doc.live.pausedAt = now
      }
      break
    case 'resume':
      change = (doc, now) => {
        if (!doc.live || doc.live.pausedAt == null) return
        doc.live.pausedAt = null
        doc.live.lastBeat = now
        doc.live.segs.push([now, now])
      }
      break
    case 'stop':
      change = (doc, now) => {
        if (!doc.live) return
        if (doc.live.pausedAt == null) advance(doc.live, now, isFocusing(partner?.live, now))
        closeLive(doc, now)
      }
      break
    case 'rate': {
      const mood = body.mood as Mood | undefined
      if (mood && !MOODS.includes(mood)) throw new HttpError(400, 'Geçersiz değerlendirme.')
      const note = clip(body.note, 240)
      change = (doc) => {
        const apply = (rec: UserDoc['lastFinished']) => {
          if (!rec || rec.id !== body.sessionId) return
          if (mood) rec.mood = mood
          if (note) rec.note = note
        }
        doc.today.sessions.forEach(apply)
        apply(doc.lastFinished)
      }
      break
    }
    case 'signal': {
      if (!partner) throw new HttpError(409, 'Önce çalışma arkadaşını davet et.')
      const kind = body.kind === 'call' ? 'call' : 'nudge'
      const signal: Signal = { id: newId(), kind, at: Date.now() }
      if (kind === 'call') {
        signal.minutes = intInRange(body.minutes ?? 25, 1, 180, 'Süre')
        signal.topic = clip(body.topic, 40)
      } else {
        signal.text = clip(body.text, 60)
        if (!signal.text) throw new HttpError(400, 'Boş mesaj gönderilemez.')
      }
      change = (doc, now) => {
        doc.outbox = [signal, ...doc.outbox.filter((s) => now - s.at < SIGNAL_KEEP_MS)].slice(0, 10)
      }
      after = () =>
        sendPush(partner, auth.pairId, {
          title: kind === 'call' ? `${myMember.name} seni derse çağırıyor` : myMember.name,
          body:
            kind === 'call'
              ? `${signal.minutes} dakika${signal.topic ? `, ${signal.topic}` : ''}. Gel birlikte çalışalım.`
              : signal.text!,
          tag: signal.id,
        })
      break
    }
    case 'respond': {
      if (!partner) throw new HttpError(409, 'Çalışma arkadaşın henüz katılmadı.')
      const resp = body.resp as SignalResponse
      if (!['accept', 'later', 'no'].includes(resp)) throw new HttpError(400, 'Geçersiz yanıt.')
      const signalId = clip(body.signalId, 40)
      const signal = partner.outbox.find((s) => s.id === signalId)
      if (!signal) throw new HttpError(404, 'Bu çağrı artık geçerli değil.')
      const callerId = partner.id
      const callerLive = partner.live
      const topic = clip(body.topic, 40) || signal.topic || ''
      const plannedMinutes = signal.minutes ?? 25

      change = (doc, now) => {
        doc.responses[signalId] = { resp, at: now }
        for (const [id, value] of Object.entries(doc.responses)) {
          if (now - value.at > SIGNAL_KEEP_MS) delete doc.responses[id]
        }
        if (resp !== 'accept' || signal.kind !== 'call' || doc.live?.mode === 'focus') return
        // Joining a running session: both clocks finish at the same moment.
        const remaining =
          callerLive && callerLive.mode === 'focus' && isRunning(callerLive, now)
            ? callerLive.plannedSec - elapsedAt(callerLive, now)
            : 0
        doc.live = newLive(now, 'focus', plannedMinutes, topic, '')
        if (remaining >= 300) doc.live.plannedSec = Math.round(remaining)
        rememberTopic(doc, topic)
      }
      after = async () => {
        if (resp === 'accept' && signal.kind === 'call') {
          await mutate<UserDoc>(userKey(auth.pairId, callerId), (doc) => {
            const now = Date.now()
            if (doc.live?.mode === 'focus' && isRunning(doc.live, now)) return null
            closeLive(doc, now)
            doc.live = newLive(now, 'focus', plannedMinutes, signal.topic ?? '', '')
            rememberTopic(doc, signal.topic ?? '')
            return doc
          })
          partner = await store().get(userKey(auth.pairId, callerId), { type: 'json' })
        }
        if (signal.kind === 'call') {
          const words = { accept: 'geliyor. Oturum başladı.', later: 'birazdan geliyor.', no: 'şu an gelemiyor.' }
          await sendPush(partner, auth.pairId, { title: 'Çınar', body: `${myMember.name} ${words[resp]}`, tag: `${signalId}-r` })
        }
      }
      break
    }
    case 'verdict': {
      if (!partner) throw new HttpError(409, 'Çalışma arkadaşın yok.')
      const value = body.value as Verdict
      if (!['yes', 'partly', 'no'].includes(value)) throw new HttpError(400, 'Geçersiz yanıt.')
      partner = await mutate<UserDoc>(userKey(auth.pairId, partner.id), (doc) => {
        for (const rec of [...doc.today.sessions, doc.lastFinished]) {
          if (rec && rec.id === body.sessionId) rec.verdict = value
        }
        return doc
      })
      break
    }
    case 'wither':
      change = (doc, now) => {
        if (doc.live?.mode !== 'focus' || doc.live.withered) return
        doc.live.withered = true
        const signal: Signal = { id: newId(), kind: 'nudge', at: now, text: 'Odağını bıraktı, ağaç soldu.' }
        doc.outbox = [signal, ...doc.outbox].slice(0, 10)
      }
      break
    case 'plan.add': {
      const title = clip(body.title, 60)
      const date = clip(body.date, 10)
      if (!title) throw new HttpError(400, 'Plana bir ad ver.')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < dayKey(Date.now())) throw new HttpError(400, 'Geçmiş bir güne plan eklenemez.')
      const minutes = intInRange(body.minutes, 5, 960, 'Süre')
      change = (doc, now) => {
        const cutoff = dayKey(now - 60 * 86400_000)
        doc.plans = [...doc.plans.filter((p) => p.date >= cutoff), { id: newId(), date, title, minutes, done: false }].slice(-120)
      }
      break
    }
    case 'plan.move': {
      const date = clip(body.date, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < dayKey(Date.now())) throw new HttpError(400, 'Geçmiş bir güne taşınamaz.')
      change = (doc) => {
        const item = doc.plans.find((p) => p.id === body.id)
        if (item) item.date = date
      }
      break
    }
    case 'plan.toggle':
      change = (doc) => {
        const item = doc.plans.find((p) => p.id === body.id)
        if (item) item.done = !item.done
      }
      break
    case 'plan.remove':
      change = (doc) => {
        doc.plans = doc.plans.filter((p) => p.id !== body.id)
      }
      break
    case 'presence.hide':
      change = (doc) => {
        doc.hidden = body.hidden === true
      }
      break
    case 'task.add': {
      const title = clip(body.title, 80)
      if (!title) throw new HttpError(400, 'Göreve bir ad ver.')
      change = (doc) => {
        const est = body.est === undefined || body.est === '' ? undefined : intInRange(body.est, 1, 40, 'Tahmin')
        doc.tasks = [...doc.tasks, { id: newId(), title, done: false, sec: 0, est }].slice(-40)
      }
      break
    }
    case 'task.toggle':
      change = (doc) => {
        const task = doc.tasks.find((t) => t.id === body.id)
        if (task) task.done = !task.done
      }
      break
    case 'task.remove':
      change = (doc) => {
        doc.tasks = doc.tasks.filter((t) => t.id !== body.id)
      }
      break
    case 'challenge.set': {
      const targetMin = intInRange(body.minutes, 15, 960, 'Hedef')
      change = (doc, now) => {
        const date = dayKey(now)
        if (doc.challenge?.date === date && doc.challenge.won) throw new HttpError(409, 'Bugünün hedefini zaten tamamladın.')
        doc.challenge = { date, targetMin }
      }
      break
    }
    case 'goal.add': {
      const goal = readGoal(body, Date.now())
      if (body.scope === 'group') {
        meta = await mutate<PairMeta>(metaKey(auth.pairId), (m) => {
          m.goals = [...m.goals, goal].slice(-20)
          return m
        })
      } else {
        change = (doc) => {
          doc.goals = [...doc.goals, goal].slice(-20)
        }
      }
      break
    }
    case 'goal.remove': {
      const id = clip(body.id, 40)
      if (meta.goals.some((g) => g.id === id)) {
        meta = await mutate<PairMeta>(metaKey(auth.pairId), (m) => {
          m.goals = m.goals.filter((g) => g.id !== id)
          return m
        })
      } else {
        change = (doc) => {
          doc.goals = doc.goals.filter((g) => g.id !== id)
        }
      }
      break
    }
    case 'exam.add': {
      const date = clip(body.date, 10)
      const title = clip(body.title, 50)
      if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'Sınav adı ve tarihi gerekli.')
      if (date < dayKey(Date.now())) throw new HttpError(400, 'Geçmiş bir tarih seçilemez.')
      const exam: Exam = { id: newId(), title, date }
      meta = await mutate<PairMeta>(metaKey(auth.pairId), (m) => {
        m.exams = [...m.exams, exam].sort((a, b) => a.date.localeCompare(b.date)).slice(-12)
        return m
      })
      break
    }
    case 'exam.remove': {
      const id = clip(body.id, 40)
      meta = await mutate<PairMeta>(metaKey(auth.pairId), (m) => {
        m.exams = m.exams.filter((e) => e.id !== id)
        return m
      })
      break
    }
    case 'profile': {
      const name = clip(body.name, 24)
      const ink = body.ink as Ink
      const goal = body.dailyGoalMin === undefined ? undefined : intInRange(body.dailyGoalMin, 10, 960, 'Günlük hedef')
      if (ink !== undefined && !INKS.includes(ink)) throw new HttpError(400, 'Geçersiz renk.')
      meta = await mutate<PairMeta>(metaKey(auth.pairId), (m) => {
        const member = m.members.find((x) => x.id === auth.userId)!
        if (name) member.name = name
        if (ink) member.ink = ink
        if (goal !== undefined) member.dailyGoalMin = goal
        return m
      })
      break
    }
    case 'music': {
      const id = clip(body.id, 30)
      change = (doc) => {
        doc.music = id ? { kind: 'radio', id } : null
      }
      break
    }
    case 'push.subscribe': {
      const sub = body.subscription as PushSub | undefined
      if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) throw new HttpError(400, 'Bildirim aboneliği geçersiz.')
      change = (doc) => {
        const clean: PushSub = { endpoint: String(sub.endpoint), keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) } }
        doc.pushSubs = [clean, ...doc.pushSubs.filter((s) => s.endpoint !== clean.endpoint)].slice(0, 6)
      }
      break
    }
    case 'push.unsubscribe': {
      const endpoint = clip(body.endpoint, 2000)
      change = (doc) => {
        doc.pushSubs = doc.pushSubs.filter((s) => s.endpoint !== endpoint)
      }
      break
    }
    default:
      throw new HttpError(400, 'Bilinmeyen işlem.')
  }

  const me = await syncDoc(auth, partner, change)
  await writePresence(auth, meta, me)
  if (after) await after()
  return snapshot(auth, meta, me, partner)
}

async function hashPassword(password: string, salt: string) {
  return (await scryptAsync(password, salt, 64)).toString('hex')
}

async function register(body: Record<string, unknown>) {
  const username = clip(body.username, 30).toLowerCase()
  const name = clip(body.name, 24)
  const password = typeof body.password === 'string' ? body.password : ''
  if (!name) throw new HttpError(400, 'Adını yaz.')
  if (!USERNAME_RE.test(username)) throw new HttpError(400, 'Kullanıcı adı 3-20 karakter olmalı: küçük harf, rakam, nokta ya da alt çizgi.')
  if (password.length < MIN_PASSWORD) throw new HttpError(400, `Şifre en az ${MIN_PASSWORD} karakter olmalı.`)
  const ink: Ink = INKS.includes(body.ink as Ink) ? (body.ink as Ink) : 'civit'
  const now = Date.now()
  const pairId = newId()
  const userId = newId(6)
  const passSalt = randomBytes(16).toString('hex')
  const account: Account = {
    username,
    userId,
    pairId,
    passSalt,
    passHash: await hashPassword(password, passSalt),
    failedLogins: 0,
    lockedUntil: 0,
    invitesIn: [],
    invitesOut: [],
  }
  const blobs = store()
  const claimed = await blobs.setJSON(accountKey(username), account, { onlyIfNew: true })
  if (!claimed.modified) throw new HttpError(409, 'Bu kullanıcı adı alınmış.')
  const member: Member = { id: userId, name, ink, dailyGoalMin: 120, joinedAt: now }
  const meta: PairMeta = { id: pairId, createdAt: now, seed: randomBytes(4).readUInt32BE(0), members: [member], goals: [], exams: [] }
  await blobs.setJSON(metaKey(pairId), meta)
  await blobs.setJSON(userKey(pairId, userId), newUserDoc(userId, now))
  return { token: await issueToken(username) }
}

async function login(body: Record<string, unknown>) {
  const username = clip(body.username, 30).replace(/^@/, '').toLowerCase()
  const password = typeof body.password === 'string' ? body.password : ''
  const wrong = new HttpError(401, 'Kullanıcı adı ya da şifre yanlış.')
  const account = USERNAME_RE.test(username) ? await readAccount(username) : null
  if (!account) throw wrong
  if (account.lockedUntil > Date.now()) throw new HttpError(429, 'Çok fazla yanlış deneme. Birkaç dakika sonra tekrar dene.')
  const given = Buffer.from(await hashPassword(password, account.passSalt), 'hex')
  const ok = timingSafeEqual(given, Buffer.from(account.passHash, 'hex'))
  await mutate<Account>(accountKey(username), (current) => {
    if (ok && current.failedLogins === 0) return null
    current.failedLogins = ok ? 0 : current.failedLogins + 1
    if (current.failedLogins >= MAX_FAILED_LOGINS) {
      current.lockedUntil = Date.now() + LOCK_MS
      current.failedLogins = 0
    }
    return current
  })
  if (!ok) throw wrong
  return { token: await issueToken(username) }
}

export default async (req: Request) => {
  try {
    const path = new URL(req.url).pathname.replace(/^\/api/, '')
    const body =
      req.method === 'POST' ? ((await req.json().catch(() => ({}))) as Record<string, unknown>) : {}

    if (path === '/register' && req.method === 'POST') return json(await register(body))
    if (path === '/login' && req.method === 'POST') return json(await login(body))

    const auth = await authenticate(req)

    if (path === '/sync' && req.method === 'POST') {
      const { meta, partner } = await readContext(auth)
      const seenBefore = Date.now()
      const me = await syncDoc(auth, partner)
      if (me.lastSeen >= seenBefore) await writePresence(auth, meta, me)
      return json(snapshot(auth, meta, me, partner))
    }
    if (path === '/action' && req.method === 'POST') return json(await handleAction(auth, body))
    if (path === '/ledger' && req.method === 'GET') {
      const { meta } = await readContext(auth)
      const days: Ledger['days'] = {}
      await Promise.all(
        meta.members.map(async (m) => {
          const doc = (await store().get(userKey(auth.pairId, m.id), { type: 'json' })) as UserDoc | null
          days[m.id] = doc?.days ?? {}
        }),
      )
      return json({ days } satisfies Ledger)
    }
    if (path === '/day' && req.method === 'GET') {
      const date = new URL(req.url).searchParams.get('date') ?? ''
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'Geçersiz tarih.')
      const { meta } = await readContext(auth)
      const sessions: Record<string, unknown[]> = {}
      await Promise.all(
        meta.members.map(async (m) => {
          const doc = (await store().get(userKey(auth.pairId, m.id), { type: 'json' })) as UserDoc | null
          if (doc?.today.date === date) sessions[m.id] = doc.today.sessions
          else sessions[m.id] = ((await store().get(logKey(auth.pairId, m.id, date), { type: 'json' })) as unknown[]) ?? []
        }),
      )
      return json({ sessions })
    }
    if (path.startsWith('/user/') && req.method === 'GET') {
      const username = decodeURIComponent(path.slice('/user/'.length)).replace(/^@/, '').toLowerCase()
      const account = USERNAME_RE.test(username) ? await readAccount(username) : null
      const meta = account ? ((await store().get(metaKey(account.pairId), { type: 'json' })) as PairMeta | null) : null
      if (!account || !meta) throw new HttpError(404, 'Bu kullanıcı adıyla bir profil yok.')
      const member = meta.members.find((m) => m.id === account.userId)!
      return json({ username, name: member.name, ink: member.ink, available: meta.members.length < 2 })
    }
    if (path === '/online' && req.method === 'GET') return json({ online: await listOnline() })
    if (path === '/device-link' && req.method === 'POST') return json({ token: await issueToken(auth.account.username) })
    if (path === '/logout' && req.method === 'POST') {
      await store().delete(`token/${auth.tokenHash}`)
      return json({ ok: true })
    }
    throw new HttpError(404, 'Bulunamadı.')
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status)
    console.error(err)
    return json({ error: 'Sunucuda bir sorun oluştu.' }, 500)
  }
}

export const config: Config = { path: '/api/*' }
