// ── kybernos-workers · host logic ───────────────────────────────────────────
// "Workers" are the external coding agents DSH can drive (Claude Code, Codex, Gemini,
// OpenCode, Qwen, Hermes, ZCode). This module does four things, and only those:
//
//   1. READ the profile: is the connection mounted? does the tool line that exposes the
//      worker to the lead exist, and in which state?
//   2. CHECK for real (no model is called, so nothing is spent on the worker's
//      subscription): connection mounted, package installed, binary found in the PATH DSH
//      sees, sign-in reported by the CLI (or the API key present in DSH's environment),
//      write test in a throw-away git worktree.
//   3. SET the one policy DSH really exposes: the `@deepseek-ai/dsh-tool-subagent` line
//      (exposed to the lead or not, background allowed or not). Model, permissions and the
//      account stay the native product's: the connection packages have no key for them.
//   4. HELP a person get a worker running: mount a connection of ours (`activate`) and
//      install the program itself (`install`) from a CLOSED list of official commands,
//      only after the page showed the exact command and the person confirmed it.
//
// All I/O is injected (`deps`, `io`): test-host.mjs plays this file without DSH, without a
// real disk and without a browser. No @deepseek-ai/* import.

export const PAQUET_OUTIL = '@deepseek-ai/dsh-tool-subagent'
export const PAQUET_MCP = '@deepseek-ai/dsh-mcp-client'

/**
 * The official install command of each worker. A closed list: the page never sends a command
 * to run, only the id of a worker (and the command it showed, which must match this one).
 *   needs : programs that must be on the PATH for the command to work
 *   alt   : the Homebrew / npm alternative shown for people who prefer to run it themselves
 *   src   : where the command downloads from, shown before the person confirms
 *   doc   : the vendor's own installation guide
 */
const INSTALL = Object.freeze({
  'claude-code': Object.freeze({ cmd: 'curl -fsSL https://claude.ai/install.sh | bash', alt: 'brew install --cask claude-code', src: 'claude.ai', needs: ['curl', 'bash'], doc: 'https://code.claude.com/docs/en/setup' }),
  codex: Object.freeze({ cmd: 'npm install -g @openai/codex', alt: 'brew install --cask codex', src: 'npm', needs: ['npm'], doc: 'https://github.com/openai/codex' }),
  gemini: Object.freeze({ cmd: 'npm install -g @google/gemini-cli', alt: 'brew install gemini-cli', src: 'npm', needs: ['npm'], doc: 'https://github.com/google-gemini/gemini-cli' }),
  opencode: Object.freeze({ cmd: 'curl -fsSL https://opencode.ai/install | bash', alt: 'npm install -g opencode-ai', src: 'opencode.ai', needs: ['curl', 'bash'], doc: 'https://opencode.ai/docs/' }),
  qwen: Object.freeze({ cmd: 'npm install -g @qwen-code/qwen-code@latest', alt: 'brew install qwen-code', src: 'npm', needs: ['npm'], doc: 'https://github.com/QwenLM/qwen-code' }),
  hermes: Object.freeze({ cmd: 'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash', src: 'hermes-agent.nousresearch.com', needs: ['curl', 'bash'], doc: 'https://github.com/NousResearch/hermes-agent' })
})

const tool = (id, provider) => Object.freeze({ id: 'kybernos-workers-' + id, provider, toolName: 'subagent_' + provider.replace(/-/g, '_') })

/**
 * Frozen registry of the known workers, in display order.
 *   genre      : 'connexion' (an official or home-made subagent package) | 'mcp' (a local MCP server)
 *   activation : who mounts the connection. 'outils' = the Tools screen of the main plugin
 *                (/kybernos/tools/apply), 'workers' = this module (/kybernos-workers/activate)
 *   auth       : how "signed in" is verified without calling a model
 *                { format: 'json-loggedIn' | 'code' | 'count' | 'hermes', args }  → run the CLI
 *                { format: 'env', names }                                         → key in DSH's environment
 *   connect    : what the person has to do once the program is installed
 *                { mode: 'cli', cmd }  sign in from a terminal
 *                { mode: 'key', env, refs }  paste an API key (stored under `env`, found under any of `refs`)
 */
