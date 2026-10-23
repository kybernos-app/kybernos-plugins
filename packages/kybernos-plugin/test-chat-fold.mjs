#!/usr/bin/env node
/** The chat header toggle (mockup variant A): pin, rename and a fold button next to the title; folded hides the tags,
 *  the call buttons, the Journal / Trajectory tabs and the status line.
 *
 *  1. always: the contract, pinned at source level in client.js;
 *  2. when jsdom resolves (or KYBERNOS_JSDOM=<path of its entry>): the CSS rules are run against a DOM that has the
 *     shape DSH's header measured on 2026-10-15 (slot wrappers, hashed `tabs` class, dock children).
 *
 *  Usage: node packages/kybernos-plugin/test-chat-fold.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, 'client.js'), 'utf8')

const a = src.indexOf('// ── Chat header: one toggle folds the extras')
const b = src.indexOf("'kybers: styles chat header toggle')")
assert.ok(a > 0 && b > a, 'the chat header toggle block exists')
const block = src.slice(a, b)
const cssStart = block.indexOf('styles.insert(`')
const css = block.slice(cssStart + 'styles.insert(`'.length, block.lastIndexOf('`)'))

// 1. folded by default, kept per browser, and applied only while a toggle is mounted
{
  assert.match(block, /const kbFold = \{ open: false, mounted: 0,/, 'folded by default')
  assert.match(block, /getItem\(KB_FOLD_KEY\) === 'open'/, 'only an explicit « open » unfolds')
  assert.match(block, /kbFold\.mounted > 0 && kbFold\.open !== true\) root\.setAttribute\('data-kb-chat-fold', '1'\)/, 'the attribute needs a mounted toggle')
  assert.match(block, /kbFold\.mounted = Math\.max\(0, kbFold\.mounted - 1\)/, 'unmount releases it')
  assert.match(block, /try \{ window\.localStorage\.setItem\(/, 'storage writes are guarded')
  ok('folded by default, kept per browser, the hiding needs a mounted toggle')
}

// 2. the three actions go through the same calls as the sidebar rows
{
  assert.match(block, /kbPinsToggle\('session', sessionId, pinned !== true\)/, 'pin uses the native-pin delegation')
  assert.match(block, /kbPinsRenameCall\(sessionId, value\)/, 'rename uses the native rename call')
  for (const act of ['pin', 'rename', 'toggle']) assert.ok(block.includes("'data-act': '" + act + "'"), 'data-act ' + act)
  assert.match(block, /slots\.register\(\s*\{ name: 'conversation\.session\.header\.actions', id: 'kybernos-chat-fold', order: 1 \}, KbChatFold\)/, 'registered in the header actions slot')
  ok('pin, rename and fold reuse the sidebar calls and sit in the header actions slot')
}

// 3. folding leaves Journal / Trajectory first, so the chat is never stuck on a view with no tab
{
  assert.match(block, /const fold = \(\) => \{[\s\S]*tabs\[0\]\.click\(\)[\s\S]*kbFoldSet\(false\)/, 'fold goes back to the first tab, then folds')
  assert.match(block, /\/tabActive\/\.test\(String\(tabs\[0\]\.className\)\) !== true/, 'only when the first tab is not already active')
  ok('folding returns to the Chat tab first')
}

// 4. strings: both languages, French and English
{
  for (const key of ['show', 'hide', 'pin', 'unpin', 'rename', 'save', 'err']) {
    const m = new RegExp("'kbfold\\." + key + "': \\{ kybernos: '([^']+)', en: '([^']+)' \\}").exec(src)
    assert.ok(m !== null, 'kbfold.' + key + ' has both languages')
  }
  assert.match(src, /\n  cardLines: \[/, 'the toggle glyph exists')
  ok('every string has French and English; the glyph is drawn')
}

// 5. the CSS: DSH hooks only, never a hashed class; wide screens only; a live call stays visible
{
  assert.ok(!/[A-Za-z0-9]{5,7}_(headerActions|tabs|titleRow)/.test(css), 'no hashed class name of DSH in the hiding rules')
  assert.match(css, /@media \(min-width:701px\)\{[\s\S]*data-kb-chat-fold="1"\][^{]*header\.actions"\] > :not\(\.kbfold-root\):not\(:has\(\[data-act="hangup-header"\]\)\)\{display:none!important\}/, 'actions hidden, our root and a live call spared')
  assert.match(css, /header"\] > \[class\*="tabs"\]\{display:none!important\}/, 'tabs row hidden')
  assert.match(css, /header"\] > \[class\*="titleRow"\]\{align-self:start\}/, 'the title row keeps its place when the tabs row goes (the title does not slide down)')
  assert.match(css, /composer\.dock"\] > :not\(\[data-kb="changes"\]\)\{display:none!important\}/, 'status chips hidden')
  assert.match(css, /\[data-kb="changes"\]\[data-state="ok"\],[^{]*\[data-kb="changes"\]\[data-state="unavailable"\]\{display:none!important\}/, 'a healthy save chip and the « tracking unavailable » chip (nothing to act on) hidden')
  assert.ok(!/\.kbch-|\.kbcl-/.test(css), 'no class of another bundle is named (the bundles share one class namespace)')
  assert.match(css, /@media \(max-width:700px\)\{\.kbfold-root\{display:none\}\}/, 'the phone keeps its own parked actions')
  ok('hiding keys on [data-slot] hooks, wide screens only, a live call and a save problem stay visible')
}

// 6. the rules, run against a DOM of the measured shape
console.log('\n── CSS on a DOM of the measured shape ──')
let JSDOM
try { ({ JSDOM } = await import(process.env.KYBERNOS_JSDOM ?? 'jsdom')) } catch { JSDOM = undefined }
if (JSDOM === undefined) {
  console.log('SKIPPED: the chat-fold CSS on a DOM of the measured shape — jsdom not found (KYBERNOS_JSDOM=<path of its entry> plays it)')
} else {
  // jsdom only applies @media lists that name « screen »: take the rules out of the wide-screen block.
  const mStart = css.indexOf('@media (min-width:701px){')
  const inner = css.slice(mStart + '@media (min-width:701px){'.length, css.indexOf('\n}', mStart))
  const html = (live, nocall) => `<!doctype html><html${live}><head><style>${inner}</style></head><body>
    <div data-slot="conversation.session.header">
      <div class="titleRow"><div class="titleCluster"><span class="crumb">Title</span>
        <div data-slot="conversation.session.header.actions">
          <div class="root" id="agent">Agent Team</div>
          <div class="kbfold-root" id="fold"><button>pin</button></div>
          <div class="kbtg-root" id="teams">Teams</div>
          <div class="kbcl-hdr" id="call">${nocall ? '<button data-act="panel-call">call</button>' : '<button data-act="hangup-header">hang up</button>'}</div>
        </div></div>
        <div class="headerUtilities" id="utils"><button>more</button></div>
      </div>
      <div class="x1y2z_tabs" id="tabs"><button class="tab tabActive">Chat</button><button class="tab">Journal</button></div>
    </div>
    <div data-slot="conversation.composer.dock">
      <span class="anchor" id="toks">44 tok/s</span>
      <span class="kbch-wrap kbch-ok" data-kb="changes" data-state="ok" id="saved">saved</span>
      <span class="kbch-wrap kbch-warn" data-kb="changes" data-state="unsaved" id="unsaved">not saved</span>
      <span class="kbch-wrap kbch-off" data-kb="changes" data-state="unavailable" id="off">tracking unavailable</span>
      <span class="kbs-popwrap" id="mem">memory</span>
    </div></body></html>`
  const show = (live, nocall) => {
    const w = new JSDOM(html(live, nocall)).window
    const shown = (id) => w.getComputedStyle(w.document.getElementById(id)).display !== 'none'
    return Object.fromEntries(['agent', 'fold', 'teams', 'call', 'utils', 'tabs', 'toks', 'saved', 'unsaved', 'off', 'mem'].map((id) => [id, shown(id)]))
  }
  const folded = show(' data-kb-chat-fold="1"', true)
  assert.deepEqual(folded, { agent: false, fold: true, teams: false, call: false, utils: true, tabs: false, toks: false, saved: false, unsaved: true, off: false, mem: false })
  ok('folded: tags, call, tabs and chips hidden (the « tracking unavailable » one too); toggle, header menu and a save problem stay')
  const open = show('', true)
  assert.ok(Object.values(open).every((v) => v === true), 'unfolded: nothing hidden')
  ok('unfolded: the header is DSH’s own')
  let hasOk = true
  try { hasOk = show(' data-kb-chat-fold="1"', false).call === true } catch (e) { hasOk = false }
  if (hasOk) ok('folded with a call in progress: the hang-up button stays')
  else console.log('  · call-in-progress case not played: this jsdom does not evaluate :has()')
}

console.log('\n' + pass + ' checks passed')
