#!/usr/bin/env node
// The ledger of a plugin bug hunt (.claude/skills/plugin-bug-hunter): reads every lane's findings file, refuses a finding that does not hold its proof,
// merges the duplicates two lanes found, and writes one list, worst first.
//
//   node scripts/bug-hunt-ledger.mjs <hunt folder>             # reads <folder>/constats/*.json and *.jsonl, prints the ledger (markdown)
//   node scripts/bug-hunt-ledger.mjs <hunt folder> --out f.md  # writes it to a file as well
//   node scripts/bug-hunt-ledger.mjs <hunt folder> --verify [--verify-timeout 60000]   # also runs the P0/P1 repro scripts (see below)
//   exit 0 = every finding is well formed, 1 = some are refused (listed), 2 = no folder or no file
//
// A finding: { id, package, where: "path:line", family, severity: P0|P1|P2, verdict: bug|suspect, title, detail, repro, evidence, confidence, fix_hint, status? }.
// A lane file is a JSON array, or JSON Lines (one finding per line: a hunter appends as it goes, so a hunter cut off keeps what it found); a broken line is
// refused by its number and the other lines are kept.
// A P0 or P1 'bug' without a repro is refused: without proof it is a suspect (the rule of the hunt). Two findings are one when they name the same file within
// five lines; the merged one keeps the worse severity, 'bug' over 'suspect', and the ids of both.
// --verify: for every P0/P1 finding whose repro names a .mjs file inside the hunt folder (relative to it; a path outside is refused, never run), runs
// `node <file>` from the file's folder, no shell, one at a time, each killed after the timeout, and adds a "Verify" section: the exit code (or timeout) and
// the last non-empty output line. It only records: whether a red repro means "still broken" is the reader's call, and it never changes the exit code.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const SEVERITIES = ['P0', 'P1', 'P2']
const VERDICTS = ['bug', 'suspect']
const REQUIRED = ['id', 'where', 'severity', 'verdict', 'title']

/** The problems of one finding ([] = well formed). */
export function problemsOf (f) {
  if (f === null || typeof f !== 'object' || Array.isArray(f)) return ['not an object']
  const out = []
  for (const k of REQUIRED) if (typeof f[k] !== 'string' || f[k].trim() === '') out.push('no ' + k)
  if (typeof f.severity === 'string' && !SEVERITIES.includes(f.severity)) out.push('severity must be P0, P1 or P2')
  if (typeof f.verdict === 'string' && !VERDICTS.includes(f.verdict)) out.push('verdict must be bug or suspect')
  const proven = typeof f.repro === 'string' && f.repro.trim() !== ''
  if (f.verdict === 'bug' && (f.severity === 'P0' || f.severity === 'P1') && !proven) out.push('a P0/P1 bug needs a repro (else it is a suspect)')
  return out
}