export const WORKERS = Object.freeze([
  Object.freeze({
    id: 'claude-code', nom: 'Claude Code', genre: 'connexion', via: 'claude-agent-sdk', activation: 'outils',
    paquet: '@deepseek-ai/dsh-subagent-claude-code', outil: tool('claude-code', 'claude-code'),
    binaire: 'claude', versionArgs: ['--version'], auth: Object.freeze({ format: 'json-loggedIn', args: Object.freeze(['auth', 'status']) }),
    install: INSTALL['claude-code'], connect: Object.freeze({ mode: 'cli', cmd: 'claude' })
  }),
  Object.freeze({
    id: 'codex', nom: 'Codex', genre: 'connexion', via: 'app-server', activation: 'outils',
    paquet: '@deepseek-ai/dsh-subagent-codex', outil: tool('codex', 'codex'),
    binaire: 'codex', versionArgs: ['--version'], auth: Object.freeze({ format: 'code', args: Object.freeze(['login', 'status']) }),
    install: INSTALL.codex, connect: Object.freeze({ mode: 'cli', cmd: 'codex' })
  }),
  Object.freeze({
    id: 'gemini', nom: 'Gemini CLI', genre: 'connexion', via: 'cli-one-shot', activation: 'workers',
    paquet: 'dsh-subagent-gemini', outil: tool('gemini', 'gemini'),
    binaire: 'gemini', versionArgs: ['--version'], auth: Object.freeze({ format: 'env', names: Object.freeze(['GEMINI_API_KEY', 'GOOGLE_API_KEY']) }),
    install: INSTALL.gemini, connect: Object.freeze({ mode: 'key', env: 'GEMINI_API_KEY', refs: Object.freeze(['GEMINI_API_KEY', 'GOOGLE_API_KEY']) })
  }),
  Object.freeze({
    id: 'opencode', nom: 'OpenCode', genre: 'connexion', via: 'cli-one-shot', activation: 'workers',
    paquet: 'dsh-subagent-opencode', outil: tool('opencode', 'opencode'),
    binaire: 'opencode', versionArgs: ['--version'], auth: Object.freeze({ format: 'count', args: Object.freeze(['auth', 'list']) }),
    install: INSTALL.opencode, connect: Object.freeze({ mode: 'cli', cmd: 'opencode auth login' })
  }),
  Object.freeze({
    id: 'qwen', nom: 'Qwen Code', genre: 'connexion', via: 'cli-one-shot', activation: 'workers',
    paquet: 'dsh-subagent-qwen', outil: tool('qwen', 'qwen'),
    binaire: 'qwen', versionArgs: ['--version'], auth: Object.freeze({ format: 'env', names: Object.freeze(['QWEN_TOKEN_PLAN_API_KEY', 'DASHSCOPE_API_KEY']) }),
    install: INSTALL.qwen, connect: Object.freeze({ mode: 'key', env: 'QWEN_TOKEN_PLAN_API_KEY', refs: Object.freeze(['QWEN_TOKEN_PLAN_API_KEY', 'DASHSCOPE_API_KEY']) })
  }),
  Object.freeze({
    id: 'hermes', nom: 'Hermes', genre: 'connexion', via: 'cli-one-shot', activation: 'workers',
    paquet: 'dsh-subagent-hermes', outil: tool('hermes', 'hermes'),
    binaire: 'hermes', versionArgs: ['--version'], auth: Object.freeze({ format: 'hermes', args: Object.freeze(['status']), timeoutMs: 40000 }),
    install: INSTALL.hermes, connect: Object.freeze({ mode: 'cli', cmd: 'hermes model' })
  }),
  Object.freeze({
    id: 'zcode', nom: 'ZCode', genre: 'mcp', via: 'mcp-local', activation: 'outils', mcpId: 'mcp-client-zcode', serverName: 'zcode',
    install: null, connect: null
  })
])

export const trouverWorker = (id) => WORKERS.find((w) => w.id === id)

// ── reading the profile patch ───────────────────────────────────────────────

const nettoyer = (brut) => {
  let v = String(brut ?? '').replace(/\s+#.*$/, '').trim()
  if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1)
  return v
}

/**
 * Splits `cordis.patch.yml` into its `- id: …` lines (the inserted entries). This is not a
 * YAML reader: the patch is written by this repo and by the Tools screen in a fixed shape
 * (regular indentation, one-line scalars). What is not recognised is ignored, never guessed.
 * @returns {{id:string, debut:number, fin:number, indent:number, cles:string[], clesConfig:string[], champs:Record<string,string>, config:Record<string,string>}[]}
 */
