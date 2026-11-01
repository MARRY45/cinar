import { useCallback, useEffect, useRef, useState } from 'react'
import { elapsedAt, isRunning } from '../shared/logic.ts'
import type { Ledger, Snapshot } from '../shared/types.ts'
import { api, ApiError, setToken } from './api.ts'
import { serverNow, setServerTime } from './format.ts'

/** Timers in a worker are not throttled when the tab is in the background. */
function startTicker(onTick: () => void): () => void {
  const source = 'setInterval(function(){postMessage(0)},1000)'
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
  const worker = new Worker(url)
  worker.onmessage = onTick
  return () => {
    worker.terminate()
    URL.revokeObjectURL(url)
  }
}

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(serverNow)
  useEffect(() => {
    const id = window.setInterval(() => setNow(serverNow()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

function pollDelay(snap: Snapshot | null): number {
  const someoneLive = !!snap?.me.live || !!snap?.partner?.live
  if (document.visibilityState === 'visible') return someoneLive ? 4000 : 10000
  // Must stay well under the heartbeat grace period, or a hidden tab would lose study time.
  return snap?.me.live ? 25000 : 45000
}

export function useApp(onSignedOut: () => void) {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [ledger, setLedger] = useState<Ledger | null>(null)
  const [offline, setOffline] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const snapRef = useRef<Snapshot | null>(null)
  const lastSync = useRef(0)
  const syncing = useRef(false)
  const ledgerRev = useRef(-1)
  const queue = useRef<Promise<unknown>>(Promise.resolve())

  const apply = useCallback((next: Snapshot) => {
    setServerTime(next.now)
    snapRef.current = next
    setSnap(next)
    setOffline(false)
    const rev = next.me.totals.sessions + (next.partner?.totals.sessions ?? 0)
    if (rev !== ledgerRev.current) {
      ledgerRev.current = rev
      api.ledger().then(setLedger).catch(() => {
        ledgerRev.current = -1
      })
    }
  }, [])

  /** One request at a time per device, so a slow sync can't overwrite a newer action. */
  const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const run = queue.current.then(task, task)
    queue.current = run.catch(() => undefined)
    return run
  }, [])

  const sync = useCallback(async () => {
    if (syncing.current) return
    syncing.current = true
    lastSync.current = Date.now()
    try {
      apply(await enqueue(() => api.sync()))
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setToken(null)
        onSignedOut()
      } else {
        setOffline(true)
      }
    } finally {
      syncing.current = false
    }
  }, [apply, enqueue, onSignedOut])

  useEffect(() => {
    void sync()
    const stop = startTicker(() => {
      const current = snapRef.current
      const live = current?.me.live
      const dueToFinish =
        !!live && isRunning(live, serverNow()) && elapsedAt(live, serverNow()) >= live.plannedSec && Date.now() - lastSync.current > 1500
      if (dueToFinish || Date.now() - lastSync.current >= pollDelay(current)) void sync()
    })
    const wake = () => {
      if (document.visibilityState === 'visible') void sync()
    }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('online', wake)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('online', wake)
    }
  }, [sync])

  const act = useCallback(
    async (type: string, payload: Record<string, unknown> = {}): Promise<boolean> => {
      try {
        apply(await enqueue(() => api.action(type, payload)))
        setError(null)
        lastSync.current = Date.now()
        return true
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Bağlantı sorunu.')
        return false
      }
    },
    [apply, enqueue],
  )

  return { snap, ledger, offline, error, setError, act, sync }
}
