#!/usr/bin/env node
/** The automatic Study model (WP-08, N-02).
 *
 *  The Study model used to be empty by default: nothing was watched and nothing could judge a case. Now an empty setting
 *  means « Automatic »: the model of the connected Kybernos Cloud, else a small model of the person's connected providers
 *  that answers, else a small local Ollama model. This test pins the pure choice (`choisirEtudeAuto`) and the reading of the
 *  host's services (`modelesConnectes`), with fakes: no engine, no network, no key.
 *
 *  Usage: node packages/kybernos-sessions/test-etude-auto.mjs   (exit 0 = all pass) */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { choisirEtudeAuto, modelesConnectes, ecartesDe, garderConnectes } from './etude-auto.mjs'
import { monterRoutes } from './index.js'

let ok0 = 0
let ko = 0
const ok = (nom, cond, detail) => {
  if (cond === true) { ok0 += 1; console.log('  ✓ ' + nom) } else { ko += 1; console.log('  ✗ ' + nom + (detail !== undefined ? ' → ' + JSON.stringify(detail).slice(0, 400) : '')) }
}
const m = (cle, extra = {}) => { const i = cle.indexOf('/'); return { route: cle.slice(0, i), id: cle.slice(i + 1), cle, connecte: true, ...extra } }
const choisi = (cles, extra) => choisirEtudeAuto({ modeles: cles.map((c) => (typeof c === 'string' ? m(c) : c)), ...extra })

console.log('\n── the order: Kybernos Cloud, then a small connected model, then a small local one ──')
{
  const r = choisi(['openai/gpt-5-mini', 'kybernos/auto', 'ollama-local/qwen2.5:3b', 'anthropic/claude-haiku-4'])
  ok('the connected Kybernos Cloud comes first, whatever else is there', r !== null && r.cle === 'kybernos/auto' && r.raison === 'cloud', r)
  const sans = choisi(['openai/gpt-5', 'openai/gpt-5-mini', 'anthropic/claude-opus-4', 'ollama-local/qwen2.5:3b'])
  ok('without the cloud: the small connected model, not the big ones', sans !== null && sans.cle === 'openai/gpt-5-mini' && sans.raison === 'petit', sans)
  const local = choisi(['ollama-local/llama3.1:8b', 'ollama-local/qwen2.5:3b', 'ollama-local/phi3:14b'])
  ok('only local models: the smallest one', local !== null && local.cle === 'ollama-local/qwen2.5:3b' && local.raison === 'local', local)
  const mixte = choisi(['ollama-local/qwen2.5:3b', 'openai/gpt-5'])
  ok('a connected cloud provider wins over a local model (even a big one) — the local one is the last resort', mixte !== null && mixte.cle === 'openai/gpt-5' && mixte.raison === 'petit', mixte)
  ok('nothing to choose from → null', choisi([]) === null && choisirEtudeAuto({}) === null && choisirEtudeAuto() === null && choisirEtudeAuto({ modeles: 'x' }) === null)
}

console.log('\n── which Cloud model ──')
{
  const r = choisi(['kybernos/pro-max', 'kybernos/auto', 'kybernos/flash'])
  ok('« auto » when the cloud offers it', r.cle === 'kybernos/auto', r)
  const r2 = choisi(['kybernos/opus-class', 'kybernos/flash-lite', 'kybernos/standard'])
  ok('else its smallest model', r2.cle === 'kybernos/flash-lite', r2)
}

