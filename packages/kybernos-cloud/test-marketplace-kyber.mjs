#!/usr/bin/env node
// The marketplace catalogue (marketplace-kyber.mjs): reading every page of it, finding the item an install asks for, writing a
// kyber.yml that is real YAML, and the plugin's own small reader (parseKyber and its scalar helpers, in kybernos-plugin) reading it back.
//   node packages/kybernos-cloud/test-marketplace-kyber.mjs
//
// The reader exists twice (the host half, index.js, and the page, client.js: DSH loads each as one file, so neither can import it). Both
// are taken from the text between their KB-KYBER-YAML-BEGIN / KB-KYBER-YAML-END markers and run through the same tables, so they cannot
// drift apart. A real YAML parser (the js-yaml of the DSH engine, when this machine has one) is the independent judge of the round trip;
// without it that part says it is skipped.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
// Backslash sequences are built, never typed: a table full of `\u...` is unreadable and easy to get wrong.
const BS = '\\'

// ── the readers, as the plugin ships them ──
const readers = {}
for (const [name, file] of [['host', '../kybernos-plugin/index.js'], ['client', '../kybernos-plugin/client.js']]) {
  const src = readFileSync(new URL(file, import.meta.url), 'utf8')
  const m = /\/\/ KB-KYBER-YAML-BEGIN[^\n]*\n([\s\S]*?)\/\/ KB-KYBER-YAML-END/.exec(src)
  assert.ok(m !== null, 'no KB-KYBER-YAML block in ' + file)
  readers[name] = await import('data:text/javascript,' + encodeURIComponent(m[1] + '\nexport { unquote, inlineList, parseKyber }'))
}

// ── 1. the reader ──
console.log('the reader (host half and page)')
for (const [name, r] of Object.entries(readers)) {
  const { unquote, inlineList } = r
  // what a YAML parser reads for a double-quoted scalar, escape by escape
  assert.equal(unquote('plain'), 'plain', name)
  assert.equal(unquote('  padded  '), 'padded', name)
  assert.equal(unquote('"a' + BS + '"b"'), 'a"b', name)
  assert.equal(unquote('"a' + BS + BS + 'b"'), 'a' + BS + 'b', name)
  assert.equal(unquote('"line' + BS + 'nbreak"'), 'line\nbreak', name)
  assert.equal(unquote('"tab' + BS + 'tx' + BS + 'r"'), 'tab\tx\r', name)
  assert.equal(unquote('"' + BS + 'x41' + BS + 'u00e9' + BS + 'U0001F600"'), 'A\u{e9}\u{1f600}', name)
  assert.equal(unquote('"' + BS + 'N' + BS + 'L' + BS + 'P' + BS + '_"'), '\u{85}\u{2028}\u{2029}\u{a0}', name)
  assert.equal(unquote('"' + BS + '0' + BS + 'e' + BS + 'a' + BS + 'b' + BS + 'v' + BS + 'f"'), '\0\x1b\x07\b\v\f', name)
  assert.equal(unquote('"' + BS + ' ' + BS + '/"'), ' /', name)
  assert.equal(unquote('"' + BS + 'ud800"'), '\u{d800}', name, 'half of a pair comes back as it went')
  // an escape YAML does not have stays as it was written: a path typed by hand is not mangled
  assert.equal(unquote('"C:' + BS + 'Users"'), 'C:' + BS + 'Users', name)
  assert.equal(unquote('"a' + BS + 'qb"'), 'a' + BS + 'qb', name)
  assert.equal(unquote('"' + BS + 'U00110000"'), BS + 'U00110000', name, 'past the last code point: left alone')
  // single quotes: only a doubled quote is an escape
  assert.equal(unquote("'it''s'"), "it's", name)
  assert.equal(unquote("'a" + BS + "nb'"), 'a' + BS + 'nb', name)
  // what it always did
  assert.equal(unquote('""'), '', name)
  assert.equal(unquote("''"), '', name)
  assert.equal(unquote('"abc'), '"abc', name)
  assert.equal(unquote("it's"), "it's", name)
  ok(name + ': a double-quoted scalar is decoded escape by escape, a single-quoted one folds its doubled quotes, the rest is as it was')

  assert.deepEqual(inlineList('[a, b]'), ['a', 'b'], name)
  assert.deepEqual(inlineList('[gmail,calendar]'), ['gmail', 'calendar'], name)
  assert.deepEqual(inlineList('["a, b", c]'), ['a, b', 'c'], name)
  assert.deepEqual(inlineList('["a]", \'b, c\', d]'), ['a]', 'b, c', 'd'], name)
  assert.deepEqual(inlineList('["x' + BS + '"y, z", w]'), ['x"y, z', 'w'], name)
  assert.deepEqual(inlineList("['x'', y', z]"), ["x', y", 'z'], name)
  assert.deepEqual(inlineList("[it's, ok]"), ["it's", 'ok'], name, 'an apostrophe inside a plain item opens nothing')
  assert.deepEqual(inlineList('[a, , b]'), ['a', 'b'], name, 'an empty item is dropped, as before')
  assert.deepEqual(inlineList('[]'), [], name)
  assert.deepEqual(inlineList('solo'), ['solo'], name)
  assert.deepEqual(inlineList(''), [], name)
  ok(name + ': a flow list splits on the commas outside quotes only (and is what it was for plain items)')
}

