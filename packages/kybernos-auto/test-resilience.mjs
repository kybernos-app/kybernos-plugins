#!/usr/bin/env node
// Auto routing, resilient: probe first, a circuit breaker per model, a fallback chain capped at the retry cap, outcomes
// that keep their reason. No network, no browser: the "models" are a fake llm service, the clock is injected, the home is a
// temporary folder.
//
//   node packages/kybernos-auto/test-resilience.mjs
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { monterRoutes, lireSante, router } from './index.js'
import { PAUSE_HORS_JEU_MS, PAUSE_LIMITE_MS, PAUSE_MAX_MS, PAUSE_MIN_MS, SEUIL_OUVERTURE, TTL_SONDE_KO_MS, TTL_SONDE_MS, apresIssue, causeDe, etatDisjoncteur, issueDeRapport, plafondEssais, resoudre, triCandidats, vierge, vueModele } from './resilience.mjs'

let pass = 0
let fail = 0
const check = (name, cond, detail) => { if (cond === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 260))) } }
const ICI = dirname(fileURLToPath(import.meta.url))

console.log('the probe is the same text as the Study-model health probe')
{
  const bloc = (f) => { const t = readFileSync(f, 'utf8'); const i = t.indexOf('// KB-PROBE-BEGIN'); const j = t.indexOf('// KB-PROBE-END'); const lignes = t.slice(i, j).split('\n'); return lignes.slice(2).join('\n') }
  const a = bloc(join(ICI, 'sonde.mjs'))
  const b = bloc(join(ICI, '..', 'kybernos-sessions', 'brain-health.mjs'))
  check('both copies hold a probe block', a.length > 2000 && b.length > 2000, [a.length, b.length])
  check('the two copies are identical (a fix is made in both places)', a === b)
}

