#!/usr/bin/env node
// The Motion plugin (packages/kybernos-motion), end to end, in a real GUI.
//
//   source scripts/sandbox/env.sh && node scripts/check-motion-live.mjs [--shots <dir>]
//
// It needs a DSH that LOADS the bundle, i.e. a second instance whose profile links this checkout:
// `scripts/sandbox/setup.sh` then `scripts/sandbox/start.sh` build and start one (see docs/dev/live-testing.md). The user's own
// `dsh web` does not list the bundle, and this script refuses to run against it (exit 3).
//
// What it checks, in a real page:
//   1. the host answers, a scene file is saved through the real route and the Motion tab opens by itself;
//   2. the panel paints (real pixels), plays, scrubs from the keyboard, and a settings edit reaches the file on disk
//      as a new revision made by the user;
//   3. a frame request from the agent is answered with a real PNG of the right size (the request is injected in the
//      state answer: the agent's tool itself is covered by test-host.mjs);
//   4. the real MP4 export (WebCodecs in Chrome): the file lands in artifacts/ and ffprobe reads H.264 and AAC;
//   5. the Livrables page lists the scene, draws its thumbnail and opens the player; "Edit" brings the panel back;
//   6. the live page the Mac app is built from plays by itself (no DSH around it);
//   7. a 3D scene (WebGL), a glTF model with its animation clip and a Lottie file are drawn, deterministic, exported
//      to a decodable MP4 whose frames contain the 3D pixels, and carried by the standalone page;
//   8. R3-01: the transport is Start / Play / End + 0.5× 1× 2× 4× + a state pill (2× runs the clock twice as fast), and a remembered scene
//      whose file is gone gives the empty state (no red error, no request for it on every poll).
//
// SAFETY: the scene lives in <worktree>/artifacts/ and is removed at the end; no Mac app is installed.
// Exit code 0 / 1 / 3.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, clickText } from './live-page.mjs'
import { makeLottie, makeRealGlb } from '../packages/kybernos-motion/lib-fixtures.mjs'

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
const worktree = process.env.KB_WORKTREE
if (!worktree || !existsSync(join(worktree, 'packages', 'kybernos-motion'))) { console.error('○ inconclusive: KB_WORKTREE does not point at a checkout with packages/kybernos-motion (source scripts/sandbox/env.sh).'); process.exit(3) }

