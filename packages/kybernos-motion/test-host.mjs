// Host half tests: apply(), the tool and every route over real HTTP. `cd packages/kybernos-motion && node test-host.mjs`
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync, existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let fail = 0
let n = 0
const ok = (name, cond, detail) => {
  n++
  if (cond) return
  fail++
  console.log(`FAIL ${name}${detail === undefined ? '' : ' :: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))}`)
}

const base = realpathSync(mkdtempSync(join(tmpdir(), 'motion-idx-')))
const project = join(base, 'project')
const project2 = join(base, 'project-2') // another workspace
const elsewhere = join(base, 'elsewhere')
mkdirSync(project, { recursive: true })
mkdirSync(project2, { recursive: true })
mkdirSync(elsewhere, { recursive: true })
process.env.DSH_HOME = join(base, 'dsh') // read once at import
// Like the core: every registered workspace is readable by every session (s1 and s4 work in `project`, s3 in `project2`).
globalThis[Symbol.for('kybernos.workspace')] = {
  sessionCwd: async (id) => (id === 's1' || id === 's4' ? project : id === 's3' ? project2 : null),
  pathAllowed: async (real) => [project, project2].some((p) => real === p || real.startsWith(p + '/')),
}
const M = await import('./index.js')

// ── apply() ─────────────────────────────────────────────────────────────────
{
  let threw = null
  try { M.apply({ get: () => undefined, inject: () => {} }) } catch (e) { threw = e }
  ok('apply: without services it waits (no throw)', threw === null)
  let injected = null
  M.apply({ get: () => undefined, inject: (deps) => { injected = deps } })
  ok('apply: asks DSH for tools and webServer', Array.isArray(injected) && injected.includes('tools') && injected.includes('webServer'), injected)
  threw = null
  try { M.apply({ get: () => { throw new Error('boom') }, inject: () => {} }) } catch (e) { threw = e }
  ok('apply: a failing service never stops DSH starting', threw === null)
}

// wire the real thing to a local http server through a dispatcher
const routes = new Map()
let tool = null
M.apply({
  get: (k) => (k === 'tools' ? { register: (t) => { tool = t } } : k === 'webServer' ? { register: (r) => routes.set(r.path, r.handler) } : undefined),
  inject: () => {},
})
await new Promise((r) => setTimeout(r, 50)) // the tool registers asynchronously (it looks for defineTool)
ok('apply: the tool is registered', tool !== null && tool.name === 'creer_motion')
ok('apply: every route is mounted', ['state', 'scene', 'save', 'open', 'list', 'revisions', 'restore', 'asset', 'frame', 'export', 'vendor/three.js', 'vendor/lottie.js'].every((r) => routes.has('/kybernos-motion/' + r)), [...routes.keys()])
ok('apply: the tool can be executed through its definition', typeof tool.execute === 'function')

const server = http.createServer((req, res) => {
  const h = routes.get(new URL(req.url, 'http://x').pathname)
  if (!h) { res.writeHead(404); res.end(); return }
  h(req, res)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port
const call = async (method, path, { body, headers, raw } = {}) => {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { ...(raw ? {} : body ? { 'content-type': 'application/json' } : {}), ...headers }, body: raw ? raw : body ? JSON.stringify(body) : undefined })
  const ct = r.headers.get('content-type') || ''
  return { status: r.status, json: ct.includes('json') ? await r.json() : null, buf: ct.includes('json') ? null : Buffer.from(await r.arrayBuffer()), type: ct }
}
const SCENE = { format: { duration: 4 }, params: { titre: 'Bonjour' }, layers: [{ type: 'text', name: 'T', text: '{titre}', size: 120 }] }
const exec = { agent: { id: 's1' } }

