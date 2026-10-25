#!/usr/bin/env node
// tiktok-studio: the numbers behind the skill. Reads the picture, video and voice models the Kybernos account offers (with the price of ONE
// unit) from the running DSH, keeps the person's validated choice (a primary model and a backup per kind), notices when that choice no
// longer holds, and turns a storyboard into a quote before anything is generated. It generates nothing and publishes nothing.
//
//   node studio.mjs doctor
//   node studio.mjs models   [--images 5] [--clip-seconds 20] [--chars 450] [--json]
//   node studio.mjs check    [--json]
//   node studio.mjs set      <image|video|speech> <primary-id> [<backup-id>]
//   node studio.mjs settings [--json]
//   node studio.mjs quote    <storyboard.json> [--retries 1] [--json]
//
// The models come from DSH itself: GET /kybernos-cloud/models on 127.0.0.1:<port> (the port is --port, else $DSH_WEB_PORT, else 3080; --base
// or $TIKTOK_STUDIO_BASE name a whole address). That read route answers without a sign-in and carries no key.
// State lives in <DSH_HOME, else ~/.dsh>/kybernos/tiktok-studio/settings.json.
// Exit codes: 0 done, 1 usage error, 2 DSH does not answer, 3 no Kybernos account connected, 4 no creation model offered,
// 5 the choice is missing or no longer holds (check, quote), 6 a price is missing so nothing can be quoted.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const KINDS = ['image', 'video', 'speech']
/** Voice is optional: without a priced speech model the skill keeps using a local neural voice, which costs nothing. */
export const REQUIRED_KINDS = ['image', 'video']
export const UNITS = { image: 'image', video: 'second', speech: 'thousand_characters' }
const UNIT_LABEL = { image: 'image', second: 's', thousand_characters: '1,000 chars' }
export const MAX_SHOTS = 40
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/**
 * A decimal price string ("0.14", at most nine decimals as the server writes them) -> millionths of a dollar, or null when it is not a plain
 * decimal. Money is added in integers, parsed from the digits (never through a float) and rounded UP to the millionth: never less than the price.
 */
export const toMicro = (usd) => {
  if (typeof usd !== 'string' || !/^\d{1,6}(?:\.\d{1,9})?$/.test(usd)) return null
  const [whole, frac = ''] = usd.split('.')
  const nano = BigInt(whole) * 1000000000n + BigInt(frac.padEnd(9, '0'))
  return Number((nano + 999n) / 1000n)
}
/** Millionths -> dollars rounded UP to the cent: a quote never says less than it will cost. */
export const dollars = (micro) => (Math.ceil(micro / 1e4) / 100).toFixed(2)
const price = (m) => (m.usd === null ? 'no price' : '$' + m.usd + ' / ' + UNIT_LABEL[m.unit])

/** The body of GET /kybernos-cloud/models -> { state, models }. state: 'none' (not connected), 'empty' (no creation model), 'ok'. */
export function readModels(body) {
  if (!plain(body) || body.connected !== true) return { state: 'none', models: [] }
  const list = plain(body.models) && Array.isArray(body.models.creation) ? body.models.creation : []
  const models = []
  for (const c of list) {
    if (!plain(c) || typeof c.id !== 'string' || c.id === '' || KINDS.indexOf(c.kind) < 0) continue
    // A price counts only in the unit of its kind (a picture by the picture, a clip by the second, a voice by a thousand characters).
    const unit = UNITS[c.kind]
    const usd = c.unit === unit && toMicro(c.usd) !== null ? c.usd : null
    models.push({ id: c.id, name: typeof c.name === 'string' && c.name !== '' ? c.name : c.id, kind: c.kind, unit, usd })
  }
  return { state: models.length === 0 ? 'empty' : 'ok', models }
}

/** What one model would cost for a 30 s video of the usual shape, so that models of a kind can be compared at a glance. */
export function estimate(model, { images = 5, clipSeconds = 20, chars = 450 } = {}) {
  const micro = toMicro(model.usd)
  if (micro === null) return null
  const count = model.kind === 'image' ? images : model.kind === 'video' ? clipSeconds : chars / 1000
  return Math.round(micro * count)
}

