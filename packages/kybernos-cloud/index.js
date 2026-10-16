// ── Kybernos Cloud — pairing by device code + profile + catalogue (half host) ─
//
// This half does three things:
//   1. talk to the API of the active Kybernos server (the NEW default server: BUILTIN_API in server-profile.mjs);
//   2. keep the device secret OUT of the browser and OUT of the repo, in
//      <DSH home>/kybernos-cloud.json (~/.dsh by default, mode 0600) ;
//   3. when the user is signed in, AUTOMATICALLY import the model catalogue
//      of the Kybernos LiteLLM proxy (glm, deepseek…) into the harness:
//      `kybernos` provider route in settings.yaml + KYBERNOS_API_KEY credential.
//
// It knows NEITHER a password NOR a Supabase key. The user authenticates
// in THEIR browser, on the activation page served by Kybernos (device
// code flow, RFC 8628); this plugin then stores only the opaque `kys-…`
// minted at the claim — the same kind of token as a web session, revocable from
// the Kybernos app (Security → Sessions).
//
// Route contract (all same-origin, never exposed to the network):
//   POST /kybernos-cloud/start         → creates a pairing request
//   POST /kybernos-cloud/poll          → request state / token claim
//   GET  /kybernos-cloud/status        → local state, no network
//   POST /kybernos-cloud/refresh       → refreshes the profile from the API
//   POST /kybernos-cloud/disconnect    → revokes on the server + forgets the local state
//                                         (+ removes the imported catalogue)
//   GET  /kybernos-cloud/models        → detail of the imported catalogue
//   POST /kybernos-cloud/models/sync   → resynchronises the catalogue now
//   GET  /kybernos-cloud/artifacts     → the artifacts pushed (?limit=)
//   POST /kybernos-cloud/artifacts/push    → pushes an artifact (idempotent)
//   POST /kybernos-cloud/artifacts/detail  → detail + signed URL {id}
//
// The artifact routes (phase A) are the only path by which an artifact
// of the local chat reaches the app's store (`kybernos.artifacts` — the table
// where the `kybernos-chat` EF already writes). The token never leaves this module.
//
// Invariant: the `token` is NEVER returned to the client, never logged. The
// client only sees `publicState()` (profile, workspaces, state, summary of the
// catalogue). The subscription (glm, deepseek… available depending on the plan) is
// applied by the proxy on every request — this plugin filters nothing.
import { spawn } from 'node:child_process'
import { timingSafeEqual } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { lireCatalogue, resoudreItem, slugSur, ymlDuKyber, verdictInstallation } from './marketplace-kyber.mjs'
import { rank as rankByRelevance } from './relevance.mjs'
import { findDuplicateGroups, unclearPairs } from './dedupe.mjs'
import { MAP_TUNING, textHash, packVector, unpackVector, buildMap } from './mapproj.mjs'
import { TEAM_CHUNK_NAME, TEAM_CHUNK_ORDER, TEAM_TUNING, teamWorkspace, displayName, asTeamLesson, teamFailure, teamPlan, renderTeamChunk, applicable } from './team-lessons.mjs'
import { teamSkillsBase, isSkillId, teamSkillsFailure, asTeamSkill } from './team-skills.mjs'
import { createConnections } from './connections-host.mjs'
import { normalizeTidySettings, patchTidySettings, tidyDue, tidyNext, pickAuto, removalChunks, readStudyChoice, brainGroups } from './tidy.mjs'
import { zstdDecompressSync } from 'node:zlib'
import { activeServer, stateFileName, llmBase, publicProfile } from './server-profile.mjs'
import { agentsFile, readInstructions, writeInstructions } from './instructions.mjs'
import { createKybyRoutes } from './kyby.mjs'
import { writeGuard } from './session-guard.mjs'
import { createKybyNative, isSessionId, readPointer, writePointer } from './kyby-native.mjs'
// Hosted instance: also accept the authorities declared to DSH with --trusted-host. The core bundle publishes the predicate
// (kybernos-plugin/trusted-authority.mjs); absent or failing, it answers false and the guard stays loopback-only.
const kbTrusted = (host) => { try { const f = globalThis[Symbol.for('kybernos.trustedAuthority')]; return typeof f === 'function' && f(host) === true } catch (e) { return false } }

/**
 * The DSH home, resolved the way DSH does (@deepseek-ai/dsh-home-paths): a non-blank
 * $DSH_HOME (trimmed, a leading ~ expanded), else <os home>/.dsh. Resolved at each use,
 * never cached: with DSH_HOME set (a second profile, an isolated instance, CI) every path
 * below must stay inside it and leave the user's real ~/.dsh alone.
 */
const dshHome = (env = process.env, osHome = homedir) => {
  const raw = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  if (raw === '') return join(osHome(), '.dsh')
  if (raw === '~') return osHome()
  return resolve(raw.startsWith('~/') || raw.startsWith('~\\') ? join(osHome(), raw.slice(2)) : raw)
}
const serversFile = () => {
  const raw = typeof process.env.KYBERNOS_SERVERS_FILE === 'string' ? process.env.KYBERNOS_SERVERS_FILE.trim() : ''
  return raw === '' ? join(dshHome(), 'kybernos', 'servers.json') : raw
}
/** The server this DSH talks to (server-profile.mjs): read at each use, like the state, so a registry written by the
 *  Select server module is seen without a restart. */
const server = () => activeServer({ env: process.env, registryFile: serversFile() })
const defaultStateFile = (profile = server().profile) => join(dshHome(), stateFileName(profile))
const appliedFile = () => join(dshHome(), 'kybernos', 'server-applied.json')
const sessionsHome = () => join(dshHome(), 'sessions')
const categoriesFile = () => join(dshHome(), 'kybernos', 'categories.json')
const CLIENT_VERSION = '0.1.0'
const CLIENT_NAME = 'dsh'
const REQUEST_TIMEOUT_MS = 15000
const MAX_LABEL = 64

/** API base of the active server (Kybernos Cloud by default; KYBERNOS_CLOUD_API or the server registry replace it). */
const resolveApi = () => server().profile.api
/** Web address of the active server: this is where the space's page lives. */
const resolveWeb = () => server().profile.web

/** State file: <DSH home>/kybernos-cloud.json for the built-in server, kybernos-cloud-<id>.json for another one (each server
 *  keeps its own connection), overridable by KYBERNOS_CLOUD_STATE (tests, multi-profile). */
const stateFile = (profile) => {
  const raw = process.env.KYBERNOS_CLOUD_STATE
  const value = typeof raw === 'string' ? raw.trim() : ''
  return value === '' ? defaultStateFile(profile) : value
}

/** Device label as it will appear in « Security → Sessions ». */
const deviceLabel = () => {
  let host = 'dsh'
  try { host = hostname() || 'dsh' } catch (e) { host = 'dsh' }
  return ('DSH ' + host).slice(0, MAX_LABEL)
}

const readState = () => {
  try {
    const parsed = JSON.parse(readFileSync(stateFile(), 'utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : null
  } catch (e) {
    return null
  }
}

const writeState = (state) => {
  const file = stateFile()
  // The folder of the file actually written: with KYBERNOS_CLOUD_STATE set, creating the default folder would touch ~/.dsh for nothing.
  try { mkdirSync(dirname(file), { recursive: true, mode: 0o700 }) } catch (e) { /* already there */ }
  writeFileSync(file, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 })
  // writeFileSync does not tighten the mode of an existing file: 0600 is forced.
  try { chmodSync(file, 0o600) } catch (e) { /* exotic FS (Windows) */ }
}

const clearState = () => {
  try { rmSync(stateFile(), { force: true }) } catch (e) { /* already absent */ }
}

const isConnected = (state) => state !== null && typeof state.token === 'string' && state.token !== ''

/** Public view: no token, no device_secret, no code once consumed.
 *  The catalogue import is summarised (done/count/plan) — never the full ids
 *  here: the /kybernos-cloud/models route details them on demand. */
const publicState = (state) => ({
  connected: true,
  user: state.user !== undefined && state.user !== null ? state.user : null,
  workspaces: Array.isArray(state.workspaces) ? state.workspaces : [],
  // The ACTIVE space — what the sidebar footer row shows, and what the
  // switcher changes. As long as the user has chosen nothing, we DERIVE the
  // first space (the personal one, created at sign-in) without writing anything: a derived default
  // is not a choice, and writing it would suggest a decision.
  active_workspace_id: espaceActif(state),
  ...(spacePlanView(state) !== null ? { space_plan: spacePlanView(state) } : {}),
  web_url: resolveWeb(),
  server: { id: server().profile.id, name: server().profile.name },
  device_label: state.device_label !== undefined ? state.device_label : null,
  expires_at: state.expires_at !== undefined ? state.expires_at : null,
  refreshed_at: state.refreshed_at !== undefined ? state.refreshed_at : null,
  models: state.models !== undefined && state.models !== null ? publicModels(state.models) : null,
  // Directory of DSH chats: last push (metadata, never content).
  chats_last_push: state.chats_last_push !== undefined ? state.chats_last_push : null,
})

/** Id of the active space: the explicit choice if it is still valid, else the
 *  first known space. Never an id that is no longer in the list. */
const espaceActif = (state) => {
  const espaces = state !== null && state !== undefined && Array.isArray(state.workspaces) ? state.workspaces : []
  const ids = espaces.map((w) => (w !== null && typeof w.id === 'string' ? w.id : null)).filter((id) => id !== null)
  const choisi = typeof state.active_workspace_id === 'string' ? state.active_workspace_id : null
  if (choisi !== null && ids.indexOf(choisi) !== -1) return choisi
  return ids.length > 0 ? ids[0] : null
}

/** The plan of ONE space, as the server's `/plan` of that space answers it. The profile's `plan` (/v1/me) is the ACCOUNT's word and says « team »
 *  as soon as the person is in any team; the footer, the menu and the team features belong to the ACTIVE space, so they read this instead.
 *  Never throws and never disconnects: a server that does not answer leaves the account-level word as the fallback. */
const readSpacePlan = async (state, id) => {
  if (typeof id !== 'string' || id === '' || isConnected(state) !== true) return null
  const res = await apiCall('/v1/workspaces/' + encodeURIComponent(id) + '/plan', { token: state.token })
  // A workspace that asks for a second factor turns away a member who has none, once the grace is over: the plan is unknown, the reason is not. DSH itself can only
  // say « API key is invalid » to that person (a 403 is AUTH to it), so the card carries the reason.
  if (res.status === 403 && res.body !== null && typeof res.body === 'object' && res.body.error === 'mfa_required_by_workspace') {
    return { workspace_id: id, key: 'none', name: null, level: null, label: null, status: null, credit_balance_credits: null, mfa: { state: 'blocked', ends: null } }
  }
  if (res.status !== 200 || res.body === null || typeof res.body !== 'object') return null
  const b = res.body
  const plan = b.plan !== null && typeof b.plan === 'object' ? b.plan : null
  const key = plan !== null && typeof plan.key === 'string' && plan.key !== '' ? plan.key : 'none'
  const name = plan !== null && typeof plan.name === 'string' && plan.name !== '' ? plan.name : null
  const level = typeof b.level === 'string' && b.level !== '' ? b.level : null
  // « Solo Studio »: for an individual plan the level is part of what the person bought (Solo, at the Studio level). A team plan's level is a
  // price band (« 1-5 seats »), not a name, and « Free » / « Free » is just « Free ».
  const kind = plan !== null && typeof plan.kind === 'string' ? plan.kind : null
  const label = name === null ? null : (kind === 'individual' && level !== null && level.toLowerCase() !== name.toLowerCase() ? name + ' ' + level : name)
  const credits = Number(b.credit_balance_credits)
  return { workspace_id: id, key, name, level, label, status: typeof b.status === 'string' ? b.status : null,
    credit_balance_credits: Number.isFinite(credits) ? credits : null,
    ...(res.grace !== null ? { mfa: { state: 'grace', ends: res.grace } } : {}) }
}

/** What the page may know of it: only when it was read for the space that is active NOW. */
const spacePlanView = (state) => {
  const sp = state !== null && state !== undefined && state.space_plan !== null && typeof state.space_plan === 'object' ? state.space_plan : null
  return sp !== null && sp.workspace_id === espaceActif(state) ? sp : null
}

/** Route: choose the active space. Fail-closed — an unknown id is REFUSED and
 *  never written: a space one cannot see does not become active. */
const setActiveSpace = async (req, body) => {
  const state = readState()
  if (!isConnected(state)) return { ok: false, error: 'non_connecte' }
  const voulu = body !== null && typeof body === 'object' && typeof body.workspace_id === 'string' ? body.workspace_id : ''
  if (voulu === '') return { ok: false, error: 'espace_absent' }
  const espaces = Array.isArray(state.workspaces) ? state.workspaces : []
  if (espaces.some((w) => w !== null && w.id === voulu) !== true) return { ok: false, error: 'espace_inconnu' }
  const next = Object.assign({}, state, { active_workspace_id: voulu, space_plan: await readSpacePlan(state, voulu) })
  writeState(next)
  // The model route names the active space and lists its catalogue: it follows the choice (nothing is written when it already matches).
  await importCatalog('space')
  return { ok: true, state: publicState(readState()) }
}

/** Route: create a space. The hosted server stays the master — we pass the
 *  name to POST /v1/workspaces; on a refusal (missing route, limited plan,
 *  missing permission) we fabricate NOTHING locally: we return the app's URL
 *  so that the creation happens where it is really decided. */
const createSpace = async (req, body) => {
  const state = readState()
  if (!isConnected(state)) return { ok: false, error: 'non_connecte', web_url: resolveWeb() }
  const nom = body !== null && typeof body === 'object' && typeof body.name === 'string' ? body.name.trim().slice(0, 60) : ''
  if (nom === '') return { ok: false, error: 'nom_absent' }
  const res = await apiCall('/v1/workspaces', { method: 'POST', token: state.token, body: { name: nom } })
  if (res.status !== 200 && res.status !== 201) {
    return { ok: false, error: 'creation_refusee', status: res.status, web_url: resolveWeb() }
  }
  const brut = res.body !== null && typeof res.body === 'object' ? (res.body.workspace !== undefined && res.body.workspace !== null ? res.body.workspace : res.body) : null
  const id = brut !== null && typeof brut.id === 'string' ? brut.id : null
  // A success that does not describe the space (an empty body, a page) did not create one: nothing is written.
  if (id === null) return { ok: false, error: 'creation_refusee', status: res.status, web_url: resolveWeb() }
  const espaces = Array.isArray(state.workspaces) ? state.workspaces.slice() : []
  if (id !== null && espaces.some((w) => w !== null && w.id === id) !== true) espaces.push(brut)
  const next = Object.assign({}, state, { workspaces: espaces, active_workspace_id: id !== null ? id : state.active_workspace_id })
  next.space_plan = await readSpacePlan(state, espaceActif(next))
  writeState(next)
  await importCatalog('space')
  return { ok: true, state: publicState(readState()) }
}

const publicPairing = (state) => ({
  user_code: state.user_code !== undefined ? state.user_code : null,
  activation_url: state.activation_url !== undefined ? state.activation_url : null,
  expires_at: state.expires_at !== undefined ? state.expires_at : null,
})

/** Merges the server profile (/v1/me) into the cached `user`.
 *
 * Only the FILLED values overwrite: a server-side null `name`
 * (empty `kybernos_users.name` column) must not erase an already known name,
 * and the email is never touched — it only comes from the claim, the /v1/*
 * identity does not carry it. */
const mergeUser = (cached, profile) => {
  const base = cached !== null && typeof cached === 'object' ? cached : {}
  if (profile === null || typeof profile !== 'object') return base
  const next = Object.assign({}, base)
  for (const key of ['id', 'name', 'plan']) {
    const value = profile[key]
    if (typeof value === 'string' && value.trim() !== '') next[key] = value.trim()
  }
  // The email comes from the claim and is never overwritten. A cloud computer has no claim (it is born connected, with its own token): the
  // server's answer fills it in when there is none, so the account has a face there.
  if (typeof next.email !== 'string' || next.email.trim() === '') {
    const mail = typeof profile.email === 'string' ? profile.email.trim() : ''
    if (mail !== '' && mail.length <= 254 && mail.includes('@')) next.email = mail
  }
  return next
}

/** The most an answer of the server may weigh. The biggest legitimate one is an artifact (8 MiB of content, base64: ~11 MiB). Without
 *  a cap the whole body is held, then parsed: a 400 MB answer (a faulty endpoint, a proxy page) took DSH down for every session. */
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024

/** The body of a response as text, never holding more than `max` bytes. `tooLarge` (the stream is cancelled, the socket dropped), or
 *  `error` when the body could not be read to its end (cut connection, timeout): a half answer is not an answer. */
const readBoundedText = async (res, max) => {
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > max) {
    try { await res.body.cancel() } catch (e) { /* already closed */ }
    return { tooLarge: true }
  }
  if (res.body === null) return { text: '' }
  const reader = res.body.getReader()
  const chunks = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > max) {
        await reader.cancel().catch(() => {})
        return { tooLarge: true }
      }
      chunks.push(value)
    }
  } catch (e) {
    return { error: String((e && e.message) || e) }
  }
  return { text: Buffer.concat(chunks).toString('utf8') }
}

/** API call: never throws, returns { status, body } (status 0 = network).
 *  The server is a JSON API, not a site: a redirect is never followed (it would carry the request body to another
 *  host and that host's answer would pass for the server's), a response that is too big or cut off is a network failure,
 *  and a success status with a body that is not JSON (a captive portal's page) is not a success. */
const apiCall = async (path, options = {}) => {
  const method = typeof options.method === 'string' ? options.method : 'GET'
  const token = typeof options.token === 'string' ? options.token : null
  const body = options.body !== undefined && options.body !== null ? options.body : null
  const ctrl = new AbortController()
  // A longer wait only for what is known to take longer (an action of a connected app: up to 30 s at the server).
  const timer = setTimeout(() => ctrl.abort(), Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : REQUEST_TIMEOUT_MS)
  try {
    const headers = { 'content-type': 'application/json' }
    if (options.headers !== undefined && options.headers !== null && typeof options.headers === 'object') Object.assign(headers, options.headers)
    if (token !== null) headers.authorization = 'Bearer ' + token
    const res = await fetch((typeof options.base === 'string' ? options.base : resolveApi()) + path, {
      method,
      headers,
      signal: ctrl.signal,
      redirect: 'manual',
      body: body === null ? undefined : JSON.stringify(body),
    })
    if (res.status >= 300 && res.status < 400) {
      try { await res.body.cancel() } catch (e) { /* nothing to cancel */ }
      return { status: 0, body: null, error: 'redirect_refused' }
    }
    const got = await readBoundedText(res, Number.isFinite(options.maxBytes) && options.maxBytes > 0 ? options.maxBytes : MAX_RESPONSE_BYTES)
    if (got.tooLarge === true) return { status: 0, body: null, error: 'response_too_large' }
    if (got.error !== undefined) return { status: 0, body: null, error: got.error }
    let parsed = null
    let readable = true
    try { parsed = JSON.parse(got.text) } catch (e) { parsed = null; readable = got.text.trim() === '' }
    if (readable !== true && res.status >= 200 && res.status < 300) return { status: 0, body: null, error: 'invalid_response' }
    // When the workspace asks its members for a second factor, a member who has none is told when the grace ends on every answer of that workspace.
    const grace = res.headers !== undefined && res.headers !== null && typeof res.headers.get === 'function' ? res.headers.get('x-kybernos-mfa-grace-ends') : null
    // The server's own clock, for the times it names (a used-up window comes back at ITS time; the person's clock can be hours off).
    const date = res.headers !== undefined && res.headers !== null && typeof res.headers.get === 'function' ? res.headers.get('date') : null
    return { status: res.status, body: parsed, grace: typeof grace === 'string' && grace !== '' ? grace : null, date: typeof date === 'string' && date !== '' ? date : null }
  } catch (e) {
    return { status: 0, body: null, error: String((e && e.message) || e) }
  } finally {
    clearTimeout(timer)
  }
}

// ── Operations ──────────────────────────────────────────────────────────────

const startPairing = async () => {
  const current = readState()
  if (isConnected(current)) return { ok: true, connected: true, state: publicState(current) }
  const res = await apiCall('/v1/device/start', {
    method: 'POST',
    body: { client: CLIENT_NAME, version: CLIENT_VERSION, device_label: deviceLabel() },
  })
  if (res.status !== 200 || res.body === null || typeof res.body.device_id !== 'string') {
    // Status 0 is the network (down, refused, timed out, a body that was not JSON): « cannot reach », not « the server said no ».
    return { ok: false, error: res.status === 429 ? 'trop_de_demandes' : (res.status === 0 ? 'reseau' : 'demarrage_impossible'), status: res.status }
  }
  const ttl = typeof res.body.expires_in === 'number' ? res.body.expires_in : 600
  const state = {
    device_id: res.body.device_id,
    device_secret: res.body.device_secret,
    user_code: res.body.user_code,
    activation_url: res.body.activation_url,
    expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
    created_at: new Date().toISOString(),
    api: resolveApi(),
    device_label: deviceLabel(),
  }
  writeState(state)
  return { ok: true, connected: false, status: 'pending', pairing: publicPairing(state) }
}

const pollPairing = async () => {
  const state = readState()
  if (isConnected(state)) return { ok: true, connected: true, state: publicState(state) }
  if (state === null || typeof state.device_secret !== 'string') {
    return { ok: true, connected: false, status: 'none' }
  }
  const res = await apiCall('/v1/device/poll', {
    method: 'POST',
    body: { device_id: state.device_id, device_secret: state.device_secret },
  })
  if (res.status === 0) return { ok: false, error: 'reseau', status: 0 }
  // Only the server's own verdict ends a pairing. A rate limit, a 5xx, a proxy page or a reply without a status says nothing about
  // the request: the pairing stays (it expires by itself), and the page tries again. Forgetting it here also lost a claim whose
  // answer had not come through.
  if (res.status === 429) return { ok: false, error: 'trop_de_demandes', status: 429 }
  const verdicts = ['pending', 'claimed', 'denied', 'expired']
  if (res.status !== 200 || res.body === null || typeof res.body !== 'object' || verdicts.indexOf(res.body.status) < 0) return { ok: false, error: 'reponse_illisible', status: res.status }
  const status = res.body.status
  if (status === 'claimed' && typeof res.body.token === 'string') {
    // End of the pairing: the device secret and the code disappear here.
    const next = {
      token: res.body.token,
      user: res.body.user !== undefined ? res.body.user : null,
      expires_at: res.body.expires_at !== undefined ? res.body.expires_at : null,
      connected_at: new Date().toISOString(),
      api: state.api !== undefined ? state.api : resolveApi(),
      device_label: state.device_label !== undefined ? state.device_label : deviceLabel(),
    }
    writeState(next)
    // The claim carries the person, not their workspaces: read them (and the active space's plan) NOW, so the card, the model route's
    // workspace header and the Team features start from the right space instead of the account-level word, until a page asks. This
    // imports the catalogue too (cause `claim`); a server that cannot answer the lists leaves the claim standing, and the import
    // below is the old behaviour.
    const fresh = await readProfile('claim').catch(() => null)
    if (fresh !== null && fresh.ok === true && fresh.connected === true) {
      return { ok: true, connected: true, state: fresh.state, models: fresh.models, import_error: fresh.import_error }
    }
    if (fresh !== null && fresh.connected === false && fresh.status === 'revoked') return { ok: true, connected: false, status: 'revoked' }
    // Sign-in = catalogue import (cloud feature no. 1). The import never
    // throws and never calls into question the claim that has just succeeded:
    // an unavailable catalogue shows, gets resynchronised, blocks nothing.
    const imported = await importCatalog('claim')
    return {
      ok: true,
      connected: true,
      state: publicState(next),
      models: imported.summary !== undefined ? imported.summary : null,
      import_error: imported.ok === true ? undefined : imported.error,
    }
  }
  if (status === 'pending') {
    return { ok: true, connected: false, status: 'pending', pairing: publicPairing(state) }
  }
  // denied / expired: the request is dead, we forget everything (the user will
  // start another one; the server never re-mints a request that has already been handled).
  clearState()
  return { ok: true, connected: false, status }
}

const statusRoute = () => {
  const state = readState()
  if (isConnected(state)) return { ok: true, connected: true, state: publicState(state) }
  if (state !== null && typeof state.device_secret === 'string') {
    return { ok: true, connected: false, status: 'pending', pairing: publicPairing(state) }
  }
  return { ok: true, connected: false, status: 'none' }
}

/** Does the server's catalogue for the active space list other models than the route holds? One read; nothing is written here, and the plan is
 *  not part of the comparison (a plan change alone has never rewritten the route). A server that cannot answer says « no change ». */
const catalogChanged = async (state, known) => {
  if (server().profile.services.llm === false || known === null || Array.isArray(known.ids) !== true) return false
  const cat = await fetchCatalog(state)
  if (cat.ok !== true) return false
  const key = (ids) => ids.slice().sort().join('\n')
  return key(known.ids) !== key(cat.models.map((e) => e.id)) || (known.embed === undefined || known.embed === null ? null : known.embed) !== (cat.embed === undefined || cat.embed === null ? null : cat.embed)
}

/** The server's own error envelope (`{ error: 'unauthorized', message, request_id }`), as opposed to JSON some intermediary wrote. */
const isServerRefusal = (body) => body !== null && typeof body === 'object' && Array.isArray(body) !== true && typeof body.error === 'string' && body.error !== ''

const readProfile = async (cause) => {
  const state = readState()
  if (!isConnected(state)) return { ok: true, connected: false, status: 'none' }
  // Two reads in parallel: the profile (/v1/me, added server-side for
  // this plugin) and the workspaces. The profile makes the NAME and the PLAN live
  // — without it, the identity would stay frozen at the moment of the claim: a name
  // filled in or a plan upgrade later would never come up.
  const [me, ws] = await Promise.all([
    apiCall('/v1/me', { token: state.token }),
    apiCall('/v1/workspaces', { token: state.token }),
  ])
  // Revocation is decided on /v1/workspaces, the historical route: it
  // answers 401/403 as soon as the token is dead. /v1/me is an ENRICHMENT —
  // a 401 on it never signs out. This is not theoretical: at the first
  // deployment of /v1/me, the route answered 401 to a valid token (it
  // fell into the middleware's « master key » regime); relying on it to
  // sign out would have ejected every user over a server bug.
  // Only the server's own refusal is a revocation: a firewall's or a proxy's page that says 401 / 403 is not the server speaking about
  // this token, and signing the person out on it also throws away the models imported for them. JSON alone does not make it the server
  // (a gateway answers `{}`, `[]` or `{ message: 'Forbidden' }` too): the server's error envelope names its error as a string.
  // `computer_route_not_allowed` is a cloud computer's restricted token meeting a route outside its list: the token is alive, nothing was revoked.
  if ((ws.status === 401 || ws.status === 403) && isServerRefusal(ws.body) && ws.body.error !== 'computer_route_not_allowed') {
    // Token revoked from the Kybernos app → « Reconnection required ». The
    // imported models would no longer be of any use (the proxy would refuse the
    // calls): they leave with the session.
    await removeImportedCatalog(state)
    clearState()
    return { ok: true, connected: false, status: 'revoked' }
  }
  // Anything but the list itself (a portal's page, an empty body, another shape) keeps the list the person has: only the server's own
  // `{ workspaces: [] }` empties it.
  if (ws.status !== 200 || ws.body === null || typeof ws.body !== 'object' || Array.isArray(ws.body.workspaces) !== true) return { ok: false, error: 'profil_indisponible', status: ws.status }
  const workspaces = ws.body.workspaces
  // /v1/me absent (older server: 404), broken (401/403) or down:
  // we keep the cached user and do NOT break the refresh. The email
  // is never overwritten — it only comes from the claim (the /v1/* identity does not
  // carry it).
  const profile = me.status === 200 && me.body !== null && typeof me.body === 'object' ? me.body : null
  const user = mergeUser(state.user, profile)
  const next = Object.assign({}, state, { user, workspaces, refreshed_at: new Date().toISOString() })
  // The plan of the active space; a read that fails keeps the one already known for the SAME space, never another's.
  const activeId = espaceActif(next)
  const spacePlan = await readSpacePlan(state, activeId)
  next.space_plan = spacePlan !== null ? spacePlan : (state.space_plan !== undefined && state.space_plan !== null && state.space_plan.workspace_id === activeId ? state.space_plan : null)
  writeState(next)
  // Cloud feature no. 1: if nothing has been imported yet (old state
  // file, DSH updated), the refresh imports in its turn. Otherwise, the plan
  // reported by /v1/me is reflected in the summary — the catalogue itself
  // is only re-downloaded on the manual sync (it is not filtered by plan:
  // the subscription is applied by the proxy, request by request).
  let models = null
  let import_error
  const known = state.models !== undefined && state.models !== null ? state.models : null
  const routeSpace = known !== null && typeof known.workspace === 'string' ? known.workspace : null
  if (known === null || known.provider !== PROVIDER_ID || routeSpace !== activeId) {
    // Nothing imported yet, or the route names another space than the active one (the list of spaces was not known at the claim, or the active one
    // is gone): import for the active space. An import for the same space is a no-op (fingerprint), so this is not churn.
    const imported = await importCatalog(cause)
    models = imported.summary !== undefined ? imported.summary : null
    if (imported.ok !== true) import_error = imported.error
  } else if (await catalogChanged(next, known)) {
    // The models of this space changed on the server (an owner shared a model with the team, or took one away): the route is rewritten.
    const imported = await importCatalog('refresh', { force: true })
    models = imported.summary !== undefined ? imported.summary : null
    if (imported.ok !== true) import_error = imported.error
  } else if (known.plan !== userPlan(next)) {
    const merged = Object.assign({}, known, { plan: userPlan(next) })
    writeState(Object.assign({}, next, { models: merged }))
    models = publicModels(merged)
  } else {
    models = publicModels(known)
  }
  return { ok: true, connected: true, state: publicState(readState()), models, ...(import_error !== undefined ? { import_error } : {}) }
}
/** Route: read the profile, the workspaces and the active space's plan again. */
const refreshProfile = () => readProfile('refresh')

// ── Keeping the account's picture current ─────────────────────────────────────────────────────────────────────────────
// The list of workspaces, the active one, its plan and the model route's `x-kybernos-workspace` are read at the claim and whenever a page asks
// (`/refresh`). Nothing else read them: a person removed from a team, a team deleted, a plan changed on the web or a token revoked from the account
// page left DSH naming a workspace the server no longer knew (every model call a 404 about a header the person never wrote, a card still showing
// the old plan) until they happened to open the account page. A slow tick, no page needed, so a headless DSH heals too. Never throws, never
// overlaps itself, and a read the server could not answer changes nothing (readProfile keeps the picture it has).
const PROFILE_REFRESH_TUNING = { firstMs: 3000, tickMs: 5 * 60 * 1000 }
let profileRefreshing = false
const profileRefreshTick = async () => {
  if (profileRefreshing === true) return null
  if (isConnected(readState()) !== true) return null
  profileRefreshing = true
  try { return await readProfile('refresh') } catch (e) { return null } finally { profileRefreshing = false }
}

const disconnect = async () => {
  const state = readState()
  const token = isConnected(state) ? state.token : null
  // The catalogue import lives in settings.yaml + the credentials store:
  // it leaves with the session, BEFORE the state file disappears
  // (removeImportedCatalog needs the state to know what it put there).
  await removeImportedCatalog(state)
  clearState()
  // The previous account's cache must never survive the sign-out: after
  // a re-connection to ANOTHER account, it would have been served in the prompt.
  emptyMemoryCache()
  if (token === null) return { ok: true, revoked: false, status: 0 }
  const res = await apiCall('/v1/session', { method: 'DELETE', token })
  return { ok: true, revoked: res.status === 204 || res.status === 200, status: res.status }
}

// ── Kybernos LiteLLM model catalogue ────────────────────────────────────────
//
// When the user is signed in, DSH AUTOMATICALLY imports the models
// that the Kybernos LiteLLM proxy exposes (`GET /v1/models`, standard
// OpenAI-compatible list) into the harness: a `kybernos` provider route in
// `settings.yaml` (namespace `llm-pi-ai`) + the `kys-…` token set as
// the `KYBERNOS_API_KEY` credential. The proxy itself does the exchange
// session→personal key (session_token_swap): the session token IS
// the call identifier, and the subscription is applied proxy-side, on every
// request (plan gating, fail-closed) — never duplicated here.
//
// Triggers: at the claim (sign-in), at DSH start-up if already signed in,
// at the refresh if nothing has been imported yet, and on demand (POST
// /kybernos-cloud/models/sync, « Re-import » button). Sign-out and
// revocation remove the route and the credential — but ONLY what
// THIS feature put there (traced in the state: models.provider).
//
// Invariants: the token never leaves here (neither response nor log); a
// catalogue 401 NEVER signs out (the /v1/me lesson: revocation is decided
// on /v1/workspaces); the settings write goes through the `settings` service
// (the same path as the native Models page), errors degrade without
// ever breaking the pairing.

const CRED_REF = 'KYBERNOS_API_KEY'
const PROVIDER_ID = 'kybernos'
const PROVIDER_DISPLAY = 'Kybernos Cloud'
const KB_ROUTE_PREFIX = 'kybernos/'

let hostCtx = null

