// ═══════════════════════════════════════════════════════
// kybernos-hub — host half.
//
// Tracks whether DSH boots lead to a working GUI (see boot-guard.mjs) and serves
// two routes:
//   GET  /kybernos-hub/state    → boot verdict + recommendation
//   POST /kybernos-hub/beacon   → {type: 'loading' | 'alive', bootId}
//
// It never edits the profile. If it sees repeated failed boots it LOGS the exact
// command to run: `node scripts/dsh-lifecycle.mjs safe-mode on`.
//
// The whole apply() is guarded: a failure here must never stop DSH from starting.
// No @deepseek-ai/* import: a plugin linked as @local/… cannot resolve them.
// ═══════════════════════════════════════════════════════

import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { FICHIER_ETAT } from './boot-guard.mjs'
import { creerHub, monterRoutes } from './hub-host.mjs'

export const name = 'kybernos-hub'

const dire = (message) => console.log('[kybernos-hub] ' + message)

export function apply (ctx) {
  try {
    const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
    const fichier = join(dshHome, 'kybernos', FICHIER_ETAT)
    const hub = creerHub({
      lire: () => { try { return JSON.parse(readFileSync(fichier, 'utf8')) } catch { return null } },
      ecrire: (etat) => {
        mkdirSync(dirname(fichier), { recursive: true })
        const tmp = fichier + '.tmp-' + process.pid
        writeFileSync(tmp, JSON.stringify(etat, null, 2) + '\n')
        renameSync(tmp, fichier)
      },
      maintenant: () => new Date().toISOString(),
      nouvelId: () => randomUUID()
    })
    const verdict = hub.demarrer()
    if (verdict.mode === 'safe') dire('safe mode is ON — only the socle is loaded. To leave it: node scripts/dsh-lifecycle.mjs safe-mode off')
    else if (verdict.mode === 'safe-recommande') {
      dire('⚠ ' + verdict.raison + '.')
      dire('  See the exact action with:  node scripts/dsh-lifecycle.mjs safe-mode status')
    }
    const liens = { effect: (fn, etiquette) => ctx.effect(fn, etiquette) }
    const monter = (webServer) => {
      try { monterRoutes(webServer, hub, liens); dire('routes mounted') } catch (erreur) { dire('routes not mounted: ' + String(erreur?.message ?? erreur)) }
    }
    if (ctx.get('webServer') !== undefined) monter(ctx.get('webServer'))
    else ctx.inject(['webServer'], (hote) => monter(hote.webServer))
  } catch (erreur) {
    dire('hub disabled: ' + String(erreur?.message ?? erreur))
  }
}
