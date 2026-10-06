// kybernos-skills — plugin hote cordis du paquet frere @local/kybernos-skills.
//
// ARCHITECTURE (revisee) : le catalogue n'est PLUS scanne a la main ici. Il vient du
// REGISTRE DE SKILLS DE DSH (`ctx.skills`, paquet @deepseek-ai/dsh-skill), alimente par
// le provider filesystem officiel (@deepseek-ai/dsh-skill-filesystem) qui resout deja
// les six racines, leur precedence et leur surveillance en direct.
//   racines et rangs  : dsh-skill-filesystem/lib/index.js:21-25 et :150-186
//   fusion des doublons: dsh-skill/lib/index.js:312-330 (tri par precedence PUIS
//                        rejet du nom deja vu, avec avertissement)
// Reimplementer ce scan etait la cause directe du defaut A3 (deux racines resolvant au
// meme dossier physique affichaient chaque skill deux fois, tout en lecture seule).
//
// DIX routes sur le service webServer. DEUX flux RESEAU sortants, en lecture seule, vers des hotes
// fixes (codeload.github.com pour installer, le relais kybernos-skills-index pour l'index) — voir la section RESEAU.
//   GET  /kybernos-skills/skills    : le catalogue du registre + les skills DESACTIVES. ?q= filtre.
//   GET  /kybernos-skills/index     : l'index public PAGINE (?view=all-time|trending|hot&page=&perPage=)
//   GET  /kybernos-skills/search    : recherche floue sur tout l'index (?q=, 2 caracteres minimum)
//   GET  /kybernos-skills/curated   : le set first-party, groupe par proprietaire
//   GET  /kybernos-skills/audit     : les audits de securite d'un skill (?source=&skill=)
//   GET  /kybernos-skills/status    : racines inscriptibles, portee du registre
//   POST /kybernos-skills/toggle    : bascule active/inactif par RENOMMAGE
//                                     SKILL.md <-> SKILL.md.disabled, uniquement dans
//                                     <DSH home>/skills (~/.dsh/skills) et ~/.agents/skills (decision gelee).
//   POST /kybernos-skills/create    : ecrit un SKILL.md valide dans une racine inscriptible.
//   POST /kybernos-skills/install   : telecharge une archive GitHub et copie le skill demande.
//
// CE QUE CE PAQUET APPORTE, ET QUE DSH N'A PAS :
//   1. le registre est EN LECTURE SEULE — personne ne peut desactiver un skill ;
//   2. un skill desactive est INVISIBLE du registre (discoverRoot cherche `SKILL.md`) :
//      la vue « desactives » n'existe nulle part, on la construit ici ;
//   3. le confinement reelle (defaut A2) : l'inscriptibilite se decide par le CHEMIN
//      REEL, jamais par le rang de la racine gagnante ;
//   4. l'interface.
import { existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync, chmodSync, realpathSync, mkdirSync, mkdtempSync, rmdirSync, rmSync, cpSync, createReadStream } from 'node:fs'
import { createZstdDecompress } from 'node:zlib'
import { homedir, tmpdir } from 'node:os'
import { join, dirname, basename, sep, isAbsolute, resolve as resolvePath } from 'node:path'
import { execFileSync } from 'node:child_process'

// ── helpers locaux (miroir semantique de kybernos-plugin/index.js:2696-2724, base daed42e) ──────────────────
const str = (v) => (typeof v === 'string' && v.length > 0 ? v : null)

const sendJson = (res, status, payload) => {
  try {
    const body = JSON.stringify(payload === undefined ? null : payload)
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(body)
  } catch (e) { try { res.writeHead(500); res.end('{}') } catch (e2) { /* socket ferme */ } }
}

// Same-origin guard for the POST routes. DSH serves plugin routes BEFORE its own authentication
// (measured on 0.2.0-rc.2: `/` answers 401 without a cookie, plugin routes answer 200), so the
// plugin guards itself. A POST MUST carry an Origin, or failing that a Referer: a browser always
// sends an Origin on a POST, so a request with neither is not from a browser. The origin is
// compared with the REAL listening address of the socket, never with the client-supplied Host
// header (`curl -H 'Host: attacker.example'` controls that one). Same rule as `sameOriginStrict`
// in the core bundle.
const sameOrigin = (req) => {
  try {
    const headers = (req !== null && req !== undefined && req.headers !== null && req.headers !== undefined) ? req.headers : {}
    const source = str(headers.origin) ?? str(headers.referer)
    if (source === null) return false
    const u = new URL(source)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const port = (req.socket && typeof req.socket.localPort === 'number') ? ':' + req.socket.localPort : ''
    return ['127.0.0.1' + port, 'localhost' + port, '[::1]' + port].indexOf(u.host) >= 0
  } catch (e) { return false }
}

const readJsonBody = async (req, maxBytes) => {
  const cap = typeof maxBytes === 'number' ? maxBytes : 65536
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > cap) throw new Error('corps de requete trop volumineux')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  try { return JSON.parse(text) } catch (e) { return {} }
}

// ── constantes du contrat ────────────────────────────────────────────────────────────────────────────────────
const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/ // dsh-skill/lib/index.js:17
const MARKER_ACTIVE = 'SKILL.md'
const MARKER_DISABLED = 'SKILL.md.disabled'
const JOURNAL_VERSION = 1
const JOURNAL_MAX = 50

// Rangs des sources, MIROIR de dsh-skill-filesystem/lib/index.js:21-25 + BUNDLED_SKILL_RANK
// (dsh-skill/lib/index.js:23). Ils ne servent QU'A l'ordre d'affichage et a l'identite d'une
// entree : la decouverte, la precedence et la fusion sont faites par le registre, pas ici.
const SOURCE_RANK = Object.freeze({
  'project-dsh': 100, 'project-agents': 200, custom: 300,
  'user-dsh': 400, 'user-agents': 500, bundled: 600
})
const UNKNOWN_RANK = 999

// LES DEUX SEULES RACINES INSCRIPTIBLES (decision gelee). C'est notre POLITIQUE D'ECRITURE,
// pas une regle de decouverte : le registre peut lire vingt racines, on n'ecrit que la-dedans.
const writableRootsOf = (cfg) => [join(cfg.dsh, 'skills'), join(cfg.home, '.agents', 'skills')]

const sourceOfRootPath = (rootPath, cfg) => {
  if (rootPath === join(cfg.dsh, 'skills')) return 'user-dsh'
  if (rootPath === join(cfg.home, '.agents', 'skills')) return 'user-agents'
  return 'custom'
}

// ── configuration : le home reste parametrable (harnais, testabilite), le cwd aussi ──────────────────────────
// The DSH home, resolved the way DSH does (@deepseek-ai/dsh-home-paths): a non-blank $DSH_HOME
// (trimmed, a leading ~ expanded), else <os home>/.dsh. Resolved at each use, never cached.
const dshHome = (env = process.env, osHome = homedir) => {
  const raw = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  if (raw === '') return join(osHome(), '.dsh')
  if (raw === '~') return osHome()
  return resolvePath(raw.startsWith('~/') || raw.startsWith('~\\') ? join(osHome(), raw.slice(2)) : raw)
}

const findProjectRoot = (cwd) => { // miroir dsh-skill-filesystem/lib/index.js:807-815
  let dir = cwd
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return cwd
    dir = parent
  }
}

// `home` is the OS home (it holds `.agents`); `dsh` is the DSH home (skills, journal, featured list,
// token cache, sessions). A harness that passes a `home` gets its own `<home>/.dsh`; with neither,
// `dsh` follows DSH_HOME, so an isolated instance never reaches into the user's real ~/.dsh.
// Idempotent: the routes hand an already normalised config to functions that normalise it again,
// so a `dsh` that is given must survive.
const normalizeConfig = (config = {}) => {
  const given = typeof config.home === 'string' && isAbsolute(config.home) ? config.home : null
  const dsh = typeof config.dsh === 'string' && isAbsolute(config.dsh) ? config.dsh : (given !== null ? join(given, '.dsh') : dshHome())
  return {
    home: given !== null ? given : homedir(),
    dsh,
    cwd: typeof config.cwd === 'string' && isAbsolute(config.cwd) ? config.cwd : process.cwd()
  }
}

