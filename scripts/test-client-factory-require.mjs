#!/usr/bin/env node
/** A client bundle that calls `require(...)` must declare it: `factory (require) { ... }`.
 *  DSH's module loader hands `require` to the factory as its argument; there is no global one. A client that writes `factory () {` and then
 *  `require('react')` throws « require is not defined » when the page boots, the entry does not activate (« web boot: 1 entry did not activate »)
 *  and DSH counts the boot as broken. It happened on 2026-10-29: kybernos-webapp-creator was merged into dev that way, and the sandbox showed the
 *  « Failed to load plugins » harness instead of the app. A node test cannot run the loader, so the signature is read from the source.
 *
 *  Usage: node scripts/test-client-factory-require.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

// The code without its comments: a `require(` in prose must not count, and the signature must come from code.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
// What a bundle does with `require`: a call that is not guarded by `typeof require` (a guarded call works without the parameter).
const callsRequire = (code) => /(^|[^\w$.])require\s*\(/.test(code.replace(/typeof\s+require\s*===?\s*['"]function['"]\s*\?\s*require\s*\(/g, ''))
// The parameters of the factory handed to `__ModuleLoader__.load`, or null when the bundle registers some other way.
const factoryParams = (code) => {
  const at = code.indexOf('__ModuleLoader__.load')
  if (at < 0) return null
  const m = /\bfactory\s*\(([^)]*)\)\s*\{/.exec(code.slice(at)) || /\bfactory\s*:\s*(?:function\s*)?\(([^)]*)\)\s*(?:=>)?\s*\{?/.exec(code.slice(at))
  return m === null ? null : m[1].split(',').map((x) => x.trim()).filter((x) => x !== '')
}

// 1. the reader itself, on the three shapes that matter
{
  assert.deepEqual(factoryParams('window.__ModuleLoader__.load({ id: "a", factory (require) { const R = require("react") } })'), ['require'])
  assert.deepEqual(factoryParams('window.__ModuleLoader__.load({ id: "a", factory () { const R = require("react") } })'), [])
  assert.equal(factoryParams('(function () { const x = 1 })()'), null)
  assert.equal(callsRequire('const React = require("react")'), true)
  assert.equal(callsRequire('const React = typeof require === "function" ? require("react") : null'), false, 'a guarded call works without the parameter')
  assert.equal(callsRequire('const x = obj.require("a")'), false, 'a method called require is not the loader\'s')
  assert.equal(callsRequire(stripComments('// a client that calls require(\'react\')\nconst x = 1')), false, 'a comment is not code')
  ok('the reader tells `factory (require)` from `factory ()`, guarded calls and comments')
}

// 2. every client bundle of the repository
{
  const dirs = readdirSync(join(root, 'packages')).filter((d) => existsSync(join(root, 'packages', d, 'client.js'))).sort()
  assert.ok(dirs.length > 30, 'the client bundles were found (' + dirs.length + ')')
  const bad = []
  let checked = 0
  for (const d of dirs) {
    const code = stripComments(readFileSync(join(root, 'packages', d, 'client.js'), 'utf8'))
    const params = factoryParams(code)
    if (params === null) continue
    checked += 1
    if (callsRequire(code) && params.indexOf('require') < 0) bad.push(d + ': `factory (' + params.join(', ') + ')` but the code calls require(...)')
  }
  assert.ok(checked > 25, 'bundles registered through the loader were checked (' + checked + ')')
  assert.deepEqual(bad, [], 'a client calls require without receiving it:\n  ' + bad.join('\n  '))
  ok(checked + ' client bundles: each one that calls require(...) receives it as the factory\'s parameter')
}

console.log('\n' + pass + ' checks passed')
