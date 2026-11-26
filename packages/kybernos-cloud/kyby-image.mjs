// Kaby makes a picture: `create_image` asks one of the account's picture models (the creation models of the server's catalogue, ADR 0003 § 11) through `POST /v1/images/generations`, writes the
// pictures as files in the working folder and says what it cost. Before this, nothing could: the server had no generation call and Kaby had no tool, so « make me an image » ended on a
// brief (measured through the MCP door, 2026-11-20). The server owns the price, the budget and the refusals; this file owns what a computer may ask (a bounded prompt, a size the
// providers take), where the bytes may land (inside the working folder, never elsewhere) and what Kaby is told back, in plain sentences. Pure: the network, the folder and the disk are
// given by `deps`, so the tool is tested without DSH and without a server.
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { dataLine } from './kyby-identity.mjs'

export const TOOL = 'create_image'
/** The most pictures one call may ask for (the server holds the budget for all of them before it starts, so it bounds the same). */
export const MAX_N = 4
export const MAX_PROMPT = 4000
/** One price covers at most this many pixels (the server refuses a larger picture: a provider charges by the megapixel). */
export const MAX_PIXELS = 1_600_000
export const DEFAULT_SIZE = '1024x1024'
export const DEFAULT_FOLDER = 'images'
const TIMEOUT_MS = 120_000

export const DESCRIPTION = 'Makes pictures with the account\'s own picture models and saves them as image files in the working folder: an illustration, a photo-like scene, a poster background, a logo sketch, '
  + 'a product shot. Use it for EVERY request for a picture instead of looking for another generator, writing code or drawing an SVG by hand. Describe the scene in "prompt" (subject, place, light, style; '
  + 'English works best; leave out any text to be written in the picture unless the person asked for it: models misspell). "n" asks 1 to ' + MAX_N + ' variants, each one is paid. "size" is WIDTHxHEIGHT '
  + '(default ' + DEFAULT_SIZE + ', each side 256 to 2048 and a multiple of 64, at most 1536x1024 in all). Leave "model" out to use the account\'s default picture model; give an id only when the person '
  + 'asks for a cheaper or a better one (the answer to a wrong id lists the models). The answer gives the file paths and the price; say both in one line, and hand the files over with deliver_files. '
  + 'If the answer says the budget is used up or no picture model exists, say so in one line and stop: do not look for another way.'

export const PARAMETERS = {
  prompt: { type: 'string', description: 'What the picture shows. Up to ' + MAX_PROMPT + ' characters.' },
  n: { type: 'integer', description: 'How many variants, 1 to ' + MAX_N + ' (default 1). Each one is paid.' },
  size: { type: 'string', description: 'WIDTHxHEIGHT, e.g. 1024x1024, 1536x1024 (landscape) or 1024x1536 (portrait). Default ' + DEFAULT_SIZE + '.' },
  model: { type: 'string', description: 'A picture model\'s id. Leave it out for the account\'s default.' },
  name: { type: 'string', description: 'A short name for the files (letters and digits). Default: the first words of the prompt.' },
  folder: { type: 'string', description: 'A folder of the working folder to put the files in (default "' + DEFAULT_FOLDER + '"). Relative only.' }
}

const out = () => ({
  schema: { type: 'object', additionalProperties: true, properties: { ok: { type: 'boolean' }, text: { type: 'string' } }, required: ['ok', 'text'] },
  render: (args, v) => [{ type: 'text', text: String(v.text) }]
})

const fail = (text) => ({ ok: false, text })

/** A label for a file name: letters and digits, lower case, hyphens between words. */
export const slugOf = (raw, max = 40) => String(raw ?? '')
  .normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase()
  .replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, max).replace(/-+$/u, '')

/** The kind of picture a run of bytes is, by its first bytes: `{ ext, mime }` or null (the file would be something else). */
export const imageKind = (b) => {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: 'png', mime: 'image/png' }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' }
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return { ext: 'webp', mime: 'image/webp' }
  return null
}

/** `0.03` × 3 as the price of three pictures, written `0.09`: decimal strings in, decimal string out, no floating point. null when the price does not read. */
export const costOf = (usd, n) => {
  if (typeof usd !== 'string' || !/^\d{1,6}(?:\.\d{1,9})?$/u.test(usd)) return null
  const [whole, frac = ''] = usd.split('.')
  const nano = BigInt(whole + frac.padEnd(9, '0')) * BigInt(n)
  const text = nano.toString().padStart(10, '0')
  const intPart = text.slice(0, -9)
  const decimals = text.slice(-9).replace(/0+$/u, '').padEnd(2, '0')
  return intPart + '.' + decimals
}