// ── a scene through the tool, then through the routes ───────────────────────
const made = await tool.execute({ titre: 'Intro', scene: SCENE }, exec)
ok('tool: creates the scene in the session folder', made.ok && made.chemin === join(project, 'artifacts', 'intro.miniapp.json'), made)
{
  const s = await call('GET', '/kybernos-motion/state?session=s1')
  ok('state: the panel learns which scene to show', s.status === 200 && s.json.current.path === made.chemin && s.json.current.title === 'Intro' && s.json.frame === null, s.json)
  const sc = await call('GET', '/kybernos-motion/scene?session=s1&path=' + encodeURIComponent(made.chemin))
  ok('scene: returns the clean scene without runtime markers', sc.status === 200 && sc.json.scene.layers[0].type === 'text' && !('_n' in sc.json.scene) && sc.json.rev === 1, sc.json)
  const out = await call('GET', '/kybernos-motion/scene?session=s1&path=' + encodeURIComponent(join(elsewhere, 'x.miniapp.json')))
  ok('scene: a path outside the session is 403', out.status === 403)
  const missing = await call('GET', '/kybernos-motion/scene?session=s1&path=' + encodeURIComponent(join(project, 'artifacts', 'nope.miniapp.json')))
  ok('scene: a missing file is 404', missing.status === 404)
  const sv = await call('POST', '/kybernos-motion/save', { body: { session: 's1', path: made.chemin, scene: { ...sc.json.scene, params: { titre: 'Salut' } }, what: 'Titre: Salut' } })
  ok('save: the user edit is written as a new revision', sv.status === 200 && sv.json.rev === 2, sv.json)
  const seen = await tool.execute({}, exec)
  ok('save: the agent sees it on its next read', seen.changes_by_user.length === 1 && seen.scene.params.titre === 'Salut', seen)
  ok('save: a body without a scene is 400', (await call('POST', '/kybernos-motion/save', { body: { session: 's1', path: made.chemin } })).status === 400)
  ok('save: a path outside is 403', (await call('POST', '/kybernos-motion/save', { body: { session: 's1', path: join(elsewhere, 'x.miniapp.json'), scene: SCENE } })).status === 403)
  ok('save: a scene whose layers are all invalid is 400', (await call('POST', '/kybernos-motion/save', { body: { session: 's1', path: made.chemin, scene: { layers: [{ type: 'bogus' }] } } })).status === 400)
  const ls = await call('GET', '/kybernos-motion/list?session=s1')
  ok('list: the panel can offer the session\'s animations', ls.status === 200 && ls.json.scenes.some((x) => x.path === made.chemin), ls.json)
  const rv = await call('GET', '/kybernos-motion/revisions?session=s1&path=' + encodeURIComponent(made.chemin))
  ok('revisions: lists them newest first', rv.json.revisions.length === 2 && rv.json.revisions[0].r === 2 && rv.json.revisions[0].by === 'user', rv.json)
  const rs = await call('POST', '/kybernos-motion/restore', { body: { session: 's1', path: made.chemin, rev: 1 } })
  ok('restore: brings revision 1 back as revision 3', rs.status === 200 && rs.json.rev === 3, rs.json)
  ok('restore: an unknown revision is 404', (await call('POST', '/kybernos-motion/restore', { body: { session: 's1', path: made.chemin, rev: 99 } })).status === 404)
  const op = await call('POST', '/kybernos-motion/open', { body: { session: 's2', path: made.chemin } })
  ok('open: Creations can point the panel at a scene', op.status === 200 && (await call('GET', '/kybernos-motion/state?session=s2')).json.current.path === made.chemin)
  ok('open: a non-scene file is refused', (await call('POST', '/kybernos-motion/open', { body: { session: 's1', path: join(project, 'x.txt') } })).status === 403)
}

