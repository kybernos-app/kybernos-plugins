import { fetchTasks, planReminders } from '../reminders'

const NOW = Date.parse('2026-10-25T12:00:00Z')
const at = (mins: number) => new Date(NOW + mins * 60000).toISOString()

describe('planReminders', () => {
  it('plans one reminder per active task that comes due later, soonest first, with a text that tells nothing private', () => {
    const r = planReminders([{ id: 'b', active: true, nextRun: at(90), name: 'Pay the invoice of Mrs X', prompt: 'secret' }, { id: 'a', active: true, nextRun: at(30) }], NOW)
    expect(r.map((x) => x.id)).toEqual(['a', 'b'])
    expect(r[0].at).toBe(NOW + 30 * 60000)
    expect(JSON.stringify(r)).not.toMatch(/invoice|Mrs|secret/)
  })
  it('skips paused tasks, tasks with no next run, past or imminent runs, far ones and malformed records', () => {
    const r = planReminders([
      { id: 'paused', active: false, nextRun: at(30) }, { id: 'none', active: true, nextRun: null }, { id: 'past', nextRun: at(-5) }, { id: 'now', nextRun: at(0.05) },
      { id: 'far', nextRun: at(60 * 24 * 30) }, { id: 'bad date', nextRun: 'soon' }, { id: 'bad id/../x', nextRun: at(30) }, { nextRun: at(30) }, null, 'text', 3,
    ], NOW)
    expect(r).toEqual([])
  })
  it('keeps at most the limit (iOS holds 64 pending notifications) and ignores a list that is not one', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ id: 't' + i, nextRun: at(10 + i) }))
    expect(planReminders(many, NOW)).toHaveLength(20)
    expect(planReminders(many, NOW, { limit: 5 })).toHaveLength(5)
    expect(planReminders(undefined, NOW)).toEqual([]); expect(planReminders({}, NOW)).toEqual([])
  })
})

describe('fetchTasks', () => {
  it('asks the engine for the list the way the interface does', async () => {
    const f = jest.fn(async (_u: string, _i?: any) => ({ json: async () => ({ ok: true, tasks: [{ id: 'x' }] }) }))
    expect(await fetchTasks('http://127.0.0.1:5000/', f)).toEqual([{ id: 'x' }])
    expect(f.mock.calls[0][0]).toBe('http://127.0.0.1:5000/kybernos/tasks')
    expect(f.mock.calls[0][1].headers.Origin).toBe('http://127.0.0.1:5000')
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ action: 'list' })
  })
  it('answers null when the engine does not answer or answers something else', async () => {
    expect(await fetchTasks('http://127.0.0.1:5000', async () => { throw new Error('down') })).toBeNull()
    expect(await fetchTasks('http://127.0.0.1:5000', async () => ({ json: async () => ({ ok: false }) }))).toBeNull()
  })
})
