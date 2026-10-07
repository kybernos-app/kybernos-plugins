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
import { scalaire, scalaireFlux, lignesDeTexte, ymlDuKyber, normaliserCatalogue } from './marketplace-kyber.mjs'

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

// ── 2. the writer: scalars ──
// Every kind of value that is not safe as a plain YAML scalar, and the ones that look safe and are not.
const HOSTILE = [
  '#336699', '#', ' #x', 'a #b', 'a: b', 'a:b', ':a', 'a:', '- x', '-', '-x', '--- x', '... ', '? x', '& x', '&a', '*a', '!tag', '!!js/function x',
  '| x', '> x', "'q'", '"q"', "it's", 'say "hi"', 'back' + BS + 'slash', 'a' + BS + '"b', BS, '"', "'", BS + 'n', '%TAG', '@x', '`x`',
  '{a: b}', '[a, b]', 'a, b', 'a]', 'x}', '<<', '=', '~', 'true', 'False', 'null', 'NULL', 'yes', 'no', 'on', 'off', 'y', 'n',
  '123', '-5', '+5', '1.5', '.5', '1e3', '1_000', '0x1F', '0o17', '017', '0b101', '.inf', '-.INF', '.nan', '1:30', '12:30:45', '2020-01-01', '2020-1-5 10:00',
  '', ' ', ' a', 'a ', '\ta', 'a\tb', 'a\nb', 'a\r\nb', 'a\rb', 'a\n', '\n', 'a\u{2028}b', 'a\u{2029}b', 'a\u{85}b', '\u{feff}x', 'x\u{feff}',
  '\0', '\x01', '\x1b', '\x7f', '\u{80}', '\u{9f}', '\u{fffe}', '\u{ffff}', '\u{d800}', 'x\u{dc00}y', 'a\u{d83d}',
  'key: value\nroles:\n  - id: evil', 'x\nroles:', '  - id: x', 'name: injected', '\nmission: >-', 'a\n---\nb', 'tools: [x]',
  'é', 'Équipe commerciale', 'emoji \u{1f600}', 'zwj \u{200d} joiner', 'a b c', 'a/b', 'kybernos/doer', 'openai/gpt-x', '3d-modeler', 'x'.repeat(300),
]
const flowSafe = ['gmail', 'calendar', 'crm', 'mcp:github', 'web.search', 'x/y', 'a-b_c']

// What a plain value is written as: itself, and what is not safe is double-quoted. The ones people write most.
assert.equal(scalaire('Support Concierge'), 'Support Concierge')
assert.equal(scalaire('Équipe commerciale'), 'Équipe commerciale', 'accents stay readable')
assert.equal(scalaire('kybernos/doer'), 'kybernos/doer')
assert.equal(scalaire('3d-modeler'), '3d-modeler', 'a text that merely starts with a digit is a string')
assert.equal(scalaire('compat-sales-team'), 'compat-sales-team')
assert.equal(scalaire('#336699'), '"#336699"', 'a colour is a comment in YAML unless quoted')
assert.equal(scalaire('true'), '"true"')
assert.equal(scalaire('123'), '"123"')
assert.equal(scalaire(''), '""')
assert.equal(scalaire(null), '""')
assert.equal(scalaire('2024-01-15-report'), '"2024-01-15-report"', 'it starts like a date')
assert.equal(scalaire('Odd: name # 1'), '"Odd: name # 1"')
assert.equal(scalaire('a\nb'), '"a' + BS + 'nb"')
assert.equal(scalaire('x\u{2028}y'), '"x' + BS + 'u2028y"')
assert.equal(scalaire('x\u{85}y'), '"x' + BS + 'x85y"')
assert.equal(scalaire('\u{d800}'), '"' + BS + 'uD800"')
assert.equal(scalaire('\u{1f600}'), '\u{1f600}', 'emoji stay as they are')
assert.equal(scalaire('say "hi" \\ there'), 'say "hi" \\ there', 'a quote or a backslash inside a plain value is only text')
assert.equal(scalaire('"hi" there'), '"' + BS + '"hi' + BS + '" there"', 'but a value that STARTS with a quote must be quoted')
assert.equal(scalaireFlux('gmail'), 'gmail')
assert.equal(scalaireFlux('mcp:github'), '"mcp:github"', 'a colon is not safe in a flow list')
assert.equal(scalaireFlux('a, b'), '"a, b"')
assert.equal(scalaireFlux('x]'), '"x]"')
ok('the common values are written as they were (accents, slashes, a leading digit), what is not safe is double-quoted: a colour, a boolean, a number, a date, `: `, ` #`')

