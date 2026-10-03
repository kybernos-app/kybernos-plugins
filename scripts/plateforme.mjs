// ── La couche portable du robot de cycle de vie ─────────────────────────────
//
// Le robot a besoin de trois choses qui, jusqu'ici, étaient écrites pour macOS :
//
//   1. TROUVER LE SERVEUR VIVANT — quel pid écoute sur le port de la GUI ;
//   2. SON HEURE DE DÉMARRAGE — pour dire « le serveur est antérieur à
//      l'installation » (le mélange mémoire/disque décrit dans DIAGNOSTIC) ;
//   3. NOMMER LA SUPERVISION — LaunchAgent ici, Planificateur de tâches là,
//      unité systemd ailleurs.
//
// Ce module sépare deux choses que le robot confondait :
//
//   · la DÉCISION (quelle commande, quel analyseur) — pure, donc éprouvable
//     sur cette machine, quelle qu'elle soit ;
//   · l'EXÉCUTION — la seule partie qui ne peut être prouvée que là où elle
//     tourne.
//
// Les analyseurs (`parse*`) ne devinent rien : ils prennent la sortie BRUTE
// d'une commande et rendent un pid ou une date. Chaque famille a sa fixture
// dans `scripts/test-plateforme.mjs`. Pour macOS les fixtures sont MESURÉES sur
// cette machine ; pour Linux et Windows, elles sont des sorties FORMATÉES
// (voir `PROVENANCE`) — c'est dit pour ne pas faire passer un format
// documenté pour une mesure.
//
// Usage :
//   node scripts/plateforme.mjs --plan            # les commandes qui seraient lancées ici
//   node scripts/plateforme.mjs --sonde           # mesure réelle : serveur vivant ?
//   node scripts/plateforme.mjs --sonde --port N
//
// Sortie : 0 = mesure faite, 1 = serveur absent ou lecture impossible.
import { execFile, execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

export const PROVENANCE = Object.freeze({
  mac: 'mesuré sur cette machine (2026-09-23)',
  linux: 'format documenté (ss / netstat / proc), non mesuré ici',
  windows: 'format documenté (netstat -ano / PowerShell / wmic), non mesuré ici',
})

// ── 1. La famille d'OS ──────────────────────────────────────────────────────
export const famille = (plateforme = process.platform) => {
  if (plateforme === 'darwin') return 'mac'
  if (plateforme === 'win32') return 'windows'
  if (plateforme === 'linux') return 'linux'
  return 'autre'
}
export const estWindows = (p = process.platform) => p === 'win32'
export const estMac = (p = process.platform) => p === 'darwin'
export const estLinux = (p = process.platform) => p === 'linux'

// ── 2. Les analyseurs purs ──────────────────────────────────────────────────
// Un pid, première ligne numérique non vide. `lsof -t` rend un pid par ligne.
export const parsePidLsof = (sortie) => {
  for (const ligne of String(sortie ?? '').split('\n')) {
    const t = ligne.trim()
    if (/^\d+$/.test(t)) return t
  }
  return null
}

// `ss -ltnp` : une ligne par socket, le pid dans `users:(("node",pid=29198,fd=21))`.
export const parsePidSs = (sortie) => {
  for (const ligne of String(sortie ?? '').split('\n')) {
    const m = /pid=(\d+)/.exec(ligne)
    if (m !== null) return m[1]
  }
  return null
}

// `netstat -ano` : colonnes « Proto  Local  Distant  État  PID ». On ne prend
// qu'une ligne en écoute sur le port demandé — jamais la première venue, sinon
// un port voisin donne le pid d'un autre programme.
//
// ⚠️ Le port se compare sur la colonne d'adresse LOCALE, pas par `includes` :
// `:3080` est un préfixe de `:30801`, et un `includes` naïf rendait le pid d'un
// AUTRE programme (défaut attrapé par la fixture de `test-plateforme.mjs`).
export const parsePidNetstat = (sortie, port) => {
  const suffixe = ':' + String(port)
  for (const ligne of String(sortie ?? '').split('\n')) {
    const t = ligne.trim()
    if (t === '' || !/LISTEN(ING)?/i.test(t)) continue
    const colonnes = t.split(/\s+/)
    const local = colonnes[1]
    if (local === undefined || !local.endsWith(suffixe)) continue
    const dernier = colonnes[colonnes.length - 1]
    if (/^\d+$/.test(dernier)) return dernier
  }
  return null
}

// `ps -o lstart=` : « Wed Sep 23 18:31:20 2026 » (mesuré sur macOS ; GNU ps
// rend le même format avec la locale C).
export const parseDemarragePs = (sortie) => {
  const t = String(sortie ?? '').trim()
  if (t === '') return null
  const ms = Date.parse(t)
  return Number.isFinite(ms) ? ms : null
}

// PowerShell `(Get-Process -Id N).StartTime.ToString('o')` : ISO 8601 avec
// décalage — `Date.parse` suffit, mais on refuse une date non finie.
export const parseDemarrageIso = (sortie) => {
  const t = String(sortie ?? '').trim()
  if (t === '') return null
  const ms = Date.parse(t)
  return Number.isFinite(ms) ? ms : null
}

// `wmic process where processid=N get CreationDate` : « 20260923183120.123456+120 »
// (l'offset est en MINUTES, signe inclus).
export const parseDemarrageWmic = (sortie) => {
  const m = /(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\.(\d{1,6})([+-]\d{1,4})?/.exec(String(sortie ?? ''))
  if (m === null) return null
  const millisecondes = Math.round(Number('0.' + m[7]) * 1000)
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]), millisecondes)
  const offset = m[8] === undefined ? 0 : (m[8].startsWith('-') ? -1 : 1) * Number(m[8].slice(1)) * 60000
  return ms - offset
}

