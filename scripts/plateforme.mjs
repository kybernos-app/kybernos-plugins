// ── The portable layer of the lifecycle robot ───────────────────────────────
//
// The robot needs three things that, until now, were written for macOS:
//
//   1. FINDING THE LIVE SERVER — which pid listens on the GUI's port;
//   2. ITS START TIME — to be able to say « the server is older than the
//      installation » (the memory/disk mix described in DIAGNOSTIC);
//   3. NAMING THE SUPERVISION — LaunchAgent here, Task Scheduler there,
//      a systemd unit elsewhere.
//
// This module separates two things the robot used to confuse:
//
//   · the DECISION (which command, which parser) — pure, so it can be tested
//     on this machine, whatever it is;
//   · the EXECUTION — the only part that can only be proven where it
//     runs.
//
// The parsers (`parse*`) guess nothing: they take the RAW output of a command
// and return a pid or a date. Each family has its fixture in
// `scripts/test-plateforme.mjs`. For macOS the fixtures are MEASURED on this
// machine; for Linux and Windows they are FORMATTED outputs (see
// `PROVENANCE`) — that is said so as not to pass a documented format off as
// a measurement.
//
// Usage:
//   node scripts/plateforme.mjs --plan            # the commands that would be run here
//   node scripts/plateforme.mjs --sonde           # real measure: is the server alive?
//   node scripts/plateforme.mjs --sonde --port N
//
// Exit: 0 = measure done, 1 = server absent or unreadable.
import { execFile, execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

export const PROVENANCE = Object.freeze({
  mac: 'measured on this machine (2026-09-23)',
  linux: 'documented format (ss / netstat / proc), not measured here',
  windows: 'documented format (netstat -ano / PowerShell / wmic), not measured here',
})

// ── 1. The OS family ────────────────────────────────────────────────────────
export const famille = (plateforme = process.platform) => {
  if (plateforme === 'darwin') return 'mac'
  if (plateforme === 'win32') return 'windows'
  if (plateforme === 'linux') return 'linux'
  return 'other'
}

// ── 2. The pure parsers ─────────────────────────────────────────────────────
// A pid, first non-empty numeric line. `lsof -t` gives one pid per line.
export const parsePidLsof = (sortie) => {
  for (const ligne of String(sortie ?? '').split('\n')) {
    const t = ligne.trim()
    if (/^\d+$/.test(t)) return t
  }
  return null
}

// `ss -ltnp`: one line per socket, the pid in `users:(("node",pid=29198,fd=21))`.
export const parsePidSs = (sortie) => {
  for (const ligne of String(sortie ?? '').split('\n')) {
    const m = /pid=(\d+)/.exec(ligne)
    if (m !== null) return m[1]
  }
  return null
}

// `netstat -ano`: columns « Proto  Local  Foreign  State  PID ». We only take a
// line that is listening on the requested port — never the first one that comes,
// otherwise a neighbouring port gives the pid of another program.
//
// ⚠️ The port is compared on the LOCAL address column, not with `includes`:
// `:3080` is a prefix of `:30801`, and a naive `includes` returned the pid of
// ANOTHER program (defect caught by the fixture of `test-plateforme.mjs`).
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

// `ps -o lstart=`: « Wed Sep 23 18:31:20 2026 » (measured on macOS; GNU ps
// gives the same format with the C locale).
export const parseDemarragePs = (sortie) => {
  const t = String(sortie ?? '').trim()
  if (t === '') return null
  const ms = Date.parse(t)
  return Number.isFinite(ms) ? ms : null
}

// PowerShell `(Get-Process -Id N).StartTime.ToString('o')`: ISO 8601 with
// offset — `Date.parse` is enough, but we refuse a non-finite date.
export const parseDemarrageIso = (sortie) => {
  const t = String(sortie ?? '').trim()
  if (t === '') return null
  const ms = Date.parse(t)
  return Number.isFinite(ms) ? ms : null
}

// `wmic process where processid=N get CreationDate`: « 20260923183120.123456+120 »
// (the offset is in MINUTES, sign included).
export const parseDemarrageWmic = (sortie) => {
  const m = /(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\.(\d{1,6})([+-]\d{1,4})?/.exec(String(sortie ?? ''))
  if (m === null) return null
  const millisecondes = Math.round(Number('0.' + m[7]) * 1000)
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]), millisecondes)
  const offset = m[8] === undefined ? 0 : (m[8].startsWith('-') ? -1 : 1) * Number(m[8].slice(1)) * 60000
  return ms - offset
}

