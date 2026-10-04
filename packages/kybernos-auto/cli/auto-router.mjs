#!/usr/bin/env node
/**
 * auto-router — the agent's reflex BEFORE a delegation, and the command that tells Auto how it went.
 *
 * DSH's workflow offers no automatic interception of the model: the {provider, model} override is written BY THE CALLER.
 * Auto routing (Settings ▸ Auto Routing) therefore works through this command. The routing itself lives in the
 * `kybernos-auto` plugin's host (`POST /kybernos-auto/router`): rules → local classifier → whitelist, then it PROBES the
 * candidates (a real, tiny question, verdict kept 60 s), keeps a circuit breaker per model, and answers an ordered
 * fallback chain (10 models at most, the plugin's retry cap). This file is only a client of that route.
 *
 *   node auto-router.mjs "fix the pagination bug in client.js"
 *     → {"actif":true,"classe":"code","modele":"deepseek-official/deepseek-chat","verifie":true,"candidats":[…],"ecartes":[…],…}
 *     → {"actif":false}                                  (Auto is off: delegate as usual)
 *     → {"actif":true,"modele":null,…}                   (nobody answers, or no candidate: keep the session model)
 *
 *   The delegation failed? Say so, then ask again WITHOUT that model (it learns from the report):
 *     node auto-router.mjs --report deepseek-official/deepseek-chat --error --code TIMEOUT --message "no answer in 60 s"
 *     node auto-router.mjs --exclude deepseek-official/deepseek-chat "the same sub-task"
 *   It worked? Say so too (latency and cache feed the circuit breaker and the Settings page):
 *     node auto-router.mjs --report deepseek-official/deepseek-chat --ok --latency 4200
 *
 *   Options: --no-probe (answer at once, the chain is not verified) · env KB_AUTO_HOST (default http://127.0.0.1:3080).
 *
 * The session's own model is NEVER changed (that is what keeps its cache warm): only delegated work is routed. Plugin routes
 * are served before DSH's own authentication and accept a request with no Origin, so a local process with no cookie can call
 * them. If the host does not answer, the command says so and exits 0 with `actif:false`: delegate as usual.
 */
import { fileURLToPath } from 'node:url'

const HOTE = (process.env.KB_AUTO_HOST || 'http://127.0.0.1:3080').replace(/\/+$/, '')

async function appelerHote (chemin, corps, delaiMs) {
  const reponse = await fetch(HOTE + chemin, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps),
    signal: AbortSignal.timeout(delaiMs)
  })
  const texte = await reponse.text()
  let json = null
  try { json = JSON.parse(texte) } catch { json = null }
  return { ok: reponse.ok, status: reponse.status, json }
}

/** The routing decision, from the host. Never throws: an unreachable host reads as "Auto off". */
export async function router (demande, { exclure = [], sonde = true } = {}) {
  try {
    // Probing may take ~12 s (a group of silent models): the timeout leaves room.
    const r = await appelerHote('/kybernos-auto/router', { demande, exclure, ...(sonde ? {} : { sonde: false }) }, 30000)
    if (r.ok && r.json !== null && typeof r.json === 'object') return r.json
    return { actif: false, raison: 'the host refused the request (HTTP ' + String(r.status) + ')', sonde: 'hote-refus-' + String(r.status) }
  } catch (e) {
    return { actif: false, raison: 'the host did not answer: delegate as usual', sonde: 'hote-injoignable' }
  }
}

const valeur = (args, drapeau) => {
  const i = args.indexOf(drapeau)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined
}

/** One command line → what to print and the exit code, or `null` when there is nothing to do. */
export async function principal (args) {
  if (args.includes('--report')) {
    const modele = valeur(args, '--report')
    if (modele === undefined || modele.startsWith('--')) throw new Error('--report <provider/model> expected')
    const erreur = args.includes('--error')
    if (!erreur && !args.includes('--ok')) throw new Error('--ok or --error expected')
    const corps = { modele, erreur }
    const latence = valeur(args, '--latency')
    if (latence !== undefined) corps.latenceMs = Number(latence)
    const code = valeur(args, '--code')
    if (code !== undefined) corps.code = code
    const message = valeur(args, '--message')
    if (message !== undefined) corps.message = message
    const r = await appelerHote('/kybernos-auto/report', corps, 10000)
    const vu = r.json !== null && Array.isArray(r.json.sante) ? r.json.sante.find((s) => s.modele === modele) : undefined
    return {
      sortie: {
        ok: r.ok,
        ...(r.json !== null && r.json.issue !== undefined ? { issue: r.json.issue } : {}),
        ...(vu !== undefined ? { disjoncteur: vu.disjoncteur, jusqua: vu.jusqua } : {}),
        ...(r.ok ? {} : { erreur: (r.json !== null && r.json.erreur) || 'HTTP ' + String(r.status) })
      },
      code: r.ok ? 0 : 1
    }
  }
  const exclure = []
  const demande = []
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--exclude') { exclure.push(...String(args[i + 1] || '').split(',').map((x) => x.trim()).filter(Boolean)); i += 1 } else if (args[i] !== '--no-probe') demande.push(args[i])
  }
  const texte = demande.join(' ').trim()
  if (texte === '') return null
  return { sortie: await router(texte, { exclure, sonde: !args.includes('--no-probe') }), code: 0 }
}

// Run only when invoked directly, never on import (the tests import `router` and `principal`).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  principal(process.argv.slice(2)).then((r) => {
    if (r === null) return
    console.log(JSON.stringify(r.sortie, null, 2))
    if (r.code !== 0) process.exit(r.code)
  }).catch((e) => { console.error('auto-router: ' + (e && e.message ? e.message : e)); process.exit(1) })
}
