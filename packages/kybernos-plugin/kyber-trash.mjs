// Removing an Agent Team from the person's own DSH home (`~/.dsh/kybers/<id>/`): the folder is MOVED to a trash folder next to it, never deleted.
// No I/O here: index.js (`deleteKyber`) hands in the places and the file operations, so the rules can be tested without a disk.
//
// Why only the installed root: a team a person installs from the marketplace, or has Kaby create, lives in their DSH home and is theirs to remove. A team of a
// project folder (the plugin's own `kybers/`, a workspace) is a file of that project (it may be tracked by git, shared with others): it is not removed from here.
// The Digital Clone is the person's own and stays.

export const KYBER_ID = /^[a-z0-9][a-z0-9-]{1,62}$/
export const PROTECTED_KYBERS = ['digital-clone']

const pad = (n) => String(n).padStart(2, '0')
/** `20261108-041530` (UTC): sorts like time, no character a path dislikes. */
export const stampOf = (now) => {
  const d = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date()
  return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + '-' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds())
}

/**
 * What would be moved, and where. The client names a root and an id, never a path: the path is built here from the installed root of the engine.
 * @param {{ rootId?: unknown, kyberId?: unknown, installedRoot?: unknown, now?: Date }} req
 * @returns {{ ok: true, id: string, dir: string, yml: string, trashRoot: string, to: string } | { ok: false, code: string, error: string }}
 */
export const planTrash = (req) => {
  const rootId = req !== null && req !== undefined && typeof req.rootId === 'string' ? req.rootId : ''
  const id = req !== null && req !== undefined && typeof req.kyberId === 'string' ? req.kyberId.trim() : ''
  if (rootId !== 'installed') return { ok: false, code: 'not-installed', error: 'only a team installed in your own folder can be removed here: a team of a project folder is a file of that project' }
  if (KYBER_ID.test(id) === false) return { ok: false, code: 'bad-id', error: 'invalid AI Agent Team id (lowercase letters, digits, dashes)' }
  if (PROTECTED_KYBERS.includes(id)) return { ok: false, code: 'protected', error: 'this AI Agent Team is yours and stays (the Digital Clone)' }
  const root = req.installedRoot
  if (typeof root !== 'string' || root.length < 2 || root.startsWith('/') === false) return { ok: false, code: 'no-home', error: 'the folder of your installed teams is not known: nothing was removed' }
  const base = root.replace(/\/+$/, '')
  const parent = base.slice(0, base.lastIndexOf('/'))
  if (parent === '' || base.slice(base.lastIndexOf('/') + 1) !== 'kybers') return { ok: false, code: 'no-home', error: 'the installed teams folder is not where it was expected: nothing was removed' }
  const dir = base + '/' + id
  const trashRoot = parent + '/agent-teams-trash'
  return { ok: true, id, dir, yml: dir + '/kyber.yml', trashRoot, to: trashRoot + '/' + id + '-' + stampOf(req.now) }
}

/**
 * Does the move. `ops` = { exists(path), mkdirp(path), rename(from, to), copyDir(from, to), removeDir(path) }, all synchronous.
 * A rename that crosses a disk (EXDEV) is a copy then a removal, and the removal only happens when the copy went through.
 * @returns {{ ok: true, trash: string } | { ok: false, code: string, error: string }}
 */
export const moveToTrash = (plan, ops) => {
  if (plan.ok !== true) return plan
  try {
    if (ops.exists(plan.yml) !== true) return { ok: false, code: 'missing', error: 'this AI Agent Team is not in your own folder any more: nothing to remove' }
    if (ops.exists(plan.to) === true) return { ok: false, code: 'trash-busy', error: 'a folder with this name is already in the trash: try again in a second' }
    ops.mkdirp(plan.trashRoot)
    try {
      ops.rename(plan.dir, plan.to)
    } catch (e) {
      if (e === null || e === undefined || e.code !== 'EXDEV') throw e
      ops.copyDir(plan.dir, plan.to)
      ops.removeDir(plan.dir)
    }
    return { ok: true, trash: plan.to }
  } catch (e) {
    return { ok: false, code: 'io', error: String(e !== null && e !== undefined && e.message !== undefined ? e.message : e) }
  }
}
