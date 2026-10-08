// kybernos-skills — cordis host plugin of the sibling package @local/kybernos-skills.
//
// ARCHITECTURE (revised): the catalogue is NO LONGER scanned by hand here. It comes from the
// DSH SKILLS REGISTRY (`ctx.skills`, package @deepseek-ai/dsh-skill), fed by the official
// filesystem provider (@deepseek-ai/dsh-skill-filesystem), which already resolves
// the six roots, their precedence and their live watching.
//   roots and ranks   : dsh-skill-filesystem/lib/index.js:21-25 and :150-186
//   merging duplicates: dsh-skill/lib/index.js:312-330 (sort by precedence THEN
//                        rejection of the already-seen name, with a warning)
// Reimplementing this scan was the direct cause of flaw A3 (two roots resolving to the
// same physical folder showed every skill twice, all read-only).
//
// TEN routes on the webServer service. TWO outbound NETWORK flows, read-only, to fixed hosts
// (codeload.github.com to install, the kybernos-skills-index relay for the index) — see the NETWORK section.
//   GET  /kybernos-skills/skills    : the registry catalogue + the DISABLED skills. ?q= filters.
//   GET  /kybernos-skills/index     : the PAGINATED public index (?view=all-time|trending|hot&page=&perPage=)
//   GET  /kybernos-skills/search    : fuzzy search over the whole index (?q=, 2 characters minimum)
//   GET  /kybernos-skills/curated   : the first-party set, grouped by owner
//   GET  /kybernos-skills/audit     : the security audits of a skill (?source=&skill=)
//   GET  /kybernos-skills/status    : writable roots, registry scope
//   POST /kybernos-skills/toggle    : enabled/disabled toggle by RENAMING
//                                     SKILL.md <-> SKILL.md.disabled, only inside
//                                     <DSH home>/skills (~/.dsh/skills) and ~/.agents/skills (frozen decision).
//   POST /kybernos-skills/create    : writes a valid SKILL.md into a writable root.
//   POST /kybernos-skills/install   : downloads a GitHub archive and copies the requested skill.
//
// WHAT THIS PACKAGE BRINGS, AND WHAT DSH DOES NOT HAVE:
//   1. the registry is READ-ONLY — nobody can disable a skill;
//   2. a disabled skill is INVISIBLE to the registry (discoverRoot looks for `SKILL.md`):
//      the "disabled" view exists nowhere, we build it here;
//   3. the real confinement (flaw A2): writability is decided by the REAL
//      PATH, never by the rank of the winning root;
//   4. the interface.
import { existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync, chmodSync, realpathSync, mkdirSync, mkdtempSync, rmdirSync, rmSync, cpSync, createReadStream } from 'node:fs'
import { createZstdDecompress } from 'node:zlib'
import { homedir, tmpdir } from 'node:os'
import { join, dirname, basename, sep, isAbsolute, resolve as resolvePath } from 'node:path'
import { execFileSync } from 'node:child_process'
import { validateTeamSkill, skillVersion, frontmatterOfText, TEAM_SKILL_LIMITS } from './team-skills.mjs'

// ── local helpers (semantic mirror of kybernos-plugin/index.js:2696-2724, base daed42e) ──────────────────
const str = (v) => (typeof v === 'string' && v.length > 0 ? v : null)

