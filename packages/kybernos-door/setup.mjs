// The routes behind the Kaby MCP Settings page, and the words of the message the person pastes into their assistant.
//
//   GET  /kybernos-door/setup?lang=fr|en   the state of the door for the page: the address, where the token file is, when an assistant last called, the message to paste and the manual snippets
//   POST /kybernos-door/setup/token        the token itself, for the page's « Copy the token » button (the page puts it on the clipboard and never draws it)
//   POST /kybernos-door/setup/rotate       a new token: the old one stops working at once
//
// These are the page's routes, not the assistants': DSH serves plugin routes before its own sign-in, so each one needs this listener's own loopback Host, the right Origin AND DSH's signed browser session (session-guard.mjs, the same
// rule as every write in this repository), and a request that came through the phone link is refused. An assistant never reaches them: it has the bearer token for the MCP route, not the cookie.
import { hostOk } from './door-http.mjs'
import { writeGuard } from './session-guard.mjs'

export const SETUP_ROUTE = '/kybernos-door/setup'
export const TOKEN_ROUTE = '/kybernos-door/setup/token'
export const ROTATE_ROUTE = '/kybernos-door/setup/rotate'

const send = (res, status, body) => {
  try {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  } catch (e) { /* the page left */ }
}

/** The address an assistant on this computer calls, on the listener the page itself came from. */
export const addressOf = (req) => {
  const port = req !== null && req !== undefined && req.socket !== null && req.socket !== undefined && Number.isInteger(req.socket.localPort) ? req.socket.localPort : 3080
  return 'http://127.0.0.1:' + port + '/kybernos-door/mcp'
}

const EN = {
  message: (url, tokenFile) => [
    'Add an MCP server named "kaby" to your tools, for all my projects (not just this one).',
    'Type: HTTP. Address: ' + url,
    'Header to send: Authorization: Bearer, followed by the contents of the file ' + tokenFile,
    'Pass the token through the shell (for example with $(cat …)) instead of copying it into the conversation.',
    'Then check that the tools kaby_do and list_tasks are available, and tell me in one sentence how to use them.',
  ].join('\n'),
}
const FR = {
  message: (url, tokenFile) => [
    'Ajoute à tes outils un serveur MCP nommé « kaby », pour tous mes projets (pas seulement celui-ci).',
    'Type : HTTP. Adresse : ' + url,
    'En-tête à envoyer : Authorization: Bearer, suivi du contenu du fichier ' + tokenFile,
    'Passe le jeton par le shell (par exemple avec $(cat …)) au lieu de le recopier dans la conversation.',
    'Ensuite vérifie que les outils kaby_do et list_tasks sont disponibles, et dis-moi en une phrase comment m’en servir.',
  ].join('\n'),
}

/** The message to paste into an assistant, in the person's language. It carries the address and the PLACE of the token, never the token. */
export const messageFor = (lang, url, tokenFile) => (lang === 'fr' ? FR : EN).message(url, tokenFile)

/** The manual snippets: one per kind of assistant. `<token>` is a placeholder the person fills with « Copy the token »; Claude Code reads the file itself. */
export const snippetsFor = (url, tokenFile) => [
  { id: 'claude-code', title: 'Claude Code', code: 'claude mcp add --scope user --transport http kaby ' + url + ' --header "Authorization: Bearer $(cat ' + tokenFile + ')"' },
  { id: 'codex', title: 'Codex', code: '[mcp_servers.kaby]\nurl = "' + url + '"\nhttp_headers = { Authorization = "Bearer <token>" }' },
  { id: 'json', title: 'JSON', code: '{ "mcpServers": { "kaby": { "type": "http", "url": "' + url + '", "headers": { "Authorization": "Bearer <token>" } } } }' },
]

/**
 * @param deps `{ token, activity, tokenFile: () => string, guard? }`; `guard` is `writeGuard` unless a test passes another.
 * @returns `{ state, token, rotate }`: three handlers for DSH's web server.
 */
export function createSetup ({ token, activity, tokenFile, guard = writeGuard }) {
  const refuse = (req, res, method) => {
    // The Host first, like every route served before DSH's own sign-in: a page that rebinds its own name to 127.0.0.1 has the wrong Host, whatever Origin and cookie it carries.
    if (hostOk(req) !== true) { send(res, 403, { ok: false, error: 'host refused' }); return true }
    const refused = guard(req)
    if (refused !== null) { send(res, refused.status, { ok: false, error: refused.error }); return true }
    if (String(req.method || '').toUpperCase() !== method) { send(res, 405, { ok: false, error: 'method' }); return true }
    return false
  }
  return {
    async state (req, res) {
      if (refuse(req, res, 'GET')) return
      let lang = 'en'
      try { lang = new URL(req.url || '/', 'http://x').searchParams.get('lang') === 'fr' ? 'fr' : 'en' } catch (e) { lang = 'en' }
      const url = addressOf(req)
      const file = tokenFile()
      send(res, 200, { ok: true, url, tokenFile: file, hasToken: token.current() !== '', lastCallAt: activity.lastAt(), message: messageFor(lang, url, file), snippets: snippetsFor(url, file) })
    },
    async token (req, res) {
      if (refuse(req, res, 'POST')) return
      const t = token.current()
      if (t === '') { send(res, 503, { ok: false, error: 'no_token' }); return }
      send(res, 200, { ok: true, token: t })
    },
    async rotate (req, res) {
      if (refuse(req, res, 'POST')) return
      try { token.rotate() } catch (e) { send(res, 500, { ok: false, error: 'not_saved' }); return }
      send(res, 200, { ok: true })
    },
  }
}
