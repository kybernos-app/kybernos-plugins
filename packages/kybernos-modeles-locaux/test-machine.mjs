// What the "Local engine" tile is told about this machine. Ollama being INSTALLED says nothing about its server running: the tile used to
// stay green with "localhost:11434" while nothing listened, and an empty list of models read as "none pulled" instead of "unknown".
//   node packages/kybernos-modeles-locaux/test-machine.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mesurerMachine } from './index.js'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}

// A fake machine: which commands exist and what they print. null = the command failed (not found, or the server does not answer).
const machine = (reponses) => async (cmd, args) => {
  const cle = cmd + ' ' + args.join(' ')
  return Object.prototype.hasOwnProperty.call(reponses, cle) ? reponses[cle] : null
}
const MAC = { 'sysctl -n machdep.cpu.brand_string': 'Apple M4\n', 'sysctl -n hw.memsize': String(16 * 1024 ** 3) + '\n' }

console.log('the server runs')
{
  const r = await mesurerMachine(machine({ ...MAC, 'ollama --version': 'ollama version is 0.35.0\n', 'ollama list': 'NAME ID SIZE MODIFIED\nllama3:8b abc 4.7 GB 2 days ago\n' }))
  check('present, server answering', r.ollama.present === true && r.ollama.serveur === true, JSON.stringify(r.ollama))
  check('the installed models are listed', r.ollama.models.length === 1 && r.ollama.models[0].id === 'llama3:8b')
  check('the machine is measured as before', r.chip === 'Apple M4' && r.ramGo === 16)
}
console.log('the server does not run')
{
  const r = await mesurerMachine(machine({ ...MAC, 'ollama --version': 'ollama version is 0.35.0\n' }))
  check('installed but `ollama list` fails → serveur is false (not null, not true)', r.ollama.present === true && r.ollama.serveur === false, JSON.stringify(r.ollama))
  check('the version is still known', r.ollama.version === '0.35.0')
  check('models is empty: with serveur false that means "unknown"', Array.isArray(r.ollama.models) && r.ollama.models.length === 0)
}
console.log('Ollama is not installed')
{
  const r = await mesurerMachine(machine({ ...MAC }))
  check('absent → present false and serveur null (no program, no question)', r.ollama.present === false && r.ollama.serveur === null, JSON.stringify(r.ollama))
}
console.log('the tile')
{
  const client = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')
  check('the client reads serveur === false only when the program is present', /ollamaArrete = machine !== null && machine\.ollama\.present === true && machine\.ollama\.serveur === false/.test(client))
  check('the dot is a warning when the server is stopped', /\(ollamaAbsent === true \|\| ollamaArrete === true\) \? 'warning' : 'done'/.test(client))
  check('the note says the server is not running instead of "localhost:11434"', /ollamaArrete === true \? m\('kml\.ollama\.arrete'\) : m\('kml\.moteur\.port'\)/.test(client))
  const e = /'kml\.ollama\.arrete': \{ fr: "([^"]+)", en: '([^']+)' \}/.exec(client)
  check('the message exists in French and English and says what to do', e !== null && /ollama serve/.test(e[1]) && /ollama serve/.test(e[2]), String(e))
}

console.log(failed === 0 ? '\nOK' : `\n${failed} failure(s)`)
process.exit(failed === 0 ? 0 : 1)
