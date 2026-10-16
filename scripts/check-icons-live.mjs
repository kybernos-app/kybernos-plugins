// Icon/glyph completeness audit — static (catalogue) + live (Suite panel).
//
//   node scripts/check-icons-live.mjs [--shots <dir>] [--json out.json]
//
// Static half: every module in packages/kybernos-hub/catalog.json has a `glyphe`
// the client GLYPHES map can draw, and no two modules share one glyph (a shared
// glyph makes two cards look identical — the user's complaint "pas tous les
// plugins ont une icône" is often this).
//
// Live half (needs a running DSH that serves this checkout, e.g. the sandbox of
// scripts/sandbox, cookie sign-in — see docs/dev/live-testing.md): opens the Suite
// settings page and checks that each module card actually draws a non-empty SVG glyph.
//
// READ-ONLY. Exit 0 = all green, 1 = a check failed, 3 = inconclusive (GUI down).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openLivePage, waitFor } from './live-page.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d }
const SHOTS = argOf('--shots', null)
const JSON_OUT = argOf('--json', null)
if (SHOTS !== null) mkdirSync(SHOTS, { recursive: true })

let pass = 0
let fail = 0
const report = []
const check = (name, ok, detail) => {
  report.push({ name, ok: ok === true, detail })
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

// ── static half ────────────────────────────────────────────────────────────
const catalogue = JSON.parse(readFileSync(join(REPO, 'packages', 'kybernos-hub', 'catalog.json'), 'utf8'))
const modules = catalogue.modules
check('the catalogue has modules', Array.isArray(modules) && modules.length > 0, modules.length)

const missing = modules.filter((m) => typeof m.glyphe !== 'string' || m.glyphe === '')
check('every module declares a glyph', missing.length === 0, missing.map((m) => m.id))

const byGlyph = new Map()
for (const m of modules) { const k = m.glyphe; if (!byGlyph.has(k)) byGlyph.set(k, []); byGlyph.get(k).push(m.id) }
const shared = [...byGlyph.entries()].filter(([, ids]) => ids.length > 1)
check('no two modules share a glyph', shared.length === 0, shared.map(([g, ids]) => g + ' → ' + ids.join(', ')))

// The client's GLYPHES map — read the palette the panel draws from.
const clientJs = readFileSync(join(REPO, 'packages', 'kybernos-hub', 'client.js'), 'utf8')
const paletteBlock = clientJs.slice(clientJs.indexOf('const GLYPHES = {'), clientJs.indexOf('}', clientJs.indexOf('const GLYPHES = {')))
const paletteNames = [...paletteBlock.matchAll(/^\s{6}([a-z0-9]+)\s*:/gm)].map((m) => m[1])
const unknown = modules.filter((m) => !paletteNames.includes(m.glyphe))
check('every catalogue glyph name exists in the client palette', unknown.length === 0, unknown.map((m) => m.id + ':' + m.glyphe))
check('the client palette is non-trivial', paletteNames.length > 10, paletteNames.length)

// ── live half ──────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const live = await openLivePage({ width: 1500, height: 1000 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
try {
  await waitFor(page, 'document.readyState === "complete"', 15000)
  await sleep(2500)

  // Open Settings → Suite (the module grid).
  await page.evalJs(`(() => { const b = document.querySelector('[class*="settingsArea"] button[class*="trigger"]'); if (b) b.click() })()`)
  await sleep(1500)
  const opened = await waitFor(page, `/back to workspace|retour au workspace/i.test(document.body.innerText)`, 8000)
  check('Settings opened', opened !== null)

  // Click the Suite entry (label varies: "Suite", "Kybernos Suite").
  const clickedSuite = await page.evalJs(`(() => {
    const cells = [...document.querySelectorAll('[class*="navCell"]')].filter(e => /suite/i.test((e.innerText||'').trim()))
    if (!cells.length) return false
    cells[0].scrollIntoView({block:'center'}); cells[0].click(); return true
  })()`)
  check('the Suite entry is in the Settings menu', clickedSuite.val === true, clickedSuite)
  // The panel draws a skeleton until the host has answered (a few ms by hand, longer on a busy machine): wait for the cards themselves,
  // not for a fixed delay, then for the skeleton to be gone.
  const cardsUp = await waitFor(page, `document.querySelectorAll('[data-kb="suite-card"], [data-kb="suite-row"]').length > 0`, 20000)
  check('the Suite panel draws its cards', cardsUp !== null)
  await waitFor(page, `!document.querySelector('.kbsu [aria-busy="true"]')`, 5000)

  // evalJs returns { val } or { err } — read `.val`, never the envelope.
  // The Suite panel draws each module's glyph on a card (or a row in the list
  // view). Read every card/row's SVG glyph and measure it.
  const gridRes = await page.evalJs(`(() => {
    const pick = [...document.querySelectorAll('[data-kb="suite-card"], [data-kb="suite-row"]')]
    return JSON.stringify(pick.map(c => {
      const svg = c.querySelector('svg[viewBox="0 0 32 32"]') || c.querySelector('svg')
      const r = svg ? svg.getBoundingClientRect() : null
      return {
        id: c.getAttribute('data-id'),
        label: (c.getAttribute('aria-label')||'').slice(0,60),
        paths: svg ? svg.querySelectorAll('path,circle,rect,ellipse').length : 0,
        empty: svg ? (svg.innerHTML||'').trim()==='' : true,
        w: r ? Math.round(r.width) : 0,
        h: r ? Math.round(r.height) : 0
      }
    }))
  })()`)
  const grid = gridRes && gridRes.val !== undefined ? gridRes.val : '[]'
  const cards = JSON.parse(typeof grid === 'string' ? grid : '[]')
  check('the Suite panel draws glyph SVGs', cards.length > 0, cards.length)
  const empty = cards.filter((c) => c.empty || c.paths === 0)
  check('every drawn glyph has content', empty.length === 0, empty)
  const tooSmall = cards.filter((c) => c.w < 20 || c.h < 20)
  check('every drawn glyph is at least 20px', tooSmall.length === 0, tooSmall)

  // The tiles are the web Plugins page's (a gradient per plugin, 24% corners, a 64 grid), the panel uses the room it has, and the
  // direct link of a module opens that module's own Settings page.
  const tiles = await page.evalJs(`JSON.stringify([...document.querySelectorAll('[data-kb="suite-card"] .kbsu-ico')].map((e) => { const s = e.querySelector('svg'); const cs = getComputedStyle(e); return { grad: /linear-gradient/.test(cs.backgroundImage), radius: cs.borderRadius, vb: s ? s.getAttribute('viewBox') : null, from: e.style.getPropertyValue('--from') !== '' } }))`)
  const tl = JSON.parse(tiles && typeof tiles.val === 'string' ? tiles.val : '[]')
  check('every tile is a gradient with a 64-grid drawing and its own colours', tl.length > 0 && tl.every((t) => t.grad && t.vb === '0 0 64 64' && t.from), tl.filter((t) => !(t.grad && t.vb === '0 0 64 64' && t.from)).slice(0, 3))
  const room = await page.evalJs(`(() => { const r = document.querySelector('.kbsu'); return r ? Math.round(r.getBoundingClientRect().width) : 0 })()`)
  check('the panel is wider than the 720px every other Settings page keeps to', room.val > 900, room.val)
  const jumped = await page.evalJs(`(() => { const b = document.querySelector('[data-kb="suite-card"][data-id="kybernos-models"] [data-kb="suite-reglages"]'); if (!b) return 'no link'; b.click(); return 'clicked' })()`)
  await waitFor(page, `!document.querySelector('.kbsu')`, 8000)
  const gone = await page.evalJs(`!document.querySelector('.kbsu')`)
  check('the Settings link of a module leaves the Suite for that module\'s page', jumped.val === 'clicked' && gone.val === true, [jumped.val, gone.val])

  if (SHOTS !== null) await page.shot(join(SHOTS, 'suite-glyphs.png'))
} finally {
  await live.close()
}

if (JSON_OUT !== null) writeFileSync(JSON_OUT, JSON.stringify({ pass, fail, report }, null, 2))
console.log('\n' + pass + ' ok, ' + fail + ' failed')
process.exit(fail > 0 ? 1 : 0)