/** A choice the person validates: the primary and a backup of ONE kind. Returns { ok, choice } or { ok: false, error }. */
export function validateChoice(kind, primaryId, backupId, models) {
  if (KINDS.indexOf(kind) < 0) return { ok: false, error: 'the kind is one of: ' + KINDS.join(', ') }
  const ofKind = models.filter((m) => m.kind === kind)
  const offered = ofKind.map((m) => m.id).join(', ') || 'none'
  const find = (id) => ofKind.find((m) => m.id === id)
  const first = find(primaryId)
  if (first === undefined) return { ok: false, error: '"' + String(primaryId) + '" is not an ' + kind + ' model of this account. Offered: ' + offered }
  let second = null
  if (backupId !== undefined && backupId !== null && backupId !== '') {
    if (backupId === primaryId) return { ok: false, error: 'the backup must be another model than the primary' }
    second = find(backupId)
    if (second === undefined) return { ok: false, error: '"' + String(backupId) + '" is not an ' + kind + ' model of this account. Offered: ' + offered }
  }
  const keep = (m) => ({ id: m.id, name: m.name, unit: m.unit, usd: m.usd })
  return { ok: true, choice: { primary: keep(first), backup: second === null ? null : keep(second) }, noBackupPossible: second === null && ofKind.length < 2 }
}

/**
 * The saved choice against the models offered now. Per kind: 'ok', 'missing' (nothing validated), 'gone' (the primary is no longer
 * offered), 'repriced' (the price moved since the person validated it), 'backup-gone', 'backup-repriced'. Overall 'ready' only when
 * every required kind is 'ok' and no other kind is in a worse state than 'missing'.
 */
export function checkSettings(settings, models) {
  const out = {}
  for (const kind of KINDS) {
    const saved = plain(settings) && plain(settings[kind]) ? settings[kind] : null
    if (saved === null || !plain(saved.primary)) { out[kind] = { status: 'missing' }; continue }
    const live = (id) => models.find((m) => m.kind === kind && m.id === id)
    const now = live(saved.primary.id)
    if (now === undefined) { out[kind] = { status: 'gone', id: saved.primary.id }; continue }
    if (now.usd !== saved.primary.usd) { out[kind] = { status: 'repriced', id: now.id, was: saved.primary.usd, now: now.usd }; continue }
    if (plain(saved.backup)) {
      const b = live(saved.backup.id)
      if (b === undefined) { out[kind] = { status: 'backup-gone', id: saved.backup.id }; continue }
      if (b.usd !== saved.backup.usd) { out[kind] = { status: 'backup-repriced', id: b.id, was: saved.backup.usd, now: b.usd }; continue }
    }
    out[kind] = { status: 'ok' }
  }
  const bad = KINDS.some((k) => (REQUIRED_KINDS.indexOf(k) >= 0 ? out[k].status !== 'ok' : out[k].status !== 'ok' && out[k].status !== 'missing'))
  return { kinds: out, ready: !bad }
}

/** A storyboard is `{ title?, shots: [{ id, seconds, motion: 'clip'|'still', text? }], voice?: { chars } }`. Returns { ok, error? }. */
export function validateStoryboard(sb) {
  if (!plain(sb) || !Array.isArray(sb.shots) || sb.shots.length === 0) return { ok: false, error: 'the storyboard needs a non-empty "shots" list' }
  if (sb.shots.length > MAX_SHOTS) return { ok: false, error: 'at most ' + MAX_SHOTS + ' shots' }
  const ids = new Set()
  for (const s of sb.shots) {
    if (!plain(s)) return { ok: false, error: 'every shot is an object' }
    if (s.id === undefined || ids.has(s.id)) return { ok: false, error: 'every shot has its own "id"' }
    ids.add(s.id)
    if (typeof s.seconds !== 'number' || !(s.seconds > 0) || s.seconds > 30) return { ok: false, error: 'shot ' + String(s.id) + ': "seconds" is a number between 0 and 30' }
    if (s.motion !== 'clip' && s.motion !== 'still') return { ok: false, error: 'shot ' + String(s.id) + ': "motion" is "clip" (a generated video) or "still" (a picture moved at editing)' }
  }
  if (sb.voice !== undefined && sb.voice !== null && !(plain(sb.voice) && typeof sb.voice.chars === 'number' && sb.voice.chars >= 0 && sb.voice.chars <= 20000)) return { ok: false, error: '"voice" is { "chars": N } with N the characters spoken' }
  return { ok: true }
}

/**
 * The quote of a storyboard at the validated primary models, and the ceiling if everything fell back to the dearer of primary and backup.
 * One picture per shot (the first frame of a clip, or the shot itself), `retries` extra pictures for a redo, clip seconds only for shots that
 * move, the voice by thousand characters when a speech model is validated (else it is the free local voice). Returns { ok, lines, total, ceiling }
 * in millionths, or { ok: false, error, code }.
 */
