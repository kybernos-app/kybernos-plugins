// The engine lookup and the factory wiring, on a FIXTURE engine — no DSH, no network, no CLI needed (CI runs this).
//   node packages/dsh-subagent-maison/test-moteur.mjs
//
// A fixture engine is a node_modules folder with fake `@deepseek-ai/*` packages. The real helpers are replaced by minimal
// look-alikes: what is tested is that the providers FIND the engine without a node_modules of their own, take each module from
// the right place, and drive the helpers the way the seam expects. The same wiring against a REAL engine is
// test-integration.mjs (skipped when no engine is installed).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { pointsDeDepart, importerDepuis, chargerMoteur } from './moteur.mjs'

let echecs = 0
let total = 0
const ok = (nom, cond, detail) => { total++; if (cond) console.log('  ✓ ' + nom); else { echecs++; console.log('  ✗ ' + nom + (detail !== undefined ? ' — ' + detail : '')) } }

const dossier = mkdtempSync(join(tmpdir(), 'kb-moteur-'))
const ecrire = (chemin, texte) => { mkdirSync(join(chemin, '..'), { recursive: true }); writeFileSync(chemin, texte) }
const paquet = (racine, nom, source, extra = {}) => {
  const d = join(racine, 'node_modules', ...nom.split('/'))
  ecrire(join(d, 'package.json'), JSON.stringify({ name: nom, version: '0.0.0', type: 'module', main: 'index.js', exports: { '.': './index.js' }, ...extra }))
  ecrire(join(d, 'index.js'), source)
  return d
}

// ── the fixture engine ──────────────────────────────────────────────────────
const moteur = join(dossier, 'moteur')
const sub = paquet(moteur, '@deepseek-ai/dsh-subagent', `
import { statSync } from 'node:fs'
export const MARQUE = 'moteur'
export const NO_START_CAPABILITIES = Object.freeze({ agentOptions: false })
export const resolveChildCwd = (prefix, configured, parentCwd) => { if (configured !== undefined) return configured; if (parentCwd === undefined) throw new Error(prefix + ': no cwd'); statSync(parentCwd); return parentCwd }
export async function settleRunResult (p) {
  try { const r = await p.attempt(); return p.cancelled() ? { output: p.collectOutput(), stopReason: 'aborted' } : r }
  catch (e) { try { p.onError?.(e, 'error') } catch {} return { output: p.collectOutput(), diagnostic: p.collectDiagnostic?.(), stopReason: 'error' } }
  finally { p.signal.removeEventListener('abort', p.onAbort) }
}
export function subprocessRunHandle (p) { let d; return { id: p.id, result: p.result, dispose () { if (d === undefined) { p.requestCancel(); d = p.teardown() } return d } } }
`)
// the engine's own schema + brand live NEXT TO its subagent package (nested), and a decoy sits at the top level
paquet(sub, '@deepseek-ai/schemastery', `const chaine = () => { const o = {}; for (const k of ['min', 'default', 'optional']) o[k] = () => o; return o }
export default { vrai: true, object: (forme) => ({ forme }), string: chaine, number: chaine, dict: () => chaine() }`)
paquet(sub, '@deepseek-ai/dsh-brand', `export const brandString = (s) => 'brand:' + s`)
paquet(moteur, '@deepseek-ai/schemastery', `export default { vrai: false, decoy: true }`)
paquet(moteur, '@deepseek-ai/dsh-brand', `export const brandString = (s) => 'decoy:' + s`)
paquet(moteur, '@deepseek-ai/dsh-subprocess', `export const scrubbedParentEnv = () => ({ PATH: process.env.PATH, SCRUBBED: '1' })`)

