// ═════════════════════════════════════════════════════════════════
// Settings › Connectors (provider choice), Discover's « Popular » section, and the Add menu's
// « API from an OpenAPI spec » / « Add with AI »: the host routes (through the real host half) and the page's contract,
// pinned at source level. No network.
//
//   node test-connectors-ui.mjs
// ═════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { suite, startHost } from './lib-test.mjs'

const { ok, done } = suite()
const P = '/kybernos/composio/provider'
const O = '/kybernos/composio/openapi'
const src = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
const catalog = readFileSync(new URL('./catalog.js', import.meta.url), 'utf8')

// ── the host: the provider choice ─────────────────────────────────────────────────────────────────
{
  const h = await startHost()
  let r = await h.call(P)
  ok('provider: nothing chosen at first', r.code === 200 && r.json.ok === true && r.json.provider === null)
  r = await h.call(P, { method: 'POST', body: { provider: 'kybernos' } })
  ok('provider: kybernos is kept', r.code === 200 && r.json.provider === 'kybernos')
  r = await h.call(P)
  ok('provider: and read back', r.json.provider === 'kybernos')
  r = await h.call(P, { method: 'POST', body: { provider: 'other' } })
  ok('provider: anything else is refused', r.code === 400 && r.json.ok === false)
  r = await h.call(P, { method: 'POST', body: { provider: null } })
  ok('provider: null clears the choice', r.code === 200 && r.json.provider === null)
  r = await h.call(P, { method: 'POST', body: { provider: 'composio' }, headers: { origin: 'https://evil.example', host: 'localhost:3080' } })
  ok('provider: a request from another origin is refused', r.code === 403)
  r = await h.call(P, { method: 'DELETE' })
  ok('provider: only GET and POST', r.code === 405)
  await h.call(P, { method: 'POST', body: { provider: 'composio' } })
  const file = h.home + '/.dsh/kybernos/connectors.json'
  ok('provider: kybernos-cloud reads this exact file: <DSH home>/kybernos/connectors.json', JSON.parse(readFileSync(file, 'utf8')).provider === 'composio')
  h.stop()
}

// ── the host: API connectors (the spec itself is covered by test-openapi.mjs) ─────────────────────
{
  const h = await startHost()
  let r = await h.call(O)
  ok('api: none saved at first', r.code === 200 && r.json.ok === true && Array.isArray(r.json.items) && r.json.items.length === 0)
  r = await h.call(O, { method: 'POST', body: { action: 'read', url: 'http://example.com/openapi.json', auth: { type: 'bearer' } } })
  ok('api: a plain-http address of another host is refused before any request', r.code === 200 && r.json.ok === false && r.json.error === 'bad_address', r.text.slice(0, 100))
  r = await h.call(O, { method: 'POST', body: { action: 'read', url: 'https://x.example/spec.json', auth: { type: 'header', name: 'Host' } } })
  ok('api: a header that would break the request is refused as an authentication', r.json.ok === false && r.json.error === 'bad_auth')
  r = await h.call(O, { method: 'POST', body: { action: 'add', name: 'Bad Name', url: 'https://x.example/spec.json', auth: { type: 'none' }, operations: ['a'] } })
  ok('api: a name that is not a plain slug is refused', r.json.ok === false && r.json.error === 'bad_name')
  r = await h.call(O, { method: 'POST', body: { action: 'remove', name: 'nothing' } })
  ok('api: removing what is not there says so', r.json.ok === false && r.json.error === 'not_found')
  r = await h.call(O, { method: 'POST', body: { action: 'test', name: 'nothing', operationId: 'x' } })
  ok('api: testing what is not there says so', r.json.ok === false && r.json.error === 'not_found')
  r = await h.call(O, { method: 'POST', body: { action: 'wat' } })
  ok('api: an unknown action is a word, not a crash', r.code === 200 && r.json.ok === false)
  r = await h.call(O, { method: 'POST', body: { action: 'remove', name: 'x' }, headers: { origin: 'https://evil.example', host: 'localhost:3080' } })
  ok('api: a request from another origin is refused', r.code === 403)
  h.stop()
}

