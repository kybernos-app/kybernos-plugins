// The cover of a skill that has none: made the way the 24 covers of the Featured tab were made (docs/dev/skills-featured-covers.md), with the SAME style and tail,
// so a new picture sits in the row with the others. The scene is the only thing that changes: a model writes ONE scene for the skill, in the register of
// four of the scenes of the shipped covers; the picture is made from `<scene>. <style>. <tail>`, then cut out and trimmed to the alpha box.
//
//   1. scene    DeepInfra chat model, a few lines (a plain fallback when it does not answer)
//   2. picture  black-forest-labs/FLUX-2-pro on DeepInfra, 1344x768, a plain white ground                      (about 0.015 USD)
//   3. cut-out  Bria/remove_background on DeepInfra                                                              (about 0.018 USD)
//   4. trim     to the alpha box with 3 percent of padding (a PNG decoded and written here, no image library)
// The file is `<DSH home>/kybernos/skills-featured/<name>.png` (the folder the cover route already reads) and `<name>.cover.json` keeps the scene, so the picture can be
// made again. The key is the one DSH holds for DeepInfra (`DEEPINFRA_API_KEY`, the environment first, then `<DSH home>/.credentials.yaml`); it goes to api.deepinfra.com only,
// is never printed, and no key means no cover (the tile stays). A picture costs about 0.035 USD: at most `perDay` a day, one at a time, and a failure waits an hour.
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync, inflateSync, crc32 } from 'node:zlib'
import { randomBytes } from 'node:crypto'
import { kyDir, SKILL_NAME_RE } from './learned.mjs'

