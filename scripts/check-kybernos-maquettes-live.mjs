// The Maquettes page on a real GUI: add a folder, open a page in its sandboxed frame, edit a text with a real click and real typing, save, see the file change
// by that text only, undo, and read the editor in both languages. Run it against the SANDBOX (scripts/sandbox/setup.sh && start.sh, then `source scripts/sandbox/env.sh`):
// it registers a throw-away folder under the system temp dir and takes it out again, but it writes in the registry of the DSH it talks to and, in that folder, files.
//
// Named check-* on purpose: it needs a running DSH and Chrome, so CI must not run it.
//   node scripts/check-kybernos-maquettes-live.mjs     (KB_HOST of the sandbox; KB_SHOT_DIR=/some/dir keeps screenshots)
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLivePage, waitFor } from './live-page.mjs'
import { connect } from './cdp-lib.mjs'
import { fixtures } from '../packages/kybernos-maquettes/lib-fixtures.mjs'

const authority = process.env.KB_HOST
if (!authority || authority === '127.0.0.1:3080') { console.log('Run this against the sandbox (source scripts/sandbox/env.sh): it will not touch the real :3080.'); process.exit(2) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let fails = 0
const check = (label, ok, detail) => { if (!ok) fails += 1; console.log((ok ? 'ok   ' : 'FAIL ') + label + (detail !== undefined && !ok ? ' | ' + detail : '')) }
const shotDir = process.env.KB_SHOT_DIR || join(tmpdir(), 'kb-maquettes-live')
mkdirSync(shotDir, { recursive: true })

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kb-mq-live-')))
const fx = fixtures().creator
for (const [name, text] of Object.entries(fx)) writeFileSync(join(dir, name), text)
writeFileSync(join(dir, 'two.html'), fx['index.html'].replace('Create your app', 'Second page'))
const ORIGINAL = fx['index.html']
const onDisk = () => readFileSync(join(dir, 'index.html'), 'utf8')

const live = await openLivePage({ width: 1360, height: 1000 })
const { page } = live
const q = async (js, ms = 20000) => { const r = await page.evalJs(js, ms); return r.err ? { __err: r.err } : r.val }

// The frame of the maquette is a sandboxed page that Chrome keeps in a process of its own: it is a target of its own, driven through its own connection.
const debugBase = 'http://' + new URL(page.info.webSocketDebuggerUrl.replace(/^ws/, 'http')).host
let frameConn = null
let frameTargetId = ''
const frameTarget = async () => {
  try {
    const list = await (await fetch(debugBase + '/json/list')).json()
    const t = list.find((x) => /\/kybernos-maquettes\/v\//.test(x.url) && x.type !== 'page' && x.type !== 'service_worker')
    if (!t) return null
    if (frameConn === null || frameTargetId !== t.id) {
      try { if (frameConn) frameConn.close() } catch (e) { /* gone */ }
      frameConn = await connect(t)
      frameTargetId = t.id
    }
    return frameConn
  } catch (e) { return null }
}
const fq = async (js, ms = 15000) => {
  const c = await frameTarget()
  if (c === null) return { __err: 'no frame target' }
  const r = await c.evalJs(js, ms)
  return r.err ? { __err: r.err } : r.val
}
const fsend = async (method, params) => { const c = await frameTarget(); return c ? c.send(method, params) : {} }
// An element of the editor (inside its shadow root) or of the page, as the centre of its box in the window of the DSH page.
const SHADOW = `(document.querySelector('div[data-ky-ui]') || {}).shadowRoot`
const centreOf = async (inFrame) => {
  const box = await q(`(() => { const r = document.querySelector('[data-kb="maquettes-frame"]').getBoundingClientRect(); return { x: r.left, y: r.top } })()`)
  const c = await fq(`(() => { const e = ${inFrame}; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 14) } })()`)
  return c && !c.__err ? { x: box.x + c.x, y: box.y + c.y } : null
}
const mouse = async (p) => {
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 })
}
const press = async (inFrame) => { const p = await centreOf(inFrame); if (p === null) return false; await mouse(p); return true }
const inShadow = (sel) => `${SHADOW}.querySelector(${JSON.stringify(sel)})`
const until = async (js, ms = 15000, inFrame = false) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = inFrame ? await fq(js) : await q(js); if (v && !v.__err) return v; await sleep(250) } return false }
const lang = async () => q(`(window.__KB_LANG_RESOLVE__ && String(window.__KB_LANG_RESOLVE__()).split(/[-_]/)[0] === 'fr') || (window.__KB_LANG_RESOLVE__ && window.__KB_LANG_RESOLVE__() === 'kybernos') ? 'fr' : 'en'`)

