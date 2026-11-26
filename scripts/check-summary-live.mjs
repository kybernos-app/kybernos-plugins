#!/usr/bin/env node
// The Summary tab (packages/kybernos-summary), in a real GUI.
//
//   source scripts/sandbox/env.sh && node scripts/check-summary-live.mjs [--shots <dir>]
//
// It needs a DSH that LOADS the bundle, i.e. the sandbox instance (`scripts/sandbox/setup.sh`, `scripts/sandbox/start.sh`; see
// docs/dev/live-testing.md). The user's own `dsh web` does not list the bundle: this script refuses to run against :3080 (exit 3).
//
// What it checks, in a real page:
//   1. the probe files the chat on screen (and the kinds of its nodes: the model relies on a `user` node);
//   2. the tab opens in the right sidebar (its guide entry is covered by test-client.mjs);
//   3. with data fed in (no model here): the four sections, their counts, struck-through done tasks, MCP servers
//      grouped, files listed once each;
//   4. « Latest only » scopes skills, tools and files, and flipping it back shows the whole chat;
//   5. a section folds, the theme tokens apply, and a narrow pane does not overflow.
//
// NOT covered here (no key, no turn in a sandbox): the real tool calls of a real turn. The shapes the model reads were
// taken from the engine's own renderer (dsh-client-ui-tool: `call.name`, `call.args`, `subCalls`) and are asserted
// against fixtures by test-client.mjs; `state().kinds` below shows what a real chat's nodes look like here.
//
// SAFETY: the sandbox has its own DSH_HOME; nothing is written outside it (the tab stores one preference in the
// browser's localStorage). Exit code 0 / 1 / 3.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage } from './live-page.mjs'

const args = process.argv.slice(2)
const shotDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const host = process.env.KB_HOST || '127.0.0.1:3080'
if (host === '127.0.0.1:3080') { console.error('○ inconclusive: this check needs a DSH that loads the bundle (a sandbox instance), not the one on :3080. Set KB_HOST, DSH_HOME and HOME.'); process.exit(3) }

