#!/usr/bin/env node
/** The (i) sheet of a skill on the project page shows what the Skills page knows of it (2026-10-22), source-level like test-conn-logos.mjs:
 *   - the catalogue is read from the Skills plugin once a minute and is `null` when that plugin is absent (the sheet then shows what the page already knew);
 *   - the date is the ISO string the Skills plugin writes (or a number), never « NaN »;
 *   - the sheet offers the description, « use it when », the origin, the folder, the date and the instructions on demand.
 *  Usage: node packages/kybernos-plugin/test-project-skill-sheet.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))
const client = readFileSync(process.env.KB_PLUGIN_CLIENT || join(here, 'client.js'), 'utf8')
const between = (a, b) => {
  const i = client.indexOf(a)
  const j = client.indexOf(b, i + 1)
  assert.ok(i >= 0 && j > i, a + ' … ' + b + ' were found')
  return client.slice(i, j)
}

// the helpers, played as they are
const code = between('let kbSkillCatCache', 'const kbConnRowsOf')
const calls = []
const ctx = {
  Date,
  String,
  Array,
  Object,
  Promise,
  kbe: (en) => en,
  fetch: (url) => { calls.push(url); return Promise.resolve({ ok: true, json: () => Promise.resolve({ skills: [{ name: 'Ai-Team-Creator', description: 'd' }, { name: 'ai-team-creator', description: 'dup' }, { name: '' }] }) }) },
}
vm.createContext(ctx)
vm.runInContext(code + '\nthis.kbSkillCatalog = kbSkillCatalog; this.kbSkillTime = kbSkillTime; this.kbSkillSourceLabel = kbSkillSourceLabel', ctx)

const cat = await ctx.kbSkillCatalog()
assert.deepEqual(Object.keys(cat), ['ai-team-creator'])
assert.equal(cat['ai-team-creator'].description, 'd')
ok('the catalogue is keyed by lower-case name, the first one wins, empty names are dropped')
await ctx.kbSkillCatalog()
assert.equal(calls.length, 1)
assert.equal(calls[0], '/kybernos-skills/skills')
ok('the catalogue is read once, from the Skills plugin')

assert.equal(ctx.kbSkillTime(1700000000000), 1700000000000)
assert.equal(ctx.kbSkillTime('2026-09-24T10:00:00.000Z'), Date.parse('2026-09-24T10:00:00.000Z'))
assert.ok(Number.isNaN(ctx.kbSkillTime(undefined)))
ok('the date accepts a number or an ISO string, and says NaN for nothing (the sheet then hides the row)')

assert.equal(ctx.kbSkillSourceLabel('user-dsh'), 'DSH skills folder')
assert.equal(ctx.kbSkillSourceLabel('user-agents'), 'Agents skills folder')
assert.equal(ctx.kbSkillSourceLabel('project'), 'This project')
assert.equal(ctx.kbSkillSourceLabel('x'), 'x')
assert.equal(ctx.kbSkillSourceLabel(undefined), '')
ok('the origin has words, and an unknown one is shown as it is')

// the Skills plugin absent: the answer is null, not an error
{
  const c2 = { Date, String, Array, Object, Promise, kbe: (en) => en, fetch: () => Promise.reject(new Error('down')) }
  vm.createContext(c2)
  vm.runInContext(code + '\nthis.kbSkillCatalog = kbSkillCatalog', c2)
  assert.equal(await c2.kbSkillCatalog(), null)
  const c3 = { Date, String, Array, Object, Promise, kbe: (en) => en, fetch: () => Promise.resolve({ ok: false }) }
  vm.createContext(c3)
  vm.runInContext(code + '\nthis.kbSkillCatalog = kbSkillCatalog', c3)
  assert.equal(await c3.kbSkillCatalog(), null)
}
ok('a missing or failing Skills plugin gives null')

// the sheet
const sheet = between("data-kb': 'project-skill-sheet'", 'kb8-docfiche')
for (const hook of ['project-skill-desc', 'project-skill-sheet-toggle', 'project-skill-read', 'project-skill-text']) assert.ok(client.includes(hook), hook)
ok('the sheet has its description, toggle, read button and instructions block')
assert.ok(client.includes("'/kybernos-skills/skill/read'"))
assert.ok(/kbui\.skill\.when/.test(client) && /kbui\.skill\.folder/.test(client) && /kbui\.skill\.modified/.test(client) && /kbui\.skill\.source/.test(client))
ok('the instructions are read on demand from the Skills plugin and the new fields have strings')
assert.ok(sheet.length > 0)

console.log(pass + ' tests passed')
