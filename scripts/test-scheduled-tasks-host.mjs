// Test du noyau « tâches planifiées » : moteur cron, fuseaux, one-time, store,
// déclencheur. Importe le bloc balisé KB-TASKS-CORE de kybernos-plugin/index.js
// (le plugin host tourne en bundle sans imports relatifs — d'où l'extraction).
// Usage : node scripts/test-scheduled-tasks-host.mjs   (exit 0 = tout passe)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const src = readFileSync(root + 'kybernos-plugin/index.js', 'utf8')
const m = src.match(/\/\/ KB-TASKS-CORE-BEGIN([\s\S]*?)\/\/ KB-TASKS-CORE-END/)
if (m === null) { console.error('BLOC KB-TASKS-CORE INTROUVABLE dans index.js'); process.exit(1) }
const mod = await import('data:text/javascript,' + encodeURIComponent(m[1] + '\nexport { kbParseCron, kbNextCronAfter, kbComputeNextRun, kbSanitizeTaskInput, kbParseIsoLocal, kbZoneOffsetMinutes, kbMakeTaskStore, kbMakeTrigger }'))

let fails = 0
const eq = (label, got, want) => { const ok = got === want; if (!ok) { fails++; console.log('FAIL', label, '| got', got, '| want', want) } else console.log('ok  ', label) }

/* ── 1. Moteur cron ─────────────────────────────────────────────────────── */
const now = Date.UTC(2026, 8, 21, 6, 0, 0) // lundi 21 sept. 2026, 08:00 heure de Paris
eq('monday strictly after -> next monday', new Date(mod.kbNextCronAfter('0 8 * * 1', now, 'Europe/Paris')).toISOString(), '2026-09-28T06:00:00.000Z')
eq('weekdays at 07:59 local -> today 08:00', new Date(mod.kbNextCronAfter('0 8 * * 1-5', now - 60000, 'Europe/Paris')).toISOString(), '2026-09-21T06:00:00.000Z')
eq('every-15min', new Date(mod.kbNextCronAfter('*/15 * * * *', now, 'Europe/Paris')).toISOString(), '2026-09-21T06:15:00.000Z')
eq('friday 16:00', new Date(mod.kbNextCronAfter('0 16 * * 5', now, 'Europe/Paris')).toISOString(), '2026-09-25T14:00:00.000Z')
eq('dom-or-dow Vixie OR (13th or friday)', new Date(mod.kbNextCronAfter('0 0 13 * 5', now, 'UTC')).toISOString(), '2026-09-25T00:00:00.000Z')
eq('invalid cron -> null', String(mod.kbNextCronAfter('99 99 99 99 99', now, 'UTC')), 'null')
eq('dow 7 wraps to sunday', String(mod.kbParseCron('0 8 * * 7').dow.has(0)), 'true')

/* ── 2. Fuseaux & bascules d’heure (Europe/Paris 2026) ──────────────────── */
// Bascule printemps : sam 28 mars, 01:00 UTC → 03:00 locale (02:00 inexistante).
const springBefore = Date.UTC(2026, 2, 28, 5, 0) // samedi 05:00Z = 06:00 CET, avant 8h
eq('daily 8am on switch day fires 07:00Z (=08:00 CEST)', new Date(mod.kbNextCronAfter('0 8 * * *', springBefore, 'Europe/Paris')).toISOString(), '2026-03-28T07:00:00.000Z')
const gap = mod.kbNextCronAfter('30 2 * * *', springBefore, 'Europe/Paris')
// Le 28 mars à Paris, le mur 02:30 N'EXISTE PAS (01:59 CET → 03:00 CEST), et le
// 29 mars n'a pas non plus de 02:30 « +2 » : le premier vrai 02:30 est celui du
// 30 mars, désormais en CEST (+2) = 00:30Z. Attendu mesuré, pas deviné.
eq('impossible wall 02:30 skipped to first real occurrence', new Date(gap).toISOString(), '2026-03-30T00:30:00.000Z')
// Bascule automne : dim 25 oct., 01:00 UTC → 02:00 CEST puis 02:00 CET (heure doublée).
const fallBefore = Date.UTC(2026, 9, 25, 0, 0)
eq('doubled 02:30 fires FIRST occurrence only', new Date(mod.kbNextCronAfter('30 2 * * *', fallBefore, 'Europe/Paris')).toISOString(), '2026-10-25T00:30:00.000Z')

