#!/usr/bin/env node
// The Creations tab of a project shows what is inside each creation (UX audit 2026-10-20), checked at source level. No browser.
//
//   node packages/kybernos-plugin/test-deliv-preview.mjs
//
// Pinned because every row of the tab drew the same cube, and the type was written twice (« MD » next to « MD · 6 KB »). A row and a card now
// carry the creation's own preview (the one the Creations page draws, read with kybers/art-previews for the visible page), the type's
// drawing until it arrives, the picture itself for an image, and the type is said once, in words.
import { readFileSync } from 'node:fs'

let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) console.log('  ✓ ' + name)
  else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}
const SRC = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
const at = SRC.indexOf("if (tab === 'Deliverables') {")
const tabSrc = SRC.slice(at, SRC.indexOf("if (tab === kbt('kbui.skills'))", at))
if (at < 0 || tabSrc.length < 500) { console.log('  ✗ cannot cut the Creations tab out of client.js'); process.exit(1) }

console.log('the data')
check('the previews of the visible page are read with the Creations page\'s own route', /host\.call\('kybers\/art-previews', \{ paths: paths \}\)/.test(SRC.slice(SRC.indexOf('const delivPrevPair'), SRC.indexOf('const delivPrevPair') + 900)))
check('and only for paths not read yet, only while the tab is open', /if \(tab !== 'Deliverables'\) return undefined/.test(SRC) && /delivPrevPair\[0\]\[pth\] === undefined/.test(SRC))
check('the effect re-runs when the page or its size changes (whole-row pages)', /\[tab, delivVp\.page, delivVp\.per, delivMine\.length\]/.test(SRC))

console.log('the tab')
check('a row carries a thumbnail, not the cube', tabSrc.includes("'kb8-delthumb kb8-delthumb-row'") && !/Icon\('package', 16\)/.test(tabSrc))
check('a card carries the same thumbnail', tabSrc.includes("'kb8-docthumb kb8-delthumb-card'"))
check('the thumbnail is the real preview once read (the Creations page\'s previewContent)', /previewContent\(t, a\.name, pv, a\.path, a\.size\)/.test(tabSrc))
check('an image shows the picture itself, as before', /KB_DOC_IMAGE_EXTS\.indexOf\(delivExt\(a\)\) >= 0\) return h\('img'/.test(tabSrc))
check('until the preview arrives, the type\'s drawing stands in (never invented lines)', /kbTiArt\(kbTiOfName\(a\.name\)\)/.test(tabSrc) && !/previewLine\(/.test(tabSrc))
check('the type is said once, in words, from the Creations page\'s own label', /const delivMeta = \(a\) => \[kbArtType\(a\.name\)\.label,/.test(tabSrc))
check('the card no longer writes the extension a second time', !/kb8-docxt/.test(tabSrc))

console.log('the style')
for (const sel of ['.kb8-delthumb{', '.kb8-delthumb-row{', '.kb8-docthumb.kb8-delthumb-card{']) check(sel + ' is styled', SRC.includes(sel))
check('the row thumbnail is a scaled copy of the card preview, never interactive', /\.kb8-delthumb-row>\.kb6-prev\{[^}]*transform:scale\(\.4\)[^}]*pointer-events:none/.test(SRC))
process.exit(fail === 0 ? 0 : 1)
