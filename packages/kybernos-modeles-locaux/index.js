// ═══════════════════════════════════════════════════════════════════════════
// @local/kybernos-modeles-locaux — host: detect the machine, install a
// local Ollama model, follow the download. The client half (panel at the
// foot of Settings → Models) lives in client.js; the DSH WIRING (the
// `ollama-local` route of the `llm-pi-ai` namespace) is written by the client through
// remote.settings.mutate — the same channel as the native Models page.
//
// Honesty: this file invents NOTHING. The machine is measured (sysctl,
// hw.memsize, `ollama --version`, `ollama list`); the catalogue of
// recommendations lives on the client side with its sources cited; the installation
// runs `ollama pull <id>` (or `brew install ollama` first, explicitly)
// and does nothing else. No configuration write here.
// ═══════════════════════════════════════════════════════════════════════════
import { execFile, spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadKeys, loadShipped, serveCatalogue } from './modeles-distant.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const CATALOGUE_FILE = join(HERE, 'catalogue.json')
export const KEYS_FILE = join(HERE, 'models-pubkey.json')

// The DSH home, the way DSH resolves it (DSH_HOME when set, `~` expanded, else <home of the OS user>/.dsh): the catalogue
// the page last verified is cached under it, so an isolated instance never reads or writes the user's own folder.
export function resolveDshHome(env = process.env, osHome = homedir) {
  try {
    const fromEnv = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
    if (fromEnv !== '') {
      if (fromEnv === '~') return osHome()
      return resolve(fromEnv.startsWith('~/') ? join(osHome(), fromEnv.slice(2)) : fromEnv)
    }
    const base = typeof env.HOME === 'string' && env.HOME.length > 0 ? env.HOME : osHome()
    return typeof base === 'string' && base.length > 0 ? join(base, '.dsh') : null
  } catch (e) { return null }
}

// ── small HTTP helpers (same contracts as kybernos-models) ────────────
const sendJson = (res, status, body) => {
  try {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  } catch (e) { try { res.end('{}') } catch (e2) { /* socket fermé */ } }
}

const readBody = (req) => new Promise((resolve) => {
  let raw = ''
  try {
    req.on('data', (chunk) => { raw += chunk; if (raw.length > 200_000) raw = raw.slice(0, 200_000) })
    req.on('end', () => { try { resolve(raw.length === 0 ? {} : JSON.parse(raw)) } catch (e) { resolve(null) } })
    req.on('error', () => resolve(null))
  } catch (e) { resolve(null) }
})