const sendJson = (res, status, payload) => {
  try {
    const body = JSON.stringify(payload === undefined ? null : payload)
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(body)
  } catch (e) { try { res.writeHead(500); res.end('{}') } catch (e2) { /* socket closed */ } }
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
    if (size > cap) throw new Error('body_too_large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  try { return JSON.parse(text) } catch (e) { return {} }
}

// ── contract constants ────────────────────────────────────────────────────────────────────────────────────
const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/ // dsh-skill/lib/index.js:17
const MARKER_ACTIVE = 'SKILL.md'
const MARKER_DISABLED = 'SKILL.md.disabled'
const JOURNAL_VERSION = 1
const JOURNAL_MAX = 50

// Source ranks, MIRROR of dsh-skill-filesystem/lib/index.js:21-25 + BUNDLED_SKILL_RANK
// (dsh-skill/lib/index.js:23). They are used ONLY for the display order and for the identity of an
// entry: discovery, precedence and merging are done by the registry, not here.
const SOURCE_RANK = Object.freeze({
  'project-dsh': 100, 'project-agents': 200, custom: 300,
  'user-dsh': 400, 'user-agents': 500, bundled: 600
})
const UNKNOWN_RANK = 999

// THE ONLY TWO WRITABLE ROOTS (frozen decision). This is our WRITE POLICY,
// not a discovery rule: the registry may read twenty roots, we only write in these two.
const writableRootsOf = (cfg) => [join(cfg.dsh, 'skills'), join(cfg.home, '.agents', 'skills')]

const sourceOfRootPath = (rootPath, cfg) => {
  if (rootPath === join(cfg.dsh, 'skills')) return 'user-dsh'
  if (rootPath === join(cfg.home, '.agents', 'skills')) return 'user-agents'
  return 'custom'
}

// ── configuration: the home stays configurable (harness, testability), and so does the cwd ───────────────────
// The DSH home, resolved the way DSH does (@deepseek-ai/dsh-home-paths): a non-blank $DSH_HOME
// (trimmed, a leading ~ expanded), else <os home>/.dsh. Resolved at each use, never cached.
const dshHome = (env = process.env, osHome = homedir) => {
  const raw = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  if (raw === '') return join(osHome(), '.dsh')
  if (raw === '~') return osHome()
  return resolvePath(raw.startsWith('~/') || raw.startsWith('~\\') ? join(osHome(), raw.slice(2)) : raw)
}

const findProjectRoot = (cwd) => { // mirror of dsh-skill-filesystem/lib/index.js:807-815
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

// ── layout: where a skill lives, from the path of its markdown file ──────────────────────────────────────────
//   <root>/<folder>/SKILL.md             -> folder=<root>/<folder>, root=<root>
//   <root>/<name>.md                     -> folder=null,            root=<root>
const layoutOf = (filePath) => {
  if (typeof filePath !== 'string' || filePath === '') return { folder: null, root: null }
  const base = basename(filePath)
  if (base === MARKER_ACTIVE || base === MARKER_DISABLED) {
    const folder = dirname(filePath)
    return { folder, root: dirname(folder) }
  }
  return { folder: null, root: dirname(filePath) }
}

// ── CONFINEMENT BY REAL TARGET (flaw A2, kept as is) ─────────────────────────────────────────────────────────
// Writability is decided by the REAL path compared with the REAL path of the root, never by the
// rank of the winning source. Intended consequence: when the project IS the home, the registry makes
// `project-dsh` win (rank 100, read-only by convention) while the file actually lives
// in ~/.dsh/skills, which is writable — the real path gives the write permission back, the rank does not
// take it away. A symbolic link whose real target leaves the root stays VISIBLE and readable,
// but becomes non-writable, and the toggle refuses it with a distinct message.
// realpathSync is always under try/catch: not found => NOT compliant, never an exception.
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

// ── minimal "key: value" frontmatter with de-quoting (readable on the DISABLED ones, which the registry does not see; the active ones,
//    for their part, are already parsed by DSH). The parser is the one from team-skills.mjs: the old one (a single regular expression whose spaces and the
//    `.*` overlap) was QUADRATIC — a `k:` line followed by 80,000 spaces blocked the host for 6 s, and a skill downloaded from GitHub
//    is one possible example of it.
const frontmatterOf = (file) => {
  try { return frontmatterOfText(readFileSync(file, 'utf8')) } catch (e) { return {} /* unreadable => empty frontmatter */ }
}

// ── DISABLED VIEW: what the registry cannot see ──────────────────────────────────────────────────────────────
// `SKILL.md.disabled` is not `SKILL.md`, so discoverRoot ignores it and the skill drops out of the catalogue.
// We sweep the TWO writable roots to find these markers. Read-only, no cache.
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
    if (!existsSync(disabledFile)) continue // active => already in the registry, we do not duplicate it
    if (existsSync(join(folder, MARKER_ACTIVE))) continue // double marker => ambiguous, the toggle will refuse it
    const fm = frontmatterOf(disabledFile)
    const fmName = typeof fm.name === 'string' ? fm.name : ''
    const name = SKILL_NAME_RE.test(fmName) ? fmName : entry
    if (!SKILL_NAME_RE.test(name)) continue
    let modifiedAt = ''
    try { modifiedAt = statSync(disabledFile).mtime.toISOString() } catch (e) { /* carrier file gone */ }
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

// ── REGISTRY VIEW: which INSTANCE, which cwd, which SCOPE? ───────────────────────────────────────────────────
// A trap we fell into, which was worth an EMPTY catalogue on screen while the session
// announced seven: DSH's registry does not return the same thing depending on the scope. `collectFresh` only
// reads the GLOBAL layer and those of `chainLayers(options.scope)`. The skills provider registers itself
// in the layer of a PRESET, not in the global layer: a snapshot without `scope` therefore returns NOTHING.
//
// We reproduce what DSH itself does (dsh-api-session-controller, `sessionSkillCatalog` service,
// "backing ctx.remote.skills without activating a cold Agent"): a LIVE agent supplies its scope and the
// instance mounted by its preset; without a live agent, we ask the default preset for its MOUNT
// KEY, which activates no agent.
// The LIVE agent of the requested session. `agents.roots()` guarantees NO order: taking the
// last one mixed up the projects (observed in production on 20 Sep — the Skills tab listed the
// skills of ~/dyad-apps/testing while a session lived in ~/dyad-apps/dsh-kybernos).
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

// The last live agent: original behaviour, kept for the call WITHOUT a session (settings
// page, tab outside a session) and as a last resort.
const dernierAgent = (ctx) => {
  const agents = ctx.get('agents')
  if (agents === undefined || typeof agents.roots !== 'function') return undefined
  try {
    const roots = agents.roots()
    return Array.isArray(roots) && roots.length > 0 ? roots[roots.length - 1] : undefined
  } catch (e) { return undefined }
}

// The view carried by a live agent: its scope, and the cwd of ITS header.
const vueAgent = (live, cfg) => {
  const header = live.session !== undefined ? live.session.header : undefined
  const cwd = header !== undefined && typeof header.cwd === 'string' && header.cwd !== '' ? header.cwd : cfg.cwd
  return { scope: live, live, cwd }
}

// The MOUNT KEY of the default preset: it carries the skills provider without activating any
// agent. This is what DSH itself does for a cold session.
const cleDeMontage = async (ctx) => {
  const presets = ctx.get('agentPresets')
  if (presets !== undefined && typeof presets.standingKeyFor === 'function') {
    try { return await presets.standingKeyFor(undefined) } catch (e) { /* no mountable preset */ }
  }
  return undefined
}

// The cwd of an IDLE session. The displayed session is not always live (tab opened
// afterwards, inactive session): `agents.roots()` then does not know it and the host fell back to
// its OWN directory — hence the skills of an unrelated project, or none at all. DSH writes the session header
// (`{ type:'session', version, id, cwd, ... }`) at the head of a zstd stream:
//   <home>/sessions/<project>/<sessionId>/session.v3.jsonl.zstd
// We read ONLY the first event, as a stream: a session can weigh megabytes, and the
// catalogue reloads often. Any error returns `null`: we fall back, we never fail.
const enteteDeSession = (chemin) => new Promise((resolve) => {
  let flux = null
  let zstd = null
  let fini = false
  const finir = (valeur) => {
    if (fini === true) return
    fini = true
    clearTimeout(minuteur)
    try { if (flux !== null) flux.destroy() } catch (e) { /* already closed */ }
    try { if (zstd !== null) zstd.destroy() } catch (e) { /* already closed */ }
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
  // 1. The requested session is alive: its scope and its cwd, no discussion.
  const parId = agentParId(ctx, wanted)
  if (parId !== undefined) return vueAgent(parId, cfg)
  // 2. Session requested but IDLE: its project is the one in its header, NOT that of the last live
  //    agent. This is the real failure of 20 Sep: an idle session inherited the project of another
  //    session, and its own project skills never showed up.
  if (typeof wanted === 'string' && wanted !== '') {
    const cwdSession = await cwdDeSession(cfg, wanted)
    if (cwdSession !== null) return { scope: await cleDeMontage(ctx), live: undefined, cwd: cwdSession }
  }
  // 3. No session (or unknown session): the last live agent, original behavior.
  const dernier = dernierAgent(ctx)
  if (dernier !== undefined) return vueAgent(dernier, cfg)
  // 4. Nothing at all: the preset's mount key, and the host's directory.
  return { scope: await cleDeMontage(ctx), live: undefined, cwd: cfg.cwd }
}

// The registry instance to query. With a live agent, DSH mounts the registry of the preset that carries
// that agent: querying the host's one would return a different view, and invalidating it would refresh nothing.
const registryOf = (ctx, view) => {
  const presets = ctx.get('agentPresets')
  if (view.live !== undefined && presets !== undefined && typeof presets.serviceFor === 'function') {
    try {
      const scoped = presets.serviceFor(view.live, 'skills')
      if (scoped !== undefined && typeof scoped.snapshot === 'function') return scoped
    } catch (e) { /* we fall back to the host's registry */ }
  }
  const own = ctx.get('skills')
  return own !== undefined ? own : null
}

// This package is the ONLY writer of the writable roots: after a creation or a toggle, it must
// make the instance ACTUALLY queried forget its cache — not only the host's registry.
const invalidateSkills = (ctx, wanted) => {
  if (ctx === undefined || typeof ctx.get !== 'function') return
  const candidates = [ctx.get('skills')]
  const presets = ctx.get('agentPresets')
  if (presets !== undefined && typeof presets.serviceFor === 'function') {
    try {
      const live = agentParId(ctx, wanted) ?? dernierAgent(ctx)
      if (live !== undefined) candidates.push(presets.serviceFor(live, 'skills'))
    } catch (e) { /* we settle for the host's registry */ }
  }
  const seen = new Set()
  for (const reg of candidates) {
    if (reg === undefined || reg === null || seen.has(reg) || typeof reg.invalidateCache !== 'function') continue
    seen.add(reg)
    try { reg.invalidateCache() } catch (e) { /* best effort: the next watch event will be authoritative */ }
  }
}

// ── THE CATALOGUE: DSH registry (active) + disabled markers (ours) ─────────────────────────────────
const catalogueOf = async (ctx, config, sessionId) => {
  const cfg = normalizeConfig(config)
  const wRoots = writableRootsOf(cfg)

  // 1. the ACTIVE skills, from the DSH registry: already merged by name according to precedence.
  //    We CHECK that the file still exists: the registry keeps a cached catalogue and
  //    only invalidates it on a watch event. An entry whose SKILL.md has disappeared
  //    (just toggled, unwatched root) is therefore dropped — the catalogue stays
  //    true even if the invalidation is late. Cost: one check per skill.
  //    The scope is ESSENTIAL: without it the registry only reads its global layer, which
  //    carries no provider, and returns an empty list — see `scopeOf`.
  const view = await scopeOf(ctx, cfg, sessionId)
  const registry = registryOf(ctx, view)
  const snapshot = registry === null ? { skills: [], complete: false } : await registry.snapshot({ cwd: view.cwd, scope: view.scope })
  const skills = []
  for (const entry of snapshot.skills) {
    if (typeof entry.path !== 'string') continue
    // ONE system call does both jobs. We must drop an entry whose SKILL.md
    // no longer exists (the registry answers from a cache), and a missing entry cannot
    // provide a date anyway: both questions have the same answer. Scale measurement:
    // two calls per skill cost ~25ms for 1000 skills, a single one costs half of that.
    let modifiedAt = ''
    try { modifiedAt = statSync(entry.path).mtime.toISOString() } catch (e) { continue }
    const { folder, root } = layoutOf(entry.path)
    const target = folder !== null ? folder : entry.path
    const writable = writableRootFor(target, wRoots) !== null
    // Only a skill of a writable root can have been installed from a team (that is where an install writes).
    const team = writable && root !== null ? teamInfoOf(root, entry.name) : { teamVersion: null, teamModified: null }
    skills.push({
      name: entry.name,
      root: root === null ? '' : root,
      source: typeof entry.source === 'string' ? entry.source : 'runtime',
      rank: SOURCE_RANK[entry.source] ?? UNKNOWN_RANK,
      writable,
      teamVersion: team.teamVersion,
      teamModified: team.teamModified,
      active: true,
      description: typeof entry.description === 'string' ? entry.description : '',
      whenToUse: typeof entry.whenToUse === 'string' ? entry.whenToUse : '',
      modifiedAt,
      collision: false
    })
  }

  // 2. the DISABLED skills: invisible to the registry, found by marker in the writable roots.
  for (const rootPath of wRoots) skills.push(...disabledInRoot(rootPath, cfg))

  // 3. collisions by name: two entries with the same name (one active and one disabled in two scopes).
  const byName = new Map()
  for (const s of skills) byName.set(s.name, (byName.get(s.name) ?? 0) + 1)
  for (const s of skills) s.collision = byName.get(s.name) > 1

  skills.sort((a, b) => (a.rank - b.rank) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) ||
    (a.root < b.root ? -1 : a.root > b.root ? 1 : 0))

  // 4. roots: derived from the catalogue, plus the two writable roots even when empty.
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

// ── resolving a name IN a writable root (guard A1 kept: the marker path
//    is built from the REAL folder coming from the readdir, never from the resolved name) ────────────────────
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

// ── toggle by rename ONLY (frozen decision; table ARB-3) ──────────────────────────────────────────
const journalPath = (cfg) => join(cfg.dsh, 'kybernos-skills.json')

// Audit journal: written on every REAL toggle, READ BY NOBODY. It is NOT a source of
// truth — the active/inactive state lives in the file system (presence of SKILL.md) and nowhere
// else. Best-effort: a write that cannot happen never makes the toggle fail.
const appendJournal = (cfg, entry) => {
  const path = journalPath(cfg)
  try {
    let toggles = []
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'))
      if (parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.toggles)) toggles = parsed.toggles
    } catch (e) { /* missing or corrupt => treated as empty */ }
    toggles.push(entry)
    writeFileSync(path, JSON.stringify({ version: JOURNAL_VERSION, updatedAt: new Date().toISOString(), toggles: toggles.slice(-JOURNAL_MAX) }, null, 2) + '\n')
    try { chmodSync(path, 0o600) } catch (e2) { /* best-effort mode */ }
  } catch (e) {
    try { console.error('[kybernos-skills] journal des bascules non ecrit (renommage conserve)', e.message) } catch (e2) { /* */ }
  }
}

// ── Featured: USER-CONTROLLED highlighting (manual list) ────────────────────
// Source of truth: <DSH home>/kybernos/skills-featured.json — an array of items {name, why,
// addedAt} in display ORDER. Nothing automatic: the row shows exactly what the
// user put in it (the star on the detail page writes here). A name missing from the registry stays in
// the file but is rendered `found:false` — the UI skips it without erasing it.
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
  } catch (e) { return [] } // missing or corrupt => empty list, never an outage of the tab
}

