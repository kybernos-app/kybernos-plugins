// ── kybernos-workers · logique hôte ─────────────────────────────────────────
// Les « workers » sont les agents de code externes que DSH peut piloter (Claude
// Code, Codex, ZCode). Ce module fait trois choses, et seulement celles-là :
//
//   1. LIRE le profil : la connexion est-elle montée ? la ligne d'outil qui
//      expose le worker au lead existe-t-elle, et dans quel état ?
//   2. VÉRIFIER pour de vrai (sans appeler aucun modèle, donc sans consommer
//      l'abonnement) : connexion montée, paquet installé, binaire trouvé dans le
//      PATH que voit DSH, authentification déclarée par la CLI, écriture dans un
//      worktree git jetable.
//   3. RÉGLER la seule politique que DSH expose réellement : la ligne d'outil
//      `@deepseek-ai/dsh-tool-subagent` (exposée ou non au lead, arrière-plan
//      autorisé ou non). Modèle, permissions et connexion restent ceux du produit
//      natif — les paquets de connexion n'ont aucune clé pour cela.
//
// Toute l'E/S est injectée (`deps`, `io`) : test-host.mjs joue ce fichier sans
// DSH, sans disque réel et sans navigateur. Aucun import @deepseek-ai/*.

export const PAQUET_OUTIL = '@deepseek-ai/dsh-tool-subagent'
export const PAQUET_MCP = '@deepseek-ai/dsh-mcp-client'

/** Registre figé des workers connus. `genre` : connexion | mcp | non-supporte. */
export const WORKERS = Object.freeze([
  Object.freeze({
    id: 'claude-code', nom: 'Claude Code', genre: 'connexion', via: 'claude-agent-sdk',
    paquet: '@deepseek-ai/dsh-subagent-claude-code',
    outil: Object.freeze({ id: 'kybernos-workers-claude-code', provider: 'claude-code', toolName: 'subagent_claude_code' }),
    binaire: 'claude', versionArgs: ['--version'], authArgs: ['auth', 'status'], authFormat: 'json-loggedIn'
  }),
  Object.freeze({
    id: 'codex', nom: 'Codex', genre: 'connexion', via: 'app-server',
    paquet: '@deepseek-ai/dsh-subagent-codex',
    outil: Object.freeze({ id: 'kybernos-workers-codex', provider: 'codex', toolName: 'subagent_codex' }),
    binaire: 'codex', versionArgs: ['--version'], authArgs: ['login', 'status'], authFormat: 'code'
  }),
  Object.freeze({
    id: 'zcode', nom: 'ZCode', genre: 'mcp', via: 'mcp-local', mcpId: 'mcp-client-zcode', serverName: 'zcode'
  }),
  Object.freeze({ id: 'hermes', nom: 'Hermes', genre: 'non-supporte', via: '' })
])

export const trouverWorker = (id) => WORKERS.find((w) => w.id === id)

// ── lecture du patch de profil ──────────────────────────────────────────────

const nettoyer = (brut) => {
  let v = String(brut ?? '').replace(/\s+#.*$/, '').trim()
  if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1)
  return v
}

/**
 * Découpe `cordis.patch.yml` en lignes `- id: …` (les entrées insérées). Ce n'est
 * pas un lecteur YAML : le patch est écrit par ce dépôt et par l'écran Outils sous
 * une forme fixe (clés à indentation régulière, scalaires sur une ligne). Ce qu'on
 * ne reconnaît pas est ignoré, jamais deviné.
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
 * Ce que le profil dit d'un worker : connexion montée ? ligne d'outil ?
 * `nous` = la ligne porte l'identifiant que CE module écrit (donc modifiable ici).
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

// ── écriture de la politique ────────────────────────────────────────────────

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

/** Bloc à ajouter en fin de patch quand la ligne d'outil n'existe pas. */
export function blocOutil (worker, politique, horodatage) {
  return ['',
    `# ── Workers · ${worker.nom} — ajouté le ${horodatage} par l’écran Workers (Kybernos)`,
    `# Retour arrière : restaurer cordis.patch.yml.bak-workers-${worker.id}-${horodatage}, puis relancer DSH.`,
    '- insert:',
    ...lignesItem(worker, politique, 4)
  ].join('\n') + '\n'
}

/**
 * Calcule le nouveau texte du patch pour la politique demandée, sans rien écrire.
 * Refus nets plutôt que devinettes :
 *   worker-inconnu · non-supporte · connexion-absente · ligne-existante (définie
 *   ailleurs que par ce module) · ligne-modifiee-a-la-main · auto-controle
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
  // Auto-contrôle : on relit ce qu'on s'apprête à écrire.
  const relu = etatProfil(apres, worker)
  if (!relu.connexion || relu.ligne === null || relu.ligne.nous !== true || relu.ligne.expose !== voulu.expose || relu.ligne.arrierePlan !== voulu.arrierePlan) {
    return { ok: false, error: 'auto-controle' }
  }
  return { ok: true, action, apres }
}

// ── vérifications réelles ───────────────────────────────────────────────────

const premiereLigne = (sortie) => String(sortie ?? '').split('\n').map((s) => s.trim()).find((s) => s !== '' && !/^WARNING:/i.test(s)) ?? ''

/** Lit la réponse de `claude auth status` (JSON) ; repli sur le code retour. */
export function lireAuthJson (res) {
  const texte = String(res?.sortie ?? '')
  try {
    const debut = texte.indexOf('{')
    const fin = texte.lastIndexOf('}')
    if (debut >= 0 && fin > debut) {
      const j = JSON.parse(texte.slice(debut, fin + 1))
      if (typeof j.loggedIn === 'boolean') return { connecte: j.loggedIn, detail: j.loggedIn ? String(j.authMethod ?? '') : premiereLigne(texte) }
    }
  } catch { /* retombe sur le code */ }
  return { connecte: res?.code === 0, detail: premiereLigne(texte) }
}

