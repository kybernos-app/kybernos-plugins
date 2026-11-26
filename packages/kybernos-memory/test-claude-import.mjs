// test-claude-import.mjs — Tests for the Claude memory importer.
// Joins scripts/run-all-tests.mjs discovery (packages/*/test*.mjs).

import { strict as assert } from 'node:assert'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  IMPORT_STATUSES, IMPORT_SOURCES, ENTRY_MAX_CHARS, ENTRY_MAX_TAGS, IMPORT_BATCH_MAX,
  parseFrontmatter, extractTitle, extractTags, truncateEntry,
  scanClaudeMemory, toImportEntry, normalizeForDedup, similarity, deduplicate,
  importClaudeMemories, setEntryStatus, readStaging, writeStaging, statusCounts,
} from './claude-import.mjs'

let n = 0
const ok = (label, cond) => { n += 1; assert.ok(cond, label); console.log('ok  ' + label) }
const eq = (label, a, b) => { n += 1; assert.deepStrictEqual(a, b, label); console.log('ok  ' + label) }

// ── Frozen shapes ─────────────────────────────────────────────────────────────

ok('IMPORT_STATUSES has 4 statuses', IMPORT_STATUSES.length === 4)
ok('staging is the first status', IMPORT_STATUSES[0] === 'staging')
ok('locked is the last status', IMPORT_STATUSES[IMPORT_STATUSES.length - 1] === 'locked')
ok('ENTRY_MAX_CHARS is 500', ENTRY_MAX_CHARS === 500)
ok('ENTRY_MAX_TAGS is 5', ENTRY_MAX_TAGS === 5)

// ── parseFrontmatter ─────────────────────────────────────────────────────────

const fm1 = parseFrontmatter('---\nname: test\ndescription: "Hello world"\ntags: a,b,c\n---\nBody here')
eq('frontmatter parsed', fm1.frontmatter, { name: 'test', description: 'Hello world', tags: 'a,b,c' })
eq('body extracted', fm1.body, 'Body here')

const fm2 = parseFrontmatter('No frontmatter here')
eq('no frontmatter', fm2.frontmatter, {})
eq('body is full text', fm2.body, 'No frontmatter here')

const fm3 = parseFrontmatter('---\nname: x\n---\n')
eq('empty body', fm3.body, '')

// ── extractTitle ─────────────────────────────────────────────────────────────

eq('heading title', extractTitle('# My Title\nContent'), 'My Title')
eq('bullet title', extractTitle('- First bullet\nSecond'), 'First bullet')
eq('plain text title', extractTitle('Just text here'), 'Just text here')

// ── extractTags ──────────────────────────────────────────────────────────────

const tags1 = extractTags({ type: 'reference', tags: 'api,database' }, 'This is about workflow and testing')
ok('tags from frontmatter', tags1.includes('api') && tags1.includes('database'))
ok('tags from type', tags1.includes('reference'))
ok('tags bounded to 5', tags1.length <= ENTRY_MAX_TAGS)

// ── truncateEntry ────────────────────────────────────────────────────────────

const short = truncateEntry('Hello world')
eq('short text unchanged', short, 'Hello world')
const long = truncateEntry('word '.repeat(200), 50)
ok('long text truncated', long.length <= 52)
ok('truncation adds ellipsis', long.endsWith('…'))

// ── normalizeForDedup + similarity ───────────────────────────────────────────

eq('normalize strips punctuation', normalizeForDedup('Hello, World! Test.'), 'hello world test')
ok('similarity of identical texts is 1', similarity('hello world', 'hello world') === 1)
ok('similarity of disjoint texts is 0', similarity('hello world', 'foo bar') === 0)
ok('similarity is between 0 and 1', similarity('hello world', 'hello there') > 0 && similarity('hello world', 'hello there') < 1)

// ── setEntryStatus ───────────────────────────────────────────────────────────

const entry = { status: 'staging', content: 'test' }
const r1 = setEntryStatus(entry, 'active')
ok('staging -> active works', r1.ok && r1.entry.status === 'active')
const r2 = setEntryStatus(entry, 'bogus')
ok('unknown status refused', !r2.ok)
const locked = { status: 'locked', content: 'test' }
const r3 = setEntryStatus(locked, 'active')
ok('locked cannot be changed', !r3.ok)

// ── statusCounts ─────────────────────────────────────────────────────────────

const counts = statusCounts([
  { status: 'staging' }, { status: 'staging' }, { status: 'active' },
  { status: 'pinned' }, { status: 'locked' }, { status: 'bogus' },
])
eq('status counts', counts, { staging: 2, active: 1, pinned: 1, locked: 1 })

// ── Full import pipeline with temp Claude root ────────────────────────────────

const tmp = mkdtempSync(join(tmpdir(), 'claude-import-test-'))
const claudeRoot = join(tmp, '.claude')
const projDir = join(claudeRoot, 'projects', '-test-project', 'memory')
mkdirSync(projDir, { recursive: true })

// Create test memory files
writeFileSync(join(projDir, 'MEMORY.md'), '# Index\n- [Test](test.md)')
writeFileSync(join(projDir, 'test.md'), '---\nname: test-memory\ndescription: "Test memory content"\ntags: api,testing\n---\n# Test Memory\n\nThis is a test memory about workflows.')
writeFileSync(join(projDir, 'duplicate.md'), '---\nname: dup\ndescription: "Test memory content"\n---\nThis is a test memory about workflows.')
writeFileSync(join(projDir, 'empty.md'), '')
writeFileSync(join(projDir, 'other.md'), '---\nname: other\ndescription: "Completely different content"\ntags: deploy\n---\n# Other\n\nDeployment pipeline knowledge.')

const stagingPath = join(tmp, 'staging.json')
const result = importClaudeMemories({
  claudeRoot,
  outputPath: stagingPath,
  existingLessons: [],
  now: '2026-10-28T00:00:00Z',
})

ok('import finds 3 files (skips MEMORY.md and empty)', result.total === 3)
ok('import returns entries', result.imported >= 2)
ok('import deduplicates', result.duplicates >= 1)
ok('staging file written', existsSync(stagingPath))
ok('source Claude files untouched', existsSync(join(projDir, 'test.md')))

const staging = readStaging(stagingPath)
ok('staging has entries', staging.entries.length >= 2)
ok('entries have staging status', staging.entries.every((e) => e.status === 'staging'))
ok('entries have source field', staging.entries.every((e) => e.source === 'claude-project-memory'))

// ── Dedup against existing lessons ───────────────────────────────────────────

const result2 = importClaudeMemories({
  claudeRoot,
  outputPath: join(tmp, 'staging2.json'),
  existingLessons: [{ text: 'This is a test memory about workflows' }],
  now: '2026-10-28T00:00:00Z',
  dryRun: true,
})
ok('dedup against existing lessons', result2.duplicates >= 1)

// ── writeStaging / readStaging roundtrip ─────────────────────────────────────

const customPath = join(tmp, 'custom.json')
writeStaging({ version: 1, entries: [{ status: 'active', content: 'x' }] }, customPath)
const readBack = readStaging(customPath)
eq('write/read roundtrip', readBack.entries.length, 1)

const emptyRead = readStaging(join(tmp, 'nonexistent.json'))
eq('nonexistent staging returns empty', emptyRead.entries.length, 0)

// ── Batch cap ────────────────────────────────────────────────────────────────

ok('IMPORT_BATCH_MAX is 500', IMPORT_BATCH_MAX === 500)

// Cleanup
rmSync(tmp, { recursive: true, force: true })

console.log('\nall ' + n + ' checks passed')