// ── API connectors, end to end through the real host and a real (local) HTTP server ──────────────
{
  const seen = []
  const api = createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization || null })
    if (req.url === '/openapi.json') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ openapi: '3.0.0', info: { title: 'Local Things', version: '1' }, servers: [{ url: '/v1' }], paths: { '/things': { get: { operationId: 'listThings', summary: 'List things' }, post: { operationId: 'makeThing', requestBody: { content: { 'application/json': { schema: { type: 'object' } } } } } } } }))
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"things":[1,2]}')
  })
  await new Promise((r) => api.listen(0, '127.0.0.1', r))
  const base = 'http://127.0.0.1:' + api.address().port
  const registered = new Map()
  const h = await startHost({ services: { tools: { register: (d) => { registered.set(d.name, d); return () => registered.delete(d.name) } } } })
  let r = await h.call(O, { method: 'POST', body: { action: 'read', url: base + '/openapi.json', auth: { type: 'bearer' } } })
  ok('api e2e: the spec is read from a real address', r.json.ok === true && r.json.title === 'Local Things' && r.json.total === 2 && r.json.baseUrl === base + '/v1', r.text.slice(0, 160))
  ok('api e2e: reads and writes are told apart', r.json.operations.find((o) => o.id === 'makeThing').write === true && r.json.operations.find((o) => o.id === 'listThings').write === false)
  ok('api e2e: the spec was fetched without any key', seen[0].auth === null)
  r = await h.call(O, { method: 'POST', body: { action: 'add', name: 'local-things', url: base + '/openapi.json', auth: { type: 'bearer' }, key: 'sk_e2e_secret', operations: ['listThings'] } })
  ok('api e2e: added', r.json.ok === true && r.json.tools.length === 1, r.text.slice(0, 160))
  r = await h.call(O)
  ok('api e2e: listed, with its key hidden', r.json.items.length === 1 && r.json.items[0].hasKey === true && !r.text.includes('sk_e2e_secret'))
  r = await h.call(O, { method: 'POST', body: { action: 'test', name: 'local-things', operationId: 'listThings' } })
  ok('api e2e: the test button reaches the API with the key, on the API address only', r.json.ok === true && r.json.reached === true && seen.at(-1).url === '/v1/things' && seen.at(-1).auth === 'Bearer sk_e2e_secret', JSON.stringify(seen.at(-1)))
  r = await h.call(O, { method: 'POST', body: { action: 'remove', name: 'local-things' } })
  ok('api e2e: removed', r.json.ok === true && (await h.call(O)).json.items.length === 0)
  api.close()
  h.stop()
}

