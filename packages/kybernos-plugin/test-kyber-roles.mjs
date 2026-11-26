#!/usr/bin/env node
// Which provider and model the roles of a new Agent Team are written with (the owner, 2026-11-08: « every static model goes »):
// the model the person chose, never one a plugin picked in advance. Also the guard that fails if a built-in model or provider comes back
// in a role default, in a template of the marketplace, or as a frozen « available models » list.
//
//   cd packages/kybernos-plugin && node test-kyber-roles.mjs
import { readFileSync } from 'node:fs'
import { hasEntry } from './lib-i18n-test.mjs'
import { defaultRoute, roleRoute, kyberRoles, chatRoute } from './kyber-roles.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}
const slugify = (s) => String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
const route = { provider: 'kybernos', model: 'my-model' }

console.log('the person\'s default route')
check('a default with a provider and a model is kept', JSON.stringify(defaultRoute({ provider: ' kybernos ', model: 'my-model' })) === JSON.stringify(route))
check('no default, an empty one, half of one: none', defaultRoute(null) === null && defaultRoute(undefined) === null && defaultRoute({}) === null && defaultRoute({ provider: 'x' }) === null && defaultRoute({ model: 'y' }) === null && defaultRoute('x') === null)

console.log('one role')
check('no provider and no model: the person\'s route', JSON.stringify(roleRoute({ id: 'a' }, route)) === JSON.stringify(route), roleRoute({ id: 'a' }, route))
check('blank strings count as none', JSON.stringify(roleRoute({ provider: '  ', model: '' }, route)) === JSON.stringify(route))
check('both given: kept, the default does not override them', JSON.stringify(roleRoute({ provider: 'anthropic', model: 'x' }, route)) === JSON.stringify({ provider: 'anthropic', model: 'x' }))
check('only a model: kept, no provider is guessed for it', JSON.stringify(roleRoute({ model: 'x' }, route)) === JSON.stringify({ provider: '', model: 'x' }))
check('only a provider: kept, no model is guessed for it', JSON.stringify(roleRoute({ provider: 'p' }, route)) === JSON.stringify({ provider: 'p', model: '' }))
check('no default in the profile: the role stays undeclared, nothing is invented', JSON.stringify(roleRoute({ id: 'a' }, null)) === JSON.stringify({ provider: '', model: '' }))
check('a null role is fine', JSON.stringify(roleRoute(null, route)) === JSON.stringify(route))

console.log('the roles of a team')
{
  const roles = kyberRoles([{ id: 'Scout', role: 'scout', prompt: ' find ' }, { id: 'doer', provider: 'p', model: 'm' }, null, 'x'], route, slugify, 600)
  check('every role of the request is kept, in order, junk skipped', roles.length === 2 && roles[0].id === 'scout' && roles[1].id === 'doer', roles)
  check('a blank role takes the person\'s model, an explicit one keeps its own', roles[0].provider === 'kybernos' && roles[0].model === 'my-model' && roles[1].provider === 'p' && roles[1].model === 'm', roles)
  check('kind and prompt are carried (prompt trimmed)', roles[0].kind === 'scout' && roles[0].prompt === 'find')
  check('a prompt is cut at the limit', kyberRoles([{ id: 'a', prompt: 'x'.repeat(50) }], route, slugify, 10)[0].prompt.length === 10)
}
{
  const lead = kyberRoles([], route, slugify, 600)
  check('no role at all: one lead on the person\'s model', lead.length === 1 && lead[0].id === 'lead' && lead[0].kind === 'lead' && lead[0].provider === 'kybernos' && lead[0].model === 'my-model', lead)
  const bare = kyberRoles(undefined, null, slugify, 600)
  check('no role and no default model: one lead, undeclared', bare.length === 1 && bare[0].provider === '' && bare[0].model === '', bare)
}