console.log('\n── only a model that is connected, a chat model, and one that answers ──')
{
  ok('a provider with no key is ignored', choisi([m('openai/gpt-5-mini', { connecte: false }), 'anthropic/claude-sonnet-4']).cle === 'anthropic/claude-sonnet-4')
  ok('the Cloud with no token is ignored too', choisi([m('kybernos/auto', { connecte: false }), 'ollama-local/qwen2.5:3b']).cle === 'ollama-local/qwen2.5:3b')
  ok('an embedding, speech or image model is never the Study model', choisi(['openai/text-embedding-3-small', 'openai/whisper-1', 'openai/gpt-image-1', 'openai/tts-1']) === null)
  ok('a model declared without text input is left out', choisi([m('google/flash-banana', { entree: ['image'] }), m('google/gemini', { entree: ['text', 'image'] })]).cle === 'google/gemini')
  ok('a model that does not declare its input is kept (« not declared » is not « no text »)', choisi([m('google/gemini-flash', { entree: [] })]).cle === 'google/gemini-flash' && choisi([m('google/gemini-flash', { entree: null })]).cle === 'google/gemini-flash')
  const ecartes = new Set(['kybernos/auto', 'openai/gpt-5-mini'])
  const r = choisi(['kybernos/auto', 'openai/gpt-5-mini', 'anthropic/claude-haiku-4', 'ollama-local/qwen2.5:3b'], { ecartes })
  ok('a model the last health probe saw failing is skipped, the next one answers', r.cle === 'anthropic/claude-haiku-4', r)
  const tous = choisi(['kybernos/auto', 'ollama-local/qwen2.5:3b'], { ecartes: new Set(['kybernos/auto', 'ollama-local/qwen2.5:3b']) })
  ok('every model failing → nothing (the local word rules answer instead)', tous === null, tous)
  ok('reasoning and very large models are the last choice but still a choice', choisi(['deepseek/deepseek-r1', 'openai/gpt-5-thinking']) !== null)
  ok('...and a plain model beats them', choisi(['deepseek/deepseek-r1', 'deepseek/deepseek-chat']).cle === 'deepseek/deepseek-chat')
}

console.log('\n── it is stable ──')
{
  const liste = ['openai/gpt-5-mini', 'anthropic/claude-haiku-4', 'google/gemini-2.5-flash', 'ollama-local/qwen2.5:3b']
  const a = choisi(liste)
  const b = choisi(liste.slice().reverse())
  ok('the same models in another order give the same choice (no flapping from one reading to the next)', a.cle === b.cle, [a, b])
}

