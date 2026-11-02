#!/usr/bin/env node
/** The dashboard panel belongs to the chat on screen, and a close stays a close.
 *
 *  Two defects reported by the person on 2026-10-30, both proven in the code before this fix:
 *    A. the pane asked `/state` without `strict`, and the host falls back to the last dashboard of the last chat
 *       that wrote one (dashboard-host.mjs:367-371) — so every chat showed « the last dashboard »;
 *    B. after a dashboard arrived, `WANT_OPEN_UNTIL` ran for 60 s and the 1.5 s probe called `openTab()` again
 *       whenever the panel was not on screen — which is exactly the state of a panel the person just closed.
 *
 *  This file plays the two pure guards cut out of client.js (`<kb-open-guard>`), checks the pane asks strictly and
 *  empties itself, and checks the source for the close check. The live behaviour (a chat with no dashboard shows an
 *  empty panel) needs a running GUI with two chats: it is noted in the campaign file, not claimed here.
 *
 *  Usage: node packages/kybernos-dashboards/test-open-guard.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const HERE = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(HERE, 'client.js'), 'utf8')

const BEGIN = '// <kb-open-guard>'
const END = '// </kb-open-guard>'
const from = src.indexOf(BEGIN)
const to = src.indexOf(END)
assert.ok(from >= 0 && to > from, 'client.js carries the <kb-open-guard> block')
const block = src.slice(from + BEGIN.length, to)
const { kbDashArrival, kbDashMayOpen, kbDashMemo, kbDashDecide, kbDashDismiss } = new Function(block + '\nreturn { kbDashArrival, kbDashMayOpen, kbDashMemo, kbDashDecide, kbDashDismiss }')()

// ── A. arrival: the first reading opens only for a fresh write ───────────────────────────────────────────────────
const NOW = 1000000
assert.equal(kbDashArrival(null, NOW - 5000, NOW), true, 'first reading, dashboard written 5 s ago: opens')
assert.equal(kbDashArrival(null, NOW - 60000, NOW), false, 'first reading, dashboard written a minute ago: a reload does not reopen it')
assert.equal(kbDashArrival(NOW - 5000, NOW - 1000, NOW), true, 'a new write after a first reading opens')
assert.equal(kbDashArrival(NOW - 1000, NOW - 1000, NOW), false, 'the same write is not a new arrival')
ok('an arrival is a write that is new to this page (the first one only when it is fresh)')

// ── B. may open: never for the write the person closed ──────────────────────────────────────────────────────────
assert.equal(kbDashMayOpen(NOW + 60000, 0, NOW - 5000, NOW), true, 'no close yet, window open, this write: opens')
assert.equal(kbDashMayOpen(NOW + 60000, NOW - 5000, NOW - 5000, NOW), false, 'the person closed THIS write: never reopens it')
assert.equal(kbDashMayOpen(NOW + 60000, NOW - 1000, NOW - 5000, NOW), false, 'a write older than the close: never reopens it')
assert.equal(kbDashMayOpen(NOW + 60000, NOW - 9000, NOW - 5000, NOW), true, 'a write NEWER than the close (the agent wrote again): opens')
assert.equal(kbDashMayOpen(NOW - 1, 0, NOW - 5000, NOW), false, 'the 60 s window is over: no reopen')
ok('a closed panel is reopened only by a NEW dashboard write, never by the timer')

// ── C. the pane asks strictly and empties itself ────────────────────────────────────────────────────────────────
assert.ok(src.includes("const s = await api('GET', 'state?strict=1')"), 'the pane asks /state with strict=1 (this chat only)')
assert.ok(/setCur\(\(old\) => \(old === null \? old : null\)\)/.test(src), 'the pane clears its dashboard when this chat has none')
assert.ok(/setDash\(\(old\) => \(old === null \? old : null\)\)/.test(src), 'the pane clears the rendered dashboard too')
ok('the pane never borrows another chat’s dashboard (strict + an explicit empty state)')

// ── D. a close is seen, and the session key is cleared when the chat changes ────────────────────────────────────
assert.ok(/kbDashDismiss\(memo, chat, at\)/.test(src), 'the close is remembered, per chat')
assert.ok(/armCloseCheck\(/.test(src), 'the panel is checked shortly after opening, to see whether the person closed it')
assert.ok(src.includes('kbDashDecide(memo, chat, at, Date.now(), panelShown())'), 'the open loop goes through the guard')
assert.ok(/const setSession = \(id\) => \{ SESSION_ID = typeof id === 'string' \? id : '' \}/.test(src), 'the session key is cleared, so the previous chat cannot be served')
ok('a close is recorded, the timer respects it, and the session key is cleared')

// ── E. the memory is per chat: going to another chat is not an arrival (person, 2026-11-02: it opened « tout le temps, quelle que soit la session ») ──
{
  const memo = kbDashMemo()
  const T = 5_000_000
  // chat A: the agent wrote 5 s ago and the panel is not on screen
  assert.equal(kbDashDecide(memo, 'A', T - 5000, T, false), true, 'A: a fresh write opens the panel')
  assert.equal(kbDashDecide(memo, 'A', T - 5000, T + 1500, true), false, 'A: once on screen it stays as it is')
  // the person goes to chat B, whose dashboard was written last week
  assert.equal(kbDashDecide(memo, 'B', T - 7 * 86400000, T + 6000, false), false, 'B: an old dashboard seen for the first time does not open the panel (it used to: the memory was one value for all chats)')
  assert.equal(kbDashDecide(memo, 'B', T - 7 * 86400000, T + 7500, false), false, 'B: nor on the next reading')
  // back to A, same write
  assert.equal(kbDashDecide(memo, 'A', T - 5000, T + 12000, false), false, 'A again: the write was already seen, the panel the person left closed stays closed')
  // the agent writes in A again
  assert.equal(kbDashDecide(memo, 'A', T + 13000, T + 14000, false), true, 'A: a NEW write opens it')
  // the person closes it: that write never comes back, in A
  kbDashDismiss(memo, 'A', T + 13000)
  assert.equal(kbDashDecide(memo, 'A', T + 13000, T + 16000, false), false, 'A: a close stays a close')
  // … and the close in A says nothing about B
  assert.equal(kbDashDecide(memo, 'B', T + 17000, T + 18000, false), true, 'B: its own new write opens the panel although A was closed')
  ok('a switch of chat is not an arrival; a seen write and a close are remembered per chat')
}
{
  // the minute an arrival keeps trying belongs to the chat that opened it
  const memo = kbDashMemo()
  const T = 9_000_000
  assert.equal(kbDashDecide(memo, 'A', T - 1000, T, false), true)
  assert.equal(kbDashDecide(memo, 'A', T - 1000, T + 1500, false), true, 'A: still not on screen inside the minute: tried again')
  assert.equal(kbDashDecide(memo, 'B', T - 40000, T + 3000, false), false, 'B within the minute: A\'s window is not B\'s')
  assert.equal(kbDashDecide(memo, 'A', T - 1000, T + 4500, false), false, 'back in A: the window died with the switch, the person left it')
  // a dashboard the person only pointed at (no agent write in this chat: at 0) never opens anything
  const page = kbDashMemo()
  assert.equal(kbDashDecide(page, 'A', 0, T, false), false, 'at 0: nothing was written by the agent in this chat')
  ok('the one-minute window is not carried to another chat, and a dashboard nobody wrote in this chat opens nothing')
}

// ── F. the probe answers for the chat it asked about, and the close check too ───────────────────────────────────
assert.ok(/if \(sessionId\(\) !== chat\) return \/\/ the answer is for the chat/.test(src), 'an answer that arrives after a switch of chat is dropped')
assert.ok(/panelShown\(\) === true \|\| sessionId\(\) !== chat/.test(src), 'a panel not on screen because the person left the chat is not a close')
ok('a late answer and a late close check are ignored once the chat has changed')

console.log('\n' + pass + ' verifications OK')
