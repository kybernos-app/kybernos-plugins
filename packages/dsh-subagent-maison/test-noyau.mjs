// The core of the home-made providers, without DSH: the one-shot run, the task check, the health probe, the free-model discovery.
//   node packages/dsh-subagent-maison/test-noyau.mjs
// Hermetic: a fake spawn, a throw-away HTTP server for the model list. The two checks that need a real CLI (opencode) say
// "skipped" when it is not installed — CI has none.
import { createServer } from 'node:http'
import { spawn as nodeSpawn } from 'node:child_process'
import { runOneShot, texteTache, RunFailure, sonder, trouverBinaire, trouverModeleFree } from './noyau.mjs'

let echecs = 0
let total = 0
const ok = (nom, cond, detail) => { total++; if (cond) console.log('  ✓ ' + nom); else { echecs++; console.log('  ✗ ' + nom + (detail !== undefined ? ' — ' + detail : '')) } }
const saute = (nom, raison) => console.log('  ○ ' + nom + ' — skipped (' + raison + ')')

// A fake spawn: returns a handle shaped like DSH's SubprocessHandle.
const fauxSpawn = ({ argv }) => {
  const e = nodeSpawn(argv[0], argv.slice(1))
  const done = new Promise((resolve) => e.on('close', (code, signal) => resolve({ exitCode: code, signal: signal ?? null })))
  return { stdout: e.stdout, stderr: e.stderr, done, terminate: () => e.kill('SIGTERM'), waitForExit: () => done.catch(() => {}) }
}

const serveur = async (reponse) => {
  const s = createServer((req, res) => { const r = reponse(req); res.writeHead(r.statut ?? 200, { 'content-type': 'application/json' }); res.end(JSON.stringify(r.corps ?? {})) })
  await new Promise((resolve) => s.listen(0, '127.0.0.1', resolve))
  return { url: 'http://127.0.0.1:' + s.address().port + '/v1', fermer: () => new Promise((resolve) => s.close(resolve)) }
}

try {
  console.log('── the core, without DSH ──')
  ok('finds node on the PATH', typeof trouverBinaire('node') === 'string')
  ok('a binary that does not exist is null', trouverBinaire('binary-that-does-not-exist-xyz') === null)

  ok('texteTache accepts text', texteTache([{ type: 'text', text: 'hello' }])[0] === 'hello')
  let refuse = false
  try { texteTache([{ type: 'image', data: 'x' }]) } catch { refuse = true }
  ok('texteTache refuses a non-text block', refuse)
  refuse = false
  try { texteTache([{ type: 'text', text: '   ' }]) } catch { refuse = true }
  ok('texteTache refuses an empty task', refuse)

  {
    const { attempt, teardown } = runOneShot('Test', [process.execPath, '-e', 'console.log("hello")'], { spawn: fauxSpawn })
    const r = await attempt()
    ok('runOneShot returns what the CLI wrote on stdout', r.output[0].text === 'hello' && r.stopReason === 'completed', JSON.stringify(r))
    await teardown()
  }
  {
    const { attempt, teardown } = runOneShot('Test', [process.execPath, '-e', 'process.exit(3)'], { spawn: fauxSpawn })
    let echoue = false
    try { await attempt() } catch (e) { echoue = e instanceof RunFailure && e.fait.code === 3 }
    ok('a non-zero exit code raises RunFailure with the code', echoue)
    await teardown()
  }
  {
    const { attempt, requestCancel, teardown } = runOneShot('Test', [process.execPath, '-e', 'setTimeout(()=>{}, 5000)'], { spawn: fauxSpawn })
    const attente = attempt().then(() => 'fini', (e) => (e instanceof RunFailure ? 'annule' : 'autre'))
    await new Promise((resolve) => setTimeout(resolve, 100))
    requestCancel()
    ok('a cancelled run ends as a failure of its own kind, quickly', (await attente) === 'annule')
    await teardown()
  }

  console.log('── the health probe ──')
  {
    const s = await sonder({ produit: 'Nothing', binaire: 'binary-that-does-not-exist-xyz' })
    ok('missing binary → not ready, reason binaire-absent, never an exception', s.pret === false && s.raison === 'binaire-absent')
    const n = await sonder({ produit: 'Node', binaire: 'node', versionArgs: ['--version'], authArgs: ['-e', 'process.exit(0)'], authOk: (code) => code === 0 })
    ok('binary present and "signed in" → ready, with its version', n.pret === true && /^v\d+/.test(n.version), JSON.stringify(n))
    const m = await sonder({ produit: 'Node', binaire: 'node', versionArgs: ['--version'], authArgs: ['-e', 'process.exit(1)'], authOk: (code) => code === 0 })
    ok('binary present but not signed in → not ready, reason non-connecte', m.pret === false && m.raison === 'non-connecte')
  }
  if (trouverBinaire('opencode') !== null) {
    const s = await sonder({ produit: 'OpenCode', binaire: 'opencode', versionArgs: ['--version'], authArgs: ['models'], authOk: (code) => code === 0 })
    ok('the real OpenCode probe is ready (opencode is installed here)', s.pret === true, JSON.stringify(s))
  } else saute('the real OpenCode probe', 'opencode is not installed')

  console.log('── discovering a free model ──')
  {
    const bon = await serveur(() => ({ corps: { data: [{ id: 'vendor/paid-model' }, { id: 'vendor/small:free' }, { id: 'other/big:free' }] } }))
    ok('the first ":free" model of the list', (await trouverModeleFree(bon.url)) === 'vendor/small:free')
    ok('a trailing slash on the address is fine', (await trouverModeleFree(bon.url + '/')) === 'vendor/small:free')
    ok('a "choose" callback decides among the free ones', (await trouverModeleFree(bon.url, { choisir: (ids) => ids[ids.length - 1] })) === 'other/big:free')
    await bon.fermer()
    const payant = await serveur(() => ({ corps: { data: [{ id: 'vendor/paid-model' }] } }))
    ok('no free model → null (nothing is invented)', (await trouverModeleFree(payant.url)) === null)
    await payant.fermer()
    const casse = await serveur(() => ({ statut: 500, corps: { error: 'down' } }))
    ok('a server error → null', (await trouverModeleFree(casse.url)) === null)
    await casse.fermer()
    ok('an unreachable server → null, no exception', (await trouverModeleFree('http://127.0.0.1:9/v1')) === null)
    const bizarre = await serveur(() => ({ corps: { data: 'not a list' } }))
    ok('a malformed answer → null', (await trouverModeleFree(bizarre.url)) === null)
    await bizarre.fermer()
  }
} catch (e) {
  echecs++; total++
  console.log('  ✗ the test itself stopped — ' + String(e && e.stack ? e.stack : e).split('\n').slice(0, 4).join(' | '))
} finally {
  console.log('\nNOYAU — ' + (total - echecs) + '/' + total + ' checks, ' + echecs + ' failure(s)')
  process.exit(echecs === 0 ? 0 : 1)
}