// `/proc/<pid>/stat` : le champ 22 est `starttime`, en tops depuis le démarrage.
// Le champ 2 (`comm`) peut contenir des espaces ET des parenthèses : on coupe
// donc après la DERNIÈRE parenthèse fermante, jamais au premier espace.
export const parseDemarrageProcStat = (stat, btimeMs, hz) => {
  const fin = String(stat ?? '').lastIndexOf(')')
  if (fin < 0) return null
  const champs = String(stat).slice(fin + 1).trim().split(/\s+/)
  const tops = Number(champs[22 - 3])
  if (!Number.isFinite(tops) || !Number.isFinite(btimeMs) || !Number.isFinite(hz) || hz <= 0) return null
  return btimeMs + (tops / hz) * 1000
}

// `btime <secondes>` dans `/proc/stat` : l'heure de démarrage de la MACHINE.
export const parseBtime = (contenu) => {
  const m = /^btime\s+(\d+)\s*$/m.exec(String(contenu ?? ''))
  return m === null ? null : Number(m[1]) * 1000
}

// ── 3. Le plan par famille (pur, donc éprouvable ici) ───────────────────────
// `nom` sert aux messages ; `parse` reçoit (sortie, contexte).
export const planPid = (fam, port) => {
  if (fam === 'windows') {
    return [{ nom: 'netstat -ano', cmd: ['netstat', '-ano'], parse: (s) => parsePidNetstat(s, port) }]
  }
  if (fam === 'linux') {
    return [
      { nom: 'ss -ltnp', cmd: ['ss', '-ltnp'], parse: parsePidSs },
      { nom: 'lsof -t', cmd: ['lsof', '-nP', '-iTCP:' + String(port), '-sTCP:LISTEN', '-t'], parse: parsePidLsof },
    ]
  }
  if (fam === 'mac') {
    return [{ nom: 'lsof -t', cmd: ['lsof', '-nP', '-iTCP:' + String(port), '-sTCP:LISTEN', '-t'], parse: parsePidLsof }]
  }
  return []
}

