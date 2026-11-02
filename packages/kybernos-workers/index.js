// ═══════════════════════════════════════════════════════
// kybernos-workers — host half.
//
// The "Workers" screen (Settings): VERIFIED state of the external coding agents and the
// common policy. The logic lives in workers-host.mjs (testable without DSH); this file only
// plugs in the real I/O:
//   · the profile patch  ~/.dsh/profiles/<profile>/cordis.patch.yml
//   · the processes (`claude`, `codex`, `gemini`, `git`…) run with DSH's PATH and an
//     environment WITHOUT secret-looking variables, as the official connections do (otherwise
//     a token DSH happens to hold would make a worker look "signed in" while the worker
//     itself would not see it)
//   · the install of a program, from a closed list of commands (see workers-host.mjs)
//
// No model call: checking spends nothing on the worker's subscription.
// Everything in apply() is guarded: an error here must never stop DSH from starting.
// No @deepseek-ai/* import (an @local/… plugin does not resolve them).
// ═══════════════════════════════════════════════════════

import { execFile, spawn } from 'node:child_process'
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { monterWorkers } from './workers-host.mjs'

export const name = 'kybernos-workers'

const dire = (message) => console.log('[kybernos-workers] ' + message)

const SECRET = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|COOKIE|AUTH)/i

/** Environment handed to the checks: DSH's own, minus anything that looks like a secret. */
export function envSansSecrets (env) {
  const sortie = {}
  for (const [k, v] of Object.entries(env)) if (!SECRET.test(k) && typeof v === 'string') sortie[k] = v
  return sortie
}

/** Looks an executable up in DSH's PATH (and nowhere else: that is what the connection sees). */
export function trouverBinaire (binaire, env = process.env, plateforme = process.platform) {
  const exts = plateforme === 'win32' ? String(env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : ['']
  for (const dossier of String(env.PATH || '').split(delimiter)) {
    if (dossier === '') continue
    for (const ext of exts) {
      const candidat = join(dossier, binaire + ext)
      try {
        if (statSync(candidat).isFile()) { accessSync(candidat, constants.X_OK); return candidat }
      } catch { /* next */ }
    }
  }
  return null
}

const executer = (binaire, args, { delaiMs = 20000, cwd, env } = {}) => new Promise((resolve) => {
  try {
    const enfant = execFile(binaire, args, { timeout: delaiMs, maxBuffer: 1024 * 1024, cwd, env: env ?? envSansSecrets(process.env), windowsHide: true }, (erreur, sortie, err) => {
      const texte = String(sortie ?? '') + String(err ?? '')
      if (!erreur) return resolve({ code: 0, sortie: texte })
      if (erreur.code === 'ENOENT') return resolve({ code: 127, sortie: texte, absent: true })
      if (erreur.killed === true || erreur.signal === 'SIGTERM') return resolve({ code: 1, sortie: texte, delai: true })
      resolve({ code: typeof erreur.code === 'number' ? erreur.code : 1, sortie: texte })
    })
    enfant.stdin?.end()
  } catch (e) { resolve({ code: 1, sortie: String(e?.message ?? e), absent: true }) }
})

/** A throw-away git repository, a worktree in it, a file written then read back. Always cleans up. */
export async function worktreeJetable (lancer = executer) {
  let dossier = null
  try {
    dossier = mkdtempSync(join(tmpdir(), 'kybernos-workers-'))
    const depot = join(dossier, 'depot')
    const arbre = join(dossier, 'arbre')
    mkdirSync(depot)
    const git = (args, cwd) => lancer('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=kybernos', '-c', 'user.email=kybernos@localhost', ...args], { cwd, delaiMs: 30000 })
    const v = await git(['--version'], depot)
    if (v.absent === true) return { ok: false, detail: 'git not found in DSH’s PATH' }
    const init = await git(['init', '-q'], depot)
    if (init.code !== 0) return { ok: false, detail: 'git init: ' + String(init.sortie).trim().split('\n')[0] }
    writeFileSync(join(depot, 'a.txt'), 'a\n')
    for (const etape of [['add', 'a.txt'], ['commit', '-q', '--no-verify', '-m', 'init'], ['worktree', 'add', '-q', '-b', 'kybernos-controle', arbre]]) {
      const r = await git(etape, depot)
      if (r.code !== 0) return { ok: false, detail: 'git ' + etape[0] + ': ' + String(r.sortie).trim().split('\n')[0] }
    }
    writeFileSync(join(arbre, 'b.txt'), 'ecriture\n')
    if (readFileSync(join(arbre, 'b.txt'), 'utf8') !== 'ecriture\n') return { ok: false, detail: 'the file read back differs from the one written' }
    return { ok: true, detail: String(v.sortie).trim().split('\n')[0] }
  } catch (e) {
    return { ok: false, detail: String(e?.message ?? e) }
  } finally {
    if (dossier !== null) { try { rmSync(dossier, { recursive: true, force: true }) } catch { /* temp folder: the OS will clean it */ } }
  }
}

