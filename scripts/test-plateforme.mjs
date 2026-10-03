// ── Épreuve de la couche portable ───────────────────────────────────────────
//
// Ce qu'on peut prouver ICI : les ANALYSEURS (sur des sorties brutes) et les
// PLANS (quelles commandes, dans quel ordre, pour quelle famille). Ce qu'on ne
// peut pas prouver ici : que `netstat -ano` se comporte ainsi sur un vrai
// Windows, ou que `ss` est présent sur une distribution donnée. Les fixtures
// disent leur provenance ; le test ne les fait pas passer pour des mesures.
//
// Usage : node scripts/test-plateforme.mjs   (0 = tout vert)
import { existsSync as existSync, readFileSync as readFichier } from 'node:fs'
import {
  famille, estWindows, estMac, estLinux, PROVENANCE,
  parsePidLsof, parsePidSs, parsePidNetstat,
  parseDemarragePs, parseDemarrageIso, parseDemarrageWmic, parseDemarrageProcStat, parseBtime,
  planPid, planDemarrage, planCommande, nomSuperviseur, mesurer, mesurerSync, executerSync, parseCommande,
  binaireDsh, planRelance, instructionsRedemarrage,
  planSupervision, famillesSupervisables, PROVENANCE_SUPERVISION,
} from './plateforme.mjs'

let ok = 0
const echecs = []
const verifie = (titre, condition) => {
  if (condition) ok += 1
  else echecs.push(titre)
}

// ── fixtures, avec leur provenance ──────────────────────────────────────────
const F = {
  macLsof: '38120\n',                                       // MESURÉ sur cette machine
  macLsofMulti: '38120\n38221\n',                           // idem, forme multi-pid
  macLsofVide: '',                                          // idem, aucun listener
  macPs: 'Wed Sep 23 18:31:20 2026    \n',                  // MESURÉ
  linuxSs: 'LISTEN 0      4096   127.0.0.1:3080      0.0.0.0:*    users:(("node",pid=29198,fd=21))\n', // format documenté
  linuxSsSansPid: 'LISTEN 0      4096   127.0.0.1:3080      0.0.0.0:*\n',                              // idem (ss sans droits)
  linuxPs: 'Wed Sep 23 18:31:20 2026\n',                    // idem
  winNetstat: [
    '',
    'Connexions actives',
    '',
    '  Proto  Adresse locale         Adresse distante       État',
    '  TCP    127.0.0.1:3080         0.0.0.0:0              LISTENING       29198',
    '  TCP    127.0.0.1:30801        0.0.0.0:0              LISTENING       40404',
    '  TCP    127.0.0.1:3080         127.0.0.1:51422        ESTABLISHED     29198',
    '',
  ].join('\r\n'),                                           // format documenté
  winIso: '2026-09-23T18:31:20.1234567+02:00\r\n',           // idem
  winWmic: 'CreationDate\r\n20260923183120.123456+120\r\n\r\n', // idem
}

// ── 1. la famille ───────────────────────────────────────────────────────────
verifie('darwin → mac', famille('darwin') === 'mac')
verifie('win32 → windows', famille('win32') === 'windows')
verifie('linux → linux', famille('linux') === 'linux')
verifie('freebsd → autre', famille('freebsd') === 'autre')
verifie('estWindows/estMac/estLinux cohérents', estWindows('win32') && estMac('darwin') && estLinux('linux'))
verifie('les trois provenances sont déclarées', Object.keys(PROVENANCE).length === 3)

// ── 2. trouver le pid ───────────────────────────────────────────────────────
verifie('lsof : le pid mesuré', parsePidLsof(F.macLsof) === '38120')
verifie('lsof : le premier de plusieurs', parsePidLsof(F.macLsofMulti) === '38120')
verifie('lsof : vide → null', parsePidLsof(F.macLsofVide) === null)
verifie('lsof : du bruit ne devient pas un pid', parsePidLsof('COMMAND\nnode\n') === null)
verifie('ss : le pid dans users:(…)', parsePidSs(F.linuxSs) === '29198')
verifie('ss : sans pid → null', parsePidSs(F.linuxSsSansPid) === null)
verifie('netstat : le pid du bon port', parsePidNetstat(F.winNetstat, 3080) === '29198')
verifie('netstat : :30801 ne répond pas pour 3080', parsePidNetstat('  TCP    127.0.0.1:30801        0.0.0.0:0              LISTENING       40404', 3080) === null)
verifie('netstat : une ligne ESTABLISHED est ignorée', parsePidNetstat('  TCP    127.0.0.1:3080         127.0.0.1:51422        ESTABLISHED     99999', 3080) === null)
verifie('netstat : un port absent → null', parsePidNetstat(F.winNetstat, 9999) === null)