// ── A4-11: a chat shows its own scene, or none ──────────────────────────────
{
  const mine = await call('GET', '/kybernos-motion/state?session=s1')
  ok('state: the session that made a scene still sees it', mine.json.current !== null && mine.json.current.path === made.chemin, mine.json)
  const other = await call('GET', '/kybernos-motion/state?session=s-new-chat')
  ok('state: a new chat does not borrow the scene another chat is working on (it used to show it)', other.status === 200 && other.json.current === null, other.json)
  // The Creations page points the panel at a scene with no session: that one IS shown to a chat that may read it.
  const pointed = await call('POST', '/kybernos-motion/open', { body: { path: made.chemin } })
  const seen = await call('GET', '/kybernos-motion/state?session=s4')
  ok('state: a scene pointed at from Creations (no session) is shown to a new chat of the same workspace', pointed.status === 200 && seen.json.current !== null && seen.json.current.path === made.chemin, seen.json)
  // R3-01 (A4-11): the core lets every session read every registered workspace, but a new chat of ANOTHER workspace must not open its
  // Motion tab on a scene that belongs to a project it has nothing to do with.
  const foreign = await call('GET', '/kybernos-motion/state?session=s3')
  ok('state: a new chat of another workspace does not show the scene Creations pointed at', foreign.status === 200 && foreign.json.current === null, foreign.json)
  const nowhere = await call('GET', '/kybernos-motion/state?session=s-new-chat')
  ok('state: a chat whose folder cannot be found does not show it either', nowhere.status === 200 && nowhere.json.current === null, nowhere.json)
  const noSession = await call('GET', '/kybernos-motion/state')
  ok('state: a request that names no session does not show it', noSession.status === 200 && noSession.json.current === null, noSession.json)
  // ...but that other workspace's chat sees its OWN scene
  const made2 = await tool.execute({ titre: 'Other', scene: SCENE }, { agent: { id: 's3' } })
  ok('the other workspace writes its own scene', made2.ok === true && made2.chemin.startsWith(project2), made2)
  ok('state: ...which that chat does see', (await call('GET', '/kybernos-motion/state?session=s3')).json.current.path === made2.chemin)
  ok('state: ...and the first workspace\'s chats do not', (await call('GET', '/kybernos-motion/state?session=s4')).json.current.path === made.chemin)
  // The file itself is gone but its folder is not (a deleted artifact): the chat gets the empty state, once and for all.
  const doomed = await tool.execute({ titre: 'Doomed', scene: SCENE }, exec)
  await call('POST', '/kybernos-motion/open', { body: { path: doomed.chemin } })
  ok('state: the scene pointed at is shown while its file exists', (await call('GET', '/kybernos-motion/state?session=s4')).json.current.path === doomed.chemin)
  await rm(doomed.chemin, { force: true })
  const vanished = await call('GET', '/kybernos-motion/state?session=s4')
  ok('state: a pointed scene whose file is gone gives the empty state (the panel used to show a red error and ask for it on every poll)', vanished.status === 200 && vanished.json.current === null, vanished.json)
  ok('state: ...and a second poll too', (await call('GET', '/kybernos-motion/state?session=s4')).json.current === null)
  const doomedOwn = await tool.execute({ titre: 'Doomed too', scene: SCENE }, exec)
  await rm(doomedOwn.chemin, { force: true })
  ok('state: a session\'s own scene whose file is gone gives the empty state as well', (await call('GET', '/kybernos-motion/state?session=s1')).json.current === null)
  // ...and when its folder is gone, or it is another workspace's, the chat gets the empty state, not a path to a refused read.
  const gone = await tool.execute({ titre: 'Gone', fichier: join(project, 'tmp-gone', 'gone'), scene: SCENE }, exec)
  ok('the scene to forget is written', gone.ok === true, gone)
  await call('POST', '/kybernos-motion/open', { body: { path: gone.chemin } })
  await rm(join(project, 'tmp-gone'), { recursive: true, force: true })
  const lost = await call('GET', '/kybernos-motion/state?session=s-new-chat')
  ok('state: a remembered scene whose folder is gone is dropped (no 403 on every poll)', lost.status === 200 && lost.json.current === null, lost.json)
  // back to the scene the next sections work on
  await call('POST', '/kybernos-motion/open', { body: { session: 's1', path: made.chemin } })
}

