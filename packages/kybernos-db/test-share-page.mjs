// kybernos-db, the page that shows a shared dashboard: what it draws, that a snapshot can only ever become text and a few shapes, and the one file a person can keep.
// The browser itself is checked by scripts/check-share-page.mjs (it needs a Chrome); everything here runs in Node.
//
//   node packages/kybernos-db/test-share-page.mjs
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { Script } from 'node:vm'
import { drifted } from '../../scripts/vendor-share.mjs'
import { DASHBOARD, salesWorld } from './lib-share-test.mjs'
import { kvCheck, kvLock, kvMessage, kvMount, kvPage, kvShort, kvTick, kvh } from './share/render.mjs'
import { SEAL_ITERATIONS_MIN, sealText } from './share/seal.mjs'
import { buildSnapshot } from './share/snapshot.mjs'
import { exportFile, viewerCss, viewerHtml, viewerPolicy, viewerScript } from './share/viewer.mjs'

let count = 0
const ok = async (label, fn) => { await fn(); count++; console.log('ok  ', label) }

const world = salesWorld()
const made = buildSnapshot({ dashboard: DASHBOARD, api: world.api, now: Date.UTC(2026, 10, 2, 9) })
assert.equal(made.ok, true)
const DOC = made.doc

/** A DOM that only records, to see what a tree becomes. */
function fakeDocument () {
  const el = (tag) => ({ tag, attrs: {}, kids: [], listeners: {}, setAttribute (k, v) { this.attrs[k] = String(v) }, addEventListener (k, f) { this.listeners[k] = f }, appendChild (c) { this.kids.push(c); return c } })
  return { createTextNode: (text) => ({ text: String(text) }), createElement: el, createElementNS: (ns, tag) => ({ ...el(tag), ns }) }
}
function walk (node, visit) {
  visit(node)
  for (const c of Array.isArray(node.c) ? node.c : []) walk(c, visit)
}
const nodes = (tree) => { const out = []; walk(tree, (n) => { if (n !== null && typeof n === 'object') out.push(n) }); return out }
const texts = (tree) => { const out = []; walk(tree, (n) => { if (typeof n === 'string' || typeof n === 'number') out.push(String(n)) }); return out }

await ok('the copies of the Dashboards plugin\'s model and chart geometry are the originals (node scripts/vendor-share.mjs refreshes them)', () => {
  assert.deepEqual(drifted(), [])
})

await ok('the page of the fixture shop has a title, nine widgets in order, and the numbers of the snapshot', () => {
  const tree = kvPage(kvCheck(DOC))
  const sections = nodes(tree).filter((n) => n.t === 'section')
  assert.equal(sections.length, 9)
  assert.deepEqual(sections.map((s) => s.a['aria-label']), DOC.widgets.map((w) => w.title || w.type))
  const all = texts(tree)
  assert.ok(all.includes('Sales'))
  assert.ok(all.includes('The first two months'))
  assert.ok(all.some((t) => /2,750/.test(t)), 'the revenue card shows the sum')
  assert.ok(all.some((t) => /A snapshot of 2026-11-02/.test(t)))
  assert.ok(nodes(tree).some((n) => n.t === 'svg'), 'charts are drawn as shapes')
})

