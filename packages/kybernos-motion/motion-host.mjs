// Motion host logic: scene files, revisions, previews. No `ctx`, no DSH import: every effect is injected,
// so the whole thing runs in a test against a temp folder.
//
// A scene lives in the project as `<name>.miniapp.json`, the shared livrable format (see the Livrables page):
//
//   { "kind": "motion", "renderer": "motion", "title": "...",
//     "meta": { "rev": 7, "history": [ { "r": 7, "by": "agent", "at": "...", "what": "..." } ] },
//     "data": [ <scene> ] }
//
// Files only ever go where the core plugin says a session may work (session folder, kyber roots, declared
// workspaces): `workspace.pathAllowed` is the core's own resolve-then-compare check, and `workspace.sessionCwd`
// finds the session's folder. Without the core (or when the folder is unknown) scenes go to
// `<dsh home>/kybernos/motion/files`, which still works but does not show in Livrables.
import { createHash } from 'node:crypto'
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from 'node:path'
import * as engine from './engine.mjs'

export const EXT = '.miniapp.json'
export const KIND = 'motion'
export const LIMITS = {
  doc: 2_000_000, // bytes of a scene file we will read or write
  history: 30, // history lines kept inside the file
  revisions: 20, // snapshots kept on disk, per scene
  png: 8_000_000,
  asset: 25_000_000,
  export: 400_000_000,
  name: 60,
}
export const ASSET_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.flac': 'audio/flac', '.aac': 'audio/aac',
}

export const slug = (s, fallback = 'animation') => {
  const out = String(s ?? '').toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, LIMITS.name)
  return out === '' ? fallback : out
}

const hashOf = (s) => createHash('sha1').update(String(s)).digest('hex').slice(0, 16)

/** The document a scene file holds, around a validated scene (without the `_n` marker). */
export function makeDoc (scene, { title, meta } = {}) {
  const clean = engine.compact(scene)
  return {
    kind: KIND,
    renderer: KIND,
    title: typeof title === 'string' && title.trim() !== '' ? title.trim().slice(0, 120) : 'Animation',
    meta: meta || { rev: 0, history: [] },
    data: [clean],
  }
}

/** The scene inside a parsed file (accepts the `payload` wrapper the shared contract allows). */
export function sceneOfDoc (doc) {
  if (doc === null || typeof doc !== 'object') return null
  const first = Array.isArray(doc.data) ? doc.data[0] : null
  if (first === null || first === undefined || typeof first !== 'object') return null
  return first.payload !== null && typeof first.payload === 'object' ? first.payload : first
}