export function analyserPatch (texte) {
  const lignes = String(texte ?? '').split('\n')
  const items = []
  let cur = null
  let enConfig = false
  for (let i = 0; i < lignes.length; i++) {
    const l = lignes[i]
    if (/^\s*#/.test(l) || l.trim() === '') continue
    const m = /^(\s*)-\s+id:\s*(.+)$/.exec(l)
    if (m) {
      cur = { id: nettoyer(m[2]), debut: i, fin: i, indent: m[1].length, cles: [], clesConfig: [], champs: {}, config: {} }
      items.push(cur)
      enConfig = false
      continue
    }
    if (/^\S/.test(l)) { cur = null; enConfig = false; continue }
    if (cur === null) continue
    const ind = /^(\s*)/.exec(l)[1].length
    if (ind <= cur.indent) { cur = null; enConfig = false; continue }
    cur.fin = i
    const kv = /^\s*([A-Za-z_][\w-]*):\s*(.*)$/.exec(l)
    if (kv === null) continue
    if (ind === cur.indent + 2) {
      cur.cles.push(kv[1])
      enConfig = kv[1] === 'config'
      if (!enConfig) cur.champs[kv[1]] = nettoyer(kv[2])
    } else if (enConfig && ind === cur.indent + 4) {
      cur.clesConfig.push(kv[1])
      cur.config[kv[1]] = nettoyer(kv[2])
    }
  }
  return items
}

const estLigneOutil = (it, worker) => it.champs.name === PAQUET_OUTIL && it.config.provider === worker.outil?.provider

/**
 * What the profile says about a worker: is the connection mounted? is there a tool line?
 * `nous` = the line carries the id THIS module writes (so it may be edited here).
 */
export function etatProfil (texte, worker) {
  const items = analyserPatch(texte)
  let connexion = false
  if (worker.genre === 'connexion') connexion = items.some((it) => it.champs.name === worker.paquet)
  else if (worker.genre === 'mcp') connexion = items.some((it) => it.id === worker.mcpId || (it.champs.name === PAQUET_MCP && it.config.serverName === worker.serverName))
  let ligne = null
  if (worker.genre === 'connexion') {
    const it = items.find((x) => estLigneOutil(x, worker))
    if (it !== undefined) {
      ligne = {
        id: it.id,
        nous: it.id === worker.outil.id,
        expose: it.champs.disabled !== 'true',
        arrierePlan: it.config.enableRunInBackground === 'true',
        profondeur: it.config.maxDepth ?? null,
        nomOutil: it.config.toolName ?? null
      }
    }
  }
  return { connexion, ligne }
}

// ── writing the policy ──────────────────────────────────────────────────────

const CLES_ITEM_CONNUES = ['name', 'disabled', 'config']
const CLES_CONFIG_CONNUES = ['provider', 'toolName', 'enableRunInBackground', 'maxDepth']

const lignesItem = (worker, { expose, arrierePlan }, indent) => {
  const p = ' '.repeat(indent)
  const o = worker.outil
  return [
    `${p}- id: ${o.id}`,
    `${p}  name: '${PAQUET_OUTIL}'`,
    ...(expose ? [] : [`${p}  disabled: true`]),
    `${p}  config:`,
    `${p}    provider: ${o.provider}`,
    `${p}    toolName: ${o.toolName}`,
    `${p}    enableRunInBackground: ${arrierePlan ? 'true' : 'false'}`,
    `${p}    maxDepth: provider-managed`
  ]
}

/** Block appended at the end of the patch when the tool line does not exist yet. */
export function blocOutil (worker, politique, horodatage) {
  return ['',
    `# ── Workers · ${worker.nom} — added ${horodatage} by the Workers screen (Kybernos)`,
    `# Rollback: restore cordis.patch.yml.bak-workers-${worker.id}-${horodatage}, then DSH picks it up by itself.`,
    '- insert:',
    ...lignesItem(worker, politique, 4)
  ].join('\n') + '\n'
}

/**
 * Computes the new patch text for the requested policy, writing nothing. Plain refusals
 * rather than guesses:
 *   worker-inconnu · non-supporte · connexion-absente · ligne-existante (defined somewhere
 *   other than by this module) · ligne-modifiee-a-la-main · auto-controle
 * @returns {{ok:true, action:'ajout'|'modification'|'inchange', apres:string} | {ok:false, error:string, detail?:unknown}}
 */
export function calculerPolitique ({ worker, expose, arrierePlan, texte, horodatage }) {
  if (worker === undefined) return { ok: false, error: 'worker-inconnu' }
  if (worker.genre !== 'connexion') return { ok: false, error: 'non-supporte' }
  const voulu = { expose: expose === true, arrierePlan: arrierePlan === true }
  const avant = String(texte ?? '')
  const etat = etatProfil(avant, worker)
  if (!etat.connexion) return { ok: false, error: 'connexion-absente' }
  let apres
  let action
  if (etat.ligne === null) {
    action = 'ajout'
    apres = (avant === '' || avant.endsWith('\n') ? avant : avant + '\n') + blocOutil(worker, voulu, horodatage)
  } else if (!etat.ligne.nous) {
    return { ok: false, error: 'ligne-existante', detail: etat.ligne }
  } else {
    if (etat.ligne.expose === voulu.expose && etat.ligne.arrierePlan === voulu.arrierePlan && etat.ligne.profondeur === 'provider-managed') {
      return { ok: true, action: 'inchange', apres: avant }
    }
    const it = analyserPatch(avant).find((x) => x.id === worker.outil.id)
    const inconnues = [...it.cles.filter((k) => !CLES_ITEM_CONNUES.includes(k)), ...it.clesConfig.filter((k) => !CLES_CONFIG_CONNUES.includes(k))]
    if (inconnues.length > 0) return { ok: false, error: 'ligne-modifiee-a-la-main', detail: inconnues }
    action = 'modification'
    const lignes = avant.split('\n')
    lignes.splice(it.debut, it.fin - it.debut + 1, ...lignesItem(worker, voulu, it.indent))
    apres = lignes.join('\n')
  }
  // Self-check: read back what we are about to write.
  const relu = etatProfil(apres, worker)
  if (!relu.connexion || relu.ligne === null || relu.ligne.nous !== true || relu.ligne.expose !== voulu.expose || relu.ligne.arrierePlan !== voulu.arrierePlan) {
    return { ok: false, error: 'auto-controle' }
  }
  return { ok: true, action, apres }
}

// ── mounting a connection of ours ───────────────────────────────────────────

/** The `- insert:` block that loads a worker's subagent package, with its rollback note. */
export function blocActivation (worker, horodatage) {
  return ['',
    `# ── Workers · ${worker.nom} — added ${horodatage} by the Workers screen (Kybernos)`,
    `# Rollback: restore cordis.patch.yml.bak-workers-activate-${worker.id}-${horodatage}; DSH reloads the profile by itself.`,
    '- insert:',
    `    - id: subagent-${worker.id}`,
    `      name: "${worker.paquet}"`
  ].join('\n') + '\n'
}

/**
 * New patch text that mounts the worker's connection. Refusals: worker-inconnu,
 * non-supporte (not handled by this module), deja-montee, auto-controle.
 * @returns {{ok:true, apres:string} | {ok:false, error:string}}
 */
export function calculerActivation ({ worker, texte, horodatage }) {
  if (worker === undefined) return { ok: false, error: 'worker-inconnu' }
  if (worker.genre !== 'connexion' || worker.activation !== 'workers') return { ok: false, error: 'non-supporte' }
  const avant = String(texte ?? '')
  if (etatProfil(avant, worker).connexion) return { ok: false, error: 'deja-montee' }
  const apres = (avant === '' || avant.endsWith('\n') ? avant : avant + '\n') + blocActivation(worker, horodatage)
  if (!etatProfil(apres, worker).connexion) return { ok: false, error: 'auto-controle' }
  return { ok: true, apres }
}

// ── real checks ─────────────────────────────────────────────────────────────

const premiereLigne = (sortie) => String(sortie ?? '').split('\n').map((s) => s.trim()).find((s) => s !== '' && !/^WARNING:/i.test(s)) ?? ''

/** Reads the answer of `claude auth status` (JSON); falls back on the exit code. */
export function lireAuthJson (res) {
  const texte = String(res?.sortie ?? '')
  try {
    const debut = texte.indexOf('{')
    const fin = texte.lastIndexOf('}')
    if (debut >= 0 && fin > debut) {
      const j = JSON.parse(texte.slice(debut, fin + 1))
      if (typeof j.loggedIn === 'boolean') return { connecte: j.loggedIn, detail: j.loggedIn ? String(j.authMethod ?? '') : premiereLigne(texte) }
    }
  } catch { /* falls back on the code */ }
  return { connecte: res?.code === 0, detail: premiereLigne(texte) }
}

/** `opencode auth list` prints "N credentials" (or "1 credential"): signed in when N > 0. */
export function lireAuthCompte (res) {
  const m = /(\d+)\s+credentials?/i.exec(String(res?.sortie ?? ''))
  if (m === null) return null
  const n = Number(m[1])
  return { connecte: n > 0, detail: n + (n === 1 ? ' credential' : ' credentials') }
}

/**
 * `hermes status` is a report in `◆ Section` blocks. Only two of them say whether a model can be used: "Auth Providers"
 * ("✓ logged in") and "API-Key Providers" ("✓ configured"). The others tick things that have nothing to do with it
 * (messaging platforms such as WhatsApp or A2A also read "✓ configured"): they must never count.
 * Anything that does not look like that report is "cannot tell" (null).
 */
export function lireAuthHermes (res) {
  const lignes = String(res?.sortie ?? '').split('\n')
  let section = ''
  let vu = false
  let trouvee = null
  for (const l of lignes) {
    const titre = /^\s*◆\s*(.+?)\s*$/.exec(l)
    if (titre !== null) { section = titre[1]; continue }
    if (!/^(Auth Providers|API-Key Providers)$/i.test(section)) continue
    vu = true
    if (trouvee === null && /✓\s+(logged in|configured)/i.test(l)) trouvee = l
  }
  if (trouvee !== null) return { connecte: true, detail: trouvee.replace(/\s+/g, ' ').trim() }
  return vu ? { connecte: false, detail: '' } : null
}

const ok = (id, code, detail) => ({ id, etat: 'ok', code, ...(detail !== undefined && detail !== '' ? { detail } : {}) })
const ko = (id, code, detail) => ({ id, etat: 'ko', code, ...(detail !== undefined && detail !== '' ? { detail } : {}) })
const inconnu = (id, code, detail) => ({ id, etat: 'inconnu', code, ...(detail !== undefined && detail !== '' ? { detail } : {}) })

/** The sign-in control of a CLI worker. Never says "ok" for something it could not read. */
async function controleAuth (worker, io) {
  const a = worker.auth
  if (a.format === 'env') {
    const trouvee = await protege(() => io.cleDansEnv?.(a.names))
    return trouvee === true ? ok('auth', 'connecte', 'API key found') : ko('auth', 'non-connecte', a.names.join(' / '))
  }
  const r = await protege(() => io.executer(worker.binaire, a.args, { delaiMs: a.timeoutMs ?? 20000 }))
  if (!r || r.absent === true || r.delai === true) return inconnu('auth', 'non-verifiable', r?.delai ? 'delai' : 'illisible')
  let lu
  if (a.format === 'json-loggedIn') lu = lireAuthJson(r)
  else if (a.format === 'count') lu = lireAuthCompte(r)
  else if (a.format === 'hermes') lu = lireAuthHermes(r)
  else lu = { connecte: r.code === 0, detail: premiereLigne(r.sortie) }
  if (lu === null) return inconnu('auth', 'non-verifiable', 'illisible')
  return lu.connecte ? ok('auth', 'connecte', lu.detail) : ko('auth', 'non-connecte', lu.detail)
}

/**
 * The checks of a worker, in order. A check whose condition is false is not played: it is
 * marked `inconnu` with the reason, never "ok".
 * io : { paquetInstalle(paquet):boolean, fichierExiste(chemin):boolean,
 *        trouver(binaire):Promise<string|null>,
 *        executer(binaire,args,{delaiMs}):Promise<{code,sortie,delai?,absent?}>,
 *        cleDansEnv(names):boolean,
 *        worktreeJetable():Promise<{ok:boolean, detail?:string}>, fichierServeur?:string }
 */
export async function verifier ({ worker, texte, io }) {
  const c = []
  const etat = etatProfil(texte, worker)
  c.push(etat.connexion ? ok('connexion', 'montee') : ko('connexion', 'non-montee'))
  if (worker.genre === 'connexion') {
    c.push(await protege(() => io.paquetInstalle(worker.paquet)) === true ? ok('paquet', 'installe') : ko('paquet', 'non-installe'))
    const chemin = await protege(() => io.trouver(worker.binaire))
    if (typeof chemin === 'string' && chemin !== '') {
      const v = await protege(() => io.executer(worker.binaire, worker.versionArgs, { delaiMs: 20000 }))
      c.push(ok('binaire', 'trouve', chemin + (v && v.code === 0 ? ' · ' + premiereLigne(v.sortie) : '')))
      c.push(await controleAuth(worker, io))
    } else {
      c.push(ko('binaire', 'absent'))
      c.push(inconnu('auth', 'binaire-absent'))
    }
  } else {
    const present = await protege(() => io.fichierExiste(io.fichierServeur ?? ''))
    c.push(present === true ? ok('paquet', 'serveur-present', io.fichierServeur) : ko('paquet', 'serveur-absent', io.fichierServeur))
    c.push(inconnu('auth', 'coffre-propre'))
  }
  const w = await protege(() => io.worktreeJetable())
  c.push(w && w.ok === true ? ok('worktree', 'ecriture-ok', w.detail) : ko('worktree', 'ecriture-ko', w?.detail))
  return { statut: statutGlobal(c), controles: c }
}

async function protege (fn) { try { return await fn() } catch (e) { return undefined } }

/** Pure. One word for the row, from the most blocking to the least. */
export function statutGlobal (controles) {
  const par = Object.fromEntries(controles.map((x) => [x.id, x]))
  if (par.connexion?.etat === 'ko') return 'a-connecter'
  if (par.paquet?.etat === 'ko') return par.paquet.code === 'serveur-absent' ? 'serveur-absent' : 'a-relancer'
  if (par.binaire?.etat === 'ko') return 'binaire-absent'
  if (par.auth?.etat === 'ko') return 'non-connecte'
  if (par.worktree?.etat === 'ko') return 'ecriture-impossible'
  if (controles.some((x) => x.etat === 'inconnu')) return 'incomplet'
  return 'pret'
}

// ── installing a program ────────────────────────────────────────────────────

const LIGNES_GARDEES = 40
const LIGNE_MAX = 240

/** Drops the terminal control sequences an installer prints (colours, cursor moves). */
export const sansAnsi = (t) => String(t).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '').replace(/\r/g, '\n')