// What the editor draws, with the words of every attribute a person can read.
const editorWords = () => fq(`(() => { const r = ${SHADOW}; if (!r) return []; const out = []; r.querySelectorAll('*').forEach((e) => { if (e.tagName === 'STYLE') return; for (const a of ['title', 'placeholder', 'aria-label']) { const v = e.getAttribute(a); if (v) out.push(v) } if (e.children.length === 0 && e.textContent.trim()) out.push(e.textContent.trim()) }); return [...new Set(out)] })()`)
const FRENCH = /[àâçéèêëîïôùûœ]|\b(Enregistrer|Annuler|Modifier|Ajouter|Supprimer|Dupliquer|Réglages|Quitter|Aucun|Couleur|Texte|Police|Bordure|Marges|Titre|Rien|Retour)\b/
const openMaquette = async () => {
  await q(`document.querySelector('[data-act="open"]').click()`)
  return until(`document.querySelector('[data-kb="maquettes-frame"]') !== null`, 8000)
}
const editorReady = () => until(`!!(${SHADOW}) && !!${inShadow('#pill')}`, 20000, true)

try {
  await page.send('Page.navigate', { url: 'http://' + authority + '/' })
  await waitFor(page, 'document.body && document.body.innerText.length > 40', 30000)
  await sleep(9000)
  const appLang = await lang()

  // ── the way in: Creations, not a row of its own
  const rows = await q(`[...document.querySelectorAll('.kb4-menu .kb4-item')].map((x) => x.textContent.trim().replace(/[0-9+]+$/, ''))`)
  check('the menu has no Maquettes row of its own while Creations lists them', Array.isArray(rows) && rows.indexOf('Mockups') < 0 && rows.indexOf('Maquettes') < 0 && rows.indexOf('Creations') >= 0, JSON.stringify(rows))
  await q(`[...document.querySelectorAll('.kb4-menu .kb4-item')].find((x) => x.textContent.trim().startsWith('Creations')).click()`)
  await sleep(3500)
  const tiles = await q(`[...document.querySelectorAll('[data-kb="type-tiles"] .kb-type-lab')].map((x) => x.textContent)`)
  check('Creations draws a Mockups tile', Array.isArray(tiles) && tiles.some((t) => /^(Mockups|Maquettes)$/.test(t)), JSON.stringify(tiles))

  // ── the page
  await q(`window.__KB_OPEN__({ view: 'maquettes' })`)
  const here = await until(`document.querySelector('[data-kb="maquettes-page"]') !== null`, 10000)
  check('the Maquettes page opens', here === true)
  check('it has the add form and the title', (await q(`!!document.querySelector('[data-kb="maquettes-path"]') && /^(Mockups|Maquettes)$/.test((document.querySelector('.kbmq h1') || {}).textContent || '')`)) === true)
  await page.shot(join(shotDir, '1-list-empty.png'))

  const type = async (value) => q(`(() => { const i = document.querySelector('[data-kb="maquettes-path"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(value)}); i.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  await type('/definitely/not/a/folder')
  await sleep(300)
  await q(`document.querySelector('[data-act="add"]').click()`)
  const refused = await until(`(document.querySelector('[data-kb="maquettes-error"]') || {}).textContent || false`, 8000)
  check('a path that is not a folder is refused in words', typeof refused === 'string' && refused.length > 5, JSON.stringify(refused))

  await type(dir)
  await sleep(300)
  await q(`document.querySelector('[data-act="add"]').click()`)
  const card = await until(`(() => { const c = [...document.querySelectorAll('[data-kb="maquettes-folder"]')].find((x) => x.textContent.includes('two.html')); return c ? c.textContent : false })()`, 10000)
  check('the folder is added: a card with its two pages', typeof card === 'string' && /2 pages|2 pages/.test(card), JSON.stringify(card))
  await page.shot(join(shotDir, '2-list.png'))
  const stats0 = await q(`fetch('/kybernos-maquettes/stats').then((r) => r.json())`)
  check('the use counter counted it', stats0 && stats0.ok && stats0.stats && stats0.stats['folders-added'] >= 1, JSON.stringify(stats0))

  // ── the frame
  check('Open shows the maquette in a frame', (await openMaquette()) === true)
  const sbx = await q(`document.querySelector('[data-kb="maquettes-frame"]').getAttribute('sandbox')`)
  check('the frame is sandboxed without allow-same-origin', typeof sbx === 'string' && sbx.includes('allow-scripts') && !sbx.includes('allow-same-origin'), JSON.stringify(sbx))
  check('the editor loads in it (its pill is there)', (await editorReady()) === true)
  const wall = await fq(`(() => { const out = {}; try { parent.document.title; out.parent = 'reached' } catch (e) { out.parent = 'blocked' } try { out.cookie = document.cookie } catch (e) { out.cookie = 'blocked' } try { void window.top.location.href; out.top = 'reached' } catch (e) { out.top = 'blocked' } return out })()`)
  check('the maquette cannot reach the DSH page, its cookie or its address', wall && wall.parent === 'blocked' && (wall.cookie === 'blocked' || wall.cookie === '') && wall.top === 'blocked', JSON.stringify(wall))
  const direct = await q(`fetch(document.querySelector('[data-kb="maquettes-frame"]').getAttribute('src').replace('/index.html', '/index.html?raw=1')).then((r) => r.text())`)
  check('the file in the frame is the one on disk, byte for byte, with ?raw=1', direct === ORIGINAL)
  await page.shot(join(shotDir, '3-frame.png'))

  // ── the language of the editor follows the page's, not the browser's
  const pill = await fq(`${inShadow('#pill')}.textContent.trim()`)
  check('the editor speaks the language of the app (' + appLang + ')', appLang === 'fr' ? /Modifier/.test(pill) : /Edit/.test(pill), JSON.stringify(pill))

  // ── a real edit: click the title, replace it, save
  check('click Edit', await press(inShadow('#pill')))
  check('the bar appears', (await until(`!${inShadow('#bar')}.hidden && getComputedStyle(${inShadow('#bar')}).display !== 'none'`, 6000, true)) === true)
  check('click the title', await press(`document.querySelector('h1.kb-title')`))
  await sleep(500)
  check('the title is being edited', (await fq(`document.querySelector('h1.kb-title').getAttribute('contenteditable') !== null`)) === true)
  await fsend('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 4, commands: ['selectAll'] })
  await fsend('Input.insertText', { text: 'Live edit title' })
  await sleep(500)
  const cnt = await fq(`${inShadow('#cnt')}.textContent.trim()`)
  check('one change is waiting', /1/.test(cnt || ''), JSON.stringify(cnt))
  check('nothing is written before Save', onDisk() === ORIGINAL)
  await page.shot(join(shotDir, '4-editing.png'))
  check('click Save', await press(inShadow('#save')))
  const wrote = await (async () => { for (let i = 0; i < 40; i += 1) { if (onDisk() !== ORIGINAL) return true; await sleep(250) } return false })()
  check('the file now holds the new title', wrote && onDisk().includes('<h1 class="kb-title">Live edit title</h1>'), JSON.stringify({ toast: await fq(`(${SHADOW} && ${inShadow('#toast')} ? ${inShadow('#toast')}.textContent : '')`), file: onDisk().slice(0, 700) }))
  check('and nothing else changed: the file is the original with that one text replaced', onDisk() === ORIGINAL.replace('Create your app', 'Live edit title'))
  check('the style sheet next to it is untouched', readFileSync(join(dir, 'dsh.css'), 'utf8') === fx['dsh.css'])
  check('the page came back with the new title and the editor', (await until(`document.querySelector('h1.kb-title') && document.querySelector('h1.kb-title').textContent === 'Live edit title' && !!${inShadow('#pill')}`, 15000, true)) === true)
  await page.shot(join(shotDir, '5-saved.png'))

  // ── undo goes back to before the save
  check('open the list of changes', await press(inShadow('#cnt')))
  await sleep(500)
  check('click « back before the last save »', await press(inShadow('#l-undo')))
  await sleep(500)
  check('confirm', await press(inShadow('#c-ok')))
  const back = await (async () => { for (let i = 0; i < 40; i += 1) { if (onDisk() === ORIGINAL) return true; await sleep(250) } return false })()
  check('undo puts the file back exactly', back)
  check('the page is back too', (await until(`document.querySelector('h1.kb-title') && document.querySelector('h1.kb-title').textContent === 'Create your app'`, 15000, true)) === true)

  // ── a picture dropped on the page goes through the DSH page to the host (with the session), lands in images/ and in the file as a block
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  if ((await fq(`getComputedStyle(${inShadow('#bar')}).display === 'none'`)) === true) await press(inShadow('#pill'))
  await sleep(400)
  await fq(`(() => { const bytes = Uint8Array.from(atob('${PNG}'), (c) => c.charCodeAt(0)); const dt = new DataTransfer(); dt.items.add(new File([bytes], 'live pic.png', { type: 'image/png' })); const r = document.querySelector('main').getBoundingClientRect(); document.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 40, clientY: r.top + 30 })); return true })()`)
  const stored = await (async () => { for (let i = 0; i < 40; i += 1) { try { const f = readdirSync(join(dir, 'images')).find((n) => /^live-pic-[0-9a-f]{8}\.png$/.test(n)); if (f) return f } catch (e) { /* not yet */ } await sleep(250) } return null })()
  check('the dropped picture is stored in the folder under images/ (through the DSH page, with the session)', stored !== null)
  check('and it is the picture, byte for byte', stored !== null && readFileSync(join(dir, 'images', stored)).equals(Buffer.from(PNG, 'base64')))
  check('the page still has not been written', onDisk() === ORIGINAL)
  check('click Save', await press(inShadow('#save')))
  const withPic = await (async () => { for (let i = 0; i < 40; i += 1) { if (onDisk() !== ORIGINAL) return true; await sleep(250) } return false })()
  check('the file now holds the picture as a block', withPic && stored !== null && onDisk().includes('images/' + stored))
  const pureInsertion = (now) => { const d = now.length - ORIGINAL.length; let k = 0; while (k < ORIGINAL.length && now[k] === ORIGINAL[k]) k += 1; return d > 0 && now.slice(0, k) + now.slice(k + d) === ORIGINAL ? now.slice(k, k + d) : null }
  const inserted = pureInsertion(onDisk())
  check('and the rest of the file is the original: the change is one block added, nothing else', inserted !== null && /img[^>]*images\//.test(inserted), JSON.stringify(inserted))
  await until(`!!${inShadow('#cnt')}`, 15000, true)
  await sleep(800)
  check('open the list of changes', await press(inShadow('#cnt')))
  await sleep(500)
  check('click « back before the last save »', await press(inShadow('#l-undo')))
  await sleep(500)
  check('confirm', await press(inShadow('#c-ok')))
  check('undo puts the file back exactly', await (async () => { for (let i = 0; i < 40; i += 1) { if (onDisk() === ORIGINAL) return true; await sleep(250) } return false })())
  await until(`!!${inShadow('#pill')}`, 15000, true)

  // ── the words of the editor, in each language (the DSH language setting is not touched: the throw-away browser is told it)
  const addPanel = async () => { await editorReady(); await press(inShadow('#pill')); await sleep(400); await press(inShadow('#ins')); await sleep(600) }
  for (const forced of ['en', 'fr']) {
    await q(`window.__KB_LANG_RESOLVE__ = () => ${JSON.stringify(forced === 'fr' ? 'kybernos' : 'en')}; document.querySelector('[data-kb="maquettes-back"]').click()`)
    await sleep(800)
    check(forced + ': back on the list', (await openMaquette()) === true)
    await editorReady()
    await addPanel()
    const tilesN = await fq(`${SHADOW}.querySelectorAll('.tile').length`)
    check(forced + ': the Add panel holds 15 blocks', tilesN === 15, String(tilesN))
    const words = await editorWords()
    const wrong = Array.isArray(words) ? words.filter((w) => (forced === 'en' ? FRENCH.test(w) : /\b(Save|Cancel|Edit|Quit|Delete|Duplicate|Settings)\b/.test(w))) : ['no words']
    check(forced + ': the editor shows nothing in the other language (' + (Array.isArray(words) ? words.length : 0) + ' strings read)', wrong.length === 0, JSON.stringify(wrong.slice(0, 8)))
    await page.shot(join(shotDir, '6-add-panel-' + forced + '.png'))
  }

  // ── narrow window
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: false })
  await sleep(800)
  const fits = await q(`(() => { const f = document.querySelector('[data-kb="maquettes-frame"]'); const r = f ? f.getBoundingClientRect() : null; return r ? { right: Math.round(r.right), width: window.innerWidth } : null })()`)
  check('in a narrow window the frame stays inside the window', fits && fits.right <= fits.width, JSON.stringify(fits))
  check('the Add panel was closed by the resize (it would stay at its old place)', (await fq(`${inShadow('#insm')}.hidden`)) === true)
  await press(inShadow('#ins'))
  await sleep(600)
  const panel = await fq(`(() => { const r = ${inShadow('#insm')}.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), width: innerWidth, hidden: ${inShadow('#insm')}.hidden } })()`)
  check('in a narrow window the Add panel opens inside the frame', panel && !panel.hidden && panel.left >= 0 && panel.right <= panel.width, JSON.stringify(panel))
  await page.shot(join(shotDir, '7-narrow.png'))
  await page.send('Emulation.clearDeviceMetricsOverride')

  // ── the counters and the way out
  const stats = await q(`fetch('/kybernos-maquettes/stats').then((r) => r.json())`)
  check('the use counter counted the saves and the undo', stats && stats.ok && stats.stats && stats.stats.saves >= 1 && stats.stats.undos >= 1, JSON.stringify(stats && stats.stats))
  await q(`document.querySelector('[data-kb="maquettes-back"]').click()`)
  await sleep(800)
  await q(`document.querySelector('[data-act="remove"]').click()`)
  await sleep(300)
  await q(`document.querySelector('[data-act="remove-yes"]').click()`)
  await sleep(1200)
  const left = await q(`fetch('/kybernos-maquettes/folders').then((r) => r.json()).then((j) => j.folders.length)`)
  check('removing the folder from the list leaves the files alone', left === 0 && onDisk() === ORIGINAL)
  const errs = (page.errs || []).filter((e) => /maquettes|ky-edit/i.test(e))
  check('no console error from the plugin', errs.length === 0, JSON.stringify(errs.slice(0, 3)))
} catch (e) {
  fails += 1
  console.log('ERROR', String(e && e.message ? e.message : e))
} finally {
  try { if (frameConn) frameConn.close() } catch (e) { /* gone */ }
  await live.close()
  rmSync(dir, { recursive: true, force: true })
}
console.log(fails === 0 ? '\nall ok (screenshots in ' + shotDir + ')' : '\n' + fails + ' failure(s) (screenshots in ' + shotDir + ')')
process.exit(fails === 0 ? 0 : 1)