const configOf = ({ home, dsh, cwd } = {}) => normalizeConfig({ home, dsh, cwd })

// ── layout : ou vit un skill a partir du chemin de son fichier markdown ──────────────────────────────────────
//   <racine>/<dossier>/SKILL.md          -> folder=<racine>/<dossier>, root=<racine>
//   <racine>/<nom>.md                    -> folder=null,                root=<racine>
const layoutOf = (filePath) => {
  if (typeof filePath !== 'string' || filePath === '') return { folder: null, root: null }
  const base = basename(filePath)
  if (base === MARKER_ACTIVE || base === MARKER_DISABLED) {
    const folder = dirname(filePath)
    return { folder, root: dirname(folder) }
  }
  return { folder: null, root: dirname(filePath) }
}

// ── CONFINEMENT PAR CIBLE REELLE (defaut A2, conserve tel quel) ──────────────────────────────────────────────
// L'inscriptibilite se decide par le chemin REEL compare au chemin REEL de la racine, jamais par le
// rang de la source gagnante. Consequence voulue : quand le projet EST le home, le registre fait
// gagner `project-dsh` (rang 100, lecture seule par convention) alors que le fichier vit en realite
// dans ~/.dsh/skills, qui est inscriptible — le chemin reel redonne le droit d'ecriture, le rang ne
// le retire pas. Un lien symbolique dont la cible reelle sort de la racine reste VISIBLE et lisible,
// mais passe non inscriptible, et la bascule le refuse avec un message distinct.
// realpathSync est toujours sous try/catch : introuvable => NON conforme, jamais une exception.
const realpathSafe = (p) => { try { return realpathSync(p) } catch (e) { return null } }

const writableRootFor = (target, roots) => {
  if (target === null || target === undefined) return null
  const real = realpathSafe(target)
  if (real === null) return null
  for (const rootPath of roots) {
    const realRoot = realpathSafe(rootPath)
    if (realRoot === null) continue
    if (real === realRoot || real.startsWith(realRoot + sep)) return rootPath
  }
  return null
}

// ── frontmatter minimal « cle: valeur » avec de-quotation (lisible sur les DESACTIVES, que le
//    registre ne voit pas ; les actifs, eux, sont deja parses par DSH) ────────────────────────────────────
const unquote = (v) => {
  const t = v.trim()
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    // On defait EXACTEMENT ce que yamlQuoted pose (\\, \" et \n), en une passe : sans cela la
    // reponse immediate d'une creation rendrait des echappements litteraux, alors que le
    // registre, lui, relit la valeur exacte dans le fichier — deux lectures du meme champ.
    return t.slice(1, -1).replace(/\\(.)/g, (m, c) => c === 'n' ? '\n' : (c === '\\' || c === '"' ? c : m))
  }
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'")
  return t
}

const frontmatterOf = (file) => {
  const out = {}
  try {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/)
    if (lines[0] !== '---') return out
    for (let i = 1; i < lines.length; i++) {
      if (lines[i] === '---') break
      const m = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(lines[i])
      if (m === null) continue
      out[m[1]] = unquote(m[2])
    }
  } catch (e) { /* illisible => frontmatter vide */ }
  return out
}

// ── VUE DES DESACTIVES : ce que le registre ne peut pas voir ─────────────────────────────────────────────────
// `SKILL.md.disabled` n'est pas `SKILL.md`, donc discoverRoot l'ignore et le skill sort du catalogue.
// On balaie les DEUX racines inscriptibles pour retrouver ces marqueurs. Lecture seule, aucun cache.
const disabledInRoot = (rootPath, cfg) => {
  const out = []
  if (!existsSync(rootPath)) return out
  let entries
  try { entries = readdirSync(rootPath) } catch (e) { return out }
  for (const entry of entries) {
    if (entry.startsWith('.')) continue
    const folder = join(rootPath, entry)
    let st = null
    try { st = statSync(folder) } catch (e) { continue }
    if (!st.isDirectory()) continue
    const disabledFile = join(folder, MARKER_DISABLED)
    if (!existsSync(disabledFile)) continue // actif => deja dans le registre, on ne double pas
    if (existsSync(join(folder, MARKER_ACTIVE))) continue // double marqueur => ambigu, la bascule le refusera
    const fm = frontmatterOf(disabledFile)
    const fmName = typeof fm.name === 'string' ? fm.name : ''
    const name = SKILL_NAME_RE.test(fmName) ? fmName : entry
    if (!SKILL_NAME_RE.test(name)) continue
    let modifiedAt = ''
    try { modifiedAt = statSync(disabledFile).mtime.toISOString() } catch (e) { /* porteur disparu */ }
    out.push({
      name,
      root: rootPath,
      source: sourceOfRootPath(rootPath, cfg),
      rank: SOURCE_RANK[sourceOfRootPath(rootPath, cfg)] ?? UNKNOWN_RANK,
      writable: writableRootFor(folder, writableRootsOf(cfg)) !== null,
      active: false,
      description: typeof fm.description === 'string' ? fm.description : '',
      whenToUse: typeof fm.whenToUse === 'string' ? fm.whenToUse : '',
      modifiedAt,
      collision: false
    })
  }
  return out
}

// ── VUE DU REGISTRE : quelle INSTANCE, quel cwd, quelle PORTEE ? ─────────────────────────────────────────────
// Piege dans lequel on est tombe, et qui valait un catalogue VIDE a l'ecran alors que la session en
// annoncait sept : le registre de DSH ne rend pas la meme chose selon la portee. `collectFresh` ne lit
// que la couche GLOBALE et celles de `chainLayers(options.scope)`. Le fournisseur de skills s'enregistre
// dans la couche d'un PRESET, pas dans la couche globale : un snapshot sans `scope` ne rend donc RIEN.
//
// On reproduit ce que fait DSH lui-meme (dsh-api-session-controller, service `sessionSkillCatalog`,
// « backing ctx.remote.skills without activating a cold Agent ») : un agent VIVANT fournit sa portee et
// l'instance montee par son preset ; sans agent vivant, on demande au preset par defaut sa CLE DE
// MONTAGE, qui n'active aucun agent.
// L'agent VIVANT de la session demandee. `agents.roots()` ne garantit AUCUN ordre : prendre le
// dernier melangeait les projets (constate en production le 20/09 — l'onglet Skills listait les
// skills de ~/dyad-apps/testing pendant qu'une session vivait dans ~/dyad-apps/dsh-kybernos).
const agentParId = (ctx, wanted) => {
  if (typeof wanted !== 'string' || wanted === '') return undefined
  const agents = ctx.get('agents')
  if (agents === undefined || typeof agents.roots !== 'function') return undefined
  let roots
  try { roots = agents.roots() } catch (e) { return undefined }
  if (!Array.isArray(roots)) return undefined
  for (const r of roots) {
    const header = r !== null && r !== undefined && r.session !== undefined ? r.session.header : undefined
    if (header !== undefined && header !== null && (header.id === wanted || header.sessionId === wanted)) return r
  }
  return undefined
}

// Le dernier agent vivant : comportement d'origine, conserve pour l'appel SANS session (page de
// reglages, onglet hors session) et comme dernier recours.
const dernierAgent = (ctx) => {
  const agents = ctx.get('agents')
  if (agents === undefined || typeof agents.roots !== 'function') return undefined
  try {
    const roots = agents.roots()
    return Array.isArray(roots) && roots.length > 0 ? roots[roots.length - 1] : undefined
  } catch (e) { return undefined }
}

// La vue portee par un agent vivant : sa portee, et le cwd de SON en-tete.
const vueAgent = (live, cfg) => {
  const header = live.session !== undefined ? live.session.header : undefined
  const cwd = header !== undefined && typeof header.cwd === 'string' && header.cwd !== '' ? header.cwd : cfg.cwd
  return { scope: live, live, cwd }
}

