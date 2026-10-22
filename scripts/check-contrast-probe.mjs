#!/usr/bin/env node
// The contrast probe of the ux-bug-hunter skill (.claude/skills/ux-bug-hunter/contrast.js) against two fixture pages: one with text below AA that it must
// name (grey on white, a dimmed black, text on a tint), one clean page that must raise nothing even though it carries what the probe leaves out on purpose
// (a disabled control, an aria-hidden drawing, an animating caption, text on a gradient) and what only looks pale (large text at 3:1).
//
//   node scripts/check-contrast-probe.mjs
//
// Like check-ux-probes.mjs it needs a headless Chrome and a signed-in session (docs/dev/live-testing.md) and never looks at DSH: the fixtures are data: pages.
// Exit code 0 / 1 / 3 (inconclusive). Named check-*, not test-*: CI has no Chrome.
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openLivePage } from './live-page.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PROBE = readFileSync(join(REPO, '.claude', 'skills', 'ux-bug-hunter', 'contrast.js'), 'utf8')
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) console.log('  ✓ ' + name)
  else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 300))) }
}

const STYLE = '<meta charset="utf-8"><title>fixture</title><style>body{font:14px/1.4 system-ui;margin:20px;background:#fff;color:#111}p{margin:0 0 12px}'
  + '@keyframes pulse{0%{opacity:.3}100%{opacity:1}}</style>'
const BAD = STYLE + '<main>'
  + '<p style="color:#999">grey on white</p>'
  + '<p style="color:#000;opacity:.4">dimmed black</p>'
  + '<div style="background:rgba(0,0,0,.05);padding:6px"><span style="color:#aaa">on a tint</span></div>'
  + '<p style="color:#595959">readable grey</p>'
  + '</main>'
const CLEAN = STYLE + '<main>'
  + '<p style="color:#595959">readable grey</p>'
  + '<p style="color:#777;font-size:24px">large and pale, 3:1 is enough</p>'
  + '<button disabled style="color:#aaa;background:#eee;border:0;padding:6px">disabled button</button>'
  + '<div aria-hidden="true" style="color:#ccc">decorative drawing text</div>'
  + '<p style="color:#bbb;animation:pulse 1s infinite alternate">animating caption</p>'
  + '<p style="background:linear-gradient(90deg,#fff,#000);color:#888">on a gradient, unknown background</p>'
  + '</main>'

const live = await openLivePage({ width: 1100, height: 900 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const val = async (js) => (await page.evalJs(js, 15000)).val
const load = async (html) => {
  await page.send('Page.navigate', { url: 'data:text/html;charset=utf-8,' + encodeURIComponent(html) })
  await new Promise((r) => setTimeout(r, 800))
}
try {
  await load(BAD)
  const bad = await val(PROBE)
  const texts = bad.bad.map((b) => b.text)
  check('grey on white is named, with its ratio (2.85:1)', texts.includes('grey on white') && bad.bad.find((b) => b.text === 'grey on white').ratio === 2.85, bad.bad)
  check('a dimmed black is measured with its opacity (the effective colour is the grey)', texts.includes('dimmed black'), bad.bad)
  check('text on a translucent tint is measured on the composited background', texts.includes('on a tint'), bad.bad)
  check('a readable grey (7:1) is not named', !texts.includes('readable grey'), bad.bad)
  check('the worst ratio comes first and the count of what was read is given', bad.bad.length === 3 && bad.bad[0].ratio <= bad.bad[1].ratio && bad.scanned === 4, { scanned: bad.scanned, bad: bad.bad })

  await load(CLEAN)
  const clean = await val(PROBE)
  check('the clean page raises nothing: large text at 3:1, a disabled control, an aria-hidden drawing, an animating caption and a gradient are left out', clean.bad.length === 0, clean.bad)
  check('...and it did read the readable and the large text', clean.scanned === 2, clean.scanned)
} finally {
  await live.close()
}
console.log(fail === 0 ? '\nOK' : '\n' + fail + ' check(s) failed')
process.exit(fail === 0 ? 0 : 1)