export const COVER_STYLE = "Isometric miniature world as a soft matte 3D render, but rich in hand-drawn detail like an ink-and-watercolour illustration: many tiny props and micro-details, a fine hand-inked line and hatching texture applied on the surfaces, watercolour wash texture and subtle bleeding colour on the materials, small plants, cables, scattered papers and tiny scribbles that are not letters, tiny characters with expressive faces, warm soft light, pastel palette with ochre and sage"
export const COVER_TAIL = "The tile floats alone, isolated on a perfectly plain pure white background, nothing else in the frame, no shadow cast on the background, centred with a generous margin all around. No text, no letters, no numbers, no words, no logos, no watermark, no signature."
/** Four of the shipped scenes: the register the model is asked to write in. */
export const COVER_EXAMPLES = {
  "cold-email": "a postal sorting room where paper planes made from letters take off from a big mailbox, a conveyor belt of envelopes, a few recipients catching planes and sending reply arrows back",
  "task-management": "a big checklist board with tiny people ticking items, moving sticky notes between columns, a calendar with a pin, a clock",
  "gws-gmail-triage": "an overflowing inbox of envelopes being sorted by tiny people into three coloured trays, a calm person at the centre holding a checklist, the pile getting smaller",
  "seo-audit": "tiny inspectors with magnifying glasses and ladders examining a giant web page as if it were a landmark, one climbing a tall ladder to fix a signpost at the top, a golden star placed at the very top of a ranked list of results"
}
// `attempts`: pictures tried for one card when the cut-out is not a floating tile (a room that kept its walls); `perDay` counts every picture paid for, a failed one included;
// `shareMin` / `shareMax`: the part of the trimmed picture that is opaque (the shipped covers are 40 to 55 %, a room that was not cut out is 85 %).
export const COVER_LIMITS = Object.freeze({ perDay: 16, attempts: 3, shareMin: 0.12, shareMax: 0.8, shareGood: 0.72, failedMs: 15 * 60 * 1000, sceneMax: 480, descriptionMax: 400, timeoutMs: 90000, imageMax: 12 * 1024 * 1024 })
export const COVER_MODELS = Object.freeze({ chat: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', image: 'black-forest-labs/FLUX-2-pro', cutout: 'Bria/remove_background' })
const DEEPINFRA = 'https://api.deepinfra.com'

export const coversDir = (dsh) => join(dsh, 'kybernos', 'skills-featured')
export const settingsPath = (dsh) => join(kyDir(dsh), 'skills-covers.json')
const EXTS = ['png', 'webp', 'jpg', 'jpeg', 'svg']
export const hasCover = (dsh, name) => SKILL_NAME_RE.test(name) && EXTS.some((e) => existsSync(join(coversDir(dsh), name + '.' + e)))

// ── the key ───────────────────────────────────────────────────────────────────────────────────────────────────
export const keyOf = (dsh, env = process.env) => {
  const fromEnv = typeof env.DEEPINFRA_API_KEY === 'string' ? env.DEEPINFRA_API_KEY.trim() : ''
  if (fromEnv !== '') return fromEnv
  try {
    const line = readFileSync(join(dsh, '.credentials.yaml'), 'utf8').split(/\r?\n/).find((l) => /^\s*DEEPINFRA_API_KEY\s*:/.test(l))
    if (line === undefined) return ''
    return line.replace(/^[^:]*:/, '').replace(/\s+#.*$/, '').trim().replace(/^['"]|['"]$/g, '')
  } catch (e) { return '' }
}

// ── the scene ─────────────────────────────────────────────────────────────────────────────────────────────────
const clean = (text, max) => String(typeof text === 'string' ? text : '').replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

/** A plain scene for when the model does not answer: tiny people at work on what the skill does. */
export const fallbackScene = (name, description) => {
  const what = clean(description, 160).replace(/\s*Use when.*$/i, '').replace(/[.!?]+$/, '')
  return 'tiny people at work on a miniature workshop table around ' + (what !== '' ? 'this task: ' + what : 'the task called ' + name.replace(/-/g, ' ')) + ', tools, papers and small props, one person checking the result'
}

export const scenePrompt = (name, description) => ({
  system: 'You write ONE scene for an illustrated cover of a skill, in the same register as these examples (tiny people at work in a miniature isometric world, many small props, one clear idea). '
    + 'At most 55 words, one sentence or two, no title, no quotation marks. Never put any text, letters, numbers or logos in the scene. '
    + 'It is ONE compact miniature that can float alone on a small tile: never a whole room, street or landscape, nothing that needs a wall or a backdrop. Examples:\n' + Object.keys(COVER_EXAMPLES).map((k) => '- ' + k + ': ' + COVER_EXAMPLES[k]).join('\n'),
  user: 'Skill: ' + name.replace(/-/g, ' ') + '\nWhat it does: ' + clean(description, COVER_LIMITS.descriptionMax) + '\nScene:'
})

const sceneOf = (answer) => {
  const t = clean(answer, COVER_LIMITS.sceneMax + 200).replace(/^["'“«\s]+|["'”»\s]+$/g, '').replace(/^scene\s*:\s*/i, '').replace(/[.!?]+$/, '')
  if (t.length < 20 || /https?:|<|>/.test(t)) return ''
  return t.slice(0, COVER_LIMITS.sceneMax)
}

// ── the network (replaceable in the tests) ────────────────────────────────────────────────────────────────────
const post = async (key, path, body, fetchImpl) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), COVER_LIMITS.timeoutMs)
  try {
    const res = await fetchImpl(DEEPINFRA + path, { method: 'POST', signal: controller.signal, redirect: 'error', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key, 'user-agent': 'kybernos-skills' }, body: JSON.stringify(body) })
    if (res.ok !== true) return { ok: false, status: res.status }
    return { ok: true, json: await res.json() }
  } catch (e) { return { ok: false, status: 0 } } finally { clearTimeout(timer) }
}

const bytesOfImage = async (value, fetchImpl) => {
  if (typeof value !== 'string' || value === '') return null
  const data = /^data:image\/[a-z0-9.+-]+;base64,(.+)$/i.exec(value)
  if (data !== null) { const buf = Buffer.from(data[1], 'base64'); return buf.length > 0 && buf.length <= COVER_LIMITS.imageMax ? buf : null }
  let url = null
  try { url = new URL(value) } catch (e) { return null }
  // A temporary address on DeepInfra's own hosts, or on the one Bria hands its cut-outs from (measured: `https://temp.bria.ai/<id>/…`): nothing else is ever fetched.
  if (url.protocol !== 'https:' || (url.hostname !== 'deepinfra.com' && url.hostname.endsWith('.deepinfra.com') === false && url.hostname !== 'temp.bria.ai')) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), COVER_LIMITS.timeoutMs)
  try {
    const res = await fetchImpl(url.href, { signal: controller.signal, redirect: 'error', headers: { 'user-agent': 'kybernos-skills' } })
    if (res.ok !== true) return null
    const buf = Buffer.from(await res.arrayBuffer())
    return buf.length > 0 && buf.length <= COVER_LIMITS.imageMax ? buf : null
  } catch (e) { return null } finally { clearTimeout(timer) }
}

