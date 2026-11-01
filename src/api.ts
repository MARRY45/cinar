import type { Ledger, PresenceEntry, SessionRec, Snapshot } from '../shared/types.ts'

const TOKEN_KEY = 'cinar.token'

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Private windows can refuse storage; the session then lasts only this page load.
  }
}

export interface UserCard {
  username: string
  name: string
  ink: string
  available: boolean
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const token = getToken()
  const res = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'Bağlantı sorunu.')
  return data as T
}

export const api = {
  register: (username: string, name: string, password: string, ink: string) => call<{ token: string }>('/register', { username, name, password, ink }),
  login: (username: string, password: string) => call<{ token: string }>('/login', { username, password }),
  lookup: (username: string) => call<UserCard>(`/user/${encodeURIComponent(username)}`),
  sync: () => call<Snapshot>('/sync', {}),
  action: (type: string, payload: Record<string, unknown> = {}) => call<Snapshot>('/action', { type, ...payload }),
  ledger: () => call<Ledger>('/ledger'),
  day: (date: string) => call<{ sessions: Record<string, SessionRec[]> }>(`/day?date=${date}`),
  online: () => call<{ online: PresenceEntry[] }>('/online'),
  deviceLink: () => call<{ token: string }>('/device-link', {}),
  logout: () => call<{ ok: boolean }>('/logout', {}),
}
