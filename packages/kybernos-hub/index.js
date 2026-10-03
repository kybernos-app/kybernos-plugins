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
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { creerHub, monterRoutes, monterSuite } from './hub-host.mjs'

export const name = 'kybernos-hub'

const FICHIER_ACTIVATION = 'satellites-actives.json'

// The real I/O of the Suite panel. Kept here (not in suite-host.mjs) so the logic stays testable.
function suiteDeps (dshHome, hub) {
  const ici = dirname(fileURLToPath(import.meta.url))
  const catalogue = JSON.parse(readFileSync(join(ici, 'catalog.json'), 'utf8'))
  const fichier = join(dshHome, 'kybernos', FICHIER_ACTIVATION)
  const robot = join(ici, '..', '..', 'scripts', 'dsh-lifecycle.mjs')
  const relance = join(dshHome, 'tools', 'dsh-relance.mjs')
  return {
    catalogue,
    hub,
    lireActivation: () => { try { return JSON.parse(readFileSync(fichier, 'utf8')) } catch { return null } },
    ecrireActivation: (obj) => {
      mkdirSync(dirname(fichier), { recursive: true })
      const tmp = fichier + '.tmp-' + process.pid
      writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n')
      renameSync(tmp, fichier)
    },
    executer: (argv) => new Promise((resolve, reject) => {
      if (!existsSync(robot)) { reject(new Error('lifecycle robot not found next to this bundle (' + robot + ')')); return }
      execFile(process.execPath, [robot, ...argv], { env: { ...process.env, DSH_HOME: dshHome }, timeout: 10 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 },
        (erreur, sortie, err) => resolve({ code: erreur ? (typeof erreur.code === 'number' ? erreur.code : 1) : 0, sortie: String(sortie ?? '') + String(err ?? '') }))
    }),
    // Detached, like the relaunch tool: DSH stops itself, the child survives and brings it back.
    relancer: async () => {
      if (!existsSync(relance)) return { ok: false, error: 'relaunch-tool-missing' }
      const enfant = spawn(process.execPath, [relance, 'relance', '--avec-autres'], { detached: true, stdio: 'ignore', env: { ...process.env, DSH_HOME: dshHome } })
      enfant.unref()
      return { ok: true }
    }
  }
}

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
      // The Suite panel is separate from the boot guard: if it cannot start, the guard above still runs.
      try { monterSuite(webServer, suiteDeps(dshHome, hub), liens); dire('suite routes mounted') } catch (erreur) { dire('suite routes not mounted: ' + String(erreur?.message ?? erreur)) }
    }
    if (ctx.get('webServer') !== undefined) monter(ctx.get('webServer'))
    else ctx.inject(['webServer'], (hote) => monter(hote.webServer))
  } catch (erreur) {
    dire('hub disabled: ' + String(erreur?.message ?? erreur))
  }
}
