// html.mjs — the few pages the server renders itself (the owner's people page, the invitation page, short notices). Plain semantic HTML styled by /app.css, the same file as the app:
// no script, no inline style, no handler (the page policy allows none), and what people type goes through `esc`. A removal asks again with <details>, which needs no script.
// Pure: strings in, strings out.
export const esc = (v) => String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const KMARK = '<svg class="kmark" viewBox="0 0 32.5 36" aria-hidden="true"><g fill="#f2372a"><rect x="0" y="0" width="13" height="36"/><polygon points="21,0 31,0 13,28.3 13,12.6"/><polygon points="13,22 22,36 32.5,36 20.3,16.8 13,16.8"/></g><g fill="#fff"><circle cx="6.5" cy="7.5" r="2.8"/><circle cx="6.5" cy="18" r="2.8"/><circle cx="6.5" cy="28.5" r="2.8"/></g></svg>'
const MADE = '<p class="made">' + KMARK + '<span>Made with Kybernos</span></p>'

const document_ = (title, body) => '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>' + esc(title) +
  '</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/app.css"></head>\n<body>\n' + body + '\n</body></html>\n'
/** One card on a pale ground: a notice, the invitation. */
const card = (title, body) => document_(title, '<div class="auth"><main class="card-auth"><div class="brand">' + KMARK + '<span>Team space</span></div>\n<h1>' + esc(title) + '</h1>\n' + body + '\n' + MADE + '</main></div>')

