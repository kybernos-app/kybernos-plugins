#!/usr/bin/env node
// Exports Kybernos Motion scenes to MP4 with the real panel (the browser encodes H.264 + AAC, like a person pressing Export).
//
//   source scripts/sandbox/env.sh && node scripts/motion-export.mjs <scene.json>... --out <dir> [--shots <dir>]
//
// A scene file is the `data[0]` object of a motion document (docs/dev/templates-lots/motion/*.scene.json). Each one is saved through the real route
// into <worktree>/artifacts/, the Motion tab opens by itself, the dialog's export runs, and <name>.mp4 is copied to --out (the artifacts/ files are removed).
// It needs a DSH that LOADS the bundle: the sandbox instance (scripts/sandbox/setup.sh, start.sh), never the one on :3080 (exit 3). Exit code 0 / 1 / 3.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { openLivePage } from './live-page.mjs'

const args = process.argv.slice(2)
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
const scenes = args.filter((a, i) => !a.startsWith('--') && !['--out', '--shots'].includes(args[i - 1]))
const outDir = flag('--out')
const shotDir = flag('--shots')
if (scenes.length === 0 || outDir === null) { console.error('usage: node scripts/motion-export.mjs <scene.json>... --out <dir> [--shots <dir>]'); process.exit(2) }

const host = process.env.KB_HOST || '127.0.0.1:3080'
if (host === '127.0.0.1:3080') { console.error('○ inconclusive: this needs a DSH that loads the bundle (the sandbox instance), not the one on :3080. source scripts/sandbox/env.sh'); process.exit(3) }
const worktree = process.env.KB_WORKTREE
if (!worktree || !existsSync(join(worktree, 'packages', 'kybernos-motion'))) { console.error('○ inconclusive: KB_WORKTREE does not point at a checkout with packages/kybernos-motion (source scripts/sandbox/env.sh).'); process.exit(3) }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const live = await openLivePage({ width: 1500, height: 1000 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const val = async (expr, ms) => (await page.evalJs(expr, ms)).val
const poll = async (fn, ms = 15000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await sleep(250) } }
const click = (sel) => val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true })()`)
const shot = async (name) => { if (shotDir !== null) { mkdirSync(shotDir, { recursive: true }); await page.shot(join(shotDir, name + '.png')).catch(() => {}) } }

const artifacts = join(worktree, 'artifacts')
const made = []
let failed = 0
try {
  // A chat must be mounted for the right sidebar to exist (this instance has no model: the turn fails, that is fine), in the workspace of this checkout.
  const workspaceName = worktree.split('/').filter((x) => x !== '').pop() || ''
  await poll(() => val(`document.querySelector('[contenteditable="true"], textarea') !== null`), 20000)
  await val(`(() => { const b = document.querySelector('button[aria-label="New session in ' + ${JSON.stringify(workspaceName)} + '"]'); if (b) b.click(); return !!b })()`)
  await sleep(1200)
  const composer = await poll(() => val(`(() => { const e = document.querySelector('[contenteditable="true"], textarea'); if (!e) return null; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.x + 40, y: r.y + r.height / 2 }) })()`), 20000)
  if (typeof composer !== 'string') throw new Error('no composer on the page')
  const { x, y } = JSON.parse(composer)
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
  await sleep(300)
  await page.send('Input.insertText', { text: 'Motion export' })
  await sleep(300)
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await sleep(1500)
  if ((await poll(() => val(`document.querySelector('button[aria-label="Open right sidebar"], button[aria-label="New tab"]') !== null`), 12000)) !== true) throw new Error('no chat is mounted: there is no right sidebar for the Motion tab')

  mkdirSync(artifacts, { recursive: true })
  mkdirSync(resolve(outDir), { recursive: true })
  for (const file of scenes) {
    const name = basename(file).replace(/\.scene\.json$|\.json$/, '')
    const scenePath = join(artifacts, name + '.miniapp.json')
    const mp4 = join(artifacts, name + '.mp4')
    made.push(scenePath, mp4)
    const scene = JSON.parse(readFileSync(resolve(file), 'utf8'))
    const saved = await val(`fetch('/kybernos-motion/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: ${JSON.stringify(scenePath)}, scene: ${JSON.stringify(scene)}, what: 'export', title: ${JSON.stringify(name)} }) }).then((r) => r.json()).then((j) => j.ok === true).catch(() => false)`)
    if (saved !== true) { console.log('  ✗ ' + name + ': the scene was refused by the host'); failed += 1; continue }
    await val(`window.__KB_MOTION__.open(${JSON.stringify(scenePath)})`)
    // The panel is already on screen after the first scene: wait for the one asked for (its title is the first line of the panel).
    const shown = await poll(() => val(`(() => { const p = document.querySelector('[data-kb="motion-panel"]'); return p !== null && p.innerText.trim().split('\\n')[0] === ${JSON.stringify(name)} })()`), 20000)
    if (shown !== true) { console.log('  ✗ ' + name + ': the Motion panel did not open it'); failed += 1; continue }
    await sleep(800)
    await click('[data-act="export"]')
    await poll(() => val(`!!document.querySelector('.kbmt-modal')`), 4000)
    await sleep(600)
    // The first height of the dialog is the tallest (720p), the one a shelf video wants.
    await val(`(() => { const r = document.querySelector('.kbmt-modal input[name="kbmt-res"]'); if (r) r.click() })()`)
    await click('[data-act="export-go"]')
    const done = await poll(() => val(`!!document.querySelector('.kbmt-modal [data-act="download"]')`), 180000)
    await shot(name)
    if (done !== true || !existsSync(mp4) || statSync(mp4).size < 2000) { console.log('  ✗ ' + name + ': the export did not finish'); failed += 1; continue }
    copyFileSync(mp4, join(resolve(outDir), name + '.mp4'))
    console.log('  ✓ ' + name + '.mp4  ' + Math.round(statSync(mp4).size / 1024) + ' KB')
    await val(`(() => { const b = Array.from(document.querySelectorAll('.kbmt-modal button')).find((e) => (e.innerText || '').trim() === 'Close'); if (b) b.click() })()`)
    await poll(() => val(`!document.querySelector('.kbmt-modal')`), 5000)
  }
} catch (e) {
  console.error('✗ ' + e.message)
  failed += 1
}
for (const f of made) { try { rmSync(f, { force: true }) } catch (e) { /* gone */ } }
try { if (existsSync(artifacts) && readdirSync(artifacts).length === 0) rmdirSync(artifacts) } catch (e) { /* not empty: not ours */ }
await live.close()
process.exit(failed === 0 ? 0 : 1)
