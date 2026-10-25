#!/usr/bin/env node
// One frame for the pages of Settings (UX audit 2026-10-20), checked at source level. No browser; the real measure is
// scripts/check-settings-frame-live.mjs.
//
//   node scripts/test-settings-frame.mjs
//
// Pinned because the title of a page moved when the person changed page: x 272 on most, 289 / 300 / 330 on four, y 54 on most, 90 to 110 on five
// (the « How it works » button had a row of its own above the title), 77 and 107 on two. The page box was always at x 272, 720 wide: it was the
// padding, the card frame and the button's row inside it that moved the title.
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) console.log('  ✓ ' + name)
  else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}
const PACKAGES = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages')
const read = (b) => readFileSync(join(PACKAGES, b, 'client.js'), 'utf8')

console.log('the help button')
{
  const left = []
  for (const b of readdirSync(PACKAGES)) {
    let s = null
    try { s = read(b) } catch (e) { continue }
    if (/justifyContent: 'flex-end', width: '100%', marginBottom: 6 \}/.test(s)) left.push(b)
  }
  check('no page gives the button a row of its own with an inline style (it pushed the title down by 36 px)', left.length === 0, left)
  const hub = read('kybernos-hub')
  check('the shared row takes no height, so the title starts where the button\'s row starts', /\.kbhp-row\{display:flex;justify-content:flex-end;width:100%;height:0;overflow:visible;position:relative;z-index:1;margin-bottom:calc\(-1 \* var\(--kbhp-gap,0px\)\)\}/.test(hub))
  check('on a narrow screen it goes back in the flow, above the title (no overlap)', /@media \(max-width:760px\)\{\.kbhp-row\{height:auto;margin-bottom:6px\}\}/.test(hub))
  for (const b of ['kybernos-free-llms', 'kybernos-modeles-locaux', 'kybernos-plugin', 'kybernos-sessions', 'kybernos-skills', 'kybernos-slash', 'kybernos-theme']) check(b + ' uses the shared row', /h\('div', \{ className: 'kbhp-row'/.test(read(b)))
  check('the class prefix stays the hub\'s alone: no other bundle declares a .kbhp- rule', readdirSync(PACKAGES).filter((b) => b !== 'kybernos-hub').every((b) => { try { return !/\.kbhp-/.test(read(b)) } catch (e) { return true } }))
  check('Theme tells the row the 6 px gap of its header (the title starts at the top, not 6 px below)', read('kybernos-theme').includes("className: 'kbhp-row', style: { '--kbhp-gap': '6px' }"))
  check('Voice tells the row the 20 px gap of its page', read('kybernos-plugin').includes("className: 'kbhp-row', style: { '--kbhp-gap': '20px' }"))
}

console.log('the page boxes')
{
  const usage = read('kybernos-usage')
  check('Usage has no padding of its own (it was 22 px 28 px: the title sat at x 300, y 76)', /\.kbus-page\{padding:0 0 32px;/.test(usage) && /@media \(max-width:760px\)\{\.kbus-page\{padding:0 0 24px\}/.test(usage))
  for (const [b, cls] of [['kybernos-modeles-locaux', 'kml-root'], ['kybernos-free-llms', 'kfl-root']]) {
    const s = read(b)
    const rule = s.slice(s.indexOf('.' + cls + ' {'), s.indexOf('}', s.indexOf('.' + cls + ' {')))
    check(b + ': the page is not a card inside the page (no border, background or padding on ' + cls + ')', rule.length > 0 && !/border|background|padding/.test(rule), rule)
  }
  check('Phone and channels has no padding of its own (the icon starts at the frame\'s edge)', /\.kbmr-page\{[^}]*padding:0;/.test(read('kybernos-mobile')))
  // Settings › Kaby had `padding:6px 2px 24px`: its title sat at x 274, y 60 instead of 272, 54 (recette of 2026-10-24). Only the foot keeps room, for the scroll end.
  const kaby = /\.kbkc\{([^}]*)\}/.exec(read('kybernos-kaby-customisation'))
  const kabyPad = kaby === null ? null : /(?:^|;)padding:([^;]*)/.exec(kaby[1])
  check('Kaby has no padding at the top or at the sides (only the foot keeps room), so its title starts where the others do', kabyPad !== null && /^0 0 \d+px$/.test(kabyPad[1].trim()), kabyPad === null ? null : kabyPad[1])
}
process.exit(fail === 0 ? 0 : 1)
