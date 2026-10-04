#!/usr/bin/env node
/** Client harness for kybernos-models, parked ("disabled") providers: the pure
 *  decisions are evaluated for real; the wiring is checked on the source. The
 *  rendered page is checked on the real GUI (see docs/dev/live-testing.md). */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')

let pass = 0
let fail = 0
const ok = (name, cond, detail) => {
  if (cond === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail !== undefined ? ' → ' + String(detail).slice(0, 160) : '')) }
}

// ── the pure block, evaluated ────────────────────────────────────────────────
const begin = src.indexOf('// KB-PARK-PURE-BEGIN')
const end = src.indexOf('// KB-PARK-PURE-END')
ok('the pure block is delimited', begin > 0 && end > begin)
const { kbMParkable, kbMParkBlock, kbMParkedShown } = new Function(src.slice(begin, end) + '\nreturn { kbMParkable, kbMParkBlock, kbMParkedShown }')()

console.log('\n── which providers can be disabled ──')
ok('a provider in the user layer only can be parked', kbMParkable('acme', { acme: { api: 'x' } }, {}) === true)
ok('a provider the base layer also declares cannot (an unset would reveal the base copy)', kbMParkable('acme', { acme: {} }, { acme: {} }) === false)
ok('a provider only in the base layer cannot', kbMParkable('acme', {}, { acme: {} }) === false)
ok('an unknown route cannot', kbMParkable('ghost', { acme: {} }, {}) === false)
ok('a null or missing layer cannot throw', kbMParkable('a', null, undefined) === false)
ok('a non-object profile cannot be parked', kbMParkable('a', { a: 'oops' }, {}) === false && kbMParkable('a', { a: [] }, {}) === false && kbMParkable('a', { a: null }, {}) === false)
ok('a prototype key is not a provider', kbMParkable('toString', {}, {}) === false && kbMParkable('__proto__', {}, {}) === false)
ok('the Kybernos Cloud route is locked: kybernos-cloud rewrites it on every sync', kbMParkable('kybernos', { kybernos: { api: 'x' } }, {}) === false && kbMParkBlock('kybernos', { kybernos: {} }, {}) === 'managed')
ok('the reason is told: profile-owned vs managed vs free', kbMParkBlock('acme', {}, { acme: {} }) === 'profile' && kbMParkBlock('acme', { acme: {} }, {}) === null)
ok('an empty profile object (a catalog route with only a key) can be parked', kbMParkable('openai', { openai: {} }, {}) === true)

console.log('\n── which parked entries are shown ──')
const parked = [{ slug: 'a', models: [] }, { slug: 'b', models: ['m'] }, null, { slug: 3 }, 'x']
ok('every well-formed entry whose slug is not active', kbMParkedShown(parked, ['z']).map((p) => p.slug).join() === 'a,b')
ok('a stale copy of an ACTIVE provider is hidden, not deleted', kbMParkedShown(parked, ['a']).map((p) => p.slug).join() === 'b')
ok('a non-array answer reads as nothing', kbMParkedShown(null, []).length === 0 && kbMParkedShown({}, []).length === 0)

