/** iOS suspends the app soon after it leaves the screen, and nothing wakes the engine: an automation that comes due while the app is closed waits, and runs when the person comes back. A reminder
 *  tells them it is due. This turns the engine's task list into the notifications to schedule. The text is generic on purpose: a notification can show on a locked screen, and an automation's name
 *  or prompt can be private. */
export interface TaskRecord { id?: unknown; active?: unknown; nextRun?: unknown }
export interface Reminder { id: string; title: string; body: string; at: number }

const DAY = 86_400_000

export const planReminders = (tasks: unknown, nowMs: number, { limit = 20, horizonDays = 14 }: { limit?: number; horizonDays?: number } = {}): Reminder[] => {
  if (!Array.isArray(tasks)) return []
  const out: Reminder[] = []
  for (const t of tasks as TaskRecord[]) {
    if (t === null || typeof t !== 'object' || typeof t.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(t.id)) continue
    if (t.active === false || typeof t.nextRun !== 'string') continue
    const at = Date.parse(t.nextRun)
    if (!Number.isFinite(at) || at <= nowMs + 5000 || at > nowMs + horizonDays * DAY) continue
    out.push({ id: t.id, title: 'An automation is due', body: 'Open Kybernos and it runs.', at })
  }
  return out.sort((a, b) => a.at - b.at).slice(0, limit)
}

type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ json(): Promise<any> }>

/** The task list, through the same route the interface uses (the engine's address with the token has been opened once, so the cookie is there). Null on any failure. */
export const fetchTasks = async (base: string, fetchFn: FetchLike, timeoutMs = 8000): Promise<unknown[] | null> => {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const r = await fetchFn(base.replace(/\/$/, '') + '/kybernos/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base.replace(/\/$/, '') }, body: JSON.stringify({ action: 'list' }), signal: ctl.signal })
    const j = await r.json()
    return Array.isArray(j?.tasks) ? j.tasks : null
  } catch { return null } finally { clearTimeout(t) }
}
