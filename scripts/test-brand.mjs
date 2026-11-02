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
const names = 'KB_BRAND_NAME, KB_BRAND_RED, KB_BRAND_VIEWBOX, KB_BRAND_RATIO, KB_BRAND_INNER, KB_BRAND_FAVICON_VIEWBOX, KB_BRAND_FAVICON_INNER, kbBrandArt, KB_WORDMARK, KB_BRAND_LOGO_MAX, KB_BRAND_NAME_MAX, kbBrandFaviconHref, kbBrandSanitize, kbBrandRetitle, kbBrandFromCloud, kbBrandSame'
const mod = await import('data:text/javascript,' + encodeURIComponent(m[1] + '\nexport { ' + names + ' }'))

let fails = 0
const eq = (label, got, want) => {
  const ok = got === want
  if (!ok) { fails++; console.log('FAIL', label, '| got', JSON.stringify(got), '| want', JSON.stringify(want)) } else console.log('ok  ', label)
}
const near = (label, got, want, tol) => eq(label + ' (±' + tol + ')', Math.abs(got - want) <= tol, true)

/* ── 1. Geometry: the numbers the wordmark relies on ─────────────────────── */
// The K is 32.5 x 36 units (the artwork of the public site): the viewBox is exactly its box.
const [vx, vy, vw, vh] = mod.KB_BRAND_VIEWBOX.split(' ').map(Number)
eq('the viewBox is the K\'s own box', [vx, vy, vw, vh].join(' '), '0 0 32.5 36')
near('ratio matches the viewBox', mod.KB_BRAND_RATIO, vw / vh, 1e-9)
// The K is .93f high: 1.28 x the cap height of Inter (.727), as on the site (BrandWordmark: CAP * K_SCALE).
near('the K is 1.28 x the cap height', mod.KB_WORDMARK.height, 0.727 * 1.28, 0.002)
near('wordmark width follows the ratio', mod.KB_WORDMARK.height * mod.KB_BRAND_RATIO, mod.KB_WORDMARK.width, 0.005)
// Nothing hangs below the baseline: the foot of the K is the bottom of its box.
eq('the wordmark has no drop: the K stands on the baseline', mod.KB_WORDMARK.drop, undefined)
near('the air between the K and the y is .075 of the font size', mod.KB_WORDMARK.gap, 0.075, 1e-9)

