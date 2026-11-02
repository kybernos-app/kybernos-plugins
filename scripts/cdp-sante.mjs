// Préflight CDP partagé par les volets navigateur.
//
// Un navigateur de debug peut ACCEPTER une connexion WebSocket et pourtant ne
// plus RIEN exécuter : quand trop d'onglets saturent le processus (relevé du
// 2026-09-21 : 46 onglets, dont 30 « planches de contrôle » d'un chantier
// parallèle), `Runtime.evaluate` ne revient jamais. Confondre cet état avec une
// régression du produit est le piège : ce module rend le diagnostic explicite et
// les volets sortent en code **3 — non concluant (environnement)**, jamais 0
// (faussement vert) ni 1 (faussement rouge).
//
//   import { etatNavigateur, refusEnvironnement } from './cdp-sante.mjs'
//   const sante = await etatNavigateur()
//   if (sante.etat !== 'ok') { refusEnvironnement(sante, 'ce volet'); process.exit(3) }
const BASE = process.env.KB_CDP || 'http://127.0.0.1:9333'
export const DELAI_PING = Number(process.env.KB_CDP_PING || 6000)

const avecDelai = (promesse, ms, quoi) => Promise.race([
  promesse,
  new Promise((_, rej) => { const t = setTimeout(() => rej(new Error('délai dépassé (' + String(ms) + ' ms) : ' + quoi)), ms); if (t.unref !== undefined) t.unref() }),
])

// Une page répond-elle ? Connexion + une évaluation triviale, sous délai.
const ping = async (cible) => {
  let ws = null
  try {
    const c = await avecDelai(fetch(BASE + '/json/list'), DELAI_PING, 'json/list')
    if (!c.ok) return false
    ws = new WebSocket(cible.webSocketDebuggerUrl)
    await avecDelai(new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true })
      ws.addEventListener('error', () => rej(new Error('websocket refusé')), { once: true })
    }), DELAI_PING, 'ouverture du WebSocket')
    const reponse = await avecDelai(new Promise((res) => {
      ws.addEventListener('message', (ev) => {
        let m = null
        try { m = JSON.parse(ev.data) } catch (e) { return }
        if (m.id === 7) res(m)
      })
      ws.send(JSON.stringify({ id: 7, method: 'Runtime.evaluate', params: { expression: '1 + 1', returnByValue: true } }))
    }), DELAI_PING, 'Runtime.evaluate de contrôle')
    return reponse.result !== undefined && reponse.result.result !== undefined && reponse.result.result.value === 2
  } catch (e) {
    return false
  } finally {
    if (ws !== null) { try { ws.close() } catch (e) { /* déjà fermé */ } }
  }
}

/**
 * État du navigateur de debug.
 * @param {{host?: string, budgetMs?: number, essais?: number}} [opts]
 * @returns {Promise<{etat: 'ok'|'muet'|'absent', total: number, parlantes: number, essais: number}>}
 */
export const etatNavigateur = async (opts) => {
  const o = opts === undefined ? {} : opts
  const filtre = o.host === undefined ? (() => true) : (t) => String(t.url || '').startsWith(String(o.host))
  let cibles = []
  try {
    const r = await avecDelai(fetch(BASE + '/json/list'), DELAI_PING, 'json/list')
    if (r.ok !== true) return { etat: 'absent', total: 0, parlantes: 0, essais: 0 }
    cibles = (await r.json()).filter((t) => t.type === 'page').filter(filtre)
  } catch (e) {
    return { etat: 'absent', total: 0, parlantes: 0, essais: 0 }
  }
  if (cibles.length === 0) return { etat: 'absent', total: 0, parlantes: 0, essais: 0 }
  const budget = o.essais === undefined ? 3 : o.essais
  let parlantes = 0
  let essais = 0
  for (const t of cibles.slice(0, budget)) {
    essais += 1
    if (await ping(t)) parlantes += 1
  }
  return { etat: parlantes > 0 ? 'ok' : 'muet', total: cibles.length, parlantes: parlantes, essais: essais }
}

// Message homogène : ce n'est pas un échec de la campagne, c'est une mesure
// impossible — et on dit pourquoi, avec le chiffre qui le prouve.
export const refusEnvironnement = (sante, quoi) => {
  if (sante.etat === 'absent') {
    console.log('  ○ ' + quoi + ' : non concluant — aucun onglet ' + (process.env.KB_CDP_URL || 'http://127.0.0.1:3080') + ' joignable sur le CDP')
    return
  }
  console.log('  ○ ' + quoi + ' : non concluant — le navigateur de debug se connecte mais n’exécute plus rien')
  console.log('     (' + String(sante.total) + ' onglet(s) vu(s), ' + String(sante.parlantes) + '/' + String(sante.essais) + ' sondé(s) répondent ; ' +
    'cause type : trop d’onglets ouverts — fermer les onglets de contrôle, puis relancer)')
}