// A kyber.yml as the OLD marketplace writer wrote it (a name with `: ` and ` #`, an unquoted colour): still read, the same fields.
const OLD_YML = 'id: support-concierge\nspecVersion: 2\nname: Support: Concierge # 1\ncategorie: Support\nglyphe: SC\ncouleur: #2E86AB\norigine: kybernos.app/support-concierge\n\n'
  + 'mission: >-\n  Ton equipe de support client : tri des tickets,\n  reponses dans le bon ton.\n\n'
  + 'roles:\n  - id: manager\n    route: kybernos/doer\n    tools: [gmail, calendar]\n    prompt: >-\n      Pilote le SLA de reponse et trie chaque entree.\n  - id: doer\n    prompt: >-\n      Writes the follow-ups.\n'
const DOC_ATTENDU = {
  id: 'support-concierge', specVersion: '2', topology: null, elucidation: null, maxDepth: null,
  mission: 'Ton equipe de support client : tri des tickets, reponses dans le bon ton.', budget: null, stages: [],
  roles: [
    { id: 'manager', kind: null, needs: {}, provider: null, model: null, tools: ['gmail', 'calendar'], prompt: 'Pilote le SLA de reponse et trie chaque entree.' },
    { id: 'doer', kind: null, needs: {}, provider: null, model: null, tools: [], prompt: 'Writes the follow-ups.' },
  ],
  skills: [],
}
for (const [name, r] of Object.entries(readers)) {
  assert.deepEqual(r.parseKyber(OLD_YML), DOC_ATTENDU, name)
}
ok('a kyber.yml written by the old marketplace writer (unquoted colour, a name with `: ` and ` #`) is read as it always was, by both readers')

// What the plugin's other writers produce (yamlScalar: only `\\` and `\"` escaped) now comes back exactly too.
for (const [name, r] of Object.entries(readers)) {
  const doc = r.parseKyber('id: "my' + BS + '"team' + BS + '""\nskills:\n  - "a' + BS + BS + 'b"\n  - plain\nroles:\n  - id: x\n    prompt: "say ' + BS + '"hi' + BS + '" at C:' + BS + BS + 'tmp"\n')
  assert.equal(doc.id, 'my"team"', name)
  assert.deepEqual(doc.skills, ['a' + BS + 'b', 'plain'], name)
  assert.equal(doc.roles[0].prompt, 'say "hi" at C:' + BS + 'tmp', name)
}
ok('the escapes the plugin\'s own writers use (a quote, a backslash) are decoded: id, skills and prompt come back exactly')

// the two copies are the same code (the host's reads `fallback` too; the page's does not need it)
const hostSrc = readFileSync(new URL('../kybernos-plugin/index.js', import.meta.url), 'utf8')
const clientSrc = readFileSync(new URL('../kybernos-plugin/client.js', import.meta.url), 'utf8')
const between = (s) => /\/\/ KB-KYBER-YAML-BEGIN[^\n]*\n([\s\S]*?)\/\/ KB-KYBER-YAML-END/.exec(s)[1].replace(/\n\s*else if \(k === 'fallback'\)[^\n]*/, '')
assert.equal(between(hostSrc), between(clientSrc), 'the host reader and the page reader have drifted apart')
ok('the host half and the page carry the same reader (apart from the host-only `fallback` key)')

console.log('\n' + pass + ' verifications OK')
