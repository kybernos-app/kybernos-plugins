// Host half of the hand-off between DSH and the Team settings console (the SaaS page shown in an iframe).
//
// The console needs a workspace admin key to read its data. That key lives in ~/.dsh/kybernos/settings.json
// (field `wsAdminKey`): never in the repo, never in a URL. The page asks this route, same-origin, and posts
// the answer to the console's own origin (see KbWsConsole in client.js).
//
// DSH serves plugin routes BEFORE its own authentication, so the guard is ours: a request that does not come
// from this very server (no Origin/Referer, or a foreign one) gets 403, and the settings file is not even read.
//
// Pure: the host hands in the origin check and the settings reader, so a unit test can run every branch.
// The error strings are the ones the route always answered with; callers only read `ok`.

export const WS_CONSOLE_KEY_PATH = '/kybernos/ws-console-key'
/** A key longer than this is a corrupted setting, not a key: answer "no key" instead of echoing it. */
export const MAX_KEY_LENGTH = 512

/**
 * `{ status, body }` for one request. `deps.sameOriginStrict(req)` -> boolean, `deps.readSettings()` -> promise of
 * the settings object. Never throws, never logs, never returns anything but `{ ok, key }` on success.
 */
export async function wsConsoleKeyReply (req, deps) {
  const method = req !== null && req !== undefined && typeof req.method === 'string' ? req.method : ''
  if (method !== 'GET') return { status: 405, body: { ok: false, error: 'GET attendu' } }
  if (deps.sameOriginStrict(req) === false) return { status: 403, body: { ok: false, error: 'origine refusee' } }
  let key = ''
  try {
    const settings = await deps.readSettings()
    if (settings !== null && settings !== undefined && typeof settings.wsAdminKey === 'string') key = settings.wsAdminKey.trim()
  } catch (e) { key = '' }
  if (key.length > MAX_KEY_LENGTH) key = ''
  return { status: 200, body: { ok: true, key: key.length > 0 ? key : null } }
}