console.log('\n── reading the host: connected = the profile exists and its key is configured ──')
{
  const profils = {
    kybernos: { apiKeyEnv: 'KYBERNOS_TOKEN', models: [{ id: 'auto' }] },
    openai: { apiKeyEnv: 'OPENAI_API_KEY', models: [{ id: 'gpt-5-mini', input: ['text'] }, { id: 'gpt-5' }] },
    anthropic: { apiKeyEnv: 'ANTHROPIC_API_KEY', modelOverrides: { 'claude-haiku-4': { input: ['text', 'image'] } } },
    'ollama-local': { baseURL: 'http://127.0.0.1:11434/v1', models: [{ id: 'qwen2.5:3b' }] },
    lmstudio: { baseURL: 'http://localhost:1234/v1', apiKeyEnv: 'LMSTUDIO_KEY', models: [{ id: 'some-7b' }] },
    vide: { apiKeyEnv: 'X', models: [] }
  }
  const settings = { describe: () => [{ ns: 'agent-default-model', value: {} }, { ns: 'llm-pi-ai', value: { providers: profils } }] }
  const configures = { KYBERNOS_TOKEN: true, OPENAI_API_KEY: false, ANTHROPIC_API_KEY: true, LMSTUDIO_KEY: true }
  const appels = []
  const credentials = { describe: async (ref) => { appels.push(ref); return { configured: configures[ref] === true } } }
  const liste = await modelesConnectes({ settings, credentials })
  const par = (cle) => liste.find((x) => x.cle === cle)
  ok('every model of every profile is listed, with its route and id', liste.length === 6 && par('openai/gpt-5-mini') !== undefined && par('anthropic/claude-haiku-4') !== undefined, liste.map((x) => x.cle))
  ok('a profile whose key reference is configured is connected, one whose key is not, is not', par('kybernos/auto').connecte === true && par('openai/gpt-5').connecte === false && par('anthropic/claude-haiku-4').connecte === true, liste)
  ok('a profile with no key reference (a local engine, an account) is connected', par('ollama-local/qwen2.5:3b').connecte === true)
  ok('a local engine is flagged local (Ollama by name, any loopback address by URL)', par('ollama-local/qwen2.5:3b').locale === true && par('lmstudio/some-7b').locale === true && par('openai/gpt-5').locale !== true, liste)
  ok('the declared input modalities travel with the model', JSON.stringify(par('openai/gpt-5-mini').entree) === '["text"]' && par('openai/gpt-5').entree === null, liste)
  ok('a key reference is asked once however many models share it', appels.filter((r) => r === 'OPENAI_API_KEY').length === 1, appels)
  ok('only the existence of a key is asked, never its value', appels.every((r) => typeof r === 'string') && typeof credentials.resolve === 'undefined')
  const r = choisirEtudeAuto({ modeles: liste })
  ok('end to end: the connected Cloud wins', r.cle === 'kybernos/auto' && r.raison === 'cloud', r)
  const sansNuage = choisirEtudeAuto({ modeles: liste.filter((x) => x.route !== 'kybernos') })
  ok('...then the connected small model (the OpenAI one has no key here)', sansNuage.cle === 'anthropic/claude-haiku-4', sansNuage)
}
{
  const settings = { describe: () => [{ ns: 'llm-pi-ai', value: { providers: { openai: { apiKeyEnv: 'K', models: [{ id: 'gpt-5-mini' }] } } } }] }
  const sans = await modelesConnectes({ settings })
  ok('no credentials service: a provider is taken as connected (a failing call costs nothing)', sans.length === 1 && sans[0].connecte === true, sans)
  const plante = await modelesConnectes({ settings, credentials: { describe: async () => { throw new Error('x') } } })
  ok('a credentials service that throws: taken as connected, never an exception', plante.length === 1 && plante[0].connecte === true, plante)
  ok('the remote settings shape (a promise of { ok, value: { namespaces } }) is read too', (await modelesConnectes({ settings: { describe: async () => ({ ok: true, value: { namespaces: [{ ns: 'llm-pi-ai', value: { providers: { a: { models: [{ id: 'b' }] } } } }] } }) } })).length === 1)
  ok('no settings service, a throwing one, a malformed namespace → an empty list', (await modelesConnectes({})).length === 0 &&
    (await modelesConnectes({ settings: { describe: () => { throw new Error('x') } } })).length === 0 &&
    (await modelesConnectes({ settings: { describe: () => [{ ns: 'llm-pi-ai', value: 'oops' }] } })).length === 0 &&
    (await modelesConnectes()).length === 0)
}

console.log('\n── what the last health probe saw failing ──')
{
  const vide = ecartesDe(null)
  ok('no probe yet → nothing is excluded', vide instanceof Set && vide.size === 0 && ecartesDe(undefined).size === 0 && ecartesDe({ actif: false }).size === 0)
  const sonde = {
    actif: true, tousEnEchec: false,
    modeles: [{ cle: 'a/ok', etat: 'ok' }, { cle: 'a/mute', etat: 'muet' }, { cle: 'a/err', etat: 'erreur' }, { cle: 'a/lim', etat: 'limite' }, { cle: 'a/net', etat: 'reseau' }, { cle: 'a/off', etat: 'hors-jeu' }]
  }
  const e = ecartesDe(sonde)
  ok('silent, refused, rate-limited and not-a-chat-model are excluded; a network failure says nothing about the model',
    e.has('a/mute') && e.has('a/err') && e.has('a/lim') && e.has('a/off') && !e.has('a/ok') && !e.has('a/net'), [...e])
  ok('when EVERY model failed the probe says the network is down, not the models: nothing is excluded', ecartesDe({ ...sonde, tousEnEchec: true }).size === 0)
}