// La CLE DE MONTAGE du preset par defaut : elle porte le fournisseur de skills sans activer aucun
// agent. C'est ce que DSH fait lui-meme pour une session froide.
const cleDeMontage = async (ctx) => {
  const presets = ctx.get('agentPresets')
  if (presets !== undefined && typeof presets.standingKeyFor === 'function') {
    try { return await presets.standingKeyFor(undefined) } catch (e) { /* aucun preset montable */ }
  }
  return undefined
}

// Le cwd d'une session AU REPOS. La session affichee n'est pas toujours vivante (onglet ouvert
// apres coup, session inactive) : `agents.roots()` ne la connait alors pas et l'hote retombait sur
// son PROPRE repertoire — donc les skills d'un projet sans rapport, voire aucun. DSH ecrit l'entete
// de la session (`{ type:'session', version, id, cwd, ... }`) en tete d'un flux zstd :
//   <home>/sessions/<projet>/<sessionId>/session.v3.jsonl.zstd
// On ne lit QUE le premier evenement, en flux : une session peut peser des megaoctets, et le
// catalogue se recharge souvent. Toute erreur rend `null` : on retombe, jamais on n'echoue.
const enteteDeSession = (chemin) => new Promise((resolve) => {
  let flux = null
  let zstd = null
  let fini = false
  const finir = (valeur) => {
    if (fini === true) return
    fini = true
    clearTimeout(minuteur)
    try { if (flux !== null) flux.destroy() } catch (e) { /* deja ferme */ }
    try { if (zstd !== null) zstd.destroy() } catch (e) { /* deja ferme */ }
    resolve(valeur)
  }
  const minuteur = setTimeout(() => finir(null), 1500)
  try {
    flux = createReadStream(chemin)
    zstd = createZstdDecompress()
  } catch (e) { return finir(null) }
  let texte = ''
  zstd.on('data', (bloc) => {
    texte += bloc.toString('utf8')
    const fin = texte.indexOf('\n')
    if (fin === -1) return
    try {
      const entete = JSON.parse(texte.slice(0, fin))
      finir(entete !== null && typeof entete === 'object' && typeof entete.cwd === 'string' && entete.cwd !== '' ? entete.cwd : null)
    } catch (e) { finir(null) }
  })
  zstd.on('error', () => finir(null))
  flux.on('error', () => finir(null))
  flux.pipe(zstd)
})

const cwdDeSession = async (cfg, wanted) => {
  if (typeof wanted !== 'string' || wanted === '') return null
  // The store lives under the DSH home (`<DSH home>/sessions`): that one home only, never the
  // other one (a session of the user's real ~/.dsh is not a session of an isolated instance).
  const base = join(cfg.dsh, 'sessions')
  let projets = []
  try { projets = readdirSync(base) } catch (e) { return null }
  for (const projet of projets) {
    const repertoire = join(base, projet, wanted)
    let fichiers = []
    try { fichiers = readdirSync(repertoire) } catch (e) { continue }
    const fichier = fichiers.find((n) => /^session\..*jsonl\.zstd$/.test(n))
    if (fichier === undefined) continue
    return await enteteDeSession(join(repertoire, fichier))
  }
  return null
}

const scopeOf = async (ctx, cfg, wanted) => {
  // 1. La session demandee est vivante : sa portee et son cwd, sans discussion.
  const parId = agentParId(ctx, wanted)
  if (parId !== undefined) return vueAgent(parId, cfg)
  // 2. Session demandee mais AU REPOS : son projet est celui de son en-tete, PAS celui du dernier
  //    agent vivant. C'est la panne reelle du 20/09 : une session au repos heritait du projet d'une
  //    autre session, et ses propres skills de projet n'apparaissaient jamais.
  if (typeof wanted === 'string' && wanted !== '') {
    const cwdSession = await cwdDeSession(cfg, wanted)
    if (cwdSession !== null) return { scope: await cleDeMontage(ctx), live: undefined, cwd: cwdSession }
  }
  // 3. Sans session (ou session inconnue) : le dernier agent vivant, comportement d'origine.
  const dernier = dernierAgent(ctx)
  if (dernier !== undefined) return vueAgent(dernier, cfg)
  // 4. Rien du tout : la cle de montage du preset, et le repertoire de l'hote.
  return { scope: await cleDeMontage(ctx), live: undefined, cwd: cfg.cwd }
}

// L'instance de registre a interroger. Avec un agent vivant, DSH monte le registre du preset qui porte
// cet agent : interroger celui de l'hote rendrait une autre vue, et l'invalider ne rafraichirait rien.
const registryOf = (ctx, view) => {
  const presets = ctx.get('agentPresets')
  if (view.live !== undefined && presets !== undefined && typeof presets.serviceFor === 'function') {
    try {
      const scoped = presets.serviceFor(view.live, 'skills')
      if (scoped !== undefined && typeof scoped.snapshot === 'function') return scoped
    } catch (e) { /* on retombe sur le registre de l'hote */ }
  }
  const own = ctx.get('skills')
  return own !== undefined ? own : null
}

// Ce paquet est le SEUL ecrivain des racines inscriptibles : apres une creation ou une bascule, il doit
// faire oublier son cache a l'instance REELLEMENT interrogee — pas seulement au registre de l'hote.
const invalidateSkills = (ctx, wanted) => {
  if (ctx === undefined || typeof ctx.get !== 'function') return
  const candidates = [ctx.get('skills')]
  const presets = ctx.get('agentPresets')
  if (presets !== undefined && typeof presets.serviceFor === 'function') {
    try {
      const live = agentParId(ctx, wanted) ?? dernierAgent(ctx)
      if (live !== undefined) candidates.push(presets.serviceFor(live, 'skills'))
    } catch (e) { /* on se contente du registre de l'hote */ }
  }
  const seen = new Set()
  for (const reg of candidates) {
    if (reg === undefined || reg === null || seen.has(reg) || typeof reg.invalidateCache !== 'function') continue
    seen.add(reg)
    try { reg.invalidateCache() } catch (e) { /* meilleur effort : le prochain evenement de surveillance fera foi */ }
  }
}

// ── LE CATALOGUE : registre DSH (actifs) + marqueurs desactives (les notres) ─────────────────────────────────
const catalogueOf = async (ctx, config, sessionId) => {
  const cfg = normalizeConfig(config)
  const wRoots = writableRootsOf(cfg)

  // 1. les skills ACTIFS, du registre de DSH : deja fusionnes par nom selon la precedence.
  //    On VERIFIE que le fichier existe encore : le registre garde un catalogue en cache et
  //    ne l'invalide que sur evenement de surveillance. Une entree dont le SKILL.md a disparu
  //    (bascule a l'instant, racine non surveillee) est donc ecartee — le catalogue reste
  //    vrai meme si l'invalidation tarde. Cout : une verification par skill.
  //    La portee est INDISPENSABLE : sans elle le registre ne lit que sa couche globale, qui ne
  //    porte aucun fournisseur, et rend une liste vide — voir `scopeOf`.
  const view = await scopeOf(ctx, cfg, sessionId)
  const registry = registryOf(ctx, view)
  const snapshot = registry === null ? { skills: [], complete: false } : await registry.snapshot({ cwd: view.cwd, scope: view.scope })
  const skills = []
  for (const entry of snapshot.skills) {
    if (typeof entry.path !== 'string') continue
    // UN SEUL appel systeme fait les deux offices. On doit ecarter une entree dont le SKILL.md
    // n'existe plus (le registre repond depuis un cache), et une entree absente ne peut de toute
    // facon pas fournir de date : les deux questions ont la meme reponse. Mesure d'echelle :
    // deux appels par skill coutaient ~25ms pour 1000 skills, un seul en coute la moitie.
    let modifiedAt = ''
    try { modifiedAt = statSync(entry.path).mtime.toISOString() } catch (e) { continue }
    const { folder, root } = layoutOf(entry.path)
    const target = folder !== null ? folder : entry.path
    const writable = writableRootFor(target, wRoots) !== null
    skills.push({
      name: entry.name,
      root: root === null ? '' : root,
      source: typeof entry.source === 'string' ? entry.source : 'runtime',
      rank: SOURCE_RANK[entry.source] ?? UNKNOWN_RANK,
      writable,
      active: true,
      description: typeof entry.description === 'string' ? entry.description : '',
      whenToUse: typeof entry.whenToUse === 'string' ? entry.whenToUse : '',
      modifiedAt,
      collision: false
    })
  }

  // 2. les skills DESACTIVES : invisibles du registre, retrouves par marqueur dans les racines inscriptibles.
  for (const rootPath of wRoots) skills.push(...disabledInRoot(rootPath, cfg))

  // 3. collisions par nom : deux entrees de meme nom (un actif et un desactive dans deux portees).
  const byName = new Map()
  for (const s of skills) byName.set(s.name, (byName.get(s.name) ?? 0) + 1)
  for (const s of skills) s.collision = byName.get(s.name) > 1

  skills.sort((a, b) => (a.rank - b.rank) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) ||
    (a.root < b.root ? -1 : a.root > b.root ? 1 : 0))

  // 4. racines : deduites du catalogue, plus les deux racines inscriptibles meme vides.
  const byRoot = new Map()
  for (const s of skills) {
    if (s.root === '') continue
    if (!byRoot.has(s.root)) {
      byRoot.set(s.root, { path: s.root, source: s.source, rank: s.rank, writable: s.writable, exists: true, count: 0 })
    }
    byRoot.get(s.root).count += 1
  }
  for (const rootPath of wRoots) {
    if (!byRoot.has(rootPath)) {
      const source = sourceOfRootPath(rootPath, cfg)
      byRoot.set(rootPath, { path: rootPath, source, rank: SOURCE_RANK[source], writable: true, exists: existsSync(rootPath), count: 0 })
    }
  }
  const roots = [...byRoot.values()].sort((a, b) => (a.rank - b.rank) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return { skills, roots, complete: snapshot.complete !== false }
}

