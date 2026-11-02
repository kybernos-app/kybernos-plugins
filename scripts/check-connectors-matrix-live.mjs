#!/usr/bin/env node
// A matrix of REAL third-party MCP servers (remote, no key) and public APIs (OpenAPI), against an ISOLATED DSH.
//
//   source scripts/sandbox/env.sh   # then
//   KB_HOST=127.0.0.1:<sandbox port> node scripts/check-connectors-matrix-live.mjs [--only mcp|api] [--json <file>]
//
// For each remote MCP server: the host adds it to the sandbox profile (POST /kybernos/composio/connecteurs), DSH hot-loads it, the
// check reads what DSH says (loaded, phase, tool count), runs the page's Test button (initialize + tools/list: never a tool call),
// then deletes it. For each API: the spec is read by the page's host route, the reads are added as native tools, the first read
// without a parameter is run with the test route, the connector is removed. Nothing is left behind.
//
// It writes the profile of the DSH it talks to, so it REFUSES 127.0.0.1:3080 (the real one). Named check-*, never test-*: it needs a
// DSH and the internet. Exit 0 always when it ran (the table is the result), 3 when no isolated DSH answered.
import { mkdirSync, writeFileSync } from 'node:fs'
import { openLivePage, waitFor } from './live-page.mjs'

