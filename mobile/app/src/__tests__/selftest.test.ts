import { dueAt, runSelfTest, SelfTestDeps } from '../selftest'

const SIGN_IN = 'http://127.0.0.1:51234/?token=abc'
const NOW = new Date('2026-10-25T03:20:30Z')
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }

const setup = (history: any[], opts: { hasKey?: boolean; search?: string } = {}) => {
  const lines: string[] = []; const results: string[] = []; const posts: any[] = []
  const fetch: SelfTestDeps['fetch'] = jest.fn(async (url: string, init?: any) => {
    if (url.endsWith('/kybernos/tasks')) {
      const body = JSON.parse(init.body); posts.push({ body, headers: init.headers })
      const json = body.action === 'create' ? { ok: true, task: { id: 't1' } } : { tasks: [{ id: 't1', history }] }
      return { status: 200, text: async () => JSON.stringify(json), json: async () => json }
    }
    if (url.includes('/kybernos/search-content')) return { status: 200, text: async () => opts.search ?? '', json: async () => ({}) }
    return { status: 200, text: async () => '', json: async () => ({}) }
  })
  const deps: SelfTestDeps = { fetch, now: () => NOW, show: (l) => lines.push(l), writeResult: (j) => results.push(j), hasKey: opts.hasKey ?? false, pollMs: 1000 }
  return { deps, lines, results, posts }
}

describe('dueAt', () => {
  it('is the minute the delay lands in, in UTC', () => {
    expect(dueAt(NOW, 90)).toBe('2026-10-25T03:22')
    expect(dueAt(new Date('2026-12-31T23:59:30Z'), 60)).toBe('2027-01-01T00:00')
  })
})

describe('runSelfTest', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('creates a one-off automation through the interface route, with the Origin header', async () => {
    const s = setup([])
    const t = runSelfTest(SIGN_IN, 90, s.deps)
    await flush()
    expect(s.posts[0].body).toMatchObject({ action: 'create', task: { name: 'selftest', schedule: { mode: 'once', at: '2026-10-25T03:22', tz: 'UTC' }, approvals: 'ask' } })
    expect(s.posts[0].headers.Origin).toBe('http://127.0.0.1:51234')
    expect(s.lines).toContain('selftest: created, due 03:22 UTC')
    t.stop()
  })

  it('shows the state once the automation fired', async () => {
    const s = setup([{ status: 'fired', at: '2026-10-25T03:22:05.123Z' }])
    const t = runSelfTest(SIGN_IN, 90, s.deps)
    await flush(); jest.advanceTimersByTime(1000); await flush()
    expect(s.lines[s.lines.length - 1]).toBe('selftest: due 03:22 UTC | fired at 03:22:05 UTC')
    expect(JSON.parse(s.results[s.results.length - 1])).toMatchObject({ status: 'fired', due: '03:22' })
    t.stop()
  })

  it('with a key it asks a question and looks for the answer in the chat', async () => {
    const s = setup([{ status: 'fired', at: '2026-10-25T03:22:05Z', sessionId: 'abc' }], { hasKey: true, search: '{"hits":[{"role":"assistant","text":"Canberra"}]}' })
    const t = runSelfTest(SIGN_IN, 90, s.deps)
    await flush(); jest.advanceTimersByTime(1000); await flush()
    expect(s.posts[0].body.task.prompt).toContain('capital of Australia')
    expect(s.lines[s.lines.length - 1]).toContain('answer check: "Canberra" found 1x, from the assistant')
    t.stop()
  })

  it('says when the route refuses', async () => {
    const s = setup([])
    ;(s.deps.fetch as jest.Mock).mockImplementation(async () => ({ status: 403, text: async () => '', json: async () => ({ error: 'forbidden' }) }))
    const t = runSelfTest(SIGN_IN, 90, s.deps)
    await flush()
    expect(s.lines[s.lines.length - 1]).toBe('selftest: create failed forbidden')
    t.stop()
  })
})