/** A harness service, or null when the deployment does not mount it:
 *  settings and credentials are optional — their absence degrades the import
 *  (catalogue remembered, writes skipped) instead of breaking it. */
const service = (name) => {
  if (hostCtx === null || typeof hostCtx.get !== 'function') return null
  const svc = hostCtx.get(name)
  return svc === undefined ? null : svc
}

/** The current plan (may be absent from the profile). */
const userPlan = (state) => {
  const user = state !== null && state.user !== undefined && state.user !== null ? state.user : {}
  return typeof user.plan === 'string' ? user.plan : null
}

/** OpenAI-compatible base of the proxy: the Kybernos API + /v1 (chat completions,
 *  models). The server's kys→sk swap covers these native routes. */
const baseUrl = (state) => {
  const profile = server().profile
  // The profile names its LLM service when it has a separate one (DSH never deduces it from the account address); a server
  // with no LLM has no base at all, and importCatalog() does not reach this.
  if (typeof profile.services.llm === 'string') return llmBase(profile)
  const api = state !== null && typeof state.api === 'string' && state.api !== '' ? state.api : resolveApi()
  return api.replace(/\/+$/, '') + '/v1'
}

const intOf = (...candidates) => {
  for (const raw of candidates) {
    const n = typeof raw === 'number' ? raw : Number(raw)
    if (Number.isFinite(n) && n > 0 && Number.isInteger(n) === true) return n
  }
  return null
}

/** Keeps only the `kybernos/*` product routes callable in chat:
 *  not the fallback twins (-fb1, -fb2…), not the infra routing pools
 *  (*_rg), not the embeddings route. The other ids of the LiteLLM catalogue
 *  (raw backend models, tier groups) are not a product
 *  surface — calling them directly would bypass the Kybernos gating. */
const keepChatModels = (ids) => {
  const kept = []
  const seen = new Set()
  for (const id of ids) {
    if (typeof id !== 'string' || id.indexOf(KB_ROUTE_PREFIX) !== 0) continue
    if (/-fb[0-9]+$/.test(id) === true) continue
    if (/_rg$/.test(id) === true) continue
    if (id === 'kybernos/embed' || id.indexOf('kybernos/embed-') === 0) continue
    if (seen.has(id) === true) continue
    seen.add(id)
    kept.push(id)
  }
  return kept
}

/** `kybernos/orchestrator-expert` → « Kybernos Orchestrator Expert ». */
const humanizeModelName = (id) => {
  const segment = id.slice(KB_ROUTE_PREFIX.length) || id
  const words = segment.split(/[-_.]/).filter((w) => w.length > 0)
  return 'Kybernos ' + words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

/** Settings entry of a model: {id, name}, enriched with the capabilities when the
 *  catalogue provides them (LiteLLM sometimes exposes max_tokens / context_length).
 *  A model without dimensions takes the route's fallbacks (262 144 / 32 768). */
const modelEntry = (id, info) => {
  const shown = info !== null && typeof info === 'object' && typeof info.display_name === 'string' && info.display_name.trim() !== '' ? info.display_name.trim() : null
  const entry = { id, name: shown !== null ? shown : humanizeModelName(id) }
  if (info !== null && typeof info === 'object' && Array.isArray(info) === false) {
    const context = intOf(info.context_length, info.max_input_tokens, info.max_model_len)
    const output = intOf(info.max_output_tokens, info.max_tokens)
    if (context !== null) entry.contextWindow = context
    if (output !== null) entry.maxTokens = output
  }
  return entry
}

/** The catalogue of a Kybernos server built on vanilla provider models (`GET /v1/models` answers entries with a `kind`): every chat model is
 *  offered, named as the server names it; the embeddings model is remembered apart (it is not a chat route). The old role routes
 *  (`kybernos/*` twins, `_rg` pools, raw backend ids) are told apart by having no `kind`: they keep the filter below. */
const isServerCatalog = (entries) => entries.length > 0 && entries.every((e) => typeof e.kind === 'string')

const serverCatalog = (entries) => {
  const chat = []
  let embed = null
  for (const entry of entries) {
    if (entry.kind === 'chat') chat.push(entry)
    else if (entry.kind === 'embeddings' && embed === null) embed = entry.id
  }
  return { models: chat.map((e) => modelEntry(e.id, e)), embed }
}

/** Accepted shapes: `{data: [{id, …}]}` (native LiteLLM, or Kybernos server with `kind`) or `{models: {id: …}}`
 *  (enriched variant). Anything else = unreadable. Returns `{models, embed}`: `embed` is the id of the embeddings model, or null. */
const parseCatalogIds = (body) => {
  if (body === null || typeof body !== 'object') return null
  if (Array.isArray(body.data) === true) {
    const entries = body.data.filter((entry) => entry !== null && typeof entry === 'object' && typeof entry.id === 'string')
    if (isServerCatalog(entries) === true) return serverCatalog(entries)
    const infos = new Map()
    const ids = []
    for (const entry of entries) {
      ids.push(entry.id)
      infos.set(entry.id, entry)
    }
    const kept = keepChatModels(ids)
    return { models: kept.map((id) => modelEntry(id, infos.get(id))), embed: null }
  }
  if (body.models !== null && typeof body.models === 'object' && Array.isArray(body.models) === false) {
    return { models: keepChatModels(Object.keys(body.models)).map((id) => modelEntry(id, body.models[id])), embed: null }
  }
  return null
}

const fetchCatalog = async (state) => {
  // The catalogue is read where the route will point: the profile's LLM service when it has one, else the account API.
  const llm = server().profile.services.llm
  const res = await apiCall('/v1/models', { token: state.token, base: typeof llm === 'string' ? llm : undefined, headers: spaceHeaders(state) })
  if (res.status === 401 || res.status === 403) return { ok: false, error: 'catalogue_refuse', status: res.status }
  if (res.status !== 200 || res.body === null) {
    return { ok: false, error: res.status === 0 ? 'reseau' : 'catalogue_indisponible', status: res.status }
  }
  const parsed = parseCatalogIds(res.body)
  if (parsed === null) return { ok: false, error: 'catalogue_illisible', status: res.status }
  return { ok: true, models: parsed.models, embed: parsed.embed }
}

/** The workspace a model call is billed to is named by the CALLER (`x-kybernos-workspace`); without it the server bills the person's PERSONAL
 *  workspace. DSH's chat has nothing else to say it with, so the route carries the ACTIVE space's id: the one the Cloud card shows, and the one
 *  whose plan, pool and shared models (a team's own `byok/…` models) the person is meant to use. No known space, no header (the server's default). */
const SPACE_HEADER = 'x-kybernos-workspace'
const spaceHeaders = (state) => {
  const id = espaceActif(state)
  return id !== null ? { [SPACE_HEADER]: id } : undefined
}

/** The provider route written in `llm-pi-ai.providers.kybernos`. apiKeyEnv is
 *  a REFERENCE: the token lives in the credentials store, not here. */
const providerValue = (state, entries) => {
  const headers = spaceHeaders(state)
  return {
    displayName: PROVIDER_DISPLAY,
    api: 'openai-completions',
    baseURL: baseUrl(state),
    apiKeyEnv: CRED_REF,
    ...(headers !== undefined ? { headers } : {}),
    models: entries,
  }
}

/** Already imported identically? (comparison of sorted ids + plan + base) */
const catalogFingerprint = (state, entries, plan, embed, space) => JSON.stringify([
  baseUrl(state),
  plan,
  entries.map((e) => e.id).slice().sort(),
  embed === undefined || embed === null ? null : embed,
  typeof space === 'string' ? space : null,
])

/** Import (or refresh): catalogue → settings → credential → state.
 *  Never throws: each failure is an explicit reason in the response. */
const importCatalog = async (cause, options = {}) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: true, connected: false, status: 'none' }
  if (server().profile.services.llm === false) {
    const gone = await removeImportedCatalog(state)
    if (gone.removed === true) { const next = Object.assign({}, state); delete next.models; writeState(next) }
    return { ok: true, connected: true, no_llm: true, summary: null }
  }
  const cat = await fetchCatalog(state)
  if (cat.ok !== true) {
    // A 401 from the catalogue does NOT sign out (same lesson as /v1/me):
    // revocation stays decided on /v1/workspaces; the previous import stays
    // in place (stale) until that verdict.
    return { ok: false, error: cat.error, status: cat.status, summary: publicModels(state.models) }
  }
  const plan = userPlan(state)
  // Already imported identically → no write (no settings churn on
  // every refresh); the manual resynchronisation always rewrites.
  const known = state.models !== undefined && state.models !== null ? state.models : null
  if (options.force !== true && known !== null && known.provider === PROVIDER_ID
    && known.settings === true && known.credential === true
    && known.plan === plan && known.base_url === baseUrl(state)
    && Array.isArray(known.ids) === true
    && catalogFingerprint(state, known.ids.map((id) => ({ id })), plan, known.embed, known.workspace) === catalogFingerprint(state, cat.models, plan, cat.embed, espaceActif(state))) {
    if (appliedServerId() === null) markApplied()   // an install from before servers existed: this route is the active server's
    return { ok: true, connected: true, current: true, summary: publicModels(known) }
  }
  const settingsOut = await writeProviderRoute(state, cat.models)
  let credentialStored = false
  if (settingsOut.wrote === true) credentialStored = await storeCredential(state.token)
  const models = {
    imported_at: new Date().toISOString(),
    cause: typeof cause === 'string' ? cause : 'auto',
    plan,
    count: cat.models.length,
    ids: cat.models.map((e) => e.id),
    embed: cat.embed,
    // The space this route names on every call (and whose catalogue it lists): a later refresh compares it with the active one.
    workspace: espaceActif(state),
    provider: PROVIDER_ID,
    base_url: baseUrl(state),
    settings: settingsOut.wrote === true,
    credential: credentialStored,
    reason: settingsOut.wrote === true ? null : (settingsOut.reason || 'settings_absent'),
  }
  writeState(Object.assign({}, state, { models }))
  if (settingsOut.wrote === true) markApplied()
  return {
    ok: true,
    connected: true,
    current: false,
    wrote: settingsOut.wrote === true,
    reason: settingsOut.wrote === true ? null : (settingsOut.reason || 'settings_absent'),
    summary: publicModels(models),
  }
}

const writeProviderRoute = async (state, entries) => {
  const svc = service('settings')
  if (svc === null || typeof svc.mutate !== 'function') return { wrote: false, reason: 'settings_absent' }
  try {
    await svc.mutate('llm-pi-ai', [{ op: 'set', path: ['providers', PROVIDER_ID], value: providerValue(state, entries) }], undefined)
    return { wrote: true }
  } catch (e) {
    console.error('[kybernos-cloud] ecriture settings llm-pi-ai refusee : ' + String((e && e.message) || e))
    return { wrote: false, reason: 'settings_refuse' }
  }
}

const storeCredential = async (token) => {
  const cred = service('credentials')
  if (cred === null || typeof cred.set !== 'function') return false
  try { await cred.set(CRED_REF, token); return true } catch (e) {
    console.error('[kybernos-cloud] stockage credential ' + CRED_REF + ' refuse : ' + String((e && e.message) || e))
    return false
  }
}

/** Removes WHAT THIS FEATURE put there: the `providers.kybernos` route
 *  and the credential — never a kybernos route written by hand before
 *  the pairing (models.provider absent → no-op). */
const removeImportedCatalog = async (state) => {
  const imported = state !== null && state.models !== undefined && state.models !== null
    && state.models.provider === PROVIDER_ID
  if (imported !== true) return { removed: false }
  const out = { removed: true, settings: false, credential: false }
  const svc = service('settings')
  if (svc !== null && typeof svc.mutate === 'function') {
    try { await svc.mutate('llm-pi-ai', [{ op: 'unset', path: ['providers', PROVIDER_ID] }], undefined); out.settings = true } catch (e) {
      console.error('[kybernos-cloud] retrait providers.kybernos refuse : ' + String((e && e.message) || e))
    }
  }
  if (state.models.provider === PROVIDER_ID) {
    // The credential is always ours after an import (the set overwrites it on
    // every successful import): we remove it unconditionally, regardless of the LAST
    // summary — a degraded sync may have left a credential from an earlier
    // import. Removing an absent ref is a no-op.
    const cred = service('credentials')
    if (cred !== null && typeof cred.unset === 'function') {
      try { await cred.unset(CRED_REF); out.credential = true } catch (e) { /* left behind, with no consumer */ }
    }
  }
  return out
}

/** Public view of the import: no token, no secret — only the facts. */
const publicModels = (models) => {
  if (models === undefined || models === null) return null
  return {
    provider: models.provider !== undefined ? models.provider : PROVIDER_ID,
    base_url: models.base_url !== undefined ? models.base_url : null,
    imported_at: models.imported_at !== undefined ? models.imported_at : null,
    plan: models.plan !== undefined ? models.plan : null,
    count: typeof models.count === 'number' ? models.count : 0,
    ids: Array.isArray(models.ids) ? models.ids.slice() : [],
    embed: typeof models.embed === 'string' ? models.embed : null,
    settings: models.settings === true,
    credential: models.credential === true,
    cause: models.cause !== undefined ? models.cause : null,
  }
}

const addressOrigin = (url) => { try { return new URL(String(url)).origin } catch (e) { return null } }

/** A connection recorded against ANOTHER server's address than the active one's: an install from before the new server became the default
 *  (its file still says `api: <old stack>`), or a state copied by hand. Its token belongs to that server: it must not be sent to this
 *  one (the new server answers 401 and the old route kept chat and feedback going to the old address until then). A state with no
 *  `api` (a file older than the field) is trusted, as before. */
const foreignConnection = (state) => {
  if (state === null || typeof state !== 'object' || typeof state.api !== 'string' || state.api === '') return false
  const theirs = addressOrigin(state.api)
  const ours = addressOrigin(resolveApi())
  return theirs !== null && ours !== null && theirs !== ours
}

/** Boot, FIRST thing (before any timer or refresh can use the token): take a foreign connection out of the way. The file is MOVED aside
 *  under the name of its own host, never deleted (nothing is lost, an explicit opt-in to that server finds it again) and never read for
 *  this server: the person is « not connected » here and pairs again. Returns what was set aside (`{ raw }`), or null. Never throws. */
const setAsideForeignConnection = () => {
  try {
    const file = stateFile()
    const raw = readState()
    if (foreignConnection(raw) !== true) return null
    const host = String(addressOrigin(raw.api)).replace(/^[a-z]+:\/\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 60) || 'other'
    const aside = join(dirname(file), 'kybernos-cloud-' + host + '.json')
    renameSync(file, aside)
    try { chmodSync(aside, 0o600) } catch (e) { /* exotic FS */ }
    console.error('[kybernos-cloud] a connection recorded for another server (' + host + ') was set aside, not used for this one: pair again to connect to this server')
    return { raw }
  } catch (e) {
    console.error('[kybernos-cloud] could not set aside a connection of another server: ' + String((e && e.message) || e))
    return null
  }
}

/** Then, once the settings and credentials services are there: the « kybernos » model route and credential the set-aside connection
 *  imported point at the other server and go too, so chat never keeps talking to it. */
const cleanAfterForeignConnection = async (aside) => {
  try {
    await removeImportedCatalog(aside.raw)
    emptyMemoryCache()
    markApplied()
  } catch (e) { /* the route stays, without a token to use it */ }
}

/** Import at DSH start-up when the session is already alive: without it, a
 *  restarted harness would only have the models after a card was opened. */
const autoImportAtBoot = (ctx, aside) => {
  if (aside !== null && aside !== undefined) {
    const kickForeign = () => { void cleanAfterForeignConnection(aside) }
    if (ctx.get('settings') !== undefined && ctx.get('credentials') !== undefined) kickForeign()
    else ctx.inject(['settings', 'credentials'], kickForeign)
    return
  }
  // The registry may have changed while DSH was down: then the previous server's route must go, connected or not.
  const changed = appliedServerId() !== null && appliedServerId() !== server().profile.id
  if (changed !== true && isConnected(readState()) !== true) return
  const kick = () => { void (changed === true ? serverApply() : importCatalog('boot')).catch(() => {}) }
  if (ctx.get('settings') !== undefined && ctx.get('credentials') !== undefined) kick()
  else ctx.inject(['settings', 'credentials'], kick)
}

/** Which server owns the « kybernos » model route now: the one whose catalogue was imported last. */
const markApplied = () => {
  try {
    mkdirSync(dirname(appliedFile()), { recursive: true, mode: 0o700 })
    writeFileSync(appliedFile(), JSON.stringify({ id: server().profile.id, at: new Date().toISOString() }) + '\n', { mode: 0o600 })
  } catch (e) { /* the marker is a convenience: the next apply just cleans nothing */ }
}

const appliedServerId = () => {
  try {
    const marker = JSON.parse(readFileSync(appliedFile(), 'utf8'))
    return marker !== null && typeof marker === 'object' && typeof marker.id === 'string' ? marker.id : null
  } catch (e) { return null }
}

/** Which server a call went to, for a sentence that names it (« the server X (host) does not answer »): the active server's label and host, never its full address, and
 *  whether the registry names another server to switch to. A call that failed because the server did not answer carries it (the footer and the phone link say WHICH one). */
const serverIdentity = () => {
  const active = server()
  let host = ''
  try { host = new URL(active.profile.api).host } catch (e) { host = '' }
  return { name: active.profile.name, host, can_switch: active.servers.some((s) => s.id !== active.profile.id) }
}

/** GET /kybernos-cloud/server: the active server and the others the registry names. Nothing secret lives in a profile. */
const serverRoute = async () => {
  const active = server()
  // `connected`: this DSH holds a sign-in for that server (its own connection file), never anything of the token itself.
  // The active server's own file is whatever stateFile() says (KYBERNOS_CLOUD_STATE included); the others have the usual name.
  const connectedTo = (id) => {
    if (id === active.profile.id) return isConnected(readState())
    try { return isConnected(JSON.parse(readFileSync(join(dshHome(), stateFileName({ id })), 'utf8'))) } catch (e) { return false }
  }
  return { ok: true, server: publicProfile(active.profile), source: active.source, error: active.error, servers: active.servers.map((x) => Object.assign({ active: x.id === active.profile.id, connected: connectedTo(x.id) }, x)), rejected: active.rejected,
    // A cloud computer (the platform names it in the machine's environment): the suite there is the person's own, but the server's console cannot be framed by its page.
    computer: typeof process.env.KYBERNOS_COMPUTER_ID === 'string' && process.env.KYBERNOS_COMPUTER_ID !== '' }
}

/** POST /kybernos-cloud/server/apply: the registry changed (the Select server module wrote it): make DSH follow. What the
 *  previous server left (the « kybernos » model route and its credential) is removed FIRST, so chat never keeps talking to a
 *  server the user left; then the new server's catalogue is imported if this DSH is connected to it. Idempotent. */
const serverApply = async () => {
  const active = server()
  const previousId = appliedServerId()
  let cleaned = false
  if (previousId !== null && previousId !== active.profile.id) {
    try {
      const before = JSON.parse(readFileSync(join(dshHome(), stateFileName({ id: previousId })), 'utf8'))
      cleaned = (await removeImportedCatalog(before)).removed === true
    } catch (e) { /* no connection file for it: nothing was imported */ }
  }
  markApplied()
  connections.sync()
  const out = { ok: true, server: publicProfile(active.profile), source: active.source, error: active.error, cleaned, connected: isConnected(readState()) }
  if (out.connected === true) {
    const imported = await importCatalog('server', { force: true })
    out.models = imported.summary !== undefined ? imported.summary : null
    if (imported.no_llm === true) out.no_llm = true
    if (imported.ok !== true) out.import_error = imported.error
  }
  return out
}

const modelsRoute = async () => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: true, connected: false, status: 'none' }
  return { ok: true, connected: true, plan: userPlan(state), models: publicModels(state.models) }
}

/** One page of the remote catalogue (`before`: the id of the last item of the previous page; null for the first page). */
const marketplacePage = (state) => (before) => apiCall('/v1/marketplace' + (before === null ? '' : '?before=' + encodeURIComponent(before)), { token: state.token })

/**
 * The remote catalogue: what kybernos.app publishes, as it is.
 * Not linked -> an explicit `motif`; server unreachable -> a `motif` with the HTTP code.
 * It NEVER falls back on a local fixture passed off as the remote catalogue: that is exactly the lie this module replaces.
 *
 * The server pages the catalogue (200 at a time, `has_more`): every page is read (marketplace-kyber.mjs, `lireCatalogue`,
 * with hard limits). When a later page cannot be read the answer is still `ok` with the pages read, `partiel: true` and
 * a `motif` that says what is missing: the panel shows the first pages with a note, never an empty catalogue.
 */
const marketplaceRoute = async () => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, items: [], motif: 'no account linked to kybernos.app', raison: 'not-linked' }
  const cat = await lireCatalogue(marketplacePage(state))
  if (cat.echec === true) return { ok: false, connected: true, items: [], motif: cat.motif, raison: cat.raison }
  return Object.assign({ connected: true }, cat)
}

const modelsSyncRoute = async () => {
  const out = await importCatalog('manuel', { force: true })
  // Same contract as poll/refresh: the summary is read in `models`.
  return Object.assign({}, out, { models: out.summary !== undefined ? out.summary : null, summary: undefined })
}

/**
 * The referral code of the linked account (sidebar footer invitation card).
 *
 * Why a route here: the code lives in `kybernos.profiles.referral_code`
 * (RLS « select own »), and the only service that returned it — the Edge Function
 * `kybernos-referral-info` — requires a WEB JWT. The plugin only has the
 * `kys-…` device token: measured on 24/09/2026, the function answers 401
 * UNAUTHORIZED_INVALID_JWT_FORMAT. The /v1/referral route was added to the
 * proxy to give the DSH account the same truth.
 *
 * Never an invented code: `code` stays null as long as the server has not
 * returned it — the card then falls back on manual pasting, it does not lie.
 * Not linked → explicit reason; server unreachable → reason + HTTP code.
 */
const referralRoute = async () => {
  const state = readState()
  if (isConnected(state) !== true) {
    return { ok: false, connected: false, code: null, share_url: null, motif: 'no account linked to kybernos.app' }
  }
  let res = null
  try {
    res = await apiCall('/v1/referral', { token: state.token })
  } catch (e) {
    return { ok: false, connected: true, code: null, share_url: null, motif: 'parrainage injoignable : ' + String(e !== null && e.message !== undefined ? e.message : e) }
  }
  if (res === null || res.status !== 200 || res.body === null) {
    return { ok: false, connected: true, code: null, share_url: null, motif: 'parrainage indisponible (code ' + String(res === null ? 'inconnu' : res.status) + ')' }
  }
  const brut = res.body.code
  const code = typeof brut === 'string' && brut.trim() !== '' ? brut.trim() : null
  const lien = res.body.share_url
  const brutLien = typeof lien === 'string' && lien.trim() !== '' ? lien.trim() : null
  // No code → no link: a share_url without a code leads to an empty /r/. The
  // server does not produce it (it only builds the link with a code), but
  // the plugin never relays a dead link.
  const share = code === null ? null : brutLien
  // `ok: true` even without a code: the account answers, it simply has no code
  // yet — the card must be able to say that instead of asking for a paste.
  return { ok: true, connected: true, code: code, share_url: share, motif: code === null ? 'ce compte n a pas encore de code de parrainage' : null }
}

// ── Routes ──────────────────────────────────────────────────────────────────

const sendJson = (res, status, payload) => {
  try {
    const body = JSON.stringify(payload === undefined ? null : payload)
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(body)
  } catch (e) {
    try { res.writeHead(500); res.end('{}') } catch (e2) { /* socket closed */ }
  }
}

/** JSON body of a local request (bounded): `{}` if absent or unreadable. */
const readJsonBody = async (req, cap) => {
  const max = typeof cap === 'number' ? cap : 65536
  try {
    let size = 0
    const chunks = []
    for await (const chunk of req) {
      size += chunk.length
      if (size > max) return {}
      chunks.push(chunk)
    }
    const text = Buffer.concat(chunks).toString('utf8')
    if (text.length === 0) return {}
    const parsed = JSON.parse(text)
    return (parsed !== null && typeof parsed === 'object') ? parsed : {}
  } catch (e) { return {} }
}

/** The authority a request must name to be about THIS listener: the port the socket is really bound to, on 127.0.0.1 / localhost / [::1], or an authority the
 *  operator declared to DSH (`--trusted-host`). Null when the request has no socket (a test, a synthetic caller): nothing to compare with. */
const listenerAuthority = (req) => {
  const sock = req !== null && req !== undefined && req.socket !== null && req.socket !== undefined ? req.socket : null
  if (sock === null || typeof sock.localPort !== 'number') return null
  const port = ':' + sock.localPort
  return (authority) => ['127.0.0.1' + port, 'localhost' + port, '[::1]' + port].indexOf(authority) >= 0 || kbTrusted(authority)
}
/** False when the Host header names an authority that is not this listener's: a page that rebinds its own name to this machine (DNS rebinding) reaches the
 *  routes with Host = its own name. DSH serves plugin routes BEFORE its own authentication and its `/api` Host fence does not cover them, so this is the
 *  fence. Applied to every route, the open ones (status, server, models) included. */
const hostAllowed = (req) => {
  try {
    const mine = listenerAuthority(req)
    const host = req.headers !== null && req.headers !== undefined && typeof req.headers.host === 'string' ? req.headers.host : null
    return mine === null || host === null || mine(host) === true
  } catch (e) { return false }
}

/** Same guard as the other local routes: never cross-origin.
 *  On a real connection the Origin is compared with what THIS listener really is, never with the Host header alone: « Origin.host === Host » let a page
 *  that rebinds its name send the same attacker-chosen authority as both (measured in the pre-production acceptance: memory/add and space/create
 *  answered 200 to Host = Origin = attacker.example). A request with no socket keeps the old comparison. */
const sameOrigin = (req) => {
  try {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : null
    const host = typeof req.headers.host === 'string' ? req.headers.host : null
    const mine = listenerAuthority(req)
    if (mine !== null) {
      if (host !== null && mine(host) !== true) return false
      return origin === null ? true : mine(new URL(origin).host) === true
    }
    if (origin === null || host === null) return true
    return new URL(origin).host === host
  } catch (e) {
    return false
  }
}

/** Strict variant for a route that hands out the account's data with its token: a request that names no origin at all is
 *  refused (any local process can omit a header; a browser page always sends Origin or Referer), and the origin must be
 *  this server's own address, taken from the socket and not from the client-supplied Host header. */
const sameOriginStrict = (req) => {
  try {
    const headers = req !== null && req !== undefined && req.headers !== null && req.headers !== undefined ? req.headers : {}
    const source = typeof headers.origin === 'string' && headers.origin !== '' ? headers.origin : (typeof headers.referer === 'string' && headers.referer !== '' ? headers.referer : null)
    if (source === null) return false
    const u = new URL(source)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const sock = req.socket !== null && req.socket !== undefined ? req.socket : null
    const port = sock !== null && typeof sock.localPort === 'number' ? ':' + sock.localPort : ''
    return (['127.0.0.1' + port, 'localhost' + port, '[::1]' + port].indexOf(u.host) >= 0 || kbTrusted(u.host))
  } catch (e) { return false }
}

// ── Relay for the Team settings console (read only, phase 1) ───────────────────
// The console is a page of another origin shown in an iframe: it must never hold a session token. It asks its parent page,
// the parent calls THIS route, and this route adds the token and calls the main API: only on the allowlist below, only GET,
// only for a workspace of this account. The server checks the caller's role again (docs/specs/2026-10-05-team-console-wiring.md).
const UUID_SRC = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const RELAY_DATE = /^\d{4}-\d{2}-\d{2}([T ][0-9:.]{1,16}(Z|[+-]\d{2}:?\d{2})?)?$/
const RELAY_UUID = new RegExp('^' + UUID_SRC + '$', 'i')
/** A decimal integer within [min, max], written plainly (no sign, no leading zero, no exponent): the server's own bound for the parameter. */
const relayInt = (min, max) => (v) => /^[1-9]\d{0,3}$/.test(v) && Number(v) >= min && Number(v) <= max
const relayUuid = (v) => RELAY_UUID.test(v)

// The two reads that are the most personal of the list: the person's own API keys (names, 8-character prefix, dates, status: never a secret) and the team's trail
// (who joined, left, was invited, changed role; the server answers owners and admins only). Each is behind its own switch: a host that does not want one of them
// reachable from the frame sets it to false and the relay refuses that path, nothing else changes (README: « Team console relay »).
const RELAY_ALLOW_API_KEYS_LIST = true
const RELAY_ALLOW_TEAM_AUDIT_TRAIL = true

/** The allowlist, as a function of the two switches above (the tests build it both ways). A rule is `{ re, query }`: the path, and the query keys it takes, each with
 *  the check its value must pass (`check`, a date by default; `choices`, a closed set). Every rule is a GET and the whole list is read only: a write is a door to the browser. */
const relayRules = (opts = {}) => {
  const rules = [
    { re: /^\/v1\/me$/, query: [] },
    // The read-only pages of the account the console shows in DSH's frame (Account, Referral): the profile (above), the person's sessions and the referral card.
    { re: /^\/v1\/sessions$/, query: [] },
    { re: /^\/v1\/referral$/, query: [] },
    // The account's security (is a second factor on: status only, never a secret) and the server's legal page (terms, privacy, support addresses): the Security and
    // Support & legal pages of the same frame. Exact paths: the writes of the second factor (`/v1/me/mfa/...`) are not named.
    { re: /^\/v1\/me\/mfa$/, query: [] },
    { re: /^\/v1\/public\/legal$/, query: [] },
    { re: /^\/v1\/workspaces$/, query: [] },
    { re: new RegExp('^/v1/workspaces/(' + UUID_SRC + ')/(members|providers|models)$', 'i'), query: [] },
    { re: new RegExp('^/v1/workspaces/(' + UUID_SRC + ')/llm/(budget|models|catalog|billing)$', 'i'), query: [] },
    // The team's metadata the frame's pages draw (Members, Models, Billing, Team security, Computers). Every one answers owners and admins only on the server's side
    // (a member gets a 403 that comes back as it is); the team's own keys come back with their last four characters only.
    { re: new RegExp('^/v1/workspaces/(' + UUID_SRC + ')/(invitations|security|computers|computers/usage)$', 'i'), query: [] },
    { re: new RegExp('^/v1/workspaces/(' + UUID_SRC + ')/llm/(member-limits|byok|byok/credentials|byok/models|provider-policy|provider-acceptances)$', 'i'), query: [] },
    // `group_by` is one of the server's four groupings (the team console asks for `detail`: one row per day, member and model).
    { re: new RegExp('^/v1/workspaces/(' + UUID_SRC + ')/llm/usage$', 'i'), query: ['from', 'to', 'group_by'], choices: { group_by: ['model', 'day', 'member', 'detail'] } },
  ]
  if (opts.apiKeysList === true) {
    // GET /v1/keys: `limit` 1 to 200 and the workspace the keys belong to (the server's own bounds); no cursor, no other key.
    rules.push({ re: /^\/v1\/keys$/, query: ['limit', 'workspace_id'], check: { limit: relayInt(1, 200), workspace_id: relayUuid }, workspaceQuery: 'workspace_id' })
  }
  if (opts.auditTrail === true) {
    // GET /v1/workspaces/{id}/audit: `limit` 1 to 100, `before` the id of the last entry of the previous page (a UUID). The export is another path and is not named.
    rules.push({ re: new RegExp('^/v1/workspaces/(' + UUID_SRC + ')/audit$', 'i'), query: ['limit', 'before'], check: { limit: relayInt(1, 100), before: relayUuid } })
  }
  return rules
}
const RELAY_RULES = relayRules({ apiKeysList: RELAY_ALLOW_API_KEYS_LIST, auditTrail: RELAY_ALLOW_TEAM_AUDIT_TRAIL })

/** `{ ok, path }` (the canonical path to call) or `{ ok: false, error }`. Pure: a path the allowlist does not name, a
 *  workspace that is not one of the account's, a query parameter other than a date `from` / `to` (or a known `group_by` on usage), is refused. */
const relayCheck = (target, state, rules = RELAY_RULES) => {
  const refused = { ok: false, error: 'chemin refuse' }
  if (typeof target !== 'string' || target.length === 0 || target.length > 300 || target[0] !== '/') return refused
  let u = null
  try { u = new URL(target, 'http://relay.invalid') } catch (e) { return refused }
  // A path the URL parser rewrites (dot segments, doubled slashes, an encoded trick) is not the path we were asked for.
  if (u.origin !== 'http://relay.invalid' || u.pathname !== target.split('?')[0]) return refused
  const rule = rules.find((r) => r.re.test(u.pathname))
  if (rule === undefined) return refused
  const seen = new Set()
  const query = []
  let askedWorkspace = null
  for (const [k, v] of u.searchParams) {
    if (rule.query.indexOf(k) < 0 || seen.has(k)) return refused
    const choices = rule.choices !== undefined ? rule.choices[k] : undefined
    const check = rule.check !== undefined ? rule.check[k] : undefined
    if (check !== undefined) { if (check(v) !== true) return refused } else if (choices !== undefined ? choices.indexOf(v) < 0 : RELAY_DATE.test(v) !== true) return refused
    if (rule.workspaceQuery === k) askedWorkspace = v
    seen.add(k)
    query.push(k + '=' + encodeURIComponent(v))
  }
  // A workspace the path names, or the one a query names, must be one of this account's: the server checks the caller's role again.
  const m = u.pathname.match(new RegExp('^/v1/workspaces/(' + UUID_SRC + ')/', 'i'))
  const named = m !== null ? m[1] : askedWorkspace
  if (named !== null) {
    const known = (state !== null && state !== undefined && Array.isArray(state.workspaces) ? state.workspaces : [])
    if (known.some((w) => w !== null && typeof w === 'object' && String(w.id).toLowerCase() === named.toLowerCase()) !== true) return { ok: false, error: 'espace_inconnu' }
  }
  return { ok: true, path: u.pathname + (query.length > 0 ? '?' + query.join('&') : '') }
}