/** Appends a chunk of installer output to a job's log: whole lines only, last ones kept. */
export function ajouterAuJournal (job, morceau) {
  const texte = (job.reste ?? '') + sansAnsi(morceau)
  const lignes = texte.split('\n')
  job.reste = lignes.pop() ?? ''
  for (const l of lignes) {
    const t = l.trim()
    if (t === '') continue
    job.journal.push(t.length > LIGNE_MAX ? t.slice(0, LIGNE_MAX) + '…' : t)
  }
  if (job.journal.length > LIGNES_GARDEES) job.journal.splice(0, job.journal.length - LIGNES_GARDEES)
}

const vueJob = (job) => (job === undefined ? null : {
  phase: job.phase, journal: [...job.journal, ...(job.reste ? [job.reste.slice(0, LIGNE_MAX)] : [])], code: job.code ?? null,
  surLePath: job.surLePath ?? null, raison: job.raison ?? null, commence: job.commence, fini: job.fini ?? null
})

// ── routes ──────────────────────────────────────────────────────────────────
const str = (v) => (typeof v === 'string' && v.length > 0 ? v : null)
const hotesLocaux = (req) => {
  const port = typeof req?.socket?.localPort === 'number' ? ':' + req.socket.localPort : ''
  return ['127.0.0.1' + port, 'localhost' + port, '[::1]' + port]
}
const origineOk = (req, strict) => {
  try {
    const source = str(req?.headers?.origin) ?? str(req?.headers?.referer)
    if (source === null) return strict === false
    const u = new URL(source)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    return hotesLocaux(req).includes(u.host)
  } catch { return strict === false }
}
export const sameOriginStrict = (req) => origineOk(req, true)
export const sameOriginLax = (req) => origineOk(req, false)

