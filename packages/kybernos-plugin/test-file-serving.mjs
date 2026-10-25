// ── The Creations routes read only inside a project; the project's files never open as a page in DSH's origin ───────────────────────────
//
// Recette 2026-10-25, lots 2 and 3 (L3-07, L3-08), decisions DL-05 and DL-04. Two families, each played against the real routes of the bundle.
//
// 1. READS (L3-07 / DL-05). `art-read`, `art-previews` and `art-raw` used the lax check of `cheminAutorise`, which counts `sandbox.workspaceRoot`
//    (the folder `dsh web` was started from, often the home) as a readable root: with that folder = the home, any local program read
//    the DSH session secret, a `.env` or an SSH key with no header and no cookie. They now pass `{ strict: true }` (as `art-load` did), accept only the
//    extensions of a deliverable (as `art-raw` did), and refuse a path that goes through `.credentials*`, `.env*` or `.ssh` whatever the mode.
//
// 2. SERVED FILES (L3-08 / DL-04). `/kybernos/avatar`, `/kybernos/member-avatar` and `/kybernos/voice-sample-audio` answered with the content type that
//    the project's own files declared and no protective header: an SVG with an `onload`, or an index that said `text/html`, ran in DSH's origin with
//    the person's cookie. They now answer through serve-user-file.mjs (the type from the bytes and a fixed list, `nosniff`, a closed CSP, a download for
//    anything that is not a picture or a sound of the list).
//
//   node packages/kybernos-plugin/test-file-serving.mjs
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { sessionSource } from './session-guard.mjs'
import { SESSION_SECRET } from './lib-session-test.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const base = realpathSync(mkdtempSync(join(tmpdir(), 'kb-plugin-file-serving-')))
const home = join(base, 'home')                      // the folder `dsh web` was started from: sandbox.workspaceRoot
const dshHome = join(base, 'dsh-home')
const project = join(home, 'proj')                   // the one registered project, inside it
const outside = join(base, 'elsewhere')
for (const d of [home, dshHome, project, outside, join(home, '.ssh'), join(project, '.ssh'), join(project, 'src'), join(home, 'kybers', '.kyber-avatars'), join(home, 'kybers', '.kyber-voices')]) mkdirSync(d, { recursive: true })
process.env.HOME = base
process.env.DSH_HOME = dshHome
process.env.USERPROFILE = base
for (const key of ['KYBERNOS_CLOUD_STATE', 'KYBERNOS_SERVERS_FILE']) delete process.env[key]
sessionSource.secret = () => SESSION_SECRET

// ── The fixtures ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)])
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40)])
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(40)])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(30)])
const WAV = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(30)])
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(40)])
const OGG = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(40)])
const FLAC = Buffer.concat([Buffer.from('fLaC'), Buffer.alloc(40)])
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(40)])
const M4A = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypM4A '), Buffer.alloc(30)])
const SVG_SCRIPT = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="document.title=\'ran\'"><script>fetch(\'/kybernos-terminal/run\')</script></svg>')
const HTML = Buffer.from('<!doctype html><html><body><script>document.title = "ran"</script></body></html>')
const b64 = (bytes) => bytes.toString('base64')