const relayRoute = async (req) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, status: 'none', error: 'non connecte' }
  let target = ''
  try { target = new URL(req.url, 'http://localhost').searchParams.get('p') || '' } catch (e) { target = '' }
  const verdict = relayCheck(target, state)
  if (verdict.ok !== true) return { ok: false, error: verdict.error }
  const res = await apiCall(verdict.path, { token: state.token })
  return { ok: res.status >= 200 && res.status < 300, status: res.status, body: res.body }
}

// ── The team console in the user's browser (the new server, ADR 0005 § 5) ──────
// The console page is served by the server and, in a browser, uses the person's own session. DSH holds a device token and a token never goes through a
// browser: it asks the server for a single-use link (valid 60 seconds) and hands THAT to the browser. The link is a bearer capability, so it is only
// returned when it points at the server this account is connected to (a hostile or broken answer cannot send the browser elsewhere), and the route is strict
// (a page of another origin cannot ask DSH for it).
/** Where a console link may land (`/account#<section>`): a short slug of the server's own page names, never a path or an address. */
const LINK_SECTION_RE = /^[a-z][a-z0-9-]{0,31}$/

/** « open: true »: this host runs on the person's machine, so it opens the SYSTEM browser with the address. Only for a caller on this machine; the address is handed back
 *  (opened: false) when no browser could be opened, and is NOT when one was. `extra` is merged into the answer (what the call is about). */
const openOrHandBack = async (req, body, url, deps, extra) => {
  if (body !== null && typeof body === 'object' && body.open === true) {
    const peer = req !== null && req !== undefined && req.socket !== null && req.socket !== undefined ? String(req.socket.remoteAddress || '') : ''
    let opened = false
    if (['127.0.0.1', '::1', '::ffff:127.0.0.1'].indexOf(peer) >= 0) {
      try { opened = (await (deps.openExternal || openExternal)(url)) === true } catch (e) { opened = false }
    }
    return opened ? Object.assign({ ok: true, opened: true }, extra) : Object.assign({ ok: true, opened: false, url }, extra)
  }
  return Object.assign({ ok: true, url }, extra)
}

const consoleLink = async (req, body, deps = {}) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, status: 'none', error: 'non connecte' }
  const asked = body !== null && typeof body === 'object' && typeof body.workspace_id === 'string' ? body.workspace_id.trim().toLowerCase() : ''
  const section = body !== null && typeof body === 'object' && typeof body.section === 'string' && LINK_SECTION_RE.test(body.section.trim()) ? body.section.trim() : ''
  const known = Array.isArray(state.workspaces) ? state.workspaces : []
  const mine = (id) => known.some((w) => w !== null && typeof w === 'object' && String(w.id).toLowerCase() === id)
  if (asked !== '' && (new RegExp('^' + UUID_SRC + '$', 'i').test(asked) !== true || mine(asked) !== true)) return { ok: false, error: 'espace_inconnu' }
  const ask = (withSection) => apiCall('/v1/console/link', { method: 'POST', token: state.token, body: Object.assign(asked === '' ? {} : { workspace_id: asked }, withSection ? { section } : {}) })
  let res = await ask(section !== '')
  // A server that does not know `section` yet either ignores it (the link lands on its plan page) or refuses the body: ask again without it.
  if (section !== '' && (res.status === 400 || res.status === 422)) res = await ask(false)
  if (res.status !== 200 || res.body === null || typeof res.body !== 'object') return { ok: false, status: res.status, error: res.status === 0 ? 'injoignable' : 'refuse', ...(res.status === 0 ? { server: serverIdentity() } : {}) }
  let url = null
  try {
    const u = new URL(String(res.body.url))
    if ((u.protocol === 'https:' || u.protocol === 'http:') && u.origin === new URL(resolveApi()).origin) url = u.toString()
  } catch (e) { url = null }
  if (url === null) return { ok: false, status: res.status, error: 'lien_invalide' }
  const expires = typeof res.body.expires_in === 'number' ? res.body.expires_in : 60
  // The server refuses a single-use link that arrives as a navigation a page started (a tab opened by this DSH page, pointed at the link, is « cross-site » for it:
  // the person lands on « link expired »), and accepts one the person's own OS opened (ADR 0005 § 5 of the server).
  return openOrHandBack(req, body, url, deps, { expires_in: expires })
}

// ── Plans and payment, for the upgrade popup (the pricing table and « Subscribe ») ──────────────────────────────────────────────────────────
// The catalogue and the quotes are PUBLIC on the server; buying is the workspace's owner or admin (the server decides: a 403 comes back as such). The popup is a page of
// DSH, so the device token stays here: it asks these routes, which add it. Every answer is reduced to what the popup shows — a status and the server's error CODE, never
// its sentence — and the payment page is opened in the system browser, like the console link.
const PLAN_KEY_RE = /^[a-z0-9][a-z0-9-]{0,62}$/
const PLAN_COMPONENT_RE = /^[A-Za-z0-9:_-]{1,64}$/
const CURRENCY_RE = /^[A-Za-z]{3}$/
const ERROR_CODE_RE = /^[a-z][a-z0-9_]{0,48}$/

/** A failed call, as the popup needs it. `status` 0 = the server did not answer. */
const billingFailure = (res) => {
  const code = res.body !== null && res.body !== undefined && typeof res.body === 'object' && typeof res.body.error === 'string' && ERROR_CODE_RE.test(res.body.error) ? res.body.error : null
  return { ok: false, status: res.status, error: code !== null ? code : (res.status === 0 ? 'injoignable' : 'refuse') }
}
const queryOf = (req) => { try { return new URL(String(req.url), 'http://localhost').searchParams } catch (e) { return new URLSearchParams() } }
const asPriceText = (v) => (typeof v === 'string' && v.length <= 24 ? v : null)

/** GET /kybernos-cloud/plans?currency=: the plans on sale (levels, seat bands, top-up packs), from the active server. Public: no token is sent. */
const plansRoute = async (req) => {
  const currency = (queryOf(req).get('currency') || '').trim()
  if (currency !== '' && CURRENCY_RE.test(currency) !== true) return { ok: false, status: 400, error: 'unknown_currency' }
  const res = await apiCall('/v1/plans' + (currency === '' ? '' : '?currency=' + encodeURIComponent(currency.toUpperCase())))
  if (res.status !== 200 || res.body === null || typeof res.body !== 'object' || Array.isArray(res.body.plans) !== true) return billingFailure(res)
  return {
    ok: true,
    plans: res.body.plans,
    credits_per_usd: typeof res.body.credits_per_usd === 'number' ? res.body.credits_per_usd : null,
    tax_basis: ['inclusive', 'exclusive', 'not_stated'].indexOf(res.body.tax_basis) >= 0 ? res.body.tax_basis : 'not_stated',
  }
}

/** GET /kybernos-cloud/plans/quote?plan=&currency=&component=&quantity=&interval=: what a purchase costs. Public: no token is sent. */
const planQuote = async (req) => {
  const q = queryOf(req)
  const plan = (q.get('plan') || '').trim()
  const currency = (q.get('currency') || '').trim()
  const component = (q.get('component') || '').trim()
  const interval = (q.get('interval') || '').trim()
  const quantityRaw = (q.get('quantity') || '1').trim()
  const quantity = /^\d{1,6}$/.test(quantityRaw) ? Number(quantityRaw) : NaN
  if (PLAN_KEY_RE.test(plan) !== true || CURRENCY_RE.test(currency) !== true || (component !== '' && PLAN_COMPONENT_RE.test(component) !== true)
    || (interval !== '' && interval !== 'year' && interval !== 'month') || !(quantity >= 1 && quantity <= 100000)) return { ok: false, status: 400, error: 'bad_request' }
  const query = ['currency=' + encodeURIComponent(currency.toUpperCase()), 'quantity=' + quantity]
  if (component !== '') query.push('component=' + encodeURIComponent(component))
  if (interval !== '') query.push('interval=' + interval)
  const res = await apiCall('/v1/plans/' + plan + '/quote?' + query.join('&'))
  if (res.status !== 200 || res.body === null || typeof res.body !== 'object' || asPriceText(res.body.total) === null) return billingFailure(res)
  const b = res.body
  return {
    ok: true,
    quote: {
      currency: typeof b.currency === 'string' ? b.currency : currency.toUpperCase(),
      interval: b.interval === 'year' || b.interval === 'month' || b.interval === 'once' ? b.interval : null,
      total: asPriceText(b.total),
      monthly_total: asPriceText(b.monthly_total),
      tax_basis: ['inclusive', 'exclusive', 'not_stated'].indexOf(b.tax_basis) >= 0 ? b.tax_basis : 'not_stated',
      lines: (Array.isArray(b.lines) ? b.lines : []).slice(0, 12).filter((l) => l !== null && typeof l === 'object').map((l) => ({
        label: typeof l.label === 'string' ? l.label.slice(0, 80) : '', quantity: Number.isFinite(l.quantity) ? l.quantity : 1,
        unit: asPriceText(l.unit), subtotal: asPriceText(l.subtotal),
      })),
    },
  }
}

/** The workspace a billing call is for: the one asked, else the active one; it must be one of the account's. */
const billingWorkspace = (state, body) => {
  const asked = body !== null && typeof body === 'object' && typeof body.workspace_id === 'string' ? body.workspace_id.trim().toLowerCase() : ''
  const known = Array.isArray(state.workspaces) ? state.workspaces : []
  // No workspace asked: the active one, which is the first when none was chosen (the same rule as everywhere else: espaceActif).
  const active = espaceActif(state)
  const id = asked !== '' ? asked : (typeof active === 'string' ? active.trim().toLowerCase() : '')
  const mine = known.some((w) => w !== null && typeof w === 'object' && String(w.id).toLowerCase() === id)
  return id !== '' && new RegExp('^' + UUID_SRC + '$', 'i').test(id) && mine ? id : null
}

/** Where the payment page and the portal send the person back to: the server's own web app, on this workspace's plan page (its own address is a trusted one). */
const billingBackUrl = (workspaceId, flag) => resolveWeb().replace(/\/+$/, '') + '/account?' + flag + '#plan&ws=' + workspaceId

/** Both payment calls hand over a page of the payment provider: http(s) only, and in the system browser when asked (never a page of this DSH). */
const billingPage = async (req, body, res, deps) => {
  let url = null
  try {
    const u = new URL(String(res.body.url))
    if (u.protocol === 'https:' || u.protocol === 'http:') url = u.toString()
  } catch (e) { url = null }
  if (url === null) return { ok: false, status: res.status, error: 'lien_invalide' }
  return openOrHandBack(req, body, url, deps, {})
}

/** POST /kybernos-cloud/billing/checkout: { workspace_id?, plan, component?, quantity?, currency, interval?, open? } → the payment page of that purchase. */
const billingCheckout = async (req, body, deps = {}) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, status: 'none', error: 'non connecte' }
  const b = body !== null && typeof body === 'object' ? body : {}
  const workspaceId = billingWorkspace(state, b)
  if (workspaceId === null) return { ok: false, error: 'espace_inconnu' }
  const plan = typeof b.plan === 'string' ? b.plan.trim() : ''
  const component = typeof b.component === 'string' ? b.component.trim() : ''
  const currency = typeof b.currency === 'string' ? b.currency.trim() : ''
  const interval = typeof b.interval === 'string' ? b.interval.trim() : ''
  const quantity = b.quantity === undefined ? 1 : b.quantity
  if (PLAN_KEY_RE.test(plan) !== true || CURRENCY_RE.test(currency) !== true || (component !== '' && PLAN_COMPONENT_RE.test(component) !== true)
    || (interval !== '' && interval !== 'year' && interval !== 'month') || Number.isInteger(quantity) !== true || quantity < 1 || quantity > 100000) return { ok: false, status: 400, error: 'bad_request' }
  const payload = { plan, quantity, currency: currency.toUpperCase() }
  if (component !== '') payload.component = component
  if (interval !== '') payload.interval = interval
  const ask = (withBack) => apiCall('/v1/workspaces/' + workspaceId + '/billing/checkout', {
    method: 'POST', token: state.token,
    body: withBack ? Object.assign({}, payload, { success_url: billingBackUrl(workspaceId, 'paid=1'), cancel_url: billingBackUrl(workspaceId, 'paid=0') }) : payload,
  })
  let res = await ask(true)
  // A server whose web app is not on its list of trusted redirects refuses the return addresses: its own default (its home page) is fine.
  if (res.status === 422 && res.body !== null && typeof res.body === 'object' && res.body.error === 'invalid_redirect') res = await ask(false)
  if (res.status !== 200 || res.body === null || typeof res.body !== 'object') return billingFailure(res)
  return billingPage(req, b, res, deps)
}

/** POST /kybernos-cloud/billing/portal: { workspace_id?, open? } → the payment provider's customer portal (card, invoices, cancellation). */
const billingPortal = async (req, body, deps = {}) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, status: 'none', error: 'non connecte' }
  const b = body !== null && typeof body === 'object' ? body : {}
  const workspaceId = billingWorkspace(state, b)
  if (workspaceId === null) return { ok: false, error: 'espace_inconnu' }
  const ask = (withBack) => apiCall('/v1/workspaces/' + workspaceId + '/billing/portal', { method: 'POST', token: state.token, body: withBack ? { return_url: billingBackUrl(workspaceId, 'back=1') } : {} })
  let res = await ask(true)
  if (res.status === 422 && res.body !== null && typeof res.body === 'object' && res.body.error === 'invalid_redirect') res = await ask(false)
  if (res.status !== 200 || res.body === null || typeof res.body !== 'object') return billingFailure(res)
  return billingPage(req, b, res, deps)
}

/** Opens an http(s) address in the system browser, from the process that runs on the person's machine. True when it was handed over, false when it could not be (no desktop,
 *  no opener, a refusal). Never a shell: the address is ONE argument (a `&` in it must not become a command), and nothing but http(s) is ever handed over. */
const openExternal = (url, { platform = process.platform, env = process.env, spawnFn = spawn, waitMs = 3000 } = {}) => new Promise((resolve) => {
  let ok = false
  try { const u = new URL(String(url)); ok = u.protocol === 'https:' || u.protocol === 'http:' } catch (e) { ok = false }
  if (ok !== true) { resolve(false); return }
  let cmd = null
  let args = []
  if (platform === 'darwin') { cmd = 'open'; args = [String(url)] }
  else if (platform === 'win32') { cmd = 'rundll32'; args = ['url.dll,FileProtocolHandler', String(url)] }
  else if ((typeof env.DISPLAY === 'string' && env.DISPLAY !== '') || (typeof env.WAYLAND_DISPLAY === 'string' && env.WAYLAND_DISPLAY !== '')) { cmd = 'xdg-open'; args = [String(url)] }
  if (cmd === null) { resolve(false); return }
  let done = false
  let timer = null
  const finish = (value) => { if (done) return; done = true; if (timer !== null) clearTimeout(timer); resolve(value) }
  try {
    const child = spawnFn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true })
    child.once('error', () => finish(false))
    child.once('exit', (code) => finish(code === 0))
    if (typeof child.unref === 'function') child.unref()
    // An opener that keeps running (xdg-open waits for some browsers) has handed the address over.
    timer = setTimeout(() => finish(true), waitMs)
    if (typeof timer.unref === 'function') timer.unref()
  } catch (e) { finish(false) }
})

/** How much of a budget window is used, as the whole percent people are shown (never tokens, never dollars): the server's own `used_percent` when it gives one,
 *  else computed from what it spent and its limit by the same rule (100 only when used up, at least 1 once anything was spent, never 100 before). Null: unlimited,
 *  or nothing readable. */
const budgetPercent = (w) => {
  if (w === null || typeof w !== 'object') return null
  if (typeof w.used_percent === 'number' && Number.isFinite(w.used_percent)) return Math.min(100, Math.max(0, Math.round(w.used_percent)))
  if (w.limit_usd === null || w.limit_usd === undefined) return null
  const limit = Number(w.limit_usd)
  const used = Number(w.spent_usd)
  if (!Number.isFinite(limit) || !Number.isFinite(used)) return null
  if (limit <= 0 || used >= limit) return 100
  if (used <= 0) return 0
  return Math.min(99, Math.max(1, Math.round((used / limit) * 100)))
}

/** One window of the server's budget as the notice and the card read it: its length, whose it is (`member`: the person's own, `pool`: the team's), where its limit
 *  comes from, how much is used and, only while it is used up, when it opens again. No amounts of money: the allowance is a percentage. Null for a window that is
 *  unlimited or unreadable. */
const budgetWindowView = (w) => {
  if (w === null || typeof w !== 'object' || (w.kind !== 'member' && w.kind !== 'pool') || !Number.isFinite(w.window_seconds)) return null
  const exhausted = w.exhausted === true
  const percent = exhausted ? 100 : budgetPercent(w)
  if (percent === null) return null
  const at = typeof w.resets_at === 'string' && Number.isFinite(Date.parse(w.resets_at)) ? new Date(Date.parse(w.resets_at)).toISOString() : null
  return { kind: w.kind, window_seconds: w.window_seconds, scope: typeof w.scope === 'string' ? w.scope : 'plan', used_percent: percent, exhausted, resets_at: exhausted ? at : null }
}

/** What stopped the person's last call, for the notice that replaces DSH's « Request quota exhausted » (its own words, the same for every refusal: a window used up,
 *  a cap, a failed payment), and what the card of the active team shows as its meter. The facts are the server's, for the ACTIVE space and with the device token,
 *  which never leaves here: every window as a percent (the person's own, and the team's pool, which turns everyone away when it is used up) and whether the plan's
 *  payment is blocked. A server that does not answer gives no facts, and the notice then says what DSH said. */
const quotaFacts = async () => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, status: 'none' }
  const id = espaceActif(state)
  if (id === null) return { ok: false, error: 'espace_absent' }
  const [plan, budget] = await Promise.all([
    apiCall('/v1/workspaces/' + encodeURIComponent(id) + '/plan', { token: state.token }),
    apiCall('/v1/workspaces/' + encodeURIComponent(id) + '/llm/budget', { token: state.token }),
  ])
  if (plan.status !== 200 || plan.body === null || typeof plan.body !== 'object' || budget.status !== 200 || budget.body === null || typeof budget.body !== 'object') return { ok: false, error: 'indisponible' }
  const known = Array.isArray(state.workspaces) ? state.workspaces.filter((w) => w !== null && typeof w === 'object' && w.id === id)[0] : undefined
  const usage = (Array.isArray(budget.body.windows) ? budget.body.windows : []).map(budgetWindowView).filter((w) => w !== null)
    .sort((a, b) => a.window_seconds - b.window_seconds || (a.kind === b.kind ? 0 : a.kind === 'member' ? -1 : 1))
  // The server's own clock, as it stamped the answer (a Date header, one-second resolution): the page subtracts ITS clock when it receives this, so a used-up
  // window's `resets_at` (the server's time) is told against the server's now, whatever the person's clock says. Null when the server sent no usable Date.
  const stamped = Date.parse(String(budget.date !== null && budget.date !== undefined ? budget.date : plan.date))
  return {
    ok: true,
    workspace: { id, name: known !== undefined && typeof known.name === 'string' ? known.name : null, role: known !== undefined && typeof known.role === 'string' ? known.role : null, personal: known !== undefined && known.personal === true },
    payment_blocked: plan.body.payment_blocked === true,
    usage,
    server_time: Number.isFinite(stamped) ? new Date(stamped).toISOString() : null,
  }
}

// ── Artifacts (phase A) ─────────────────────────────────────────────────────
// The artifact from the local chat goes to `kybernos.artifacts` through `/v1/artifacts`
// (the app computes the sha256, resolves the implicit objective, uploads to the private
// bucket). Here we only carry the token: the client never touches it.
// Content bounded on the plugin side (the local body is bounded to 64 KiB by default);
// the app refuses anything above 8 MiB.
const ARTIFACT_CONTENT_MAX = 4 * 1024 * 1024

const artifactError = (res, fallback) => {
  const detail = res && res.body && typeof res.body.error === 'string' ? res.body.error : null
  return detail !== null ? detail : (res && res.error ? res.error : fallback)
}

const artifactPush = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, status: 'none', error: 'non connecte' }
  const text = (v) => (typeof v === 'string' ? v.trim() : '')
  const deliverableType = text(body.deliverable_type)
  const filename = text(body.filename)
  const title = text(body.title)
  const contentB64 = typeof body.content_b64 === 'string' ? body.content_b64 : ''
  if (contentB64 === '') return { ok: false, error: 'content_b64 requis' }
  if (title === '' && filename === '') return { ok: false, error: 'title ou filename requis' }
  if (contentB64.length > ARTIFACT_CONTENT_MAX) {
    return { ok: false, error: 'contenu trop gros (max ' + ARTIFACT_CONTENT_MAX + ' octets)' }
  }
  const payload = { content_b64: contentB64 }
  if (deliverableType !== '') payload.deliverable_type = deliverableType
  if (filename !== '') payload.filename = filename
  if (title !== '') payload.title = title
  if (text(body.mime) !== '') payload.mime = text(body.mime)
  if (text(body.kind) !== '') payload.kind = text(body.kind)
  const push = {}
  for (const key of ['session_id', 'run_id', 'workspace_id']) {
    if (text(body[key]) !== '') push[key] = text(body[key])
  }
  if (Object.keys(push).length > 0) payload.push = push
  const res = await apiCall('/v1/artifacts', { method: 'POST', token: state.token, body: payload })
  if (res.status !== 200 && res.status !== 201) {
    return { ok: false, status: res.status, error: artifactError(res, 'poussee refusee') }
  }
  const out = res.body !== null && typeof res.body === 'object' ? res.body : {}
  return { ok: true, created: out.created === true, artifact: out.artifact, status: res.status }
}


// ── Sharing (core.shares) ────────────────────────────────────────────
// Three DISTINCT paths: the router indexes by path, two routes on
// `/shares` would mask each other (observed on `/memory`).
// The audience is derived server-side (only_me | link | password); the
// password is returned only ONCE, by the call that sets or rotates it.
const shareError = (res, fallback) => {
  const detail = res && res.body && typeof res.body.error === 'string' ? res.body.error : null
  return detail !== null ? detail : (res && res.error ? res.error : fallback)
}

/** True when the SERVER says it has no such route (the new server's answer to an unknown path: 404 `{error:'not_found', message:'No such route.'}`).
 *  Public links and hosted chats (`/v1/shares`, `/v1/chats`) are paused on the new server (its ADR 0007 § 7): the pages are told
 *  « not on this server » instead of showing a raw `not_found`, and hide the control. A 404 about a resource has another message. */
const routeAbsent = (res) => res !== null && res !== undefined && res.status === 404 && res.body !== null && typeof res.body === 'object' && res.body.error === 'not_found' && /no such route/i.test(String(res.body.message === undefined ? '' : res.body.message))

// ── DSH chats → webapp (session directory) ───────────────────────────────────
// Pushes the LIST of local sessions (<DSH home>/sessions) to
// POST /v1/dsh/sessions — METADATA ONLY (session id, project, date,
// nothing of the conversations' content: the .jsonl.zstd files are never opened).
// The webapp reads the same list (GET /v1/dsh/sessions) to display
// « DSH Conversations ». Idempotent: the server upserts by (user, dsh_id).
const CHATS_PUSH_MAX = 100

const projetDuSlug = (slug) => {
  // « --Users-me-dev-kybernos-- » → « kybernos »; « ~0020 » = a space.
  const segments = String(slug || '').split('-').filter((s) => s !== '')
  const dernier = segments.length > 0 ? segments[segments.length - 1] : ''
  return dernier.split('~').join(' ').trim()
}

const chatsScan = () => {
  const items = []
  const sessions = sessionsHome()
  let slugs = []
  try {
    slugs = readdirSync(sessions)
  } catch (e) {
    return { items, error: 'sessions illisibles' }
  }
  // Real titles of renamed sessions (<DSH home>/kybernos/categories.json,
  // kept by the kybernos-sessions plugin) — fallback: the project name from the slug.
  let titres = {}
  try {
    titres = JSON.parse(readFileSync(categoriesFile(), 'utf8')) || {}
  } catch (e) { /* no renames: project from the slug for everyone */ }
  const titreDe = (sessionId, projet) => {
    const t = titres[sessionId] && typeof titres[sessionId].titre === 'string' ? titres[sessionId].titre.trim() : ''
    return t !== '' ? t : (projet !== '' ? projet : 'Session DSH')
  }
  for (const slug of slugs) {
    let sessionDirs = []
    try {
      sessionDirs = readdirSync(join(sessions, slug))
    } catch (e) {
      continue
    }
    for (const dir of sessionDirs) {
      if (!dir.startsWith('session-')) continue
      const dossier = join(sessions, slug, dir)
      let dernierMtimeMs = 0
      try {
        for (const f of readdirSync(dossier)) {
          if (!f.endsWith('.zstd')) continue
          const st = statSync(join(dossier, f))
          if (st.mtimeMs > dernierMtimeMs) dernierMtimeMs = st.mtimeMs
        }
      } catch (e) { /* unreadable session: skipped */ }
      if (dernierMtimeMs === 0) continue
      const projet = projetDuSlug(slug)
      items.push({
        dsh_id: dir,
        title: titreDe(dir, projet),
        kyber_name: '',
        preview: '',
        last_active: new Date(dernierMtimeMs).toISOString(),
      })
    }
  }
  items.sort((a, b) => (a.last_active < b.last_active ? 1 : -1))
  return { items: items.slice(0, CHATS_PUSH_MAX) }
}

const chatsPushRoute = async () => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  const { items, error } = chatsScan()
  if (error !== undefined) return { ok: false, error }
  if (items.length === 0) return { ok: false, error: 'no local session found' }
  const res = await apiCall('/v1/dsh/sessions', {
    method: 'POST',
    token: state.token,
    body: { sessions: items },
  })
  const ok = res.status === 200 || res.status === 201
  const detail = res && res.body && typeof res.body.error === 'string' ? res.body.error : null
  const out = {
    ok,
    scanned: items.length,
    pushed: ok && res.body && typeof res.body.pushed === 'number' ? res.body.pushed : 0,
    status: res.status,
    error: ok ? null : (detail !== null ? detail : (res.error || 'poussee refusee')),
  }
  if (ok || res.status >= 400) {
    try {
      const fresh = readState()
      fresh.chats_last_push = { at: new Date().toISOString(), ok, scanned: out.scanned, pushed: out.pushed, error: out.error }
      writeState(fresh)
    } catch (e) { /* the state never blocks the result */ }
  }
  return out
}

const chatsStatusRoute = async () => {
  const state = readState()
  return {
    ok: true,
    connected: isConnected(state),
    last_push: state && state.chats_last_push ? state.chats_last_push : null,
  }
}

// Materialises a local (DSH) chat as `kybernos.chat_sessions`: a DSH chat
// has no hosted counterpart, it must be created before it can be shared. The
// transcript is REPLACED, never concatenated (pushing the same thread again does not duplicate
// the bubbles), and `external_ref` makes the call idempotent: two shares of the
// same thread land on the same session.
const chatEnsure = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, status: 'none', error: 'non connecte' }
  const ref = typeof body.external_ref === 'string' ? body.external_ref.trim() : ''
  if (ref === '') return { ok: false, error: 'external_ref requis' }
  const payload = { external_ref: ref }
  const titre = typeof body.title === 'string' ? body.title.trim() : ''
  if (titre !== '') payload.title = titre
  if (Array.isArray(body.messages)) {
    payload.messages = body.messages.filter((m) => m !== null && typeof m === 'object').slice(0, 500)
  }
  const res = await apiCall('/v1/chats', { method: 'POST', token: state.token, body: payload })
  if (routeAbsent(res)) return { ok: false, status: 404, error: 'not_on_this_server' }
  if (res.status !== 200 && res.status !== 201) {
    return { ok: false, status: res.status, error: shareError(res, 'materialisation refusee') }
  }
  const out = res.body !== null && typeof res.body === 'object' ? res.body : {}
  return {
    ok: true,
    id: typeof out.id === 'string' ? out.id : null,
    title: typeof out.title === 'string' ? out.title : '',
    created: out.created === true,
    messages: typeof out.messages === 'number' ? out.messages : 0,
    status: res.status,
  }
}

const shareGet = async (req) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, status: 'none', error: 'non connecte' }
  let q = ''
  try {
    const p = new URL(req.url, 'http://localhost').searchParams
    const rt = (p.get('resource_type') || '').trim()
    const rid = (p.get('resource_id') || '').trim()
    if (rt === '' || rid === '') return { ok: false, error: 'resource_type et resource_id requis' }
    q = '?resource_type=' + encodeURIComponent(rt) + '&resource_id=' + encodeURIComponent(rid)
  } catch (e) { return { ok: false, error: 'URL illisible' } }
  const res = await apiCall('/v1/shares' + q, { token: state.token })
  if (routeAbsent(res)) return { ok: false, status: 404, error: 'not_on_this_server' }
  if (res.status !== 200) return { ok: false, status: res.status, error: shareError(res, 'lecture refusee') }
  const out = res.body !== null && typeof res.body === 'object' ? res.body : {}
  return { ok: true, share: out.share === undefined ? null : out.share, status: 200 }
}

const shareSet = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, status: 'none', error: 'non connecte' }
  const payload = {}
  for (const k of ['resource_type', 'resource_id', 'audience', 'password', 'expires_in']) {
    const v = typeof body[k] === 'string' ? body[k].trim() : ''
    if (v !== '') payload[k] = v
  }
  if (payload.resource_type === undefined || payload.resource_id === undefined) {
    return { ok: false, error: 'resource_type et resource_id requis' }
  }
  const res = await apiCall('/v1/shares', { method: 'POST', token: state.token, body: payload })
  if (routeAbsent(res)) return { ok: false, status: 404, error: 'not_on_this_server' }
  if (res.status !== 200 && res.status !== 201) {
    return { ok: false, status: res.status, error: shareError(res, 'ecriture refusee') }
  }
  const out = res.body !== null && typeof res.body === 'object' ? res.body : {}
  return { ok: true, share: out.share === undefined ? null : out.share, status: res.status }
}

const shareRevoke = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, status: 'none', error: 'non connecte' }
  const payload = {}
  for (const k of ['resource_type', 'resource_id']) {
    const v = typeof body[k] === 'string' ? body[k].trim() : ''
    if (v !== '') payload[k] = v
  }
  if (payload.resource_type === undefined || payload.resource_id === undefined) {
    return { ok: false, error: 'resource_type et resource_id requis' }
  }
  const res = await apiCall('/v1/shares/revoke', { method: 'POST', token: state.token, body: payload })
  if (routeAbsent(res)) return { ok: false, status: 404, error: 'not_on_this_server' }
  if (res.status !== 200) return { ok: false, status: res.status, error: shareError(res, 'revocation refusee') }
  const out = res.body !== null && typeof res.body === 'object' ? res.body : {}
  return { ok: true, count: typeof out.count === 'number' ? out.count : 0, status: 200 }
}

// ── Members of a space (« Share » card) ──────────────────────────────────────
// Read: GET /v1/workspaces/:id/members (member key accepted). Write
// (invitation, removal): today the server only opens it to the master key
// (the kybernos-workspace-invite EF calls it with requesting_user_id) — a user
// key gets 403/404/405/501. These cases return `{ok:false,
// error:'indisponible'}`: the card shows it as it is, with no false success.
const MEMBER_ROLES = ['owner', 'admin', 'member']
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Target space: the requested one if it exists in the account, else the active one. */
const memberSpace = (state, wanted) => {
  const espaces = Array.isArray(state.workspaces) ? state.workspaces : []
  const w = typeof wanted === 'string' ? wanted.trim() : ''
  if (w !== '' && espaces.some((e) => e !== null && e.id === w)) return w
  return espaceActif(state)
}

const memberUnavailable = (res) => {
  const detail = res && res.body && typeof res.body.error === 'string' ? res.body.error : ''
  if (res.status === 404 || res.status === 405 || res.status === 501) return true
  return res.status === 403 && /master/i.test(detail)
}

const membersGet = async (req) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, status: 'none', error: 'non connecte' }
  let wanted = ''
  try { wanted = new URL(req.url, 'http://localhost').searchParams.get('workspace_id') || '' } catch (e) { /* default */ }
  const wid = memberSpace(state, wanted)
  if (wid === null) return { ok: false, error: 'espace_absent' }
  const res = await apiCall('/v1/workspaces/' + encodeURIComponent(wid) + '/members', { token: state.token })
  if (memberUnavailable(res)) return { ok: false, error: 'indisponible', status: res.status }
  if (res.status !== 200) return { ok: false, status: res.status, error: shareError(res, 'lecture refusee') }
  const out = res.body !== null && typeof res.body === 'object' ? res.body : {}
  const members = (Array.isArray(out.members) ? out.members : [])
    .filter((m) => m !== null && typeof m === 'object' && typeof m.user_id === 'string')
    .map((m) => ({ user_id: m.user_id, role: MEMBER_ROLES.indexOf(m.role) !== -1 ? m.role : 'member', status: typeof m.status === 'string' ? m.status : 'active', created_at: typeof m.created_at === 'string' ? m.created_at : null }))
  return { ok: true, workspace_id: wid, members, status: 200 }
}

