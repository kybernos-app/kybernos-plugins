#!/usr/bin/env node
/** The sidebar and the Creations page list the Office files a chat writes (2026-11-03). A chat asked for « a doc, a sheet, a slide, a pdf and mockups » and wrote a .docx,
 *  an .xlsx and a .pptx next to the PDF: the sidebar showed the PDF and none of the three, because the host's whitelist of creations had no Office extension.
 *  The whitelist and the filter are run here as they are written in index.js (a slice of the source), not copied.
 *
 *  Usage: node packages/kybernos-plugin/test-art-office.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KB_OFFICE_EXTS, kbIsOfficeLock } from './art-office.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))
const host = readFileSync(join(here, 'index.js'), 'utf8')
const client = readFileSync(join(here, 'client.js'), 'utf8')

assert.ok(host.includes("import { KB_OFFICE_EXTS, kbIsOfficeLock } from './art-office.mjs'"), 'index.js imports the Office list')
const a = host.indexOf('const ARTIFACT_EXTS = new Set([')
const b = host.indexOf('// Racines à ne JAMAIS scanner')
assert.ok(a > 0 && b > a, 'the whitelist block is in index.js')
const { ARTIFACT_EXTS, isLivrableName } = new Function('KB_OFFICE_EXTS', 'kbIsOfficeLock', host.slice(a, b) + '\nreturn { ARTIFACT_EXTS, isLivrableName }')(KB_OFFICE_EXTS, kbIsOfficeLock)

for (const ext of ['docx', 'xlsx', 'pptx', 'pdf']) assert.equal(isLivrableName('Sillage_Note.' + ext, '/work/Exemples/Sillage_Note.' + ext), true, ext)
ok('a .docx, an .xlsx and a .pptx are creations like the PDF next to them')

for (const ext of KB_OFFICE_EXTS) assert.ok(ARTIFACT_EXTS.has(ext), ext)
assert.deepEqual([...KB_OFFICE_EXTS].sort(), ['doc', 'docx', 'odp', 'ods', 'odt', 'ppt', 'pptx', 'xls', 'xlsx'])
ok('every Office and OpenDocument extension of art-office.mjs is on the host whitelist')

for (const name of ['~$Sillage_Note.docx', '~$Pilotage.xlsx', '~$Pitch.pptx']) assert.equal(isLivrableName(name, '/work/' + name), false, name)
assert.equal(kbIsOfficeLock('~$a.docx'), true)
assert.equal(kbIsOfficeLock('a.docx'), false)
ok('the lock file an open Word, Excel or PowerPoint leaves next to a document is not a creation')

assert.equal(isLivrableName('package.json', '/work/package.json'), false)
assert.equal(isLivrableName('notes.exe', '/work/notes.exe'), false)
assert.equal(isLivrableName('photo.png', '/work/photo.png'), false, 'a picture still counts only under artifacts/')
assert.equal(isLivrableName('photo.png', '/work/artifacts/photo.png'), true)
ok('what was left out stays out: project config, other binaries, pictures outside artifacts/')

// The client already files these extensions under documents, spreadsheets and slides: the host must be able to send what the client knows how to sort.
for (const ext of ['docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'ods', 'odp']) assert.ok(new RegExp("'" + ext + "'").test(client), 'the client knows .' + ext)
ok('the client sorts the same extensions into documents, spreadsheets and slides')

// The viewer of a file offers « Edit » to the editors a plugin declared (docs/dev/office-editors-open-save-contract-2026-11-03.md); the core knows no editor by name.
assert.ok(client.includes('window.__KB_EDITORS__ = api'), 'the core publishes the registry of file editors')
const reg = client.slice(client.indexOf('const kbFileEditors = (() => {'), client.indexOf('// One item of a source, drawn as the files are'))
assert.ok(/register: \(entry\) =>/.test(reg) && /forName: \(name\) =>/.test(reg) && /return \(\) => \{ if \(!live\) return/.test(reg), 'register takes an entry back, forName finds the editor of a name')
assert.ok(!/kybernos-office|docx|xlsx/i.test(reg), 'the registry names no editor and no format')
assert.ok(/const fileEditor = kbFileEditors\.forName\(name\)/.test(client) && /fileEditor !== null \? h\('button'[^\n]*'data-kb': 'art-popup-edit'/.test(client), 'the viewer draws the pencil only when an editor takes the name')
assert.ok(/'Modifier ce fichier': 'Edit this file'/.test(client) && /'Modifier': 'Edit'/.test(client), 'the French words of the pencil')
ok('the viewer offers Edit to a declared editor only, and the core names none')

console.log('\n' + pass + ' passed')
