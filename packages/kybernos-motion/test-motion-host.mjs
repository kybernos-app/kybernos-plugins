// Host logic tests against a real temp folder. `cd packages/kybernos-motion && node test-motion-host.mjs`
import * as fsp from 'node:fs/promises'
import { existsSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as engine from './engine.mjs'
import * as H from './motion-host.mjs'
import { glbWithClips, makeGlb, makeLottie } from './lib-fixtures.mjs'

let fail = 0
let n = 0
const ok = (name, cond, detail) => {
  n++
  if (cond) return
  fail++
  console.log(`FAIL ${name}${detail === undefined ? '' : ' :: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))}`)
}

const base = realpathSync(mkdtempSync(join(tmpdir(), 'motion-host-')))
const home = join(base, 'dsh')
const project = join(base, 'project')
const elsewhere = join(base, 'elsewhere')
for (const d of [home, project, elsewhere]) mkdirSync(d, { recursive: true })
const workspace = {
  sessionCwd: async (id) => (id === 's1' ? project : null),
  pathAllowed: async (real) => real === project || real.startsWith(project + '/'),
}
const mk = (over) => H.createHost({ fs: fsp, home, workspace, ...over })
const host = mk({ frameTimeoutMs: 80 })
const engine_validate = (raw) => engine.validate(raw).scene
const SCENE = { format: { duration: 4 }, params: { titre: 'Bonjour' }, layers: [{ type: 'text', name: 'T', text: '{titre}', x: 960, y: 540, size: 120 }] }

ok('slug: accents, spaces, junk', H.slug('Intro Lancement été!') === 'intro-lancement-ete' && H.slug('???') === 'animation' && H.slug('a'.repeat(200)).length === 60)

// ── doc helpers ─────────────────────────────────────────────────────────────
{
  const doc = H.makeDoc({ _n: true, v: 1, layers: [] }, { title: '  Mon titre ' })
  ok('makeDoc: kind, renderer, trimmed title, no runtime marker', doc.kind === 'motion' && doc.renderer === 'motion' && doc.title === 'Mon titre' && !('_n' in doc.data[0]))
  ok('sceneOfDoc: data[0], or its payload', H.sceneOfDoc({ data: [{ a: 1 }] }).a === 1 && H.sceneOfDoc({ data: [{ payload: { b: 2 } }] }).b === 2 && H.sceneOfDoc({}) === null && H.sceneOfDoc(null) === null)
}

// ── resolveTarget ───────────────────────────────────────────────────────────
{
  const a = await host.resolveTarget({ sessionId: 's1', fichier: 'intro', titre: 'x' })
  ok('resolveTarget: a bare name lands in <project>/artifacts with the extension', a.ok && a.path === join(project, 'artifacts', 'intro.miniapp.json'), a)
  ok('resolveTarget: the folder was created', existsSync(join(project, 'artifacts')))
  const b = await host.resolveTarget({ sessionId: 's1', fichier: 'sub/x.json', titre: 'x' })
  ok('resolveTarget: .json becomes .miniapp.json, subfolders allowed', b.ok && b.path === join(project, 'artifacts', 'sub', 'x.miniapp.json'), b)
  const c = await host.resolveTarget({ sessionId: 's1', fichier: null, titre: 'Mon super titre' })
  ok('resolveTarget: no name derives one from the title', c.ok && c.path.endsWith('mon-super-titre.miniapp.json'), c)
  ok('resolveTarget: ".." is refused', (await host.resolveTarget({ sessionId: 's1', fichier: '../evil', titre: 'x' })).ok === false)
  ok('resolveTarget: an absolute path outside the session is refused', (await host.resolveTarget({ sessionId: 's1', fichier: join(elsewhere, 'x'), titre: 'x' })).ok === false)
  const inside = await host.resolveTarget({ sessionId: 's1', fichier: join(project, 'docs', 'x'), titre: 'x' })
  ok('resolveTarget: an absolute path inside the session is accepted', inside.ok && inside.path === join(project, 'docs', 'x.miniapp.json'), inside)
  const fb = await host.resolveTarget({ sessionId: 'unknown', fichier: 'f', titre: 'x' })
  ok('resolveTarget: an unknown session falls back to the DSH home store', fb.ok && fb.path === join(home, 'kybernos', 'motion', 'files', 'f.miniapp.json'), fb)
  const bare = mk({ workspace: null })
  const nb = await bare.resolveTarget({ sessionId: 's1', fichier: 'g', titre: 'x' })
  ok('resolveTarget: without the core seam it still works in the fallback store', nb.ok && nb.path.startsWith(join(home, 'kybernos', 'motion', 'files')), nb)
  const nb2 = await bare.resolveTarget({ sessionId: 's1', fichier: join(project, 'z'), titre: 'x' })
  ok('resolveTarget: without the core seam nothing outside the fallback store is allowed', nb2.ok === false)
  ok('resolveTarget: the bare extension is not a name', (await host.resolveTarget({ sessionId: 's1', fichier: '.miniapp.json', titre: 'x' })).ok === false)
}

// ── save, read, history ─────────────────────────────────────────────────────
const p1 = join(project, 'artifacts', 'a.miniapp.json')
{
  const s1 = await host.saveScene({ path: p1, rawScene: SCENE, by: 'agent', what: 'Created', title: 'Titre A' })
  ok('save: ok, rev 1', s1.ok && s1.rev === 1, s1)
  const doc = JSON.parse(readFileSync(p1, 'utf8'))
  ok('save: file is a motion doc with the clean scene', doc.kind === 'motion' && doc.title === 'Titre A' && doc.data[0].layers[0].type === 'text' && !('_n' in doc.data[0]) && doc.meta.rev === 1)
  ok('save: no temp file is left behind', (await fsp.readdir(join(project, 'artifacts'))).every((f) => !f.endsWith('.tmp')))
  const s2 = await host.saveScene({ path: p1, rawScene: { ...SCENE, params: { titre: 'Salut' } }, by: 'user', what: 'Titre: Salut' })
  ok('save: rev increments, title kept, history records who', s2.rev === 2 && s2.title === 'Titre A')
  const r = await host.readDoc(p1)
  ok('read: returns the validated scene and the doc', r.ok && r.scene._n === true && r.doc.meta.history.map((h) => h.by).join() === 'agent,user' && r.scene.params.titre === 'Salut')
  ok('userEditsSince: the user edit after the agent write is listed', host.userEditsSince(r.doc).length === 1 && host.userEditsSince(r.doc)[0].what === 'Titre: Salut')
  await host.saveScene({ path: p1, rawScene: r.scene, by: 'agent', what: 'Read and kept' })
  ok('userEditsSince: an agent write clears them', host.userEditsSince((await host.readDoc(p1)).doc).length === 0)
  const bad = await host.saveScene({ path: p1, rawScene: { layers: [{ type: 'evil' }, { type: 'nope' }] }, by: 'agent', what: 'x' })
  ok('save: a scene whose layers are all invalid is refused, the file is untouched', bad.ok === false && (await host.readDoc(p1)).doc.meta.rev === 3)
  const clean = await host.saveScene({ path: p1, rawScene: { layers: [{ type: 'rect', hax: 1 }] }, by: 'agent', what: 'x' })
  ok('save: a scene that only lost properties is written and the problems come back', clean.ok && clean.errors.some((e) => e.includes('hax')))
  for (let i = 0; i < 40; i++) await host.saveScene({ path: p1, rawScene: SCENE, by: 'agent', what: 'loop ' + i })
  const many = (await host.readDoc(p1)).doc
  ok('save: the history inside the file is capped', many.meta.history.length === H.LIMITS.history && many.meta.rev === 44, [many.meta.history.length, many.meta.rev])
  const revs = await host.revisions(p1)
  ok('revisions: only the last 20 snapshots are kept, newest first', revs.length === H.LIMITS.revisions && revs[0].r === 44 && revs[19].r === 25, revs.map((r) => r.r))
}
{
  const rr = await host.restore(p1, 30)
  ok('restore: an old revision comes back as a new one', rr.ok && rr.rev === 45, rr)
  ok('restore: an expired revision is refused', (await host.restore(p1, 1)).ok === false)
}
{
  const bad = join(project, 'artifacts', 'bad.miniapp.json')
  writeFileSync(bad, '{not json')
  ok('read: invalid JSON is a message, not a throw', (await host.readDoc(bad)).ok === false)
  writeFileSync(bad, JSON.stringify({ kind: 'quiz', data: [] }))
  ok('read: another kind is refused', (await host.readDoc(bad)).message.includes('kind must be "motion"'))
  writeFileSync(bad, JSON.stringify({ kind: 'motion' }))
  ok('read: no scene is refused', (await host.readDoc(bad)).ok === false)
  ok('read: a missing file is a message', (await host.readDoc(join(project, 'nope.miniapp.json'))).ok === false)
}
{
  ok('confineExisting: inside is fine', (await host.confineExisting(p1, 's1')).ok === true)
  ok('confineExisting: outside is refused', (await host.confineExisting(join(elsewhere, 'a.miniapp.json'), 's1')).ok === false)
  ok('confineExisting: wrong extension is refused', (await host.confineExisting(join(project, 'a.txt'), 's1')).ok === false)
  ok('confineExisting: relative path is refused', (await host.confineExisting('a.miniapp.json', 's1')).ok === false)
}

// ── assets ──────────────────────────────────────────────────────────────────
{
  mkdirSync(join(project, 'artifacts', 'img'), { recursive: true })
  writeFileSync(join(project, 'artifacts', 'img', 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]))
  writeFileSync(join(elsewhere, 'secret.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  writeFileSync(join(project, 'artifacts', 'notes.txt'), 'x')
  symlinkSync(join(elsewhere, 'secret.png'), join(project, 'artifacts', 'img', 'link.png'))
  const a = await host.resolveAsset(p1, 'img/logo.png', 's1')
  ok('asset: an image next to the scene is served with its type', a.ok && a.type === 'image/png' && a.size === 8, a)
  ok('asset: ".." out of the project is refused', (await host.resolveAsset(p1, '../../../elsewhere/secret.png', 's1')).ok === false)
  ok('asset: a symlink pointing outside is refused', (await host.resolveAsset(p1, 'img/link.png', 's1')).ok === false)
  ok('asset: only media types are served', (await host.resolveAsset(p1, 'notes.txt', 's1')).ok === false)
  ok('asset: a missing file is refused', (await host.resolveAsset(p1, 'img/none.png', 's1')).ok === false)
  ok('asset: an absolute path outside is refused', (await host.resolveAsset(p1, join(elsewhere, 'secret.png'), 's1')).ok === false)
  ok('asset: a scene outside the project cannot be used as an anchor', (await host.resolveAsset(join(elsewhere, 'a.miniapp.json'), 'secret.png', 's1')).ok === false)
}

// ── models and Lottie files ─────────────────────────────────────────────────
{
  mkdirSync(join(project, 'artifacts', 'media'), { recursive: true })
  writeFileSync(join(project, 'artifacts', 'media', 'hero.glb'), glbWithClips(['Walk', 'Run']))
  writeFileSync(join(project, 'artifacts', 'media', 'hero.json'), JSON.stringify(makeLottie(3)))
  writeFileSync(join(project, 'artifacts', 'media', 'data.json'), JSON.stringify({ some: 'project data', secret: 'x' }))
  writeFileSync(join(project, 'artifacts', 'media', 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  const g = await host.resolveAsset(p1, 'media/hero.glb', 's1')
  ok('asset: a .glb is served as a glTF binary', g.ok && g.type === 'model/gltf-binary', g)
  const l = await host.resolveAsset(p1, 'media/hero.json', 's1')
  ok('asset: a Lottie .json is served as JSON', l.ok && l.type === 'application/json', l)
  const d = await host.resolveAsset(p1, 'media/data.json', 's1')
  ok('asset: any other .json of the project is NOT served (this is not a file server)', d.ok === false && d.message.includes('not a Lottie'), d)
  const scene3 = { format: { duration: 4 }, layers: [
    { type: 'scene3d', name: 'Hero', objects: [{ shape: 'model', src: 'media/hero.glb', clip: 'Run' }, { shape: 'model', src: 'media/hero.glb', clip: 'Fly' }, { shape: 'model', src: 'media/missing.glb' }] },
    { type: 'lottie', name: 'L', src: 'media/hero.json' }, { type: 'image', name: 'I', src: 'media/logo.png' }, { type: 'lottie', name: 'Bad', src: 'media/data.json' },
  ] }
  const sc = engine_validate(scene3)
  const rep = await host.inspectAssets(p1, sc, 's1')
  const byKind = (k) => rep.list.filter((x) => x.kind === k)
  ok('assets: a model lists its clips', byKind('model').find((x) => x.src === 'media/hero.glb').animations.map((a) => a.name).join() === 'Walk,Run', rep.list)
  ok('assets: a Lottie gives its length, rate and size', JSON.stringify(byKind('lottie')[0].size) === '[200,200]' && byKind('lottie')[0].seconds === 3 && byKind('lottie')[0].fps === 30, byKind('lottie')[0])
  ok('assets: an image is found with its size in bytes', byKind('image')[0].found === true && byKind('image')[0].bytes === 4)
  ok('assets: a missing model is reported as a problem', rep.problems.some((x) => x.includes('media/missing.glb')), rep.problems)
  ok('assets: a clip the model does not have is reported with the ones it has', rep.problems.some((x) => x.includes('clip "Fly"') && x.includes('Walk, Run')), rep.problems)
  ok('assets: a .json that is not a Lottie is reported', rep.problems.some((x) => x.includes('media/data.json')))
  ok('assets: a good clip is not reported', !rep.problems.some((x) => x.includes('clip "Run"')))
  writeFileSync(join(project, 'artifacts', 'media', 'wild.glb'), makeGlb({ asset: { version: '2.0' }, images: [{ uri: 'https://tracker.example/t.png' }], animations: [] }))
  writeFileSync(join(project, 'artifacts', 'media', 'wild.json'), JSON.stringify({ ...makeLottie(1), assets: [{ id: 'i', p: 'img_0.png', u: 'images/' }] }))
  const wild = await host.inspectAssets(p1, engine_validate({ layers: [{ type: 'scene3d', objects: [{ shape: 'model', src: 'media/wild.glb' }] }, { type: 'lottie', src: 'media/wild.json' }] }), 's1')
  ok('assets: a model and a Lottie that point outside themselves are reported (they will not be loaded)', wild.problems.some((x) => x.includes('wild.glb') && x.includes('outside itself')) && wild.problems.some((x) => x.includes('wild.json') && x.includes('outside the file')), wild.problems)
  const tool2 = H.toolOptions(host)
  const made = await tool2.execute({ titre: 'Media', scene: scene3 }, { agent: { id: 's1' } })
  ok('tool: the answer carries the asset report and its problems', made.ok && Array.isArray(made.assets) && made.assets.length === 5 && made.assets_problems.length >= 3, made)
  const plain = await tool2.execute({ titre: 'Plain', scene: SCENE }, { agent: { id: 's1' } })
  ok('tool: a scene with no files has no asset section', plain.ok && plain.assets === undefined && plain.assets_problems === undefined)
  const back = await tool2.execute({ fichier: made.chemin }, { agent: { id: 's1' } })
  ok('tool: reading hands the scene back in its COMPACT form (what is on disk), not the verbose normalised one', back.ok && JSON.stringify(back.scene).length < 1400 && back.scene.layers[0].objects[0].src === 'media/hero.glb' && !('rx' in back.scene.layers[0].objects[0]), JSON.stringify(back.scene).length)
  ok('tool: the description tells the agent about files and clips', tool2.description.includes('animation clip names') && tool2.description.includes('- scene3d:') && tool2.description.includes('- lottie:'))
}

// ── listing ─────────────────────────────────────────────────────────────────
{
  mkdirSync(join(project, 'artifacts', 'deep', 'er', 'est'), { recursive: true })
  writeFileSync(join(project, 'artifacts', 'quiz.miniapp.json'), JSON.stringify({ kind: 'quiz', title: 'Not motion', data: [] }))
  writeFileSync(join(project, 'artifacts', 'junk.miniapp.json'), '{nope')
  writeFileSync(join(project, 'artifacts', 'other.txt'), 'x')
  const deepOk = join(project, 'artifacts', 'deep', 'in.miniapp.json')
  await host.saveScene({ path: deepOk, rawScene: SCENE, by: 'agent', what: 'x', title: 'Deep one' })
  writeFileSync(join(project, 'artifacts', 'deep', 'er', 'est', 'too-deep.miniapp.json'), JSON.stringify({ kind: 'motion', title: 'Too deep', data: [SCENE] }))
  const l = await host.listScenes('s1')
  ok('list: motion scenes only, with title and rev, newest first', l.length >= 2 && l.every((s) => typeof s.title === 'string' && typeof s.rev === 'number') && l.some((s) => s.title === 'Titre A') && l.some((s) => s.title === 'Deep one'), l.map((s) => s.title))
  ok('list: other kinds, junk and anything beyond two levels are skipped', !l.some((s) => s.title === 'Not motion' || s.title === 'Too deep') && l.every((s) => s.path.endsWith('.miniapp.json')))
  ok('list: sorted by modification time', l.every((s, i) => i === 0 || l[i - 1].mtimeMs >= s.mtimeMs))
  ok('list: an unknown session still lists the fallback store without throwing', Array.isArray(await host.listScenes('nobody')))
}

// ── frames for the agent ────────────────────────────────────────────────────
{
  const pending = host.wantFrame('s1', 2)
  const w = host.pendingFrame('s1')
  ok('frame: the panel sees what is wanted', w !== null && w.t === 2 && typeof w.id === 'string')
  ok('frame: a wrong id is refused', (await host.deliverFrame('s1', 'nope', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]))).ok === false)
  ok('frame: a non-PNG is refused', (await host.deliverFrame('s1', w.id, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).ok === false)
  ok('frame: delivery resolves the waiting agent with a file path', (await host.deliverFrame('s1', w.id, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]))).ok === true)
  const got = await pending
  ok('frame: the agent gets the PNG path', got.ok && existsSync(got.path) && got.path.startsWith(join(home, 'kybernos', 'motion', 'preview')), got)
  ok('frame: nothing is pending afterwards', host.pendingFrame('s1') === null)
  const none = await host.wantFrame('s1', 1)
  ok('frame: if the panel never answers the agent is told to open it', none.ok === false && none.message.includes('Open it'))
  const tooBig = host.wantFrame('s1', 1, 1000)
  ok('frame: an oversize image is refused', (await host.deliverFrame('s1', host.pendingFrame('s1').id, new Uint8Array(H.LIMITS.png + 10).fill(0x89))).ok === false)
  await tooBig.then(() => {}, () => {})
}

// ── the tool ────────────────────────────────────────────────────────────────
{
  const exec = (id) => ({ agent: { id } })
  const t = H.toolOptions(host)
  ok('tool: named and described for the agent', t.name === 'creer_motion' && t.description.includes('particles') && t.description.includes('keyframes') && t.description.includes('- chart:'))
  ok('tool: refuses a call it cannot attribute to a session', (await t.execute({ scene: SCENE }, {})).ok === false)
  const created = await t.execute({ titre: 'Mon intro', scene: SCENE }, exec('s1'))
  ok('tool: writes a scene under artifacts/ with a file derived from the title', created.ok && created.chemin === join(project, 'artifacts', 'mon-intro.miniapp.json') && created.rev === 1, created)
  ok('tool: tells the agent about readability problems', created.inspect && Array.isArray(created.inspect.warnings))
  const bad = await t.execute({ titre: 'Trop', scene: { layers: [{ type: 'text', text: 'Un texte vraiment beaucoup trop long pour tenir dans le cadre', x: 960, size: 200, maxW: 20000 }] } }, exec('s1'))
  ok('tool: a cut-off text comes back as a warning', bad.ok && bad.inspect.warnings.some((w) => w.code === 'cutoff'), bad)
  const rd = await t.execute({}, exec('s1'))
  ok('tool: with nothing it reads the current scene back', rd.ok && rd.read === true && rd.scene && rd.rev >= 1, rd)
  // the user changes something in the panel
  await host.saveScene({ path: rd.chemin, rawScene: { ...rd.scene, params: { ...rd.scene.params, titre: 'Changé' } }, by: 'user', what: 'Titre: Changé' })
  const seen = await t.execute({}, exec('s1'))
  ok('tool: reading shows what the user changed', seen.changes_by_user.length === 1 && seen.changes_by_user[0].what === 'Titre: Changé' && seen.scene.params.titre === 'Changé', seen)
  const patched = await t.execute({ params: { titre: 'Patch', accent: '#ff0000' }, note: 'Retitled' }, exec('s1'))
  ok('tool: params patch keeps the rest of the scene', patched.ok && patched.rev === seen.rev + 1, patched)
  const after = await t.execute({}, exec('s1'))
  ok('tool: the patch is in the file and the user list is cleared', after.scene.params.titre === 'Patch' && after.scene.params.accent === '#ff0000' && after.changes_by_user.length === 0 && after.scene.layers.length === 1)
  ok('tool: an empty session says there is nothing yet', (await t.execute({}, exec('other'))).empty === true)
  ok('tool: a bad path is refused with a reason', (await t.execute({ fichier: '../x', scene: SCENE }, exec('s1'))).ok === false)
  ok('tool: params must be an object', (await t.execute({ params: [1] }, exec('s1'))).ok === false)
  const viewing = t.execute({ voir: 1 }, exec('s1'))
  let w = null
  for (let i = 0; i < 100 && w === null; i++) { w = host.pendingFrame('s1'); if (w === null) await new Promise((r) => setTimeout(r, 5)) }
  await host.deliverFrame('s1', w.id, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]))
  const withPng = await viewing
  ok('tool: voir waits for the panel and returns the PNG path', withPng.voir && withPng.voir.path && withPng.voir.hint.includes('Read this PNG'), withPng.voir)
  const lonely = await t.execute({ voir: 0 }, exec('s1'))
  ok('tool: voir without a panel answers with an instruction, not a failure', lonely.ok === true && lonely.voir.error.includes('Open it'), lonely.voir)
}

await fsp.rm(base, { recursive: true, force: true })
console.log(`${n - fail}/${n} checks passed`)
process.exit(fail ? 1 : 0)