const csrf = (token) => '<input type="hidden" name="_csrf" value="' + esc(token) + '">'
const when = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
const initials = (s) => esc(String(s).split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?')
const roleSelect = (roles, current, name, id) => '<select class="input auto" name="' + name + '"' + (id === undefined ? '' : ' id="' + id + '"') + ' aria-label="Profile" required>' +
  roles.map((r) => '<option value="' + esc(r.id) + '"' + (r.id === current ? ' selected' : '') + '>' + esc(r.label) + '</option>').join('') + '</select>'
const labelOf = (roles, id) => { const r = roles.find((x) => x.id === id); return r === undefined ? id : r.label }

/** A form with a select and its button: change the profile of a member or an invitation. */
const roleForm = (action, token, roles, current) => '<form class="inline" method="post" action="' + action + '">' + csrf(token) + roleSelect(roles, current, 'role') + ' <button class="btn sm" type="submit">Change profile</button></form>'
/** A destructive action behind a second click, with no script: a <details> that opens the question and its button. */
const askForm = (action, token, label, question, yes) => '<details class="ask"><summary class="btn sm danger">' + label + '</summary><form class="confirm" method="post" action="' + action + '">' + csrf(token) +
  '<p>' + question + '</p><button class="btn sm danger" type="submit">' + yes + '</button></form></details>'

/** The owner's people page. `view` is `{ members, invitations, roles, csrf, notice? }`; a notice is `{ text, who?, link?, bad? }`. */
export function peoplePage (view) {
  const { members, invitations, roles, notice } = view
  const t = view.csrf
  const note = notice === undefined ? '' : '<div class="said' + (notice.bad === true ? ' bad' : '') + '" role="' + (notice.bad === true ? 'alert' : 'status') + '"><p>' + esc(notice.text) + '</p>' +
    (notice.link === undefined ? '' : '<p>Invitation link (shown once, for ' + esc(notice.who) + '):</p><output>' + esc(notice.link) + '</output>') + '</div>'
  const memberRows = members.map((m) => '<tr><td><div class="who"><span class="av" aria-hidden="true">' + initials(m.email) + '</span><b>' + esc(m.email) + '</b></div></td><td>' +
    (m.role === 'owner' ? '<span class="pill blue">Owner</span>' : esc(labelOf(roles, m.role))) + '</td><td>' + (m.role === 'owner' ? '<span class="mute">You are the owner</span>' :
      '<div class="actions">' + roleForm('/people/members/' + esc(m.user_id) + '/role', t, roles, m.role) +
      askForm('/people/members/' + esc(m.user_id) + '/remove', t, 'Remove', 'Remove ' + esc(m.email) + '? They are signed out.', 'Yes, remove') + '</div>') + '</td></tr>').join('\n')
  const inviteRows = invitations.map((i) => '<tr><td>' + esc(i.email === null ? '(link only)' : i.email) + '</td><td>' + roleForm('/people/invitations/' + esc(i.id) + '/role', t, roles, i.role) + '</td><td>' + esc(when(i.exp)) + '</td><td><div class="actions">' +
    '<form class="inline" method="post" action="/people/invitations/' + esc(i.id) + '/resend">' + csrf(t) + '<button class="btn sm" type="submit">Resend</button></form>' +
    askForm('/people/invitations/' + esc(i.id) + '/revoke', t, 'Revoke', 'Revoke this invitation? Its link stops working.', 'Yes, revoke') + '</div></td></tr>').join('\n')
  const invite = roles.length === 0 ? '<p class="dim">No app in this space has a profile yet: add one in the app first.</p>' :
    '<form class="form-row" method="post" action="/people/invitations">' + csrf(t) +
    '<div class="col1"><label for="inv-email"><span>Email (leave empty for a link)</span></label><input class="input" id="inv-email" type="email" name="email" maxlength="254" autocomplete="off"></div>' +
    '<div class="col1"><label for="inv-role"><span>Profile</span></label>' + roleSelect(roles, '', 'role', 'inv-role') + '</div>' +
    '<button class="btn primary" type="submit">Invite</button></form>\n<p class="sub">They get a link to join. They only see what their profile allows.</p>'
  return document_('People', '<div class="sheet"><header class="sheet-top"><a class="back" href="/">← Back to the app</a><h1>People</h1></header>\n<main class="sheet-main">\n' + note +
    '\n<section class="panel"><h2>Members</h2><div class="tablewrap"><table><thead><tr><th scope="col">Email</th><th scope="col">Profile</th><th scope="col">Actions</th></tr></thead><tbody>\n' + memberRows + '\n</tbody></table></div></section>' +
    '\n<section class="panel"><h2>Pending invitations</h2>' + (invitations.length === 0 ? '<p class="dim">None.</p>' : '<div class="tablewrap"><table><thead><tr><th scope="col">Email</th><th scope="col">Profile</th><th scope="col">Expires</th><th scope="col">Actions</th></tr></thead><tbody>\n' + inviteRows + '\n</tbody></table></div>') + '</section>' +
    '\n<section class="panel"><h2>Invite someone</h2>' + invite + '</section>\n</main></div>')
}

/** The page the invitee lands on. `view` is `{ token, email (string | null), csrf, error? }`. */
export function invitePage (view) {
  return card('Join this team space', (view.error === undefined ? '' : '<p class="said bad" role="alert">' + esc(view.error) + '</p>') +
    '<form method="post" action="/invite">' + csrf(view.csrf) + '<input type="hidden" name="token" value="' + esc(view.token) + '">' +
    (view.email === null ? '<div class="fld"><label for="in-email">Email</label><input class="input" id="in-email" type="email" name="email" required maxlength="254" autocomplete="email"></div>' : '<p>You are invited as <strong>' + esc(view.email) + '</strong>.</p>') +
    '<div class="fld"><label for="in-name">Your name</label><input class="input" id="in-name" type="text" name="name" maxlength="80" autocomplete="name"></div>' +
    '<div class="fld"><label for="in-password">Choose a password <span class="req">10 characters or more</span></label><input class="input" id="in-password" type="password" name="password" required minlength="10" maxlength="128" autocomplete="new-password"></div>' +
    '<button class="btn primary" type="submit">Join</button></form>')
}

/** A short page for a message with no form. */
export const notice = (title, text) => card(title, '<p>' + esc(text) + '</p><p><a class="btn" href="/">Go to the app</a></p>')
