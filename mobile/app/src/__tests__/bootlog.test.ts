import { bootDiagnosticsText, tailLines } from '../bootlog'

describe('tailLines', () => {
  it('keeps the last lines, drops empty ones, cuts long ones and hides tokens and keys', () => {
    const log = ['one', '', 'two', 'dsh web: http://127.0.0.1:5000/?token=SECRET', 'x'.repeat(200), 'key sk-ant-api03-abcdefghijkl', 'last'].join('\n')
    const out = tailLines(log, 4, 20).split('\n')
    expect(out).toHaveLength(4)
    expect(out[0]).toBe('dsh web: http://127…')
    expect(out[1]).toBe('xxxxxxxxxxxxxxxxxxx…')
    expect(out.join('\n')).not.toContain('SECRET')
    expect(out[2]).toBe('key sk-ant-…')
    expect(out[3]).toBe('last')
  })
  it('is empty for an empty log', () => { expect(tailLines('')).toBe('') })
})

describe('bootDiagnosticsText', () => {
  it('starts with the marker a remote driver looks for and reports the facts', () => {
    const t = bootDiagnosticsText({ status: 'unpacking 10/30', signInInLog: false, probe: null, exitCode: null }, 'booting\nloading plugins', 42)
    expect(t.startsWith('engine log: 42 s, status unpacking 10/30, sign-in line not yet, probe none yet')).toBe(true)
    expect(t.endsWith('booting\nloading plugins')).toBe(true)
  })
  it('reports an exit code and the last probe', () => {
    const t = bootDiagnosticsText({ status: 'starting', signInInLog: true, probe: 'HTTP 401', exitCode: 3 }, '', 5)
    expect(t).toBe('engine log: 5 s, status starting, sign-in line found, probe HTTP 401, exit 3')
  })
})