export function createHost ({ fs, home, workspace, now = () => Date.now(), log = () => {}, frameTimeoutMs = 10000 }) {
  const root = join(home, 'kybernos', 'motion')
  const historyDir = (path) => join(root, 'history', hashOf(path))

  // ── where files may live ─────────────────────────────────────────────────
  async function exists (p) { try { await fs.stat(p); return true } catch { return false } }

  async function fallbackDir () {
    const d = join(root, 'files')
    await fs.mkdir(d, { recursive: true })
    return d
  }

  /** Session folder, or null. */
  async function sessionDir (sessionId) {
    if (!workspace || typeof workspace.sessionCwd !== 'function' || typeof sessionId !== 'string') return null
    try {
      const d = await workspace.sessionCwd(sessionId)
      return typeof d === 'string' && d !== '' && (await exists(d)) ? d : null
    } catch { return null }
  }

  /**
   * Is `dir` a folder this session may write to? Returns the real folder or null.
   * The fallback store is always allowed; anything else goes through the core's check.
   */
  async function allowedDir (dir, sessionId) {
    let real
    try { real = await fs.realpath(dir) } catch { return null }
    let fb = null
    try { fb = await fs.realpath(join(root, 'files')) } catch { /* not created yet */ }
    if (fb !== null && (real === fb || real.startsWith(fb + sep))) return real
    if (!workspace || typeof workspace.pathAllowed !== 'function') return null
    try { return (await workspace.pathAllowed(real, { strict: true, sessionId })) === true ? real : null } catch { return null }
  }

  /**
   * Resolve a scene path given by an agent (a name, a relative path, or an absolute path).
   * Names and relative paths land in `<session folder>/artifacts/`; the file must end in .miniapp.json
   * and its folder must be allowed. Returns { ok, path } or { ok:false, message }.
   */
  async function resolveTarget ({ sessionId, fichier, titre }) {
    let name = typeof fichier === 'string' && fichier.trim() !== '' ? fichier.trim() : slug(titre)
    let abs
    if (isAbsolute(name)) abs = resolve(name)
    else {
      if (name.split(/[\\/]/).includes('..')) return { ok: false, message: 'The file path may not contain "..".' }
      const base = await sessionDir(sessionId)
      const dir = base !== null ? join(base, 'artifacts') : await fallbackDir()
      abs = resolve(dir, name)
      if (!abs.startsWith(dir + sep)) return { ok: false, message: 'The file must stay inside the session folder.' }
    }
    if (!abs.endsWith(EXT)) abs = abs.replace(/\.json$/i, '').replace(/\.miniapp$/i, '') + EXT
    const leaf = basename(abs)
    if (leaf.length > 120 || leaf === EXT) return { ok: false, message: 'Invalid file name.' }
    const dir = dirname(abs)
    try { await fs.mkdir(dir, { recursive: true }) } catch (e) { return { ok: false, message: `Cannot create the folder: ${e && e.message}` } }
    const real = await allowedDir(dir, sessionId)
    if (real === null) return { ok: false, message: 'That folder is outside what this session may write to.' }
    return { ok: true, path: join(real, leaf) }
  }

  /** Same check for a file that already exists (the panel, Livrables). */
  async function confineExisting (path, sessionId) {
    if (typeof path !== 'string' || !isAbsolute(path) || !path.endsWith(EXT)) return { ok: false, message: 'Not a scene file.' }
    const real = await allowedDir(dirname(path), sessionId)
    if (real === null) return { ok: false, message: 'That folder is outside what this session may read.' }
    return { ok: true, path: join(real, basename(path)) }
  }

  // ── reading and writing ──────────────────────────────────────────────────
  async function readDoc (path) {
    let text
    try {
      const st = await fs.stat(path)
      if (st.size > LIMITS.doc) return { ok: false, message: 'The scene file is too large.' }
      text = await fs.readFile(path, 'utf8')
    } catch (e) { return { ok: false, message: 'The scene file cannot be read.' } }
    let doc
    try { doc = JSON.parse(text) } catch { return { ok: false, message: 'The scene file is not valid JSON.' } }
    if (doc === null || typeof doc !== 'object' || doc.kind !== KIND) return { ok: false, message: 'This file is not a motion scene (kind must be "motion").' }
    const raw = sceneOfDoc(doc)
    if (raw === null) return { ok: false, message: 'The scene file has no scene in data[0].' }
    const v = engine.validate(raw)
    return { ok: true, doc, scene: v.scene, errors: v.errors }
  }

  async function writeAtomic (path, text) {
    const tmp = `${path}.${process.pid}.${now()}.tmp`
    try {
      await fs.writeFile(tmp, text, 'utf8')
      await fs.rename(tmp, path)
    } catch (e) {
      try { await fs.rm(tmp, { force: true }) } catch { /* nothing to clean */ }
      throw e
    }
  }

  async function snapshot (path, doc) {
    try {
      const dir = historyDir(path)
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(join(dir, `${String(doc.meta.rev).padStart(6, '0')}.json`), JSON.stringify(doc), 'utf8')
      const files = (await fs.readdir(dir)).filter((f) => /^\d{6}\.json$/.test(f)).sort()
      for (const f of files.slice(0, Math.max(0, files.length - LIMITS.revisions))) await fs.rm(join(dir, f), { force: true })
    } catch (e) { log(`history not kept: ${e && e.message}`) }
  }

  /**
   * Write a scene. `by` is 'agent' or 'user', `what` a short human line. A scene that fails validation badly
   * (nothing usable) is refused; one that merely lost some properties is written clean and the problems returned.
   */
  async function saveScene ({ path, rawScene, by, what, title }) {
    const v = engine.validate(rawScene)
    if (!v.ok && v.scene.layers.length === 0 && rawScene && typeof rawScene === 'object' && Array.isArray(rawScene.layers) && rawScene.layers.length > 0) {
      return { ok: false, message: 'No layer of this scene is valid.', errors: v.errors }
    }
    let meta = { rev: 0, history: [] }
    let docTitle = title
    const prev = (await exists(path)) ? await readDoc(path) : null
    if (prev !== null && prev.ok) {
      meta = { rev: Number(prev.doc.meta && prev.doc.meta.rev) || 0, history: Array.isArray(prev.doc.meta && prev.doc.meta.history) ? prev.doc.meta.history : [] }
      if (docTitle === undefined) docTitle = prev.doc.title
    }
    meta.rev += 1
    meta.history = meta.history.concat([{ r: meta.rev, by: by === 'user' ? 'user' : 'agent', at: new Date(now()).toISOString(), what: String(what || '').slice(0, 160) }]).slice(-LIMITS.history)
    const doc = makeDoc(v.scene, { title: docTitle, meta })
    const text = JSON.stringify(doc, null, 2)
    if (text.length > LIMITS.doc) return { ok: false, message: 'The scene is too large to save.' }
    await writeAtomic(path, text)
    await snapshot(path, doc)
    return { ok: true, rev: meta.rev, title: doc.title, errors: v.errors, scene: v.scene }
  }

  async function revisions (path) {
    try {
      const dir = historyDir(path)
      const files = (await fs.readdir(dir)).filter((f) => /^\d{6}\.json$/.test(f)).sort().reverse()
      const out = []
      for (const f of files) {
        try {
          const d = JSON.parse(await fs.readFile(join(dir, f), 'utf8'))
          const h = (d.meta.history || []).find((e) => e.r === d.meta.rev) || {}
          out.push({ r: d.meta.rev, by: h.by || 'agent', at: h.at || null, what: h.what || '' })
        } catch { /* skip a damaged snapshot */ }
      }
      return out
    } catch { return [] }
  }

  async function restore (path, rev) {
    const f = join(historyDir(path), `${String(Number(rev) | 0).padStart(6, '0')}.json`)
    let snap
    try { snap = JSON.parse(await fs.readFile(f, 'utf8')) } catch { return { ok: false, message: 'That revision is no longer available.' } }
    const raw = sceneOfDoc(snap)
    if (raw === null) return { ok: false, message: 'That revision is damaged.' }
    return saveScene({ path, rawScene: raw, by: 'user', what: `Restored r${rev}`, title: snap.title })
  }

  /** The motion scenes of a session's artifacts/ folder (two levels deep), newest first: what the panel offers to open. */
  async function listScenes (sessionId) {
    const dirs = []
    const base = await sessionDir(sessionId)
    if (base !== null) dirs.push(join(base, 'artifacts'))
    dirs.push(join(root, 'files'))
    const found = []
    const walk = async (dir, depth) => {
      let entries
      try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        const full = join(dir, e.name)
        if (e.isDirectory() && depth < 2 && !e.name.startsWith('.')) await walk(full, depth + 1)
        else if (e.isFile() && e.name.endsWith(EXT)) {
          try {
            const st = await fs.stat(full)
            if (st.size > LIMITS.doc) continue
            const doc = JSON.parse(await fs.readFile(full, 'utf8'))
            if (doc && doc.kind === KIND) found.push({ path: full, title: String(doc.title || e.name).slice(0, 120), rev: Number(doc.meta && doc.meta.rev) || 0, mtimeMs: st.mtimeMs })
          } catch { /* not a readable scene: skip */ }
        }
      }
    }
    for (const d of dirs) await walk(d, 0)
    return found.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 40)
  }

  // ── assets next to a scene (images, sounds) ──────────────────────────────
  /** Resolve `src` (relative to the scene's folder, or under its folder tree) to a readable asset. */
  async function resolveAsset (scenePath, src, sessionId) {
    if (typeof src !== 'string' || src === '' || src.includes('\0')) return { ok: false, message: 'Invalid asset path.' }
    const ext = extname(src).toLowerCase()
    if (!Object.prototype.hasOwnProperty.call(ASSET_TYPES, ext)) return { ok: false, message: `Files of type ${ext || '(none)'} are not served.` }
    const sc = await confineExisting(scenePath, sessionId)
    if (!sc.ok) return sc
    const abs = isAbsolute(src) ? resolve(src) : resolve(dirname(sc.path), src)
    let real
    try { real = await fs.realpath(abs) } catch { return { ok: false, message: 'That file does not exist.' } }
    const dirReal = await allowedDir(dirname(real), sessionId)
    if (dirReal === null) return { ok: false, message: 'That file is outside what this session may read.' }
    const st = await fs.stat(real)
    if (!st.isFile() || st.size > LIMITS.asset) return { ok: false, message: 'That file is not usable (not a file, or over 25 MB).' }
    return { ok: true, path: real, type: ASSET_TYPES[ext], size: st.size }
  }

  // ── what the user changed since the agent last wrote ─────────────────────
  function userEditsSince (doc) {
    const h = Array.isArray(doc.meta && doc.meta.history) ? doc.meta.history : []
    let lastAgent = 0
    for (const e of h) if (e.by === 'agent') lastAgent = Math.max(lastAgent, e.r)
    return h.filter((e) => e.by === 'user' && e.r > lastAgent).map((e) => ({ r: e.r, at: e.at, what: e.what }))
  }

  // ── per-session state: which scene the panel shows ───────────────────────
  const current = new Map() // sessionId -> { path, title, at }
  const frameWanted = new Map() // sessionId -> { id, t, resolve, timer }
  let lastSession = null
  function setCurrent (sessionId, path, title) {
    current.set(sessionId, { path, title, at: now() })
    lastSession = sessionId
  }
  /** The scene a session is working on. `strict` (the agent's own tool) never borrows another session's scene; the panel may. */
  function getCurrent (sessionId, strict) {
    if (typeof sessionId === 'string' && current.has(sessionId)) return current.get(sessionId)
    if (strict === true) return null
    return lastSession !== null ? current.get(lastSession) || null : null
  }

  /** The agent asks the open panel to render frame t and hand the PNG back. Resolves { ok, path } or { ok:false }. */
  function wantFrame (sessionId, t, timeoutMs = 10000) {
    return new Promise((done) => {
      const id = `${now()}-${Math.random().toString(36).slice(2, 8)}`
      const timer = setTimeout(() => { frameWanted.delete(sessionId); done({ ok: false, message: 'The Motion panel did not answer. Open it (right sidebar) and try again.' }) }, timeoutMs)
      frameWanted.set(sessionId, { id, t, resolve: done, timer })
    })
  }
  function pendingFrame (sessionId) {
    const w = frameWanted.get(sessionId) || (lastSession !== null ? frameWanted.get(lastSession) : null)
    return w ? { id: w.id, t: w.t } : null
  }
  async function deliverFrame (sessionId, id, bytes) {
    const key = frameWanted.has(sessionId) ? sessionId : lastSession
    const w = key !== null && key !== undefined ? frameWanted.get(key) : null
    if (!w || w.id !== id) return { ok: false, message: 'Nobody is waiting for that frame.' }
    if (!(bytes instanceof Uint8Array) || bytes.length < 8 || bytes.length > LIMITS.png) return { ok: false, message: 'Invalid image.' }
    if (!(bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)) return { ok: false, message: 'The image must be a PNG.' }
    const dir = join(root, 'preview')
    await fs.mkdir(dir, { recursive: true })
    const path = join(dir, `frame-${hashOf(key)}.png`)
    const tmp = `${path}.${now()}.tmp`
    await fs.writeFile(tmp, bytes)
    await fs.rename(tmp, path)
    clearTimeout(w.timer)
    frameWanted.delete(key)
    w.resolve({ ok: true, path, t: w.t })
    return { ok: true }
  }

  return { root, frameTimeoutMs, listScenes, resolveTarget, confineExisting, readDoc, saveScene, revisions, restore, resolveAsset, userEditsSince, setCurrent, getCurrent, wantFrame, pendingFrame, deliverFrame, sessionDir, allowedDir }
}

