#!/usr/bin/env node
// The Commands page and its editor, end to end in a real GUI, with the host's real store: create a slash command with three
// questions (a choice, a long text shown only for one choice), put them in order with the arrow and by drag and drop, choose
// « Send right away », save, read back what the host kept, edit, duplicate, delete with Undo, then run the command from the
// « / » menu (the conditional question appears, the text is filled in, the message is sent) and create a message action.
//
//   source scripts/sandbox/env.sh && node scripts/check-slash-live.mjs [--shots <dir>]
//
// Needs a DSH that serves this checkout (scripts/sandbox/start.sh). Refuses :3080 (exit 3): it writes commands, sends one message
// (the turn then fails for lack of a model key, which is fine) and leaves the sandbox's list of commands empty. It does not run an
// action on a reply: a sandbox has no assistant reply; that part is played on a real conversation, read-only, by hand (the action
// inserts its text in the composer and sends nothing when its delivery is « insert »).
// Exit code 0 / 1 / 3.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, openSettings, clickText, showAllSettingsPages, waitFor } from './live-page.mjs'

const args = process.argv.slice(2)
const shotDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 300))) } }

const host = process.env.KB_HOST || '127.0.0.1:3080'
if (host === '127.0.0.1:3080') { console.error('○ inconclusive: this check writes commands and sends a message: it needs a sandbox instance, not :3080. Set KB_HOST, DSH_HOME and HOME (source scripts/sandbox/env.sh).'); process.exit(3) }

const live = await openLivePage({ width: 1400, height: 1000 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const val = async (e, ms) => (await page.evalJs(e, ms || 10000)).val
const shot = async (name) => {
  if (shotDir === null) return
  try { mkdirSync(shotDir, { recursive: true }); const r = await page.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(shotDir, name + '.png'), Buffer.from(r.result.data, 'base64')) } catch (e) { /* no screenshot */ }
}
const entries = () => val(`fetch('/kybernos/slash/entries').then((x) => x.json()).then((j) => JSON.stringify(j.entries || j))`).then((t) => JSON.parse(t))
const clickXY = async (x, y) => { for (const t of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type: t, x, y, button: 'left', clickCount: 1 }); await sleep(350) }
const click = async (sel) => {
  const r = await val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return JSON.stringify({ x: b.x + b.width / 2, y: b.y + b.height / 2 }) })()`)
  if (!r) return false
  const { x, y } = JSON.parse(r); await clickXY(x, y); return true
}
const type = async (text) => { await page.send('Input.insertText', { text }); await sleep(250) }
const key = async (k, code, vk, mod) => { const o = { key: k, code, windowsVirtualKeyCode: vk, modifiers: mod || 0 }; await page.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyDown' }, o)); await page.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, o)); await sleep(250) }
const setVal = (sel, v) => val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return 'none'; const proto = e.tagName === 'SELECT' ? HTMLSelectElement.prototype : (e.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype); Object.getOwnPropertyDescriptor(proto, 'value').set.call(e, ${JSON.stringify(v)}); e.dispatchEvent(new Event(e.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return 'ok' })()`)
const order = () => val(`[...document.querySelectorAll('.kbsl-fcard')].map((c) => c.querySelector('.kbsl-chip.cmd').textContent).join(',')`)
const card = (i) => `document.querySelectorAll('.kbsl-fcard')[${i}]`
const drag = (idx, t) => val(`(() => { window.__dt = window.__dt || new DataTransfer(); document.querySelectorAll('.kbsl-fcard')[${idx}].dispatchEvent(new DragEvent(${JSON.stringify(t)}, { bubbles: true, cancelable: true, dataTransfer: window.__dt })) })()`)
const formPop = `[...document.querySelectorAll('[class*="kbsl-pop"]')].pop()`

