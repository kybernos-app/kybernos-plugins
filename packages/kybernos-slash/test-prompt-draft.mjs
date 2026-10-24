#!/usr/bin/env node
/** « Create with AI » pre-fills a prompt in a fresh chat. DSH 0.2.1-rc.3 reuses the first blank Session again, and a blank may hold the person's unsent draft:
 *  `setDraft` replaces it. The prompt now goes after that draft (DSH's own append, else the two joined), and the retries of the write never stack it.
 *
 *  1. the contract, pinned at source level in client.js;
 *  2. `kbPutPrompt` itself, taken out of client.js and run on stand-in composer shells.
 *
 *  Usage: node packages/kybernos-slash/test-prompt-draft.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')

// 1. source level
{
  const start = src.indexOf('const kbStartWithAI = ')
  const end = src.indexOf('// ── The text of a received message', start)
  assert.ok(start > 0 && end > start, 'kbStartWithAI exists')
  const body = src.slice(start, end)
  assert.match(body, /kbPutPrompt\(shell, prompt\); shell\.focus\(\)/, 'the write goes through kbPutPrompt')
  assert.ok(!/shell\.setDraft\(prompt\)/.test(body), 'kbStartWithAI no longer calls setDraft(prompt) itself')
  assert.match(body, /kbReadComposer\(\)\.indexOf\(prompt\) >= 0\) \{ diag\.ai\.wrote = true; return \}/, 'it stops when the composer HOLDS the prompt (after a draft it is not the whole text)')
  assert.match(body, /depart\.setDraft\(''\)/, 'the « /zzz » token is still erased from the chat it was typed in')
  ok('the prompt is written by kbPutPrompt; the retry stops when the composer holds it; the token is still erased')
}

// 2. kbPutPrompt on stand-in shells
{
  const a = src.indexOf('const kbPutPrompt = ')
  const b = src.indexOf('const kbStartWithAI = ', a)
  assert.ok(a > 0 && b > a, 'kbPutPrompt exists')
  const kbPutPrompt = new Function(src.slice(a, b) + '\nreturn kbPutPrompt')()
  const PROMPT = 'Help me create a command: make it short.'
  const shell = (held, init) => {
    const calls = []
    const s = { calls, setDraft: (x) => calls.push(['set', x]) }
    if (held === 'throws') Object.defineProperty(s, 'draftSnapshot', { get () { throw new Error('no snapshot') } })
    else if (held !== undefined) s.draftSnapshot = { text: held, references: [] }
    if (init !== undefined && init !== false) s.requestDraftInitialization = (o) => { calls.push(['init', o]); if (init === 'throws') throw new Error('refused'); return init === true ? 'applied' : init }
    return s
  }
  const put = (s) => { kbPutPrompt(s, PROMPT); return s.calls }
  const APPEND = ['init', { prompt: PROMPT, whenDraftExists: 'append' }]

  assert.deepEqual(put(shell('', true)), [['set', PROMPT]], 'an empty draft: set')
  assert.deepEqual(put(shell('  \n ', true)), [['set', PROMPT]], 'only blanks: set')
  assert.deepEqual(put(shell(undefined, true)), [['set', PROMPT]], 'an engine that says nothing of the draft: set, as before')
  assert.deepEqual(put(shell('throws', true)), [['set', PROMPT]], 'a snapshot that throws: set, as before')
  assert.deepEqual(put(shell('my own words', true)), [APPEND], 'a reused blank with a draft: DSH appends ours after it, setDraft is not called')
  assert.deepEqual(put(shell('my own words', false)), [['set', 'my own words\n\n' + PROMPT]], 'an engine without the request: the two joined')
  assert.deepEqual(put(shell('my own words', 'preserved')), [APPEND, ['set', 'my own words\n\n' + PROMPT]], 'rc.2 answers « preserved » and adds nothing: the two joined, ours is not lost')
  assert.deepEqual(put(shell('my own words', 'throws')), [APPEND, ['set', 'my own words\n\n' + PROMPT]], 'a request that throws: the two joined')
  assert.deepEqual(put(shell('my own words', 'blocked')), [APPEND], 'a message is going out: nothing is written over it')
  assert.deepEqual(put(shell('my own words\n\n' + PROMPT, true)), [], 'the prompt is already in the draft: nothing is written, so a retry never stacks it')
  assert.deepEqual(put(shell(PROMPT, true)), [], 'the draft is exactly the prompt: left alone')
  ok('kbPutPrompt: sets an empty draft, appends after a typed one (DSH’s request, else joined), never overwrites, never stacks on a retry')
}

console.log('\n' + pass + ' checks passed')