console.log('the breaker')
{
  const T = 1_000_000
  const ko = (code, message = 'x') => ({ etat: 'erreur', code, message })
  const muet = { etat: 'muet', code: 'TIMEOUT', message: 'slow' }
  check('a model never seen is closed', etatDisjoncteur(undefined, T) === 'closed' && etatDisjoncteur(vierge(), T) === 'closed' && etatDisjoncteur('x', T) === 'closed')
  let r = apresIssue(undefined, muet, T)
  check('one silent answer is a flake: the breaker stays closed', etatDisjoncteur(r, T) === 'closed' && r.consecutive === 1)
  r = apresIssue(apresIssue(r, muet, T + 1), muet, T + 2)
  check('three in a row open it, for the minimum pause', SEUIL_OUVERTURE === 3 && etatDisjoncteur(r, T + 3) === 'open' && r.openUntil === T + 2 + PAUSE_MIN_MS && r.openReason === 'silent', r)
  check('while open it says until when; once the pause is over it is half-open (one trial decides)', etatDisjoncteur(r, r.openUntil - 1) === 'open' && etatDisjoncteur(r, r.openUntil) === 'half-open' && etatDisjoncteur(r, r.openUntil + 99999) === 'half-open')
  const again = apresIssue(r, muet, r.openUntil + 5)
  check('a failed trial opens it again, for twice as long', again.openUntil === r.openUntil + 5 + 2 * PAUSE_MIN_MS && etatDisjoncteur(again, r.openUntil + 6) === 'open', again)
  let long = r
  for (let i = 0; i < 12; i += 1) long = apresIssue(long, muet, T + 10 + i)
  check('the pause grows but never past ten minutes', long.openUntil - (T + 21) <= PAUSE_MAX_MS && long.openUntil - (T + 21) === PAUSE_MAX_MS, long.openUntil - (T + 21))
  const ok1 = apresIssue(r, { etat: 'ok', code: 'stop', message: '' }, r.openUntil + 10)
  check('a success closes it and forgets the streak', etatDisjoncteur(ok1, r.openUntil + 11) === 'closed' && ok1.consecutive === 0 && ok1.openUntil === 0 && ok1.openReason === null && ok1.lastOkAt === r.openUntil + 10)
  for (const code of ['AUTH', 'UNKNOWN_MODEL', 'INVALID_REQUEST', 'PI_AI_ERROR', 'CONTEXT_WINDOW_EXCEEDED']) {
    const h = apresIssue(undefined, ko(code), T)
    check(code + ': asking again will not fix it, so the first failure opens the breaker for ten minutes', etatDisjoncteur(h, T + 1) === 'open' && h.openUntil === T + PAUSE_MAX_MS && h.openReason === causeDe(code), h)
  }
  const lim = apresIssue(undefined, { etat: 'limite', code: 'RATE_LIMIT', message: 'slow down' }, T)
  check('a rate limit is a short pause, not a failure streak', etatDisjoncteur(lim, T + 1) === 'open' && lim.openUntil === T + PAUSE_LIMITE_MS && lim.consecutive === 0 && lim.openReason === 'limit')
  const net = apresIssue(undefined, { etat: 'reseau', code: 'TRANSPORT', message: 'down' }, T)
  check('a transport failure is not the model’s fault: noted, the breaker untouched', etatDisjoncteur(net, T + 1) === 'closed' && net.consecutive === 0 && net.lastError.code === 'TRANSPORT')
  const hj = apresIssue(undefined, { etat: 'hors-jeu', code: 'INVALID_REQUEST', message: 'x' }, T)
  check('a model that refuses to be a language model is left alone for an hour', etatDisjoncteur(hj, T + 1) === 'open' && hj.openUntil === T + PAUSE_HORS_JEU_MS && hj.openReason === 'not-chat')
  check('the input record is never changed', JSON.stringify(vierge()) === JSON.stringify(vierge()) && apresIssue(r, muet, T + 99) !== r && r.consecutive === 3)
  const e = apresIssue(undefined, ko('AUTH', 'x'.repeat(500)), T)
  check('every failure keeps its reason; the message is capped; the last five are kept', e.lastError.code === 'AUTH' && e.lastError.message.length === 200 && e.lastError.at === T)
  let five = undefined
  for (let i = 0; i < 8; i += 1) five = apresIssue(five, ko('X' + i), T + i)
  check('…newest first', five.recent.length === 5 && five.recent[0].code === 'X7' && five.recent[4].code === 'X3')
  check('a report with an error is classed like a probe outcome (key refused → "erreur", AUTH)', issueDeRapport({ erreur: true, code: 'AUTH', message: 'bad key' }).etat === 'erreur' && issueDeRapport({ erreur: true, code: 'RATE_LIMIT' }).etat === 'limite' && issueDeRapport({ erreur: true }).code === 'UNKNOWN' && issueDeRapport({ erreur: false }).etat === 'ok' && issueDeRapport({}).etat === 'ok')
  check('causes are the chip’s words', causeDe('AUTH') === 'key' && causeDe('UNKNOWN_MODEL') === 'gone' && causeDe('TIMEOUT') === 'silent' && causeDe('constructor') === 'other' && causeDe('whatever') === 'other')
  const v = vueModele('a/b', r, T + 3)
  check('the page’s view: down, until when, why, how many in a row', v.etat === 'down' && v.disjoncteur === 'open' && v.jusqua === r.openUntil && v.cause === 'silent' && v.consecutive === 3 && v.lastError.code === 'TIMEOUT', v)
  check('a model seen only by a failed probe is not "never"; a trial shows as degraded', vueModele('a/b', apresIssue(undefined, muet, T), T).etat === 'degrade' && vueModele('a/b', r, r.openUntil + 1).etat === 'degrade' && vueModele('a/b', undefined, T).etat === 'jamais')
}