/** The three calls. `net` is `{ scene(name, description), image(prompt), cutout(buffer) }`; this is the real one. */
export const realNet = (key, fetchImpl = fetch) => ({
  async scene (name, description) {
    const p = scenePrompt(name, description)
    const r = await post(key, '/v1/openai/chat/completions', { model: COVER_MODELS.chat, temperature: 0.8, max_tokens: 160, messages: [{ role: 'system', content: p.system }, { role: 'user', content: p.user }] }, fetchImpl)
    const text = r.ok === true && r.json !== null && Array.isArray(r.json.choices) && r.json.choices[0] !== undefined && r.json.choices[0].message !== undefined ? r.json.choices[0].message.content : ''
    return sceneOf(text)
  },
  async image (prompt) {
    const r = await post(key, '/v1/openai/images/generations', { model: COVER_MODELS.image, prompt, size: '1344x768', n: 1, response_format: 'b64_json' }, fetchImpl)
    if (r.ok !== true || r.json === null || !Array.isArray(r.json.data) || r.json.data[0] === undefined) return null
    const first = r.json.data[0]
    return bytesOfImage(typeof first.b64_json === 'string' ? 'data:image/png;base64,' + first.b64_json : first.url, fetchImpl)
  },
  async cutout (buffer) {
    const r = await post(key, '/v1/inference/' + COVER_MODELS.cutout, { image: 'data:image/png;base64,' + buffer.toString('base64') }, fetchImpl)
    if (r.ok !== true || r.json === null || !Array.isArray(r.json.images) || r.json.images.length === 0) return null
    return bytesOfImage(r.json.images[0], fetchImpl)
  }
})

// ── the trim ──────────────────────────────────────────────────────────────────────────────────────────────────
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc32(body) >>> 0, 8 + data.length)
  return out
}
export const encodePng = (width, height, rgba) => {
  const rows = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y += 1) { rows[y * (width * 4 + 1)] = 0; rgba.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4) }
  const head = Buffer.alloc(13)
  head.writeUInt32BE(width, 0); head.writeUInt32BE(height, 4); head[8] = 8; head[9] = 6
  return Buffer.concat([SIGNATURE, chunk('IHDR', head), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}
/** `{ width, height, rgba }` of an 8-bit RGBA PNG that is not interlaced, or null (anything else is kept as it is). */
export const decodePng = (buf) => {
  if (buf.length < 33 || buf.subarray(0, 8).equals(SIGNATURE) === false) return null
  let pos = 8; let head = null; const parts = []
  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos); const type = buf.toString('latin1', pos + 4, pos + 8)
    if (pos + 12 + len > buf.length) return null
    if (type === 'IHDR') head = buf.subarray(pos + 8, pos + 8 + len)
    else if (type === 'IDAT') parts.push(buf.subarray(pos + 8, pos + 8 + len))
    else if (type === 'IEND') break
    pos += 12 + len
  }
  if (head === null || head.length < 13 || parts.length === 0) return null
  const width = head.readUInt32BE(0); const height = head.readUInt32BE(4)
  if (head[8] !== 8 || head[9] !== 6 || head[12] !== 0 || width < 1 || height < 1 || width * height > 40e6) return null
  let raw
  try { raw = inflateSync(Buffer.concat(parts)) } catch (e) { return null }
  const stride = width * 4
  if (raw.length !== (stride + 1) * height) return null
  const rgba = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]
    const src = y * (stride + 1) + 1; const dst = y * stride
    for (let x = 0; x < stride; x += 1) {
      const a = x >= 4 ? rgba[dst + x - 4] : 0
      const b = y > 0 ? rgba[dst - stride + x] : 0
      const c = x >= 4 && y > 0 ? rgba[dst - stride + x - 4] : 0
      let v = raw[src + x]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : (pb <= pc ? b : c) }
      else if (filter !== 0) return null
      rgba[dst + x] = v & 255
    }
  }
  return { width, height, rgba }
}
/** The picture cut to the box where something is drawn (alpha above 10), with 3 percent of the longer side around it. A PNG this cannot read comes back as it is. */
export const trimPng = (buf) => {
  const img = decodePng(buf)
  if (img === null) return buf
  const { width, height, rgba } = img
  let x0 = width; let y0 = height; let x1 = -1; let y1 = -1
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) if (rgba[(y * width + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  if (x1 < 0) return buf
  const pad = Math.round(0.03 * Math.max(x1 - x0 + 1, y1 - y0 + 1))
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad)
  const w = x1 - x0 + 1; const h = y1 - y0 + 1
  if (w === width && h === height) return buf
  const out = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y += 1) rgba.copy(out, y * w * 4, ((y0 + y) * width + x0) * 4, ((y0 + y) * width + x1 + 1) * 4)
  return encodePng(w, h, out)
}

/** The part of a PNG's pixels that are opaque (alpha above 245), or null when the picture cannot be read. A floating tile is 40 to 55 %; 85 % is a room that was not cut out. */
export const opaqueShare = (buf) => {
  const img = decodePng(buf)
  if (img === null) return null
  let opaque = 0
  for (let i = 3; i < img.rgba.length; i += 4) if (img.rgba[i] > 245) opaque += 1
  return opaque / (img.width * img.height)
}