/** The picture models of a `GET /v1/models` answer, the server's own order first: `[{ id, name, usd }]`. */
export const pictureModels = (body) => {
  const rows = body !== null && typeof body === 'object' && Array.isArray(body.data) ? body.data : []
  const found = []
  for (const e of rows) {
    if (e === null || typeof e !== 'object' || e.kind !== 'image' || typeof e.id !== 'string' || e.id === '' || e.id.length > 120) continue
    const up = e.unit_pricing !== null && typeof e.unit_pricing === 'object' ? e.unit_pricing : null
    found.push({ id: e.id, name: typeof e.display_name === 'string' && e.display_name.trim() !== '' ? e.display_name.trim() : e.id, usd: up !== null && up.unit === 'image' && typeof up.usd === 'string' ? up.usd : null })
    if (found.length >= 20) break
  }
  return found
}

const priceLine = (m) => dataLine(m.id, 60) + (m.name !== m.id ? ' (' + dataLine(m.name, 40) + ')' : '') + (m.usd !== null ? ', ' + m.usd + ' USD a picture' : '')

/** The size, checked the way the server checks it: a sentence when it is wrong, null when it is fine. */
export const sizeProblem = (size) => {
  const m = /^(\d{3,4})x(\d{3,4})$/u.exec(size)
  if (m === null) return 'The size is WIDTHxHEIGHT, for example 1024x1024.'
  const w = Number(m[1])
  const h = Number(m[2])
  if (![w, h].every((v) => v >= 256 && v <= 2048 && v % 64 === 0)) return 'Each side of the size is 256 to 2048 and a multiple of 64 (1024x1024, 1536x1024).'
  if (w * h > MAX_PIXELS) return 'That size is larger than one price covers: 1536x1024 at most.'
  return null
}

/** What the server said, in a sentence for Kaby. `res` is `{ status, body }`; the server's own codes come first. */
export const sayRefusal = (res) => {
  const status = res !== null && res !== undefined && Number.isFinite(res.status) ? res.status : 0
  const err = res !== null && res !== undefined && res.body !== null && typeof res.body === 'object' && res.body.error !== null && typeof res.body.error === 'object' ? res.body.error : {}
  const code = typeof err.code === 'string' ? err.code : (res !== null && res !== undefined && res.body !== null && typeof res.body === 'object' && typeof res.body.error === 'string' ? res.body.error : '')
  const message = typeof err.message === 'string' ? dataLine(err.message, 200) : ''
  if (code === 'insufficient_quota' || status === 402) return 'The budget of this account is used up for now, so no picture was made and nothing was charged. Say so in one line and stop.'
  if (code === 'model_not_found' || status === 404) return 'That picture model does not exist on this account.'
  if (code === 'model_kind') return 'That model is not a picture model.'
  if (status === 400) return 'The server refused the request' + (message !== '' ? ': ' + message : '') + '. Nothing was charged.'
  if (status === 401 || status === 403 || code === 'computer_route_not_allowed') return 'This account cannot make pictures from here (' + (code !== '' ? code : 'refused') + '). Say so in one line.'
  if (status === 429) return 'The picture service is busy right now: nothing was charged. Try once more in a minute.'
  if (status === 0) return 'The server did not answer, so no picture was made and nothing was charged. Say so in one line.'
  return 'The picture could not be made (' + (code !== '' ? code : 'http ' + status) + '). Nothing was charged. Say so in one line; do not look for another way.'
}

/**
 * The tool. deps: `models()` and `generate(body, exec)` → `{ status, body }` (the host picks the account or the cloud computer's own token and never throws), `workingFolder(exec)` → the folder
 * a relative path starts from, or '' when it cannot be told, `io` `{ mkdir, writeFile }`, `now()` (optional), `keep(file, exec)` → `{ link }` or null (optional: puts a picture among the
 * person's own files and returns a private link to it; a failure never fails the tool).
 */