export const planDemarrage = (fam, pid) => {
  if (fam === 'windows') {
    return [
      { nom: 'PowerShell StartTime', cmd: ['powershell', '-NoProfile', '-Command', '(Get-Process -Id ' + pid + ').StartTime.ToString(\'o\')'], parse: parseDemarrageIso },
      { nom: 'wmic CreationDate', cmd: ['wmic', 'process', 'where', 'processid=' + pid, 'get', 'CreationDate'], parse: parseDemarrageWmic },
    ]
  }
  if (fam === 'mac') {
    return [{ nom: 'ps -o lstart=', cmd: ['ps', '-o', 'lstart=', '-p', String(pid)], parse: parseDemarragePs }]
  }
  if (fam === 'linux') {
    return [
      {
        nom: '/proc/<pid>/stat',
        fichier: '/proc/' + pid + '/stat',
        // `starttime` est en tops depuis le démarrage de la MACHINE : il faut
        // donc `btime` (/proc/stat) ET le `hz` du noyau pour en faire une date.
        lire: (chemin) => parseDemarrageProcStat(
          readFileSync(chemin, 'utf8'),
          parseBtime(readFileSync('/proc/stat', 'utf8')),
          100,
        ),
      },
      { nom: 'ps -o lstart=', cmd: ['ps', '-o', 'lstart=', '-p', String(pid)], parse: parseDemarragePs },
    ]
  }
  return []
}

// ── Le REDÉMARRAGE ─────────────────────────────────────────────────────────
// Un plugin a du code côté hôte (index.js) : le charger demande de REDÉMARRER
// DSH, pas de recharger la page. Arrêter est portable (process.kill), démarrer
// ne l'est pas tout à fait : sous Windows le binaire s'appelle `dsh.cmd`.
export const binaireDsh = (fam) => (fam === 'windows' ? 'dsh.cmd' : 'dsh')

export const planRelance = (fam, { port, pid = null }) => ({
  arreter: pid === null || pid === undefined ? null : { pid: String(pid) },
  demarrer: { cmd: binaireDsh(fam), args: ['web', '--no-open', '--port', String(port)] },
})

// Ce qu'on DIT au testeur quand on ne redémarre pas à sa place : la commande
// exacte pour son OS, pas « relance DSH ».
export const instructionsRedemarrage = (fam, port) => {
  if (fam === 'windows') {
    return '  Pour voir Kybernos : Ctrl-C dans la console de DSH, puis :\n' +
      '    dsh web --no-open --port ' + port + '\n' +
      '  (ou relance « kybernos-install --relancer » : le robot s\'en charge)'
  }
  return '  Pour voir Kybernos : Ctrl-C là où DSH tourne, puis :\n' +
    '    ' + binaireDsh(fam) + ' web --no-open --port ' + port + '\n' +
    '  (ou relance « ./kybernos-install --relancer » : le robot s\'en charge)'
}

// La ligne de commande d'un processus : elle sert à VÉRIFIER qu'un pid est bien
// un `dsh web` avant de le couper — sur un port partagé, le mauvais pid est un
// accident coûteux.
export const parseCommande = (sortie) => {
  const t = String(sortie ?? '').trim()
  return t === '' ? null : t
}

export const planCommande = (fam, pid) => {
  if (fam === 'windows') {
    return [{
      nom: 'PowerShell CommandLine',
      cmd: ['powershell', '-NoProfile', '-Command', '(Get-CimInstance Win32_Process -Filter "ProcessId=' + pid + '").CommandLine'],
      parse: parseCommande,
    }]
  }
  if (fam === 'mac' || fam === 'linux') {
    return [{ nom: 'ps -o command=', cmd: ['ps', '-o', 'command=', '-p', String(pid)], parse: parseCommande }]
  }
  return []
}

export const nomSuperviseur = (fam) => {
  if (fam === 'mac') return 'launchd (LaunchAgent)'
  if (fam === 'windows') return 'Planificateur de taches'
  if (fam === 'linux') return 'systemd --user'
  return 'inconnu'
}