console.log('triage')
{
  const T = 5000
  const sante = { 'p/open': { ...vierge(), openUntil: T + 1000, openReason: 'key' }, 'p/half': { ...vierge(), openUntil: T - 1, consecutive: 3 } }
  const t = triCandidats(['p/a', 'p/open', 'p/half', 'p/a', 'p/b', 7, null], sante, T, { exclure: ['p/b'] })
  check('open breakers and excluded models are skipped with their reason; half-open ones are tried; duplicates and junk are dropped', JSON.stringify(t.eligibles) === JSON.stringify(['p/a', 'p/half']) && t.ecartes.length === 2 && t.ecartes[0].raison === 'key' && t.ecartes[0].jusqua === T + 1000 && t.ecartes[1].raison === 'exclu', t)
  const many = Array.from({ length: 25 }, (_, i) => 'p/m' + i)
  const cap = triCandidats(many, {}, T)
  check('never more than the retry cap (10): the rest is left out, and says so', cap.eligibles.length === 10 && cap.ecartes.length === 15 && cap.ecartes.every((x) => x.raison === 'plafond'))
  check('the cap is the plugin’s retry cap (KB_RETRY_PLAFOND), 10 by default, never below 1', plafondEssais({}) === 10 && plafondEssais({ KB_RETRY_PLAFOND: '4' }) === 4 && plafondEssais({ KB_RETRY_PLAFOND: '0' }) === 10 && plafondEssais({ KB_RETRY_PLAFOND: 'x' }) === 10 && triCandidats(many, {}, T, { max: 3 }).eligibles.length === 3)
}

console.log('probe first')
{
  const mk = (verdicts, log) => async (m) => { log.push(m); await Promise.resolve(); return verdicts[m] || { etat: 'ok', code: 'stop', message: '', ms: 5 } }
  const bad = { etat: 'erreur', code: 'AUTH', message: 'bad key' }
  let t = 10000
  const horloge = () => t
  const noted = []
  const noter = (m, i) => noted.push([m, i.etat])
  {
    const log = []
    const r = await resoudre({ eligibles: ['a', 'b', 'c', 'd', 'e'], sonder: mk({}, log), cache: new Map(), noter, horloge })
    check('the first model to answer is verified and first; probing stops at the first group that has a healthy one', r.chaine[0].modele === 'a' && r.chaine[0].verifie === true && log.length === 3 && r.sondes === 3, [r, log])
    check('the models after it are offered, in order, as fallbacks: probed ones verified, the rest not', JSON.stringify(r.chaine.map((c) => c.modele + ':' + c.verifie)) === JSON.stringify(['a:true', 'b:true', 'c:true', 'd:false', 'e:false']), r.chaine)
  }
  {
    const log = []
    noted.length = 0
    const r = await resoudre({ eligibles: ['a', 'b', 'c', 'd', 'e'], sonder: mk({ a: bad, b: bad, c: bad }, log), cache: new Map(), noter, horloge })
    check('a group where nobody answers is skipped; the next group is probed', r.chaine[0].modele === 'd' && r.chaine[0].verifie === true && log.join() === 'a,b,c,d,e', [r.chaine, log])
    check('the failed ones come back with their reason, for the caller and the page', r.echecs.length === 3 && r.echecs[0].raison === 'key' && r.echecs[0].code === 'AUTH' && r.echecs[0].message === 'bad key', r.echecs)
    check('every probe outcome is recorded (it feeds the breaker)', noted.length === 5 && noted.filter((n) => n[1] === 'erreur').length === 3, noted)
  }
  {
    const cache = new Map()
    const log = []
    await resoudre({ eligibles: ['a'], sonder: mk({}, log), cache, noter, horloge })
    t += TTL_SONDE_MS - 1
    const r1 = await resoudre({ eligibles: ['a'], sonder: mk({}, log), cache, noter, horloge })
    check('a healthy verdict under a minute old is trusted: no new probe', log.length === 1 && r1.chaine[0].source === 'cache' && r1.sondes === 0, [log, r1])
    t += 2
    const r2 = await resoudre({ eligibles: ['a'], sonder: mk({}, log), cache, noter, horloge })
    check('older than a minute: asked again', log.length === 2 && r2.chaine[0].source === 'probe' && TTL_SONDE_MS === 60000)
    const r3 = await resoudre({ eligibles: ['a'], sonder: mk({}, log), cache, noter, horloge, forcer: true })
    check('"force" ignores the cache', log.length === 3 && r3.sondes === 1)
    const cacheKo = new Map()
    const logKo = []
    await resoudre({ eligibles: ['z'], sonder: mk({ z: bad }, logKo), cache: cacheKo, noter, horloge })
    t += TTL_SONDE_KO_MS - 1
    await resoudre({ eligibles: ['z'], sonder: mk({ z: bad }, logKo), cache: cacheKo, noter, horloge })
    check('a failed verdict is trusted for ten seconds, so a dead model is not hammered', logKo.length === 1)
    t += 2
    await resoudre({ eligibles: ['z'], sonder: mk({ z: bad }, logKo), cache: cacheKo, noter, horloge })
    check('…then asked again, so its recovery is seen', logKo.length === 2)
  }
  {
    let tt = 0
    const lent = async (m) => { tt += 5000; return { etat: 'erreur', code: 'TIMEOUT', message: 'slow' } }
    const r = await resoudre({ eligibles: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], sonder: lent, cache: new Map(), noter, horloge: () => tt, delaiMs: 12000, groupe: 2 })
    check('past the deadline the rest is handed over unprobed instead of making the caller wait', r.delai === true && r.chaine.length > 0 && r.chaine.every((c) => c.verifie === false) && r.chaine.length < 7 + 1, r)
  }
  {
    const r = await resoudre({ eligibles: [], sonder: mk({}, []), cache: new Map(), noter, horloge })
    check('nobody eligible: an empty chain, no probe', r.chaine.length === 0 && r.sondes === 0)
  }
}

