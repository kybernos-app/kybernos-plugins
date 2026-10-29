// One template at a time, the host's pure half (business-scope.mjs): the stored choice (a small file, atomic, bounded), the templates read from what
// the registry hands the three Business points and the template's own field-of-work pack, which one is active and why, what the base asks at each
// question, and the body of /kybernos/business/scope.
//
// Hermetic: temp folders only, a fake registry, no DSH, no server.
//
//   node packages/kybernos-plugin/test-business-scope.mjs
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BUSINESS_POINTS, PACK_POINT, activate, activeFileFor, handleScope, liveScope, readActive, recentTemplates, registryReady, resolveActive, templatesOf, viewOf, writeActive } from './business-scope.mjs'

const root = mkdtempSync(join(tmpdir(), 'kb-scope-'))
let count = 0
let no = 0
const ok = async (label, fn) => { await fn(); count++; console.log('ok  ', label) }
const folder = () => join(root, 'case-' + (++no))

const SHOP = 'kybernos-themes/ecommerce'
const HOUSE = 'kybernos-themes/real-estate'
const JOBS = 'acme/recruitment'
const pack = (name, icon, accent, words) => ({ id: 'p', name, icon, accent, menu: { labels: words, hide: [] } })
/** A registry seam with the contributions of the three Business points and the packs, and the plugin list. */
const registry = (spec) => ({
  version: 1,
  contributions: (ref) => {
    if (typeof spec.boom === 'function') spec.boom(ref)
    return (spec.by[ref] || []).map((c) => ({ ...c }))
  },
  plugins: () => spec.plugins || [],
})
const both = registry({
  by: {
    [BUSINESS_POINTS.contacts]: [{ plugin: SHOP, value: {} }, { plugin: HOUSE, value: {} }],
    [BUSINESS_POINTS.catalog]: [{ plugin: SHOP, value: {} }, { plugin: HOUSE, value: {} }, { plugin: HOUSE, value: {} }],
    [BUSINESS_POINTS.pipeline]: [{ plugin: HOUSE, value: {} }],
    [PACK_POINT]: [
      { plugin: SHOP, value: pack({ en: 'E-commerce shop', fr: 'Boutique en ligne' }, 'bag', '#c25e0a', { contacts: { en: 'Customers', fr: 'Clients' }, catalog: { en: 'Products', fr: 'Produits' }, pipeline: { en: 'Orders', fr: 'Commandes' } }) },
      { plugin: HOUSE, value: pack({ en: 'Real estate agency', fr: 'Agence immobilière' }, 'house', '#b4532a', { catalog: { en: 'Properties', fr: 'Biens' }, dashboards: { en: 'My activity' } }) },
      { plugin: 'kybernos-themes/not-business', value: pack({ en: 'Elsewhere' }, 'cap', '#111111', {}) },
    ],
  },
})