await ok('a snapshot is data: every text in it only becomes a text node, and the page sets no style, link, address, form action or handler', () => {
  const evil = '"><img src=x onerror=alert(1)></script><svg onload=alert(2)>'
  const doc = {
    kind: 'kybernos-snapshot', version: 1, title: evil, desc: evil, made: evil,
    widgets: [
      { id: 'a', type: 'card', title: evil, w: 3, h: 2, data: { text: evil, sub: evil, st: evil, spark: [1, 2, 3] } },
      { id: 'b', type: 'chart', title: evil, w: 6, h: 4, data: { kind: 'bars', unit: evil, labels: [{ label: evil }, { label: evil, tone: evil }], series: [{ name: evil, values: [3, 4] }], totals: [3, 4] } },
      { id: 'c', type: 'chart', title: evil, w: 6, h: 4, data: { kind: 'donut', labels: [{ label: evil }, { label: 'x' }], series: [{ name: evil, values: [3, 4] }], totals: [3, 4] } },
      { id: 'd', type: 'chart', title: evil, w: 6, h: 4, data: { kind: 'stacked', labels: [{ label: evil }, { label: 'x' }], series: [{ name: evil, values: [3, 4] }, { name: evil, values: [1, 2] }], totals: [4, 6] } },
      { id: 'e', type: 'table', title: evil, w: 6, h: 4, data: { total: 3, columns: [{ label: evil, type: 'text' }, { label: 'n', type: 'number', bar: true }], rows: [[{ s: evil }, { s: evil, bar: 0.5 }]] } },
      { id: 'f', type: 'list', title: evil, w: 4, h: 4, data: { rows: [{ title: evil, sub: evil, when: evil, state: evil }] } },
      { id: 'g', type: 'note', title: evil, w: 4, h: 2, data: { tint: 'amber" onmouseover="x', text: evil + '\n' + evil } },
      { id: 'h', type: 'note', title: evil, w: 4, h: 2, data: { check: [[evil, 1], [evil, 0]] } },
      { id: 'i', type: 'script', title: evil, w: 4, h: 2, data: {} },
    ],
  }
  const checked = kvCheck(doc)
  assert.equal(checked.widgets.length, 8, 'a widget of a type the page does not draw is dropped')
  const tree = kvPage(checked)
  const attrs = []
  for (const n of nodes(tree)) for (const [k, v] of Object.entries(n.a)) attrs.push([n.t, k, v])
  const allowed = new Set(['class', 'aria-label', 'aria-hidden', 'role', 'viewBox', 'preserveAspectRatio', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'width', 'height', 'd', 'points', 'fill', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset', 'transform', 'text-anchor', 'scope'])
  for (const [tag, k, v] of attrs) {
    assert.ok(allowed.has(k), tag + ' sets "' + k + '"')
    if (k === 'class') assert.match(String(v), /^[a-z0-9 -]*$/, 'a class is never made of the snapshot: ' + v)
    if (k === 'aria-label') assert.equal(typeof v, 'string')
    if (k === 'transform') assert.match(String(v), /^rotate\(-90 [\d.]+ [\d.]+\)$/)
    if (['x', 'y', 'cx', 'cy', 'r', 'width', 'height'].includes(k)) assert.ok(Number.isFinite(Number(v)), k + ' is a number')
  }
  const klass = attrs.filter(([, k]) => k === 'class').map(([, , v]) => v).join(' ')
  assert.equal(/onmouseover|onerror|onload|alert/.test(klass), false)
  assert.ok(texts(tree).some((t) => t.includes('<img src=x')), 'the text is still there, as text')
  // and mounted for real, on a recording DOM: no handler, no style, no address
  const root = kvMount(fakeDocument(), tree)
  const seen = []
  const visit = (e) => { if (e.attrs !== undefined) { seen.push(...Object.keys(e.attrs)); assert.deepEqual(Object.keys(e.listeners), []); for (const c of e.kids) visit(c) } }
  visit(root)
  assert.equal(seen.some((k) => /^on/i.test(k) || ['style', 'href', 'src', 'srcdoc', 'action', 'formaction', 'target'].includes(k.toLowerCase())), false)
  assert.ok(seen.includes('viewBox') && seen.includes('preserveAspectRatio'), 'the two camel-case SVG attributes survive')
})

await ok('the mounter refuses a tag the page does not use, and never sets a style, a link or an inline handler even when asked', () => {
  assert.throws(() => kvMount(fakeDocument(), kvh('script', null, 'x')), /does not use: script/)
  assert.throws(() => kvMount(fakeDocument(), kvh('iframe', null)), /does not use/)
  assert.throws(() => kvMount(fakeDocument(), kvh('svg', null, kvh('foreignObject', null))), /does not use: foreignObject/)
  const el = kvMount(fakeDocument(), kvh('div', { class: 'x', style: 'color:red', href: 'javascript:1', src: 'x', onclick: 'alert(1)', ONCLICK: 'alert(2)', 'data-x': 'ok' }))
  assert.deepEqual(Object.keys(el.attrs).sort(), ['class', 'data-x'])
  const fn = kvMount(fakeDocument(), kvh('form', { onsubmit: () => 1 }))
  assert.equal(typeof fn.listeners.submit, 'function', 'a handler of the page\'s own is a function, never text')
})

await ok('a snapshot the page does not know is not drawn: wrong kind, wrong version, no widgets, too many', () => {
  assert.equal(kvCheck(null), null)
  assert.equal(kvCheck({ kind: 'other', version: 1, widgets: [] }), null)
  assert.equal(kvCheck({ kind: 'kybernos-snapshot', version: 2, widgets: [] }), null)
  assert.equal(kvCheck({ kind: 'kybernos-snapshot', version: 1 }), null)
  const many = { kind: 'kybernos-snapshot', version: 1, widgets: Array.from({ length: 80 }, (_, i) => ({ id: 'n' + i, type: 'note', data: { text: 'x' } })) }
  assert.equal(kvCheck(many).widgets.length, 24)
})

await ok('empty and odd data draws something and never throws: no data, one point, NaN, huge counts, a very long word', () => {
  const odd = [
    { id: 'a', type: 'card', title: 't', w: 3, h: 2, data: {} },
    { id: 'b', type: 'chart', title: 't', w: 6, h: 4, data: { kind: 'line', labels: [{ label: 'only' }], series: [{ name: 's', values: [5] }], totals: [5] } },
    { id: 'c', type: 'chart', title: 't', w: 6, h: 4, data: { kind: 'columns', labels: [{ label: 'a' }, { label: 'b' }], series: [{ name: 's', values: [NaN, null] }], totals: [] } },
    { id: 'd', type: 'chart', title: 't', w: 6, h: 4, data: { kind: 'heatmap', labels: Array.from({ length: 400 }, (_, i) => ({ label: '2026-01-' + (i % 28 + 1) })), series: [{ name: 's', values: [] }], totals: Array.from({ length: 400 }, (_, i) => i) } },
    { id: 'e', type: 'chart', title: 't', w: 6, h: 4, data: { kind: 'donut', labels: [], series: [], totals: [], empty: true } },
    { id: 'f', type: 'table', title: 't', w: 6, h: 4, data: { total: 1e12, columns: [{ label: 'a', type: 'text' }], rows: [[{ s: 'W'.repeat(5000) }]] } },
    { id: 'g', type: 'list', title: 't', w: 4, h: 4, data: { rows: [] } },
    { id: 'h', type: 'note', title: 't', w: 4, h: 2, data: {} },
    { id: 'i', type: 'chart', title: 't', w: 99, h: -4, data: { kind: 'bars', labels: [{ label: 'a' }], series: [{ name: 's', values: [1e308] }], totals: [] } },
  ]
  const tree = kvPage(kvCheck({ kind: 'kybernos-snapshot', version: 1, title: 'Odd', widgets: odd }))
  kvMount(fakeDocument(), tree)
  assert.equal(nodes(tree).filter((n) => n.t === 'section').length, 9)
  assert.ok(texts(tree).every((t) => t.length <= 4000), 'a text is cut')
  assert.equal(kvShort('2026-09-28'), '09-28')
  assert.equal(kvShort('a very long label here', 11).length, 11)
  assert.equal(kvTick(1500), '1.5k')
  assert.equal(kvTick(2e6), '2M')
})

await ok('the lock page and the message page carry text only, and the lock calls back with what was typed', () => {
  let typed = null
  const lock = kvLock({ error: 'Wrong password', onOpen: (p) => { typed = p } })
  const form = nodes(lock).find((n) => n.t === 'form')
  const input = nodes(lock).find((n) => n.t === 'input')
  assert.equal(input.a.type, 'password')
  assert.equal(input.a.autocomplete, 'off')
  form.a.onsubmit({ preventDefault () {}, target: { elements: { password: { value: 'hunter2 hunter2' } } } })
  assert.equal(typed, 'hunter2 hunter2')
  assert.ok(texts(lock).includes('Wrong password'))
  assert.ok(nodes(kvLock({ busy: true, onOpen () {} })).find((n) => n.t === 'button').a.disabled)
  assert.deepEqual(texts(kvMessage('Gone', 'Removed.')), ['Gone', 'Removed.'])
})

await ok('the script is assembled from the four files with nothing left of import or export, parses, and no name is declared twice', () => {
  const script = viewerScript()
  assert.doesNotThrow(() => new Script(script))
  assert.equal(/^\s*(import|export)\s/m.test(script), false)
  assert.ok(script.startsWith("(function () {\n'use strict'"))
  assert.ok(script.trimEnd().endsWith('kvBoot()\n})()'))
  assert.equal(/['"]node:|\bBuffer\b|\brequire\s*\(|\bprocess\./.test(script), false, 'nothing of Node leaks into the page')
  assert.equal(/\beval\s*\(|new Function|document\.write|innerHTML|outerHTML|insertAdjacent/.test(script), false, 'no way to make HTML from text')
})

await ok('the style sheet sets what the page needs: 12 column spans on a wide screen, none on a phone, light and dark, print', () => {
  const css = viewerCss()
  for (let i = 1; i <= 12; i++) assert.ok(css.includes('.kv-s' + i + '{grid-column:span ' + i + '}'))
  for (let i = 1; i <= 8; i++) assert.ok(css.includes('.kv-r' + i + '{grid-row:span ' + i + '}'))
  assert.ok(css.indexOf('@media (min-width:761px){.kv-s1') > 0)
  assert.ok(css.includes('prefers-color-scheme:dark') && css.includes('@media print'))
  assert.equal(/@import|url\(|expression\(/.test(css), false, 'the style sheet loads nothing')
})

await ok('the content policy lets in exactly this script and this style by hash, loads nothing from elsewhere, and a file loads nothing at all', () => {
  const sha = (t) => "'sha256-" + createHash('sha256').update(t, 'utf8').digest('base64') + "'"
  const server = viewerHtml({ docPath: '/s/abc.json' })
  assert.ok(server.policy.includes('script-src ' + sha(viewerScript())))
  assert.ok(server.policy.includes('style-src ' + sha(viewerCss())))
  assert.ok(server.policy.includes("default-src 'none'") && server.policy.includes("connect-src 'self'") && server.policy.includes("base-uri 'none'") && server.policy.includes("form-action 'none'"))
  assert.ok(server.html.includes('data-doc="/s/abc.json"'))
  assert.equal(server.html.includes('id="kv-doc"'), false)
  const file = viewerHtml({ doc: DOC })
  assert.ok(file.policy.includes("connect-src 'none'"))
  assert.equal(/https?:\/\//.test(file.html.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '')), false, 'nothing in the page points anywhere')
  assert.deepEqual(file.policy, viewerPolicy({ script: viewerScript(), css: viewerCss(), fetchOwnSite: false }))
  // the html is the same bytes for any snapshot, so one hash serves every link
  assert.equal(viewerHtml({ docPath: '/s/abc.json' }).html, viewerHtml({ docPath: '/s/abc.json' }).html)
})

await ok('a file carries its snapshot inert: a `</script>` or `<!--` in a title cannot end the data block, and the title is escaped', () => {
  const doc = { ...DOC, title: '</script><script>alert(1)</script><!-- & "x"', desc: '<b>' }
  const html = exportFile(doc)
  const block = /<script type="application\/json" id="kv-doc">([\s\S]*?)<\/script>/.exec(html)
  assert.notEqual(block, null)
  assert.equal(block[1].includes('<'), false)
  assert.deepEqual(JSON.parse(block[1]), doc, 'the data reads back exactly')
  assert.equal((html.match(/<script/g) || []).length, 2, 'the data block and the page script, nothing else')
  assert.ok(html.includes('<title>&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;&lt;!-- &amp; &quot;x&quot;</title>'))
})

await ok('a protected file shows nothing of the snapshot: no title, no number, no text; only the envelope', async () => {
  const env = await sealText(JSON.stringify(DOC), 'a long enough password', { iterations: SEAL_ITERATIONS_MIN })
  const html = exportFile(env)
  assert.ok(html.includes('<title>Protected dashboard</title>'))
  assert.equal(html.includes('Sales'), false)
  assert.equal(html.includes('The first two months'), false)
  assert.equal(html.includes('2,750'), false)
  assert.equal(html.includes('A-1007'), false)
  const block = /<script type="application\/json" id="kv-doc">([\s\S]*?)<\/script>/.exec(html)
  assert.deepEqual(JSON.parse(block[1]), env)
})

console.log('\nkybernos-db share page: ' + count + ' checks passed')
