// test-computers-host.mjs — SDK E2B factice : aucune clé réelle, aucun réseau.
// Couvre : validation et store de la clé, cycle start/exec/write/read/stop,
// TTL (clamp, échéance, balayage), cap de sandboxes, invariants (clé jamais
// dans les réponses, état sans secret).
import { readFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

// Rediriger l'état AVANT l'import du module (STATE_FILE est dérivé de DSH_HOME).
const sandboxDir = mkdtempSync(join(tmpdir(), 'kbc-test-'))
process.env.DSH_HOME = sandboxDir

const { testHooks, ROUTES, LIMITS } = await import('./index.js')
const {
  setSdkForTests, setCredentialsForTests, readState, writeState,
  resolveKey, looksLikeE2bKey, startSandbox, execCommand, writeFile,
  readFile, stopSandbox, sweepOnce, clampTtl, publicSandbox,
} = testHooks

let failures = 0
const check = (name, fn) => {
  try { fn(); console.log('  ✓ ' + name) }
  catch (e) { failures += 1; console.error('  ✗ ' + name + '\n    ' + String((e && e.message) || e)) }
}
const checkAsync = async (name, fn) => {
  try { await fn(); console.log('  ✓ ' + name) }
  catch (e) { failures += 1; console.error('  ✗ ' + name + '\n    ' + String((e && e.message) || e)) }
}

// ── faux services ────────────────────────────────────────────────────────────
const creds = { store: new Map() }
creds.resolve = async (k) => (creds.store.has(k) ? { value: creds.store.get(k), source: 'file' } : undefined)
creds.set = async (k, v) => { creds.store.set(k, v) }
creds.unset = async (k) => { creds.store.delete(k) }
setCredentialsForTests(creds)
delete process.env.E2B_API_KEY

const KEY = 'e2b_' + 'a'.repeat(40)
const calls = []
const sandboxes = new Map()
let nextId = 1
const fakeSandbox = (id) => ({
  sandboxId: id,
  commands: { run: async (command, opts) => { calls.push({ id, command, opts }); return { exitCode: 0, stdout: 'ok: ' + command, stderr: '' } } },
  files: {
    write: async (path, content) => { calls.push({ id, path, content }) },
    read: async (path) => { calls.push({ id, path, read: true }); return 'contenu de ' + path },
  },
  kill: async () => { sandboxes.delete(id) },
})
const paused = new Set()
const fakeSdk = {
  Sandbox: {
    create: async (template, opts) => { const o = typeof template === 'string' ? (opts ?? {}) : (template ?? {}); calls.push({ create: true, template: typeof template === 'string' ? template : 'base', apiKey: o?.apiKey, envs: o?.envs }); const id = 'sbx-test-' + (nextId++); sandboxes.set(id, fakeSandbox(id)); return fakeSandbox(id) },
    connect: async (id, opts) => { calls.push({ connect: id }); if (sandboxes.has(id) !== true) throw new Error('not found'); const sb = sandboxes.get(id); if (paused.has(id) === true) paused.delete(id); sb.setTimeout = async () => {}; return sb },
    kill: async (id) => { sandboxes.delete(id) },
    betaPause: async (id) => { if (sandboxes.has(id) !== true) throw new Error('not found'); calls.push({ pause: id }); paused.add(id); return true },
  },
}
setSdkForTests(fakeSdk)

// ── 1. clé ───────────────────────────────────────────────────────────────────
console.log('clé E2B')
check('format accepté : e2b_ + 40 car.', () => assert.equal(looksLikeE2bKey(KEY), true))
check('format refusé : trop court / espaces', () => {
  assert.equal(looksLikeE2bKey('e2b_court'), false)
  assert.equal(looksLikeE2bKey('e2b ' + 'a'.repeat(40)), false)
})
check('absente par défaut', async () => {}); // couvert par l'appel suivant
await checkAsync('resolveKey null sans credential ni env', async () => assert.equal(await resolveKey(), null))
creds.store.set('E2B_API_KEY', KEY)
await checkAsync('resolveKey lit le credential', async () => assert.equal(await resolveKey(), KEY))

// ── 2. cycle de vie ──────────────────────────────────────────────────────────
console.log('cycle de vie')
writeState({ version: 1, sandboxes: {} })
let started = null
await checkAsync('start → sandbox suivie', async () => {
  const made = await startSandbox({ label: 'chantier', ttlMs: 90_000 })
  assert.equal(made.ok, true)
  assert.match(made.sandbox.sandboxId, /^sbx-test-/)
  assert.equal(made.sandbox.label, 'chantier')
  started = made.sandbox
})
check('état local sans secret', () => {
  const raw = readFileSync(testHooks.STATE_FILE, 'utf8')
  assert.equal(raw.includes(KEY), false)
  assert.equal(Object.keys(readState().sandboxes).length, 1)
})
await checkAsync('exec renvoie stdout', async () => {
  const ran = await execCommand({ sandboxId: started.sandboxId, command: 'echo salut' })
  assert.equal(ran.ok, true)
  assert.equal(ran.stdout, 'ok: echo salut')
})
await checkAsync('exec sans sandboxId → erreur nette', async () => {
  const ran = await execCommand({ sandboxId: '', command: 'x' })
  assert.equal(ran.ok, false)
  assert.equal(ran.error, 'sandboxId_manquant')
})
await checkAsync('exec vers une sandbox morte → connexion_impossible', async () => {
  const ran = await execCommand({ sandboxId: 'sbx-fantome', command: 'x' })
  assert.equal(ran.ok, false)
  assert.equal(ran.error, 'connexion_impossible')
})
await checkAsync('write puis read', async () => {
  const w = await writeFile({ sandboxId: started.sandboxId, path: '/home/user/a.txt', content: 'coucou' })
  assert.equal(w.ok, true)
  const r = await readFile({ sandboxId: started.sandboxId, path: '/home/user/a.txt' })
  assert.equal(r.ok, true)
  assert.equal(r.content, 'contenu de /home/user/a.txt')
})
await checkAsync('write sans contenu → refus', async () => {
  const w = await writeFile({ sandboxId: started.sandboxId, path: '/x', content: undefined })
  assert.equal(w.ok, false)
  assert.equal(w.error, 'contenu_invalide')
})
check('publicSandbox ne fuit pas de secret', () => {
  const pub = JSON.stringify(publicSandbox(readState().sandboxes[started.sandboxId]))
  assert.equal(pub.includes(KEY), false)
})

// ── 3. cap et TTL ────────────────────────────────────────────────────────────
console.log('cap et TTL')
check('clampTtl borne les deux côtés', () => {
  assert.equal(clampTtl(undefined), 15 * 60_000)
  assert.equal(clampTtl(5_000), 60_000)
  assert.equal(clampTtl(99 * 60 * 60_000), 2 * 60 * 60_000)
})
await checkAsync('cap local : 4 simultanées max', async () => {
  while (Object.keys(readState().sandboxes).length < 4) { await startSandbox({}) }
  const fifth = await startSandbox({})
  assert.equal(fifth.ok, false)
  assert.equal(fifth.error, 'quota_local_atteint')
})
await checkAsync('balayeur arrête les expirées et détache', async () => {
  const state = readState()
  const [first] = Object.values(state.sandboxes)
  first.expiresAt = Date.now() - 1_000
  writeState(state)
  await sweepOnce()
  assert.equal(readState().sandboxes[first.sandboxId], undefined)
})
await checkAsync('stop détache même une sandbox déjà morte', async () => {
  const [id] = Object.keys(readState().sandboxes)
  const stopped = await stopSandbox({ sandboxId: id })
  assert.equal(stopped.ok, true)
  assert.equal(readState().sandboxes[id], undefined)
})

// ── 4. routes ────────────────────────────────────────────────────────────────
console.log('routes')
check('13 routes, chemins distincts, toutes guarded', () => {
  assert.equal(ROUTES.length, 13)
  const paths = new Set(ROUTES.map((r) => r.path))
  assert.equal(paths.size, ROUTES.length) // le routeur indexe par chemin
  for (const r of ROUTES) assert.equal(r.guarded, true)
})

// ── 5. outils agent ──────────────────────────────────────────────────────────
console.log('outils agent')
const tools = testHooks.computerTools()
check('9 outils computer_* déclarés', () => {
  const names = tools.map((t) => t.name).sort()
  assert.deepEqual(names, ['computer_exec', 'computer_list', 'computer_pause', 'computer_read', 'computer_resume', 'computer_start', 'computer_stop', 'computer_task', 'computer_write'])
  for (const t of tools) {
    assert.equal(typeof t.execute, 'function')
    assert.equal(typeof t.output.render, 'function')
    assert.equal(t.output?.schema?.type, 'object')
  }
})
writeState({ version: 1, sandboxes: {} })
let toolSandbox = null
await checkAsync('computer_start crée et rend l’identifiant', async () => {
  const made = await tools.find((t) => t.name === 'computer_start').execute({ label: 'outil', ttlMs: 300_000 })
  assert.equal(made.ok, true)
  toolSandbox = made.sandbox.sandboxId
  const txt = tools.find((t) => t.name === 'computer_start').output.render({}, made)[0].text
  assert.ok(txt.includes(toolSandbox))
})
await checkAsync('computer_exec exécute et rend un résumé lisible', async () => {
  const ran = await tools.find((t) => t.name === 'computer_exec').execute({ sandboxId: toolSandbox, command: 'echo outil' })
  assert.equal(ran.ok, true)
  assert.equal(ran.stdout, 'ok: echo outil')
})
await checkAsync('computer_write puis computer_read font l’aller-retour', async () => {
  await tools.find((t) => t.name === 'computer_write').execute({ sandboxId: toolSandbox, path: '/home/user/o.txt', content: 'xyz' })
  const r = await tools.find((t) => t.name === 'computer_read').execute({ sandboxId: toolSandbox, path: '/home/user/o.txt' })
  assert.equal(r.content, 'contenu de /home/user/o.txt')
})
await checkAsync('computer_list rend les suivies', async () => {
  const listed = await tools.find((t) => t.name === 'computer_list').execute({})
  assert.equal(listed.ok, true)
  assert.equal(listed.sandboxes.length, 1)
  const txt = tools.find((t) => t.name === 'computer_list').output.render({}, listed)[0].text
  assert.ok(txt.includes(toolSandbox))
})
await checkAsync('computer_pause gèle, sort du balayage, puis computer_resume réveille', async () => {
  const froze = await tools.find((t) => t.name === 'computer_pause').execute({ sandboxId: toolSandbox })
  assert.equal(froze.ok, true)
  const entry = readState().sandboxes[toolSandbox]
  assert.equal(entry.paused, true)
  assert.ok(entry.expiresAt > 1e15, 'échéance suspendue (hors balayage)')
  // le balayeur ne doit PAS tuer une gelée même si savedExpiresAt est passé
  const state = readState()
  state.sandboxes[toolSandbox].savedExpiresAt = Date.now() - 1
  writeState(state)
  await testHooks.sweepOnce()
  assert.notEqual(readState().sandboxes[toolSandbox], undefined)
  const woke = await tools.find((t) => t.name === 'computer_resume').execute({ sandboxId: toolSandbox })
  assert.equal(woke.ok, true)
  const back = readState().sandboxes[toolSandbox]
  assert.equal(back.paused, false)
  assert.ok(back.expiresAt <= Date.now() + LIMITS.maxTtlMs, 'échéance réaliste après réveil')
  // une fois réveillée et expirée, le balayeur la coupe
  const s2 = readState()
  s2.sandboxes[toolSandbox].expiresAt = Date.now() - 1
  writeState(s2)
  await testHooks.sweepOnce()
  assert.equal(readState().sandboxes[toolSandbox], undefined)
})
await checkAsync('computer_stop détache même une gelée', async () => {
  const made = await testHooks.startSandbox({ label: 'gelée' })
  await testHooks.pauseSandbox({ sandboxId: made.sandbox.sandboxId })
  const stopped = await tools.find((t) => t.name === 'computer_stop').execute({ sandboxId: made.sandbox.sandboxId })
  assert.equal(stopped.ok, true)
  assert.equal(readState().sandboxes[made.sandbox.sandboxId], undefined)
})

rmSync(sandboxDir, { recursive: true, force: true })
if (failures > 0) { console.error('\n' + failures + ' échec(s)'); process.exit(1) }
console.log('\ntous les tests host kybernos-computers passent')