/** The refusals of `POST /invitations` that the Share panel can act on, as ONE word each (`already_member`, `seat_limit`, `forbidden`,
 *  `rate_limited`); any other refusal keeps the server's own code. The server's sentence is never passed on. */
const inviteError = (res) => {
  const code = res && res.body && typeof res.body.error === 'string' ? res.body.error.trim().toLowerCase() : ''
  if (code === 'already_member' || code === 'seat_limit') return code
  if (res.status === 403) return 'forbidden'
  if (res.status === 429) return 'rate_limited'
  return shareError(res, 'invitation refusee')
}

const membersInvite = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, status: 'none', error: 'non connecte' }
  const wid = memberSpace(state, body.workspace_id)
  if (wid === null) return { ok: false, error: 'espace_absent' }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const userId = typeof body.user_id === 'string' ? body.user_id.trim() : ''
  if (email === '' && userId === '') return { ok: false, error: 'email requis' }
  if (email !== '' && EMAIL_RE.test(email) !== true) return { ok: false, error: 'email invalide' }
  if (userId !== '' && UUID_RE.test(userId) !== true) return { ok: false, error: 'user_id invalide' }
  // The EF's contract: admin | member — never owner from here.
  const role = body.role === 'admin' ? 'admin' : (body.role === 'member' ? 'member' : '')
  if (role === '') return { ok: false, error: 'role invalide (admin|member)' }
  // The new server separates the two: an e-mail address is an INVITATION (`POST …/invitations`, a link valid 7 days; 501 when the
  // server sends no e-mail, which the page words as « not available on this server »), a user id is an upsert of the role
  // (`POST …/members`). Sending `{email, role}` to `/members` is a 400 `invalid_request`.
  const byEmail = email !== ''
  const res = byEmail
    ? await apiCall('/v1/workspaces/' + encodeURIComponent(wid) + '/invitations', { method: 'POST', token: state.token, body: { email, role } })
    : await apiCall('/v1/workspaces/' + encodeURIComponent(wid) + '/members', { method: 'POST', token: state.token, body: { role, user_id: userId } })
  if (memberUnavailable(res)) return { ok: false, error: 'indisponible', status: res.status }
  if (res.status !== 200 && res.status !== 201) return { ok: false, status: res.status, error: byEmail ? inviteError(res) : shareError(res, 'invitation refusee') }
  return byEmail ? { ok: true, invited: true, status: res.status } : { ok: true, status: res.status }
}

const membersRemove = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, status: 'none', error: 'non connecte' }
  const wid = memberSpace(state, body.workspace_id)
  if (wid === null) return { ok: false, error: 'espace_absent' }
  const userId = typeof body.user_id === 'string' ? body.user_id.trim() : ''
  if (UUID_RE.test(userId) !== true) return { ok: false, error: 'user_id invalide' }
  const res = await apiCall('/v1/workspaces/' + encodeURIComponent(wid) + '/members', { method: 'DELETE', token: state.token, body: { user_id: userId } })
  if (memberUnavailable(res)) return { ok: false, error: 'indisponible', status: res.status }
  if (res.status !== 200) return { ok: false, status: res.status, error: shareError(res, 'retrait refuse') }
  return { ok: true, status: 200 }
}

const artifactList = async (req) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, status: 'none', error: 'non connecte' }
  let limit = 50
  try {
    const raw = new URL(req.url, 'http://localhost').searchParams.get('limit')
    if (raw !== null) limit = Math.max(1, Math.min(200, parseInt(raw, 10) || 50))
  } catch (e) { /* unreadable URL → default */ }
  const res = await apiCall('/v1/artifacts?limit=' + limit, { token: state.token })
  if (res.status !== 200) {
    return { ok: false, status: res.status, error: artifactError(res, 'lecture refusee') }
  }
  const out = res.body !== null && typeof res.body === 'object' ? res.body : {}
  return { ok: true, artifacts: Array.isArray(out.artifacts) ? out.artifacts : [], count: out.count, status: 200 }
}

const artifactDetail = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, status: 'none', error: 'non connecte' }
  const id = typeof body.id === 'string' ? body.id.trim() : ''
  if (id === '') return { ok: false, error: 'id requis' }
  const res = await apiCall('/v1/artifacts/' + encodeURIComponent(id), { token: state.token })
  if (res.status !== 200) {
    return { ok: false, status: res.status, error: artifactError(res, 'artifact not found') }
  }
  const out = res.body !== null && typeof res.body === 'object' ? res.body : {}
  return { ok: true, artifact: out.artifact, status: 200 }
}

// ── Cloud feature no. 2: the account's memory ───────────────────────────────
//
// The Kybernos server already carries the whole model (migration 003): a table
// `kybernos.memories` with two scopes (account | kyber), four kinds
// (fact|preference|event|policy), a mandatory source, pinning and a
// retention (180 days by default, never expired if `pinned`). Contract read
// off the API on 22/09/2026: POST → 201 + the object, GET → {memories:[…]},
// DELETE → 200; everything in snake_case.
//
// This half does only three things:
//   1. read/write these memories with the account's token;
//   2. re-inject them into the prompt at every assembly, in the
//      deterministic order the spec imposes (pinned DESC, created_at ASC, id ASC) —
//      an unstable order breaks the proxy's prompt caching;
//   3. let the model write (`memory_write`), search (`memory_search`) and
//      retain what has just been taught, at the end of the turn.
//
// Invariants:
//   - offline, nothing exists: empty chunk, tools that refuse, no
//     network request, and above all not a cache left by the previous account;
//   - the content is neutralised before entering the prompt: a memory cannot
//     forge a chunk line (same rule as `_sanitize` on the
//     server side);
//   - the injection is SYNCHRONOUS: `systemPrompt.context` calls its text at
//     every assembly, so it reads a cache — never the network;
//   - every error is fail-open: no chunk, the turn goes on.

const MEMORY_KINDS = ['fact', 'preference', 'event', 'policy']
const MEMORY_SOURCES = ['conversation', 'call', 'correction', 'taught', 'admin']
const MEMORY_MAX_CONTENT = 2000
const MEMORY_CACHE_MS = 60000
const MEMORY_MAX_INJECT_CHARS = 6000
const MEMORY_INJECT_ORDER = 130
const MEMORY_PUSH_MAX = 40
const CAPTURE_MAX_TOKENS = 300
const CAPTURE_MIN_CHARS = 60
// Share of the injection budget reserved for pinned memories, and share left
// to the memory of the linked kybers when there are any: without these caps, a single
// group can starve all the others (observed: 47 pinned = the whole budget,
// so none of the 543 captured memories ever reached the model).
const MEMORY_PINNED_SHARE = 0.6
const MEMORY_KYBER_SHARE = 0.3
// The FRAME of the chunk (header, « other memories » line, final instruction) counts in
// the cap: MEMORY_MAX_INJECT_CHARS bounds the whole injected text, not only
// the memory lines (measured: the old rendering exceeded 6 000 by more than 130).
const MEMORY_FRAME_CHARS = 450
const MEMORY_KYBER_FRAME_CHARS = 120
// Refresh settings, exported so that the host suite can
// switch them off (a timer firing at a fake server during a test skews it).
const MEMORY_TUNING = { writeRefreshMs: 400, tickMs: 30000 }

// ── Files next to the state ─────────────────────────────────────────────────
// Settings and origins live NEXT TO the state file (same folder, same
// permissions) but NOT in it: the state file disappears on sign-out
// (clearState), whereas a « Memory: no » switch must survive a
// reconnection — and it must be possible to set it while offline.
const sideFile = (suffix) => stateFile().replace(/\.json$/, '') + '-' + suffix + '.json'

const readSide = (suffix, fallback) => {
  try {
    const parsed = JSON.parse(readFileSync(sideFile(suffix), 'utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : fallback
  } catch (e) {
    return fallback
  }
}

const writeSide = (suffix, value) => {
  const file = sideFile(suffix)
  try { mkdirSync(dirname(file), { recursive: true, mode: 0o700 }) } catch (e) { /* already there */ }
  writeFileSync(file, JSON.stringify(value) + '\n', { mode: 0o600 })
  try { chmodSync(file, 0o600) } catch (e) { /* exotic FS (Windows) */ }
}

/**
 * Switches of the « Memory & Lessons learned » page. All true by default:
 * this is the behaviour from before the settings existed, so nothing changes
 * for anyone who does not touch them. Read at every prompt assembly (tiny file,
 * synchronous read) — no cache to invalidate when another process writes.
 */
const MEMORY_SETTING_KEYS = ['memories', 'context', 'capture', 'meaning', 'relevant', 'team_use', 'team_share']
// `meaning` (search by meaning) is OFF until the user turns it on: it sends the text of a memory to the
// embedding model of the Kybernos cloud, which nothing else in this plugin does outside a chat turn.
// `relevant` (pick the memories that match the current question, on top of the pinned and the newest) is ON: it is
// local, nothing goes anywhere extra, and the page lets the user turn it off.
// `team_use` (the agents also read the lessons the team approved) and `team_share` (« Propose to team » is offered) only mean something on a Team
// workspace; both are on by default there, and the page locks them with the reason everywhere else.
const MEMORY_SETTING_DEFAULTS = { memories: true, context: true, capture: true, meaning: false, relevant: true, team_use: true, team_share: true }
const readMemorySettings = () => {
  const raw = readSide('memory', {})
  const out = {}
  for (const key of MEMORY_SETTING_KEYS) out[key] = typeof raw[key] === 'boolean' ? raw[key] : MEMORY_SETTING_DEFAULTS[key]
  return out
}

/**
 * Origin of a memory: the server only distinguishes `source` (conversation,
 * taught…), and the automatic capture, an agent's tool and the push of
 * lessons ALL write `conversation` — indistinguishable on the account side. The plugin
 * therefore notes locally who wrote what; what was not written from here is
 * deduced from `source` and marked « unknown » (`originKnown: false`).
 */
const MEMORY_ORIGINS = ['capture', 'agent', 'taught', 'sync']
const MEMORY_ORIGINS_MAX = 5000

const noteOrigins = (ids, origin) => {
  if (MEMORY_ORIGINS.indexOf(origin) < 0) return
  try {
    const map = readSide('memory-origins', {})
    for (const id of ids) map[String(id)] = origin
    const keys = Object.keys(map)
    // The ids are increasing: beyond the cap, the oldest are forgotten.
    if (keys.length > MEMORY_ORIGINS_MAX) {
      keys.sort((a, b) => Number(a) - Number(b)).slice(0, keys.length - MEMORY_ORIGINS_MAX).forEach((k) => { delete map[k] })
    }
    writeSide('memory-origins', map)
  } catch (e) { /* the origin log is a convenience: never blocking */ }
}

const originOf = (m, ledger) => {
  const known = ledger[String(m.id)]
  if (MEMORY_ORIGINS.indexOf(known) >= 0) return { origin: known, originKnown: true }
  const derived = (m.source === 'taught' || m.source === 'correction' || m.source === 'admin') ? 'taught' : m.source === 'call' ? 'agent' : 'capture'
  return { origin: derived, originKnown: false }
}

/** Injection cache: read by the prompt (synchronous), filled from the network. */
const memoryCache = { at: 0, account: [], kyber: {}, error: null }

const emptyMemoryCache = () => {
  memoryCache.at = 0
  memoryCache.account = []
  memoryCache.kyber = {}
  memoryCache.error = null
}

/** Marks the cache stale; `scheduleMemoryRefresh` reloads it right after. */
const bumpMemoryCache = () => {
  memoryCache.at = 0
}

// A prompt assembly reads ONLY the cache (never the network). Without a scheduled
// reload, a memory written — by the tool, the capture or the card — stayed
// absent from the prompt until the next restart: the TTL was useless
// because every caller forced. A write therefore triggers a short
// (grouped) reload, and a timer refreshes the stale cache.
let memoryRefreshTimer = null
const scheduleMemoryRefresh = () => {
  if (memoryRefreshTimer !== null || MEMORY_TUNING.writeRefreshMs < 0) return
  memoryRefreshTimer = setTimeout(() => {
    memoryRefreshTimer = null
    void refreshMemoryCache(readState(), false).catch(() => {})
  }, MEMORY_TUNING.writeRefreshMs)
  if (typeof memoryRefreshTimer.unref === 'function') memoryRefreshTimer.unref()
}

const afterMemoryWrite = () => {
  bumpMemoryCache()
  scheduleMemoryRefresh()
}

const asMemory = (m) => ({
  id: m.id,
  scope: m.scope,
  kyberId: m.kyber_id === undefined ? null : m.kyber_id,
  kind: m.kind,
  content: m.content,
  source: m.source,
  pinned: m.pinned === true,
  retentionDays: m.retention_days === undefined ? null : m.retention_days,
  expiresAt: m.expires_at === undefined ? null : m.expires_at,
  createdAt: m.created_at === undefined ? null : m.created_at,
})

const memoryFailure = (res) => {
  if (res.status === 401) return 'reconnexion_requise'
  if (res.status === 0) return 'reseau'
  if (res.status >= 400) return 'refus_' + String(res.status)
  return null
}

const listMemories = async (state, scope, kyberId) => {
  let path = '/v1/memories?scope=' + encodeURIComponent(scope)
  if (scope === 'kyber' && typeof kyberId === 'string' && kyberId !== '') path += '&kyber_id=' + encodeURIComponent(kyberId)
  const res = await apiCall(path, { token: state.token })
  const failure = memoryFailure(res)
  if (failure !== null) return { ok: false, error: failure, items: [] }
  const raw = res.body !== null && Array.isArray(res.body.memories) ? res.body.memories : []
  return { ok: true, error: null, items: raw.map(asMemory) }
}

/**
 * Validates a memory before sending it. Fail-closed like the server: a
 * kind outside the enumeration is refused, never folded back to `fact`.
 */
const validateMemory = (body) => {
  const content = typeof body.content === 'string' ? body.content.trim() : ''
  if (content === '') return { error: 'contenu_vide' }
  if (content.length > MEMORY_MAX_CONTENT) return { error: 'contenu_trop_long' }
  if (MEMORY_KINDS.indexOf(body.kind) < 0) return { error: 'genre_invalide' }
  const source = MEMORY_SOURCES.indexOf(body.source) >= 0 ? body.source : 'conversation'
  const scope = body.scope === 'kyber' ? 'kyber' : 'account'
  const pinned = body.pinned === true
  let retention = 180
  if (body.retentionDays !== undefined && body.retentionDays !== null) {
    const n = parseInt(body.retentionDays, 10)
    if (!Number.isFinite(n) || n < 0) return { error: 'retention_invalide' }
    retention = n
  }
  const payload = { scope, kind: body.kind, content, source, pinned, retention_days: retention }
  if (scope === 'kyber') {
    const cloud = typeof body.kyberId === 'string' ? body.kyberId : ''
    if (cloud === '') return { error: 'kyber_requis' }
    payload.kyber_id = cloud
  }
  return { error: null, payload }
}

const createMemory = async (state, body, origin) => {
  const checked = validateMemory(body)
  if (checked.error !== null) return { ok: false, error: checked.error }
  const res = await apiCall('/v1/memories', { method: 'POST', token: state.token, body: checked.payload })
  const failure = memoryFailure(res)
  if (failure !== null) return { ok: false, error: failure, status: res.status }
  afterMemoryWrite()
  const memory = res.body !== null && typeof res.body === 'object' ? asMemory(res.body) : null
  if (memory !== null && origin !== undefined) noteOrigins([memory.id], origin)
  indexOneInBackground(state, memory)
  return { ok: true, memory }
}

const patchMemory = async (state, body) => {
  const id = body.id === undefined || body.id === null ? '' : String(body.id)
  if (id === '') return { ok: false, error: 'id_manquant' }
  const sets = {}
  if (typeof body.content === 'string') {
    const content = body.content.trim()
    if (content === '' || content.length > MEMORY_MAX_CONTENT) return { ok: false, error: 'contenu_invalide' }
    sets.content = content
  }
  if (typeof body.pinned === 'boolean') sets.pinned = body.pinned
  if (body.retentionDays !== undefined && body.retentionDays !== null) {
    const n = parseInt(body.retentionDays, 10)
    if (!Number.isFinite(n) || n < 0) return { ok: false, error: 'retention_invalide' }
    sets.retention_days = n
  }
  if (Object.keys(sets).length === 0) return { ok: false, error: 'rien_a_modifier' }
  const res = await apiCall('/v1/memories/' + encodeURIComponent(id), { method: 'PATCH', token: state.token, body: sets })
  const failure = memoryFailure(res)
  if (failure !== null) return { ok: false, error: failure, status: res.status }
  afterMemoryWrite()
  const patched = res.body !== null && typeof res.body === 'object' ? asMemory(res.body) : null
  // The server drops the vector of a memory whose text changed: give it a new one.
  if (sets.content !== undefined) indexOneInBackground(state, patched)
  return { ok: true, memory: patched }
}

const deleteMemory = async (state, body) => {
  const id = body.id === undefined || body.id === null ? '' : String(body.id)
  if (id === '') return { ok: false, error: 'id_manquant' }
  const res = await apiCall('/v1/memories/' + encodeURIComponent(id), { method: 'DELETE', token: state.token })
  const failure = memoryFailure(res)
  if (failure !== null) return { ok: false, error: failure, status: res.status }
  afterMemoryWrite()
  return { ok: true }
}

const searchMemories = async (state, q) => {
  const needle = typeof q === 'string' ? q.trim() : ''
  if (needle === '') return { ok: false, error: 'requete_vide', items: [] }
  const res = await apiCall('/v1/memories/search?q=' + encodeURIComponent(needle), { token: state.token })
  const failure = memoryFailure(res)
  if (failure !== null) return { ok: false, error: failure, items: [] }
  const raw = res.body !== null && Array.isArray(res.body.memories) ? res.body.memories : []
  return { ok: true, error: null, items: raw.map(asMemory) }
}

// ── Matching local kybers ↔ cloud kybers ────────────────────────────────────
// The identifiers have nothing to do with each other: locally `default`, `dev-team`…; on the
// cloud side `kg52d53f4ce522`, `kga9ad6e`. No automatic matching is
// reliable, so it is EXPLICIT and inspectable (`state.kyberMap`). With no
// entry, a lesson is not pushed — we never write into the kyber of
// another at random.

const stateKyberMap = (state) => (state !== null && typeof state.kyberMap === 'object' && state.kyberMap !== null ? state.kyberMap : {})

const localKybers = () => {
  try {
    return readdirSync(kybersDir(), { withFileTypes: true })
      // Hidden entries (`.git`, `.active`, `.kyber-avatars`) are not
      // kybers: offering them in the matching would be a false choice.
      .filter((entry) => entry.isDirectory() === true && entry.name.startsWith('.') !== true)
      .map((entry) => entry.name)
      .sort()
  } catch (e) {
    return []
  }
}

/** Root of the local kybers: <DSH home>/kybers, overridable so the host suite stays deterministic. */
const kybersDir = () => (typeof process.env.KYBERNOS_CLOUD_KYBERS === 'string' && process.env.KYBERNOS_CLOUD_KYBERS !== '' ? process.env.KYBERNOS_CLOUD_KYBERS : join(dshHome(), 'kybers'))

const readJsonl = (path) => {
  try {
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => {
        try { return JSON.parse(line) } catch (e) { return null }
      })
      .filter((row) => row !== null)
  } catch (e) {
    return []
  }
}

const localLessons = (kyber) => readJsonl(join(kybersDir(), kyber, 'memory', 'lessons.jsonl'))

const listCloudKybers = async (state) => {
  const spaces = Array.isArray(state.workspaces) ? state.workspaces : []
  const out = []
  for (const ws of spaces) {
    if (ws === null || typeof ws.id !== 'string') continue
    const res = await apiCall('/v1/memories/kybers?workspace_id=' + encodeURIComponent(ws.id), { token: state.token })
    if (res.status !== 200 || res.body === null || Array.isArray(res.body.kybers) === false) continue
    for (const k of res.body.kybers) {
      out.push({
        id: k.id,
        name: k.name,
        glyph: k.glyph === undefined ? null : k.glyph,
        color: k.color === undefined ? null : k.color,
        workspaceId: ws.id,
        workspaceName: ws.name === undefined ? null : ws.name,
        memoryCount: k.memory_count === undefined ? 0 : k.memory_count,
      })
    }
  }
  return out
}

/**
 * Pushes the lessons of a local kyber to its cloud kyber (scope=kyber).
 * Deduplication before writing (the server spec lists it as a follow-up, we do it
 * here): a memory with identical content is never rewritten.
 */
const pushLessons = async (state, options = {}) => {
  const map = stateKyberMap(state)
  const dry = options.dryRun === true
  const report = []
  for (const local of Object.keys(map)) {
    const cloud = map[local]
    if (typeof cloud !== 'string' || cloud === '') continue
    const lessons = localLessons(local)
    const row = { local, cloud, lessons: lessons.length, added: 0, skipped: 0, error: null }
    if (lessons.length === 0) { report.push(row); continue }
    const existing = await listMemories(state, 'kyber', cloud)
    if (existing.ok !== true) { row.error = existing.error; report.push(row); continue }
    const known = new Set(existing.items.map((m) => String(m.content).trim()))
    // Most recent first: if the cap cuts, it cuts the old ones.
    const ordered = lessons.slice().reverse().slice(0, MEMORY_PUSH_MAX)
    for (const lesson of ordered) {
      const text = typeof lesson.text === 'string' ? lesson.text.trim() : ''
      if (text === '') continue
      if (known.has(text) === true) { row.skipped = row.skipped + 1; continue }
      if (dry === true) { row.added = row.added + 1; continue }
      const made = await createMemory(state, { scope: 'kyber', kyberId: cloud, kind: 'policy', content: text, source: 'conversation' }, 'sync')
      if (made.ok === true) row.added = row.added + 1
      else { row.error = made.error; break }
    }
    report.push(row)
  }
  return { ok: true, dryRun: dry, report }
}

// ── Injection into the prompt ───────────────────────────────────────────────

/**
 * Neutralises the content of a memory before putting it in the prompt: a
 * user must not be able to write a fake chunk line by
 * saving « [KYBERNOS MEMORY] … ». We trim the marker and flatten the
 * line breaks, exactly like `_sanitize` on the server side.
 */
const sanitizeMemory = (text) => String(text)
  .replace(/\r?\n+/g, ' · ')
  .replace(/\[\s*KYBERNOS\s*MEMORY/gi, '[KYBERNOS-MEMORY')
  .replace(/\[\s*MEMORY/gi, '[MEMORY-')
  .slice(0, MEMORY_MAX_CONTENT)

/** RENDER order imposed by the spec: pinned first, then oldest to newest (stable for the proxy's prompt cache). */
const sortMemories = (items) => items.slice().sort((a, b) => {
  if (a.pinned !== b.pinned) return a.pinned === true ? -1 : 1
  const ka = String(a.createdAt === null || a.createdAt === undefined ? '' : a.createdAt)
  const kb = String(b.createdAt === null || b.createdAt === undefined ? '' : b.createdAt)
  if (ka !== kb) return ka < kb ? -1 : 1
  return Number(a.id) - Number(b.id)
})

const memoryLine = (m) => '- (' + String(m.kind) + (m.pinned === true ? ', pinned' : '') + ') ' + sanitizeMemory(m.content)

const newestFirst = (a, b) => {
  const ka = String(a.createdAt === null || a.createdAt === undefined ? '' : a.createdAt)
  const kb = String(b.createdAt === null || b.createdAt === undefined ? '' : b.createdAt)
  if (ka !== kb) return ka < kb ? 1 : -1
  return Number(b.id) - Number(a.id)
}

// ── The memories that matter to THIS question ───────────────────────────────
// The base selection (pinned, then the newest) cannot know what the user is asking: on a 640-memory account the one
// about Docker on this Mac is 9 days old and never goes. So the human's latest message of each session is kept here
// and ranked against the memories (relevance.mjs, local: nothing is sent anywhere), and the ones that clearly match
// are added to what goes to the model.
//
// Cost: the engine appends a new "runtime context" snapshot to the history whenever this text CHANGES (and keeps the
// older ones), so the pick is made to stay put: it is computed once per user message, kept while the topic is the same
// (overlap), and not changed again for a few turns. Never per step, never per tool call.
const RELEVANCE_TUNING = {
  maxTerms: 12,           // judge the question by its 12 rarest words that can match something
  minCoverage: 0.25,      // ≥ 2 words matched and a quarter of the question's rarity …
  strongCoverage: 0.5,    // … or 1 word that is half of it (a rare word: « tev1 »)
  relative: 0.5,          // and never less than this fraction of the best match's coverage (the tail of a long list is noise)
  maxPicked: 6,           // at most this many memories picked
  maxCandidates: 15,      // … and only when the question is SELECTIVE: if more than this many memories qualify, none stands out
  share: 0.4,             // … and at most this share of the memories budget
  keepOverlap: 0.6,       // a new pick that overlaps the last one this much changes nothing
  minTurnsBetweenChanges: 3,
  queryChars: 1200,
  sessions: 64,
}
const sessionQuery = new Map()   // sessionId -> { key, text, turn }
const sessionPick = new Map()    // sessionId -> { key, ids, turn }

const forgetOldest = (map) => { while (map.size > RELEVANCE_TUNING.sessions) map.delete(map.keys().next().value) }

/** The text of a HUMAN prompt (source.kind 'user'); injected context, file notices, skills and goal rounds are not a question. */
const userPromptText = (message) => {
  if (message === null || typeof message !== 'object') return ''
  const kind = message.source !== null && typeof message.source === 'object' ? message.source.kind : undefined
  if (kind !== 'user') return ''
  const blocks = Array.isArray(message.content) ? message.content : []
  return stripMemoryBlock(blocks.filter((b) => b !== null && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n')).trim()
}

const noteUserTurn = (sessionId, message, turn) => {
  try {
    const text = userPromptText(message)
    if (typeof sessionId !== 'string' || sessionId === '' || text === '') return
    const cut = text.slice(0, RELEVANCE_TUNING.queryChars)
    sessionQuery.delete(sessionId)
    sessionQuery.set(sessionId, { key: String(Number.isFinite(turn) ? turn : 0) + ':' + String(text.length) + ':' + cut.slice(0, 40), text: cut, turn: Number.isFinite(turn) ? turn : 0 })
    forgetOldest(sessionQuery)
  } catch (e) { /* never break a turn */ }
}

const overlapOf = (a, b) => {
  if (a.length === 0 && b.length === 0) return 1
  const set = new Set(a)
  let both = 0
  for (const id of b) if (set.has(id)) both += 1
  return both / (a.length + b.length - both)
}

/** The memories of `candidates` that match this session's latest question, best first; [] when nothing clearly does. */
const pickRelevant = (sessionId, candidates, picks = sessionPick, tuning = RELEVANCE_TUNING) => {
  const q = sessionQuery.get(sessionId)
  if (q === undefined) return []
  const byId = new Map(candidates.map((m) => [String(m.id), m]))
  const prev = picks.get(sessionId)
  if (prev !== undefined && prev.key === q.key) return prev.ids.map((id) => byId.get(id)).filter((m) => m !== undefined)   // same message, next step: byte-identical
  const T = tuning
  const ranked = rankByRelevance(candidates.map((m) => ({ content: m.content, createdAt: m.createdAt, pinned: false, mem: m })), q.text, { maxTerms: T.maxTerms })
  const passing = ranked.filter((r) => (r.matched >= 2 && r.coverage >= T.minCoverage) || (r.matched >= 1 && r.coverage >= T.strongCoverage))
  const best = passing.reduce((top, r) => Math.max(top, r.coverage), 0)
  const strong = passing.filter((r) => r.coverage >= best * T.relative)
  // "kybernos" or "note" matches hundreds of memories equally: that is not a question about any of them.
  const ids = strong.length > T.maxCandidates ? [] : strong.slice(0, T.maxPicked).map((r) => String(r.doc.mem.id))
  let next = ids
  let turn = q.turn
  if (prev !== undefined) {
    const spaced = q.turn - prev.turn >= T.minTurnsBetweenChanges
    if (overlapOf(ids, prev.ids) >= T.keepOverlap || !spaced) { next = prev.ids; turn = prev.turn }
  }
  picks.delete(sessionId)
  picks.set(sessionId, { key: q.key, ids: next, turn })
  forgetOldest(picks)
  return next.map((id) => byId.get(id)).filter((m) => m !== undefined)
}

/**
 * CHOICE of what goes to the model within a character budget. The selection is
 * made by freshness (pinned first, capped at `pinnedShare` of the budget,
 * then the most recent), the RENDER stays in the stable order of `sortMemories`.
 * The « oldest to newest + cut at the first overflow » sort that this code used to do
 * always kept the oldest: on a 631-memory account only 12 pinned ones got in,
 * and nothing of what the model had just learned.
 * A memory too long for the rest of the budget is skipped (we try a smaller one).
 */
const selectForPrompt = (items, budget, pinnedShare, preferred = [], preferredShare = 0) => {
  const cost = (m) => memoryLine(m).length + 1
  const chosen = new Set()
  let used = 0
  const take = (m, cap) => {
    const c = cost(m)
    if (chosen.has(m) || used + c > cap) return
    chosen.add(m)
    used += c
  }
  const pinned = items.filter((m) => m.pinned === true).sort(newestFirst)
  const loose = items.filter((m) => m.pinned !== true).sort(newestFirst)
  const pinCap = Math.floor(budget * pinnedShare)
  pinned.forEach((m) => take(m, pinCap))
  // What matches the current question comes right after the pinned and BEFORE the newest, within its own share.
  let relevantUsed = 0
  const relevantCap = Math.floor(budget * preferredShare)
  for (const m of preferred) {
    const c = cost(m)
    if (chosen.has(m) || relevantUsed + c > relevantCap || used + c > budget) continue
    take(m, budget)
    relevantUsed += c
  }
  loose.forEach((m) => take(m, budget))
  // Of the budget left free (few free memories): pinned ones are put back into it.
  pinned.forEach((m) => take(m, budget))
  return { chosen: sortMemories(items.filter((m) => chosen.has(m))), used, omitted: items.length - chosen.size }
}

/**
 * The injection plan — ONE single source of truth: the prompt text, the
 * « 12 of 631 » counter of the page and the `sent` flag of each line all
 * come out of it. Otherwise the screen can announce something other than what the model reads.
 */
const planInjection = (state, info) => {
  const empty = { account: { chosen: [], used: 0, omitted: 0 }, kyber: {}, used: 0, budget: MEMORY_MAX_INJECT_CHARS }
  if (isConnected(state) !== true) return empty
  const cfg = readMemorySettings()
  if (cfg.memories !== true || cfg.context !== true) return empty
  const kyberKeys = Object.keys(memoryCache.kyber).filter((k) => memoryCache.kyber[k].length > 0)
  const lineBudget = Math.max(0, MEMORY_MAX_INJECT_CHARS - MEMORY_FRAME_CHARS - MEMORY_KYBER_FRAME_CHARS * kyberKeys.length)
  const accountBudget = kyberKeys.length > 0 ? Math.floor(lineBudget * (1 - MEMORY_KYBER_SHARE)) : lineBudget
  // `info.sessionId` is only given by the prompt itself: the page's counts and « sent » flags stay the base selection.
  const preferred = cfg.relevant === true && info !== undefined && typeof info.sessionId === 'string'
    ? pickRelevant(info.sessionId, memoryCache.account.filter((m) => m.pinned !== true))
    : []
  const account = selectForPrompt(memoryCache.account, accountBudget, MEMORY_PINNED_SHARE, preferred, RELEVANCE_TUNING.share)
  const kyber = {}
  let used = account.used
  const left = lineBudget - used
  for (const local of kyberKeys) {
    const sel = selectForPrompt(memoryCache.kyber[local], Math.max(0, Math.floor(left / Math.max(1, kyberKeys.length))), MEMORY_PINNED_SHARE)
    kyber[local] = sel
    used += sel.used
  }
  return { account, kyber, used, budget: MEMORY_MAX_INJECT_CHARS }
}

/**
 * The injected text. Rendered at every assembly: it must be synchronous and never
 * throw — hence the total `try` and the empty-string return in case of doubt.
 */
const renderMemoryChunk = (state, info) => {
  try {
    if (isConnected(state) !== true) return ''
    const plan = planInjection(state, info)
    const parts = []
    if (plan.account.chosen.length > 0) {
      parts.push(MEMORY_MARKER + ' The user\'s Kybernos account memories (shared with all their agents):')
      plan.account.chosen.forEach((m) => parts.push(memoryLine(m)))
      if (plan.account.omitted > 0) parts.push('- … (' + String(plan.account.omitted) + ' more memories not sent this turn: use memory_search to find them)')
    }
    for (const local of Object.keys(plan.kyber)) {
      if (plan.kyber[local].chosen.length === 0) continue
      parts.push('', 'Memory of the Agent Team “' + local + '”:')
      plan.kyber[local].chosen.forEach((m) => parts.push(memoryLine(m)))
      if (plan.kyber[local].omitted > 0) parts.push('- … (' + String(plan.kyber[local].omitted) + ' more not sent)')
    }
    if (parts.length === 0) return ''
    // The proxy looks for this exact token to avoid adding its own copy: it must lead every non-empty chunk,
    // including one that only carries kyber memories.
    if (parts[0].indexOf(MEMORY_MARKER) !== 0) parts.unshift(MEMORY_MARKER + ' The user\'s Kybernos account memory:')
    parts.push('', 'These memories come from the user\'s account. Never make any up: call memory_write to add one (kind fact|preference|event|policy), memory_search to look one up.')
    return parts.join('\n')
  } catch (e) {
    return ''
  }
}

/**
 * Tokens the Kybernos proxy reads in the system prompt (core/middleware/kybernos/_hook.py, server repo):
 * with either one present it does NOT add its own MEMORY chunk, so the model never gets the memories
 * twice and a user who switched them off is not overruled server-side. Keep both strings in step with it.
 */
const MEMORY_MARKER = '[KYBERNOS MEMORY]'
const MEMORY_OFF_MARKER = '[KYBERNOS MEMORY OFF] Saved memories are not included in this request.'

/**
 * What the prompt really gets: the memories (they carry MEMORY_MARKER), or the off marker when the user
 * switched memories / their context off, or nothing (no account, or nothing to send yet — the proxy
 * may then still add its own copy, which is the safety net on a cold start).
 */
const renderMemoryPrompt = (state, info) => {
  try {
    if (isConnected(state) !== true) return ''
    const cfg = readMemorySettings()
    if (cfg.memories !== true || cfg.context !== true) return MEMORY_OFF_MARKER
    return renderMemoryChunk(state, info)
  } catch (e) {
    return ''
  }
}

/** Reloads the cache from the API. Best-effort: a read that fails KEEPS the old content. */
const refreshMemoryCache = async (state, force) => {
  try {
    if (isConnected(state) !== true) { emptyMemoryCache(); return }
    if (force !== true && Date.now() - memoryCache.at < MEMORY_CACHE_MS) return
    const account = await listMemories(state, 'account', null)
    // A refused read (401, network down) NEVER empties the cache: the prompt
    // keeps carrying the last known state, and the error comes up through the route.
    if (account.ok !== true) { memoryCache.error = account.error; return }
    const kyber = {}
    const map = stateKyberMap(state)
    const seen = new Set()
    for (const local of Object.keys(map)) {
      const cloud = map[local]
      if (typeof cloud !== 'string' || cloud === '' || seen.has(cloud)) continue
      seen.add(cloud)
      const got = await listMemories(state, 'kyber', cloud)
      if (got.ok === true) kyber[local] = got.items
      else if (memoryCache.kyber[local] !== undefined) kyber[local] = memoryCache.kyber[local]
    }
    memoryCache.account = account.items
    memoryCache.kyber = kyber
    memoryCache.error = null
    memoryCache.at = Date.now()
  } catch (e) {
    memoryCache.error = 'interne'
  }
}

// ── Local routes ────────────────────────────────────────────────────────────

const memoryRoute = async (req) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  await refreshMemoryCache(state, true)
  // A read that fails must NEVER present itself as « no
  // memories »: an empty list and a 401 do not look alike.
  if (memoryCache.error !== null) return { ok: false, connected: true, error: memoryCache.error }
  const map = stateKyberMap(state)
  return {
    ok: true,
    connected: true,
    account: sortMemories(memoryCache.account),
    kyber: memoryCache.kyber,
    map,
    locals: localKybers(),
    cloud: await listCloudKybers(state),
    lessonCounts: Object.fromEntries(localKybers().map((k) => [k, localLessons(k).length])),
    cache: { at: memoryCache.at, ttlMs: MEMORY_CACHE_MS, error: memoryCache.error },
    capture: lastCapture,
  }
}

/**
 * Installs a published kyber into the local root `<DSH home>/kybers/`.
 * A tester's kyber is NEVER replaced: when the id is taken the route refuses and says so, unless `ecraser: true` is
 * asked for explicitly. The answer carries `aCompleter`: what the catalogue does not publish (model route, stages, a
 * missing prompt) and the tester will have to write.
 *
 * The item is found by its address first (`GET /v1/marketplace/{slug}`: any item, listed or not, whatever page of the
 * catalogue it would be on), then, on a 404 (an older server has no such route, or the item is not there), by reading
 * the pages of the list (marketplace-kyber.mjs, `resoudreItem`).
 */
const marketplaceInstallRoute = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  const demande = body !== null && typeof body === 'object' ? body : {}
  const slug = typeof demande.slug === 'string' ? demande.slug.trim() : ''
  if (slug === '') return { ok: false, error: 'slug missing' }
  // The slug goes into a URL and into a folder name: only a plain one is let through.
  if (slugSur(slug) !== true) return { ok: false, error: 'invalid slug' }
  const trouve = await resoudreItem(slug, {
    lireItem: (id) => apiCall('/v1/marketplace/' + encodeURIComponent(id), { token: state.token }),
    lirePage: marketplacePage(state),
  })
  if (trouve.item === undefined) return { ok: false, error: trouve.erreur }
  const item = trouve.item
  const construit = ymlDuKyber(item)
  if (construit.yml === null) return { ok: false, error: 'manifeste inexploitable : ' + construit.aCompleter.join(' ; ') }
  const racine = kybersDir()
  let existants = []
  try { existants = readdirSync(racine, { withFileTypes: true }).filter((d) => d.isDirectory() === true).map((d) => d.name) } catch (e) { existants = [] }
  const verdict = verdictInstallation(existants, slug, { ecraser: demande.ecraser === true })
  if (verdict.action !== 'ecrire') return { ok: false, refuse: true, action: 'refus', error: verdict.motif, racine }
  const dir = join(racine, slug)
  const cible = join(dir, 'kyber.yml')
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(cible, construit.yml, 'utf8')
  } catch (e) {
    return { ok: false, error: 'cannot write: ' + String(e !== null && e.message !== undefined ? e.message : e) }
  }
  return {
    ok: true, slug, chemin: cible, origine: 'kybernos.app/' + slug,
    roles: construit.roles.map((r) => r.id), aCompleter: construit.aCompleter,
  }
}

const memoryCreateRoute = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  return await createMemory(state, body === null ? {} : body, 'taught')
}

const memoryUpdateRoute = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  return await patchMemory(state, body === null ? {} : body)
}

