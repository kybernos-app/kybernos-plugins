// ═══════════════════════════════════════════════════════════════════════════
// @local/kybernos-modeles-locaux — hôte : détecter la machine, installer un
// modèle Ollama local, suivre le téléchargement. La moitié client (panneau en
// pied de Réglages → Models) vit dans client.js ; le BRANCHEMENT DSH (route
// `ollama-local` du namespace `llm-pi-ai`) est écrit par le client via
// remote.settings.mutate — le même canal que la page Models native.
//
// Honnêteté : ce fichier n'invente RIEN. La machine est mesurée (sysctl,
// hw.memsize, `ollama --version`, `ollama list`) ; le catalogue de
// recommandations vit côté client avec ses sources citées ; l'installation
// lance `ollama pull <id>` (ou `brew install ollama` d'abord, explicitement)
// et ne fait rien d'autre. Aucune écriture de configuration ici.
// ═══════════════════════════════════════════════════════════════════════════
import { execFile, spawn } from 'node:child_process'

// ── petits utilitaires HTTP (mêmes contrats que kybernos-models) ────────────
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

const sameOrigin = (req) => {
  try {
    const origin = req.headers.origin
    if (origin === undefined || origin === null || origin === '') return true
    const host = req.headers.host
    return origin === 'http://' + host || origin === 'https://' + host
  } catch (e) { return false }
}

// Un processus, une sortie texte bornée (les barres de progression d'ollama
// parlent en \r : on ne garde que la fin).
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

// ── détection machine (cache 30 s — sysctl ne change pas plus vite) ─────────
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
      models = liste.split(/\r?\n/).slice(1) // 1re ligne = en-tête « NAME ID SIZE MODIFIED »
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

// ── le job d'installation : UNE seule opération à la fois ───────────────────
// cible 'ollama' → `brew install ollama` (macOS, accord explicite du clic) ;
// cible <id>    → `ollama pull <id>`. Rien d'autre n'est exécutable.
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
  // Les étapes, dans l'ordre : 'ollama' → brew seul ; un modèle → pull seul,
  // ou (moteur absent, accord explicite du clic — la maquette dit « installé
  // au 1ᵉʳ téléchargement ») brew d'abord puis pull. La progression de chaque
  // étape réarme pct/octets/ligne pour la suivante.
  const etapes = []
  if (cible === 'ollama') etapes.push({ cmd: 'brew', args: ['install', 'ollama'] })
  else {
    if (chaineMoteur === true) etapes.push({ cmd: 'brew', args: ['install', 'ollama'] })
    // `ollama pull` exige le serveur : s'il ne tourne pas (installation brew
    // fraîche — mesuré 27/09 : pull → « could not connect to ollama server »),
    // on le démarre détaché puis on attend le port 11434 (30 s max). Un shell
    // `sh -c`, car le serveur doit survivre à l'étape.
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

// cible 'ollama' → brew seul ; un id de bibliothèque (qwen3.5:9b) ou une
// référence Hugging Face GGUF (hf.co/org/repo:Q4_K_M — Ollama sait tirer
// hf.co/… depuis 0.11) — « / » admis, « .. » refusé.
const ID_VALIDE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,100}$/

export function apply(ctx) {
  try {
    ctx.inject(['webServer'], (hostCtx) => {
      const webServer = hostCtx.get('webServer')

      // Machine mesurée : chip, RAM, présence d'Ollama, modèles déjà tirés.
      hostCtx.effect(() => webServer.register({ kind: 'exact', path: '/modeles-locaux/machine', handler: async (req, res) => {
        const force = req.url !== undefined && String(req.url).indexOf('force=1') >= 0
        try { sendJson(res, 200, { ok: true, machine: await lireMachine(force) }) }
        catch (e) { sendJson(res, 200, { ok: false, error: String(e && e.message ? e.message : e) }) }
      }}), 'modeles-locaux: machine')

      // État du job (le client interroge toutes les 600 ms pendant un tirage).
      hostCtx.effect(() => webServer.register({ kind: 'exact', path: '/modeles-locaux/installation', handler: async (req, res) => {
        if (job === null) { sendJson(res, 200, { ok: true, job: null }); return }
        const { child, ...reste } = job
        sendJson(res, 200, { ok: true, job: reste })
      }}), 'modeles-locaux: installation (état)')

      // Démarrage : 'ollama' (brew) ou un id de modèle (charset sûr). Un seul
      // job à la fois ; un job en cours répond 409 sans rien casser.
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
            // Pas de moteur : on refuse — SAUF accord explicite (le bouton de
            // la maquette « Installer » porte installeMoteur), auquel cas le
            // job enchaîne brew install ollama puis le pull (macOS).
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
