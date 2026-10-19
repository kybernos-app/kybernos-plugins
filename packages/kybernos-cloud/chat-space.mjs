// kybernos-cloud — which team a chat belongs to, and which replies are running (teams plan, « the active team follows the chat »). Pure: the disk and the clock are injected,
// so test-chat-space.mjs plays it without DSH.
//
// DSH has ONE model route per instance and its `x-kybernos-workspace` header names the ACTIVE team, so whoever is billed is whoever is active. The rule this file serves:
//   · a chat in a team's folder bills that team; every other chat bills Personal (`spaceOfFolder`);
//   · the active team therefore follows the chat the person is looking at (`createSightings` says which chats those are), and it is never changed while a reply is running
//     (`createTurnWatch`), because the reply's second request would carry the new team's header (one answer billed to two teams).
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** Lower-cases on the platforms whose file systems ignore case (macOS and Windows by default): `Acme` and `acme` are one folder there. A case-sensitive volume on those systems
 *  would see two, and the worst that costs is a chat of `acme` billed to the team of `Acme`: the team folders are made by this plugin, nobody keeps a twin beside them. */
const fold = (platform, p) => (platform === 'darwin' || platform === 'win32' ? p.toLowerCase() : p)

/** The form of a path two paths are compared in: absolute, `.` and `..` gone, symbolic links followed, and (macOS, Windows) case folded. A folder that does not exist (deleted since,
 *  or a disk that is not mounted) is resolved from its deepest existing ancestor, so a link above it is still followed. `deps`: `{ platform, realpath }` (`realpath` throws when the
 *  path does not exist). null for anything that is not an absolute path. Never throws. */
export function canonicalPath (path, deps) {
  if (typeof path !== 'string' || path === '' || path.includes('\0') || !isAbsolute(path)) return null
  const lexical = resolve(path)
  let current = lexical
  let rest = ''
  for (let depth = 0; depth < 128; depth += 1) {
    try {
      const real = deps.realpath(current)
      if (typeof real !== 'string' || real === '') break
      return fold(deps.platform, rest === '' ? real : join(real, rest))
    } catch (e) {
      const parent = dirname(current)
      if (parent === current) break
      rest = rest === '' ? basename(current) : join(basename(current), rest)
      current = parent
    }
  }
  return fold(deps.platform, lexical)
}

/** Is `path` the folder `root` or somewhere under it? By whole path segments: `Acme-2` is not inside `Acme`. Both are canonical. */
export function isInside (root, path) {
  const rel = relative(root, path)
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel))
}

/** Which space owns a chat that works in `cwd`: the team whose recorded folder holds it (the folder itself or anywhere below), else Personal. `teams` is `[{ id, folder }]` (the teams
 *  the person is in NOW that have a recorded folder), `personalId` the id of their personal space. `{ kind: 'team' | 'personal' | 'unknown', id }`: `unknown` (no usable folder) names no
 *  space, so nothing follows it. */
export function spaceOfFolder ({ cwd, teams, personalId, platform, realpath }) {
  const deps = { platform, realpath }
  const here = canonicalPath(cwd, deps)
  if (here === null) return { kind: 'unknown', id: null }
  let best = null
  for (const team of Array.isArray(teams) ? teams : []) {
    if (team === null || typeof team !== 'object' || typeof team.id !== 'string' || team.id === '') continue
    const root = canonicalPath(team.folder, deps)
    // A team folder is never the root of the disk: a record that resolves there would claim every chat.
    if (root === null || root === dirname(root) || isInside(root, here) !== true) continue
    if (best === null || root.length > best.root.length) best = { id: team.id, root }
  }
  if (best !== null) return { kind: 'team', id: best.id }
  return { kind: 'personal', id: typeof personalId === 'string' && personalId !== '' ? personalId : null }
}

/** A reply that has been running longer than this no longer blocks a switch. Fail-open on purpose: the cost of a reply wrongly counted as running forever is a person who cannot
 *  change team (they could always stop the reply, but may not know to); the cost of letting go after the bound is one very long reply billed to two teams, which is exactly what
 *  happened before this guard existed. Thirty minutes is longer than an ordinary reply, including its tools, and shorter than anything worth waiting for. */
export const TURN_MAX_AGE_MS = 30 * 60 * 1000

/** The replies in flight. The engine's own registry is the truth (`live()` lists the agents whose status is `running`) and the events only add WHEN and in WHICH team a reply started,
 *  so a missed `idle` event cannot leave a reply stuck as running (the registry says it is not) and a missed start is picked up at the next look. Without a registry (`live()` gives
 *  null) the events and the age bound are all there is. A restart empties it, which is right: the engine starts idle. `now`: a clock (tests). */
export function createTurnWatch ({ now = Date.now, maxAgeMs = TURN_MAX_AGE_MS, live = () => null } = {}) {
  const turns = new Map()
  const MAX_TRACKED = 256
  return {
    /** A reply started in the chat `id`, billed to the space `space` (the one active now). The first start wins: a repeated one does not restart the clock. */
    start (id, space) {
      if (typeof id !== 'string' || id === '' || turns.has(id)) return
      if (turns.size >= MAX_TRACKED) turns.delete(turns.keys().next().value)
      turns.set(id, { since: now(), space: typeof space === 'string' && space !== '' ? space : null })
    },
    /** The chat `id` was switched to `space` by its own claim, after its reply was counted as started: that is the team the reply is billed to. */
    setSpace (id, space) {
      const entry = turns.get(id)
      if (entry !== undefined && typeof space === 'string' && space !== '') entry.space = space
    },
    /** The reply of the chat `id` ended (or the chat is gone). */
    end (id) { turns.delete(id) },
    /** The replies that block a switch now, oldest first: `[{ id, since, space }]`, leaving out the chat `except` (the one whose own first request is waiting on the switch). */
    running ({ except } = {}) {
      const t = now()
      let alive = null
      try { alive = live() } catch (e) { alive = null }
      if (Array.isArray(alive)) {
        const ids = new Set(alive)
        for (const id of Array.from(turns.keys())) if (ids.has(id) !== true) turns.delete(id)
        for (const id of ids) if (typeof id === 'string' && turns.has(id) !== true) turns.set(id, { since: t, space: null })
      }
      const out = []
      for (const [id, entry] of Array.from(turns)) {
        if (t - entry.since > maxAgeMs) {
          // Past the bound it no longer blocks. With no registry to confirm it, it is forgotten; with one, it is kept (its age keeps counting from the first sighting).
          if (Array.isArray(alive) !== true) turns.delete(id)
          continue
        }
        if (id !== except) out.push({ id, since: entry.since, space: entry.space })
      }
      return out.sort((a, b) => a.since - b.since)
    },
  }
}

/** The chats the person has looked at lately, reported by the page. A chat the host never heard of from the page (an automation, Kaby's, a Telegram turn, a subagent) is not one
 *  the person is looking at, so its turns never change the active team. `ttlMs` is how long a sighting counts; the page repeats it every ten seconds while it is open. */
export function createSightings ({ now = Date.now, ttlMs = 2 * 60 * 1000, max = 16 } = {}) {
  const seen = new Map()
  return {
    see (id) {
      if (typeof id !== 'string' || id === '') return
      seen.delete(id)
      if (seen.size >= max) seen.delete(seen.keys().next().value)
      seen.set(id, now())
    },
    /** Looked at within the last `ttlMs`? */
    isFresh (id) {
      const at = seen.get(id)
      return at !== undefined && now() - at <= ttlMs
    },
  }
}