const writeFeatured = (cfg, items) => {
  const path = featuredPath(cfg)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify({ version: FEATURED_VERSION, updatedAt: new Date().toISOString(), items }, null, 2) + '\n')
  try { chmodSync(path, 0o600) } catch (e) { /* best-effort, like the journal */ }
}

// One cover per skill, looked up in the cache folder: <name>.png|webp|jpg|jpeg|svg.
// The NAME is the only variable (guard A1: no path substring passes the regex).
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

  // The root must be EXACTLY one of the TWO writable roots (frozen decisions 2 and 4).
  if (typeof root !== 'string' || wRoots.includes(root) === false) return { ok: false, error: 'root_not_allowed' }
  if (typeof name !== 'string' || !SKILL_NAME_RE.test(name)) return { ok: false, error: 'invalid_name' }
  if (typeof active !== 'boolean') return { ok: false, error: 'active_required' }

  // Resolution (root, name): EXACTLY one folder must resolve this name in the root.
  const matches = resolveInRoot(root, name)
  if (matches.length === 0) return { ok: false, error: 'skill_not_found' }
  if (matches.length > 1) return { ok: false, error: 'skill_ambiguous' }
  const resolved = matches[0]
  const { folder, activeFile, disabledFile, hasActive, hasDisabled } = resolved

  if (hasActive && hasDisabled) {
    return { ok: false, error: 'double_marker' }
  }
  if (!hasActive && !hasDisabled) return { ok: false, error: 'skill_not_found' }

  // Anti-traversal barrier (guard A1): the RESOLVED folder must be a DIRECT CHILD of the root.
  if (dirname(folder) !== root || folder === root || basename(folder).startsWith('.')) {
    return { ok: false, error: 'path_outside_root' }
  }
  const markerPath = join(folder, hasActive ? MARKER_ACTIVE : MARKER_DISABLED)
  if (markerPath !== activeFile && markerPath !== disabledFile) {
    return { ok: false, error: 'path_outside_root' }
  }

  // Confinement by REAL target (flaw A2): the refusal names the real cause.
  if (writableRootFor(folder, wRoots) === null) {
    return { ok: false, error: 'real_path_outside_root' }
  }

  let changed = false
  if (active === true && hasActive) changed = false            // (i) already active
  else if (active === true && hasDisabled) {                   // (ii) real reactivation
    renameSync(disabledFile, activeFile)
    changed = true
  } else if (active === false && hasDisabled) changed = false  // (iii) already inactive
  else {                                                        // (iv) real deactivation
    renameSync(activeFile, disabledFile)
    changed = true
  }

  // Entry recomputed AFTER the rename, if any.
  const after = resolveInRoot(root, name)
  const skill = after.length === 1 ? skillEntryOf(root, cfg, after[0]) : null
  if (changed) {
    appendJournal(cfg, { root, name, active, at: new Date().toISOString() })
    // This package is the ONLY writer of the writable roots: so we tell the registry that
    // its cache is stale, instead of paying an existence check per skill on every
    // read. Without this, the next read would serve the skill again at its old location: it would
    // show up TWICE, once active from the cache, once disabled from our sweep.
    // Best effort: a registry from another version stays usable without this method.
    invalidateSkills(ctx, sessionId)
  }
  return { ok: true, changed, skill }
}