/** `path:line` (the first one when several are named) -> { file, line }; a where without a line keeps line null. */
export function placeOf (where) {
  const m = /([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)(?::(\d+))?/.exec(String(where || ''))
  return m === null ? { file: String(where || ''), line: null } : { file: m[1], line: m[2] === undefined ? null : Number(m[2]) }
}

const worse = (a, b) => (SEVERITIES.indexOf(a) <= SEVERITIES.indexOf(b) ? a : b)

/** Merges the findings that name the same file within five lines; keeps the input order otherwise. */
export function merge (findings) {
  const out = []
  for (const f of findings) {
    const p = placeOf(f.where)
    const twin = out.find((g) => {
      const q = placeOf(g.where)
      return q.file === p.file && (p.line === null || q.line === null ? p.line === q.line : Math.abs(p.line - q.line) <= 5)
    })
    if (twin === undefined) { out.push({ ...f, ids: [f.id] }); continue }
    twin.ids.push(f.id)
    twin.severity = worse(twin.severity, f.severity)
    if (f.verdict === 'bug') twin.verdict = 'bug'
    if ((typeof twin.repro !== 'string' || twin.repro === '') && typeof f.repro === 'string') twin.repro = f.repro
  }
  return out
}

/** Worst first: severity, then bug before suspect, then the fixed ones last. */
export function sorted (findings) {
  const rank = (f) => SEVERITIES.indexOf(f.severity) * 4 + (f.verdict === 'bug' ? 0 : 1) + (typeof f.status === 'string' && /fixed/i.test(f.status) ? 8 : 0)
  return findings.slice().sort((a, b) => rank(a) - rank(b))
}

/** The findings of one lane file's text: a JSON array, or JSON Lines. -> { items: [{ finding, line }], broken: [{ line, message }] } (line null for an array). */
export function parseLane (text) {
  const trimmed = text.trim()
  if (trimmed.startsWith('[')) {
    let list
    try { list = JSON.parse(trimmed) } catch (e) { return { items: [], broken: [{ line: null, message: 'unreadable JSON: ' + e.message }] } }
    if (!Array.isArray(list)) return { items: [], broken: [{ line: null, message: 'not an array' }] }
    return { items: list.map((finding) => ({ finding, line: null })), broken: [] }
  }
  const items = []
  const broken = []
  text.split(/\r?\n/).forEach((raw, i) => {
    if (raw.trim() === '') return
    try { items.push({ finding: JSON.parse(raw), line: i + 1 }) } catch (e) { broken.push({ line: i + 1, message: 'unreadable JSON on line ' + (i + 1) + ': ' + e.message }) }
  })
  return { items, broken }
}

/** Reads <folder>/constats/*.json and *.jsonl: { findings, refused: [{ file, id, problems }], files }. */
export function readHunt (folder) {
  const dir = join(folder, 'constats')
  if (!existsSync(dir)) return null
  const files = readdirSync(dir).filter((n) => /\.jsonl?$/.test(n)).sort()
  const findings = []
  const refused = []
  for (const name of files) {
    const { items, broken } = parseLane(readFileSync(join(dir, name), 'utf8'))
    for (const b of broken) refused.push({ file: name, id: b.line === null ? '-' : 'line ' + b.line, problems: [b.message] })
    for (const { finding: f, line } of items) {
      const problems = problemsOf(f)
      const id = f && typeof f.id === 'string' ? f.id : (line === null ? '?' : 'line ' + line)
      if (problems.length > 0) refused.push({ file: name, id, problems })
      else findings.push({ ...f, lane: name.replace(/\.jsonl?$/, '') })
    }
  }
  return { findings, refused, files }
}

/** The .mjs script a repro names (the first one), or null. */
export function scriptOf (repro) {
  const m = /[^\s'"`()]+\.mjs\b/.exec(String(repro || ''))
  return m === null ? null : m[0]
}

const inside = (root, p) => { const r = relative(root, p); return r !== '' && !r.startsWith('..') && !isAbsolute(r) }

/** Where a repro script is, relative to the hunt folder: { file } when it may run, { refused } when it is outside, { missing } when there is none. */
export function locateScript (folder, script) {
  const root = resolve(folder)
  const file = resolve(root, script)
  if (!inside(root, file)) return { refused: 'outside the hunt folder' }
  if (!existsSync(file) || !statSync(file).isFile()) return { missing: true }
  // A link inside the folder that points outside it is outside too.
  if (!inside(realpathSync(root), realpathSync(file))) return { refused: 'outside the hunt folder (through a link)' }
  return { file }
}

/** The last non-empty line of an output, clipped to 160 characters (the "Node.js vX" line node prints after a crash is skipped). */
export function lastLine (text) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '' && !/^Node\.js v\d+\.\d+\.\d+$/.test(l))
  const l = lines.length === 0 ? '' : lines[lines.length - 1]
  return l.length > 160 ? l.slice(0, 159) + '\u2026' : l
}

/** Runs `node <file>` from its folder, no shell: { code: number|'timeout'|'spawn error', last }. */
export function runScript (file, timeoutMs) {
  return new Promise((done) => {
    let out = ''
    let timedOut = false
    let settled = false
    const finish = (code) => { if (settled) return; settled = true; clearTimeout(timer); done({ code: timedOut ? 'timeout' : code, last: lastLine(out) }) }
    const child = spawn(process.execPath, [file], { cwd: dirname(file), shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FORCE_COLOR: '0' } })
    const keep = (b) => { out += b.toString('utf8'); if (out.length > 200000) out = out.slice(-100000) }
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    const timer = setTimeout(() => {
      timedOut = true
      try { child.kill('SIGKILL') } catch (e) { /* gone */ }
      // A grandchild may hold the pipes open: do not wait for them past the kill.
      setTimeout(() => { child.stdout.destroy(); child.stderr.destroy(); finish(null) }, 1000).unref()
    }, timeoutMs)
    child.on('error', (e) => { out += '\n' + e.message; finish('spawn error') })
    child.on('close', (code, signal) => finish(code === null ? signal : code))
  })
}

