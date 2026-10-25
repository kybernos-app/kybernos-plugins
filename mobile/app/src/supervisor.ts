/** Watches the engine from the app: first-launch progress, the sign-in address the server prints, readiness, and a health check when the app comes back. */
export type BootState =
  | { phase: 'starting' }
  | { phase: 'unpacking'; done: number; total: number }
  | { phase: 'booting' }
  | { phase: 'ready'; url: string }
  | { phase: 'failed'; message: string }

export interface HostPort {
  start(port: number): boolean
  status(): { phase: string; done: number; total: number }
  exitCode(): number | null
  logTail(maxBytes: number): string
}

export interface SupervisorDeps {
  host: HostPort
  fetch: (url: string, init?: { signal?: AbortSignal }) => Promise<{ status: number }>
  port?: number
  intervalMs?: number
}

/** `dsh web: http://127.0.0.1:PORT/?token=…` is printed once the server listens: the last such line of the log. */
export const findSignInUrl = (log: string): string | null => {
  let last: string | null = null
  for (const m of log.matchAll(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\S*)/g)) last = m[1]
  return last
}

export const baseOf = (url: string): string | null => {
  const m = /^(http:\/\/127\.0\.0\.1:\d+)/.exec(url)
  return m ? m[1] + '/' : null
}

/** 401 is the server answering: it wants the sign-in address. */
const ANSWERING = [200, 302, 401]

export const createSupervisor = ({ host, fetch, port = 0, intervalMs = 500 }: SupervisorDeps) => {
  let state: BootState = { phase: 'starting' }
  const listeners = new Set<(s: BootState) => void>()
  let timer: ReturnType<typeof setInterval> | null = null
  let probing = false

  const set = (next: BootState) => {
    if (JSON.stringify(next) === JSON.stringify(state)) return
    state = next
    for (const l of [...listeners]) l(state)
  }
  const stop = () => { if (timer !== null) { clearInterval(timer); timer = null } }

  const get = async (url: string, timeoutMs: number): Promise<number | null> => {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), timeoutMs)
    try { return (await fetch(url, { signal: ctl.signal })).status } catch { return null } finally { clearTimeout(t) }
  }

  const probe = async (signIn: string) => {
    if (probing) return
    probing = true
    try {
      const base = baseOf(signIn)
      const status = base === null ? null : await get(base, 2000)
      if (status !== null && ANSWERING.includes(status) && state.phase !== 'failed') { stop(); set({ phase: 'ready', url: signIn }) }
    } finally { probing = false }
  }

  const tick = () => {
    if (state.phase === 'ready' || state.phase === 'failed') return
    const code = host.exitCode()
    if (code !== null) { stop(); set({ phase: 'failed', message: `The engine stopped (exit ${code}). Close and reopen the app to start it again.` }); return }
    const url = findSignInUrl(host.logTail(65536))
    if (url !== null) { void probe(url); return }
    const s = host.status()
    if (s.phase === 'unpacking') set({ phase: 'unpacking', done: s.done, total: s.total })
    else if (s.phase !== 'none') set({ phase: 'booting' })
  }

  return {
    get state() { return state },
    subscribe(fn: (s: BootState) => void) { listeners.add(fn); return () => { listeners.delete(fn) } },
    /** Starts the engine and the watch. `node_start` runs once per process: a stopped engine is reported, never restarted. */
    begin() {
      if (!host.start(port)) {
        // already running (a reload of the JavaScript side) is fine; no payload in the app is not
        if (host.status().phase === 'none' && host.exitCode() === null && findSignInUrl(host.logTail(65536)) === null) {
          set({ phase: 'failed', message: 'This build of the app does not contain the Kybernos runtime.' }); return
        }
      }
      timer = setInterval(tick, intervalMs)
      tick()
    },
    stop,
    /** When the app returns to the foreground: is the server still answering? */
    async healthCheck(): Promise<boolean> {
      if (state.phase !== 'ready') return false
      const base = baseOf(state.url)
      return base !== null && (await get(base, 3000)) !== null
    },
  }
}
