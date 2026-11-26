// A3-35 and A3-31 of the audit, on the pure parts of the panel (cut out of client.js as they are, like test-seam.mjs):
//   · a machine that could not be measured gives no verdict on any model (it used to read « Too heavy » on all of them);
//   · a failed pull is explained in plain words, with Ollama's own « Error: » not repeated.
//
//   node packages/kybernos-modeles-locaux/test-fit.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(fileURLToPath(new URL('./client.js', import.meta.url)), 'utf8')
const a = src.indexOf('// <fit:begin>')
const b = src.indexOf('// <fit:end>')
assert.ok(a >= 0 && b > a, 'the fit block is delimited by its markers')
const mod = await import('data:text/javascript,' + encodeURIComponent(src.slice(a, b) + '\nexport { kbEtat, kbEnCharge, kbCauseEchec, kbRefusInstall, kbEstLigne }'))

let n = 0
const ok = (label, fn) => { fn(); n += 1; console.log('  ✓ ' + label) }

// The models of the audit's screenshot (file sizes of the built-in list).
const CATALOGUE = [
  { id: 'qwen3.5:9b', tailleGo: 6.6 }, { id: 'qwen3.5:4b', tailleGo: 3.3 }, { id: 'qwen3.5:2b', tailleGo: 2.7 },
  { id: 'gemma4:e4b', tailleGo: 6.6 }, { id: 'qwen3:14b', tailleGo: 9.3 }, { id: 'qwen3-coder:30b', tailleGo: 19 },
  { id: 'gemma3:1b', tailleGo: 0.8 },
]

// What the panel did before: a null RAM fell through to 'lourd'.
const avant = (mo, ramGo) => {
  const budgetGo = ramGo === null ? null : Math.max(1, ramGo - 5)
  const ec = mo.tailleGo === null ? null : Math.round(mo.tailleGo * 1.25 * 10) / 10
  if (ec === null) return 'inconnu'
  if (budgetGo !== null && ec <= budgetGo) return 'compatible'
  if (ramGo !== null && ec <= ramGo) return 'juste'
  return 'lourd'
}

ok('with the machine unmeasured, no model is « too heavy » (the old rule said so for all seven)', () => {
  assert.deepEqual(CATALOGUE.map((m) => avant(m, null)), Array(7).fill('lourd'), 'the old behaviour, as the audit saw it')
  assert.deepEqual(CATALOGUE.map((m) => mod.kbEtat(m, null)), Array(7).fill('indetermine'))
  assert.deepEqual(CATALOGUE.map((m) => mod.kbEtat(m, undefined)), Array(7).fill('indetermine'))
})

ok('a model whose size is unknown stays « unknown » whatever the machine', () => {
  assert.equal(mod.kbEtat({ id: 'x', tailleGo: null }, 16), 'inconnu')
  assert.equal(mod.kbEtat({ id: 'x', tailleGo: null }, null), 'inconnu')
})

ok('with a measured machine the verdicts are exactly the old ones (16 GB: fits, tight, too heavy)', () => {
  for (const ram of [4, 8, 16, 24, 32, 64, 128]) for (const m of CATALOGUE) assert.equal(mod.kbEtat(m, ram), avant(m, ram), m.id + ' on ' + ram + ' GB')
  assert.equal(mod.kbEtat(CATALOGUE[0], 16), 'compatible')
  assert.equal(mod.kbEtat(CATALOGUE[4], 16), 'juste')
  assert.equal(mod.kbEtat(CATALOGUE[5], 16), 'lourd')
})

ok('a tiny machine still gets a verdict (a 2 GB RAM is not « unmeasured »)', () => {
  assert.equal(mod.kbEtat(CATALOGUE[0], 2), 'lourd')
  assert.equal(mod.kbEtat(CATALOGUE[6], 2), 'compatible')
})

ok('the memory estimate is the file size × 1.25, one decimal', () => {
  assert.equal(mod.kbEnCharge({ tailleGo: 6.6 }), 8.3)
  assert.equal(mod.kbEnCharge({ tailleGo: null }), null)
})