/** Runs the repro script of every P0/P1 finding, one at a time (a script named twice runs once): [{ id, severity, script, code?, last?, refused?, missing? }]. */
export async function verifyHunt (folder, findings, timeoutMs = 60000) {
  const rows = []
  const seen = new Map()
  for (const f of sorted(findings)) {
    if (f.severity !== 'P0' && f.severity !== 'P1') continue
    const script = scriptOf(f.repro)
    if (script === null) continue
    const where = locateScript(folder, script)
    const row = { id: f.id, severity: f.severity, script }
    if (where.file === undefined) { rows.push({ ...row, ...where }); continue }
    if (!seen.has(where.file)) seen.set(where.file, await runScript(where.file, timeoutMs))
    rows.push({ ...row, ...seen.get(where.file) })
  }
  return rows
}

/** The ledger as markdown: counts first, then one line per finding, the refused ones, and the runs of --verify when given. */
export function ledger (hunt, verify) {
  const merged = sorted(merge(hunt.findings))
  const count = (s, v) => merged.filter((f) => f.severity === s && (v === undefined || f.verdict === v)).length
  const lines = ['# Bug hunt ledger', '', merged.length + ' findings after merging ' + hunt.findings.length + ' (' + hunt.files.length + ' lane files): ' +
    SEVERITIES.map((s) => s + ' ' + count(s) + ' (' + count(s, 'bug') + ' bug)').join(', ') + '.', '']
  for (const f of merged) {
    const st = typeof f.status === 'string' && f.status !== '' ? ' [' + f.status + ']' : ''
    lines.push('- **' + f.severity + ' ' + f.verdict + '**' + st + ' ' + f.title + ' (`' + f.where + '`; ' + f.ids.join(', ') + ')')
  }
  if (hunt.refused.length > 0) {
    lines.push('', '## Refused (fix the lane file)', '')
    for (const r of hunt.refused) lines.push('- ' + r.file + ' ' + r.id + ': ' + r.problems.join('; '))
  }
  if (Array.isArray(verify)) {
    lines.push('', '## Verify (the P0/P1 repro scripts, run ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC; recorded, not judged)', '')
    if (verify.length === 0) lines.push('- no P0/P1 finding names a .mjs repro')
    for (const v of verify) {
      const head = '- ' + v.id + ' (' + v.severity + ') `' + v.script + '`: '
      if (v.refused !== undefined) lines.push(head + 'not run, ' + v.refused)
      else if (v.missing) lines.push(head + 'not run, no such file in the hunt folder')
      else lines.push(head + (v.code === 'timeout' ? 'timeout' : 'exit ' + v.code) + (v.last ? ' | ' + v.last : ''))
    }
  }
  return lines.join('\n') + '\n'
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) {
  const args = process.argv.slice(2)
  const valueOf = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined }
  const folder = args[0]
  const timeoutMs = Number(valueOf('--verify-timeout') ?? 60000)
  if (folder === undefined || folder.startsWith('--') || !(timeoutMs > 0)) {
    console.error('usage: node scripts/bug-hunt-ledger.mjs <hunt folder> [--out file.md] [--verify [--verify-timeout ms]]')
    process.exit(2)
  }
  const hunt = readHunt(resolve(folder))
  if (hunt === null || hunt.files.length === 0) { console.error('no findings file in ' + join(folder, 'constats')); process.exit(2) }
  const verify = args.includes('--verify') ? await verifyHunt(resolve(folder), hunt.findings, timeoutMs) : undefined
  const text = ledger(hunt, verify)
  const out = valueOf('--out')
  if (out !== undefined) writeFileSync(out, text)
  process.stdout.write(text)
  process.exit(hunt.refused.length === 0 ? 0 : 1)
}
