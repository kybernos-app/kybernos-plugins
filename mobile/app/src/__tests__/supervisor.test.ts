import { baseOf, createSupervisor, findSignInUrl, HostPort } from '../supervisor'

const SIGN_IN = 'http://127.0.0.1:51234/?token=abc123'
type Fake = HostPort & { log: string; code: number | null; st: { phase: string; done: number; total: number }; started: number }
const fakeHost = (over: { start?: () => boolean; log?: string; code?: number | null; status?: { phase: string; done: number; total: number } } = {}): Fake => {
  const h: Fake = {
    log: over.log ?? '', code: over.code ?? null, st: over.status ?? { phase: 'none', done: 0, total: 0 }, started: 0,
    start: () => { h.started += 1; return over.start ? over.start() : true },
    status: () => h.st,
    exitCode: () => h.code,
    logTail: () => h.log,
  }
  return h
}
const answering = (status: number) => jest.fn(async () => ({ status }))
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }

describe('findSignInUrl', () => {
  it('takes the last sign-in address of the log and ignores other lines', () => {
    expect(findSignInUrl('boot\nweb: nothing\n')).toBeNull()
    expect(findSignInUrl(`a\ndsh web: ${SIGN_IN}\nb\n`)).toBe(SIGN_IN)
    expect(findSignInUrl('dsh web: http://127.0.0.1:1/?token=old\ndsh web: http://127.0.0.1:2/?token=new\n')).toBe('http://127.0.0.1:2/?token=new')
  })
  it('refuses an address that is not the loopback', () => {
    expect(findSignInUrl('dsh web: http://evil.example:80/?token=x')).toBeNull()
    expect(baseOf('http://127.0.0.1:51234/?token=abc')).toBe('http://127.0.0.1:51234/')
    expect(baseOf('http://example.com/')).toBeNull()
  })
})

describe('supervisor', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('goes unpacking, booting, ready (a 401 means the server answers)', async () => {
    const host = fakeHost({ status: { phase: 'unpacking', done: 500, total: 1000 } })
    const sup = createSupervisor({ host, fetch: answering(401) })
    const seen: string[] = []
    sup.subscribe((s) => seen.push(s.phase))
    sup.begin()
    expect(host.started).toBe(1)
    expect(sup.state).toEqual({ phase: 'unpacking', done: 500, total: 1000 })
    host.st = { phase: 'starting', done: 0, total: 0 }
    jest.advanceTimersByTime(500)
    expect(sup.state.phase).toBe('booting')
    host.log = `dsh web: ${SIGN_IN}\n`
    jest.advanceTimersByTime(500)
    await flush()
    expect(sup.state).toEqual({ phase: 'ready', url: SIGN_IN })
    expect(seen).toEqual(['unpacking', 'booting', 'ready'])
  })

  it('stays in booting while the server does not answer yet, then becomes ready', async () => {
    const host = fakeHost({ status: { phase: 'starting', done: 0, total: 0 }, log: `dsh web: ${SIGN_IN}\n` })
    const f = jest.fn().mockRejectedValueOnce(new Error('refused')).mockResolvedValue({ status: 200 })
    const sup = createSupervisor({ host, fetch: f })
    sup.begin()
    await flush()
    expect(sup.state.phase).not.toBe('ready')
    jest.advanceTimersByTime(500)
    await flush()
    expect(sup.state.phase).toBe('ready')
  })

  it('does not take a server error for readiness', async () => {
    const host = fakeHost({ log: `dsh web: ${SIGN_IN}\n` })
    const sup = createSupervisor({ host, fetch: answering(500) })
    sup.begin(); await flush()
    expect(sup.state.phase).not.toBe('ready')
    sup.stop()
  })

  it('reports a stopped engine and never restarts it', () => {
    const host = fakeHost({ status: { phase: 'starting', done: 0, total: 0 } })
    const sup = createSupervisor({ host, fetch: answering(200) })
    sup.begin()
    host.code = 7
    jest.advanceTimersByTime(500)
    expect(sup.state).toMatchObject({ phase: 'failed' })
    expect((sup.state as any).message).toContain('exit 7')
    expect(host.started).toBe(1)
  })

  it('says so when the build carries no runtime', () => {
    const host = fakeHost({ start: () => false })
    const sup = createSupervisor({ host, fetch: answering(200) })
    sup.begin()
    expect(sup.state).toMatchObject({ phase: 'failed' })
    sup.stop()
  })

  it('accepts a reload of the JavaScript side while the engine already runs', async () => {
    const host = fakeHost({ start: () => false, log: `dsh web: ${SIGN_IN}\n`, status: { phase: 'starting', done: 0, total: 0 } })
    const sup = createSupervisor({ host, fetch: answering(401) })
    sup.begin(); await flush()
    expect(sup.state.phase).toBe('ready')
  })

  it('health check: false before ready, true when the server answers, false when it does not', async () => {
    const host = fakeHost({ log: `dsh web: ${SIGN_IN}\n` })
    const f = jest.fn().mockResolvedValue({ status: 401 })
    const sup = createSupervisor({ host, fetch: f })
    expect(await sup.healthCheck()).toBe(false)
    sup.begin(); await flush()
    expect(await sup.healthCheck()).toBe(true)
    f.mockRejectedValue(new Error('down'))
    expect(await sup.healthCheck()).toBe(false)
  })
})
