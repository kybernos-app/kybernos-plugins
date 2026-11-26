#!/usr/bin/env node
// Checks the Connectors page (MCP servers tab) against a REAL DSH GUI.
//
//   node scripts/check-connectors-live.mjs [--shots <dir>]                      read only
//   KB_HOST=127.0.0.1:3098 HOME=$SB DSH_HOME=$SB/.dsh \
//     node scripts/check-connectors-live.mjs --write [--shots <dir>]           full flow, on an isolated instance
//
// Without --write nothing is changed: the script opens the page, looks at the tabs and the rows, checks that
// the row actions stay hidden until hover, opens the add menu and a server's edit window, and closes them.
// It never clicks Test (that starts the server's process).
//
// With --write it adds a fake stdio MCP server by pasting JSON, waits for DSH to load it by itself (hot reload),
// tests it, switches it off and on, renames it, and deletes it. It writes the user's profile and .env, so it
// REFUSES to run against 127.0.0.1:3080 (the real DSH) unless --allow-real is given: use an isolated instance
// (own HOME and DSH_HOME, see docs/dev/live-testing.md).
//
// Exit code: 0 all green, 1 a check failed, 3 inconclusive (GUI down / the page did not open).
// Named check-*, not test-*: CI runs every test-*.mjs with no DSH, and this one needs one.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openLivePage, waitFor } from './live-page.mjs'
import { fakeStdioScript } from '../packages/kybernos-composio/lib-test.mjs'

const args = process.argv.slice(2)
const WRITE = args.includes('--write')
const ALLOW_REAL = args.includes('--allow-real')
const shotsDir = args.indexOf('--shots') >= 0 ? args[args.indexOf('--shots') + 1] : null
const HOST = process.env.KB_HOST || '127.0.0.1:3080'
if (WRITE && HOST === '127.0.0.1:3080' && !ALLOW_REAL) {
  console.error('✗ --write changes the profile and the .env of the DSH it talks to, and that is the real one (127.0.0.1:3080).')
  console.error('  Start an isolated instance (own HOME and DSH_HOME) and point KB_HOST at it, or pass --allow-real if you mean it.')
  process.exit(2)
}
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 300))) }
}

