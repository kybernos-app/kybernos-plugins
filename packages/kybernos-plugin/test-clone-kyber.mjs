#!/usr/bin/env node
// « Clone » of an Agent Team keeps every word of the original (audit 2026-10-24, T2-13).
//
// The copy used to be built from the page's read model: `parseKyber` holds the mission and each role prompt cut to 600 characters and
// folded to one line, and `createKyber` cut every prompt to 600 again and wrote only the fields it knows. A 1,200-character prompt came
// back as half a sentence, with nothing said. `cloneOf` (the path of the original kyber.yml) now makes the copy from the RAW file, with a new `id`.
//
//   node packages/kybernos-plugin/test-clone-kyber.mjs
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'kb-clone-kyber-'))
process.env.HOME = home
process.env.USERPROFILE = home
process.env.DSH_HOME = join(home, '.dsh')
const { cloneKyberText } = await import('./index.js')

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const PARA1 = 'You review pull requests for the payments team. '.repeat(12).trim()
const PARA2 = 'Never approve a change that touches the ledger without a test.'
const LIST = ['Check the migration is reversible.', 'Check the money type is never a float.']
const prompt = [PARA1, '', PARA2, '', '- ' + LIST[0], '  - ' + LIST[1]]
const SOURCE = [
  '# the payments reviewers',
  'id: payments-review',
  'specVersion: 1',
  'topology: pipeline',
  'mission: |',
  '  Keep the ledger honest.',
  '',
  '  Nothing merges without a reviewer.',
  'budget:',
  '  total: 5',
  '  currency: EUR',
  'skills:',
  '  - code-review',
  'roles:',
  '  - id: reviewer',
  '    kind: reviewer',
  '    provider: ollama-cloud',
  '    model: glm-5.3',
  '    fallback: ollama-cloud/glm-5.2',
  '    tools: [shell, git]',
  '    prompt: |',
  ...prompt.map((l) => (l === '' ? '' : '      ' + l)),
  '  - id: lead',
  '    provider: ollama-cloud',
  '    model: glm-5.3',
  'stages:',
  '  - id: review',
  '    roles: [reviewer]',
  '    gate: true',
  ''
].join('\n')
assert.ok(prompt.join('\n').length > 600, 'the fixture prompt is longer than the old 600-character cut')

// 1. the pure rewrite
{
  const made = cloneKyberText(SOURCE, 'payments-review-copy')
  assert.equal(made.ok, true)
  assert.equal(made.text, SOURCE.replace('id: payments-review\n', 'id: payments-review-copy\n'), 'only the id line differs')
  assert.ok(made.text.includes(PARA1) && made.text.includes(PARA2), 'both paragraphs of the long prompt are there, whole')
  assert.ok(made.text.includes('    tools: [shell, git]') && made.text.includes('    fallback: ollama-cloud/glm-5.2') && made.text.includes('budget:\n  total: 5'), 'the fields createKyber does not write are kept')
  assert.ok(made.text.includes('      - ' + LIST[1]), 'the nested bullet keeps its indentation')
  ok('the copy is the original with only its id line changed: long prompt, paragraphs, nested list, tools, fallback, budget all kept')
}
{
  const made = cloneKyberText(SOURCE.replace(/\n/g, '\r\n'), 'copy')
  assert.equal(made.ok, true)
  assert.ok(made.text.includes('id: copy\r\n') && !made.text.includes('id: copy\n'), 'a Windows file keeps its line ends on the id line')
  assert.equal((made.text.match(/\r\n/g) || []).length, SOURCE.split('\n').length - 1, 'and everywhere else')
  ok('a CRLF file stays CRLF')
}
{
  const nested = SOURCE.replace('  - id: lead', '  - id: lead\n    id2: x')
  assert.equal(cloneKyberText(nested, 'c').text.split('\n').filter((l) => l.startsWith('id: ')).length, 1)
  assert.ok(cloneKyberText(SOURCE, 'c').text.includes('  - id: reviewer') && cloneKyberText(SOURCE, 'c').text.includes('  - id: lead'), 'the role ids (indented) are not touched')
  assert.equal(cloneKyberText('roles:\n  - id: a\n', 'c').ok, false, 'an indented id is not the team id')
  ok('only the top-level id line is rewritten, never a role or stage id')
}
{
  assert.equal(cloneKyberText('', 'c').ok, false)
  assert.equal(cloneKyberText('   \n', 'c').ok, false)
  assert.equal(cloneKyberText(undefined, 'c').ok, false)
  const none = cloneKyberText('specVersion: 1\nroles: []\n', 'c')
  assert.deepEqual([none.ok, /no id line/.test(none.error)], [false, true])
  const two = cloneKyberText('id: a\nid: b\n', 'c')
  assert.deepEqual([two.ok, /two id lines/.test(two.error)], [false, true])
  ok('an empty file, no id line or two id lines are refused with a reason, never copied half')
}

