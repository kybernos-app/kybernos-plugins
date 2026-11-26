#!/usr/bin/env node
// Ramasse les RESTES des harnais de test locaux : deux fuites mesurées le 1er/11/2026.
//
//   1. Un Chrome headless lancé par scripts/live-page.mjs avec un profil jetable
//      (`--user-data-dir=.../kb-live-*`) est resté 10 h 40 orphelin après qu'un test a planté
//      avant son `live.close()` : il redessinait la GUI 3080 en boucle à ~60 % d'un cœur, sans
//      une ligne de log et sans erreur. Personne ne le voyait.
//   2. Un `dsh web` de bac à sable (scripts/sandbox/start.sh, port 3098) a été démarré à vide
//      et jamais arrêté : `stop.sh` existe, mais rien ne le réclame quand l'appelant oublie.
//
// Ce balayeur ne devine pas : il ne touche QUE ce qu'il peut prouver orphelin.
//   · Chrome headless : profil JETABLE (kb-live-*, ou un dossier temporaire /var/folders, /tmp,
//     /private/tmp), AUCUNE connexion ESTABLISHED sur son port de debug, et plus vieux que
//     --idle minutes (sinon un test est peut-être en train de démarrer). Un profil persistant
//     n'est jamais candidat, même headless.
//   · Bac à sable : sandbox.pid vivant, ligne de commande qui porte bien `--profile web --port N`,
//     port JAMAIS 3080, et soit plus vieux que --ttl minutes, soit sans client et sans activité
//     de log depuis --idle minutes, ou pid périmé (alors on nettoie seulement les fichiers).
//
// DRY-RUN par défaut : sans --exec, il dit ce qu'il ferait et ne tue rien.
//
//   node scripts/restes-de-tests.mjs                  # constat
//   node scripts/restes-de-tests.mjs --exec           # ramasse
//   node scripts/restes-de-tests.mjs --exec --idle 5 --ttl 60
//   node scripts/restes-de-tests.mjs --json --exec
//
// Exit code toujours 0 : un balayeur qui échoue ne doit jamais casser un boot.

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const at = args.indexOf('--' + name)
  return at >= 0 && args[at + 1] !== undefined ? Number(args[at + 1]) : fallback
}
const EXEC = args.includes('--exec')
const JSON_OUT = args.includes('--json')
const QUIET = args.includes('--quiet')
const IDLE = Number.isFinite(opt('idle', 10)) ? opt('idle', 10) : 10 // minutes
const TTL = Number.isFinite(opt('ttl', 180)) ? opt('ttl', 180) : 180 // minutes
const HOME = homedir()

const run = (cmd, argv) => {
  try { return execFileSync(cmd, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 }) } catch (e) {
    return typeof e.stdout === 'string' ? e.stdout : ''
  }
}
const sh = (line) => run('/bin/sh', ['-c', line])
const alive = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return false } }
const say = (line) => { if (QUIET !== true) console.log(line) }

/** `ps -Ao pid=,ppid=,etime=,command=` une fois, parsé une fois. */
// etime est `[[jj-]hh:]mm:ss` : sa LONGUEUR change (00:04 = 4 s, 12:34:56 = 12 h). Le lire en
// déstructurant trois champs faisait passer 4 secondes pour 4 minutes — et un test tout juste
// lancé pour un orphelin de plusieurs heures (mesuré : Chrome jetable de 4 s annoncé à 4 min).
const dureeEnSecondes = (etime) => {
  const [jours, reste] = etime.includes('-') ? etime.split('-') : [null, etime]
  const champs = reste.split(':').map(Number).filter((n) => Number.isFinite(n))
  const sec = champs.length === 3 ? champs[0] * 3600 + champs[1] * 60 + champs[2]
    : champs.length === 2 ? champs[0] * 60 + champs[1]
      : (champs[0] || 0)
  return (jours ? Number(jours) * 86400 : 0) + sec
}

const processes = () => sh('ps -Ao pid=,ppid=,etime=,command=').split('\n').map((line) => {
  const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line)
  if (m === null) return null
  const [, pid, ppid, etime, command] = m
  const parts = command.split(/\s+/)
  const secondes = dureeEnSecondes(etime)
  return { pid: Number(pid), ppid: Number(ppid), etime, ageMin: secondes / 60, command, args: parts }
}).filter((p) => p !== null)

/** Les connexions clientes (ESTABLISHED) ouvertes sur un port. */
const clientsOn = (port) => {
  const out = sh('lsof -nP -iTCP:' + port + ' -sTCP:ESTABLISHED 2>/dev/null')
  return out.split('\n').filter((l) => l.trim() !== '' && !/^COMMAND/.test(l)).length
}

/** Le pid nous appartient-il vraiment ? Garde-fou : jamais lancer un kill sur un pid inconnu. */
const ownerOf = (pid) => {
  const out = run('/bin/ps', ['-o', 'user=', '-p', String(pid)]).trim()
  try { return out !== '' && run('/usr/bin/id', ['-un']).trim() === out } catch (e) { return false }
}

