// Measure what the tool-result pruner would have saved on real sessions, before touching any policy.
//   node scripts/compaction-prune-mesure.mjs                 # the 8 most recently touched sessions
//   node scripts/compaction-prune-mesure.mjs --sessions 30   # more of them
//   node scripts/compaction-prune-mesure.mjs --budget 8192,4096,1024
// It replays ONE pass of the pruner over the tool results of each session log: every result longer than
// `thresholdChars` becomes `thresholdChars`, so the saving is `len - thresholdChars` characters. Tokens are estimated at
// 4 chars/token (measured on session 46d551e6: 1 937 582 chars of tool text for a 564 951-token surface, i.e. 85 % of
// the surface from 720 results). The threshold is the engine's own ratio bound, ratio x window.
// Read-only: nothing is written, no session is modified.
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DSH = join(homedir(), '.dsh')
const SESSIONS = join(DSH, 'sessions')
const CACHE = join(DSH, 'storages', 'session_projcache', 'sessions')
const CHARS_PER_TOKEN = 4

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name)
  return i === -1 ? fallback : process.argv[i + 1]
}
const budget = String(arg('budget', '4096,2048,512')).split(',').map(Number)
const thresholdChars = budget[0]
const sessionsWanted = Number(arg('sessions', '8'))
const ratio = Number(arg('ratio', '0.5'))

/** Every session log under ~/.dsh/sessions, newest first. Layout: workspace/session-<id>/session.v4.jsonl.zstd */
const allLogs = () => {
  const found = []
  for (const workspace of readdirSync(SESSIONS)) {
    const workspacePath = join(SESSIONS, workspace)
    if (!statSync(workspacePath).isDirectory()) continue
    for (const dirName of readdirSync(workspacePath)) {
      const path = join(workspacePath, dirName)
      if (!statSync(path).isDirectory()) continue
      const file = join(path, 'session.v4.jsonl.zstd')
      if (!existsSync(file)) continue
      found.push({ file, mtime: statSync(file).mtimeMs, id: dirName.replace(/^session-/, '') })
    }
  }
  return found.sort((a, b) => b.mtime - a.mtime)
}

/** Projection rows (surfaceTokens, contextWindow) for one session, or {} when absent. */
const projection = (id) => {
  const file = join(CACHE, 'session-' + id + '.json')
  if (!existsSync(file)) return {}
  try {
    const rows = JSON.parse(readFileSync(file, 'utf8')).record.rows
    const pressure = rows?.contextPressure?.val ?? {}
    return { surface: pressure.surfaceTokens, window: pressure.contextWindow }
  } catch { return {} }
}

/** Text length of one tool result message, 0 for anything that is not one. */
const toolTextLength = (line) => {
  if (!line.includes('"tool/result"')) return 0
  try {
    const content = JSON.parse(line).data?.message?.content
    if (!Array.isArray(content)) return 0
    let n = 0
    for (const block of content) if (block?.type === 'text' && typeof block.text === 'string') n += block.text.length
    return n
  } catch { return 0 }
}

// One line per session: two workspaces can hold the same id, the newest log wins.
const seen = new Set()
const logs = allLogs().filter((log) => (seen.has(log.id) ? false : (seen.add(log.id), true))).slice(0, sessionsWanted)
let totalSaved = 0
let compacted = 0
let avoided = 0
let measured = 0
console.log('pruner budget ' + thresholdChars + ' chars (' + budget.join('/') + '), ratio ' + ratio)
console.log('session   surface   tools  share   saving    after  threshold  verdict')
for (const log of logs) {
  const info = projection(log.id)
  if (info.surface === undefined || info.window === undefined) continue
  const raw = execFileSync('zstd', ['-dc', log.file], { maxBuffer: 1024 * 1024 * 1024 }).toString('utf8')
  let chars = 0
  let saving = 0
  let count = 0
  for (const line of raw.split('\n')) {
    const n = toolTextLength(line)
    if (n === 0) continue
    chars += n
    count += 1
    if (n > thresholdChars) saving += n - thresholdChars
  }
  if (count === 0) continue
  measured += 1
  const didCompact = raw.includes('"compaction/start"')
  if (didCompact) compacted += 1
  const toolTokens = Math.round(chars / CHARS_PER_TOKEN)
  const savedTokens = Math.round(saving / CHARS_PER_TOKEN)
  const after = info.surface - savedTokens
  const threshold = Math.round(info.window * ratio)
  const under = info.surface >= threshold
  const skip = under && after < threshold
  if (skip) avoided += 1
  totalSaved += savedTokens
  const verdict = skip ? 'summary avoided' : under ? 'still summarizes' : 'never under pressure'
  console.log(
    String(log.id).slice(0, 8).padEnd(10)
    + String(info.surface).padStart(8)
    + String(toolTokens).padStart(8)
    + String(Math.round(100 * toolTokens / info.surface) + '%').padStart(7)
    + String(savedTokens).padStart(9)
    + String(after).padStart(9)
    + String(threshold).padStart(11)
    + '  ' + verdict + (didCompact ? ' (compacted)' : ''),
  )
}
console.log('')
console.log('sessions measured: ' + measured + ', of which compacted: ' + compacted
  + ', summaries the pruner alone would have avoided: ' + avoided)
console.log('total saved: ' + totalSaved + ' tokens (estimate, 4 chars/token)')