console.log('\n── the actions, run against the REAL host routes and a fake settings service ──')
{
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'kbm-client-'))
  const { kbPkMount, kbPkRead } = await import('./index.js')
  const aBegin = src.indexOf('// KB-PARK-ACTIONS-BEGIN')
  const aEnd = src.indexOf('// KB-PARK-ACTIONS-END')
  ok('the actions block is delimited', aBegin > 0 && aEnd > aBegin)
  const body = src.slice(begin, end) + '\n' + src.slice(aBegin, aEnd) + '\nreturn { kbMDisable, kbMEnable, kbMMutateRetry, kbMParkCall }'

  /** A fresh world: a host store file, a fake settings service, the client's globals. */
  const world = (opts = {}) => {
    const file = join(process.env.DSH_HOME, 'w' + Math.random().toString(36).slice(2) + '.json')
    const routes = {}
    kbPkMount((r) => { routes[r.path] = r.handler }, file)
    const log = []
    const settings = { providers: { acme: { api: 'openai-completions', baseURL: 'https://a.example', apiKeyEnv: 'ACME_KEY' }, other: { api: 'x' } }, revision: 1 }
    const KBM = { writable: opts.writable !== false, revision: 1, routes: Object.keys(settings.providers), models: [{ route: 'acme', id: 'a-1' }, { route: 'acme', id: 'a-2' }, { route: 'other', id: 'o-1' }],
      userProviders: settings.providers, baseProviders: opts.base || {}, parked: [], parkHost: true }
    const mutateScript = opts.mutate || []
    const api = { settings: { mutate: async (ns, ops, rev) => {
      log.push(['mutate', ops[0].op, ops[0].path.join('.'), rev])
      const scripted = mutateScript.shift()
      if (scripted !== undefined && scripted !== null) return scripted
      if (rev !== settings.revision) return { ok: false, error: { code: 'settings/conflict', message: 'stale' } }
      for (const op of ops) {
        if (op.op === 'unset') delete settings.providers[op.path[1]]
        else if (op.op === 'set') settings.providers[op.path[1]] = op.value
      }
      settings.revision += 1
      return { ok: true, value: { revision: settings.revision } }
    } } }
    const fakeFetch = async (url, init) => {
      const path = String(url).split('?')[0]
      const handler = routes[path]
      if (handler === undefined) return { status: 404, json: async () => { throw new Error('not json') } }
      const text = init && init.body ? init.body : ''
      const req = { method: (init && init.method) || 'GET', url: path, socket: { localPort: 3080 }, headers: { origin: 'http://127.0.0.1:3080' },
        on (ev, cb) { if (ev === 'data' && text !== '') cb(text); if (ev === 'end') cb() } }
      const r = { status: 0, body: null, writeHead (st) { r.status = st }, end (t) { r.body = t } }
      await handler(req, r)
      log.push(['host', path.split('/').pop(), r.status])
      return { status: r.status, json: async () => JSON.parse(r.body) }
    }
    const kbMLoad = async () => { log.push(['load']); KBM.revision = settings.revision; KBM.routes = Object.keys(settings.providers); KBM.userProviders = settings.providers }
    const fns = new Function('m', 'kbMApi', 'KBM', 'KB_NS', 'kbMLoad', 'kbMJournal', 'kbMTimeout', 'fetch', body)(
      (k) => k, () => api, KBM, 'llm-pi-ai', kbMLoad, async () => {}, (p) => p, fakeFetch)
    return { fns, KBM, settings, file, log }
  }
  const rejects = async (fn) => { try { await fn(); return null } catch (e) { return String(e && e.message ? e.message : e) } }
  const steps = (w) => w.log.map((l) => l.slice(0, 2).join(':')).join(' > ')

  let w = world()
  await w.fns.kbMDisable('acme')
  ok('disable: parks on the host first, then unsets the route, then reloads', steps(w) === 'host:park > mutate:unset > load > host:parked' || steps(w) === 'host:park > mutate:unset > load', steps(w))
  ok('disable: the route is gone from the settings, the profile is on the host', w.settings.providers.acme === undefined && kbPkRead(w.file).providers.acme !== undefined)
  ok('disable: the host keeps the exact profile and the model ids', kbPkRead(w.file).providers.acme.profile.apiKeyEnv === 'ACME_KEY' && kbPkRead(w.file).providers.acme.models.join() === 'a-1,a-2')
  ok('disable: the other provider is untouched', w.settings.providers.other !== undefined)

  await w.fns.kbMEnable('acme')
  ok('enable: takes the profile, writes it back, THEN forgets the copy', steps(w).endsWith('host:take > mutate:set > host:forget > load'), steps(w))
  ok('enable: the provider is back with the identical profile and nothing stays parked', w.settings.providers.acme.apiKeyEnv === 'ACME_KEY' && w.settings.providers.acme.baseURL === 'https://a.example' && Object.keys(kbPkRead(w.file).providers).length === 0)

  w = world({ mutate: [{ ok: false, error: { code: 'settings/invalid', message: 'refused by schema' } }] })
  let err = await rejects(() => w.fns.kbMDisable('acme'))
  ok('disable: a refused settings write rolls back the host copy and says why', /refused by schema/.test(err) && Object.keys(kbPkRead(w.file).providers).length === 0 && w.settings.providers.acme !== undefined, err)

  const w2 = world()
  const brokenHost = new Function('m', 'kbMApi', 'KBM', 'KB_NS', 'kbMLoad', 'kbMJournal', 'kbMTimeout', 'fetch', body)(
    (k) => k, () => ({ settings: { mutate: async () => { w2.log.push(['mutate']); return { ok: true, value: { revision: 2 } } } } }), w2.KBM, 'llm-pi-ai', async () => {}, async () => {}, (p) => p, async () => ({ status: 404, json: async () => { throw new Error('html') } }))
  err = await rejects(() => brokenHost.kbMDisable('acme'))
  ok('disable: when the host cannot save the copy, the settings are NOT touched', err !== null && w2.log.every((l) => l[0] !== 'mutate'), err)

  w = world()
  await w.fns.kbMParkCall('park', { slug: 'acme', profile: { stale: true }, models: [] })
  await w.fns.kbMDisable('acme')
  ok('disable: a stale copy left by an interrupted run is replaced by the live profile', kbPkRead(w.file).providers.acme.profile.apiKeyEnv === 'ACME_KEY' && w.settings.providers.acme === undefined)

  w = world({ base: { acme: { api: 'x' } } })
  err = await rejects(() => w.fns.kbMDisable('acme'))
  ok('disable: a provider the base layer declares is refused before anything is written', err === 'kb.prov.off.locked' && w.log.length === 0, err + ' ' + steps(w))

  w = world()
  w.KBM.userProviders.kybernos = { api: 'x' }
  err = await rejects(() => w.fns.kbMDisable('kybernos'))
  ok('disable: the Kybernos Cloud route is refused (managed) before anything is written', err === 'kb.prov.off.managed' && w.log.length === 0, err + ' ' + steps(w))

  w = world({ writable: false })
  err = await rejects(() => w.fns.kbMDisable('acme'))
  ok('disable: a read-only settings store is refused before anything is written', err === 'kb.models.error.readonly' && w.log.length === 0, err)

  w = world()
  await w.fns.kbMDisable('acme')
  w.log.length = 0
  w.settings.providers.acme = { api: 'newer' }
  w.KBM.routes = Object.keys(w.settings.providers)
  await w.fns.kbMEnable('acme')
  ok('enable: a stale copy of an already active provider only forgets the copy (never overwrites the live profile)', steps(w).indexOf('mutate') < 0 && w.settings.providers.acme.api === 'newer' && Object.keys(kbPkRead(w.file).providers).length === 0, steps(w))

  // enable refused by the settings: the copy must stay parked
  const wr = world({ mutate: [null, { ok: false, error: { code: 'settings/invalid', message: 'schema moved' } }] })
  await wr.fns.kbMDisable('acme')
  err = await rejects(() => wr.fns.kbMEnable('acme'))
  ok('enable: a refused settings write keeps the profile parked, nothing is lost', /schema moved/.test(err) && kbPkRead(wr.file).providers.acme !== undefined, err)

  w = world()
  err = await rejects(() => w.fns.kbMEnable('ghost'))
  ok('enable: an unknown slug fails on the host and writes nothing', err === 'not-parked' && steps(w).indexOf('mutate') < 0, err + ' ' + steps(w))

  const wc = world({ mutate: [{ ok: false, error: { code: 'settings/conflict', message: 'stale' } }] })
  await wc.fns.kbMDisable('acme')
  ok('a revision conflict reloads once and the retry succeeds', steps(wc).indexOf('mutate:unset > load > mutate:unset') >= 0 && wc.settings.providers.acme === undefined, steps(wc))

  const wd = world({ mutate: [{ ok: false, error: { code: 'settings/conflict', message: 'stale' } }, { ok: false, error: { code: 'settings/conflict', message: 'stale again' } }] })
  err = await rejects(() => wd.fns.kbMDisable('acme'))
  ok('a second conflict gives up (no loop) and rolls back the host copy', /stale again/.test(err) && Object.keys(kbPkRead(wd.file).providers).length === 0, err)
}