const memoryDeleteRoute = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  return await deleteMemory(state, body === null ? {} : body)
}

const memorySearchRoute = async (req) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte', items: [] }
  let q = ''
  try { q = new URL(req.url, 'http://localhost').searchParams.get('q') || '' } catch (e) { q = '' }
  return await searchMemories(state, q)
}

const memoryMapRoute = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  const incoming = body !== null && typeof body.map === 'object' && body.map !== null ? body.map : null
  if (incoming === null) return { ok: false, error: 'map_manquante' }
  const clean = {}
  for (const local of Object.keys(incoming)) {
    const cloud = incoming[local]
    if (typeof cloud === 'string' && cloud !== '') clean[local] = cloud
  }
  writeState({ ...state, kyberMap: clean })
  bumpMemoryCache()
  void refreshMemoryCache(readState(), true).catch(() => {})
  return { ok: true, map: clean }
}

// ── Settings + paginated list (« Memory & Lessons learned » page) ────────────

// `capture` rides along: the page shows « last capture: … » in the options, and the full
// `/kybernos-cloud/memory` route that also carries it re-reads the whole account from the API.
const memorySettingsRoute = async () => ({ ok: true, settings: readMemorySettings(), capture: lastCapture })

const memorySettingsSetRoute = async (req, body) => {
  const incoming = body !== null && typeof body === 'object' && Array.isArray(body) === false ? body : null
  if (incoming === null) return { ok: false, error: 'corps_invalide' }
  const next = readMemorySettings()
  for (const key of Object.keys(incoming)) {
    // Fail-closed: an unknown key or a value that is not a boolean is
    // refused as a whole — a setting is never applied « by halves ».
    if (MEMORY_SETTING_KEYS.indexOf(key) < 0) return { ok: false, error: 'cle_inconnue', key }
    if (typeof incoming[key] !== 'boolean') return { ok: false, error: 'valeur_invalide', key }
    next[key] = incoming[key]
  }
  writeSide('memory', next)
  return { ok: true, settings: next }
}

/** Server date (`2026-09-22 18:57:52.777496+00:00`) → ms; NaN if unreadable. */
const parseWhen = (value) => {
  if (typeof value !== 'string' || value === '') return NaN
  const iso = value.replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1')
  return Date.parse(iso)
}

const ADDED_WINDOW_MIN = { '1m': 1, '1h': 60, today: 1440, '7d': 10080 }

const intParam = (raw, fallback, min, max) => {
  const n = parseInt(raw, 10)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

// ── Search by meaning (client half; server half: GET/PUT/POST /v1/memories… embeddings) ─────────
// The plugin embeds the text itself with the Kybernos embeddings route (kybernos/embed = bge-m3, 1024
// dimensions, free tier, billed to the account like chat) and sends the vector; the server only stores
// and ranks. EVERYTHING here is behind the `meaning` switch and never runs on its own at start-up.

const EMBED_MODEL = 'kybernos/embed'   // the role route of the older servers; a server with a vanilla catalogue names its own (below)
/** The embeddings model of the server we are connected to: the one its catalogue named at the last import, else the legacy route. */
const embedModelId = () => {
  const state = readState()
  const named = state !== null && state.models !== undefined && state.models !== null ? state.models.embed : null
  return typeof named === 'string' && named !== '' ? named : EMBED_MODEL
}
const EMBED_DIM = 1024
const EMBED_BATCH = 16
const INDEX_BATCH_MAX = 64
const MEANING_BACKOFF_MS = 10 * 60 * 1000
// What we last learned, so a write or a search does not hammer a server (or a plan) that already said no.
const meaningCache = { unavailableAt: 0, planBlockedAt: 0, requiredTier: null, plan: null, lastError: null, lastIndexedAt: 0 }

/** Why we are not even trying right now ('sens_indisponible' | 'offre_requise'), or null. Both lift after 10 minutes or on a good status probe. */
const meaningPaused = () => {
  const now = Date.now()
  if (now - meaningCache.planBlockedAt < MEANING_BACKOFF_MS) return 'offre_requise'
  if (now - meaningCache.unavailableAt < MEANING_BACKOFF_MS) return 'sens_indisponible'
  return null
}

/**
 * The embeddings route is gated by plan: on the dev tier a `free` key gets
 * 403 { error: { provider_specific_fields: { error: 'model-not-available-plan', required_tier: 'solo', plan: 'free' } } }.
 * 402 = no credits left. Everything else keeps the generic words.
 */
const embedFailure = (res) => {
  if (res.status === 402) return { error: 'credits_epuises' }
  if (res.status === 403) {
    const f = res.body !== null && res.body.error !== null && typeof res.body.error === 'object' ? res.body.error.provider_specific_fields : null
    if (f !== null && typeof f === 'object' && f.error === 'model-not-available-plan') {
      return { error: 'offre_requise', requiredTier: typeof f.required_tier === 'string' ? f.required_tier : null, plan: typeof f.plan === 'string' ? f.plan : null }
    }
    return { error: 'refus_403' }
  }
  const generic = memoryFailure(res)
  return generic === null ? null : { error: generic }
}

/** Remembers a refusal: the plan one stops us trying for 10 minutes and says which tier is needed. */
const noteEmbedFailure = (failure) => {
  meaningCache.lastError = failure.error
  if (failure.error === 'offre_requise') {
    meaningCache.planBlockedAt = Date.now()
    meaningCache.requiredTier = failure.requiredTier === undefined ? null : failure.requiredTier
    meaningCache.plan = failure.plan === undefined ? null : failure.plan
  }
}

/** Vectors for `texts`, in order. Never throws; every failure is `{ ok:false, error }` (+ requiredTier / plan for 'offre_requise'). */
const embedTexts = async (state, texts) => {
  if (!Array.isArray(texts) || texts.length === 0) return { ok: true, vectors: [] }
  const res = await apiCall('/v1/embeddings', { method: 'POST', token: state.token, body: { model: embedModelId(), input: texts } })
  const failure = embedFailure(res)
  if (failure !== null) return { ok: false, ...failure }
  const data = res.body !== null && Array.isArray(res.body.data) ? res.body.data.slice() : []
  data.sort((a, b) => (Number(a && a.index) || 0) - (Number(b && b.index) || 0))
  const vectors = data.map((d) => (d !== null && typeof d === 'object' ? d.embedding : null))
  const sane = vectors.length === texts.length && vectors.every((v) => Array.isArray(v) && v.length === EMBED_DIM && v.every((x) => typeof x === 'number' && Number.isFinite(x)))
  if (sane !== true) return { ok: false, error: 'embedding_invalide' }
  meaningCache.planBlockedAt = 0
  return { ok: true, vectors }
}

/** Stores one vector on a memory. 503 = this server cannot (no pgvector); 404 = gone (or an older server). */
const putEmbedding = async (state, id, vector) => {
  const res = await apiCall('/v1/memories/' + encodeURIComponent(String(id)) + '/embedding', { method: 'PUT', token: state.token, body: { embedding: vector, model: embedModelId() } })
  if (res.status === 200) return { ok: true }
  if (res.status === 503) return { ok: false, error: 'sens_indisponible' }
  if (res.status === 404) {
    const unknownRoute = res.body !== null && typeof res.body.error === 'string' && res.body.error.indexOf('Unknown memories route') >= 0
    return { ok: false, error: unknownRoute ? 'serveur_ancien' : 'souvenir_introuvable' }
  }
  return { ok: false, error: memoryFailure(res) || 'refus_' + String(res.status) }
}

const noteMeaningUnavailable = (error) => {
  meaningCache.lastError = error
  if (error === 'sens_indisponible' || error === 'serveur_ancien') meaningCache.unavailableAt = Date.now()
}

/** One page of the account's memories as the server filters it (`embedded=false|true`). */
const serverPage = async (state, query) => apiCall('/v1/memories?scope=account&' + query, { token: state.token })

/**
 * What this server can do, whether the plan allows it, and how much is indexed.
 * `available`: true / false (no pgvector, or a server that predates the routes) / null (could not tell).
 * `allowed`: true / false (the plan does not include the embeddings model; `requiredTier` says which does) / null
 * (never tried). `probe` spends ONE embedding call (a 2-letter text) to find out, only when asked.
 */
const meaningStatus = async (state, options) => {
  const settings = readMemorySettings()
  const base = { ok: true, enabled: settings.meaning, available: null, allowed: null, requiredTier: null, plan: null, reason: null, total: null, indexed: null, remaining: null, last: meaningCache.lastError }
  const todo = await serverPage(state, 'embedded=false&limit=1')
  if (todo.status === 503) return { ...base, available: false, reason: 'sens_indisponible' }
  const failure = memoryFailure(todo)
  if (failure !== null) return { ...base, reason: failure }
  if (todo.body === null || typeof todo.body.total !== 'number') return { ...base, available: false, reason: 'serveur_ancien' }
  const done = await serverPage(state, 'embedded=true&limit=1')
  const indexed = done.body !== null && typeof done.body.total === 'number' ? done.body.total : null
  const remaining = todo.body.total
  meaningCache.unavailableAt = 0
  if (options !== undefined && options.probe === true) {
    const probe = await embedTexts(state, ['ok'])
    if (probe.ok !== true) noteEmbedFailure(probe)
  }
  const blocked = Date.now() - meaningCache.planBlockedAt < MEANING_BACKOFF_MS
  const probed = options !== undefined && options.probe === true
  return {
    ...base, available: true,
    allowed: blocked ? false : (probed ? true : null),
    requiredTier: blocked ? meaningCache.requiredTier : null, plan: blocked ? meaningCache.plan : null,
    total: indexed === null ? null : indexed + remaining, indexed, remaining, last: meaningCache.lastError,
  }
}

/** Indexes up to `max` (≤ INDEX_BATCH_MAX) memories that have no vector yet, newest first. */
const indexMemories = async (state, max) => {
  if (readMemorySettings().meaning !== true) return { ok: false, error: 'sens_desactive', indexed: 0 }
  const paused = meaningPaused()
  if (paused !== null) return { ok: false, error: paused, indexed: 0, requiredTier: paused === 'offre_requise' ? meaningCache.requiredTier : undefined }
  const cap = Math.min(INDEX_BATCH_MAX, Math.max(1, Number.isFinite(max) ? Math.floor(max) : INDEX_BATCH_MAX))
  let indexed = 0
  let remaining = null
  while (indexed < cap) {
    const want = Math.min(EMBED_BATCH, cap - indexed)
    const page = await serverPage(state, 'embedded=false&order=recent&limit=' + String(want))
    if (page.status === 503) { noteMeaningUnavailable('sens_indisponible'); return { ok: false, error: 'sens_indisponible', indexed } }
    const failure = memoryFailure(page)
    if (failure !== null) return { ok: false, error: failure, indexed }
    if (page.body === null || typeof page.body.total !== 'number') { noteMeaningUnavailable('serveur_ancien'); return { ok: false, error: 'serveur_ancien', indexed } }
    const rows = Array.isArray(page.body.memories) ? page.body.memories : []
    remaining = Math.max(0, page.body.total - rows.length)
    if (rows.length === 0) break
    const emb = await embedTexts(state, rows.map((r) => String(r.content)))
    if (emb.ok !== true) { noteEmbedFailure(emb); return { ok: false, error: emb.error, requiredTier: emb.requiredTier, indexed } }
    rememberVectors(rows.map((r) => String(r.content)), emb.vectors)
    for (let i = 0; i < rows.length; i++) {
      const put = await putEmbedding(state, rows[i].id, emb.vectors[i])
      if (put.ok !== true && put.error !== 'souvenir_introuvable') { noteMeaningUnavailable(put.error); return { ok: false, error: put.error, indexed } }
      if (put.ok === true) indexed += 1
    }
  }
  meaningCache.lastError = null
  meaningCache.lastIndexedAt = Date.now()
  return { ok: true, indexed, remaining: remaining === null ? 0 : remaining }
}

/** Fire-and-forget: a memory that was just written or edited gets its vector. A miss is fine: the next indexing run covers it. */
const indexOneInBackground = (state, memory) => {
  try {
    if (memory === null || memory === undefined || readMemorySettings().meaning !== true) return
    if (meaningPaused() !== null) return
    void (async () => {
      const emb = await embedTexts(state, [String(memory.content)])
      if (emb.ok !== true) { noteEmbedFailure(emb); return }
      rememberVectors([String(memory.content)], emb.vectors)
      const put = await putEmbedding(state, memory.id, emb.vectors[0])
      if (put.ok !== true) noteMeaningUnavailable(put.error)
    })().catch(() => {})
  } catch (e) { /* never break a write */ }
}

/** The memories nearest to `q` by meaning: `{ ok, items:[{…memory, distance}] }`. */
const findByMeaning = async (state, q, limit) => {
  const settings = readMemorySettings()
  if (settings.meaning !== true) return { ok: false, error: 'sens_desactive' }
  const paused = meaningPaused()
  if (paused !== null) return { ok: false, error: paused, requiredTier: paused === 'offre_requise' ? meaningCache.requiredTier : undefined }
  const emb = await embedTexts(state, [q])
  if (emb.ok !== true) { noteEmbedFailure(emb); return { ok: false, error: emb.error, requiredTier: emb.requiredTier } }
  const res = await apiCall('/v1/memories/search', { method: 'POST', token: state.token, body: { embedding: emb.vectors[0], scope: 'account', limit } })
  if (res.status === 503) { noteMeaningUnavailable('sens_indisponible'); return { ok: false, error: 'sens_indisponible' } }
  if (res.status === 404 || res.status === 405) { noteMeaningUnavailable('serveur_ancien'); return { ok: false, error: 'serveur_ancien' } }
  const failure = memoryFailure(res)
  if (failure !== null) return { ok: false, error: failure }
  const raw = res.body !== null && Array.isArray(res.body.memories) ? res.body.memories : []
  return { ok: true, items: raw.map((m) => ({ ...asMemory(m), distance: typeof m.distance === 'number' ? m.distance : null })) }
}

// ── The map: memories placed by meaning ─────────────────────────────────────────────────────────────────
// Close dots mean close meaning. The positions are worked out HERE (mapproj.mjs) from the embedding vectors of a sample of memories
// (pinned first, then the ones sent to the model, then the newest). The vectors come from the same route as the search by meaning and
// sit behind the same `meaning` switch (the text of a memory goes to the embeddings model, nothing else); they are kept in a side file
// next to the state (`memory-vectors`: int8 + scale, keyed by a hash of the text, so an edited memory is simply a new key), which also
// fills while the memories are indexed, so opening the map is usually free. No server route is involved.

const MAP_VECTORS_MAX = 800
const MAP_TEXT_MAX = 1000
let mapInFlight = null

const readVectorCache = () => {
  const raw = readSide('memory-vectors', {})
  if (raw.model !== embedModelId() || raw.dim !== EMBED_DIM || raw.v === null || typeof raw.v !== 'object' || Array.isArray(raw.v)) return {}
  return raw.v
}

const writeVectorCache = (cache, keep) => {
  let keys = Object.keys(cache)
  if (keep !== undefined) keys = keys.filter((k) => keep.has(k))
  if (keys.length > MAP_VECTORS_MAX) keys = keys.slice(keys.length - MAP_VECTORS_MAX)
  const v = {}
  for (const k of keys) v[k] = cache[k]
  try { writeSide('memory-vectors', { model: embedModelId(), dim: EMBED_DIM, v }) } catch (e) { /* the map just recomputes next time */ }
}

/** Keeps vectors that were just paid for (indexing, a new memory) so the map does not ask for them again. Never throws. */
const rememberVectors = (texts, vectors) => {
  try {
    const cache = readVectorCache()
    texts.forEach((t, i) => { if (Array.isArray(vectors[i]) && vectors[i].length === EMBED_DIM) cache[textHash(String(t).slice(0, MAP_TEXT_MAX))] = packVector(vectors[i]) })
    writeVectorCache(cache)
  } catch (e) { /* a cache, nothing more */ }
}

/** At most `limit` memories: the pinned ones, then the ones sent to the model, then the newest. */
const mapSample = (rows, limit) => {
  if (rows.length <= limit) return rows
  const out = []
  const seen = new Set()
  const add = (r) => { if (out.length < limit && !seen.has(r.id)) { seen.add(r.id); out.push(r) } }
  rows.filter((r) => r.pinned).forEach(add)
  rows.filter((r) => r.sent).forEach(add)
  rows.forEach(add)
  return out
}

const buildMemoryMap = async (state, limit) => {
  if (readMemorySettings().meaning !== true) return { ok: false, error: 'sens_desactive' }
  const paused = meaningPaused()
  if (paused !== null) return { ok: false, error: paused, requiredTier: paused === 'offre_requise' ? meaningCache.requiredTier : undefined, plan: paused === 'offre_requise' ? meaningCache.plan : undefined }
  await refreshMemoryCache(state, false)
  if (memoryCache.error !== null && memoryCache.account.length === 0) return { ok: false, connected: true, error: memoryCache.error }
  const { rows: all } = accountRows(state)
  const rows = all.map((r) => ({ ...r, text: String(r.content).slice(0, MAP_TEXT_MAX) }))
  const sample = mapSample(rows, limit)
  const cache = readVectorCache()
  const vectors = new Array(sample.length).fill(null)
  const missing = []
  sample.forEach((r, i) => {
    const hit = cache[textHash(r.text)]
    const v = hit === undefined ? null : unpackVector(hit, EMBED_DIM)
    if (v !== null) vectors[i] = v; else missing.push(i)
  })
  let changed = false
  for (let at = 0; at < missing.length; at += EMBED_BATCH) {
    const part = missing.slice(at, at + EMBED_BATCH)
    const emb = await embedTexts(state, part.map((i) => sample[i].text))
    if (emb.ok !== true) {
      noteEmbedFailure(emb)
      if (changed) writeVectorCache(cache)   // what was paid for is kept: the next try goes on from here
      return { ok: false, error: emb.error, requiredTier: emb.requiredTier, plan: emb.plan }
    }
    part.forEach((i, k) => { cache[textHash(sample[i].text)] = packVector(emb.vectors[k]); vectors[i] = unpackVector(cache[textHash(sample[i].text)], EMBED_DIM); changed = true })
  }
  if (changed) writeVectorCache(cache, new Set(rows.map((r) => textHash(r.text))))
  meaningCache.lastError = null
  const map = buildMap(sample.map((r) => ({ id: r.id, text: r.text })), vectors)
  return {
    ok: true, total: rows.length, shown: sample.length, embedded: missing.length,
    // each dot carries the memory as the list shows it, so the page can open it as it does from the list
    nodes: sample.map((r, i) => { const { text, ...memory } = r; return { ...memory, x: map.nodes[i].x, y: map.nodes[i].y, cl: map.nodes[i].cl } }),
    clusters: map.clusters, links: map.links,
  }
}

const memoryMeaningMapRoute = async (req) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  let params = new URLSearchParams('')
  try { params = new URL(req.url, 'http://localhost').searchParams } catch (e) { /* request without a query */ }
  const limit = intParam(params.get('limit'), MAP_TUNING.sample, 10, MAP_TUNING.sample)
  // two openings at once (the page remounts) share one computation, so the texts are embedded once
  if (mapInFlight === null) mapInFlight = buildMemoryMap(state, limit).finally(() => { mapInFlight = null })
  return await mapInFlight
}

// ── Tidy up: near-duplicates among the account's memories (dedupe.mjs, local, no model) ─────────────────
// A scan only LOOKS: it groups near-duplicates and stores the groups, nothing is changed. Applying a group keeps one
// memory (the pinned one if any, else the most complete, or the one the user picks, optionally edited) and deletes
// the others — and the server deletes for good, so BEFORE any delete the removed rows (and the kept one's old text)
// are written to a local archive, which is what Undo restores from, for 30 days. A pinned memory is never removed.
// Side files next to the state: `tidy` (last scan, groups the user kept apart, log of runs) and `tidy-archive`.

const TIDY_UNDO_DAYS = 30
const TIDY_MAX_REMOVALS = 50
const TIDY_DISMISSED_MAX = 500
const TIDY_LOG_MAX = 50

const tidyState = () => {
  const raw = readSide('tidy', {})
  return {
    scan: raw.scan !== null && typeof raw.scan === 'object' ? raw.scan : null,
    dismissed: Array.isArray(raw.dismissed) ? raw.dismissed.map(String) : [],
    log: Array.isArray(raw.log) ? raw.log : [],
    settings: normalizeTidySettings(raw.settings),
    last: raw.last !== null && typeof raw.last === 'object' && typeof raw.last.at === 'string' ? raw.last : null,
    judged: raw.judged !== null && typeof raw.judged === 'object' && !Array.isArray(raw.judged) ? raw.judged : {},
  }
}
const writeTidy = (t) => writeSide('tidy', { scan: t.scan, dismissed: t.dismissed.slice(-TIDY_DISMISSED_MAX), log: t.log.slice(0, TIDY_LOG_MAX), settings: t.settings, last: t.last, judged: t.judged })

// The Study model (Kybernos Settings → `brain`: a « route/id », `none`, or empty = Automatic, the model kybernos-sessions
// publishes) and the `llm` service that can talk to it.
const kybernosSettingsFile = () => {
  const own = process.env.KYBERNOS_SETTINGS_FILE
  return typeof own === 'string' && own.trim() !== '' ? own.trim() : join(dshHome(), 'kybernos', 'settings.json')
}
const studyChoice = () => readStudyChoice(() => readFileSync(kybernosSettingsFile(), 'utf8'))
const studyModel = () => studyChoice().model
/** What the page needs of the Study model: its name, whether it was picked for the person, whether they chose none, and whether a model service exists. */
const studyView = () => { const c = studyChoice(); return { model: c.model, auto: c.auto, none: c.none, llm: tidyLlm() !== undefined } }
const tidyLlm = () => { try { return hostCtx === null ? undefined : hostCtx.get('llm') } catch (e) { return undefined } }
// A run that starts by itself, and the process-wide flags it needs.
const TIDY_TUNING = { firstMs: 90000, tickMs: 600000 }
const tidyFlags = { running: false, bootDone: false, retryAt: 0 }
const tidyArchive = () => { const raw = readSide('tidy-archive', {}); return { runs: raw.runs !== null && typeof raw.runs === 'object' ? raw.runs : {} } }
const writeTidyArchive = (a) => writeSide('tidy-archive', a)

const forgetOldArchive = () => {
  const limit = Date.now() - TIDY_UNDO_DAYS * 86400000
  const a = tidyArchive()
  let changed = false
  for (const id of Object.keys(a.runs)) { if (!(Date.parse(a.runs[id].at) > limit)) { delete a.runs[id]; changed = true } }
  if (changed) writeTidyArchive(a)
  return a
}

/** What the page needs: the groups of the last scan (without the ones the user kept apart), the log and what can still be undone. */
const tidyView = () => {
  const t = tidyState()
  const a = forgetOldArchive()
  const now = Date.now()
  const groups = t.scan === null ? [] : t.scan.groups.filter((g) => t.dismissed.indexOf(g.id) < 0).map((g) => ({
    ...g, items: g.items.map((i) => { const when = parseWhen(i.createdAt); return { ...i, ageMinutes: Number.isFinite(when) ? Math.max(0, Math.round((now - when) / 60000)) : null } }),
  }))
  return {
    ok: true, scannedAt: t.scan === null ? null : t.scan.at, total: t.scan === null ? null : t.scan.total, groups,
    saves: groups.reduce((n, g) => n + g.saves, 0),
    log: t.log.slice(0, 20).map((l) => ({ ...l, canUndo: l.undone !== true && a.runs[l.id] !== undefined })),
    settings: t.settings, last: t.last,
    next: tidyNext({ schedule: t.settings.schedule, last: t.last, now, total: memoryCache.account.length > 0 ? memoryCache.account.length : null, bootDone: tidyFlags.bootDone }),
    brain: studyView(),
    unclear: t.scan === null || !Number.isFinite(t.scan.unclear) ? 0 : t.scan.unclear,
  }
}

/**
 * One run: look (local detection, and — when the user allowed it and a Study model is set — its judgement of the pairs
 * the word count cannot decide), then, in `auto` mode, merge by itself the local groups at or above the line. Anything
 * else is left for the review. A run that was started by the schedule is `trigger: 'schedule'`.
 */
const tidyRun = async (state, trigger, now = Date.now()) => {
  if (tidyFlags.running) return { ok: false, error: 'deja_en_cours' }
  tidyFlags.running = true
  try {
    await refreshMemoryCache(state, true)
    if (memoryCache.error !== null && memoryCache.account.length === 0) return { ok: false, error: memoryCache.error }
    const items = memoryCache.account.map((m) => ({ id: m.id, content: m.content, createdAt: m.createdAt, pinned: m.pinned === true, bucket: m.kind }))
    const t = tidyState()
    const local = findDuplicateGroups(items)
    const taken = new Set(local.flatMap((g) => g.items.map((i) => i.id)))
    let suggestions = []
    let unclear = 0
    const brain = { asked: 0, error: null, detail: null, model: '' }
    if (t.settings.brain === true) {
      brain.model = studyModel()
      const llm = tidyLlm()
      const judged = await brainGroups({ items, taken, judged: t.judged, dismissed: t.dismissed, llm: brain.model === '' ? null : llm, model: brain.model, maxMerged: MEMORY_MAX_CONTENT, noun: 'memories' })
      suggestions = judged.groups
      unclear = judged.unclear
      brain.asked = judged.asked
      brain.error = brain.model === '' ? 'pas_de_modele_detude' : (llm === undefined ? 'llm_indisponible' : judged.error)
      t.judged = judged.judged
      brain.detail = brain.error === null ? null : (judged.detail === undefined ? null : judged.detail)
      if (brain.error !== null && brain.error !== 'pas_de_modele_detude' && brain.error !== 'llm_indisponible') console.error('[kybernos-cloud] tidy-up: the Study model could not be asked (' + brain.error + (brain.detail === null ? '' : ': ' + brain.detail) + ')')
    } else {
      unclear = unclearPairs(items, { taken }).filter((p) => t.dismissed.indexOf(p.id) < 0).length
    }
    t.scan = { at: new Date(now).toISOString(), total: items.length, unclear, groups: [...local, ...suggestions] }
    writeTidy(t)
    // 2. what the user allowed to be merged without asking
    const auto = { groups: 0, removed: 0, runs: [], failed: 0 }
    const picked = pickAuto(local.filter((g) => t.dismissed.indexOf(g.id) < 0), t.settings)
    for (const chunk of removalChunks(picked, TIDY_MAX_REMOVALS)) {
      const done = await applyGroups(state, chunk.map((g) => ({ id: g.id })), 'auto', now)
      if (done.error !== undefined) { auto.failed += chunk.length; continue }
      for (const r of done.results) {
        if (r.ok === true) { auto.groups += 1; auto.removed += r.removed || 0; if (r.run) auto.runs.push(r.run) } else auto.failed += 1
      }
    }
    const after = tidyState()
    after.last = { at: new Date(now).toISOString(), trigger, total: items.length - auto.removed, found: local.length + suggestions.length, autoGroups: auto.groups, autoRemoved: auto.removed, brainAsked: brain.asked, brainError: brain.error, ok: true }
    writeTidy(after)
    return { ...tidyView(), auto, brain }
  } finally {
    tidyFlags.running = false
  }
}
const tidyScan = (state) => tidyRun(state, 'manual')

