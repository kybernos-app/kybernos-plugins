// ═══════════════════════════════════════════════════════
// kybernos-workers — moitié hôte.
//
// Écran « Workers » (Réglages) : état VÉRIFIÉ des agents de code externes et
// politique commune. La logique est dans workers-host.mjs (testable sans DSH) ;
// ce fichier ne fait que brancher la vraie E/S :
//   · le patch du profil  ~/.dsh/profiles/<profil>/cordis.patch.yml
//   · les processus (`claude`, `codex`, `git`) lancés avec le PATH de DSH et un
//     environnement SANS variables « secrètes », comme le font les connexions
//     officielles (sinon un jeton présent chez DSH ferait croire « connecté »
//     alors que le worker, lui, ne le verrait pas).
//
// Aucun appel de modèle : vérifier ne consomme pas l'abonnement du worker.
// Tout apply() est protégé : une erreur ici ne doit jamais empêcher DSH de démarrer.
// Aucun import @deepseek-ai/* (un plugin @local/… ne les résout pas).
// ═══════════════════════════════════════════════════════

import { execFile } from 'node:child_process'
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { monterWorkers } from './workers-host.mjs'

export const name = 'kybernos-workers'

const dire = (message) => console.log('[kybernos-workers] ' + message)

const SECRET = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|COOKIE|AUTH)/i

/** Environnement transmis aux contrôles : celui de DSH, sans rien qui ressemble à un secret. */
export function envSansSecrets (env) {
  const sortie = {}
  for (const [k, v] of Object.entries(env)) if (!SECRET.test(k) && typeof v === 'string') sortie[k] = v
  return sortie
}

/** Cherche un exécutable dans le PATH de DSH (et nulle part ailleurs : c'est ce que voit la connexion). */
export function trouverBinaire (binaire, env = process.env, plateforme = process.platform) {
  const exts = plateforme === 'win32' ? String(env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : ['']
  for (const dossier of String(env.PATH || '').split(delimiter)) {
    if (dossier === '') continue
    for (const ext of exts) {
      const candidat = join(dossier, binaire + ext)
      try {
        if (statSync(candidat).isFile()) { accessSync(candidat, constants.X_OK); return candidat }
      } catch { /* suivant */ }
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

/** Un dépôt git jetable, un worktree dedans, un fichier écrit puis relu. Nettoie toujours. */
export async function worktreeJetable (lancer = executer) {
  let dossier = null
  try {
    dossier = mkdtempSync(join(tmpdir(), 'kybernos-workers-'))
    const depot = join(dossier, 'depot')
    const arbre = join(dossier, 'arbre')
    mkdirSync(depot)
    const git = (args, cwd) => lancer('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=kybernos', '-c', 'user.email=kybernos@localhost', ...args], { cwd, delaiMs: 30000 })
    const v = await git(['--version'], depot)
    if (v.absent === true) return { ok: false, detail: 'git introuvable dans le PATH de DSH' }
    const init = await git(['init', '-q'], depot)
    if (init.code !== 0) return { ok: false, detail: 'git init : ' + String(init.sortie).trim().split('\n')[0] }
    writeFileSync(join(depot, 'a.txt'), 'a\n')
    for (const etape of [['add', 'a.txt'], ['commit', '-q', '--no-verify', '-m', 'init'], ['worktree', 'add', '-q', '-b', 'kybernos-controle', arbre]]) {
      const r = await git(etape, depot)
      if (r.code !== 0) return { ok: false, detail: 'git ' + etape[0] + ' : ' + String(r.sortie).trim().split('\n')[0] }
    }
    writeFileSync(join(arbre, 'b.txt'), 'ecriture\n')
    if (readFileSync(join(arbre, 'b.txt'), 'utf8') !== 'ecriture\n') return { ok: false, detail: 'relecture différente de l’écriture' }
    return { ok: true, detail: String(v.sortie).trim().split('\n')[0] }
  } catch (e) {
    return { ok: false, detail: String(e?.message ?? e) }
  } finally {
    if (dossier !== null) { try { rmSync(dossier, { recursive: true, force: true }) } catch { /* temp: l'OS nettoiera */ } }
  }
}

/** La vraie E/S de l'écran. Gardée ici pour que workers-host.mjs reste testable. */
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
      worktreeJetable: () => worktreeJetable()
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