console.log('\n── provider writes: pure rules ──')
{
  const bl = (name) => { const i = src.indexOf('// ' + name + '-BEGIN'); const j = src.indexOf('// ' + name + '-END'); return src.slice(i, j) }
  const pv = new Function(bl('KB-PV-PURE') + '\nreturn { kbPvKeyRef, kbPvUrlOk, kbPvRows, kbPvMergeModels, kbPvDiffOps, kbPvEditProfile, kbPvNewProfile, kbPvAddBlock }')()
  ok('the key reference is <ROUTE>_API_KEY, like the native page', pv.kbPvKeyRef('zai-coding-cn') === 'ZAI_CODING_CN_API_KEY' && pv.kbPvKeyRef('groq') === 'GROQ_API_KEY')
  ok('http(s) URLs pass, templates and junk do not', pv.kbPvUrlOk('https://a.example/v1') === true && pv.kbPvUrlOk('http://127.0.0.1:11434/v1') === true && pv.kbPvUrlOk('https://x.${ACCOUNT}.example') === false && pv.kbPvUrlOk('ftp://x') === false && pv.kbPvUrlOk('') === false && pv.kbPvUrlOk('https://a b') === false)
  ok('model rows: blanks dropped, first duplicate kept, ids trimmed', JSON.stringify(pv.kbPvRows([{ id: ' a ', name: 'A' }, { id: '', name: 'x' }, { id: 'a', name: 'dup' }, { id: 'b' }])) === JSON.stringify([{ id: 'a', name: 'A' }, { id: 'b', name: '' }]))
  const existing = [{ id: 'm1', name: 'Old', contextWindow: 8000, maxTokens: 2000, input: ['text', 'image'] }, { id: 'm2' }]
  const merged = pv.kbPvMergeModels(existing, [{ id: 'm1', name: 'New' }, { id: 'm3', name: '' }])
  ok('editing a model keeps its other fields (context, max tokens, input)', merged[0].contextWindow === 8000 && merged[0].maxTokens === 2000 && merged[0].input.join() === 'text,image' && merged[0].name === 'New')
  ok('a cleared name removes the field, a new model starts bare, a dropped one is gone', merged.length === 2 && merged[1].id === 'm3' && !('name' in merged[1]))
  const ops = pv.kbPvDiffOps(['providers', 'a'], { baseURL: 'x', displayName: 'N', api: 'p' }, { baseURL: 'y', api: 'p' })
  ok('the diff writes what changed and unsets what went away, nothing else', ops.length === 2 && ops[0].op === 'set' && ops[0].path.join('.') === 'providers.a.baseURL' && ops[1].op === 'unset' && ops[1].path.join('.') === 'providers.a.displayName')
  ok('no change, no ops', pv.kbPvDiffOps(['p'], { a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } }).length === 0)
  const before = { api: 'openai-completions', baseURL: 'https://old/v1', displayName: 'Old', models: [{ id: 'm1' }], headers: { x: '1' }, retryPolicy: { attempts: 2 } }
  const ec = pv.kbPvEditProfile('acme', before, { url: 'https://new/v1/', name: 'New', proto: 'openai-responses', key: '', models: [{ id: 'm1', name: 'One' }] }, true)
  ok('custom edit: URL (trailing slash trimmed), name, protocol, models; headers and retryPolicy untouched', ec.baseURL === 'https://new/v1' && ec.displayName === 'New' && ec.api === 'openai-responses' && ec.models[0].name === 'One' && ec.headers.x === '1' && ec.retryPolicy.attempts === 2)
  const ek = pv.kbPvEditProfile('groq', { baseURL: 'https://g/v1', displayName: 'Groq', api: 'openai-completions' }, { url: 'https://g/v1', name: 'HACK', proto: 'anthropic-messages', key: '', models: undefined }, false)
  ok('a catalog route cannot get its display name or protocol rewritten', ek.displayName === 'Groq' && ek.api === 'openai-completions')
  ok('a typed key records apiKeyEnv when the profile has none, and keeps an existing one', pv.kbPvEditProfile('acme', {}, { url: '', key: 'sk-1' }, false).apiKeyEnv === 'ACME_API_KEY' && pv.kbPvEditProfile('acme', { apiKeyEnv: 'MY_KEY' }, { url: '', key: 'sk-1' }, false).apiKeyEnv === 'MY_KEY')
  ok('an empty URL removes baseURL (the provider default)', !('baseURL' in pv.kbPvEditProfile('acme', { baseURL: 'x' }, { url: '', key: '' }, false)))
  const np = pv.kbPvNewProfile({ tab: 'custom', id: 'Acme', name: 'Acme GW', url: 'https://gw.example/v1/', proto: 'anthropic-messages', key: 'sk', env: '', models: [{ id: 'a', name: 'A' }] })
  ok('a new profile: protocol, trimmed URL, derived key reference, models, no secret in it', np.api === 'anthropic-messages' && np.baseURL === 'https://gw.example/v1' && np.apiKeyEnv === 'ACME_API_KEY' && np.models.length === 1 && JSON.stringify(np).indexOf('"sk"') < 0)
  ok('a new profile never carries the retryPolicy shape DSH 0.2.0-rc.2 rejects, nor an empty modelOverrides', !('retryPolicy' in np) && !('modelOverrides' in np))
  ok('a catalog route with no models declared writes no empty models list', !('models' in pv.kbPvNewProfile({ tab: 'catalog', prov: 'x', id: 'x', url: 'https://x/v1', key: '', models: [] })))
  ok('a new profile with no key records no reference (provider-native authentication)', !('apiKeyEnv' in pv.kbPvNewProfile({ tab: 'custom', id: 'a', url: 'https://a/v1', key: '', models: [{ id: 'x' }] })))
  const blk = (d, taken) => pv.kbPvAddBlock(d, taken || [])
  ok('add rules: pick first, then slug, taken, models (custom), URL, template', blk({ tab: 'catalog', prov: '', id: 'a', url: 'https://a' }) === 'pick' && blk({ tab: 'custom', id: 'Bad Slug', url: 'https://a', models: [{ id: 'm' }] }) === 'slug' && blk({ tab: 'custom', id: 'a', url: 'https://a', models: [{ id: 'm' }] }, ['a']) === 'taken' && blk({ tab: 'custom', id: 'a', url: 'https://a', models: [] }) === 'models' && blk({ tab: 'custom', id: 'a', url: 'nope', models: [{ id: 'm' }] }) === 'url' && blk({ tab: 'catalog', prov: 'x', id: 'a', url: 'https://x.${ID}.example' }) === 'template' && blk({ tab: 'catalog', prov: 'x', id: 'a', url: 'https://ok/v1' }) === null)
}