export function buildQuote(sb, settings, { retries = 1 } = {}) {
  const v = validateStoryboard(sb)
  if (v.ok !== true) return { ok: false, error: v.error, code: 1 }
  const need = (kind) => (plain(settings) && plain(settings[kind]) && plain(settings[kind].primary) ? settings[kind] : null)
  const image = need('image')
  const video = sb.shots.some((s) => s.motion === 'clip') ? need('video') : { primary: { usd: '0', unit: 'second', name: '' }, backup: null }
  if (image === null || video === null) return { ok: false, error: 'the primary models are not validated yet: run `set` first', code: 5 }
  const speech = sb.voice && sb.voice.chars > 0 ? need('speech') : null
  const unitOf = (pick, side) => {
    const m = side === 'ceiling' && pick.backup !== null && pick.backup !== undefined && (toMicro(pick.backup.usd) ?? 0) > (toMicro(pick.primary.usd) ?? 0) ? pick.backup : pick.primary
    return toMicro(m.usd)
  }
  const lines = []
  let total = 0
  let ceiling = 0
  const add = (label, count, pick, unit) => {
    const lo = unitOf(pick, 'primary')
    const hi = unitOf(pick, 'ceiling')
    if (lo === null || hi === null) return false
    lines.push({ label, count, unit, each: lo, micro: Math.round(lo * count), model: pick.primary.name || pick.primary.id })
    total += Math.round(lo * count)
    ceiling += Math.round(hi * count)
    return true
  }
  const clipSeconds = sb.shots.filter((s) => s.motion === 'clip').reduce((n, s) => n + s.seconds, 0)
  if (!add('pictures', sb.shots.length, image, 'image')) return { ok: false, error: 'the image model has no readable price', code: 6 }
  if (retries > 0 && !add('picture redos', retries, image, 'image')) return { ok: false, error: 'the image model has no readable price', code: 6 }
  if (clipSeconds > 0 && !add('video clips', clipSeconds, video, 'second')) return { ok: false, error: 'the video model has no readable price', code: 6 }
  if (speech !== null && !add('voice', sb.voice.chars / 1000, speech, 'thousand_characters')) return { ok: false, error: 'the speech model has no readable price', code: 6 }
  return { ok: true, lines, total, ceiling, voice: speech === null ? 'local' : 'account' }
}

// ───────────────────────────── the files and the network ─────────────────────────────

export const stateDir = (env = process.env) => join(env.DSH_HOME || join(homedir(), '.dsh'), 'kybernos', 'tiktok-studio')
const settingsFile = (env) => join(stateDir(env), 'settings.json')
export function loadSettings(env = process.env) {
  try { const s = JSON.parse(readFileSync(settingsFile(env), 'utf8')); return plain(s) ? s : {} } catch (e) { return {} }
}
export function saveSettings(settings, env = process.env) {
  mkdirSync(stateDir(env), { recursive: true })
  const file = settingsFile(env)
  writeFileSync(file + '.tmp', JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 })
  renameSync(file + '.tmp', file)
}

export const baseOf = (opts, env = process.env) => String(opts.base || env.TIKTOK_STUDIO_BASE || 'http://127.0.0.1:' + String(opts.port || env.DSH_WEB_PORT || 3080)).replace(/\/+$/, '')

/** { ok: true, body } or { ok: false, reason } ('unreachable' | 'status:<n>' | 'unreadable'). Never throws. */
export async function fetchModels(base, timeoutMs = 8000) {
  try {
    const res = await fetch(base + '/kybernos-cloud/models', { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) })
    if (res.ok !== true) return { ok: false, reason: 'status:' + String(res.status) }
    try { return { ok: true, body: await res.json() } } catch (e) { return { ok: false, reason: 'unreadable' } }
  } catch (e) { return { ok: false, reason: 'unreachable' } }
}

// ───────────────────────────── the command line ─────────────────────────────

function parseArgs(argv) {
  const pos = []
  const opts = {}
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      if (key === 'json') opts.json = true
      else { opts[key] = argv[i + 1]; i += 1 }
    } else pos.push(a)
  }
  return { pos, opts }
}
const num = (v, d) => (v === undefined ? d : Number(v))

async function live(opts, env, say) {
  const base = baseOf(opts, env)
  const got = await fetchModels(base)
  if (got.ok !== true) { say('DSH does not answer at ' + base + ' (' + got.reason + '). Is it running, and is the port right (--port)?'); return { code: 2 } }
  const read = readModels(got.body)
  if (read.state === 'none') { say('No Kybernos account is connected in this DSH: the creation models come with the account. Connect it in Settings, then run this again.'); return { code: 3 } }
  return { code: 0, read, base }
}