// ── 3 bis. La supervision : le CONTENU de l'unité, par famille ──────────────
// Même doctrine que le reste du fichier : on construit le contenu et les
// commandes, on ne les exécute pas. Un seul cas est MESURÉ ici — le
// LaunchAgent `com.kybernos.dsh-web` réellement chargé sur cette machine
// (2026-09-23) : `planSupervision('mac', …)` reproduit son plist OCTET POUR
// OCTET, sinon ce plan n'est qu'une intention. Linux et Windows sont écrits
// d'après la documentation systemd et schtasks, et le disent.
export const PROVENANCE_SUPERVISION = Object.freeze({
  mac: 'mesuré : reproduit le plist chargé le 2026-09-23',
  linux: 'écrit d\'après systemd --user, non mesuré ici',
  windows: 'écrit d\'après schtasks /create /xml, non mesuré ici',
})

/** Les familles pour lesquelles on sait écrire une unité. */
export const famillesSupervisables = () => ['mac', 'linux', 'windows']

/**
 * Pure. Rend l'unité de supervision à écrire, ses commandes et son chemin :
 * `{ fam, nom, chemin, contenu, installer, desinstaller, etat, remarque, provenance }`.
 * `opts` : `{ home, node, dsh, port, travail, journaux, label, path, uid }`.
 * Une famille inconnue rend `null` — jamais une unité inventée.
 */
export const planSupervision = (fam, opts = {}) => {
  const label = opts.label || 'com.kybernos.dsh-web'
  const port = opts.port === undefined || opts.port === null ? 3080 : opts.port
  const node = opts.node || ''
  const dsh = opts.dsh || ''
  const travail = opts.travail || ''
  const journaux = opts.journaux || ''
  const home = opts.home || ''
  if (fam === 'mac') {
    const chemin = join(home, 'Library', 'LaunchAgents', label + '.plist')
    const contenu = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${node}</string>
    <string>${dsh}</string>
    <string>web</string>
    <string>--no-open</string>
    <string>--port</string>
    <string>${port}</string>
  </array>

  <key>WorkingDirectory</key>
  <string>${travail}</string>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>ThrottleInterval</key>
  <integer>10</integer>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${opts.path || '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'}</string>
    <key>HOME</key>
    <string>${home}</string>
  </dict>

  <key>StandardOutPath</key>
  <string>${join(journaux, 'dsh-web.out.log')}</string>
  <key>StandardErrorPath</key>
  <string>${join(journaux, 'dsh-web.err.log')}</string>

  <key>ProcessType</key>
  <string>Interactive</string>
</dict>
</plist>
`
    const domaine = 'gui/' + (opts.uid || '')
    return {
      fam, nom: nomSuperviseur(fam), chemin, contenu, provenance: PROVENANCE_SUPERVISION.mac,
      installer: [['launchctl', 'bootstrap', domaine, chemin]],
      desinstaller: [['launchctl', 'bootout', domaine + '/' + label]],
      etat: [['launchctl', 'print', domaine + '/' + label]],
      remarque: 'KeepAlive : launchd relance DSH seul. Un `dsh web` lancé à la main occupe le port — libère-le avant.',
    }
  }
  if (fam === 'linux') {
    const chemin = join(home, '.config', 'systemd', 'user', label + '.service')
    const contenu = `[Unit]
Description=DSH (DeepSeek Harness) — serveur web Kybernos
Documentation=https://github.com/platonai-net/dsh-kybernos

[Service]
Type=simple
WorkingDirectory=${travail}
ExecStart=${node} ${dsh} web --no-open --port ${port}
Restart=always
RestartSec=10
StandardOutput=append:${join(journaux, 'dsh-web.out.log')}
StandardError=append:${join(journaux, 'dsh-web.err.log')}
Environment=PATH=${opts.path || '/usr/local/bin:/usr/bin:/bin'}

[Install]
WantedBy=default.target
`
    const utilisateur = opts.utilisateur || (home === '' ? '' : basename(home))
    return {
      fam, nom: nomSuperviseur(fam), chemin, contenu, provenance: PROVENANCE_SUPERVISION.linux,
      installer: [['systemctl', '--user', 'daemon-reload'], ['systemctl', '--user', 'enable', '--now', label + '.service']],
      desinstaller: [['systemctl', '--user', 'disable', '--now', label + '.service']],
      etat: [['systemctl', '--user', 'status', label + '.service', '--no-pager']],
      remarque: 'Sans session graphique, active la persistance : `loginctl enable-linger ' + utilisateur + '` — c\'est ce qui fait tourner l\'unité après la fermeture de session.',
    }
  }
  if (fam === 'windows') {
    const chemin = join(journaux, label + '.xml')
    const contenu = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>DSH — serveur web Kybernos</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>3</Count>
    </RestartOnFailure>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${node}</Command>
      <Arguments>"${dsh}" web --no-open --port ${port}</Arguments>
      <WorkingDirectory>${travail}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`
    return {
      fam, nom: nomSuperviseur(fam), chemin, contenu, provenance: PROVENANCE_SUPERVISION.windows,
      installer: [['schtasks', '/create', '/tn', label, '/xml', chemin, '/f']],
      desinstaller: [['schtasks', '/delete', '/tn', label, '/f']],
      etat: [['schtasks', '/query', '/tn', label, '/v', '/fo', 'list']],
      remarque: '`LeastPrivilege` : la tâche tourne en tant qu\'utilisateur — aucun droit administrateur, aucun mot de passe stocké.',
    }
  }
  return null
}

