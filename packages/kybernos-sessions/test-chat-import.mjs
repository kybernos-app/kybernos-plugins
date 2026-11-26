#!/usr/bin/env node
// Round-trip tests for the chat-import skill (ChatGPT, Claude.ai, Claude Code,
// Cursor, Codex), dry-run, deduplication, CLI execution, kybernos-search
// compatibility, and skills-ratchet R1/R2 compliance.
//
//   node packages/kybernos-sessions/test-chat-import.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildDshJournal,
  detectSource,
  encodeSlugPath,
  importPath,
  parseChatGPT,
  parseClaude,
  parseCodex,
  parseCursor
} from './skills/chat-import/scripts/import-chats.mjs'
import { zstdFrames } from '../kybernos-search/zstd-frames.mjs'
import { extractJournal } from '../kybernos-search/extractor.mjs'
import { prepare, search } from '../kybernos-search/core.mjs'
import { seedSkills } from './seed-skills.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SKILL_DIR = join(HERE, 'skills', 'chat-import')
const SCRIPT = join(SKILL_DIR, 'scripts', 'import-chats.mjs')

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const root = mkdtempSync(join(tmpdir(), 'kb-chat-import-'))

try {
  console.log('\n── skill contract (skills-vs-plugins.md R1 / R2) ──')
  const skillMd = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8')
  const HARNESS_TOOLS = ['read_image', 'subagent', 'kybernos_dashboard', 'creer_slides', 'creer_motion', 'modeliser']
  check('R1: skill carries executable script import-chats.mjs', existsSync(SCRIPT))
  check('R2: SKILL.md names zero harness-only tools', HARNESS_TOOLS.every((t) => !new RegExp('\\b' + t + '\\b').test(skillMd)))
  check('SKILL.md frontmatter declares name: chat-import', /^name: chat-import$/m.test(skillMd))

  console.log('\n── 4 source parsers and auto-detection ──')
  // 1. ChatGPT export with an abandoned side branch + active current_node branch
  const chatgptJson = JSON.stringify([{
    id: 'cg-1',
    title: 'Docker cleanup guide',
    create_time: 1700000100,
    current_node: 'n3',
    mapping: {
      root: { id: 'root', parent: null, children: ['n1'] },
      n1: { id: 'n1', parent: 'root', message: { author: { role: 'user' }, create_time: 1700000101, content: { parts: ['How do I prune unused Docker volumes?'] } } },
      n2_abandoned: { id: 'n2_abandoned', parent: 'n1', message: { author: { role: 'assistant' }, create_time: 1700000102, content: { parts: ['Abandoned draft reply'] } } },
      n2: { id: 'n2', parent: 'n1', message: { author: { role: 'assistant' }, create_time: 1700000103, content: { parts: ['Run docker volume prune cleanly.'] } } },
      n3: { id: 'n3', parent: 'n2', message: { author: { role: 'user' }, create_time: 1700000104, content: { parts: ['Thanks!'] } } }
    }
  }])
  check('detectSource identifies ChatGPT export', detectSource(chatgptJson) === 'chatgpt')
  const cgParsed = parseChatGPT(chatgptJson)
  check('parseChatGPT follows active current_node branch and skips abandoned draft',
    cgParsed.length === 1 && cgParsed[0].title === 'Docker cleanup guide' && cgParsed[0].messages.length === 3 &&
    !JSON.stringify(cgParsed).includes('Abandoned draft reply'))

  // 2a. Claude.ai JSON export
  const claudeAiJson = JSON.stringify([{
    uuid: 'cl-1',
    name: 'Invoice template review',
    created_at: '2026-10-15T10:00:00Z',
    chat_messages: [
      { sender: 'human', text: 'Review my invoice template for French VAT.', created_at: '2026-10-15T10:00:01Z' },
      { sender: 'assistant', text: 'Here are the mandatory VAT mentions.', created_at: '2026-10-15T10:00:05Z' }
    ]
  }])
  check('detectSource identifies Claude.ai export', detectSource(claudeAiJson) === 'claude')
  const clAi = parseClaude(claudeAiJson)
  check('parseClaude reads Claude.ai chat_messages', clAi.length === 1 && clAi[0].messages.length === 2 && clAi[0].messages[0].role === 'user')

  // 2b. Claude Code JSONL transcript
  const claudeCodeJsonl = [
    JSON.stringify({ type: 'user', sessionId: 'cc-42', cwd: '/tmp/app', timestamp: '2026-10-20T09:00:00Z', message: { role: 'user', content: [{ type: 'text', text: 'Fix failing unit test' }] } }),
    JSON.stringify({ type: 'assistant', sessionId: 'cc-42', timestamp: '2026-10-20T09:00:04Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Fixed the assertion in test-auth.mjs.' }] } })
  ].join('\n')
  check('detectSource identifies Claude Code JSONL', detectSource(claudeCodeJsonl) === 'claude')
  const clCode = parseClaude(claudeCodeJsonl)
  check('parseClaude reads Claude Code JSONL with cwd and sessionId', clCode.length === 1 && clCode[0].cwd === '/tmp/app' && clCode[0].messages.length === 2)

  // 3. Cursor export JSON
  const cursorJson = JSON.stringify({
    tabs: [{
      tabId: 'cur-7',
      chatTitle: 'SQLite FTS5 indexing',
      bubbles: [
        { type: 1, text: 'Build an FTS5 search index in Node.' },
        { type: 2, text: 'Use a virtual table with bm25 ranking.' }
      ]
    }]
  })
  check('detectSource identifies Cursor export', detectSource(cursorJson) === 'cursor')
  const curParsed = parseCursor(cursorJson)
  check('parseCursor extracts tabs and bubbles', curParsed.length === 1 && curParsed[0].title === 'SQLite FTS5 indexing' && curParsed[0].messages.length === 2)

  // 4. Codex CLI JSONL rollout
  const codexJsonl = [
    JSON.stringify({ type: 'session_meta', timestamp: '2026-11-01T08:00:00Z', payload: { id: 'cx-9', cwd: '/tmp/codex-proj' } }),
    JSON.stringify({ type: 'response_item', timestamp: '2026-11-01T08:00:02Z', payload: { role: 'user', content: [{ type: 'input_text', text: 'Refactor the parser module.' }] } }),
    JSON.stringify({ type: 'response_item', timestamp: '2026-11-01T08:00:05Z', payload: { role: 'assistant', content: [{ type: 'output_text', text: 'Refactored with zero breaking changes.' }] } })
  ].join('\n')
  check('detectSource identifies Codex JSONL', detectSource(codexJsonl) === 'codex')
  const cxParsed = parseCodex(codexJsonl)
  check('parseCodex reads session_meta and response_item turns', cxParsed.length === 1 && cxParsed[0].cwd === '/tmp/codex-proj' && cxParsed[0].messages.length === 2)

  console.log('\n── dry-run, real import, idempotency, CLI and kybernos-search round-trip ──')
  const exportsDir = join(root, 'exports')
  const dshHome = join(root, 'dsh')
  const ws = join(root, 'my-workspace')
  mkdirSync(exportsDir, { recursive: true })
  mkdirSync(ws, { recursive: true })

  writeFileSync(join(exportsDir, 'chatgpt.json'), chatgptJson)
  writeFileSync(join(exportsDir, 'claude-ai.json'), claudeAiJson)
  writeFileSync(join(exportsDir, 'claude-code.jsonl'), claudeCodeJsonl)
  writeFileSync(join(exportsDir, 'cursor.json'), cursorJson)
  writeFileSync(join(exportsDir, 'codex.jsonl'), codexJsonl)

  // Dry run writes nothing
  const dry = importPath(exportsDir, { dshHome, cwd: ws, dryRun: true })
  check('dry-run finds all 5 conversations and writes nothing to disk',
    dry.ok === true && dry.dryRun === true && dry.counts.imported === 5 && !existsSync(join(dshHome, 'sessions')))

  // Real import via CLI (proves script is directly runnable)
  const cliOut = execFileSync(process.execPath, [SCRIPT, exportsDir, '--dsh-home', dshHome, '--cwd', ws, '--json'], { encoding: 'utf8' })
  const cliRes = JSON.parse(cliOut)
  check('CLI imports all 5 conversations into DSH sessions folder',
    cliRes.ok === true && cliRes.counts.imported === 5 && cliRes.counts.errors === 0 &&
    cliRes.imported.every((item) => existsSync(item.file)))

  // Second run deduplicates every single conversation
  const again = importPath(exportsDir, { dshHome, cwd: ws })
  check('re-importing skips all 5 duplicates idempotently',
    again.ok === true && again.counts.imported === 0 && again.counts.skipped === 5)

  // End-to-end round-trip with kybernos-search (zstdFrames -> extractJournal -> prepare -> search)
  const docs = cliRes.imported.map((item) => {
    const decoded = zstdFrames(readFileSync(item.file))
    const extracted = extractJournal(decoded)
    return prepare({
      scope: 'chat',
      id: item.id,
      title: extracted.title,
      parts: extracted.msgs.map(([r, ts, t]) => ({ r, ts, t })),
      meta: { cwd: extracted.cwd },
      open: null,
      ts: extracted.lastAt
    })
  })
  const hitDocker = search(docs, 'docker volume')
  const hitVat = search(docs, 'french vat')
  const hitFts = search(docs, 'fts5')
  check('imported zstd sessions are decoded by kybernos-search zstdFrames + extractJournal and searchable',
    hitDocker.results.length === 1 && hitDocker.results[0].title === 'Docker cleanup guide' &&
    hitVat.results.length === 1 && hitVat.results[0].title === 'Invoice template review' &&
    hitFts.results.length === 1 && hitFts.results[0].title === 'SQLite FTS5 indexing')

  check('encodeSlugPath produces DSH-style --segments-- slug', encodeSlugPath('/tmp/my-proj') === '--tmp-my-proj--')
  check('buildDshJournal emits session, session/title, user/message and assistant/message lines',
    buildDshJournal(cgParsed[0], { sessionId: 'imp-1', cwd: ws }).includes('"session/title"'))

  console.log('\n── skill seeding into DSH_HOME/skills/chat-import ──')
  const seedHome = join(root, 'seed-home')
  const r1 = seedSkills({ home: seedHome, sourceDir: join(HERE, 'skills'), names: ['chat-import'] })
  check('seedSkills creates both SKILL.md and scripts/import-chats.mjs',
    r1[0].action === 'created' &&
    existsSync(join(seedHome, 'skills', 'chat-import', 'SKILL.md')) &&
    existsSync(join(seedHome, 'skills', 'chat-import', 'scripts', 'import-chats.mjs')))
  const r2 = seedSkills({ home: seedHome, sourceDir: join(HERE, 'skills'), names: ['chat-import'] })
  check('second seedSkills call is idempotent (current)', r2[0].action === 'current')
  writeFileSync(join(seedHome, 'skills', 'chat-import', 'SKILL.md'), '# User customised\n', 'utf8')
  const r3 = seedSkills({ home: seedHome, sourceDir: join(HERE, 'skills'), names: ['chat-import'] })
  check('user-edited SKILL.md is kept untouched',
    r3[0].action === 'kept' &&
    readFileSync(join(seedHome, 'skills', 'chat-import', 'SKILL.md'), 'utf8') === '# User customised\n')
} finally {
  try { rmSync(root, { recursive: true, force: true }) } catch { /* ignore */ }
}

console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
assert.equal(fail, 0, fail + ' check(s) failed')
process.exit(0)