// `/proc/<pid>/stat`: field 22 is `starttime`, in ticks since boot.
// Field 2 (`comm`) can contain spaces AND parentheses: so we cut after the
// LAST closing parenthesis, never at the first space.
export const parseDemarrageProcStat = (stat, btimeMs, hz) => {
  const fin = String(stat ?? '').lastIndexOf(')')
  if (fin < 0) return null
  const champs = String(stat).slice(fin + 1).trim().split(/\s+/)
  const tops = Number(champs[22 - 3])
  if (!Number.isFinite(tops) || !Number.isFinite(btimeMs) || !Number.isFinite(hz) || hz <= 0) return null
  return btimeMs + (tops / hz) * 1000
}

// `btime <seconds>` in `/proc/stat`: the boot time of the MACHINE.
export const parseBtime = (contenu) => {
  const m = /^btime\s+(\d+)\s*$/m.exec(String(contenu ?? ''))
  return m === null ? null : Number(m[1]) * 1000
}

// ── 3. The plan per family (pure, so it can be tested here) ─────────────────
// `nom` is used by the messages; `parse` receives (output, context).
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
        // `starttime` is in ticks since the MACHINE's boot: so we need
        // `btime` (/proc/stat) AND the kernel's `hz` to make a date of it.
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

// ── The RESTART ────────────────────────────────────────────────────────────
// A plugin has host-side code (index.js): loading it needs DSH to be RESTARTED,
// not the page to be reloaded. Stopping is portable (process.kill), starting
// is not quite: on Windows the binary is called `dsh.cmd`.
export const binaireDsh = (fam) => (fam === 'windows' ? 'dsh.cmd' : 'dsh')

export const planRelance = (fam, { port, pid = null }) => ({
  arreter: pid === null || pid === undefined ? null : { pid: String(pid) },
  demarrer: { cmd: binaireDsh(fam), args: ['web', '--no-open', '--port', String(port)] },
})

// What we TELL the person when we do not restart DSH for them: the exact command for their OS, not « restart DSH ». The address matters as
// much as the command: `dsh web` signs the browser in through the URL it prints (…/?token=…) and answers a bare address with a
// plain-text 401, which is what the page said to everybody who followed the old instructions and typed http://127.0.0.1:3080/ (A6-17).
export const instructionsRedemarrage = (fam, port) => {
  const ou = fam === 'windows' ? 'in the DSH console' : 'where DSH runs'
  const robot = (fam === 'windows' ? '' : './') + 'kybernos-install --restart --force'
  return '  To see Kybernos: press Ctrl-C ' + ou + ', then:\n' +
    '    dsh web --port ' + port + '\n' +
    '  DSH opens your browser already signed in. If no browser opens (or you added --no-open), open the address that dsh web prints:\n' +
    '  it looks like http://127.0.0.1:' + port + '/?token=… and carries your sign-in; the bare http://127.0.0.1:' + port + '/ answers 401.\n' +
    '  (or run "' + robot + '": the robot restarts DSH for you)'
}

// The command line of a process: it is used to CHECK that a pid really is a
// `dsh web` before cutting it — on a shared port, the wrong pid is an
// expensive accident.
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
  if (fam === 'windows') return 'Task Scheduler'
  if (fam === 'linux') return 'systemd --user'
  return 'unknown'
}

