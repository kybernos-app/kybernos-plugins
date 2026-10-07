// Test des fabriques d'argv des providers maison — sans DSH (argv.js est pur).
//   node test-providers.mjs
import { argv as gemini } from './dsh-subagent-gemini/argv.js'
import { argv as qwen } from './dsh-subagent-qwen/argv.js'
import { argv as opencode } from './dsh-subagent-opencode/argv.js'
import { argv as hermes } from './dsh-subagent-hermes/argv.js'

let echecs = 0
const ok = (nom, cond, detail) => { if (cond) console.log('  ✓ ' + nom); else { echecs++; console.log('  ✗ ' + nom + (detail !== undefined ? ' — ' + detail : '')) } }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

try {
  console.log('── argv par CLI ──')
  ok('gemini -p sans modèle', eq(gemini('gemini', undefined, ['t']), ['gemini', '-p', 't']))
  ok('gemini -m modèle quand fourni', eq(gemini('gemini', 'flash', ['t']), ['gemini', '-m', 'flash', '-p', 't']))
  ok('qwen -p identique façade', eq(qwen('qwen', undefined, ['t']), ['qwen', '-p', 't']))
  ok('opencode run + skip-permissions', eq(opencode('opencode', undefined, ['t']), ['opencode', 'run', '--dangerously-skip-permissions', 't']))
  ok('opencode joint les tâches', opencode('opencode', undefined, ['a', 'b']).pop() === 'a\n\nb')
  ok('aucun modèle en dur (defaut = pas de -m)', !gemini('gemini', undefined, ['t']).includes('-m'))
  ok('hermes -z one-shot', eq(hermes('hermes', undefined, ['t']), ['hermes', '-z', 't']))
} finally {
  console.log('\nPROVIDERS — ' + echecs + ' échec(s)')
  process.exit(echecs === 0 ? 0 : 1)
}