/** Does what was cut out reach the edge of the picture? Then the frame cropped the tile (the first real cover of a ticket desk had its legs cut at the bottom). `null` when unreadable. */
export const touchesEdge = (buf) => {
  const img = decodePng(buf)
  if (img === null) return null
  const { width, height, rgba } = img
  for (let x = 0; x < width; x += 1) if (rgba[x * 4 + 3] > 10 || rgba[((height - 1) * width + x) * 4 + 3] > 10) return true
  for (let y = 0; y < height; y += 1) if (rgba[y * width * 4 + 3] > 10 || rgba[(y * width + width - 1) * 4 + 3] > 10) return true
  return false
}

// ── what is made, what waits, what failed ─────────────────────────────────────────────────────────────────────
const readSettings = (dsh) => {
  try {
    const j = JSON.parse(readFileSync(settingsPath(dsh), 'utf8'))
    const failed = {}
    if (j !== null && typeof j === 'object' && j.failed !== null && typeof j.failed === 'object') for (const k of Object.keys(j.failed).slice(0, 200)) if (SKILL_NAME_RE.test(k) && Number.isFinite(j.failed[k])) failed[k] = j.failed[k]
    return { auto: j.auto !== false, day: typeof j.day === 'string' ? j.day : '', made: Number.isInteger(j.made) && j.made >= 0 ? j.made : 0, failed }
  } catch (e) { return { auto: true, day: '', made: 0, failed: {} } }
}
const writeSettings = (dsh, s) => {
  const file = settingsPath(dsh)
  mkdirSync(join(file, '..'), { recursive: true })
  const temp = file + '.tmp-' + String(process.pid) + '-' + randomBytes(3).toString('hex')
  try { writeFileSync(temp, JSON.stringify(s, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 }); renameSync(temp, file) } catch (e) { try { unlinkSync(temp) } catch (e2) { /* nothing to clean */ } throw e }
}
const dayOf = (now) => new Date(now).toISOString().slice(0, 10)

const queue = []       // [{ dsh, name, description }]
const making = new Map() // dsh -> name being made
let draining = false

/**
 * What the page needs for the cards it shows: for each name `have` (a file), `making`, `queued`, `failed` (tried, wait an hour), `limit` (today's
 * limit is reached), or `none`. `can` says whether anything can be made at all (a key, and the person's switch on).
 */
export const coverState = ({ dsh, names, now = Date.now(), env = process.env }) => {
  const s = readSettings(dsh)
  const items = {}
  const left = Math.max(0, COVER_LIMITS.perDay - (s.day === dayOf(now) ? s.made : 0))
  for (const n of Array.isArray(names) ? names.slice(0, 60) : []) {
    if (SKILL_NAME_RE.test(String(n)) === false) continue
    if (hasCover(dsh, n)) items[n] = 'have'
    else if (making.get(dsh) === n) items[n] = 'making'
    else if (queue.some((q) => q.dsh === dsh && q.name === n)) items[n] = 'queued'
    else if (s.failed[n] !== undefined && now - s.failed[n] < COVER_LIMITS.failedMs) items[n] = 'failed'
    else items[n] = left === 0 ? 'limit' : 'none'
  }
  return { ok: true, can: s.auto === true && keyOf(dsh, env) !== '', auto: s.auto, key: keyOf(dsh, env) !== '', left, items }
}

/**
 * Makes one cover now: scene, picture, cut-out, trim, check, write. Up to `attempts` pictures are tried until the cut-out is a floating tile (the opaque part of the
 * trimmed picture between `shareMin` and `shareMax`; the first one under `shareGood` is taken at once, otherwise the closest to a tile); a cut-out that fails is tried
 * twice on the same picture before a new one is paid for. Returns `{ ok, name, images }` (`images`: how many pictures were paid for) or `{ ok: false, error, images }`.
 * `net` is replaceable (tests).
 */