// ── 3. l'heure de démarrage ─────────────────────────────────────────────────
const msMac = parseDemarragePs(F.macPs)
verifie('ps : la date mesurée est lue', Number.isFinite(msMac))
verifie('ps : le jour est le 23', new Date(msMac).getDate() === 23)
verifie('ps : l\'heure locale est 18', new Date(msMac).getHours() === 18)
verifie('ps : les minutes sont 31', new Date(msMac).getMinutes() === 31)
verifie('ps : une sortie vide → null', parseDemarragePs('   \n') === null)
verifie('ps : du texte non datable → null', parseDemarragePs('lundi') === null)

const msWmic = parseDemarrageWmic(F.winWmic)
verifie('wmic : +120 minutes est retiré', msWmic === Date.UTC(2026, 8, 23, 16, 31, 20, 123))
verifie('wmic : les millisecondes sont gardées', new Date(msWmic).getUTCMilliseconds() === 123)
verifie('wmic : une sortie sans date → null', parseDemarrageWmic('CreationDate\r\n\r\n') === null)

const msIso = parseDemarrageIso(F.winIso)
verifie('ISO : le décalage est appliqué', msIso === Date.UTC(2026, 8, 23, 16, 31, 20, 123))
verifie('ISO : vide → null', parseDemarrageIso('\r\n') === null)
verifie('ISO : « N/A » → null', parseDemarrageIso('N/A') === null)

verifie('btime : lu depuis /proc/stat', parseBtime('cpu  1 2 3\nbtime 1758645080\nprocesses 42\n') === 1758645080000)
verifie('btime : absent → null', parseBtime('cpu  1 2 3\n') === null)

// /proc/<pid>/stat : le champ 2 peut contenir espaces ET parenthèses — on coupe
// après la DERNIÈRE parenthèse, sinon les champs glissent et la date est fausse.
const champsStat = new Array(20).fill('0')
champsStat[0] = 'S'      // champ 3 : state
champsStat[19] = '5000'  // champ 22 : starttime, en tops
const statAvecParens = '1234 (node (my app)) ' + champsStat.join(' ') + '\n'
verifie('proc : comm à espaces ET parenthèses', parseDemarrageProcStat(statAvecParens, 1000, 100) === 1000 + 50 * 1000)
verifie('proc : 5000 tops à 100 Hz = 50 s', parseDemarrageProcStat(statAvecParens, 0, 100) === 50000)
verifie('proc : 5000 tops à 250 Hz = 20 s', parseDemarrageProcStat(statAvecParens, 0, 250) === 20000)
verifie('proc : un hz nul ne divise pas par zéro', parseDemarrageProcStat(statAvecParens, 0, 0) === null)
verifie('proc : sans parenthèse → null', parseDemarrageProcStat('1234 node S 1', 0, 100) === null)

// ── 4. les plans, par famille ───────────────────────────────────────────────
const planMac = planPid('mac', 3080)
verifie('mac : un seul plan de pid', planMac.length === 1)
verifie('mac : la commande est lsof', planMac[0].cmd.join(' ') === 'lsof -nP -iTCP:3080 -sTCP:LISTEN -t')
const planLinux = planPid('linux', 3080)
verifie('linux : ss d\'abord, lsof ensuite', planLinux.length === 2 && planLinux[0].cmd[0] === 'ss' && planLinux[1].cmd[0] === 'lsof')
verifie('linux : ss ne code pas le port en dur', !planLinux[0].cmd.join(' ').includes('3080'))
const planWin = planPid('windows', 3080)
verifie('windows : un seul plan de pid', planWin.length === 1)
verifie('windows : netstat -ano', planWin[0].cmd.join(' ') === 'netstat -ano')
verifie('windows : le port est filtré par l\'analyseur', planWin[0].parse(F.winNetstat) === '29198')

verifie('mac : démarrage par ps', planDemarrage('mac', 42)[0].cmd.join(' ') === 'ps -o lstart= -p 42')
verifie('windows : PowerShell d\'abord', planDemarrage('windows', 42)[0].cmd[0] === 'powershell')
verifie('windows : wmic en secours', planDemarrage('windows', 42)[1].cmd[0] === 'wmic')
verifie('windows : le pid est dans la commande PowerShell', planDemarrage('windows', 4242)[0].cmd[3].includes('4242'))
verifie('linux : /proc d\'abord, ps ensuite', planDemarrage('linux', 42)[0].fichier === '/proc/42/stat' && planDemarrage('linux', 42)[1].cmd[0] === 'ps')
verifie('autre OS : aucun plan', planPid('autre', 3080).length === 0 && planDemarrage('autre', 1).length === 0)