// Nothing here is a real secret: the words are the names a real one would carry.
writeFileSync(join(home, 'secret.txt'), 'SECRET-OUTSIDE-ANY-PROJECT')
writeFileSync(join(home, 'notes.md'), 'NOTES-IN-THE-LAUNCH-FOLDER')
writeFileSync(join(home, 'picture.png'), PNG)
writeFileSync(join(home, '.credentials.yaml'), 'secret: SESSION-SECRET-LOOKALIKE')
writeFileSync(join(home, '.env'), 'TOKEN=lookalike')
writeFileSync(join(home, '.ssh', 'id_test'), 'KEY-LOOKALIKE')
writeFileSync(join(outside, 'elsewhere.md'), 'ELSEWHERE')
writeFileSync(join(project, 'notes.md'), 'PROJECT-NOTES')
writeFileSync(join(project, 'plan.html'), '<h1>plan</h1>')
writeFileSync(join(project, 'data.json'), '{"a":1}')
writeFileSync(join(project, 'photo.png'), PNG)
writeFileSync(join(project, 'config.ts'), 'export const key = "x"')
writeFileSync(join(project, 'run.sh'), 'echo hi')
writeFileSync(join(project, 'noext'), 'NO-EXTENSION')
writeFileSync(join(project, '.credentials.yaml'), 'secret: PROJECT-LOOKALIKE')
writeFileSync(join(project, '.env.json'), '{"token":"lookalike"}')
writeFileSync(join(project, '.envrc.md'), 'ENVRC')
writeFileSync(join(project, '.ssh', 'notes.md'), 'SSH-NOTES')
writeFileSync(join(project, 'src', 'ok.md'), 'NESTED-OK')
try { symlinkSync(join(home, 'secret.txt'), join(project, 'link-out.txt')) } catch (e) { /* no symlink right: that row is skipped */ }

// The avatar store of the root `workspace` (= <launch folder>/kybers): the sidecar, three avatars, one member face, three voice samples.
const kybers = join(home, 'kybers')
const avatars = {
  'a-png': ['.kyber-avatars/a-png.png.b64', PNG],
  'a-jpg': ['.kyber-avatars/a-jpg.jpg.b64', JPEG],
  'a-webp': ['.kyber-avatars/a-webp.webp.b64', WEBP],
  'a-gif': ['.kyber-avatars/a-gif.gif.b64', GIF],
  'a-svg': ['.kyber-avatars/a-svg.svg.b64', SVG_SCRIPT],
  'a-html': ['.kyber-avatars/a-html.png.b64', HTML],       // the name says PNG, the bytes are a page
  'a-htmlsvg': ['.kyber-avatars/a-htmlsvg.svg.b64', HTML],  // the name says SVG, the bytes are a page
  'a-junk': ['.kyber-avatars/a-junk.gif.b64', Buffer.from('plain text nobody recognises')],
}
const ui = {}
for (const [id, [rel, bytes]] of Object.entries(avatars)) {
  writeFileSync(join(kybers, rel), b64(bytes))
  ui[id] = { avatar: rel }
}
ui['t-members'] = { members: {
  face: { avatar: '.kyber-avatars/t-members-face.png.b64' },
  evil: { avatar: '.kyber-avatars/t-members-evil.png.b64' },
  trav: { avatar: '.kyber-avatars/../../secret.txt' },
} }
writeFileSync(join(kybers, '.kyber-avatars', 't-members-face.png.b64'), b64(PNG))
writeFileSync(join(kybers, '.kyber-avatars', 't-members-evil.png.b64'), b64(SVG_SCRIPT))
writeFileSync(join(kybers, '.kyber-ui.json'), JSON.stringify(ui))
const voices = [
  ['v-wav', 'x-wav.wav', WAV, 'audio/wav'], ['v-mp3', 'x-mp3.mp3', MP3, 'audio/mpeg'], ['v-ogg', 'x-ogg.ogg', OGG, 'audio/ogg'],
  ['v-flac', 'x-flac.flac', FLAC, 'audio/flac'], ['v-webm', 'x-webm.webm', WEBM, 'audio/webm'], ['v-m4a', 'x-m4a.m4a', M4A, 'audio/mp4'],
  // The index lies: it says the sample is a web page (and the bytes are a real WAV, or really a page).
  ['v-lie-wav', 'x-lie1.wav', WAV, 'text/html'], ['v-lie-html', 'x-lie2.wav', HTML, 'text/html'], ['v-lie-audio', 'x-lie3.wav', HTML, 'audio/wav'],
  ['v-svg', 'x-svg.wav', SVG_SCRIPT, 'audio/wav'],
]
for (const [id, name, bytes] of voices) writeFileSync(join(kybers, '.kyber-voices', name + '.b64'), b64(bytes))
writeFileSync(join(kybers, '.kyber-voices', 'index.json'), JSON.stringify({ voices: voices.map(([id, name, , mime]) => ({ id, name: id, kyberId: 'k', file: '.kyber-voices/' + name + '.b64', mime })) }))