export const makeCover = async ({ dsh, name, description, net, now = Date.now() }) => {
  if (SKILL_NAME_RE.test(name) === false) return { ok: false, error: 'bad_name', images: 0 }
  if (hasCover(dsh, name)) return { ok: true, name, state: 'have', images: 0 }
  let scene = ''
  try { scene = await net.scene(name, description) } catch (e) { scene = '' }
  const usedFallback = scene === ''
  if (usedFallback) scene = fallbackScene(name, description)
  let images = 0
  let best = null
  let failure = 'image_failed'
  for (let attempt = 0; attempt < COVER_LIMITS.attempts; attempt += 1) {
    const prompt = scene + '. ' + COVER_STYLE + '. ' + COVER_TAIL + (attempt > 0 ? ' The whole scene is one compact tile with clear empty white space all around it.' : '')
    let picture = null
    try { picture = await net.image(prompt) } catch (e) { picture = null }
    // A picture that did not come back was not paid for and a second call would meet the same fault: the card waits (`failedMs`) instead.
    if (picture === null) { failure = 'image_failed'; break }
    images += 1
    let cut = null
    for (let again = 0; again < 2 && cut === null; again += 1) { try { cut = await net.cutout(picture) } catch (e) { cut = null } }
    if (cut === null) { failure = 'cutout_failed'; continue }
    const cropped = touchesEdge(cut) === true
    const final = trimPng(cut)
    const share = opaqueShare(final)
    if (share === null || (share <= COVER_LIMITS.shareGood && share >= COVER_LIMITS.shareMin && cropped === false)) { best = { final, share }; break }
    failure = 'not_a_tile'
    // A tile cropped by the frame, or too heavy, is kept only when no better one comes: the closest to a tile, an uncropped one first.
    const score = Math.abs(share - 0.5) + (cropped ? 1 : 0)
    if (share >= COVER_LIMITS.shareMin && share <= COVER_LIMITS.shareMax && (best === null || score < best.score)) best = { final, share, score }
  }
  if (best === null) return { ok: false, error: failure, images }
  const dir = coversDir(dsh)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, name + '.png')
  const temp = join(dir, '.' + name + '.' + String(process.pid) + '.tmp')
  writeFileSync(temp, best.final)
  renameSync(temp, file)
  writeFileSync(join(dir, name + '.cover.json'), JSON.stringify({ scene, fallbackScene: usedFallback, style: 'COVER_STYLE', models: COVER_MODELS, opaqueShare: best.share, pictures: images, madeAt: new Date(now).toISOString() }, null, 2) + '\n', { mode: 0o600 })
  return { ok: true, name, state: 'made', images }
}

/**
 * Asks for covers: each name without one is queued (at most `perDay` a day, one at a time in the background). Returns the state at once.
 * `items`: `[{ name, description }]`. Nothing is made without a key or with the person's switch off.
 */
export const requestCovers = ({ dsh, items, net, now = Date.now(), env = process.env, afterEach }) => {
  const state = coverState({ dsh, names: (Array.isArray(items) ? items : []).map((i) => i && i.name), now, env })
  if (state.can !== true) return state
  const by = net !== undefined ? net : realNet(keyOf(dsh, env))
  let left = state.left
  for (const it of Array.isArray(items) ? items.slice(0, 12) : []) {
    if (it === null || typeof it !== 'object' || state.items[it.name] !== 'none' || left <= 0) continue
    left -= 1
    queue.push({ dsh, name: it.name, description: clean(it.description, COVER_LIMITS.descriptionMax), net: by })
    state.items[it.name] = 'queued'
  }
  if (draining === false) {
    draining = true
    ;(async () => {
      try {
        while (queue.length > 0) {
          const job = queue.shift()
          making.set(job.dsh, job.name)
          let res = { ok: false, error: 'failed' }
          try { res = await makeCover({ dsh: job.dsh, name: job.name, description: job.description, net: job.net, now: Date.now() }) } catch (e) { res = { ok: false, error: 'failed' } }
          making.delete(job.dsh)
          try {
            const s = readSettings(job.dsh); const today = dayOf(Date.now())
            // every picture paid for counts toward the day, a failed card's too
            if (res.images > 0) { if (s.day !== today) { s.day = today; s.made = 0 } s.made += res.images }
            if (res.ok !== true) s.failed[job.name] = Date.now()
            else delete s.failed[job.name]
            writeSettings(job.dsh, { auto: s.auto, day: s.day, made: s.made, failed: s.failed })
          } catch (e) { /* the count is a courtesy */ }
          if (typeof afterEach === 'function') { try { afterEach(job, res) } catch (e) { /* ignored */ } }
        }
      } finally { draining = false }
    })()
  }
  return state
}

/** The person's switch (default on): `skills-covers.json` › `auto`. */
export const setAuto = (dsh, on) => {
  const s = readSettings(dsh)
  writeSettings(dsh, { auto: on === true, day: s.day, made: s.made, failed: s.failed })
  return { ok: true, auto: on === true }
}

/** For the tests: waits until nothing is queued or being made. */
export const idle = async () => { while (draining === true || queue.length > 0) await new Promise((r) => setTimeout(r, 5)) }