const live = await openLivePage({ width: 1500, height: 950 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const ev = async (js) => { const r = await page.evalJs(js, 8000); return r.err ? { __err: r.err } : r.val }
const shot = async (name) => { if (shotsDir !== null) await page.shot(join(shotsDir, name + '.png')).catch(() => {}) }
const q = (sel) => JSON.stringify(sel)
const exists = async (sel) => (await ev(`!!document.querySelector(${q(sel)})`)) === true
const hover = async (sel) => {
  const r = await ev(`(() => { const e = document.querySelector(${q(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } })()`)
  if (r === null || r.__err) return false
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y })
  await sleep(350)
  return true
}
const clickJs = async (sel) => ev(`(() => { const e = document.querySelector(${q(sel)}); if (!e) return false; e.click(); return true })()`)
const rowChip = (nom) => ev(`(() => { const r = document.querySelector('[data-kb-server="${nom}"]'); const c = r && r.querySelector('[data-kb-state]'); return c ? c.textContent.trim() : null })()`)
const rowNames = async () => (await ev(`Array.from(document.querySelectorAll('[data-kb-server]')).map((r) => r.getAttribute('data-kb-server'))`)) || []
const opacityOf = (sel) => ev(`(() => { const e = document.querySelector(${q(sel)}); return e ? parseFloat(getComputedStyle(e).opacity) : null })()`)
const typeInto = async (sel, text) => {
  await ev(`(() => { const e = document.querySelector(${q(sel)}); e.focus(); const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e), 'value').set; set.call(e, ${JSON.stringify(text)}); e.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
}
const tmp = mkdtempSync(join(tmpdir(), 'kb-connlive-'))

try {
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
  await waitFor(page, `document.readyState === 'complete'`, 15000)
  await sleep(2500)
  // A fresh instance asks for a model key in a dialog that covers the page (and swallows the mouse): dismiss it.
  await ev(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /^Configure later$/i.test(x.textContent.trim())); if (b) b.click(); return !!b })()`)
  await sleep(500)
  await ev(`window.dispatchEvent(new CustomEvent('kb-open-resources', { detail: { tab: 'composio' } })); 1`)
  if ((await waitFor(page, `!!document.querySelector('[data-kb="subtab-mcp"]')`, 15000)) === null) {
    console.error('○ inconclusive: the Connections page did not open with an MCP servers tab (is this DSH serving the current client?)')
    process.exit(3)
  }
  await sleep(1200)

  console.log('the page')
  check('three sub-tabs: Yours, Discover, MCP servers', (await exists('[data-kb="subtab-yours"]')) && (await exists('[data-kb="subtab-discover"]')) && (await exists('[data-kb="subtab-mcp"]')))
  await clickJs('[data-kb="subtab-mcp"]')
  await sleep(900)
  await shot('01-mcp-tab')
  const names = await rowNames()
  console.log('  (' + names.length + ' server' + (names.length === 1 ? '' : 's') + ': ' + names.join(', ') + ')')
  check('the add button offers two ways: a form and pasting JSON', await (async () => {
    await clickJs('[data-kb="connector-create"]'); await sleep(300)
    const ok = (await exists('[data-kb="add-form"]')) && (await exists('[data-kb="add-json"]'))
    await shot('02-add-menu')
    await clickJs('[data-kb="connector-create"]'); await sleep(200)
    return ok
  })())

  if (names.length > 0) {
    const first = names[0]
    const acts = `[data-kb-server="${first}"] .kbcp-macts`
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 })
    await sleep(400)
    const away = await opacityOf(acts)
    check('the row actions are quiet until the row is hovered', away === 0, away)
    await hover(`[data-kb-server="${first}"] .kbcp-mname`)
    const over = await opacityOf(acts)
    check('...and show when it is', over === 1, over)
    await shot('03-row-hover')
    const chip = await rowChip(first)
    check('each row says what DSH says of it (a chip), not nothing', typeof chip === 'string' && chip.length > 0, chip)
    const fromSkill = await ev(`!!Array.from(document.querySelectorAll('[data-kb-server]')).find((r) => r.querySelector('.kbcp-src'))`)
    if (fromSkill === true) {
      const nom = await ev(`Array.from(document.querySelectorAll('[data-kb-server]')).find((r) => r.querySelector('.kbcp-src')).getAttribute('data-kb-server')`)
      await ev(`Array.from(document.querySelectorAll('[data-kb-server="${nom}"] .kbcp-macts button')).find((b) => b.textContent.trim() === 'Edit' || b.textContent.trim() === 'Modifier').click()`)
      await sleep(600)
      const dlg = await ev(`(() => { const d = document.querySelector('.kb7-modal'); if (!d) return null; const name = d.querySelector('#kbcp-f-name'); return { title: d.querySelector('.kb7-mname').textContent, nameLocked: name ? name.disabled : null, command: (d.querySelector('#kbcp-f-cmd') || {}).value || null } })()`)
      await shot('04-edit-skill-server')
      check('a server the skill wrote opens in the form (it used to have no edit button)', dlg !== null && dlg.nameLocked === true, dlg)
      check('...with its fields filled in', dlg !== null && (dlg.command === null || dlg.command.charAt(0) === '/'), dlg)
      await clickJs('.kb7-modal [aria-label="Close"], .kb7-modal [aria-label="Fermer"]')
      await sleep(300)
    }
  }

  if (WRITE) {
    console.log('add by pasting JSON, then the whole life of a server')
    const script = fakeStdioScript(tmp)
    const NAME = 'fake-live'
    const doc = JSON.stringify({ mcpServers: { [NAME]: { command: '/usr/bin/env', args: [process.execPath, script], env: { FAKE_TOKEN: 'a-secret-value-123' } } } }, null, 2)
    await clickJs('[data-kb="connector-create"]'); await sleep(250)
    await clickJs('[data-kb="add-json"]'); await sleep(500)
    await typeInto('#kbcp-imp-json', doc)
    await sleep(1500)
    await shot('05-json-analysed')
    const analysed = await ev(`(() => { const it = document.querySelector('.kbcp-fitem'); return it ? { text: it.textContent, enabled: !it.querySelector('input[type=checkbox]').disabled } : null })()`)
    check('the pasted JSON is analysed, the server can be imported', analysed !== null && analysed.enabled === true, analysed)
    check('...and the secret-looking value is announced as moved, never shown', analysed !== null && /FAKE_TOKEN/.test(analysed.text) && !analysed.text.includes('a-secret-value-123'), analysed)
    await ev(`Array.from(document.querySelectorAll('.kb7-modal button')).find((b) => /Import|Importer/.test(b.textContent)).click()`)
    const appeared = await waitFor(page, `!!document.querySelector('[data-kb-server="${NAME}"]')`, 10000)
    check('the imported server appears in the list', appeared !== null)
    // DSH reloads its configuration by itself: the chip goes from Loading to Active with the tools
    let chip = null
    for (let i = 0; i < 40; i += 1) { chip = await rowChip(NAME); if (/Actif|Active/.test(String(chip))) break; await sleep(500) }
    await shot('06-loaded')
    check('DSH loads it by itself, no restart: the chip says Active with its tools', /Actif · 6|Active · 6/.test(String(chip)), chip)

    await hover(`[data-kb-server="${NAME}"] .kbcp-mname`)
    await ev(`Array.from(document.querySelectorAll('[data-kb-server="${NAME}"] .kbcp-macts button')).find((b) => b.textContent.trim() === 'Test' || b.textContent.trim() === 'Tester').click()`)
    const tested = await waitFor(page, `(() => { const d = document.querySelector('[data-kb-server="${NAME}"] .kbcp-detail'); return d && /ping/.test(d.textContent) ? d.textContent : null })()`, 12000)
    await shot('07-test')
    check('Test lists the tools the server really exposes', tested !== null && /ping/.test(String(tested)) && !String(tested).includes('a-secret-value-123'), tested)

    await ev(`document.querySelector('[data-kb-server="${NAME}"] .kbcp-switch').click()`)
    let off = null
    for (let i = 0; i < 40; i += 1) { off = await rowChip(NAME); if (/Désactivé|Disabled/.test(String(off))) break; await sleep(500) }
    check('the switch turns it off (the chip says Disabled once DSH has dropped it)', /Désactivé|Disabled/.test(String(off)), off)
    await ev(`document.querySelector('[data-kb-server="${NAME}"] .kbcp-switch').click()`)
    let on = null
    for (let i = 0; i < 40; i += 1) { on = await rowChip(NAME); if (/Actif|Active/.test(String(on))) break; await sleep(500) }
    check('...and back on: Active again, with its tools', /Actif · 6|Active · 6/.test(String(on)), on)

    // rename through the form
    await ev(`Array.from(document.querySelectorAll('[data-kb-server="${NAME}"] .kbcp-macts button')).find((b) => b.textContent.trim() === 'Edit' || b.textContent.trim() === 'Modifier').click()`)
    await sleep(600)
    const locked = await ev(`document.querySelector('#kbcp-f-name').disabled`)
    check('editing: the name is locked until "Rename…"', locked === true, locked)
    await ev(`Array.from(document.querySelectorAll('.kb7-modal button')).find((b) => /Rename|Renommer/.test(b.textContent)).click()`)
    await sleep(300)
    await typeInto('#kbcp-f-name', 'fake-live-2')
    await ev(`Array.from(document.querySelectorAll('.kb7-modal button')).find((b) => /^(Save|Enregistrer)$/.test(b.textContent.trim())).click()`)
    await waitFor(page, `!!document.querySelector('[data-kb-server="fake-live-2"]')`, 10000)
    await sleep(800)
    const after = await rowNames()
    check('renamed: the new name is in the list and the old one is gone', after.includes('fake-live-2') && !after.includes(NAME), after)
    let chip2 = null
    for (let i = 0; i < 40; i += 1) { chip2 = await rowChip('fake-live-2'); if (/Actif|Active/.test(String(chip2))) break; await sleep(500) }
    check('...and DSH loaded the renamed server too', /Actif · 6|Active · 6/.test(String(chip2)), chip2)

    // delete
    await hover(`[data-kb-server="fake-live-2"] .kbcp-mname`)
    await ev(`document.querySelector('[data-kb-server="fake-live-2"] .kbcp-macts button[aria-label^="Delete"], [data-kb-server="fake-live-2"] .kbcp-macts button[aria-label^="Supprimer"]').click()`)
    await sleep(300)
    await shot('08-confirm-delete')
    await ev(`Array.from(document.querySelectorAll('[data-kb-server="fake-live-2"] .kbcp-confirm button')).find((b) => /Delete|Supprimer/.test(b.textContent)).click()`)
    const gone = await waitFor(page, `!document.querySelector('[data-kb-server="fake-live-2"]')`, 10000)
    check('deleted: the row goes', gone !== null)
  }
} catch (e) {
  console.error('✗ the check crashed: ' + (e && e.stack ? e.stack : e))
  fail += 1
} finally {
  rmSync(tmp, { recursive: true, force: true })
  await live.close()
}
console.log('\n' + (fail === 0 ? '✓ ' + pass + ' checks, all green' : '✗ ' + fail + ' failed, ' + pass + ' passed'))
process.exit(fail === 0 ? 0 : 1)