// ── resolution d'un nom DANS une racine inscriptible (garde A1 conservee : le chemin du marqueur
//    est construit depuis le dossier REEL issu du readdir, jamais depuis le nom resolu) ────────────────────
const resolveInRoot = (rootPath, name) => {
  const matches = []
  if (!existsSync(rootPath)) return matches
  let entries
  try { entries = readdirSync(rootPath) } catch (e) { return matches }
  for (const entry of entries) {
    if (entry.startsWith('.')) continue
    const folder = join(rootPath, entry)
    let st = null
    try { st = statSync(folder) } catch (e) { continue }
    if (!st.isDirectory()) continue
    const activeFile = join(folder, MARKER_ACTIVE)
    const disabledFile = join(folder, MARKER_DISABLED)
    const hasActive = existsSync(activeFile)
    const hasDisabled = existsSync(disabledFile)
    if (!hasActive && !hasDisabled) continue
    const fm = frontmatterOf(hasActive ? activeFile : disabledFile)
    const fmName = typeof fm.name === 'string' ? fm.name : ''
    const resolved = SKILL_NAME_RE.test(fmName) ? fmName : entry
    if (resolved === name) matches.push({ folder, activeFile, disabledFile, hasActive, hasDisabled })
  }
  return matches
}

// ── bascule par renommage UNIQUEMENT (decision gelee ; table ARB-3) ──────────────────────────────────────────
const journalPath = (cfg) => join(cfg.dsh, 'kybernos-skills.json')

// Journal d'audit : ecrit a chaque bascule REELLE, LU PAR PERSONNE. Ce n'est PAS une source de
// verite — l'etat actif/inactif vit dans le systeme de fichiers (presence de SKILL.md) et nulle
// part ailleurs. Best-effort : une ecriture impossible ne fait jamais echouer la bascule.
const appendJournal = (cfg, entry) => {
  const path = journalPath(cfg)
  try {
    let toggles = []
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'))
      if (parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.toggles)) toggles = parsed.toggles
    } catch (e) { /* absent ou corrompu => traite comme vide */ }
    toggles.push(entry)
    writeFileSync(path, JSON.stringify({ version: JOURNAL_VERSION, updatedAt: new Date().toISOString(), toggles: toggles.slice(-JOURNAL_MAX) }, null, 2) + '\n')
    try { chmodSync(path, 0o600) } catch (e2) { /* mode best-effort */ }
  } catch (e) {
    try { console.error('[kybernos-skills] journal des bascules non ecrit (renommage conserve)', e.message) } catch (e2) { /* */ }
  }
}

// ── Featured : mise en avant CONTROLÉE PAR L'UTILISATEUR (liste manuelle) ────────────────────
// Source de vérité : <DSH home>/kybernos/skills-featured.json — un tableau d'items {name, why,
// addedAt} dans l'ORDRE d'affichage. Rien d'automatique : la rangée montre exactement ce que
// l'utilisateur y a mis (l'étoile de la fiche écrit ici). Un nom absent du registre reste dans
// le fichier mais est rendu `found:false` — l'interface le saute sans l'effacer.
const FEATURED_VERSION = 1
const featuredPath = (cfg) => join(cfg.dsh, 'kybernos', 'skills-featured.json')
const featuredCoversDir = (cfg) => join(cfg.dsh, 'kybernos', 'skills-featured')
const COVER_EXTS = ['png', 'webp', 'jpg', 'jpeg', 'svg']
const COVER_TYPES = { png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml' }

const readFeatured = (cfg) => {
  try {
    const parsed = JSON.parse(readFileSync(featuredPath(cfg), 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.items)) return []
    return parsed.items
      .filter((it) => it !== null && typeof it === 'object' && typeof it.name === 'string' && SKILL_NAME_RE.test(it.name))
      .map((it) => ({ name: it.name, why: typeof it.why === 'string' ? it.why : '', addedAt: typeof it.addedAt === 'string' ? it.addedAt : '' }))
  } catch (e) { return [] } // absent ou corrompu => liste vide, jamais une panne de l'onglet
}

const writeFeatured = (cfg, items) => {
  const path = featuredPath(cfg)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify({ version: FEATURED_VERSION, updatedAt: new Date().toISOString(), items }, null, 2) + '\n')
  try { chmodSync(path, 0o600) } catch (e) { /* best-effort, comme le journal */ }
}

// Une pochette par skill, cherchée dans le dossier cache : <name>.png|webp|jpg|jpeg|svg.
// Le NOM est la seule variable (garde A1 : aucune sous-chaîne de chemin ne passe la regex).
const coverFileOf = (cfg, name) => {
  if (SKILL_NAME_RE.test(name) === false) return null
  const dir = featuredCoversDir(cfg)
  for (const ext of COVER_EXTS) {
    const p = join(dir, name + '.' + ext)
    if (existsSync(p)) return p
  }
  return null
}

const skillEntryOf = (rootPath, cfg, resolved) => {
  const source = sourceOfRootPath(rootPath, cfg)
  const { folder, activeFile, disabledFile, hasActive } = resolved
  const carrier = hasActive ? activeFile : disabledFile
  const fm = frontmatterOf(carrier)
  const fmName = typeof fm.name === 'string' ? fm.name : ''
  const name = SKILL_NAME_RE.test(fmName) ? fmName : basename(folder)
  let modifiedAt = ''
  try { modifiedAt = statSync(carrier).mtime.toISOString() } catch (e) { /* */ }
  return {
    name,
    root: rootPath,
    source,
    rank: SOURCE_RANK[source] ?? UNKNOWN_RANK,
    writable: writableRootFor(folder, writableRootsOf(cfg)) !== null,
    active: hasActive,
    description: typeof fm.description === 'string' ? fm.description : '',
    whenToUse: typeof fm.whenToUse === 'string' ? fm.whenToUse : '',
    modifiedAt,
    collision: false
  }
}

