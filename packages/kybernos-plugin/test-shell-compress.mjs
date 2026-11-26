#!/usr/bin/env node
// Unit and hook tests for kybernos-plugin preventive shell output compressor (shell-compress.mjs).
// Runs in a temporary directory: zero network, zero external binaries.
//
//   node packages/kybernos-plugin/test-shell-compress.mjs
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MAX_SAVED_LOGS,
  cleanTerminalNoise,
  collapseVerboseRuns,
  compressShellOutput,
  mountShellCompressor,
  saveRawShellLog
} from './shell-compress.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const root = mkdtempSync(join(tmpdir(), 'kb-shell-comp-'))

try {
  console.log('\n── terminal noise cleaning and verbose run collapsing ──')
  const noisy = '\x1b[32m✓ ok\x1b[0m\n10%\r50%\r100% done\n\x1b]0;title\x07plain'
  const cleaned = cleanTerminalNoise(noisy)
  check('strips ANSI CSI/OSC codes and collapses \\r progress overwrites',
    cleaned === '✓ ok\n100% done\nplain', cleaned)

  const greenLines = Array.from({ length: 30 }, (_, i) => '  ✓ check #' + (i + 1) + ' passed cleanly')
  greenLines.splice(15, 0, '  ✗ check #16 AssertionError: expected 1 to equal 2')
  const collapsed = collapseVerboseRuns(greenLines)
  check('collapses long green runs while preserving every error line intact',
    collapsed.length < greenLines.length &&
    collapsed.some((l) => l.includes('AssertionError: expected 1 to equal 2')) &&
    collapsed.some((l) => l.includes('omitted')), collapsed.length)

  console.log('\n── compressShellOutput thresholds, error preservation and bounds ──')
  const shortText = 'short output\nexit 0'
  check('short output under threshold is returned unchanged', compressShellOutput(shortText).changed === false)

  const hugeParts = [
    'Starting build pipeline...',
    ...Array.from({ length: 120 }, (_, i) => 'compiling module src/mod-' + i + '.js ' + 'x'.repeat(80)),
    'TypeError: Cannot read properties of undefined (reading "foo") at src/broken.js:42',
    ...Array.from({ length: 120 }, (_, i) => '  ✓ unit test ' + i + ' passed ' + 'y'.repeat(80)),
    'Summary: 120 passed, 1 failed (exit code 1)'
  ]
  const huge = hugeParts.join('\n')
  const comp = compressShellOutput(huge, { thresholdChars: 4000, targetChars: 3000, savedLogPath: '/tmp/sample.log' })
  check('oversized output is compressed well below original size',
    comp.changed === true && comp.compressedChars < huge.length * 0.5 && comp.savedPct >= 50,
    { orig: comp.originalChars, after: comp.compressedChars, pct: comp.savedPct })
  check('preserves head, middle TypeError line, tail summary and compression marker',
    comp.text.includes('Starting build pipeline...') &&
    comp.text.includes('TypeError: Cannot read properties of undefined') &&
    comp.text.includes('Summary: 120 passed, 1 failed (exit code 1)') &&
    comp.text.includes('[kybernos: shell output compressed') &&
    comp.text.includes('/tmp/sample.log'))

  console.log('\n── saveRawShellLog bounded retention ──')
  const logDir = join(root, 'shell-logs')
  let t = 1700000000000
  let lastSaved = ''
  for (let i = 0; i < MAX_SAVED_LOGS + 8; i += 1) {
    t += 10
    lastSaved = saveRawShellLog(logDir, 'raw log #' + i, () => t)
  }
  check('saves raw log to disk and prunes oldest beyond MAX_SAVED_LOGS',
    existsSync(lastSaved) && readFileSync(lastSaved, 'utf8') === 'raw log #' + (MAX_SAVED_LOGS + 7) &&
    readdirSync(logDir).length === MAX_SAVED_LOGS, readdirSync(logDir).length)

  console.log('\n── mountShellCompressor (tools/post-execute waterfall) ──')
  let hook = null
  let disposed = false
  const fakeCtx = {
    on (ev, fn) {
      if (ev === 'tools/post-execute') hook = fn
      return () => { disposed = true; hook = null }
    }
  }
  const off = mountShellCompressor(fakeCtx, { logDir: join(root, 'hook-logs'), thresholdChars: 4000, targetChars: 2500, env: {} })
  check('registers on tools/post-execute', typeof hook === 'function')

  // 1. Oversized bash output -> compressed
  const bashDec = await hook({ name: 'bash', arguments: { command: 'npm test' } }, { content: [{ type: 'text', text: huge }], isError: false }, async () => ({ kind: 'accept' }))
  check('compresses oversized bash result via accept.content',
    bashDec.kind === 'accept' && Array.isArray(bashDec.content) && bashDec.content[0].text.length < huge.length * 0.5 &&
    bashDec.content[0].text.includes('TypeError: Cannot read properties of undefined'))

  // 2. Non-shell tool (`read`) -> untouched
  const readDec = await hook({ name: 'read', arguments: { file_path: 'a.js' } }, { content: [{ type: 'text', text: huge }], isError: false }, async () => ({ kind: 'accept' }))
  check('leaves non-shell tools untouched', readDec.kind === 'accept' && readDec.content === undefined)

  // 3. Downstream block wins untouched
  const blockDec = await hook({ name: 'bash', arguments: { command: 'x' } }, { content: [{ type: 'text', text: huge }], isError: false }, async () => ({ kind: 'block', feedback: 'blocked by guard' }))
  check('preserves downstream block decision untouched', blockDec.kind === 'block' && blockDec.feedback === 'blocked by guard')

  // 4. Downstream content replacement wins untouched
  const customDec = await hook({ name: 'bash', arguments: { command: 'x' } }, { content: [{ type: 'text', text: huge }], isError: false }, async () => ({ kind: 'accept', content: [{ type: 'text', text: 'already replaced' }] }))
  check('preserves downstream content override untouched', customDec.kind === 'accept' && customDec.content[0].text === 'already replaced')

  off()
  check('disposer detaches listener cleanly', disposed === true && hook === null)

  // 5. KYBERNOS_SHELL_COMPRESS=0 opt-out
  let offHook = null
  mountShellCompressor({ on: (_e, fn) => { offHook = fn; return () => {} } }, { env: { KYBERNOS_SHELL_COMPRESS: '0' }, saveLogs: false })
  const optOut = await offHook({ name: 'bash' }, { content: [{ type: 'text', text: huge }] }, async () => ({ kind: 'accept' }))
  check('KYBERNOS_SHELL_COMPRESS=0 disables compression', optOut.kind === 'accept' && optOut.content === undefined)
} finally {
  try { rmSync(root, { recursive: true, force: true }) } catch { /* ignore */ }
}

console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
assert.equal(fail, 0, fail + ' check(s) failed')
process.exit(0)