const ok = (id, code, detail) => ({ id, etat: 'ok', code, ...(detail !== undefined && detail !== '' ? { detail } : {}) })
const ko = (id, code, detail) => ({ id, etat: 'ko', code, ...(detail !== undefined && detail !== '' ? { detail } : {}) })
const inconnu = (id, code, detail) => ({ id, etat: 'inconnu', code, ...(detail !== undefined && detail !== '' ? { detail } : {}) })

/**
 * Les contrôles d'un worker, dans l'ordre. Un contrôle dont la condition est
 * fausse n'est pas joué : il est marqué `inconnu` avec la raison, jamais « ok ».
 * io : { paquetInstalle(paquet):boolean, fichierExiste(chemin):boolean,
 *        trouver(binaire):Promise<string|null>,
 *        executer(binaire,args,{delaiMs}):Promise<{code,sortie,delai?,absent?}>,
 *        worktreeJetable():Promise<{ok:boolean, detail?:string}>, fichierServeur?:string }
 */
export async function verifier ({ worker, texte, io }) {
  const c = []
  if (worker.genre === 'non-supporte') return { statut: 'non-supporte', controles: [] }
  const etat = etatProfil(texte, worker)
  c.push(etat.connexion ? ok('connexion', 'montee') : ko('connexion', 'non-montee'))
  if (worker.genre === 'connexion') {
    c.push(await protege(() => io.paquetInstalle(worker.paquet)) === true ? ok('paquet', 'installe') : ko('paquet', 'non-installe'))
    const chemin = await protege(() => io.trouver(worker.binaire))
    if (typeof chemin === 'string' && chemin !== '') {
      const v = await protege(() => io.executer(worker.binaire, worker.versionArgs, { delaiMs: 20000 }))
      c.push(ok('binaire', 'trouve', chemin + (v && v.code === 0 ? ' · ' + premiereLigne(v.sortie) : '')))
      const a = await protege(() => io.executer(worker.binaire, worker.authArgs, { delaiMs: 20000 }))
      if (!a || a.absent === true || a.delai === true) c.push(inconnu('auth', 'non-verifiable', a?.delai ? 'delai' : 'illisible'))
      else {
        const lu = worker.authFormat === 'json-loggedIn' ? lireAuthJson(a) : { connecte: a.code === 0, detail: premiereLigne(a.sortie) }
        c.push(lu.connecte ? ok('auth', 'connecte', lu.detail) : ko('auth', 'non-connecte', lu.detail))
      }
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

/** Pure. Un seul mot pour la carte, du plus bloquant au moins bloquant. */
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
  } catch { /* socket fermée */ }
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

/**
 * GET  /kybernos-workers/state?profile=   → registre + état du profil + dernier contrôle
 * POST /kybernos-workers/check   {worker, profile?}                         → contrôles réels
 * POST /kybernos-workers/policy  {worker, expose, background, profile?, dry?} → écrit le patch (sauvegarde d'abord)
 * deps : { profils(), profilParDefaut(), lirePatch(profil), ecrirePatch(profil,texte),
 *          sauvegarder(profil,nom,contenu), cheminPatch(profil), io, maintenant() }
 */
export function monterWorkers (webServer, deps, liens = {}) {
  const dernier = new Map()
  let occupe = false
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
      const installe = w.genre === 'connexion' ? deps.io.paquetInstalle(p.profil, w.paquet) : (w.genre === 'mcp' ? deps.io.fichierExiste(deps.io.fichierServeur ?? '') : null)
      return { id: w.id, nom: w.nom, genre: w.genre, via: w.via, paquet: w.paquet ?? null, binaire: w.binaire ?? null, connexion: w.genre === 'non-supporte' ? null : e.connexion, installe, ligne: e.ligne, dernier: dernier.get(cle(p.profil, w.id)) ?? null }
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
      if (corps.dry === true || calc.action === 'inchange') return envoyer(res, 200, { ok: true, dry: corps.dry === true, action: calc.action, restart: false, patch: deps.cheminPatch(p.profil) })
      const nomSauvegarde = `cordis.patch.yml.bak-workers-${worker.id}-${stamp}`
      try {
        deps.sauvegarder(p.profil, nomSauvegarde, texte)
        deps.ecrirePatch(p.profil, calc.apres)
      } catch (e) { return envoyer(res, 500, { ok: false, error: 'write-failed', detail: String(e?.message ?? e) }) }
      return envoyer(res, 200, { ok: true, action: calc.action, restart: true, backup: nomSauvegarde, patch: deps.cheminPatch(p.profil) })
    } finally { occupe = false }
  }

  const enregistrer = () => {
    webServer.register({ kind: 'exact', path: '/kybernos-workers/state', handler: etat })
    webServer.register({ kind: 'exact', path: '/kybernos-workers/check', handler: verifierRoute })
    webServer.register({ kind: 'exact', path: '/kybernos-workers/policy', handler: politique })
  }
  return typeof liens.effect === 'function' ? liens.effect(enregistrer, 'kybernos-workers: routes') : enregistrer()
}
