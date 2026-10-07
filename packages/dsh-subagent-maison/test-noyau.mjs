// Test standalone du noyau des providers maison — sans DSH.
// Simule un ctx.subprocess.spawn minimal pour prouver le run one-shot.
//   node test-noyau.mjs
import { runOneShot, texteTache, RunFailure, sonder, trouverBinaire } from './noyau.mjs'
import { spawn as nodeSpawn } from 'node:child_process'

let echecs = 0
const ok = (nom, cond, detail) => { if (cond) console.log('  ✓ ' + nom); else { echecs++; console.log('  ✗ ' + nom + (detail !== undefined ? ' — ' + detail : '')) } }

// faux spawn : renvoie un handle façon SubprocessHandle de DSH
const fauxSpawn = ({ argv }) => {
  const e = nodeSpawn(argv[0], argv.slice(1))
  let sortie = ''
  e.stdout.on('data', (c) => { sortie += c })
  const done = new Promise((resolve, reject) => e.on('close', (code, signal) => resolve({ exitCode: code, signal: signal ?? null })))
  return {
    stdout: e.stdout, stderr: e.stderr,
    done,
    terminate: () => e.kill('SIGTERM'),
    waitForExit: () => done.catch(() => {})
  }
}

try {
  console.log('── noyau, sans DSH ──')
  ok('trouve le binaire opencode', typeof trouverBinaire('opencode') === 'string')
  ok('trouve node', typeof trouverBinaire('node') === 'string')

  // texteTache
  ok('texteTache accepte du texte', texteTache([{ type: 'text', text: 'salut' }])[0] === 'salut')
  let aRefuse = false
  try { texteTache([{ type: 'image', data: 'x' }]) } catch { aRefuse = true }
  ok('texteTache refuse un bloc non-texte', aRefuse)

  // runOne-shot avec echo (binaire universel)
  {
    const { attempt, teardown } = runOneShot('Test', [process.execPath, '-e', 'console.log("bonjour")'], { spawn: fauxSpawn })
    const r = await attempt()
    ok('runOneShot renvoie le texte de stdout', r.output[0].text === 'bonjour' && r.stopReason === 'completed', JSON.stringify(r))
    await teardown()
  }

  // run en échec
  {
    const { attempt, teardown } = runOneShot('Test', [process.execPath, '-e', 'process.exit(3)'], { spawn: fauxSpawn })
    let echoue = false
    try { await attempt() } catch (e) { echoue = e instanceof RunFailure && e.fait.code === 3 }
    ok('un code de sortie non-nul lève RunFailure', echoue)
    await teardown()
  }

  // sonde opencode réelle (health-check, sans modèle)
  {
    const s = await sonder({ produit: 'OpenCode', binaire: 'opencode', versionArgs: ['--version'], authArgs: ['models'], authOk: (code) => code === 0 })
    ok('sonde OpenCode prête', s.pret === true, JSON.stringify(s))
  }
} finally {
  console.log('\nNOYAU — ' + echecs + ' échec(s)')
  process.exit(echecs === 0 ? 0 : 1)
}
