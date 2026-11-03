#!/usr/bin/env node
// A scripted walk through the real GUI of a SANDBOX, for the cheap walkthrough testers of the soft-takeoff recette (docs/tests/soft-takeoff/tester-brief.md).
// The tester writes a list of steps, this tool plays them in a throw-away signed-in Chrome and writes what was seen: nothing here judges.
//
//   source scripts/sandbox/env.sh && node scripts/takeoff-walk.mjs --steps <steps.json> --out <folder outside the repo> [--width 390 --height 844 --touch]
//
// A step is one of: {"open":"/"} {"click":"Visible text"} {"settings":"Page label"} {"type":"text"} {"key":"Escape|Enter|Tab"} {"wait":ms} {"look":"label"} {"shot":"name"}
//   look  records the title, the dialog on top, the headings, the first buttons, every « undefined » / « NaN » / « [object » in the text, what runs past the right edge
//         of the viewport, controls smaller than 32 px, and the console errors since the last look. shot saves <out>/<nn>-<name>.png.
// Output: one JSON line per step on stdout and <out>/walk.json. Exit 0 when every step ran (a step that finds nothing to click is a result, not a crash), 1 when the walk
// could not run, 2 on a refusal. Refuses: the real DSH (port 3080), an output folder inside the repository (screenshots never go to git), a step list that is not valid.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { goToSettingsPage, openLivePage, openSettings } from './live-page.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const KEYS = { Escape: { key: 'Escape', code: 'Escape', vk: 27 }, Enter: { key: 'Enter', code: 'Enter', vk: 13 }, Tab: { key: 'Tab', code: 'Tab', vk: 9 } }
const KINDS = ['open', 'click', 'settings', 'type', 'key', 'wait', 'look', 'shot']

/** Everything wrong with a list of steps, as sentences. Pure. */
export function checkSteps (steps) {
  if (!Array.isArray(steps) || steps.length === 0) return ['the steps must be a non-empty list']
  if (steps.length > 200) return ['more than 200 steps: split the walk']
  const bad = []
  steps.forEach((s, i) => {
    const kinds = s && typeof s === 'object' ? Object.keys(s).filter((k) => KINDS.includes(k)) : []
    if (kinds.length !== 1 || Object.keys(s).length !== 1) { bad.push(`step ${i + 1}: exactly one of ${KINDS.join(', ')}`); return }
    const k = kinds[0]
    const v = s[k]
    if (k === 'wait' && !(typeof v === 'number' && v >= 0 && v <= 30000)) bad.push(`step ${i + 1}: wait is a number of milliseconds, 0 to 30000`)
    else if (k === 'key' && !KEYS[v]) bad.push(`step ${i + 1}: key is one of ${Object.keys(KEYS).join(', ')}`)
    else if (k === 'open' && !(typeof v === 'string' && v.startsWith('/') && !v.startsWith('//'))) bad.push(`step ${i + 1}: open takes a path on the sandbox, starting with a single /`)
    else if (k === 'shot' && !(typeof v === 'string' && /^[\w-]{1,40}$/.test(v))) bad.push(`step ${i + 1}: shot takes a short name (letters, digits, - and _)`)
    else if (!['wait', 'key', 'open', 'shot'].includes(k) && !(typeof v === 'string' && v.trim() !== '')) bad.push(`step ${i + 1}: ${k} takes a non-empty text`)
  })
  return bad
}

/** The page-side script of a `click`: the centre of the element a person would press for that text, or null. Only what is really on top at its own centre counts: a hidden twin of a
 *  button (a step that is leaving, a phone variant) comes first in the document and must not take the press (the shared clickText of live-page.mjs picks it). */
export const findScript = (text) => `(() => {
  const norm = (s) => String(s || '').replace(/[⟦⟧]/g, '').replace(/\\s+/g, ' ').trim().toLowerCase()
  const want = norm(${JSON.stringify(text)})
  const own = (e) => norm(Array.from(e.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join(''))
  const hits = Array.from(document.querySelectorAll('*')).filter((e) => {
    const r = e.getBoundingClientRect()
    if (r.width < 4 || r.height < 4) return false
    return own(e) === want || (e.children.length <= 3 && norm(e.innerText) === want)
  })
  const rank = (e) => (e.closest('button, a[href], [role=button], [role=tab], [role=menuitem], [role=radio], summary') ? 0 : 1)
  hits.sort((a, b) => rank(a) - rank(b))
  for (const e of hits) {
    e.scrollIntoView({ block: 'center' })
    const r = e.getBoundingClientRect()
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    const top = document.elementFromPoint(x, y)
    if (top && (top === e || e.contains(top) || top.contains(e))) return { x, y }
  }
  return null
})()`

