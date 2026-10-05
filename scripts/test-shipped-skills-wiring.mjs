// The core plugin ships the `automation-creator` skill: this boots the REAL packages/kybernos-plugin/index.js
// with a fake context, on a temporary DSH_HOME and a DIFFERENT home with a decoy .dsh, and checks where the
// skill lands, that a skill the user wrote under the same name survives, and that a switched-off skill stays off.
// Nothing outside the temporary folders is read or written.
// Usage: node scripts/test-shipped-skills-wiring.mjs   (exit 0 = everything passes)
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'kb-shipped-skills-'))
const dshHome = join(tmp, 'dsh')
const decoyHome = join(tmp, 'decoy-home')
mkdirSync(join(decoyHome, '.dsh'), { recursive: true })
mkdirSync(dshHome, { recursive: true })
process.env.DSH_HOME = dshHome
process.env.HOME = decoyHome

// timers of the scheduler are not wanted here
const realSetTimeout = globalThis.setTimeout
globalThis.setTimeout = (fn, ms, ...a) => ((ms === 5000 || ms === 30000) ? { unref() {}, ref() {} } : realSetTimeout(fn, ms, ...a))

let fails = 0
const eq = (label, got, want) => { const ok = got === want; if (!ok) { fails++; console.log('FAIL', label, '| got', got, '| want', want) } else console.log('ok  ', label) }

const mod = await import(root + 'packages/kybernos-plugin/index.js')
const shipped = readFileSync(root + 'packages/kybernos-plugin/skills/automation-creator/SKILL.md', 'utf8')
const target = join(dshHome, 'skills', 'automation-creator', 'SKILL.md')
const start = async () => {
  const quiet = []
  const e0 = console.error; const l0 = console.log
  console.error = (...a) => quiet.push(a.join(' ')); console.log = (...a) => quiet.push(a.join(' '))
  try { mod.apply({ get: () => undefined, inject: () => {}, effect: (fn) => { try { return fn() } catch (e) { return undefined } }, on: () => {}, scope: {} }) } finally { console.error = e0; console.log = l0 }
  await new Promise((r) => realSetTimeout(r, 30))
  return quiet
}

let log = await start()
eq('a fresh home gets the skill, byte for byte, under DSH_HOME', existsSync(target) && readFileSync(target, 'utf8') === shipped, true)
eq('nothing was written under the other home\'s .dsh', existsSync(join(decoyHome, '.dsh', 'skills')) === false && existsSync(join(decoyHome, '.dsh', 'kybernos')) === false, true)
eq('what was written is remembered', /^[0-9a-f]{64}$/.test(JSON.parse(readFileSync(join(dshHome, 'kybernos', 'seeded-skills.json'), 'utf8')).skills['automation-creator']), true)
eq('no error was logged for the skill', log.some((l) => /skill automation-creator not installed|shipped skills not installed/.test(l)), false)

log = await start()
eq('a second start changes nothing', readFileSync(target, 'utf8') === shipped, true)

// the user edits it: it must never be overwritten
writeFileSync(target, '---\nname: automation-creator\ndescription: mine\n---\nmy own words\n')
await start()
eq('a skill the user edited is kept on the next start', readFileSync(target, 'utf8').includes('my own words'), true)

// the user switches it off
rmSync(target)
writeFileSync(join(dshHome, 'skills', 'automation-creator', 'SKILL.md.disabled'), '')
await start()
eq('a switched-off skill is not brought back', existsSync(target), false)

// DSH_HOME unset: the default is <home>/.dsh
rmSync(dshHome, { recursive: true, force: true })
delete process.env.DSH_HOME
await start()
eq('without DSH_HOME the skill goes to <home>/.dsh', existsSync(join(decoyHome, '.dsh', 'skills', 'automation-creator', 'SKILL.md')), true)

// a blank DSH_HOME is the same as none
rmSync(join(decoyHome, '.dsh'), { recursive: true, force: true })
process.env.DSH_HOME = '   '
await start()
eq('a blank DSH_HOME counts as unset', existsSync(join(decoyHome, '.dsh', 'skills', 'automation-creator', 'SKILL.md')), true)

rmSync(tmp, { recursive: true, force: true })
console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILURES')
process.exit(fails === 0 ? 0 : 1)