// ── The bundle, mounted over a small file service made from node:fs ───────────────────────────────────────────────────────────────────────
const handleOf = (p) => ({ p })
const fsSvc = {
  resolve: async (p, o) => handleOf(o !== undefined && o !== null && typeof o.cwd === 'string' ? join(o.cwd, p) : p),
  stat: async (h) => {
    const st = statSync(h.p)
    return { type: st.isDirectory() ? 'directory' : (st.isFile() ? 'file' : 'other'), size: st.size, version: ['0', '0', String(st.size), '0', '0'].join(':') }
  },
  readText: async (h) => readFileSync(h.p, 'utf8'),
  processPath: (h) => h.p,
  listDir: async (h) => readdirSync(h.p, { withFileTypes: true }).map((e) => ({ name: e.name, type: e.isDirectory() ? 'directory' : 'file', target: handleOf(join(h.p, e.name)) })),
  writeText: async () => {},
}
const routes = []
const service = { register: (r) => { routes.push(r); return () => {} }, registerRoute: (r) => { routes.push(r); return () => {} } }
const registry = { list: () => [{ id: 'w-proj', title: 'proj', path: project }] }
const ctx = new Proxy({
  get: (name) => (name === 'webServer' ? service : (name === 'fs' ? fsSvc : (name === 'sandboxPolicy' ? { workspaceRoot: home } : (name === 'workspaceRegistry' ? registry : undefined)))),
  inject: (_list, cb) => { try { cb(ctx) } catch (e) { /* a service that is not here */ } },
  effect: (fn) => { try { return fn() } catch (e) { return undefined } },
  on: () => {}, systemPrompt: { context: () => {} }, tools: { register: () => () => {} }, config: {},
  log: { info: () => {}, warn: () => {}, error: () => {} }, webServer: service,
}, { get: (t, k) => (k in t ? t[k] : (() => undefined)) })
const mod = await import(pathToFileURL(join(here, 'index.js')).href)
await Promise.race([Promise.resolve(mod.apply(ctx)), new Promise((r) => setTimeout(r, 5000))])
const routeOf = (path) => routes.find((r) => r.path === path && typeof r.handler === 'function')

const server = http.createServer((req, res) => {
  const route = routeOf(new URL(req.url, 'http://x').pathname)
  if (route === undefined) { res.writeHead(404); res.end('{}'); return }
  Promise.resolve(route.handler(req, res)).catch(() => { try { res.writeHead(500); res.end('{}') } catch (e) { /* closed */ } })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const own = '127.0.0.1:' + port
const origin = 'http://' + own

const request = (method, path, body) => new Promise((resolve) => {
  const payload = body === undefined ? null : JSON.stringify(body)
  const headers = { host: own }
  if (payload !== null) Object.assign(headers, { origin, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) })
  const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
    const chunks = []
    res.on('data', (c) => chunks.push(c))
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
  })
  req.on('error', () => resolve({ status: 0, headers: {}, body: Buffer.alloc(0) }))
  if (payload !== null) req.write(payload)
  req.end()
})
const q = (o) => new URLSearchParams(o).toString()
const readOf = async (path) => { const r = await request('GET', '/kybernos/art-read?' + q({ path }), undefined); return { status: r.status, json: JSON.parse(r.body.toString('utf8') || '{}') } }
const rawOf = (path) => request('GET', '/kybernos/art-raw?' + q({ path }), undefined)
const previewOf = async (path) => { const r = await request('POST', '/kybernos/art-previews', { paths: [path] }); return JSON.parse(r.body.toString('utf8') || '{}') }

let pass = 0
const failures = []
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
/** One row of a table: a row that fails is listed and the next one still runs, so a regression shows every path it opens. */
const row = async (label, check) => {
  try { await check(); ok(label) } catch (e) { failures.push(label); console.error('  ✗ ' + label + ' — ' + String(e && e.message ? e.message : e).split('\n')[0].slice(0, 220)) }
}

