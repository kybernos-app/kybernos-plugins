// Test of the Kybernos brand core: the K pastille geometry, the favicon data URI, the Team
// override sanitiser and the tab-title rewrite. It runs the block marked KB-BRAND-CORE of
// packages/kybernos-plugin/client.js as-is (the client is one bundle with no relative imports,
// hence the extraction, same as test-scheduled-tasks-host.mjs).
// Usage: node scripts/test-brand.mjs   (exit 0 = everything passes)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const src = readFileSync(root + 'packages/kybernos-plugin/client.js', 'utf8')
const m = src.match(/\/\/ KB-BRAND-CORE-BEGIN([\s\S]*?)\/\/ KB-BRAND-CORE-END/)
if (m === null) { console.error('BLOCK KB-BRAND-CORE NOT FOUND in packages/kybernos-plugin/client.js'); process.exit(1) }
const names = 'KB_BRAND_NAME, KB_BRAND_RED, KB_BRAND_VIEWBOX, KB_BRAND_RATIO, KB_BRAND_INNER, KB_WORDMARK, KB_BRAND_LOGO_MAX, KB_BRAND_NAME_MAX, kbBrandFaviconHref, kbBrandSanitize, kbBrandRetitle'
const mod = await import('data:text/javascript,' + encodeURIComponent(m[1] + '\nexport { ' + names + ' }'))

let fails = 0
const eq = (label, got, want) => {
  const ok = got === want
  if (!ok) { fails++; console.log('FAIL', label, '| got', JSON.stringify(got), '| want', JSON.stringify(want)) } else console.log('ok  ', label)
}
const near = (label, got, want, tol) => eq(label + ' (±' + tol + ')', Math.abs(got - want) <= tol, true)

/* ── 1. Geometry: the numbers the wordmark relies on ─────────────────────── */
const [vx, vy, vw, vh] = mod.KB_BRAND_VIEWBOX.split(' ').map(Number)
near('ratio matches the viewBox', mod.KB_BRAND_RATIO, vw / vh, 1e-9)
// The pastille is .98f wide and 1.14f high: the width is the height times the ratio.
near('wordmark width follows the ratio', mod.KB_WORDMARK.height * mod.KB_BRAND_RATIO, mod.KB_WORDMARK.width, 0.005)
// The K is 36 units high: its height as a fraction of the font size is the cap height (~.72).
near('K height equals the cap height', (36 / vh) * mod.KB_WORDMARK.height, 0.72, 0.01)
// The K foot (y = 50) sits on the baseline: the pastille dips (viewBox bottom - 50) units below it.
near('drop puts the K on the baseline', ((vy + vh - 50) / vh) * mod.KB_WORDMARK.height, mod.KB_WORDMARK.drop, 0.005)

