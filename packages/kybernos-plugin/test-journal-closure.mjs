#!/usr/bin/env node
/** R1 guard (recoupement 2026-10-15): the « Journal » tab (workflows-v2) must not reference a name that
 *  nothing declares.
 *
 *  Why it exists: a clean-up commit deleted the journal's stylesheet (`WV2_CSS`) and its format helpers
 *  (`wvDur`, `wvEur`, `wvTok`, `wvClock`, `wvRunSpan`, `wvFirstIssue`) while they were still called, and renamed
 *  `wv2JeuDemo` without renaming its callers. The block is wrapped in a try/catch, so DSH kept starting and the
 *  tab silently disappeared (`[workflows-v2] tab disabled ReferenceError: WV2_CSS is not defined`), with every
 *  unit test green. Source-level: the bundle is a browser module, not importable here.
 *
 *  Usage: node packages/kybernos-plugin/test-journal-closure.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(process.env.KB_PLUGIN_CLIENT || join(here, 'client.js'), 'utf8')

// The journal block: from its banner to the catch that reports « tab disabled ».
const start = src.indexOf('workflows-v2 · journal d')
const end = src.indexOf("[workflows-v2] tab disabled", start)
assert.ok(start > 0 && end > start, 'the workflows-v2 block was found')
const block = src.slice(start, end)

// Strip string/template literals' CSS and comments so only code is scanned: names inside the stylesheet or
// in prose must not count as references.
const code = block
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  .replace(/`(?:[^`\\]|\\.)*`/g, '``')
  .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
  .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')

// 1. Every identifier of the journal's own namespaces is declared somewhere in the file.
{
  const NS = /(?<![.\w$])(WV2?_[A-Z0-9_]+|wv2?[A-Z][A-Za-z0-9]*|en(?:Vide|Demo))(?![\w$])/g
  const used = new Set()
  for (const m of code.matchAll(NS)) used.add(m[1])
  assert.ok(used.size > 20, 'the journal namespace was scanned (' + used.size + ' names)')
  const missing = []
  for (const name of used) {
    const decl = new RegExp('(?:\\b(?:const|let|var|function)\\s+' + name + '\\b)|(?:catch\\s*\\(\\s*' + name + '\\s*\\))|(?:[(,]\\s*' + name + '\\s*[,)]\\s*=>)|(?:\\(\\s*[^)]*\\b' + name + '\\b[^)]*\\)\\s*=>)')
    if (!decl.test(src)) missing.push(name)
  }
  assert.deepEqual(missing, [], 'names used by the journal and declared nowhere: ' + missing.join(', '))
  ok('the journal references only names that are declared (' + used.size + ' checked)')
}

// 2. The stylesheet is declared AND handed to the style slot.
{
  assert.ok(/const WV2_CSS = `/.test(src), 'WV2_CSS is declared')
  assert.ok(/styles\.insert\(WV2_CSS\)/.test(src), 'WV2_CSS is inserted')
  ok('the journal stylesheet exists and is inserted')
}

// 3. No demo dataset comes back (UB-7: an empty journal is shown empty, never as sample data).
{
  assert.ok(!/\bWV_RUNS\b|\bWV_GRAPHS\b|\bwv2JeuDemo\b/.test(code), 'no demo dataset identifier is referenced')
  assert.ok(!/kbe\('[^']*[Dd]emo/.test(block), 'no label offers a demo dataset')
  ok('no demo dataset is referenced (an empty journal stays empty)')
}

// 4. Behaviour: the model of an EMPTY journal (what a session with no run gets) does not throw. The first
//    version of the empty journal read `runs[-1].r` and crashed the tab ("slot entry crashed in
//    'conversation.view'"). The three functions are cut out of the bundle and run as they are; any name
//    they use from the enclosing scope is a stub.
{
  const cutFunction = (name) => {
    const at = src.indexOf('function ' + name + '(')
    assert.ok(at >= 0, name + ' was found')
    let i = src.indexOf('{', src.indexOf(')', at))
    let depth = 0
    for (; i < src.length; i += 1) {
      const c = src[i]
      if (c === "'" || c === '"' || c === '`') {
        // skip a string / template literal (escapes honoured)
        for (i += 1; i < src.length && src[i] !== c; i += 1) if (src[i] === '\\') i += 1
      } else if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i) } else if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1 } else if (c === '{') depth += 1
      else if (c === '}') { depth -= 1; if (depth === 0) return src.slice(at, i + 1) }
    }
    throw new Error('unterminated ' + name)
  }
  const code = ['wv2Vide', 'wv2Source', 'wv2Modele'].map(cutFunction).join('\n')
  const stub = () => 0
  const scope = new Proxy({ kbe: (x) => x, WV_LLM: { orch: 1, doer: 1, checker: 1 }, Math, Object, Array, String, Number, JSON }, {
    has: () => true,
    get: (t, k) => (k in t ? t[k] : (k === Symbol.unscopables ? undefined : stub))
  })
  const ctx = vm.createContext(scope)
  vm.runInContext(code, ctx)
  const model = vm.runInContext('wv2Modele', ctx)
  const vide = vm.runInContext('wv2Vide', ctx)
  const S = { run: 0, step: 0, trig: 'all', npos: {}, range: [540, 900], exp: {}, data: null, srcSel: 'courante' }
  let m
  assert.doesNotThrow(() => { m = model(S) }, 'the model of an empty journal must not throw')
  assert.equal(m.empty, true, 'the model says it is empty')
  assert.equal(m.loading, true, 'before the runs arrive it says it is loading')
  S.data = vide()
  m = model(S)
  assert.equal(m.empty, true)
  assert.equal(m.loading, false, 'once the answer is in, an empty journal is not loading')
  ok('an empty journal has a model (no crash): loading first, then empty')
}

console.log('\n' + pass + ' checks passed')