const tidySettings = (body) => {
  const t = tidyState()
  const patched = patchTidySettings(t.settings, body)
  if (patched.ok !== true) return patched
  t.settings = patched.settings
  writeTidy(t)
  return { ok: true, settings: t.settings, view: tidyView() }
}

/** One look at whether a scheduled run is due; a run that fails waits an hour. Never throws, never runs offline. */
const tidyTick = async (now = Date.now()) => {
  try {
    const state = readState()
    if (isConnected(state) !== true || readMemorySettings().memories !== true) return { ran: false, why: 'hors_connexion' }
    const t = tidyState()
    const total = memoryCache.account.length > 0 ? memoryCache.account.length : null
    const due = tidyDue({ schedule: t.settings.schedule, last: t.last, now, total, bootDone: tidyFlags.bootDone, retryAt: tidyFlags.retryAt })
    if (t.settings.schedule === 'start') tidyFlags.bootDone = true
    if (!due) return { ran: false, why: 'pas_echu' }
    const res = await tidyRun(state, 'schedule', now)
    if (res.ok !== true) { tidyFlags.retryAt = now + 3600000; return { ran: false, why: res.error } }
    return { ran: true, auto: res.auto }
  } catch (e) {
    tidyFlags.retryAt = now + 3600000
    return { ran: false, why: 'erreur' }
  }
}

const mountProfileRefresh = (ctx) => {
  ctx.effect(() => {
    const first = setTimeout(() => { void profileRefreshTick() }, PROFILE_REFRESH_TUNING.firstMs)
    const timer = setInterval(() => { void profileRefreshTick() }, PROFILE_REFRESH_TUNING.tickMs)
    if (typeof first.unref === 'function') first.unref()
    if (typeof timer.unref === 'function') timer.unref()
    return () => { clearTimeout(first); clearInterval(timer) }
  }, 'kybernos-cloud: periodic profile read')
}
const mountTidySchedule = (ctx) => {
  ctx.effect(() => {
    const first = setTimeout(() => { void tidyTick() }, TIDY_TUNING.firstMs)
    const timer = setInterval(() => { void tidyTick() }, TIDY_TUNING.tickMs)
    if (typeof first.unref === 'function') first.unref()
    if (typeof timer.unref === 'function') timer.unref()
    return () => { clearTimeout(first); clearInterval(timer) }
  }, 'kybernos-cloud: nettoyage planifie')
}

const tidyDismiss = (body) => {
  const ids = body !== null && typeof body === 'object' && Array.isArray(body.groups) ? body.groups.map(String) : []
  if (ids.length === 0) return { ok: false, error: 'groupes_manquants' }
  const t = tidyState()
  if (body.restore === true) t.dismissed = t.dismissed.filter((d) => ids.indexOf(d) < 0)   // Undo of « Keep both »
  else for (const id of ids) if (t.dismissed.indexOf(id) < 0) t.dismissed.push(id)
  writeTidy(t)
  return tidyView()
}

/**
 * Applies the groups the user accepted. `body = { confirm: true, groups: [{ id, keep?, edit? }] }`. Every group is checked
 * against what the account holds NOW (a memory that changed or vanished since the scan is skipped, never guessed).
 */
const tidyApply = async (state, body) => {
  if (body === null || typeof body !== 'object' || body.confirm !== true) return { ok: false, error: 'confirmation_requise' }
  const asked = Array.isArray(body.groups) ? body.groups : []
  if (asked.length === 0) return { ok: false, error: 'groupes_manquants' }
  const done = await applyGroups(state, asked, 'you')
  if (done.error !== undefined) return { ok: false, error: done.error, ...(done.max === undefined ? {} : { max: done.max, wanted: done.wanted }) }
  return { ok: done.results.every((r) => r.ok === true), results: done.results, view: tidyView() }
}

/** The work of an apply, for the user's click (`by: 'you'`) and for a run that merges by itself (`by: 'auto'`). */
const applyGroups = async (state, asked, by, now = Date.now()) => {
  const t = tidyState()
  if (t.scan === null) return { error: 'aucun_scan', results: [] }
  await refreshMemoryCache(state, true)
  if (memoryCache.error !== null && memoryCache.account.length === 0) return { error: memoryCache.error, results: [] }
  const live = new Map(memoryCache.account.map((m) => [String(m.id), m]))
  // plan first (nothing is written until every group is judged): a request that would remove too much is refused whole
  const plan = []
  const results = []
  let removals = 0
  for (const want of asked) {
    const id = want !== null && typeof want === 'object' ? String(want.id) : ''
    const group = t.scan.groups.find((g) => g.id === id)
    if (group === undefined) { results.push({ id, ok: false, error: 'groupe_inconnu' }); continue }
    const members = group.items.map((i) => live.get(String(i.id)))
    if (members.some((m, k) => m === undefined || m.content !== group.items[k].content)) { results.push({ id, ok: false, error: 'a_change' }); continue }
    const pinned = members.filter((m) => m.pinned === true)
    let keepId = want.keep === undefined || want.keep === null ? String(group.keeperId) : String(want.keep)
    if (members.every((m) => String(m.id) !== keepId)) { results.push({ id, ok: false, error: 'garde_invalide' }); continue }
    if (pinned.length > 0 && pinned.some((m) => String(m.id) !== keepId)) { results.push({ id, ok: false, error: 'epingle_protege' }); continue }
    let edit = null
    if (typeof want.edit === 'string' && want.edit.trim() !== '') {
      edit = want.edit.trim()
      if (edit.length > MEMORY_MAX_CONTENT) { results.push({ id, ok: false, error: 'contenu_trop_long' }); continue }
    }
    const keeper = live.get(keepId)
    const removed = members.filter((m) => String(m.id) !== keepId)
    removals += removed.length
    plan.push({ group, keeper, removed, edit: edit !== null && edit !== keeper.content ? edit : null })
  }
  if (removals > TIDY_MAX_REMOVALS) return { error: 'trop_de_suppressions', max: TIDY_MAX_REMOVALS, wanted: removals, results: [] }
  const log = []
  for (const step of plan) {
    const runId = 't' + Date.now().toString(36) + step.group.id
    const archive = tidyArchive()
    const row = (m) => ({ id: m.id, content: m.content, kind: m.kind, scope: m.scope, kyberId: m.kyberId, source: m.source, pinned: m.pinned === true, retentionDays: m.retentionDays, createdAt: m.createdAt })
    // 1. the archive FIRST: if anything below fails half way, what was removed can always be put back
    archive.runs[runId] = { at: new Date().toISOString(), removed: step.removed.map(row), edited: step.edit === null ? [] : [{ id: step.keeper.id, before: step.keeper.content }] }
    writeTidyArchive(archive)
    let edited = false
    if (step.edit !== null) {
      const patched = await patchMemory(state, { id: step.keeper.id, content: step.edit })
      if (patched.ok !== true) { delete archive.runs[runId]; writeTidyArchive(archive); results.push({ id: step.group.id, ok: false, error: patched.error }); continue }
      edited = true
    }
    const gone = []
    let failure = null
    for (const m of step.removed) {
      const del = await deleteMemory(state, { id: m.id })
      if (del.ok !== true) { failure = del.error; break }
      gone.push(m.id)
    }
    // the archive keeps ONLY what was really deleted (and the old text only if it was really edited)
    const kept = tidyArchive()
    kept.runs[runId].removed = kept.runs[runId].removed.filter((r) => gone.indexOf(r.id) >= 0)
    if (!edited) kept.runs[runId].edited = []
    if (kept.runs[runId].removed.length === 0 && kept.runs[runId].edited.length === 0) delete kept.runs[runId]
    writeTidyArchive(kept)
    if (gone.length > 0 || edited) log.push({ id: runId, at: new Date(now).toISOString(), by, groupId: step.group.id, kept: step.keeper.id, removed: gone.length, edited, partial: failure !== null, undone: false })
    results.push({ id: step.group.id, ok: failure === null, removed: gone.length, edited, run: gone.length > 0 || edited ? runId : null, error: failure === null ? undefined : failure })
  }
  const after = tidyState()
  const done = new Set(results.filter((r) => r.ok === true).map((r) => r.id))
  if (after.scan !== null) after.scan.groups = after.scan.groups.filter((g) => !done.has(g.id))
  after.log = [...log.reverse(), ...after.log]
  writeTidy(after)
  return { results }
}

/** Puts a run back: the removed memories come back as NEW memories (new ids), the edited keeper gets its old text. */
const tidyUndo = async (state, body) => {
  const runId = body !== null && typeof body === 'object' ? String(body.run || '') : ''
  if (runId === '') return { ok: false, error: 'run_manquant' }
  const t = tidyState()
  const entry = t.log.find((l) => l.id === runId)
  if (entry === undefined) return { ok: false, error: 'run_inconnu' }
  if (entry.undone === true) return { ok: false, error: 'deja_annule' }
  const archive = tidyArchive()
  const run = archive.runs[runId]
  if (run === undefined) return { ok: false, error: 'archive_perimee' }
  let restored = 0
  const failed = []
  for (const r of run.removed) {
    const made = await createMemory(state, { scope: r.scope === 'kyber' ? 'kyber' : 'account', kind: r.kind, content: r.content, source: r.source, pinned: r.pinned === true, retentionDays: r.retentionDays, kyberId: r.kyberId === null ? undefined : r.kyberId }, 'taught')
    if (made.ok === true) restored += 1
    else failed.push(r)
  }
  let reverted = 0
  for (const e of run.edited) {
    const back = await patchMemory(state, { id: e.id, content: e.before })
    if (back.ok === true) reverted += 1
  }
  // what could not be put back stays in the archive, and the run stays undoable
  if (failed.length === 0) {
    delete archive.runs[runId]
    entry.undone = true
  } else {
    run.removed = failed
    run.edited = []
  }
  writeTidyArchive(archive)
  writeTidy(t)
  return { ok: failed.length === 0, restored, reverted, failed: failed.length, view: tidyView() }
}

// ── Team lessons ─────────────────────────────────────────────────────────────────────────────────────
// What the owners and admins of a TEAM workspace approved, read by every agent of it (team-lessons.mjs holds the rules; the server
// is /v1/workspaces/{id}/lessons). Three jobs here: keep the approved list in a small cache (the prompt only ever reads the cache),
// answer the page (list, propose, approve, reject, retire, withdraw) and add one block to the system prompt.
// The workspace is the ACTIVE one of the plugin (the sidebar's switcher); membership and roles are the server's business.

const teamCache = { at: 0, workspaceId: null, lessons: [], role: null, counts: { approved: 0, pending: 0 }, error: null }
const teamPickStore = new Map()   // sessionId -> { key, ids, turn } : the relevance pick of the team block, apart from the memories'
const TEAM_RELEVANCE = { ...RELEVANCE_TUNING, maxPicked: 3, maxCandidates: 8, share: 0.5 }

const emptyTeamCache = () => {
  teamCache.at = 0
  teamCache.workspaceId = null
  teamCache.lessons = []
  teamCache.role = null
  teamCache.counts = { approved: 0, pending: 0 }
  teamCache.error = null
  teamPickStore.clear()
}

const teamNow = (state) => teamWorkspace(state, state === null || state === undefined ? null : espaceActif(state))
const teamBase = (workspaceId) => '/v1/workspaces/' + encodeURIComponent(workspaceId) + '/lessons'

/** Re-reads the approved lessons of the active team workspace when the cache is older than its TTL (or `force`). Never throws. */
const refreshTeamCache = async (state, force) => {
  const ws = teamNow(state)
  if (ws.available !== true) { if (teamCache.workspaceId !== null) emptyTeamCache(); return ws }
  if (teamCache.workspaceId !== ws.workspaceId) emptyTeamCache()
  if (force !== true && teamCache.workspaceId === ws.workspaceId && Date.now() - teamCache.at < TEAM_TUNING.ttlMs) return ws
  const res = await apiCall(teamBase(ws.workspaceId) + '?view=approved&limit=' + String(TEAM_TUNING.fetchMax), { token: state.token })
  const failure = teamFailure(res.status, res.body)
  teamCache.workspaceId = ws.workspaceId
  if (failure !== null || res.body === null || !Array.isArray(res.body.lessons)) {
    teamCache.error = failure !== null ? failure : 'reponse_invalide'
    // a short retry delay, not the whole TTL; what was read before stays until the workspace is no longer ours
    teamCache.at = Date.now() - TEAM_TUNING.ttlMs + 60000
    if (teamCache.error === 'espace_introuvable') { teamCache.lessons = []; teamCache.role = null; teamCache.counts = { approved: 0, pending: 0 } }
    return ws
  }
  // A row that is not an object (the server's list is typed, a proxy's or a broken deploy's is not) is not a lesson: it is dropped, and a list
  // with nothing usable in it is an invalid answer. This runs from fire-and-forget refreshes (`void refresh…`): a throw here ends DSH.
  const rows = res.body.lessons.filter((r) => r !== null && typeof r === 'object' && Array.isArray(r) !== true)
  if (res.body.lessons.length > 0 && rows.length === 0) {
    teamCache.error = 'reponse_invalide'
    teamCache.at = Date.now() - TEAM_TUNING.ttlMs + 60000
    return ws
  }
  teamCache.at = Date.now()
  teamCache.error = null
  teamCache.lessons = rows.map(asTeamLesson)
  teamCache.role = typeof res.body.role === 'string' ? res.body.role : null
  teamCache.counts = res.body.counts !== null && typeof res.body.counts === 'object' ? { approved: Number(res.body.counts.approved) || 0, pending: Number(res.body.counts.pending) || 0 } : { approved: teamCache.lessons.length, pending: 0 }
  return ws
}

/** The personal-lessons plugin's own switches (`kybernos-memory.json`): turning its context off also silences the team block. */
const lessonsSwitches = () => {
  const own = process.env.KYBERNOS_MEMORY_SETTINGS
  const file = typeof own === 'string' && own.trim() !== '' ? own.trim() : join(dshHome(), 'kybernos-memory.json')
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    return { lessons: raw.lessons !== false, context: raw.context !== false }
  } catch (e) { return { lessons: true, context: true } }
}

/** The kyber a chat runs (`<kybers>/.active/<session>`, written by the lessons plugin); null when unknown. */
const activeKyberOf = (sessionId) => {
  if (typeof sessionId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{5,79}$/.test(sessionId)) return null
  try {
    const row = JSON.parse(readFileSync(join(kybersDir(), '.active', sessionId), 'utf8'))
    return typeof row.kyber === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(row.kyber) && row.kyber.indexOf('..') < 0 ? row.kyber : null
  } catch (e) { return null }
}

/** What a session receives: from the cache only (synchronous), and nothing unless every switch says so. */
const teamSelection = (state, sessionId) => {
  const none = { plan: { chosen: [], omitted: 0, used: 0 }, ws: teamNow(state), kyber: null, picked: [] }
  if (state === null || state === undefined) return none
  const ws = none.ws
  const cfg = readMemorySettings()
  const sw = lessonsSwitches()
  if (ws.available !== true || cfg.team_use !== true || sw.lessons !== true || sw.context !== true || teamCache.workspaceId !== ws.workspaceId) return none
  const kyber = activeKyberOf(sessionId)
  const pool = applicable(teamCache.lessons, kyber)
  let preferred = []
  if (cfg.relevant === true && typeof sessionId === 'string' && sessionId !== '') {
    const hits = pickRelevant(sessionId, pool.map((l) => ({ id: l.id, content: l.text + ' ' + l.tags.join(' '), createdAt: l.updatedAt })), teamPickStore, TEAM_RELEVANCE)
    preferred = hits.map((h) => pool.find((l) => l.id === h.id)).filter((l) => l !== undefined)
  }
  return { plan: teamPlan(teamCache.lessons, kyber, preferred), ws, kyber, picked: preferred.map((l) => l.id) }
}

/** The block of the system prompt. Synchronous and never throws: '' on any doubt. */
const renderTeamPrompt = (state, sessionId) => {
  try {
    const sel = teamSelection(state, sessionId)
    return renderTeamChunk(sel.plan, sel.ws.workspaceName === undefined ? '' : sel.ws.workspaceName)
  } catch (e) { return '' }
}

const isLessonId = (v) => (typeof v === 'number' && Number.isInteger(v) && v > 0) || (typeof v === 'string' && /^\d{1,18}$/.test(v))

const teamCall = async (state, method, suffix, body) => {
  const ws = teamNow(state)
  if (ws.available !== true) return { ok: false, error: ws.reason }
  const res = await apiCall(teamBase(ws.workspaceId) + suffix, { method, token: state.token, ...(body === undefined ? {} : { body }) })
  const failure = teamFailure(res.status, res.body)
  if (failure !== null) return { ok: false, error: failure }
  return { ok: true, body: res.body, ws }
}

const teamStatusRoute = async (req) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  const ws = teamNow(state)
  if (ws.available === true) await refreshTeamCache(state, false)
  const cfg = readMemorySettings()
  let params = new URLSearchParams('')
  try { params = new URL(req.url, 'http://localhost').searchParams } catch (e) { /* no query */ }
  const sid = String(params.get('session') || '')
  const sel = sid === '' ? null : teamSelection(state, sid.replace(/^session-/, ''))
  const mine = ws.available === true && teamCache.workspaceId === ws.workspaceId
  return {
    ok: true, connected: true,
    team: { available: ws.available, reason: ws.reason, plan: ws.plan === undefined ? null : ws.plan, workspaceId: ws.workspaceId === undefined ? null : ws.workspaceId, workspaceName: ws.workspaceName === undefined ? null : ws.workspaceName,
      role: mine ? teamCache.role : null, counts: mine ? teamCache.counts : { approved: 0, pending: 0 }, error: mine ? teamCache.error : null },
    settings: { use: cfg.team_use === true, share: cfg.team_share === true },
    sent: sel === null ? null : { count: sel.plan.chosen.length, omitted: sel.plan.omitted, picked: sel.picked.length, kyber: sel.kyber },
  }
}

const teamListRoute = async (req) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  const ws = teamNow(state)
  if (ws.available !== true) return { ok: false, error: ws.reason }
  let params = new URLSearchParams('')
  try { params = new URL(req.url, 'http://localhost').searchParams } catch (e) { /* no query */ }
  const view = ['approved', 'proposed', 'mine', 'all'].indexOf(params.get('view')) >= 0 ? params.get('view') : 'approved'
  let query = 'view=' + view + '&limit=' + String(intParam(params.get('limit'), 100, 1, 200)) + '&offset=' + String(intParam(params.get('offset'), 0, 0, 100000))
  if (params.get('kyber') !== null) query += '&kyber=' + encodeURIComponent(String(params.get('kyber')).slice(0, 64))
  const made = await teamCall(state, 'GET', '?' + query)
  if (made.ok !== true) return made
  const b = made.body !== null && typeof made.body === 'object' ? made.body : {}
  if (!Array.isArray(b.lessons)) return { ok: false, error: 'reponse_invalide' }
  return { ok: true, connected: true, role: typeof b.role === 'string' ? b.role : null, view: b.view, total: b.total, limit: b.limit, offset: b.offset, counts: b.counts, lessons: b.lessons.map(asTeamLesson), workspaceName: ws.workspaceName }
}

/** After a write: the cache is stale, and the next reading must see it. */
const afterTeamWrite = (state) => { teamCache.at = 0; void refreshTeamCache(state, true).catch(() => {}) }

const teamAddRoute = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  if (readMemorySettings().team_share !== true) return { ok: false, error: 'partage_desactive' }
  const b = body !== null && typeof body === 'object' ? body : {}
  if (typeof b.text !== 'string' || b.text.trim() === '') return { ok: false, error: 'texte_invalide' }
  const payload = { text: b.text, name: displayName(state) }
  if (typeof b.kyber === 'string' && b.kyber !== '') payload.kyber = b.kyber
  if (Array.isArray(b.tags)) payload.tags = b.tags
  if (typeof b.note === 'string' && b.note.trim() !== '') payload.note = b.note
  const made = await teamCall(state, 'POST', '', payload)
  if (made.ok !== true) return made
  afterTeamWrite(state)
  return { ok: true, lesson: asTeamLesson(made.body) }
}

const teamReviewRoute = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  const b = body !== null && typeof body === 'object' ? body : {}
  if (!isLessonId(b.id)) return { ok: false, error: 'lecon_introuvable' }
  if (b.decision !== 'approve' && b.decision !== 'reject') return { ok: false, error: 'requete_invalide' }
  const payload = { decision: b.decision, name: displayName(state) }
  if (typeof b.note === 'string' && b.note.trim() !== '') payload.note = b.note
  if (b.decision === 'approve' && typeof b.text === 'string' && b.text.trim() !== '') payload.text = b.text
  if (b.decision === 'approve' && typeof b.kyber === 'string') payload.kyber = b.kyber
  const made = await teamCall(state, 'POST', '/' + String(b.id) + '/review', payload)
  if (made.ok !== true) return made
  afterTeamWrite(state)
  return { ok: true, lesson: asTeamLesson(made.body) }
}

const teamRetireRoute = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  const b = body !== null && typeof body === 'object' ? body : {}
  if (!isLessonId(b.id)) return { ok: false, error: 'lecon_introuvable' }
  const made = await teamCall(state, 'POST', '/' + String(b.id) + '/retire', { name: displayName(state) })
  if (made.ok !== true) return made
  afterTeamWrite(state)
  return { ok: true, lesson: asTeamLesson(made.body) }
}

const teamDeleteRoute = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  const b = body !== null && typeof body === 'object' ? body : {}
  if (!isLessonId(b.id)) return { ok: false, error: 'lecon_introuvable' }
  const made = await teamCall(state, 'DELETE', '/' + String(b.id))
  if (made.ok !== true) return made
  afterTeamWrite(state)
  return { ok: true }
}

// ── Team skills ──────────────────────────────────────────────────────────────────────
// A Team's private catalogue of skills (docs/dev/team-skills-contract.md): any member proposes one, an owner or admin approves it, every
// member can install it. Reserved to the Team plan by the same rule as the lessons (`teamWorkspace`). This side only talks to the server
// with the account token; reading a local skill and writing an installed one is kybernos-skills' business (the page carries the files
// from one to the other), so no skill content is ever kept here.
const teamSkillsCall = async (state, method, suffix, body) => {
  const ws = teamNow(state)
  if (ws.available !== true) return { ok: false, error: ws.reason }
  const res = await apiCall(teamSkillsBase(ws.workspaceId) + suffix, { method, token: state.token, ...(body === undefined ? {} : { body }) })
  const failure = teamSkillsFailure(res.status, res.body)
  if (failure !== null) return { ok: false, ...failure }
  return { ok: true, body: res.body, ws }
}

const paramsOf = (req) => {
  try { return new URL(req.url, 'http://localhost').searchParams } catch (e) { return new URLSearchParams('') }
}

const teamSkillsListRoute = async (req) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  const params = paramsOf(req)
  const view = ['approved', 'proposed', 'mine', 'all'].indexOf(params.get('view')) >= 0 ? params.get('view') : 'approved'
  const query = 'view=' + view + '&limit=' + String(intParam(params.get('limit'), 100, 1, 200)) + '&offset=' + String(intParam(params.get('offset'), 0, 0, 100000))
  const made = await teamSkillsCall(state, 'GET', '?' + query)
  if (made.ok !== true) return made
  const b = made.body !== null && typeof made.body === 'object' ? made.body : {}
  if (!Array.isArray(b.skills)) return { ok: false, error: 'invalid_response' }
  return { ok: true, connected: true, role: typeof b.role === 'string' ? b.role : null, view: b.view, total: b.total, limit: b.limit, offset: b.offset, counts: b.counts, skills: b.skills.map(asTeamSkill), workspaceName: made.ws.workspaceName }
}

const teamSkillsItemRoute = async (req) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  const id = paramsOf(req).get('id')
  if (!isSkillId(id)) return { ok: false, error: 'skill_not_found' }
  const made = await teamSkillsCall(state, 'GET', '/' + String(id))
  if (made.ok !== true) return made
  if (made.body === null || typeof made.body !== 'object' || !Array.isArray(made.body.files)) return { ok: false, error: 'invalid_response' }
  return { ok: true, skill: asTeamSkill(made.body) }
}

const teamSkillsAddRoute = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  const b = body !== null && typeof body === 'object' ? body : {}
  if (typeof b.name !== 'string' || b.name === '' || typeof b.description !== 'string' || !Array.isArray(b.files) || b.files.length === 0) return { ok: false, error: 'bad_request' }
  const payload = { name: b.name, description: b.description, files: b.files, display_name: displayName(state) }
  if (typeof b.note === 'string' && b.note.trim() !== '') payload.note = b.note
  const made = await teamSkillsCall(state, 'POST', '', payload)
  if (made.ok !== true) return made
  return { ok: true, skill: asTeamSkill(made.body) }
}

const teamSkillsReviewRoute = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  const b = body !== null && typeof body === 'object' ? body : {}
  if (!isSkillId(b.id)) return { ok: false, error: 'skill_not_found' }
  if (b.decision !== 'approve' && b.decision !== 'reject') return { ok: false, error: 'bad_request' }
  const payload = { decision: b.decision, display_name: displayName(state) }
  if (typeof b.note === 'string' && b.note.trim() !== '') payload.note = b.note
  const made = await teamSkillsCall(state, 'POST', '/' + String(b.id) + '/review', payload)
  if (made.ok !== true) return made
  return { ok: true, skill: asTeamSkill(made.body) }
}

const teamSkillsRetireRoute = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  const b = body !== null && typeof body === 'object' ? body : {}
  if (!isSkillId(b.id)) return { ok: false, error: 'skill_not_found' }
  const made = await teamSkillsCall(state, 'POST', '/' + String(b.id) + '/retire', { display_name: displayName(state) })
  if (made.ok !== true) return made
  return { ok: true, skill: asTeamSkill(made.body) }
}

const teamSkillsDeleteRoute = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  const b = body !== null && typeof body === 'object' ? body : {}
  if (!isSkillId(b.id)) return { ok: false, error: 'skill_not_found' }
  const made = await teamSkillsCall(state, 'DELETE', '/' + String(b.id))
  if (made.ok !== true) return made
  return { ok: true }
}

/**
 * Paginated, filtered list of the ACCOUNT's memories. Everything is computed here, on the
 * cache: the server does not paginate yet (`GET /v1/memories` returns everything), so
 * the page must not receive 631 rows to display 25. `sent` comes from
 * `planInjection` — the same selection as the prompt. The search is textual
 * (`mode: exact`): relevance will need an index on the server side.
 */
/** The account's memories as the page shows them (newest first, with what is sent to the model), and the injection plan they were measured against. */
const accountRows = (state) => {
  const plan = planInjection(state)
  const sentIds = new Set(plan.account.chosen.map((m) => String(m.id)))
  const ledger = readSide('memory-origins', {})
  const now = Date.now()
  const rows = memoryCache.account.slice().sort(newestFirst).map((m) => {
    const o = originOf(m, ledger)
    const when = parseWhen(m.createdAt)
    return {
      id: m.id, kind: m.kind, content: m.content, source: m.source, origin: o.origin, originKnown: o.originKnown,
      pinned: m.pinned === true, sent: sentIds.has(String(m.id)), createdAt: m.createdAt, expiresAt: m.expiresAt, retentionDays: m.retentionDays,
      ageMinutes: Number.isFinite(when) ? Math.max(0, Math.round((now - when) / 60000)) : null,
    }
  })
  return { plan, rows }
}

const memoryListRoute = async (req) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  let params = new URLSearchParams('')
  try { params = new URL(req.url, 'http://localhost').searchParams } catch (e) { /* request without a query */ }
  // `fresh=1` is the page's own « look again » (it opens, or the person refreshes): a memory written on the web or by another
  // device is there at once. Without it the 60 s cache serves paging and filters, which must not call the server each time.
  await refreshMemoryCache(state, params.get('fresh') === '1')
  if (memoryCache.error !== null && memoryCache.account.length === 0) return { ok: false, connected: true, error: memoryCache.error }
  const limit = intParam(params.get('limit'), 25, 1, 200)
  const offset = intParam(params.get('offset'), 0, 0, 1000000)
  const show = ['pinned', 'sent'].indexOf(params.get('show')) >= 0 ? params.get('show') : 'all'
  const src = ['capture', 'agent', 'you', 'sync'].indexOf(params.get('src')) >= 0 ? params.get('src') : 'any'
  const added = ADDED_WINDOW_MIN[params.get('added')] !== undefined ? params.get('added') : 'any'
  const qRaw = String(params.get('q') || '').trim()
  const q = qRaw.toLowerCase()
  const wantMeaning = params.get('mode') === 'meaning' && q !== ''

  const { plan, rows } = accountRows(state)
  const youOrigin = (r) => r.origin === 'taught'
  const counts = {
    all: rows.length, pinned: rows.filter((r) => r.pinned).length, sent: rows.filter((r) => r.sent).length,
    capture: rows.filter((r) => r.origin === 'capture').length, agent: rows.filter((r) => r.origin === 'agent').length,
    you: rows.filter(youOrigin).length, sync: rows.filter((r) => r.origin === 'sync').length,
  }
  let list = rows
  if (show === 'pinned') list = list.filter((r) => r.pinned)
  if (show === 'sent') list = list.filter((r) => r.sent)
  if (src !== 'any') list = list.filter((r) => (src === 'you' ? youOrigin(r) : r.origin === src))
  if (added !== 'any') list = list.filter((r) => r.ageMinutes !== null && r.ageMinutes <= ADDED_WINDOW_MIN[added])
  // The words search ranks by relevance, locally (relevance.mjs): no model, no network, any plan. The order is
  // best first, and each item says how many of the query's words it matched.
  const byRelevance = (items) => rankByRelevance(items, qRaw).map((r) => ({ ...r.doc, matched: r.matched, of: r.of }))
  let search = { mode: 'relevance', relevance: true }
  if (wantMeaning) {
    // Search by meaning: the server ranks, we only decorate and filter. Any failure falls back to the words
    // search below, with the reason, so the page always shows something and says why it is not by meaning.
    const found = await findByMeaning(state, String(params.get('q')).trim(), 50)
    if (found.ok === true) {
      const byId = new Map(rows.map((r) => [String(r.id), r]))
      list = found.items.map((m) => {
        const known = byId.get(String(m.id))
        const base = known !== undefined ? known : { id: m.id, kind: m.kind, content: m.content, source: m.source, origin: 'sync', originKnown: false, pinned: m.pinned, sent: false, createdAt: m.createdAt, expiresAt: m.expiresAt, retentionDays: m.retentionDays, ageMinutes: null }
        return { ...base, closeness: typeof m.distance === 'number' ? Math.max(0, Math.min(100, Math.round((1 - m.distance) * 100))) : null }
      })
      if (show === 'pinned') list = list.filter((r) => r.pinned)
      if (show === 'sent') list = list.filter((r) => r.sent)
      if (src !== 'any') list = list.filter((r) => (src === 'you' ? youOrigin(r) : r.origin === src))
      if (added !== 'any') list = list.filter((r) => r.ageMinutes !== null && r.ageMinutes <= ADDED_WINDOW_MIN[added])
      search = { mode: 'meaning', relevance: true }
    } else {
      search = { mode: 'relevance', relevance: true, fallback: found.error, requiredTier: found.requiredTier === undefined ? null : found.requiredTier }
      list = byRelevance(list)
    }
  } else if (q !== '') {
    list = byRelevance(list)
  }
  // The chat this page is open next to (`?session=`): how many memories were picked for its latest message.
  const sid = String(params.get('session') || '')
  const pick = sid === '' ? undefined : (sessionPick.get(sid) || sessionPick.get(sid.replace(/^session-/, '')))
  const picked = pick === undefined ? null : { count: pick.ids.length, turn: pick.turn }
  return {
    ok: true, connected: true,
    total: list.length, limit, offset, items: list.slice(offset, offset + limit),
    counts, filters: { show, src, added, q },
    search, picked,
    budget: { cap: plan.budget, used: renderMemoryChunk(state).length, sent: plan.account.chosen.length, omitted: plan.account.omitted },
    settings: readMemorySettings(),
    cache: { at: memoryCache.at, error: memoryCache.error },
  }
}

/** Search by meaning: is it on, can this server do it, how much is indexed. Two light reads, no embedding call. */
const memoryIndexStatusRoute = async (req) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  let probe = false
  try { probe = new URL(req.url, 'http://localhost').searchParams.get('probe') === '1' } catch (e) { probe = false }
  // A probe embeds a 2-letter text: only when the switch is on, never on its own.
  return await meaningStatus(state, { probe: probe && readMemorySettings().meaning === true })
}

/** Indexes one batch (≤ 64) of the memories without a vector. The page calls it again until `remaining` is 0. */
const memoryIndexRunRoute = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  const max = body !== null && typeof body === 'object' && body.max !== undefined ? Number(body.max) : INDEX_BATCH_MAX
  return await indexMemories(state, max)
}

