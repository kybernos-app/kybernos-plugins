// kybernos-cloud — one working folder per team (plan « Équipes », step 6). Pure: every I/O (disk, platform) is injected, so test-team-folder.mjs plays it without DSH.
//
// A session's working folder is fixed when the session starts, so a team switch cannot move a chat that is open; it can open a NEW chat in the team's folder (client.js, the
// `team-folder` block). This file is the host half: it names and creates <Documents>/Kybernos/<Team> for a team and says where. The name is what the SERVER holds for the team
// (other people wrote it: a team lead, an invited colleague), so it is never a path: it is cut down to one safe segment here, and the folder is made as a direct child of a root
// this file computes itself. The « where is Documents » rule is kybernos-multi-device's (a bundle cannot import another one: scripts/test-team-folder-rule.mjs keeps the two equal).
import { isAbsolute, join, relative, sep } from 'node:path'

export const FOLDER_NAME_MAX = 60

// Control characters, the C1 range, the characters a path or a file system treats as syntax (separators, drive colon, wildcards, quotes, redirection, pipe), and the invisible
// ones that make a name read as something else (zero-width, directional overrides, the byte-order mark). Line and paragraph separators are handled apart, below.
const hex = (n) => '\\u' + n.toString(16).padStart(4, '0')
const UNSAFE = new RegExp('[' + [[0, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x2064], [0x2066, 0x2069], [0xfeff, 0xfeff]].map(([x, y]) => hex(x) + (y > x ? '-' + hex(y) : '')).join('') + '/\\\\:*?"<>|]', 'gu')
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
const LINE_SEPARATOR = String.fromCharCode(0x2028)
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029)

/** A short, stable word from a team's id (its first eight letters and digits): what tells two teams of the same name apart. */
export const shortId = (id) => (typeof id === 'string' ? id.replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toLowerCase() : '')

/** The name of a team's folder: ONE segment, whatever the team is called. A separator, a drive colon, a control character, `..` and a leading or trailing dot are gone; the length is
 *  capped (by characters, never cutting one in half); a name that leaves nothing, or that Windows reserves, becomes « Team <id> ». Never throws. */
export function teamFolderName(raw, id) {
  let s = typeof raw === 'string' ? raw.normalize('NFC') : ''
  s = s.replace(UNSAFE, ' ').split(LINE_SEPARATOR).join(' ').split(PARAGRAPH_SEPARATOR).join(' ')
  s = s.replace(/\.{2,}/gu, '.').replace(/\s+/gu, ' ')
  const edges = /^[.\s]+|[.\s]+$/gu
  s = s.replace(edges, '')
  s = Array.from(s).slice(0, FOLDER_NAME_MAX).join('').replace(edges, '')
  if (s === '' || RESERVED.test(s)) {
    const short = shortId(id)
    return short === '' ? 'Team' : 'Team ' + short
  }
  return s
}

/** The names to try, in order: the plain one, then the one that carries the team's id (two teams called « Acme », or a folder the person already made under that name). */
export function folderCandidates(raw, id) {
  const name = teamFolderName(raw, id)
  const short = shortId(id)
  const withId = short === '' || name.includes(short) ? null : name + ' (' + short + ')'
  return withId === null ? [name] : [name, withId]
}

/** Where « Documents » is. Same rule as kybernos-multi-device and as DSH's first-use directory: the system Documents folder, or ~/Documents (KYBERNOS_DOCUMENTS_DIR for tests).
 *  @param {{ platform: string, home: string, env: Record<string, string | undefined>, xdgDocuments?: () => string | null }} deps */
export function documentsDir(deps) {
  const override = deps.env.KYBERNOS_DOCUMENTS_DIR
  if (typeof override === 'string' && isAbsolute(override)) return override
  if (deps.platform === 'linux' && typeof deps.xdgDocuments === 'function') {
    let x = null
    try { x = deps.xdgDocuments() } catch (e) { x = null }
    // xdg-user-dir answers $HOME when Documents is not configured: that is not a Documents folder.
    if (typeof x === 'string' && isAbsolute(x) && x.replace(/[\\/]+$/, '') !== deps.home.replace(/[\\/]+$/, '')) return x
  }
  return join(deps.home, 'Documents')
}

export const rootOf = (documents) => join(documents, 'Kybernos')

/** True for a path that is a DIRECT child of `root` (whatever the file system's separator): the only kind of folder this file makes, reuses or records. */
export const isChildOf = (root, path) => {
  if (typeof path !== 'string' || path === '' || isAbsolute(path) !== true) return false
  const rel = relative(root, path)
  return rel !== '' && rel !== '..' && rel.startsWith('..') !== true && rel.includes(sep) !== true && isAbsolute(rel) !== true
}

const codeOf = (e) => (e !== null && typeof e === 'object' ? e.code : undefined)

/** The folder of ONE team: the one already recorded when it is still there (made again when the person removed it), else a new one under <Documents>/Kybernos. The leaf is made WITHOUT
 *  `recursive`, so a folder that exists is reported, never taken over: a name already used (by another team, or by the person) falls to the name that carries the team's id, and
 *  only that one, being this team's by its id, is reused when it is already there. Never throws: a refusal of the disk is `{ ok: false, error }`, and the team goes on without a folder.
 *  @param {{ id: string, name: unknown, recorded?: unknown, documents: string, io: { mkdir: (p: string, opts?: object) => void, isDir: (p: string) => boolean } }} a
 *  @returns {{ ok: true, path: string, created: boolean } | { ok: false, error: 'not_allowed' | 'mkdir_failed' | 'exists' }} */
export function ensureTeamFolder({ id, name, recorded, documents, io }) {
  const root = rootOf(documents)
  const refusal = (e) => (['EACCES', 'EPERM', 'EROFS'].includes(codeOf(e)) ? { ok: false, error: 'not_allowed' } : { ok: false, error: 'mkdir_failed' })
  if (isChildOf(root, recorded)) {
    try {
      if (io.isDir(recorded)) return { ok: true, path: recorded, created: false }
      io.mkdir(root, { recursive: true })
      io.mkdir(recorded)
      return { ok: true, path: recorded, created: true }
    } catch (e) {
      // Something that is not a folder holds the recorded name: the team gets a folder of its own below, whose name is chosen again.
      if (codeOf(e) !== 'EEXIST') return refusal(e)
    }
  }
  const names = folderCandidates(name, id)
  for (let i = 0; i < names.length; i += 1) {
    const target = join(root, names[i])
    if (isChildOf(root, target) !== true || relative(root, target) !== names[i]) continue
    try {
      io.mkdir(root, { recursive: true })
      io.mkdir(target)
      return { ok: true, path: target, created: true }
    } catch (e) {
      if (codeOf(e) !== 'EEXIST') return refusal(e)
      let there = false
      try { there = io.isDir(target) } catch (err) { there = false }
      if (i > 0 && there === true) return { ok: true, path: target, created: false }
    }
  }
  return { ok: false, error: 'exists' }
}