verifie('supervision : launchd sur mac', nomSuperviseur('mac') === 'launchd (LaunchAgent)')
verifie('supervision : Planificateur sur windows', nomSuperviseur('windows').includes('Planificateur'))
verifie('supervision : systemd sur linux', nomSuperviseur('linux') === 'systemd --user')

// ── 5. `mesurer` : le premier plan qui répond gagne ─────────────────────────
const planFaux = { nom: 'faux', cmd: ['node', '-e', 'process.exit(9)'], parse: () => 'jamais' }
const planMuets = { nom: 'muet', cmd: ['node', '-e', 'console.log("rien")'], parse: () => null }
const planBon = { nom: 'bon', cmd: ['node', '-e', 'console.log("29198")'], parse: parsePidLsof }
const r1 = await mesurer([planFaux, planMuets, planBon])
verifie('mesurer : saute l\'échec et le muet, garde le bon', r1.valeur === '29198')
verifie('mesurer : dit d\'où vient la mesure', r1.source === 'bon')
const r2 = await mesurer([planFaux, planMuets])
verifie('mesurer : aucune source → null', r2.valeur === null && r2.source === null)

// ── 6. la variante synchrone (celle du relanceur) ───────────────────────────
// Elle ne doit JAMAIS lever : un binaire absent (`ss` n'existe pas sur macOS,
// `lsof` n'existe pas sur Windows) doit faire tomber au plan suivant.
const r3 = mesurerSync([planFaux, planMuets, planBon])
verifie('mesurerSync : même verdict que l\'asynchrone', r3.valeur === '29198' && r3.source === 'bon')
const r4 = mesurerSync([planFaux, planMuets])
verifie('mesurerSync : aucune source → null', r4.valeur === null && r4.source === null)
const manquant = executerSync(['binaire-qui-nexiste-pas-kybernos'])
verifie('executerSync : un binaire absent ne lève pas', manquant.code !== 0)
verifie('executerSync : rend une sortie vide, pas undefined', typeof manquant.sortie === 'string')
const present = executerSync(['node', '-e', 'console.log("ok")'])
verifie('executerSync : un succès rend 0 et la sortie', present.code === 0 && present.sortie.trim() === 'ok')
verifie('mesurerSync : un plan dont la commande echoue rend null', mesurerSync([{ nom: 'casse', cmd: ['binaire-qui-nexiste-pas-kybernos'], parse: parsePidLsof }]).valeur === null)

// ── 7. la ligne de commande d\'un processus ─────────────────────────────────
verifie('commande : les espaces sont rognés', parseCommande('/usr/bin/node dsh web\n') === '/usr/bin/node dsh web')
verifie('commande : vide → null', parseCommande('   \n') === null)
verifie('commande : mac et linux passent par ps', planCommande('mac', 42)[0].cmd.join(' ') === 'ps -o command= -p 42' && planCommande('linux', 42)[0].cmd[0] === 'ps')
const planCmdWin = planCommande('windows', 4242)
verifie('commande : windows passe par Win32_Process', planCmdWin[0].cmd.join(' ').includes('Win32_Process'))
verifie('commande : le pid est dans la requête windows', planCmdWin[0].cmd.join(' ').includes('4242'))
verifie('commande : autre OS → aucun plan', planCommande('autre', 1).length === 0)

