// serve-user-file.mjs is the one exit for a file that a person's project (or a file they could edit by hand) supplied: an avatar, a voice sample, a portrait
// (recette 2026-10-25, L3-08, decision DL-04: such a file is never shown as a document in DSH's origin). Bundles are installed on their own and import
// nothing from one another, so each one that serves such a file holds a copy of the same file. This test keeps that honest:
//   1. every copy is byte-identical, and a bundle that holds a copy imports it (a copy nobody imports is dead code);
//   2. what the helper decides, row by row: the type comes from the bytes and from the fixed list, the rest is a download, every answer carries the three protections;
//   3. THE FAMILY: every route of every bundle that answers with a content type computed at run time is listed below with the reason it is safe. A new route of
//      that kind fails here until it goes through the helper or is classified, so the next avatar-like route cannot be forgotten.
//
//   node scripts/test-serve-user-file.mjs
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const packages = join(root, 'packages')
let failed = 0
const check = (label, ok, detail) => {
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok || detail === undefined ? '' : '  -- ' + detail))
  if (!ok) failed += 1
}
const text = (pkg, file) => readFileSync(join(packages, pkg, file), 'utf8')

// ── 1. identical copies, each one used ────────────────────────────────────────────────────────────────────────────────────
const copies = readdirSync(packages).filter((p) => existsSync(join(packages, p, 'serve-user-file.mjs'))).sort()
console.log('copies of serve-user-file.mjs: ' + copies.join(', '))
check('the helper is in the core plugin and in the Kaby customisation bundle (the two that serve a file of the person\'s)', copies.includes('kybernos-plugin') && copies.includes('kybernos-kaby-customisation'), copies.join(', '))
for (const pkg of copies.slice(1)) check(pkg + '/serve-user-file.mjs is identical to ' + copies[0] + '/serve-user-file.mjs', text(pkg, 'serve-user-file.mjs') === text(copies[0], 'serve-user-file.mjs'))
const hostFiles = (pkg) => readdirSync(join(packages, pkg)).filter((f) => /\.(m?js)$/.test(f) && !/^(test|lib-)/.test(f) && f !== 'client.js' && f !== 'serve-user-file.mjs')
for (const pkg of copies) {
  const users = hostFiles(pkg).filter((f) => /from '\.\/serve-user-file\.mjs'/.test(text(pkg, f)) && /sendUserFile\(res, /.test(text(pkg, f)))
  check(pkg + ': a host file imports the helper and answers through sendUserFile', users.length > 0, users.join(', '))
}

// ── 2. what the helper decides ────────────────────────────────────────────────────────────────────────────────────────────
const { sniffInlineType, userFileType, userFileHeaders, sendUserFile } = await import(pathToFileURL(join(packages, copies[0], 'serve-user-file.mjs')).href)
const z = (n) => Buffer.alloc(n)
const bytes = {
  png: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), z(20)]),
  jpeg: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), z(20)]),
  gif: Buffer.concat([Buffer.from('GIF87a'), z(20)]),
  webp: Buffer.concat([Buffer.from('RIFF'), z(4), Buffer.from('WEBP'), z(20)]),
  wav: Buffer.concat([Buffer.from('RIFF'), z(4), Buffer.from('WAVE'), z(20)]),
  mp3id3: Buffer.concat([Buffer.from('ID3'), z(20)]),
  mp3frame: Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), z(20)]),
  ogg: Buffer.concat([Buffer.from('OggS'), z(20)]),
  flac: Buffer.concat([Buffer.from('fLaC'), z(20)]),
  webm: Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), z(20)]),
  m4a: Buffer.concat([z(4), Buffer.from('ftypM4A '), z(20)]),
}
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script></svg>')
const SVG_PROLOG = Buffer.from('﻿<?xml version="1.0"?>\n<!-- x -->\n<svg width="1" height="1"/>')
const HTML = Buffer.from('<!doctype html><script>alert(1)</script>')
const CSP = "default-src 'none'; sandbox"
const rows = [
  // [label, bytes, type, inline]
  ['a PNG', bytes.png, 'image/png', true], ['a JPEG', bytes.jpeg, 'image/jpeg', true], ['a GIF', bytes.gif, 'image/gif', true], ['a WebP', bytes.webp, 'image/webp', true],
  ['a WAV', bytes.wav, 'audio/wav', true], ['an MP3 with an ID3 tag', bytes.mp3id3, 'audio/mpeg', true], ['an MP3 frame', bytes.mp3frame, 'audio/mpeg', true],
  ['an Ogg file', bytes.ogg, 'audio/ogg', true], ['a FLAC file', bytes.flac, 'audio/flac', true], ['a WebM recording', bytes.webm, 'audio/webm', true], ['an M4A file', bytes.m4a, 'audio/mp4', true],
  ['an SVG with scripts: still an image type so that an <img> draws it, but a download', SVG, 'image/svg+xml', false],
  ['an SVG behind a BOM, a prolog and a comment', SVG_PROLOG, 'image/svg+xml', false],
  ['an HTML page', HTML, 'application/octet-stream', false],
  ['a PNG signature cut short', Buffer.from([0x89, 0x50]), 'application/octet-stream', false],
  ['a RIFF file that is neither WebP nor WAV (an AVI)', Buffer.concat([Buffer.from('RIFF'), z(4), Buffer.from('AVI '), z(20)]), 'application/octet-stream', false],
  ['plain text', Buffer.from('hello there, nobody recognises me'), 'application/octet-stream', false],
  ['an empty file', Buffer.alloc(0), 'application/octet-stream', false],
  ['a page that claims to be a PNG through its first bytes only after a few spaces', Buffer.concat([Buffer.from('   '), bytes.png]), 'application/octet-stream', false],
  ['an SVG that only mentions <svg after the first 4 KB', Buffer.concat([z(5000), SVG]), 'application/octet-stream', false],
]
for (const [label, b, type, inline] of rows) {
  const how = userFileType(b)
  check('helper: ' + label + ' -> ' + type + (inline ? ' inline' : ' as a download'), how.type === type && how.inline === inline, JSON.stringify(how))
  const h = userFileHeaders(b)
  check('helper: ' + label + ' carries nosniff, the closed CSP and its length' + (inline ? '' : ', and attachment'),
    h['x-content-type-options'] === 'nosniff' && h['content-security-policy'] === CSP && h['content-length'] === String(b.length) && h['cache-control'] === 'no-store' && h['content-type'] === type && h['content-disposition'] === (inline ? undefined : 'attachment'), JSON.stringify(h))
}
check('helper: nothing but a Buffer is sniffed', sniffInlineType('GIF89a') === null && sniffInlineType(null) === null && sniffInlineType(undefined) === null)
check('helper: a type is never "text/html", whatever the bytes', rows.every(([, b]) => !/html/i.test(userFileType(b).type)))
const sent = []
sendUserFile({ writeHead: (code, headers) => sent.push([code, headers]), end: (body) => sent.push([body]) }, bytes.png)
check('helper: sendUserFile answers 200 with the headers and the bytes', sent.length === 2 && sent[0][0] === 200 && sent[0][1]['content-type'] === 'image/png' && sent[1][0] === bytes.png)

