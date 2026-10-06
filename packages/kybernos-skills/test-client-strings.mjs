#!/usr/bin/env node
/** The words of the Skills screen: every string the client asks for exists in French AND English, and every word the Team routes can
 *  answer with has a sentence. No browser: the client is read as text (it is a browser bundle, not importable).
 *
 *  A missing key would not crash anything: `t()` returns the key itself, so the user would read "tm.e.write_failed" on screen. This
 *  is the test that says it before they do.
 *
 *  Usage: node packages/kybernos-skills/test-client-strings.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, 'client.js'), 'utf8')

// The dictionary: one entry per line, `'key': { fr: '…', en: '…' },`.
const dict = new Map()
for (const m of src.matchAll(/^\s+'([A-Za-z0-9_.]+)': \{ fr: (.+), en: (.+) \},?\s*$/gm)) dict.set(m[1], { fr: m[2], en: m[3] })
assert.ok(dict.size > 150, 'the dictionary was read (' + dict.size + ' entries)')

// 1. both languages, and no placeholder the other language lacks
for (const [key, row] of dict) {
  assert.ok(row.fr.length > 2 && row.en.length > 2, key + ' has an empty side')
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join()
  assert.equal(vars(row.fr), vars(row.en), key + ': the French and English sentences must use the same {variables}')
}
ok('every entry has a French and an English sentence with the same {variables} (' + dict.size + ' entries)')

// 2. every literal t('key') of the client exists
const used = new Set([...src.matchAll(/\bt\('([A-Za-z0-9_.]+)'\s*[,)]/g)].map((m) => m[1]))
const missing = [...used].filter((k) => !dict.has(k))
assert.deepEqual(missing, [], 'keys asked for and not defined: ' + missing.join(', '))
ok('every t(\'…\') of the client names a defined key (' + used.size + ' used)')

// 3. the families built at run time: t('tm.lock.' + kind + '.t'), t('tm.st.' + status), t('tm.empty.' + view), t('tm.e.' + word)
const need = []
for (const kind of ['plan', 'signin', 'space', 'server', 'reconnect', 'net']) need.push('tm.lock.' + kind + '.t', 'tm.lock.' + kind + '.b')
need.push('tm.lock.other.t')
for (const st of ['proposed', 'approved', 'rejected', 'retired']) need.push('tm.st.' + st)
for (const v of ['approved', 'mine', 'review', 'retired']) need.push('tm.empty.' + v, 'tm.empty.' + v + 'Hint')
for (const v of ['approved', 'mine', 'review', 'retired']) assert.ok(src.includes("'tm.v." + v + "'"), 'the sub-view ' + v)
assert.deepEqual(need.filter((k) => !dict.has(k)), [])
ok('the lock reasons, the statuses and the empty states all have their sentences')

// 4. every word the Team routes (kybernos-cloud/team-skills.mjs) and the disk half (index.js) can answer with has a sentence
const cloud = readFileSync(join(here, '..', 'kybernos-cloud', 'team-skills.mjs'), 'utf8')
const host = readFileSync(join(here, 'index.js'), 'utf8')
const words = new Set()
for (const m of cloud.matchAll(/error: '([a-z_]+)'/g)) words.add(m[1])
for (const body of host.slice(host.indexOf('const packSkill'), host.indexOf('// ── CREATION')).matchAll(/error: '([a-z_]+)'/g)) words.add(body[1])
// What a reviewer or the user can meet: every word, except the generic ones that fall back to "Failed ({code})" on purpose.
// `refused_<status>` is the server's answer to a status nobody planned; `skill_disabled` has its own sentence in the propose sheet.
const generic = new Set(['refused_', 'skill_disabled'])
const noSentence = [...words].filter((w) => !generic.has(w) && !dict.has('tm.e.' + w) && !dict.has('tm.p.bad.' + w))
assert.deepEqual(noSentence, [], 'answers with no sentence: ' + noSentence.join(', '))
assert.ok(words.size > 15, 'the answer words were read (' + words.size + ')')
ok('every answer of the Team routes and of pack/install has a sentence (' + words.size + ' words, ' + generic.size + ' deliberately generic)')

// 5. the ways a skill can fail to be packed each have a sentence
for (const reason of ['binary', 'file_too_large', 'too_many_files', 'too_large', 'bad_path', 'frontmatter', 'name', 'description', 'no_skill_md']) {
  assert.ok(src.includes(reason + ": 'tm.p.bad."), 'no sentence for the pack reason ' + reason)
}
ok('each reason a skill cannot be shared (picture, size, count, name, path, frontmatter, missing SKILL.md) has a sentence')

console.log('\n' + pass + ' verifications OK')
