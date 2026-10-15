#!/usr/bin/env node
/** API connectors from an OpenAPI spec (openapi.mjs) and the provider choice (provider.mjs). No network: a fake fetch answers.
 *
 *  Usage: node packages/kybernos-composio/test-openapi.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, statSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseSpec, operationsOf, baseUrlOf, buildRequest, callOperation, toolFor, safeUrl, createOpenapi, MAX_RESPONSE_BYTES } from './openapi.mjs'
import { readProvider, writeProvider, providerPath } from './provider.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const SPEC = {
  openapi: '3.0.3',
  info: { title: 'Acme Invoices', version: '2.3' },
  servers: [{ url: 'https://{region}.acme-invoices.com/v2', variables: { region: { default: 'api' } } }],
  components: {
    parameters: { Limit: { name: 'limit', in: 'query', schema: { type: 'integer' }, description: 'How many' } },
  },
  paths: {
    '/invoices': {
      get: { operationId: 'listInvoices', summary: 'List invoices', parameters: [{ $ref: '#/components/parameters/Limit' }, { name: 'status', in: 'query', schema: { type: 'string', enum: ['open', 'paid'] } }, { name: 'X-Trace', in: 'header', schema: { type: 'string' } }] },
      post: { operationId: 'createInvoice', summary: 'Create an invoice', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } } },
    },
    '/invoices/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      get: { summary: 'Get one invoice' },
      delete: { operationId: 'deleteInvoice', summary: 'Delete an invoice' },
    },
  },
}
const SPEC_URL = 'https://api.acme-invoices.com/openapi.json'

// 1. the spec: JSON only, OpenAPI 3 only, each refusal has its own word
{
  assert.equal(parseSpec(JSON.stringify(SPEC)).ok, true)
  assert.equal(parseSpec('openapi: 3.0.0\ninfo:\n  title: x\npaths: {}').error, 'yaml_unsupported')
  assert.equal(parseSpec('{"swagger":"2.0","paths":{}}').error, 'swagger2_unsupported')
  assert.equal(parseSpec('{"hello":1}').error, 'not_openapi')
  assert.equal(parseSpec('<html>').error, 'not_json')
  assert.equal(parseSpec('').error, 'not_json')
  ok('JSON OpenAPI 3 is read; YAML, Swagger 2 and anything else get their own word')
}

// 2. operations: ids, writes, parameters (path and query only, refs followed), body
{
  const ops = operationsOf(SPEC)
  assert.deepEqual(ops.map((o) => o.id), ['listInvoices', 'createInvoice', 'get_invoices_id', 'deleteInvoice'])
  const list = ops[0]
  assert.equal(list.write, false)
  assert.deepEqual(list.params.map((p) => p.name + ':' + p.in), ['limit:query', 'status:query'], 'a header parameter is ignored, a $ref is followed')
  assert.deepEqual(list.params[1].schema.enum, ['open', 'paid'])
  assert.equal(ops[1].write, true)
  assert.equal(ops[1].body.required, true)
  assert.equal(ops[2].params[0].in, 'path', 'path-level parameters apply to each operation')
  assert.equal(ops[2].params[0].required, true)
  ok('operations: unique ids, writes flagged, path+query parameters, refs followed, header parameters ignored')
}

// 3. the base address: variables resolved, relative resolved against the spec, only safe addresses
{
  assert.equal(baseUrlOf(SPEC, SPEC_URL), 'https://api.acme-invoices.com/v2')
  assert.equal(baseUrlOf({ servers: [{ url: '/v1' }] }, 'https://x.example/spec.json'), 'https://x.example/v1')
  assert.equal(baseUrlOf({ servers: [{ url: 'http://evil.example/' }] }, SPEC_URL), null, 'plain http to a remote host is refused')
  assert.equal(baseUrlOf({ servers: [{ url: 'http://localhost:8080/api' }] }, SPEC_URL), 'http://localhost:8080/api')
  assert.equal(safeUrl('https://user:pw@x.example/'), null, 'no credentials in an address')
  assert.equal(safeUrl('file:///etc/passwd'), null)
  ok('base address: server variables, relative servers, https only (plain http for this computer)')
}

// 4. building a request: path encoded, query, auth in every shape, body, errors
{
  const ops = operationsOf(SPEC)
  const c = { name: 'acme', title: 'Acme', baseUrl: 'https://api.acme-invoices.com/v2', auth: { type: 'bearer' }, key: 'sk_test_1' }
  const get = buildRequest(c, ops[2], { id: 'a/b c' })
  assert.equal(get.url, 'https://api.acme-invoices.com/v2/invoices/a%2Fb%20c')
  assert.equal(get.init.headers.authorization, 'Bearer sk_test_1')
  assert.equal(get.init.redirect, 'manual')
  assert.equal(buildRequest(c, ops[2], {}).error, 'missing_parameter')
  const q = buildRequest(Object.assign({}, c, { auth: { type: 'query', name: 'api_key' } }), ops[0], { limit: 5, status: 'open' })
  assert.equal(new URL(q.url).searchParams.get('api_key'), 'sk_test_1')
  assert.equal(new URL(q.url).searchParams.get('limit'), '5')
  const h = buildRequest(Object.assign({}, c, { auth: { type: 'header', name: 'X-API-Key' } }), ops[0], {})
  assert.equal(h.init.headers['x-api-key'], 'sk_test_1')
  assert.equal(buildRequest(Object.assign({}, c, { auth: { type: 'basic' }, key: 'u:p' }), ops[0], {}).init.headers.authorization, 'Basic ' + Buffer.from('u:p').toString('base64'))
  const post = buildRequest(c, ops[1], { body: { amount: 12 } })
  assert.equal(post.init.body, '{"amount":12}')
  assert.equal(post.init.headers['content-type'], 'application/json')
  assert.equal(buildRequest(c, ops[1], {}).error, 'missing_parameter', 'a required body is required')
  assert.equal(buildRequest(c, ops[0], {}).init.headers.authorization, 'Bearer sk_test_1')
  assert.equal(buildRequest(Object.assign({}, c, { key: '' }), ops[0], {}).init.headers.authorization, undefined, 'no key, no header')
  ok('requests: path encoded, query, bearer / header / query / basic, JSON body, missing parameters named')
}

// 5. a call: bounded, redirects refused, same origin only, never throws
{
  const ops = operationsOf(SPEC)
  const c = { name: 'acme', title: 'Acme', baseUrl: 'https://api.acme-invoices.com/v2', auth: { type: 'none' }, key: '' }
  const mk = (status, text, extra) => async () => Object.assign({ status, ok: status >= 200 && status < 300, text: async () => text, body: null }, extra || {})
  let r = await callOperation({ connector: c, op: ops[0], args: {}, fetchFn: mk(200, '{"data":[]}') })
  assert.deepEqual([r.ok, r.status, r.text], [true, 200, '{"data":[]}'])
  r = await callOperation({ connector: c, op: ops[0], args: {}, fetchFn: mk(302, '', {}) })
  assert.equal(r.error, 'redirect')
  r = await callOperation({ connector: c, op: ops[0], args: {}, fetchFn: mk(404, 'nope') })
  assert.deepEqual([r.ok, r.status], [false, 404])
  r = await callOperation({ connector: c, op: ops[0], args: {}, fetchFn: async () => { throw new Error('boom') } })
  assert.equal(r.error, 'network')
  r = await callOperation({ connector: c, op: ops[0], args: {}, fetchFn: mk(200, 'x'.repeat(MAX_RESPONSE_BYTES + 50)) })
  assert.equal(r.cut, true)
  assert.equal(r.text.length, MAX_RESPONSE_BYTES)
  r = await callOperation({ connector: c, op: ops[0], args: {}, timeoutMs: 20, fetchFn: (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' })))) })
  assert.equal(r.error, 'timeout')
  ok('a call: answer bounded at 100 KB, a redirect is not followed, errors are words, a timeout stops it')
}

// 6. the tool the agent sees
{
  const ops = operationsOf(SPEC)
  const c = { name: 'acme-invoices', title: 'Acme Invoices', baseUrl: 'https://api.acme-invoices.com/v2', auth: { type: 'bearer' }, key: 'k' }
  const t = toolFor(c, ops[1])
  assert.equal(t.name, 'api_acme_invoices_createInvoice')
  assert.match(t.description, /^Changes data\./)
  assert.deepEqual(t.parameters.required, ['body'])
  assert.equal(t.parameters.additionalProperties, false)
  const read = toolFor(c, ops[0])
  assert.deepEqual(Object.keys(read.parameters.properties), ['limit', 'status'])
  assert.ok(!JSON.stringify(read.parameters).includes('"k"'), 'the key is never part of the tool')
  ok('the tool: a name that says where it comes from, « Changes data » on writes, a closed schema, no key in it')
}

// 7. the connector end to end, with a fake tools service
{
  const home = mkdtempSync(join(tmpdir(), 'kb-openapi-'))
  try {
    const calls = []
    const fetchFn = async (url, init) => {
      calls.push({ url, init })
      if (url === SPEC_URL) return { ok: true, status: 200, text: async () => JSON.stringify(SPEC), body: null }
      return { ok: true, status: 200, text: async () => '{"id":"inv_1"}', body: null }
    }
    const registered = new Map()
    const toolsSvc = { register: (def) => { registered.set(def.name, def); return () => registered.delete(def.name) } }
    const api = createOpenapi({ home, fetchFn })
    api.attach(toolsSvc)

    const read = await api.read({ url: SPEC_URL, auth: { type: 'bearer' } })
    assert.equal(read.ok, true)
    assert.equal(read.title, 'Acme Invoices')
    assert.equal(read.baseUrl, 'https://api.acme-invoices.com/v2')
    assert.equal(read.total, 4)
    assert.equal(calls.at(-1).init.headers.authorization, undefined, 'the spec is fetched without the key')

    assert.equal((await api.add({ name: 'Bad Name', url: SPEC_URL, auth: { type: 'bearer' }, key: 'k', operations: ['listInvoices'] })).error, 'bad_name')
    assert.equal((await api.add({ name: 'acme', url: SPEC_URL, auth: { type: 'bearer' }, key: 'k', operations: ['nope'] })).error, 'bad_operations')
    const added = await api.add({ name: 'acme', url: SPEC_URL, auth: { type: 'bearer' }, key: 'sk_live_secret', operations: ['listInvoices', 'get_invoices_id'] })
    assert.equal(added.ok, true)
    assert.deepEqual(Array.from(registered.keys()).sort(), ['api_acme_get_invoices_id', 'api_acme_listInvoices'])

    const mode = statSync(join(home, 'kybernos', 'openapi-connectors.json')).mode & 0o777
    assert.equal(mode, 0o600, 'the store holds a key: owner only')
    const listed = JSON.stringify(api.list())
    assert.ok(!listed.includes('sk_live_secret'), 'the list never carries the key')
    assert.equal(api.list().items[0].hasKey, true)

    const out = await registered.get('api_acme_listInvoices').execute({ limit: 2 })
    assert.equal(out.ok, true)
    assert.match(out.text, /^HTTP 200/)
    const last = calls.at(-1)
    assert.equal(last.url, 'https://api.acme-invoices.com/v2/invoices?limit=2')
    assert.equal(last.init.headers.authorization, 'Bearer sk_live_secret', 'the key goes to the API')

    const tested = await api.test({ name: 'acme', operationId: 'listInvoices', args: {} })
    assert.deepEqual([tested.ok, tested.reached, tested.status], [true, true, 200])
    await api.add({ name: 'acme', url: SPEC_URL, auth: { type: 'bearer' }, key: 'sk_live_secret', operations: ['deleteInvoice'] })
    assert.equal((await api.test({ name: 'acme', operationId: 'deleteInvoice', args: { id: '1' } })).error, 'write_not_tested', 'a write is never run from the test button')
    assert.deepEqual(Array.from(registered.keys()), ['api_acme_deleteInvoice'], 're-adding replaces the connector, its old tools go')

    // a fresh process finds the tools again from the store alone
    const again = new Map()
    const api2 = createOpenapi({ home, fetchFn })
    api2.attach({ register: (def) => { again.set(def.name, def); return () => again.delete(def.name) } })
    assert.deepEqual(Array.from(again.keys()), ['api_acme_deleteInvoice'])

    assert.equal(api.remove({ name: 'acme' }).ok, true)
    assert.equal(registered.size, 0, 'removing a connector removes its tools')
    assert.equal(api.remove({ name: 'acme' }).error, 'not_found')
    ok('read → choose → add → tools registered, key private and never listed, test runs reads only, restart finds the tools, remove')
  } finally { rmSync(home, { recursive: true, force: true }) }
}

// 8. the provider choice: a few bytes, 0600, kept beside whatever else the file holds
{
  const home = mkdtempSync(join(tmpdir(), 'kb-provider-'))
  try {
    assert.equal(readProvider(home), null, 'nothing chosen')
    writeProvider(home, 'kybernos')
    assert.equal(readProvider(home), 'kybernos')
    assert.equal(statSync(providerPath(home)).mode & 0o777, 0o600)
    writeProvider(home, 'composio')
    assert.equal(readProvider(home), 'composio')
    writeProvider(home, null)
    assert.equal(readProvider(home), null)
    assert.throws(() => writeProvider(home, 'other'))
    mkdirSync(join(home, 'kybernos'), { recursive: true })
    writeFileSync(providerPath(home), '{ not json')
    assert.equal(readProvider(home), null, 'an unreadable file reads as nothing chosen')
    writeFileSync(providerPath(home), JSON.stringify({ provider: 'kybernos', extra: 1 }))
    writeProvider(home, 'composio')
    assert.equal(JSON.parse(readFileSync(providerPath(home), 'utf8')).extra, 1, 'other keys are kept')
    ok('provider choice: nothing / composio / kybernos, owner-only, tolerant of a broken file, other keys kept')
  } finally { rmSync(home, { recursive: true, force: true }) }
}

console.log('\n' + pass + ' checks passed')
