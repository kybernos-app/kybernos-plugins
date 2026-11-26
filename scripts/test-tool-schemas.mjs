#!/usr/bin/env node
// Every tool a plugin of this repo registers with the engine has `parameters` that are a valid JSON Schema (draft 2020-12).
//
// Why: a tool defined by hand is registered with a ready-made JSON Schema, which the engine forwards to the model's provider untouched (only the engine's `defineTool` shorthand
// builds a clean one). Anthropic checks it against draft 2020-12 and refuses the WHOLE request when one tool is wrong: `create_image` had `required: true` inside a property (the draft-03
// form), and every turn of Claude Haiku 4.5 failed with « 400 tools.22.custom.input_schema: JSON schema is invalid » (the phone, 2026-11-22; commit 4dd8cb76 had put it there on 2026-11-20).
//
// How: each plugin that registers tools is loaded in its OWN child process, hermetic (an empty home in a temp folder, no key in the environment), and its `apply(ctx)` is run with a context
// that records what is given to `tools.register` and answers everything else with an inert stand-in. The recorded `parameters` are then checked:
//   · always, by a small keyword check that knows the mistakes met so far (a boolean `required`, a boolean `exclusiveMinimum`, an array `items`, a `type` that is not a type, ...);
//   · when the engine's own copy of Ajv is found (`KYBERNOS_AJV`, or `~/.dsh/kybernos/moteur/<version>/node_modules/ajv/dist/2020.js`, the newest), against the whole draft 2020-12 meta-schema
//     with `strict: false`, as the engine does. Without it that part is reported as SKIPPED, the keyword check still runs.
// Run: node scripts/test-tool-schemas.mjs        (the child mode is `--capture <package dir>`, used by the test itself)
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const packagesDir = join(here, '..', 'packages')

// ── the checks (pure) ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const TYPES = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'])
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const SCHEMA_KEYS = ['items', 'additionalProperties', 'additionalItems', 'not', 'contains', 'propertyNames', 'if', 'then', 'else', 'unevaluatedProperties', 'unevaluatedItems']
const SCHEMA_LISTS = ['allOf', 'anyOf', 'oneOf', 'prefixItems']
const SCHEMA_MAPS = ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']
const NUMBER_KEYS = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf']
const COUNT_KEYS = ['minLength', 'maxLength', 'minItems', 'maxItems', 'minProperties', 'maxProperties']

/** What is wrong in one schema, as a list of `path: problem` (empty when the keyword check finds nothing). Booleans are schemas (`true`/`false`), everything under `enum`, `const`, `default`, `examples` is data. */
export function keywordProblems (schema, path = '') {
  const out = []
  const at = (p) => (path + '/' + p)
  if (typeof schema === 'boolean') return out
  if (!isObj(schema)) return [(path || '/') + ': a schema is an object or a boolean']
  if ('type' in schema) {
    const t = schema.type
    const ok = typeof t === 'string' ? TYPES.has(t) : (Array.isArray(t) && t.length > 0 && t.every((x) => typeof x === 'string' && TYPES.has(x)))
    if (!ok) out.push(at('type') + ': must be one of ' + [...TYPES].join(', ') + ' (or a list of them)')
  }
  if ('required' in schema && !(Array.isArray(schema.required) && schema.required.every((x) => typeof x === 'string'))) out.push(at('required') + ': must be an array of property names (a boolean is the draft-03 form)')
  for (const k of NUMBER_KEYS) if (k in schema && typeof schema[k] !== 'number') out.push(at(k) + ': must be a number' + (k.startsWith('exclusive') && typeof schema[k] === 'boolean' ? ' (a boolean is the draft-04 form)' : ''))
  for (const k of COUNT_KEYS) if (k in schema && !(Number.isInteger(schema[k]) && schema[k] >= 0)) out.push(at(k) + ': must be a non-negative integer')
  if ('enum' in schema && !Array.isArray(schema.enum)) out.push(at('enum') + ': must be an array')
  if ('pattern' in schema && typeof schema.pattern !== 'string') out.push(at('pattern') + ': must be a string')
  if ('description' in schema && typeof schema.description !== 'string') out.push(at('description') + ': must be a string')
  if ('items' in schema && Array.isArray(schema.items)) out.push(at('items') + ': must be a schema (the array form is draft 2019 and before: use prefixItems)')
  if ('additionalProperties' in schema && typeof schema.additionalProperties !== 'boolean' && !isObj(schema.additionalProperties)) out.push(at('additionalProperties') + ': must be a boolean or a schema')
  for (const k of SCHEMA_KEYS) if (k in schema && !Array.isArray(schema[k])) out.push(...keywordProblems(schema[k], at(k)))
  for (const k of SCHEMA_LISTS) if (k in schema) { if (!Array.isArray(schema[k]) || schema[k].length === 0) out.push(at(k) + ': must be a non-empty array of schemas'); else schema[k].forEach((s, i) => out.push(...keywordProblems(s, at(k + '/' + i)))) }
  for (const k of SCHEMA_MAPS) if (k in schema) { if (!isObj(schema[k])) out.push(at(k) + ': must be an object of schemas'); else for (const [name, s] of Object.entries(schema[k])) out.push(...keywordProblems(s, at(k + '/' + name))) }
  return out
}