console.log('\n── Automatic watches what is connected, not every model of the profile ──')
{
  const tous = [m('kybernos/auto', { connecte: false }), m('openai/gpt-5-mini'), m('openai/gpt-5', { connecte: false }), m('ollama-local/qwen2.5:3b')]
  ok('only the connected models are kept, in their order', JSON.stringify(garderConnectes(tous.map((x) => x.cle), tous)) === JSON.stringify(['openai/gpt-5-mini', 'ollama-local/qwen2.5:3b']), garderConnectes(tous.map((x) => x.cle), tous))
  ok('a model the host does not know is kept (the page knows better than the host: never hide a model it asked about)', garderConnectes(['x/unknown', 'openai/gpt-5'], tous).join() === 'x/unknown')
  ok('junk in, no exception', Array.isArray(garderConnectes(null, null)) && garderConnectes(undefined, undefined).length === 0 && garderConnectes(['a/b'], 'oops').join() === 'a/b')
}

console.log('\n── through the host: the settings answer, the health switch, the published contract ──')
{
  const racine = mkdtempSync(join(tmpdir(), 'ksess-etude-'))
  mkdirSync(join(racine, 'kybernos'), { recursive: true })
  const reglages = join(racine, 'kybernos', 'settings.json')
  const poser = (objet) => writeFileSync(reglages, JSON.stringify(objet))
  poser({})
  let horloge = 5_000_000
  const profils = {
    kybernos: { apiKeyEnv: 'KT', models: [{ id: 'auto' }] },
    openai: { apiKeyEnv: 'OK', models: [{ id: 'gpt-5-mini' }, { id: 'gpt-5' }] },
    'ollama-local': { models: [{ id: 'qwen2.5:3b' }] }
  }
  let nuageConnecte = true
  const services = {
    settings: { describe: () => [{ ns: 'llm-pi-ai', value: { providers: profils } }] },
    credentials: { describe: async (ref) => ({ configured: ref === 'KT' ? nuageConnecte : true }) },
    llm: {
      stream (p) {
        // The Cloud model fails the probe (a bad key, say); every other model answers.
        const panne = p.provider === 'kybernos'
        return (async function * () { yield { type: 'finish', reason: panne ? { kind: 'error', failure: { code: 'AUTH', message: 'bad key' } } : { kind: 'stop' } } })()
      }
    }
  }
  const routes = {}
  const PORT = 3080
  const GLOBAL = Symbol.for('kybernos.studyModel')
  delete globalThis[GLOBAL]
  monterRoutes({ register: (r) => { routes[r.path] = r.handler } }, { reglagesPath: reglages, categoriesPath: join(racine, 'kybernos', 'categories.json'), sessionsHome: join(racine, 'sessions'), ctx: { get: (n) => services[n] }, maintenant: () => horloge })
  const requete = (method, path, corps) => ({ method, url: path, headers: { origin: 'http://127.0.0.1:' + PORT }, socket: { localPort: PORT }, on (ev, cb) { if (ev === 'data' && corps !== undefined) cb(JSON.stringify(corps)); if (ev === 'end') cb() } })
  const reponse = () => { const r = { code: null, corps: null, writeHead (c) { r.code = c }, end (t) { try { r.corps = JSON.parse(t) } catch (e) { r.corps = t } } }; return r }
  const appeler = async (method, path, corps) => { const r = reponse(); await routes[path](requete(method, path, corps), r); return r.corps }
  const etude = async () => (await appeler('GET', '/kybernos-sessions/settings')).etude

  let e = await etude()
  ok('Automatic, the Cloud connected: the settings answer names it, and says why', e.mode === 'auto' && e.cle === 'kybernos/auto' && e.raison === 'cloud' && e.actif === true && e.auto === 'kybernos/auto', e)
  const publie = globalThis[GLOBAL]
  ok('the automatic Study model is published for the bundles that cannot import this one (Memory), as a plain function', typeof publie === 'function' && publie() === 'kybernos/auto', typeof publie)
  const sonde = await appeler('POST', '/kybernos-sessions/brain/health', { models: ['kybernos/auto', 'openai/gpt-5-mini', 'ollama-local/qwen2.5:3b'], force: true })
  // 2026-10-28: our own gateway is never pinged — it meters and bills what it receives, and one sweep of the old
  // probe was 78 paid calls. The Cloud model is left out by name, and the answer says so.
  ok('the probe never asks our own gateway: the Cloud model is left out, and the answer says so', sonde.actif === true && sonde.alertes.length === 0 && sonde.ecartes.some((x) => x.cle === 'kybernos/auto'), sonde)
  ok('...and the other (connected, free-to-ping) models were probed: none left out by mistake', sonde.total === 2, sonde.total)
  horloge += 61 * 1000
  e = await etude()
  ok('...and the automatic choice does not move for a probe that never ran: it stays on the Cloud', e.cle === 'kybernos/auto' && e.raison === 'cloud' && e.auto === 'kybernos/auto', e)
  ok('...and the published function still follows the choice (the Cloud, since no probe moved it)', publie() === 'kybernos/auto')
  nuageConnecte = false
  horloge += 61 * 1000
  const auto2 = await appeler('POST', '/kybernos-sessions/brain/health', { models: ['kybernos/auto', 'openai/gpt-5-mini', 'ollama-local/qwen2.5:3b'], force: true })
  ok('the Cloud has no token any more: Automatic does not probe it (it would shout « not answering » for a model nobody connected)', auto2.total === 2 && auto2.alertes.length === 0, { total: auto2.total, alertes: auto2.alertes })
  poser({ brain: 'ollama-local/qwen2.5:3b' })
  const choisi2 = await appeler('POST', '/kybernos-sessions/brain/health', { models: ['kybernos/auto', 'openai/gpt-5-mini', 'ollama-local/qwen2.5:3b'], force: true })
  ok('...while a person who picked their Study model gets the same guard: the gateway stays out', choisi2.total === 2 && choisi2.alertes.length === 0 && choisi2.ecartes.some((x) => x.cle === 'kybernos/auto'), { total: choisi2.total, alertes: choisi2.alertes.map((x) => x.cle) })
  e = await etude()
  ok('a pick wins over Automatic, and Automatic is still named for the select', e.mode === 'choisi' && e.cle === 'ollama-local/qwen2.5:3b' && e.auto !== '', e)
  poser({ brain: 'none' })
  const eteint = await appeler('POST', '/kybernos-sessions/brain/health', { models: ['openai/gpt-5-mini'], force: true })
  ok('None: no probe at all (nobody watches)', eteint.actif === false && (await etude()).actif === false, eteint)
  poser({ brain: '' })
  services.settings = undefined
  horloge += 61 * 1000
  e = await etude()
  ok('Automatic with the settings service gone: nothing found, nothing watched, no exception', e.mode === 'aucun' && e.actif === false && e.cle === '', e)
  // A plugin's host half sees a service through `ctx.get` only when it declared it: the real DSH answers `undefined` for
  // `credentials` there, while the root context holds it. The choice must read it from the root, or every provider looks
  // connected (measured on a sandbox with no account: the Cloud was picked).
  {
    const racines = { settings: { describe: () => [{ ns: 'llm-pi-ai', value: { providers: profils } }] }, credentials: { describe: async (ref) => ({ configured: ref === 'OK' }) } }
    const routes2 = {}
    monterRoutes({ register: (r) => { routes2[r.path] = r.handler } }, { reglagesPath: reglages, categoriesPath: join(racine, 'kybernos', 'categories.json'), sessionsHome: join(racine, 'sessions'), ctx: { get: (n) => (n === 'llm' ? services.llm : undefined), root: racines }, maintenant: () => horloge })
    const r = reponse()
    poser({})
    await routes2['/kybernos-sessions/settings'](requete('GET', '/kybernos-sessions/settings'), r)
    ok('credentials read from the root context: only the provider whose key is configured counts (the Cloud has none → OpenAI)', r.corps.etude.cle === 'openai/gpt-5-mini' && r.corps.etude.raison === 'petit', r.corps.etude)
  }
  rmSync(racine, { recursive: true, force: true })
  delete globalThis[GLOBAL]
}

console.log('\nETUDE AUTO — ' + (ok0 + ko) + ' assertions, ' + ko + ' failure(s)')
process.exit(ko === 0 ? 0 : 1)