const envoyer = (res, statut, charge) => {
  try {
    res.writeHead(statut, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(charge))
  } catch { /* socket closed */ }
}
const lireCorps = async (req, plafond = 4096) => {
  let taille = 0
  const morceaux = []
  for await (const m of req) { taille += m.length; if (taille > plafond) throw new Error('too-large'); morceaux.push(m) }
  return morceaux.length === 0 ? null : JSON.parse(Buffer.concat(morceaux).toString('utf8'))
}

const horodatage = (d) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

const PLATEFORMES_INSTALL = ['darwin', 'linux']

/**
 * GET  /kybernos-workers/state?profile=         → registry + profile state + last check + install job
 * POST /kybernos-workers/check    {worker, profile?}                          → real checks
 * POST /kybernos-workers/policy   {worker, expose, background, profile?, dry?} → writes the patch (backup first)
 * POST /kybernos-workers/activate {worker, profile?}                           → mounts a connection of ours (backup first)
 * POST /kybernos-workers/install  {worker, command}                            → starts the install job (202)
 * GET  /kybernos-workers/install?worker=                                       → the install job: phase + last log lines
 * deps : { profils(), profilParDefaut(), lirePatch(profil), ecrirePatch(profil,texte),
 *          sauvegarder(profil,nom,contenu), cheminPatch(profil), io, maintenant() }
 * io.plateforme(), io.lancerInstallation(commande, {surDonnees}) and io.cleDansEnv(names) are
 * optional: without them the install is unavailable and a key is never found.
 */
