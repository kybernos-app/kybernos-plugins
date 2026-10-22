#!/usr/bin/env node
/** The chats of the « Pinned » section look like the chats under a workspace (2026-10-15).
 *
 *  Reported: pinned chats were 28px rows of 13px text with no icon, starting at x=24, while the same chats under a
 *  workspace are 32px rows of 14px text with their category icon (icon at x=40, text at x=60). Measured on the real
 *  GUI: native row left 12, title left 40, 14px/20px, radius 12; pinned row left 12, text padding 12, 13px, radius 8.
 *
 *  Two bundles are involved, so two halves are pinned here:
 *    - kybernos-plugin draws the Pinned section (`.kbpin_*`): its geometry must be the native one;
 *    - kybernos-sessions owns the category icon: it must recognise a Pinned row (same session id, other attribute)
 *      and decorate it the way it decorates a native row.
 *  Source-level: the bundles are browser modules, not importable here.
 *
 *  Usage: node packages/kybernos-plugin/test-pinned-rows.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))
const plugin = readFileSync(process.env.KB_PLUGIN_CLIENT || join(here, 'client.js'), 'utf8')
const sessionsFile = process.env.KB_SESSIONS_CLIENT || join(here, '..', 'kybernos-sessions', 'client.js')
if (!existsSync(sessionsFile)) { console.log('SKIPPED: the two-sided pinned-rows checks — kybernos-sessions is not next to this bundle'); process.exit(0) }
const sessions = readFileSync(sessionsFile, 'utf8')

// The CSS rule of a selector, as the Pinned section injects it (one array entry per rule).
const rule = (sel) => {
  const at = plugin.indexOf("'" + sel + '{')
  assert.ok(at >= 0, sel + ' is declared')
  return plugin.slice(at + 1, plugin.indexOf("'", at + 1))
}

// 1. geometry: the native session row — the same height and text size as it (both follow the chat text size since 2026-10-18: 2.2 text heights, the
//    chat text size; 32px and 14px before), icon 28px in from the row edge, radius 12.
{
  const open = rule('.kbpin_open')
  assert.match(open, /height:calc\(var\(--dsh-content-font-size,13px\)\*2\.2\)/, 'a pinned row is 2.2 text heights high like a session row')
  assert.match(open, /line-height:calc\(var\(--dsh-content-font-size,13px\)\*2\.2\)/, 'its text is centred in it')
  assert.match(open, /font-size:var\(--dsh-content-font-size,13px\)/, 'its text is the chat text size like a session row')
  assert.match(open, /padding:0 8px 0 28px/, 'its icon starts where a session row\'s icon starts (28px in from the row edge)')
  assert.match(open, /border-radius:12px/)
  assert.match(rule('.kbpin_row'), /border-radius:12px/, 'the row hover has the native radius')
  ok('a pinned row has the geometry of a session row (2.2 text heights, chat text size, icon 28px in, radius 12)')
}

// 2. rhythm: two rows of one group are 2px apart (they were flush), like the native list.
{
  assert.ok(/'\.kbpin_group>\.kbpin_row\+\.kbpin_row\{margin-top:2px\}'/.test(plugin), 'rows of a group are 2px apart')
  assert.match(rule('.kbpin_threads>*+*'), /margin-top:2px/, 'the grouped rows keep their 2px')
  ok('the rows of the Pinned section are 2px apart like the session list')
}

// 2b. R-A5-02: in the 44 px icon rail the « No pins yet » hint wrapped one word per line under the page icons: it is not drawn there.
{
  assert.ok(plugin.includes("'[class*=\"collapsed\"] .kbpin_empty{display:none}'"), 'the empty hint is hidden when the sidebar is the icon rail')
  ok('the empty-state hint of the Pinned section is hidden in the icon rail')
}

// 3. the contract between the two bundles: what one writes, the other reads.
{
  assert.ok(/row\.className = 'kbpin_row'/.test(plugin) && /setAttribute\('data-kbpin-kind', kind\)/.test(plugin) && /setAttribute\('data-kbpin-id', id\)/.test(plugin), 'the Pinned section marks its rows with kind and id')
  assert.ok(/open\.className = 'kbpin_open'/.test(plugin), 'the title of a pinned row is .kbpin_open')
  assert.ok(sessions.includes('data-kbpin-id') && sessions.includes('data-kbpin-kind'), 'the sessions bundle reads the id and the kind of a pinned row')
  assert.ok(/querySelector\('\.kbpin_open'\)/.test(sessions), 'it finds the title element of a pinned row')
  assert.ok(/\.kbpin_row\[data-kbpin-kind="session"\]/.test(sessions), 'its sweep covers the pinned session rows')
  ok('both bundles agree on the pinned row markup (.kbpin_row, data-kbpin-kind/id, .kbpin_open)')
}

// 4. behaviour: the session id of a row, native or pinned (the function is cut out of the bundle and run as it is).
{
  const at = sessions.indexOf('const idDeLigne = (ligne) => {')
  assert.ok(at >= 0, 'idDeLigne was found')
  let depth = 0
  let i = sessions.indexOf('{', at + 'const idDeLigne = (ligne) => '.length - 1)
  const from = i
  for (; i < sessions.length; i += 1) {
    if (sessions[i] === '{') depth += 1
    else if (sessions[i] === '}') { depth -= 1; if (depth === 0) break }
  }
  const body = sessions.slice(at, i + 1)
  assert.ok(from > at, 'the function body was cut')
  const ctx = vm.createContext({})
  vm.runInContext(body + '\n;globalThis.idDeLigne = idDeLigne', ctx)
  const idDeLigne = ctx.idDeLigne
  const el = (attrs) => ({ getAttribute: (k) => (k in attrs ? attrs[k] : null) })
  assert.equal(idDeLigne(el({ 'data-row-key': 'session:session-abc' })), 'session-abc', 'a native row')
  assert.equal(idDeLigne(el({ 'data-kbpin-kind': 'session', 'data-kbpin-id': 'session-abc' })), 'session-abc', 'a pinned session row')
  assert.equal(idDeLigne(el({ 'data-kbpin-kind': 'workspace', 'data-kbpin-id': 'ws-1' })), '', 'a pinned workspace is not a session')
  assert.equal(idDeLigne(el({})), '', 'a row with no key')
  assert.equal(idDeLigne(null), '')
  ok('a pinned session row gives the same session id as its native row')
}

// 5. the status dots (2026-10-22): a running chat showed no spinner in this section while its native row did. The choice of the dot is cut out of the bundle and run as it is.
{
  const a = plugin.indexOf('// <pins-status:begin>')
  const b = plugin.indexOf('// <pins-status:end>')
  assert.ok(a >= 0 && b > a, 'the pure block of the status dots was found')
  const ctx = vm.createContext({})
  vm.runInContext(plugin.slice(a, b) + '\n;globalThis.kbPinsStateOf = kbPinsStateOf; globalThis.kbPinsSubagentsRunning = kbPinsSubagentsRunning; globalThis.kbPinsPick = kbPinsPick', ctx)
  const { kbPinsStateOf, kbPinsSubagentsRunning, kbPinsPick } = ctx
  const state = (...args) => { const r = kbPinsStateOf(...args); return r === null ? null : r.state + ':' + r.label }
  assert.equal(state(undefined, undefined, 0), null, 'an idle chat shows nothing')
  assert.equal(state({ running: false }, true, 0), null, 'the status Map wins over the sessions store')
  assert.equal(state({ running: true }, false, 0), 'ongoing:Running', 'a running chat: the spinner')
  assert.equal(state(undefined, true, 0), 'ongoing:Running', 'the sessions store\'s flag is used when the Map has no entry')
  assert.equal(state({ completionUnread: true }, undefined, 0), 'done:Completed', 'a finished chat nobody has read: the green dot')
  assert.equal(state({ pendingInteraction: { kind: 'approval' } }, undefined, 0), 'warning:Waiting for approval')
  assert.equal(state({ pendingInteraction: { kind: 'plan-review' } }, undefined, 0), 'warning:Plan awaiting review')
  assert.equal(state({ pendingInteraction: { kind: 'question' } }, undefined, 0), 'warning:Waiting for answer')
  assert.equal(state({ pendingInteraction: { kind: 'approval' }, running: true, completionUnread: true }, true, 2), 'warning:Waiting for approval', 'a pending interaction outranks everything')
  assert.equal(state({ running: true, completionUnread: true }, true, 0), 'ongoing:Running', 'activity outranks the completion reminder')
  assert.equal(state({ pendingInteraction: { kind: 'something-new' } }, undefined, 0), null, 'a kind DSH does not show shows nothing')
  assert.equal(state({ running: false }, undefined, 2), 'ongoing:Subagents running', 'a chat idle itself but with sub-agents running is still ongoing')
  assert.equal(state({ running: false, completionUnread: true }, undefined, 1), 'ongoing:Subagents running', 'and that outranks the completion reminder')
  assert.equal(state(null, null, 0), null, 'nulls are idle')
  // ids: the stores hold the bare uuid and the prefixed form.
  assert.equal(kbPinsPick(new Map([['session-abc', 1]]), 'abc'), 1, 'a bare id finds the prefixed key')
  assert.equal(kbPinsPick(new Map([['abc', 2]]), 'session-abc'), 2, 'a prefixed id finds the bare key')
  assert.equal(kbPinsPick({ 'session-abc': 3 }, 'session-abc'), 3, 'a plain object works too')
  assert.equal(kbPinsPick(null, 'abc'), undefined)
  // sub-agents: the catalogue's children, by the status Map first, else by the sessions store.
  const list = { projectionsBySession: { 'session-p': { values: { subagentCatalog: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }, null] } } }, byId: { c2: { running: true }, c3: { running: false } } }
  const statuses = new Map([['c1', { running: true }], ['c3', { running: true }]])
  assert.equal(kbPinsSubagentsRunning(list, statuses, 'session-p'), 3, 'c1 and c3 by the Map, c2 by the store')
  assert.equal(kbPinsSubagentsRunning(list, statuses, 'session-none'), 0, 'no catalogue, none running')
  assert.equal(kbPinsSubagentsRunning(null, statuses, 'x'), 0, 'a missing store is zero, never a throw')
  ok('the status dot of a pinned row follows DSH\'s own order (pending, running or sub-agents, completed, idle) and finds the session under either id form')
}
{
  assert.ok(/kbPinsCtx\.get\('uiSession'\)/.test(plugin) && /svc\.sessionStatus/.test(plugin), 'the source is DSH\'s session-status service')
  assert.ok(/src\.subscribe\(\(\) => kbPinsEmit\(\)\)/.test(plugin) && /kbPinsWatchStatus\(\)\n  for \(const el of/.test(plugin), 'a status change refreshes the section, subscribed on each scan until the service is there')
  assert.ok(/data-kbpin-sig'\) === sig\) \{ kbPinsStatusApply\(section\); return \}/.test(plugin), 'the dots are updated in place even when the rows did not change (no rebuild under the user\'s fingers)')
  assert.ok(/section\.appendChild\(rows\)\n  kbPinsStatusApply\(section\)/.test(plugin), 'and after a rebuild')
  assert.match(rule('.kbpin_state'), /position:absolute;inset-inline-start:8px;[^']*pointer-events:none/, 'the dot sits in the free 28px at the row\'s start and takes no click')
  assert.ok(/appendChild\(kbPinsDot\(st\)\)/.test(plugin) && /class', 'kbm-dot-spinner'/.test(plugin) && /className = 'kbm-dot'/.test(plugin), 'the spinner and the dot are the shared design-system classes')
  assert.ok(!/\.kbpin_state[^']*\{[^}]*animation/.test(plugin), 'no animation of its own: the shared spinner animates itself')
  for (const k of ['En cours', 'En attente d’approbation', 'Plan à relire', 'En attente de réponse', 'Conversation terminée', 'Sous-agents en cours']) assert.ok(plugin.includes("'" + k + "': '"), 'the French twin « ' + k + ' » exists')
  ok('the dots are wired to DSH\'s status, updated in place, drawn in the free left slot with the shared classes, and have their French twins')
}

console.log('\n' + pass + ' checks passed')
