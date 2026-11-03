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

// A file a declared editor can draw is drawn by it INSIDE the viewer (read-only, with its own « Edit »), never read as text: the sidebar shows the document, not « file is binary ».
assert.ok(/embed: typeof entry\.embed === 'function' \? entry\.embed : null/.test(reg), 'the registry keeps the optional embed of an editor')
assert.ok(/const embedEditor = kbFileEditors\.forName\(name\)\s*\n\s*if \(embedEditor !== null && embedEditor\.embed !== null && embedEditor\.embeds\(name\) === true\) return h\(KbFileEmbed/.test(client), 'ArtBody hands such a file to the editor before it looks at the text')
// An editor may leave a name to the viewer's own preview (`embeds`: Markdown keeps its rendered preview, the pencil still opens the editor); without `embeds` it takes all its names.
assert.ok(/embeds: typeof entry\.embeds === 'function' \? \(name\) => \{ try \{ return entry\.embeds\(name\) === true \} catch \(e\) \{ return false \} \} : \(\) => true/.test(reg), 'the registry keeps the optional embeds of an editor, true for every name by default')
{
  const win = {}
  new Function('window', reg)(win)
  const api = win.__KB_EDITORS__
  const open = () => {}
  api.register({ id: 'all', canEdit: (n) => /\.docx$/.test(n), open, embed: () => null })
  api.register({ id: 'some', canEdit: (n) => /\.md$/.test(n), open, embed: () => null, embeds: (n) => !/\.md$/.test(n) })
  api.register({ id: 'broken', canEdit: (n) => /\.pdf$/.test(n), open, embed: () => null, embeds: () => { throw new Error('boom') } })
  assert.equal(api.forName('a.docx').embeds('a.docx'), true, 'no embeds: every name is drawn by the editor')
  assert.equal(api.forName('a.md').embeds('a.md'), false, 'embeds can leave a name to the viewer')
  assert.equal(api.forName('a.pdf').embeds('a.pdf'), false, 'an embeds that throws leaves the name to the viewer')
}
assert.ok(client.indexOf('const embedEditor = kbFileEditors.forName(name)') < client.indexOf("if (load.state === 'error') return h('div', { className: 'kbg-empty' }, kbt('deliverables.notfound')"), 'and before the « preview unavailable » of a binary file')
// Leaving the viewer with changes the editor still holds asks first (the popup: Esc, the scrim, the cross; the page: Back).
assert.ok(/const leave = \(\) => \{ if \(kbEmbedCanLeave\(\) === true\) onClose\(\) \}/.test(client) && /onClick: leave \}, '✕'/.test(client) && /className: 'kb6-popscrim', onClick: leave/.test(client) && /if \(ev\.key === 'Escape'\) leave\(\)/.test(client), 'the popup asks before it closes')
assert.ok(/className: 'kbg-back', onClick: \(\) => \{ if \(kbEmbedCanLeave\(\) === true\) onBack\(\) \}/.test(client), 'the page of a file asks before Back')
// The guard itself, run: nothing asks while nothing is dirty; a dirty editor asks, and « no » keeps the viewer.
const guardSrc = client.slice(client.indexOf('const kbEmbedDirty = new Set()'), client.indexOf('const KbFileEmbed = '))
const kbe = (t) => t
let asked = 0
let answer = true
globalThis.window = { confirm: () => { asked += 1; return answer } }
const guard = new Function('kbe', 'window', guardSrc + '\nreturn { kbEmbedDirty, kbEmbedCanLeave }')(kbe, globalThis.window)
assert.equal(guard.kbEmbedCanLeave(), true, 'no editor: leave')
let dirty = false
guard.kbEmbedDirty.add(() => dirty)
assert.equal(guard.kbEmbedCanLeave(), true, 'a clean editor: leave, nothing asked')
assert.equal(asked, 0)
dirty = true
answer = false
assert.equal(guard.kbEmbedCanLeave(), false, 'unsaved changes and « no »: stay')
answer = true
assert.equal(guard.kbEmbedCanLeave(), true, 'unsaved changes and « yes »: leave')
assert.equal(asked, 2, 'asked once each time')
dirty = false
guard.kbEmbedDirty.add(() => { throw new Error('an editor that cannot say') })
asked = 0
assert.equal(guard.kbEmbedCanLeave(), true, 'an editor that throws never keeps the person in the viewer')
assert.equal(asked, 0, 'and asks nothing')
ok('the viewer draws a file an editor takes inside itself, and asks before it is closed over unsaved changes')

console.log('\n' + pass + ' passed')
