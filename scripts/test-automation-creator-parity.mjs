// The `automation-creator` skill validates what the agent saves with its own small validator, because the
// agent runs it with plain node and cannot call the scheduler. It must accept and refuse exactly what the
// scheduler does, or a task the skill saved would be refused (or worse, mis-read) later. This compares them
// on a table and on a few hundred generated expressions.
// Usage: node scripts/test-automation-creator-parity.mjs   (exit 0 = they agree)
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const host = readFileSync(root + 'packages/kybernos-plugin/index.js', 'utf8').match(/\/\/ KB-TASKS-CORE-BEGIN([\s\S]*?)\/\/ KB-TASKS-CORE-END/)
if (host === null) { console.error('KB-TASKS-CORE block not found'); process.exit(1) }
const core = await import('data:text/javascript,' + encodeURIComponent(host[1] + '\nexport { kbParseCron, kbIsValidTimeZone, kbParseIsoLocal, kbComputeNextRun, kbSanitizeTaskInput }'))
const skill = readFileSync(root + 'packages/kybernos-plugin/skills/automation-creator/SKILL.md', 'utf8')
const grab = (from, to) => { const a = skill.indexOf(from); const b = skill.indexOf(to, a); if (a < 0 || b < 0) { console.error('cannot find ' + from + ' in SKILL.md'); process.exit(1) } return skill.slice(a, b) }
const fns = new Function("const text = (v) => (typeof v === 'string' ? v : '');\n" + grab('const validZone', 'const sc = ') + '\n' + grab('const cronOk', 'const schedule = ') + '\nreturn { validZone, cronOk }')()

let fails = 0
const eq = (label, got, want) => { if (got !== want) { fails += 1; console.log('FAIL', label, '| skill', got, '| scheduler', want) } }
let n = 0

const crons = ['0 8 * * 1', '30 9 * * 1-5', '*/15 * * * *', '5-59/10 * * * *', '0 8 * * 7', '0 8 * * 0', '0 0 1 1 *', '0 12 29 2 *', '* * * * *', '0 8,17 * * *', '*/60 * * * *',
  '0 8 * * 1,', ',5 * * * *', '1,,2 * * * *', '/5 * * * *', '5abc * * * *', '1-5-9 * * * *', '0x10 * * * *', '*/1e9 * * * *', '1#2 * * * *', '*/5/2 * * * *', '*/0 * * * *', '*/-1 * * * *',
  '22-2 * * * *', '* 24 * * *', '60 * * * *', '* * 0 * *', '* * 32 * *', '* * * 13 *', '* * * * 8', 'jan * * * *', '@daily', '* * * *', '* * * * * *', '', '   ', 'banana', '0 8 * * 1-', '-1 * * * *']
for (const c of crons) { n += 1; eq('cron "' + c + '"', fns.cronOk(c), core.kbParseCron(c) !== null) }

// generated: pieces from a vocabulary that mixes valid and invalid tokens
let seed = 20261005
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
const pick = (a) => a[Math.floor(rnd() * a.length)]
const piece = () => pick(['*', '*/5', '*/0', '0', '1', '7', '12', '23', '31', '59', '60', '1-5', '5-1', '0-59', '1,2', '1,', '', 'a', '5/2', '1-5/2', '*/', '-', '*-3', '00', '007'])
for (let i = 0; i < 600; i += 1) {
  const c = Array.from({ length: pick([4, 5, 5, 5, 5, 6]) }, () => piece()).join(rnd() < 0.05 ? '  ' : ' ')
  n += 1
  eq('generated cron "' + c + '"', fns.cronOk(c), core.kbParseCron(c) !== null)
}

for (const z of ['Europe/Paris', 'America/New_York', 'Asia/Kolkata', 'UTC', 'Australia/Lord_Howe', 'Mars/Phobos', ' Europe/Paris', '', 'europe/paris', 'Europe/Paris ', 'x'.repeat(65)]) { n += 1; eq('zone "' + z + '"', fns.validZone(z), core.kbIsValidTimeZone(z)) }

if (fails === 0) console.log('ok   the skill and the scheduler agree on ' + n + ' crons and zones')

// A task SAVED by the skill's script (really run with sh) is understood by the scheduler.
const block = /```bash\n(node --input-type=module - [^\n]*<<'JS'\n[\s\S]*?\nJS)\n```/.exec(skill)
if (block === null) { console.error('script block not found in SKILL.md'); process.exit(1) }
const tmp = mkdtempSync(join(tmpdir(), 'kb-skill-parity-'))
const save = (spec) => {
  const dsh = join(tmp, 'dsh' + Math.random().toString(36).slice(2)); mkdirSync(dsh, { recursive: true })
  const specFile = join(dsh, 'spec.json'); writeFileSync(specFile, JSON.stringify(spec))
  const r = spawnSync('sh', ['-c', block[1].replace('/tmp/automation-spec.json', specFile)], { env: Object.assign({}, process.env, { DSH_HOME: dsh, HOME: join(tmp, 'other') }), encoding: 'utf8' })
  if (r.status !== 0) { fails += 1; console.log('FAIL the script refused', JSON.stringify(spec), r.stdout + r.stderr); return null }
  return JSON.parse(readFileSync(join(dsh, 'kybernos', 'tasks.json'), 'utf8'))[0]
}
const now = Date.now()
const cases = [
  ['cron', { name: 'A', prompt: 'p', schedule: { mode: 'cron', cron: '0 8 * * 1', tz: 'Europe/Paris' } }, true],
  ['one-time', { name: 'B', prompt: 'p', schedule: { mode: 'once', at: '2999-12-15T09:00', tz: 'Asia/Tokyo' } }, true],
  ['webhook only', { name: 'C', prompt: 'p', schedule: { mode: 'webhook' } }, false],
  ['schedule + webhook', { name: 'D', prompt: 'p', schedule: { mode: 'cron', cron: '*/15 * * * *' }, webhook: true, approvals: 'auto', notify: ['push', 'email'] }, true],
]
for (const [label, spec, hasNext] of cases) {
  const task = save(spec); n += 1
  if (task === null) continue
  const next = core.kbComputeNextRun(task, now)
  eq('saved by the skill (' + label + '): the scheduler computes its next run', next !== null, hasNext)
  const clean = core.kbSanitizeTaskInput({ name: task.name, prompt: task.prompt, schedule: task.schedule, approvals: task.approvals, notify: task.notify, active: task.active })
  eq('saved by the skill (' + label + '): the route\'s validation accepts its definition', clean.ok, true)
  eq('saved by the skill (' + label + '): the stored schedule is the one the route would store', JSON.stringify(clean.task.schedule), JSON.stringify(task.schedule))
}
rmSync(tmp, { recursive: true, force: true })
if (fails === 0) console.log('ok   a task saved by the skill is understood by the scheduler (' + cases.length + ' kinds)')
process.exit(fails === 0 ? 0 : 1)