// ── the agent's tool ──────────────────────────────────────────────────────────

export const TOOL = 'creer_motion'

export function toolOptions (host) {
  return {
    name: TOOL,
    description:
      'Creates or edits a motion-design animation (titles, shapes, charts, counters, particles, shape morphs, sound) '
      + 'as a .miniapp.json file in the project\'s artifacts/ folder. It shows in the Livrables page and in the "Motion" panel '
      + '(right sidebar), where the user can play it, change its settings and export it to MP4. '
      + 'Call with `scene` to write it; call with only `params` to change a few of its settings; call with neither to READ it back '
      + 'together with what the user changed since your last write. The result lists problems found in the scene '
      + '(text cut off, overlapping, unreadable, on screen too briefly): fix them and call again. '
      + 'Use `voir` to get a PNG of one instant that you can read with your file-reading tool.\n'
      + 'A scene is {format:{width,height,fps,duration}, background, params:{name:value}, controls:[{id,label,type,options?}], layers:[...], audio:[...]}. '
      + 'Any property can be a number, a $param, or keyframes {k:[[time_s, value, ease?],...]} (ease: ' + engine.EASE_NAMES.join(', ') + ' or [x1,y1,x2,y2]). '
      + 'A layer without x,y sits at the centre of the frame; coordinates are in frame pixels, origin top-left. '
      + 'Text can use {param} placeholders. Colours are #rgb, #rrggbb or #rrggbbaa. '
      + 'audio: [{synth:"' + engine.AUDIO_SYNTH.join('"|"') + '", at, volume, pitch}] or [{src:"file in the project", at, volume, loop, fadeIn, fadeOut}].\n'
      + 'Components (layers[].type):\n' + engine.describeComponents(),
    parameters: {
      fichier: { type: 'string', description: 'File name (without folder) or path. Default: derived from the title. Created in <project>/artifacts/.' },
      titre: { type: 'string', description: 'Title shown in the Livrables page and the panel.' },
      scene: { type: 'object', additionalProperties: true, description: 'The whole scene to write (see above). Omit to read, or to patch with `params`.' },
      params: { type: 'object', additionalProperties: true, description: 'Change only these params of the existing scene (e.g. {"titre":"New title","accent":"#ff0000"}).' },
      voir: { type: 'number', description: 'Render the instant t (seconds) as a PNG and return its path, to look at the result. Needs the Motion panel open.' },
      note: { type: 'string', description: 'One line saying what changed (kept in the scene history).' },
    },
    render: (_args, valeur) => [{ type: 'text', text: typeof valeur === 'string' ? valeur : JSON.stringify(valeur, null, 2) }],
    execute: async (brut, exec) => {
      const a = brut && typeof brut === 'object' ? brut : {}
      const sessionId = exec && exec.agent && typeof exec.agent.id === 'string' ? exec.agent.id : null
      if (sessionId === null) return { ok: false, message: 'Cannot identify the current session.' }
      return runTool(host, sessionId, a)
    },
  }
}