// ── the origin guard ────────────────────────────────────────────────────────
{
  const evil = await call('GET', '/kybernos-motion/state?session=s1', { headers: { origin: 'http://evil.example' } })
  ok('guard: a foreign origin is refused', evil.status === 403)
  const sneaky = await call('GET', '/kybernos-motion/state?session=s1', { headers: { origin: `http://localhost.evil.example:${port}` } })
  ok('guard: a look-alike host is refused (exact match, not a prefix)', sneaky.status === 403)
  const own = await call('GET', '/kybernos-motion/state?session=s1', { headers: { origin: `http://localhost:${port}` } })
  ok('guard: the page\'s own origin passes', own.status === 200)
  const post = await call('POST', '/kybernos-motion/save', { body: { session: 's1', path: made.chemin, scene: SCENE }, headers: { origin: 'https://evil.example' } })
  ok('guard: a foreign POST is refused too', post.status === 403)
  ok('guard: wrong method is 405', (await call('POST', '/kybernos-motion/state')).status === 405 && (await call('GET', '/kybernos-motion/save')).status === 405)
}

// ── assets ──────────────────────────────────────────────────────────────────
{
  mkdirSync(join(project, 'artifacts', 'img'), { recursive: true })
  writeFileSync(join(project, 'artifacts', 'img', 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]))
  writeFileSync(join(elsewhere, 'secret.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  const a = await call('GET', `/kybernos-motion/asset?session=s1&scene=${encodeURIComponent(made.chemin)}&src=${encodeURIComponent('img/logo.png')}`)
  ok('asset: an image is served with its type and bytes', a.status === 200 && a.type === 'image/png' && a.buf.length === 8 && a.buf[1] === 0x50, a)
  const esc = await call('GET', `/kybernos-motion/asset?session=s1&scene=${encodeURIComponent(made.chemin)}&src=${encodeURIComponent('../../../elsewhere/secret.png')}`)
  ok('asset: an escape attempt is 404', esc.status === 404)
}

// ── the agent looks at a frame ──────────────────────────────────────────────
{
  const viewing = tool.execute({ voir: 1.5 }, exec)
  let w = null
  for (let i = 0; i < 200 && (w === null || w.frame === null); i++) { w = (await call('GET', '/kybernos-motion/state?session=s1')).json; if (w.frame === null) await new Promise((r) => setTimeout(r, 10)) }
  ok('frame: the panel sees a request through state', w.frame && w.frame.t === 1.5, w)
  const bad = await call('POST', `/kybernos-motion/frame?session=s1&id=${w.frame.id}`, { raw: Buffer.from('not a png at all'), headers: { 'content-type': 'application/octet-stream' } })
  ok('frame: a non-PNG is 409', bad.status === 409)
  const good = await call('POST', `/kybernos-motion/frame?session=s1&id=${w.frame.id}`, { raw: Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9, 9, 9]), headers: { 'content-type': 'application/octet-stream' } })
  ok('frame: the PNG is accepted', good.status === 200)
  const r = await viewing
  ok('frame: the agent gets a readable path', r.voir && existsSync(r.voir.path) && readFileSync(r.voir.path)[1] === 0x50, r.voir)
}