for (const [name, r] of Object.entries(readers)) {
  for (const h of HOSTILE) {
    const w = scalaire(h)
    assert.equal(/[\n\r\u{85}\u{2028}\u{2029}]/u.test(w), false, 'one line: ' + JSON.stringify(h))
    assert.equal(w.isWellFormed(), true, 'well formed: ' + JSON.stringify(h))
    assert.equal(/[\0-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u{feff}\u{fffe}\u{ffff}]/u.test(w), false, 'no control character in the file: ' + JSON.stringify(h))
    assert.equal(r.unquote(w), h, name + ' reads back ' + JSON.stringify(h) + ' from ' + w)
    // a list item: the same, and the list still has the items it had
    const list = '[' + [scalaireFlux(h), scalaireFlux('z')].join(', ') + ']'
    assert.deepEqual(r.inlineList(list), [h, 'z'].filter((x) => x !== ''), name + ' reads back the list ' + list)
  }
  for (const t of flowSafe) assert.equal(r.inlineList('[' + scalaireFlux(t) + ']')[0], t, name)
}
ok('round trip, ' + HOSTILE.length + ' hostile values: one line, no control character in the file, and both readers give back exactly what went in (as a value and as a list item)')

// A text that may run over several lines: a folded block when YAML can carry it, else one escaped line.
{
  assert.deepEqual(lignesDeTexte('mission', 'Follow up on every lead.', 0), ['mission: >-', '  Follow up on every lead.'])
  assert.deepEqual(lignesDeTexte('prompt', 'one\ntwo\n\nthree', 4), ['    prompt: >-', '      one', '      two', '', '      three'])
  assert.deepEqual(lignesDeTexte('prompt', '\n\nlast  \n\n', 4), ['    prompt: >-', '      last'], 'blank lines around the text and trailing spaces are not part of it')
  assert.equal(lignesDeTexte('mission', '  starts with a space', 0)[0], 'mission: "  starts with a space"', 'a block would lose the first space')
  assert.equal(lignesDeTexte('mission', 'tab\there', 0)[0], 'mission: "tab' + BS + 'there"')
  assert.equal(lignesDeTexte('mission', 'a\u{2028}b', 0)[0], 'mission: "a' + BS + 'u2028b"')
  assert.equal(lignesDeTexte('mission', 'a\x01b', 0)[0], 'mission: "a' + BS + 'x01b"')
  assert.equal(lignesDeTexte('mission', 'line one\r\nline two', 0).length, 3, 'CRLF is a line break, not a character')
  assert.equal(lignesDeTexte('mission', 'a: b # c\n- d\n# e', 0).length, 4, 'inside a block, `: `, ` #`, `- ` and `#` are only text')
  ok('a text is a folded block when YAML can carry it as it is; a leading space, a tab, a control or a separator makes it one escaped line')
}

