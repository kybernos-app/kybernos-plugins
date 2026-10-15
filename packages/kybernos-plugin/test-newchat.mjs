#!/usr/bin/env node
/** The new-chat cards (Build / Create / Cloud Computer), the Cloud Computer menu row, and the rule that hides DSH's own
 *  « Automation tasks » entry. The pure part is cut out of client.js (KB-NEWCHAT block) and run as it is; the rest is
 *  pinned at source level. The conversation starters are pinned too: they must not change.
 *
 *  Usage: node packages/kybernos-plugin/test-newchat.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, 'client.js'), 'utf8')

// ── the pure block ────────────────────────────────────────────────────────────────────────────────────────
const a = src.indexOf('// KB-NEWCHAT-BEGIN')
const b = src.indexOf('// KB-NEWCHAT-END')
assert.ok(a > 0 && b > a, 'the KB-NEWCHAT block exists')
const api = vm.runInNewContext(src.slice(a, b) + '\n;({ KB_NC_BUILD, KB_NC_CREATE, kbNcTemplates, kbNcCloud, kbNcDot, kbNcActions, kbNcRefusalKey, kbNcIsNativeSchedules, kbNcHideNative })')

// 1. templates are offered only when the bundle they need is installed
{
  const ids = (list) => JSON.parse(JSON.stringify(list.map((t) => t.id)))   // the arrays come from another realm
  assert.deepEqual(ids(api.kbNcTemplates(api.KB_NC_BUILD, [])), ['website', 'automation', 'team', 'skill', 'plugin'], 'with no satellite only the core templates')
  assert.ok(api.kbNcTemplates(api.KB_NC_BUILD, ['@local/kybernos-dashboards']).some((t) => t.id === 'dashboard'))
  assert.ok(!api.kbNcTemplates(api.KB_NC_CREATE, ['@local/kybernos-dashboards']).some((t) => t.id === 'slides'), 'a template of another bundle stays hidden')
  assert.deepEqual(ids(api.kbNcTemplates(api.KB_NC_CREATE, null)), ['doc', 'sheet', 'image'], 'no boot list reads as none')
  ok('templates follow the installed bundles (never offered dead)')
}

// 2. every template has an icon the product draws and its two strings, in both languages
{
  const all = api.KB_NC_BUILD.concat(api.KB_NC_CREATE)
  assert.equal(new Set(all.map((t) => t.id)).size, all.length, 'ids are unique')
  const lucide = src.slice(src.indexOf('const LUCIDE = {'), src.indexOf('const Icon = (name, size)'))
  for (const t of all) {
    assert.ok(new RegExp('\\n  ' + t.icon + ':').test(lucide), 'icon ' + t.icon + ' exists')
    for (const key of ['kbnc.t.' + t.id, 'kbnc.p.' + t.id]) {
      const m = new RegExp("'" + key.replace(/\./g, '\\.') + "': \\{ kybernos: '([^']+)', en: '([^']+)' \\}").exec(src)
      assert.ok(m !== null, key + ' has both languages')
    }
  }
  ok('every template has an icon and its label and prompt in French and English')
}

// 3. the Cloud Computer state, from what /kybernos-cloud/kyber answers
{
  const k = (home) => ({ ok: true, connected: true, home })
  assert.equal(api.kbNcCloud(null).kind, 'unknown')
  assert.equal(api.kbNcCloud({ ok: false }).kind, 'unknown')
  assert.equal(api.kbNcCloud({ ok: true, connected: false }).kind, 'signedout')
  assert.equal(api.kbNcCloud(k(null)).kind, 'none')
  const want = { running: 'awake', suspended: 'asleep', creating: 'starting', resuming: 'waking', suspending: 'suspending', failed: 'failed', weird: 'other' }
  for (const [state, kind] of Object.entries(want)) assert.equal(api.kbNcCloud(k({ state })).kind, kind, state)
  const full = api.kbNcCloud(k({ state: 'running', version: '1.0.0-beta.8', last_active_at: '2026-10-15T09:00:00Z', network: 'list' }))
  assert.equal(full.version, '1.0.0-beta.8'); assert.equal(full.lastActive, '2026-10-15T09:00:00Z'); assert.equal(full.network, 'list')
  assert.equal(api.kbNcCloud(k({ state: 'running', network: 'x' })).network, '', 'an unknown network mode is not shown')
  assert.equal(api.kbNcDot('awake'), 'on'); assert.equal(api.kbNcDot('asleep'), 'off'); assert.equal(api.kbNcDot('failed'), 'bad'); assert.equal(api.kbNcDot('none'), '')
  ok('the Cloud Computer state is derived from the server answer, unknown values included')
}

// 4. DSH's own « Automation tasks » entry: found by its React key, hidden unless asked back
{
  assert.equal(api.kbNcIsNativeSchedules('schedules', 'whatever'), true)
  assert.equal(api.kbNcIsNativeSchedules('plugins', 'Automation tasks'), false, 'a known other key is never matched by its label')
  assert.equal(api.kbNcIsNativeSchedules(null, 'Automation tasks'), true, 'no key readable: the label is the fallback')
  assert.equal(api.kbNcIsNativeSchedules(null, 'Plugins'), false)
  assert.equal(api.kbNcHideNative({ showNativeTasks: false }), true)
  assert.equal(api.kbNcHideNative({}), true); assert.equal(api.kbNcHideNative(null), true)
  assert.equal(api.kbNcHideNative({ showNativeTasks: true }), false)
  ok('the native Automation tasks entry is hidden by default and comes back when asked')
}

// 3b. what the person can do with the computer, from its state: never what the server would refuse
{
  const k = (home) => api.kbNcCloud({ ok: true, connected: true, home })
  const acts = (c) => JSON.parse(JSON.stringify(api.kbNcActions(c)))
  assert.deepEqual(acts(k({ state: 'running', mode: 'sleep' })), ['open', 'suspend'])
  assert.deepEqual(acts(k({ state: 'running', mode: 'always' })), ['open'], 'an always-on computer is not offered a sleep (409 always_on)')
  assert.deepEqual(acts(k({ state: 'suspended', mode: 'sleep' })), ['resume'])
  assert.deepEqual(acts(k({ state: 'stopped' })), ['resume'])
  assert.deepEqual(acts(k({ state: 'failed' })), ['resume'])
  assert.deepEqual(acts(k({ state: 'suspended', paused_reason: 'hours' })), [], 'no wake while the run hours are used up (409 run_hours_exhausted)')
  for (const state of ['creating', 'resuming', 'suspending', 'weird']) assert.deepEqual(acts(k({ state })), [], state + ': nothing to do while it moves')
  for (const c of [api.kbNcCloud(null), api.kbNcCloud({ ok: true, connected: false }), api.kbNcCloud({ ok: true, connected: true, home: null })]) assert.deepEqual(acts(c), [])
  assert.deepEqual(acts(null), [])
  assert.equal(api.kbNcCloud({ ok: true, connected: true, home: { state: 'running', mode: 'x' } }).mode, '', 'an unknown mode is not trusted')
  assert.equal(api.kbNcRefusalKey({ ok: false, error: 'always_on' }), 'always_on')
  assert.equal(api.kbNcRefusalKey({ ok: false, error: 'database exploded' }), 'refused', 'a code nobody planned is « refused », never shown')
  assert.equal(api.kbNcRefusalKey(null), 'unreachable')
  // every sentence the card can show exists in both languages
  for (const key of ['resume', 'suspend', 'open', 'busy']) assert.ok(new RegExp("'kbnc\\.cc\\.act\\." + key + "': \\{ kybernos: '[^']+', en: '[^']+' \\}").test(src), 'act.' + key)
  for (const key of ['always_on', 'run_hours_exhausted', 'computer_deleting', 'computers_off_for_workspace', 'not_allowed_to_open', 'computer_not_ready', 'owner_left', 'rate_limited', 'no_computer', 'not_connected', 'refused', 'unreachable']) {
    assert.ok(new RegExp("'kbnc\\.cc\\.err\\." + key + "': \\{ kybernos: '[^']+', en: '[^']+' \\}").test(src), 'err.' + key)
  }
  ok('the actions follow the state and never offer what the server refuses; every refusal has its sentence in both languages')
}

// ── wiring ────────────────────────────────────────────────────────────────────────────────────────────────
// 5. the starters are untouched, and the new cards sit before them in the dock
{
  assert.ok(/id: 'kybernos-starters', order: 30 \}, KbChatStarters\)/.test(src), 'the starters keep their dock entry and order')
  assert.ok(/id: 'kybernos-newchat', order: 25 \}, KbNewChatCards\)/.test(src), 'the new cards are their own dock entry, before the starters')
  const s = src.slice(src.indexOf('const KbChatStarters = (props)'), src.indexOf('const KbChatStarters = (props)') + 9000)
  assert.ok(/KBCS_PAR_PAGE = 4/.test(src) && /kbStartersFromUi\(ui\)/.test(s), 'the team starters, 4 per page, still read from ui.starters')
  assert.ok(/act\.setDraft\(texte\)[\s\S]{0,80}act\.submit\(\)/.test(s), 'a starter still SENDS')
  assert.ok(/'data-kb': 'starter'/.test(s) && /kb8-cs-card/.test(s) && /kbui\.starters\.more/.test(s), 'the starter cards and « more ideas » are as they were')
  ok('the conversation starters are untouched; the new cards are a separate dock entry before them')
}

// 6. the new cards only show on a blank chat, and a template prefills (does not send)
{
  const c = src.slice(src.indexOf('const KbNewChatCards = (props)'), src.indexOf('const KbNewChatCards = (props)') + 9000)
  assert.ok(c.length > 1000, 'the component exists')
  assert.ok(/blank !== '1'\) return null/.test(c), 'it effaces itself once the chat is not blank, like the starters')
  assert.ok(/act\.setDraft\(/.test(c) && !/act\.submit\(/.test(c), 'a template prefills the composer and never submits')
  ok('the cards show on a blank chat only and a template never sends')
}

// 6b. the card's actions: the host picks the computer, « Open » cannot be hijacked by the page it opens
{
  const c = src.slice(src.indexOf('const KbNewChatCards = (props)'), src.indexOf('const KbNewChatCards = (props)') + 14000)
  assert.ok(/fetch\('\/kybernos-cloud\/computer\/' \+ verb, \{ method: 'POST'/.test(c), 'the actions call the host, by POST')
  assert.ok(!/computer_?[Ii]d|workspace_?[Ii]d/.test(c), 'the page never names a computer or a workspace')
  assert.ok(/tab\.opener = null/.test(c), 'the tab it opens has no way back to DSH')
  assert.ok(/window\.open\('', '_blank'\)/.test(c) && /tab\.location\.href = j\.url/.test(c), 'the tab is made at the click and the address put in it afterwards')
  ok('the actions call the host only; the page never names a computer; the opened tab has no opener')
}

// 6c. the card with its two buttons gets a wider column: with equal thirds the title was cut to « Cloud ... » (seen on the sandbox)
{
  assert.ok(/\.kb8-nc-row\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\) minmax\(0,1\.6fr\)/.test(src), 'the third column (the Cloud Computer card) is wider than the first two')
  ok('the Cloud Computer card has the wider column, so its title and its buttons both fit')
}

// 7. the menu row and the hiding are wired
{
  assert.ok(/KB_KY === true \? row\('cloudcomputer'/.test(src), 'the Cloud Computer row shows with the Kyber satellite')
  assert.ok(/kbNcIsNativeSchedules\(kbNavKeyOf\(/.test(src), 'the hiding reads the row key with the nav helper')
  assert.ok(/id: 'kybernos-automations'|'kybernos-automations', \d+/.test(src), 'the Automations settings page is registered')
  ok('menu row, hiding and settings page are wired')
}

console.log('\n' + pass + ' checks passed')