const results = []
const note = (kind, what, action, detail) => {
  results.push({ kind, what, action, detail })
  say((action === 'kil' ? '  ✂ ' : '  · ') + what + ' — ' + detail)
}

// ── 1. Chromes headless orphelins des tests ─────────────────────────────────
// Deux familles rencontrées le 01-02/11/2026 : les profils `kb-live-*` de scripts/live-page.mjs,
// et les profils jetables des outils de test (puppeteer / Chrome for Testing) sous /var/folders,
// /tmp, /private/tmp. Un profil PERSISTANT — le Chrome de quelqu'un — n'est jamais candidat :
// sans dossier temporaire, on ne regarde même pas. Un headless sans client depuis --idle minutes
// ne fait plus rien pour personne : c'est le même orphelin dans les deux familles.
const profilTemporaire = (p) => {
  if (/--headless(=new)?(\s|$)/.test(p.command) !== true) return null
  if (p.command.includes('--type=') === true) return null // un helper, pas le processus principal
  const chemin = (/--user-data-dir=(\S+)/.exec(p.command) || [])[1]
  if (chemin === undefined) return null
  const base = (chemin.split('/').pop() || '').replace(/^["']|["']$/g, '')
  const jetable = /^kb-live/.test(base) ||
    /^file:\/\/\/(var\/folders|tmp|private\/tmp|var\/tmp)\//.test(chemin) ||
    /^(\/var\/folders\/|\/tmp\/|\/private\/tmp\/|\/var\/tmp\/)/.test(chemin)
  return jetable === true ? { chemin, base } : null
}

const chromes = processes().map((p) => {
  const profil = profilTemporaire(p)
  return profil === null ? null : Object.assign({}, p, profil)
}).filter((p) => p !== null)

// Un même navigateur apparaît plusieurs fois dans `ps` (le binaire lancé et le processus
// principal partagent le profil) : on regroupe par profil pour ne compter qu'un orphelin et
// pour tuer toute la famille d'un coup.
const groupes = new Map()
for (const p of chromes) {
  if (groupes.has(p.chemin) !== true) groupes.set(p.chemin, [])
  groupes.get(p.chemin).push(p)
}

for (const [, liste] of groupes) {
  const base = liste[0].base
  const pids = liste.map((x) => x.pid).filter((pid) => ownerOf(pid) === true)
  if (pids.length === 0) continue // jamais un pid qui n'est pas à moi
  const ports = [...new Set(liste.map((x) => Number((/--remote-debugging-port=(\d+)/.exec(x.command) || [])[1] || 0)))]
  const clients = ports.reduce((n, port) => n + (port > 0 ? clientsOn(port) : 0), 0)
  const ageMin = Math.max(...liste.map((x) => x.ageMin))
  const portTxt = ports.filter((p) => p > 0).join(', ') || 'aucun'
  const nom = 'Chrome headless ' + base + ' (pid ' + pids.join('+') + ')'
  // Un client connecté = un test le pilote en ce moment : on n'y touche pas.
  if (clients > 0) { note('chrome', nom, 'garde', 'pilote par ' + clients + ' client(s) sur ' + portTxt); continue }
  if (ageMin < IDLE) { note('chrome', nom, 'garde', 'trop jeune (' + Math.round(ageMin) + ' min < ' + IDLE + ')'); continue }
  const detail = Math.round(ageMin) + ' min, aucun client (' + portTxt + '), profil ' + base
  if (EXEC === true) {
    for (const pid of pids) { try { process.kill(pid, 'SIGTERM') } catch (e) { /* déjà parti */ } }
    for (let i = 0; i < 20 && pids.some((pid) => alive(pid)); i++) sh('sleep 0.25')
    for (const pid of pids) if (alive(pid)) { try { process.kill(pid, 'SIGKILL') } catch (e) { /* parti */ } }
    note('chrome', nom, 'kil', detail + ' → tué')
  } else {
    note('chrome', nom, 'tuer', detail)
  }
}

// ── 2. Bacs à sable DSH laissés ouverts ─────────────────────────────────────
const racine = join(HOME, '.kybernos-sandbox')
let etats = []
try { etats = readdirSync(racine).map((n) => join(racine, n)) } catch (e) { etats = [] }

for (const etat of etats) {
  const pidFile = join(etat, 'sandbox.pid')
  const portFile = join(etat, 'sandbox.port')
  const logFile = join(etat, 'sandbox.log')
  if (existsSync(pidFile) !== true) continue
  const pid = Number(readFileSync(pidFile, 'utf8').trim() || 0)
  const port = existsSync(portFile) ? readFileSync(portFile, 'utf8').trim() : ''
  const nom = etat.split('/').pop()

  // Le port 3080 est la vraie GUI : même un fichier périmé ne fait pas la toucher.
  if (port === '3080') { note('sandbox', nom, 'garde', 'port 3080 — jamais touché'); continue }

  if (Number.isFinite(pid) !== true || pid <= 0 || alive(pid) !== true) {
    if (EXEC === true) { rmSync(pidFile, { force: true }); rmSync(portFile, { force: true }) }
    note('sandbox', nom, EXEC ? 'kil' : 'nettoyer', 'pid périmé (' + (pid || 'illisible') + ') — fichiers de state à retirer')
    continue
  }
  if (ownerOf(pid) !== true) { note('sandbox', nom, 'garde', 'pid ' + pid + ' pas à moi'); continue }

  const p = processes().find((x) => x.pid === pid)
  const cmd = p === undefined ? '' : p.command
  if (port !== '' && (cmd.includes('--profile web') !== true || cmd.includes('--port ' + port) !== true)) {
    note('sandbox', nom, 'garde', 'pid ' + pid + " ne ressemble pas au dsh du bac à sable")
    continue
  }

  const clients = port === '' ? 0 : clientsOn(Number(port))
  if (clients > 0) { note('sandbox', nom, 'garde', 'utilisé (' + clients + ' client(s) sur ' + port + ')'); continue }

  const ageMin = p === undefined ? 0 : p.ageMin
  let dernier = 0
  try { dernier = (Date.now() - statSync(logFile).mtimeMs) / 60000 } catch (e) { dernier = TTL + 1 }
  const raisons = []
  if (ageMin >= TTL) raisons.push('démarré depuis ' + Math.round(ageMin) + ' min (TTL ' + TTL + ')')
  if (dernier >= IDLE) raisons.push('sans activité depuis ' + Math.round(dernier) + ' min et aucun client')
  if (raisons.length === 0) { note('sandbox', nom, 'garde', 'jeune (' + Math.round(ageMin) + ' min) et pas encore en veille'); continue }

  const detail = raisons.join(', ') + (port ? ' — port ' + port : '')
  if (EXEC !== true) { note('sandbox', nom, 'arreter', detail); continue }

  // Arrêt par le script du bac à sable lui-même quand on peut le retrouver (il re-vérifie tout).
  const env = run('/bin/ps', ['eww', '-p', String(pid)])
  const worktree = ((/ KB_WORKTREE=(\S+)/.exec(env) || [])[1] || '').replace(/^["']|["']$/g, '')
  const stopSh = worktree === '' ? '' : join(worktree, 'scripts/sandbox/stop.sh')
  let arrete = false
  if (stopSh !== '' && existsSync(stopSh)) {
    const sortie = run('/bin/bash', [stopSh])
    arrete = !alive(pid)
    if (arrete !== true) note('sandbox', nom, 'garde', 'stop.sh a répondu sans arrêter : ' + sortie.trim().slice(0, 120))
  }
  if (arrete !== true) {
    // Repli : même garde que stop.sh avant de tuer.
    if (cmd.includes('--profile web') !== true || (port !== '' && cmd.includes('--port ' + port) !== true)) {
      note('sandbox', nom, 'garde', 'repli refusé : ligne de commande non reconnue'); continue
    }
    try { process.kill(pid, 'SIGTERM') } catch (e) { /* parti */ }
    for (let i = 0; i < 40 && alive(pid); i++) sh('sleep 0.25')
    if (alive(pid)) { try { process.kill(pid, 'SIGKILL') } catch (e) { /* parti */ } }
    rmSync(pidFile, { force: true })
    arrete = !alive(pid)
  }
  note('sandbox', nom, arrete ? 'kil' : 'garde', detail + (arrete ? ' → arrêté' : ' → refusé'))
}

// ── rapport ─────────────────────────────────────────────────────────────────
const agis = results.filter((r) => r.action === 'kil').length
const proposes = results.filter((r) => r.action === 'tuer' || r.action === 'arreter' || r.action === 'nettoyer').length
if (JSON_OUT === true) {
  console.log(JSON.stringify({ exec: EXEC, idle: IDLE, ttl: TTL, restes: results, agis, proposes }, null, 1))
} else if (results.length === 0) {
  // Une passe qui ne trouve rien laisse quand même une trace datée dans le journal de l'agent :
  // sans ça, un journal immobile ne distingue plus « rien à faire » de « l'agent ne tourne plus ».
  if (EXEC === true) console.log(new Date().toISOString() + ' — rien à ramasser')
  else say('aucun reste de test (rien à ramasser)')
} else if (EXEC !== true) {
  console.log('\n' + proposes + ' reste(s) à ramasser — relancer avec --exec pour agir.')
} else {
  // Horodatage : le journal de l'agent (com.kybernos.restes-de-tests) sert d'audit, il doit dater ses passes.
  console.log(new Date().toISOString() + ' — ' + agis + ' reste(s) ramassé(s), ' + (results.length - agis) + ' laissé(s) en place.')
}