// ── 3. the writer: the whole file ──
console.log('the file')
// What the OLD writer made of ordinary text (copied from its output): the new one makes the same file, but for the colour,
// which was a YAML comment and is now a string.
const PLAIN_ITEM = {
  id: 'i1', slug: 'support-concierge', name: 'Support Concierge', cat: 'Support', glyph: 'SC', color: '#2E86AB', version: 2,
  pitch: 'Ton equipe de support client : tri des tickets, reponses dans le bon ton.',
  agents: [
    { role_key: 'custom:manager', name: 'Manager', does: 'Pilote le SLA de reponse et trie chaque entree.', model_route: 'kybernos/doer', tools: ['gmail', 'calendar'] },
    { role_key: 'custom:doer', name: 'Dex', does: 'Writes the follow-ups.', model_route: '', tools: [] },
    { role_key: 'checker', name: 'Chk', tools: [] },
  ],
}
const OLD_PLAIN_YML = 'id: support-concierge\nspecVersion: 2\nname: Support Concierge\ncategorie: Support\nglyphe: SC\ncouleur: #2E86AB\norigine: kybernos.app/support-concierge\n\n'
  + 'mission: >-\n  Ton equipe de support client : tri des tickets, reponses dans le bon ton.\n\n'
  + 'roles:\n  - id: manager\n    route: kybernos/doer\n    tools: [gmail, calendar]\n    prompt: >-\n      Pilote le SLA de reponse et trie chaque entree.\n  - id: doer\n    prompt: >-\n      Writes the follow-ups.\n  - id: checker\n'
{
  const made = ymlDuKyber(PLAIN_ITEM)
  assert.equal(made.yml, OLD_PLAIN_YML.replace('couleur: #2E86AB', 'couleur: "#2E86AB"'))
  assert.deepEqual(made.roles.map((r) => r.id), ['manager', 'doer', 'checker'])
  assert.deepEqual(made.aCompleter, [
    'role « checker » : aucun prompt publie (does absent)',
    'sans route de modele : doer, checker',
    'la route de modele de la plateforme n\'est pas un couple provider/modele : manager→kybernos/doer — choisir provider/model localement',
    'les etapes (stages) ne sont pas publiees par le catalogue : les declarer localement',
  ])
  for (const [name, r] of Object.entries(readers)) assert.deepEqual(r.parseKyber(made.yml), r.parseKyber(OLD_PLAIN_YML), name + ': the same kyber for the plugin, old file or new')
  assert.deepEqual(ymlDuKyber(null), { yml: null, roles: [], aCompleter: ['entree de catalogue sans slug'] })
  assert.equal(ymlDuKyber({ slug: '' }).yml, null)
  ok('ordinary text: the file is the old one but for `couleur: "#2E86AB"`, same roles, same list of what is left to write, same kyber for the plugin')
}

