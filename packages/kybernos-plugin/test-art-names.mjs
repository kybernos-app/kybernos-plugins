#!/usr/bin/env node
/** The names a person may give a Creations file (rename, duplicate) — T2-05, 2026-10-24.
 *  Before: `[A-Za-z0-9][A-Za-z0-9 ._-]`, so « résumé.md » could be neither renamed nor duplicated, and a rename typed without its extension made the file vanish from Creations.
 *  Usage: node packages/kybernos-plugin/test-art-names.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { kbArtKeepExt, kbArtNameOk } from './art-names.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

for (const good of ['report.md', 'résumé copy.md', 'été.md', 'été.md', '日本語.md', 'Привет мир.txt', 'plan (v2).md', 'notes [draft].md', "it's mine.md", 'a & b, c + d.md', 'x', '9 lives.md', 'a'.repeat(120)]) {
  assert.equal(kbArtNameOk(good), true, JSON.stringify(good))
}
ok('names in any language, an accent made of one character or of a letter plus a mark (macOS), and the usual punctuation are accepted')

for (const bad of ['', ' lead.md', '.hidden', '..', '../x', 'a/b', '/etc/passwd', 'a\\b', 'a\nb', 'a\0b', 'a\tb', 'a;rm -rf x', '`x`', '$HOME', 'a|b', 'a>b', '"quoted"', 'a'.repeat(121), null, undefined, 7, ['a']]) {
  assert.equal(kbArtNameOk(bad), false, JSON.stringify(bad))
}
ok('a path, a hidden file, a control character, a shell metacharacter, an empty or too long name, and anything that is not a string are refused')

const listed = (name) => /\.(md|txt|html)$/i.test(name)
assert.equal(kbArtKeepExt('plan v2', '.md', listed), 'plan v2.md', 'the extension typed away is given back')
assert.equal(kbArtKeepExt('plan v2.md', '.md', listed), 'plan v2.md', 'typed with it, left alone')
assert.equal(kbArtKeepExt('plan.txt', '.md', listed), 'plan.txt', 'another listed extension is the person\'s choice')
assert.equal(kbArtKeepExt('plan.v2', '.md', listed), 'plan.v2.md', 'a dot that is not a listed extension does not count as one')
assert.equal(kbArtKeepExt('plan', '', listed), 'plan', 'a file that had no extension keeps none')
ok('a rename typed without its extension keeps the old one; one with a listed extension is left as typed')

// wired in the host, and the old ASCII-only rule is gone
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.js'), 'utf8')
const at = src.indexOf("if (action === 'duplicate' || action === 'rename') {")
const body = src.slice(at, src.indexOf("const cmd = action === 'rename'", at))
assert.match(body, /kbArtNameOk\(newName\) === false/, 'the name is checked by kbArtNameOk')
assert.match(body, /action === 'rename'\) newName = kbArtKeepExt\(newName, ext, \(nm\) => ARTIFACT_EXTS\.has\(kbArtifactExtOf\(nm\)\)\)/, 'a rename keeps the extension when needed')
assert.ok(body.indexOf('kbArtKeepExt') < body.indexOf('kbArtNameOk'), 'the length is checked after the extension is given back')
assert.ok(!/A-Za-z0-9 \._-/.test(body), 'the ASCII-only rule is gone')
ok('index.js checks the name with kbArtNameOk after kbArtKeepExt; the ASCII-only rule is gone')

console.log('\n' + pass + ' checks passed')
