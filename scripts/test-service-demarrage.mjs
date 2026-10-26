// Start at login: the decision and the I/O of the unit, with a fake system. Nothing here touches a real launchd or systemd.
//   node scripts/test-service-demarrage.mjs   (0 = all green)
import {
  LABEL, etiquette, cheminDuService, contexteService, trouverDsh, decisionDemarrageAuto,
  etat, installer, retirer, commandeRedemarrage, FAMILLES_INSTALLABLES,
} from './service-demarrage.mjs'

let total = 0
const echecs = []
const ok = (nom, cond, detail = '') => { total++; if (!cond) echecs.push(nom + (detail ? ' — ' + detail : '')) }

const ctxMac = contexteService({ home: '/Users/me', dshHome: '/Users/me/.dsh', port: 3080, node: '/opt/homebrew/bin/node', dsh: '/opt/homebrew/bin/dsh', path: '/usr/bin:/opt/homebrew/bin:/usr/bin', uid: 501 })
const ctxLinux = contexteService({ home: '/home/me', dshHome: '/home/me/.dsh', port: 3080, node: '/usr/bin/node', dsh: '/usr/local/bin/dsh', path: '/usr/local/bin:/usr/bin', uid: 1000 })

// A fake system: files in memory, every command recorded, answers scripted per command prefix.
const faux = ({ fichiers = {}, charge = false, echec = null, repond = true, desactive = false } = {}) => {
  const fs = { ...fichiers }
  const cmds = []
  const sauvegardes = []
  let enCharge = charge
  return {
    fs, cmds, sauvegardes,
    io: {
      existe: (c) => c in fs,
      lire: (c) => fs[c],
      ecrire: (c, contenu) => { fs[c] = contenu },
      supprimer: (c) => { delete fs[c] },
      sauvegarder: (c, contenu) => { sauvegardes.push([c, contenu]); return '/backup/' + c.split('/').at(-1) },
      executer: async (cmd) => {
        cmds.push(cmd.join(' '))
        if (echec !== null && cmd.join(' ').includes(echec)) return { code: 5, sortie: '', err: 'Bootstrap failed: 5' }
        if (cmd[1] === 'print-disabled') return { code: 0, sortie: desactive ? '\t\t"com.kybernos.dsh-web" => disabled\n' : '\t\t"com.apple.foo" => enabled\n', err: '' }
        if (cmd.includes('enable') && cmd[1] === 'enable') desactive = false
        if (cmd.includes('print') || cmd.includes('status')) return { code: enCharge ? 0 : 113, sortie: '', err: '' }
        if (cmd.includes('bootstrap') || cmd.includes('--now')) enCharge = true
        return { code: 0, sortie: '', err: '' }
      },
      serveurRepond: async () => repond,
    },
  }
}

// ── names and paths ──
ok('the unit of the real port keeps the historical label', etiquette(3080) === 'com.kybernos.dsh-web' && LABEL === 'com.kybernos.dsh-web')
ok('another port gets its own unit', etiquette(4444) === 'com.kybernos.dsh-web-4444')
ok('the working folder is the home, not a development tree', ctxMac.travail === '/Users/me')
ok('the logs go where the relaunch tool reads them', ctxMac.journaux === '/Users/me/.dsh/logs')
ok('Node\'s folder comes first in the PATH, once', cheminDuService({ path: '/usr/bin:/opt/homebrew/bin:/usr/bin', node: '/opt/homebrew/bin/node' }) === '/opt/homebrew/bin:/usr/bin')
ok('a missing PATH still yields Node\'s folder', cheminDuService({ path: '', node: '/usr/bin/node' }) === '/usr/bin')
const existe = (set) => (c) => set.includes(c)
ok('dsh is found on the PATH as written (the link, not its target)', trouverDsh({ dirs: ['/a', '/b'], home: '/h', existe: existe(['/b/dsh']) }) === '/b/dsh')
ok('a thin launcher PATH still finds the Homebrew dsh', trouverDsh({ dirs: ['/usr/bin'], home: '/h', existe: existe(['/opt/homebrew/bin/dsh']) }) === '/opt/homebrew/bin/dsh')
ok('no dsh anywhere → null', trouverDsh({ dirs: ['/a'], home: '/h', existe: () => false }) === null)
ok('installable families are macOS and Linux', FAMILLES_INSTALLABLES.join() === 'mac,linux')