// Hosted instance: also accept the authorities declared to DSH with --trusted-host. The core bundle publishes the predicate
// (kybernos-plugin/trusted-authority.mjs); absent or failing, it answers false and the guard stays loopback-only.
const kbTrusted = (host) => { try { const f = globalThis[Symbol.for('kybernos.trustedAuthority')]; return typeof f === 'function' && f(host) === true } catch (e) { return false } }
// Host fence (scripts/test-route-hosts.mjs). DSH serves plugin routes BEFORE its own authentication, and a page that rebinds its own name to this machine
// (DNS rebinding) reaches them with its own name as Host, no cookie and, on a same-origin GET, no Origin (a browser sends none): a guard that looks at the
// Origin alone lets every read through. Every route of this bundle refuses a Host that is not this listener's (the port the socket is bound to, on
// 127.0.0.1 / localhost / [::1], or an authority declared with --trusted-host) before its own guard runs. A request with no socket (a test) is not judged.
const kbHostOK = (req) => {
  try {
    const host = req.headers !== null && req.headers !== undefined && typeof req.headers.host === 'string' ? req.headers.host : null
    const sock = req.socket !== null && req.socket !== undefined ? req.socket : null
    if (host === null || sock === null || typeof sock.localPort !== 'number') return true
    const port = ':' + sock.localPort
    return ['127.0.0.1' + port, 'localhost' + port, '[::1]' + port].indexOf(host) >= 0 || kbTrusted(host)
  } catch (e) { return false }
}
const kbFenced = (service) => {
  if (service === null || service === undefined || typeof service.register !== 'function') return service
  const fence = (route) => (route !== null && typeof route === 'object' && typeof route.handler === 'function'
    ? Object.assign({}, route, {
      handler: (req, res, ...rest) => {
        if (kbHostOK(req) !== true) {
          try { res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' }); res.end('{"ok":false,"error":"origin refused"}') } catch (e) { /* closed */ }
          return undefined
        }
        return route.handler(req, res, ...rest)
      },
    })
    : route)
  return new Proxy(service, { get: (target, key) => (key === 'register' ? (route) => target.register(fence(route)) : (typeof target[key] === 'function' ? target[key].bind(target) : target[key])) })
}

// A request that says nothing about where it comes from (no Origin, no Referer: a script, another local user) may read; it may not
// write. A page of this DSH always says it on a write, so this refuses no one the person can see (A3-29).
const sameOrigin = (req) => {
  try {
    const h = req.headers || {}
    const origin = typeof h.origin === 'string' && h.origin !== '' ? h.origin : (typeof h.referer === 'string' ? h.referer : '')
    if (origin === '') return ['GET', 'HEAD'].indexOf(String(req.method || '').toUpperCase()) >= 0
    const u = new URL(origin)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const sock = req.socket !== null && req.socket !== undefined ? req.socket : null
    // A real connection: the origin is compared with what THIS listener really is (the socket's port), never with the client-supplied Host header
    // alone (a page that rebinds its own name sends the same authority as Host and as Origin). No socket = a synthetic caller (a test).
    if (sock === null || typeof sock.localPort !== 'number') return typeof req.headers.host === 'string' && u.host === req.headers.host
    const port = ':' + sock.localPort
    return (['127.0.0.1' + port, 'localhost' + port, '[::1]' + port].indexOf(u.host) >= 0 || kbTrusted(u.host))
  } catch (e) { return false }
}

// One process, one bounded text output (ollama's progress bars
// speak in \r: only the end is kept).
const exec1 = (cmd, args, timeoutMs = 4000) => new Promise((resolve) => {
  try {
    execFile(cmd, args, { timeout: timeoutMs, encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 512 },
      (err, stdout) => { resolve(err ? null : String(stdout)) })
  } catch (e) { resolve(null) }
})

const dernierSegment = (txt) => {
  const brut = String(txt === null || txt === undefined ? '' : txt)
  const morceaux = brut.split(/[\r\n]+/).map((s) => s.trim()).filter((s) => s.length > 0)
  return morceaux.length > 0 ? morceaux[morceaux.length - 1] : ''
}

// ── machine detection (30 s cache — sysctl does not change faster) ─────────
let machineCache = null // { at, data }
const MACHINE_TTL_MS = 30_000

// `exec` is a seam for the tests (a command and its arguments in, the text out, or null when it failed).
export const mesurerMachine = async (exec = exec1) => {
  const [chip, memsize] = await Promise.all([
    exec('sysctl', ['-n', 'machdep.cpu.brand_string']),
    exec('sysctl', ['-n', 'hw.memsize']),
  ])
  const ramGo = /^\d+$/.test(String(memsize === null ? '' : memsize).trim())
    ? Math.round(Number(memsize.trim()) / (1024 ** 3)) : null
  const versionBrut = await exec('ollama', ['--version'])
  const present = versionBrut !== null
  const version = present ? dernierSegment(versionBrut).replace(/^.*version is\s*/i, '') : null
  let models = []
  // `serveur`: does the Ollama SERVER answer? The `ollama` program being installed says nothing about it, and `ollama list` is the
  // cheapest call that needs the server. null = no program, so no question; false = installed but not running (an empty `models`
  // then means "unknown", not "none pulled").
  let serveur = null
  if (present === true) {
    const liste = await exec('ollama', ['list'], 8000)
    serveur = liste !== null
    if (liste !== null) {
      models = liste.split(/\r?\n/).slice(1) // first line = header « NAME ID SIZE MODIFIED »
        .map((l) => l.trim()).filter((l) => l.length > 0)
        .map((l) => ({ id: l.split(/\s+/)[0], taille: l.split(/\s+/)[2] || null }))
    }
  }
  return {
    at: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    chip: chip === null ? null : dernierSegment(chip),
    ramGo,
    ollama: { present, version, models, serveur },
  }
}

const lireMachine = async (force) => {
  if (force !== true && machineCache !== null && (Date.now() - machineCache.atMs) < MACHINE_TTL_MS) return machineCache.data
  const data = await mesurerMachine()
  machineCache = { atMs: Date.now(), data }
  return data
}

// ── the install job: ONE operation at a time ───────────────────
// target 'ollama' → `brew install ollama` (macOS, the click is the explicit consent);
// target <id>   → `ollama pull <id>`. Nothing else can be executed.
let job = null

const pourcentDe = (txt) => {
  const hit = /(\d{1,3})\s*%/.exec(String(txt === null ? '' : txt))
  return hit === null ? null : Math.min(100, Number(hit[1]))
}

const octetsDe = (txt) => {
  const hit = /([\d.]+)\s*(GB|MB|KB)\s*\/\s*([\d.]+)\s*(GB|MB|KB)/i.exec(String(txt === null ? '' : txt))
  return hit === null ? null : { recu: hit[1] + ' ' + hit[2], total: hit[3] + ' ' + hit[4] }
}

const lancerJob = (cible, chaineMoteur) => {
    // The steps, in order: 'ollama' → brew alone; a model → pull alone,
    // or (engine missing, explicit consent of the click — the mock-up says « installed
    // on first download ») brew first then pull. Each
    // step's progress re-arms pct/bytes/line for the next one.
  const etapes = []
  if (cible === 'ollama') etapes.push({ cmd: 'brew', args: ['install', 'ollama'] })
  else {
    if (chaineMoteur === true) etapes.push({ cmd: 'brew', args: ['install', 'ollama'] })
        // `ollama pull` needs the server: if it is not running (fresh brew
        // install — measured 27/09: pull → « could not connect to ollama server »),
        // it is started detached, then the port 11434 is waited for (30 s max). A
        // `sh -c` shell, because the server must outlive the step.
    etapes.push({
      cmd: 'sh',
      args: ['-c', 'curl -s -o /dev/null -m 2 http://127.0.0.1:11434/ 2>/dev/null && exit 0; (nohup ollama serve >/dev/null 2>&1 &); i=0; until curl -s -o /dev/null -m 2 http://127.0.0.1:11434/ 2>/dev/null; do i=$((i+1)); if [ "$i" -gt 30 ]; then echo "serveur ollama introuvable sur 11434"; exit 20; fi; sleep 1; done'],
      shim: true,
    })
    etapes.push({ cmd: 'ollama', args: ['pull', cible] })
  }
  const j = {
    cible,
    cmd: etapes.map((x) => x.cmd + ' ' + x.args.join(' ')).join(' && '),
    demarreA: new Date().toISOString(),
    running: true, ok: null, code: null, annule: false,
    pct: null, octets: null, ligne: '',
    child: null,
  }
  let index = 0
  const absorbe = (txt) => {
    const fin = dernierSegment(txt)
    if (fin.length > 0) j.ligne = fin.slice(0, 200)
    const p = pourcentDe(txt)
    if (p !== null) j.pct = p
    const o = octetsDe(txt)
    if (o !== null) j.octets = o
  }
  const etapeSuivanteOuFin = (code, signal) => {
    if (signal === 'SIGTERM') { j.running = false; j.ok = false; j.annule = true; return }
    if (code !== 0) { j.running = false; j.ok = false; j.code = code; return }
    index += 1
    if (index >= etapes.length) { j.running = false; j.ok = true; j.code = 0; return }
    let enfant = null
    try { enfant = spawn(etapes[index].cmd, etapes[index].args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }) } catch (e) { j.running = false; j.ok = false; j.erreur = 'lancement impossible'; return }
    j.child = enfant
    j.pct = null; j.octets = null; j.ligne = ''
    enfant.stdout.on('data', absorbe)
    enfant.stderr.on('data', absorbe)
    enfant.on('error', () => { j.running = false; j.ok = false; j.erreur = 'lancement impossible' })
    enfant.on('close', etapeSuivanteOuFin)
  }
  let premier = null
  try { premier = spawn(etapes[0].cmd, etapes[0].args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }) } catch (e) { return null }
  j.child = premier
  premier.stdout.on('data', absorbe)
  premier.stderr.on('data', absorbe)
  premier.on('error', () => { j.running = false; j.ok = false; j.erreur = 'lancement impossible' })
  premier.on('close', etapeSuivanteOuFin)
  return j
}