console.log('\n── provider writes: the actions, against a fake settings and credential store ──')
{
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'kbm-pv-'))
  const { kbPkMount, kbPkRead } = await import('./index.js')
  const bl = (name) => { const i = src.indexOf('// ' + name + '-BEGIN'); const j = src.indexOf('// ' + name + '-END'); return src.slice(i, j) }
  const body = bl('KB-PARK-PURE') + '\n' + bl('KB-PARK-ACTIONS') + '\n' + bl('KB-PV-PURE') + '\n' + bl('KB-PV-ACTIONS') + '\nreturn { kbPvCreate, kbPvSave, kbPvDelete, kbMDisable }'
  const world = (o = {}) => {
    const file = join(process.env.DSH_HOME, 'pv' + Math.random().toString(36).slice(2) + '.json')
    const routes = {}
    kbPkMount((r) => { routes[r.path] = r.handler }, file)
    const log = []
    const settings = { providers: { acme: { api: 'openai-completions', baseURL: 'https://a.example/v1', displayName: 'Acme', apiKeyEnv: 'ACME_API_KEY', models: [{ id: 'a-1', contextWindow: 9000 }] }, groq: { baseURL: 'https://g/v1' } }, revision: 1 }
    const creds = { ACME_API_KEY: 'old' }
    const KBM = { writable: o.writable !== false, revision: 1, routes: Object.keys(settings.providers), models: [], userProviders: settings.providers, baseProviders: o.base || {}, parked: o.parked || [], parkHost: true }
    const failCred = o.failCred
    const api = {
      settings: { mutate: async (ns, ops, rev) => {
        log.push(['settings', ops.map((x) => x.op + ':' + x.path.join('.')).join(',')])
        if (o.refuse) return { ok: false, error: { code: 'settings/invalid', message: 'refused' } }
        for (const op of ops) {
          if (op.op === 'set') { let t = settings; const p = op.path; for (let i = 0; i < p.length - 1; i++) t = t[p[i]]; t[p[p.length - 1]] = op.value }
          else { let t = settings; const p = op.path; for (let i = 0; i < p.length - 1; i++) t = t[p[i]]; delete t[p[p.length - 1]] }
        }
        settings.revision += 1
        return { ok: true, value: { revision: settings.revision } }
      } },
      credentials: {
        set: async (ref, value) => { log.push(['cred.set', ref]); if (failCred === 'set') return { ok: false, error: { message: 'vault' } }; creds[ref] = value; return { ok: true } },
        unset: async (ref) => { log.push(['cred.unset', ref]); if (failCred === 'unset') return { ok: false, error: { message: 'vault locked' } }; delete creds[ref]; return { ok: true } },
      },
    }
    const fakeFetch = async (url, init) => {
      const handler = routes[String(url).split('?')[0]]
      if (handler === undefined) return { status: 404, json: async () => { throw new Error('x') } }
      const text = init && init.body ? init.body : ''
      const req = { method: (init && init.method) || 'GET', url, socket: { localPort: 3080 }, headers: { origin: 'http://127.0.0.1:3080' }, on (ev, cb) { if (ev === 'data' && text !== '') cb(text); if (ev === 'end') cb() } }
      const r = { status: 0, body: null, writeHead (st) { r.status = st }, end (t) { r.body = t } }
      await handler(req, r)
      return { status: r.status, json: async () => JSON.parse(r.body) }
    }
    const kbMLoad = async () => { log.push(['load']); KBM.revision = settings.revision; KBM.routes = Object.keys(settings.providers); KBM.userProviders = settings.providers }
    const kbMOBJ = (v) => (v === null || v === undefined || typeof v !== 'object' || Array.isArray(v)) ? {} : v
    const fns = new Function('m', 'kbMApi', 'KBM', 'KB_NS', 'kbMLoad', 'kbMJournal', 'kbMTimeout', 'fetch', 'kbMOBJ', body)(
      (k) => k, () => api, KBM, 'llm-pi-ai', kbMLoad, async () => {}, (p) => p, fakeFetch, kbMOBJ)
    return { fns, KBM, settings, creds, log, file }
  }
  const rejects = async (fn) => { try { await fn(); return null } catch (e) { return String(e && e.message ? e.message : e) } }
  const steps = (w) => w.log.map((l) => l.join(':')).join(' > ')

  let w = world()
  let r = await w.fns.kbPvCreate({ tab: 'custom', id: 'gw', name: 'Gateway', url: 'https://gw/v1', proto: 'anthropic-messages', key: 'sk-9', env: '', models: [{ id: 'm1', name: 'M1' }] })
  ok('create: the route is written, THEN the key, then the list reloads', /settings:set:providers\.gw > cred\.set:GW_API_KEY > load/.test(steps(w)), steps(w))
  ok('create: the profile holds the reference, the vault holds the key, settings never see it', w.settings.providers.gw.apiKeyEnv === 'GW_API_KEY' && w.creds.GW_API_KEY === 'sk-9' && JSON.stringify(w.settings).indexOf('sk-9') < 0 && r.keyOk === true)
  w = world({ failCred: 'set' })
  r = await w.fns.kbPvCreate({ tab: 'custom', id: 'gw', url: 'https://gw/v1', key: 'sk', models: [{ id: 'm' }] })
  ok('create: a failed key save keeps the route and says so (keyOk=false)', w.settings.providers.gw !== undefined && r.keyOk === false)
  w = world()
  let err = await rejects(() => w.fns.kbPvCreate({ tab: 'custom', id: 'acme', url: 'https://x/v1', models: [{ id: 'm' }] }))
  ok('create: an existing slug is refused before anything is written', err === 'kb.pv.err.taken' && w.log.length === 0, err)
  w = world({ parked: [{ slug: 'old', models: [] }] })
  err = await rejects(() => w.fns.kbPvCreate({ tab: 'custom', id: 'old', url: 'https://x/v1', models: [{ id: 'm' }] }))
  ok('create: a slug held by a disabled provider is refused too', err === 'kb.pv.err.taken', err)
  w = world({ refuse: true })
  err = await rejects(() => w.fns.kbPvCreate({ tab: 'custom', id: 'gw', url: 'https://gw/v1', key: 'sk', models: [{ id: 'm' }] }))
  ok('create: a refused settings write stores no key', /refused/.test(err) && w.log.every((l) => l[0] !== 'cred.set'), err + ' ' + steps(w))
  w = world({ writable: false })
  err = await rejects(() => w.fns.kbPvCreate({ tab: 'custom', id: 'gw', url: 'https://gw/v1', models: [{ id: 'm' }] }))
  ok('create: read-only settings are refused before anything is written', err === 'kb.models.error.readonly' && w.log.length === 0, err)

  w = world()
  r = await w.fns.kbPvSave('acme', { custom: true, url: 'https://a.example/v1', name: 'Acme', proto: 'openai-completions', key: '', models: [{ id: 'a-1', name: '' }] })
  ok('save: nothing changed, nothing written', r.changed === 0 && w.log.every((l) => l[0] === 'load'), steps(w))
  w = world()
  r = await w.fns.kbPvSave('acme', { custom: true, url: 'https://a.example/v2', name: 'Acme', proto: 'openai-completions', key: '', models: [{ id: 'a-1', name: 'One' }] })
  ok('save: only the changed keys are written, and the model keeps its context window', r.changed === 2 && w.settings.providers.acme.baseURL === 'https://a.example/v2' && w.settings.providers.acme.models[0].contextWindow === 9000 && w.settings.providers.acme.models[0].name === 'One', steps(w))
  w = world()
  r = await w.fns.kbPvSave('acme', { custom: true, url: 'https://a.example/v1', name: 'Acme', proto: 'openai-completions', key: 'sk-new', models: undefined })
  ok('save: a typed key replaces the stored one under the existing reference, no settings write', w.creds.ACME_API_KEY === 'sk-new' && r.changed === 0 && r.keyOk === true && steps(w).indexOf('settings') < 0, steps(w))
  w = world()
  r = await w.fns.kbPvSave('groq', { custom: false, url: 'https://g/v1', key: 'gk', models: undefined })
  ok('save: a route with no reference gets one recorded (apiKeyEnv) and the key stored', w.settings.providers.groq.apiKeyEnv === 'GROQ_API_KEY' && w.creds.GROQ_API_KEY === 'gk')
  w = world()
  err = await rejects(() => w.fns.kbPvSave('acme', { custom: true, url: 'not a url', key: '' }))
  ok('save: a bad URL is refused before anything is written', err === 'kb.pv.err.url' && w.log.length === 0, err)

  w = world()
  await w.fns.kbPvDelete('acme')
  ok('delete: the credential goes FIRST, then the route, then the list reloads', /cred\.unset:ACME_API_KEY > settings:unset:providers\.acme > load/.test(steps(w)) && w.settings.providers.acme === undefined && w.creds.ACME_API_KEY === undefined, steps(w))
  w = world({ failCred: 'unset' })
  err = await rejects(() => w.fns.kbPvDelete('acme'))
  ok('delete: when the credential cannot be removed the route stays (nothing half-deleted)', /vault locked/.test(err) && w.settings.providers.acme !== undefined && w.log.every((l) => l[0] !== 'settings'), err + ' ' + steps(w))
  w = world()
  await w.fns.kbPvDelete('groq')
  ok('delete: a route with no reference needs no credential call', steps(w).indexOf('cred.') < 0 && w.settings.providers.groq === undefined)
  w = world()
  w.KBM.userProviders.kybernos = { baseURL: 'x' }
  err = await rejects(() => w.fns.kbPvDelete('kybernos'))
  ok('delete: the Kybernos Cloud route is refused (managed)', err === 'kb.prov.off.managed' && w.log.length === 0, err)
  w = world({ base: { acme: {} } })
  err = await rejects(() => w.fns.kbPvDelete('acme'))
  ok('delete: a route the base layer also declares is refused', err === 'kb.prov.off.locked' && w.log.length === 0, err)
  w = world()
  await w.fns.kbMDisable('acme')
  await w.fns.kbMDisable('groq')
  w.KBM.parked = [{ slug: 'acme' }]
  w.settings.providers.acme = { api: 'x', baseURL: 'https://a' }
  w.KBM.routes = Object.keys(w.settings.providers); w.KBM.userProviders = w.settings.providers
  await w.fns.kbPvDelete('acme')
  ok('delete: a stale parked copy of the same slug is forgotten too', kbPkRead(w.file).providers.acme === undefined)
}