try {
  console.log('── where to look ──')
  {
    const pts = pointsDeDepart({ env: { KB_MOTEUR: moteur, DSH_HOME: join(dossier, 'home') }, argv1: '/nonexistent/dsh.js', ici: pathToFileURL(join(dossier, 'ici.mjs')).href })
    ok('KB_MOTEUR comes first (an explicit choice beats everything)', pts[0] === join(moteur, 'noop.js'), pts[0])
    ok('then the profile, then this package; a script that does not exist is not listed', pts.includes(join(dossier, 'home', 'profiles', 'web', 'package.json')) && pts.at(-1) === join(dossier, 'ici.mjs') && !pts.includes('/nonexistent/dsh.js'), JSON.stringify(pts))
    ok('DSH_PROFILE picks the profile', pointsDeDepart({ env: { DSH_HOME: '/h', DSH_PROFILE: 'kyber' }, argv1: '' }).includes('/h/profiles/kyber/package.json'))
    ok('no duplicates', new Set(pts).size === pts.length)
    const reel = join(dossier, 'bin', 'dsh.js'); ecrire(reel, '')
    symlinkSync(reel, join(dossier, 'lien-dsh'))
    ok('the running dsh is taken with its symlinks resolved (the engine, not the shim)', pointsDeDepart({ env: {}, argv1: join(dossier, 'lien-dsh') }).some((p) => p.endsWith(join('bin', 'dsh.js'))))
  }

  console.log('── finding the engine from a package that has no node_modules ──')
  {
    const sansModules = join(dossier, 'checkout', 'packages', 'dsh-subagent-maison'); mkdirSync(sansModules, { recursive: true })
    const m = await chargerMoteur({ env: { KB_MOTEUR: moteur }, argv1: '', ici: pathToFileURL(join(sansModules, 'moteur.mjs')).href })
    ok('the four modules are found through KB_MOTEUR', m.subagent.MARQUE === 'moteur' && typeof m.subprocess.scrubbedParentEnv === 'function' && typeof m.brand.brandString === 'function' && m.z !== undefined)
    ok('the schema is the one NEXT TO the engine’s subagent package, not the decoy at the top level', m.z.vrai === true && m.z.decoy === undefined)
    ok('so is brand', m.brand.brandString('x') === 'brand:x')
    ok('subprocess comes from the engine itself', m.subprocess.scrubbedParentEnv().SCRUBBED === '1')
    let message = ''
    try { await chargerMoteur({ env: { KB_MOTEUR: join(dossier, 'nulle-part'), DSH_HOME: join(dossier, 'vide') }, argv1: '', ici: pathToFileURL(join(sansModules, 'moteur.mjs')).href }) } catch (e) { message = String(e.message) }
    ok('no engine: a clear error that names the module, where it looked and what to set', /cannot find @deepseek-ai\/dsh-subagent/.test(message) && /KB_MOTEUR/.test(message) && message.includes(join(dossier, 'nulle-part')), message)
    ok('importerDepuis tries each starting point in turn', (await importerDepuis([join(dossier, 'nulle-part', 'x.js'), join(moteur, 'noop.js')], '@deepseek-ai/dsh-brand')).module.brandString('y') === 'decoy:y')
  }

  console.log('── the providers on the fixture engine ──')
  {
    process.env.KB_MOTEUR = moteur
    const enregistres = []
    const parent = (cwd) => ({ session: { header: { cwd } } })
    const lanceur = (sortie, code = 0) => ({ stdout: { on: (e, f) => { if (e === 'data') setImmediate(() => f(Buffer.from(sortie))) } }, stderr: { on: () => {} }, done: new Promise((r) => setTimeout(() => r({ exitCode: code, signal: null }), 30)), terminate: () => {}, waitForExit: async () => {} })
    const etat = { derniere: null }
    const faux = (sortie, code) => ({ logger: { warn: () => {} }, subagents: { registerProvider: (p) => enregistres.push(p) }, subprocess: { spawn: (spec) => { etat.derniere = spec; return lanceur(sortie, code) } } })
    const clis = ['opencode', 'gemini', 'qwen', 'hermes']
    const modules = {}
    for (const cli of clis) modules[cli] = await import(pathToFileURL(join(import.meta.dirname, 'dsh-subagent-' + cli, 'index.js')).href)
    ok('the four providers load with NO node_modules of their own (the engine was found by the lookup)', clis.every((c) => typeof modules[c].apply === 'function' && Array.isArray(modules[c].inject)))
    ok('the schema they export is the engine’s own', clis.every((c) => modules[c].Config.forme !== undefined))
    const ctx = faux('texte rendu\n', 0)
    for (const cli of clis) modules[cli].apply(ctx, { model: '', env: {} })
    ok('each one registers a provider under its own name', enregistres.map((p) => p.name).join() === 'opencode,gemini,qwen,hermes', enregistres.map((p) => p.name).join())
    ok('with the engine’s "no start capability" constant', enregistres.every((p) => p.capabilities.agentOptions === false))
    const p = enregistres[1]
    const signal = new AbortController().signal
    const poignee = await p.start({ parent: parent(tmpdir()), prompt: [{ type: 'text', text: 'relis le README' }], signal })
    const resultat = await poignee.result
    ok('start() spawns the CLI with the task, in the parent’s folder, with a branded run id', etat.derniere.argv[0] === 'gemini' && etat.derniere.argv.at(-1) === 'relis le README' && etat.derniere.cwd === tmpdir() && /^brand:/.test(poignee.id), JSON.stringify(etat.derniere.argv))
    ok('the child’s environment is the engine’s scrubbed one (secrets stay out)', etat.derniere.env.SCRUBBED === '1')
    ok('the result carries the CLI’s output and the engine’s run-handle shape', resultat.stopReason === 'completed' && resultat.output[0].text === 'texte rendu' && typeof poignee.dispose === 'function')
    let refus = ''
    try { await p.start({ parent: parent(undefined), prompt: [{ type: 'text', text: 'x' }], signal }) } catch (e) { refus = String(e.message) }
    ok('no working folder → a plain English refusal, nothing is spawned', /no working folder/.test(refus))
    const ctxCle = faux('ok', 0)
    modules.gemini.apply(ctxCle, { apiKey: 'sk-from-config', env: {} })
    await (await enregistres.at(-1).start({ parent: parent(tmpdir()), prompt: [{ type: 'text', text: 'x' }], signal })).result
    ok('the API key is put back in the child’s environment under the name the CLI reads (the engine scrubbed it)', etat.derniere.env.GEMINI_API_KEY === 'sk-from-config' && etat.derniere.env.SCRUBBED === '1')
    modules.gemini.apply(faux('ok', 0), { env: {} })
    await (await enregistres.at(-1).start({ parent: parent(tmpdir()), prompt: [{ type: 'text', text: 'x' }], signal })).result
    ok('and no key is invented when there is none', etat.derniere.env.GEMINI_API_KEY === undefined || etat.derniere.env.GEMINI_API_KEY === process.env.GEMINI_API_KEY)
    const ctxEchec = faux('boom', 3)
    modules.qwen.apply(ctxEchec, { model: '', env: {} })
    const r3 = await (await enregistres.at(-1).start({ parent: parent(tmpdir()), prompt: [{ type: 'text', text: 'x' }], signal })).result
    ok('exit code 3 → stopReason "error" with a diagnostic naming the product', r3.stopReason === 'error' && /Qwen Code/.test(String(r3.diagnostic)), JSON.stringify(r3))
  }
} catch (e) {
  echecs++; total++
  console.log('  ✗ the test itself stopped — ' + String(e && e.stack ? e.stack : e).split('\n').slice(0, 4).join(' | '))
} finally {
  rmSync(dossier, { recursive: true, force: true })
  console.log('\nMOTEUR — ' + (total - echecs) + '/' + total + ' checks, ' + echecs + ' failure(s)')
  process.exit(echecs === 0 ? 0 : 1)
}