// ── NETWORK: the ONLY TWO outgoing destinations, and no other ─────────────────────────────────────────────
// This package used to be purely local. It now opens exactly two flows, both
// READ-only, to FIXED hosts:
//   · codeload.github.com  — a repository's archive, to install a skill;
//   · skills.kybernos.app/v1 — our read-only relay of the skills.sh index (ranking, search, curated, audits);
//     see services/skills-index/README.md. It holds the one Vercel token, so no user needs one.
// No caller-supplied URL is followed: `source` is validated as owner/repo BEFORE any
// request, and the skill name remains subject to the same pattern as elsewhere. Redirects are followed
// (codeload redirects) but the initial host is never chosen by the client.
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
const INDEX_API_DEFAULT = 'https://skills.kybernos.app/v1'
const VIEWS = ['all-time', 'trending', 'hot']
const PER_PAGE_MAX = 500
const PER_PAGE_DEFAULT = 50
const SEARCH_LIMIT_MAX = 100
const DISCOVER_TTL_MS = 300000

// The most a JSON answer (the relay's, a listing) may weigh. A ranking page is a few hundred KB.
const MAX_TEXT_BYTES = 16 * 1024 * 1024

/** The body of a response, never holding more than `max` bytes: `null` when it is larger (the stream is cancelled and the socket dropped).
 *  Without the cap a faulty relay or a proxy's page that never ends filled the memory of the whole DSH. */
const readBounded = async (res, max) => {
  const declared = Number(res.headers !== undefined && res.headers !== null && typeof res.headers.get === 'function' ? res.headers.get('content-length') : NaN)
  if (Number.isFinite(declared) && declared > max) { try { await res.body.cancel() } catch (e) { /* closed */ } return null }
  if (res.body === null || res.body === undefined || typeof res.body.getReader !== 'function') {
    const whole = Buffer.from(await res.arrayBuffer())
    return whole.length > max ? null : whole
  }
  const reader = res.body.getReader()
  const chunks = []
  let total = 0
  for (;;) {
    const part = await reader.read()
    if (part.done === true) break
    total += part.value.byteLength
    if (total > max) { await reader.cancel().catch(() => {}); return null }
    chunks.push(part.value)
  }
  return Buffer.concat(chunks)
}

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
      const buffer = await readBounded(res, MAX_ARCHIVE_BYTES)
      if (buffer === null) return { status: 413 }
      return { status: 200, buffer }
    }
    const text = await readBounded(res, MAX_TEXT_BYTES)
    if (text === null) return { status: 413 }
    return { status: 200, text: text.toString('utf8') }
  } catch (e) {
    return { status: 0, error: e !== null && e.name === 'AbortError' ? 'timeout' : 'network_unavailable' }
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
  if (base === null) return { status: 0, error: 'index_url_refused' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), NET_TIMEOUT_MS)
  try {
    const res = await fetch(base + path, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { accept: 'application/json', 'user-agent': 'kybernos-skills' }
    })
    if (!res.ok) {
      let detail
      try { const e = JSON.parse((await readBounded(res, 65536)).toString('utf8')); if (typeof e.message === 'string' && e.message !== '') detail = e.message } catch (e2) { /* body is not JSON, or too long to be an error */ }
      return { status: res.status, error: 'index_unavailable', http: res.status, detail }
    }
    const raw = await readBounded(res, MAX_TEXT_BYTES)
    if (raw === null) return { status: 0, error: 'network_unavailable' }
    return { status: 200, body: JSON.parse(raw.toString('utf8')) }
  } catch (e) {
    return { status: 0, error: e !== null && e.name === 'AbortError' ? 'timeout' : 'network_unavailable' }
  } finally {
    clearTimeout(timer)
  }
}