const live = await openLivePage({ width: 1500, height: 1000 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const val = async (expr, ms) => (await page.evalJs(expr, ms)).val
const shot = async (name) => { if (shotDir !== null) { try { mkdirSync(shotDir, { recursive: true }); await page.shot(join(shotDir, name + '.png')) } catch (e) { /* no screenshot */ } } }
const poll = async (fn, ms = 12000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await sleep(250) } }
const mouse = async (x, y) => { await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }) }
const text = (sel) => val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent : null })()`)
const count = (sel) => val(`document.querySelectorAll(${JSON.stringify(sel)}).length`)

// what a real turn leaves in the chat's nodes, as far as the model reads them
const call = (callId, name, a, phase) => (phase === 'result'
  ? { kind: 'ok', callId, call: { name, args: a }, subCalls: [] }
  : { callId, name, args: a, argsRaw: JSON.stringify(a), subCalls: [] })
const node = (root) => ({ kind: 'tool-call', data: { root } })
const FED = {
  nodes: [
    { kind: 'user', data: { text: 'earlier' } },
    node(call('o1', 'skill', { name: 'old-skill' }, 'result')),
    node(call('o2', 'write', { file_path: '/work/old_notes.md' }, 'result')),
    { kind: 'user', data: { text: 'compare the funding rounds' } },
    node(call('n1', 'skill', { name: 'market-research' }, 'result')),
    node(call('n2', 'mcp__exa__web_search_exa', { query: 'q4 funding' }, 'result')),
    node(call('n3', 'mcp__notion__create_page', { title: 'brief' }, 'result')),
    node(call('n4', 'web_search', { queries: ['a'] }, 'result')),
    node(call('n5', 'write', { file_path: '/work/ai_agent_market_q4.md' }, 'result')),
    node(call('n6', 'write', { file_path: '/work/funding_rounds_q4.csv' }, 'result')),
  ],
  todos: [
    { content: 'Collect Q4 funding rounds', status: 'completed' },
    { content: 'Compare positioning for the top five', status: 'completed' },
    { content: 'Assemble the shareable brief', status: 'in_progress' },
  ],
  catalog: [{ id: 'a1b2c3d4e5', mode: 'continuable', label: 'CAMEL Agent' }],
}

try {
  await sleep(3000)
  if ((await val(`/Add an API key to get started/.test(document.body.innerText)`)) === true) {
    const pos = await val(`(() => { const e = Array.from(document.querySelectorAll('*')).filter((e) => e.children.length === 0 && (e.innerText || '').trim() === 'Configure later')[0]; if (!e) return null; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }) })()`)
    if (typeof pos === 'string') { const { x, y } = JSON.parse(pos); await mouse(x, y); await sleep(700) }
  }

  console.log('── 1. the probe ──')
  // a session must be mounted for the right sidebar: write a first message from the empty composer (no model here, the turn fails, that is fine)
  const composer = await poll(() => val(`(() => { const e = document.querySelector('[contenteditable="true"], textarea'); if (!e) return null; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.x + 40, y: r.y + r.height / 2 }) })()`), 8000)
  if (typeof composer === 'string') {
    const { x, y } = JSON.parse(composer)
    await mouse(x, y)
    await sleep(300)
    await page.send('Input.insertText', { text: 'Summary check' })
    await sleep(300)
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await sleep(2500)
  }
  check('the plugin exposes its diagnostics hook', (await poll(() => val(`typeof (window.__KB_SUMMARY__ && window.__KB_SUMMARY__.state) === 'function'`), 10000)) === true)
  const st = JSON.parse((await poll(async () => {
    const s = await val(`JSON.stringify(window.__KB_SUMMARY__.state())`)
    return s && JSON.parse(s).filed === true ? s : null
  }, 15000)) || 'null')
  check('the probe filed the chat on screen', st !== null && st.filed === true && typeof st.session === 'string' && st.session.length > 0, st)
  console.log('    nodes read: ' + JSON.stringify(st && st.kinds))
  check('the chat\'s nodes carry the person\'s message as kind `user`', st !== null && Array.isArray(st.kinds) && st.kinds.includes('user'), st && st.kinds)
  const sid = st !== null ? st.session : ''

  console.log('\n── 2. the tab ──')
  check('open() reaches the sidebar', (await val(`window.__KB_SUMMARY__.open()`)) === true)
  const pane = await poll(() => val(`(() => { const p = document.querySelector('[data-kb="kybernos-summary-pane"]'); return !!p && p.getClientRects().length > 0 })()`), 15000)
  check('the Summary tab opens in the right sidebar', pane === true)
  check('with nothing filed it says so instead of showing empty boxes', (await text('[data-kb="kybernos-summary-pane"] .kbsm-empty')) !== null && (await count('[data-kb="kybernos-summary-section"]')) === 0)
  await shot('1-empty')

  console.log('\n── 3. with the chat\'s work in place ──')
  check('a chat\'s data can be filed', (await val(`window.__KB_SUMMARY__.feed(${JSON.stringify(sid)}, ${JSON.stringify(FED)})`)) === true)
  await poll(() => count('[data-kb="kybernos-summary-section"]'), 8000)
  const secs = await val(`JSON.stringify(Array.from(document.querySelectorAll('[data-kb="kybernos-summary-section"]')).map((s) => ({ id: s.getAttribute('data-sec'), n: s.querySelector('.kbsm-count').textContent })))`)
  const sections = JSON.parse(secs || '[]')
  check('four sections, in the order of the reference', sections.map((s) => s.id).join() === 'agents,progress,context,files', sections)
  check('with their counts', sections.length === 4 && sections[0].n === '1' && sections[1].n === '3' && sections[2].n === '5' && sections[3].n === '2', sections)
  check('the agent is listed by its label', (await text('[data-kb="kybernos-summary-agent"] .kbsm-name')) === 'CAMEL Agent')
  const todoRows = JSON.parse(await val(`JSON.stringify(Array.from(document.querySelectorAll('[data-kb="kybernos-summary-todo"]')).map((r) => ({ s: r.getAttribute('data-status'), struck: !!r.querySelector('.kbsm-struck'), dec: getComputedStyle(r.querySelector('.kbsm-name')).textDecorationLine })))`))
  check('done tasks are struck through, the one in progress is not', todoRows.length === 3 && todoRows[0].struck && todoRows[0].dec.includes('line-through') && todoRows[1].struck && !todoRows[2].struck, todoRows)
  check('the skill of this turn is listed, not the old one', (await text('[data-kb="kybernos-summary-skill"] .kbsm-name')) === 'market-research' && (await count('[data-kb="kybernos-summary-skill"]')) === 1)
  const tools = JSON.parse(await val(`JSON.stringify(Array.from(document.querySelectorAll('[data-kb="kybernos-summary-tool"]')).map((r) => r.querySelector('.kbsm-name').textContent + '|' + r.getAttribute('data-tool-kind')))`))
  check('MCP servers first, then native tools by use', tools.join() === 'Exa|mcp,Notion|mcp,Write|native,Web search|native', tools)
  const files = JSON.parse(await val(`JSON.stringify(Array.from(document.querySelectorAll('[data-kb="kybernos-summary-file"]')).map((r) => r.querySelector('.kbsm-name').textContent))`))
  check('the files of this turn, by name', files.join() === 'ai_agent_market_q4.md,funding_rounds_q4.csv', files)
  await shot('2-fed-latest')

  console.log('\n── 4. the scope ──')
  check('the scope button says what it shows', (await text('[data-act="scope"]')) !== null)
  await val(`document.querySelector('[data-act="scope"]').click()`)
  await poll(() => val(`document.querySelectorAll('[data-kb="kybernos-summary-skill"]').length === 2`), 5000)
  check('the whole chat lists both skills and all three files', (await count('[data-kb="kybernos-summary-skill"]')) === 2 && (await count('[data-kb="kybernos-summary-file"]')) === 3)
  check('progress and agents do not change with the scope', (await count('[data-kb="kybernos-summary-todo"]')) === 3 && (await count('[data-kb="kybernos-summary-agent"]')) === 1)
  await shot('3-fed-whole')
  await val(`document.querySelector('[data-act="scope"]').click()`)
  check('back to the latest turn only', (await poll(() => val(`document.querySelectorAll('[data-kb="kybernos-summary-skill"]').length === 1`), 5000)) === true)

  console.log('\n── 5. fold, theme, narrow ──')
  await val(`document.querySelector('[data-act="toggle-progress"]').click()`)
  check('a section folds on a click', (await poll(() => val(`document.querySelectorAll('[data-kb="kybernos-summary-todo"]').length === 0 && document.querySelector('[data-act="toggle-progress"]').getAttribute('aria-expanded') === 'false'`), 4000)) === true)
  await val(`document.querySelector('[data-act="toggle-progress"]').click()`)
  const bg = await val(`getComputedStyle(document.querySelector('.kbsm-card')).backgroundColor`)
  check('the card uses the theme (a real background)', typeof bg === 'string' && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent', bg)
  const over = await val(`(() => { const p = document.querySelector('[data-kb="kybernos-summary-pane"]'); return p.scrollWidth - p.clientWidth })()`)
  check('the pane does not scroll sideways', over <= 1, over)
  const longName = Object.assign({}, FED, { nodes: FED.nodes.concat([node(call('n7', 'write', { file_path: '/very/long/folder/structure/that/goes/on/and/on/and/on/a_really_quite_long_file_name_for_a_deliverable_2026_q4.md' }, 'result'))]) })
  await val(`window.__KB_SUMMARY__.feed(${JSON.stringify(sid)}, ${JSON.stringify(longName)})`)
  await poll(() => count('[data-kb="kybernos-summary-file"]'), 5000)
  const over2 = await val(`(() => { const p = document.querySelector('[data-kb="kybernos-summary-pane"]'); return p.scrollWidth - p.clientWidth })()`)
  check('a very long file name is cut, not overflowing', over2 <= 1, over2)
  await shot('4-long-name')
} catch (e) {
  fail += 1
  console.log('  ✗ the check itself failed — ' + (e && e.message ? e.message : String(e)))
} finally {
  try { await live.close() } catch (e) { /* already gone */ }
}

console.log('\nSUMMARY LIVE — ' + (pass + fail) + ' checks, ' + fail + ' failure(s)')
process.exit(fail > 0 ? 1 : 0)