// target 'ollama' → brew alone; a library id (qwen3.5:9b) or a
// Hugging Face GGUF reference (hf.co/org/repo:Q4_K_M — Ollama can pull
// hf.co/… since 0.11) — « / » allowed, « .. » refused.
const ID_VALIDE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,100}$/

// ── new-model discovery (Refresh button) ────────────────────────────────────
// The model ids seen by the LAST scan (module state, resets on restart). The
// first scan seeds the set, so it never reports false "new" for models that
// were already there; later scans report what appeared since.
let idsConnus = null

// Ask the Ollama SERVER itself (http://127.0.0.1:11434/api/tags) for the list
// of models it currently serves — a real interrogation, not a local re-read.
const listerTagsOllama = async () => {
  try {
    const r = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(4000) })
    if (!r.ok) return null
    const body = await r.json()
    if (body === null || !Array.isArray(body.models)) return null
    return body.models
      .filter((m) => m && typeof m.name === 'string' && m.name.length > 0)
      .map((m) => ({ id: m.name, taille: typeof m.size === 'number' ? Math.round(m.size / (1024 ** 3) * 10) / 10 + ' Go' : null }))
  } catch (e) { return null }
}

export function apply(ctx) {
  try {
    ctx.inject(['webServer'], (hostCtx) => {
      const webServer = kbFenced(hostCtx.get('webServer'))

            // Measured machine: chip, RAM, presence of Ollama, models already pulled.
      hostCtx.effect(() => webServer.register({ kind: 'exact', path: '/modeles-locaux/machine', handler: async (req, res) => {
        const force = req.url !== undefined && String(req.url).indexOf('force=1') >= 0
        try { sendJson(res, 200, { ok: true, machine: await lireMachine(force) }) }
        catch (e) { sendJson(res, 200, { ok: false, error: String(e && e.message ? e.message : e) }) }
      }}), 'modeles-locaux: machine')

      // The catalogue of models the page recommends: the one shipped with this bundle, or the signed online one (verified,
      // cached, never believed without its signature). GET reads the disk only; POST { op: 'refresh' } asks the network.
      hostCtx.effect(() => webServer.register({ kind: 'exact', path: '/modeles-locaux/catalogue', handler: (req, res) => serveCatalogue(req, res, {
        home: async () => resolveDshHome(),
        sameOriginStrict: sameOrigin,
        sameOriginLax: sameOrigin,
        readJson: async (r) => { const b = await readBody(r); if (b === null) throw new Error('unreadable body'); return b },
        send: sendJson,
        shipped: () => loadShipped(CATALOGUE_FILE),
        keys: () => loadKeys(KEYS_FILE),
      }) }), 'modeles-locaux: catalogue (signé)')

      // Scan for newly installed compatible models (the "Re-check" button):
      // interrogate /api/tags, diff against the ids seen last time.
      hostCtx.effect(() => webServer.register({ kind: 'exact', path: '/modeles-locaux/decouvrir', handler: async (req, res) => {
        if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method' }); return }
        if (sameOrigin(req) !== true) { sendJson(res, 403, { ok: false, error: 'origin' }); return }
        try {
          const modeles = await listerTagsOllama()
          if (modeles === null) { sendJson(res, 200, { ok: false, error: 'serveur-ollama-inaccessible' }); return }
          const ids = modeles.map((m) => m.id)
          let nouveaux = []
          if (idsConnus !== null) nouveaux = modeles.filter((m) => !idsConnus.has(m.id))
          idsConnus = new Set(ids)
          sendJson(res, 200, { ok: true, nouveaux, total: ids.length })
        } catch (e) { sendJson(res, 200, { ok: false, error: String(e && e.message ? e.message : e) }) }
      }}), 'modeles-locaux: decouvrir (nouveaux modèles)')

            // Job state (the client polls every 600 ms during a pull).
      hostCtx.effect(() => webServer.register({ kind: 'exact', path: '/modeles-locaux/installation', handler: async (req, res) => {
        if (job === null) { sendJson(res, 200, { ok: true, job: null }); return }
        const { child, ...reste } = job
        sendJson(res, 200, { ok: true, job: reste })
      }}), 'modeles-locaux: installation (état)')

            // Start: 'ollama' (brew) or a model id (safe charset). One
            // job at a time; a running job answers 409 without breaking anything.
      hostCtx.effect(() => webServer.register({ kind: 'exact', path: '/modeles-locaux/installer', handler: async (req, res) => {
        if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method' }); return }
        if (sameOrigin(req) !== true) { sendJson(res, 403, { ok: false, error: 'origin' }); return }
        const body = await readBody(req)
        const cible = body !== null && typeof body.cible === 'string' ? body.cible : ''
        if (cible.length === 0) { sendJson(res, 400, { ok: false, error: 'cible-absente' }); return }
        if (job !== null && job.running === true) { sendJson(res, 409, { ok: false, error: 'occupe', cmd: job.cmd }); return }
        if (cible !== 'ollama' && ID_VALIDE.test(cible) !== true) { sendJson(res, 400, { ok: false, error: 'id-invalide' }); return }
        if (cible !== 'ollama' && cible.indexOf('..') >= 0) { sendJson(res, 400, { ok: false, error: 'id-invalide' }); return }
        const veutMoteur = body !== null && body.installeMoteur === true
        if (cible === 'ollama') {
          if (process.platform !== 'darwin') {
            sendJson(res, 400, { ok: false, error: 'brew-indisponible',
              astuce: "installe Ollama depuis https://ollama.com/download puis reviens" })
            return
          }
        } else {
          const m = await lireMachine(false)
          if (m.ollama.present !== true) {
                        // No engine: refused — UNLESS explicit consent (the mock-up's
                        // « Install » button carries installeMoteur), in which case the
                        // job chains brew install ollama then the pull (macOS).
            if (veutMoteur !== true || process.platform !== 'darwin') {
              sendJson(res, 409, { ok: false, error: 'ollama-absent' }); return
            }
          }
        }
        const j = lancerJob(cible, veutMoteur === true && cible !== 'ollama')
        if (j === null) { sendJson(res, 500, { ok: false, error: 'spawn' }); return }
        job = j
        sendJson(res, 200, { ok: true, demarre: true, cmd: j.cmd })
      }}), 'modeles-locaux: installation (démarrage)')

      // Annulation : SIGTERM sur le tirage en cours.
      hostCtx.effect(() => webServer.register({ kind: 'exact', path: '/modeles-locaux/annuler', handler: async (req, res) => {
        if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method' }); return }
        if (sameOrigin(req) !== true) { sendJson(res, 403, { ok: false, error: 'origin' }); return }
        if (job === null || job.running !== true) { sendJson(res, 200, { ok: true, annule: false }); return }
        try { job.child.kill('SIGTERM') } catch (e) { /* déjà mort */ }
        sendJson(res, 200, { ok: true, annule: true })
      }}), 'modeles-locaux: installation (annulation)')
    })
  } catch (bootError) {
    try { console.error('[kybernos-modeles-locaux] montage des routes impossible', bootError) } catch (e2) { /* console indisponible */ }
  }
}
