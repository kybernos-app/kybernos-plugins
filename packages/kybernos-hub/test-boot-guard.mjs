import {
  etatVide, normaliser, noterDemarrage, noterChargement, noterSante, verdict, echecsConsecutifs,
  recommandation, entrerSafe, sortirSafe, MAX_HISTORIQUE, SEUIL_ECHECS
} from './boot-guard.mjs'

let total = 0; let echecs = 0
const ok = (nom, cond, detail = '') => { total++; if (cond) console.log('  ✓ ' + nom); else { echecs++; console.log('  ✗ ' + nom + (detail ? ' — ' + detail : '')) } }

const boot = (e, id, gui) => {
  let x = noterDemarrage(e, { id, date: '2026-10-03T10:00:00Z' })
  if (gui === 'loading' || gui === 'alive') x = noterChargement(x, id)
  if (gui === 'alive') x = noterSante(x, id)
  return x
}

console.log('── reading ──')
ok('null → empty state', JSON.stringify(normaliser(null)) === JSON.stringify(etatVide()))
ok('garbage → empty state', normaliser('x').demarrages.length === 0 && normaliser(42).safe.actif === false)
ok('invalid entries dropped', normaliser({ demarrages: [{ id: 'a', gui: 'alive' }, { gui: 'alive' }, null, 7] }).demarrages.length === 1)
ok('unknown gui value → none', normaliser({ demarrages: [{ id: 'a', gui: 'weird' }] }).demarrages[0].gui === 'none')
ok('history is capped', (() => { let e = etatVide(); for (let i = 0; i < 30; i++) e = noterDemarrage(e, { id: 'b' + i, date: null }); return e.demarrages.length === MAX_HISTORIQUE })())

console.log('── verdicts ──')
ok('alive → ok', verdict({ gui: 'alive' }) === 'ok')
ok('loading without alive → failed', verdict({ gui: 'loading' }) === 'echec')
ok('no GUI → neutral', verdict({ gui: 'none' }) === 'neutre')
ok('alive is never downgraded by a late loading', (() => { let e = boot(etatVide(), 'a', 'alive'); e = noterChargement(e, 'a'); return e.demarrages[0].gui === 'alive' })())
ok('same boot id recorded once', noterDemarrage(noterDemarrage(etatVide(), { id: 'a', date: 'x' }), { id: 'a', date: 'y' }).demarrages.length === 1)

console.log('── consecutive failures ──')
ok('empty → 0', echecsConsecutifs(etatVide()) === 0)
ok('two failures → 2', echecsConsecutifs(boot(boot(etatVide(), 'a', 'loading'), 'b', 'loading')) === 2)
ok('an ok boot resets the count', echecsConsecutifs(boot(boot(boot(etatVide(), 'a', 'loading'), 'b', 'alive'), 'c', 'loading')) === 1)
ok('neutral boots are skipped, not counted', echecsConsecutifs(boot(boot(boot(etatVide(), 'a', 'loading'), 'n', 'none'), 'b', 'loading')) === 2)
ok('neutral boots do not hide an older ok', echecsConsecutifs(boot(boot(boot(etatVide(), 'a', 'alive'), 'n', 'none'), 'b', 'loading')) === 1)
ok('the boot in progress can be excluded', echecsConsecutifs(boot(boot(etatVide(), 'a', 'loading'), 'now', 'loading'), { exclure: 'now' }) === 1)

console.log('── recommendation ──')
ok('threshold is 2', SEUIL_ECHECS === 2)
ok('one failure → normal', recommandation(boot(etatVide(), 'a', 'loading')).mode === 'normal')
ok('two failures → safe recommended', recommandation(boot(boot(etatVide(), 'a', 'loading'), 'b', 'loading')).mode === 'safe-recommande')
ok('recommendation carries the count and a reason', (() => { const r = recommandation(boot(boot(etatVide(), 'a', 'loading'), 'b', 'loading')); return r.echecs === 2 && r.raison.includes('2') })())
ok('a healthy boot after failures → normal', recommandation(boot(boot(boot(etatVide(), 'a', 'loading'), 'b', 'loading'), 'c', 'alive')).mode === 'normal')
ok('only neutral boots → normal', recommandation(boot(boot(etatVide(), 'a', 'none'), 'b', 'none')).mode === 'normal')

console.log('── safe mode ──')
const avant = ['@local/kybernos-models', '@local/kybernos-cloud']
const s1 = entrerSafe(etatVide(), { activesAvant: avant, date: '2026-10-03T11:00:00Z' })
ok('enter: active, dated, list saved', s1.safe.actif === true && s1.safe.depuis === '2026-10-03T11:00:00Z' && s1.safe.activesAvant.length === 2)
const s2 = entrerSafe(s1, { activesAvant: [], date: '2026-10-03T12:00:00Z' })
ok('entering twice keeps the FIRST saved list', s2.safe.activesAvant.length === 2 && s2.safe.depuis === '2026-10-03T11:00:00Z')
ok('while safe, recommendation says safe', recommandation(s1).mode === 'safe')
const out = sortirSafe(s1)
ok('exit: returns the list to restore', JSON.stringify(out.aRestaurer) === JSON.stringify(avant))
ok('exit: state is clean and history is reset', out.etat.safe.actif === false && out.etat.demarrages.length === 0)
ok('exit from a non-safe state restores nothing', sortirSafe(etatVide()).aRestaurer.length === 0)
ok('input states are never mutated', (() => { const e = boot(etatVide(), 'a', 'loading'); const snap = JSON.stringify(e); noterSante(e, 'a'); entrerSafe(e, { activesAvant: ['x'], date: 'd' }); return JSON.stringify(e) === snap })())

console.log(`\nBOOT GUARD — ${total} assertions, ${echecs} failure(s)`)
process.exit(echecs === 0 ? 0 : 1)
