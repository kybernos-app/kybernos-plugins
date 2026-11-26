// A reader for the zip container of an Office file (.docx, .xlsx, .pptx): the list of its parts and the text of one. Read only, no dependency: the guard
// (office-guard.mjs) needs to look inside a file to say what a light editor would lose, and nothing else here ever re-writes the container.
import { inflateRawSync } from 'node:zlib'

const EOCD = 0x06054b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50
const MAX_PART = 64 * 1024 * 1024 // one part inflated
const MAX_PARTS = 20000

const fail = (code) => { const e = new Error(code); e.code = code; throw e }

/** The parts of a zip: `Map<name, { method, size, compressed, offset }>`. Throws an error whose `code` is 'not-a-zip', 'zip64' or 'too-many-parts'. */
export const listParts = (buf) => {
  if (!Buffer.isBuffer(buf) || buf.length < 22) fail('not-a-zip')
  let at = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i -= 1) {
    if (buf.readUInt32LE(i) === EOCD) { at = i; break }
  }
  if (at < 0) fail('not-a-zip')
  const count = buf.readUInt16LE(at + 10)
  const size = buf.readUInt32LE(at + 12)
  const offset = buf.readUInt32LE(at + 16)
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) fail('zip64')
  if (count > MAX_PARTS) fail('too-many-parts')
  const parts = new Map()
  let p = offset
  for (let i = 0; i < count; i += 1) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CENTRAL) fail('not-a-zip')
    const method = buf.readUInt16LE(p + 10)
    const compressed = buf.readUInt32LE(p + 20)
    const usize = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    parts.set(name, { method, size: usize, compressed, offset: local })
    p += 46 + nameLen + extraLen + commentLen
  }
  return parts
}

/** The bytes of one part, or null when it is not there. Refuses a part that would inflate past MAX_PART (a zip bomb): throws code 'part-too-big'. */
export const readPart = (buf, parts, name) => {
  const part = parts.get(name)
  if (part === undefined) return null
  if (part.size > MAX_PART) fail('part-too-big')
  const at = part.offset
  if (at + 30 > buf.length || buf.readUInt32LE(at) !== LOCAL) fail('not-a-zip')
  const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28)
  const raw = buf.subarray(start, start + part.compressed)
  if (part.method === 0) return Buffer.from(raw)
  if (part.method === 8) {
    try { return inflateRawSync(raw, { maxOutputLength: MAX_PART }) } catch (e) { fail('part-too-big') }
  }
  return fail('not-a-zip')
}

/** The text of one part (UTF-8), or null. */
export const readText = (buf, parts, name) => {
  const b = readPart(buf, parts, name)
  return b === null ? null : b.toString('utf8')
}