// The same item, with a hostile value everywhere a value goes.
const TOP = ['id', 'specVersion', 'name', 'categorie', 'glyphe', 'couleur', 'origine', 'mission', 'roles']
const WS = /[\s\u{85}\u{2028}\u{2029}]+/u
const collapse = (t) => t.split(WS).filter(Boolean).join(' ')
const texte = (t) => t.replace(/\r\n?/g, '\n').replace(/^\n+/, '').replace(/\s+$/, '')
const oneLiner = (t) => t === t.trim() && /[\n\r\u{85}\u{2028}\u{2029}]/u.test(t) === false
const hostileItem = (h) => ({
  id: 'i', slug: 'odd-item', name: h === '' ? 'n' : h, cat: h, glyph: h, color: h, pitch: h, version: 1,
  agents: [{ role_key: 'custom:a', name: h, does: h, model_route: h, tools: [h, 'z'] }],
})
const engine = (() => {
  if (process.env.NO_DSH_ENGINE === '1') return null
  const root = join(homedir(), '.dsh', 'kybernos', 'moteur')
  const dirs = []
  try { for (const v of readdirSync(root).sort().reverse()) dirs.push(join(root, v, 'node_modules')) } catch (e) { /* no engine here */ }
  dirs.push('/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules')
  for (const d of dirs) {
    try { return createRequire(join(d, '@deepseek-ai', 'dsh-app-boot', 'package.json'))('js-yaml') } catch (e) { /* next */ }
  }
  return null
})()
let judged = 0
for (const h of HOSTILE) {
  const item = hostileItem(h)
  const { yml } = ymlDuKyber(item)
  const label = JSON.stringify(h)
  assert.equal(yml.isWellFormed(), true, label)
  assert.equal(/[\0-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u{feff}\u{fffe}\u{ffff}\u{2028}\u{2029}]/u.test(yml), false, 'no control character or separator in the file: ' + label)
  // no extra key: the lines at column 0 are exactly the keys of the file, in order
  const keys = yml.split('\n').filter((l) => /^\S/.test(l)).map((l) => l.slice(0, l.indexOf(':')))
  const want = TOP.filter((k) => !((k === 'categorie' && h === '') || (k === 'glyphe' && h === '') || (k === 'couleur' && h === '')))
  assert.deepEqual(keys, want, 'keys: ' + label)
  const after = yml.slice(yml.indexOf('\nroles:\n'))
  const roleKeys = after.split('\n').filter((l) => /^ {4}[A-Za-z]+:/.test(l)).map((l) => l.trim().slice(0, l.trim().indexOf(':')))
  assert.deepEqual(roleKeys, [].concat(h === '' ? [] : ['route'], ['tools'], texte(h) === '' ? [] : ['prompt']), 'role keys: ' + label)
  for (const [name, r] of Object.entries(readers)) {
    const top = (k) => { const l = yml.split('\n').find((x) => x.startsWith(k + ': ')); return l === undefined ? undefined : r.unquote(l.slice(k.length + 2)) }
    assert.equal(top('id'), 'odd-item', name + ' ' + label)
    assert.equal(top('specVersion'), '2', name + ' ' + label)
    assert.equal(top('name'), item.name, name + ' name ' + label)
    if (h !== '') for (const k of ['categorie', 'glyphe', 'couleur']) assert.equal(top(k), h, name + ' ' + k + ' ' + label)
    assert.equal(top('origine'), 'kybernos.app/odd-item', name + ' ' + label)
    const doc = r.parseKyber(yml)
    assert.equal(doc.id, 'odd-item', name + ' ' + label)
    assert.equal(doc.roles.length, 1, name + ' one role, never more: ' + label)
    assert.deepEqual([doc.stages.length, doc.skills.length, doc.budget, doc.topology], [0, 0, null, null], name + ' nothing else appears: ' + label)
    assert.equal(doc.roles[0].id, 'a', name + ' ' + label)
    assert.deepEqual(doc.roles[0].tools, [h, 'z'].filter((x) => x !== ''), name + ' tools ' + label)
    const mission = texte(h) === '' ? '(mission non publiee)' : texte(h)
    assert.equal(collapse(doc.mission), collapse(mission), name + ' mission ' + label)
    if (oneLiner(mission) === true) assert.equal(doc.mission, mission, name + ' mission, exactly ' + label)
    if (texte(h) === '') assert.equal(doc.roles[0].prompt, null, name + ' ' + label)
    else {
      assert.equal(collapse(doc.roles[0].prompt), collapse(texte(h)), name + ' prompt ' + label)
      if (oneLiner(texte(h)) === true) assert.equal(doc.roles[0].prompt, texte(h), name + ' prompt, exactly ' + label)
    }
    const route = after.split('\n').find((l) => l.startsWith('    route: '))
    if (h === '') assert.equal(route, undefined, name)
    else assert.equal(r.unquote(route.slice('    route: '.length)), h, name + ' route ' + label)
  }
  if (engine !== null) {
    // the independent judge: a real YAML parser reads the same thing
    const doc = engine.load(yml)
    assert.deepEqual(Object.keys(doc), want, 'js-yaml keys: ' + label)
    assert.deepEqual([doc.id, doc.specVersion, doc.name, doc.origine], ['odd-item', 2, item.name, 'kybernos.app/odd-item'], 'js-yaml ' + label)
    if (h !== '') assert.deepEqual([doc.categorie, doc.glyphe, doc.couleur], [h, h, h], 'js-yaml scalars ' + label)
    assert.equal(doc.roles.length, 1, label)
    assert.deepEqual(Object.keys(doc.roles[0]), ['id', ...(h === '' ? [] : ['route']), 'tools', ...(texte(h) === '' ? [] : ['prompt'])], 'js-yaml role keys ' + label)
    assert.deepEqual(doc.roles[0].tools, [h, 'z'], 'js-yaml tools ' + label)
    if (h !== '') assert.equal(doc.roles[0].route, h, 'js-yaml route ' + label)
    assert.equal(collapse(doc.mission), collapse(texte(h) === '' ? '(mission non publiee)' : texte(h)), 'js-yaml mission ' + label)
    if (texte(h) !== '') assert.equal(collapse(doc.roles[0].prompt), collapse(texte(h)), 'js-yaml prompt ' + label)
    judged += 1
  }
}
ok('round trip, ' + HOSTILE.length + ' hostile values in every field: the same keys and no more, and both readers give back the name, category, glyph, colour, route, tools, mission and prompt')
if (engine !== null) ok('js-yaml (the DSH engine\'s) reads the same ' + judged + ' files the same way: every scalar exact, the texts equal once the folding of the block is applied')
else console.log('  - skipped: no js-yaml of the DSH engine on this machine (the plugin\'s reader above is the only judge here)')