// ── 4. L'exécution ──────────────────────────────────────────────────────────
export const executer = (cmd, options = {}) => new Promise((res) => {
  execFile(cmd[0], cmd.slice(1), { encoding: 'utf8', timeout: options.timeoutMs ?? 15000, windowsHide: true }, (err, stdout, stderr) =>
    res({ code: err ? (err.code ?? 1) : 0, sortie: String(stdout || ''), err: String(stderr || '') }))
})

// Variante SYNCHRONE : les outils qui tournent déjà en synchrone (le relanceur)
// n'ont pas à être réécrits en asynchrone pour devenir portables.
export const executerSync = (cmd, options = {}) => {
  try {
    return { code: 0, sortie: String(execFileSync(cmd[0], cmd.slice(1), { encoding: 'utf8', timeout: options.timeoutMs ?? 15000 })), err: '' }
  } catch (e) {
    return { code: e.status ?? 1, sortie: String(e.stdout ?? ''), err: String(e.stderr ?? '') }
  }
}

const valeurDuPlan = (plan, sortie) => {
  if (typeof plan.parse === 'function') return plan.parse(sortie, { hz: 100 })
  return null
}

// Le premier plan qui rend une valeur gagne ; on note lequel, pour que le
// message dise d'où vient la mesure (et se taise si aucune source n'a répondu).
export const mesurer = async (plans) => {
  for (const plan of plans) {
    if (plan.cmd !== undefined) {
      const r = await executer(plan.cmd)
      if (r.code !== 0) continue
      const valeur = valeurDuPlan(plan, r.sortie)
      if (valeur !== null && valeur !== undefined) return { valeur, source: plan.nom }
      continue
    }
    // Chemin fichier (Linux : /proc).
    if (plan.fichier !== undefined && plan.lire !== undefined) {
      try {
        const valeur = plan.lire(plan.fichier)
        if (valeur !== null && valeur !== undefined) return { valeur, source: plan.nom }
      } catch (e) { /* fichier absent : on essaie le plan suivant */ }
    }
  }
  return { valeur: null, source: null }
}

export const mesurerSync = (plans) => {
  for (const plan of plans) {
    if (plan.cmd !== undefined) {
      const r = executerSync(plan.cmd)
      if (r.code !== 0) continue
      const valeur = valeurDuPlan(plan, r.sortie)
      if (valeur !== null && valeur !== undefined) return { valeur, source: plan.nom }
      continue
    }
    if (plan.fichier !== undefined && plan.lire !== undefined) {
      try {
        const valeur = plan.lire(plan.fichier)
        if (valeur !== null && valeur !== undefined) return { valeur, source: plan.nom }
      } catch (e) { /* fichier absent : on essaie le plan suivant */ }
    }
  }
  return { valeur: null, source: null }
}

export const pidSurPort = async (port, fam = famille()) => mesurer(planPid(fam, port))