// ── who decides ──
const d = decisionDemarrageAuto
ok('the refusal flag wins over everything', d({ refuse: true, autostart: true, interactif: true }) === 'non')
ok('the yes flag installs without asking, even from a checkout', d({ autostart: true, depotDeDev: true }) === 'oui')
ok('a unit already there is refreshed without a question', d({ present: true, interactif: true }) === 'deja')
ok('a development checkout never adds one by itself', d({ depotDeDev: true, interactif: true }) === 'ignorer')
ok('an interactive install asks', d({ interactif: true }) === 'demander')
ok('a script, an agent or CI never adds one behind anyone\'s back', d({ interactif: false }) === 'ignorer')

// ── macOS: a free port ──
{
  const f = faux()
  const r = await installer({ fam: 'mac', ctx: ctxMac, io: f.io })
  const chemin = '/Users/me/Library/LaunchAgents/com.kybernos.dsh-web.plist'
  ok('mac: ok and started', r.ok === true && r.demarre === true)
  ok('mac: the plist is written where launchd looks', typeof f.fs[chemin] === 'string')
  ok('mac: it loads the unit with bootstrap, after switching it on', f.cmds.indexOf('launchctl enable gui/501/com.kybernos.dsh-web') >= 0 && f.cmds.indexOf('launchctl enable gui/501/com.kybernos.dsh-web') < f.cmds.indexOf('launchctl bootstrap gui/501 ' + chemin))
  ok('mac: it never touches a running DSH (no kickstart, no bootout)', !f.cmds.some((c) => c.includes('kickstart') || c.includes('bootout')))
  const env = /<key>EnvironmentVariables<\/key>\s*<dict>([\s\S]*?)<\/dict>/.exec(f.fs[chemin])[1]
  ok('mac: the only variables in the unit are PATH and HOME (no key, no token)', [...env.matchAll(/<key>(\w+)<\/key>/g)].map((m) => m[1]).join() === 'PATH,HOME' && !/API_KEY|TOKEN|SECRET|PASSWORD/i.test(f.fs[chemin]))
  ok('mac: the unit carries no development path', !f.fs[chemin].includes('dsh-kybernos'))
  ok('mac: KeepAlive and RunAtLoad are on', f.fs[chemin].includes('<key>KeepAlive</key>\n  <true/>') && f.fs[chemin].includes('<key>RunAtLoad</key>\n  <true/>'))
  ok('mac: state afterwards is loaded and identical', (await etat({ fam: 'mac', ctx: ctxMac, io: f.io })).charge === true && (await etat({ fam: 'mac', ctx: ctxMac, io: f.io })).identique === true)
}
// ── macOS: launchd had the label switched off (the real cause of the missed start after the reboot) ──
{
  const f = faux({ desactive: true })
  ok('mac: a disabled label is detected', (await etat({ fam: 'mac', ctx: ctxMac, io: f.io })).desactive === true && (await etat({ fam: 'mac', ctx: ctxMac, io: faux().io })).desactive === false)
  const r = await installer({ fam: 'mac', ctx: ctxMac, io: f.io })
  ok('mac, disabled: it is switched on again and says so', r.ok === true && r.etapes.some((e) => e.includes('switched off')) && f.cmds.includes('launchctl enable gui/501/com.kybernos.dsh-web'))
}
// ── macOS: a DSH the person started by hand holds the port ──
{
  const f = faux()
  const r = await installer({ fam: 'mac', ctx: ctxMac, io: f.io, portOccupe: true })
  ok('mac, busy port: the unit is written', r.ok === true && Object.keys(f.fs).length === 1)
  ok('mac, busy port: the label is switched on so the next login loads it', f.cmds.includes('launchctl enable gui/501/com.kybernos.dsh-web'))
  ok('mac, busy port: nothing is loaded, nothing is cut', !f.cmds.some((c) => c.includes('bootstrap') || c.includes('kickstart') || c.includes('bootout')))
  ok('mac, busy port: it says it takes over at the next login', r.etapes.some((e) => e.includes('next login')) && r.demarre === false)
}
// ── macOS: a hand-made plist is replaced, never lost ──
{
  const chemin = '/Users/me/Library/LaunchAgents/com.kybernos.dsh-web.plist'
  const f = faux({ fichiers: { [chemin]: '<plist>hand made</plist>' } })
  const r = await installer({ fam: 'mac', ctx: ctxMac, io: f.io })
  ok('mac, existing file: a copy is kept first', f.sauvegardes.length === 1 && f.sauvegardes[0][1] === '<plist>hand made</plist>' && r.sauvegarde === '/backup/com.kybernos.dsh-web.plist')
  ok('mac, existing file: then replaced', f.fs[chemin].includes('KeepAlive'))
}
// ── macOS: already there, already running → nothing to do ──
{
  const f0 = faux()
  await installer({ fam: 'mac', ctx: ctxMac, io: f0.io })
  const f = faux({ fichiers: { ...f0.fs }, charge: true })
  const r = await installer({ fam: 'mac', ctx: ctxMac, io: f.io })
  ok('mac, identical and running: only state reads, nothing changed', f.cmds.every((c) => c.includes('print')) && r.ok === true && r.demarre === false)
}
// ── macOS: a refreshed file while DSH runs does not cut it ──
{
  const chemin = '/Users/me/Library/LaunchAgents/com.kybernos.dsh-web.plist'
  const f = faux({ fichiers: { [chemin]: '<plist>older</plist>' }, charge: true })
  const r = await installer({ fam: 'mac', ctx: ctxMac, io: f.io })
  ok('mac, running with an older unit: file refreshed, DSH not stopped', r.ok === true && f.fs[chemin].includes('KeepAlive') && !f.cmds.some((c) => c.includes('bootout') || c.includes('bootstrap') || c.includes('kickstart')))
}
// ── macOS: launchd refuses → the folder is as it was found ──
{
  const f = faux({ echec: 'bootstrap' })
  const r = await installer({ fam: 'mac', ctx: ctxMac, io: f.io })
  ok('mac, refused: not ok, says why', r.ok === false && r.raison === 'command-failed' && r.message.includes('bootstrap'))
  ok('mac, refused: no file left behind', Object.keys(f.fs).length === 0)
  const chemin = '/Users/me/Library/LaunchAgents/com.kybernos.dsh-web.plist'
  const g = faux({ fichiers: { [chemin]: '<plist>mine</plist>' }, echec: 'bootstrap' })
  await installer({ fam: 'mac', ctx: ctxMac, io: g.io })
  ok('mac, refused: the previous file is put back', g.fs[chemin] === '<plist>mine</plist>')
}
// ── dry run ──
{
  const f = faux()
  const r = await installer({ fam: 'mac', ctx: ctxMac, io: f.io, dry: true })
  ok('dry: plan only, nothing written, nothing started', r.ok === true && r.dry === true && Object.keys(f.fs).length === 0 && f.cmds.every((c) => c.includes('print')))
}
// ── Linux ──
{
  const f = faux()
  const r = await installer({ fam: 'linux', ctx: ctxLinux, io: f.io })
  ok('linux: reload, then enable --now', r.ok === true && f.cmds.includes('systemctl --user daemon-reload') && f.cmds.includes('systemctl --user enable --now com.kybernos.dsh-web.service'))
  ok('linux: unit under ~/.config/systemd/user with Restart=always', Object.keys(f.fs)[0] === '/home/me/.config/systemd/user/com.kybernos.dsh-web.service' && Object.values(f.fs)[0].includes('Restart=always'))
  const g = faux()
  await installer({ fam: 'linux', ctx: ctxLinux, io: g.io, portOccupe: true })
  ok('linux, busy port: enabled without --now', g.cmds.includes('systemctl --user enable com.kybernos.dsh-web.service') && !g.cmds.some((c) => c.includes('--now')))
}
// ── Windows: nothing is written for a task nobody has seen run ──
{
  const f = faux()
  const r = await installer({ fam: 'windows', ctx: ctxMac, io: f.io })
  ok('windows: refused, says why, writes nothing', r.ok === false && r.raison === 'not-measured' && Object.keys(f.fs).length === 0 && f.cmds.length === 0)
}
// ── removing ──
{
  const f0 = faux()
  await installer({ fam: 'mac', ctx: ctxMac, io: f0.io })
  const f = faux({ fichiers: { ...f0.fs }, charge: true })
  const r = await retirer({ fam: 'mac', ctx: ctxMac, io: f.io })
  ok('remove: stops the job, deletes the file, says DSH was stopped', r.ok === true && r.arrete === true && Object.keys(f.fs).length === 0 && f.cmds.some((c) => c.includes('bootout gui/501/com.kybernos.dsh-web')))
  const g = faux()
  const rg = await retirer({ fam: 'mac', ctx: ctxMac, io: g.io })
  ok('remove: nothing there is not an error', rg.ok === true && rg.arrete === false && rg.etapes.length === 0)
}
// ── restarting through the supervisor ──
ok('restart: macOS kickstart -k on the unit', commandeRedemarrage('mac', ctxMac).join(' ') === 'launchctl kickstart -k gui/501/com.kybernos.dsh-web')
ok('restart: Linux systemctl restart', commandeRedemarrage('linux', ctxLinux).join(' ') === 'systemctl --user restart com.kybernos.dsh-web.service')
ok('restart: no command where nothing is installed', commandeRedemarrage('windows', ctxMac) === null)

console.log('START AT LOGIN — ' + total + ' assertions, ' + echecs.length + ' failure(s)')
for (const e of echecs) console.log('  ✗ ' + e)
process.exit(echecs.length === 0 ? 0 : 1)