console.log('\n── the models table: fixed capability slots ──')
{
  const bl = (name) => { const i = src.indexOf('// ' + name + '-BEGIN'); const j = src.indexOf('// ' + name + '-END'); return src.slice(i, j) }
  const { KB_MATRIX, kbMxSlots } = new Function(bl('KB-MX-PURE') + '\nreturn { KB_MATRIX, kbMxSlots }')()
  ok('nine slots, always in the same order', KB_MATRIX.join() === 'textIn,vision,audioIn,video,imageGen,search,tools,s2s,reasoning')
  const a1 = kbMxSlots(['textIn', 'textOut', 'vision', 'reasoning'])
  ok('the lit slots follow the matrix order, not the order the model lists them in', a1.slots.join() === 'true,true,false,false,false,false,false,false,true' && kbMxSlots(['reasoning', 'vision', 'textIn']).slots.join() === a1.slots.join())
  ok('text OUT is the baseline: it never counts as an extra', a1.extras.length === 0)
  const a2 = kbMxSlots(['textIn', 'tts', 'structured', 'temperature', 'videoGen', 'textOut'])
  ok('capabilities without a slot are counted, so nothing a model has is hidden', a2.extras.join() === 'tts,structured,temperature,videoGen')
  ok('a model with nothing lights nothing and never throws', kbMxSlots([]).slots.every((x) => x === false) && kbMxSlots(null).extras.length === 0 && kbMxSlots(undefined).slots.length === 9)
}

console.log('\n── DSH’s native page: which menu cell to hide ──')
{
  const bl = (name) => { const i = src.indexOf('// ' + name + '-BEGIN'); const j = src.indexOf('// ' + name + '-END'); return src.slice(i, j) }
  const { kbNatPick, kbNatHidden } = new Function(bl('KB-NATIVE-PURE') + '\nreturn { kbNatPick, kbNatHidden }')()
  ok('the default is visible until this page does everything the native one does', /const KB_NAT_DEFAULT_HIDDEN = false/.test(src))
  const nav = ['Theme', 'AI Provider & Models', 'Models', 'Ollama Local Models', 'Voice']
  ok('the native cell is found beside ours', JSON.stringify(kbNatPick([nav], 'Models', 'AI Provider & Models')) === JSON.stringify([{ group: 0, index: 2 }]))
  ok('only the exact label matches, never "Ollama Local Models"', kbNatPick([nav], 'Models', 'AI Provider & Models').length === 1)
  ok('a list that does not hold our cell is never touched', kbNatPick([['Models', 'Chat', 'Files', 'More']], 'Models', 'AI Provider & Models').length === 0)
  ok('a list too short to be a menu is ignored', kbNatPick([['Models', 'AI Provider & Models']], 'Models', 'AI Provider & Models').length === 0)
  ok('with no native label (locale did not answer) nothing is hidden', kbNatPick([nav], null, 'AI Provider & Models').length === 0 && kbNatPick([nav], '', 'AI Provider & Models').length === 0)
  ok('never hides our own cell if the labels collide', kbNatPick([nav], 'AI Provider & Models', 'AI Provider & Models').length === 0)
  ok('the translated label is matched as is', kbNatPick([['Thème', 'Fournisseur IA & modèles', 'Modèles', 'Voix']], 'Modèles', 'Fournisseur IA & modèles').length === 1)
  ok('the stored choice wins, otherwise the default', kbNatHidden('1', false) === true && kbNatHidden('0', true) === false && kbNatHidden(null, false) === false && kbNatHidden(null, true) === true && kbNatHidden('junk', false) === false)
}