// ── 8. le redémarrage (le geste qui charge le code hôte) ────────────────────
verifie('binaire : `dsh` sous mac et linux', binaireDsh('mac') === 'dsh' && binaireDsh('linux') === 'dsh')
verifie('binaire : `dsh.cmd` sous Windows', binaireDsh('windows') === 'dsh.cmd')
const relanceMac = planRelance('mac', { port: 3080, pid: 38120 })
verifie('relance : le pid à arrêter est porté', relanceMac.arreter.pid === '38120')
verifie('relance : la commande de démarrage est complète', relanceMac.demarrer.cmd + ' ' + relanceMac.demarrer.args.join(' ') === 'dsh web --no-open --port 3080')
verifie('relance : le port est celui demandé', planRelance('mac', { port: 3099 }).demarrer.args.join(' ').includes('3099'))
verifie('relance : sans serveur, rien à arrêter', planRelance('mac', { port: 3080 }).arreter === null)
verifie('relance : windows démarre dsh.cmd', planRelance('windows', { port: 3080, pid: 1 }).demarrer.cmd === 'dsh.cmd')
verifie('relance : le pid est converti en chaîne (process.kill accepte les deux)', typeof planRelance('mac', { port: 1, pid: 42 }).arreter.pid === 'string')
const ditMac = instructionsRedemarrage('mac', 3080)
verifie('instructions : la commande exacte est donnée', ditMac.includes('dsh web --no-open --port 3080'))
verifie('instructions : elle dit Ctrl-C, pas « recharge la page »', ditMac.includes('Ctrl-C'))
verifie('instructions : elle propose --relancer', ditMac.includes('--relancer'))
verifie('instructions : Windows dit la même commande', instructionsRedemarrage('windows', 3080).includes('dsh web --no-open --port 3080'))
verifie('instructions : le port vient de l\'appelant', instructionsRedemarrage('linux', 4444).includes('--port 4444'))

// ── la supervision : le contenu de l'unité, par famille ────────────────────
// Le seul cas MESURÉ : le LaunchAgent réellement chargé sur cette machine.
// S'il n'est pas là (autre poste), on le DIT — on ne fait pas passer une
// absence pour un succès.
const os = {
  home: '/Users/essai', node: '/usr/local/bin/node', dsh: '/usr/local/bin/dsh',
  port: 3080, travail: '/Users/essai/dsh-kybernos', journaux: '/Users/essai/.dsh/logs', uid: 501,
}
const mac = planSupervision('mac', os)
const linux = planSupervision('linux', os)
const win = planSupervision('windows', os)

verifie('supervision : trois familles savent écrire une unité', famillesSupervisables().length === 3)
verifie('supervision : une famille inconnue ne rend rien', planSupervision('beos', os) === null)
verifie('supervision : chaque famille a son nom de superviseur',
  mac.nom.includes('launchd') && linux.nom.includes('systemd') && win.nom.includes('Planificateur'))
verifie('supervision : chaque famille dit sa provenance',
  mac.provenance === PROVENANCE_SUPERVISION.mac && linux.provenance === PROVENANCE_SUPERVISION.linux)
verifie('supervision : macOS écrit dans ~/Library/LaunchAgents', mac.chemin === '/Users/essai/Library/LaunchAgents/com.kybernos.dsh-web.plist')
verifie('supervision : Linux écrit dans ~/.config/systemd/user', linux.chemin === '/Users/essai/.config/systemd/user/com.kybernos.dsh-web.service')
verifie('supervision : le port vient de l\'appelant',
  planSupervision('mac', Object.assign({}, os, { port: 4444 })).contenu.includes('<string>4444</string>'))

// macOS : le plist, dans sa structure
verifie('plist : Label en tête', mac.contenu.includes('<key>Label</key>\n  <string>com.kybernos.dsh-web</string>'))
verifie('plist : le programme est node suivi du script dsh', mac.contenu.includes('<string>/usr/local/bin/node</string>\n    <string>/usr/local/bin/dsh</string>'))
verifie('plist : les arguments disent web --no-open --port', mac.contenu.includes('<string>web</string>\n    <string>--no-open</string>\n    <string>--port</string>'))
verifie('plist : KeepAlive est vrai (DSH redémarre seul)', mac.contenu.includes('<key>KeepAlive</key>\n  <true/>'))
verifie('plist : RunAtLoad est vrai', mac.contenu.includes('<key>RunAtLoad</key>\n  <true/>'))
verifie('plist : la sortie et l\'erreur vont dans deux journaux distincts',
  mac.contenu.includes('dsh-web.out.log') && mac.contenu.includes('dsh-web.err.log'))
verifie('plist : le dossier de travail est celui du dépôt', mac.contenu.includes('<string>/Users/essai/dsh-kybernos</string>'))
verifie('plist : l\'unité se termine par une nouvelle ligne',
  mac.contenu.endsWith('</plist>\n'))
verifie('plist : installer passe par launchctl bootstrap', mac.installer[0][0] === 'launchctl' && mac.installer[0][1] === 'bootstrap')
verifie('plist : bootstrap vise le domaine gui de l\'utilisateur', mac.installer[0][2] === 'gui/501')
verifie('plist : désinstaller passe par launchctl bootout', mac.desinstaller[0][1] === 'bootout')
verifie('plist : le domaine porte le label pour bootout', mac.desinstaller[0][2] === 'gui/501/com.kybernos.dsh-web')

