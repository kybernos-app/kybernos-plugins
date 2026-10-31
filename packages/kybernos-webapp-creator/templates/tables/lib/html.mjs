// html.mjs — the few server-rendered pages (the people page, the invitation page). Plain semantic HTML: no script, no inline style, no class names; the restyle comes later.
// Pure: strings in, strings out.
export const esc = (v) => String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

export const page = (title, body) => '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + esc(title) + '</title></head>\n<body><main>\n<h1>' + esc(title) + '</h1>\n' + body + '\n</main></body></html>\n'

const csrf = (token) => '<input type="hidden" name="_csrf" value="' + esc(token) + '">'
const when = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
const roleSelect = (roles, current, name) => '<select name="' + name + '" required>' + roles.map((r) => '<option value="' + esc(r.id) + '"' + (r.id === current ? ' selected' : '') + '>' + esc(r.label) + ' (' + esc(r.id) + ')</option>').join('') + '</select>'

/** The owner's people page. `view` is `{ members, invitations, roles, csrf, notice? }`. */
export function peoplePage (view) {
  const { members, invitations, roles, notice } = view
  const t = view.csrf
  const note = notice === undefined ? '' : '<p role="status">' + esc(notice.text) + '</p>' + (notice.link === undefined ? '' : '<p>Invitation link (shown once, for ' + esc(notice.who) + '): <output>' + esc(notice.link) + '</output></p>')
  const memberRows = members.map((m) => '<tr><td>' + esc(m.email) + '</td><td>' + esc(m.role) + '</td><td>' + (m.role === 'owner' ? 'owner' :
    '<form method="post" action="/people/members/' + esc(m.user_id) + '/role">' + csrf(t) + roleSelect(roles, m.role, 'role') + ' <button type="submit">Change profile</button></form> ' +
    '<form method="post" action="/people/members/' + esc(m.user_id) + '/remove">' + csrf(t) + '<button type="submit">Remove</button></form>') + '</td></tr>').join('\n')
  const inviteRows = invitations.map((i) => '<tr><td>' + esc(i.email === null ? '(link only)' : i.email) + '</td><td>' + esc(i.role) + '</td><td>' + esc(when(i.exp)) + '</td><td>' +
    '<form method="post" action="/people/invitations/' + esc(i.id) + '/role">' + csrf(t) + roleSelect(roles, i.role, 'role') + ' <button type="submit">Change profile</button></form> ' +
    '<form method="post" action="/people/invitations/' + esc(i.id) + '/resend">' + csrf(t) + '<button type="submit">Resend</button></form> ' +
    '<form method="post" action="/people/invitations/' + esc(i.id) + '/revoke">' + csrf(t) + '<button type="submit">Revoke</button></form></td></tr>').join('\n')
  return page('People', note +
    '<h2>Members</h2>\n<table><thead><tr><th>E-mail</th><th>Profile</th><th>Actions</th></tr></thead><tbody>\n' + memberRows + '\n</tbody></table>\n' +
    '<h2>Pending invitations</h2>\n' + (invitations.length === 0 ? '<p>None.</p>' : '<table><thead><tr><th>E-mail</th><th>Profile</th><th>Expires</th><th>Actions</th></tr></thead><tbody>\n' + inviteRows + '\n</tbody></table>') + '\n' +
    '<h2>Invite someone</h2>\n' + (roles.length === 0 ? '<p>No app in this space has a profile yet: add one in the app first.</p>' :
      '<form method="post" action="/people/invitations">' + csrf(t) + '<label>E-mail (leave empty for a link) <input type="email" name="email" maxlength="254"></label> <label>Profile ' + roleSelect(roles, '', 'role') + '</label> <button type="submit">Invite</button></form>'))
}

/** The page the invitee lands on. `view` is `{ token, email (string | null), csrf, error? }`. */
export function invitePage (view) {
  const t = view.csrf
  return page('Join this team space', (view.error === undefined ? '' : '<p role="alert">' + esc(view.error) + '</p>') +
    '<form method="post" action="/invite">' + csrf(t) + '<input type="hidden" name="token" value="' + esc(view.token) + '">' +
    (view.email === null ? '<p><label>E-mail <input type="email" name="email" required maxlength="254" autocomplete="email"></label></p>' : '<p>You are invited as <strong>' + esc(view.email) + '</strong>.</p>') +
    '<p><label>Your name <input type="text" name="name" maxlength="80" autocomplete="name"></label></p>' +
    '<p><label>Choose a password (10 characters or more) <input type="password" name="password" required minlength="10" maxlength="128" autocomplete="new-password"></label></p>' +
    '<button type="submit">Join</button></form>')
}

/** A short page for a message with no form. */
export const notice = (title, text) => page(title, '<p>' + esc(text) + '</p>')
