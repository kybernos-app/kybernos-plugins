#!/usr/bin/env node
/** Client harness for kybernos-models, parked ("disabled") providers: the pure
 *  decisions are evaluated for real; the wiring is checked on the source. The
 *  rendered page is checked on the real GUI (see docs/dev/live-testing.md). */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sessionSource } from './session-guard.mjs'
import { SESSION_SECRET, browserHeaders } from './lib-session-test.mjs'
sessionSource.secret = () => SESSION_SECRET // the machine secret the write routes check the session cookie against

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
  const body = src.slice(begin, end) + '\n' + src.slice(src.indexOf('// KB-PV-PURE-BEGIN'), src.indexOf('// KB-PV-PURE-END')) + '\n' + src.slice(aBegin, aEnd) + '\nreturn { kbMDisable, kbMEnable, kbMMutateRetry, kbMParkCall }'

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
      const req = { method: (init && init.method) || 'GET', url: path, socket: { localPort: 3080 }, headers: browserHeaders(),
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
  const pv = new Function(bl('KB-PV-PURE') + '\nreturn { kbPvKeyRef, kbPvKeyRefOf, kbPvKeyState, kbPvUrlOk, kbPvRows, kbPvMergeModels, kbPvDiffOps, kbPvEditProfile, kbPvNewProfile, kbPvAddBlock }')()
  ok('the key reference is <ROUTE>_API_KEY, like the native page', pv.kbPvKeyRef('zai-coding-cn') === 'ZAI_CODING_CN_API_KEY' && pv.kbPvKeyRef('groq') === 'GROQ_API_KEY')
  ok('a catalog provider added with the key left blank is « key missing », not a silent card (A3-32)', pv.kbPvKeyState({ baseURL: 'https://api.mistral.ai/v1' }, 'MISTRAL_API_KEY', { MISTRAL_API_KEY: false }) === 'missing' && pv.kbPvKeyState({}, 'MISTRAL_API_KEY', {}) === 'unknown')
  ok('the key dot follows the credential: the profile reference wins over the catalogue one, set is ok', pv.kbPvKeyState({ apiKeyEnv: 'MY_KEY' }, 'MISTRAL_API_KEY', { MY_KEY: true, MISTRAL_API_KEY: false }) === 'ok' && pv.kbPvKeyRefOf({ apiKeyEnv: 'MY_KEY' }, 'X') === 'MY_KEY' && pv.kbPvKeyRefOf({}, 'MISTRAL_API_KEY') === 'MISTRAL_API_KEY')
  ok('a hand-declared route that names no key stays without a dot (a local endpoint)', pv.kbPvKeyState({ baseURL: 'http://127.0.0.1:11434/v1' }, null, {}) === 'none' && pv.kbPvKeyState(undefined, undefined, undefined) === 'none')
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
      const req = { method: (init && init.method) || 'GET', url, socket: { localPort: 3080 }, headers: browserHeaders(), on (ev, cb) { if (ev === 'data' && text !== '') cb(text); if (ev === 'end') cb() } }
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
  ok('the native cell is hidden by default (this page does everything the native one does); a stored choice still wins', /const KB_NAT_DEFAULT_HIDDEN = true/.test(src) && new Function(src.slice(src.indexOf('// KB-NATIVE-PURE-BEGIN'), src.indexOf('// KB-NATIVE-PURE-END')) + '\nreturn kbNatHidden')()(null, true) === true && new Function(src.slice(src.indexOf('// KB-NATIVE-PURE-BEGIN'), src.indexOf('// KB-NATIVE-PURE-END')) + '\nreturn kbNatHidden')()('0', true) === false)
  const nav = ['Theme', 'AI provider and models', 'Models', 'Ollama local models', 'Voice']
  ok('the native cell is found beside ours', JSON.stringify(kbNatPick([nav], 'Models', 'AI provider and models')) === JSON.stringify([{ group: 0, index: 2 }]))
  ok('only the exact label matches, never "Ollama local models"', kbNatPick([nav], 'Models', 'AI provider and models').length === 1)
  ok('a list that does not hold our cell is never touched', kbNatPick([['Models', 'Chat', 'Files', 'More']], 'Models', 'AI provider and models').length === 0)
  ok('a list too short to be a menu is ignored', kbNatPick([['Models', 'AI provider and models']], 'Models', 'AI provider and models').length === 0)
  ok('with no native label (locale did not answer) nothing is hidden', kbNatPick([nav], null, 'AI provider and models').length === 0 && kbNatPick([nav], '', 'AI provider and models').length === 0)
  ok('never hides our own cell if the labels collide', kbNatPick([nav], 'AI provider and models', 'AI provider and models').length === 0)
  ok('the translated label is matched as is', kbNatPick([['Thème', 'Fournisseur IA et modèles', 'Modèles', 'Voix']], 'Modèles', 'Fournisseur IA et modèles').length === 1)
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
ok('the DeepSeek cards edit here, in a panel of the page (see the DeepSeek section)', has("'data-prov': c.provider") && has('openDs(c.ns)') && !has("'data-kbm': 'prov-edit-native'"))
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
ok('the Cloud card is the first cell of the provider grid, a card of its own size (so it shows on the Providers tab only and the tab bar never moves), and the old header block (intro, Live data pill, two buttons) is gone from Models', has("h(KybernosHero, { key: 'kb-hero' })") && !has("UI.tab === 'providers' ? h(KybernosHero, null) : null") && has("className: 'kbpv-card kbmh-hero'") && !has('grid-column:1/-1') && !has("className: 'kbm-head'"))
ok('the Cloud card IS the « kybernos » provider while the account is connected: its plain card is not drawn beside it (it is when the account is disconnected, and in a search result where the provider has to be findable)', has("cloud: route === 'kybernos'") && has('const listed = cards.filter((x) => !(x.cloud === true && KBM.cloud !== false))') && has('KBM.cloud = res !== null && typeof res === \'object\' && res.connected === true; kbmNotify()') && has('.catch(() => { if (mort !== true) { KBM.cloud = false; kbmNotify() } })') && has('const hits = searching ? kbPvSearch(cards, UI.pq) : listed') && has('(searching ? hits : (fold.fold && !ui.waitOpen ? ready : listed))'))
ok('the tab bar is the first thing the panel draws: nothing sits above it on either tab (it jumped 85 px between Providers and Models)', (() => { const a = src.indexOf("'data-slot': 'kybernos-models-header' }"); const b = src.indexOf("className: 'kbmp-tabs'", a); return a > 0 && b > a && b - a < 3000 && !src.slice(a, b).includes('KybernosHero') })())
ok('the page uses the room it has (1120 px, against the core plugin’s 720 cap, with more specificity)', has('>.kbm-page:has(.kbm-root.kbmp){max-width:1120px}'))
ok('no colour hard-coded in the new Providers styles', !/kbpv-[a-z-]+\{[^}']*#[0-9a-fA-F]{3,8}\b/.test(src))

console.log('\n── DeepSeek: the two adapters outside llm-pi-ai, edited here ──')
{
  const bl = (name) => { const i = src.indexOf('// ' + name + '-BEGIN'); const j = src.indexOf('// ' + name + '-END'); return src.slice(i, j) }
  const ds = new Function(bl('KB-DS-PURE') + '\nreturn { KB_DS_NS, kbDsParseCapacity, kbDsFormatCapacity, kbDsRows, kbDsValidate, kbDsCleanRows, kbDsHasImage, kbDsSetImage, kbDsEditProfile, kbDsKeyRef }')()
  const pv = new Function(bl('KB-PV-PURE') + '\nreturn { kbPvDiffOps }')()
  ok('two namespaces: the official adapter and the account one', ds.KB_DS_NS.join() === 'llm-deepseek,llm-deepseek-account')

  console.log('  — capacities')
  const P = ds.kbDsParseCapacity
  ok('"256K", "1M", "131072" and decimals read like the native page; blank inherits; junk is NaN', P('256K') === 256000 && P('1M') === 1e6 && P('131072') === 131072 && P('1.5k') === 1500 && P('  64k ') === 64000 && P('') === undefined && P('   ') === undefined && Number.isNaN(P('12x')) && Number.isNaN(P('-5')) && Number.isNaN(P('1,000')))
  ok('spelling round-trips: whole millions, whole thousands, else the plain count', ds.kbDsFormatCapacity(1000000) === '1M' && ds.kbDsFormatCapacity(256000) === '256K' && ds.kbDsFormatCapacity(131072) === '131072' && ds.kbDsFormatCapacity(8192) === '8192' && [1000000, 256000, 131072, 1500].every((n) => P(ds.kbDsFormatCapacity(n)) === n))

  console.log('  — validation (the adapter’s own rules)')
  const V = ds.kbDsValidate
  ok('a clean catalog is valid', V([{ id: 'a', name: 'A', contextWindow: 1000, maxTokens: 10 }, { id: 'b' }]) === null && V([]) === null)
  ok('a blank id is refused, with its row', JSON.stringify(V([{ id: 'a' }, { id: '  ' }])) === JSON.stringify({ index: 1, key: 'kb.ds.err.id' }) && V([{ name: 'x' }]).key === 'kb.ds.err.id')
  ok('a duplicate id is refused', JSON.stringify(V([{ id: 'a' }, { id: ' a ' }])) === JSON.stringify({ index: 1, key: 'kb.ds.err.dup' }))
  ok('an empty display name is refused; an absent one is fine', V([{ id: 'a', name: '' }]).key === 'kb.ds.err.name' && V([{ id: 'a' }]) === null)
  ok('a context window or max tokens that is not a positive integer is refused (NaN, 0, 1.5, negative)', ['contextWindow', 'maxTokens'].every((f) => [NaN, 0, 1.5, -1, '5'].every((bad) => V([{ id: 'a', [f]: bad }]) !== null)) && V([{ id: 'a', contextWindow: NaN }]).key === 'kb.ds.err.ctx' && V([{ id: 'a', maxTokens: NaN }]).key === 'kb.ds.err.max')

  console.log('  — what is written')
  const base = [{ id: 'deepseek-flash', name: 'Flash', contextWindow: 1000000, inputModalities: ['text', 'image'], systemPromptUpdate: 'in-history', toolUpdate: 'addition-only' }, { id: 'deepseek-v4-pro', description: 'Stronger…', contextWindow: 1000000 }]
  const rows = ds.kbDsRows(base)
  ok('rows are copies of the full records: nothing the page does not show is lost, and the source is not touched', rows[0].systemPromptUpdate === 'in-history' && rows[1].description === 'Stronger…' && rows[0] !== base[0] && (rows[0].name = 'x', base[0].name === 'Flash'))
  rows[0].name = 'Flash'
  const edited = rows.map((r, i) => (i === 1 ? { ...r, maxTokens: 64000, name: undefined } : r))
  const cleaned = ds.kbDsCleanRows([{ id: ' a ', name: '', contextWindow: undefined, maxTokens: 5, keep: 'me' }])
  ok('writing trims ids, drops an empty name and an unset capacity, keeps every other field', JSON.stringify(cleaned) === JSON.stringify([{ id: 'a', maxTokens: 5, keep: 'me' }]), cleaned)
  const img = ds.kbDsSetImage({ id: 'p', inputModalities: ['text'] }, true)
  ok('image input on adds it next to text, off removes only it; a row with no modalities starts from text', img.inputModalities.join() === 'text,image' && ds.kbDsSetImage(img, false).inputModalities.join() === 'text' && ds.kbDsSetImage({ id: 'x' }, true).inputModalities.join() === 'text,image' && ds.kbDsHasImage(img) === true && ds.kbDsHasImage({ id: 'x' }) === false)
  const user = { baseURL: 'https://old', streamIdleTimeoutMs: 1000 }
  const e1 = ds.kbDsEditProfile(user, { url: 'https://proxy.example/v1/', touched: false, restoreModels: false, rows })
  ok('official: the base URL is written (trailing slash trimmed); untouched models stay inherited; other keys untouched', e1.baseURL === 'https://proxy.example/v1' && !('models' in e1) && e1.streamIdleTimeoutMs === 1000)
  ok('an empty URL removes the override', !('baseURL' in ds.kbDsEditProfile(user, { url: '  ', touched: false, rows })))
  ok('the account adapter has no endpoint: url undefined leaves baseURL alone', ds.kbDsEditProfile(user, { url: undefined, touched: false, rows }).baseURL === 'https://old')
  const e2 = ds.kbDsEditProfile({}, { url: undefined, touched: true, rows: edited })
  ok('a touched catalog is written whole (the first edit materializes every row), hidden fields included', e2.models.length === 2 && e2.models[0].systemPromptUpdate === 'in-history' && e2.models[1].maxTokens === 64000 && e2.models[1].description === 'Stronger…' && !('name' in e2.models[1]), e2)
  ok('Restore removes the override instead of copying defaults into it', !('models' in ds.kbDsEditProfile({ models: base, baseURL: 'x' }, { url: undefined, restoreModels: true, touched: false, rows })) && ds.kbDsEditProfile({ models: base, baseURL: 'x' }, { url: undefined, restoreModels: true, rows }).baseURL === 'x')
  const ops = pv.kbPvDiffOps([], { baseURL: 'old' }, ds.kbDsEditProfile({ baseURL: 'old' }, { url: 'https://new', touched: true, rows: [{ id: 'a' }] }))
  ok('the ops are path-addressed against the namespace root: a set per changed key', ops.map((o) => o.op + ':' + o.path.join('.')).sort().join() === 'set:baseURL,set:models')
  ok('the credential reference is the profile’s own (DEEPSEEK_API_KEY by default in the real catalog), else the derived one', ds.kbDsKeyRef({ apiKeyEnv: 'MY_KEY' }) === 'MY_KEY' && ds.kbDsKeyRef({ apiKeyEnv: '' }) === 'DEEPSEEK_OFFICIAL_API_KEY' && ds.kbDsKeyRef(undefined) === 'DEEPSEEK_OFFICIAL_API_KEY')

  console.log('  — the save, against a fake settings and credential store')
  const world = (o = {}) => {
    const log = []
    const state = { 'llm-deepseek': { user: o.user || {}, revision: 3 }, 'llm-deepseek-account': { user: {}, revision: 8 } }
    const creds = {}
    const KBM = { writable: o.writable !== false, revision: 1, ds: {}, dsDir: [] }
    const sync = () => { for (const ns of Object.keys(state)) KBM.ds[ns] = { ns, user: state[ns].user, base: { models: base }, value: { models: base, defaultContextWindow: 1000000, maxTokens: 256000, apiKeyEnv: 'DEEPSEEK_API_KEY' }, revision: state[ns].revision } }
    sync()
    const api = {
      settings: { mutate: async (ns, ops, rev) => {
        log.push(['settings', ns, String(rev), ops.map((x) => x.op + ':' + x.path.join('.')).join(',')])
        if (o.conflictOnce === true && log.filter((l) => l[0] === 'settings').length === 1) return { ok: false, error: { code: 'settings/conflict', message: 'stale' } }
        if (rev !== state[ns].revision) return { ok: false, error: { code: 'settings/conflict', message: 'stale' } }
        if (o.refuse) return { ok: false, error: { code: 'settings/invalid', message: 'refused by schema' } }
        for (const op of ops) { if (op.op === 'set') state[ns].user[op.path[0]] = op.value; else delete state[ns].user[op.path[0]] }
        state[ns].revision += 1
        return { ok: true, value: { revision: state[ns].revision } }
      } },
      credentials: { set: async (ref, value) => { log.push(['cred.set', ref]); if (o.failCred) return { ok: false, error: { message: 'vault' } }; creds[ref] = value; return { ok: true } } }
    }
    const kbMLoad = async () => { log.push(['load']); sync() }
    const body = bl('KB-PARK-ACTIONS') + '\n' + bl('KB-PV-PURE') + '\n' + bl('KB-PV-ACTIONS') + '\n' + bl('KB-DS-PURE') + '\n' + bl('KB-DS-ACTIONS') + '\nreturn { kbDsSave, kbDsCardsOf, kbMLoadDsKey }'
    const fns = new Function('m', 'kbMApi', 'KBM', 'KB_NS', 'kbMLoad', 'kbMJournal', 'kbMTimeout', 'fetch', 'kbMOBJ', body)(
      (k, v) => k + (v === undefined ? '' : JSON.stringify(v)), () => api, KBM, 'llm-pi-ai', kbMLoad, async () => {}, (p) => p, async () => ({ status: 404 }), (v) => v)
    return { fns, KBM, state, creds, log }
  }
  const rejects = async (fn) => { try { await fn(); return null } catch (e) { return String(e && e.message ? e.message : e) } }
  const steps = (w) => w.log.map((l) => l.join(':')).join(' > ')
  let w = world()
  let r = await w.fns.kbDsSave('llm-deepseek', { url: 'https://proxy/v1', key: '', rows: ds.kbDsRows(base), touched: false, restoreModels: false })
  ok('official: only the base URL is written, in ITS namespace, with ITS revision (3, not the models page’s)', r.changed === 1 && /settings:llm-deepseek:3:set:baseURL > load/.test(steps(w)) && w.state['llm-deepseek'].user.baseURL === 'https://proxy/v1' && w.state['llm-deepseek-account'].revision === 8, steps(w))
  w = world()
  r = await w.fns.kbDsSave('llm-deepseek', { url: '', key: 'sk-ds', rows: ds.kbDsRows(base), touched: false })
  ok('a typed key goes to the credential store under the profile’s reference, never to settings', w.creds.DEEPSEEK_API_KEY === 'sk-ds' && r.keyOk === true && r.changed === 0 && steps(w).indexOf('settings') < 0, steps(w))
  w = world({ failCred: true })
  r = await w.fns.kbDsSave('llm-deepseek', { url: '', key: 'sk', rows: [], touched: false })
  ok('a failed key save is reported (keyOk=false), not thrown', r.keyOk === false)
  w = world()
  r = await w.fns.kbDsSave('llm-deepseek-account', { url: undefined, key: 'ignored', rows: edited, touched: true })
  ok('account: the catalog is written in the account namespace; a typed key is ignored (it signs in with the account)', /settings:llm-deepseek-account:8:set:models/.test(steps(w)) && w.state['llm-deepseek-account'].user.models.length === 2 && w.log.every((l) => l[0] !== 'cred.set') && Object.keys(w.state['llm-deepseek'].user).length === 0, steps(w))
  w = world({ user: { models: base, baseURL: 'https://x' } })
  r = await w.fns.kbDsSave('llm-deepseek', { url: 'https://x', key: '', rows: [], touched: false, restoreModels: true })
  ok('Restore unsets `models` and nothing else', w.state['llm-deepseek'].user.models === undefined && w.state['llm-deepseek'].user.baseURL === 'https://x' && /unset:models/.test(steps(w)), steps(w))
  w = world()
  let err = await rejects(() => w.fns.kbDsSave('llm-deepseek', { url: '', rows: [{ id: 'a' }, { id: '' }], touched: true }))
  ok('an invalid catalog is refused before anything is written, naming the row', /kb\.ds\.err\.row/.test(err) && /"n":2/.test(err) && w.log.length === 0, err)
  w = world()
  err = await rejects(() => w.fns.kbDsSave('llm-deepseek', { url: 'not a url', rows: [], touched: false }))
  ok('a bad URL is refused before anything is written', err === 'kb.pv.err.url' && w.log.length === 0, err)
  w = world({ writable: false })
  err = await rejects(() => w.fns.kbDsSave('llm-deepseek', { url: 'https://a', rows: [], touched: false }))
  ok('read-only settings are refused', err === 'kb.models.error.readonly' && w.log.length === 0, err)
  w = world({ refuse: true })
  err = await rejects(() => w.fns.kbDsSave('llm-deepseek', { url: 'https://a', key: 'sk', rows: [], touched: false }))
  ok('a refused write stores no key and says why', /refused by schema/.test(err) && w.log.every((l) => l[0] !== 'cred.set'), err + ' ' + steps(w))
  w = world({ conflictOnce: true })
  r = await w.fns.kbDsSave('llm-deepseek', { url: 'https://a', rows: [], touched: false })
  ok('a revision conflict reloads once and retries', r.changed === 1 && w.log.filter((l) => l[0] === 'settings').length === 2 && w.log.some((l) => l[0] === 'load'), steps(w))
  const cards = w.fns.kbDsCardsOf(w.KBM.ds, [{ ns: 'llm-deepseek', provider: 'deepseek-official', name: 'DeepSeek' }])
  ok('two cards, named by the engine’s directory when it has them, else by default', cards.length === 2 && cards[0].provider === 'deepseek-official' && cards[1].provider === 'deepseek-account' && cards[1].name === 'DeepSeek Account' && w.fns.kbDsCardsOf({}, []).length === 0 && w.fns.kbDsCardsOf({ 'llm-deepseek': {} }, []).length === 1)
  const kw = world()
  kw.KBM.ds['llm-deepseek'].value.apiKeyEnv = 'MY_DS_KEY'
  const api2 = { credentials: { describe: async (refs) => ({ ok: true, value: { [refs[0]]: { configured: true } } }) } }
  const fn2 = new Function('m', 'KBM', 'kbMTimeout', bl('KB-DS-PURE') + '\n' + bl('KB-DS-ACTIONS') + '\nreturn { kbMLoadDsKey }')((k) => k, kw.KBM, (p) => p)
  await fn2.kbMLoadDsKey(api2)
  ok('the key state is read through credentials.describe, under the profile’s reference', kw.KBM.dsKey.ref === 'MY_DS_KEY' && kw.KBM.dsKey.configured === true, kw.KBM.dsKey)

  console.log('  — wiring')
  const w2 = (frag) => src.includes(frag)
  ok('each namespace has its own revision in the mutate helper', w2('ns === KB_NS ? KBM.revision : (KBM.ds[ns] !== undefined ? KBM.ds[ns].revision : null)'))
  ok('the DeepSeek namespaces are read in kbMLoad, and the key state after the directory', w2('for (const ns of KB_DS_NS)') && w2('await kbMLoadDsKey(api)'))
  ok('both cards edit in a panel: key (official only) folded under Customized settings with the URL and the catalog; the account shows its catalog directly', w2("'data-prov': c.provider") && w2("official ? h('button', { type: 'button', className: 'kbpv-adv'") && w2("'data-kbm': 'ds-account-note'"))
  ok('the catalog editor: id, name, context window, max tokens, image input, add, delete, restore; Apply is disabled while a row is invalid', w2("'data-kbm': 'ds-ctx'") && w2("'data-kbm': 'ds-max'") && w2("'data-kbm': 'ds-img'") && w2("'data-kbm': 'ds-model-add'") && w2("'data-kbm': 'ds-restore'") && w2('disabled: ui.busy === true || urlBad || rowsBad || ro'))
  ok('the Providers count includes both DeepSeek cards', w2('kbDsCardsOf(KBM.ds, KBM.dsDir).length'))
  ok('no colour hard-coded in the DeepSeek styles', !/\.kbpv-ds[a-z-]*\{[^}']*#[0-9a-fA-F]{3,8}\b/.test(src))
}

console.log('\n── Fetch available models (the engine lists what a provider serves; the user ticks) ──')
{
  const bl = (name) => { const i = src.indexOf('// ' + name + '-BEGIN'); const j = src.indexOf('// ' + name + '-END'); return src.slice(i, j) }
  ok('the fetch blocks are delimited', bl('KB-FETCH-PURE').length > 100 && bl('KB-FETCH-ACTIONS').length > 100)
  const fx = new Function(bl('KB-CAP-PURE') + bl('KB-FETCH-PURE') + '\nreturn { kbFetchProbe, kbFetchAskable, kbFetchCandidates, kbFetchOutcome, kbFetchAdopt, kbFetchPreselect, kbFetchFilter, kbFetchApply, kbFetchSize, kbFetchLiveOutcome, kbFetchMerge, kbFetchWhy, kbFetchHost, kbFetchTagUndescribed }')()
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
  ok('sizes read like the Context column: K is 1000, so a label reads back as itself (A3-11)', fx.kbFetchSize(256000) === '256K' && fx.kbFetchSize(262144) === '262.1K' && fx.kbFetchSize(1048576) === '1M' && fx.kbFetchSize(131072) === '131.1K' && fx.kbFetchSize(200000) === '200K' && fx.kbFetchSize(8192) === '8.2K' && fx.kbFetchSize(1500) === '1.5K' && fx.kbFetchSize(512) === '512')

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

  console.log('  — the live list (the provider\'s own endpoint, through the host)')
  const mk = () => new Function('kbMTimeout', 'KB_NS', bl('KB-FETCH-PURE') + bl('KB-FETCH-ACTIONS') + '\nreturn { kbFetchRun }')((p) => Promise.resolve(p), 'llm-pi-ai').kbFetchRun
  const realFetch = globalThis.fetch
  const answer = (body, status = 200) => { const calls = []; globalThis.fetch = async (url, init) => { calls.push({ url, init }); if (body instanceof Error) throw body; return new Response(JSON.stringify(body), { status }) }; return calls }
  const catalog = { llm: { discoverModels: async () => ({ ok: true, value: [{ id: 'a', name: 'Model A', contextWindow: 256000, maxTokens: 32000, inputModalities: ['text', 'image'] }, { id: 'old', name: 'Gone' }] }) } }
  try {
    const live = mk()
    let calls = answer({ ok: true, source: 'live', url: 'https://opencode.ai/zen/go/v1/models', models: [{ id: 'a', name: 'a' }, { id: 'new-1', name: 'new-1' }] })
    const r1 = await live(catalog, { provider: 'opencode-go', apiKey: 'sk-typed' }, { live: true })
    ok('a catalog route is asked through the host first: the route, and the typed key for this call', calls.length === 1 && calls[0].url === '/kybernos-models/models/live' && calls[0].init.method === 'POST' && JSON.parse(calls[0].init.body).route === 'opencode-go' && JSON.parse(calls[0].init.body).key === 'sk-typed', calls)
    ok('the live list decides which models exist: a model the catalog has and the provider dropped is not offered, a new one is', r1.kind === 'found' && r1.live === true && r1.models.map((c) => c.id).join() === 'a,new-1', r1)
    ok('a bare-id listing gets the name and capacities the catalog knows, and only those', r1.models[0].name === 'Model A' && r1.models[0].contextWindow === 256000 && r1.models[0].maxTokens === 32000 && r1.models[0].input.join() === 'text,image' && r1.models[1].contextWindow === undefined, r1.models)
    ok('the source is told: live, and from which address', r1.url === 'https://opencode.ai/zen/go/v1/models' && fx.kbFetchHost(r1.url) === 'opencode.ai')

    calls = answer({ ok: true, source: 'live', url: 'https://x/v1/models', models: [{ id: 'a' }] })
    await live(catalog, { provider: 'opencode-go', baseURL: 'https://typed.example/v1' }, { live: true })
    await live(catalog, { provider: 'opencode-go', baseURL: 'https://typed.example/v1', apiKey: 'sk-typed' }, { live: true })
    const sent1 = JSON.parse(calls[0].init.body)
    const sent2 = JSON.parse(calls[1].init.body)
    ok('an address being typed (not saved) is not sent alone, so the live list is the provider\'s own; beside a typed key it goes along', sent1.baseURL === undefined && sent1.key === undefined && sent2.baseURL === 'https://typed.example/v1' && sent2.key === 'sk-typed', [sent1, sent2])

    calls = answer({ ok: true, source: 'live', url: 'https://openrouter.ai/api/v1/models', models: [{ id: 'x', name: 'X', contextWindow: 1000 }] })
    let asked = 0
    const r2 = await live({ llm: { discoverModels: async () => { asked += 1; return { ok: true, value: [{ id: 'x', name: 'Catalog X', contextWindow: 9 }, { id: 'y' }] } } } }, { provider: 'openrouter' }, { live: true })
    ok('the engine is asked for its catalog on the live path too (its ids say which models the route may refuse); what the endpoint disclosed still wins over the catalog', r2.live === true && asked === 1 && r2.models[0].contextWindow === 1000 && r2.models[0].name === 'X' && JSON.stringify(r2.described) === JSON.stringify(['x', 'y']), r2)

    calls = answer({ ok: false, error: 'refused', status: 401, detail: '' })
    const r3 = await live(catalog, { provider: 'opencode-go' }, { live: true })
    ok('a refused key falls back to the engine\'s catalog and says why, in words about the key', r3.kind === 'found' && r3.live === false && r3.why.key === 'kb.fetch.why.key' && r3.why.vars.status === 401 && r3.models.length === 2, r3)

    calls = answer({ ok: false, error: 'refused', status: 400, detail: 'This API key is not scoped to a workspace' })
    const r4 = await live(catalog, { provider: 'anthropic' }, { live: true })
    ok('any other refusal carries the provider\'s own words', r4.why.key === 'kb.fetch.why.refused' && r4.why.vars.detail === ': This API key is not scoped to a workspace', r4)

    answer(new Error('network down'))
    const r5 = await live(catalog, { provider: 'opencode-go' }, { live: true })
    ok('a host that cannot be reached (an old DSH, not restarted) is a fallback with its reason, never a throw', r5.kind === 'found' && r5.live === false && r5.why.key === 'kb.fetch.why.host', r5)

    answer({ ok: false, error: 'no-endpoint' })
    const r6 = await live({ llm: { discoverModels: async () => ({ ok: false, error: { message: 'HTTP 401' } }) } }, { provider: 'mine' }, { live: true })
    ok('with no live list and no engine answer either, the engine\'s refusal is what the person sees', r6.kind === 'refused' && r6.message === 'HTTP 401', r6)

    calls = answer({ ok: true, url: 'https://x', models: [] })
    await live(catalog, { provider: 'a' })
    await live(catalog, { baseURL: 'https://a/v1' }, { live: true })
    await live(catalog, { provider: 'a' }, { live: false })
    ok('without the option, or with no route to name, the host is never asked (a custom provider is already asked over the wire by the engine)', calls.length === 0, calls)
  } finally { globalThis.fetch = realFetch }
  ok('why: 401 and 403 are about the key; a plain refusal, an unreachable provider, a bad reply, a big one, an old host and no address each have their own words', fx.kbFetchWhy({ why: 'refused', status: 403, detail: '' }).key === 'kb.fetch.why.key' && fx.kbFetchWhy({ why: 'refused', status: 429, detail: '' }).vars.detail === '' && fx.kbFetchWhy({ why: 'unreachable' }).key === 'kb.fetch.why.unreachable' && fx.kbFetchWhy({ why: 'bad-reply' }).key === 'kb.fetch.why.bad' && fx.kbFetchWhy({ why: 'too-big' }).key === 'kb.fetch.why.big' && fx.kbFetchWhy({ why: 'host' }).key === 'kb.fetch.why.host' && fx.kbFetchWhy({ why: 'no-endpoint' }).key === 'kb.fetch.why.noaddr' && fx.kbFetchWhy({ why: 'foreign-endpoint' }).key === 'kb.fetch.why.noaddr')
  ok('the host\'s answer is read defensively: anything unreadable is `none`, and a bad entry is dropped like in the engine\'s answer', fx.kbFetchLiveOutcome(null).kind === 'none' && fx.kbFetchLiveOutcome({ ok: true, models: 'x' }).kind === 'none' && fx.kbFetchLiveOutcome({ ok: true, models: [{ id: 'a' }, { id: 'a' }, { name: 'x' }] }).models.length === 1 && fx.kbFetchLiveOutcome({ ok: false, error: 'refused', status: 401 }).status === 401)
  const merged = fx.kbFetchMerge([{ id: 'a', name: 'a' }, { id: 'b', name: 'Mine', contextWindow: 5 }], [{ id: 'a', name: 'Model A', contextWindow: 9, maxTokens: 3 }, { id: 'b', name: 'Other', contextWindow: 7, maxTokens: 4 }])
  ok('merging never overrides what the endpoint disclosed', merged[0].name === 'Model A' && merged[0].contextWindow === 9 && merged[1].name === 'Mine' && merged[1].contextWindow === 5 && merged[1].maxTokens === 4)

  console.log('  — models outside the engine\'s catalog: custom models of the provider')
  const cp = new Function(bl('KB-PV-PURE') + '\nreturn { kbPvRefusedModel, kbCompanionSlug, kbCompanionOf, kbCompanionsOf, kbCompanionProfile }')()
  ok('the engine\'s two refusals (no protocol, then no address) name the model; any other message is not one', cp.kbPvRefusedModel('llm-pi-ai: provider "opencode-go" model "minimax-m3.1-flash-free" needs an api; the installed catalog does not describe it, so set the route\'s api to the wire protocol its endpoint speaks') === 'minimax-m3.1-flash-free' && cp.kbPvRefusedModel('llm-pi-ai: provider "opencode-go" model "glm-5.1" needs a baseURL; the installed catalog does not describe this route') === 'glm-5.1' && cp.kbPvRefusedModel('model "x" contextWindow must be a positive integer') === null && cp.kbPvRefusedModel(undefined) === null && cp.kbPvRefusedModel('') === null)
  ok('a companion is named after its provider and its protocol, and only a provider that exists owns one', cp.kbCompanionSlug('opencode-go', 'openai-completions') === 'opencode-go-custom-chat' && cp.kbCompanionSlug('opencode-go', 'anthropic-messages') === 'opencode-go-custom-msgs' && cp.kbCompanionSlug('opencode-go', 'openai-responses') === 'opencode-go-custom-resp' && cp.kbCompanionSlug('x', 'nope') === 'x-custom-chat' && cp.kbCompanionOf('opencode-go-custom-msgs', ['opencode-go', 'other']) === 'opencode-go' && cp.kbCompanionOf('opencode-go-custom-msgs', ['other']) === null && cp.kbCompanionOf('opencode-go', ['opencode-go']) === null && cp.kbCompanionOf('my-custom-gw', ['my']) === null && JSON.stringify(cp.kbCompanionsOf('a', ['a', 'a-custom-chat', 'b-custom-chat', 'a-custom-msgs', 'a-custom'])) === JSON.stringify(['a-custom-chat', 'a-custom-msgs']))
  const comp = cp.kbCompanionProfile({ displayName: 'OpenCode Go' }, 'opencode-go', 'OPENCODE_GO_API_KEY', 'openai-completions', 'https://opencode.ai/inference/go/v1', [{ id: 'm-new', name: 'M new', outside: true }], undefined)
  ok('a companion\'s profile: the provider\'s name and key reference, its own protocol and address, the models', comp.displayName === 'OpenCode Go (custom)' && comp.api === 'openai-completions' && comp.baseURL === 'https://opencode.ai/inference/go/v1' && comp.apiKeyEnv === 'OPENCODE_GO_API_KEY' && comp.models.length === 1 && comp.models[0].id === 'm-new' && comp.models[0].name === 'M new' && !('outside' in comp.models[0]))
  const comp2 = cp.kbCompanionProfile({}, 'opencode-go', null, 'openai-completions', 'https://x/v1', [{ id: 'm2', name: '' }], { ...comp, models: [{ id: 'm-new', name: 'M new', contextWindow: 7777 }] })
  ok('completing a companion keeps the entries it has, tuned fields included, and adds the new ones', comp2.models.map((x) => x.id).join() === 'm-new,m2' && comp2.models[0].contextWindow === 7777 && comp2.apiKeyEnv === 'OPENCODE_GO_API_KEY' && comp2.displayName === 'opencode-go (custom)')
  const live3 = [{ id: 'a' }, { id: 'new-1' }, { id: 'new-2' }]
  const tagged = fx.kbFetchTagUndescribed(live3, ['a', 'old'])
  ok('a model outside the engine\'s catalog is tagged, and only that; with no catalog to compare to nothing is tagged', tagged[0].undescribed === undefined && tagged[1].undescribed === true && tagged[2].undescribed === true && fx.kbFetchTagUndescribed(live3, []) === live3 && fx.kbFetchTagUndescribed(live3, null) === live3)
  ok('the models outside the catalog are not ticked on opening (each one is asked of the provider), the others are; an adopted one is flagged for the save', Object.keys(fx.kbFetchPreselect(tagged, [])).join() === 'a' && fx.kbFetchAdopt(tagged[1]).outside === true && fx.kbFetchAdopt(tagged[0]).outside === undefined)

  // the save itself, against a settings service that refuses like the engine: a model outside the catalog on a route without api/baseURL
  {
    const { mkdtempSync: mk2 } = await import('node:fs')
    const { tmpdir: td2 } = await import('node:os')
    process.env.DSH_HOME = mk2(join(td2(), 'kbm-comp-'))
    const { kbPkMount: pkMount, kbPkRead: pkRead } = await import('./index.js')
    const cbody = bl('KB-PARK-PURE') + '\n' + bl('KB-PARK-ACTIONS') + '\n' + bl('KB-PV-PURE') + '\n' + bl('KB-PV-ACTIONS') + '\nreturn { kbPvSaveSmart, kbCompanionRemove, kbPvDelete, kbMDisable, kbMEnable }'
    const cworld = (o = {}) => {
      const file = join(process.env.DSH_HOME, 'c' + Math.random().toString(36).slice(2) + '.json')
      const routes = {}
      pkMount((r) => { routes[r.path] = r.handler }, file)
      const log = []
      const settings = { providers: { cat: { apiKeyEnv: 'CAT_KEY', displayName: 'Cat', models: [{ id: 'known', name: 'Known' }] }, other: { baseURL: 'https://o/v1', api: 'openai-completions' } }, revision: 1 }
      const KBM = { writable: true, revision: 1, routes: Object.keys(settings.providers), models: [], userProviders: settings.providers, baseProviders: {}, parked: [], parkHost: true }
      const probes = []
      const api = {
        settings: { mutate: async (ns, ops) => {
          log.push(ops.map((x) => x.op + ':' + x.path.join('.')).join(','))
          // the engine's rule: a route with no api/baseURL of its own refuses the first model its catalog does not describe
          for (const op of ops) {
            if (op.op === 'set' && op.path.length === 3 && op.path[0] === 'providers' && op.path[2] === 'models' && op.path[1] === 'cat') {
              const bad = op.value.find((x) => /^new/.test(x.id))
              if (bad !== undefined) return { ok: false, error: { code: 'settings/invalid', message: 'llm-pi-ai: provider "cat" model "' + bad.id + '" needs an api; the installed catalog does not describe it, so set the route\'s api to the wire protocol its endpoint speaks' } }
            }
            if (o.refuseAll === true) return { ok: false, error: { code: 'settings/invalid', message: 'refused' } }
          }
          for (const op of ops) {
            const p = op.path; let t = settings
            for (let i = 0; i < p.length - 1; i++) t = t[p[i]]
            if (op.op === 'set') t[p[p.length - 1]] = op.value
            else delete t[p[p.length - 1]]
          }
          settings.revision += 1
          return { ok: true, value: { revision: settings.revision } }
        } },
        credentials: { set: async () => ({ ok: true }), unset: async (ref) => { log.push('cred.unset:' + ref); return { ok: true } } },
      }
      const fakeFetch = async (url, init) => {
        const u = String(url).split('?')[0]
        if (u === '/kybernos-models/models/probe') {
          const body = JSON.parse(init.body)
          probes.push(body)
          if (o.probe === undefined) return { status: 200, json: async () => ({ ok: false, error: 'refused', status: 401 }) }
          return { status: 200, json: async () => o.probe(body) }
        }
        const handler = routes[u]
        if (handler === undefined) return { status: 404, json: async () => { throw new Error('x') } }
        const text = init && init.body ? init.body : ''
        const req = { method: (init && init.method) || 'GET', url, socket: { localPort: 3080 }, headers: browserHeaders(), on (ev, cb) { if (ev === 'data' && text !== '') cb(text); if (ev === 'end') cb() } }
        const r = { status: 0, body: null, writeHead (st) { r.status = st }, end (tx) { r.body = tx } }
        await handler(req, r)
        return { status: r.status, json: async () => JSON.parse(r.body) }
      }
      const kbMLoad = async () => { KBM.revision = settings.revision; KBM.routes = Object.keys(settings.providers); KBM.userProviders = settings.providers; KBM.parked = Object.keys(pkRead(file).providers).map((slug) => ({ slug, models: [] })) }
      const kbMOBJ = (v) => (v === null || v === undefined || typeof v !== 'object' || Array.isArray(v)) ? {} : v
      const catDe = (r) => (r === 'cat' ? { id: 'cat', env: 'CAT_KEY', url: 'https://cat.example/v1' } : null)
      const fns = new Function('m', 'kbMApi', 'KBM', 'KB_NS', 'kbMLoad', 'kbMJournal', 'kbMTimeout', 'fetch', 'kbMOBJ', 'catDe', cbody)(
        (k) => k, () => api, KBM, 'llm-pi-ai', kbMLoad, async () => {}, (p) => p, fakeFetch, kbMOBJ, catDe)
      return { fns, KBM, settings, log, probes, file }
    }
    const draft = (models) => ({ url: '', key: '', custom: false, touched: true, models })

    let cw = await cworld({ probe: (b) => (b.model === 'new-2' ? { ok: true, api: 'anthropic-messages', baseURL: 'https://cat.example' } : { ok: true, api: 'openai-completions', baseURL: 'https://cat.example/v1' }) })
    let cr = await cw.fns.kbPvSaveSmart('cat', draft([{ id: 'known', name: 'Known' }, { id: 'new-1', name: '', outside: true }, { id: 'new-2', name: 'Two', outside: true }]))
    ok('a model the engine refuses is not an error: it moves to a companion of the provider, found by asking the provider, and the rest is saved', cw.settings.providers.cat.models.map((x) => x.id).join() === 'known' && cr.customN === 2 && cr.custom.guessed === 0, [cw.settings.providers.cat, cr])
    ok('...one companion per protocol, each with its own protocol and address, the provider\'s key reference and name', cw.settings.providers['cat-custom-chat'].api === 'openai-completions' && cw.settings.providers['cat-custom-chat'].baseURL === 'https://cat.example/v1' && cw.settings.providers['cat-custom-chat'].apiKeyEnv === 'CAT_KEY' && cw.settings.providers['cat-custom-chat'].displayName === 'Cat (custom)' && cw.settings.providers['cat-custom-chat'].models.map((x) => x.id).join() === 'new-1' && cw.settings.providers['cat-custom-msgs'].api === 'anthropic-messages' && cw.settings.providers['cat-custom-msgs'].baseURL === 'https://cat.example' && cw.settings.providers['cat-custom-msgs'].models[0].name === 'Two')
    ok('the probe is asked about each model, by the provider\'s name (never an address)', JSON.stringify(cw.probes) === JSON.stringify([{ route: 'cat', model: 'new-1' }, { route: 'cat', model: 'new-2' }]))
    ok('the refusal was met once and the models went together (all the flagged ones): the main route had nothing left to change, so it was not written again', cw.log.filter((l) => l.indexOf('providers.cat.models') >= 0).length === 1, cw.log)

    cw = await cworld({})
    cr = await cw.fns.kbPvSaveSmart('cat', draft([{ id: 'known', name: 'Known' }, { id: 'new-9', name: '', outside: true }]))
    ok('when the provider cannot be asked (no key, unreachable) the model is still added, on OpenAI chat at the provider\'s address, and the page is told it was a guess', cw.settings.providers['cat-custom-chat'].api === 'openai-completions' && cw.settings.providers['cat-custom-chat'].baseURL === 'https://cat.example/v1' && cr.custom.guessed === 1)

    cw = await cworld({})
    cr = await cw.fns.kbPvSaveSmart('cat', draft([{ id: 'known', name: 'Known' }, { id: 'new-5', name: '' }, { id: 'also-ok', name: '' }]))
    ok('a typed model nobody flagged is moved when the engine refuses it, and only it', cw.settings.providers.cat.models.map((x) => x.id).join() === 'known,also-ok' && cw.settings.providers['cat-custom-chat'].models.map((x) => x.id).join() === 'new-5' && cr.customN === 1)

    cw = await cworld({})
    cr = await cw.fns.kbPvSaveSmart('cat', draft([{ id: 'known', name: 'Known' }, { id: 'plain', name: '', outside: true }]))
    ok('a model the engine accepts stays on the provider\'s own route (no companion is made for the sake of a flag)', cw.settings.providers.cat.models.map((x) => x.id).join() === 'known,plain' && cw.settings.providers['cat-custom-chat'] === undefined && cr.custom === null)

    cw = await cworld({ refuseAll: true })
    const refused = await (async () => { try { await cw.fns.kbPvSaveSmart('cat', draft([{ id: 'known', name: 'Known' }, { id: 'x', name: '' }])); return null } catch (e) { return String(e && e.message ? e.message : e) } })()
    ok('any other refusal is still an error, said as it is', refused === 'refused', refused)

    // removing, deleting, switching off
    cw = await cworld({})
    await cw.fns.kbPvSaveSmart('cat', draft([{ id: 'known', name: 'Known' }, { id: 'new-1', name: '', outside: true }, { id: 'new-2', name: '', outside: true }]))
    await cw.fns.kbCompanionRemove('cat', 'new-1')
    ok('removing one custom model keeps the companion and its other models', cw.settings.providers['cat-custom-chat'].models.map((x) => x.id).join() === 'new-2')
    await cw.fns.kbCompanionRemove('cat', 'new-2')
    ok('removing the last one removes the companion with it', cw.settings.providers['cat-custom-chat'] === undefined && cw.settings.providers.cat !== undefined)

    cw = await cworld({})
    await cw.fns.kbPvSaveSmart('cat', draft([{ id: 'known', name: 'Known' }, { id: 'new-1', name: '', outside: true }]))
    await cw.fns.kbPvDelete('cat')
    ok('deleting the provider deletes its companions in the same write, and the key reference once', cw.settings.providers.cat === undefined && cw.settings.providers['cat-custom-chat'] === undefined && cw.settings.providers.other !== undefined && cw.log.filter((l) => l === 'cred.unset:CAT_KEY').length === 1 && cw.log.some((l) => l === 'unset:providers.cat,unset:providers.cat-custom-chat'), cw.log)

    cw = await cworld({})
    await cw.fns.kbPvSaveSmart('cat', draft([{ id: 'known', name: 'Known' }, { id: 'new-1', name: '', outside: true }]))
    await cw.fns.kbMDisable('cat')
    ok('switching the provider off switches its companions off with it', cw.settings.providers.cat === undefined && cw.settings.providers['cat-custom-chat'] === undefined && Object.keys(pkRead(cw.file).providers).sort().join() === 'cat,cat-custom-chat', Object.keys(pkRead(cw.file).providers))
    await cw.fns.kbMEnable('cat')
    ok('...and back on with it', cw.settings.providers.cat !== undefined && cw.settings.providers['cat-custom-chat'] !== undefined && cw.settings.providers['cat-custom-chat'].models[0].id === 'new-1' && Object.keys(pkRead(cw.file).providers).length === 0, [Object.keys(cw.settings.providers), Object.keys(pkRead(cw.file).providers)])
  }


  console.log('  — wiring')
  const w = (frag) => src.includes(frag)
  // A provider the catalogue knows is named by the catalogue ("OpenRouter"), not by its id ("openrouter"): pvLabel falls back on the catalogue's `nom` before the raw route.
  ok('pvLabel names a catalogue provider by its catalogue name, and falls back on the id only for a provider nobody named',
    /const pvLabel = \(route\) => \{[\s\S]*?const known = catDe\(route\)[\s\S]*?known\.nom[\s\S]*?: route\n\s*\}/.test(src))
  ok('the button sits in the models header of both panels, disabled with a reason until there is something to ask', w("'data-kbm': 'fetch-open'") && w("title: blocked !== null ? blocked : (!askable ? m('kb.fetch.needsurl') : undefined)") && w('probe: kbFetchProbe(route, dr)') && w('probe: kbFetchProbe(null, dr)'))
  ok('the picker asks the provider\'s own endpoint for a catalog route, and tells where the list came from (live, or the catalog and why not)', w('kbFetchRun(kbMApi(), probe, { live: custom !== true })') && w("'data-kbm': 'fetch-source'") && w("m('kb.fetch.src.catalog', { raison: m(fp.src.why.key, fp.src.why.vars) })"))
  ok('Add provider from the catalogue still adopts the engine\'s answer (a live list of hundreds is not adopted unasked)', w('const found = await kbFetchRun(api, kbFetchProbe(slug, d))'))
  ok('the picker tags the models outside the engine\'s catalog and says what happens to them', w("kbFetchTagUndescribed(out.models, out.described)") && w("'data-kbm': 'fetch-undescribed'") && w("m('kb.fetch.undescribed')"))
  ok('Apply saves through the smart save: a refused model becomes a custom model of the provider, and the page says how many (and when the protocol was a guess)', w("kbPvSaveSmart(route, { ...dr, models: dr.touched === true ? dr.models : undefined })") && w("m('kb.pv.saved.custom', { n: out.customN, slug: route })") && w("m('kb.pv.saved.custom.guess')"))
  ok('the companion routes are not drawn as providers, their models count with the provider, and the Models tab lists them under it (name, logo, filter) with a « custom » tag', w("const routes = kbProvRoutes()") && w("const kbProvRoutes = () =>") && w("n: kbProvRoutes().length + kbDsCardsOf(KBM.ds, KBM.dsDir).length") && w("kbProvOf(mo.route) === route") && w("if (UI.prov !== 'all' && kbProvOf(mo.route) !== UI.prov) return false") && w("pvLabel(kbProvOf(mo.route))") && w("'data-kbm': 'row-custom'"))
  ok('the Edit panel lists the custom models with a remove each, and a provider\'s companions follow it when it is deleted, switched off or on', w("'data-kbm': 'pv-custom'") && w("'data-kbm': 'pv-custom-del'") && w("kbCompanionRemove(route, x.id)") && w("const gone = [slug].concat(kbCompanionsOf(slug, KBM.routes))") && w("for (const c of kbCompanionsOf(route, KBM.routes)) { try { await kbMDisable(c) }") && w("for (const pk of KBM.parked.filter((x) => kbCompanionOf(x.slug, [slug]) !== null))"))
  ok('no select of the provider\'s protocol, no lock: the engine\'s one-api-per-route rule is met by a route of its own, not by binding every model', !w('pv-apisel') && !w('apiSel') && !w('needsApi') && !w('kb.pv.proto.auto'))
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
  const { KB_HEALTH_CAUSES, kbHealthView, kbHealthCauses, kbHealthRows, kbHealthDown, kbHealthIndex, kbHealthFree, kbHealthWhy } = new Function(src.slice(hb, he) + '\nreturn { KB_HEALTH_CAUSES, kbHealthView, kbHealthCauses, kbHealthRows, kbHealthDown, kbHealthIndex, kbHealthFree, kbHealthWhy }')()
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

console.log('\n── a count typed in the model sheet (context window, max output) ──')
{
  const bl = (name) => { const i = src.indexOf('// ' + name + '-BEGIN'); const j = src.indexOf('// ' + name + '-END'); return src.slice(i, j) }
  const { kbMNum } = new Function(bl('KB-DS-PURE') + bl('KB-NUM-PURE') + '\nreturn { kbMNum }')()
  ok('"256K" is 256000 and "1M" is 1000000 (it used to write 256 and 1)', kbMNum('256K') === 256000 && kbMNum('1M') === 1e6 && kbMNum('64k') === 64000, [kbMNum('256K'), kbMNum('1M')].join())
  ok('a decimal suffix works: "1.5M"', kbMNum('1.5M') === 1500000)
  ok('plain counts and numbers still work: "131072", 131072', kbMNum('131072') === 131072 && kbMNum(131072) === 131072)
  ok('grouped digits still work: "128 000", "128,000", "128_000", " 128000 "', ['128 000', '128,000', '128_000', ' 128000 '].every((t) => kbMNum(t) === 128000), ['128 000', '128,000', '128_000'].map(kbMNum).join())
  ok('junk is refused, not read for its digits: "abc", "abc12", "12abc", "", null, undefined', ['abc', 'abc12', '12abc', '', null, undefined].every((t) => kbMNum(t) === null), ['abc', 'abc12', '12abc'].map(kbMNum).join())
  ok('zero and negatives are refused', kbMNum(0) === null && kbMNum('0') === null && kbMNum('-5') === null && kbMNum(-5) === null)
  ok('an absurd size is refused (12 800 064 000 was accepted as a max output)', kbMNum('12800064000') === null && kbMNum(12800064000) === null && kbMNum('100M') === 1e8 && kbMNum('101M') === null)
  ok('NaN and Infinity are refused', kbMNum(NaN) === null && kbMNum(Infinity) === null)
}

console.log('\n── a count and its label agree both ways (A3-11) ──')
{
  const bl = (name) => { const i = src.indexOf('// ' + name + '-BEGIN'); const j = src.indexOf('// ' + name + '-END'); return src.slice(i, j) }
  const { kbCapLabel, kbCapExact, kbMNum } = new Function(bl('KB-CAP-PURE') + bl('KB-DS-PURE') + bl('KB-NUM-PURE') + '\nreturn { kbCapLabel, kbCapExact, kbMNum }')()
  ok('typing 256K shows 256K (it showed 250K)', kbCapLabel(kbMNum('256K')) === '256K', kbCapLabel(kbMNum('256K')))
  ok('a window of 128000 reads 128K (it read 125K) and 200000 reads 200K', kbCapLabel(128000) === '128K' && kbCapLabel(200000) === '200K')
  ok('a window that is not a whole thousand does not pretend to be one: 262144 is 262.1K, not 256K', kbCapLabel(262144) === '262.1K' && kbCapLabel(131072) === '131.1K')
  ok('every whole thousand reads back as itself', [1000, 8000, 32000, 64000, 128000, 200000, 256000, 1000000, 1500000, 2000000].every((n) => kbMNum(kbCapLabel(n)) === n), [1000, 64000, 256000, 1500000].map((n) => kbCapLabel(n)).join())
  ok('the edges: just under a million rounds up to 1M, small counts are plain, blanks and junk are empty', kbCapLabel(999960) === '1M' && kbCapLabel(999949) === '999.9K' && kbCapLabel(512) === '512' && kbCapLabel('') === '' && kbCapLabel(null) === '' && kbCapLabel(0) === '' && kbCapLabel(-5) === '' && kbCapLabel('abc') === '')
  ok('the exact count sits behind the label', kbCapExact(262144) === '262,144' && kbCapExact('1048576') === '1,048,576' && kbCapExact(512) === '512' && kbCapExact('') === '' && kbCapExact(0) === '')
  const has = (frag) => src.includes(frag)
  ok('the Context column and the field badge carry the exact count as a tooltip', has("h('span', { title: kbCapExact(ctx) !== '' ? kbCapExact(ctx) : undefined }") && has("className: 'kbm-suffix', title: def.pretty === true && kbCapExact(value)"))
  ok('the fetch list uses the same words as the table (one convention)', has('const kbFetchSize = (n) => kbCapLabel(n)') && has('const pretty = kbCapLabel'))
}

console.log('\n── a provider card with no model says what to do (A3-32) ──')
{
  const has = (frag) => src.includes(frag)
  ok('the key dot reads the credential of the catalogue provider when the profile names none', has('return kbPvKeyState(kbMOBJ(KBM.userProviders)[route], entry !== null ? entry.env : null, KBM.keys)') && has('const ref = kbPvKeyRefOf(prof, entry !== null ? entry.env : null)'))
  ok('a card with 0 models and no managed block offers the next step, which opens the panel on the models block', has("count === 0 && off !== true && bloc === null && ro !== true") && has("'data-kbm': 'prov-next', onClick: () => openEdit(route, false, true)") && has("if (showModels === true) d.adv = true"))
  ok('the hint says "add the key" while the key is missing, "fetch the models" otherwise', has("m(ks === 'missing' ? 'kb.pv.empty.nokey' : 'kb.pv.empty.fetch')"))
}

console.log('\n── the provider panel keeps the keyboard inside (A3-40) ──')
{
  const bl = (name) => { const i = src.indexOf('// ' + name + '-BEGIN'); const j = src.indexOf('// ' + name + '-END'); return src.slice(i, j) }
  const { kbTrapTarget } = new Function(bl('KB-TRAP-PURE') + '\nreturn { kbTrapTarget }')()
  const [a, b, c] = ['a', 'b', 'c']
  ok('Tab on the last control comes back to the first (it used to leave for the page behind)', kbTrapTarget([a, b, c], c, false) === a)
  ok('Shift+Tab on the first control goes to the last', kbTrapTarget([a, b, c], a, true) === c)
  ok('inside the list the browser moves on by itself', kbTrapTarget([a, b, c], b, false) === null && kbTrapTarget([a, b, c], b, true) === null && kbTrapTarget([a, b, c], a, false) === null && kbTrapTarget([a, b, c], c, true) === null)
  ok('a focus outside the panel (or on its frame) is brought back in at the end the key is heading for', kbTrapTarget([a, b, c], 'x', false) === a && kbTrapTarget([a, b, c], 'x', true) === c)
  ok('nothing tabbable, or junk, changes nothing', kbTrapTarget([], a, false) === null && kbTrapTarget(null, a, false) === null)
  const has = (frag) => src.includes(frag)
  ok('the panel handles Tab in its captured key handler and the frame can take focus', has("ev.key === 'Tab' && boxRef.current !== null") && has("kbTrapTarget(kbTabbables(boxRef.current), document.activeElement, ev.shiftKey)") && has("'aria-modal': 'true', 'aria-label': label, tabIndex: -1, ref: boxRef"))
  ok('the focus goes back to what opened the panel, read before the panel autofocuses (not on every render)', has('if (openerRef.current === undefined) openerRef.current = document.activeElement') && /React\.useEffect\(\(\) => \(\) => \{\s*const opener = openerRef\.current/.test(src))
}

console.log('\n── a refused value is shown, and taken back ──')
{
  const fn = (name) => { const i = src.indexOf('const ' + name + ' = '); return i < 0 ? '' : src.slice(i, i + 1400) }
  const set = fn('kbmSet')
  ok('kbmSet clears the error BEFORE saving (a synchronous refusal used to be wiped right after)', /mo\.error = null[\s\S]*?kbmSave\(mo, k, v, takeBack\)/.test(set) && !/kbmSave\(mo, k, v, takeBack\) !== true\) \{[^}]*\}\s*mo\.error = null/.test(set))
  ok('a refused value is taken back: the previous override comes back, or the key goes', /takeBack = \(\) =>[\s\S]*?if \(had\) back\[k\] = previous[\s\S]*?else delete back\[k\]/.test(set))
  ok('a refused count says what a count is', /wire === KB_REFUS\) \{ mo\.error = m\(k === 'context' \|\| k === 'outputLimit' \? 'kb\.models\.error\.number'/.test(src))
  const rowSrc = fn('Row').length > 0 ? src.slice(src.indexOf('const Row = '), src.indexOf('const ROWS_PAR_PAGE')) : ''
  ok('the row draws the message only while the sheet is closed: the sheet\'s mask covers the row (A3-10)', /ouvert !== true && mo\.error !== null && mo\.error !== undefined \? h\('div', \{ className: 'kbmp-err', 'data-kbm': 'row-error'/.test(rowSrc))
  ok('the open sheet draws a message that belongs to no field as an alert at the top of its own body (A3-10)', /kbmp-mdlbody' \},\s*mo\.error !== null && mo\.error !== undefined && kbmFieldOwned\(mo\) !== true \? h\('div', \{ className: 'kbmp-err kbmp-err-mdl', 'data-kbm': 'modal-error', role: 'alert' \}[\s\S]*?h\(Details, \{ mo: mo \}\)/.test(rowSrc))
  ok('a refused count is attached to its field and drawn under it, inside the sheet, as an alert (A3-10)', src.includes("mo.errorAt = { k, text: mo.error }") && src.includes("kbmFieldError(mo, def.k) !== null ? h('div', { className: 'kbm-ferr', 'data-kbm': 'field-error', role: 'alert' }"))
  {
    const body = src.slice(src.indexOf('const kbmFieldError = '), src.indexOf('const kbmSet = '))
    const { kbmFieldError, kbmFieldOwned } = new Function(body + '\nreturn { kbmFieldError, kbmFieldOwned }')()
    const mo = { error: 'enter a positive count', errorAt: { k: 'context', text: 'enter a positive count' } }
    ok('the message stays with the field that was refused, and only while it is the current message', kbmFieldError(mo, 'context') === 'enter a positive count' && kbmFieldError(mo, 'outputLimit') === null && kbmFieldOwned(mo) === true && kbmFieldError({ ...mo, error: 'another error' }, 'context') === null && kbmFieldOwned({ ...mo, error: 'another error' }) === false && kbmFieldError({ error: null }, 'context') === null && kbmFieldOwned({ error: 'x' }) === false)
  }
  const num = /'kb\.models\.error\.number': \{ kybernos: '([^']+)', en: '([^']+)' \}/.exec(src)
  ok('that message exists in French and English and names the K / M spelling', num !== null && /256K/.test(num[1]) && /256K/.test(num[2]))
}

console.log('\n── why a model is not answering, and the first view (V-29, V-28, N-06) ──')
{
  const bl = (name) => { const i = src.indexOf('// ' + name + '-BEGIN'); const j = src.indexOf('// ' + name + '-END'); return src.slice(i, j) }
  const hb = src.indexOf('// KB-HEALTH-PURE-BEGIN')
  const he = src.indexOf('// KB-HEALTH-PURE-END')
  const { kbHealthView, kbHealthIndex, kbHealthFree, kbHealthWhy } = new Function(src.slice(hb, he) + '\nreturn { kbHealthView, kbHealthIndex, kbHealthFree, kbHealthWhy }')()
  const al = (cle, cause, code = '') => ({ cle, route: cle.slice(0, cle.indexOf('/')), cause, code })
  ok('a key problem says what it is for a Kybernos Cloud model, a free model and any other', kbHealthWhy(al('kybernos/x', 'key')) === 'kb.health.why.cloud' && kbHealthWhy(al('openrouter/a:free', 'key'), true) === 'kb.health.why.free' && kbHealthWhy(al('groq/a', 'key'), false) === 'kb.health.why.key')
  ok('every other cause has its own sentence', ['gone', 'refused', 'text', 'silent', 'other'].every((c) => kbHealthWhy(al('groq/a', c)) === 'kb.health.why.' + c))
  ok('a model is free when it comes from the Free LLMs route, says so in its id, or sits with a provider that gives a free quota', kbHealthFree('opencode-free', 'big-pickle', []) === true && kbHealthFree('openrouter', 'x/y:free', []) === true && kbHealthFree('p', 'model-free', []) === true && kbHealthFree('nvidia', 'nv', ['nvidia', 'openrouter']) === true && kbHealthFree('groq', 'llama', ['nvidia']) === false)
  const view = kbHealthView({ alertes: [{ cle: 'groq/a', cause: 'key', code: 'AUTH' }, { cle: 'groq/b', cause: 'gone', code: 'x'.repeat(100) }, { cle: 'groq/c', cause: 'silent' }], total: 9 })
  ok('the failure code rides along (a tooltip), capped, and is empty when the bus has none', view.alertes[0].code === 'AUTH' && view.alertes[1].code.length === 40 && view.alertes[2].code === '')
  ok('the failing models are indexed by route/id', Object.keys(kbHealthIndex(view)).join() === 'groq/a,groq/b,groq/c' && kbHealthIndex(view)['groq/a'].cause === 'key' && Object.keys(kbHealthIndex(null)).length === 0)
  ok('each reason sentence exists in French and English', ['cloud', 'free', 'key', 'gone', 'refused', 'text', 'silent', 'other'].every((c) => new RegExp("'kb\\.health\\.why\\." + c + "': \\{ kybernos: '[^']+', en: '[^']+' \\}").test(src)))
  const has = (frag) => src.includes(frag)
  ok('the popover words each row with its own reason and the button says what it does (« Check key »)', has("'data-kbm': 'health-why'") && has("m(kbHealthWhy(a, kbHealthFree(a.route, a.cle.slice(a.route.length + 1), Object.keys(FREE_LINKS))))") && /'kb\.health\.fixkey': \{ kybernos: 'Vérifier la clé', en: 'Check key' \}/.test(src))
  ok('« Show unavailable (n) » brings the failing models back, on the Models tab, and the chip hears the bus so the tab re-reads it', has("m('kb.health.show', { n })") && has('UI.statut = \'down\'; UI.page = 1; UI.showDown = true') && has("const on = () => { tick((n) => n + 1); kbmNotify() }"))
  ok('the Models tab folds the failing models away until asked, with a toggle that counts them, and each shown row says why', has("hidden !== null && hidden[mo.route + '/' + mo.id] === true") && has("'data-kbm': 'toggle-down'") && has("'data-kbm': 'row-why'") && has("m('kb.health.showdown', { n: downN })"))

  ok('a provider picked by name shows ALL its models (the fold only applies to the unscoped list) and counts « N of N » like its card, so 3 declared models are 3 on screen', has("UI.statut !== 'down' && UI.showDown !== true && UI.prov === 'all'") && has("const scope = UI.prov === 'all' ? toutes : toutes.filter((mo) => mo.route === UI.prov)") && has("m('kb.models.count', { a: rows.length, b: scope.length })") && has("downN > 0 && UI.statut !== 'down' && UI.prov === 'all'"))

  const { kbPvSearch } = new Function(bl('KB-PV-PURE') + '\nreturn { kbPvSearch }')()
  const provs = [{ id: 'a', hay: 'anthropic Anthropic claude-opus-5-5 Claude Opus 5.5' }, { id: 'b', hay: 'opencode-go OpenCode Go claude-haiku-5-5 qwen3.8-max' }, { id: 'c', hay: 'groq Groq llama-4-scout' }, { id: 'd', hay: 'mistral Mistral Large Modèle Étendu' }]
  ok('a search finds the providers by their own words and by the models they serve', kbPvSearch(provs, 'claude').map((x) => x.id).join() === 'a,b' && kbPvSearch(provs, 'GROQ').map((x) => x.id).join() === 'c' && kbPvSearch(provs, 'qwen').map((x) => x.id).join() === 'b')
  ok('every word typed must match (« claude opus » is not « claude haiku »), in any order', kbPvSearch(provs, 'claude opus').map((x) => x.id).join() === 'a' && kbPvSearch(provs, 'opus claude').map((x) => x.id).join() === 'a' && kbPvSearch(provs, 'claude zzz').length === 0)
  ok('case and accents are ignored; an empty or blank query keeps everything and nothing throws on odd input', kbPvSearch(provs, 'modele etendu').map((x) => x.id).join() === 'd' && kbPvSearch(provs, '').length === 4 && kbPvSearch(provs, '   ').length === 4 && kbPvSearch(provs, null).length === 4 && kbPvSearch([{ id: 'x' }], 'a').length === 0)
  ok('the Providers tab has a search; while it is typed the Cloud card and the folds step aside and a miss says so', has("'data-kbm': 'prov-search'") && has("searching ? null : h(KybernosHero, { key: 'kb-hero' })") && has("fold.fold && !searching ? h('button'") && has("'data-kbm': 'prov-nomatch'") && has("m('kb.pv.search.none')"))
  ok('the provider logos are bigger on the cards (a 46 px tile, a 30 px drawing); the drawers keep their small header one', has('.kbpv-card>.kbpv-logo{width:46px;height:46px') && has("h(LogoProv, { route, taille: 30 })") && has("h(LogoProv, { route: 'deepseek', taille: 30 })") && has("h(LogoProv, { route, taille: 20 })"))

  ok('the tab row is 30 px on both tabs, so the tabs do not move by a pixel when the Models tab adds its icon buttons', has('.kbmp-tabs{position:relative;display:flex;flex-wrap:wrap;gap:8px;align-items:center;min-height:30px}'))

  ok('a provider card is 70 px tall at least, padding included (border-box): as a content box the 76 px minimum plus 28 px of padding made every card 106 px', has('.kbpv-card{box-sizing:border-box;position:relative;display:flex;align-items:center;gap:14px;padding:12px 14px;min-height:70px;'))

  const { kbHeroPlan, kbHeroShowKey } = new Function(bl('KB-HERO-PURE') + '\nreturn { kbHeroPlan, kbHeroShowKey }')()
  ok('the plan comes from the active space, else from the account, lower case; nothing known is null', kbHeroPlan({ space_plan: { key: 'Free' }, user: { plan: 'team' } }) === 'free' && kbHeroPlan({ user: { plan: 'PLUS' } }) === 'plus' && kbHeroPlan({ space_plan: { key: '' }, user: { plan: 'pro' } }) === 'pro' && kbHeroPlan(null) === null && kbHeroPlan({}) === null && kbHeroPlan({ space_plan: 5, user: 7 }) === null)
  ok('V-28: « Add your API key » is offered while not connected and on a Free account, not on a connected paid one', kbHeroShowKey(false, null) === true && kbHeroShowKey(null, null) === true && kbHeroShowKey(true, 'free') === true && kbHeroShowKey(true, 'plus') === false && kbHeroShowKey(true, null) === false)
  ok('the hero hides the key link and the « Recommended » tag once connected (on a Free account the link stays), and says it in one line (« N models included », with « Connected » for a screen reader)', has("kbHeroShowKey(connecte, plan) ? h('button', {") && has("'data-kbmh': 'badge' }, m('kb.hero.badge')") && has("m(n === 1 ? 'kb.hero.title.in.one' : 'kb.hero.title.in', { n })") && has("className: 'kbmh-hero-sr'") && /'kb\.hero\.title\.in': \{ kybernos: '\{n\} modèles inclus', en: '\{n\} models included' \}/.test(src))
  ok('the card is a provider card in a night blue: short labels on the buttons (Connect / Manage / or add a key), the full sentence in the tooltip and the accessible name, and the name opens the Models view once connected', has("kb.hero.connect.short") && has("'kb.hero.manage.short': { kybernos: 'Gérer', en: 'Manage' }") && has("'aria-label': connecte === true ? m('kb.hero.manage') : m('kb.hero.connect')") && has("const voirModeles = () => { uiSet('prov', 'kybernos'); uiSet('tab', 'models') }") && has("'data-kbmh': 'models'"))
  ok('the dead banner is gone: no pitch, no feature list, no « or » divider, no 520 px column rule', !has('kbmh-hero-pitch') && !has('kbmh-hero-feats') && !has('kbmh-hero-or') && !has('kbmh-hero-cta') && !has("'kb.hero.pitch") && !has("'kb.hero.f.") && !has("'kb.hero.or'"))

  const { kbPvFold } = new Function(bl('KB-PV-PURE') + '\nreturn { kbPvFold }')()
  ok('N-06: once one provider works, the ones with no key or switched off fold away and are counted', JSON.stringify(kbPvFold([false, true, true, true])) === JSON.stringify({ fold: true, waiting: 3 }))
  ok('...but with none working, or none waiting, nothing folds (a fold over the whole page would hide the page)', kbPvFold([true, true]).fold === false && kbPvFold([false, false]).fold === false && kbPvFold([]).fold === false && kbPvFold(null).waiting === 0)
  ok('the fold is a button that names the count, opens by itself for a provider just added, and keeps the old cards intact', has("'data-kbm': 'prov-wait-toggle'") && has("m('kb.pv.wait.n', { n: fold.waiting })") && has('patch({ drawer: null, busy: false, waitOpen: true,') && has('const renderDsCard = (c) => {'))
}

console.log('\n── a score on each model, a filter and a sort on it (V-37) ──')
{
  const bl = (name) => { const i = src.indexOf('// ' + name + '-BEGIN'); const j = src.indexOf('// ' + name + '-END'); return src.slice(i, j) }
  const { kbScoreRank, kbScoreSteps } = new Function(bl('KB-SCORE-PURE') + '\nreturn { kbScoreRank, kbScoreSteps }')()
  ok('a model with a score sorts by it, one without goes after them all', kbScoreRank(52.3) > kbScoreRank(32) && kbScoreRank(0) > kbScoreRank(undefined) && kbScoreRank(null) === -1 && kbScoreRank('x') === -1 && kbScoreRank(NaN) === -1)
  ok('the filter offers steps only up to what the list reaches', JSON.stringify(kbScoreSteps({ a: 32, b: 52.3 })) === JSON.stringify([10, 20, 30, 40, 50]) && JSON.stringify(kbScoreSteps({ a: 9 })) === JSON.stringify([]) && kbScoreSteps({}).length === 0 && kbScoreSteps(null).length === 0)
  const has = (frag) => src.includes(frag)
  ok('the badge reads « II 32 » with the source in its tooltip, and sits in the model cell', has("'data-kbm': 'row-score'") && has("'II ' + String(KBM.scoreOf[mo.route + '/' + mo.id])") && has("m('kb.models.score.badge', { n: KBM.scoreOf[mo.route + '/' + mo.id] })"))
  ok('the Score filter and the Score sort exist only once a score is known, and the filter is part of « reset »', has("kbScoreSteps(KBM.scoreOf).length > 0 ? h(Menu, { id: 'score', field: 'score'") && has("Object.keys(KBM.scoreOf).length > 0 ? [{ v: 'score'") && has("UI.statut !== 'any' || UI.score !== 'any'") && has("UI.score = 'any'"))
  ok('the whole list is scored in ONE call, when the Models tab is up, and again for a newer snapshot — never on every render', has("fetch('/kybernos-models/scores/list'") && has("React.useEffect(() => { if (UI.tab !== 'providers') kbMScoreListLoad(false) })") && has('if (KBM.scoreLoaded === true && force !== true) return false') && has('if (KBM.scoreAtSeen !== KBM.scoresAt) { KBM.scoreAtSeen = KBM.scoresAt; KBM.scoreLoaded = false }'))
  ok('a fresh install can ask for the scores (V-37): a « Load model scores » button shows while no score is known, forces ONE sync, waits for the job to end, then reads the column again; nothing is read before the click',
    has("'data-kbm': 'scores-load'") && has('KBM.live === true && Object.keys(KBM.scoreOf).length === 0') && has('const started = await kbMScoresRefresh(true)') && has("fetch('/kybernos-models/scores/status')") && has('return kbMScoreListLoad(true)') && !/useEffect\([^\n]*kbMScoresStart/.test(src))
  ok('its two strings exist in French and English', ['kb.models.scores.load', 'kb.models.scores.loadHint'].every((k) => new RegExp("'" + k.replace(/\./g, '\\.') + "': \\{ kybernos: '[^']+', en: '[^']+' \\}").test(src)))
  ok('the score strings exist in French and English', ['kb.models.tri.score', 'kb.models.filter.score', 'kb.models.score.any', 'kb.models.score.min', 'kb.models.score.badge'].every((k) => new RegExp("'" + k.replace(/\./g, '\\.') + "': \\{ kybernos: '[^']+', en: '[^']+' \\}").test(src)))
}

console.log('\n── strings: every new key in French and English ──')
const keys = [...src.matchAll(/'(kb\.(?:prov\.(?:off|on)\.[a-z.]+|prov\.add\.err\.parque|pv\.[a-z.]+|nat\.[a-z.]+|health\.[a-z.]+|fetch\.[a-z.]+|ds\.[a-z.]+))': \{ kybernos: '((?:[^'\\]|\\.)*)', en: '((?:[^'\\]|\\.)*)' \}/g)]
ok('the new keys are all declared', keys.length >= 70, keys.length)
ok('each has a French and an English text', keys.every((k) => k[2].length > 0 && k[3].length > 0))
ok('placeholders match between French and English', keys.every((k) => (k[2].match(/\{[a-z]+\}/g) || []).sort().join() === (k[3].match(/\{[a-z]+\}/g) || []).sort().join()), keys.filter((k) => (k[2].match(/\{[a-z]+\}/g) || []).sort().join() !== (k[3].match(/\{[a-z]+\}/g) || []).sort().join()).map((k) => k[1]).join())
ok('every kb.prov.off/on, kb.pv, kb.nat, kb.health, kb.fetch and kb.ds key used in the code is declared (a trailing dot is a computed key: kb.pv.err.<reason>)', [...src.matchAll(/m\('(kb\.(?:prov\.(?:off|on)\.[a-z.]+|prov\.add\.err\.parque|pv\.[a-z.]+|nat\.[a-z.]+|health\.[a-z.]+|fetch\.[a-z.]+|ds\.[a-z.]+))'/g)].filter((u) => !u[1].endsWith('.')).every((u) => keys.some((k) => k[1] === u[1])) && ['pick', 'slug', 'taken', 'url', 'template', 'models'].every((r) => keys.some((k) => k[1] === 'kb.pv.err.' + r)))

console.log('\n── the Add provider form and the provider drawer say what they do (audit A3-01, A3-07, A3-09) ──')
ok('Custom API: when no model has an ID the form says why Create is off (kb.pv.err.models), instead of « no models will be shown »', has("required: true, probe: kbFetchProbe(null, dr)") && has("(required === true ? 'kb.pv.err.models' : 'kb.pv.models.none')") && has('required === true && rows.length > 0 && kbPvRows(rows).length === 0'))
ok('...and the disabled Create button carries the reason as its tooltip', has("title: block !== null ? m('kb.pv.err.' + block) : undefined"))
ok('...the footer hint nothing displayed is gone', !has("const hint = block === 'slug' || block === 'taken'"))
ok('the enable switch of the drawer reads as the state it is in: « Enabled », not « Disable »', has("'kb.pv.zone.off': { kybernos: 'Activé', en: 'Enabled' }") && has("'kb.pv.sw.aria': { kybernos: '{slug} activé', en: '{slug} enabled' }"))
ok('...a switch is named by what it controls, never by the action it would do', has("'aria-label': m('kb.pv.sw.aria', { slug: route })") && !has("title: why, 'aria-label': why"))
ok('Escape closes the confirmation and not the drawer behind it (window capture, ahead of the drawer\'s own document capture)', has('const confirming = ui.dlg !== null') && has("window.addEventListener('keydown', key, true)") && has("setUi((u) => ({ ...u, dlg: null, typed: '' }))"))

console.log('\n── provider logos never ask a third party (A6-13) ──')
{
  const lBegin = src.indexOf('// KB-LOGO-PURE-BEGIN')
  const lEnd = src.indexOf('// KB-LOGO-PURE-END')
  ok('the logo block is delimited', lBegin > 0 && lEnd > lBegin)
  const { kbLogoLocalId } = new Function(src.slice(lBegin, lEnd) + '\nreturn { kbLogoLocalId }')()
  const cat = [{ id: 'google', logo: true }, { id: 'alibaba', logo: true }, { id: 'ollama-cloud', logo: true }, { id: 'anthropic', logo: true }, { id: 'acme', logo: false }, { id: 'mistral', logo: 'mistralai' }]
  ok('a slug that is a local logo id keeps it', kbLogoLocalId('anthropic', cat) === 'anthropic')
  ok('simple-icons names map to the logos the bundle ships (gemini → google, qwen → alibaba, ollama → ollama-cloud)', ['googlegemini', 'qwen', 'ollama'].map((x) => kbLogoLocalId(x, cat)).join() === 'google,alibaba,ollama-cloud')
  ok('a provider without a shipped logo gets none (its initial is shown, nothing is fetched)', kbLogoLocalId('acme', cat) === null && kbLogoLocalId('unknown', cat) === null && kbLogoLocalId('mistralai', cat) === null)
  ok('only a catalogue entry that says logo:true counts (the short built-in list carries slugs, not files)', kbLogoLocalId('mistral', cat) === null)
  ok('a missing catalogue or a hostile slug is no logo, not an error', kbLogoLocalId('google', null) === null && kbLogoLocalId('__proto__', cat) === null && kbLogoLocalId('constructor', cat) === null && kbLogoLocalId(undefined, cat) === null)
  ok('no third-party image host is left in the page', !/cdn\.simpleicons\.org/.test(src.replace(/\/\/[^\n]*/g, '')), (src.match(/cdn\.simpleicons\.org[^\n]{0,40}/) || [])[0])
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