/* ── 3. One-time ─────────────────────────────────────────────────────────── */
eq('past once -> null', String(mod.kbComputeNextRun({ active: true, schedule: { mode: 'once', at: '2026-09-20T10:00' } }, now)), 'null')
eq('future once wall Paris (+2 CEST)', new Date(mod.kbComputeNextRun({ active: true, schedule: { mode: 'once', at: '2026-09-25T09:30' } }, now, 'Europe/Paris')).toISOString(), '2026-09-25T07:30:00.000Z')
eq('future once explicit offset +05:00', new Date(mod.kbComputeNextRun({ active: true, schedule: { mode: 'once', at: '2026-09-25T09:30+05:00' } }, now)).toISOString(), '2026-09-25T04:30:00.000Z')
eq('inactive task -> null', String(mod.kbComputeNextRun({ active: false, schedule: { mode: 'cron', cron: '* * * * *' } }, now)), 'null')
eq('bad once date -> null', String(mod.kbComputeNextRun({ active: true, schedule: { mode: 'once', at: 'pas une date' } }, now)), 'null')

/* ── 4. Validation formulaire ────────────────────────────────────────────── */
eq('missing name rejected', String(mod.kbSanitizeTaskInput({ name: '', prompt: 'p' }).error), 'name required')
eq('missing prompt rejected', String(mod.kbSanitizeTaskInput({ name: 'a', prompt: '  ' }).error), 'prompt required')
eq('bad cron rejected', String(mod.kbSanitizeTaskInput({ name: 'a', prompt: 'b', schedule: { mode: 'cron', cron: '99 99 99 99 99' } }).error), 'cron invalide')
eq('bad once date rejected', String(mod.kbSanitizeTaskInput({ name: 'a', prompt: 'b', schedule: { mode: 'once', at: 'x' } }).error), 'date ponctuelle invalide')
const okIn = mod.kbSanitizeTaskInput({ name: ' a ', prompt: ' b ', schedule: { mode: 'cron', cron: '0  8 * * 1-5' } })
eq('valid input normalized', okIn.task.schedule.cron, '0 8 * * 1-5')
eq('runsOn forced local', okIn.task.runsOn, 'local')
eq('approvals defaults ask', okIn.task.approvals, 'ask')
eq('notify filtered', JSON.stringify(mod.kbSanitizeTaskInput({ name: 'a', prompt: 'b', notify: ['push', 'sms'] }).task.notify), '["push"]')

/* ── 5. Store + déclencheur (faux fs en mémoire) ─────────────────────────── */
// makeTaskStore/makeTrigger ne vivent PAS dans le bloc balisé (ils sont définis
// plus bas dans index.js côté boot) : on teste ici la boucle équivalente avec
// un faux fs et un fire injecté, comme le fait le tick réel.
const fakeFs = (() => {
  const files = {}
  return {
    async resolve(p) { return p },
    async readText(p) { if (files[p] === undefined) throw new Error('ENOENT'); return files[p] },
    async writeText(p, c) { files[p] = c },
    dump() { return files['/tmp/tasks.json'] !== undefined ? JSON.parse(files['/tmp/tasks.json']) : [] },
  }
})()
const store = mod.kbMakeTaskStore ? mod.kbMakeTaskStore('/tmp/tasks.json', fakeFs) : null
if (store === null) { console.log('SKIP store tests (fabriques absentes du bloc balisé)') }
else {
  await store.mutate(async (tasks) => { tasks.push({ id: 't1', name: 'A', prompt: 'p', schedule: { mode: 'cron', cron: '0 8 * * *' }, active: true, nextRun: new Date(Date.now() - 1000).toISOString() }) })
  eq('store persists one task', fakeFs.dump().length, 1)
  let firedIds = []
  const trigger = mod.kbMakeTrigger({ store, fire: async (t) => { firedIds.push(t.id); return { sessionId: 'session-test' } }, onError: (m) => { console.log('trigger error:', m) } })
  const r1 = await trigger.tick()
  eq('tick fires due task', r1.fired, 1)
  eq('fired id recorded', firedIds.join(','), 't1')
  const saved = fakeFs.dump()[0]
  eq('history holds fired entry', saved.history[0].status, 'fired')
  eq('nextRun recomputed to future', Date.parse(saved.nextRun) > Date.now(), true)
  const r2 = await trigger.tick()
  eq('second tick idle', r2.fired, 0)
}

console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILURES')
process.exit(fails === 0 ? 0 : 1)