const toggleSkill = async ({ ctx, root, name, active, config, sessionId }) => {
  const cfg = normalizeConfig(config)
  const wRoots = writableRootsOf(cfg)

  // La racine doit etre EXACTEMENT l'une des DEUX racines inscriptibles (decisions 2 et 4 gelees).
  if (typeof root !== 'string' || wRoots.includes(root) === false) return { ok: false, error: 'racine absente ou non inscriptible' }
  if (typeof name !== 'string' || !SKILL_NAME_RE.test(name)) return { ok: false, error: 'nom de skill invalide' }
  if (typeof active !== 'boolean') return { ok: false, error: 'champ active requis (booleen)' }

  // Resolution (root, name) : EXACTEMENT un dossier doit resoudre ce nom dans la racine.
  const matches = resolveInRoot(root, name)
  if (matches.length === 0) return { ok: false, error: 'skill introuvable' }
  if (matches.length > 1) return { ok: false, error: 'nom ambigu : plusieurs dossiers resolvent ce nom, chemin complet requis' }
  const resolved = matches[0]
  const { folder, activeFile, disabledFile, hasActive, hasDisabled } = resolved

  if (hasActive && hasDisabled) {
    return { ok: false, error: 'double marqueur SKILL.md + SKILL.md.disabled : etat ambigu, aucun renommage execute' }
  }
  if (!hasActive && !hasDisabled) return { ok: false, error: 'skill introuvable' }

  // Barriere anti-traversal (garde A1) : le dossier RESOLU doit etre un ENFANT DIRECT de la racine.
  if (dirname(folder) !== root || folder === root || basename(folder).startsWith('.')) {
    return { ok: false, error: 'chemin hors racine refuse' }
  }
  const markerPath = join(folder, hasActive ? MARKER_ACTIVE : MARKER_DISABLED)
  if (markerPath !== activeFile && markerPath !== disabledFile) {
    return { ok: false, error: 'chemin hors racine refuse' }
  }

  // Confinement par cible REELLE (defaut A2) : le refus nomme la cause reelle.
  if (writableRootFor(folder, wRoots) === null) {
    return { ok: false, error: 'chemin reel hors racine refuse' }
  }

  let changed = false
  if (active === true && hasActive) changed = false            // (i) deja actif
  else if (active === true && hasDisabled) {                   // (ii) reactivation reelle
    renameSync(disabledFile, activeFile)
    changed = true
  } else if (active === false && hasDisabled) changed = false  // (iii) deja inactif
  else {                                                        // (iv) desactivation reelle
    renameSync(activeFile, disabledFile)
    changed = true
  }

  // Entree recalee APRES renommage eventuel.
  const after = resolveInRoot(root, name)
  const skill = after.length === 1 ? skillEntryOf(root, cfg, after[0]) : null
  if (changed) {
    appendJournal(cfg, { root, name, active, at: new Date().toISOString() })
    // Ce paquet est le SEUL ecrivain des racines inscriptibles : on previent donc le registre que
    // son cache est perime, au lieu de payer une verification d'existence par skill a chaque
    // lecture. Sans cela, la lecture suivante resservirait le skill a son ancien emplacement : il
    // apparaitrait DEUX fois, une fois actif par le cache, une fois desactive par notre balayage.
    // Meilleur effort : un registre d'une autre version reste utilisable sans cette methode.
    invalidateSkills(ctx, sessionId)
  }
  return { ok: true, changed, skill }
}

// ── RESEAU : les DEUX seules destinations sortantes, et aucune autre ─────────────────────────────────────────
// Ce paquet etait jusqu'ici purement local. Il ouvre desormais exactement deux flux, tous deux en
// LECTURE, vers des hotes FIXES :
//   · codeload.github.com  — l'archive d'un depot, pour installer un skill ;
//   · kybernos-skills-index.vercel.app/v1 — our read-only relay of the skills.sh index (ranking, search, curated, audits);
//     see services/skills-index/README.md. It holds the one Vercel token, so no user needs one.
// Aucune URL fournie par l'appelant n'est suivie : `source` est validee en owner/repo AVANT toute
// requete, et le nom du skill reste soumis au meme motif qu'ailleurs. Les redirections sont suivies
// (codeload redirige) mais l'hote initial, lui, n'est jamais choisi par le client.
const SOURCE_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/
const NET_TIMEOUT_MS = 45000
const MAX_ARCHIVE_BYTES = 96 * 1024 * 1024
const MAX_TREE_DEPTH = 6
const MAX_TREE_FILES = 20000
const CODELOAD = 'https://codeload.github.com'

// ── REMOTE INDEX: the skills.sh index, through our relay ─────────────────────────────────────────────────────
// skills.sh's documented API (/api/v1) offers a PAGINATED ranking (0-indexed pages, up to 500 each; all-time / trending / hot
// views), a fuzzy search over name AND description, the first-party curated set, and each skill's SECURITY AUDITS. It
// authenticates with a Vercel OIDC token that only a Vercel deployment receives and renews. We used to ask every user for one
// (pulled with the Vercel CLI, valid ~12 h), so Discover was empty for anyone but the developer. The relay in services/skills-index holds
// it once and serves the same JSON, cached; the plugin sends no credential at all.
// KYBERNOS_SKILLS_INDEX_URL points DSH at another relay (a company server, a test): https, or http on a loopback address only.
// A value that is set but invalid refuses the call: a typo must never fall back to another address.
const INDEX_API_DEFAULT = 'https://kybernos-skills-index.vercel.app/v1'
const VIEWS = ['all-time', 'trending', 'hot']
const PER_PAGE_MAX = 500
const PER_PAGE_DEFAULT = 50
const SEARCH_LIMIT_MAX = 100
const DISCOVER_TTL_MS = 300000

const httpGet = async (url, binary) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), NET_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        accept: binary ? 'application/gzip' : 'application/json, text/html;q=0.9',
        'user-agent': 'kybernos-skills'
      }
    })
    if (!res.ok) return { status: res.status }
    if (binary === true) {
      const buffer = Buffer.from(await res.arrayBuffer())
      if (buffer.length > MAX_ARCHIVE_BYTES) return { status: 413 }
      return { status: 200, buffer }
    }
    return { status: 200, text: await res.text() }
  } catch (e) {
    return { status: 0, error: e !== null && e.name === 'AbortError' ? 'delai depasse' : 'reseau indisponible' }
  } finally {
    clearTimeout(timer)
  }
}

const queryParam = (req, key) => {
  try {
    const url = new URL('http://hote' + (typeof req.url === 'string' ? req.url : '/'))
    const v = url.searchParams.get(key)
    return typeof v === 'string' ? v : ''
  } catch (e) { return '' }
}

// The relay's base URL: the default, or the validated override. null = an override that is set but not acceptable.
const indexApiBase = () => {
  const raw = process.env.KYBERNOS_SKILLS_INDEX_URL
  if (typeof raw !== 'string' || raw.trim() === '') return INDEX_API_DEFAULT
  try {
    const u = new URL(raw.trim())
    const loopback = u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]'
    const schemeOk = u.protocol === 'https:' || (u.protocol === 'http:' && loopback)
    if (schemeOk && u.username === '' && u.password === '' && u.search === '' && u.hash === '') return u.href.replace(/\/+$/, '')
  } catch (e) { /* refused below */ }
  return null
}

// One read-only GET to the relay. No credential is sent. A failure never carries the relay's own text beyond its `message`.
const apiGet = async (path) => {
  const base = indexApiBase()
  if (base === null) return { status: 0, error: 'KYBERNOS_SKILLS_INDEX_URL refusee (https, ou http sur boucle locale)' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), NET_TIMEOUT_MS)
  try {
    const res = await fetch(base + path, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { accept: 'application/json', 'user-agent': 'kybernos-skills' }
    })
    if (!res.ok) {
      let detail = 'index indisponible (' + res.status + ')'
      try { const e = await res.json(); if (typeof e.message === 'string' && e.message !== '') detail = e.message } catch (e2) { /* corps non json */ }
      return { status: res.status, error: detail }
    }
    return { status: 200, body: await res.json() }
  } catch (e) {
    return { status: 0, error: e !== null && e.name === 'AbortError' ? 'delai depasse' : 'reseau indisponible' }
  } finally {
    clearTimeout(timer)
  }
}