console.log('the router')
{
  const reg = { whitelist: ['deepseek-official/deepseek-chat', 'openrouter/qwen/qwen-coder', 'ollama-local/llama3', 'token-plan/wan2.7-image', 'claude-code/claude-sonnet-5-5'], classifier: '', global: true }
  const log = []
  const sonder = async (m) => { log.push(m); return m.includes('deepseek') ? { etat: 'erreur', code: 'UNKNOWN_MODEL', message: 'gone', ms: 3 } : { etat: 'ok', code: 'stop', message: '', ms: 4 } }
  const r = await router('corrige le bug de pagination', { reglages: reg, sonder, noter: () => {}, cache: new Map() })
  check('code class: the first candidate that does not answer is passed over, the next one is chosen and verified', r.classe === 'code' && r.modele === 'openrouter/qwen/qwen-coder' && r.verifie === true && r.candidats[0] === r.modele, r)
  check('the answer says who was skipped and why, and what was probed', r.ecartes.some((e) => e.modele === 'deepseek-official/deepseek-chat' && e.raison === 'gone') && r.sondes === log.length && r.sonde === 'fraiche' && r.plafond === 10, r)
  const d = await router('refais la maquette de la page', { reglages: reg, sonder: async () => ({ etat: 'ok', code: 'stop', message: '' }), noter: () => {}, cache: new Map() })
  check('the "design" class of the CLI is here too: Claude first', d.classe === 'design' && d.modele === 'claude-code/claude-sonnet-5-5', d)
  const m = await router('génère une vidéo', { reglages: reg, sonder: async () => ({ etat: 'ok', code: 'stop', message: '' }), noter: () => {}, cache: new Map() })
  check('the media class keeps to media models', m.classe === 'media' && m.modele === 'token-plan/wan2.7-image' && m.candidats.length === 1, m)
  const x = await router('corrige le bug de pagination', { reglages: reg, sonder: async () => ({ etat: 'ok', code: 'stop', message: '' }), noter: () => {}, cache: new Map(), exclure: ['openrouter/qwen/qwen-coder'] })
  check('a caller whose delegation just failed asks again with exclure: it gets the NEXT model', x.modele !== 'openrouter/qwen/qwen-coder' && x.ecartes.some((e) => e.modele === 'openrouter/qwen/qwen-coder' && e.raison === 'exclu'), x)
  const none = await router('corrige le bug', { reglages: reg, sonder: async () => ({ etat: 'erreur', code: 'AUTH', message: 'k' }), noter: () => {}, cache: new Map() })
  check('nobody answers: modele null (keep the session model), with the reasons', none.modele === null && none.verifie === false && none.candidats.length === 0 && none.ecartes.length >= 3 && /did not answer/.test(none.raison), none)
  const sans = await router('corrige le bug', { reglages: reg })
  check('with no llm service nothing is probed: the chain is unverified and says so', sans.modele !== null && sans.verifie === false && sans.sonde === 'indisponible' && /not available/.test(sans.raison) && sans.sondes === 0, sans)
  const pause = await router('corrige le bug', { reglages: reg, sante: { 'deepseek-official/deepseek-chat': { ...vierge(), openUntil: Date.now() + 60000, openReason: 'key' }, 'openrouter/qwen/qwen-coder': { ...vierge(), openUntil: Date.now() + 60000, openReason: 'silent' } }, sonder: async () => ({ etat: 'ok', code: 'stop', message: '' }), noter: () => {}, cache: new Map() })
  check('a model in its pause is not even probed (the code class also takes the Claude Code route, whose id says "code")', pause.ecartes.filter((e) => e.raison === 'key' || e.raison === 'silent').length === 2 && pause.modele === 'claude-code/claude-sonnet-5-5', pause)
  const long = { ...reg, whitelist: Array.from({ length: 30 }, (_, i) => 'p/m' + i) }
  const cap = await router('bonjour', { reglages: long, sonder: async () => ({ etat: 'ok', code: 'stop', message: '' }), noter: () => {}, cache: new Map() })
  check('the chain handed to the caller is never longer than the retry cap', cap.candidats.length === 10 && cap.chaine.length === 10, cap.candidats.length)
}