export async function main(argv, env = process.env, out = (s) => console.log(s)) {
  const { pos, opts } = parseArgs(argv)
  const cmd = pos[0]
  const json = (v) => out(JSON.stringify(v, null, 2))
  if (cmd === 'settings') {
    const s = loadSettings(env)
    if (opts.json) json(s)
    else if (Object.keys(s).length === 0) out('Nothing validated yet.')
    else for (const k of KINDS) if (plain(s[k])) out(k + ': primary ' + s[k].primary.id + ' (' + price(s[k].primary) + ')' + (s[k].backup ? ', backup ' + s[k].backup.id + ' (' + price(s[k].backup) + ')' : ', no backup') + ' — validated ' + String(s[k].validatedAt || '?'))
    return 0
  }
  if (cmd === 'quote') {
    let sb
    try { sb = JSON.parse(readFileSync(String(pos[1]), 'utf8')) } catch (e) { out('Cannot read the storyboard: ' + String(pos[1])); return 1 }
    const q = buildQuote(sb, loadSettings(env), { retries: num(opts.retries, 1) })
    if (q.ok !== true) { out(q.error); return q.code }
    if (opts.json) { json({ lines: q.lines.map((l) => ({ ...l, usd: dollars(l.micro) })), total: dollars(q.total), ceiling: dollars(q.ceiling), voice: q.voice }); return 0 }
    for (const l of q.lines) out(l.label.padEnd(14) + String(l.count).padStart(6) + ' × $' + (l.each / 1e6).toFixed(4).replace(/0+$/, '').replace(/\.$/, '') + ' / ' + UNIT_LABEL[l.unit].padEnd(10) + ' = $' + dollars(l.micro) + '   (' + l.model + ')')
    out('QUOTE'.padEnd(14) + ' $' + dollars(q.total) + '   ceiling if everything falls back to the dearer model: $' + dollars(q.ceiling) + (q.voice === 'local' ? '   (voice: the free local one)' : ''))
    return 0
  }
  if (cmd === 'models' || cmd === 'check' || cmd === 'set' || cmd === 'doctor') {
    const l = await live(opts, env, out)
    if (l.code !== 0) return l.code
    const models = l.read.models
    if (cmd === 'doctor') {
      out('DSH answers at ' + l.base + ' · account connected · ' + models.length + ' creation model' + (models.length === 1 ? '' : 's') + ' offered')
      const c = checkSettings(loadSettings(env), models)
      out('the validated choice: ' + (c.ready ? 'holds' : 'needs a look (run `check`)'))
      out('generation: NOT wired yet. The skill stops at the approved quote and the storyboard files until the server can generate.')
      return models.length === 0 ? 4 : 0
    }
    if (l.read.state === 'empty') { out('This account is connected, but the server offers no picture, video or voice model yet.'); return 4 }
    if (cmd === 'models') {
      const sizes = { images: num(opts.images, 5), clipSeconds: num(opts['clip-seconds'], 20), chars: num(opts.chars, 450) }
      if (opts.json) { json(models.map((m) => ({ ...m, estimate: estimate(m, sizes) === null ? null : dollars(estimate(m, sizes)) }))); return 0 }
      for (const kind of KINDS) {
        const list = models.filter((m) => m.kind === kind)
        if (list.length === 0) continue
        const what = kind === 'image' ? sizes.images + ' pictures' : kind === 'video' ? sizes.clipSeconds + ' s of clips' : sizes.chars + ' characters'
        out('\n' + kind.toUpperCase() + '  (estimate for ' + what + ')')
        for (const m of list) { const e = estimate(m, sizes); out('  ' + m.id.padEnd(28) + price(m).padEnd(24) + (e === null ? '' : '≈ $' + dollars(e))) }
      }
      return 0
    }
    if (cmd === 'check') {
      const c = checkSettings(loadSettings(env), models)
      if (opts.json) json(c)
      else for (const k of KINDS) { const s = c.kinds[k]; out(k.padEnd(7) + s.status + (s.id ? ' (' + s.id + ')' : '') + (s.was !== undefined ? ' $' + String(s.was) + ' -> $' + String(s.now) : '')) }
      return c.ready ? 0 : 5
    }
    const [, kind, primary, backup] = pos
    const v = validateChoice(kind, primary, backup, models)
    if (v.ok !== true) { out(v.error); return 1 }
    const s = loadSettings(env)
    s[kind] = { ...v.choice, validatedAt: new Date().toISOString().slice(0, 10) }
    saveSettings(s, env)
    out('Saved: ' + kind + ' primary ' + v.choice.primary.id + ' (' + price(v.choice.primary) + ')' + (v.choice.backup ? ', backup ' + v.choice.backup.id + ' (' + price(v.choice.backup) + ')' : ', no backup' + (v.noBackupPossible ? ' (the account offers a single ' + kind + ' model)' : '')))
    return 0
  }
  out('Usage: studio.mjs doctor | models | check | set <image|video|speech> <primary> [<backup>] | settings | quote <storyboard.json>')
  return 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main(process.argv.slice(2))
}