const live = await openLivePage({ width: 1500, height: 1000 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const val = async (expr, ms) => (await page.evalJs(expr, ms)).val
const shot = async (name) => { if (shotDir !== null) { try { mkdirSync(shotDir, { recursive: true }); await page.shot(join(shotDir, name + '.png')) } catch (e) { /* no screenshot */ } } }
const poll = async (fn, ms = 15000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await sleep(250) } }
const click = (sel) => val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true })()`)

const dir = join(worktree, 'artifacts')
const scenePath = join(dir, 'motion-live-check.miniapp.json')
const mp4Path = join(dir, 'motion-live-check.mp4')
const scene3dPath = join(dir, 'motion-live-3d.miniapp.json')
const modelPath = join(dir, 'motion-live-model.miniapp.json')
const mp4Path3d = join(dir, 'motion-live-3d.mp4')
const vanishPath = join(dir, 'motion-live-vanish.miniapp.json')
const mediaDir = join(dir, 'motion-live-media')
const cleanup = () => {
  for (const f of [scenePath, mp4Path, join(dir, 'motion-live-check-2.mp4'), scene3dPath, modelPath, mp4Path3d, vanishPath]) { try { rmSync(f, { force: true }) } catch (e) { /* gone */ } }
  try { rmSync(mediaDir, { recursive: true, force: true }) } catch (e) { /* gone */ }
  try { if (existsSync(dir) && readdirSync(dir).length === 0) rmdirSync(dir) } catch (e) { /* not empty: not ours */ }
}
const readScene = () => { try { return JSON.parse(readFileSync(scenePath, 'utf8')) } catch (e) { return null } }

const SCENE = {
  format: { width: 1280, height: 720, fps: 30, duration: 4 },
  background: '#0f1115',
  params: { titre: 'Bonjour', accent: '#4176e6', total: 12480 },
  controls: [{ id: 'titre', label: 'Titre', type: 'text' }, { id: 'accent', label: 'Accent', type: 'color' }, { id: 'total', label: 'Total', type: 'number' }],
  layers: [
    { type: 'circle', name: 'Balayage', x: 640, y: 360, r: { k: [[0, 0], [1, 900, 'io']] }, fill: '$accent', alpha: { k: [[0, 1], [1, 1, 'lin'], [1.6, 0, 'out']] } },
    { type: 'text', name: 'Titre', text: '{titre}', x: 640, y: { k: [[1, 330], [1.8, 280, 'out']] }, size: 110, weight: 700, alpha: { k: [[1, 0], [1.7, 1, 'out']] } },
    { type: 'number', name: 'Total', value: { k: [[1, 0], [3, '$total', 'out']] }, x: 640, y: 450, size: 90, suffix: ' €' },
    { type: 'chart', name: 'Barres', kind: 'bar', x: 640, y: 600, w: 600, h: 180, data: [{ label: 'A', value: 3 }, { label: 'B', value: 5 }], p: { k: [[1.5, 0], [3, 1, 'out']] }, labelSize: 30 },
    { type: 'particles', name: 'Confettis', x: 640, y: 360, count: 80, t0: 1, life: 1.6, seed: 4 },
    { type: 'morph', name: 'Forme', x: 140, y: 140, size: 120, p: { k: [[1, 0], [3, 1, 'io']] }, fill: '$accent' },
  ],
  audio: [{ synth: 'ding', at: 1 }],
}

try {
  // ═══ 1. host, file, tab ═══════════════════════════════════════════════════════════════
  console.log('\n── 1. the host, a scene file, the tab ──')
  const st0 = await val(`fetch('/kybernos-motion/state').then((r) => r.json()).then((j) => JSON.stringify(j)).catch(() => null)`)
  check('the host answers on /kybernos-motion/state', typeof st0 === 'string' && JSON.parse(st0).ok === true, st0)
  // a session must be mounted for the right sidebar: write a first message from the empty composer (no model here, the turn fails, that is fine)
  const composer = await poll(() => val(`(() => { const e = document.querySelector('[contenteditable="true"], textarea'); if (!e) return null; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.x + 40, y: r.y + r.height / 2 }) })()`), 20000)
  if (typeof composer === 'string') {
    const { x, y } = JSON.parse(composer)
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
    await sleep(300)
    await page.send('Input.insertText', { text: 'Motion check' })
    await sleep(300)
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await sleep(1500)
  }
  mkdirSync(dir, { recursive: true })
  const saved = await val(`fetch('/kybernos-motion/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: ${JSON.stringify(scenePath)}, scene: ${JSON.stringify(SCENE)}, what: 'live check', title: 'Live check' }) }).then((r) => r.json()).then((j) => JSON.stringify(j)).catch((e) => String(e))`)
  const savedJson = (() => { try { return JSON.parse(saved) } catch (e) { return null } })()
  check('a scene is saved through the real route, inside the allowed folder', savedJson !== null && savedJson.ok === true && savedJson.rev === 1, saved)
  check('the file on disk is a motion doc with its first revision', readScene() !== null && readScene().kind === 'motion' && readScene().meta.rev === 1)
  const tab = await poll(() => val(`!!document.querySelector('[data-kb="motion-panel"]')`), 20000)
  check('the Motion tab opens by itself when a scene arrives', tab === true)
  await shot('1-panel')

  // ═══ 2. the panel ═════════════════════════════════════════════════════════════════════
  console.log('\n── 2. the panel: pixels, play, scrub, edit ──')
  const painted = () => val(`(() => { const c = document.querySelector('[data-kb="motion-canvas"]'); if (!c) return -1; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; const r0 = d[0], g0 = d[1], b0 = d[2]; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - r0) + Math.abs(d[i + 1] - g0) + Math.abs(d[i + 2] - b0) > 60) n++; return n })()`)
  const px = await poll(async () => { const n = await painted(); return n > 500 ? n : 0 }, 10000)
  check('the canvas holds a real picture (title, counter, chart: many pixels differ from the background)', px > 500, px)
  const timeText = () => val(`(document.querySelector('[data-kb="motion-panel"] .kbmt-time') || { innerText: '' }).innerText`)
  // a scene that has just arrived plays by itself (the first thing seen is the animation, not an empty first frame)
  const a0 = await timeText()
  await sleep(900)
  const a1 = await timeText()
  check('a scene that arrives starts playing by itself', typeof a0 === 'string' && a0 !== a1, [a0, a1])
  await click('[data-act="play"]') // pause
  const p0 = await timeText()
  await sleep(700)
  check('pause stops the clock', p0 === (await timeText()), p0)
  const t0 = p0
  await click('[data-act="play"]') // play again
  await sleep(900)
  const t1 = await timeText()
  await click('[data-act="play"]')
  const glyph = await val(`(() => { const b = document.querySelector('[data-kb="motion-panel"] [data-act="play"]'); const cs = getComputedStyle(b); return JSON.stringify([cs.color, cs.backgroundColor]) })()`)
  const [fg, bg] = JSON.parse(glyph || '["",""]')
  check('the play button\'s glyph is readable (its colour differs from its background)', fg !== '' && fg !== bg, glyph)
  check('play makes the clock run again', typeof t0 === 'string' && typeof t1 === 'string' && t0 !== t1, [t0, t1])
  const v0 = await val(`document.querySelector('[data-kb="motion-timeline"] [role="slider"]').getAttribute('aria-valuenow')`)
  await val(`(() => { const s = document.querySelector('[data-kb="motion-timeline"] [role="slider"]'); s.focus(); for (let i = 0; i < 5; i++) s.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })) })()`)
  const v1 = await val(`document.querySelector('[data-kb="motion-timeline"] [role="slider"]').getAttribute('aria-valuenow')`)
  check('the arrow keys move the cursor on the timeline', Number(v1) > Number(v0), [v0, v1])
  check('the timeline has one row per layer', (await val(`document.querySelectorAll('[data-kb="motion-timeline"] .kbmt-tl-row').length`)) === SCENE.layers.length)
  check('the settings form is built from the scene\'s controls', (await val(`document.querySelectorAll('.kbmt-params .kbmt-fld').length`)) === 3)
  // edit the title: focus the field, replace the text, wait for the debounce, read the file
  await val(`(() => { const i = document.querySelector('#kbmt-f-titre'); i.focus(); i.select() })()`)
  await page.send('Input.insertText', { text: 'Titre modifié' })
  const edited = await poll(() => { const s = readScene(); return s && s.meta.rev >= 2 ? s : null }, 8000)
  check('an edit reaches the file as a new revision made by the user', edited !== null && edited.data[0].params.titre === 'Titre modifié' && edited.meta.history[edited.meta.history.length - 1].by === 'user', edited && edited.meta)
  check('the file stays lean (defaults are not written back)', edited !== null && JSON.stringify(edited.data[0]).length < 1500, edited && JSON.stringify(edited.data[0]).length)
  check('the status says it was sent to the agent', await poll(() => val(`/(Envoyé à l’agent|Sent to the agent)/.test((document.querySelector('.kbmt-status') || { innerText: '' }).innerText)`), 3000) === true)
  await shot('2-edited')
  const revs = await val(`(() => { document.querySelector('[data-act="revisions"]').click(); return true })()`)
  const revRows = await poll(() => val(`document.querySelectorAll('.kbmt-pop .kbmt-rv').length`), 4000)
  check('the revisions list opens with the revisions', revs === true && revRows >= 2, revRows)
  await val(`document.querySelector('[data-act="revisions"]').click()`)

  // R3-01 (A4-26): the transport is the one of the Slides, Modeleur and Bricks panels: Start / Play / End, 0.5× 1× 2× 4×, a state pill.
  const tr = JSON.parse((await val(`(() => { const t = document.querySelector('[data-kb="motion-panel"] .kbmt-transport'); if (!t) return 'null'; return JSON.stringify({ acts: Array.from(t.querySelectorAll('button[data-act]')).map((b) => b.getAttribute('data-act')), speeds: Array.from(t.querySelectorAll('[data-act="speed"]')).map((b) => b.innerText.trim()), on: Array.from(t.querySelectorAll('[data-act="speed"][aria-pressed="true"]')).map((b) => b.innerText.trim()) }) })()`)) || 'null')
  check('the transport row is Start, Play, End, then 0.5× 1× 2× 4×, with 1× on', tr !== null && JSON.stringify(tr.acts.slice(0, 3)) === JSON.stringify(['start', 'play', 'end']) && JSON.stringify(tr.speeds) === JSON.stringify(['0.5×', '1×', '2×', '4×']) && JSON.stringify(tr.on) === JSON.stringify(['1×']), tr)
  const seconds = async () => { const m = /^(\d+):(\d+\.\d)/.exec(String(await timeText())); return m === null ? NaN : Number(m[1]) * 60 + Number(m[2]) }
  const pill = () => val(`(document.querySelector('[data-kb="motion-panel"] .kbmt-state') || { innerText: '' }).innerText`)
  await click('[data-act="end"]')
  await sleep(300)
  check('End stops at the end of the scene and the pill says Done / Fini', /^(Done|Fini)$/.test(String(await pill())) && Math.abs((await seconds()) - SCENE.format.duration) < 0.2, [await pill(), await seconds()])
  await click('[data-act="start"]')
  await sleep(300)
  check('Start goes back to 0:00.0 and holds there', (await seconds()) === 0 && !/^(Done|Fini)$/.test(String(await pill())), [await pill(), await seconds()])
  const clockSpeed = async (label) => {
    await click('[data-act="start"]')
    await val(`(() => { const b = Array.from(document.querySelectorAll('[data-kb="motion-panel"] [data-act="speed"]')).find((x) => x.innerText.trim() === ${JSON.stringify(label)}); if (b) b.click() })()`)
    await click('[data-act="play"]')
    await sleep(1000)
    const t = await seconds()
    await click('[data-act="play"]')
    return t
  }
  const at1 = await clockSpeed('1×')
  const at2 = await clockSpeed('2×')
  check('2× runs the clock about twice as fast as 1× (the sound follows through playbackRate)', at1 > 0.3 && at2 / at1 > 1.5 && at2 / at1 < 2.6, { at1, at2 })
  await val(`(() => { const b = Array.from(document.querySelectorAll('[data-kb="motion-panel"] [data-act="speed"]')).find((x) => x.innerText.trim() === '1×'); if (b) b.click() })()`)
  await shot('2-transport')

  // ═══ 3. the agent asks for a frame ═══════════════════════════════════════════════════
  console.log('\n── 3. a frame for the agent ──')
  const frames = []
  let inject = null
  page.on('Fetch.requestPaused', async (p) => {
    try {
      const url = p.request.url
      if (/\/kybernos-motion\/state/.test(url) && inject !== null) {
        const real = await fetch('http://' + host + '/kybernos-motion/state?x=1').then((r) => r.json()).catch(() => ({ ok: true, current: null }))
        const body = JSON.stringify({ ...real, frame: { id: inject.id, t: inject.t } })
        await page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: Buffer.from(body).toString('base64') })
        return
      }
      if (/\/kybernos-motion\/frame/.test(url) && p.request.method === 'POST') {
        const entry = (p.request.postDataEntries || [])[0]
        frames.push({ url, bytes: entry && entry.bytes ? Buffer.from(entry.bytes, 'base64') : null })
        await page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: Buffer.from('{"ok":true}').toString('base64') })
        return
      }
      await page.send('Fetch.continueRequest', { requestId: p.requestId })
    } catch (e) { try { await page.send('Fetch.continueRequest', { requestId: p.requestId }) } catch (e2) { /* gone */ } }
  })
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*/kybernos-motion/state*', requestStage: 'Request' }, { urlPattern: '*/kybernos-motion/frame*', requestStage: 'Request' }] })
  inject = { id: 'live-frame-1', t: 2.5 }
  const got = await poll(() => (frames.length > 0 ? frames[0] : null), 10000)
  inject = null
  const png = got && got.bytes
  check('the panel answers a frame request with a PNG', png !== null && png !== undefined && png.length > 1000 && png[0] === 0x89 && png[1] === 0x50, png && png.length)
  check('the request carried the id the agent is waiting for', got !== null && /id=live-frame-1/.test(got.url), got && got.url)
  check('the PNG has the scene\'s size (1280 wide, 16:9)', png && png.readUInt32BE(16) === 1280 && png.readUInt32BE(20) === 720, png && [png.readUInt32BE(16), png.readUInt32BE(20)])
  await page.send('Fetch.disable', {})

  // ═══ 4. the real MP4 ════════════════════════════════════════════════════════════════
  console.log('\n── 4. the MP4 export ──')
  await click('[data-act="export"]')
  check('the export dialog opens', await poll(() => val(`!!document.querySelector('.kbmt-modal')`), 4000) === true)
  await shot('4-export-dialog')
  await val(`(() => { const r = Array.from(document.querySelectorAll('.kbmt-modal input[name="kbmt-res"]')).pop(); if (r) r.click() })()`)
  await click('[data-act="export-go"]')
  const done = await poll(() => val(`!!document.querySelector('.kbmt-modal [data-act="download"]')`), 120000)
  check('the export finishes in the browser', done === true, await val(`(document.querySelector('.kbmt-modal') || { innerText: '' }).innerText.slice(0, 200)`))
  await shot('4-export-done')
  check('the video is written next to the scene, inside artifacts/', existsSync(mp4Path) && readFileSync(mp4Path).length > 2000, existsSync(mp4Path))
  // what a browser makes of the file (the Livrables card plays it): its own idea of the length
  const browserSeconds = await val(`(async () => { const v = document.createElement('video'); v.preload = 'metadata'; v.muted = true; v.src = ${JSON.stringify('/kybernos/art-raw?path=' )} + encodeURIComponent(${JSON.stringify(mp4Path)}); await new Promise((res) => { v.onloadedmetadata = res; v.onerror = res; setTimeout(res, 8000) }); return v.duration })()`, 15000)
  console.log('    (the browser reads it as ' + browserSeconds + ' s)')
  if (existsSync(mp4Path)) {
    // ffprobe may be missing next to ffmpeg: read the stream lines ffmpeg prints, and decode the whole file to nowhere
    const info = spawnSync('ffmpeg', ['-hide_banner', '-i', mp4Path], { encoding: 'utf8' })
    if (info.error) console.log('  ○ ffmpeg is not available: the file was not decoded')
    else {
      const text = String(info.stderr)
      const dur = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(text)
      const seconds = dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : null
      const size = /Video: h264[^\n]*?(\d{3,4})x(\d{3,4})/.exec(text)
      console.log('    (ffmpeg: duration ' + seconds + ' s' + (size ? ', ' + size[1] + 'x' + size[2] : '') + ')')
      check('ffmpeg reads H.264 video in 16:9, about the scene\'s 4 seconds', size !== null && Math.abs(Number(size[1]) / Number(size[2]) - 16 / 9) < 0.02 && seconds !== null && Math.abs(seconds - 4) < 0.5, { size: size && size.slice(1, 3), seconds })
      check('ffmpeg reads the sound track (AAC)', /Audio: aac/.test(text))
      const dec = spawnSync('ffmpeg', ['-v', 'error', '-i', mp4Path, '-f', 'null', '-'], { encoding: 'utf8' })
      check('the whole file decodes without a single error', dec.status === 0 && String(dec.stderr).trim() === '', String(dec.stderr).slice(0, 200))
    }
  }
  await click('.kbmt-modal [data-act="download"]') // a download in a headless page: must not throw
  await val(`(() => { const b = Array.from(document.querySelectorAll('.kbmt-modal button')).find((x) => /Fermer|Close/.test(x.innerText)); if (b) b.click() })()`)

  // ═══ 5. Livrables ═══════════════════════════════════════════════════════════════════
  console.log('\n── 5. the Livrables page ──')
  const opened = (await clickText(page, 'Livrables')) || (await clickText(page, 'Deliverables')) || (await clickText(page, 'Créations')) || (await clickText(page, 'Creations'))
  check('the Livrables page opens', opened === true)
  const card = await poll(() => val(`(() => { const e = Array.from(document.querySelectorAll('*')).find((x) => x.children.length === 0 && /motion-live-check/.test(x.innerText || '')); return !!e })()`), 20000)
  check('the scene is listed', card === true)
  const thumb = await poll(() => val(`(() => { const c = document.querySelector('[data-kb="motion-player-compact"] canvas'); if (!c || c.width < 10) return 0; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - d[0]) + Math.abs(d[i + 1] - d[1]) + Math.abs(d[i + 2] - d[2]) > 60) n++; return n })()`), 15000)
  check('its card draws a live thumbnail (the motion player, compact)', thumb > 100, thumb)
  await shot('5-livrables')
  await clickText(page, 'motion-live-check.miniapp.json')
  const player = await poll(() => val(`!!document.querySelector('[data-kb="motion-player"]')`), 10000)
  check('opening it shows the motion player (not the raw JSON)', player === true)
  await shot('5-player')
  // the live page a Mac app would be built from, without installing anything
  const exported = await val(`(async () => { const root = document.querySelector('.kbma-root'); const f = window.__KB_MINIAPP_EXPORTERS__ && window.__KB_MINIAPP_EXPORTERS__.motion; if (!root || !f) return null; const r = await f(root); return r ? JSON.stringify({ titre: r.titre, len: r.html.length, head: r.html.slice(0, 15) }) : null })()`, 20000)
  const ex = (() => { try { return JSON.parse(exported) } catch (e) { return null } })()
  check('the exporter gives miniapps a live page with the runtime inside', ex !== null && ex.head === '<!doctype html>' && ex.len > 50000, exported)
  check('miniapps says whether it can install here (a boolean, true on macOS)', (await val(`typeof (window.__KB_MINIAPPS__ || {}).supported`)) === 'boolean')
  const live2 = await val(`(async () => { const root = document.querySelector('.kbma-root'); const r = await window.__KB_MINIAPP_EXPORTERS__.motion(root); const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;left:0;top:0;width:640px;height:420px;z-index:99999;background:#000'; f.srcdoc = r.html; document.body.appendChild(f); await new Promise((res) => setTimeout(res, 1800)); const d = f.contentDocument; const c = d.getElementById('cv'); const bar1 = d.getElementById('bar').value; await new Promise((res) => setTimeout(res, 700)); const bar2 = d.getElementById('bar').value; const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < px.length; i += 4) if (Math.abs(px[i] - px[0]) + Math.abs(px[i + 1] - px[1]) + Math.abs(px[i + 2] - px[2]) > 60) n++; f.remove(); return JSON.stringify({ bar1, bar2, n }) })()`, 30000)
  const lv = (() => { try { return JSON.parse(live2) } catch (e) { return null } })()
  check('that page plays by itself: the bar moves and the canvas is painted', lv !== null && lv.bar1 !== lv.bar2 && lv.n > 200, live2)
  await val(`document.querySelector('[data-kb="motion-player"] [data-act="edit"]').click()`)
  const hint = await poll(() => val(`!!document.querySelector('[data-kb="motion-hint"]')`), 5000)
  check('"Edit" from Livrables (no chat on screen) says to open a chat instead of failing silently', hint === true)
  await shot('5-edit-hint')
  // back to the chat: the tab must open by itself on that scene (it kept trying)
  await val(`(() => { const b = document.querySelector('[aria-label="Close"], [aria-label="Fermer"], button[title="Close"]'); if (b) b.click() })()`)
  await sleep(400)
  await clickText(page, 'Motion check')
  const back = await poll(() => val(`(() => { const p = document.querySelector('[data-kb="motion-panel"]'); return p ? p.getAttribute('data-kb-path') : null })()`), 20000)
  check('back in the chat, the Motion panel opens by itself on that scene', typeof back === 'string' && back.endsWith('motion-live-check.miniapp.json'), back)
  await shot('5-back-in-chat')

  // ═══ 6. 3D, a glTF model, a Lottie ═══════════════════════════════════════════════════
  console.log('\n── 6. 3D, a glTF model and a Lottie ──')
  mkdirSync(mediaDir, { recursive: true })
  writeFileSync(join(mediaDir, 'hero.glb'), makeRealGlb())
  writeFileSync(join(mediaDir, 'hero.json'), JSON.stringify(makeLottie(2, 200)))
  const webgl = await val(`!!document.createElement('canvas').getContext('webgl2')`)
  if (webgl !== true) console.log('  ○ this browser has no WebGL: the 3D checks are skipped (Lottie is still checked)')
  const saveScene = (path, scene, title) => val(`fetch('/kybernos-motion/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: ${JSON.stringify(path)}, scene: ${JSON.stringify(scene)}, what: 'live check', title: ${JSON.stringify(title)} }) }).then((r) => r.json()).then((j) => j.ok === true).catch(() => false)`)
  const SCENE3 = {
    format: { width: 1280, height: 720, fps: 30, duration: 3 }, background: '#0f1115',
    layers: [
      { type: 'scene3d', name: 'Monde', x: 640, y: 380, w: 900, h: 560, bg: '#203040', orbit: { k: [[0, 0], [3, 90, 'lin']] }, objects: [
        { shape: 'box', x: -1.3, color: '#ff2020', ry: { k: [[0, 0], [3, 360, 'lin']] } },
        { shape: 'sphere', x: 1.3, color: '#20ff20' },
      ] },
      { type: 'lottie', name: 'Perso', src: 'motion-live-media/hero.json', x: 200, y: 200, w: 300, h: 300 },
    ],
  }
  check('a 3D + Lottie scene is saved', (await saveScene(scene3dPath, SCENE3, 'Live 3D')) === true)
  // counts of pixels of a colour in the panel's canvas
  const count = (rule) => val(`(() => { const c = document.querySelector('[data-kb="motion-canvas"]'); if (!c) return -1; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) { const r = d[i], g = d[i + 1], b = d[i + 2]; if (${rule}) n++ } return n })()`)
  const redBox = 'r > 170 && g < 80 && b < 80'
  const greenBall = 'g > 170 && r < 90 && b < 90'
  const orangeLottie = 'r > 200 && g > 60 && g < 130 && b < 80'
  const seekTo = (frac) => val(`(() => { const s = document.querySelector('[data-kb="motion-timeline"] [role="slider"]'); const r = s.getBoundingClientRect(); const x = r.left + r.width * ${frac}; s.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: r.top + 5, pointerId: 1, bubbles: true })); s.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: r.top + 5, pointerId: 1, bubbles: true })); return s.getAttribute('aria-valuenow') })()`)
  const sceneShown = await poll(() => val(`(document.querySelector('[data-kb="motion-panel"] .kbmt-title strong') || { innerText: '' }).innerText === 'Live 3D'`), 15000)
  check('the panel switches to the new scene by itself', sceneShown === true)
  await seekTo(0.4)
  const lottieOrange = await poll(async () => { const n = await count(orangeLottie); return n > 30 ? n : 0 }, 20000)
  check('the Lottie square is drawn (orange pixels appear once the library and the file are loaded)', lottieOrange > 30, lottieOrange)
  const notLoaded = await val(`typeof window.KbMotionLottie`)
  check('lottie-web lives in its private global, nothing else is replaced', notLoaded === 'object' || notLoaded === 'function', notLoaded)
  if (webgl === true) {
    const reds = await poll(async () => { const n = await count(redBox); return n > 30 ? n : 0 }, 20000)
    check('the 3D red box is drawn through WebGL (red pixels)', reds > 30, reds)
    const greens = await count(greenBall)
    check('the green sphere is drawn too', greens > 30, greens)
    check('three.js lives in its private global', (await val(`typeof window.KbMotionThree`)) === 'object')
    await shot('6-3d')
    await seekTo(0.05)
    const a = await val(`(() => { const c = document.querySelector('[data-kb="motion-canvas"]'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i]) | 0; return h })()`)
    await seekTo(0.7)
    const b = await val(`(() => { const c = document.querySelector('[data-kb="motion-canvas"]'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i]) | 0; return h })()`)
    check('the picture changes with time (the box turns, the camera orbits, the square moves)', a !== b, [a, b])
    await seekTo(0.4)
    const again = await val(`(() => { const c = document.querySelector('[data-kb="motion-canvas"]'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i]) | 0; return h })()`)
    await seekTo(0.4)
    const again2 = await val(`(() => { const c = document.querySelector('[data-kb="motion-canvas"]'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i]) | 0; return h })()`)
    check('the same instant paints the same picture twice (deterministic, so preview = export)', again === again2, [again, again2])

    // a model and its clip, alone in its scene
    const SCENEM = { format: { width: 1280, height: 720, duration: 2 }, background: '#0f1115', layers: [{ type: 'scene3d', name: 'Seul', x: 640, y: 360, w: 800, h: 600, bg: '#203040', cz: 4, objects: [{ shape: 'model', src: 'motion-live-media/hero.glb', clip: 'Spin', s: 3 }] }] }
    check('a scene with just the model is saved', (await saveScene(modelPath, SCENEM, 'Live model')) === true)
    check('the panel shows it', await poll(() => val(`(document.querySelector('[data-kb="motion-panel"] .kbmt-title strong') || { innerText: '' }).innerText === 'Live model'`), 15000) === true)
    const bg3 = 'Math.abs(r - 32) + Math.abs(g - 48) + Math.abs(b - 64) > 40'
    await seekTo(0.02)
    const m0 = await poll(async () => { const n = await count(bg3); return n > 100 ? n : 0 }, 20000)
    check('the glTF model is drawn (pixels that are neither the scene\'s background nor the page\'s)', m0 > 100, m0)
    const hashNow = () => val(`(() => { const c = document.querySelector('[data-kb="motion-canvas"]'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 53) h = (h * 31 + d[i]) | 0; return h })()`)
    const ha = await hashNow()
    await seekTo(0.5)
    const hb = await hashNow()
    check('the model\'s own animation clip plays with the playhead (its pose changes)', ha !== hb, [ha, hb])
    const nWide = await count(bg3)
    await seekTo(0.02)
    check('and it turns back when the playhead goes back (the clip time follows, no hidden clock)', (await hashNow()) === ha)
    void nWide
  }

  // export the 3D scene to a real MP4, and rebuild the standalone page
  await val(`fetch('/kybernos-motion/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: ${JSON.stringify(scene3dPath)} }) }).then((r) => r.json())`)
  check('the 3D scene is the open one again', await poll(() => val(`(document.querySelector('[data-kb="motion-panel"] .kbmt-title strong') || { innerText: '' }).innerText === 'Live 3D'`), 15000) === true)
  await click('[data-act="export"]')
  await poll(() => val(`!!document.querySelector('.kbmt-modal')`), 4000)
  await val(`(() => { const r = Array.from(document.querySelectorAll('.kbmt-modal input[name="kbmt-res"]')).pop(); if (r) r.click() })()`)
  await click('[data-act="export-go"]')
  const done3 = await poll(() => val(`!!document.querySelector('.kbmt-modal [data-act="download"]')`), 120000)
  check('the 3D + Lottie scene exports to MP4 in the browser', done3 === true, await val(`(document.querySelector('.kbmt-modal') || { innerText: '' }).innerText.slice(0, 200)`))
  check('the video is next to its scene', existsSync(mp4Path3d) && readFileSync(mp4Path3d).length > 2000)
  if (existsSync(mp4Path3d) && !spawnSync('ffmpeg', ['-version']).error) {
    const dec = spawnSync('ffmpeg', ['-v', 'error', '-i', mp4Path3d, '-f', 'null', '-'], { encoding: 'utf8' })
    check('and it decodes without an error', dec.status === 0 && String(dec.stderr).trim() === '', String(dec.stderr).slice(0, 200))
    if (webgl === true) {
      // one frame of the video (the 3D box is red): decode it and look at its colours
      const png = spawnSync('ffmpeg', ['-v', 'error', '-ss', '1.0', '-i', mp4Path3d, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 * 1024 * 1024 })
      const px = png.stdout
      let red = 0
      for (let i = 0; i + 2 < px.length; i += 3) if (px[i] > 170 && px[i + 1] < 80 && px[i + 2] < 80) red++
      check('a frame of the VIDEO shows the 3D red box (WebGL pixels made it into the encoder)', red > 100, red)
    }
  }
  await val(`(() => { const b = Array.from(document.querySelectorAll('.kbmt-modal button')).find((x) => /Fermer|Close/.test(x.innerText)); if (b) b.click() })()`)

  const root3 = await val(`(async () => { const panel = document.querySelector('[data-kb="motion-panel"]'); const f = window.__KB_MINIAPP_EXPORTERS__.motion; const r = await f(panel.parentElement); if (!r) return null; const fr = document.createElement('iframe'); fr.style.cssText = 'position:fixed;left:0;top:0;width:700px;height:460px;z-index:99999;background:#000'; fr.srcdoc = r.html; document.body.appendChild(fr); await new Promise((res) => setTimeout(res, 4500)); const d = fr.contentDocument; const c = d.getElementById('cv'); const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let red = 0, orange = 0; for (let i = 0; i < px.length; i += 4) { const R = px[i], G = px[i + 1], B = px[i + 2]; if (R > 170 && G < 80 && B < 80) red++; if (R > 200 && G > 60 && G < 130 && B < 80) orange++ } const out = JSON.stringify({ len: r.html.length, three: typeof fr.contentWindow.KbMotionThree, lottie: typeof fr.contentWindow.KbMotionLottie, red, orange }); fr.remove(); return out })()`, 40000)
  const sa = (() => { try { return JSON.parse(root3) } catch (e) { return null } })()
  check('the standalone page carries lottie-web and plays the Lottie by itself', sa !== null && sa.lottie !== 'undefined' && sa.orange > 20, root3)
  if (webgl === true) check('and three.js, drawing the 3D scene by itself (no DSH, no network)', sa !== null && sa.three === 'object' && sa.red > 20, root3)

  // ═══ 7. a scene that vanished (R3-01, A4-11) ═══════════════════════════════════════════
  console.log('\n── 7. a remembered scene whose file is gone ──')
  const savedVanish = await val(`fetch('/kybernos-motion/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: ${JSON.stringify(vanishPath)}, scene: ${JSON.stringify(SCENE)}, what: 'live check', title: 'Vanish' }) }).then((r) => r.text())`)
  check('a scene to forget is saved', (() => { try { return JSON.parse(savedVanish).ok === true } catch (e) { return false } })(), savedVanish)
  const keyNow = await val(`(() => { const e = performance.getEntriesByType('resource').filter((x) => x.name.includes('kybernos-motion/state?session=')).pop(); return e ? decodeURIComponent(e.name.split('session=')[1]) : '' })()`)
  const stateOf = async () => JSON.parse(await val(`fetch('/kybernos-motion/state' + ${JSON.stringify(keyNow ? '?session=' + keyNow : '')}).then((r) => r.text())`))
  const before = await stateOf()
  check('the chat is shown that scene while its file exists', before.current !== null && before.current.path === vanishPath, { keyNow, before })
  rmSync(vanishPath, { force: true })
  const after = await stateOf()
  check('once the file is gone the host drops it: the chat gets the empty state, not a path to a missing file', after.current === null, after)
  // The panel of a chat opened afterwards: no red error, and no request for a scene the host no longer names.
  await live.page.send('Page.reload')
  await sleep(4000)
  await val(`(() => { const b = document.querySelector('button[aria-label="Open right sidebar"]'); if (b) b.click() })()`)
  await sleep(1000)
  if ((await val(`!!document.querySelector('[data-kb="motion-panel"]')`)) !== true) {
    await val(`(() => { const all = Array.from(document.querySelectorAll('button')); const i = all.findIndex((b) => b.getAttribute('aria-label') === 'Collapse right sidebar'); const b = all.slice(i).find((x) => x.innerText.trim() === 'Motion'); if (b) b.click() })()`)
  }
  const mounted = await poll(() => val(`!!document.querySelector('[data-kb="motion-panel"]')`), 8000)
  if (mounted === true) {
    const reqBefore = await val(`performance.getEntriesByType('resource').filter((x) => x.name.includes('kybernos-motion/scene')).length`)
    await sleep(8000)
    const reqAfter = await val(`performance.getEntriesByType('resource').filter((x) => x.name.includes('kybernos-motion/scene')).length`)
    check('the panel shows its empty state, with no red error', (await val(`!!document.querySelector('[data-kb="motion-empty"]') && !document.querySelector('.kbmt-err')`)) === true)
    check('...and asks for no scene in 8 s (it asked on every poll)', reqAfter - reqBefore === 0, { reqBefore, reqAfter })
    await shot('7-empty')
  } else console.log('SKIPPED: the Motion panel could not be mounted by hand after the reload — the empty-state half of step 7 is not checked here')
} catch (e) {
  fail += 1
  console.log('  ✗ the check crashed — ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e)))
} finally {
  cleanup()
  await live.close()
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
