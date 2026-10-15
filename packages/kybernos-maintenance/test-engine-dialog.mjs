#!/usr/bin/env node
// The update dialog for an ENGINE that is outside the tested zone (owner, 2026-10-15: « ce popup n'aide pas, pour un non dev c'est
// compliqué de mettre à jour : on devrait le faire de manière automatisée »). It used to say « go back to the tested version » and
// hand over a terminal command. It must now offer ONE button that does it (POST /kybernos-hub/engine, then the same follow-up and
// restart as the Suite update), and keep the command folded for developers.
//
// Source-level for the dialog (a DOM), run for the words (`motMaj`, pure).   node test-engine-dialog.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')

// ── the words, run as shipped ─────────────────────────────────────────────
let lang = 'en'
let definition
const stub = new Proxy({}, { get: (_t, k) => (k === 'Component' || k === 'PureComponent' ? class {} : k === 'useState' ? (v) => [v, () => {}] : k === 'useRef' ? (v) => ({ current: v }) : () => null) })
const win = { __ModuleLoader__: { load: (def) => { definition = def } }, __KB_LANG_RESOLVE__: () => lang, localStorage: { getItem: () => null, setItem: () => {} } }
new Function('window', SOURCE)(win)
const modele = definition.factory((nom) => { if (nom === 'react') return stub; throw new Error('no ' + nom) })
const T = modele.__test
assert.equal(typeof T.motMaj, 'function', 'motMaj is exposed to the tests')
{
  const w = (etat, extra) => T.motMaj({ etat, version: '0.2.1-alpha.2', moteur: true, ...extra })
  lang = 'en'
  assert.match(w('installation'), /Putting DSH back on the tested version/)
  assert.match(w('relance'), /^✓ DSH 0\.2\.1-alpha\.2 is in place\. DSH is restarting/)
  assert.match(w('termine'), /Restart DSH to finish/)
  assert.match(w('echec', { erreur: 'engine-update-failed' }), /nothing changed/)
  assert.ok(!/Kybernos/.test(w('relance')), 'an engine job never says « Kybernos is installed »')
  lang = 'fr'
  assert.match(w('installation'), /Remise de DSH sur la version testée/)
  assert.match(w('relance'), /DSH 0\.2\.1-alpha\.2 est en place/)
  assert.equal(T.motMaj({ etat: 'installation', version: '1.1.0' }).includes('DSH'), false, 'a Suite update keeps its own words')
  ok('the engine job has its own words in both languages and never claims a Kybernos install')
}

// ── the dialog and the follow-up ──────────────────────────────────────────
{
  assert.ok(/fetch\('\/kybernos-hub\/engine', \{ method: 'POST'/.test(SOURCE) && /\{ confirm: true, version: moteurVersion \}/.test(SOURCE), 'the click posts to the engine route with the version')
  assert.ok(/p\.kind === 'moteur' && pk\.heberge !== true && typeof p\.cible === 'string' && p\.cible !== ''/.test(SOURCE), 'only for an engine item with a target, and never on a hosted instance (it is rebuilt)')
  assert.ok(/viaMoteur === true \? kbp\('Corriger automatiquement', 'Fix automatically'\)/.test(SOURCE), 'the primary button says what it does')
  assert.ok(/updRun\(go, statutMaj, fin, viaMoteur === true \? p\.cible : undefined\)/.test(SOURCE), 'the target is the one the host announced (p.cible), not typed anywhere')
  assert.ok(/upEl\('details', 'kbup-dev'\)/.test(SOURCE) && /Pour les développeurs/.test(SOURCE), 'the terminal command is kept, folded, for developers')
  assert.ok(/if \(viaSuite !== true && viaMoteur !== true\) dlg\.appendChild\(steps\)/.test(SOURCE), 'the numbered terminal steps are not shown on the automatic path')
  assert.ok(/motMaj\(\{ etat: 'relance', version: t\.version, moteur: t\.moteur === true \}\)/.test(SOURCE), 'the restart message keeps the engine flag')
  ok('the dialog: one automatic button, the command folded for developers, same polling and restart as the Suite update')
}
// the engine route is the hub's, with the same follow-up route
{
  assert.ok(/'\/kybernos-hub\/update\/status'/.test(SOURCE), 'the follow-up polls the shared status route')
  ok('the engine job is followed on the shared status route')
}

console.log('\n' + pass + ' checks passed')