const args = process.argv.slice(2)
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null
const HOST = process.env.KB_HOST || ''
if (HOST === '' || HOST === '127.0.0.1:3080' || HOST === 'localhost:3080') {
  console.error('✗ this check writes the profile of the DSH it talks to: set KB_HOST to an isolated instance (scripts/sandbox), never :3080.')
  process.exit(2)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const MCP = [
  ['deepwiki', 'https://mcp.deepwiki.com/mcp', 'DeepWiki (docs of any GitHub repo)'],
  ['context7', 'https://mcp.context7.com/mcp', 'Context7 (library docs)'],
  ['cloudflare-docs', 'https://docs.mcp.cloudflare.com/mcp', 'Cloudflare docs'],
  ['ms-learn', 'https://learn.microsoft.com/api/mcp', 'Microsoft Learn docs'],
  ['gitmcp', 'https://gitmcp.io/modelcontextprotocol/servers', 'GitMCP (one public repo)'],
  ['mcpsrv-fetch', 'https://remote.mcpservers.org/fetch/mcp', 'mcpservers.org fetch'],
  ['mcpsrv-thinking', 'https://remote.mcpservers.org/sequentialthinking/mcp', 'mcpservers.org sequential thinking'],
  ['semgrep', 'https://mcp.semgrep.ai/mcp', 'Semgrep'],
  ['astro-docs', 'https://mcp.docs.astro.build/mcp', 'Astro docs'],
  ['svelte', 'https://mcp.svelte.dev/mcp', 'Svelte docs'],
  ['exa', 'https://mcp.exa.ai/mcp', 'Exa search'],
  ['grep-app', 'https://mcp.grep.app', 'grep.app code search'],
  ['huggingface', 'https://huggingface.co/mcp', 'Hugging Face'],
  ['coingecko', 'https://mcp.api.coingecko.com/mcp', 'CoinGecko'],
  ['deepwiki-sse', 'https://mcp.deepwiki.com/sse', 'DeepWiki, SSE transport (the old one)'],
]
const API = [
  ['petstore3', 'https://petstore3.swagger.io/api/v3/openapi.json', 'Swagger Petstore v3 (OpenAPI 3, JSON)'],
  ['catfact', 'https://catfact.ninja/docs?api-docs.json', 'Cat Facts (OpenAPI 3, JSON)'],
  ['httpbin', 'https://httpbin.org/spec.json', 'httpbin (Swagger 2)'],
  ['github', 'https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json', 'GitHub REST (very large)'],
  ['open-meteo', 'https://raw.githubusercontent.com/open-meteo/open-meteo/main/openapi.yml', 'Open-Meteo (YAML)'],
]

const live = await openLivePage({ width: 1100, height: 700 }).catch((e) => { console.error('○ not run: ' + e.message); process.exit(3) })
const { page } = live
const call = async (path, method = 'GET', body) => {
  const js = `(async () => { const init = { method: ${JSON.stringify(method)}, credentials: 'same-origin' }; ${body === undefined ? '' : `init.headers = { 'content-type': 'application/json' }; init.body = ${JSON.stringify(JSON.stringify(body))};`} try { const r = await fetch(${JSON.stringify(path)}, init); let j = null; try { j = await r.json() } catch (e) {} return { status: r.status, json: j } } catch (e) { return { status: 0, json: null } } })()`
  const r = await page.evalJs(js, 90000)
  return r.err ? { status: -1, json: null, err: r.err } : r.val
}
const rows = []
const one = (s) => String(s === undefined || s === null ? '' : s).replace(/\s+/g, ' ').slice(0, 140)

try {
  await waitFor(page, `document.readyState === 'complete'`, 20000)
  await sleep(2500)
  const probe = await call('/kybernos/composio/openapi')
  if (probe.status !== 200 || probe.json === null || probe.json.ok !== true) { console.error('○ not run: the sandbox does not have the OpenAPI route (is it serving the current dev?)'); process.exit(3) }
  const already = (await call('/kybernos/composio/connecteurs')).json
  const taken = new Set(((already && already.connecteurs) || []).map((c) => c.nom))

  if (only === null || only === 'mcp') {
    for (const [nom, url, label] of MCP) {
      const name = 'kbmx-' + nom
      const row = { kind: 'MCP', name: nom, label, url }
      const t0 = Date.now()
      if (taken.has(name)) { row.verdict = 'skip'; row.cause = 'name already present in the sandbox'; rows.push(row); continue }
      const add = await call('/kybernos/composio/connecteurs', 'POST', { nom: name, transport: 'streamable-http', url, headers: [], env: [], secrets: [] })
      if (add.status !== 200 || add.json === null || add.json.ok !== true) {
        row.verdict = 'ko'; row.cause = 'host refused: ' + one(add.json && add.json.error); rows.push(row); continue
      }
      // DSH reloads its configuration by itself, 2 to 3 seconds after the write: ask until it has loaded the server (or give up).
      let live1 = null
      for (let i = 0; i < 14; i += 1) {
        await sleep(2000)
        const list = (await call('/kybernos/composio/connecteurs')).json
        const it = list && Array.isArray(list.connecteurs) ? list.connecteurs.find((c) => c.nom === name) : null
        live1 = it ? it.live : null
        if (live1 && live1.loaded === true && live1.phase !== 'loading' && live1.phase !== 'pending') break
      }
      const test = await call('/kybernos/composio/connecteurs/test', 'POST', { nom: name })
      const r = test.json && test.json.result ? test.json.result : null
      row.ms = Date.now() - t0
      row.dsh = live1 ? ('loaded=' + live1.loaded + ' phase=' + live1.phase + ' tools=' + live1.tools) : 'no state'
      row.test = r ? (r.ok === true ? 'ok · ' + (Array.isArray(r.tools) ? r.tools.length : 0) + ' tools' : 'fail · ' + one((r.code || '') + ' ' + (r.message || ''))) : 'no answer'
      const toolsOk = r && r.ok === true && Array.isArray(r.tools) && r.tools.length > 0
      const dshOk = live1 && live1.loaded === true && live1.phase === 'active' && live1.tools > 0
      if (toolsOk && dshOk) { row.verdict = 'ok'; row.cause = (r.tools.length) + ' tools: ' + r.tools.slice(0, 4).map((t) => t.name).join(', ') }
      else if (toolsOk && !dshOk) { row.verdict = 'partiel'; row.cause = 'the test lists tools, DSH does not load them (' + row.dsh + ')' }
      else if (!toolsOk && dshOk) { row.verdict = 'partiel'; row.cause = 'DSH loads ' + live1.tools + ' tools, the test button says: ' + row.test }
      else { row.verdict = 'ko'; row.cause = row.test + ' · DSH: ' + row.dsh; if (r && r.hint) row.cause += ' · hint: ' + one(r.hint) }
      await call('/kybernos/composio/connecteurs?nom=' + encodeURIComponent(name), 'DELETE')
      rows.push(row)
      console.log('  ' + row.verdict.padEnd(7) + nom.padEnd(18) + one(row.cause).slice(0, 100))
    }
  }

  if (only === null || only === 'api') {
    for (const [nom, url, label] of API) {
      const name = 'kbmx-' + nom
      const row = { kind: 'API', name: nom, label, url }
      const t0 = Date.now()
      const read = await call('/kybernos/composio/openapi', 'POST', { action: 'read', url, auth: { type: 'none' } })
      row.ms = Date.now() - t0
      if (read.status !== 200 || read.json === null || read.json.ok !== true) {
        row.verdict = 'ko'; row.cause = 'read: ' + one(read.json ? read.json.error + (read.json.status ? ' ' + read.json.status : '') : 'no answer'); rows.push(row); console.log('  ko     ' + nom.padEnd(18) + row.cause); continue
      }
      const reads = read.json.operations.filter((o) => o.write !== true)
      row.spec = read.json.title + ' · ' + read.json.total + ' operations (' + reads.length + ' reads) · base ' + (read.json.baseUrl || 'none')
      if (read.json.baseUrl === null) { row.verdict = 'partiel'; row.cause = 'spec read, but it gives no usable API address: ' + row.spec; rows.push(row); console.log('  partiel ' + nom.padEnd(17) + row.cause.slice(0, 100)); continue }
      // The first reads without a path parameter (a test needs nothing to be typed).
      const simple = reads.filter((o) => !/\{[^}]+\}/.test(o.path) && (!Array.isArray(o.needs) || o.needs.length === 0)).slice(0, 3)
      const chosen = (simple.length > 0 ? simple : reads.slice(0, 1)).map((o) => o.id)
      const add = await call('/kybernos/composio/openapi', 'POST', { action: 'add', name, url, baseUrl: read.json.baseUrl, auth: { type: 'none' }, key: '', operations: chosen })
      if (add.status !== 200 || add.json === null || add.json.ok !== true) { row.verdict = 'ko'; row.cause = 'add: ' + one(add.json && add.json.error); rows.push(row); continue }
      const list = (await call('/kybernos/composio/openapi')).json
      const it = list && list.items ? list.items.find((x) => x.name === name) : null
      row.registered = it ? it.live + '/' + chosen.length : '0/' + chosen.length
      let reached = null
      const target = simple.length > 0 ? simple[0] : null
      if (target !== null) {
        const t = await call('/kybernos/composio/openapi', 'POST', { action: 'test', name, operationId: target.id, args: {} })
        reached = t.json && t.json.ok === true ? (t.json.reached === true ? 'reachable · HTTP ' + t.json.status : 'not reachable · ' + one(t.json.text)) : 'test refused: ' + one(t.json && t.json.error)
      } else reached = 'every read needs a path parameter: not run'
      row.test = reached
      const regOk = it && it.live === chosen.length
      if (regOk && /^reachable/.test(reached)) { row.verdict = 'ok'; row.cause = row.spec + ' · ' + row.registered + ' tools registered · ' + reached }
      else if (regOk) { row.verdict = 'partiel'; row.cause = row.spec + ' · tools registered · ' + reached }
      else { row.verdict = 'ko'; row.cause = row.spec + ' · tools registered ' + row.registered + ' · ' + reached }
      await call('/kybernos/composio/openapi', 'POST', { action: 'remove', name })
      rows.push(row)
      console.log('  ' + row.verdict.padEnd(7) + nom.padEnd(18) + one(row.cause).slice(0, 100))
    }
  }
} finally {
  await live.close()
}

console.log('\n| kind | name | verdict | cause |\n|---|---|---|---|')
for (const r of rows) console.log('| ' + r.kind + ' | ' + r.name + ' | ' + r.verdict + ' | ' + one(r.cause).replace(/\|/g, '/') + ' |')
if (jsonOut !== null) { mkdirSync(new URL('.', 'file://' + jsonOut).pathname, { recursive: true }); writeFileSync(jsonOut, JSON.stringify(rows, null, 2)) }
