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
import { URL_PAR_DEFAUT } from './catalogue-distant.mjs'
import { plateformeDe } from './suite-host.mjs'
import { creerTelechargeurs } from './telechargement.mjs'

export const name = 'kybernos-hub'

const FICHIER_ACTIVATION = 'satellites-actives.json'

// The real I/O of the Suite panel. Kept here (not in suite-host.mjs) so the logic stays testable.
const FICHIER_CATALOGUE_DISTANT = 'catalogue-distant.json'

function suiteDeps (dshHome, hub) {
  const ici = dirname(fileURLToPath(import.meta.url))
  const racineDepot = join(ici, '..', '..')
  const dossierKb = join(dshHome, 'kybernos')
  const cache = join(dossierKb, FICHIER_CATALOGUE_DISTANT)
  const ecrireAtomique = (fichier, contenu) => {
    mkdirSync(dirname(fichier), { recursive: true })
    const tmp = fichier + '.tmp-' + process.pid
    writeFileSync(tmp, contenu)
    renameSync(tmp, fichier)
  }
  const telechargeurs = creerTelechargeurs()
  const catalogue = JSON.parse(readFileSync(join(ici, 'catalog.json'), 'utf8'))
  const fichier = join(dshHome, 'kybernos', FICHIER_ACTIVATION)
  const robot = join(ici, '..', '..', 'scripts', 'dsh-lifecycle.mjs')
  const relance = join(dshHome, 'tools', 'dsh-relance.mjs')
  return {
    catalogue,
    hub,
    lireActivation: () => { try { return JSON.parse(readFileSync(fichier, 'utf8')) } catch { return null } },
    // ── the online (signed) catalogue and the suite update: see catalogue-distant.mjs and suite-host.mjs ──
    // The public key(s) this bundle trusts. None installed = the online catalogue is never asked for.
    cles: () => { try { const j = JSON.parse(readFileSync(join(ici, 'catalog-pubkey.json'), 'utf8')); return Array.isArray(j.cles) ? j.cles : [] } catch { return [] } },
    versionSuite: () => { try { return readFileSync(join(racineDepot, 'VERSION'), 'utf8').trim() } catch { return '0.0.0' } },
    // The setting `catalogueUrl` of ~/.dsh/kybernos/settings.json overrides the default (an empty string turns the online catalogue off).
    urlCatalogue: () => {
      try {
        const v = JSON.parse(readFileSync(join(dossierKb, 'settings.json'), 'utf8')).catalogueUrl
        if (typeof v === 'string') return v.trim()
      } catch { /* the default applies */ }
      return URL_PAR_DEFAUT
    },
    lireCache: () => {
      try { return { octets: readFileSync(cache), signature: readFileSync(cache + '.sig', 'utf8') } } catch { return null }
    },
    ecrireCache: ({ octets, signature }) => { ecrireAtomique(cache, octets); ecrireAtomique(cache + '.sig', signature) },
    telecharger: telechargeurs.telecharger,
    telechargerVers: telechargeurs.telechargerVers,
    extraire: telechargeurs.extraire,
    nettoyer: telechargeurs.nettoyer,
    // The robot that ships INSIDE the verified archive installs it (the same contract as running ./kybernos-update by hand).
    executerArchive: (racine) => new Promise((resolve) => {
      execFile(process.execPath, [join(racine, 'scripts', 'dsh-lifecycle.mjs'), 'upgrade', '--source', racine], { env: { ...process.env, DSH_HOME: dshHome }, timeout: 20 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 },
        (erreur, sortie, err) => resolve({ code: erreur ? (typeof erreur.code === 'number' ? erreur.code : 1) : 0, sortie: String(sortie ?? '') + String(err ?? '') }))
    }),
    // A git working tree is a development checkout: it is updated with git, never by replacing it with an archive.
    racineDev: () => existsSync(join(racineDepot, '.git')),
    plateforme: plateformeDe(process.platform),
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