const INSTALL_DELAI_MS = 15 * 60 * 1000

/**
 * Runs one install command through `/bin/sh -c`, feeding every chunk of output to `surDonnees`.
 * The command is a CONSTANT of workers-host.mjs, never text from a request. Killed after
 * `delaiMs` (SIGTERM, then SIGKILL) — to the whole process GROUP, because `curl … | bash` is two processes and signalling
 * the shell alone would leave both running. Resolves { code, delai? } and never rejects.
 */
export function lancerInstallation (commande, { surDonnees = () => {}, delaiMs = INSTALL_DELAI_MS, env = process.env, cwd = tmpdir() } = {}) {
  return new Promise((resolve) => {
    let enfant
    try {
      enfant = spawn('/bin/sh', ['-c', commande], { cwd, env: envSansSecrets(env), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: true })
    } catch (e) { return resolve({ code: 1, erreur: String(e?.message ?? e) }) }
    let delai = false
    let fin = false
    const tuer = (signal) => {
      try { process.kill(-enfant.pid, signal) } catch { try { enfant.kill(signal) } catch { /* already gone */ } }
    }
    const minuteur = setTimeout(() => {
      delai = true
      tuer('SIGTERM')
      const dur = setTimeout(() => tuer('SIGKILL'), 5000)
      if (typeof dur.unref === 'function') dur.unref()
    }, delaiMs)
    if (typeof minuteur.unref === 'function') minuteur.unref()
    const donner = (d) => { try { surDonnees(String(d)) } catch { /* the log is a courtesy */ } }
    enfant.stdout.on('data', donner)
    enfant.stderr.on('data', donner)
    enfant.on('error', (e) => { if (fin) return; fin = true; clearTimeout(minuteur); donner(String(e?.message ?? e) + '\n'); resolve({ code: 127, erreur: String(e?.message ?? e) }) })
    enfant.on('close', (code, signal) => { if (fin) return; fin = true; clearTimeout(minuteur); resolve({ code: typeof code === 'number' ? code : 1, signal, ...(delai ? { delai: true } : {}) }) })
  })
}

/** The real I/O of the screen. Kept here so workers-host.mjs stays testable. */
export function workersDeps (dshHome, env = process.env) {
  const dossierProfils = join(dshHome, 'profiles')
  const patch = (profil) => join(dossierProfils, profil, 'cordis.patch.yml')
  const profils = () => {
    try { return readdirSync(dossierProfils).filter((n) => /^[A-Za-z0-9_-]+$/.test(n) && existsSync(join(dossierProfils, n, 'package.json'))) } catch { return [] }
  }
  const fichierServeur = join(dshHome, 'mcp', 'zcode-mcp-server.mjs')
  return {
    profils,
    profilParDefaut: (liste) => {
      const e = env.DSH_PROFILE
      if (typeof e === 'string' && liste.includes(e)) return e
      return liste.includes('web') ? 'web' : (liste[0] ?? 'web')
    },
    lirePatch: (profil) => { try { return readFileSync(patch(profil), 'utf8') } catch { return null } },
    ecrirePatch: (profil, texte) => {
      const tmp = patch(profil) + '.tmp-' + process.pid
      writeFileSync(tmp, texte, 'utf8')
      renameSync(tmp, patch(profil))
    },
    sauvegarder: (profil, nom, contenu) => writeFileSync(join(dossierProfils, profil, nom), contenu, 'utf8'),
    cheminPatch: patch,
    maintenant: () => new Date(),
    io: {
      fichierServeur,
      paquetInstalle: (profil, paquet) => {
        try { return existsSync(join(dossierProfils, profil, 'node_modules', paquet)) } catch { return false }
      },
      fichierExiste: (chemin) => { try { return chemin !== '' && existsSync(chemin) } catch { return false } },
      trouver: async (binaire) => trouverBinaire(binaire, env),
      executer: (binaire, args, opts) => executer(binaire, args, { delaiMs: opts?.delaiMs, env: envSansSecrets(env) }),
      worktreeJetable: () => worktreeJetable(),
      // Names only: the VALUE of a key never leaves this function.
      cleDansEnv: (noms) => noms.some((n) => typeof env[n] === 'string' && env[n].trim() !== ''),
      plateforme: () => process.platform,
      lancerInstallation: (commande, opts) => lancerInstallation(commande, { ...opts, env })
    }
  }
}

export function apply (ctx) {
  try {
    const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
    const liens = { effect: (fn, etiquette) => ctx.effect(fn, etiquette) }
    const monter = (webServer) => {
      try { monterWorkers(webServer, workersDeps(dshHome), liens); dire('routes mounted') } catch (erreur) { dire('routes not mounted: ' + String(erreur?.message ?? erreur)) }
    }
    if (ctx.get('webServer') !== undefined) monter(ctx.get('webServer'))
    else ctx.inject(['webServer'], (hote) => monter(hote.webServer))
  } catch (erreur) {
    dire('disabled: ' + String(erreur?.message ?? erreur))
  }
}