// Une entree de l'API : { id, slug, name, source, installs, sourceType, installUrl, url }.
// ATTENTION : `source` n'est PAS toujours « owner/repo ». L'index reference aussi des sources
// `well-known`, dont la source est un DOMAINE (open.feishu.cn) et dont `installUrl` vaut null.
// Les rejeter — ce que faisait SOURCE_RE seul — escamotait 26 entrees sur 50, sans le dire : le
// classement paraissait court alors qu'il etait tronque. 15 % du catalogue est dans ce cas.
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i
const normalizeHit = (raw) => {
  if (raw === null || typeof raw !== 'object') return null
  const source = typeof raw.source === 'string' ? raw.source : ''
  const slug = typeof raw.slug === 'string' && raw.slug !== '' ? raw.slug : (typeof raw.name === 'string' ? raw.name : '')
  if (slug === '' || (SOURCE_RE.test(source) === false && DOMAIN_RE.test(source) === false)) return null
  const sourceType = typeof raw.sourceType === 'string' ? raw.sourceType : ''
  return {
    id: typeof raw.id === 'string' && raw.id !== '' ? raw.id : source + '/' + slug,
    name: slug,
    source,
    installs: Number.isFinite(raw.installs) ? raw.installs : 0,
    sourceType,
    // Seul un depot GitHub est installable par la route /install. L'interface doit le DIRE plutot
    // que de proposer un bouton qui echouera.
    installable: sourceType === 'github' && SOURCE_RE.test(source),
    installUrl: typeof raw.installUrl === 'string' ? raw.installUrl : '',
    url: typeof raw.url === 'string' ? raw.url : ''
  }
}

// Cache en memoire seulement (jamais sur disque), et doctrine dshmarket tenue : un echec reseau
// n'est JAMAIS repondu depuis le cache — sinon la panne se presenterait comme une reponse valide.
const discoverCache = new Map()
const cachedDiscover = async (key, produce) => {
  const hit = discoverCache.get(key)
  if (hit !== undefined && Date.now() - hit.at < DISCOVER_TTL_MS) return hit.data
  const data = await produce()
  if (data !== null && data.ok === true) discoverCache.set(key, { at: Date.now(), data })
  return data
}

// Vide le cache de l'index. Necessaire aux tests pour mesurer un NOUVEAU classement, et de toute
// facon indispensable des qu'on voudra un bouton « rafraichir » cote interface : sans cela une
// reponse reste figee jusqu'a DISCOVER_TTL_MS.
const resetDiscoverCache = () => { discoverCache.clear() }

const clampInt = (v, min, max, fallback) => {
  const n = Number(v)
  if (Number.isFinite(n) === false) return fallback
  const i = Math.trunc(n)
  return i < min ? min : (i > max ? max : i)
}

// Classement PAGINE. Le serveur annonce `total` et `hasMore` : l'interface n'a donc rien a deviner,
// et c'est precisement ce qui manquait quand on scrapait 571 entrees d'une page de 9 827 skills.
const indexSkills = async (opts) => {
  const o = opts !== null && typeof opts === 'object' ? opts : {}
  const view = VIEWS.includes(o.view) ? o.view : 'all-time'
  const page = clampInt(o.page, 0, 100000, 0)
  const perPage = clampInt(o.perPage, 1, PER_PAGE_MAX, PER_PAGE_DEFAULT)
  return cachedDiscover('index:' + view + ':' + page + ':' + perPage, async () => {
    const res = await apiGet('/skills?view=' + view + '&page=' + page + '&per_page=' + perPage)
    if (res.status !== 200) return { ok: false, error: res.error }
    const items = Array.isArray(res.body.data) ? res.body.data : []
    const skills = items.map(normalizeHit).filter((x) => x !== null)
    const pag = res.body.pagination !== null && typeof res.body.pagination === 'object' ? res.body.pagination : {}
    return {
      ok: true,
      view,
      page,
      perPage,
      total: Number.isFinite(pag.total) ? pag.total : skills.length,
      hasMore: pag.hasMore === true,
      skills
    }
  })
}

const searchSkills = async (query, limit) => {
  const q = typeof query === 'string' ? query.trim() : ''
  if (q.length < 2) return { ok: false, error: 'recherche : au moins 2 caracteres' }
  const n = clampInt(limit, 1, SEARCH_LIMIT_MAX, PER_PAGE_DEFAULT)
  return cachedDiscover('q:' + q.toLowerCase() + ':' + n, async () => {
    const res = await apiGet('/skills/search?q=' + encodeURIComponent(q) + '&limit=' + n)
    if (res.status !== 200) return { ok: false, error: res.error }
    const items = Array.isArray(res.body.data) ? res.body.data : []
    const skills = items.map(normalizeHit).filter((x) => x !== null)
    return {
      ok: true,
      query: q,
      count: Number.isFinite(res.body.count) ? res.body.count : skills.length,
      durationMs: Number.isFinite(res.body.durationMs) ? res.body.durationMs : null,
      skills
    }
  })
}

// Le set first-party, groupe par proprietaire. C'est lui qui donne un sens VERIFIABLE a l'ancienne
// pastille « officiel », qui venait d'un drapeau glane dans le HTML d'une page.
const curatedSkills = async () => cachedDiscover('curated', async () => {
  const res = await apiGet('/skills/curated')
  if (res.status !== 200) return { ok: false, error: res.error }
  const owners = (Array.isArray(res.body.data) ? res.body.data : []).map((o) => ({
    owner: o !== null && typeof o.owner === 'string' ? o.owner : '',
    totalInstalls: Number.isFinite(o.totalInstalls) ? o.totalInstalls : 0,
    featuredRepo: typeof o.featuredRepo === 'string' ? o.featuredRepo : '',
    featuredSkill: typeof o.featuredSkill === 'string' ? o.featuredSkill : '',
    skills: (Array.isArray(o.skills) ? o.skills : []).map(normalizeHit).filter((x) => x !== null)
  })).filter((o) => o.owner !== '')
  return {
    ok: true,
    owners,
    totalOwners: Number.isFinite(res.body.totalOwners) ? res.body.totalOwners : owners.length,
    totalSkills: Number.isFinite(res.body.totalSkills) ? res.body.totalSkills : owners.reduce((a, o) => a + o.skills.length, 0),
    generatedAt: typeof res.body.generatedAt === 'string' ? res.body.generatedAt : null
  }
})

// Audits de securite : la donnee qui manquait pour dire autre chose que « non audite ».
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/
const auditSkill = async (source, skill) => {
  const s = typeof source === 'string' && SOURCE_RE.test(source) ? source : ''
  const n = typeof skill === 'string' && SLUG_RE.test(skill) ? skill : ''
  if (s === '' || n === '') return { ok: false, error: 'source ou skill invalide' }
  return cachedDiscover('audit:' + s + '/' + n, async () => {
    const res = await apiGet('/skills/audit/' + s + '/' + n)
    if (res.status === 404) return { ok: true, audits: [], note: 'aucun audit publie pour ce skill' }
    if (res.status !== 200) return { ok: false, error: res.error }
    const audits = (Array.isArray(res.body.audits) ? res.body.audits : []).map((a) => ({
      provider: a !== null && typeof a.provider === 'string' ? a.provider : '',
      slug: typeof a.slug === 'string' ? a.slug : '',
      status: typeof a.status === 'string' ? a.status : '',
      summary: typeof a.summary === 'string' ? a.summary : ''
    })).filter((a) => a.provider !== '')
    return { ok: true, audits }
  })
}

// ── INSTALLATION : telechargement direct de l'archive GitHub, sans npm ni CLI externe ────────────────────────
// Parcours borne de l'arbre extrait : ni profondeur infinie, ni nombre de fichiers infini, et les liens
// symboliques sont ignores (isDirectory() est faux pour un lien) — ce qui est aussi la bonne semantique,
// puisque le service fs de DSH type un lien « symlink » et que discoverRoot l'ignore.
const collectSkillFiles = (dir, out, depth) => {
  if (depth > MAX_TREE_DEPTH || out.length > MAX_TREE_FILES) return
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch (e) { return }
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) collectSkillFiles(full, out, depth + 1)
    else if (entry.isFile() && entry.name === MARKER_ACTIVE) out.push(full)
  }
}

