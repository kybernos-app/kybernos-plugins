/** The device-cloud self-test: once the server answers, sign in with the address it printed, create a one-off automation through the route the interface uses, and report the
 *  automation's state on screen (a label a remote driver reads) and in a result file. Active only in builds that carry the native constant `selfTestDelay`. */
import { baseOf } from './supervisor'

export interface SelfTestDeps {
  fetch: (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; text(): Promise<string>; json(): Promise<any> }>
  now: () => Date
  show: (line: string) => void
  writeResult: (json: string) => void
  hasKey: boolean
  pollMs?: number
}

const QUESTION = 'What is the capital of Australia? Reply with the single word.'
const ANSWER = 'Canberra'

const pad = (n: number) => String(n).padStart(2, '0')
/** `yyyy-MM-ddTHH:mm` in UTC, the shape the schedule wants. */
export const dueAt = (now: Date, delaySeconds: number): string => {
  const d = new Date(now.getTime() + delaySeconds * 1000)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

export const runSelfTest = (signIn: string, delaySeconds: number, deps: SelfTestDeps) => {
  const base = (baseOf(signIn) ?? '').replace(/\/$/, '')
  let stopped = false
  let timer: ReturnType<typeof setInterval> | null = null
  const result: Record<string, unknown> = { startedAt: deps.now().toISOString() }
  const report = (line: string) => { deps.show(line); result.line = line; deps.writeResult(JSON.stringify(result)) }

  const post = async (body: object): Promise<any> => {
    const r = await deps.fetch(base + '/kybernos/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(body) })
    return r.json()
  }

  const start = async () => {
    report('selftest: signing in')
    try { await deps.fetch(signIn) } catch { /* the cookie is what matters; a failure shows up in the next step */ }
    const at = dueAt(deps.now(), delaySeconds)
    const due = at.slice(-5)
    result.due = due
    let created: any
    try {
      created = await post({ action: 'create', task: { name: 'selftest', prompt: deps.hasKey ? QUESTION : 'Reply with the single word TICKED', schedule: { mode: 'once', at, tz: 'UTC' }, approvals: 'ask' } })
    } catch (e) { report('selftest: create failed ' + String(e)); return }
    const id = created?.task?.id
    if (typeof id !== 'string') { report('selftest: create failed ' + String(created?.error)); return }
    report(`selftest: created, due ${due} UTC`)
    timer = setInterval(async () => {
      if (stopped) return
      let list: any
      try { list = await post({ action: 'list' }) } catch { return }
      result.taskCount = (list?.tasks ?? []).length
      const t = (list?.tasks ?? []).find((x: any) => x.id === id)
      if (!t) return
      const h = (t.history ?? [])[(t.history ?? []).length - 1]
      if (!h) { report(`selftest: created, due ${due} UTC | waiting`); return }
      const at8 = typeof h.at === 'string' ? h.at.slice(11, 19) : '?'
      const err = typeof h.error === 'string' ? ' | ' + h.error.slice(0, 60) : ''
      let line = `selftest: due ${due} UTC | ${h.status ?? '?'} at ${at8} UTC${err}`
      result.status = h.status; result.firedAt = h.at
      if (deps.hasKey && h.status === 'fired' && typeof h.sessionId === 'string') {
        try {
          const r = await deps.fetch(`${base}/kybernos/search-content?q=${ANSWER}&sessionId=${encodeURIComponent(h.sessionId)}`, { headers: { Origin: base } })
          const text = await r.text()
          const hits = text.toLowerCase().split(ANSWER.toLowerCase()).length - 1
          const fromAssistant = text.includes('assistant')
          result.answerHits = hits
          line += ` | answer check: "${ANSWER}" found ${hits}x${fromAssistant ? ', from the assistant' : ''}`
        } catch { /* the line without the check is still true */ }
      }
      report(line)
    }, deps.pollMs ?? 3000)
  }
  void start()
  return { stop: () => { stopped = true; if (timer !== null) clearInterval(timer) } }
}
