// Team skills, the server half as this plugin sees it: where the routes are, and what a row or a refusal means. No network, no file:
// index.js makes the calls with the account token. The contract is docs/dev/team-skills-contract.md; the files themselves (packing a
// local skill, checking and installing one) are kybernos-skills' business, this side only carries them to and from the server.

/** The Team skills routes of a workspace: `/v1/workspaces/{id}/skills`. */
export const teamSkillsBase = (workspaceId) => '/v1/workspaces/' + encodeURIComponent(workspaceId) + '/skills'

/** A skill id as the server numbers them: a positive integer, no sign, no leading zero. */
export const isSkillId = (v) => (typeof v === 'number' && Number.isInteger(v) && v > 0) || (typeof v === 'string' && /^[1-9]\d{0,17}$/.test(v))

const code = (body) => (body !== null && body !== undefined && typeof body === 'object' && typeof body.error === 'string' ? body.error : '')

/**
 * What a failed call to the Team skills routes means, or null for a success: `{ error, ...details }` where `error` is one word the
 * page translates. The server's own text never reaches the page. A 404 that names neither the workspace nor the skill is a server
 * that has no Team skills at all (an older or another server): `not_on_this_server`, which the page shows as "not available here".
 */
export const teamSkillsFailure = (status, body) => {
  const c = code(body)
  if (status >= 200 && status < 300) return null
  if (status === 401) return { error: 'reconnect_required' }
  if (status === 0) return { error: 'network' }
  if (status === 404) {
    if (c === 'Team skill not found') return { error: 'skill_not_found' }
    if (c === 'Workspace not found') return { error: 'workspace_not_found' }
    return { error: 'not_on_this_server' }
  }
  if (status === 403) return { error: c === 'admin_required' ? 'admin_required' : 'forbidden' }
  if (status === 409) {
    if (c === 'duplicate') return { error: 'duplicate', id: body.id, status: typeof body.status === 'string' ? body.status : undefined }
    if (c === 'team_full') return { error: 'team_full', max: Number.isFinite(body.max) ? body.max : undefined }
    if (c === 'not_pending') return { error: 'not_pending' }
    if (c === 'not_approved') return { error: 'not_approved' }
    return { error: 'conflict' }
  }
  if (status === 413) return { error: 'too_large' }
  if (status === 429) return { error: 'too_many_proposals', max: body !== null && typeof body === 'object' && Number.isFinite(body.max) ? body.max : undefined }
  if (status === 400) {
    if (c === 'invalid_skill') return { error: 'invalid_skill', reason: typeof body.reason === 'string' ? body.reason : undefined }
    if (c === 'scan_rejected') return { error: 'scan_rejected', file: typeof body.file === 'string' ? body.file : undefined }
    return { error: 'bad_request' }
  }
  return { error: 'refused_' + String(status) }
}

const num = (v) => (Number.isFinite(v) ? v : 0)
const str = (v) => (typeof v === 'string' ? v : null)

/** A server row → what the page uses. A list row carries `files` as a number, a single skill carries the files themselves. */
export const asTeamSkill = (r) => {
  const withFiles = Array.isArray(r.files)
  const files = withFiles ? r.files.filter((f) => f !== null && typeof f === 'object').map((f) => ({ path: String(f.path), content: String(f.content) })) : undefined
  return {
    id: r.id,
    name: String(r.name === undefined ? '' : r.name),
    description: String(r.description === undefined ? '' : r.description),
    version: String(r.version === undefined ? '' : r.version),
    status: r.status,
    // The server's own count wins; without it, what was actually read.
    fileCount: Number.isFinite(r.files_count) ? r.files_count : (withFiles ? files.length : num(r.files)),
    bytes: num(r.bytes),
    files,
    proposedName: str(r.proposed_by_name),
    proposedAt: r.proposed_at === undefined ? null : r.proposed_at,
    reviewedName: str(r.reviewed_by_name),
    reviewedAt: r.reviewed_at === undefined ? null : r.reviewed_at,
    note: str(r.note),
    reviewNote: str(r.review_note),
    replaces: r.replaces === undefined ? null : r.replaces,
    supersededBy: r.superseded_by === undefined ? null : r.superseded_by,
    mine: r.mine === true,
  }
}