/** The page-side script of a `look`. Reads only. */
export const LOOK_SCRIPT = `(() => {
  const vw = document.documentElement.clientWidth
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' }
  const text = (document.body.innerText || '').replace(/[⟦⟧]/g, '')
  const dialog = Array.from(document.querySelectorAll('[role=dialog], dialog[open]')).filter(vis).pop() || null
  const root = dialog || document
  const rect = (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] }
  const label = (e) => ((e.innerText || e.getAttribute('aria-label') || e.getAttribute('title') || '').trim().split('\\n')[0] || '').slice(0, 60)
  const controls = Array.from(root.querySelectorAll('button, a[href], [role=button], input, select, textarea')).filter(vis)
  return {
    title: document.title,
    dialog: dialog ? { label: dialog.getAttribute('aria-label') || label(dialog), rect: rect(dialog) } : null,
    headings: Array.from(root.querySelectorAll('h1, h2, h3, [role=heading]')).filter(vis).slice(0, 12).map((e) => label(e)),
    buttons: controls.slice(0, 40).map((e) => label(e) || e.tagName.toLowerCase()),
    controls: controls.length,
    badText: Array.from(text.matchAll(/.{0,30}(undefined|NaN|\\[object|\\bnull\\b).{0,30}/g)).slice(0, 8).map((m) => m[0].replace(/\\s+/g, ' ')),
    pastRightEdge: Array.from(root.querySelectorAll('*')).filter((e) => vis(e) && e.getBoundingClientRect().right > vw + 1 && getComputedStyle(e).position !== 'fixed').slice(0, 8).map((e) => ({ what: label(e) || e.tagName.toLowerCase(), rect: rect(e) })),
    scrollsSideways: document.documentElement.scrollWidth > vw + 1,
    small: controls.filter((e) => { const r = e.getBoundingClientRect(); return r.width < 32 || r.height < 32 }).slice(0, 12).map((e) => ({ what: label(e) || e.tagName.toLowerCase(), rect: rect(e) })),
    viewport: [vw, document.documentElement.clientHeight],
    textStart: text.trim().slice(0, 300).replace(/\\s+/g, ' '),
  }
})()`

async function walk (steps, out, opts) {
  const authority = process.env.KB_HOST || ''
  const live = await openLivePage({ authority, width: opts.width, height: opts.height })
  const { page } = live
  const results = []
  let shots = 0
  let errSeen = 0
  try {
    if (opts.width) {
      await page.send('Emulation.setDeviceMetricsOverride', { width: opts.width, height: opts.height || 844, deviceScaleFactor: 2, mobile: opts.touch === true })
      if (opts.touch) await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
      await sleep(600)
    }
    for (let i = 0; i < steps.length; i += 1) {
      const s = steps[i]
      const kind = Object.keys(s)[0]
      const v = s[kind]
      const row = { n: i + 1, step: s, ok: true }
      try {
        if (kind === 'open') { await page.send('Page.navigate', { url: 'http://' + authority + v }); await sleep(2500) }
        else if (kind === 'click') {
          const at = (await page.evalJs(findScript(v), 6000)).val
          row.ok = !!at
          if (at) {
            await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y })
            await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', clickCount: 1 })
            await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', clickCount: 1 })
            await sleep(800)
          } else row.note = 'nothing visible on top with that exact text'
        }
        else if (kind === 'settings') {
          const opened = await openSettings(page)
          row.ok = opened && await goToSettingsPage(page, v)
          if (!row.ok) row.note = opened ? 'no Settings cell with that label' : 'the Settings dialog did not open'
        }
        else if (kind === 'type') { await page.send('Input.insertText', { text: v }); await sleep(300) }
        else if (kind === 'key') {
          const k = KEYS[v]
          for (const t of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type: t, key: k.key, code: k.code, windowsVirtualKeyCode: k.vk })
          await sleep(500)
        }
        else if (kind === 'wait') await sleep(v)
        else if (kind === 'look') {
          const r = await page.evalJs(LOOK_SCRIPT, 10000)
          if (r.err) { row.ok = false; row.note = r.err.slice(0, 200) } else row.look = { label: v, ...r.val, consoleErrors: page.errs.slice(errSeen) }
          errSeen = page.errs.length
        }
        else if (kind === 'shot') { shots += 1; const f = join(out, String(shots).padStart(2, '0') + '-' + v + '.png'); row.ok = await page.shot(f); row.file = f }
      } catch (e) { row.ok = false; row.note = String(e.message || e).slice(0, 200) }
      results.push(row)
      console.log(JSON.stringify(row))
    }
  } finally { await live.close() }
  return results
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const argv = process.argv.slice(2)
  const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d }
  const refuse = (m) => { console.error('takeoff-walk: ' + m); process.exit(2) }
  const stepsFile = opt('--steps', '')
  const out = opt('--out', '')
  if (!stepsFile || !out) refuse('--steps <file> and --out <folder> are required')
  const host = process.env.KB_HOST || ''
  if (!host) refuse('KB_HOST is not set: run « source scripts/sandbox/env.sh » first')
  if (/:3080$/.test(host) || /:879[12]$/.test(host)) refuse('KB_HOST is the owner\'s own DSH or replica: this walk is for sandboxes only')
  const outDir = resolve(out)
  const inside = relative(REPO, outDir)
  if (inside === '' || (!inside.startsWith('..') && !inside.startsWith('/'))) refuse('the output folder is inside the repository: screenshots never go to git')
  let steps
  try { steps = JSON.parse(readFileSync(resolve(stepsFile), 'utf8')) } catch (e) { refuse('the steps file is not readable JSON: ' + e.message) }
  const bad = checkSteps(steps)
  if (bad.length) refuse(bad.slice(0, 5).join('; '))
  mkdirSync(outDir, { recursive: true })
  const width = Number(opt('--width', '0')) || 0
  const height = Number(opt('--height', '0')) || 0
  try {
    const results = await walk(steps, outDir, { width, height, touch: argv.includes('--touch') })
    writeFileSync(join(outDir, 'walk.json'), JSON.stringify({ host, viewport: width ? [width, height || 844] : 'window', steps: results }, null, 2) + '\n')
    process.exit(0)
  } catch (e) { console.error('takeoff-walk: the walk could not run: ' + (e.message || e)); process.exit(1) }
}