/** The engine's own Ajv (draft 2020-12), or null. */
export async function findAjv () {
  const candidates = []
  if (process.env.KYBERNOS_AJV) candidates.push(process.env.KYBERNOS_AJV)
  try {
    const root = join(homedir(), '.dsh', 'kybernos', 'moteur')
    const versions = readdirSync(root).sort().reverse()
    for (const v of versions) candidates.push(join(root, v, 'node_modules', 'ajv', 'dist', '2020.js'))
  } catch (e) { /* no engine on this machine */ }
  for (const file of candidates) {
    if (!existsSync(file)) continue
    try { const m = await import(pathToFileURL(file).href); const A = m.default?.default ?? m.default ?? m.Ajv2020; return new A({ strict: false, allErrors: true }) } catch (e) { /* the next one */ }
  }
  return null
}

// ── the child: load one plugin, run its apply with a recording context ────────────────────────────────────────────────────────────────────────────
const inert = () => {
  const f = function () {}
  const p = new Proxy(f, {
    get (_t, k) { if (k === 'then') return undefined; if (k === Symbol.toPrimitive) return () => ''; if (k === Symbol.iterator) return function * () {}; return p },
    apply () { return p }, construct () { return p }, has () { return true }
  })
  return p
}

async function capture (dir) {
  const tools = []
  const toolsApi = { register (tool) { try { tools.push({ name: String(tool?.name ?? ''), parameters: tool?.parameters ?? tool?.inputSchema ?? tool?.input_schema ?? null }) } catch (e) { /* not a tool */ } return () => {} } }
  const scopeOf = () => new Proxy({ tools: toolsApi }, { get: (t, k) => (k in t ? t[k] : inert()) })
  const own = {
    inject (names, fn) { try { const r = fn(scopeOf()); if (r && typeof r.catch === 'function') r.catch(() => {}) } catch (e) { /* a mount that needs more than this */ } },
    get (name) { return name === 'tools' ? toolsApi : undefined },
    effect (fn) { try { const r = fn(); if (r && typeof r.catch === 'function') r.catch(() => {}) } catch (e) { /* idem */ } return () => {} },
    on () { return () => {} }
  }
  const ctx = new Proxy(own, { get: (t, k) => (k in t ? t[k] : inert()) })
  let loaded = false
  let error = ''
  try {
    const mod = await import(pathToFileURL(join(packagesDir, dir, 'index.js')).href)
    loaded = true
    if (typeof mod.apply === 'function') { const r = mod.apply(ctx); if (r && typeof r.then === 'function') await r.catch(() => {}) }
    await new Promise((resolve) => setTimeout(resolve, 1200))
  } catch (e) { error = String(e?.message ?? e).slice(0, 200) }
  process.stdout.write('\n@@TOOLS@@' + JSON.stringify({ dir, loaded, error, tools }) + '\n')
  process.exit(0)
}

const argv = process.argv.slice(2)
if (argv[0] === '--capture') {
  // the engine's output goes to stderr of nobody: only the marked line is read
  await capture(argv[1])
}

// ── the test ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
let fail = 0
const ok = (name, cond, detail) => { if (cond) console.log('ok   ' + name); else { fail += 1; console.log('FAIL ' + name + (detail === undefined ? '' : '  ' + JSON.stringify(detail).slice(0, 900))) } }