try {
  console.log('the page')
  await showAllSettingsPages(page); await openSettings(page); await sleep(800)
  await clickText(page, 'Commands'); await waitFor(page, `!!document.querySelector('.kbsl-page')`, 20000); await sleep(1200)
  await val(`(() => { const b = document.querySelector('[data-act="help"][aria-expanded="true"]'); if (b) b.click() })()`)
  const start = await entries()
  check('the sandbox starts without commands (the list says what a slash command is and offers « New command »)', start.filter((e) => e.kind !== 'action').length === 0 && (await val(`!!document.querySelector('.kbsl-empty') && /saved prompt/.test(document.querySelector('.kbsl-empty').innerText)`)) === true, start.length)
  check('the toolbar holds the tabs, the search, « Create with AI » and « New command »', (await val(`document.querySelectorAll('.kbsl-tabs .kbsl-tab').length === 2 && !!document.querySelector('.kbsl-tabs .kbsl-search') && document.querySelectorAll('.kbsl-tabs .kbsl-btn').length === 2`)) === true)

  console.log('create')
  await click('.kbsl-tabs .kbsl-primary'); await sleep(700)
  check('the editor opens with its preview closed and a Save that waits for a name', (await val(`!!document.querySelector('.kbsl-modal') && !document.querySelector('.kbsl-modal.pv') && document.querySelector('.kbsl-efoot .kbsl-primary').disabled`)) === true)
  await click('[data-kb-ed="title"]'); await type('Draft a note')
  check('the command word follows the name', (await val(`document.querySelector('[data-kb-ed="slug"]').value`)) === 'draft-a-note')
  await click('[data-kb-template]'); await type('Draft a note about {topic} in a {tone} tone.\n\nDetails: {detail}')
  check('three blanks without a question are flagged', (await val(`document.querySelectorAll('.kbsl-vchip.missing').length`)) === 3)
  for (let i = 0; i < 3; i += 1) { await click('.kbsl-vchip.missing'); await sleep(400) }
  check('a click on a flagged blank adds its question', (await order()) === '{topic},{tone},{detail}')
  await val(`${card(1)}.querySelector('.kbsl-fmain').click()`); await sleep(300)
  await val(`${card(1)}.querySelector('[aria-label="Choice"]').click()`); await sleep(300)
  await setVal('[aria-label="Choices"]', 'Formal, Casual'); await sleep(300)
  await val(`${card(2)}.querySelector('.kbsl-fmain').click()`); await sleep(300)
  await val(`[...${card(2)}.querySelectorAll('button')].find((b) => /More options/.test(b.innerText)).click()`); await sleep(300)
  await val(`${card(2)}.querySelector('[aria-label="Conditional field"]').click()`); await sleep(300)
  await setVal('[aria-label="Visibility logic"]', 'tone'); await sleep(200)
  await setVal('[aria-label="Value to compare"]', 'Formal'); await sleep(300)
  check('a question can be shown only for one choice (its row says so)', (await val(`${card(2)}.querySelector('.kbsl-vistag') && /some cases/.test(${card(2)}.querySelector('.kbsl-vistag').innerText)`)) === true)
  await val(`${card(2)}.querySelector('.kbsl-ibtn.mv').click()`); await sleep(300)
  check('the arrow moves a question up', (await order()) === '{topic},{detail},{tone}')
  await drag(2, 'dragstart'); await sleep(300); await drag(0, 'dragover'); await sleep(300); await drag(0, 'drop'); await sleep(300); await drag(2, 'dragend'); await sleep(400)
  check('a drag and drop puts a question first', (await order()) === '{tone},{topic},{detail}', await order())
  await val(`[...document.querySelectorAll('.kbsl-seg .kbsl-pill')].find((b) => /Send right away/.test(b.innerText)).click()`); await sleep(300)
  await click('.kbsl-ptg'); await sleep(400)
  check('the preview opens from the header button and the window widens', (await val(`!!document.querySelector('.kbsl-modal.pv') && !!document.querySelector('.kbsl-easide')`)) === true)
  await shot('slash-create')
  await key('s', 'KeyS', 83, 2); await sleep(1500)
  check('Ctrl/Cmd + S saves and closes the editor', (await val(`!document.querySelector('.kbsl-modal')`)) === true)
  let list = await entries()
  const mine = list.filter((e) => e.slug === 'draft-a-note')[0]
  check('the host kept the command: word, delivery « send », three questions in the order of the screen', mine !== undefined && mine.delivery === 'send' && (mine.fields || []).length === 3 && (mine.fields || []).map((f) => f.key || f.name).join(',') === 'tone,topic,detail', mine)
  check('…the question shown for one choice carries its condition', mine !== undefined && JSON.stringify(mine.fields.filter((f) => (f.key || f.name) === 'detail')[0].showIf).indexOf('Formal') > 0)
  check('the list shows it with its question count', (await val(`[...document.querySelectorAll('.kbsl-lrow')].some((r) => /draft-a-note/.test(r.innerText) && /3 questions/.test(r.innerText))`)) === true)

  console.log('edit, duplicate, delete')
  await val(`document.querySelector('.kbsl-lrow .kbsl-lmain').click()`); await sleep(800)
  check('the preview stays open the next time (the choice is kept)', (await val(`!!document.querySelector('.kbsl-modal.pv')`)) === true)
  await setVal('[data-kb-ed="title"]', 'Draft a note v2'); await sleep(300)
  check('an edit is announced as unsaved changes', /Unsaved changes/.test(await val(`document.querySelector('.kbsl-efoot').innerText`)))
  await val(`document.querySelector('.kbsl-efoot .kbsl-primary').click()`); await sleep(1500)
  list = await entries()
  check('the host kept the new name', list.some((e) => e.slug === 'draft-a-note' && e.label === 'Draft a note v2'))
  await val(`document.querySelector('.kbsl-lrow [aria-label^="Dupli"]').click()`); await sleep(1500)
  list = await entries()
  check('duplicate makes a second command with its own word', list.filter((e) => e.kind !== 'action').length === 2 && list.some((e) => e.slug === 'draft-a-note-copy'))
  const rowOf = (slug) => `[...document.querySelectorAll('.kbsl-lrow')].find((r) => r.innerText.indexOf('/${slug}') >= 0)`
  await val(`${rowOf('draft-a-note')}.querySelector('.kbsl-ibtn.danger').click()`); await sleep(500)
  check('a delete asks in the row', /Can be undone/.test(await val(`(document.querySelector('.kbsl-lrow-ask') || { innerText: '' }).innerText`)))
  await val(`[...document.querySelectorAll('.kbsl-lrow-ask button')].find((b) => b.innerText.trim() === 'Delete').click()`); await sleep(1200)
  check('the command is gone and a toast offers Undo', (await entries()).length === 1 && (await val(`!!document.querySelector('.kbsl-toast-btn')`)) === true)
  await val(`document.querySelector('.kbsl-toast-btn').click()`); await sleep(1500)
  check('Undo brings it back', (await entries()).length === 2)
  await val(`${rowOf('draft-a-note')}.querySelector('.kbsl-ibtn.danger').click()`); await sleep(400)
  await val(`[...document.querySelectorAll('.kbsl-lrow-ask button')].find((b) => b.innerText.trim() === 'Delete').click()`); await sleep(1200)
  check('the original is deleted for good', !(await entries()).some((e) => e.slug === 'draft-a-note'))

  console.log('message actions')
  await val(`document.querySelectorAll('.kbsl-tab')[1].click()`); await sleep(500)
  await click('.kbsl-tabs .kbsl-primary'); await sleep(700)
  check('a new action has no command word and asks where its button goes', (await val(`/New message action/.test(document.querySelector('.kbsl-eh').textContent) && !document.querySelector('.kbsl-slugbox') && !!document.querySelector('[aria-label="Where should the button appear?"]')`)) === true)
  await click('[data-kb-ed="title"]'); await type('Explain simply')
  await click('[data-kb-template]'); await type('Explain this more simply:\n\n{message}')
  await val(`document.querySelector('.kbsl-efoot .kbsl-primary').click()`); await sleep(1500)
  const act = (await entries()).filter((e) => e.kind === 'action')[0]
  check('the host kept an action whose prompt carries {message}', act !== undefined && /\{message\}/.test(act.template), act)
  await val(`document.querySelector('.kbsl-lrow .kbsl-ibtn.danger').click()`); await sleep(400)
  await val(`[...document.querySelectorAll('.kbsl-lrow-ask button')].find((b) => b.innerText.trim() === 'Delete').click()`); await sleep(1200)

  console.log('run the command from the / menu')
  // leave Settings with a real click on « Back to workspace »
  const back = await val(`(() => { const b = Array.from(document.querySelectorAll('button,a,[role=button]')).find((e) => /^back to workspace$/i.test((e.innerText || '').trim())); if (!b) return null; const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }) })()`)
  if (back !== null && back !== undefined) { const { x, y } = JSON.parse(back); await clickXY(x, y); await sleep(1200) }
  check('Settings closes with « Back to workspace »', (await val(`!document.querySelector('.kbsl-page')`)) === true)
  const composer = `document.querySelector('[data-composer-card] [contenteditable="true"], [contenteditable="true"], textarea')`
  const cp = JSON.parse(await val(`(() => { const e = ${composer}; const b = e.getBoundingClientRect(); return JSON.stringify({ x: b.x + 40, y: b.y + b.height / 2 }) })()`))
  await clickXY(cp.x, cp.y)
  await type('/draft'); await sleep(900)
  check('typing « /draft » offers the command in DSH\'s own menu', (await val(`document.body.innerText.indexOf('/draft-a-note-copy') >= 0`)) === true)
  await key('Enter', 'Enter', 13); await sleep(1000)
  check('its form opens with the questions in the saved order, the conditional one hidden', (await val(`(() => { const t = ${formPop}; return !!t && t.querySelectorAll('input, textarea').length === 1 && t.innerText.indexOf('Tone') < t.innerText.indexOf('Topic') })()`)) === true)
  await val(`[...${formPop}.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Formal').click()`); await sleep(500)
  check('choosing « Formal » shows the conditional question', (await val(`${formPop}.querySelectorAll('input, textarea').length`)) === 2)
  await val(`(() => { const i = ${formPop}.querySelectorAll('input, textarea'); const f = (e, v) => { const proto = e.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(e, v); e.dispatchEvent(new Event('input', { bubbles: true })) }; f(i[0], 'the sandbox'); f(i[1], 'result first') })()`); await sleep(600)
  check('the preview of the result is the prompt with the answers in it', /Draft a note about the sandbox in a Formal tone\./.test(await val(`${formPop}.innerText`)))
  await shot('slash-form')
  await val(`[...${formPop}.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Send').click()`); await sleep(2500)
  check('« Send » sends the filled message and closes the form', (await val(`!document.querySelector('[class*="kbsl-pop"]') && [...document.querySelectorAll('[data-chat-flow-kind="user"]')].some((b) => /Draft a note about the sandbox in a Formal tone\\./.test(b.innerText) && /result first/.test(b.innerText))`)) === true)

  // the sandbox's list of commands goes back to empty
  for (const e of await entries()) await val(`fetch('/kybernos/slash/entries', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ delete: ${JSON.stringify(e.id || e.slug)} }) }).then((r) => r.status)`)
} catch (e) {
  fail += 1
  console.log('  ✗ the check stopped: ' + e.message)
} finally {
  await live.close()
}
console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