// ── 3 bis. The supervision: the CONTENT of the unit, per family ─────────────
// Same doctrine as the rest of the file: we build the content and the
// commands, we do not run them. Only one case is MEASURED here — the
// `com.kybernos.dsh-web` LaunchAgent really loaded on this machine
// (2026-09-23): `planSupervision('mac', …)` reproduces its plist BYTE FOR
// BYTE, otherwise this plan is only an intention. Linux and Windows are written
// from the systemd and schtasks documentation, and say so.
export const PROVENANCE_SUPERVISION = Object.freeze({
  mac: 'measured: reproduces the plist loaded on 2026-09-23',
  linux: 'written from systemd --user, not measured here',
  windows: 'written from schtasks /create /xml, not measured here',
})

/** The families for which we know how to write a unit. */
export const famillesSupervisables = () => ['mac', 'linux', 'windows']

/**
 * Pure. Returns the supervision unit to write, its commands and its path:
 * `{ fam, nom, chemin, contenu, installer, desinstaller, etat, remarque, provenance }`.
 * `opts`: `{ home, node, dsh, port, travail, journaux, label, path, uid }`.
 * An unknown family returns `null` — never an invented unit.
 */
export const planSupervision = (fam, opts = {}) => {
  const label = opts.label || 'com.kybernos.dsh-web'
  const port = opts.port === undefined || opts.port === null ? 3080 : opts.port
  const node = opts.node || ''
  const dsh = opts.dsh || ''
  const travail = opts.travail || ''
  const journaux = opts.journaux || ''
  const home = opts.home || ''
  // Logs are named by port, like dsh-relance does (`dsh-web-<port>.out.log` off 3080): a unit on another port never writes into the log of the real one.
  const journal = (flux) => join(journaux, port === 3080 ? 'dsh-web.' + flux + '.log' : 'dsh-web-' + port + '.' + flux + '.log')
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
  <string>${journal('out')}</string>
  <key>StandardErrorPath</key>
  <string>${journal('err')}</string>

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
      remarque: 'KeepAlive: launchd restarts DSH by itself. A `dsh web` started by hand holds the port — free it first.',
    }
  }
  if (fam === 'linux') {
    const chemin = join(home, '.config', 'systemd', 'user', label + '.service')
    const contenu = `[Unit]
Description=DSH (DeepSeek Harness) — Kybernos web server
Documentation=https://github.com/kybernos-app/kybernos-plugins

[Service]
Type=simple
WorkingDirectory=${travail}
ExecStart=${node} ${dsh} web --no-open --port ${port}
Restart=always
RestartSec=10
StandardOutput=append:${journal('out')}
StandardError=append:${journal('err')}
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
      remarque: 'Without a graphical session, turn persistence on: `loginctl enable-linger ' + utilisateur + '` — that is what keeps the unit running after the session is closed.',
    }
  }
  if (fam === 'windows') {
    const chemin = join(journaux, label + '.xml')
    const contenu = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>DSH — Kybernos web server</Description>
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
      remarque: '`LeastPrivilege`: the task runs as the user — no administrator right, no stored password.',
    }
  }
  return null
}

// ── 4. The execution ────────────────────────────────────────────────────────
export const executer = (cmd, options = {}) => new Promise((res) => {
  execFile(cmd[0], cmd.slice(1), { encoding: 'utf8', timeout: options.timeoutMs ?? 15000, windowsHide: true }, (err, stdout, stderr) =>
    res({ code: err ? (err.code ?? 1) : 0, sortie: String(stdout || ''), err: String(stderr || '') }))
})

// SYNCHRONOUS variant: the tools that already run synchronously (the restarter)
// do not have to be rewritten asynchronously to become portable.
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

// The first plan that returns a value wins; we note which one, so that the
// message says where the measure comes from (and stays quiet if no source answered).
export const mesurer = async (plans) => {
  for (const plan of plans) {
    if (plan.cmd !== undefined) {
      const r = await executer(plan.cmd)
      if (r.code !== 0) continue
      const valeur = valeurDuPlan(plan, r.sortie)
      if (valeur !== null && valeur !== undefined) return { valeur, source: plan.nom }
      continue
    }
    // File path (Linux: /proc).
    if (plan.fichier !== undefined && plan.lire !== undefined) {
      try {
        const valeur = plan.lire(plan.fichier)
        if (valeur !== null && valeur !== undefined) return { valeur, source: plan.nom }
      } catch (e) { /* file absent: we try the next plan */ }
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
      } catch (e) { /* file absent: we try the next plan */ }
    }
  }
  return { valeur: null, source: null }
}

export const pidSurPort = async (port, fam = famille()) => mesurer(planPid(fam, port))

export const demarrageProcessus = async (pid, fam = famille()) => mesurer(planDemarrage(fam, pid))

export const pidSurPortSync = (port, fam = famille()) => mesurerSync(planPid(fam, port))

export const demarrageProcessusSync = (pid, fam = famille()) => mesurerSync(planDemarrage(fam, pid))

export const commandeProcessusSync = (pid, fam = famille()) => mesurerSync(planCommande(fam, pid))

// ── 5. Command-line probe ───────────────────────────────────────────────────
// ⚠️ Compare the FILE NAME, not an `endsWith` on the path: the latter was true
// for `test-plateforme.mjs`, so that importing the module from the test
// launched the probe (defect seen in the test's output).
const estPrincipal = () => process.argv[1] !== undefined && basename(process.argv[1]) === 'plateforme.mjs'

if (estPrincipal()) {
  const args = process.argv.slice(2)
  const lireOption = (nom, defaut) => {
    const i = args.indexOf(nom)
    return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : defaut
  }
  const port = Number(lireOption('--port', '3080'))
  const fam = famille()
  // `--supervision [<family>]`: the unit that would be written, and the commands
  // that would put it in place. Writes nothing, runs nothing — it is a plan.
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
      console.log('No known unit for « ' + voulue + ' » — families: ' + famillesSupervisables().join(', '))
      process.exit(1)
    }
    console.log('Supervision ' + plan.fam + ' — ' + plan.nom + '  (' + plan.provenance + ')')
    console.log('File: ' + plan.chemin)
    console.log(plan.contenu)
    console.log('To install:')
    for (const c of plan.installer) console.log('  · ' + c.join(' '))
    console.log('To remove:')
    for (const c of plan.desinstaller) console.log('  · ' + c.join(' '))
    console.log('To look at:')
    for (const c of plan.etat) console.log('  · ' + c.join(' '))
    console.log('Note: ' + plan.remarque)
  } else if (args.includes('--plan')) {
    console.log('Platform: ' + process.platform + ' (' + fam + ') — supervision: ' + nomSuperviseur(fam))
    console.log('Find the server on port ' + port + ':')
    for (const p of planPid(fam, port)) console.log('  · ' + p.nom + ' — ' + p.cmd.join(' '))
    console.log('Start time of the process:')
    for (const p of planDemarrage(fam, '<pid>')) console.log('  · ' + p.nom + (p.cmd === undefined ? ' — ' + p.fichier : ' — ' + p.cmd.join(' ')))
    console.log('Provenance of the formats: ' + JSON.stringify(PROVENANCE))
  } else {
    const pid = await pidSurPort(port)
    if (pid.valeur === null) {
      console.log('No server listening on port ' + port + ' (source: ' + (pid.source ?? 'none') + ')')
      process.exit(1)
    }
    const demarrage = await demarrageProcessus(pid.valeur)
    console.log('pid ' + pid.valeur + ' on port ' + port + ' (via ' + pid.source + ')')
    console.log('started: ' + (demarrage.valeur === null ? 'unknown' : new Date(demarrage.valeur).toISOString()) + ' (via ' + (demarrage.source ?? 'no source') + ')')
  }
}