try {
  // ── the stored choice ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  await ok('the file lives beside the base, is written whole (a temporary, then a rename), 0600, and reads back', () => {
    const dir = folder()
    const file = activeFileFor(join(dir, 'business', 'donnees.sqlite'))
    assert.equal(file, join(dir, 'business', 'active-template.json'))
    assert.equal(readActive(file), null, 'no file: none')
    const w = writeActive(file, SHOP, () => '2026-10-29T00:00:00.000Z')
    assert.deepEqual(w, { ok: true })
    assert.equal(readActive(file), SHOP)
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { v: 1, active: SHOP, at: '2026-10-29T00:00:00.000Z' })
    assert.equal(statSync(file).mode & 0o777, 0o600)
    assert.deepEqual(readdirSync(join(dir, 'business')), ['active-template.json'], 'no temporary file is left behind')
    assert.equal(writeActive(file, HOUSE).ok, true)
    assert.equal(readActive(file), HOUSE, 'the second write replaces the first')
    assert.equal(writeActive(file, null).ok, true)
    assert.equal(readActive(file), null, 'null is « none »')
  })

  await ok('a file that is corrupt, too large, from another version or not an id reads as none; a bad id or path is refused, never thrown', () => {
    const dir = folder()
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'a.json')
    for (const body of ['', 'not json', '[]', '{"v":2,"active":"x/y"}', '{"v":1,"active":42}', '{"v":1,"active":"../etc/passwd"}', '{"v":1,"active":"UPPER/case"}', JSON.stringify({ v: 1, active: SHOP, pad: 'x'.repeat(5000) })]) {
      writeFileSync(file, body)
      assert.equal(readActive(file), null, body.slice(0, 30))
    }
    assert.equal(readActive(join(dir, 'missing.json')), null)
    assert.equal(readActive(undefined), null)
    assert.deepEqual(writeActive(file, '../x'), { ok: false, error: 'id' })
    assert.deepEqual(writeActive(file, 7), { ok: false, error: 'id' })
    assert.deepEqual(writeActive('', SHOP), { ok: false, error: 'file' })
    assert.equal(writeActive(join(file, 'inside-a-file', 'x.json'), SHOP).ok, false, 'a folder that cannot be made is an answer')
  })

  await ok('the install order is read from the installer\'s record, the latest first, and a broken record is empty', () => {
    const dir = folder()
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'themes.json')
    writeFileSync(file, JSON.stringify({ v: 1, active: HOUSE, records: [{ id: HOUSE }, { id: SHOP }, { nope: 1 }] }))
    assert.deepEqual(recentTemplates(file), [SHOP, HOUSE])
    writeFileSync(file, JSON.stringify({ v: 1, active: JOBS, records: [{ id: SHOP }] }))
    assert.deepEqual(recentTemplates(file), [JOBS, SHOP], 'the recorded active theme counts even without a record')
    writeFileSync(file, '{')
    assert.deepEqual(recentTemplates(file), [])
    assert.deepEqual(recentTemplates(join(dir, 'none.json')), [])
  })

  // ── what is installed ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  await ok('the templates are the plugins that brought a contribution to one of the three points, with their own name, icon, accent and words', () => {
    const t = templatesOf(both)
    assert.deepEqual(t.map((x) => x.id), [SHOP, HOUSE], 'sorted by id, and a plugin that only has a pack is not a Business template')
    assert.deepEqual(t[0].name, { en: 'E-commerce shop', fr: 'Boutique en ligne' })
    assert.deepEqual([t[0].icon, t[0].accent], ['bag', '#c25e0a'])
    assert.deepEqual(t[0].words.catalog, { en: 'Products', fr: 'Produits' })
    assert.deepEqual(t[1].words, { catalog: { en: 'Properties', fr: 'Biens' } }, 'only the three rows; a template without a word for a row has none')
    JSON.stringify(t)
  })

  await ok('a template with no pack is named by its plugin, else by the last word of its id; garbage in a pack is ignored', () => {
    const r = registry({
      by: {
        [BUSINESS_POINTS.catalog]: [{ plugin: JOBS, value: {} }, { plugin: 'x/plain', value: {} }, { plugin: 'bad id', value: {} }, { plugin: 7, value: {} }, null],
        [PACK_POINT]: [{ plugin: 'x/plain', value: { name: { fr: 'no english' }, icon: '<script>', accent: 'red', menu: { labels: { catalog: { en: '<b>x</b>' } } } } }],
      },
      plugins: [{ id: JOBS, name: 'Recruitment firm' }],
    })
    const t = templatesOf(r)
    assert.deepEqual(t.map((x) => [x.id, x.name.en, x.icon, x.accent]), [[JOBS, 'Recruitment firm', null, null], ['x/plain', 'plain', null, null]])
    assert.deepEqual(t[1].words, {})
  })

  await ok('no registry, a registry that throws or one that answers garbage: no template, never an exception', () => {
    assert.deepEqual(templatesOf(null), [])
    assert.deepEqual(templatesOf(undefined), [])
    assert.deepEqual(templatesOf({ version: 1 }), [])
    assert.deepEqual(templatesOf(registry({ by: {}, boom: () => { throw new Error('boom') } })), [])
    assert.deepEqual(templatesOf({ contributions: () => 'nope' }), [])
  })

  // ── is the registry ready ─────────────────────────────────────────────────────────────────────────────────────────────────────
  await ok('the registry is ready once it has heard the three Business points; before that « nothing installed » and « not told yet » must not look alike', () => {
    const withPoints = (ids) => ({ version: 1, points: () => ids.map((id) => ({ id })), contributions: () => [], plugins: () => [] })
    const all = Object.values(BUSINESS_POINTS)
    assert.equal(registryReady(withPoints(all)), true)
    assert.equal(registryReady(withPoints(all.slice(0, 2))), false, 'one point not told yet')
    assert.equal(registryReady(withPoints([])), false)
    assert.equal(registryReady(withPoints([...all, 'kybernos/core#domain-pack'])), true)
    assert.equal(registryReady(null), false)
    assert.equal(registryReady(undefined), false)
    assert.equal(registryReady({ version: 1, contributions: () => [] }), true, 'a registry that cannot list its points is taken as ready')
    assert.equal(registryReady({ points: () => { throw new Error('boom') } }), false)
    assert.equal(registryReady({ points: () => [null, 7, 'x'] }), false)
  })

  await ok('while it is not ready the stored choice stands, the view says so, and an empty list is not read as « no template »', () => {
    const dir = folder()
    const file = join(dir, 'a.json')
    writeActive(file, HOUSE)
    const early = { version: 1, points: () => [{ id: BUSINESS_POINTS.catalog }], contributions: () => [], plugins: () => [] }
    const ports = { file: () => file, registry: () => early, recent: () => [] }
    assert.equal(liveScope(ports), HOUSE, 'the first seconds after DSH starts: the person\'s choice, not « none »')
    const v = viewOf(ports)
    assert.deepEqual([v.ok, v.ready, v.active, v.stored, v.templates], [true, false, HOUSE, HOUSE, []])
    const late = { ...both, points: () => Object.values(BUSINESS_POINTS).map((id) => ({ id })) }
    const ready = viewOf({ ...ports, registry: () => late })
    assert.deepEqual([ready.ready, ready.active, ready.templates.length], [true, HOUSE, 2])
    assert.equal(viewOf({ ...ports, registry: () => null }).ready, false)
  })

  // ── which one is active ───────────────────────────────────────────────────────────────────────────────────────────────────────
  await ok('the active template is the stored one while it is installed, else the one installed last, else the first by id, else none', () => {
    const both2 = [SHOP, HOUSE]
    assert.equal(resolveActive({ stored: HOUSE, templates: both2, recent: [SHOP] }), HOUSE)
    assert.equal(resolveActive({ stored: JOBS, templates: both2, recent: [JOBS, HOUSE, SHOP] }), HOUSE, 'the stored one left; the last installed that is still there')
    assert.equal(resolveActive({ stored: null, templates: both2, recent: [] }), SHOP, 'first by id')
    assert.equal(resolveActive({ stored: null, templates: [SHOP], recent: [HOUSE] }), SHOP, 'with one template that one is the active one')
    assert.equal(resolveActive({ stored: SHOP, templates: [], recent: [SHOP] }), null, 'none installed: none')
    assert.equal(resolveActive({ stored: SHOP, templates: [{ id: SHOP }] }), SHOP, 'a list of templates as the registry view gives them')
    assert.equal(resolveActive({}), null)
  })

  await ok('what the base asks: the stored choice when the registry is not there yet, none when the registry knows no template, the resolved one otherwise', () => {
    const dir = folder()
    const file = join(dir, 'a.json')
    const ports = (reg, recent = []) => ({ file: () => file, registry: () => reg, recent: () => recent })
    assert.equal(liveScope(ports(null)), null, 'nothing stored, no registry')
    writeActive(file, HOUSE)
    assert.equal(liveScope(ports(null)), HOUSE, 'the registry mounts after the first question: the stored choice stands')
    assert.equal(liveScope(ports(registry({ by: {} }))), null, 'the registry reads no template: the pages behave as they always did')
    assert.equal(liveScope(ports(both)), HOUSE)
    writeActive(file, 'acme/gone')
    assert.equal(liveScope(ports(both, [SHOP])), SHOP, 'the stored template was removed: the latest installed one that is still there')
    assert.equal(liveScope({ file: () => { throw new Error('boom') }, registry: () => null, recent: () => [] }), null, 'a port that throws is none')
    assert.equal(liveScope(undefined), null)
  })

  // ── switching ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  await ok('the view tells the active one, the stored one and the templates; a switch stores an installed template only', () => {
    const dir = folder()
    const file = join(dir, 'business', 'a.json')
    const ports = { file: () => file, registry: () => both, recent: () => [SHOP] }
    let v = viewOf(ports)
    assert.deepEqual([v.ok, v.active, v.stored, v.templates.length], [true, SHOP, null, 2])
    assert.deepEqual(activate(ports, HOUSE), { ok: true, active: HOUSE })
    v = viewOf(ports)
    assert.deepEqual([v.active, v.stored], [HOUSE, HOUSE])
    assert.deepEqual(activate(ports, 'acme/unknown'), { ok: false, error: 'unknown_template' })
    assert.deepEqual(activate(ports, 'not an id'), { ok: false, error: 'id' })
    assert.deepEqual(activate(ports, 7), { ok: false, error: 'id' })
    assert.equal(readActive(file), HOUSE, 'a refused switch changes nothing')
    const broken = { ...ports, file: () => join(file, 'x', 'y.json') }
    mkdirSync(join(dir, 'business'), { recursive: true })
    writeFileSync(file, 'a file where a folder is needed')
    assert.deepEqual(activate(broken, SHOP), { ok: false, error: 'write' })
  })

  await ok('an install may name a template the registry does not read yet (it waits for consent or a restart), if the plugin is installed and extends a Business point', () => {
    const dir = folder()
    const file = join(dir, 'a.json')
    const waiting = registry({ by: {}, plugins: [{ id: JOBS, status: 'needs-consent', extends: [{ point: BUSINESS_POINTS.catalog, contributions: 0 }] }, { id: 'x/skills-only', extends: [{ point: 'kybernos/skills#skill' }] }] })
    const ports = { file: () => file, registry: () => waiting, recent: () => [] }
    assert.deepEqual(activate(ports, JOBS, true), { ok: false, error: 'unknown_template' }, 'the selector wants a template that is listed')
    assert.deepEqual(activate(ports, JOBS, false), { ok: true, active: JOBS })
    assert.equal(readActive(file), JOBS)
    assert.deepEqual(activate(ports, 'x/skills-only', false), { ok: false, error: 'unknown_template' }, 'a plugin that touches none of the three points is ignored')
    assert.deepEqual(activate(ports, 'x/unknown', false), { ok: false, error: 'unknown_template' })
    assert.deepEqual(activate({ ...ports, registry: () => null }, JOBS, false), { ok: false, error: 'unknown_template' })
  })

  // ── the route body ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  await ok('the route: method first, then the strict origin, then the signed session, then the body; a read and a switch answer the same view', () => {
    const dir = folder()
    const file = join(dir, 'a.json')
    const base = { file: () => file, registry: () => both, recent: () => [SHOP], sameOrigin: () => true, session: () => true }
    const go = (method, body, over = {}) => handleScope({ method, body }, { ...base, ...over })
    assert.equal(go('DELETE').status, 405)
    assert.equal(go('PUT').status, 405)
    assert.equal(go('GET', undefined, { sameOrigin: () => false }).status, 403)
    assert.equal(go('POST', { action: 'set', id: HOUSE }, { sameOrigin: () => false }).status, 403)
    assert.deepEqual(go('GET', undefined, { session: () => ({ status: 401, error: 'sign-in required' }) }), { status: 401, body: { ok: false, error: 'sign-in required' } })
    assert.equal(go('POST', { action: 'set', id: HOUSE }, { session: () => ({ status: 503, error: 'no secret' }) }).status, 503)
    assert.equal(go('POST', { action: 'set', id: HOUSE }, { session: () => false }).status, 403, 'a session answer that is not true or a refusal object is a refusal')
    assert.equal(existsSync(file), false, 'nothing was written by a refused call')
    const read = go('GET')
    assert.equal(read.status, 200)
    assert.deepEqual([read.body.ok, read.body.active, read.body.templates.map((t) => t.id)], [true, SHOP, [SHOP, HOUSE]])
    assert.equal(go('POST', null).status, 400)
    assert.equal(go('POST', { action: 'nope' }).status, 400)
    assert.equal(go('POST', { action: 'set' }).status, 400)
    assert.equal(go('POST', { action: 'set', id: 'acme/unknown' }).status, 404)
    const done = go('POST', { action: 'set', id: HOUSE })
    assert.equal(done.status, 200)
    assert.deepEqual([done.body.active, done.body.stored], [HOUSE, HOUSE])
    assert.equal(go('GET').body.active, HOUSE, 'the next read says the same')
    assert.equal(handleScope(undefined, undefined).status, 405, 'garbage in is a refusal, not a throw')
    assert.equal(handleScope({ method: 'GET' }, { ...base, session: () => { throw new Error('boom') } }).status, 500)
  })

  await ok('the module imports nothing but node:fs and node:path, and holds no personal path', () => {
    const src = readFileSync(new URL('./business-scope.mjs', import.meta.url), 'utf8')
    const imports = [...src.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1])
    assert.deepEqual(imports.sort(), ['node:fs', 'node:path'])
    assert.doesNotMatch(src, /\/Users\//)
  })
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log('\n' + count + ' checks passed')