/* ── 2. The shared SVG: one source for the mark and the favicon ──────────── */
const open = (tag) => (mod.KB_BRAND_INNER.match(new RegExp('<' + tag + '[\\s>/]', 'g')) || []).length
eq('three polygons/rects of K plus body and tail are present', open('rect') + open('polygon'), 5)
eq('the inner markup is balanced (one <g>)', open('g') === 1 && (mod.KB_BRAND_INNER.match(/<\/g>/g) || []).length === 1, true)
eq('no script or event handler in the artwork', /<script|\son[a-z]+=/i.test(mod.KB_BRAND_INNER), false)
eq('only the brand red and white are used', [...new Set(mod.KB_BRAND_INNER.match(/#[0-9a-f]{3,6}/gi))].sort().join(','), '#f2372a,#fff')
const fav = mod.kbBrandFaviconHref()
eq('favicon is an SVG data URI', fav.startsWith('data:image/svg+xml,'), true)
const favSvg = decodeURIComponent(fav.slice('data:image/svg+xml,'.length))
eq('favicon declares the SVG namespace and the viewBox', favSvg.includes('xmlns="http://www.w3.org/2000/svg"') && favSvg.includes('viewBox="' + mod.KB_BRAND_VIEWBOX + '"'), true)
eq('favicon embeds the same artwork as the mark', favSvg.includes(mod.KB_BRAND_INNER), true)
eq('favicon stays small (< 1.5 KB)', fav.length < 1500, true)

/* ── 3. Team override: only a name and a data-URI logo get through ───────── */
const S = mod.kbBrandSanitize
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
eq('nothing -> null', S(null), null)
eq('a string -> null', S('Acme'), null)
eq('an empty object -> null', S({}), null)
eq('name only', JSON.stringify(S({ name: '  Acme AI ' })), JSON.stringify({ name: 'Acme AI', logo: null }))
eq('logo only keeps the default name', JSON.stringify(S({ logo: PNG })), JSON.stringify({ name: 'Kybernos', logo: PNG }))
eq('name and logo', S({ name: 'Acme AI', logo: PNG }).logo, PNG)
eq('control characters are stripped', S({ name: 'Ac\u0000me\n AI\u007f' }).name, 'Acme AI')
eq('name is cut at 40 characters', Array.from(S({ name: 'x'.repeat(100) }).name).length, 40)
eq('the cut counts characters, not UTF-16 units', Array.from(S({ name: '\u{1F600}'.repeat(60) }).name).length, 40)
eq('a blank name falls back to the default', S({ name: '   ', logo: PNG }).name, 'Kybernos')
eq('an https logo is refused', S({ name: 'A', logo: 'https://evil.example/x.png' }).logo, null)
eq('a javascript: logo is refused', S({ name: 'A', logo: 'javascript:alert(1)' }).logo, null)
eq('a non-base64 svg data URI is refused', S({ name: 'A', logo: 'data:image/svg+xml;utf8,<svg onload=alert(1)/>' }).logo, null)
eq('a text/html data URI is refused', S({ name: 'A', logo: 'data:text/html;base64,PHNjcmlwdD4=' }).logo, null)
eq('an oversized logo is refused', S({ name: 'A', logo: 'data:image/png;base64,' + 'A'.repeat(mod.KB_BRAND_LOGO_MAX) }).logo, null)
eq('a base64 svg logo is accepted', S({ logo: 'data:image/svg+xml;base64,PHN2Zy8+' }).logo, 'data:image/svg+xml;base64,PHN2Zy8+')
eq('a non-string name and a bad logo -> null', S({ name: 42, logo: 7 }), null)

/* ── 4. Tab title ─────────────────────────────────────────────────────────── */
const T = mod.kbBrandRetitle
eq('DSH title becomes the brand', T('DeepSeek Harness', 'Kybernos'), 'Kybernos')
eq('case does not matter', T('deepseek harness', 'Kybernos'), 'Kybernos')
eq('inside a longer title', T('New session · DeepSeek Harness', 'Kybernos'), 'New session · Kybernos')
eq('an already branded title is left alone', T('Kybernos', 'Kybernos'), 'Kybernos')
eq('an override renames the previous brand too', T('Session — Kybernos', 'Acme AI', 'Kybernos'), 'Session — Acme AI')
eq('clearing the override puts the brand back', T('Acme AI', 'Kybernos', 'Acme AI'), 'Kybernos')
eq('a title that is not a string passes through', T(undefined, 'Kybernos'), undefined)
eq('an empty name changes nothing', T('DeepSeek Harness', ''), 'DeepSeek Harness')

/* ── 5. The client really wires the block in (static) ─────────────────────── */
eq('the old circle logo is gone', src.includes('KB_LOGO_RED') || src.includes('KybernosLogo'), false)
eq('the sidebar mark slot is shadowed', /name: 'sidebar\.brand\.mark', priority: -1 \}, KybernosSidebarMark/.test(src), true)
eq('the sidebar name slot is shadowed', /name: 'sidebar\.brand\.name', priority: -1 \}, KybernosSidebarName/.test(src), true)
eq('the contract for other bundles is published', src.includes('window.__KB_BRAND__ = {'), true)
eq('"Powered by" is added by the shell whenever an override is active', /if \(ov !== null\) \{[\s\S]{0,400}h\(KybernosPoweredBy\)/.test(src), true)

console.log(fails === 0 ? '\nbrand: all checks pass' : '\nbrand: ' + fails + ' check(s) FAILED')
process.exit(fails === 0 ? 0 : 1)
