#!/usr/bin/env node
// ── Open Kybernos: start it if it is not running, wait until it is ready, open the browser already signed in ──
//
//   node scripts/kybernos-open.mjs [--port 3080] [--timeout 90] [--no-browser]
//
// The one gesture for a person who does not use a terminal: a launcher (a shortcut, a Dock item) runs this and nothing else.
//   running and ready  → opens the browser. Nothing is started, nothing is cut.
//   not running        → starts it through the supervisor that owns it (LaunchAgent / systemd unit) when there is one, else a detached
//                        `dsh web`; waits until the plugin routes are mounted (~20 s measured: the port answers after ~3 s, the routes after ~15 s).
//   never ready        → exit 1 after the timeout with the log's path. It never opens a page that would show the engine's error card.
//
// The sign-in address (it carries a one-time token) is read from DSH's own output log and never printed. It is used only if the server accepts
// it; otherwise the bare address is opened, which works as long as the browser still holds its cookie (30 days).
import { spawn, execFile } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { etiquette, trouverDsh } from './service-demarrage.mjs'

const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

/** The last `dsh web: http…` line of the output log: the address DSH printed for this run, or null. */
export const adresseDuJournal = (texte) => {
  const lignes = String(texte ?? '').split('\n').filter((l) => l.includes('dsh web: http'))
  if (lignes.length === 0) return null
  const l = lignes.at(-1)
  const url = l.slice(l.indexOf('http')).trim()
  return /^http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+$/.test(url) ? url : null
}

/**
 * `d`: { port, fetch, journal() → text, demarrerService() → Promise<bool> (true = the supervisor was asked), demarrerDetache() → Promise<void>,
 * navigateur(url) → Promise<void>, attendre(ms), maintenant(), delaiMs, pas, dire(msg) }. Returns { ok, demarre, signe, raison? }.
 */
export async function ouvrir (d) {
  const base = 'http://127.0.0.1:' + d.port + '/'
  // « ready » = the hub's own route answers: it is mounted with the plugins, so the page will find them. Plugin routes are served before sign-in.
  const pret = async () => { try { return (await d.fetch(base + 'kybernos-hub/state')).ok } catch { return false } }
  // « listening » = any HTTP answer at all (the engine says 401 to anyone without a cookie).
  const ecoute = async () => { try { await d.fetch(base, { redirect: 'manual' }); return true } catch { return false } }
  let demarre = false
  if (!(await pret())) {
    if (!(await ecoute())) {
      demarre = true
      d.dire('Starting Kybernos…')
      if (!(await d.demarrerService())) await d.demarrerDetache()
    } else d.dire('Kybernos is starting…')
    const fin = d.maintenant() + d.delaiMs
    while (!(await pret())) {
      if (d.maintenant() >= fin) return { ok: false, raison: 'timeout', demarre }
      await d.attendre(d.pas ?? 500)
    }
  }
  let url = base
  const propose = adresseDuJournal(d.journal())
  if (propose !== null) {
    // A log line from an earlier run carries a token the running server does not know (it answers 401): then the bare address is used.
    try { if ((await d.fetch(propose, { redirect: 'manual' })).status === 303) url = propose } catch { /* bare address */ }
  }
  await d.navigateur(url)
  return { ok: true, demarre, signe: url !== base }
}

// ── the real I/O ────────────────────────────────────────────────────────────
const executer = (cmd) => new Promise((res) => execFile(cmd[0], cmd.slice(1), { timeout: 15_000, windowsHide: true }, (e) => res(e ? (e.code ?? 1) : 0)))

export const depsReelles = ({ port, delaiS, navigateur = true }) => {
  const home = homedir()
  const dshHome = process.env.DSH_HOME || join(home, '.dsh')
  const logs = join(dshHome, 'logs')
  const sortie = port === 3080 ? join(logs, 'dsh-web.out.log') : join(logs, 'dsh-web-' + port + '.out.log')
  const erreur = sortie.replace('.out.', '.err.')
  const uid = process.getuid?.() ?? ''
  const label = etiquette(port)
  return {
    port,
    delaiMs: delaiS * 1000,
    fetch: (url, opts = {}) => fetch(url, { ...opts, signal: AbortSignal.timeout(3000) }),
    journal: () => { try { return readFileSync(sortie, 'utf8') } catch { return '' } },
    attendre: dormir,
    maintenant: () => Date.now(),
    dire: (m) => console.log(m),
    demarrerService: async () => {
      // Only a supervisor that exists is asked; nothing is installed from here.
      if (process.platform === 'darwin') {
        if (!existsSync(join(home, 'Library', 'LaunchAgents', label + '.plist'))) return false
        if ((await executer(['launchctl', 'print', 'gui/' + uid + '/' + label])) !== 0) return false
        return (await executer(['launchctl', 'kickstart', 'gui/' + uid + '/' + label])) === 0
      }
      if (process.platform === 'linux') {
        if (!existsSync(join(home, '.config', 'systemd', 'user', label + '.service'))) return false
        return (await executer(['systemctl', '--user', 'start', label + '.service'])) === 0
      }
      return false
    },
    demarrerDetache: async () => {
      const dsh = trouverDsh({ dirs: String(process.env.PATH ?? '').split(delimiter), home, existe: existsSync, nom: process.platform === 'win32' ? 'dsh.cmd' : 'dsh' })
      if (dsh === null) throw new Error('`dsh` was not found: install Kybernos first (./kybernos-install).')
      mkdirSync(logs, { recursive: true })
      const out = openSync(sortie, 'a'); const err = openSync(erreur, 'a')
      const enfant = spawn(dsh, ['web', '--no-open', '--port', String(port)], { detached: true, stdio: ['ignore', out, err], cwd: home, windowsHide: true })
      enfant.unref(); closeSync(out); closeSync(err)
    },
    navigateur: async (url) => {
      if (!navigateur) return
      const cmd = process.platform === 'darwin' ? ['open', url] : (process.platform === 'win32' ? ['cmd', '/c', 'start', '', url] : ['xdg-open', url])
      spawn(cmd[0], cmd.slice(1), { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    },
    _sortie: sortie,
  }
}

const valeur = (args, nom, defaut) => { const i = args.indexOf(nom); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : defaut }

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const port = Number(valeur(args, '--port', process.env.KB_PORT || 3080))
  const d = depsReelles({ port, delaiS: Number(valeur(args, '--timeout', 90)), navigateur: !args.includes('--no-browser') })
  try {
    const r = await ouvrir(d)
    if (r.ok) { console.log(r.demarre ? 'Kybernos is ready.' : 'Kybernos is running.'); process.exit(0) }
    console.log('Kybernos did not become ready within ' + valeur(args, '--timeout', 90) + ' s. The server log: ' + d._sortie.replace('.out.', '.err.'))
    process.exit(1)
  } catch (e) {
    console.log(String(e?.message ?? e)); process.exit(1)
  }
}
