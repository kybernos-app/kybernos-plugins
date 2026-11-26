// Which workspace an automation's runs land in.
//
// A DSH workspace is a folder the engine adopted (the page calls it a project), and a session lives in one: the folder is where the
// run's agents work and where what they write ends up. An automation may name one (`workspaceHint`, the id of a workspace);
// when it names none, the runs go to ONE dedicated workspace, « Automations », instead of whichever workspace happens to be first
// in the list (which was the assistant's own).
//
// Pure: ids and lists in, a decision out. index.js reads the registry and creates the dedicated folder and workspace.

/** The title of the dedicated workspace and the folder under `<dsh home>/kybernos/` that it adopts. */
export const DEDICATED_TITLE = 'Automations'
export const DEDICATED_DIR = 'automations'

const HINT_RE = /^[A-Za-z0-9_.:@-]{1,160}$/

/**
 * What the page may send as a workspace: nothing or an empty string (no choice: the dedicated workspace), `null` (the same), or the id
 * of a workspace. Anything else is refused: `undefined` is returned for it, so the caller can tell « no choice » (null) from « invalid ».
 */
export const cleanHint = (value) => {
  if (value === null || value === '') return null
  if (typeof value === 'string' && HINT_RE.test(value) === true) return value
  return undefined
}

/** The id of a workspace record, whichever of the two spellings the registry (host) or the store (page) uses. */
export const idOf = (ws) => {
  if (ws === null || typeof ws !== 'object') return null
  const id = typeof ws.id === 'string' && ws.id.length > 0 ? ws.id : (typeof ws.workspaceId === 'string' && ws.workspaceId.length > 0 ? ws.workspaceId : null)
  return id
}

/**
 * Where a run goes, given what the automation named and the workspaces that exist:
 *   { id, why: 'chosen' }            the workspace it named, which exists
 *   { id: null, why: 'none' }        it named none: the dedicated workspace
 *   { id: null, why: 'missing' }     it named one that is gone (deleted): the dedicated workspace too, never a guess
 */
export const chooseWorkspace = (hint, list) => {
  const clean = cleanHint(hint)
  if (typeof clean !== 'string') return { id: null, why: 'none' }
  const ids = (Array.isArray(list) === true ? list : []).map(idOf).filter((x) => x !== null)
  return ids.indexOf(clean) >= 0 ? { id: clean, why: 'chosen' } : { id: null, why: 'missing' }
}

/** Is this folder the dedicated workspace's folder, or one inside it? `dir` is `<dsh home>/kybernos/automations`. */
export const inDedicatedDir = (cwd, dir) => typeof cwd === 'string' && typeof dir === 'string' && dir !== '' && (cwd === dir || cwd.startsWith(dir + '/'))

/**
 * The folder Creations scans for a chat: the chat's own. An automation run lives in the dedicated folder, which holds none of the person's
 * own work, so Creations said « no file » until a normal chat was opened (UJ-136): it reads the newest other chat's folder then, and the
 * run's own when there is none. `others` is the folders of the recent chats, newest first.
 */
export const creationsFolder = (cwd, dir, others) => {
  if (inDedicatedDir(cwd, dir) !== true) return cwd
  const other = (Array.isArray(others) === true ? others : []).find((x) => typeof x === 'string' && x !== '' && inDedicatedDir(x, dir) !== true)
  return other === undefined ? cwd : other
}