// What a failed `apiGet` becomes for the screen: a code, and the facts its sentence needs (the screen words it, in its own language).
const apiFail = (res) => ({ ok: false, error: res.error, http: res.http, detail: res.detail })

// An API entry: { id, slug, name, source, installs, sourceType, installUrl, url }.
// WARNING: `source` is NOT always "owner/repo". The index also lists `well-known` sources,
// whose source is a DOMAIN (open.feishu.cn) and whose `installUrl` is null.
// Rejecting them — which SOURCE_RE alone did — silently dropped 26 entries out of 50: the
// ranking looked short when it was in fact truncated. 15% of the catalogue is in this case.
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
    // Only a GitHub repository can be installed by the /install route. The interface must SAY so
    // rather than offer a button that will fail.
    installable: sourceType === 'github' && SOURCE_RE.test(source),
    installUrl: typeof raw.installUrl === 'string' ? raw.installUrl : '',
    url: typeof raw.url === 'string' ? raw.url : ''
  }
}

// In-memory cache only (never on disk), and the dshmarket doctrine is kept: a network failure
// is NEVER answered from the cache — otherwise the outage would look like a valid answer.
const discoverCache = new Map()
const cachedDiscover = async (key, produce) => {
  const hit = discoverCache.get(key)
  if (hit !== undefined && Date.now() - hit.at < DISCOVER_TTL_MS) return hit.data
  const data = await produce()
  if (data !== null && data.ok === true) discoverCache.set(key, { at: Date.now(), data })
  return data
}

// Empties the index cache. Needed by the tests to measure a NEW ranking, and in any case
// indispensable as soon as a "refresh" button is wanted on the interface side: without it an answer
// stays frozen until DISCOVER_TTL_MS.
const resetDiscoverCache = () => { discoverCache.clear() }

const clampInt = (v, min, max, fallback) => {
  const n = Number(v)
  if (Number.isFinite(n) === false) return fallback
  const i = Math.trunc(n)
  return i < min ? min : (i > max ? max : i)
}