console.log('the YAML helper (Workflow tab) is written to the person\'s model, on that model\'s own provider')
{
  const providers = { kybernos: { baseURL: 'https://api.example.test/v1/', apiKeyEnv: 'KYBERNOS_KEY' }, local: { baseURL: 'http://127.0.0.1:11434/v1' }, broken: {} }
  const mine = chatRoute({ texte: 'x' }, route, providers)
  check('no model in the request: the person\'s default model, on its provider, at its address (no trailing slash) and with the name of its key', mine.ok === true && mine.model === 'my-model' && mine.provider === 'kybernos' && mine.baseUrl === 'https://api.example.test/v1' && mine.ref === 'KYBERNOS_KEY', mine)
  const named = chatRoute({ model: 'other' }, route, providers)
  check('a model named by the request wins, on the default model\'s provider', named.ok === true && named.model === 'other' && named.provider === 'kybernos', named)
  const both = chatRoute({ model: 'm2', provider: 'local' }, route, providers)
  check('a provider named too is used, and a provider with no key has an empty reference (no Authorization header)', both.ok === true && both.provider === 'local' && both.baseUrl === 'http://127.0.0.1:11434/v1' && both.ref === '', both)
  const none = chatRoute({}, null, providers)
  check('no default model and none in the request: it says so, nothing is invented', none.ok === false && none.needsModel === true && /no model chosen/.test(none.error), none)
  const noAddr = chatRoute({}, { provider: 'broken', model: 'm' }, providers)
  const noProv = chatRoute({}, { provider: 'ghost', model: 'm' }, providers)
  const noList = chatRoute({}, route, null)
  check('a provider with no address, an unknown one, or no list at all: it says the provider has no address', [noAddr, noProv, noList].every((r) => r.ok === false && r.needsProvider === true && /has no address/.test(r.error)), [noAddr, noProv, noList])
}

console.log('the wiring (no built-in model comes back)')
const host = readFileSync(new URL('./index.js', import.meta.url), 'utf8')
const client = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
const slice = (src, from, len) => src.slice(src.indexOf(from), src.indexOf(from) + len)
const create = slice(host, 'const createKyber = async (args) => {', 6000)
check('createKyber resolves its roles with the person\'s default model', create.includes('kyberRoles(req.roles, defaultRoute(catalogNow.default), slugify, KB_CREATE_PROMPT_MAX)') && create.includes('const catalogNow = readCatalog()'))
check('createKyber names no provider and no model of its own', !/ollama|glm|deepseek|kimi|claude|gpt-|qwen|moonshot|zhipu/i.test(create))
const ser = slice(host, 'const serializeKyber = (spec) => {', 2500)
check('a role without a provider or a model is written without those lines (not as empty values)', ser.includes("if (typeof r.provider === 'string' && r.provider.length > 0) lines.push('    provider: '") && ser.includes("if (typeof r.model === 'string' && r.model.length > 0) lines.push('    model: '"))
check('the editor can still add the lines to such a role later', host.includes("if (provider !== '' && gotP === false) out.push(pad + 'provider: ' + provider)") && host.includes("if (model !== '' && gotM === false) out.push(pad + 'model: ' + model)"))
const yml = slice(host, 'const kbYmlProposer = async (args) => {', 3200)
check('the YAML helper picks the person\'s model with chatRoute and names no provider, no model and no address of its own', yml.includes('chatRoute(req, defaultRoute(readCatalog().default), kbModelsProviders())') && !/ollama|glm|deepseek|kimi|claude|gpt-|qwen|moonshot|zhipu|kbVoiceProfile|token-plan/i.test(yml), yml.match(/ollama|glm|deepseek|kimi|claude|gpt-|qwen|moonshot|zhipu|kbVoiceProfile|token-plan/gi))
const market = client.slice(client.indexOf('const KB_MARKET_TEAMS = ['), client.indexOf('// Manifest read-only'))
check('the templates of the marketplace name no provider and no model', market.length > 2000 && !/\bprovider:|\bmodel:/.test(market), market.match(/(provider|model): '[^']*'/g))
check('...and no model id of any maker', !/glm|claude|gpt-|kimi|deepseek|qwen|ollama|moonshot|zhipu/i.test(market.replace(/Claude/g, '')), market.match(/glm|claude|gpt-|kimi|deepseek|qwen|ollama|moonshot|zhipu/gi))
check('no frozen list of « available models » is left in the page (KB_CATALOG is gone)', !client.includes('KB_CATALOG') && !client.includes('ui.frozencatalog'))
const collect = slice(client, 'const kbCollect = async (args) => {', 2500)
check('the fallback of the Kybers page judges no role and says so', collect.includes("out.catalogErrors.push(kbt('ui.nomodellist'))") && collect.includes('buildKyber(doc, name, target, noList, null)') && collect.includes('r.unchecked = true') && client.includes("else if (role.unchecked === true)"))
check('the page speaks of the model list in French and in English', hasEntry('ui.nomodellist'))

console.log('\n' + pass + ' ok, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
