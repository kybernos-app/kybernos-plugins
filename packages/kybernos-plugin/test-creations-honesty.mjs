#!/usr/bin/env node
/** Lot 2 of the interfaces triage (2026-10-24), the Creations page: five places that said more, or less, than the truth.
 *
 *  T2-03  Delete took the file for good with one click: it asks first (the name in the question, nothing deleted without a yes).
 *  T2-09  « 500 » was drawn as a count while it is the cap of the list: the host says when it cut, the sidebar and the « All » tile write « 500+ ».
 *  T2-10  The « Modified » (7 / 30 days) filter was drawn and counted as active but filtered nothing: the chain applies it (the clock is passed in).
 *  T2-11  The pins (star, pin to top) were lost on reload: they live in the shared favourites store, scope « creations ».
 *  T2-21  The Workspace > Creations tab showed raw markdown (**bold**, backticks) in document previews: every shown line goes through the card subtitle's strip.
 *
 *  The rules are pure functions of client.js (a marked block) and art-limit.mjs, run here as they are; the wiring that cannot be run without a
 *  browser (the page's filter chain, its delete action, the sidebar) is pinned at source level.
 *
 *  Usage: node packages/kybernos-plugin/test-creations-honesty.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { kbArtifactsCut } from './art-limit.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, 'client.js'), 'utf8')
const host = readFileSync(join(here, 'index.js'), 'utf8')

// The marked block of pure rules, with the translation table entry it reads (kbt) stood in from the real KB_T line.
const a = src.indexOf('// <kb-art-rules:begin>')
const b = src.indexOf('// <kb-art-rules:end>')
assert.ok(a > 0 && b > a, 'the block of pure rules exists in client.js')
const tEntry = (key) => {
  const m = new RegExp("'" + key.replace(/\./g, '\\.') + "': \\{ kybernos: '([^']+)', en: '([^']+)' \\}").exec(src)
  assert.ok(m !== null, key + ' is in the translation table')
  return { fr: m[1], en: m[2] }
}
const askText = tEntry('deliv.delete.confirm')
const mk = (lang) => new Function('kbt', src.slice(a, b) + '\nreturn { kbArtPlain, kbArtInPeriod, kbArtCountLabel, kbArtDeleteOk }')((key) => {
  assert.equal(key, 'deliv.delete.confirm', 'the rules read only the delete question')
  return lang === 'fr' ? askText.fr : askText.en
})
const rules = mk('en')

// ── T2-03 ────────────────────────────────────────────────────────────────────
{
  const asked = []
  const yes = (m) => { asked.push(m); return true }
  const no = (m) => { asked.push(m); return false }
  assert.equal(rules.kbArtDeleteOk('plan.md', yes), true, 'a yes goes ahead')
  assert.equal(rules.kbArtDeleteOk('plan.md', no), false, 'a no stops')
  assert.equal(rules.kbArtDeleteOk('plan.md', () => undefined), false, 'only a real true goes ahead (a dialog that answers nothing is not a yes)')
  assert.equal(rules.kbArtDeleteOk('plan.md', () => 'yes'), false, 'a truthy string is not a yes')
  assert.equal(rules.kbArtDeleteOk('plan.md', null), false, 'no way to ask (no window.confirm): nothing is deleted')
  assert.equal(rules.kbArtDeleteOk('plan.md', undefined), false, 'no way to ask: nothing is deleted')
  assert.equal(rules.kbArtDeleteOk('plan.md', () => { throw new Error('blocked dialog') }), false, 'a dialog that throws: nothing is deleted')
  assert.equal(asked[0], 'Delete “plan.md”? This cannot be undone.', 'the English question names the file and says it cannot be undone')
  assert.equal(mk('fr').kbArtDeleteOk('plan.md', (m) => { asked.push(m); return true }), true)
  assert.equal(asked[asked.length - 1], 'Supprimer « plan.md » ? Cette action est irréversible.', 'the French twin names the file too')
  rules.kbArtDeleteOk('a$&b$1.md', (m) => { asked.push(m); return false })
  assert.ok(asked[asked.length - 1].includes('“a$&b$1.md”'), 'a name with replacement patterns ($& $1) is written as it is')
  assert.ok(askText.fr.includes('{name}') && askText.en.includes('{name}'), 'both languages carry the {name} slot')
  ok('T2-03: kbArtDeleteOk goes ahead only on a real yes; the question names the file in French and in English; no dialog = no delete')

  // The page's delete action asks BEFORE it posts anything to the host, and only for « delete ».
  const d0 = src.indexOf('const doAction = (action, a, extra) => {')
  const d1 = src.indexOf("host.call('kybers/art-action', payload)", d0)
  assert.ok(d0 > 0 && d1 > d0, 'doAction exists in the Creations page')
  const body = src.slice(d0, d1)
  const gate = body.indexOf("if (action === 'delete' && kbArtDeleteOk(a.name, typeof window.confirm === 'function' ? (m) => window.confirm(m) : null) !== true) return")
  assert.ok(gate > 0, 'doAction asks (window.confirm) and returns unless the answer is a yes')
  assert.ok(gate < body.indexOf('const payload = { action: action, path: a.path }'), 'the question comes before the payload is built and posted')
  assert.equal(src.split("host.call('kybers/art-action'").length - 1, 1, 'doAction is the only caller of art-action in the page')
  assert.match(src, /item\('delete', 'trash', kbt\('kbui\.delete'\), true, \(\) => \{ setOpen\(false\); onAction\('delete', a\) \}\)/, 'the menu item goes through onAction (doAction), never to the host directly')
  ok('T2-03: doAction asks before it posts « delete » to art-action; the menu item has no other way to the host')
}

// ── T2-09 ────────────────────────────────────────────────────────────────────
{
  assert.equal(rules.kbArtCountLabel(500, true), '500+', 'a cut list at the cap reads 500+')
  assert.equal(rules.kbArtCountLabel(512, true), '512+', 'the disk list plus the pushed ones (client side) still reads « n+ »')
  assert.equal(rules.kbArtCountLabel(500, false), '500', 'a list that is exactly 500 files and was not cut stays 500')
  assert.equal(rules.kbArtCountLabel(500, undefined), '500', 'a host that does not say (older, or the client collect) stays 500')
  assert.equal(rules.kbArtCountLabel(500, 'true'), '500', 'only the flag true counts')
  assert.equal(rules.kbArtCountLabel(0, false), '0')
  assert.equal(rules.kbArtCountLabel(12, false), '12')

  // the host rule: 501 fixture files cut, 500 not; a root under the limit whose neighbours push the list over it is cut; one over it with no neighbour is cut
  assert.equal(kbArtifactsCut(501, 500, 500), true, '501 files in the root')
  assert.equal(kbArtifactsCut(500, 500, 500), false, 'exactly 500: nothing was left out')
  assert.equal(kbArtifactsCut(499, 499, 500), false)
  assert.equal(kbArtifactsCut(400, 700, 500), true, 'a root under the limit plus other workspaces over it')
  assert.equal(kbArtifactsCut(200, 300, 500), false, 'both under the limit')
  assert.equal(kbArtifactsCut(900, 500, 500), true, 'a root over the limit already cut to it, with no neighbour (the merge list is only 500)')
  assert.equal(kbArtifactsCut(0, 0, 500), false)
  ok('T2-09: kbArtCountLabel writes « 500+ » only for a list the host flagged; kbArtifactsCut flags 501 files, 400+300, 900, and not 500 or 200+100')

  // host wiring: initial false, set after the own slice (no workspace registry) and again before the merged slice (registry), the flag read from the host, not from a length
  assert.match(host, /import \{ kbArtifactsCut \} from '\.\/art-limit\.mjs'/, 'index.js imports the rule')
  assert.match(host, /artifacts: \[\],\n\s+artifactsCut: false,/, 'the payload always has the flag')
  const own = host.indexOf('out.artifacts = ownArtsFull.slice(0, ARTIFACT_LIMIT)')
  const ownFlag = host.indexOf('out.artifactsCut = kbArtifactsCut(ownArtsFull.length, ownArtsFull.length, ARTIFACT_LIMIT)', own)
  assert.ok(own > 0 && ownFlag > own && ownFlag - own < 400, 'set right after the root\'s own list is cut')
  const mergedFlag = host.indexOf('out.artifactsCut = kbArtifactsCut(ownArtsFull.length, merged.length, ARTIFACT_LIMIT)')
  const mergedSlice = host.indexOf('out.artifacts = merged.slice(0, ARTIFACT_LIMIT)')
  assert.ok(mergedFlag > 0 && mergedFlag < mergedSlice, 'set again, from the merged length, BEFORE the merged list is cut')
  ok('T2-09: the host sets artifactsCut where it cuts (the root alone, and the merged list), before each slice')

  // client wiring: the sidebar badge and the « All » tile; the badge accepts a text, and a zero stays hidden
  assert.match(src, /const artsCut = hasPayload === true && s\.data\.artifactsCut === true/, 'the page reads the host flag')
  assert.match(src, /const artsCut = s\.data !== null && s\.data !== undefined && s\.data\.artifactsCut === true/, 'the sidebar reads the host flag')
  assert.match(src, /h\('span', \{ className: 'kb-type-cnt' \}, kbArtCountLabel\(typed\.length, artsCut\)\)\)\),\n\s+\/\/ Familles d/, 'the « All » tile writes the label')
  assert.match(src, /row\('deliverables', Icon\('shapes', 15\), kbt\('menu\.deliverables'\), arts\.length > 0 \? kbArtCountLabel\(arts\.length, artsCut\) : 0,/, 'the sidebar row gets the label (a zero stays a number, hidden)')
  assert.match(src, /\(badge !== null && badge !== undefined && \(typeof badge === 'string' \? badge !== '' : badge > 0\)\) \? h\('span', \{ className: 'kb4-badge' \}, String\(badge\)\) : null/, 'row() draws a text badge, and still hides 0')
  ok('T2-09: the sidebar badge and the « All » tile read the host flag; row() draws a text badge and still hides a zero')
}

// ── T2-10 ────────────────────────────────────────────────────────────────────
{
  const DAY = 86400000
  const NOW = Date.UTC(2026, 9, 24, 12, 0, 0)
  const keeps = (age, period) => rules.kbArtInPeriod(NOW - age, period, NOW)
  assert.equal(keeps(6 * DAY, '7'), true, '6 days old is inside 7 days')
  assert.equal(keeps(7 * DAY, '7'), true, 'exactly 7 days is still inside')
  assert.equal(keeps(7 * DAY + 1, '7'), false, '7 days and a millisecond is out')
  assert.equal(keeps(8 * DAY, '7'), false, '8 days old is out of 7 days')
  assert.equal(keeps(8 * DAY, '30'), true, 'but inside 30 days')
  assert.equal(keeps(30 * DAY, '30'), true, 'exactly 30 days is inside')
  assert.equal(keeps(31 * DAY, '30'), false, '31 days is out of 30')
  assert.equal(keeps(400 * DAY, 'all'), true, '« All » keeps everything')
  assert.equal(keeps(400 * DAY, undefined), true, 'no period keeps everything')
  assert.equal(keeps(400 * DAY, '90'), true, 'an unknown period keeps everything')
  assert.equal(keeps(-3 * DAY, '7'), true, 'a date in the future (clock skew) is not old')
  for (const missing of [null, undefined, NaN, '1700000000000', Infinity]) assert.equal(rules.kbArtInPeriod(missing, '7', NOW), true, 'no usable date (' + String(missing) + '): kept, nothing says it is old')
  assert.equal(rules.kbArtInPeriod(NOW - 99 * DAY, '7', NaN), true, 'a clock that gives no time keeps everything instead of emptying the page')
  // the list the page would draw for « 7 days »
  const files = [{ n: 'new', m: NOW - 1000 }, { n: 'week', m: NOW - 6 * DAY }, { n: 'old', m: NOW - 8 * DAY }, { n: 'undated', m: null }, { n: 'ancient', m: NOW - 200 * DAY }]
  assert.deepEqual(files.filter((f) => rules.kbArtInPeriod(f.m, '7', NOW)).map((f) => f.n), ['new', 'week', 'undated'])
  assert.deepEqual(files.filter((f) => rules.kbArtInPeriod(f.m, '30', NOW)).map((f) => f.n), ['new', 'week', 'old', 'undated'])
  assert.equal(files.filter((f) => rules.kbArtInPeriod(f.m, 'all', NOW)).length, 5)
  ok('T2-10: kbArtInPeriod keeps the last 7 / 30 days (edges to the millisecond), an undated file, a future date; all/unknown keep all; a bad clock keeps all')

  // wiring: the chain applies it with a clock read once per render, and the effects that depend on the list re-run when the period changes
  const f0 = src.indexOf('const nowMs = Date.now()')
  const f1 = src.indexOf('const sorted = filtered.slice()', f0)
  assert.ok(f0 > 0 && f1 > f0, 'the filter chain of the Creations page exists')
  const chain = src.slice(f0, f1)
  assert.ok(chain.includes('.filter((a) => kbArtInPeriod(a.mtimeMs, tbArts[0].period, nowMs))'), 'the chain applies the period')
  assert.ok(!/kbArtInPeriod[^\n]*Date\.now/.test(chain), 'the rule is handed the clock, it does not read it')
  assert.match(src, /React\.useEffect\(\(\) => \{ setReveal\(KB_ART_REVEAL\) \}, \[typesKey, sort, q, tbArts\[0\]\.period\]\)/, 'a new period folds the grid back to its first cards')
  assert.match(src, /\}, \[typesKey, sort, q, tbArts\[0\]\.period, reveal, s\.data\]\)\n\s+const openName =/, 'and the previews of the cards that come into view are read')
  assert.match(src, /facets: \{ type: \{ options: tilesShown\.map\(\(d\) => \(\{ id: d\.id, label: d\.label, count: d\.count \}\)\) \}, period: true \}/, 'the toolbar still offers the period (the filter is no longer a decoration)')
  ok('T2-10: the page\'s chain applies the period with the clock read once per render; the reveal and the previews follow a period change')
}

// ── T2-11 ────────────────────────────────────────────────────────────────────
{
  const f0 = src.indexOf("const KB_FAV_KEY = 'kybernos.favorites.v1'")
  const f1 = src.indexOf('\n', src.indexOf('const kbFavOn = ', f0))
  assert.ok(f0 > 0 && f1 > f0, 'the favourites store exists in client.js')
  const store = {}
  const win = { localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v) } } }
  // each call builds the functions anew: the reload of the page, over the same browser storage
  const boot = (w) => new Function('window', src.slice(f0, f1) + '\nreturn { kbFavRead, kbFavToggle, kbFavOn, KB_FAV_SCOPES }')(w)
  let fav = boot(win)
  assert.ok(fav.KB_FAV_SCOPES.includes('creations'), 'the scope exists')
  assert.deepEqual(fav.kbFavRead().creations, {}, 'nothing pinned at first')
  const P1 = '/work/proj/artifacts/plan.md'
  const P2 = '/work/proj/reports/q3.html'
  assert.equal(fav.kbFavToggle('creations', P1).creations[P1], true, 'pin')
  fav.kbFavToggle('creations', P2)
  fav = boot(win) // reload
  assert.deepEqual(fav.kbFavRead().creations, { [P1]: true, [P2]: true }, 'the two pins are still there after a reload')
  assert.equal(fav.kbFavOn(fav.kbFavRead(), 'creations', P1), true)
  fav.kbFavToggle('creations', P1)
  fav = boot(win)
  assert.deepEqual(fav.kbFavRead().creations, { [P2]: true }, 'unpinned and still unpinned after a reload')
  // the other panels\' stars live in the same key and survive a creation pin
  fav.kbFavToggle('workspaces', 'ws1')
  fav.kbFavToggle('kybers', 'k1')
  fav.kbFavToggle('automations', 'a1')
  fav.kbFavToggle('creations', P1)
  fav = boot(win)
  const all = fav.kbFavRead()
  assert.deepEqual([all.workspaces, all.kybers, all.automations, all.creations], [{ ws1: true }, { k1: true }, { a1: true }, { [P2]: true, [P1]: true }], 'four scopes side by side, none overwrote another')
  // a store written before this scope existed, a corrupt one, and a browser with no storage
  store['kybernos.favorites.v1'] = JSON.stringify({ workspaces: { w: true }, kybers: {}, automations: {} })
  assert.deepEqual(boot(win).kbFavRead().creations, {}, 'an older store without the scope reads as nothing pinned')
  assert.deepEqual(boot(win).kbFavRead().workspaces, { w: true }, 'and keeps what it had')
  store['kybernos.favorites.v1'] = '{not json'
  assert.deepEqual(boot(win).kbFavRead(), { workspaces: {}, kybers: {}, automations: {}, creations: {} }, 'a corrupt store reads as empty, no throw')
  store['kybernos.favorites.v1'] = JSON.stringify({ creations: ['not', 'a', 'map'], extra: { x: true } })
  assert.deepEqual(boot(win).kbFavRead().creations, {}, 'a scope that is not a map reads as empty; a scope nobody knows is ignored')
  const dead = boot({ localStorage: { getItem () { throw new Error('denied') }, setItem () { throw new Error('denied') } } })
  assert.deepEqual(dead.kbFavRead().creations, {}, 'private mode: reads as empty')
  assert.doesNotThrow(() => dead.kbFavToggle('creations', P1), 'private mode: a pin does not throw (it just does not last)')
  ok('T2-11: pins in scope « creations » survive a reload, unpin, sit beside the three other scopes, and an older/corrupt/unavailable store reads as nothing pinned')

  // wiring: the page has no in-memory pin store left
  assert.ok(!/\bapins\b/.test(src), 'no `apins` (the in-memory store) is left in client.js')
  assert.ok(!/\bnPins\b/.test(src), 'the unused pin counter is gone')
  assert.match(src, /const artFavPair = React\.useState\(\(\) => kbFavRead\(\)\)/, 'the page reads the store once, as the other pages do')
  assert.match(src, /const pins = artFavs\.creations\n\s+const togglePin = \(path\) => \{ setArtFavs\(kbFavToggle\('creations', path\)\) \}/, 'pins come from, and go to, the store')
  assert.match(src, /const KB_FAV_SCOPES = \['workspaces', 'kybers', 'automations', 'creations'\]/)
  ok('T2-11: the page pins through kbFavToggle(\'creations\', path); `apins` and the dead pin counter are gone')
}

// ── T2-21 ────────────────────────────────────────────────────────────────────
{
  const p = rules.kbArtPlain
  assert.equal(p('- **Skills**: x'), 'Skills: x', 'a list bullet and bold')
  assert.equal(p('## Plan of the **cloud computer**'), 'Plan of the cloud computer', 'heading hashes and bold')
  assert.equal(p('Run `npm test` first'), 'Run npm test first', 'backticks')
  assert.equal(p('> **Note** — keep it'), 'Note — keep it', 'a quote')
  assert.equal(p('+ item'), 'item')
  assert.equal(p('* item'), 'item', 'a star bullet leaves no leading space')
  assert.equal(p('<b>bold</b> text'), 'bold text', 'tags')
  assert.equal(p('plain words'), 'plain words')
  assert.equal(p('2026-10-24 — 3 - 4 = -1'), '2026-10-24 — 3 - 4 = -1', 'a dash inside the line is not a bullet')
  assert.equal(p(''), '')
  assert.equal(p(null), '')
  assert.equal(p(undefined), '')

  // previewContent itself (the Workspace > Creations tab draws it directly), run on a document preview with a stand-in for the React element
  const c0 = src.indexOf('const previewContent = (t, name, preview, path, size) => {')
  const c1 = src.indexOf('    const KbArtMenu = (p0) => {', c0)
  assert.ok(c0 > 0 && c1 > c0, 'previewContent exists')
  const h = (type, props, ...children) => ({ type, props: props || {}, children })
  const previewContent = new Function('h', 'kbArtPlain', 'previewLine', 'KB_AV_AUDIO', 'kbe', 'kbt', 'kbFmtSize', 'kbTiArt', 'kbTiOfName',
    src.slice(c0, c1) + '\nreturn previewContent')(h, p, (i, w) => h('div', { className: 'kb6-line', width: w }), [], (s) => s, (s) => s, () => '', () => null, () => 'doc')
  const texts = (node) => (Array.isArray(node) ? node.flatMap(texts) : (node === null || node === undefined ? [] : (typeof node === 'string' ? [node] : texts(node.children))))
  const doc = { id: 'doc' }
  const md = '# The **cloud computer** plan\n\n- **Skills**: `docx`, `pdf`\n> **Note**: ask first\n---\nplain'
  const shown = texts(previewContent(doc, 'PLAN.md', { kind: 'text', text: md }, '/p/PLAN.md', md.length))
  assert.deepEqual(shown.slice(0, 3), ['The cloud computer plan', 'Skills: docx, pdf', 'Note: ask first'], 'title and the two lines under it as plain words')
  assert.ok(!shown.some((l) => /\*|`|^#|^>/.test(l)), 'no markdown mark is left on any shown line')
  assert.deepEqual(texts(previewContent(doc, 'EMPTY.md', { kind: 'text', text: '```\n**' }, '/p/EMPTY.md', 6)).filter((l) => l.length > 0), ['EMPTY.md'], 'a document that is only marks falls back to the file name, no empty lines')
  assert.equal(texts(previewContent(doc, 'NONE.md', null, '/p/NONE.md', 0))[0], 'NONE.md', 'no text: the file name, as before')
  ok('T2-21: kbArtPlain strips tags, hashes, bullets, quotes, backticks and stars; the document preview of the tab shows plain words')

  // the card subtitle keeps its own behaviour and now shares the strip
  const k0 = src.indexOf('const kbArtFirstLine = (preview) => {')
  const k1 = src.indexOf('    const KbArtCard = ', k0)
  assert.ok(k0 > 0 && k1 > k0, 'kbArtFirstLine exists')
  const first = new Function('kbArtPlain', src.slice(k0, k1) + '\nreturn kbArtFirstLine')(p)
  assert.equal(first({ text: '---\n# **Title** here\nbody' }), 'Title here', 'rule lines are skipped, the first real line is stripped')
  assert.equal(first('- **Skills**: x'), 'Skills: x')
  assert.equal(first(null), '')
  assert.equal(first({ text: '' }), '')
  assert.match(src, /return kbArtPlain\(lines\[0\]\)\.slice\(0, 96\)/, 'the subtitle uses the shared strip')
  ok('T2-21: the card subtitle (kbArtFirstLine) behaves as before and shares the strip')
}

console.log('\n' + pass + ' checks passed')