// PAGINATED ranking. The server announces `total` and `hasMore`: the interface has nothing to guess,
// and that is precisely what was missing when 571 entries were scraped from a page of 9,827 skills.
const indexSkills = async (opts) => {
  const o = opts !== null && typeof opts === 'object' ? opts : {}
  const view = VIEWS.includes(o.view) ? o.view : 'all-time'
  const page = clampInt(o.page, 0, 100000, 0)
  const perPage = clampInt(o.perPage, 1, PER_PAGE_MAX, PER_PAGE_DEFAULT)
  return cachedDiscover('index:' + view + ':' + page + ':' + perPage, async () => {
    const res = await apiGet('/skills?view=' + view + '&page=' + page + '&per_page=' + perPage)
    if (res.status !== 200) return apiFail(res)
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
  if (q.length < 2) return { ok: false, error: 'query_too_short' }
  const n = clampInt(limit, 1, SEARCH_LIMIT_MAX, PER_PAGE_DEFAULT)
  return cachedDiscover('q:' + q.toLowerCase() + ':' + n, async () => {
    const res = await apiGet('/skills/search?q=' + encodeURIComponent(q) + '&limit=' + n)
    if (res.status !== 200) return apiFail(res)
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

// The first-party set, grouped by owner. It is what gives a VERIFIABLE meaning to the former
// "official" badge, which came from a flag scraped from a page's HTML.
const curatedSkills = async () => cachedDiscover('curated', async () => {
  const res = await apiGet('/skills/curated')
  if (res.status !== 200) return apiFail(res)
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

// Security audits: the data that was missing to say anything other than "not audited".
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/
const auditSkill = async (source, skill) => {
  const s = typeof source === 'string' && SOURCE_RE.test(source) ? source : ''
  const n = typeof skill === 'string' && SLUG_RE.test(skill) ? skill : ''
  if (s === '' || n === '') return { ok: false, error: 'invalid_source' }
  return cachedDiscover('audit:' + s + '/' + n, async () => {
    const res = await apiGet('/skills/audit/' + s + '/' + n)
    if (res.status === 404) return { ok: true, audits: [], note: 'no_audit' }
    if (res.status !== 200) return apiFail(res)
    const audits = (Array.isArray(res.body.audits) ? res.body.audits : []).map((a) => ({
      provider: a !== null && typeof a.provider === 'string' ? a.provider : '',
      slug: typeof a.slug === 'string' ? a.slug : '',
      status: typeof a.status === 'string' ? a.status : '',
      summary: typeof a.summary === 'string' ? a.summary : ''
    })).filter((a) => a.provider !== '')
    return { ok: true, audits }
  })
}

// ── INSTALLATION: direct download of the GitHub archive, without npm or an external CLI ────────────────────────
// Bounded walk of the extracted tree: neither infinite depth nor an infinite number of files, and symbolic
// links are ignored (isDirectory() is false for a link) — which is also the right semantics,
// since DSH's fs service types a link as "symlink" and discoverRoot ignores it.
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
  if (wRoots.includes(dest) === false) return { ok: false, error: 'root_not_allowed' }
  if (typeof source !== 'string' || !SOURCE_RE.test(source)) {
    // A `well-known` source is a domain: it is legitimate IN THE INDEX, but its content is
    // not in a GitHub repository, hence out of reach of this route. Say so, rather than "invalid".
    return {
      ok: false,
      error: DOMAIN_RE.test(String(source)) ? 'not_github' : 'invalid_source',
      source: typeof source === 'string' ? source : undefined
    }
  }
  if (typeof name !== 'string' || !SKILL_NAME_RE.test(name)) return { ok: false, error: 'invalid_name' }
  if (existsSync(join(dest, name))) return { ok: false, error: 'already_installed' }

  const res = await httpGet(CODELOAD + '/' + source + '/tar.gz/HEAD', true)
  if (res.status === 404) return { ok: false, error: 'repo_not_found', source }
  if (res.status === 0) return { ok: false, error: res.error }   // timeout | network_unavailable
  if (res.status !== 200) return { ok: false, error: 'download_failed', http: res.status }

  const tmp = mkdtempSync(join(tmpdir(), 'kybernos-skill-'))
  try {
    writeFileSync(join(tmp, 'archive.tar.gz'), res.buffer)
    try { execFileSync('tar', ['-xzf', join(tmp, 'archive.tar.gz'), '-C', tmp], { stdio: 'ignore' }) }
    catch (e) {
      // Name the real cause: "unreadable archive" would blame the repository when it is
      // perhaps the extraction tool that is missing on the machine.
      if (e !== null && e !== undefined && e.code === 'ENOENT') return { ok: false, error: 'tar_missing' }
      return { ok: false, error: 'archive_unreadable' }
    }

    const files = []
    collectSkillFiles(tmp, files, 0)
    const found = []
    for (const file of files) {
      const fm = frontmatterOf(file)
      if (typeof fm.name === 'string' && fm.name === name && typeof fm.description === 'string' && fm.description !== '') found.push(dirname(file))
    }
    if (found.length === 0) return { ok: false, error: 'skill_not_in_repo', name, source }
    if (found.length > 1) return { ok: false, error: 'repo_ambiguous', count: found.length, source }

    mkdirSync(dest, { recursive: true })
    const target = join(dest, name)
    // PHYSICAL, dereferenced copy: never a link. A skill placed as a link would be invisible to the
    // registry (flaw observed on DSH's fs service), hence installed for nothing.
    cpSync(found[0], target, { recursive: true, dereference: true })
    if (existsSync(join(target, MARKER_ACTIVE)) === false) return { ok: false, error: 'copy_incomplete' }

    invalidateSkills(ctx, sessionId)
    return {
      ok: true,
      files: countFiles(target),
      skill: skillEntryOf(dest, cfg, { folder: target, activeFile: join(target, MARKER_ACTIVE), disabledFile: join(target, MARKER_DISABLED), hasActive: true })
    }
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }) } catch (e) { /* temporary folder: best-effort cleanup */ }
  }
}

// ── TEAM SKILLS: a local skill to the Team, and a Team skill to this machine ─────────────────────────────────
// The server half is docs/dev/team-skills-contract.md; the pure rules (limits, paths, secret scan, version) are team-skills.mjs and
// are applied on both ends. Two operations touch the disk, and both are POST: they carry skill CONTENT, which a GET (served before
// DSH's own auth, no origin guard) must not hand to any local caller.
//   pack    reads a skill folder of ONE of the two writable roots and returns what a proposal carries;
//   install writes what a Team skill carries into a writable root, atomically, and NEVER over an existing folder.
const TEAM_WALK_DEPTH = 6

// Every regular file of a skill folder, as { path, abs, size }. Hidden entries (`.git`, `.DS_Store`, `.env`) and `node_modules` are
// not part of a skill; a symlink is neither a file nor a folder here, so it is skipped, never followed.
const walkSkillFolder = (dir, rel, depth, out) => {
  if (depth > TEAM_WALK_DEPTH || out.length > TEAM_SKILL_LIMITS.files) return
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch (e) { return }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const abs = join(dir, entry.name)
    const path = rel === '' ? entry.name : rel + '/' + entry.name
    if (entry.isDirectory()) walkSkillFolder(abs, path, depth + 1, out)
    else if (entry.isFile()) {
      let size = 0
      try { size = statSync(abs).size } catch (e) { continue }
      out.push({ path, abs, size })
    }
  }
}

// What an install leaves inside the skill folder to say where it came from: the version that was approved. It is a hidden file, so
// it is never part of the files a proposal carries and never changes the version of the folder. A skill without it is the user's own.
const TEAM_MARK = '.kybernos-team.json'

const readTeamMark = (folder) => {
  try {
    const m = JSON.parse(readFileSync(join(folder, TEAM_MARK), 'utf8'))
    return m !== null && typeof m === 'object' && /^[0-9a-f]{64}$/.test(String(m.version)) ? { version: m.version, id: Number.isInteger(m.id) ? m.id : null, installedAt: typeof m.installedAt === 'string' ? m.installedAt : '' } : null
  } catch (e) { return null }
}

/** `{ ok: true, files }` (text files of a skill folder, sorted by path) or `{ ok: false, error: 'invalid_skill', reason, file }`. */
const readSkillFiles = (folder) => {
  const listed = []
  walkSkillFolder(folder, '', 0, listed)
  if (listed.length > TEAM_SKILL_LIMITS.files) return { ok: false, error: 'invalid_skill', reason: 'too_many_files' }
  const files = []
  for (const f of listed.sort((a, b) => (a.path < b.path ? -1 : (a.path > b.path ? 1 : 0)))) {
    if (f.size > TEAM_SKILL_LIMITS.fileBytes) return { ok: false, error: 'invalid_skill', reason: 'file_too_large', file: f.path }
    let content
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(f.abs)) } catch (e) {
      // Not UTF-8 text (a picture, a binary), or unreadable: either way it cannot travel, and the user is told which file.
      return { ok: false, error: 'invalid_skill', reason: 'binary', file: f.path }
    }
    files.push({ path: f.path, content })
  }
  return { ok: true, files }
}

/**
 * What the catalogue says about a skill that an install put there: `{ teamVersion, teamModified }`, both null for the user's own.
 * `teamModified` is true when the files no longer hash to the installed version (edited, added to, or unreadable as text).
 */
const teamInfoOf = (root, name) => {
  const folder = join(root, name)
  const mark = readTeamMark(folder)
  if (mark === null) return { teamVersion: null, teamModified: null }
  const read = readSkillFiles(folder)
  return { teamVersion: mark.version, teamModified: read.ok !== true || skillVersion(read.files) !== mark.version }
}