console.log('\n── wiring (source) ──')
const has = (needle) => src.indexOf(needle) !== -1
ok('disable parks FIRST, then drops the route (never the other way round)', src.indexOf("kbMParkCall('park', body)") < src.indexOf("op: 'unset', path: ['providers', route]"))
ok('enable writes the profile back FIRST, then forgets the copy', src.indexOf("op: 'set', path: ['providers', slug], value: taken.profile") < src.indexOf("await kbMParkCall('forget', { slug })\n        await kbMLoad()"))
ok('a failed settings write forgets the parked copy', has("await kbMParkCall('forget', { slug: route }) } catch"))
ok('the revision conflict is retried once after a reload', has("'settings/conflict'") && has('essai === 1'))
ok('while the host half has not restarted the switch stays visible, disabled, with the reason', has('const hostOff = KBM.parkHost !== true') && has("m('kb.pv.hostnote')") && has('locked: ro || hostOff'))
ok('the add form refuses a slug that is parked (the check counts the disabled providers)', has('const taken = routes.concat(parkedShown.map((p) => p.slug))') && has('kbPvAddBlock(dr, taken)'))
ok('the confirmation dialog exists, with cancel and confirm', has("'data-kbm': 'prov-off-dialog'") && has("'data-kbm': 'prov-off-cancel'") && has("'data-kbm': 'prov-off-ok'"))
ok('the switch and the disabled card are addressable', has("'prov-switch'") && has("'prov-card-off'") && has("'prov-off-badge'"))
ok('the switch is a real switch for assistive tech', has("role: 'switch'") && has("'aria-checked': on ? 'true' : 'false'"))
ok('the host calls go through the same-origin route, never a hard-coded host', has("'/kybernos-models/providers/' + path") && !/fetch\(\s*['"]https?:/.test(src))
ok('no colour hard-coded in the new styles', !/kbmp-(sw|off)[^']*#[0-9a-fA-F]{3,6}\b/.test(src))

ok('the panels are plain render calls: an inline component type would remount on every keystroke and drop focus', !/h\((Card|EditPanel|AddPanel|Dialogs|Switch|Combo), /.test(src))
ok('a component that owns hooks is never called conditionally (React error #300 on the tab switch)', !/\? KybernosHero\(\)/.test(src))
ok('edit, add and delete are reachable from the card (hover actions) and from the menu', has("'data-kbm': 'prov-edit'") && has("'data-kbm': 'prov-more'") && has("'data-kbm': 'prov-delete'") && has("'data-kbm': 'prov-add-model'"))
ok('the delete dialog asks for the provider id before it enables the button', has("'data-kbm': 'prov-del-type'") && has('const okType = ui.typed.trim() === route') && has('disabled: !okType'))
ok('the drawer closes on Escape and on a click outside, and Escape is captured so DSH does not also close Settings', has("ev.key === 'Escape'") && has('onMouseDown: onClose') && has("document.addEventListener('keydown', key, true)") && has("document.addEventListener('keydown', touche, true)"))
ok('the models.dev picker keeps its search, groups, arrow keys and Already-added rows', has("'data-kbm': 'prov-picker'") && has("ev.key === 'ArrowDown'") && has("m('kb.prov.add.deja')") && has("m('kb.prov.add.grp.free')") && has("m('kb.prov.add.pied'"))
ok('the models.dev list closes on a press elsewhere without swallowing it (no full-screen backdrop)', has("document.addEventListener('mousedown', away)") && !has('kbpv-cb-fond'))
ok('the picker still shows the free-models link for providers that have one', has('p.libre === true ? h(BadgeFree'))
ok('the DeepSeek card edits on DSH’s page (its namespace is not ours)', has("'data-kbm': 'prov-edit-native'") && has("KBM.hasDeepseek === true ? h('div'"))
ok('the native menu cell is hidden only while this plugin is healthy, and shown again on dispose', has('kbNatOwner = true') && has('kbNatOwner = false; kbNatApply()') && has('hide = kbNatOwner === true && kbNatPrefGet() === true'))
ok('a crash on this page puts DSH’s native page back (error boundary)', has('class KbBoundary extends React.Component') && has('h(KbBoundary, null, h(Panel, null))') && has("componentDidCatch (e) { kbNatOwner = false; kbNatApply()"))
ok('the native page gets a note and a way back, in its footer seat', has("slots.inject('settings.models.footer'") && has("'data-kbm': 'native-back'"))
ok('Open DSH’s native page and Hide it from the menu are in the page menu', has("'data-kbm': 'native-open'") && has("'data-kbm': 'native-hide'"))
ok('the table header sorts by model, provider and context, and filters by capability', has("'data-kbm': 'sort-' + key") && has("'data-kbm': 'mxfilter-' + k") && has("kbmSortHead('name'") && has("kbmSortHead('provider'") && has("kbmSortHead('context'"))
ok('every row keeps its columns: model, provider, capabilities (list and matrix), context, source, actions', has("className: 'kbmp-c kbmp-cprov'") && has("className: 'kbmp-mx', 'data-kbm': 'row-matrix'") && has("'kbmp-c kbmp-cact'") && has("'kbmp-c kbmp-csrc'"))
ok('the override count is a line in the Source cell, not a pill on every row', has("className: 'kbmp-ovline', 'data-kbm': 'ovpill'") && !has("className: 'kbmp-ovpill'"))
ok('row actions show on hover and focus, and stay visible on touch screens', has('opacity:0;transition:opacity .12s') && has('@media (hover:none){.kbmp-c.kbmp-cact{opacity:1}}') && has('.kbmp-lig:hover .kbmp-cact,.kbmp-lig:focus-within .kbmp-cact'))
ok('the provider column and the matrix appear from 860 px, the compact layout below', has('@container (min-width: 860px)') && has('@container (min-width: 620px)'))
ok('the capability chips are hidden by default from 860 px (the header filters), always shown below, and one menu item turns them on', has("const KB_CHIPS_PREF = 'kb.models.capChips'") && has('kbmp-capsbar-on') && has('.kbmp-capsbar:not(.kbmp-capsbar-on){display:none}') && has("'data-kbm': 'chips-toggle'"))
ok('Restore, Sync all, the chips and DSH’s native page live in one ⋯ menu on the tab bar', has("'data-kbm': 'models-more'") && has("'data-kbm': 'models-menu'") && has("'data-kbm': 'restore'") && has("'data-kbm': 'fetch'"))
ok('the Cloud card shows on the Providers tab only, and the old header block (intro, Live data pill, two buttons) is gone from Models', has("UI.tab === 'providers' ? h(KybernosHero, null) : null") && !has("className: 'kbm-head'"))
ok('the page uses the room it has (1120 px, against the core plugin’s 720 cap, with more specificity)', has('>.kbm-page:has(.kbm-root.kbmp){max-width:1120px}'))
ok('no colour hard-coded in the new Providers styles', !/kbpv-[a-z-]+\{[^}']*#[0-9a-fA-F]{3,8}\b/.test(src))

console.log('\n── Fetch available models (the engine lists what a provider serves; the user ticks) ──')
{
  const bl = (name) => { const i = src.indexOf('// ' + name + '-BEGIN'); const j = src.indexOf('// ' + name + '-END'); return src.slice(i, j) }
  ok('the fetch blocks are delimited', bl('KB-FETCH-PURE').length > 100 && bl('KB-FETCH-ACTIONS').length > 100)
  const fx = new Function(bl('KB-FETCH-PURE') + '\nreturn { kbFetchProbe, kbFetchAskable, kbFetchCandidates, kbFetchOutcome, kbFetchAdopt, kbFetchPreselect, kbFetchFilter, kbFetchApply, kbFetchSize }')()
  const pv = new Function(bl('KB-PV-PURE') + '\nreturn { kbPvRows, kbPvMergeModels, kbPvEditProfile, kbPvNewProfile }')()

  console.log('  — the request')
  ok('an edit names its route; the endpoint is the one the form shows (trailing slash trimmed)', JSON.stringify(fx.kbFetchProbe('acme', { url: 'https://gw.example/v1/', custom: true, proto: 'anthropic-messages', key: '' })) === JSON.stringify({ provider: 'acme', baseURL: 'https://gw.example/v1', api: 'anthropic-messages' }))
  ok('a catalog route sends no protocol (the adapter knows it)', !('api' in fx.kbFetchProbe('groq', { url: '', custom: false, proto: 'openai-completions', key: '' })))
  ok('an add (custom) has no route to name, only the endpoint and protocol', JSON.stringify(fx.kbFetchProbe(null, { tab: 'custom', url: 'https://a/v1', proto: 'openai-completions', key: '' })) === JSON.stringify({ baseURL: 'https://a/v1', api: 'openai-completions' }))
  ok('a typed key travels for this call (trimmed); an empty one is not sent', fx.kbFetchProbe('a', { url: '', key: ' sk-1 ' }).apiKey === 'sk-1' && !('apiKey' in fx.kbFetchProbe('a', { url: '', key: '   ' })))
  ok('there is something to ask with a route, or an endpoint; nothing without either', fx.kbFetchAskable({ provider: 'a' }) === true && fx.kbFetchAskable({ baseURL: 'https://a' }) === true && fx.kbFetchAskable({}) === false && fx.kbFetchAskable({ baseURL: '' }) === false)

  console.log('  — the answer')
  const found = fx.kbFetchOutcome({ ok: true, value: [{ id: 'a', name: ' A ', contextWindow: 262144, maxTokens: 32000, inputModalities: ['text', 'image'] }, { id: 'a' }, { id: '' }, null, { name: 'no id' }, { id: 'b', contextWindow: -5, maxTokens: 1.5, inputModalities: 'x' }] })
  ok('well-formed candidates only: first of a duplicate, ids required, optional fields typed', found.kind === 'found' && found.models.length === 2 && found.models[0].name === 'A' && found.models[0].contextWindow === 262144 && found.models[0].input.join() === 'text,image' && JSON.stringify(found.models[1]) === JSON.stringify({ id: 'b' }), found)
  ok('a refusal carries the engine’s own message', JSON.stringify(fx.kbFetchOutcome({ ok: false, error: { code: 'llm/model-discovery-rejected', message: 'HTTP 401' } })) === JSON.stringify({ kind: 'refused', timeout: false, message: 'HTTP 401' }))
  ok('a timeout is told apart', fx.kbFetchOutcome({ ok: false, error: { code: 'timeout', message: 'x' } }).timeout === true)
  ok('anything unreadable is a refusal, never a throw', fx.kbFetchOutcome(null).kind === 'refused' && fx.kbFetchOutcome(undefined).kind === 'refused' && fx.kbFetchOutcome({ ok: true, value: 'x' }).kind === 'refused' && fx.kbFetchOutcome({ ok: false }).message === '')

  console.log('  — the picker')
  const cands = fx.kbFetchCandidates([{ id: 'gpt-a', name: 'GPT A', contextWindow: 131072 }, { id: 'gpt-b' }, { id: 'claude-x', name: 'Claude X', inputModalities: ['text', 'image'] }])
  ok('already-listed models are not ticked on opening; the rest are', JSON.stringify(Object.keys(fx.kbFetchPreselect(cands, [{ id: 'gpt-a' }, { id: ' ' }]))) === JSON.stringify(['gpt-b', 'claude-x']))
  ok('search matches the id and the display name, case-insensitive', fx.kbFetchFilter(cands, 'GPT').length === 2 && fx.kbFetchFilter(cands, 'claude x').length === 1 && fx.kbFetchFilter(cands, '  ').length === 3 && fx.kbFetchFilter(cands, 'zzz').length === 0)
  const rows = [{ id: 'gpt-a', name: 'Mine', contextWindow: 999 }, { id: '', name: '' }]
  const applied = fx.kbFetchApply(rows, cands, { 'gpt-a': true, 'claude-x': true })
  ok('adopting appends the ticked models, keeps a row already there exactly as it was, drops the empty placeholder', applied.length === 2 && applied[0].name === 'Mine' && applied[0].contextWindow === 999 && applied[1].id === 'claude-x' && applied[1].name === 'Claude X' && applied[1].input.join() === 'text,image', applied)
  ok('nothing ticked adds nothing', fx.kbFetchApply([{ id: 'x', name: '' }], cands, {}).length === 1)
  ok('sizes read the way the native page writes them', fx.kbFetchSize(262144) === '256K' && fx.kbFetchSize(1048576) === '1M' && fx.kbFetchSize(131072) === '128K' && fx.kbFetchSize(200000) === '200K' && fx.kbFetchSize(8192) === '8K' && fx.kbFetchSize(1500) === '1500')

  console.log('  — what lands in the profile')
  const written = pv.kbPvMergeModels([{ id: 'old', name: 'Old', contextWindow: 8000 }], applied.concat([{ id: 'old', name: 'Old' }]))
  ok('a model adopted from the endpoint carries its capacities into the profile', written.some((e) => e.id === 'claude-x' && e.name === 'Claude X' && e.input.join() === 'text,image'), written)
  const edited = pv.kbPvMergeModels([{ id: 'gpt-a', name: 'Old', contextWindow: 8000, maxTokens: 100, input: ['text'] }], [{ id: 'gpt-a', name: 'New', contextWindow: 131072, maxTokens: 5, input: ['image'] }])
  ok('a model that already exists keeps ITS values, whatever the row says (the user may have tuned them)', edited[0].contextWindow === 8000 && edited[0].maxTokens === 100 && edited[0].input.join() === 'text' && edited[0].name === 'New')
  ok('rows drop invalid capacities instead of writing them', JSON.stringify(pv.kbPvRows([{ id: 'a', name: '', contextWindow: -1, maxTokens: 'x', input: [1] }])) === JSON.stringify([{ id: 'a', name: '' }]))
  const withModels = { api: 'openai-completions', baseURL: 'https://g/v1', models: [{ id: 'm1' }] }
  const restored = pv.kbPvEditProfile('groq', withModels, { url: 'https://g/v1', key: '', models: [], restoreModels: true }, false)
  ok('Restore default models removes the models list altogether (the adapter’s own list is back), it does not write an empty one', !('models' in restored) && restored.baseURL === 'https://g/v1')
  const emptied = pv.kbPvEditProfile('groq', withModels, { url: 'https://g/v1', key: '', models: [] }, false)
  ok('whereas emptying the rows writes an empty list (no model offered), as before', Array.isArray(emptied.models) && emptied.models.length === 0)

  console.log('  — the call')
  let seen = null
  const run = new Function('kbMTimeout', 'KB_NS', bl('KB-FETCH-PURE') + bl('KB-FETCH-ACTIONS') + '\nreturn { kbFetchRun }')((p) => Promise.resolve(p), 'llm-pi-ai').kbFetchRun
  const good = await run({ llm: { discoverModels: async (ns, req) => { seen = { ns, req }; return { ok: true, value: [{ id: 'm' }] } } } }, { provider: 'a' })
  ok('it asks the engine in the models namespace with the request as built, and returns the candidates', good.kind === 'found' && good.models[0].id === 'm' && seen.ns === 'llm-pi-ai' && seen.req.provider === 'a', [good, seen])
  ok('a DSH without the service is reported, not thrown', (await run(null, {})).unavailable === true && (await run({ llm: {} }, {})).unavailable === true && (await run({ llm: null }, {})).unavailable === true)
  ok('a call that throws becomes a refusal with its message', (await run({ llm: { discoverModels: async () => { throw new Error('socket closed') } } }, {})).message === 'socket closed')
  ok('a refusal from the engine comes through', (await run({ llm: { discoverModels: async () => ({ ok: false, error: { message: 'HTTP 401' } }) } }, {})).message === 'HTTP 401')
  const slow = new Function('kbMTimeout', 'KB_NS', bl('KB-FETCH-PURE') + bl('KB-FETCH-ACTIONS') + '\nreturn { kbFetchRun }')(() => Promise.resolve({ ok: false, error: { code: 'timeout', message: 'x' } }), 'llm-pi-ai').kbFetchRun
  ok('a timeout is told apart from a refusal', (await slow({ llm: { discoverModels: () => new Promise(() => {}) } }, {})).timeout === true)

  console.log('  — wiring')
  const w = (frag) => src.includes(frag)
  ok('the button sits in the models header of both panels, disabled with a reason until there is something to ask', w("'data-kbm': 'fetch-open'") && w("title: blocked !== null ? blocked : (!askable ? m('kb.fetch.needsurl') : undefined)") && w('probe: kbFetchProbe(route, dr)') && w('probe: kbFetchProbe(null, dr)'))
  ok('the picker is the native one: search, Select all / Deselect all, Add selected, Cancel', w("'data-kbm': 'fetch-search'") && w("'data-kbm': 'fetch-all'") && w("'data-kbm': 'fetch-adopt'") && w("'data-kbm': 'fetch-cancel'"))
  ok('models already in the list are shown, ticked and disabled — never overwritten', w("checked: known || fp.picked[c.id] === true, disabled: known"))
  ok('Escape closes the picker only: window capture runs before the drawer’s document capture', w("window.addEventListener('keydown', key, true)") && w('Escape closes the picker and nothing else'))
  ok('a catalog route warns that the kept list replaces the built-in one, and can restore it', w("'data-kbm': 'fetch-replaces'") && w("'data-kbm': 'fetch-restore'") && w('d.restoreModels === true) delete next.models'))
  ok('editing the rows afterwards cancels a pending "restore"', w('set({ models: next, touched: true, restoreModels: false })'))
  ok('the picker is the page’s own dialog, above the drawer', w("className: 'kbm-mdl-root', 'data-kbm': 'fetch-dialog'") && w('kbm-mdl-root sits at z-index 1000'))
  ok('no colour hard-coded in the picker styles', !/\.kbpv-(fetch|lnk|mact)[a-z-]*\{[^}']*#[0-9a-fA-F]{3,8}\b/.test(src))
}

console.log('\n── the model health chip (the alert of the study model, on the tab bar) ──')
{
  const hb = src.indexOf('// KB-HEALTH-PURE-BEGIN')
  const he = src.indexOf('// KB-HEALTH-PURE-END')
  ok('the health block is delimited', hb > 0 && he > hb)
  const { KB_HEALTH_CAUSES, kbHealthView, kbHealthCauses, kbHealthRows, kbHealthDown } = new Function(src.slice(hb, he) + '\nreturn { KB_HEALTH_CAUSES, kbHealthView, kbHealthCauses, kbHealthRows, kbHealthDown }')()
  const raw = (over) => ({ total: 9, tousEnEchec: false, checking: false, alertes: [{ cle: 'groq/a', route: 'groq', id: 'a', cause: 'key' }], ...over })
  ok('anything that is not a view reads as nothing to say, never a throw', kbHealthView(null) === null && kbHealthView(undefined) === null && kbHealthView('x') === null && kbHealthView({}) === null && kbHealthView({ alertes: 'x' }) === null)
  ok('no failing model: nothing to say', kbHealthView(raw({ alertes: [] })) === null)
  ok('entries without a key are dropped; none left means nothing to say', kbHealthView(raw({ alertes: [null, {}, { cle: '' }, { cle: 3 }] })) === null)
  const v = kbHealthView(raw())
  ok('a view keeps the failing models, the total and the flags', v.alertes.length === 1 && v.total === 9 && v.tousEnEchec === false && v.checking === false, v)
  ok('the provider comes from the key when the bus omits it (a model id may hold slashes)', kbHealthView(raw({ alertes: [{ cle: 'vercel-ai-gateway/typesafe-ai/jev', cause: 'refused' }] })).alertes[0].route === 'vercel-ai-gateway')
  ok('a cause the page has no words for is "other"', kbHealthView(raw({ alertes: [{ cle: 'a/b', cause: 'martian' }, { cle: 'a/c' }] })).alertes.every((a) => a.cause === 'other'))
  ok('a total below the failing count is repaired', kbHealthView(raw({ total: 0 })).total === 1 && kbHealthView(raw({ total: 'x' })).total === 1)
  ok('"nothing answered" and "checking" are carried', kbHealthView(raw({ tousEnEchec: true, checking: true })).tousEnEchec === true && kbHealthView(raw({ checking: true })).checking === true)

  const mixed = [{ cle: 'b/1', cause: 'silent' }, { cle: 'a/2', cause: 'gone' }, { cle: 'a/1', cause: 'key' }, { cle: 'c/1', cause: 'key' }, { cle: 'd/1', cause: 'silent' }]
  ok('causes are counted in a fixed order, key problems first, empty ones left out', JSON.stringify(kbHealthCauses(mixed)) === JSON.stringify([{ cause: 'key', n: 2 }, { cause: 'gone', n: 1 }, { cause: 'silent', n: 2 }]), kbHealthCauses(mixed))
  const r = kbHealthRows(mixed, 3)
  ok('rows: key problems first, then by key, capped, the rest counted', r.rows.map((a) => a.cle).join() === 'a/1,c/1,a/2' && r.more === 2, r)
  ok('rows under the cap list everyone and count nothing more', kbHealthRows(mixed, 10).rows.length === 5 && kbHealthRows(mixed, 10).more === 0)
  ok('the rows are a copy: the view is not reordered', mixed[0].cle === 'b/1')
  const down = kbHealthDown(kbHealthView(raw({ alertes: [{ cle: 'groq/a' }, { cle: 'zai/glm-4' }] })))
  ok('the failing models are a lookup by route/id, for the Models tab filter', down['groq/a'] === true && down['zai/glm-4'] === true && down['groq/b'] === undefined)
  ok('no view: nobody is failing', Object.keys(kbHealthDown(null)).length === 0)

  // The contract with kybernos-sessions: the cause ids it publishes are the ones this page has words for.
  const sessions = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'kybernos-sessions', 'client.js'), 'utf8')
  const table = sessions.slice(sessions.indexOf('const SANTE_CAUSES = {'), sessions.indexOf('const santeCause'))
  const published = [...new Set([...table.matchAll(/:\s*'([a-z]+)'/g)].map((x) => x[1]).concat(['other']))].sort()
  ok('the cause ids kybernos-sessions publishes are exactly the ones this page words', published.join() === KB_HEALTH_CAUSES.slice().sort().join(), published)
  ok('each cause has a French and an English text', KB_HEALTH_CAUSES.every((c) => new RegExp("'kb\\.health\\.cause\\." + c + "': \\{ kybernos: '[^']+', en: '[^']+' \\}").test(src)))
  ok('the bus name and the event are the ones kybernos-sessions publishes', src.includes('window.__kybernosHealth') && sessions.includes('window.__kybernosHealth = santeBus') && src.includes("'kybernos-health'") && sessions.includes("new CustomEvent('kybernos-health')"))

  const has2 = (frag) => src.includes(frag)
  ok('the chip sits on the tab bar, after the two tabs, and listens for the bus event (and lets go of it)', has2('h(HealthChip, null),') && has2("window.addEventListener('kybernos-health', on)") && has2("window.removeEventListener('kybernos-health', on)"))
  ok('the chip hooks come before the early return (hook order)', src.indexOf('const [, tick] = React.useState(0)') < src.indexOf('if (vue === null) return null'))
  ok('Recheck, Show them and Hide are there; Hide also leaves the "not answering" filter', has2("'data-kbm': 'health-recheck'") && has2("'data-kbm': 'health-show'") && has2("'data-kbm': 'health-hide'") && has2("if (UI.statut === 'down') UI.statut = 'any'"))
  ok('Fix key opens the provider’s Edit panel, only for key problems', has2("a.cause === 'key' ? h('button'") && has2("'data-kbm': 'health-fix'") && has2('UI.edit = route') && has2('if (UI.edit === null) return undefined'))
  ok('a provider that cannot be edited here shows its models instead of failing silently', has2("else { UI.prov = route; UI.tab = 'models'; kbmNotify() }"))
  ok('the Models tab can filter on the failing models, and offers the choice only while there is something to filter', has2("if (down !== null && down[mo.route + '/' + mo.id] !== true) return false") && has2("kbHealthGet() !== null || UI.statut === 'down'"))
  ok('the popover closes like the other menus: it lives in UI.menu, so a press elsewhere and Escape (captured) close it', has2("UI.menu === '__health'") && has2("'data-kbm': 'health-pop', onClick: (ev) => ev.stopPropagation()"))
  ok('no colour hard-coded in the chip styles', !/\.kbhc[a-z-]*\{[^}']*#[0-9a-fA-F]{3,8}\b/.test(src))
  const sess = (frag) => sessions.includes(frag)
  ok('kybernos-sessions no longer draws anything: no banner node, no anchor, no styles', !sessions.includes('kbr-sante') && !sessions.includes('santeDessiner') && !sessions.includes('santeAncrage'))
}

console.log('\n── strings: every new key in French and English ──')
const keys = [...src.matchAll(/'(kb\.(?:prov\.(?:off|on)\.[a-z.]+|prov\.add\.err\.parque|pv\.[a-z.]+|nat\.[a-z.]+|health\.[a-z.]+|fetch\.[a-z.]+))': \{ kybernos: '((?:[^'\\]|\\.)*)', en: '((?:[^'\\]|\\.)*)' \}/g)]
ok('the new keys are all declared', keys.length >= 70, keys.length)
ok('each has a French and an English text', keys.every((k) => k[2].length > 0 && k[3].length > 0))
ok('placeholders match between French and English', keys.every((k) => (k[2].match(/\{[a-z]+\}/g) || []).sort().join() === (k[3].match(/\{[a-z]+\}/g) || []).sort().join()), keys.filter((k) => (k[2].match(/\{[a-z]+\}/g) || []).sort().join() !== (k[3].match(/\{[a-z]+\}/g) || []).sort().join()).map((k) => k[1]).join())
ok('every kb.prov.off/on, kb.pv, kb.nat, kb.health and kb.fetch key used in the code is declared (a trailing dot is a computed key: kb.pv.err.<reason>)', [...src.matchAll(/m\('(kb\.(?:prov\.(?:off|on)\.[a-z.]+|prov\.add\.err\.parque|pv\.[a-z.]+|nat\.[a-z.]+|health\.[a-z.]+|fetch\.[a-z.]+))'/g)].filter((u) => !u[1].endsWith('.')).every((u) => keys.some((k) => k[1] === u[1])) && ['pick', 'slug', 'taken', 'url', 'template', 'models'].every((r) => keys.some((k) => k[1] === 'kb.pv.err.' + r)))

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