// ── 3. the family: every content type computed at run time, classified ───────────────────────────────────────────────────
// `package/file :: expression` -> why it is safe. A file of a person's (project, store, profile) NEVER appears here: it goes through sendUserFile.
const CLASSIFIED = new Map([
  ['kybernos-plugin/index.js :: type', 'technique/: two files of the plugin\'s own folder, the type is in a table next to them'],
  ['kybernos-plugin/index.js :: mimeForExt(ext)', 'art-raw: the extension must be an image or a deliverable of the whitelist, the answer carries nosniff and a closed CSP, an SVG is a download (H-04); the path is confined to a project (strict)'],
  ['kybernos-plugin/index.js :: mime', 'doc-raw (a chat attachment: the type is read from the first bytes, nosniff, a download unless it is a raster picture) and serveVendor (a vendored library of the plugin, a constant type)'],
  ['kybernos-skills/index.js :: COVER_TYPES[ext] ?? \'application/octet-stream\'', 'skill covers: pictures the plugin itself generates into the DSH home (not a project file)'],
  ['kybernos-motion/index.js :: a.type', 'motion asset: the type is looked up from the extension in a fixed table (pictures, sounds, a glTF model, a Lottie JSON; no SVG, no HTML), nosniff, and the path is confined to a project (strict)'],
  ['kybernos-call/call-routes.mjs :: mime', 'serveVendor: livekit-client.js of the plugin\'s own vendor folder, a constant type'],
  ['kybernos-mobile/remote-fake-relay.mjs :: hit[1]', 'the fake relay of the tests: serves the plugin\'s own files with the type of a fixed table'],
])
const files = []
const walk = (dir, rel) => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'vendor' || name === 'test' || name === 'agent') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { walk(full, rel + name + '/'); continue }
    if (/\.(m?js)$/.test(name) && !/^(test|lib-)/.test(name) && name !== 'client.js' && name !== 'serve-user-file.mjs') files.push(rel + name)
  }
}
for (const pkg of readdirSync(packages)) { if (statSync(join(packages, pkg)).isDirectory()) walk(join(packages, pkg), pkg + '/') }
const found = new Map()
for (const f of files) {
  const src = readFileSync(join(packages, f), 'utf8')
  for (const m of src.matchAll(/['"]content-type['"]\s*:\s*([^,}\n]+)/gi)) {
    const expr = m[1].trim()
    if (/^['"`]/.test(expr)) continue                       // a literal type
    found.set(f + ' :: ' + expr, true)
  }
  for (const m of src.matchAll(/setHeader\(\s*['"]content-type['"]\s*,\s*([^)\n]+)\)/gi)) {
    const expr = m[1].trim()
    if (/^['"`]/.test(expr)) continue
    found.set(f + ' :: ' + expr, true)
  }
}
check('the scan sees the bundles (' + files.length + ' host files)', files.length > 100, String(files.length))
const unknown = [...found.keys()].filter((k) => !CLASSIFIED.has(k))
check('every computed content type is classified: none left over (a new one goes through sendUserFile or is added above with its reason)', unknown.length === 0, unknown.join(' | '))
const stale = [...CLASSIFIED.keys()].filter((k) => !found.has(k))
check('the classification names no route that is gone', stale.length === 0, stale.join(' | '))
check('no route computes its content type from a name that says it comes from a person\'s file (out.mime, got.mime, entry.mime)', ![...found.keys()].some((k) => /\b(out|got|entry|sample|portrait)\.mime\b/.test(k)))

console.log(failed === 0 ? '\nOK' : '\n' + failed + ' failure(s)')
process.exit(failed === 0 ? 0 : 1)