/** `{ ok, name, description, files: [{path, content}], version, count, bytes, scripts }` or `{ ok: false, error, reason?, file? }`. Never writes. */
const packSkill = ({ root, name, config }) => {
  const cfg = normalizeConfig(config)
  if (typeof name !== 'string' || !SKILL_NAME_RE.test(name)) return { ok: false, error: 'invalid_skill', reason: 'name' }
  if (typeof root !== 'string' || writableRootsOf(cfg).includes(root) === false) return { ok: false, error: 'root_not_allowed' }
  const matches = resolveInRoot(root, name)
  if (matches.length === 0) return { ok: false, error: 'skill_not_found' }
  if (matches.length > 1) return { ok: false, error: 'skill_ambiguous' }
  const found = matches[0]
  if (found.hasActive === false) return { ok: false, error: 'skill_disabled' }
  // The folder must really live under the root (a symlink leaving it is visible elsewhere, but never packed).
  if (writableRootFor(found.folder, [root]) === null) return { ok: false, error: 'root_not_allowed' }

  const read = readSkillFiles(found.folder)
  if (read.ok !== true) return read
  const files = read.files
  const checked = validateTeamSkill({ name, files })
  if (checked.ok !== true) return { ok: false, error: checked.reason === 'scan_rejected' ? 'scan_rejected' : 'invalid_skill', reason: checked.reason, file: checked.file, line: checked.line }
  return { ok: true, name, description: checked.description, files, version: checked.version, count: checked.count, bytes: checked.bytes, scripts: checked.scripts }
}

/**
 * Writes a Team skill into a writable root. `version` is what the server announced: the files must hash to it, or nothing is written.
 * It never overwrites a folder, with ONE exception: `replace: true` swaps a folder that an earlier install made (it carries the team
 * mark) and that nobody has touched since (its files still hash to the version the mark says). The user's own skills, and a team
 * skill edited by hand, are left exactly as they are.
 */
const installTeamSkill = async ({ ctx, root, name, version, files, teamId, replace, config, sessionId }) => {
  const cfg = normalizeConfig(config)
  const wRoots = writableRootsOf(cfg)
  const dest = typeof root === 'string' && root !== '' ? root : join(cfg.dsh, 'skills')
  if (wRoots.includes(dest) === false) return { ok: false, error: 'root_not_allowed' }
  const checked = validateTeamSkill({ name, files })
  if (checked.ok !== true) return { ok: false, error: checked.reason === 'scan_rejected' ? 'scan_rejected' : 'invalid_skill', reason: checked.reason, file: checked.file }
  if (typeof version !== 'string' || version !== checked.version) return { ok: false, error: 'version_mismatch' }
  const target = join(dest, name)
  const swap = existsSync(target)
  if (swap) {
    if (replace !== true) return { ok: false, error: 'exists' }
    // A swap needs proof that the folder is ours to replace.
    const info = teamInfoOf(dest, name)
    if (info.teamVersion === null) return { ok: false, error: 'exists' }
    if (info.teamModified !== false) return { ok: false, error: 'modified' }
  }

  let staging = null
  let parked = null
  try {
    mkdirSync(dest, { recursive: true })
    // A dot-prefixed staging folder: the registry never lists it, and the rename below is one step.
    staging = mkdtempSync(join(dest, '.kb-team-'))
    for (const f of files) {
      const abs = resolvePath(staging, f.path)
      if (abs.startsWith(staging + sep) === false) throw new Error('path outside the skill folder')
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, f.content, { mode: 0o644 })
    }
    writeFileSync(join(staging, TEAM_MARK), JSON.stringify({ version: checked.version, id: Number.isInteger(teamId) ? teamId : null, installedAt: new Date().toISOString() }) + '\n', { mode: 0o644 })
    if (swap) {
      // The old folder is parked beside the new one, then removed: if the move fails it goes back, and the skill is never missing.
      parked = join(dest, '.kb-old-' + basename(staging).slice('.kb-team-'.length))
      renameSync(target, parked)
      try { renameSync(staging, target) } catch (e) { renameSync(parked, target); parked = null; throw e }
      staging = null
      try { rmSync(parked, { recursive: true, force: true }) } catch (e) { /* a leftover dot folder is invisible; the swap itself is done */ }
    } else {
      if (existsSync(target)) { rmSync(staging, { recursive: true, force: true }); return { ok: false, error: 'exists' } }
      renameSync(staging, target)
      staging = null
    }
  } catch (e) {
    if (staging !== null) { try { rmSync(staging, { recursive: true, force: true }) } catch (e2) { /* best effort */ } }
    return { ok: false, error: 'write_failed' }
  }
  invalidateSkills(ctx, sessionId)
  return {
    ok: true,
    replaced: swap,
    files: files.length,
    skill: skillEntryOf(dest, cfg, { folder: target, activeFile: join(target, MARKER_ACTIVE), disabledFile: join(target, MARKER_DISABLED), hasActive: true })
  }
}

// ── CREATION: the file is the only source, so we write a valid SKILL.md and nothing else ──────────────
// Every text value is emitted as a double-quoted YAML scalar, with the proper escapes:
// a description containing ":" or a quote must not be able to break the frontmatter.
const yamlQuoted = (v) => '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n') + '"'

const createSkill = async ({ ctx, root, name, description, whenToUse, body, modelInvocable, config, sessionId }) => {
  const cfg = normalizeConfig(config)
  const wRoots = writableRootsOf(cfg)
  const dest = typeof root === 'string' && root !== '' ? root : join(cfg.dsh, 'skills')
  if (wRoots.includes(dest) === false) return { ok: false, error: 'root_not_allowed' }
  if (typeof name !== 'string' || !SKILL_NAME_RE.test(name)) return { ok: false, error: 'invalid_name' }
  if (typeof description !== 'string' || description.trim() === '') return { ok: false, error: 'description_required' }
  if (description.trim().length > 1024) return { ok: false, error: 'description_too_long', max: 1024 }
  const target = join(dest, name)
  if (existsSync(target)) return { ok: false, error: 'exists' }

  const lines = ['---', 'name: ' + name, 'description: ' + yamlQuoted(description.trim())]
  if (typeof whenToUse === 'string' && whenToUse.trim() !== '') lines.push('whenToUse: ' + yamlQuoted(whenToUse.trim()))
  // A skill created for the library does not need to be announced to the model: it stays invocable by
  // the human via "/", but costs no tokens as long as it is not loaded.
  if (modelInvocable === false) lines.push('disable-model-invocation: true')
  lines.push('---', '', typeof body === 'string' && body.trim() !== '' ? body.trim() : '# ' + name, '')
  const content = lines.join('\n')

  try {
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, MARKER_ACTIVE), content)
  } catch (e) {
    try { rmdirSync(target) } catch (e2) { /* rollback: we only remove the empty folder just created, never a skill */ }
    return { ok: false, error: 'write_failed', dest }
  }
  invalidateSkills(ctx, sessionId)
  return {
    ok: true,
    skill: skillEntryOf(dest, cfg, { folder: target, activeFile: join(target, MARKER_ACTIVE), disabledFile: join(target, MARKER_DISABLED), hasActive: true })
  }
}

