// The disk half of the Office editors on a temporary folder: what may be opened, that unchanged means untouched, what a save does to the file
// and what it leaves behind, the conflict, the copy, undo, and what the host serves to the sandboxed page. No DSH, no network.
//
//   node packages/kybernos-office/test-disk.mjs
import * as fsp from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, symlinkSync, statSync, chmodSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHost, editorHtml } from './office-host.mjs'
import { docx, xlsx } from './lib-test-files.mjs'

let failed = 0
const check = (label, ok, detail) => {
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok || detail === undefined ? '' : '  -- ' + detail))
  if (!ok) failed += 1
}
const sha = (b) => createHash('sha256').update(b).digest('hex')

const base = mkdtempSync(join(tmpdir(), 'kb-office-'))
const home = join(base, 'dsh-home')
const userHome = join(base, 'user')
const work = join(userHome, 'Documents')
mkdirSync(home, { recursive: true })
mkdirSync(work, { recursive: true })
let tick = 1000
const host = createHost({ fs: fsp, home, userHome, now: () => tick })

const put = (name, buf) => { const p = join(work, name); writeFileSync(p, buf); return p }
const listing = () => readdirSync(work).sort()

// ── what may be opened ─────────────────────────────────────────────────────────
const plainSheet = xlsx()
const sheetPath = put('budget.xlsx', plainSheet)
const docPath = put('report.docx', docx({ text: 'Original' }))
{
  check('a relative path is refused', (await host.open('Documents/budget.xlsx')).code === 'not-absolute')
  check('an empty, non-string or NUL path is refused', (await host.open('')).code === 'bad-path' && (await host.open(null)).code === 'bad-path' && (await host.open('/x\0.xlsx')).code === 'bad-path')
  check('a name the light editors do not open is refused', (await host.open(put('deck.pptx', docx()))).code === 'unsupported-format' && (await host.open(put('notes.txt', 'x'))).code === 'unsupported-format')
  check('a file that is not there is refused', (await host.open(join(work, 'nope.xlsx'))).code === 'not-found')
  mkdirSync(join(work, 'folder.xlsx'))
  check('a folder named like a workbook is not a file', (await host.open(join(work, 'folder.xlsx'))).code === 'not-a-file')
  check('text with a workbook name is refused, with the reason', (await host.open(put('fake.xlsx', 'just text'))).code === 'not-a-zip')
  check('a document renamed to .xlsx is refused', (await host.open(put('wrong.xlsx', docx()))).code === 'not-a-xlsx')
  mkdirSync(join(userHome, '.ssh'))
  put('x', 'x')
  writeFileSync(join(userHome, '.ssh', 'keys.xlsx'), plainSheet)
  check('a folder of keys is never opened', (await host.open(join(userHome, '.ssh', 'keys.xlsx'))).code === 'not-allowed')
  mkdirSync(join(userHome, 'Library'), { recursive: true })
  writeFileSync(join(userHome, 'Library', 'app.xlsx'), plainSheet)
  check('the system Library folder is never opened', (await host.open(join(userHome, 'Library', 'app.xlsx'))).code === 'not-allowed')
  symlinkSync(join(userHome, '.ssh', 'keys.xlsx'), join(work, 'link.xlsx'))
  check('a link to such a file is followed, then refused', (await host.open(join(work, 'link.xlsx'))).code === 'not-allowed')
  const o = await host.open(sheetPath)
  check('a good workbook opens: token, name, format, editor, size, hash, no losses', o.ok === true && /^[0-9a-f]{32}$/.test(o.token) && o.name === 'budget.xlsx' && o.format === 'xlsx' && o.editor === 'sheet' && o.size === plainSheet.length && o.hash === sha(plainSheet) && o.losses.length === 0 && o.block === false, JSON.stringify(o))
  check('~/ means the user\'s home', (await host.open('~/Documents/report.docx')).ok === true)
  const lossy = await host.open(put('chart.xlsx', xlsx({ chart: true })))
  check('a workbook with a chart opens with the loss said and block set', lossy.ok && lossy.block === true && lossy.losses[0].code === 'chart')
  check('opening writes nothing: the folder holds exactly what was put there', !listing().some((n) => n.startsWith('.') || n.endsWith('.tmp') || n.includes('(edited')))
  check('the same bytes are on disk after opening', readFileSync(sheetPath).equals(plainSheet))
}

// ── the bytes the editor is given ──────────────────────────────────────────────
{
  const o = await host.open(sheetPath)
  const b = await host.bytes(o.token)
  check('the bytes of the file are handed to the editor with their hash', b.ok && b.bytes.equals(plainSheet) && b.hash === sha(plainSheet) && b.format === 'xlsx')
  check('an unknown token is refused', (await host.bytes('0'.repeat(32))).code === 'unknown-token' && (await host.bytes(null)).code === 'unknown-token' && (await host.bytes('../x')).code === 'unknown-token')
  check('a file that went away is said so', await (async () => { const p = put('gone.xlsx', plainSheet); const t = (await host.open(p)).token; await fsp.rm(p); return (await host.bytes(t)).code === 'not-found' })())
}