const countFiles = (dir) => {
  let n = 0
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch (e) { return 0 }
  for (const entry of entries) {
    if (entry.isDirectory()) n += countFiles(join(dir, entry.name))
    else n += 1
  }
  return n
}

const installSkill = async ({ ctx, source, name, root, config, sessionId }) => {
  const cfg = normalizeConfig(config)
  const wRoots = writableRootsOf(cfg)
  const dest = typeof root === 'string' && root !== '' ? root : join(cfg.dsh, 'skills')
  if (wRoots.includes(dest) === false) return { ok: false, error: 'racine absente ou non inscriptible' }
  if (typeof source !== 'string' || !SOURCE_RE.test(source)) {
    // Une source `well-known` est un domaine : elle est legitime DANS L'INDEX, mais son contenu n'est
    // pas dans un depot GitHub, donc hors de portee de cette route. Le dire, plutot que « invalide ».
    return {
      ok: false,
      error: DOMAIN_RE.test(String(source))
        ? 'source non GitHub (' + source + ') : cette route n\'installe que depuis un dépôt GitHub'
        : 'source invalide (attendu owner/repo)'
    }
  }
  if (typeof name !== 'string' || !SKILL_NAME_RE.test(name)) return { ok: false, error: 'nom de skill invalide' }
  if (existsSync(join(dest, name))) return { ok: false, error: 'un skill de ce nom est deja installe dans cette racine' }

  const res = await httpGet(CODELOAD + '/' + source + '/tar.gz/HEAD', true)
  if (res.status === 404) return { ok: false, error: 'depot introuvable : ' + source }
  if (res.status !== 200) return { ok: false, error: 'telechargement impossible (' + (res.error !== undefined ? res.error : 'HTTP ' + res.status) + ')' }

  const tmp = mkdtempSync(join(tmpdir(), 'kybernos-skill-'))
  try {
    writeFileSync(join(tmp, 'archive.tar.gz'), res.buffer)
    try { execFileSync('tar', ['-xzf', join(tmp, 'archive.tar.gz'), '-C', tmp], { stdio: 'ignore' }) }
    catch (e) {
      // Nommer la cause reelle : « archive illisible » accuserait le depot alors que c'est
      // peut-etre l'outil d'extraction qui manque sur la machine.
      if (e !== null && e !== undefined && e.code === 'ENOENT') return { ok: false, error: 'tar introuvable sur cette machine : extraction impossible' }
      return { ok: false, error: 'archive illisible' }
    }

    const files = []
    collectSkillFiles(tmp, files, 0)
    const found = []
    for (const file of files) {
      const fm = frontmatterOf(file)
      if (typeof fm.name === 'string' && fm.name === name && typeof fm.description === 'string' && fm.description !== '') found.push(dirname(file))
    }
    if (found.length === 0) return { ok: false, error: 'skill « ' + name + ' » introuvable dans ' + source }
    if (found.length > 1) return { ok: false, error: 'nom ambigu : ' + found.length + ' dossiers de ' + source + ' portent ce nom' }

    mkdirSync(dest, { recursive: true })
    const target = join(dest, name)
    // Copie PHYSIQUE et dereferencee : jamais de lien. Un skill pose par lien serait invisible du
    // registre (defaut constate sur le service fs de DSH), donc installe pour rien.
    cpSync(found[0], target, { recursive: true, dereference: true })
    if (existsSync(join(target, MARKER_ACTIVE)) === false) return { ok: false, error: 'copie incomplete : SKILL.md absent' }

    invalidateSkills(ctx, sessionId)
    return {
      ok: true,
      files: countFiles(target),
      skill: skillEntryOf(dest, cfg, { folder: target, activeFile: join(target, MARKER_ACTIVE), disabledFile: join(target, MARKER_DISABLED), hasActive: true })
    }
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }) } catch (e) { /* bac temporaire : nettoyage au mieux */ }
  }
}

// ── CREATION : le fichier est la seule source, on ecrit donc un SKILL.md valide et rien d'autre ──────────────
// Toute valeur textuelle est emise en scalaire YAML entre guillemets, avec les echappements qui vont
// bien : une description contenant « : » ou un guillemet ne doit pas pouvoir casser le frontmatter.
const yamlQuoted = (v) => '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n') + '"'

const createSkill = async ({ ctx, root, name, description, whenToUse, body, modelInvocable, config, sessionId }) => {
  const cfg = normalizeConfig(config)
  const wRoots = writableRootsOf(cfg)
  const dest = typeof root === 'string' && root !== '' ? root : join(cfg.dsh, 'skills')
  if (wRoots.includes(dest) === false) return { ok: false, error: 'racine absente ou non inscriptible' }
  if (typeof name !== 'string' || !SKILL_NAME_RE.test(name)) return { ok: false, error: 'nom invalide : minuscules, chiffres et tirets, sans accent' }
  if (typeof description !== 'string' || description.trim() === '') return { ok: false, error: 'description requise' }
  if (description.trim().length > 1024) return { ok: false, error: 'description trop longue (1024 caracteres)' }
  const target = join(dest, name)
  if (existsSync(target)) return { ok: false, error: 'un skill de ce nom existe deja dans cette racine' }

  const lines = ['---', 'name: ' + name, 'description: ' + yamlQuoted(description.trim())]
  if (typeof whenToUse === 'string' && whenToUse.trim() !== '') lines.push('whenToUse: ' + yamlQuoted(whenToUse.trim()))
  // Un skill cree pour la bibliotheque n'a pas a etre annonce au modele : il reste invocable par
  // l'humain via « / », mais ne coute aucun jeton tant qu'il n'est pas charge.
  if (modelInvocable === false) lines.push('disable-model-invocation: true')
  lines.push('---', '', typeof body === 'string' && body.trim() !== '' ? body.trim() : '# ' + name, '')
  const content = lines.join('\n')

  try {
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, MARKER_ACTIVE), content)
  } catch (e) {
    try { rmdirSync(target) } catch (e2) { /* rollback : on ne retire que le dossier vide cree a l'instant, jamais un skill */ }
    return { ok: false, error: 'ecriture impossible dans ' + dest }
  }
  invalidateSkills(ctx, sessionId)
  return {
    ok: true,
    skill: skillEntryOf(dest, cfg, { folder: target, activeFile: join(target, MARKER_ACTIVE), disabledFile: join(target, MARKER_DISABLED), hasActive: true })
  }
}