const memoryTidyRoute = async () => tidyView()
const memoryTidyScanRoute = async () => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  return await tidyScan(state)
}
const memoryTidyApplyRoute = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  return await tidyApply(state, body)
}
const memoryTidyDismissRoute = async (req, body) => tidyDismiss(body)
const memoryTidySettingsRoute = async (req, body) => tidySettings(body)
const memoryTidyUndoRoute = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  return await tidyUndo(state, body)
}

const memoryLessonsRoute = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  const dry = body === null ? true : body.dryRun !== false
  return await pushLessons(state, { dryRun: dry })
}

// ── Tools exposed to the model ──────────────────────────────────────────────
// Built by hand: `defineTool` lives in `@deepseek-ai/dsh-tools`, which this
// plugin (without dependencies) cannot import, but `tools.register` requires
// only { name, parameters, output:{schema,render}, execute }.
// `kyber_id` is DELIBERATELY not exposed: a model must not be able to
// target another one's kyber (server spec §7, checker F4). The kyber scope is
// chosen by the caller on the DSH side, never by the model.

const TEXT_RESULT = (text) => [{
  type: 'text',
  text,
}]

const memoryWriteTool = () => ({
  name: 'memory_write',
  description: 'Saves a lasting memory in the Kybernos account (shared with the user\'s other agents). Use it only for an explicit teaching or a correction — never to guess.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      content: { type: 'string', description: 'The memory, in one sentence.' },
      kind: { type: 'string', enum: MEMORY_KINDS, description: 'fact | preference | event | policy' },
      source: { type: 'string', enum: MEMORY_SOURCES, description: 'Where the memory comes from. Default: conversation.' },
      pinned: { type: 'boolean', description: 'Pinned: never expires.' },
    },
    required: ['content', 'kind'],
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean' },
        id: { type: 'integer' },
        error: { type: 'string' },
      },
      required: ['ok'],
    },
    render: (args, value) => TEXT_RESULT(value.ok === true ? 'Memory saved in the Kybernos account (' + String(args.kind) + ').' : 'Memory not saved: ' + String(value.error)),
  },
  async execute(args) {
    const state = readState()
    if (isConnected(state) !== true) return { ok: false, error: 'compte_kybernos_non_connecte' }
    if (readMemorySettings().memories !== true) return { ok: false, error: 'memoire_desactivee' }
    const made = await createMemory(state, {
      scope: 'account',
      kind: args.kind,
      content: args.content,
      source: typeof args.source === 'string' ? args.source : 'conversation',
      pinned: args.pinned === true,
    }, 'agent')
    return made.ok === true ? { ok: true, id: made.memory === null ? 0 : Number(made.memory.id) } : { ok: false, error: made.error }
  },
})

const memorySearchTool = () => ({
  name: 'memory_search',
  description: 'Searches the memories of the Kybernos account (facts, preferences, events, policies).',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      q: { type: 'string', description: 'Words to search for.' },
    },
    required: ['q'],
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean' },
        count: { type: 'integer' },
        found: { type: 'string' },
        error: { type: 'string' },
      },
      required: ['ok'],
    },
    render: (args, value) => TEXT_RESULT(value.ok === true ? (value.count === 0 ? 'No memory for “' + String(args.q) + '”.' : String(value.found)) : 'Search failed: ' + String(value.error)),
  },
  async execute(args) {
    const state = readState()
    if (isConnected(state) !== true) return { ok: false, error: 'compte_kybernos_non_connecte' }
    if (readMemorySettings().memories !== true) return { ok: false, error: 'memoire_desactivee' }
    const found = await searchMemories(state, args.q)
    if (found.ok !== true) return { ok: false, error: found.error }
    const lines = sortMemories(found.items).slice(0, 10).map((m) => '#' + String(m.id) + ' (' + String(m.kind) + (m.scope === 'kyber' ? ', kyber' : '') + ') ' + String(m.content))
    return { ok: true, count: found.items.length, found: lines.join('\n') }
  },
})

// ── End-of-turn capture ─────────────────────────────────────────────────────
// DSH equivalent of the platform's « option C »: after a successful turn, a
// background completion (maxTokens 300) extracts what deserves to be
// retained and writes it to the account. Never blocks, never throws, and does
// nothing offline.

// Markers of the block THIS plugin injects into the prompt. The capture re-reads the
// messages of the current turn: when the turn received the injection, the extraction
// therefore re-read the memory block and REWROTE the same memory — a feedback
// loop observed live on 22/09/2026 (memory #53, exact duplicate of
// #51, which appeared at the end of the turn of a sub-agent that carried the injection). The block
// is removed BEFORE the text is submitted.
const MEMORY_BLOCK_HEAD = '[KYBERNOS MEMORY]'
const MEMORY_BLOCK_TAIL = 'memory_search to look one up.'

const stripMemoryBlock = (value) => {
  let text = String(value)
  for (;;) {
    const start = text.indexOf(MEMORY_BLOCK_HEAD)
    if (start < 0) break
    const end = text.indexOf(MEMORY_BLOCK_TAIL, start)
    text = text.slice(0, start) + (end < 0 ? '' : text.slice(end + MEMORY_BLOCK_TAIL.length))
  }
  return text.trim()
}

// Comparable form of a memory, for idempotence.
const normalizeMemory = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const lastTurnText = (messages) => {
  const text = (m) => {
    if (m === null || typeof m !== 'object' || Array.isArray(m.content) === false) return ''
    return m.content.filter((block) => block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('\n')
  }
  // DSH writes messages of its own with the user role (the runtime-context snapshot, the time sample, the skill catalogue, a model-switch note). They carry
  // `source.kind`, `user` for what the person typed: only those are the person's words (measured in a session log of DSH 0.2.1-alpha.4).
  const theirs = (m) => !(m.source !== null && typeof m.source === 'object' && typeof m.source.kind === 'string' && m.source.kind !== 'user')
  const user = messages.filter((m) => m.role === 'user' && theirs(m)).slice(-1)[0]
  const assistant = messages.filter((m) => m.role === 'assistant').slice(-1)[0]
  const left = stripMemoryBlock(user === undefined ? '' : text(user))
  const right = stripMemoryBlock(assistant === undefined ? '' : text(assistant))
  // Roles are NAMED: without a label, the extraction model cannot
  // tell what the user taught from what the agent asserted —
  // and the instruction « extract only what the user taught » becomes
  // inapplicable (observed risk: the agent quotes itself).
  const both = (left === '' ? '' : 'USER:\n' + left + '\n\n') + (right === '' ? '' : 'AGENT:\n' + right)
  return both.trim() === '' ? null : both.trim().slice(0, 6000)
}

const CAPTURE_PROMPT = 'You read the end of a conversation turn between a user and their coding agent. '
  + 'Extract ONLY what the user taught about themselves, their environment or their lasting preferences '
  + '(for example “I live in Paris”, “I prefer answers in French”, “this project deploys on Fly.io”). '
  + 'Extract nothing that is a detail of the current task, a temporary file path or a guess. '
  + 'Answer in strict JSON: {"memories":[{"content":"…","kind":"fact|preference|event|policy"},…]} '
  + 'or {"memories":[]} if there is nothing. No text around the JSON.'

const extractFacts = async (ctx, agent, text, signal) => {
  const llm = ctx.get('llm')
  if (llm === undefined) return []
  const options = agent.options === undefined ? {} : agent.options
  const header = typeof agent.session.requestHeader === 'function' ? agent.session.requestHeader() : undefined
  const latest = header === undefined || header === null ? undefined : header.config
  const target = (typeof options.provider === 'string' && typeof options.model === 'string')
    ? { provider: options.provider, model: options.model }
    : latest
  if (target === undefined || typeof target.provider !== 'string' || typeof target.model !== 'string') return []
  const messages = [{ role: 'user', content: [{ type: 'text', text: CAPTURE_PROMPT + '\n\n---\n' + text }] }]
  let raw = ''
  const stream = llm.stream({
    provider: target.provider,
    model: target.model,
    messages,
    maxTokens: CAPTURE_MAX_TOKENS,
    sessionId: agent.session.id,
    purpose: 'memory-capture',
    ...signal === undefined ? {} : { signal },
  })
  for await (const chunk of stream) {
    if (chunk !== null && typeof chunk === 'object' && chunk.type === 'text-delta' && typeof chunk.text === 'string') raw += chunk.text
  }
  const open = raw.indexOf('{')
  const close = raw.lastIndexOf('}')
  if (open < 0 || close <= open) return []
  let parsed = null
  try { parsed = JSON.parse(raw.slice(open, close + 1)) } catch (e) { return [] }
  const rows = parsed !== null && Array.isArray(parsed.memories) ? parsed.memories : []
  return rows
    .filter((r) => r !== null && typeof r === 'object' && typeof r.content === 'string' && MEMORY_KINDS.indexOf(r.kind) >= 0)
    .map((r) => ({ content: r.content.trim(), kind: r.kind }))
    .filter((r) => r.content.length >= 8 && r.content.length <= MEMORY_MAX_CONTENT)
    .slice(0, 3)
}

/**
 * Last run of the capture. Deliberately minimal observability (in
 * memory, not persisted): without it, an unavailable `llm` or an extraction
 * that fails would be indistinguishable from « nothing to retain » — the same blind spot
 * as « the panel is selected » without « the panel is visible ».
 */
const lastCapture = { at: 0, status: 'jamais', facts: 0 }

const noteCapture = (status, facts) => {
  lastCapture.at = Date.now()
  lastCapture.status = status
  lastCapture.facts = facts
}

const captureTurn = async (ctx, agent, signal) => {
  try {
    const state = readState()
    if (isConnected(state) !== true) return noteCapture('hors_connexion', 0)
    // The switches come BEFORE any network or LLM call: « Capture: no »
    // must not cost a single token.
    const cfg = readMemorySettings()
    if (cfg.memories !== true || cfg.capture !== true) return noteCapture('desactivee', 0)
    if (agent === undefined || agent === null || agent.session === undefined) return noteCapture('sans_session', 0)
    const messages = typeof agent.session.deriveMessages === 'function' ? agent.session.deriveMessages() : []
    const text = lastTurnText(messages)
    if (text === null || text.length < CAPTURE_MIN_CHARS) return noteCapture('tour_trop_court', 0)
    if (ctx.get('llm') === undefined) return noteCapture('llm_indisponible', 0)
    const facts = await extractFacts(ctx, agent, text, signal)
    if (facts.length === 0) return noteCapture('rien_a_retenir', 0)
    // Idempotence: a fact already present in the account is not rewritten. Without
    // this guard, the same fact is written on every turn that carries it — the account
    // fills up with duplicates (observed live: #53 = #51). The read is
    // fail-open: if it fails, we write anyway (removing the injected
    // block remains the first rampart).
    const existing = await listMemories(state, 'account')
    const known = new Set(existing.ok === true ? existing.items.map((m) => normalizeMemory(m.content)) : [])
    let written = 0
    let skipped = 0
    let failed = 0
    for (const fact of facts) {
      const key = normalizeMemory(fact.content)
      if (key === '' || known.has(key) === true) { skipped += 1; continue }
      known.add(key)
      const made = await createMemory(state, { scope: 'account', kind: fact.kind, content: fact.content, source: 'conversation' }, 'capture')
      if (made.ok === true) written += 1
      else failed += 1
    }
    // Nothing written because EVERYTHING failed is not « written: 0 »: the card
    // must be able to say that the capture is down.
    if (written === 0 && failed > 0) return noteCapture('erreur', 0)
    if (written === 0 && skipped > 0) return noteCapture('deja_connu', 0)
    noteCapture('ecrit', written)
  } catch (e) {
    // Fire-and-forget: the capture never breaks a turn.
    noteCapture('erreur', 0)
  }
}

const sessionIdOfContext = (context) => {
  try { return context.agent.session.id } catch (e) { return undefined }
}

const mountMemoryPrompt = (ctx) => {
  // `inject` (and not `get`): this is the shape of native plugins, and it
  // gives a scope where `scope.systemPrompt` is the service. Without it, nothing.
  ctx.inject(['systemPrompt'], (scope) => {
    scope.systemPrompt.context({
      name: 'kybernos:memory',
      order: MEMORY_INJECT_ORDER,
      text: (context) => renderMemoryPrompt(readState(), { sessionId: sessionIdOfContext(context) }),
    })
    // The lessons the team approved: a block of its own, from the cache only (refreshed below and by the tick).
    scope.systemPrompt.context({
      name: TEAM_CHUNK_NAME,
      order: TEAM_CHUNK_ORDER,
      text: (context) => renderTeamPrompt(readState(), sessionIdOfContext(context)),
    })
  })
  // The human's message of each turn, to pick the memories that match it (see « The memories that matter »).
  ctx.on('agent/inbox/claimed', ({ agent, message, turn }) => {
    try { noteUserTurn(agent.session.id, message, turn) } catch (e) { /* never break a turn */ }
  })
  const state = readState()
  // Fire-and-forget: a rejection here would be an unhandled one, which ends DSH. Each refresh also guards itself; this is the second wall.
  if (isConnected(state) === true) setTimeout(() => { void refreshMemoryCache(readState(), true).catch(() => {}); void refreshTeamCache(readState(), true).catch(() => {}) }, 1500)
}

const mountMemoryTools = (ctx) => {
  ctx.inject(['tools'], (scope) => {
    scope.tools.register(memoryWriteTool())
    scope.tools.register(memorySearchTool())
  })
}

/**
 * Refreshes the cache as soon as it is stale. `force` stays false: the TTL is
 * finally respected (before, every caller forced and it was useless).
 * The timer is released with the plugin and does not hold the process.
 */
const mountMemoryRefresh = (ctx) => {
  ctx.effect(() => {
    const timer = setInterval(() => { void refreshMemoryCache(readState(), false).catch(() => {}); void refreshTeamCache(readState(), false).catch(() => {}) }, MEMORY_TUNING.tickMs)
    if (typeof timer.unref === 'function') timer.unref()
    return () => clearInterval(timer)
  }, 'kybernos-cloud: rafraichissement memoire')
}

const mountMemoryCapture = (ctx) => {
  ctx.on('agent/turn-stopping', ({ agent, signal }) => {
    void captureTurn(ctx, agent, signal)
  })
}

// ── DSH chat detail — LOCAL READ ONLY ───────────────────────────────────────
// The content of a conversation NEVER leaves the machine: the route reads the
// session log on disk (<DSH home>/sessions/<slug>/<id>/session.v4.jsonl.zstd)
// and answers directly. Nothing goes through Supabase, unlike the push of
// metadata (title + project + date only). CORS restricted to the origins
// of the dev webapp (localhost:8081) — never « * »: an arbitrary web page
// must not be able to read the local conversations by drive-by.
const DSH_CORS_ORIGINS = ['http://localhost:8081', 'http://127.0.0.1:8081']
const DSH_DETAIL_MAX_MESSAGES = 300
const DSH_DETAIL_MAX_CHARS = 4000

const zstdFrames = (buf) => {
  // The log is a series of CONCATENATED zstd frames (one frame per flush).
  // zstdDecompressSync stops at the first frame: we hunt for the magic
  // 0x28B52FFD frame by frame, validating each decompression (a magic
  // candidate can fall INSIDE the compressed data of the previous frame —
  // wrong slice = decompress error = next candidate).
  const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
  const parts = []
  let cursor = 0
  while (cursor < buf.length - 4) {
    let start = cursor
    let out = null
    while (start <= buf.length - 4) {
      const at = buf.indexOf(magic, start)
      if (at < 0) break
      const next = buf.indexOf(magic, at + 4)
      const end = next < 0 ? buf.length : next
      try {
        const txt = zstdDecompressSync(buf.subarray(at, end)).toString('utf8')
        if (txt.startsWith('{')) { out = { txt, end: next < 0 ? buf.length : next }; break }
      } catch { /* false candidate or packed frame: we try the next one */ }
      start = at + 1
    }
    if (!out) break
    parts.push(out.txt)
    cursor = out.end
  }
  return parts.join('')
}

const blocsTexte = (contenu) => {
  if (typeof contenu === 'string') return contenu
  if (Array.isArray(contenu)) {
    return contenu.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n')
  }
  return ''
}

const chatsDetail = (req) => {
  const url = new URL(req.url, 'http://local')
  const dshId = String(url.searchParams.get('dsh_id') || '').trim()
  if (!/^[\w-]{8,80}$/.test(dshId)) return { ok: false, error: 'dsh_id missing' }
  let dossier = null
  const sessions = sessionsHome()
  try {
    for (const slug of readdirSync(sessions)) {
      const candidat = join(sessions, slug, dshId)
      try {
        if (statSync(candidat).isDirectory()) { dossier = candidat; break }
      } catch { /* not this slug */ }
    }
  } catch { /* unreadable home */ }
  if (!dossier) return { ok: false, error: 'session not found on this machine' }
  let journal = ''
  try {
    const fichiers = readdirSync(dossier).filter((f) => f.endsWith('.jsonl.zstd')).sort()
    if (fichiers.length === 0) return { ok: false, error: 'no session log' }
    journal = zstdFrames(readFileSync(join(dossier, fichiers[0])))
  } catch (e) {
    return { ok: false, error: 'unreadable log: ' + String((e && e.message) || e).slice(0, 80) }
  }
  const messages = []
  for (const ligne of journal.split('\n')) {
    if (messages.length >= DSH_DETAIL_MAX_MESSAGES) break
    let e = null
    try { e = JSON.parse(ligne) } catch { continue }
    const d = e && e.data ? e.data : {}
    if (e.type === 'user/message') {
      // source.kind tells the real user speech ('user') from the injections
      // (agent-instructions, runtime-context, skill-catalog…).
      const kind = d.source && typeof d.source === 'object' ? d.source.kind : null
      if (kind && kind !== 'user') continue
      let txt = blocsTexte(d.content)
      txt = txt.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim()
      if (txt !== '') messages.push({ role: 'user', text: txt.slice(0, DSH_DETAIL_MAX_CHARS), time: e.time || null })
    } else if (e.type === 'assistant/message') {
      const m = d.message || {}
      const txt = blocsTexte(m.content).trim()
      if (txt !== '') messages.push({ role: 'assistant', text: txt.slice(0, DSH_DETAIL_MAX_CHARS), time: e.time || null })
    }
  }
  let titre = ''
  try {
    const cats = JSON.parse(readFileSync(categoriesFile(), 'utf8'))
    if (cats[dshId] && typeof cats[dshId].titre === 'string') titre = cats[dshId].titre
  } catch { /* no rename */ }
  return { ok: true, dsh_id: dshId, title: titre, messages, tronque: messages.length >= DSH_DETAIL_MAX_MESSAGES }
}

/** GET /kybernos-cloud/legal: where the active server publishes its terms and its privacy policy (`GET /v1/public/legal`, public: no
 *  token, a person may read them before an account). `null` for a document the server does not configure. The pages used to link
 *  to `<web>/terms` and `<web>/privacy` of the old web app, which the new server host does not serve. Only https links (or http
 *  to a loopback server, for tests and developers) are handed to the page: the owner of a server writes these addresses. */
const legalLink = (doc) => {
  if (doc === null || typeof doc !== 'object' || typeof doc.url !== 'string') return null
  let u = null
  try { u = new URL(doc.url) } catch (e) { return null }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].indexOf(u.hostname) >= 0)) return null
  if (u.username !== '' || u.password !== '') return null
  return { version: typeof doc.version === 'string' ? doc.version : '', url: u.toString() }
}
const legalRoute = async () => {
  const res = await apiCall('/v1/public/legal')
  if (res.status !== 200 || res.body === null || typeof res.body !== 'object') return { ok: false, terms: null, privacy: null, error: res.status === 0 ? 'reseau' : 'indisponible' }
  return { ok: true, terms: legalLink(res.body.terms), privacy: legalLink(res.body.privacy) }
}

// Kybernos connections (ADR 0008 of the server): the routes the connectors page calls, and three native tools for the agents. Nothing is
// asked of a server that does not offer them (`services.connections`), and nothing is sent without the account's own token.
// Which provider Settings › Connectors selected (kybernos-composio writes `<DSH home>/kybernos/connectors.json`): read each time, it is a
// few bytes, and anything unreadable means « nothing chosen ».
const connectorsProvider = () => {
  try {
    const v = JSON.parse(readFileSync(join(dshHome(), 'kybernos', 'connectors.json'), 'utf8'))
    return v !== null && typeof v === 'object' && (v.provider === 'composio' || v.provider === 'kybernos') ? v.provider : null
  } catch (e) { return null }
}
const connections = createConnections({ apiCall, readState, isConnected, server, providerChoice: connectorsProvider, log: (m) => console.error('[kybernos-cloud] connections: ' + m) })

// The Account page's "Custom instructions", kept as a marked section of `<DSH home>/AGENTS.md` (instructions.mjs): DSH's own loader hands
// that file to every agent. The page asks for the file's path so it can say where the text went (a hosted DSH is not the person's device).
const instructionsRead = async () => readInstructions(agentsFile(dshHome()))
const instructionsSave = async (req, body) => writeInstructions(agentsFile(dshHome()), body !== null && typeof body === 'object' ? body.text : undefined)

// ── A turn handed to this computer by the platform (ADR 0053 § 13.4) ───────────────────────────────
// A message the person wrote in a chat on their phone arrives as a turn addressed to THIS computer. The computer's runner (services/computer-image/runner.mjs, a process next to DSH) claims
// it with the computer's token and asks DSH to answer through these two routes, over loopback: `POST /kybernos-cloud/turn { prompt }` starts a session and queues the prompt,
// `POST /kybernos-cloud/turn/answer { sessionId }` reads the last words of it. Both need the computer's own token (`KYBERNOS_COMPUTER_TOKEN`, which only exists on a cloud computer) and a
// same-origin call: on a machine that is not a cloud computer they answer `unavailable`. The session keeps the profile's permission, as an automation set to `auto` does: nobody is there
// to answer an approval, so what lets a chat message reach this is the platform owner's own switch for it.
const turnAuthorized = (req) => {
  const id = String(process.env.KYBERNOS_COMPUTER_ID || '')
  const token = String(process.env.KYBERNOS_COMPUTER_TOKEN || '')
  if (id === '' || token === '') return false
  const given = String((req && req.headers && req.headers.authorization) || '')
  const want = 'Bearer ' + token
  if (given.length !== want.length) return false
  try { return timingSafeEqual(Buffer.from(given), Buffer.from(want)) } catch (e) { return false }
}
// The sessions this route made (in memory, bounded): `turn/continue` may queue one more prompt in those and in no other session of the machine.
const turnSessions = new Set()
/** The platform's turn (a runner job) each of those sessions belongs to: what a question to the person is asked ABOUT. */
const turnJobs = new Map()
/** Sessions whose person said « for the rest of this task »: the gate does not ask again in them. */
const turnAllowAll = new Set()
const TURN_JOB_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const rememberTurnSession = (id, jobId) => {
  turnSessions.add(id)
  if (typeof jobId === 'string' && TURN_JOB_RE.test(jobId)) turnJobs.set(id, jobId)
  if (turnSessions.size > 200) {
    const old = turnSessions.values().next().value
    turnSessions.delete(old)
    turnJobs.delete(old)
    turnAllowAll.delete(old)
  }
}