// ── A3-31 ───────────────────────────────────────────────────────────────────
ok('the audit\'s failure line: no « Error: » left, and the cause is a known one', () => {
  const c = mod.kbCauseEchec('Error: pull model manifest: file does not exist')
  assert.equal(c.brut, 'pull model manifest: file does not exist')
  assert.equal(c.cle, 'kml.echec.introuvable')
})

ok('the prefix is stripped however often it is repeated, in any case', () => {
  assert.equal(mod.kbCauseEchec('Error: Error: boom').brut, 'boom')
  assert.equal(mod.kbCauseEchec('  error:   boom  ').brut, 'boom')
  assert.equal(mod.kbCauseEchec('Errors are fun').brut, 'Errors are fun', 'a line that merely starts with « Error » is kept')
})

ok('a network failure is not mistaken for a missing model', () => {
  const line = 'Error: pull model manifest: Get "https://registry.ollama.ai/v2/library/qwen3.5/manifests/9b": dial tcp: lookup registry.ollama.ai: no such host'
  assert.equal(mod.kbCauseEchec(line).cle, 'kml.echec.reseau')
  assert.equal(mod.kbCauseEchec('Error: max retries exceeded: EOF').cle, 'kml.echec.reseau')
})

ok('server, disk and the unknown', () => {
  assert.equal(mod.kbCauseEchec("Error: could not connect to ollama server, run 'ollama serve' to start it").cle, 'kml.echec.serveur')
  assert.equal(mod.kbCauseEchec('serveur ollama introuvable sur 11434').cle, 'kml.echec.serveur')
  assert.equal(mod.kbCauseEchec('Error: write /x/blobs/sha256-1: no space left on device').cle, 'kml.echec.disque')
  const other = mod.kbCauseEchec('Error: something nobody planned for')
  assert.equal(other.cle, null)
  assert.equal(other.brut, 'something nobody planned for')
})

ok('an empty or missing line, and a very long one', () => {
  assert.deepEqual(mod.kbCauseEchec(''), { cle: null, brut: '' })
  assert.deepEqual(mod.kbCauseEchec(null), { cle: null, brut: '' })
  assert.equal(mod.kbCauseEchec('x'.repeat(900)).brut.length, 200)
})

ok('the refusals of the install route have a sentence; an unknown code has none', () => {
  assert.equal(mod.kbRefusInstall('occupe'), 'kml.echec.occupe')
  assert.equal(mod.kbRefusInstall('ollama-absent'), 'kml.echec.ollama-absent')
  assert.equal(mod.kbRefusInstall('brew-indisponible'), 'kml.echec.brew')
  assert.equal(mod.kbRefusInstall('constructor'), null, 'no prototype leak')
  assert.equal(mod.kbRefusInstall('zzz'), null)
})

ok('only a catalogue model has a row to tell its failure on (not the engine, not a Hugging Face reference)', () => {
  assert.equal(mod.kbEstLigne('qwen3.5:9b'), true)
  assert.equal(mod.kbEstLigne('ollama'), false)
  assert.equal(mod.kbEstLigne('hf.co/Qwen/Qwen2.5-7B-GGUF:Q4_K_M'), false)
})

ok('every sentence the panel asks for exists in French and in English', () => {
  const keys = new Set([...src.matchAll(/'(kml\.[a-z0-9.-]+)'/g)].map((m) => m[1]))
  const missing = []
  for (const k of keys) {
    if (/^kml\.(desc|cat\.source)\./.test(k)) continue
    const row = new RegExp("'" + k.replace(/\./g, '\\.') + "': \\{ fr: .*en: ").test(src)
    if (!row && src.indexOf("'" + k + "'") !== src.lastIndexOf("'" + k + "'")) missing.push(k)
  }
  assert.deepEqual(missing, [], 'used but not defined: ' + missing.join(', '))
})

console.log('kybernos-modeles-locaux fit and failure: ' + n + ' checks')