export function monterWorkers (webServer, deps, liens = {}) {
  const dernier = new Map()
  const jobs = new Map()
  let occupe = false
  let installEnCours = null
  const profilDe = (demande) => {
    const liste = deps.profils()
    if (demande === null || demande === undefined || demande === '') return { profil: deps.profilParDefaut(liste) }
    if (typeof demande !== 'string' || !liste.includes(demande)) return { erreur: 'profile-unknown' }
    return { profil: demande }
  }
  const corpsJson = async (req, res) => {
    if (req.method !== 'POST') { envoyer(res, 405, { ok: false, error: 'method-not-allowed' }); return undefined }
    if (sameOriginStrict(req) === false) { envoyer(res, 403, { ok: false, error: 'origin-refused' }); return undefined }
    if (!String(req.headers?.['content-type'] ?? '').toLowerCase().startsWith('application/json')) { envoyer(res, 415, { ok: false, error: 'json-required' }); return undefined }
    try { return (await lireCorps(req)) ?? {} } catch { envoyer(res, 400, { ok: false, error: 'bad-body' }); return undefined }
  }
  const cle = (profil, id) => profil + '/' + id
  const plateforme = () => { try { return typeof deps.io.plateforme === 'function' ? deps.io.plateforme() : process.platform } catch { return process.platform } }
  const installable = (w) => w.install != null && PLATEFORMES_INSTALL.includes(plateforme()) && typeof deps.io.lancerInstallation === 'function'

  const etat = (req, res) => {
    if (req.method !== 'GET') return envoyer(res, 405, { ok: false, error: 'method-not-allowed' })
    if (sameOriginLax(req) === false) return envoyer(res, 403, { ok: false, error: 'origin-refused' })
    let demande = null
    try { demande = new URL(req.url, 'http://localhost').searchParams.get('profile') } catch { demande = null }
    const p = profilDe(demande)
    if (p.erreur !== undefined) return envoyer(res, 400, { ok: false, error: p.erreur })
    let texte = null
    try { texte = deps.lirePatch(p.profil) } catch { texte = null }
    const workers = WORKERS.map((w) => {
      const e = etatProfil(texte ?? '', w)
      const installe = w.genre === 'connexion' ? deps.io.paquetInstalle(p.profil, w.paquet) : deps.io.fichierExiste(deps.io.fichierServeur ?? '')
      return {
        id: w.id, nom: w.nom, genre: w.genre, via: w.via, paquet: w.paquet ?? null, binaire: w.binaire ?? null, activation: w.activation,
        connect: w.connect, install: w.install == null ? null : { ...w.install, possible: installable(w) },
        connexion: e.connexion, installe, ligne: e.ligne, dernier: dernier.get(cle(p.profil, w.id)) ?? null, job: vueJob(jobs.get(w.id))
      }
    })
    return envoyer(res, 200, { ok: true, profil: p.profil, profils: deps.profils(), patch: deps.cheminPatch(p.profil), patchExiste: texte !== null, workers })
  }

  const verifierRoute = async (req, res) => {
    const corps = await corpsJson(req, res)
    if (corps === undefined) return undefined
    const worker = trouverWorker(corps.worker)
    if (worker === undefined) return envoyer(res, 404, { ok: false, error: 'unknown-worker' })
    const p = profilDe(corps.profile)
    if (p.erreur !== undefined) return envoyer(res, 400, { ok: false, error: p.erreur })
    if (occupe) return envoyer(res, 409, { ok: false, error: 'busy' })
    occupe = true
    try {
      let texte = null
      try { texte = deps.lirePatch(p.profil) } catch { texte = null }
      const io = { ...deps.io, paquetInstalle: (paquet) => deps.io.paquetInstalle(p.profil, paquet) }
      const r = await verifier({ worker, texte: texte ?? '', io })
      const entree = { quand: deps.maintenant().toISOString(), statut: r.statut, controles: r.controles }
      dernier.set(cle(p.profil, worker.id), entree)
      return envoyer(res, 200, { ok: true, worker: worker.id, ...entree })
    } finally { occupe = false }
  }

  const politique = async (req, res) => {
    const corps = await corpsJson(req, res)
    if (corps === undefined) return undefined
    const worker = trouverWorker(corps.worker)
    if (worker === undefined) return envoyer(res, 404, { ok: false, error: 'unknown-worker' })
    if (typeof corps.expose !== 'boolean' || typeof corps.background !== 'boolean') return envoyer(res, 400, { ok: false, error: 'bad-policy' })
    const p = profilDe(corps.profile)
    if (p.erreur !== undefined) return envoyer(res, 400, { ok: false, error: p.erreur })
    if (occupe) return envoyer(res, 409, { ok: false, error: 'busy' })
    occupe = true
    try {
      let texte = null
      try { texte = deps.lirePatch(p.profil) } catch { texte = null }
      if (texte === null) return envoyer(res, 409, { ok: false, error: 'patch-missing' })
      const stamp = horodatage(deps.maintenant())
      const calc = calculerPolitique({ worker, expose: corps.expose, arrierePlan: corps.background, texte, horodatage: stamp })
      if (!calc.ok) return envoyer(res, calc.error === 'non-supporte' ? 400 : 409, calc)
      if (corps.dry === true || calc.action === 'inchange') return envoyer(res, 200, { ok: true, dry: corps.dry === true, action: calc.action, patch: deps.cheminPatch(p.profil) })
      const nomSauvegarde = `cordis.patch.yml.bak-workers-${worker.id}-${stamp}`
      try {
        deps.sauvegarder(p.profil, nomSauvegarde, texte)
        deps.ecrirePatch(p.profil, calc.apres)
      } catch (e) { return envoyer(res, 500, { ok: false, error: 'write-failed', detail: String(e?.message ?? e) }) }
      return envoyer(res, 200, { ok: true, action: calc.action, backup: nomSauvegarde, patch: deps.cheminPatch(p.profil) })
    } finally { occupe = false }
  }

  const activer = async (req, res) => {
    const corps = await corpsJson(req, res)
    if (corps === undefined) return undefined
    const worker = trouverWorker(corps.worker)
    if (worker === undefined) return envoyer(res, 404, { ok: false, error: 'unknown-worker' })
    if (worker.genre !== 'connexion' || worker.activation !== 'workers') return envoyer(res, 400, { ok: false, error: 'non-supporte' })
    const p = profilDe(corps.profile)
    if (p.erreur !== undefined) return envoyer(res, 400, { ok: false, error: p.erreur })
    if (occupe) return envoyer(res, 409, { ok: false, error: 'busy' })
    occupe = true
    try {
      let texte = null
      try { texte = deps.lirePatch(p.profil) } catch { texte = null }
      if (texte === null) return envoyer(res, 409, { ok: false, error: 'patch-missing' })
      if (etatProfil(texte, worker).connexion) return envoyer(res, 200, { ok: true, already: true, patch: deps.cheminPatch(p.profil) })
      // Mounting a package DSH cannot load would be worse than not mounting it.
      let present = false
      try { present = deps.io.paquetInstalle(p.profil, worker.paquet) === true } catch { present = false }
      if (!present) return envoyer(res, 409, { ok: false, error: 'package-missing' })
      const stamp = horodatage(deps.maintenant())
      const calc = calculerActivation({ worker, texte, horodatage: stamp })
      if (!calc.ok) return envoyer(res, 409, calc)
      const nomSauvegarde = `cordis.patch.yml.bak-workers-activate-${worker.id}-${stamp}`
      try {
        deps.sauvegarder(p.profil, nomSauvegarde, texte)
        deps.ecrirePatch(p.profil, calc.apres)
      } catch (e) { return envoyer(res, 500, { ok: false, error: 'write-failed', detail: String(e?.message ?? e) }) }
      return envoyer(res, 200, { ok: true, already: false, backup: nomSauvegarde, patch: deps.cheminPatch(p.profil) })
    } finally { occupe = false }
  }

  /** Runs the install command of a worker, off the request: the page polls the job. */
  const lancer = async (worker, commande) => {
    const job = { phase: 'running', journal: [], reste: '', commence: deps.maintenant().toISOString(), code: null }
    jobs.set(worker.id, job)
    installEnCours = worker.id
    // The outcome is worked out first and published in one go, `phase` LAST: a page that polls never sees "done" without
    // the rest of the answer (whether the program is on the PATH, when it ended).
    let phase = 'error'
    let raison = null
    let surLePath = null
    try {
      const fin = await deps.io.lancerInstallation(commande, { surDonnees: (t) => { try { ajouterAuJournal(job, t) } catch { /* the log is a courtesy */ } } })
      if (job.reste.trim() !== '') ajouterAuJournal(job, '\n')
      job.code = typeof fin?.code === 'number' ? fin.code : 1
      if (fin?.delai === true) raison = 'timeout'
      else if (job.code !== 0) raison = 'exit'
      else {
        phase = 'done'
        let chemin = null
        try { chemin = await deps.io.trouver(worker.binaire) } catch { chemin = null }
        surLePath = typeof chemin === 'string' && chemin !== ''
      }
    } catch (e) {
      raison = 'spawn'; job.code = 1
      try { ajouterAuJournal(job, String(e?.message ?? e) + '\n') } catch { /* ignore */ }
    } finally {
      job.raison = raison
      job.surLePath = surLePath
      job.fini = deps.maintenant().toISOString()
      job.phase = phase
      installEnCours = null
    }
  }

  const installer = async (req, res) => {
    if (req.method === 'GET') {
      if (sameOriginLax(req) === false) return envoyer(res, 403, { ok: false, error: 'origin-refused' })
      let id = null
      try { id = new URL(req.url, 'http://localhost').searchParams.get('worker') } catch { id = null }
      if (trouverWorker(id) === undefined) return envoyer(res, 404, { ok: false, error: 'unknown-worker' })
      return envoyer(res, 200, { ok: true, job: vueJob(jobs.get(id)) })
    }
    const corps = await corpsJson(req, res)
    if (corps === undefined) return undefined
    const worker = trouverWorker(corps.worker)
    if (worker === undefined) return envoyer(res, 404, { ok: false, error: 'unknown-worker' })
    if (worker.install == null) return envoyer(res, 400, { ok: false, error: 'not-installable' })
    if (typeof deps.io.lancerInstallation !== 'function') return envoyer(res, 501, { ok: false, error: 'install-unavailable' })
    if (!PLATEFORMES_INSTALL.includes(plateforme())) return envoyer(res, 400, { ok: false, error: 'unsupported-platform' })
    // The person confirmed the command the page showed: it must be the one this host would run.
    if (corps.command !== worker.install.cmd) return envoyer(res, 409, { ok: false, error: 'command-changed', command: worker.install.cmd })
    if (installEnCours !== null) return envoyer(res, 409, { ok: false, error: 'busy', worker: installEnCours })
    let present = null
    try { present = await deps.io.trouver(worker.binaire) } catch { present = null }
    if (typeof present === 'string' && present !== '') return envoyer(res, 409, { ok: false, error: 'already-installed', path: present })
    for (const besoin of worker.install.needs) {
      let chemin = null
      try { chemin = await deps.io.trouver(besoin) } catch { chemin = null }
      if (typeof chemin !== 'string' || chemin === '') return envoyer(res, 409, { ok: false, error: 'missing-tool', tool: besoin })
    }
    if (installEnCours !== null) return envoyer(res, 409, { ok: false, error: 'busy', worker: installEnCours })
    void lancer(worker, worker.install.cmd)
    return envoyer(res, 202, { ok: true, started: true })
  }

  const enregistrer = () => {
    webServer.register({ kind: 'exact', path: '/kybernos-workers/state', handler: etat })
    webServer.register({ kind: 'exact', path: '/kybernos-workers/check', handler: verifierRoute })
    webServer.register({ kind: 'exact', path: '/kybernos-workers/policy', handler: politique })
    webServer.register({ kind: 'exact', path: '/kybernos-workers/activate', handler: activer })
    webServer.register({ kind: 'exact', path: '/kybernos-workers/install', handler: installer })
  }
  return typeof liens.effect === 'function' ? liens.effect(enregistrer, 'kybernos-workers: routes') : enregistrer()
}