const brief = (insp) => ({
  size: insp.size,
  duration: insp.duration,
  warnings: insp.warnings.slice(0, 12),
  more: Math.max(0, insp.warnings.length - 12),
})

export async function runTool (host, sessionId, a) {
  // find the file: given, else the session's current one
  let path = null
  if (typeof a.fichier === 'string' && a.fichier.trim() !== '') {
    const t = await host.resolveTarget({ sessionId, fichier: a.fichier, titre: a.titre })
    if (!t.ok) return { ok: false, message: t.message }
    path = t.path
  } else if (a.scene === undefined) {
    const cur = host.getCurrent(sessionId, true)
    if (cur) path = cur.path
  }
  const writing = a.scene !== undefined && a.scene !== null
  if (path === null) {
    if (!writing) return { ok: true, empty: true, message: 'No animation yet for this session: write one with `scene`.' }
    const t = await host.resolveTarget({ sessionId, fichier: null, titre: a.titre })
    if (!t.ok) return { ok: false, message: t.message }
    path = t.path
  }

  // read (and optional preview) only
  if (!writing && (a.params === undefined || a.params === null)) {
    const r = await host.readDoc(path)
    if (!r.ok) return { ok: false, message: r.message }
    host.setCurrent(sessionId, path, r.doc.title)
    const out = {
      ok: true, read: true, chemin: path, titre: r.doc.title, rev: r.doc.meta.rev,
      changes_by_user: host.userEditsSince(r.doc), scene: stripRuntime(r.scene), inspect: brief(engine.inspect(r.scene)),
    }
    if (typeof a.voir === 'number') out.voir = await previewFrame(host, sessionId, a.voir)
    return out
  }

  // patch params
  let rawScene = a.scene
  let what = typeof a.note === 'string' ? a.note : ''
  if (!writing) {
    const r = await host.readDoc(path)
    if (!r.ok) return { ok: false, message: r.message }
    if (a.params === null || typeof a.params !== 'object' || Array.isArray(a.params)) return { ok: false, message: '`params` must be an object.' }
    const next = stripRuntime(r.scene)
    next.params = { ...next.params, ...a.params }
    rawScene = next
    if (what === '') what = 'Params: ' + Object.keys(a.params).slice(0, 6).join(', ')
  } else if (what === '') what = (await exists2(host, path)) ? 'Scene rewritten' : 'Created'
  const saved = await host.saveScene({ path, rawScene, by: 'agent', what, title: a.titre })
  if (!saved.ok) return { ok: false, message: saved.message, errors: saved.errors }
  host.setCurrent(sessionId, path, saved.title)
  const insp = engine.inspect(saved.scene)
  const out = {
    ok: true, chemin: path, titre: saved.title, rev: saved.rev,
    dropped: saved.errors.slice(0, 15), inspect: brief(insp),
    message: `Saved r${saved.rev}. The user sees it in the Motion panel and in Livrables.`
      + (saved.errors.length ? ` ${saved.errors.length} thing(s) were ignored (see dropped).` : '')
      + (insp.warnings.length ? ` ${insp.warnings.length} readability warning(s): fix and call again.` : ' No readability warning.'),
  }
  if (typeof a.voir === 'number') out.voir = await previewFrame(host, sessionId, a.voir)
  return out
}

async function exists2 (host, path) {
  const r = await host.readDoc(path)
  return r.ok
}

const stripRuntime = (scene) => { const { _n, ...rest } = scene; return rest }

async function previewFrame (host, sessionId, t) {
  const r = await host.wantFrame(sessionId, Math.max(0, t), host.frameTimeoutMs)
  return r.ok ? { path: r.path, t: r.t, hint: 'Read this PNG with your file-reading tool to see the frame.' } : { error: r.message }
}