try {
  console.log('Kybernos plugin: the Creations routes read inside a project, the project\'s files never open as a page')

  // ── 1. READS: one row per path, one verdict for the three routes ─────────────────────────────────────────────────────────────────────────
  // [label, path, allowed]. The launch folder is the home here (sandbox.workspaceRoot): only the registered project inside it is readable.
  const READS = [
    ['a file in the launch folder, outside every project (a note)', join(home, 'secret.txt'), false],
    ['a deliverable in the launch folder, outside every project', join(home, 'notes.md'), false],
    ['an image in the launch folder, outside every project', join(home, 'picture.png'), false],
    ['the DSH credentials file, in the launch folder', join(home, '.credentials.yaml'), false],
    ['a .env, in the launch folder', join(home, '.env'), false],
    ['an SSH key, in the launch folder', join(home, '.ssh', 'id_test'), false],
    ['a file outside the launch folder', join(outside, 'elsewhere.md'), false],
    ['a system file', '/etc/hosts', false],
    ['a dot-dot path out of the project', join(project, '..', 'secret.txt'), false],
    ['a link inside the project that points out of it', join(project, 'link-out.txt'), false],
    ['a file of the project: a note', join(project, 'notes.md'), true],
    ['a file of the project: an HTML deliverable', join(project, 'plan.html'), true],
    ['a file of the project: a JSON deliverable', join(project, 'data.json'), true],
    ['a file of the project: an image', join(project, 'photo.png'), true],
    ['a file in a folder of the project', join(project, 'src', 'ok.md'), true],
    // The name rule, whatever the root: these ARE inside the registered project and carry a deliverable extension.
    ['.credentials.yaml inside the project', join(project, '.credentials.yaml'), false],
    ['.env.json inside the project', join(project, '.env.json'), false],
    ['.envrc.md inside the project', join(project, '.envrc.md'), false],
    ['a note inside a .ssh folder of the project', join(project, '.ssh', 'notes.md'), false],
    // The extension rule: inside the project, but not a deliverable.
    ['source code inside the project', join(project, 'config.ts'), false],
    ['a shell script inside the project', join(project, 'run.sh'), false],
    ['a file with no extension inside the project', join(project, 'noext'), false],
  ]
  for (const [label, path, allowed] of READS) {
    if (path.endsWith('link-out.txt') && !statSync(join(project, 'link-out.txt'), { throwIfNoEntry: false })) continue
    await row('art-read, art-raw and art-previews agree on ' + label + ': ' + (allowed ? 'read' : 'refused'), async () => {
      const read = await readOf(path)
      assert.equal(read.json.ok === true, allowed, 'art-read: ' + label + ' -> ' + JSON.stringify(read.json).slice(0, 120))
      if (allowed === false) assert.ok(JSON.stringify(read.json).indexOf('LOOKALIKE') < 0 && JSON.stringify(read.json).indexOf('SECRET-OUTSIDE') < 0, 'art-read: ' + label + ' leaked its content')
      const raw = await rawOf(path)
      assert.equal(raw.status === 200, allowed, 'art-raw: ' + label + ' -> ' + raw.status)
      if (allowed === false) assert.ok(raw.body.length === 0, 'art-raw: ' + label + ' sent bytes')
      const previews = await previewOf(path)
      assert.equal(previews.ok, true, 'art-previews answers')
      assert.equal(previews.previews[path] !== undefined, allowed, 'art-previews: ' + label + ' -> ' + JSON.stringify(previews).slice(0, 160))
    })
  }

  assert.equal(failures.length, 0, failures.length + ' row(s) failed')
  console.log('\nPLUGIN FILE SERVING — ' + pass + ' check(s), 0 échec')
} catch (e) {
  console.error('  ✗ ' + String(e && e.message ? e.message : e))
  process.exitCode = 1
} finally {
  server.close()
  // The bundle boots timers and watchers of its own (the host keeps them alive): this test ends when its checks do.
  process.exit(process.exitCode === undefined ? 0 : process.exitCode)
}
