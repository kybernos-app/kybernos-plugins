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
import { accessSync, chmodSync, constants, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { formatActiveWorkerPrompt, monterWorkers, sanitizeActiveWorker } from './workers-host.mjs'
import { harnessPath, readHarnessFile, writeHarnessFile } from './harness-store.mjs'
import { readRunsFile, runsPath, writeRunsFile } from './runtime-router.mjs'

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

/** The real I/O of the screen. Kept here so workers-host.mjs stays testable.
 * `lireCle(nom)` is optional: it answers the same question through DSH's credentials store, which is where the Workers
 * screen saves a key and which DSH never copies into its own environment. */
export function workersDeps (dshHome, env = process.env, lireCle = null) {
  const dossierProfils = join(dshHome, 'profiles')
  const patch = (profil) => join(dossierProfils, profil, 'cordis.patch.yml')
  const profils = () => {
    try { return readdirSync(dossierProfils).filter((n) => /^[A-Za-z0-9_-]+$/.test(n) && existsSync(join(dossierProfils, n, 'package.json'))) } catch { return [] }
  }
  const fichierServeur = join(dshHome, 'mcp', 'zcode-mcp-server.mjs')
  const fichierHarness = harnessPath(dshHome)
  const fichierRuns = runsPath(dshHome)
  const fichierActif = join(dshHome, 'kybernos-workers', 'active-worker.json')
  const fichierChecks = join(dshHome, 'kybernos-workers', 'checks.json')
  const lireChecks = () => {
    try {
      if (!existsSync(fichierChecks)) return {}
      const parsed = JSON.parse(readFileSync(fichierChecks, 'utf8'))
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch { return {} }
  }
  const ecrireChecks = (obj) => {
    mkdirSync(dirname(fichierChecks), { recursive: true })
    const tmp = fichierChecks + '.tmp-' + process.pid
    writeFileSync(tmp, JSON.stringify(obj ?? {}, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
    renameSync(tmp, fichierChecks)
    try { chmodSync(fichierChecks, 0o600) } catch { /* best-effort */ }
  }
  const lireActiveWorker = () => {
    try {
      if (!existsSync(fichierActif)) return null
      return sanitizeActiveWorker(JSON.parse(readFileSync(fichierActif, 'utf8')))
    } catch { return null }
  }
  const ecrireActiveWorker = (val) => {
    if (val === null) {
      try { if (existsSync(fichierActif)) rmSync(fichierActif, { force: true }) } catch { /* ignore */ }
      return
    }
    mkdirSync(dirname(fichierActif), { recursive: true })
    const tmp = fichierActif + '.tmp-' + process.pid
    writeFileSync(tmp, JSON.stringify(val, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
    renameSync(tmp, fichierActif)
    try { chmodSync(fichierActif, 0o600) } catch { /* best-effort */ }
  }
  const fetchJson = async (url, headers = {}) => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 10000)
    if (typeof timer.unref === 'function') timer.unref()
    try {
      const r = await fetch(url, { headers: { accept: 'application/json', ...headers }, signal: ctrl.signal })
      if (!r.ok) return null
      return await r.json()
    } catch { return null } finally { clearTimeout(timer) }
  }
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
    lireHarness: () => readHarnessFile(fichierHarness),
    ecrireHarness: (h) => writeHarnessFile(fichierHarness, h),
    lireRuns: () => readRunsFile(fichierRuns),
    ecrireRuns: (s) => writeRunsFile(fichierRuns, s),
    lireActiveWorker,
    ecrireActiveWorker,
    lireChecks,
    ecrireChecks,
    maintenant: () => new Date(),
    io: {
      fichierServeur,
      paquetInstalle: (profil, paquet) => {
        try { return existsSync(join(dossierProfils, profil, 'node_modules', paquet)) } catch { return false }
      },
      fichierExiste: (chemin) => { try { return chemin !== '' && existsSync(chemin) } catch { return false } },
      trouver: async (binaire) => trouverBinaire(binaire, env),
      executer: (binaire, args, opts) => {
        const baseEnv = envSansSecrets(env)
        if (opts?.extraEnv && typeof opts.extraEnv === 'object') {
          for (const [k, v] of Object.entries(opts.extraEnv)) {
            if (!SECRET.test(k) && typeof v === 'string') baseEnv[k] = v
          }
        }
        return executer(binaire, args, { delaiMs: opts?.delaiMs, env: baseEnv })
      },
      fetchJson,
      homeDir: typeof env.HOME === 'string' && env.HOME.trim() !== '' ? env.HOME.trim() : homedir(),
      lireCle: async (nom) => {
        if (typeof lireCle === 'function') {
          try {
            const v = await lireCle(nom)
            if (typeof v === 'string' && v.trim() !== '') return v.trim()
          } catch { /* fall through to launch env */ }
        }
        return typeof env[nom] === 'string' && env[nom].trim() !== '' ? env[nom].trim() : undefined
      },
      worktreeJetable: () => worktreeJetable(),
      // Names only: the VALUE of a key never leaves this function (the store is checked before launch env, matching cleDuRun).
      cleDansEnv: async (noms) => {
        if (typeof lireCle === 'function') {
          for (const nom of noms) {
            const v = await lireCle(nom)
            if (typeof v === 'string' && v.trim() !== '') return true
          }
        }
        return noms.some((n) => typeof env[n] === 'string' && env[n].trim() !== '')
      },
      plateforme: () => process.platform,
      lancerInstallation: (commande, opts) => lancerInstallation(commande, { ...opts, env })
    }
  }
}

// What `register` hands back takes the route off again. It is kept here and given to `ctx.effect` by `apply`, so that unloading the plugin removes every route it
// added: without it a hot reload met « duplicate exact route », logged « routes not mounted » and went on serving the OLD handlers (audit L4-05, L6-04).
const kbRetraits = []
const kbRetirerRoutes = () => { for (const retrait of kbRetraits.splice(0).reverse()) { try { retrait() } catch (e) { /* already gone */ } } }
/** `service` with a `register` that keeps the way to remove each route it adds (see kbRetirerRoutes). */
const kbSuivi = (service) => (service === null || service === undefined || typeof service.register !== 'function'
  ? service
  : new Proxy(service, { get: (target, key) => (key === 'register' ? (route) => { const retrait = target.register(route); if (typeof retrait === 'function') kbRetraits.push(retrait); return retrait } : (typeof target[key] === 'function' ? target[key].bind(target) : target[key])) }))

export function apply (ctx) {
  if (ctx !== null && ctx !== undefined && typeof ctx.effect === 'function') ctx.effect(() => kbRetirerRoutes, 'kybernos-workers: routes')
  try {
    const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
    const liens = { effect: (fn, etiquette) => ctx.effect(fn, etiquette) }
    const lireCle = async (nom) => {
      try {
        const magasin = ctx.credentials
        if (magasin === undefined || magasin === null || typeof magasin.resolve !== 'function') return undefined
        const r = await magasin.resolve(nom)
        return typeof r === 'string' ? r : r?.value
      } catch { return undefined }
    }
    const deps = workersDeps(dshHome, process.env, lireCle)
    const monter = (webServer) => {
      try { monterWorkers(kbSuivi(webServer), deps, liens); dire('routes mounted') } catch (erreur) { dire('routes not mounted: ' + String(erreur?.message ?? erreur)) }
    }
    if (ctx.get('webServer') !== undefined) monter(ctx.get('webServer'))
    else ctx.inject(['webServer'], (hote) => monter(hote.webServer))
    // Inject active Composer worker delegation directive on top-level turns only (never child subagent sessions).
    const isChildSession = (agent) => {
      try {
        const sid = agent?.session?.id ?? agent?.sessionId ?? ''
        if (typeof sid !== 'string' || sid === '') return false
        const store = ctx.get('sessions')
        const sess = store && typeof store.get === 'function' ? store.get(sid) : undefined
        return typeof sess?.header?.parentSession === 'string' && sess.header.parentSession !== ''
      } catch { return false }
    }
    const attachSystemPrompt = (sp) => {
      if (!sp || typeof sp.context !== 'function') return
      sp.context({
        name: 'kybernos-workers:active-worker',
        order: 160,
        interpolate: false,
        required: true,
        text: (context) => {
          try {
            if (isChildSession(context?.agent)) return ''
            return formatActiveWorkerPrompt(deps.lireActiveWorker())
          } catch { return '' }
        }
      })
      dire('active-worker systemPrompt context mounted')
    }
    try {
      if (ctx.get('systemPrompt') !== undefined) attachSystemPrompt(ctx.get('systemPrompt'))
      else if (typeof ctx.inject === 'function') ctx.inject(['systemPrompt'], (scope) => { try { attachSystemPrompt(scope?.systemPrompt) } catch { /* ignore */ } })
    } catch (erreur) { dire('active-worker systemPrompt not injected: ' + String(erreur?.message ?? erreur)) }
  } catch (erreur) {
    dire('disabled: ' + String(erreur?.message ?? erreur))
  }
}