export function imageTool (deps) {
  const now = typeof deps.now === 'function' ? deps.now : () => new Date()
  return {
    name: TOOL,
    description: DESCRIPTION,
    parameters: { type: 'object', additionalProperties: false, properties: PARAMETERS, required: ['prompt'] },
    output: out(),
    async execute (args, exec) {
      const a = args !== null && typeof args === 'object' ? args : {}
      const prompt = typeof a.prompt === 'string' ? a.prompt.trim() : ''
      if (prompt === '') return fail('Say what the picture shows: "prompt" is empty.')
      if (prompt.length > MAX_PROMPT) return fail('The prompt is longer than ' + MAX_PROMPT + ' characters: shorten it.')
      const n = a.n === undefined || a.n === null ? 1 : a.n
      if (!Number.isInteger(n) || n < 1 || n > MAX_N) return fail('"n" is a whole number from 1 to ' + MAX_N + '.')
      const size = typeof a.size === 'string' && a.size.trim() !== '' ? a.size.trim().toLowerCase() : DEFAULT_SIZE
      const bad = sizeProblem(size)
      if (bad !== null) return fail(bad)
      const folderGiven = typeof a.folder === 'string' && a.folder.trim() !== '' ? a.folder.trim() : DEFAULT_FOLDER
      const cwd = await Promise.resolve(deps.workingFolder(exec)).catch(() => '')
      if (typeof cwd !== 'string' || cwd === '') return fail('There is no working folder to put the pictures in.')
      const dir = resolve(cwd, folderGiven)
      const rel = relative(cwd, dir)
      if (isAbsolute(folderGiven) || rel.startsWith('..') || isAbsolute(rel)) return fail('The pictures go inside the working folder: give a relative folder, or none.')

      // The model: the one asked for, else the account's default (the server's first picture model).
      let catalogue = null
      try { catalogue = await deps.models() } catch (e) { catalogue = null }
      const available = catalogue !== null && catalogue !== undefined && catalogue.status === 200 ? pictureModels(catalogue.body) : null
      const asked = typeof a.model === 'string' ? a.model.trim() : ''
      let model = asked
      if (asked === '') {
        if (available === null) return fail('The picture models could not be read right now. Say so in one line.')
        if (available.length === 0) return fail('This account has no picture model yet, so a picture cannot be made. Say so in one line and stop: do not look for another way.')
        model = available[0].id
      } else if (available !== null && !available.some((m) => m.id === asked)) {
        return fail('"' + dataLine(asked, 60) + '" is not a picture model of this account. The ones that are: ' + (available.length === 0 ? 'none yet' : available.map(priceLine).join('; ')) + '.')
      }

      let res
      try { res = await deps.generate({ model, prompt, n, size }, exec) } catch (e) { res = { status: 0, body: null } }
      if (res === null || res === undefined || res.status !== 200) return fail(sayRefusal(res))
      const data = res.body !== null && typeof res.body === 'object' && Array.isArray(res.body.data) ? res.body.data : []
      const pictures = []
      for (const item of data.slice(0, n)) {
        const b64 = item !== null && typeof item === 'object' && typeof item.b64_json === 'string' ? item.b64_json : ''
        const bytes = b64 === '' ? null : Buffer.from(b64, 'base64')
        const kind = bytes === null ? null : imageKind(bytes)
        if (bytes !== null && kind !== null) pictures.push({ bytes, kind })
      }
      if (pictures.length === 0) return fail('The server answered, but with no picture that could be read. Say so in one line.')

      const stem = slugOf(a.name) !== '' ? slugOf(a.name) : (slugOf(prompt.split(/\s+/u).slice(0, 5).join(' ')) || 'image')
      const stamp = now().toISOString().replace(/[-:]/gu, '').replace(/\.\d+Z$/u, '').replace('T', '-')
      const saved = []
      try {
        await deps.io.mkdir(dir)
        let i = 0
        for (const p of pictures) {
          i += 1
          const file = join(dir, stem + '-' + stamp + (pictures.length > 1 ? '-' + i : '') + '.' + p.kind.ext)
          await deps.io.writeFile(file, p.bytes)
          saved.push({ file, rel: relative(cwd, file), kind: p.kind, bytes: p.bytes })
        }
      } catch (e) {
        return fail('The pictures were made (and paid) but could not be written in the working folder. Say so in one line.')
      }

      const picked = available !== null ? available.find((m) => m.id === model) : undefined
      const price = picked !== undefined && picked.usd !== null ? costOf(picked.usd, pictures.length) : null
      const lines = ['Made ' + pictures.length + ' picture' + (pictures.length > 1 ? 's' : '') + ' with ' + dataLine(model, 60) + ' (' + size + ')' + (price !== null ? ', ' + price + ' USD' : '') + ':']
      for (const s of saved) {
        let link = null
        if (typeof deps.keep === 'function') { try { link = await deps.keep({ name: basename(s.file), mime: s.kind.mime, bytes: s.bytes, title: dataLine(prompt, 80) }, exec) } catch (e) { link = null } }
        lines.push('- ' + s.rel + (link !== null && link !== undefined && typeof link.link === 'string' ? ' — private link for the person, valid one hour: ' + link.link : ''))
      }
      lines.push('Hand the files over with deliver_files.')
      return { ok: true, text: lines.join('\n') }
    }
  }
}

/** What a person reads when a gate asks about this tool: the picture, never the bytes. */
export const imageShown = (args) => {
  const a = args !== null && typeof args === 'object' ? args : {}
  return 'Make ' + (Number.isInteger(a.n) && a.n > 1 ? a.n + ' pictures' : 'a picture') + ': ' + dataLine(a.prompt, 120)
}
