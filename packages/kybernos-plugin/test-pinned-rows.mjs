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
  vm.runInContext(plugin.slice(a, b) + '\n;globalThis.kbPinsStateOf = kbPinsStateOf; globalThis.kbPinsSubagentsRunning = kbPinsSubagentsRunning; globalThis.kbPinsPick = kbPinsPick; globalThis.kbPinsWorkspaceStates = kbPinsWorkspaceStates', ctx)
  const { kbPinsStateOf, kbPinsSubagentsRunning, kbPinsPick, kbPinsWorkspaceStates } = ctx
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

  // The folder row of a workspace (2026-11-02): a chat that runs or has delivered must be visible in the menu even while its folder is folded.
  const items = [
    { workspaceId: 'w-idle', sessionIds: ['s1', 's2'] },
    { workspaceId: 'w-run', sessionIds: ['s1', 'session-s3'] },
    { workspaceId: 'w-done', sessionIds: ['s4'] },
    { workspaceId: 'w-ask', sessionIds: ['s5', 's6', 's7'] },
    { workspaceId: 'w-arch', sessionIds: ['s8'] },
    { workspaceId: 'w-store', sessionIds: ['s9'] },
    { workspaceId: 'w-sub', sessionIds: ['p'] },
    null, { workspaceId: 7, sessionIds: [] }, { workspaceId: 'w-nolist' },
  ]
  const live = new Map([['s3', { running: true }], ['session-s4', { completionUnread: true }], ['s5', { running: true }], ['s6', { pendingInteraction: { kind: 'approval' } }], ['s7', { completionUnread: true }], ['s8', { completionUnread: true }]])
  const store = { byId: { s9: { running: true } }, projectionsBySession: { p: { values: { subagentCatalog: [{ id: 'kid' }] } } } }
  const states = kbPinsWorkspaceStates(items, new Map([...live, ['kid', { running: true }]]), store, new Set(['s8']))
  assert.equal(states.get('w-idle'), undefined, 'a workspace of idle chats has no dot')
  assert.equal(states.get('w-run'), 'ongoing', 'a running chat lights its folder, whichever id form the registry holds')
  assert.equal(states.get('w-done'), 'done', 'a chat that delivered and was not read: the green dot')
  assert.equal(states.get('w-ask'), 'warning', 'a chat waiting for the person outranks a running one and a delivered one in the same folder')
  assert.equal(states.get('w-arch'), undefined, 'an archived chat is out of the menu and lights nothing')
  assert.equal(states.get('w-store'), 'ongoing', 'a chat only the sessions store knows as running still counts')
  assert.equal(states.get('w-sub'), 'ongoing', 'a chat idle itself with a sub-agent running counts')
  assert.equal(states.size, 5, 'the null item, the item with a numeric id and the one without sessions are skipped')
  assert.equal(kbPinsWorkspaceStates(items, null, null, null).size, 0, 'no status service, no dot, no throw')
  assert.equal(kbPinsWorkspaceStates(null, live, store, null).size, 0)
  ok('a workspace folder shows the most pressing dot among its chats (waiting, running, delivered), counts neither idle nor archived chats, and never throws')
}
{
  assert.ok(/row\.setAttribute\('data-kb-live', liveState\)/.test(plugin) && /row\.removeAttribute\('data-kb-live'\)/.test(plugin), 'the folder row carries the state as an attribute (React never rewrites it) and loses it when the chats go idle')
  assert.ok(/rowKey\.indexOf\('workspace:'\) === 0/.test(plugin), 'the row is matched to its workspace by DSH\'s own row key, not by the folder\'s name')
  const css = /const KB_SIDEBAR_LIVE_CSS = ([^\n]*\n[^\n]*\n[^\n]*)\n/.exec(plugin)
  assert.ok(css !== null, 'the dot has its own rule')
  assert.ok(/::after\{content:"";position:absolute/.test(css[1]) && /pointer-events:none/.test(css[1]), 'a pseudo-element that takes no click, so the folder keeps its own gestures')
  assert.ok(/state-success-primary/.test(css[1]) && /state-warning-primary/.test(css[1]), 'green for running and delivered, amber for waiting, from the design tokens')
  assert.ok(/src\.subscribe\(\(\) => \{ kbDecorLast = 0; tick\(\) \}\)/.test(plugin), 'a status change repaints the folder dot at once, past the 400 ms throttle')
  assert.ok(/styles\.insert\(KB_SIDEBAR_LIVE_CSS\)/.test(plugin) && /killLiveCss\(\)/.test(plugin), 'the rule is injected with the effect and removed with it')
  ok('the folder dot is wired: attribute from DSH\'s row key, token-coloured pseudo-element, repaint on every status change, cleaned up with the effect')
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

// 6. the rename of a pinned chat (2026-11-24, item 10 of the owner's list): the new title is shown at once, a refusal puts the old one back AND says why under the row
//    (it used to end in console.warn only). The pure block is cut out of the bundle and run as it is.
{
  const a = plugin.indexOf('// <pins-rename:begin>')
  const b = plugin.indexOf('// <pins-rename:end>')
  assert.ok(a >= 0 && b > a, 'the pure block of the rename was found')
  const ctx = vm.createContext({})
  vm.runInContext(plugin.slice(a, b) + '\n;Object.assign(globalThis, { kbPinsHeldTitle, kbPinsNoticeOf, kbPinsReason, kbPinsRenameRun, KB_PINS_HOLD_MS, KB_PINS_NOTICE_MS })', ctx)
  const { kbPinsHeldTitle, kbPinsNoticeOf, kbPinsReason, kbPinsRenameRun, KB_PINS_HOLD_MS, KB_PINS_NOTICE_MS } = ctx
  const say = (r) => 'Could not rename: ' + r
  const rig = (call) => {
    const t = { now: 1000, emits: 0, later: [], seen: [] }
    const run = (id, title) => kbPinsRenameRun(id, title, (i, ti) => { t.seen.push(['call', i, ti, kbPinsHeldTitle(i, 'Old', t.now)]); return call(i, ti) }, () => { t.emits += 1 }, say, () => t.now, (fn, ms) => t.later.push(ms))
    return { t, run }
  }
  // accepted: the typed title is shown while the call runs, then until the store shows it
  {
    const { t, run } = rig(async () => {})
    const res = await run('session-aaa', 'New title')
    assert.equal(res, true, 'an accepted rename resolves true')
    assert.deepEqual(t.seen[0], ['call', 'session-aaa', 'New title', 'New title'], 'the new title is on screen while the engine call runs')
    assert.equal(kbPinsHeldTitle('session-aaa', 'Old', t.now + 5), 'New title', 'the store still says the old title: the new one is held')
    assert.equal(kbPinsHeldTitle('aaa', 'Old', t.now + 5), 'New title', 'the bare id and the prefixed id are the same chat')
    assert.equal(kbPinsHeldTitle('session-aaa', 'New title', t.now + 6), 'New title', 'the store caught up: it is shown')
    assert.equal(kbPinsHeldTitle('session-aaa', 'Old', t.now + 7), 'Old', '…and the hold is released')
    assert.ok(t.emits >= 1 && t.later.length === 1, 'the section is redrawn at once and once more when the hold would run out')
    assert.equal(kbPinsNoticeOf('session-aaa', t.now), null, 'nothing is said when the engine accepted')
  }
  // a hold that the store never confirms runs out
  {
    const { t, run } = rig(async () => {})
    await run('session-hold', 'Typed')
    assert.equal(kbPinsHeldTitle('session-hold', 'Old', t.now + KB_PINS_HOLD_MS - 1), 'Typed')
    assert.equal(kbPinsHeldTitle('session-hold', 'Old', t.now + KB_PINS_HOLD_MS), 'Old', 'after the hold the store is the truth')
  }
  // refused: the old title is back and the reason is said under the row
  {
    const { t, run } = rig(async () => { throw new Error('  the engine\n said   no ') })
    const res = await run('session-bbb', 'Refused title')
    assert.equal(res, false, 'a refused rename resolves false (it does not throw)')
    assert.equal(kbPinsHeldTitle('session-bbb', 'Old', t.now), 'Old', 'rollback: the old title is shown again')
    assert.equal(kbPinsNoticeOf('session-bbb', t.now), 'Could not rename: the engine said no', 'the reason is kept for the row, on one line')
    assert.equal(kbPinsNoticeOf('session-bbb', t.now + KB_PINS_NOTICE_MS - 1) !== null, true, 'it stays long enough to be read')
    assert.equal(kbPinsNoticeOf('session-bbb', t.now + KB_PINS_NOTICE_MS), null, '…then goes')
    assert.ok(t.emits >= 2 && t.later.length === 1, 'redrawn at once (title) and again when the notice goes')
  }
  // a new try clears the old notice; no message / odd throws
  {
    const bad = rig(async () => { throw new Error('x') })
    await bad.run('session-ccc', 'A')
    assert.notEqual(kbPinsNoticeOf('session-ccc', bad.t.now), null)
    const good = rig(async () => {})
    await good.run('session-ccc', 'B')
    assert.equal(kbPinsNoticeOf('session-ccc', good.t.now), null, 'a new rename wipes the previous refusal')
    assert.equal(kbPinsReason(new Error('')), '', 'no message: nothing is invented here (the caller says the plain sentence)')
    assert.equal(kbPinsReason({ code: 7 }), '', 'an object with no message says nothing')
    assert.equal(kbPinsReason(null), '')
    assert.equal(kbPinsReason('plain text'), 'plain text', 'a string is its own reason')
    assert.equal(kbPinsReason(new Error('y'.repeat(300))).length, 140, 'a long reason is cut to 140 characters')
    const odd = rig(async () => { throw undefined }) // eslint-disable-line no-throw-literal
    assert.equal(await odd.run('session-ddd', 'C'), false, 'even a bare `throw undefined` is a refusal')
    assert.equal(kbPinsNoticeOf('session-ddd', odd.t.now), 'Could not rename: ', 'with an empty reason (the bundle\'s own say() then picks the plain sentence)')
  }
  // wiring, source level
  assert.ok(/kbPinsRenameRun\(id, value, kbPinsRenameCall, kbPinsEmit, kbPinsSayRename, \(\) => Date\.now\(\), \(fn, ms\) => setTimeout\(fn, ms\)\)/.test(plugin), 'the inline editor runs the rename through kbPinsRenameRun')
  assert.ok(!plugin.includes("console.warn('[kybers] rename refused'"), 'a refusal is no longer only a console.warn')
  assert.ok(/kbPinsHeldTitle\(sid, sessionTitle\(sid\), Date\.now\(\)\)/.test(plugin) && /notice: kbPinsNoticeOf\(sid, Date\.now\(\)\)/.test(plugin), 'the section model shows the held title and carries the notice (so the signature changes and the section is redrawn)')
  assert.ok(/note\.className = 'kbpin_notice'\n\s+note\.setAttribute\('role', 'alert'\)/.test(plugin), 'the reason is drawn under its row, as an alert')
  assert.match(rule('.kbpin_notice'), /color:var\(--dsw-alias-state-error-primary\)/, 'in the error colour')
  assert.ok(/console\.warn\('\[kybers\] a pinned-section subscriber failed/.test(plugin), 'a failing subscriber of kbPinsEmit is said, the others still run')
  assert.ok(/throw new Error\(kbt\('kbpin\.rename\.noservice'\)\)/.test(plugin) && /kbt\('kbpin\.rename\.refused'\)/.test(plugin), 'the two errors of kbPinsRenameCall are plain words')
  for (const lang of ['en', 'fr']) {
    const dict = JSON.parse(readFileSync(join(here, 'i18n', lang + '.json'), 'utf8'))
    for (const k of ['kbpin.rename.failed', 'kbpin.rename.failed.plain', 'kbpin.rename.noservice', 'kbpin.rename.refused']) assert.ok(typeof dict[k] === 'string' && dict[k].length > 0, lang + ' has ' + k)
    assert.ok(dict['kbpin.rename.failed'].includes('{reason}'), lang + ': the sentence has a place for the reason')
  }
  ok('the rename shows the new title at once, rolls back on a refusal and says why under the row; the bundle plays that block as it is')
}

// 7. the dots' source (2026-11-24, list item 10): since engine 0.2.2-rc.2 `uiSession.sessionStatus` is a service of its own and a plain read THROWS
//    (« cannot get property "uiSession.sessionStatus" without inject »). The read was swallowed, so the spinner never showed. The handle `ctx.inject` gives is the source now.
{
  const a = plugin.indexOf('const kbPinsStatusUsable')
  const b = plugin.indexOf('/** The dot of each workspace folder row')
  const c = plugin.indexOf('let kbPinsStatusWatched = false')
  const d = plugin.indexOf('/** A mutation made inside OUR section')
  assert.ok(a > 0 && b > a && c > b && d > c, 'the source and its adoption are found')
  const ctx = vm.createContext({})
  vm.runInContext('let kbPinsCtx = null; let emitted = 0; const kbPinsEmit = () => { emitted += 1 }\n' + plugin.slice(a, b) + '\n' + plugin.slice(c, d) +
    '\n;Object.assign(globalThis, { kbPinsStatusSource, kbPinsStatusAdopt, setCtx: (v) => { kbPinsCtx = v }, emitted: () => emitted })', ctx)
  const status = (log) => ({ getSnapshot: () => new Map(), subscribe: () => { log.push('on'); return () => { log.push('off') } } })
  // an engine of 0.2.2-rc.2 or later, the plugin not injected: the property throws
  const strict = { get: () => ({ get sessionStatus() { throw new Error('cannot get property "uiSession.sessionStatus" without inject') } }) }
  ctx.setCtx(strict)
  assert.equal(ctx.kbPinsStatusSource(), null, 'an uninjected read gives no source (and does not throw)')
  // the injected handle arrives: it is the source, it is subscribed once, the dots are drawn again
  const log = []
  const mine = status(log)
  ctx.kbPinsStatusAdopt(mine)
  assert.equal(ctx.kbPinsStatusSource(), mine, 'the injected service is the source')
  assert.deepEqual(log, ['on'], 'one subscription')
  assert.equal(ctx.emitted(), 1, 'the section is drawn again at once')
  // a replacement (hot reload): the old subscription is dropped before the new one is taken
  const log2 = []
  const next = status(log2)
  ctx.kbPinsStatusAdopt(next)
  assert.deepEqual(log, ['on', 'off'], 'the old subscription is dropped')
  assert.deepEqual(log2, ['on'], 'the new one is taken')
  assert.equal(ctx.kbPinsStatusSource(), next)
  // the service goes: no source again, subscription dropped
  ctx.kbPinsStatusAdopt(null)
  assert.deepEqual(log2, ['on', 'off'])
  assert.equal(ctx.kbPinsStatusSource(), null, 'the service is gone: no dot, no error')
  // something that is not a status service is refused
  ctx.kbPinsStatusAdopt({ getSnapshot: () => new Map() })
  assert.equal(ctx.kbPinsStatusSource(), null, 'a handle without subscribe is no source')
  // an engine older than 0.2.2-rc.2: the status is a plain property of uiSession
  const old = status([])
  ctx.setCtx({ get: () => ({ sessionStatus: old }) })
  assert.equal(ctx.kbPinsStatusSource(), old, 'an older engine still reads the property')
  // wired: a sub-plugin asks for the service (`uiSession` itself too: the guard refuses a root that is not declared), out of the module's own inject
  assert.ok(/ctx\.inject\(\['uiSession', 'uiSession\.sessionStatus'\], \(scope\) => \{/.test(plugin) && /kbPinsStatusAdopt\(ui !== undefined && ui !== null \? ui\.sessionStatus : null\)/.test(plugin), 'the bundle injects the status service and adopts it')
  assert.ok(/return \(\) => \{ kbPinsStatusAdopt\(null\) \}/.test(plugin), 'and lets it go with the effect')
  assert.ok(!/^  inject: \[[^\]]*uiSession/m.test(plugin), 'the module itself does not require it: an engine without the service must not hold the bundle back')
  assert.ok(!/ctx\.get\('uiSession'\)\.sessionStatus/.test(plugin), 'no other place reads the status without the injected handle')
  ok('the dots read the injected status service (an uninjected read throws on engine 0.2.2-rc.2+), an older engine still works, a replacement or a loss drops the old subscription')
}

console.log('\n' + pass + ' checks passed')