console.log('the routes, with a fake llm service')
{
  const home = mkdtempSync(join(tmpdir(), 'kauto-res-'))
  const reglagesPath = join(home, 'kybernos', 'settings.json')
  const santePath = join(home, 'kybernos', 'auto-health.json')
  const sessionsAutoPath = join(home, 'kybernos', 'auto-sessions.json')
  const { mkdirSync, writeFileSync } = await import('node:fs')
  mkdirSync(join(home, 'kybernos'), { recursive: true })
  // No rule matches: the class is "chat", so every text model of the whitelist is a candidate.
  const DEMANDE = 'analyse la stratégie de prix'
  const WL = ['deepseek-official/deepseek-chat', 'openrouter/qwen/qwen-coder', 'ollama-local/llama3']
  writeFileSync(reglagesPath, JSON.stringify({ autoRouting: true, autoWhitelist: WL }))
  // The fake service: what each model does when asked.
  const comportement = { 'deepseek-official': 'ok', openrouter: 'ok', 'ollama-local': 'ok' }
  const appels = []
  const llm = {
    stream ({ provider, model, signal }) {
      appels.push(provider + '/' + model)
      const how = comportement[provider]
      return (async function * () {
        if (how === 'ok') { yield { type: 'finish', reason: { kind: 'stop' } }; return }
        if (how === 'silent') { await new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { code: 'ABORTED' }))) }); return }
        yield { type: 'finish', reason: { kind: 'failure', failure: { code: how, message: how + ' from the fake provider' } } }
      })()
    }
  }
  let maintenant = 2_000_000_000_000
  const routes = {}
  monterRoutes({ register: (r) => { routes[r.path] = r.handler } }, { home, reglagesPath, santePath, sessionsAutoPath, llm, horloge: () => maintenant, delaiSondeMs: 80 })
  const req = (method, path, corps) => { const body = corps === undefined ? '' : JSON.stringify(corps); return { method, url: path, headers: { origin: 'http://127.0.0.1:3080' }, socket: { localPort: 3080 }, on (ev, cb) { if (ev === 'data') cb(body); if (ev === 'end') cb() } } }
  const appelle = async (method, path, corps) => { let out = null; await routes[path](req(method, path, corps), { writeHead () {}, end (s) { out = JSON.parse(s) } }); return out }

  let r = await appelle('POST', '/kybernos-auto/router', { demande: DEMANDE })
  check('first call: the first candidate answers the probe, it is verified and chosen', r.modele === WL[0] && r.verifie === true && r.sonde === 'fraiche' && appels.join() === WL[0] + ',' + WL[1] + ',' + WL[2], [r.modele, appels])
  const avant = appels.length
  r = await appelle('POST', '/kybernos-auto/router', { demande: DEMANDE })
  check('second call within a minute: answered from the cache, no new probe', r.modele === WL[0] && r.sonde === 'cache' && appels.length === avant, [r.sonde, appels.length - avant])
  check('routing itself writes nothing to the health file (probes do, and only their breaker data)', Object.values(lireSante(santePath)).every((x) => x.calls === 0), lireSante(santePath))

  comportement['deepseek-official'] = 'AUTH'
  maintenant += TTL_SONDE_MS + 1
  r = await appelle('POST', '/kybernos-auto/router', { demande: DEMANDE })
  check('a model whose key was refused: passed over, with the reason, and the next one is chosen', r.modele === WL[1] && r.verifie === true && r.ecartes.some((e) => e.modele === WL[0] && e.raison === 'key' && e.code === 'AUTH'), r)
  let st = await appelle('GET', '/kybernos-auto/state')
  let v = st.sante.find((x) => x.modele === WL[0])
  check('the state says why: open breaker, until when, the cause and the last error', v.etat === 'down' && v.disjoncteur === 'open' && v.cause === 'key' && v.lastError.code === 'AUTH' && v.jusqua > maintenant && v.sonde.etat === 'erreur', v)
  check('…and counts it as unavailable', st.disponibles === 2 && st.total === 3 && st.plafond === 10 && st.ttlSondeS === 60)

  const n = appels.length
  maintenant += TTL_SONDE_MS + 1
  r = await appelle('POST', '/kybernos-auto/router', { demande: DEMANDE })
  check('while its pause runs a model is not probed again (nothing hammers a dead key)', !appels.slice(n).includes(WL[0]) && r.modele === WL[1], appels.slice(n))

  comportement.openrouter = 'silent'
  maintenant += TTL_SONDE_MS + 1
  r = await appelle('POST', '/kybernos-auto/router', { demande: DEMANDE })
  check('a model that does not answer in time is passed over (silent); the third takes over', r.modele === WL[2] && r.ecartes.some((e) => e.modele === WL[1] && e.raison === 'silent'), r)

  comportement['deepseek-official'] = 'ok'
  comportement.openrouter = 'ok'
  r = await appelle('POST', '/kybernos-auto/probe', {})
  check('Re-check now probes the whitelist for real, ignoring the cache; the model whose key was fixed answers again', r.ok === true && r.sante.every((x) => x.sonde !== null), r.sante.map((x) => [x.modele, x.etat]))
  v = r.sante.find((x) => x.modele === WL[0])
  check('…and a success closes its breaker at once (the user fixed the key: no ten-minute wait)', v.disjoncteur === 'closed' && v.etat === 'ok' && v.jusqua === null, v)
  maintenant += 6000
  const avantNomme = appels.length
  r = await appelle('POST', '/kybernos-auto/probe', { models: ['ollama-local/llama3', 'evil-provider/anything'] })
  check('a probe can be limited to named models, and ONLY whitelist models are ever probed (the routes need no login)', r.ok === true && appels.slice(avantNomme).join() === 'ollama-local/llama3', appels.slice(avantNomme))
  const avantRepete = appels.length
  r = await appelle('POST', '/kybernos-auto/probe', {})
  check('asking again within five seconds does not probe again (it cannot be used to burn tokens), and still answers', r.ok === true && appels.length === avantRepete)

  // two requests that need the same model at the same moment share one probe
  maintenant += TTL_SONDE_MS + 1
  const avantDouble = appels.length
  const deux = await Promise.all([appelle('POST', '/kybernos-auto/router', { demande: DEMANDE }), appelle('POST', '/kybernos-auto/router', { demande: DEMANDE })])
  check('two requests at the same moment probe each model once, not twice', deux.every((x) => x.modele !== null) && appels.length - avantDouble === new Set(appels.slice(avantDouble)).size, appels.slice(avantDouble))

  // reports: the delegations' own outcomes
  r = await appelle('POST', '/kybernos-auto/report', { modele: WL[1], latenceMs: 1200, erreur: true, code: 'RATE_LIMIT', message: '429 too many requests' })
  v = r.sante.find((x) => x.modele === WL[1])
  check('a report with an error keeps its reason, counts as a call and an error', r.ok === true && v.calls === 1 && v.errors === 1 && v.lastError.code === 'RATE_LIMIT' && r.issue.etat === 'limite', v)
  check('a rate limit pauses the model for a minute, no more', v.disjoncteur === 'open' && Math.abs(v.jusqua - (maintenant + PAUSE_LIMITE_MS)) < 5, [v.jusqua, maintenant])
  r = await appelle('POST', '/kybernos-auto/router', { demande: DEMANDE })
  check('…so the router sends the next delegation elsewhere', r.modele !== WL[1] && r.ecartes.some((e) => e.modele === WL[1] && e.raison === 'limit'), r.ecartes)
  r = await appelle('POST', '/kybernos-auto/report', { modele: WL[1], erreur: false, latenceMs: 900 })
  v = r.sante.find((x) => x.modele === WL[1])
  check('a success report closes the breaker again', v.disjoncteur === 'closed' && v.calls === 2 && v.consecutive === 0, v)
  const mauvais = await appelle('POST', '/kybernos-auto/report', { modele: WL[1], erreur: true, code: 42 })
  check('a malformed code is refused', mauvais.ok === false)

  // the delegation failed: report it, ask again excluding it
  r = await appelle('POST', '/kybernos-auto/router', { demande: DEMANDE, exclure: [WL[0]] })
  check('router with exclure: the model that just failed is skipped, the next one answers', r.modele !== WL[0] && r.verifie === true, r.modele)
  const badExclure = await appelle('POST', '/kybernos-auto/router', { demande: DEMANDE, exclure: 'x' })
  check('exclure must be a list of ids', badExclure.ok === false)
  r = await appelle('POST', '/kybernos-auto/router', { demande: DEMANDE, sonde: false })
  check('a caller that cannot wait for probes says sonde:false: it gets the unverified chain at once', r.sondes === 0 && r.verifie === false && r.modele !== null, r)

  // nothing can be probed
  const routes2 = {}
  monterRoutes({ register: (rr) => { routes2[rr.path] = rr.handler } }, { home, reglagesPath, santePath, sessionsAutoPath, horloge: () => maintenant })
  let out = null
  await routes2['/kybernos-auto/probe'](req('POST', '/kybernos-auto/probe', {}), { writeHead (c) { out = { c } }, end (s) { out.corps = JSON.parse(s) } })
  check('with no llm service, Re-check now says so (503), it does not pretend', out.c === 503 && out.corps.ok === false && /unavailable/.test(out.corps.erreur), out)
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