// ── export ──────────────────────────────────────────────────────────────────
{
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(64, 7)])
  const e1 = await call('POST', `/kybernos-motion/export?session=s1&format=mp4&path=${encodeURIComponent(made.chemin)}`, { raw: mp4, headers: { 'content-type': 'video/mp4' } })
  ok('export: the video lands next to the scene', e1.status === 200 && e1.json.path === join(project, 'artifacts', 'intro.mp4') && readFileSync(e1.json.path).length === mp4.length, e1.json)
  const e2 = await call('POST', `/kybernos-motion/export?session=s1&format=mp4&path=${encodeURIComponent(made.chemin)}`, { raw: mp4, headers: { 'content-type': 'video/mp4' } })
  ok('export: a second export never overwrites the first', e2.status === 200 && e2.json.name === 'intro-2.mp4', e2.json)
  ok('export: webm is accepted', (await call('POST', `/kybernos-motion/export?session=s1&format=webm&path=${encodeURIComponent(made.chemin)}`, { raw: mp4 })).json.name === 'intro.webm')
  ok('export: another format is 400', (await call('POST', `/kybernos-motion/export?session=s1&format=exe&path=${encodeURIComponent(made.chemin)}`, { raw: mp4 })).status === 400)
  ok('export: an empty upload is 400 and leaves nothing', (await call('POST', `/kybernos-motion/export?session=s1&format=mp4&path=${encodeURIComponent(made.chemin)}`, { raw: Buffer.alloc(0) })).status === 400)
  ok('export: a path outside is 403', (await call('POST', `/kybernos-motion/export?session=s1&format=mp4&path=${encodeURIComponent(join(elsewhere, 'a.miniapp.json'))}`, { raw: mp4 })).status === 403)
  const { readdirSync } = await import('node:fs')
  ok('export: no temp file is left behind', readdirSync(join(project, 'artifacts')).every((f) => !f.endsWith('.tmp')))
}

// ── the big libraries, served on demand ─────────────────────────────────────
{
  const t = await call('GET', '/kybernos-motion/vendor/three.js')
  ok('vendor: three.js is served as JavaScript with a validator', t.status === 200 && t.type.includes('javascript') && t.buf.length > 100000, [t.status, t.type, t.buf && t.buf.length])
  const etag = (await fetch(`http://127.0.0.1:${port}/kybernos-motion/vendor/three.js`)).headers.get('etag')
  const again = await fetch(`http://127.0.0.1:${port}/kybernos-motion/vendor/three.js`, { headers: { 'if-none-match': etag } })
  ok('vendor: a second visit gets 304, not 600 KB again', typeof etag === 'string' && again.status === 304)
  const l = await call('GET', '/kybernos-motion/vendor/lottie.js')
  ok('vendor: lottie is served too', l.status === 200 && l.buf.length > 50000)
  ok('vendor: no way to ask for another file (the names are fixed)', (await call('GET', '/kybernos-motion/vendor/../index.js')).status === 404 && (await call('GET', '/kybernos-motion/vendor/other.js')).status === 404)
  ok('vendor: the Lottie build has no expression engine (no eval, no new Function): a scene file may not carry code', !/new Function|eval\(/.test(l.buf.toString('utf8')))
  ok('vendor: THREE is exposed as a global the client can find', t.buf.toString('utf8').includes('GLTFLoader') && t.buf.toString('utf8').includes('SkeletonUtils'))
  ok('vendor: a foreign origin is still refused', (await call('GET', '/kybernos-motion/vendor/three.js', { headers: { origin: 'https://evil.example' } })).status === 403)
}

// ── a model next to a scene ──
{
  mkdirSync(join(project, 'artifacts', 'media'), { recursive: true })
  const { glbWithClips } = await import('./lib-fixtures.mjs')
  writeFileSync(join(project, 'artifacts', 'media', 'hero.glb'), glbWithClips(['Run']))
  const m = await call('GET', `/kybernos-motion/asset?session=s1&scene=${encodeURIComponent(made.chemin)}&src=${encodeURIComponent('media/hero.glb')}`)
  ok('asset: a .glb is served with the glTF type', m.status === 200 && m.type === 'model/gltf-binary' && m.buf[0] === 0x67, [m.status, m.type])
}

server.close()
await rm(base, { recursive: true, force: true })
console.log(`${n - fail}/${n} checks passed`)
process.exit(fail ? 1 : 0)