// ── montage des routes (miroir :2728-2729 et :2873-2874, base daed42e) ──────────────────────────────────────
const mountWebRoutes = (ctx, webServerSvc) => {
  const GET = (path, label, fn) => ctx.effect(() => webServerSvc.register({ kind: 'exact', path, handler: async (req, res) => {
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'GET attendu' })
    try { sendJson(res, 200, await fn(req)) } catch (e) { sendJson(res, 200, { ok: false, error: 'requete impossible' }) }
  } }), label)

  // Gardes verbatim et dans cet ordre : methode d'abord, origine ensuite. Aucune route POST ne
  // touche au disque avant les deux.
  const POST = (path, label, fn) => ctx.effect(() => webServerSvc.register({ kind: 'exact', path, handler: async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST attendu' })
    if (sameOrigin(req) === false) return sendJson(res, 403, { ok: false, error: 'origine refusee' })
    try { sendJson(res, 200, await fn(await readJsonBody(req))) } catch (e) { sendJson(res, 200, { ok: false, error: 'requete impossible' }) }
  } }), label)

  GET('/kybernos-skills/skills', 'kybernos-skills: route skills', async (req) => {
    // `sessionId` designe la session AFFICHEE : c'est elle qui fixe le projet (donc les skills de
    // projet visibles). Sans lui on retombe sur le comportement d'origine.
    const catalogue = await catalogueOf(ctx, configOf(), queryParam(req, 'sessionId'))
    const q = queryParam(req, 'q').trim().toLowerCase()
    if (q === '') return { ok: true, ...catalogue }
    const skills = catalogue.skills.filter((s) => s.name.toLowerCase().includes(q) ||
      String(s.description).toLowerCase().includes(q) || String(s.whenToUse).toLowerCase().includes(q))
    return { ok: true, ...catalogue, skills, query: q }
  })

  // ── remote index, through the relay: paginated, 50 per page by default ───────────────────────────────────
  GET('/kybernos-skills/index', 'kybernos-skills: route index', async (req) => indexSkills({
    view: queryParam(req, 'view'),
    page: queryParam(req, 'page'),
    perPage: queryParam(req, 'perPage')
  }))

  GET('/kybernos-skills/search', 'kybernos-skills: route search', async (req) => searchSkills(
    queryParam(req, 'q'), queryParam(req, 'limit')
  ))

  GET('/kybernos-skills/curated', 'kybernos-skills: route curated', async () => curatedSkills())

  GET('/kybernos-skills/audit', 'kybernos-skills: route audit', async (req) => auditSkill(
    queryParam(req, 'source'), queryParam(req, 'skill')
  ))

  GET('/kybernos-skills/status', 'kybernos-skills: route status', async (req) => {
    const cfg = configOf()
    const roots = writableRootsOf(cfg).map((p) => ({ path: p, source: sourceOfRootPath(p, cfg), exists: existsSync(p) }))
    // Diagnostic de la VUE. Le 20/09, un catalogue vide a l'ecran pendant que la session annoncait
    // sept skills n'etait diagnosticable nulle part : `scope` dit ici, en une ligne, si la portee a
    // ete trouvee et quelle instance repond. Sans lui il fallait redemarrer pour savoir.
    const view = await scopeOf(ctx, cfg, queryParam(req, 'sessionId'))
    return {
      ok: true,
      roots,
      view: {
        scope: view.live !== undefined ? 'agent' : (view.scope !== undefined ? 'preset' : 'none'),
        cwd: view.cwd,
        registry: registryOf(ctx, view) === null ? 'absent' : (view.live !== undefined ? 'preset-ou-hote' : 'hote')
      }
    }
  })

  POST('/kybernos-skills/toggle', 'kybernos-skills: route toggle', async (body) => {
    const root = typeof body.root === 'string' ? body.root : ''
    const name = typeof body.name === 'string' ? body.name : ''
    if (root === '') return { ok: false, error: 'racine absente du corps' }
    return await toggleSkill({ ctx, root, name, active: body.active, config: configOf(), sessionId: body.sessionId }) // refus semantiques en HTTP 200 { ok:false, error } (precedent :2100/:2169/:2182/:2207)
  })

  POST('/kybernos-skills/create', 'kybernos-skills: route create', async (body) => createSkill({
    ctx,
    root: body.root,
    name: body.name,
    description: body.description,
    whenToUse: body.whenToUse,
    body: body.body,
    modelInvocable: body.modelInvocable,
    config: configOf(),
    sessionId: body.sessionId
  }))

  POST('/kybernos-skills/install', 'kybernos-skills: route install', async (body) => installSkill({
    ctx,
    source: body.source,
    name: body.name,
    root: body.root,
    config: configOf(),
    sessionId: body.sessionId
  }))

  // ── Featured : la liste mise en avant, contrôlée par l'utilisateur ──────────────────────────
  GET('/kybernos-skills/featured', 'kybernos-skills: route featured', async (req) => {
    const cfg = configOf()
    const catalogue = await catalogueOf(ctx, cfg, queryParam(req, 'sessionId'))
    const byName = new Map(catalogue.skills.map((s) => [s.name, s]))
    const items = readFeatured(cfg).map((it) => {
      const s = byName.get(it.name)
      return {
        ...it,
        found: s !== undefined,
        cover: coverFileOf(cfg, it.name) !== null ? '/kybernos-skills/cover/' + it.name : null,
        ...(s !== undefined
          ? { description: s.description, whenToUse: s.whenToUse, source: s.source, root: s.root, modifiedAt: s.modifiedAt, active: s.active, writable: s.writable }
          : {})
      }
    })
    return { ok: true, items, path: featuredPath(cfg) }
  })

  // Étoile de la fiche / des cartes : {name, action?:'toggle'|'add'|'remove', why?}. Seul un skill
  // PRÉSENT dans le registre peut être mis en avant — on ne feature pas un fantôme.
  // ⚠️ La table exact du webServer est indexée par CHEMIN seul (pas par méthode) : GET et POST sur
  // un même path jettent « duplicate exact route » AU MONTAGE (mesuré ce jour). D'où le suffixe.
  POST('/kybernos-skills/featured/toggle', 'kybernos-skills: route featured toggle', async (body) => {
    const cfg = configOf()
    const name = typeof body.name === 'string' ? body.name : ''
    if (SKILL_NAME_RE.test(name) === false) return { ok: false, error: 'nom de skill invalide' }
    const catalogue = await catalogueOf(ctx, cfg, body.sessionId)
    if (catalogue.skills.some((s) => s.name === name) === false) return { ok: false, error: 'skill introuvable dans le registre' }
    const action = body.action === 'add' || body.action === 'remove' ? body.action : 'toggle'
    const items = readFeatured(cfg)
    const at = items.findIndex((it) => it.name === name)
    const removed = at !== -1
    if (action === 'add' && removed === false) items.push({ name, why: typeof body.why === 'string' ? body.why : '', addedAt: new Date().toISOString() })
    else if (action === 'remove' && removed) items.splice(at, 1)
    else if (action === 'toggle') {
      if (removed) items.splice(at, 1)
      else items.push({ name, why: typeof body.why === 'string' ? body.why : '', addedAt: new Date().toISOString() })
    }
    writeFeatured(cfg, items)
    return { ok: true, featured: items.some((it) => it.name === name), items }
  })

  // Les pochettes sont des FICHIERS BINAIRES : pas sendJson. Route prefix (le nom suit le
  // dernier '/') ; le nom est validé par la regex avant tout accès disque.
  ctx.effect(() => webServerSvc.register({ kind: 'prefix', path: '/kybernos-skills/cover', handler: async (req, res) => {
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'GET attendu' })
    const pathname = new URL(req.url ?? '/', 'http://x').pathname
    const name = decodeURIComponent(pathname.slice('/kybernos-skills/cover/'.length))
    const file = SKILL_NAME_RE.test(name) ? coverFileOf(configOf(), name) : null
    if (file === null) return sendJson(res, 404, { ok: false, error: 'aucune pochette pour ce skill' })
    try {
      const ext = file.slice(file.lastIndexOf('.') + 1)
      res.writeHead(200, { 'content-type': COVER_TYPES[ext] ?? 'application/octet-stream', 'cache-control': 'private, max-age=120' })
      res.end(readFileSync(file))
    } catch (e) { sendJson(res, 500, { ok: false, error: 'lecture de la pochette impossible' }) }
  } }), 'kybernos-skills: route cover')

  console.log('[kybernos-skills] routes /kybernos-skills/* enregistrees (catalogue, bascule, creation, installation, index officiel, featured)')
}

// ── exports nommes pour le harnais (testabilite : chemins explicites, rien de cable) + apply ────────────────
export { dshHome, catalogueOf, toggleSkill, createSkill, installSkill, indexSkills, searchSkills, curatedSkills, auditSkill, resetDiscoverCache, configOf, journalPath, resolveInRoot, writableRootFor, layoutOf, SOURCE_RANK, sameOrigin }

export function apply(ctx) {
  // Filet miroir de kybernos-plugin/index.js:2876-2884 (base) : une erreur de montage ne doit pas
  // couper la GUI — les routes tombent seules, l'erreur est tracee pour correction.
  try {
    // `skills` est desormais une DEPENDANCE DURE : sans le registre de DSH il n'y a pas de
    // catalogue. `inject` differe le montage jusqu'a ce que les deux services soient la.
    ctx.inject(['webServer', 'skills'], (hostCtx) => {
      try {
        mountWebRoutes(hostCtx, hostCtx.get('webServer'))
      } catch (e) {
        try { console.error('[kybernos-skills] montage des routes impossible', e) } catch (e2) { /* */ }
      }
    })
  } catch (ksBootError) {
    try {
      console.error('[kybernos-skills] demarrage impossible — routes /kybernos-skills/* non montees', ksBootError)
    } catch (e2) { /* console indisponible */ }
  }
}