// The kyber of the dsh-compat check (a name and a crew full of `:` and `#`): one value per line, a file a parser can read.
{
  const made = ymlDuKyber({
    id: 'i', slug: 'odd-name-1', name: 'Odd: name # 1', cat: 'Sales', glyph: 'bot', color: '#336699', pitch: 'Follow up on every lead the day it comes in.',
    agents: [{ role_key: 'x', name: 'Ex: Why', does: 'first line second: line # not a key', tools: [] }],
  })
  assert.match(made.yml, /^name: "Odd: name # 1"$/m)
  assert.match(made.yml, /^couleur: "#336699"$/m)
  assert.match(made.yml, /^ {6}first line second: line # not a key$/m)
  if (engine !== null) assert.deepEqual([engine.load(made.yml).name, engine.load(made.yml).couleur], ['Odd: name # 1', '#336699'])
  ok('the colour and the name of the live check are quoted; a prompt with `: ` and ` #` is a block and stays as it is')
}

// ── 4. what a catalogue answer is made of (the page of the catalogue: the same before and after) ──
console.log('the catalogue answer')
{
  const unreadable = { ok: false, items: [], motif: 'reponse illisible' }
  assert.deepEqual(normaliserCatalogue(null), unreadable)
  assert.deepEqual(normaliserCatalogue(3), unreadable)
  assert.deepEqual(normaliserCatalogue({}), { ok: false, items: [], motif: 'aucun champ « items »' })
  assert.deepEqual(normaliserCatalogue({ items: 5 }), { ok: false, items: [], motif: 'aucun champ « items »' })
  assert.deepEqual(normaliserCatalogue({ items: [] }), { ok: false, items: [], motif: 'catalogue vide' })
  assert.deepEqual(normaliserCatalogue({ items: [null, 1, {}, { slug: 'a' }, { name: 'n' }] }), { ok: false, items: [], motif: 'aucune entree exploitable (5 ecartee(s))' })
  assert.deepEqual(normaliserCatalogue({ items: [{ slug: 'a', name: 'A', manifest: { price: 3, data_schemas: {}, source_kyber_id: 'x', agents: [null, { role_key: 'r' }] }, version: '4', published_at: 'd' }] }), {
    ok: true, motif: null,
    items: [{ id: 'a', slug: 'a', name: 'A', cat: '', pitch: '', glyph: '', color: '', version: 4, publishedAt: 'd', agents: [{ role_key: 'r' }], manifest: { agents: [null, { role_key: 'r' }] }, origine: 'kybernos.app' }],
  })
  ok('an answer that is not a catalogue says why; the private keys of a manifest are dropped; an unusable entry is counted, not shown')
}

console.log('\n' + pass + ' verifications OK')