// Linux : l'unité systemd --user
verifie('systemd : le fichier a les trois sections', ['[Unit]', '[Service]', '[Install]'].every((x) => linux.contenu.includes(x)))
verifie('systemd : ExecStart lance la commande web complète',
  linux.contenu.includes('ExecStart=/usr/local/bin/node /usr/local/bin/dsh web --no-open --port 3080'))
verifie('systemd : Restart=always, avec un délai', linux.contenu.includes('Restart=always') && linux.contenu.includes('RestartSec=10'))
verifie('systemd : WantedBy=default.target (c\'est un service utilisateur)', linux.contenu.includes('WantedBy=default.target'))
verifie('systemd : WorkingDirectory est posé', linux.contenu.includes('WorkingDirectory=/Users/essai/dsh-kybernos'))
verifie('systemd : installer recharge le démon puis active',
  linux.installer.length === 2 && linux.installer[0].includes('daemon-reload') && linux.installer[1].includes('enable'))
verifie('systemd : désinstaller désactive et arrête', linux.desinstaller[0].includes('disable') && linux.desinstaller[0].includes('--now'))
verifie('systemd : la remarque donne enable-linger, sans l\'exécuter', linux.remarque.includes('loginctl enable-linger'))

// Windows : la tâche planifiée
verifie('schtasks : la tâche est déclenchée à l\'ouverture de session', win.contenu.includes('<LogonTrigger>'))
verifie('schtasks : elle tourne en moindre privilège', win.contenu.includes('<RunLevel>LeastPrivilege</RunLevel>'))
verifie('schtasks : elle redémarre seule après échec', win.contenu.includes('<RestartOnFailure>'))
verifie('schtasks : la commande et ses arguments sont séparés',
  win.contenu.includes('<Command>/usr/local/bin/node</Command>') && win.contenu.includes('<Arguments>\"/usr/local/bin/dsh\" web --no-open --port 3080</Arguments>'))
verifie('schtasks : installer crée la tâche depuis le XML', win.installer[0].includes('/create') && win.installer[0].includes('/xml'))
verifie('schtasks : désinstaller supprime la tâche', win.desinstaller[0].includes('/delete'))

// D7 : jamais de sudo, nulle part, dans aucune famille
const tous = [mac, linux, win]
verifie('D7 : aucune commande de supervision ne contient sudo',
  tous.every((p) => p.installer.concat(p.desinstaller).every((c) => c.join(' ').indexOf('sudo') < 0)))
verifie('D7 : aucun contenu d\'unité ne contient sudo',
  tous.every((p) => p.contenu.indexOf('sudo') < 0 && p.remarque.indexOf('sudo') < 0))
verifie('D7 : Windows ne demande pas SYSTEM (qui exigerait des droits)',
  win.contenu.indexOf('SYSTEM') < 0)

// Le cas MESURÉ : reproduire le plist réellement chargé sur cette machine.
const plistReel = '/Users/miled/Library/LaunchAgents/com.kybernos.dsh-web.plist'
if (existSync(plistReel)) {
  const planReel = planSupervision('mac', {
    home: '/Users/miled', node: '/opt/homebrew/bin/node', dsh: '/opt/homebrew/bin/dsh',
    port: 3080, travail: '/Users/miled/dyad-apps/dsh-kybernos', journaux: '/Users/miled/.dsh/logs', uid: 501,
  })
  const reel = readFichier(plistReel, 'utf8')
  if (planReel.contenu !== reel) {
    const a = planReel.contenu.split('\n'); const b = reel.split('\n')
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
      if (a[i] !== b[i]) { console.log('    DIFF ligne ' + (i + 1) + ': ' + JSON.stringify(a[i]) + ' ≠ ' + JSON.stringify(b[i])); break }
    }
    console.log('    longueurs : ' + planReel.contenu.length + ' vs ' + reel.length)
  }
  verifie('MESURÉ : le plist engendré est le plist chargé, octet pour octet',
    planReel.contenu === reel)
} else {
  console.log('  · plist réel absent de cette machine : la comparaison octet pour octet est SAUTÉE (pas verte)')
}

// ── verdict ─────────────────────────────────────────────────────────────────
console.log('COUCHE PORTABLE — ' + ok + ' assertions, ' + echecs.length + ' échec(s)')
for (const e of echecs) console.log('  ✗ ' + e)
process.exit(echecs.length === 0 ? 0 : 1)
