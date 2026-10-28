// test-team-knowledge.mjs — Tests for structured team knowledge.
// Joins scripts/run-all-tests.mjs discovery (packages/*/test*.mjs).

import { strict as assert } from 'node:assert'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  KNOWLEDGE_CATEGORIES, CONFIDENCE_LEVELS,
  ENTRY_MAX_TITLE, ENTRY_MAX_BODY, ENTRY_MAX_CITATIONS, ENTRY_MAX_TAGS,
  SEARCH_MAX_RESULTS,
  normalizeText, tokenize, makeEntry, scoreEntry, searchKnowledge,
  makeKnowledgeStore, formatCitation, uniqueSources,
} from './team-knowledge.mjs'

let n = 0
const ok = (label, cond) => { n += 1; assert.ok(cond, label); console.log('ok  ' + label) }
const eq = (label, a, b) => { n += 1; assert.deepStrictEqual(a, b, label); console.log('ok  ' + label) }

// ── Frozen shapes ─────────────────────────────────────────────────────────────

ok('KNOWLEDGE_CATEGORIES has 10 categories', KNOWLEDGE_CATEGORIES.length === 10)
ok('CONFIDENCE_LEVELS has 3 levels', CONFIDENCE_LEVELS.length === 3)
ok('draft is first confidence', CONFIDENCE_LEVELS[0] === 'draft')
ok('battle-tested is last', CONFIDENCE_LEVELS[2] === 'battle-tested')

// ── normalizeText / tokenize ─────────────────────────────────────────────────

eq('normalize strips accents', normalizeText('Héllo Wörld'), 'hello world')
eq('normalize collapses whitespace', normalizeText('  foo   bar  '), 'foo bar')
eq('tokenize filters short words', tokenize('a bb ccc dddd'), ['ccc', 'dddd'])
eq('tokenize empty', tokenize(''), [])

// ── makeEntry ────────────────────────────────────────────────────────────────

const r1 = makeEntry({ title: 'Test', body: 'Content', category: 'workflow', tags: ['api', 'test'] })
ok('valid entry accepted', r1.ok)
eq('entry title preserved', r1.entry.title, 'Test')
eq('entry category preserved', r1.entry.category, 'workflow')
ok('entry has id', typeof r1.entry.id === 'string' && r1.entry.id.length > 0)
ok('entry has createdAt', typeof r1.entry.createdAt === 'string')
ok('entry status is proposed', r1.entry.status === 'proposed')

const r2 = makeEntry({ title: '', body: 'Content' })
ok('empty title refused', !r2.ok)

const r3 = makeEntry({ title: 'Test', body: '' })
ok('empty body refused', !r3.ok)

const r4 = makeEntry({ title: 'Test', body: 'Content', category: 'bogus' })
ok('unknown category defaults to domain', r4.entry.category === 'domain')

const r5 = makeEntry({ title: 'Test', body: 'Content', confidence: 'bogus' })
ok('unknown confidence defaults to draft', r5.entry.confidence === 'draft')

const r6 = makeEntry({ title: 'x'.repeat(200), body: 'Content' })
ok('title truncated to max', r6.entry.title.length <= ENTRY_MAX_TITLE)

const r7 = makeEntry({ title: 'Test', body: 'y'.repeat(5000) })
ok('body truncated to max', r7.entry.body.length <= ENTRY_MAX_BODY)

const r8 = makeEntry({ title: 'Test', body: 'Content', tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'] })
ok('tags capped at max', r8.entry.tags.length <= ENTRY_MAX_TAGS)

const r9 = makeEntry({ title: 'Test', body: 'Content', citations: [{ source: 'a.md' }, { source: '' }, { source: 'b.md', reference: 'L42' }] })
ok('empty citations filtered', r9.entry.citations.length === 2)
ok('citations capped at max', r9.entry.citations.length <= ENTRY_MAX_CITATIONS)

// ── scoreEntry / searchKnowledge ─────────────────────────────────────────────

const e1 = makeEntry({ title: 'Database migration workflow', body: 'How to run migrations safely', category: 'workflow', tags: ['database', 'migration'] }).entry
const e2 = makeEntry({ title: 'API authentication', body: 'Token-based auth for the REST API', category: 'security', tags: ['api', 'auth'] }).entry
const e3 = makeEntry({ title: 'Deployment pipeline', body: 'CI/CD workflow for staging and prod', category: 'workflow', tags: ['deploy', 'ci'] }).entry

ok('score with empty query is 0', scoreEntry(e1, []) === 0)
ok('score with matching token > 0', scoreEntry(e1, ['database']) > 0)
ok('score with non-matching token is 0', scoreEntry(e1, ['zzz']) === 0)

const results = searchKnowledge([e1, e2, e3], 'database migration')
ok('search finds matching entries', results.length > 0)
ok('search result has score', typeof results[0].score === 'number')
ok('search results sorted by score', results[0].score >= results[results.length - 1].score)

const emptyResults = searchKnowledge([e1, e2, e3], 'zzzz')
ok('no match returns empty', emptyResults.length === 0)

const allResults = searchKnowledge([e1, e2, e3], '')
ok('empty query returns all (up to limit)', allResults.length === 3)

// ── makeKnowledgeStore ───────────────────────────────────────────────────────

const tmp = mkdtempSync(join(tmpdir(), 'team-knowledge-test-'))
const kbFile = join(tmp, 'knowledge.jsonl')
const store = makeKnowledgeStore({
  file: kbFile,
  readFile: (f) => readFileSync(f, 'utf-8'),
  writeFile: (f, d) => writeFileSync(f, d),
})

ok('empty store lists empty', store.list().length === 0)

const addResult = store.add({ title: 'Test entry', body: 'Content here', category: 'workflow' })
ok('add succeeds', addResult.ok)
ok('store has 1 entry', store.list().length === 1)

const getResult = store.get(addResult.entry.id)
ok('get returns the entry', getResult !== null && getResult.title === 'Test entry')

const updateResult = store.update(addResult.entry.id, { title: 'Updated title' })
ok('update succeeds', updateResult.ok)
ok('title updated', store.get(addResult.entry.id).title === 'Updated title')

const dupResult = store.add({ id: addResult.entry.id, title: 'Dup', body: 'x' })
ok('duplicate id refused', !dupResult.ok)

const searchResult = store.search('updated title')
ok('store search works', searchResult.length > 0)

const removeResult = store.remove(addResult.entry.id)
ok('remove succeeds', removeResult.ok)
ok('store empty after remove', store.list().length === 0)

const updateMissing = store.update('nonexistent', { title: 'x' })
ok('update missing entry refused', !updateMissing.ok)

const removeMissing = store.remove('nonexistent')
ok('remove missing entry refused', !removeMissing.ok)

// ── formatCitation / uniqueSources ───────────────────────────────────────────

eq('format citation with reference', formatCitation({ source: 'docs.md', reference: 'L42' }), 'docs.md (L42)')
eq('format citation without reference', formatCitation({ source: 'docs.md' }), 'docs.md')
eq('format empty citation', formatCitation({ source: '' }), '')

const entries = [
  { citations: [{ source: 'a.md' }, { source: 'b.md' }] },
  { citations: [{ source: 'a.md' }, { source: 'c.md' }] },
  { citations: [] },
]
eq('unique sources sorted', uniqueSources(entries), ['a.md', 'b.md', 'c.md'])

// Cleanup
rmSync(tmp, { recursive: true, force: true })

console.log('\nall ' + n + ' checks passed')