// 1. the checks themselves: the mistake that broke create_image is caught, a good schema is not
{
  const bad = { type: 'object', properties: { prompt: { type: 'string', required: true } }, required: ['prompt'] }
  const good = { type: 'object', additionalProperties: false, properties: { prompt: { type: 'string', description: 'x' }, n: { type: 'integer', minimum: 1, maximum: 4 }, tags: { type: 'array', items: { type: 'string' } }, kind: { type: 'string', enum: ['a', 'b'] } }, required: ['prompt'] }
  ok('the keyword check catches a boolean `required` inside a property (the create_image mistake)', keywordProblems(bad).length === 1 && /properties\/prompt\/required/.test(keywordProblems(bad)[0]), keywordProblems(bad))
  ok('...and a draft-04 boolean exclusiveMinimum, an `items` array, a type that is not a type', keywordProblems({ type: 'number', exclusiveMinimum: true }).length === 1 && keywordProblems({ type: 'array', items: [{ type: 'string' }] }).length === 1 && keywordProblems({ type: 'strng' }).length === 1)
  ok('...and lets a good schema through (enum values are data, not schemas)', keywordProblems(good).length === 0 && keywordProblems({ type: 'string', enum: [{ type: 'strng' }, true, 3] }).length === 0, keywordProblems(good))
  const ajv = await findAjv()
  if (ajv === null) console.log('SKIPPED: the whole draft 2020-12 meta-schema check — the engine\'s own Ajv was not found (KYBERNOS_AJV=<path to ajv/dist/2020.js>); the keyword check above and below still ran')
  else {
    ok('Ajv (draft 2020-12, strict: false) refuses the create_image mistake and accepts a good schema', ajv.validateSchema(bad) === false && ajv.validateSchema(good) === true)
  }
}

// 2. every registered tool of every plugin of this repo
const dirs = readdirSync(packagesDir).filter((d) => existsSync(join(packagesDir, d, 'index.js'))).filter((d) => {
  try { return /inject\(\['tools'\]|tools\.register|get\('tools'\)/.test(readFileSync(join(packagesDir, d, 'index.js'), 'utf8')) || ['kybernos-cloud', 'kybernos-slash', 'kybernos-skills', 'kybernos-composio'].includes(d) } catch (e) { return false }
})
const home = mkdtempSync(join(tmpdir(), 'kb-tool-schemas-'))
const runChild = (dir) => new Promise((resolve) => {
  const env = { PATH: process.env.PATH ?? '', HOME: home, DSH_HOME: join(home, '.dsh'), TMPDIR: home, NODE_ENV: 'test', KYBERNOS_TEST_TOOLS: '1' }
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--capture', dir], { env, stdio: ['ignore', 'pipe', 'ignore'] })
  let out = ''
  child.stdout.on('data', (d) => { out += d })
  const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch (e) { /* gone */ } }, 25000)
  child.on('close', () => {
    clearTimeout(timer)
    const m = /@@TOOLS@@(.*)\n/.exec(out)
    try { resolve(m !== null ? JSON.parse(m[1]) : { dir, loaded: false, error: 'no answer', tools: [] }) } catch (e) { resolve({ dir, loaded: false, error: 'unreadable answer', tools: [] }) }
  })
})
const results = []
for (let i = 0; i < dirs.length; i += 4) results.push(...await Promise.all(dirs.slice(i, i + 4).map(runChild)))
try { rmSync(home, { recursive: true, force: true }) } catch (e) { /* kept */ }

const all = results.flatMap((r) => r.tools.map((t) => ({ ...t, dir: r.dir })))
const named = (n) => all.filter((t) => t.name === n)
console.log('     ' + results.map((r) => r.dir.replace(/^kybernos-/, '') + ':' + r.tools.length + (r.loaded ? '' : '(not loaded)')).join(' ') + ' = ' + all.length + ' tools')
ok('the harness sees the tools of the plugins that register a ready-made schema (memory, cloud), create_image among them', ['kybernos-memory', 'kybernos-cloud'].every((d) => (results.find((r) => r.dir === d)?.tools.length ?? 0) > 0) && named('create_image').length === 1, results.map((r) => [r.dir, r.loaded, r.error, r.tools.length]))
ok('at least 25 tools were seen (the number may grow, it must not silently fall to a handful when a plugin changes how it mounts)', all.length >= 25, all.length)
ok('every tool has a name and an object for `parameters`', all.every((t) => t.name !== '' && isObj(t.parameters)), all.filter((t) => t.name === '' || !isObj(t.parameters)).map((t) => t.dir + ':' + t.name))
const wrong = all.filter((t) => isObj(t.parameters)).flatMap((t) => keywordProblems(t.parameters).map((p) => t.dir + ' ' + t.name + ' ' + p))
ok('no tool has a schema the keyword check refuses (' + all.length + ' tools)', wrong.length === 0, wrong)
const ajv = await findAjv()
if (ajv !== null) {
  const bad = []
  for (const t of all.filter((x) => isObj(x.parameters))) if (ajv.validateSchema(t.parameters) !== true) bad.push(t.dir + ' ' + t.name + ' ' + JSON.stringify((ajv.errors ?? []).map((e) => e.instancePath + ' ' + e.message)))
  ok('every tool\'s `parameters` passes the draft 2020-12 meta-schema (Ajv, strict: false, as the engine)', bad.length === 0, bad)
}
console.log(fail === 0 ? '\nall passed' : '\n' + fail + ' FAILED')
process.exit(fail === 0 ? 0 : 1)
