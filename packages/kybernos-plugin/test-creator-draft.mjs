// « Let the agent help me create a preset » must open the Creator chat with the brief written in the composer, and nothing else
// that starts a session may be touched. DSH calls `uiWorkspace.startSession(undefined, { clearPreviousDraft: false, agentPreset:
// 'cordis' })` with no prompt; the client wraps that exact call shape. Checked here on the real source.
//   node packages/kybernos-plugin/test-creator-draft.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + JSON.stringify(detail)))
  if (!ok) failed += 1
}
const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')

const start = SRC.indexOf("const wrapped = function (workspaceId, options) {")
const end = SRC.indexOf("}, 'kybers: creator preset draft')", start)
check('the wrapper is in the client', start > 0 && end > start)
const body = SRC.slice(start, end)
// Rebuild the wrapper around a fake service: `original` records what it was called with.
const make = () => {
  const calls = []
  const original = function (workspaceId, options) { calls.push({ self: this, workspaceId, options }); return 'started' }
  const kbt = (k) => 'BRIEF:' + k
  const fn = new Function('original', 'kbt', 'return (' + body.slice(body.indexOf('function'), body.indexOf('\n        ctx.effect')).trim().replace(/\s*$/, '') + ')')
  return { calls, wrapped: fn(original, kbt) }
}
{
  const { calls, wrapped } = make()
  const r = wrapped.call({ id: 'svc' }, undefined, { clearPreviousDraft: false, agentPreset: 'cordis' })
  check('the button’s call gets the brief as its prompt, and keeps its other options', calls.length === 1 && calls[0].options.prompt === 'BRIEF:kbui.preset.creator.draft' && calls[0].options.agentPreset === 'cordis' && calls[0].options.clearPreviousDraft === false)
  check('the service is still the receiver and the result is passed back', calls[0].self.id === 'svc' && r === 'started')
}
{
  const { calls, wrapped } = make()
  const cases = [
    ['no options (a plain new chat)', undefined],
    ['another preset', { clearPreviousDraft: false, agentPreset: 'standard' }],
    ['the Creator preset with a draft already given by another caller', { clearPreviousDraft: false, agentPreset: 'cordis', prompt: 'mine' }],
    ['a call that clears the draft', { clearPreviousDraft: true, agentPreset: 'cordis' }],
    ['a feedback chat (prompt only)', { prompt: 'x' }],
  ]
  for (const [name, opts] of cases) {
    calls.length = 0
    wrapped.call({}, 'w1', opts)
    check('untouched: ' + name, calls.length === 1 && calls[0].options === opts && calls[0].workspaceId === 'w1')
  }
}
check('both languages carry the brief and it names the skill DSH ships for presets', /'kbui\.preset\.creator\.draft': \{ kybernos: '[^']*editing-cordis-compositions[^']*', en: '[^']*editing-cordis-compositions[^']*' \}/.test(SRC))
check('the brief is given back when the plugin stops (the property is restored)', /Object\.defineProperty\(svc, 'startSession', \{ value: original/.test(SRC))
console.log(failed === 0 ? '\nOK' : '\n' + failed + ' failed')
process.exit(failed === 0 ? 0 : 1)