// ── a save ─────────────────────────────────────────────────────────────────────
{
  const p = put('save.xlsx', xlsx({ cell: 'Before' }))
  chmodSync(p, 0o640)
  const before = readFileSync(p)
  const o = await host.open(p)
  const next = xlsx({ cell: 'After' })
  const s = await host.save(o.token, next, { base: o.hash })
  check('a save replaces the file with what the editor returned', s.ok === true && readFileSync(p).equals(next) && s.hash === sha(next) && s.undo === true, JSON.stringify(s))
  check('the mode of the file is kept', (statSync(p).mode & 0o777) === 0o640)
  check('no temp file is left next to it', !listing().some((n) => n.endsWith('.tmp')))
  check('the folder gained no file at all by saving', listing().filter((n) => n.startsWith('save')).join() === 'save.xlsx')
  const snaps = join(home, 'kybernos', 'kybernos-office', 'snapshots')
  check('the bytes before the save are kept in the plugin\'s own storage, not in the person\'s folder', existsSync(snaps) && readdirSync(snaps).length >= 1 && !readdirSync(work).some((n) => /prev|orig|snapshot/.test(n)))
  const second = await host.save(o.token, xlsx({ cell: 'Again' }), { base: s.hash })
  check('the next save goes on from the hash the last one gave', second.ok === true)
  const stale = await host.save(o.token, xlsx({ cell: 'Stale' }), { base: o.hash })
  check('a save on a stale hash is a conflict, nothing written', stale.status === 409 && stale.code === 'changed-on-disk' && readFileSync(p).equals(xlsx({ cell: 'Again' })) === true)
  check('no base hash is a conflict too (no blind overwrite)', (await host.save(o.token, next, {})).code === 'changed-on-disk')
  check('what is not a valid workbook is refused, the file is untouched', await (async () => { const r = await host.save(o.token, Buffer.from('<html>oops</html>'), { base: second.hash }); return r.code === 'invalid-output' && r.status === 422 && readFileSync(p).equals(xlsx({ cell: 'Again' })) })())
  check('a document saved into a workbook is refused (wrong format)', (await host.save(o.token, docx(), { base: second.hash })).code === 'invalid-output')
  check('an empty save is refused', (await host.save(o.token, Buffer.alloc(0), { base: second.hash })).code === 'bad-size' && (await host.save(o.token, 'text', { base: second.hash })).code === 'bad-size')
  check('the original from before the first save is still there (kept once)', readFileSync(join(snaps, readdirSync(snaps)[0], 'orig.bin')).equals(before))
}

// ── Kaby (or the person, elsewhere) wrote the file in the meantime ─────────────
{
  const p = put('race.docx', docx({ text: 'v1' }))
  const o = await host.open(p)
  const theirs = docx({ text: 'written by someone else' })
  writeFileSync(p, theirs)
  const r = await host.save(o.token, docx({ text: 'my edit' }), { base: o.hash })
  check('the other writer wins by default: the save is refused and their bytes stay', r.status === 409 && readFileSync(p).equals(theirs))
  const cp = await host.save(o.token, docx({ text: 'my edit' }), { mode: 'copy' })
  check('« save as a copy » writes next to it under a free name and leaves the original alone', cp.ok && cp.copy === true && cp.name === 'race (edited).docx' && readFileSync(p).equals(theirs) && readFileSync(join(work, cp.name)).equals(docx({ text: 'my edit' })))
  const cp2 = await host.save(o.token, docx({ text: 'again' }), { mode: 'copy' })
  check('a second copy does not overwrite the first', cp2.ok && cp2.name === 'race (edited 2).docx' && readFileSync(join(work, 'race (edited).docx')).equals(docx({ text: 'my edit' })))
  const re = await host.bytes(o.token)
  check('reloading takes the new bytes and the new base', re.ok && re.bytes.equals(theirs) && re.hash === sha(theirs))
  const ok = await host.save(o.token, docx({ text: 'merged by hand' }), { base: re.hash })
  check('a save on the reloaded base goes through', ok.ok === true)
}

// ── undo ───────────────────────────────────────────────────────────────────────
{
  const original = xlsx({ cell: 'Keep me' })
  const p = put('undo.xlsx', original)
  const o = await host.open(p)
  check('nothing to undo before a save', (await host.undo(o.token)).code === 'nothing-to-undo' && o.undo === false)
  const s = await host.save(o.token, xlsx({ cell: 'Changed' }), { base: o.hash })
  const u = await host.undo(o.token)
  check('undo puts the file back exactly as it was', u.ok && readFileSync(p).equals(original) && u.hash === sha(original))
  check('and only once', (await host.undo(o.token)).code === 'nothing-to-undo')
  const s2 = await host.save(o.token, xlsx({ cell: 'Second' }), { base: u.hash })
  writeFileSync(p, xlsx({ cell: 'Someone else' }))
  const refused = await host.undo(o.token)
  check('undo refuses when the file changed since the save (it would erase that change)', refused.status === 409 && refused.code === 'changed-since' && readFileSync(p).equals(xlsx({ cell: 'Someone else' })))
  const forced = await host.undo(o.token, { force: true })
  check('unless the person insists', forced.ok && readFileSync(p).equals(original))
  check('a fresh open of a file saved before still offers the undo', await (async () => { const p2 = put('undo2.xlsx', original); const a = await host.open(p2); await host.save(a.token, xlsx({ cell: 'X' }), { base: a.hash }); return (await host.open(p2)).undo === true })())
  void s; void s2
}

