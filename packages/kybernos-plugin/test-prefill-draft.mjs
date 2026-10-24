#!/usr/bin/env node
/** The pre-filled chat (« Send feedback », a new automation, a team chat, a task that fires): DSH 0.2.1-rc.3 reuses the first blank Session again, and a blank may hold
 *  the person's unsent draft. `setDraft` replaces, so a text we pre-fill must go AFTER that draft, as DSH's own new-task request does (`whenDraftExists: 'append'`).
 *
 *  1. the contract, pinned at source level in client.js (which callers say the Session was reused, and that the helper keeps it through its retries);
 *  2. `kbDraftPut` itself, taken out of client.js and run on stand-in composer shells.
 *
 *  Usage: node packages/kybernos-plugin/test-prefill-draft.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, 'client.js'), 'utf8')

// 1. source level
{
  assert.match(src, /const kbPrefillDraft = \(text, attempt, sidArg, reused\) => \{/, 'the helper takes « reused »')
  assert.equal((src.match(/kbDraftPut\(shell2?, text, reused\)/g) || []).length, 2, 'both ways to the composer (the service and the session scope) go through kbDraftPut')
  const body = src.slice(src.indexOf('const kbPrefillDraft = '), src.indexOf('const kbStartChatText = '))
  assert.ok(!/\.actions\.setDraft\(text\)/.test(body), 'kbPrefillDraft no longer calls setDraft itself: only kbDraftPut does')
  assert.match(body, /kbPrefillDraft\(text, n \+ 1, sid, reused\)/, 'the retry keeps « reused »')
  // the three places that open a Session and fill it
  assert.match(src, /kbAwaitNewSession\(before, \(sid, isNew\) => \{\n\s+kbPrefillDraft\(text, 0, sid, isNew === false\)/, 'the generic pre-filled chat says when the Session was reused')
  assert.match(src, /kbAwaitNewSession\(before, \(sid, isNew\) => \{ try \{ kbPrefillDraft\(text, 0, sid, isNew === false\) \}/, 'a task that fires says it too')
  assert.match(src, /kbPrefillDraft\(kbTeamKickoff\(team\), 0, sid, isNew === false\)/, 'a team chat says it too')
  assert.ok(!/kbPrefillDraft\(text, 0, sid\)\s/.test(src), 'no start-a-chat caller is left without the flag')
  ok('every caller that opens a Session says whether DSH reused a blank one; the helper keeps it through its retries and only kbDraftPut writes')
}

// 2. kbDraftPut, on stand-in shells
{
  const a = src.indexOf('const kbDraftPut = ')
  const b = src.indexOf('    // Préremplit le composer du chat courant', a)
  assert.ok(a > 0 && b > a, 'kbDraftPut exists')
  const kbDraftPut = new Function(src.slice(a, b) + '\nreturn kbDraftPut')()
  const TEXT = '/skill-ai-team-creator Help me create an Agent Team.'
  const shell = (draft, withInit) => {
    const calls = []
    const s = { actions: { setDraft: (x) => calls.push(['set', x]) }, calls }
    if (draft !== undefined) s.draftSnapshot = draft === 'throws' ? undefined : { text: draft, references: [] }
    if (draft === 'throws') Object.defineProperty(s, 'draftSnapshot', { get () { throw new Error('no snapshot on this engine') } })
    if (withInit !== undefined && withInit !== false) s.requestDraftInitialization = (o) => { calls.push(['init', o]); if (withInit === 'throws') throw new Error('refused'); return withInit === true ? 'applied' : withInit }
    return s
  }
  const run = (s, reused) => { kbDraftPut(s, TEXT, reused); return s.calls }

  assert.deepEqual(run(shell('my own words', true), false), [['set', TEXT]], 'a Session we just made: the draft is ours to set, as before')
  assert.deepEqual(run(shell('my own words', true), undefined), [['set', TEXT]], 'no flag: as before')
  assert.deepEqual(run(shell('', true), true), [['set', TEXT]], 'a reused blank with nothing typed: set')
  assert.deepEqual(run(shell('  \n ', true), true), [['set', TEXT]], 'only blanks typed: set')
  assert.deepEqual(run(shell('my own words', true), true), [['init', { prompt: TEXT, whenDraftExists: 'append' }]], 'a reused blank with a draft: DSH appends ours after it, setDraft is not called')
  assert.deepEqual(run(shell('my own words', false), true), [['set', 'my own words\n\n' + TEXT]], 'an engine without that request: ours goes after theirs, nothing of theirs is lost')
  assert.deepEqual(run(shell('my own words', 'preserved'), true), [['init', { prompt: TEXT, whenDraftExists: 'append' }], ['set', 'my own words\n\n' + TEXT]], 'rc.2 has the request but keeps the draft and adds nothing (« preserved »): the two are joined, ours is not lost')
  assert.deepEqual(run(shell('my own words', 'throws'), true), [['init', { prompt: TEXT, whenDraftExists: 'append' }], ['set', 'my own words\n\n' + TEXT]], 'a request that throws: the two are joined')
  assert.deepEqual(run(shell('my own words', 'blocked'), true), [['init', { prompt: TEXT, whenDraftExists: 'append' }]], 'a message is going out (« blocked »): nothing is written over it')
  assert.deepEqual(run(shell('  ' + TEXT + ' ', true), true), [['set', TEXT]], 'the draft already is our text (a second click): set again, not doubled')
  assert.deepEqual(run(shell('throws', true), true), [['set', TEXT]], 'an engine that cannot say what the draft is (rc.2 always made a new Session): as before')
  assert.deepEqual(run(shell(undefined, true), true), [['set', TEXT]], 'no snapshot at all: as before')
  ok('kbDraftPut: replaces only a draft we made ourselves; after a reused blank’s unsent text it appends (DSH’s request, else the two joined); nothing lost, never doubled')
}

console.log('\n' + pass + ' checks passed')
