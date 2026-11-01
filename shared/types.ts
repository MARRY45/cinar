export type Ink = 'civit' | 'visne' | 'yosun' | 'hardal' | 'murdum'
export type Mode = 'focus' | 'break'
export type Mood = 'dagnik' | 'normal' | 'akici'

export interface Live {
  id: string
  mode: Mode
  topic: string
  intent: string
  plannedSec: number
  startedAt: number
  /** Server time of the last heartbeat. Only the server ever sets this. */
  lastBeat: number
  creditedSec: number
  togetherSec: number
  gapSec: number
  pausedAt: number | null
  segs: [number, number][]
  taskId?: string
  /** Counts up with no target; plannedSec is only a safety ceiling. */
  stopwatch?: boolean
  /** Strict mode: the owner left the app mid-session, so this session earns half. */
  withered?: boolean
}

export interface SessionRec {
  id: string
  topic: string
  intent: string
  startedAt: number
  endedAt: number
  sec: number
  togetherSec: number
  gapSec: number
  points: number
  complete: boolean
  plannedSec: number
  segs: [number, number][]
  mood?: Mood
  note?: string
  /** The partner's answer to "did they do what they said?". */
  verdict?: Verdict
  withered?: boolean
}

export type Verdict = 'yes' | 'partly' | 'no'

export interface PlanItem {
  id: string
  date: string
  title: string
  minutes: number
  done: boolean
}

/** One user's aggregate for one Istanbul calendar day. */
export interface DayStat {
  s: number
  g: number
  p: number
  n: number
  t: Record<string, number>
}

export interface Totals {
  sec: number
  togetherSec: number
  points: number
  pomodoros: number
  sessions: number
}

export interface Signal {
  id: string
  kind: 'call' | 'nudge'
  at: number
  text?: string
  minutes?: number
  topic?: string
}

export type SignalResponse = 'accept' | 'later' | 'no'

export interface Goal {
  id: string
  title: string
  period: 'day' | 'week' | 'month' | 'until'
  targetMin: number
  metric: 'total' | 'together'
  topic?: string
  until?: string
  createdAt: number
}

export interface Exam {
  id: string
  title: string
  date: string
}

export interface MusicState {
  kind: 'radio'
  id: string
}

export interface PushSub {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export interface Task {
  id: string
  title: string
  done: boolean
  sec: number
  est?: number
}

/** The day's focus commitment. Finishing it earns a bird for the tree. */
export interface Challenge {
  date: string
  targetMin: number
  won?: string
}

export interface UserDoc {
  id: string
  live: Live | null
  music: MusicState | null
  lastSeen: number
  today: { date: string; sessions: SessionRec[] }
  days: Record<string, DayStat>
  totals: Totals
  topics: string[]
  goals: Goal[]
  tasks: Task[]
  challenge: Challenge | null
  birds: string[]
  plans: PlanItem[]
  hidden?: boolean
  outbox: Signal[]
  responses: Record<string, { resp: SignalResponse; at: number }>
  lastFinished: SessionRec | null
  pushSubs: PushSub[]
}

export interface Member {
  id: string
  name: string
  ink: Ink
  dailyGoalMin: number
  joinedAt: number
}

export interface PairMeta {
  id: string
  createdAt: number
  seed: number
  members: Member[]
  goals: Goal[]
  exams: Exam[]
}

export type UserView = Omit<UserDoc, 'days' | 'pushSubs'> & { pushCount: number }

export interface DeskInvite {
  id: string
  from: string
  fromName: string
  to: string
  toName: string
  at: number
}

export interface Account {
  username: string
  userId: string
  pairId: string
  passSalt: string
  passHash: string
  failedLogins: number
  lockedUntil: number
  invitesIn: DeskInvite[]
  invitesOut: DeskInvite[]
}

export interface Snapshot {
  now: number
  meId: string
  username: string
  invitesIn: DeskInvite[]
  invitesOut: DeskInvite[]
  pair: PairMeta
  me: UserView
  partner: UserView | null
  vapid: string | null
}

export interface PresenceEntry {
  username: string
  name: string
  ink: Ink
  status: 'focus' | 'break' | 'idle'
  available: boolean
  at: number
}

export interface Ledger {
  days: Record<string, Record<string, DayStat>>
}