export const demarrageProcessus = async (pid, fam = famille()) => mesurer(planDemarrage(fam, pid))

export const pidSurPortSync = (port, fam = famille()) => mesurerSync(planPid(fam, port))

export const demarrageProcessusSync = (pid, fam = famille()) => mesurerSync(planDemarrage(fam, pid))

export const commandeProcessusSync = (pid, fam = famille()) => mesurerSync(planCommande(fam, pid))

// ── 5. Sonde en ligne de commande ───────────────────────────────────────────
// ⚠️ Comparer le NOM DU FICHIER, pas un `endsWith` sur le chemin : ce dernier
// était vrai pour `test-plateforme.mjs`, si bien qu'importer le module depuis
// l'épreuve lançait la sonde (défaut vu dans la sortie de l'épreuve).
const estPrincipal = () => process.argv[1] !== undefined && basename(process.argv[1]) === 'plateforme.mjs'

if (estPrincipal()) {
  const args = process.argv.slice(2)
  const lireOption = (nom, defaut) => {
    const i = args.indexOf(nom)
    return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : defaut
  }
  const port = Number(lireOption('--port', '3080'))
  const fam = famille()
  // `--supervision [<famille>]` : l'unité qui serait écrite, et les commandes
  // qui la poseraient. N'écrit rien, n'exécute rien — c'est un plan.
  const iSup = args.indexOf('--supervision')
  if (iSup >= 0) {
    const voulue = args[iSup + 1] !== undefined && args[iSup + 1].startsWith('--') === false ? args[iSup + 1] : fam
    const plan = planSupervision(voulue, {
      home: process.env.HOME || '',
      node: process.execPath,
      dsh: lireOption('--dsh', '/opt/homebrew/bin/dsh'),
      port,
      travail: process.cwd(),
      journaux: (process.env.HOME || '') + '/.dsh/logs',
      uid: typeof process.getuid === 'function' ? process.getuid() : '',
    })
    if (plan === null) {
      console.log('Aucune unité connue pour « ' + voulue + ' » — familles : ' + famillesSupervisables().join(', '))
      process.exit(1)
    }
    console.log('Supervision ' + plan.fam + ' — ' + plan.nom + '  (' + plan.provenance + ')')
    console.log('Fichier : ' + plan.chemin)
    console.log(plan.contenu)
    console.log('Pour poser :')
    for (const c of plan.installer) console.log('  · ' + c.join(' '))
    console.log('Pour retirer :')
    for (const c of plan.desinstaller) console.log('  · ' + c.join(' '))
    console.log('Pour regarder :')
    for (const c of plan.etat) console.log('  · ' + c.join(' '))
    console.log('Remarque : ' + plan.remarque)
  } else if (args.includes('--plan')) {
    console.log('Plateforme : ' + process.platform + ' (' + fam + ') — supervision : ' + nomSuperviseur(fam))
    console.log('Trouver le serveur sur le port ' + port + ' :')
    for (const p of planPid(fam, port)) console.log('  · ' + p.nom + ' — ' + p.cmd.join(' '))
    console.log('Heure de démarrage du processus :')
    for (const p of planDemarrage(fam, '<pid>')) console.log('  · ' + p.nom + (p.cmd === undefined ? ' — ' + p.fichier : ' — ' + p.cmd.join(' ')))
    console.log('Provenance des formats : ' + JSON.stringify(PROVENANCE))
  } else {
    const pid = await pidSurPort(port)
    if (pid.valeur === null) {
      console.log('Aucun serveur en écoute sur le port ' + port + ' (source : ' + (pid.source ?? 'aucune') + ')')
      process.exit(1)
    }
    const demarrage = await demarrageProcessus(pid.valeur)
    console.log('pid ' + pid.valeur + ' sur le port ' + port + ' (via ' + pid.source + ')')
    console.log('démarré : ' + (demarrage.valeur === null ? 'inconnu' : new Date(demarrage.valeur).toISOString()) + ' (via ' + (demarrage.source ?? 'aucune source') + ')')
  }
}