// ── mounting the routes (mirror of :2728-2729 and :2873-2874, base daed42e) ──────────────────────────────────────
const mountWebRoutes = (ctx, webServerSvc) => {
  const GET = (path, label, fn) => ctx.effect(() => webServerSvc.register({ kind: 'exact', path, handler: async (req, res) => {
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'get_required' })
    try { sendJson(res, 200, await fn(req)) } catch (e) { sendJson(res, 200, { ok: false, error: 'request_failed' }) }
  } }), label)

  // Guards verbatim and in this order: method first, origin second. No POST route
  // touches the disk before both.
  // `cap` is the body limit in bytes (default 64 KiB): Team skill routes carry up to a megabyte of files.
  const POST = (path, label, fn, cap) => ctx.effect(() => webServerSvc.register({ kind: 'exact', path, handler: async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'post_required' })
    if (sameOrigin(req) === false) return sendJson(res, 403, { ok: false, error: 'origin_refused' })
    try { sendJson(res, 200, await fn(await readJsonBody(req, cap))) } catch (e) { sendJson(res, 200, { ok: false, error: e !== null && e !== undefined && e.message === 'body_too_large' ? 'body_too_large' : 'request_failed' }) }
  } }), label)

  GET('/kybernos-skills/skills', 'kybernos-skills: route skills', async (req) => {
    // `sessionId` designates the DISPLAYED session: it is what fixes the project (hence the project skills
    // visible). Without it we fall back to the original behavior.
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
    // Diagnostic of the VIEW. On 20 Sep, an empty catalogue on screen while the session announced
    // seven skills could not be diagnosed anywhere: `scope` says here, in one line, whether the scope was
    // found and which instance answers. Without it a restart was needed to find out.
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
    if (root === '') return { ok: false, error: 'root_missing' }
    return await toggleSkill({ ctx, root, name, active: body.active, config: configOf(), sessionId: body.sessionId }) // semantic refusals as HTTP 200 { ok:false, error } (precedent :2100/:2169/:2182/:2207)
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

  // ── Team skills (see docs/dev/team-skills-contract.md): the page asks here for the disk half, kybernos-cloud for the server half ──
  POST('/kybernos-skills/team/pack', 'kybernos-skills: route team pack', async (body) => packSkill({
    root: body.root,
    name: body.name,
    config: configOf()
  }))

  POST('/kybernos-skills/team/install', 'kybernos-skills: route team install', async (body) => installTeamSkill({
    ctx,
    root: body.root,
    name: body.name,
    version: body.version,
    files: body.files,
    teamId: body.teamId,
    replace: body.replace === true,
    config: configOf(),
    sessionId: body.sessionId
  }), 4 * 1024 * 1024)

  // ── Featured: the highlighted list, controlled by the user ──────────────────────────
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

  // Star of the detail page / of the cards: {name, action?:'toggle'|'add'|'remove', why?}. Only a skill
  // PRESENT in the registry can be featured — we do not feature a ghost.
  // ⚠️ The webServer's exact table is keyed by PATH alone (not by method): GET and POST on
  // the same path throw "duplicate exact route" AT MOUNT (measured that day). Hence the suffix.
  POST('/kybernos-skills/featured/toggle', 'kybernos-skills: route featured toggle', async (body) => {
    const cfg = configOf()
    const name = typeof body.name === 'string' ? body.name : ''
    if (SKILL_NAME_RE.test(name) === false) return { ok: false, error: 'invalid_name' }
    const catalogue = await catalogueOf(ctx, cfg, body.sessionId)
    if (catalogue.skills.some((s) => s.name === name) === false) return { ok: false, error: 'skill_not_in_registry' }
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

  // Covers are BINARY FILES: not sendJson. Prefix route (the name follows the
  // last '/'); the name is validated by the regex before any disk access.
  ctx.effect(() => webServerSvc.register({ kind: 'prefix', path: '/kybernos-skills/cover', handler: async (req, res) => {
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'get_required' })
    const pathname = new URL(req.url ?? '/', 'http://x').pathname
    const name = decodeURIComponent(pathname.slice('/kybernos-skills/cover/'.length))
    const file = SKILL_NAME_RE.test(name) ? coverFileOf(configOf(), name) : null
    if (file === null) return sendJson(res, 404, { ok: false, error: 'no_cover' })
    try {
      const ext = file.slice(file.lastIndexOf('.') + 1)
      res.writeHead(200, { 'content-type': COVER_TYPES[ext] ?? 'application/octet-stream', 'cache-control': 'private, max-age=120' })
      res.end(readFileSync(file))
    } catch (e) { sendJson(res, 500, { ok: false, error: 'cover_unreadable' }) }
  } }), 'kybernos-skills: route cover')

  console.log('[kybernos-skills] routes /kybernos-skills/* enregistrees (catalogue, bascule, creation, installation, index officiel, featured)')
}

// ── named exports for the harness (testability: explicit paths, nothing wired) + apply ────────────────
export { dshHome, catalogueOf, toggleSkill, createSkill, installSkill, indexSkills, searchSkills, curatedSkills, auditSkill, packSkill, installTeamSkill, resetDiscoverCache, configOf, journalPath, resolveInRoot, writableRootFor, layoutOf, SOURCE_RANK, sameOrigin }

export function apply(ctx) {
  // Safety net mirroring kybernos-plugin/index.js:2876-2884 (base): a mount error must not
  // cut off the GUI — only the routes drop, the error is logged for fixing.
  try {
    // `skills` is now a HARD DEPENDENCY: without DSH's registry there is no
    // catalogue. `inject` defers the mount until both services are there.
    ctx.inject(['webServer', 'skills'], (hostCtx) => {
      try {
        mountWebRoutes(hostCtx, hostCtx.get('webServer'))
      } catch (e) {
        try { console.error('[kybernos-skills] mounting the routes failed', e) } catch (e2) { /* */ }
      }
    })
  } catch (ksBootError) {
    try {
      console.error('[kybernos-skills] start-up failed — the /kybernos-skills/* routes are not mounted', ksBootError)
    } catch (e2) { /* console unavailable */ }
  }
}