// 2. the reading fence, taken out of index.js and run on stand-ins
{
  const src = readFileSync(new URL('./index.js', import.meta.url), 'utf8')
  const a = src.indexOf('const readCloneSource = async (path) => {')
  const b = src.indexOf('// A role prompt is kept whole', a)
  assert.ok(a > 0 && b > a, 'readCloneSource exists')
  const make = (o) => new Function('rootsFor', 'cheminAutorise', 'fs', 'errText', src.slice(a, b) + '\nreturn readCloneSource')(
    async () => o.roots, async () => o.allowed, { resolve: async (p) => p, readText: async (p) => { if (o.fails) throw new Error('disk gone'); return 'TEXT of ' + p } }, (e) => e.message)
  const good = { roots: [{ id: 'workspace', path: '/w/kybers' }], allowed: true }
  const read = make(good)
  assert.deepEqual(await read('/w/kybers/team/kyber.yml'), { ok: true, text: 'TEXT of /w/kybers/team/kyber.yml' })
  assert.equal((await read('/w/kybers/team/kyber.yaml')).ok, true, 'kyber.yaml too')
  for (const bad of ['/etc/passwd', '/w/kybers/team/notes.md', '/w/kybers/../secret/kyber.yml', '/other/kybers/team/kyber.yml', '/w/kybers']) {
    assert.equal((await read(bad)).ok, false, bad + ' is refused')
  }
  assert.equal((await make({ ...good, allowed: false })('/w/kybers/team/kyber.yml')).ok, false, 'a path that resolves outside the allowed folders is refused')
  const gone = await make({ ...good, fails: true })('/w/kybers/team/kyber.yml')
  assert.deepEqual([gone.ok, /disk gone/.test(gone.error)], [false, true])
  ok('the source is read only from a kybers root, as a kyber.yml, inside the allowed folders; a read failure says so')
}

// 3. the wiring: the route uses it, the cut is gone, the page sends the path
{
  const host = readFileSync(new URL('./index.js', import.meta.url), 'utf8')
  const client = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
  const start = host.indexOf('const createKyber = async (args) => {')
  const body = host.slice(start, host.indexOf('\n    const ', start + 40))
  assert.ok(body.includes('readCloneSource(req.cloneOf)') && body.includes('cloneKyberText(source.text, id)'), 'createKyber copies from the raw file when it is given cloneOf')
  assert.ok(!/slice\(0, 600\)/.test(body), 'and no role prompt is cut to 600 characters any more')
  assert.ok(body.includes('KB_CREATE_PROMPT_MAX'), 'a real bound is used instead')
  const clone = client.slice(client.indexOf('const cloneKyber = async (entry) => {'), client.indexOf('const exportKyber = (entry) => {'))
  assert.ok(/cloneOf: typeof k\.file === 'string'/.test(clone), 'the page sends the path of the original')
  assert.ok(!/tronque chaque prompt/.test(client), 'the comment no longer claims a 600-character limit')
  ok('createKyber copies from the raw file for cloneOf, no prompt is cut to 600 any more, the page sends the original path')
}

console.log('\n' + pass + ' checks passed')
