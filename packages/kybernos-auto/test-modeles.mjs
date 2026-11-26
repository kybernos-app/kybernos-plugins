#!/usr/bin/env node
/** The models Auto may pick from (modeles.mjs): the scopes « all models » / « free models » / the typed list, the check of what is
 *  typed (A3-24), and the reading of the host's services. No network, no disk. */
import { SCOPES, estLibre, etendre, formeOk, modelesConnus, refuserListe, scopeEnVigueur } from './modeles.mjs'

let ok0 = 0
let ko = 0
const ok = (nom, cond, detail) => {
  if (cond === true) { ok0 += 1; console.log('  ✓ ' + nom) } else { ko += 1; console.log('  ✗ ' + nom + (detail !== undefined ? ' → ' + JSON.stringify(detail).slice(0, 240) : '')) }
}

const m = (route, id, extra = {}) => ({ route, id, cle: route + '/' + id, connecte: true, locale: false, ...extra })
const MODELES = [
  m('openrouter', 'anthropic/claude-opus-4'), m('openrouter', 'cohere/north-mini-code:free'), m('groq', 'llama-3.3-70b'), m('groq', 'gemma-2-9b-flash'),
  m('opencode-free', 'big-pickle'), m('kybernos', 'auto'), m('ollama-local', 'qwen3.5:4b', { locale: true }), m('nvidia', 'nv-embed-v2'),
  m('anthropic', 'claude-haiku-4', { connecte: false }), m('deepseek', 'deepseek-chat'),
]

console.log('── the scope in force ──')
ok('the three scopes', SCOPES.join() === 'all,free,custom')
ok('a stored scope wins', scopeEnVigueur('free', ['a/b']) === 'free' && scopeEnVigueur('custom', []) === 'custom' && scopeEnVigueur('all', ['a/b']) === 'all')
ok('nothing stored and nothing typed: « all models » (a fresh install needs no list)', scopeEnVigueur(undefined, []) === 'all' && scopeEnVigueur('junk', []) === 'all' && scopeEnVigueur(undefined, undefined) === 'all')
ok('nothing stored but a list typed before scopes existed: that list stays the list', scopeEnVigueur(undefined, ['deepseek-official/deepseek-chat']) === 'custom')

console.log('\n── which models are free ──')
ok('the Free LLMs route, a « :free » id, a « -free » id and a local model are free', estLibre(m('opencode-free', 'big-pickle')) && estLibre(m('openrouter', 'x/y:free')) && estLibre(m('p', 'model-free')) && estLibre(m('ollama-local', 'q', { locale: true })))
ok('a paid model is not', !estLibre(m('openrouter', 'anthropic/claude-opus-4')) && !estLibre(m('groq', 'llama-3.3-70b')) && !estLibre(m('p', 'freedom-1')))

console.log('\n── the list a scope gives ──')
const tous = etendre('all', [], MODELES)
ok('« all models »: the connected models only (anthropic has no key here), no embedding model', tous.indexOf('anthropic/claude-haiku-4') < 0 && tous.indexOf('nvidia/nv-embed-v2') < 0 && tous.length === 8, tous)
ok('the Kybernos Cloud comes first, a local model last', tous[0] === 'kybernos/auto' && tous[tous.length - 1] === 'ollama-local/qwen3.5:4b', tous)
ok('cheap models come before costly ones (opus after the flash and the chat model)', tous.indexOf('groq/gemma-2-9b-flash') < tous.indexOf('openrouter/anthropic/claude-opus-4') && tous.indexOf('deepseek/deepseek-chat') < tous.indexOf('openrouter/anthropic/claude-opus-4'), tous)
ok('the order is stable: the same input, the same list', JSON.stringify(etendre('all', [], MODELES.slice().reverse())) === JSON.stringify(tous))
const libres = etendre('free', ['x/typed'], MODELES)
ok('« free models »: the Free LLMs route, the « :free » id and the local model, nothing else', libres.slice().sort().join() === ['ollama-local/qwen3.5:4b', 'openrouter/cohere/north-mini-code:free', 'opencode-free/big-pickle'].sort().join(), libres)
ok('« my list »: exactly what was typed, the models are not looked at', etendre('custom', ['a/b', 'c/d'], MODELES).join() === 'a/b,c/d' && etendre('custom', ['a/b'], null).join() === 'a/b')
ok('nothing known (no service): an empty list, never a made-up one', etendre('all', ['a/b'], null).length === 0 && etendre('free', [], undefined).length === 0 && etendre('all', [], []).length === 0)
ok('junk in the models is skipped, a duplicate is listed once', etendre('all', [], [null, 7, { route: '', id: 'x' }, { route: 'r' }, m('r', 'a'), m('r', 'a')]).join() === 'r/a')

