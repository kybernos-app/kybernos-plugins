#!/usr/bin/env node
/** Integration packs, the pure half: what a valid pack is, what installing it does, and what it can never do.
 *
 *  1. an EMPTY pack (a manifest and nothing else) is valid, installs, and is recorded;
 *  2. a pack with a skill, an automation and two connectors: the plan, the order, the safe defaults (paused, asking, not callable);
 *  3. what is left alone (a skill the person edited or switched off, an automation that already exists);
 *  4. every refusal, each with its reason (a pack is text a stranger wrote: nothing is trimmed into shape, it is refused whole);
 *  5. one failure does not stop the rest, and a pack that failed is not recorded as installed.
 *
 *  Usage: node packages/kybernos-skills/test-packs.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { PACK_LIMITS, installPack, planInstall, validatePack } from './packs.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const manifest = (extra) => JSON.stringify(Object.assign({ format: 1, id: 'demo-pack', name: 'Demo pack', version: '0.1.0', description: 'A pack for the tests.' }, extra))
const skillText = (name) => '---\nname: ' + name + '\ndescription: "Writes the morning brief."\n---\n\n# ' + name + '\n\nRead the calendar, then write three lines.\n'
const automation = (extra) => JSON.stringify(Object.assign({ name: 'Morning brief', prompt: 'Write my morning brief.', schedule: { mode: 'cron', cron: '0 8 * * 1-5' } }, extra))
const files = (...pairs) => ({ files: pairs.map(([path, content]) => ({ path, content })) })
const full = () => files(
  ['pack.json', manifest({ host: 'Demo app', needs: { connectors: ['gmail', 'googlecalendar'] }, skills: ['morning-brief'], automations: ['morning-brief'], never: ['Send an email without asking you.'] })],
  ['skills/morning-brief/SKILL.md', skillText('morning-brief')],
  ['automations/morning-brief.json', automation()],
  ['triggers/zapier.md', '# Start it from Zapier\n\nPost to the automation URL.\n'],
  ['README.md', '# Demo pack\n']
)
const refused = (pack, reason, label) => {
  const v = validatePack(pack)
  assert.equal(v.ok, false, label + ': should be refused')
  assert.equal(v.reason, reason, label + ': ' + JSON.stringify(v))
  ok('refused: ' + label + ' (' + reason + ')')
}

// 1. the empty pack
{
  const v = validatePack(files(['pack.json', manifest()]))
  assert.equal(v.ok, true, JSON.stringify(v))
  assert.deepEqual([v.skills.length, v.automations.length, v.connectors.length, v.never.length], [0, 0, 0, 0])
  const calls = []
  const r = await installPack(v, {
    state: async () => ({}),
    writeSkill: async () => calls.push('skill'),
    createAutomation: async () => calls.push('automation'),
    record: async (rec) => calls.push(rec)
  })
  assert.equal(r.ok, true)
  assert.deepEqual(calls, [{ id: 'demo-pack', version: '0.1.0', skills: [], automations: [] }])
  assert.equal(r.plan.ready, true)
  ok('an empty pack is valid, installs nothing, and is recorded once')
}

// 2. a pack with a skill, an automation and connectors
{
  const v = validatePack(full())
  assert.equal(v.ok, true, JSON.stringify(v))
  assert.equal(v.host, 'Demo app')
  assert.deepEqual(v.triggers, ['zapier'])
  assert.equal(v.skills[0].files[0].path, 'SKILL.md')
  const order = []
  const written = []
  const r = await installPack(v, {
    state: async () => ({ connected: ['gmail'], skills: {}, automations: [] }),
    writeSkill: async (name, f) => { order.push('skill:' + name); written.push(f) },
    createAutomation: async (task) => { order.push('automation:' + task.name); written.push(task) },
    record: async () => order.push('record')
  })
  assert.equal(r.ok, true)
  assert.deepEqual(order, ['skill:morning-brief', 'automation:Morning brief', 'record'])
  assert.equal(r.plan.ready, false)
  assert.deepEqual(r.plan.connectors, [{ slug: 'gmail', connected: true }, { slug: 'googlecalendar', connected: false }])
  const task = written[1]
  assert.equal(task.active, false)
  assert.equal(task.approvals, 'ask')
  assert.equal(task.assistant, undefined)
  assert.deepEqual(task.schedule, { mode: 'cron', cron: '0 8 * * 1-5' })
  ok('a full pack installs in order, paused, asking first, not callable; a missing connector is said, not fatal')
}

// 3. what is left alone
{
  const v = validatePack(full())
  for (const [at, action] of [['same', 'current'], ['different', 'keep'], ['disabled', 'disabled']]) {
    const plan = planInstall(v, { skills: { 'morning-brief': at }, automations: ['  morning BRIEF '] })
    assert.equal(plan.skills[0].action, action, at)
    assert.equal(plan.automations[0].action, 'exists')
  }
  const calls = []
  await installPack(v, { state: async () => ({ skills: { 'morning-brief': 'different' }, automations: ['Morning brief'] }), writeSkill: async () => calls.push('s'), createAutomation: async () => calls.push('a'), record: async () => calls.push('r') })
  assert.deepEqual(calls, ['r'])
  ok('an edited or switched-off skill and an existing automation are never overwritten or doubled')
}

// 4. refusals
refused({ files: [] }, 'no_manifest', 'no files')
refused(files(['README.md', 'x']), 'no_manifest', 'no manifest')
refused(files(['pack.json', '{nope']), 'manifest_json', 'manifest that is not JSON')
refused(files(['pack.json', '[]']), 'manifest_json', 'manifest that is not an object')
refused(files(['pack.json', manifest({ format: 2 })]), 'format', 'unknown format')
refused(files(['pack.json', manifest({ install: 'rm -rf /' })]), 'manifest_key', 'unknown manifest key')
refused(files(['pack.json', manifest({ id: 'Demo Pack' })]), 'id', 'bad id')
refused(files(['pack.json', manifest({ id: 'con' })]), 'id', 'a Windows device name as id')
refused(files(['pack.json', manifest({ version: '1.0' })]), 'version', 'bad version')
refused(files(['pack.json', manifest({ description: 'a\nb' })]), 'description', 'description on two lines')
refused(files(['pack.json', manifest({ name: '<b>x</b>' })]), 'name', 'markup in the name')
refused(files(['pack.json', manifest({ needs: { connectors: ['Gmail'] } })]), 'needs', 'connector slug in capitals')
refused(files(['pack.json', manifest({ needs: { token: 'x' } })]), 'needs', 'a key other than connectors in needs')
refused(files(['pack.json', manifest({ needs: { connectors: ['a', 'a'] } })]), 'needs', 'the same connector twice')
refused(files(['pack.json', manifest({ demo: 'demo.md' })]), 'demo', 'a demo that is not there')
refused(files(['pack.json', manifest(), ], ['run.sh', '#!/bin/sh\n']), 'unexpected_file', 'a file outside the layout')
refused(files(['pack.json', manifest()], ['skills/x/SKILL.md', skillText('x')]), 'unexpected_file', 'a skill folder the manifest does not list')
refused(files(['pack.json', manifest({ skills: ['ghost'], never: ['n'] })]), 'skills', 'a listed skill with no folder')
refused(files(['pack.json', manifest({ automations: ['ghost'], never: ['n'] })]), 'automations', 'a listed automation with no file')
refused(files(['pack.json', manifest({ skills: ['morning-brief'] })], ['skills/morning-brief/SKILL.md', skillText('morning-brief')]), 'never', 'a pack with a skill and no statement of what it never does')
refused(files(['pack.json', manifest({ skills: ['morning-brief'], never: ['n'] })], ['skills/morning-brief/SKILL.md', skillText('other-name')]), 'skill_frontmatter', 'a skill whose frontmatter name differs')
refused(files(['pack.json', manifest({ skills: ['con'], never: ['n'] })], ['skills/con/SKILL.md', skillText('con')]), 'unexpected_file', 'a skill folder named like a Windows device')
{
  const withAuto = (extra, label, reason) => refused(files(['pack.json', manifest({ automations: ['a'], never: ['n'] })], ['automations/a.json', automation(extra)]), reason, label)
  withAuto({ active: true }, 'an automation that switches itself on', 'automation_key')
  withAuto({ approvals: 'auto' }, 'an automation that sets its own approval mode', 'automation_key')
  withAuto({ trigger: { type: 'webhook', hookId: 'hk_1', secret: 's' } }, 'an automation that carries a webhook secret', 'automation_key')
  withAuto({ assistant: { callable: true } }, 'an automation that makes itself callable', 'automation_key')
  withAuto({ name: '' }, 'an automation with no name', 'automation_name')
  withAuto({ prompt: '  ' }, 'an automation with no prompt', 'automation_prompt')
  withAuto({ schedule: { mode: 'once', at: '2030-01-01T08:00' } }, 'a one-off date', 'automation_schedule')
  withAuto({ schedule: { mode: 'cron' } }, 'a cron schedule with no cron', 'automation_schedule')
  withAuto({ schedule: { mode: 'webhook', cron: '* * * * *' } }, 'a webhook schedule with a cron', 'automation_schedule')
  withAuto({ schedule: { mode: 'cron', cron: '0 8 * * *', every: 5 } }, 'an unknown schedule key', 'automation_schedule')
}
refused(files(['pack.json', manifest()], ['README.md', 'token: ' + 'AKIA' + 'ABCDEFGHIJKLMNOP' + '\n']), 'scan_rejected', 'a secret in a document')
refused(files(['pack.json', manifest()], ['README.md', 'a\u0000b']), 'binary', 'a NUL in a file')
refused(files(['pack.json', manifest()], ['README.md', 'x'], ['readme.MD', 'y']), 'bad_path', 'two paths that differ only by case')
refused(files(['pack.json', manifest()], ['../x.md', 'x']), 'bad_path', 'a path that climbs out')
refused(files(['pack.json', manifest()], ['README.md', 'x'.repeat(PACK_LIMITS.fileBytes + 1)]), 'file_too_large', 'a file over the limit')
refused({ files: Array.from({ length: PACK_LIMITS.files + 1 }, (_, i) => ({ path: 'f' + i + '.md', content: '' })) }, 'too_many_files', 'too many files')

// 5. one failure does not stop the rest
{
  const v = validatePack(full())
  const seen = []
  const r = await installPack(v, {
    state: async () => ({}),
    writeSkill: async () => { throw new Error('disk full') },
    createAutomation: async (task) => seen.push(task.name),
    record: async () => seen.push('record')
  })
  assert.equal(r.ok, false)
  assert.deepEqual(seen, ['Morning brief'])
  assert.deepEqual(r.errors, [{ kind: 'skill', name: 'morning-brief', error: 'disk full' }])
  ok('a failed skill is reported, the automation is still made, and the pack is not recorded as installed')
}

console.log('\n' + pass + ' checks passed')
