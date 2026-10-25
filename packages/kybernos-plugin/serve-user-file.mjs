// The one way a route answers a GET with bytes that a person's project (or a file they could edit by hand) supplied: an avatar, a voice
// sample, a portrait. DSH serves every plugin route from its own origin and the browser sends the signed session cookie to it, so a
// script that runs from such an answer acts as the person (recette 2026-10, L3-08: an SVG with an `onload`, or an index that said
// `text/html`, ran in DSH's origin).
//
// The rule (DL-04): a file of a project is never shown as a document in DSH's origin.
//   · The content type is never read from the project. It comes from the first bytes of the file and only from this fixed list, which
//     is also what the pages show: png, jpeg, webp, gif; wav, mpeg, mp4, webm, ogg, flac.
//   · Those are answered inline.
//   · Anything else (an SVG, an HTML page, bytes nobody recognises) is answered as a download (`content-disposition: attachment`). An SVG
//     keeps `image/svg+xml` so that it still draws in an <img> (a browser never runs the script of an SVG used as an image, and
//     `attachment` does not stop an <img>); everything else is `application/octet-stream`.
//   · Every answer says `nosniff` and a CSP that shuts the document (`default-src 'none'; sandbox`: no script, no frame, no form, an opaque origin).
//
// Bundles are installed on their own and import nothing from one another, so each one that serves such a file holds a copy of this file
// (scripts/test-serve-user-file.mjs keeps the copies identical).

const INLINE = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'audio/wav', 'audio/mpeg', 'audio/mp4', 'audio/webm', 'audio/ogg', 'audio/flac',
])

const ascii = (bytes, from, to) => bytes.subarray(from, to).toString('latin1')

/** The type the first bytes of a file say, from the inline list; null when they say none of them. */
export function sniffInlineType (bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 4) return null
  const head4 = ascii(bytes, 0, 4)
  if (bytes.length >= 8 && bytes[0] === 0x89 && head4.slice(1) === 'PNG') return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (head4 === 'GIF8') return 'image/gif'
  if (head4 === 'RIFF' && bytes.length >= 12) {
    const kind = ascii(bytes, 8, 12)
    if (kind === 'WEBP') return 'image/webp'
    if (kind === 'WAVE') return 'audio/wav'
    return null
  }
  if (head4 === 'OggS') return 'audio/ogg'
  if (head4 === 'fLaC') return 'audio/flac'
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'audio/webm'
  if (bytes.length >= 8 && ascii(bytes, 4, 8) === 'ftyp') return 'audio/mp4'
  if (head4.slice(0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return 'audio/mpeg'
  return null
}

/** How a file is answered: `{ type, inline }`. `type` is always one of the fixed list, `image/svg+xml` or `application/octet-stream`. */
export function userFileType (bytes) {
  const sniffed = sniffInlineType(bytes)
  if (sniffed !== null && INLINE.has(sniffed)) return { type: sniffed, inline: true }
  if (Buffer.isBuffer(bytes) && /<svg[\s>]/i.test(bytes.subarray(0, 4096).toString('utf8'))) return { type: 'image/svg+xml', inline: false }
  return { type: 'application/octet-stream', inline: false }
}

/** The headers of the answer for these bytes. */
export function userFileHeaders (bytes) {
  const how = userFileType(bytes)
  const headers = {
    'content-type': how.type,
    'cache-control': 'no-store',
    'content-length': String(bytes.length),
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
  }
  if (how.inline === false) headers['content-disposition'] = 'attachment'
  return headers
}

/** Answers 200 with the bytes and the headers above. */
export function sendUserFile (res, bytes) {
  res.writeHead(200, userFileHeaders(bytes))
  res.end(bytes)
}
