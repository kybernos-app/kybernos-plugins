// Team lessons, the pure half: who may use them, what a line of the prompt looks like, which lessons fit the block, and the words
// of the server's answers. No network, no file: kybernos-cloud's index.js does the calls and the caching, the page does the rest.
//
// A team lesson is a sentence an owner or admin of a TEAM workspace approved (a member proposes it): every agent of the workspace
// reads it. It is not a personal lesson (kybernos-memory, local files) and not the platform's own lessons (server-side, global).

export const TEAM_CHUNK_NAME = 'kybernos:team-lessons'
export const TEAM_CHUNK_ORDER = 136          // right after the personal lessons (135)
export const TEAM_CHUNK_HEAD = '[KYBERNOS TEAM LESSONS]'
export const TEAM_TUNING = {
  ttlMs: 300000,          // the approved list is re-read at most every 5 minutes
  chunkChars: 760,        // the whole block, frame included: about a quarter of the lessons block
  frameChars: 240,
  share: 0.5,             // the lessons that match the latest message may take this share of the lines budget
  textMax: 500,
  fetchMax: 200,
}

/** Which team workspace the plugin talks about, and whether the feature exists for this account. */
export const teamWorkspace = (state, activeId) => {
  if (state === null || state === undefined || typeof state.token !== 'string' || state.token === '') return { available: false, reason: 'non_connecte' }
  const spaces = Array.isArray(state.workspaces) ? state.workspaces : []
  const space = spaces.find((w) => w !== null && typeof w === 'object' && w.id === activeId)
  // The ACTIVE space's own plan (read from the server) decides. The account's word (`user.plan`) says « team » as soon as the person is in
  // ANY team, so it is only the fallback when the space's plan was not read; and a personal space is never a team space.
  const sp = state.space_plan !== null && typeof state.space_plan === 'object' && state.space_plan.workspace_id === activeId ? state.space_plan : null
  const plan = String(sp !== null ? sp.key : (state.user !== null && state.user !== undefined && state.user.plan !== undefined ? state.user.plan : '')).toLowerCase()
  if (space === undefined || typeof activeId !== 'string' || activeId === '') return { available: false, reason: 'aucun_espace', plan }
  if (space.personal === true || plan.indexOf('team') !== 0) return { available: false, reason: 'offre_requise', plan, workspaceId: activeId, workspaceName: String(space.name || '') }
  return { available: true, reason: null, plan, workspaceId: activeId, workspaceName: String(space.name || '') }
}

/** The name shown next to what the user proposed or approved: informative only, the server never trusts it. */
export const displayName = (state) => {
  const u = state !== null && state !== undefined && state.user !== null && typeof state.user === 'object' ? state.user : {}
  const name = typeof u.name === 'string' ? u.name.trim() : ''
  const mail = typeof u.email === 'string' ? u.email.split('@')[0].trim() : ''
  return (name !== '' ? name : mail).replace(/\s+/g, ' ').slice(0, 60)
}

/** A server row → what the page and the prompt use. */
export const asTeamLesson = (r) => ({
  id: r.id,
  text: String(r.text === undefined ? '' : r.text),
  tags: Array.isArray(r.tags) ? r.tags.filter((t) => typeof t === 'string') : [],
  kyber: typeof r.kyber === 'string' && r.kyber !== '' ? r.kyber : null,
  status: r.status,
  proposedName: typeof r.proposed_name === 'string' ? r.proposed_name : null,
  reviewedName: typeof r.reviewed_name === 'string' ? r.reviewed_name : null,
  reviewedAt: r.reviewed_at === undefined ? null : r.reviewed_at,
  createdAt: r.created_at === undefined ? null : r.created_at,
  updatedAt: r.updated_at === undefined ? null : r.updated_at,
  mine: r.mine === true,
  note: typeof r.note === 'string' ? r.note : null,
  reviewNote: typeof r.review_note === 'string' ? r.review_note : null,
})