console.log('\n── what is typed (A3-24) ──')
const junk = ['model-only', 'a b/c d', '../../etc/passwd', '<script>/x', '🙂/🙂', 'x/' + 'y'.repeat(300), '', '/x', 'x/']
ok('the six entries of the audit and the usual junk are not of the form provider/model', junk.every((x) => formeOk(x) === false), junk.filter((x) => formeOk(x)).join('|'))
ok('a real one is', ['deepseek-official/deepseek-chat', 'openrouter/anthropic/claude-sonnet-4.5', 'groq/llama-3.3-70b', 'ollama-local/qwen3.5:4b', 'x/Qwen/Qwen3-235B-A22B-Instruct-2507'].every(formeOk))
ok('a model with a double dot is refused (path walking)', formeOk('a/b..c') === false)
const connus = new Set(MODELES.map((x) => x.cle))
ok('a bad form is refused first, with the entries named', JSON.stringify(refuserListe(['groq/llama-3.3-70b', 'model-only'], connus)) === JSON.stringify({ code: 'forme', cles: ['model-only'] }))
ok('a well-formed model the profile does not have is refused as unknown', JSON.stringify(refuserListe(['groq/llama-3.3-70b', 'groq/typo-9'], connus)) === JSON.stringify({ code: 'inconnu', cles: ['groq/typo-9'] }))
ok('known models pass', refuserListe(['groq/llama-3.3-70b', 'kybernos/auto'], connus) === null && refuserListe([], connus) === null)
ok('a host that cannot read the profile judges the form only (it must not refuse what it cannot see)', refuserListe(['groq/anything'], null) === null && refuserListe(['groq/anything'], new Set()) === null && refuserListe(['nope'], null).code === 'forme')
ok('a model the profile itself declares is accepted whatever its spelling', refuserListe(['p/Weird Model (preview)'], new Set(['p/Weird Model (preview)'])) === null)

console.log('\n── reading the host\'s services ──')
const settings = { describe: async () => [{ ns: 'llm-pi-ai', value: { providers: {
  groq: { baseURL: 'https://api.groq.com/openai/v1', apiKeyEnv: 'GROQ_API_KEY', models: [{ id: 'llama-3.3-70b' }, { id: 'gemma-2-9b-flash' }, { id: 'llama-3.3-70b' }] },
  anthropic: { apiKeyEnv: 'ANTHROPIC_API_KEY', modelOverrides: { 'claude-haiku-4': {} } },
  'ollama-local': { baseURL: 'http://127.0.0.1:11434/v1', models: [{ id: 'qwen3.5:4b' }] },
  empty: { baseURL: 'https://x' },
} } }, { ns: 'other', value: {} }] }
const credentials = { describe: async (ref) => ({ configured: ref === 'GROQ_API_KEY' }) }
const lus = await modelesConnus({ settings, credentials })
ok('every model of every provider, once, with its route', lus !== null && lus.map((x) => x.cle).sort().join() === ['anthropic/claude-haiku-4', 'groq/gemma-2-9b-flash', 'groq/llama-3.3-70b', 'ollama-local/qwen3.5:4b'].join(), lus)
ok('a provider is connected when its key exists, or when it names none', lus.find((x) => x.route === 'groq').connecte === true && lus.find((x) => x.route === 'anthropic').connecte === false && lus.find((x) => x.route === 'ollama-local').connecte === true)
ok('a model on this machine is told apart (loopback address)', lus.find((x) => x.route === 'ollama-local').locale === true && lus.find((x) => x.route === 'groq').locale === false)
ok('a remote settings service ({ok, value:{namespaces}}) reads the same', (await modelesConnus({ settings: { describe: async () => ({ ok: true, value: { namespaces: [{ ns: 'llm-pi-ai', value: { providers: { a: { models: [{ id: 'm' }] } } } }] } }) } })).map((x) => x.cle).join() === 'a/m')
ok('no service, a service that throws, or no llm-pi-ai namespace: null (nothing known), never an exception', await modelesConnus({}) === null && await modelesConnus({ settings: { describe: async () => { throw new Error('boom') } } }) === null && await modelesConnus({ settings: { describe: async () => [{ ns: 'x', value: {} }] } }) === null && await modelesConnus() === null)
ok('a credentials service that fails reads as connected (a wrongly skipped model would cost more than a failing call)', (await modelesConnus({ settings, credentials: { describe: async () => { throw new Error('x') } } })).every((x) => x.connecte === true))
ok('the key itself is never asked for, only whether it exists', (await (async () => { const asked = []; await modelesConnus({ settings, credentials: { describe: async (r) => { asked.push(r); return { configured: true, value: 'SECRET' } } } }); return asked.every((r) => typeof r === 'string') })()))

console.log('\n' + (ko === 0 ? 'MODELES VERT — ' + ok0 + ' contrôles ✓' : ko + ' échec(s) sur ' + (ok0 + ko)))
process.exit(ko === 0 ? 0 : 1)