/* ── 2. The shared SVG: one source for the mark, the wizard and the favicon ─ */
const open = (tag, inner = mod.KB_BRAND_INNER) => (inner.match(new RegExp('<' + tag + '[\\s>/]', 'g')) || []).length
eq('a stem, an arm and a leg, and three dots', [open('rect'), open('polygon'), open('circle')].join(','), '1,2,3')
eq('the inner markup is balanced (two <g>)', open('g') === 2 && (mod.KB_BRAND_INNER.match(/<\/g>/g) || []).length === 2, true)
eq('no script or event handler in the artwork', /<script|\son[a-z]+=/i.test(mod.KB_BRAND_INNER), false)
eq('only the brand red and white are used', [...new Set(mod.KB_BRAND_INNER.match(/#[0-9a-f]{3,6}/gi))].sort().join(','), '#f2372a,#fff')
eq('the dots sit on the stem (x = half its width) and inside the K', [...mod.KB_BRAND_INNER.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/g)].every((c) => Number(c[1]) === 6.5 && Number(c[2]) - Number(c[3]) > 0 && Number(c[2]) + Number(c[3]) < 36), true)
const fav = mod.kbBrandFaviconHref()
eq('favicon is an SVG data URI', fav.startsWith('data:image/svg+xml,'), true)
const favSvg = decodeURIComponent(fav.slice('data:image/svg+xml,'.length))
eq('favicon declares the SVG namespace and its own, padded viewBox', favSvg.includes('xmlns="http://www.w3.org/2000/svg"') && favSvg.includes('viewBox="' + mod.KB_BRAND_FAVICON_VIEWBOX + '"'), true)
eq('the favicon is the same K with bigger dots', favSvg.includes(mod.KB_BRAND_FAVICON_INNER) && mod.KB_BRAND_FAVICON_INNER.includes('r="3.3"') && mod.KB_BRAND_INNER.includes('r="2.8"') && mod.KB_BRAND_FAVICON_INNER.replace(/r="3.3"/g, 'r="2.8"') === mod.KB_BRAND_INNER, true)
eq('the padded viewBox still holds the whole K', (() => { const [x, y, w, h] = mod.KB_BRAND_FAVICON_VIEWBOX.split(' ').map(Number); return x <= 0 && y <= 0 && x + w >= 32.5 && y + h >= 36 })(), true)
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

/* ── 5. Team brand from Kybernos Cloud: the active workspace's `brand` ───── */
const C = mod.kbBrandFromCloud
const PNGB = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
// The real answer of GET /kybernos-cloud/status (shape read from the live route): workspaces live under `state`.
const cs = (workspaces, active, connected = true) => ({ ok: true, connected, state: { connected, workspaces, active_workspace_id: active } })
const ws = (id, brand) => ({ id, name: 'Space ' + id, plan: 'team', ...(brand === undefined ? {} : { brand }) })
eq('nothing, junk or a string -> null', [C(null), C(undefined), C('x'), C(42)].every((v) => v === null), true)
eq('not connected -> null (even with a brand in the data)', C(cs([ws('a', { name: 'Acme' })], 'a', false)), null)
eq('connected, no workspaces -> null', C(cs([])), null)
eq('workspaces that is not an array -> null', C({ ok: true, connected: true, state: { workspaces: 'oops' } }), null)
eq('a workspace without a brand -> null', C(cs([ws('a')], 'a')), null)
eq('the active workspace brand is used', JSON.stringify(C(cs([ws('p'), ws('t', { name: 'Acme AI', logo: PNGB })], 't'))), JSON.stringify({ name: 'Acme AI', logo: PNGB }))
eq('a brand on a workspace that is NOT active is ignored', C(cs([ws('p'), ws('t', { name: 'Acme AI' })], 'p')), null)
eq('with no active id the first workspace counts (the host does the same)', C(cs([ws('t', { name: 'Acme AI' }), ws('p')], undefined)).name, 'Acme AI')
eq('an unknown active id falls back to the first workspace', C(cs([ws('t', { name: 'Acme AI' })], 'gone')).name, 'Acme AI')
eq('the name is cleaned (control characters, 40 characters)', C(cs([ws('t', { name: 'A\u0000cme\n' + 'x'.repeat(80) })], 't')).name.length, 40)
eq('a hostile logo is dropped, the name is kept', JSON.stringify(C(cs([ws('t', { name: 'Acme AI', logo: 'javascript:alert(1)' })], 't'))), JSON.stringify({ name: 'Acme AI', logo: null }))
eq('an https logo URL is dropped (only data URIs), name kept', C(cs([ws('t', { name: 'Acme AI', logo: 'https://evil.example/x.png' })], 't')).logo, null)
eq('a brand that is not an object -> null', [C(cs([ws('t', 'Acme AI')], 't')), C(cs([ws('t', 12)], 't'))].every((v) => v === null), true)
eq('null entries among the workspaces do not throw', C(cs([null, 7, ws('t', { name: 'Acme AI' })], 't')).name, 'Acme AI')
eq('a flat shape (workspaces at the top level) is read too', C({ connected: true, workspaces: [ws('t', { name: 'Acme AI' })], active_workspace_id: 't' }).name, 'Acme AI')
eq('same brand: equal', mod.kbBrandSame({ name: 'A', logo: null }, { name: 'A', logo: null }), true)
eq('same brand: null and null', mod.kbBrandSame(null, null), true)
eq('same brand: different name', mod.kbBrandSame({ name: 'A', logo: null }, { name: 'B', logo: null }), false)
eq('same brand: null against a brand', mod.kbBrandSame(null, { name: 'A', logo: null }), false)

/* ── 6. The client really wires the block in (static) ─────────────────────── */
eq('the old circle logo is gone', src.includes('KB_LOGO_RED') || src.includes('KybernosLogo'), false)
eq('the old bubble pastille is gone (one K in the product)', /rx="8" fill="' \+ KB_BRAND_RED|9\.5,61 24,56\.5/.test(src), false)
eq('the wizard draws the brand\'s K, not a copy of its own', /KB_BRAND_VIEWBOX \+ '" style="height:/.test(src) && !src.includes('KB_OB_MARK'), true)
eq('the sidebar mark slot is shadowed', /name: 'sidebar\.brand\.mark', priority: -1 \}, KybernosSidebarMark/.test(src), true)
eq('the sidebar name slot is shadowed', /name: 'sidebar\.brand\.name', priority: -1 \}, KybernosSidebarName/.test(src), true)
eq('the contract for other bundles is published', src.includes('window.__KB_BRAND__ = {'), true)
eq('"Powered by" is added by the shell whenever an override is active', /if \(ov !== null\) \{[\s\S]{0,400}h\(KybernosPoweredBy\)/.test(src), true)

eq('the cloud brand effect asks /kybernos-cloud/status', /fetch\('\/kybernos-cloud\/status', \{ cache: 'no-store' \}\)/.test(src), true)
eq('it only clears a brand it set itself (source tracking)', /else if \(kbBrandSource === 'cloud'\) kbBrandSet\(null\)/.test(src), true)
eq('a brand set by another module is tagged "api" by default', /typeof source === 'string' \? source : 'api'/.test(src), true)
eq('it stops its timers when disposed', /clearTimeout\(first\); clearInterval\(timer\)/.test(src), true)

// A1-10: the sentence under the Theme page's title named the engine, « DeepSeek Harness », while the tab title already says Kybernos. The product name is the
// brand's on that page, in the French source and the English pair of the page and in the core's table.
{
  const theme = readFileSync(root + 'packages/kybernos-theme/client.js', 'utf8')
  const line = theme.split('\n').find((l) => /Les réglages de base sont dans Essentiel/.test(l)) || ''
  eq('the Theme page subtitle is found', line !== '', true)
  eq('the Theme page subtitle names Kybernos in French and in English', /Personnalise l’apparence de Kybernos\./.test(line) && /Customize the look of Kybernos\./.test(line), true)
  eq('…and never the engine', /DeepSeek Harness/.test(line), false)
  const row = src.split('\n').find((l) => /Les réglages de base sont dans Essentiel/.test(l)) || ''
  // the core no longer rewrites the Theme page (that page writes its own English and French, WP-07): the row is gone, and if one ever comes back it must not name the engine
  eq('the core has no table row that names the engine for this sentence', !/DeepSeek Harness/.test(row), true)
}

console.log(fails === 0 ? '\nbrand: all checks pass' : '\nbrand: ' + fails + ' check(s) FAILED')
process.exit(fails === 0 ? 0 : 1)