// ── the page ───────────────────────────────────────────────────────────────────────────────────────
{
  const pop = /const POPULAR = \[([^\]]+)\]/.exec(src)
  const slugs = pop === null ? [] : pop[1].split(',').map((x) => x.trim().replace(/['"]/g, ''))
  ok('discover: twelve known apps, each one in the catalogue', slugs.length === 12 && slugs.every((s) => catalog.includes('"' + s + '"') || catalog.includes("'" + s + "'")), slugs.join(','))
  ok('discover: the known apps are drawn with the SAME card as the catalogue', /popList\.map\(\(a\) => appItem\(a, true\)\)/.test(src) && /shown\.map\(\(a\) => appItem\(a\)\)/.test(src) && /const appItem = \(a, inPop\) => \(viewMode === 'list' \? appRow\(a, inPop\) : appCard\(a, inPop\)\)/.test(src))
  ok('discover: the section only exists with no search and no filter', /const popSplit = qn\.length === 0 && chip === 'all'/.test(src))
  ok('discover: the catalogue below leaves out what the section shows', /const mainList = popList\.length > 0 \? list\.filter\(\(a\) => POPULAR\.indexOf\(a\.s\) < 0\)/.test(src))

  // one block on every tab: search, filter, order, view
  ok('toolbar: the same bar on the three tabs (it was missing on MCP servers)', /\(kbTb !== null && barShown === true \? h\(kbTb\.KbToolbar, \{/.test(src) && !/kbTb !== null && vtab !== 'mcp'/.test(src))
  ok('toolbar: it sits in the HEADER row with the add menu as its trailing action, like Agent Teams / Creations / Automations / Workspaces', /className: 'kb6-headrow' \},[\s\S]*?trailing: addWrap,[\s\S]*?: h\('div', \{ className: 'kb6-headacts' \}, addWrap\)/.test(src) && !/h\('div', \{ className: 'kb7-ctlrow' \},[\s\S]{0,2500}KbToolbar/.test(src.slice(src.indexOf("className: 'kb7-ctlrow' }"), src.indexOf("className: 'kb7-ctlrow' }") + 2500)))
  ok('toolbar: with nothing to list there is no bar and the add action alone keeps its place', /const barShown = vtab === 'mcp'/.test(src))
  ok('discover: refresh and « load the full catalog » are in the panel, not in the bar', /className: 'kb7-discact'/.test(src))
  ok('toolbar: the cards / list switch is there, and only hidden for the Kybernos connections panel', /views: \['cards', 'list'\]/.test(src) && /hideView: vtab === 'yours' && kcMode === true/.test(src) && !/hideView: true,/.test(src))
  ok('toolbar: the MCP servers tab has its own filter (http / stdio / api), search and order', /const mcpFacet = /.test(src) && /options: vtab === 'mcp' \? mcpFacet/.test(src) && /mcpDir/.test(src))
  ok('toolbar: a kind chosen on the MCP tab never empties the apps tabs (and the reverse)', /KB_MCP_KINDS\.indexOf\(t\) < 0\)\[0\] \|\| 'all'/.test(src))
  ok('mcp tab: the rows follow the view (a grid of cards, or the rows as before)', /className: 'kbcp-mlist' \+ \(props\.view === 'cards' \? ' cards' : ''\)/.test(src) && /\.kbcp-mlist\.cards\{display:grid/.test(src))
  ok('title: the page has one title (the outer one is gone) and it says Connectors', /'kb\.cp\.title': \{ fr: 'Connecteurs', en: 'Connectors' \}/.test(src) && !/kbPageHead\(kbt\('kbui\.connecteurs'\)\)/.test(readFileSync(new URL('../kybernos-plugin/client.js', import.meta.url), 'utf8')))
  ok('settings: the card posts the choice to the host', /kbCpHost\('\/provider', 'POST', \{ provider: next \}\)/.test(src))
  ok('settings: Kybernos Cloud can be chosen only when offered, signed in and in the plan (read from the server, never written)', /if \(next === 'kybernos' && inPlan !== true\) return/.test(src) && /const inPlan = signedIn && kc\.entitled !== false/.test(src))
  ok('settings: no plan name is written in the page', !/plan === '(free|paid|pro|plus)'/.test(src))
  ok('settings: a refused save puts the choice back', /setProvider\(prev\); setSaveErr\(true\)/.test(src))
  ok('settings: the footer says what is and is not switched off', /kb\.cp\.pv\.foot/.test(src))
  ok('page: the on-page switch writes the same choice', /kbCpHost\('\/provider', 'POST', \{ provider: m === 'kybernos' \? 'kybernos' : 'composio' \}\)/.test(src))

  ok('add menu: two new entries after the existing ones', /'data-kb': 'add-form'/.test(src) && /'data-kb': 'add-json'/.test(src) && /'data-kb': 'add-api'/.test(src) && /'data-kb': 'add-ai'/.test(src))
  ok('api window: the key field is a password field and the key goes in the body only', /id: 'kbcp-api-key', type: 'password', autoComplete: 'off'/.test(src) && !/openapi\?[^']*key/.test(src))
  ok('api window: reads are on by default, writes off', /if \(o\.write !== true && n < 100\) \{ init\[o\.id\] = true/.test(src))
  ok('api window: the host is asked to read, then to add: the page\'s own list is never trusted by the host', /action: 'read'/.test(src) && /action: 'add'/.test(src))
  ok('ai window: it hands a written request to the chat bridge and sends nothing', /new CustomEvent\('kb-open-chat-text'/.test(src) && /kb\.cp\.ai\.prompt/.test(src))
  ok('ai window: the request names the skill that exists', /connecteur-personnalise/.test(src.slice(src.indexOf("'kb.cp.ai.prompt'"), src.indexOf("'kb.cp.ai.prompt'") + 600)))

  // every string the new code asks for exists, in both languages, with the same placeholders
  const asked = new Set()
  for (const m of src.matchAll(/kbt\('(kb\.cp\.(?:pv|api|ai|add|popularH|allapps)[A-Za-z0-9_.]*)'\)/g)) asked.add(m[1])
  const missing = []
  const bad = []
  for (const k of asked) {
    const m = new RegExp("'" + k.replace(/\./g, '\\.') + "': \\{ fr: '((?:[^'\\\\]|\\\\.)*)', en: '((?:[^'\\\\]|\\\\.)*)' \\}").exec(src)
    if (m === null) { missing.push(k); continue }
    const ph = (t) => (t.match(/\{[a-z]+\}/g) || []).sort().join(',')
    if (m[1].trim() === '' || m[2].trim() === '' || ph(m[1]) !== ph(m[2])) bad.push(k)
  }
  ok('strings: every new key the page asks for is defined, French and English, same placeholders', missing.length === 0 && bad.length === 0, JSON.stringify({ missing, bad }))
  const dyn = [...src.matchAll(/'kb\.cp\.api\.err\.([a-z0-9_]+)'/g)].map((m) => m[1])
  const words = ['bad_address', 'bad_auth', 'spec_unauthorized', 'spec_http', 'spec_too_large', 'yaml_unsupported', 'swagger2_unsupported', 'not_openapi', 'not_json', 'no_operations', 'no_base_url', 'bad_name', 'bad_operations', 'timeout', 'network', 'store_write_failed']
  ok('strings: every word the host can answer has its sentence', words.every((w) => dyn.includes(w)), words.filter((w) => !dyn.includes(w)).join(','))
}

done('Connectors settings, discover and add')