// ── what the host serves to the sandboxed page ─────────────────────────────────
{
  const editors = join(home, 'kybernos', 'kybernos-office', 'editors')
  const o = await host.open(sheetPath)
  check('without installed editors the page is not served', (await host.serve(o.token, 'sheet/app.js')).code === 'not-installed' && (await host.status()).installed.sheet === false)
  mkdirSync(join(editors, 'sheet'), { recursive: true })
  const js = Buffer.from('console.log("sheet")'); const css = Buffer.from('body{}'); const wasm = Buffer.from([0, 97, 115, 109])
  writeFileSync(join(editors, 'sheet', 'app.js'), js); writeFileSync(join(editors, 'sheet', 'app.css'), css); writeFileSync(join(editors, 'sheet', 'x.wasm'), wasm)
  writeFileSync(join(editors, 'secret.txt'), 'not in the manifest')
  const manifest = { version: '1', editors: ['sheet'], files: { 'sheet/app.js': { sha256: sha(js) }, 'sheet/app.css': { sha256: sha(css) }, 'sheet/x.wasm': { sha256: sha(wasm) } } }
  writeFileSync(join(editors, 'manifest.json'), JSON.stringify(manifest))
  tick += 5000
  check('the status says which editors are installed', await (async () => { const s = await host.status(); return s.version === '1' && s.installed.sheet === true && s.installed.doc === false })())
  const a = await host.serve(o.token, 'sheet/app.js')
  check('a listed file is served with its type', a.ok && a.body.equals(js) && a.type.startsWith('text/javascript') && (await host.serve(o.token, 'sheet/app.css')).type.startsWith('text/css') && (await host.serve(o.token, 'sheet/x.wasm')).type === 'application/wasm')
  const idx = await host.serve(o.token, 'sheet/index.html')
  check('the page is built by the host, with no inline script', idx.ok && idx.body.toString().includes('src="app.js"') && !/<script(?![^>]*src=)/.test(idx.body.toString()) && idx.body.toString() === editorHtml('sheet'))
  check('a file the manifest does not list is not served', (await host.serve(o.token, 'secret.txt')).code === 'not-found' && (await host.serve(o.token, 'doc/index.html')).code === 'not-found')
  check('no way out of the folder', (await host.serve(o.token, '../secret.txt')).code === 'not-found' && (await host.serve(o.token, 'sheet/../../x')).code === 'not-found' && (await host.serve(o.token, '/etc/passwd')).code === 'not-found' && (await host.serve(o.token, 'sheet\\app.js')).code === 'not-found')
  check('no token, no file', (await host.serve('f'.repeat(32), 'sheet/app.js')).code === 'unknown-token')
  writeFileSync(join(editors, 'sheet', 'app.css'), 'body{display:none}')
  check('a file changed after it was built does not match its hash, and is refused', (await host.serve(o.token, 'sheet/app.css')).code === 'corrupt')
  writeFileSync(join(editors, 'manifest.json'), '{ not json')
  tick += 5000
  check('a broken manifest means « not installed », not a crash', (await host.serve(o.token, 'sheet/app.js')).code === 'not-installed' && (await host.status()).installed.sheet === false)
}

// ── the use counter ────────────────────────────────────────────────────────────
{
  const st = await host.stats()
  check('opens, saves, conflicts, copies, undos and refusals are counted per format', st.xlsx.opens >= 5 && st.xlsx.saves >= 3 && st.xlsx.conflicts >= 2 && st.xlsx.undos >= 2 && st.xlsx.refused >= 1 && st.docx.copies >= 2 && st.docx.saves >= 1, JSON.stringify(st))
  check('the counter is a file in the plugin\'s own storage', existsSync(join(home, 'kybernos', 'kybernos-office', 'stats.json')))
  const broken = createHost({ fs: { ...fsp, writeFile: async () => { throw new Error('disk full') }, mkdir: async () => { throw new Error('disk full') } }, home: join(base, 'other-home'), userHome, now: () => tick })
  check('a counter that cannot be written never blocks an open', (await broken.open(sheetPath)).ok === true)
}

// ── time stays out of the file ─────────────────────────────────────────────────
{
  const p = put('mtime.xlsx', plainSheet)
  utimesSync(p, new Date('2020-01-01'), new Date('2020-01-01'))
  const m = statSync(p).mtimeMs
  const o = await host.open(p); await host.bytes(o.token)
  check('opening and reading leave the modified time alone', statSync(p).mtimeMs === m)
}

process.exit(failed === 0 ? 0 : 1)