/** The words for a failed call to the lessons routes (the server's codes, then the HTTP status). */
export const teamFailure = (status, body) => {
  const code = body !== null && body !== undefined && typeof body === 'object' && typeof body.error === 'string' ? body.error : ''
  if (status === 401) return 'reconnexion_requise'
  if (status === 0) return 'reseau'
  if (status === 404) return code === 'Team lesson not found' ? 'lecon_introuvable' : 'espace_introuvable'
  if (status === 403) return code === 'admin_required' ? 'admin_requis' : 'refus_403'
  if (status === 409) {
    if (code === 'duplicate') return 'doublon'
    if (code === 'team_full') return 'equipe_pleine'
    if (code === 'not_pending') return 'deja_decidee'
    if (code === 'not_approved') return 'non_approuvee'
    return 'refus_409'
  }
  if (status === 429) return 'trop_de_propositions'
  if (status === 400) return code.indexOf('text') === 0 ? 'texte_invalide' : 'requete_invalide'
  if (status >= 400) return 'refus_' + String(status)
  return null
}

const sanitize = (text) => String(text)
  .replace(/\r?\n+/g, ' · ')
  .replace(/\[\s*KYBERNOS\s*(TEAM\s*)?(LESSONS|MEMORY)/gi, '[KYBERNOS-$2')
  .slice(0, TEAM_TUNING.textMax + 1)

export const teamLine = (l) => '- [' + (l.kyber === null ? 'general' : l.kyber) + '] ' + sanitize(l.text) + (l.tags.length > 0 ? ' ' + l.tags.map((t) => '#' + t).join(' ') : '')

/** Lessons that apply to a session: the general ones and the ones of its kyber, approved only. */
export const applicable = (lessons, kyber) => lessons.filter((l) => l.status === 'approved' && (l.kyber === null || l.kyber === kyber))

const newest = (a, b) => (Date.parse(b.updatedAt || b.createdAt || '') || 0) - (Date.parse(a.updatedAt || a.createdAt || '') || 0) || (Number(b.id) - Number(a.id))

/**
 * What the block carries. The ones that match the user's latest message (`preferred`, already picked) come first within their own
 * share, then the ones of the session's kyber, then the general ones, the newest first. A lesson too long for what is left is skipped.
 * Returns { chosen, omitted, used }.
 */
export const teamPlan = (lessons, kyber, preferred = []) => {
  const pool = applicable(lessons, kyber)
  const budget = Math.max(0, TEAM_TUNING.chunkChars - TEAM_TUNING.frameChars)
  const chosen = []
  let used = 0
  const take = (l) => {
    const cost = teamLine(l).length + 1
    if (chosen.indexOf(l) >= 0 || used + cost > budget) return false
    chosen.push(l)
    used += cost
    return true
  }
  let relevantUsed = 0
  const relevantCap = Math.floor(budget * TEAM_TUNING.share)
  for (const l of preferred) {
    const cost = teamLine(l).length + 1
    if (relevantUsed + cost > relevantCap) continue
    if (take(l)) relevantUsed += cost
  }
  const rest = pool.filter((l) => chosen.indexOf(l) < 0).sort((a, b) => (Number(b.kyber !== null) - Number(a.kyber !== null)) || newest(a, b))
  let omitted = 0
  for (const l of rest) { if (!take(l)) omitted += 1 }
  return { chosen, omitted, used }
}

/** The text injected at each assembly, or '' when there is nothing to say. */
export const renderTeamChunk = (plan, workspaceName) => {
  if (plan.chosen.length === 0) return ''
  const lines = [TEAM_CHUNK_HEAD + ' Approved by your team' + (workspaceName !== '' ? ' (' + String(workspaceName).replace(/[\r\n[\]]+/g, ' ').slice(0, 60) + ')' : '') + ': follow them like the house rules.']
  plan.chosen.forEach((l) => lines.push(teamLine(l)))
  if (plan.omitted > 0) lines.push('- … (' + String(plan.omitted) + ' more approved lessons not shown)')
  return lines.join('\n')
}