// ── The person is asked before their computer acts (ADR 0053 § 14) ───────────────────────────────
// A session made for a turn is gated: the tools that can change something (a command, a file, a connector) wait for the person's tap in their chat, asked through the platform. The gate
// is the plugin's own (`tools/pre-execute`, which DSH awaits as long as it takes): the profile stays `danger-full-access` for everything else on the machine, and DSH's own approval card
// is never raised. Whatever goes wrong (no job, the platform unreachable, no answer in time) is a refusal, never a pass.
const TURN_GATE_SAFE_TOOLS = new Set(['read', 'read_image', 'web_search', 'web_fetch'])
const TURN_GATE_WAIT_MS = 10 * 60_000 + 15_000
const turnRootOf = (ctx, id) => {
  // A sub-agent's call is its root session's.
  let current = id
  for (let depth = 0; depth < 6 && typeof current === 'string'; depth += 1) {
    if (turnSessions.has(current)) return current
    const sessions = ctx.get('sessions')
    const live = sessions !== undefined && sessions !== null && typeof sessions.get === 'function' ? sessions.get(current) : undefined
    const parent = live && live.header ? live.header.parentSession : undefined
    current = typeof parent === 'string' && parent !== '' ? parent : undefined
  }
  return null
}
const turnApprovalSubject = (exec) => {
  const name = String((exec && exec.name) || '')
  const args = exec && exec.arguments !== null && typeof exec.arguments === 'object' ? exec.arguments : {}
  const text = (v) => (typeof v === 'string' ? v : '')
  if (name === 'bash') return { kind: 'shell', summary: text(args.command) || text(args.description) || 'bash' }
  if (name === 'write') return { kind: 'write', summary: text(args.file_path) || 'write' }
  if (name === 'edit') return { kind: 'edit', summary: text(args.file_path) || 'edit' }
  let shown = ''
  try { shown = JSON.stringify(args) } catch (e) { shown = '' }
  const summary = (name + ' ' + shown).trim()
  return { kind: name.startsWith('mcp__') ? 'connector' : 'other', summary }
}
const turnPlatform = async (method, path, body) => {
  const api = String(process.env.KYBERNOS_API || '').replace(/\/+$/u, '')
  const token = String(process.env.KYBERNOS_COMPUTER_TOKEN || '')
  if (api === '' || token === '') return { status: 0, json: null }
  try {
    const r = await fetch(api + path, {
      method,
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
    let json = null
    try { json = JSON.parse(await r.text()) } catch (e) { /* not json */ }
    return { status: r.status, json }
  } catch (e) { return { status: 0, json: null } }
}
const turnGate = (ctx) => async (exec, next) => {
  if (String(process.env.KYBERNOS_COMPUTER_ID || '') === '') return next()
  const root = turnRootOf(ctx, exec && exec.agent ? exec.agent.id : undefined)
  if (root === null) return next()
  const name = String((exec && exec.name) || '')
  if (TURN_GATE_SAFE_TOOLS.has(name) || turnAllowAll.has(root)) return next()
  const refuse = (why) => ({ kind: 'deny', reason: 'The person did not allow this action (' + why + '). Do not try it again: say so in your answer.' })
  const jobId = turnJobs.get(root)
  if (jobId === undefined) return refuse('it could not be asked')
  const subject = turnApprovalSubject(exec)
  const made = await turnPlatform('POST', '/v1/computer/approvals', { job_id: jobId, kind: subject.kind, summary: subject.summary.slice(0, 2000) })
  if (made.status !== 200 || made.json === null || typeof made.json.id !== 'string') return refuse('it could not be asked')
  const id = made.json.id
  const stop = Date.now() + TURN_GATE_WAIT_MS
  while (Date.now() < stop) {
    if (exec && exec.signal && exec.signal.aborted === true) return refuse('the task was stopped')
    await new Promise((resolve) => setTimeout(resolve, Number(process.env.KYBERNOS_TURN_GATE_POLL_MS || 2000)))
    const got = await turnPlatform('GET', '/v1/computer/approvals?id=' + encodeURIComponent(id))
    const state = got.status === 200 && got.json !== null ? got.json.state : null
    if (state === 'allowed') return next()
    if (state === 'allowed_turn') { turnAllowAll.add(root); return next() }
    if (state === 'denied') return refuse('they refused it')
    if (state === 'expired') return refuse('they did not answer in time')
  }
  return refuse('they did not answer in time')
}
const mountTurnGate = (ctx) => { ctx.on('tools/pre-execute', turnGate(ctx)) }
const turnStart = async (req, body) => {
  if (turnAuthorized(req) !== true) return { ok: false, error: 'unavailable' }
  const prompt = body !== null && typeof body === 'object' && typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (prompt === '') return { ok: false, error: 'a prompt is expected' }
  const sc = hostCtx !== null && hostCtx !== undefined ? hostCtx.get('sessionController') : undefined
  if (sc === undefined || sc === null || typeof sc.create !== 'function' || typeof sc.prompt !== 'function') return { ok: false, error: 'sessions_unavailable' }
  const unwrap = (res) => {
    if (res === null || typeof res !== 'object') return null
    if (res.ok === false) throw new Error(res.error !== null && res.error !== undefined && res.error.message !== undefined ? String(res.error.message) : 'refused')
    const v = res.value !== undefined && res.value !== null ? res.value : res
    return typeof v.sessionId === 'string' ? v.sessionId : null
  }
  const sessionId = unwrap(await sc.create({}))
  if (sessionId === null) return { ok: false, error: 'no_session' }
  // Known to the gate BEFORE the prompt is queued: the first tool call must already find it gated.
  rememberTurnSession(sessionId, body.jobId)
  // Lets the session settle before the turn is assembled, as an automation's fire does.
  await new Promise((resolve) => setTimeout(resolve, 750))
  const controller = new AbortController()
  const ack = await sc.prompt({
    requestId: 'kb-turn-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    sessionId,
    mode: 'queue',
    content: [{ type: 'text', text: prompt.slice(0, 100000) }],
  }, controller.signal)
  if (ack !== null && typeof ack === 'object' && ack.ok === false) return { ok: false, error: 'prompt_refused' }
  return { ok: true, sessionId }
}
// One more prompt in a session this route made: the runner asks for the words when a turn ended without any.
const turnContinue = async (req, body) => {
  if (turnAuthorized(req) !== true) return { ok: false, error: 'unavailable' }
  const sessionId = body !== null && typeof body === 'object' && typeof body.sessionId === 'string' ? body.sessionId : ''
  const prompt = body !== null && typeof body === 'object' && typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (turnSessions.has(sessionId) !== true || prompt === '') return { ok: false, error: 'unknown_session' }
  const sc = hostCtx !== null && hostCtx !== undefined ? hostCtx.get('sessionController') : undefined
  if (sc === undefined || sc === null || typeof sc.prompt !== 'function') return { ok: false, error: 'sessions_unavailable' }
  const controller = new AbortController()
  const ack = await sc.prompt({
    requestId: 'kb-turn-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    sessionId,
    mode: 'queue',
    content: [{ type: 'text', text: prompt.slice(0, 4000) }],
  }, controller.signal)
  if (ack !== null && typeof ack === 'object' && ack.ok === false) return { ok: false, error: 'prompt_refused' }
  return { ok: true }
}
const turnAnswer = async (req, body) => {
  if (turnAuthorized(req) !== true) return { ok: false, error: 'unavailable' }
  const sessionId = body !== null && typeof body === 'object' && typeof body.sessionId === 'string' ? body.sessionId : ''
  if (/^[A-Za-z0-9_-]{1,80}$/.test(sessionId) === false) return { ok: false, error: 'a session id is expected' }
  const persistence = hostCtx !== null && hostCtx !== undefined ? hostCtx.get('sessionPersistence') : undefined
  if (persistence === undefined || persistence === null || typeof persistence.open !== 'function') return { ok: false, error: 'persistence_unavailable' }
  let events = []
  const handle = await persistence.open(sessionId, 'read')
  try {
    const read = await handle.read()
    events = read !== null && read !== undefined && Array.isArray(read.events) === true ? read.events : []
  } finally {
    try { if (handle !== null && handle !== undefined && typeof handle.close === 'function') await handle.close() } catch (e) { /* already closed */ }
  }
  let text = ''
  let tools = 0
  // What ended a turn that has no words, as a code: the type of the last event that says an error, and its `code` when it has one that is a code. Never a message (a message may carry the
  // person's words or a provider's): the runner passes this to the platform as the reason of a failed turn, where an owner can read it.
  let failure = ''
  let lastBlocks = ''
  const codeOf = (v) => (typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,60}$/.test(v) ? v.toLowerCase() : '')
  for (const ev of events) {
    if (ev === null || ev === undefined) continue
    if (typeof ev.type === 'string' && ev.type.startsWith('tool/')) tools += 1
    if (typeof ev.type === 'string' && /error|fail|refus/i.test(ev.type)) {
      const data = ev.data !== null && ev.data !== undefined && typeof ev.data === 'object' ? ev.data : {}
      failure = [codeOf(ev.type.replace(/[\/]/g, '_')), codeOf(data.code)].filter((x) => x !== '').join('.').slice(0, 80)
    }
    if (ev.type !== 'assistant/message') continue
    const message = ev.data !== null && ev.data !== undefined && typeof ev.data === 'object' ? ev.data.message : null
    if (message === null || message === undefined || Array.isArray(message.content) !== true) continue
    const parts = []
    const kinds = []
    for (const block of message.content) {
      if (block !== null && block !== undefined && typeof block.type === 'string' && kinds.length < 6) kinds.push(codeOf(block.type.replace(/[\\/]/g, '_')))
      if (block !== null && block !== undefined && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    }
    lastBlocks = kinds.filter((k) => k !== '').join('-')
    // The last message that has words is the answer: a message that only called a tool has none.
    if (parts.join('').trim() !== '') text = parts.join('\n')
  }
  // No error event: how the session ended, by the type of its last event (`ended_turn_end`), so that « no words » is never a mystery.
  if (text === '' && failure === '' && events.length > 0) {
    const last = events[events.length - 1]
    const kind = last !== null && last !== undefined && typeof last.type === 'string' ? codeOf(last.type.replace(/[\\/]/g, '_')) : ''
    failure = kind === '' ? '' : ('ended_' + kind).slice(0, 80)
  }
  // What the last message of the model was made of (`thinking`, `tool_use`, `text`): types only, so that an answer with no words says whether the model only thought or only called a tool.
  if (text === '' && lastBlocks !== '') failure = (failure + '.b_' + lastBlocks).replace(/^\./, '').slice(0, 90)
  return { ok: true, text, tools, ...(text === '' && failure !== '' ? { failure } : {}) }
}

// ── The Kyber tab's data (ADR 0053 § 14): where the person's assistant answers, and the computer it works on ───
// Read-only, from the active server with the account's token: the Telegram door's state (`GET /v1/me/telegram`) and the person's `Home` computer in their personal workspace. A device
// cannot link or unlink a chat (the server asks for a signed-in session): this route only says what is, and the tab sends the person to the bot and to their account page for the rest.
const kybyChosen = { at: 0, token: '', id: null }
const kyberRoute = async () => {
  const state = readState()
  if (!isConnected(state)) return { ok: true, connected: false }
  const get = (p) => apiCall(p, { method: 'GET', token: state.token, timeoutMs: 15000 })
  // The computer the person linked to their assistant (`GET /v1/me/kyby`, null = the default Home): read at most once a minute, an older server has none.
  const chosen = async () => {
    if (kybyChosen.token === state.token && Date.now() - kybyChosen.at < 60000) return kybyChosen.id
    const r = await get('/v1/me/kyby')
    const id = r.status === 200 && r.body !== null && typeof r.body === 'object' && typeof r.body.computer_id === 'string' ? r.body.computer_id : null
    kybyChosen.at = r.status === 200 || r.status === 404 ? Date.now() : 0
    kybyChosen.token = state.token
    kybyChosen.id = id
    return id
  }
  const [tg, ws, pick] = await Promise.all([get('/v1/me/telegram'), get('/v1/workspaces'), chosen()])
  const list = ws.status === 200 && ws.body !== null && Array.isArray(ws.body.workspaces) ? ws.body.workspaces : []
  const personal = list.find((w) => w !== null && typeof w === 'object' && w.personal === true)
  let home = null
  let computers = []
  if (personal !== undefined && typeof personal.id === 'string') {
    const c = await get('/v1/workspaces/' + encodeURIComponent(personal.id) + '/computers')
    const rows = c.status === 200 && c.body !== null && Array.isArray(c.body.computers) ? c.body.computers : []
    const cloud = rows.filter((r) => r !== null && typeof r === 'object' && typeof r.id === 'string' && (r.kind === undefined || r.kind === 'cloud'))
    computers = cloud.map((r) => ({ id: r.id, name: String(r.name || '').slice(0, 60), state: String(r.state || '') }))
    const found = (pick !== null ? rows.find((r) => r !== null && typeof r === 'object' && r.id === pick) : undefined)
      || rows.find((r) => r !== null && typeof r === 'object' && String(r.name).toLowerCase() === 'home')
    if (found !== undefined) {
      home = {
        id: String(found.id || ''),
        name: String(found.name || '').slice(0, 60),
        state: String(found.state || ''),
        desired: String(found.desired || ''),
        mode: String(found.mode || ''),
        region: String(found.region || ''),
        last_active_at: typeof found.last_active_at === 'string' ? found.last_active_at : null,
        version: typeof found.reported_version === 'string' ? found.reported_version : null,
        network: found.network !== null && typeof found.network === 'object' ? String(found.network.mode || '') : '',
        // Why it does not run when it should (hours used up, a budget, a guard…): the card says it instead of offering a wake that is refused.
        paused_reason: typeof found.paused_reason === 'string' ? found.paused_reason : null,
        // Whether this plan lets the person wake it, put it to sleep and open it by hand. Absent (an older server): the buttons stay, as before.
        manual_control: found.manual_control === false ? false : true,
      }
    }
  }
  const t = tg.status === 200 && tg.body !== null && typeof tg.body === 'object' ? tg.body : null
  return {
    ok: true,
    connected: true,
    telegram: t === null ? null : {
      configured: t.configured === true,
      enabled: t.enabled === true,
      bot: typeof t.bot_username === 'string' ? t.bot_username : null,
      linked: t.linked !== null && typeof t.linked === 'object'
        ? { display: String(t.linked.display || ''), linked_at: String(t.linked.linked_at || ''), paused: t.linked.paused === true, blocked: t.linked.blocked === true }
        : null,
    },
    computers,
    home,
  }
}

// ── The Home computer's three actions: wake, put to sleep, open (ADR 0052 § 13: POST …/computers/{id}/resume | suspend | ticket) ──
// The page never names a computer: this finds the person's own Home computer in their personal space, every time, and acts on
// THAT. Reversible (a wake and a sleep) or read-only (a single-use link), so no confirmation body; the strict same-origin guard
// of the turn routes still applies. The server decides who may (its own refusals are passed on as short codes, never as text).
const COMPUTER_VERBS = { resume: 'resume', suspend: 'suspend', open: 'ticket' }
const COMPUTER_REFUSALS = ['always_on', 'run_hours_exhausted', 'computer_deleting', 'computers_off_for_workspace', 'not_allowed_to_open', 'computer_not_ready', 'owner_left', 'rate_limited']
const findHomeComputer = async (state) => {
  const get = (p) => apiCall(p, { method: 'GET', token: state.token, timeoutMs: 15000 })
  const ws = await get('/v1/workspaces')
  const list = ws.status === 200 && ws.body !== null && Array.isArray(ws.body.workspaces) ? ws.body.workspaces : []
  const personal = list.find((w) => w !== null && typeof w === 'object' && w.personal === true && typeof w.id === 'string')
  if (personal === undefined) return null
  const c = await get('/v1/workspaces/' + encodeURIComponent(personal.id) + '/computers')
  const rows = c.status === 200 && c.body !== null && Array.isArray(c.body.computers) ? c.body.computers : []
  const found = rows.find((r) => r !== null && typeof r === 'object' && String(r.name).toLowerCase() === 'home' && typeof r.id === 'string')
  return found === undefined ? null : { workspaceId: personal.id, computer: found }
}
/** The address of the ticket: https, no credentials, and the host the server itself names for THIS computer — never another. */
const ticketAddress = (body, computer) => {
  const raw = body !== null && typeof body === 'object' && typeof body.url === 'string' ? body.url : ''
  const want = typeof computer.origin_host === 'string' ? computer.origin_host.trim().toLowerCase() : ''
  if (raw === '' || want === '') return null
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:' || u.username !== '' || u.password !== '' || u.hostname.toLowerCase() !== want) return null
    return u.toString()
  } catch (e) { return null }
}
const computerAction = async (verb) => {
  if (Object.prototype.hasOwnProperty.call(COMPUTER_VERBS, verb) !== true) return { ok: false, error: 'unknown_action' }
  const state = readState()
  if (!isConnected(state)) return { ok: false, error: 'not_connected' }
  const home = await findHomeComputer(state)
  if (home === null) return { ok: false, error: 'no_computer' }
  const path = '/v1/workspaces/' + encodeURIComponent(home.workspaceId) + '/computers/' + encodeURIComponent(home.computer.id) + '/' + COMPUTER_VERBS[verb]
  const res = await apiCall(path, { method: 'POST', token: state.token, body: {}, timeoutMs: 25000 })
  if (res.status !== 200) {
    const code = res.body !== null && typeof res.body === 'object' && typeof res.body.error === 'string' ? res.body.error : ''
    return { ok: false, error: COMPUTER_REFUSALS.indexOf(code) >= 0 ? code : 'refused', status: res.status }
  }
  if (verb === 'open') {
    const url = ticketAddress(res.body, home.computer)
    return url === null ? { ok: false, error: 'refused' } : { ok: true, url }
  }
  const c = res.body !== null && typeof res.body === 'object' && res.body.computer !== null && typeof res.body.computer === 'object' ? res.body.computer : {}
  return { ok: true, state: String(c.state || ''), desired: String(c.desired || '') }
}

// Kaby (ADR 0053): the Telegram pairing by QR code or link, where a message runs, and the person's own conversation with their Kaby.
// The pure half, and what each answer means, is kyby.mjs; the calls are made here with the account's token.
const kyby = createKybyRoutes({ readState, isConnected, apiCall, deviceLabel })
// Kaby's own chat is a native DSH conversation (kyby-native.mjs): which session it is, who Kaby is there, and the end of its turns written
// on the person's thread. The hooks are mounted below (mountKybyNative); the page asks for the session through the two routes under /kyby/native.
const kybyPointerFile = () => join(dshHome(), 'kybernos-kyby.json')
const kybyNative = createKybyNative({ pointerFile: kybyPointerFile, readState, isConnected, apiCall })
// Kaby's own folder: its chat lives in a workspace of its own, so that DSH's « New chat » never reuses it (a chat with no message yet is a
// blank, and a blank is taken back by the next new chat of its workspace) and it has a home on this machine.
const kybyFolder = () => join(dshHome(), 'kybernos', 'kyby')
const kybySessionRoute = (req) => {
  const cwd = kybyFolder()
  try { mkdirSync(cwd, { recursive: true }) } catch (e) { return { ok: false, error: 'folder_failed' } }
  return { ok: true, sessionId: readPointer(kybyPointerFile()), cwd }
}
const kybySessionSet = (req, body) => {
  const id = body !== null && typeof body === 'object' ? body.sessionId : undefined
  if (id !== null && !isSessionId(id)) return { ok: false, error: 'invalid_session' }
  const r = writePointer(kybyPointerFile(), id)
  return r.ok === true ? { ok: true, sessionId: id } : { ok: false, error: r.error }
}
const mountKybyNative = (ctx) => {
  ctx.inject(['systemPrompt'], (scope) => {
    scope.systemPrompt.context({
      name: 'kybernos:kyby',
      order: MEMORY_INJECT_ORDER - 10,
      text: (context) => kybyNative.promptFor(sessionIdOfContext(context)),
    })
  })
  ctx.on('agent/inbox/claimed', ({ agent }) => {
    try { kybyNative.noteClaim(agent.session.id) } catch (e) { /* never break a turn */ }
  })
  ctx.on('agent/turn-stopping', ({ agent, signal }) => {
    void kybyNative.mirrorTurn(agent, signal)
  })
}

// `session: true` is a route that DELETES the person's data (a memory, a team lesson or skill, a connection, a member): besides the same-origin rule it needs DSH's
// signed browser-session cookie (session-guard.mjs, the terminal's rule). Plugin routes are served before DSH's own login and an Origin header is forgeable by any
// local program, so before this a `curl -X POST .../memory/delete` with no header at all deleted a memory. Their callers are pages (Memory, Skills, Connectors,
// the Share card). The other writes keep the rule of their row: they are not named by the origin-rule audit (docs/dev/route-origin-rule.md says what is next).
const ROUTES = [
  { path: '/kybernos-cloud/kyber', method: 'GET', guarded: true, run: kyberRoute },
  // A pairing creates a link that, once opened in Telegram and confirmed there, connects the chat: same origin, strictly.
  { path: '/kybernos-cloud/telegram/pairing', method: 'POST', guarded: true, strict: true, run: () => kyby.pairingStart() },
  { path: '/kybernos-cloud/telegram/pairing/state', method: 'GET', guarded: true, run: (req) => kyby.pairingState(req) },
  { path: '/kybernos-cloud/telegram/pairing/cancel', method: 'POST', guarded: true, strict: true, body: true, cap: 1024, run: (req, body) => kyby.pairingCancel(req, body) },
  { path: '/kybernos-cloud/kyby/computer', method: 'POST', guarded: true, strict: true, body: true, cap: 1024, run: async (req, body) => { kybyChosen.at = 0; return kyby.computer(req, body) } },
  { path: '/kybernos-cloud/telegram/unlink', method: 'POST', guarded: true, strict: true, body: true, cap: 1024, run: () => kyby.unlink() },
  { path: '/kybernos-cloud/kyby/native', method: 'GET', guarded: true, run: kybySessionRoute },
  { path: '/kybernos-cloud/kyby/native/set', method: 'POST', guarded: true, strict: true, body: true, cap: 1024, run: kybySessionSet },
  { path: '/kybernos-cloud/computer/resume', method: 'POST', guarded: true, strict: true, run: () => computerAction('resume') },
  { path: '/kybernos-cloud/computer/suspend', method: 'POST', guarded: true, strict: true, run: () => computerAction('suspend') },
  { path: '/kybernos-cloud/computer/open', method: 'POST', guarded: true, strict: true, run: () => computerAction('open') },
  { path: '/kybernos-cloud/start', method: 'POST', guarded: true, run: startPairing },
  { path: '/kybernos-cloud/poll', method: 'POST', guarded: true, run: pollPairing },
  { path: '/kybernos-cloud/status', method: 'GET', guarded: false, run: statusRoute },
  { path: '/kybernos-cloud/space/active', method: 'POST', guarded: true, body: true, run: setActiveSpace },
  { path: '/kybernos-cloud/space/create', method: 'POST', guarded: true, body: true, run: createSpace },
  { path: '/kybernos-cloud/refresh', method: 'POST', guarded: true, run: refreshProfile },
  // `disconnect` revokes the session on the server side: irreversible. A bare POST
  // (campaign finding: `curl -X POST /kybernos-cloud/disconnect`) was enough to
  // trigger it. It now needs an EXPLICIT body `{confirm:true}`.
  { path: '/kybernos-cloud/disconnect', method: 'POST', guarded: true, confirm: true, run: disconnect },
  // Imported LiteLLM catalogue: detailed state + manual resynchronisation.
  // Catalogue of kybers published on kybernos.app (read only, no token
  // required for the local route: the link is verified plugin-side).
  { path: '/kybernos-cloud/marketplace', method: 'GET', guarded: false, run: marketplaceRoute },
  { path: '/kybernos-cloud/marketplace/install', method: 'POST', guarded: true, body: true, cap: 32768, run: marketplaceInstallRoute },
  { path: '/kybernos-cloud/server', method: 'GET', guarded: false, run: serverRoute },
  // A turn the platform addressed to this computer (ADR 0053 § 13.4): started, then read, by the computer's own runner (token and same origin).
  { path: '/kybernos-cloud/turn', method: 'POST', strict: true, body: true, cap: 200000, run: turnStart },
  { path: '/kybernos-cloud/turn/answer', method: 'POST', strict: true, body: true, cap: 4096, run: turnAnswer },
  { path: '/kybernos-cloud/turn/continue', method: 'POST', strict: true, body: true, cap: 8192, run: turnContinue },
  // The terms and privacy addresses of the active server (public document, no token).
  { path: '/kybernos-cloud/legal', method: 'GET', guarded: true, run: legalRoute },
  { path: '/kybernos-cloud/server/apply', method: 'POST', guarded: true, run: serverApply },
  { path: '/kybernos-cloud/models', method: 'GET', guarded: false, run: modelsRoute },
  { path: '/kybernos-cloud/models/sync', method: 'POST', guarded: true, run: modelsSyncRoute },
  // Referral code of the linked account (sidebar footer invitation card):
  // the card is served by the same origin, hence `guarded` — a third-party tab
  // has no business reading the account's code.
  { path: '/kybernos-cloud/referral', method: 'GET', guarded: true, run: referralRoute },
  // Artifacts (phase A). `body: true` → the JSON body is read (bounded by `cap`)
  // and passed to the handler; the content can be a whole artifact in base64.
  { path: '/kybernos-cloud/artifacts', method: 'GET', guarded: true, run: artifactList },
  { path: '/kybernos-cloud/artifacts/push', method: 'POST', guarded: true, body: true, cap: ARTIFACT_CONTENT_MAX + 131072, run: artifactPush },
  { path: '/kybernos-cloud/artifacts/detail', method: 'POST', guarded: true, body: true, run: artifactDetail },
  // DSH chats → webapp: pushes the DIRECTORY of local sessions (metadata
  // only) to /v1/dsh/sessions; GET = state of the last push.
  // DSH chat detail: full content read IN PLACE, served only to the local
  // webapp origins (targeted CORS + guarded:false — the standard sameOrigin
  // would refuse the dev webapp on :8081).
  { path: '/kybernos-cloud/chats/detail', method: 'GET', guarded: false, cors: true, run: chatsDetail },
  { path: '/kybernos-cloud/chats', method: 'GET', guarded: true, run: chatsStatusRoute },
  { path: '/kybernos-cloud/chats/push', method: 'POST', guarded: true, run: chatsPushRoute },
  // Share of an artifact or a chat (core.shares). Three distinct paths.
  // Local chat → hosted session (prerequisite of sharing a chat).
  { path: '/kybernos-cloud/chat/ensure', method: 'POST', guarded: true, body: true, cap: 4194304, run: chatEnsure },
  { path: '/kybernos-cloud/shares', method: 'GET', guarded: true, run: shareGet },
  { path: '/kybernos-cloud/shares/set', method: 'POST', guarded: true, body: true, run: shareSet },
  { path: '/kybernos-cloud/shares/revoke', method: 'POST', guarded: true, body: true, run: shareRevoke },
  // Members of a space: real read; invitation and removal return
  // {ok:false,error:'indisponible'} as long as the server reserves them to the master key.
  { path: '/kybernos-cloud/members', method: 'GET', guarded: true, run: membersGet },
  // Read-only relay for the Team console (iframe of another origin): allowlist, token added here, STRICT origin.
  { path: '/kybernos-cloud/relay', method: 'GET', guarded: true, strict: true, run: relayRoute },
  // The Team console in the browser: a single-use link (60 s) requested from the server with the device token, never the token itself.
  { path: '/kybernos-cloud/console/link', method: 'POST', guarded: true, strict: true, body: true, cap: 2048, run: consoleLink },
  // The upgrade popup: the plans and their quotes (public data of the server, no token sent), and the two payment calls (owner or admin of the workspace: the server decides).
  { path: '/kybernos-cloud/plans', method: 'GET', guarded: true, strict: true, run: plansRoute },
  { path: '/kybernos-cloud/plans/quote', method: 'GET', guarded: true, strict: true, run: planQuote },
  { path: '/kybernos-cloud/billing/checkout', method: 'POST', guarded: true, strict: true, body: true, cap: 2048, run: billingCheckout },
  { path: '/kybernos-cloud/billing/portal', method: 'POST', guarded: true, strict: true, body: true, cap: 1024, run: billingPortal },
  // The facts behind a refused model call (the quota notice): the active space's plan, its payment, and the windows of the person that are used up.
  { path: '/kybernos-cloud/quota', method: 'GET', guarded: true, run: quotaFacts },
  // Distinct paths: the router indexes by path, so a GET and a POST on one path would mask each other. The write is strict (a request that
  // names no origin is refused): it changes a file the agents read.
  { path: '/kybernos-cloud/instructions', method: 'GET', guarded: true, run: instructionsRead },
  { path: '/kybernos-cloud/instructions/save', method: 'POST', guarded: true, strict: true, body: true, cap: 16384, run: instructionsSave },
  { path: '/kybernos-cloud/members/invite', method: 'POST', guarded: true, body: true, cap: 8192, run: membersInvite },
  { path: '/kybernos-cloud/members/remove', method: 'POST', guarded: true, session: true, body: true, cap: 8192, run: membersRemove },
  // Account memory (cloud feature no. 2): read, write, search,
  // matching of local ↔ cloud kybers, and pushing of lessons.
  // Each path is DISTINCT (the router indexes by path: two routes on
  // `/memory` would mask each other — observed by the host test).
  { path: '/kybernos-cloud/memory', method: 'GET', guarded: true, run: memoryRoute },
  { path: '/kybernos-cloud/memory/add', method: 'POST', guarded: true, body: true, run: memoryCreateRoute },
  { path: '/kybernos-cloud/memory/update', method: 'POST', guarded: true, body: true, run: memoryUpdateRoute },
  { path: '/kybernos-cloud/memory/delete', method: 'POST', guarded: true, session: true, body: true, run: memoryDeleteRoute },
  { path: '/kybernos-cloud/memory/search', method: 'GET', guarded: true, run: memorySearchRoute },
  { path: '/kybernos-cloud/memory/map', method: 'POST', guarded: true, body: true, run: memoryMapRoute },
  // `dryRun` by default: pushing the lessons writes into the account, it
  // never goes out without a body that explicitly says `{"dryRun":false}`.
  { path: '/kybernos-cloud/memory/lessons', method: 'POST', guarded: true, body: true, run: memoryLessonsRoute },
  // « Memory & Lessons learned » page: paginated/filtered list and settings.
  // Distinct paths (GET and POST cannot share a path).
  { path: '/kybernos-cloud/memory/list', method: 'GET', guarded: true, run: memoryListRoute },
  { path: '/kybernos-cloud/memory/settings', method: 'GET', guarded: true, run: memorySettingsRoute },
  { path: '/kybernos-cloud/memory/settings/set', method: 'POST', guarded: true, body: true, run: memorySettingsSetRoute },
  // Search by meaning (off by default): status, then one indexing batch per POST — each batch calls the embeddings route.
  { path: '/kybernos-cloud/memory/index', method: 'GET', guarded: true, run: memoryIndexStatusRoute },
  { path: '/kybernos-cloud/memory/index/run', method: 'POST', guarded: true, body: true, cap: 4096, run: memoryIndexRunRoute },
  { path: '/kybernos-cloud/memory/meaning-map', method: 'GET', guarded: true, run: memoryMeaningMapRoute },
  // Tidy up (near-duplicates): the last scan and the log, a scan (it only looks), what to apply / keep apart / undo.
  { path: '/kybernos-cloud/team/status', method: 'GET', guarded: true, run: teamStatusRoute },
  { path: '/kybernos-cloud/team/lessons', method: 'GET', guarded: true, run: teamListRoute },
  { path: '/kybernos-cloud/team/lessons/add', method: 'POST', guarded: true, body: true, cap: 16384, run: teamAddRoute },
  { path: '/kybernos-cloud/team/lessons/review', method: 'POST', guarded: true, body: true, cap: 16384, run: teamReviewRoute },
  { path: '/kybernos-cloud/team/lessons/retire', method: 'POST', guarded: true, body: true, cap: 4096, run: teamRetireRoute },
  { path: '/kybernos-cloud/team/lessons/delete', method: 'POST', guarded: true, session: true, body: true, cap: 4096, run: teamDeleteRoute },
  // Team skills: the server half only (files are read and written by kybernos-skills). A proposal carries up to 1 MiB of files.
  { path: '/kybernos-cloud/team/skills', method: 'GET', guarded: true, run: teamSkillsListRoute },
  { path: '/kybernos-cloud/team/skills/item', method: 'GET', guarded: true, run: teamSkillsItemRoute },
  { path: '/kybernos-cloud/team/skills/add', method: 'POST', guarded: true, body: true, cap: 4 * 1024 * 1024, run: teamSkillsAddRoute },
  { path: '/kybernos-cloud/team/skills/review', method: 'POST', guarded: true, body: true, cap: 4096, run: teamSkillsReviewRoute },
  { path: '/kybernos-cloud/team/skills/retire', method: 'POST', guarded: true, body: true, cap: 4096, run: teamSkillsRetireRoute },
  { path: '/kybernos-cloud/team/skills/delete', method: 'POST', guarded: true, session: true, body: true, cap: 4096, run: teamSkillsDeleteRoute },
  // Kybernos connections: the account's connected apps. The routes sit here (the token does) and the connectors page calls them. A
  // link may carry the API key of a toolkit that has no OAuth, so its body is small and its handler never logs or echoes it.
  { path: '/kybernos-cloud/connections', method: 'GET', guarded: true, run: connections.listRoute },
  { path: '/kybernos-cloud/connections/apps', method: 'GET', guarded: true, run: connections.appsRoute },
  { path: '/kybernos-cloud/connections/item', method: 'GET', guarded: true, run: connections.itemRoute },
  { path: '/kybernos-cloud/connections/link', method: 'POST', guarded: true, body: true, cap: 16384, run: connections.linkRoute },
  { path: '/kybernos-cloud/connections/delete', method: 'POST', guarded: true, session: true, body: true, cap: 4096, run: connections.deleteRoute },
  { path: '/kybernos-cloud/memory/tidy', method: 'GET', guarded: true, run: memoryTidyRoute },
  { path: '/kybernos-cloud/memory/tidy/scan', method: 'POST', guarded: true, run: memoryTidyScanRoute },
  { path: '/kybernos-cloud/memory/tidy/apply', method: 'POST', guarded: true, body: true, cap: 65536, run: memoryTidyApplyRoute },
  { path: '/kybernos-cloud/memory/tidy/dismiss', method: 'POST', guarded: true, body: true, cap: 16384, run: memoryTidyDismissRoute },
  { path: '/kybernos-cloud/memory/tidy/undo', method: 'POST', guarded: true, body: true, cap: 4096, run: memoryTidyUndoRoute },
  { path: '/kybernos-cloud/memory/tidy/settings', method: 'POST', guarded: true, body: true, cap: 4096, run: memoryTidySettingsRoute },
]

const mountWebRoutes = (ctx, webServer) => {
  for (const route of ROUTES) {
    const handler = async (req, res) => {
      if (route.cors === true) {
        // Targeted CORS: only the known dev webapp origins — never
        // « * » (the content of conversations is local and private).
        const origin = String((req.headers && req.headers.origin) || '')
        const autorise = DSH_CORS_ORIGINS.includes(origin)
        res.setHeader('Access-Control-Allow-Origin', autorise ? origin : 'null')
        res.setHeader('Vary', 'Origin')
        if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
      }
      // A Host that is not this listener's is a rebound page: refused before anything is read, whatever the route (the open ones included).
      if (hostAllowed(req) !== true) return sendJson(res, 403, { ok: false, error: 'origine refusee' })
      if (req.method !== route.method) return sendJson(res, 405, { ok: false, error: route.method + ' attendu' })
      if (route.guarded === true && sameOrigin(req) === false) return sendJson(res, 403, { ok: false, error: 'origine refusee' })
      if (route.strict === true && sameOriginStrict(req) === false) return sendJson(res, 403, { ok: false, error: 'origine refusee' })
      if (route.session === true) {
        const refused = writeGuard(req)
        if (refused !== null) return sendJson(res, refused.status, { ok: false, error: refused.error })
      }
      if (route.confirm === true) {
        const body = await readJsonBody(req)
        if (body.confirm !== true) return sendJson(res, 400, { ok: false, error: 'confirmation requise : POST avec {"confirm":true}' })
      }
      try {
        // `body: true` → JSON body read here (bounded by `cap`) and passed to the
        // handler with the request; the other handlers ignore these arguments.
        const body = route.body === true ? await readJsonBody(req, route.cap) : null
        sendJson(res, 200, await route.run(req, body))
      } catch (e) {
        console.error('[kybernos-cloud] ' + route.path + ': ' + String((e && e.message) || e))
        sendJson(res, 500, { ok: false, error: 'internal error' })
      }
    }
    ctx.effect(() => webServer.register({ kind: 'exact', path: route.path, handler }), 'kybernos-cloud: route ' + route.path)
  }
  console.log('[kybernos-cloud] routes /kybernos-cloud/* enregistrees (start, poll, status, refresh, disconnect, models, models/sync, referral, artifacts, memory/*)')
}

// ── A narrow seam for sibling bundles ─────────────────────────────────────────────────────────────────────────────────
// A bundle that needs ONE authenticated call to the active server (kybernos-mobile: the phone link's pairing and relay
// tickets) reaches it through `globalThis[Symbol.for('kybernos.cloud')].call(path, { method, body })`. It never receives
// the account token: this file adds it. Only the path prefixes below are reachable, so the seam is not a general proxy.
const SEAM_PREFIXES = ['/v1/remote/']
const SEAM_METHODS = ['GET', 'POST', 'DELETE']
const SEAM_PATH = /^\/v1\/remote\/[A-Za-z0-9_\-/]{0,200}$/u
const cloudSeamCall = async (path, options) => {
  const p = typeof path === 'string' ? path : ''
  if (SEAM_PREFIXES.some((prefix) => p.startsWith(prefix)) !== true || SEAM_PATH.test(p) !== true || p.includes('//') || p.includes('..')) return { status: 0, body: null, error: 'path_refused' }
  const o = options !== null && typeof options === 'object' ? options : {}
  const method = typeof o.method === 'string' ? o.method.toUpperCase() : 'GET'
  if (SEAM_METHODS.includes(method) !== true) return { status: 0, body: null, error: 'method_refused' }
  let body = null
  if (o.body !== undefined && o.body !== null) {
    if (typeof o.body !== 'object' || Array.isArray(o.body) || JSON.stringify(o.body).length > 8192) return { status: 0, body: null, error: 'body_refused' }
    body = o.body
  }
  const state = readState()
  if (!isConnected(state)) return { status: 0, body: null, error: 'not_connected' }
  const r = await apiCall(p, { method, body, token: state.token, timeoutMs: 15000 })
  return { status: r.status, body: r.body, ...(r.error !== undefined ? { error: r.error } : {}), ...(r.status === 0 ? { server: serverIdentity() } : {}) }
}
const publishCloudSeam = (target = globalThis) => {
  try { target[Symbol.for('kybernos.cloud')] = Object.freeze({ version: 1, call: cloudSeamCall }) } catch (e) { /* a frozen global: the other bundles degrade */ }
}

export function apply(ctx) {
  hostCtx = ctx
  try { publishCloudSeam() } catch (e) { console.error('[kybernos-cloud] seam: ' + String((e && e.message) || e)) }
  // Before anything can use a token: a connection of another server (an install from before the new server became the default) is set aside.
  const aside = setAsideForeignConnection()
  if (ctx.get('webServer') !== undefined) mountWebRoutes(ctx, ctx.get('webServer'))
  else ctx.inject(['webServer'], (hostCtx) => mountWebRoutes(ctx, hostCtx.webServer))
  // Memory: the chunk in the prompt, the two tools, the end-of-turn
  // capture. Each mount is independent and tolerates the absence of its service.
  try { mountTurnGate(ctx) } catch (e) { console.error('[kybernos-cloud] turn gate: ' + String((e && e.message) || e)) }
  try { mountMemoryPrompt(ctx) } catch (e) { console.error('[kybernos-cloud] memory prompt: ' + String((e && e.message) || e)) }
  try { mountKybyNative(ctx) } catch (e) { console.error('[kybernos-cloud] native Kaby: ' + String((e && e.message) || e)) }
  try { mountMemoryTools(ctx) } catch (e) { console.error('[kybernos-cloud] memory tools: ' + String((e && e.message) || e)) }
  try { connections.mount(ctx) } catch (e) { console.error('[kybernos-cloud] connections: ' + String((e && e.message) || e)) }
  try { mountMemoryCapture(ctx) } catch (e) { console.error('[kybernos-cloud] memory capture: ' + String((e && e.message) || e)) }
  try { mountMemoryRefresh(ctx) } catch (e) { console.error('[kybernos-cloud] memory refresh: ' + String((e && e.message) || e)) }
  try { mountTidySchedule(ctx) } catch (e) { console.error('[kybernos-cloud] scheduled tidy-up: ' + String((e && e.message) || e)) }
  try { mountProfileRefresh(ctx) } catch (e) { console.error('[kybernos-cloud] periodic profile read: ' + String((e && e.message) || e)) }
  autoImportAtBoot(ctx, aside)
}

// Exported for the out-of-DSH test (scripts/test-cloud-host.mjs): no other
// public surface is promised.
export {
  cloudSeamCall, publishCloudSeam, SEAM_PREFIXES,
  dshHome, resolveApi, stateFile, server, serverApply, serverRoute, deviceLabel, publicState, ROUTES, importCatalog, CRED_REF, PROVIDER_ID, connections,
  // Keeping the picture of the account current (test: kybernos-cloud/test-profile-refresh.mjs).
  profileRefreshTick, PROFILE_REFRESH_TUNING, sameOrigin, hostAllowed,
  // Team console relay (exported for the dedicated suite).
  relayCheck, sameOriginStrict, RELAY_RULES, relayRules,
  // Memory — exported for the host suite (fake server, no real API).
  consoleLink, openExternal, plansRoute, planQuote, billingCheckout, billingPortal,
  asMemory, validateMemory, createMemory, patchMemory, deleteMemory, searchMemories,
  sanitizeMemory, sortMemories, renderMemoryChunk, renderMemoryPrompt, MEMORY_MARKER, MEMORY_OFF_MARKER, RELEVANCE_TUNING, noteUserTurn, userPromptText, pickRelevant, sessionQuery, sessionPick,
  embedTexts, putEmbedding, meaningStatus, indexMemories, findByMeaning, meaningCache, EMBED_DIM, EMBED_MODEL,
  teamCache, teamPickStore, refreshTeamCache, emptyTeamCache, teamSelection, renderTeamPrompt, activeKyberOf, lessonsSwitches, TEAM_RELEVANCE,
  tidyScan, tidyRun, tidyApply, tidyUndo, tidyDismiss, tidySettings, tidyTick, tidyView, tidyFlags, TIDY_TUNING, TIDY_MAX_REMOVALS, studyModel,
  refreshMemoryCache, memoryCache,
  emptyMemoryCache, bumpMemoryCache, pushLessons, localLessons, localKybers, stateKyberMap,
  listMemories, lastTurnText, memoryWriteTool, memorySearchTool, MEMORY_KINDS, MEMORY_SOURCES,
  captureTurn, lastCapture, extractFacts, stripMemoryBlock, normalizeMemory,
  MEMORY_MAX_CONTENT, MEMORY_MAX_INJECT_CHARS, MEMORY_TUNING,
  selectForPrompt, planInjection, readMemorySettings, noteOrigins, originOf, scheduleMemoryRefresh, parseWhen,
}
