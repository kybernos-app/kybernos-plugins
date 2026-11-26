// html.mjs — the few pages the server renders itself (the owner's people and activity pages, a person's account, the privacy page, the invitation page, short notices). Plain
// semantic HTML styled by /app.css, the same file as the app: no script, no inline style, no handler (the page policy allows none), and what people type goes through `esc`.
// A removal asks again with <details>, which needs no script. Pure: strings in, strings out.
export const esc = (v) => String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const KMARK = '<svg class="kmark" viewBox="0 0 32.5 36" aria-hidden="true"><g fill="#f2372a"><rect x="0" y="0" width="13" height="36"/><polygon points="21,0 31,0 13,28.3 13,12.6"/><polygon points="13,22 22,36 32.5,36 20.3,16.8 13,16.8"/></g><g fill="#fff"><circle cx="6.5" cy="7.5" r="2.8"/><circle cx="6.5" cy="18" r="2.8"/><circle cx="6.5" cy="28.5" r="2.8"/></g></svg>'
const MADE = '<p class="made">' + KMARK + '<span>Made with Kybernos</span></p>'
const LEGAL = '<p class="legal"><a href="/privacy">Privacy</a></p>'

// The app answers with `Referrer-Policy: no-referrer`, and a browser then sends `Origin: null` with a form that is posted (a navigation, not a fetch): the Origin check would refuse every
// form of these pages. `same-origin` sends the Origin to this server and still nothing to any other site, so these pages set it themselves (measured in Chrome: header alone, null; with this tag, the origin).
const document_ = (title, body) => '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><meta name="referrer" content="same-origin"><title>' + esc(title) +
  '</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/app.css"></head>\n<body>\n' + body + '\n</body></html>\n'
/** One card on a pale ground: a notice, the invitation. */
const card = (title, body) => document_(title, '<div class="auth"><main class="card-auth"><div class="brand">' + KMARK + '<span>Team space</span></div>\n<h1>' + esc(title) + '</h1>\n' + body + '\n' + MADE + LEGAL + '</main></div>')

/** A page of the owner's or a person's own, on the pale ground: a top bar with a way back and the other pages, then the panels. */
const sheet = (title, links, body, narrow = false) => document_(title, '<div class="sheet"><header class="sheet-top"><a class="back" href="/">← Back to the app</a><h1>' + esc(title) + '</h1>' +
  (links.length === 0 ? '' : '<nav class="sheet-links" aria-label="Pages">' + links.map(([href, text]) => '<a href="' + href + '">' + esc(text) + '</a>').join('') + '</nav>') + '</header>\n<main class="sheet-main' + (narrow ? ' narrow' : '') + '">\n' + body +
  '\n</main>\n<footer class="sheet-foot">' + MADE + LEGAL + '</footer></div>')
const OWNER_LINKS = [['/people', 'People'], ['/activity', 'Activity'], ['/account', 'Your account']]

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
      askForm('/people/members/' + esc(m.user_id) + '/remove', t, 'Remove', 'Remove ' + esc(m.email) + '? They are signed out and their account and address are erased. The rows they added keep an opaque id that points at nobody.', 'Yes, remove') + '</div>') + '</td></tr>').join('\n')
  const inviteRows = invitations.map((i) => '<tr><td>' + esc(i.email === null ? '(link only)' : i.email) + '</td><td>' + roleForm('/people/invitations/' + esc(i.id) + '/role', t, roles, i.role) + '</td><td>' + esc(when(i.exp)) + '</td><td><div class="actions">' +
    '<form class="inline" method="post" action="/people/invitations/' + esc(i.id) + '/resend">' + csrf(t) + '<button class="btn sm" type="submit">Resend</button></form>' +
    askForm('/people/invitations/' + esc(i.id) + '/revoke', t, 'Revoke', 'Revoke this invitation? Its link stops working.', 'Yes, revoke') + '</div></td></tr>').join('\n')
  const invite = roles.length === 0 ? '<p class="dim">No app in this space has a profile yet: add one in the app first.</p>' :
    '<form class="form-row" method="post" action="/people/invitations">' + csrf(t) +
    '<div class="col1"><label for="inv-email"><span>Email (leave empty for a link)</span></label><input class="input" id="inv-email" type="email" name="email" maxlength="254" autocomplete="off"></div>' +
    '<div class="col1"><label for="inv-role"><span>Profile</span></label>' + roleSelect(roles, '', 'role', 'inv-role') + '</div>' +
    '<button class="btn primary" type="submit">Invite</button></form>\n<p class="sub">They get a link to join. They only see what their profile allows.</p>'
  return sheet('People', OWNER_LINKS.filter(([href]) => href !== '/people'), note +
    '\n<section class="panel"><h2>Members</h2><div class="tablewrap"><table><thead><tr><th scope="col">Email</th><th scope="col">Profile</th><th scope="col">Actions</th></tr></thead><tbody>\n' + memberRows + '\n</tbody></table></div></section>' +
    '\n<section class="panel"><h2>Pending invitations</h2>' + (invitations.length === 0 ? '<p class="dim">None.</p>' : '<div class="tablewrap"><table><thead><tr><th scope="col">Email</th><th scope="col">Profile</th><th scope="col">Expires</th><th scope="col">Actions</th></tr></thead><tbody>\n' + inviteRows + '\n</tbody></table></div>') + '</section>' +
    '\n<section class="panel"><h2>Invite someone</h2>' + invite + '</section>')
}

/** The page the invitee lands on. `view` is `{ token, email (string | null), csrf, error? }`. */
export function invitePage (view) {
  return card('Join this team space', (view.error === undefined ? '' : '<p class="said bad" role="alert">' + esc(view.error) + '</p>') +
    '<form method="post" action="/invite">' + csrf(view.csrf) + '<input type="hidden" name="token" value="' + esc(view.token) + '">' +
    (view.email === null ? '<div class="fld"><label for="in-email">Email</label><input class="input" id="in-email" type="email" name="email" required maxlength="254" autocomplete="email"></div>' : '<p>You are invited as <strong>' + esc(view.email) + '</strong>.</p>') +
    '<div class="fld"><label for="in-name">Your name</label><input class="input" id="in-name" type="text" name="name" maxlength="80" autocomplete="name"></div>' +
    '<div class="fld"><label for="in-password">Choose a password <span class="req">10 characters or more</span></label><input class="input" id="in-password" type="password" name="password" required minlength="10" maxlength="128" autocomplete="new-password"></div>' +
    '<button class="btn primary" type="submit">Join</button></form>' +
    '<p class="sub">Your name, address and password stay in this team space. <a href="/privacy">How your data is used</a>.</p>')
}

/** A short page for a message with no form. */
export const notice = (title, text) => card(title, '<p>' + esc(text) + '</p><p><a class="btn" href="/">Go to the app</a></p>')

// ── the activity page ──

/**
 * The owner's activity page. `view` is `{ events: [{ id, at, kind, group, text, ip }], filter, groups: { id: label }, next, newer }`: `filter` the group or kind on show (or ''), `next` the cursor of the
 * older page (or null), `newer` true when this is not the first page. Filtering is a plain GET form; no script.
 */
export function activityPage (view) {
  const { events, filter, groups, next, newer } = view
  const q = (before) => '?' + [filter === '' ? '' : 'kind=' + encodeURIComponent(filter), before === undefined ? '' : 'before=' + before].filter(Boolean).join('&')
  const picker = '<form class="form-row filter" method="get" action="/activity"><div class="col1"><label for="act-kind"><span>Show</span></label><select class="input" id="act-kind" name="kind">' +
    '<option value=""' + (filter === '' ? ' selected' : '') + '>Everything</option>' + Object.entries(groups).map(([id, label]) => '<option value="' + esc(id) + '"' + (id === filter ? ' selected' : '') + '>' + esc(label) + '</option>').join('') +
    '</select></div><button class="btn" type="submit">Show</button></form>'
  const rows = events.map((e) => '<tr><td class="when">' + esc(when(e.at)) + '</td><td><span class="pill ' + esc(PILLS[e.group] ?? 'gray') + '">' + esc(groups[e.group] ?? e.group) + '</span></td><td>' + esc(e.text) +
    (e.ip === null || e.ip === undefined ? '' : ' <span class="mute">Network <code>' + esc(e.ip) + '</code></span>') + '</td></tr>').join('\n')
  const body = '<section class="panel"><h2>Activity</h2><p class="sub">The last 90 days, newest first. It says who did what and when; it holds no password, link or message, and network addresses appear only as a short code.</p>' + picker +
    (events.length === 0 ? '<p class="dim">Nothing to show' + (filter === '' ? ' yet' : ' for this filter') + '.</p>' :
      '<div class="tablewrap"><table class="activity"><thead><tr><th scope="col">When</th><th scope="col">Kind</th><th scope="col">What happened</th></tr></thead><tbody>\n' + rows + '\n</tbody></table></div>') +
    (next === null && !newer ? '' : '<nav class="pager" aria-label="Pages of activity">' + (newer ? '<a class="btn sm" href="/activity' + q() + '">Newest</a>' : '') + (next === null ? '' : '<a class="btn sm" href="/activity' + q(next) + '">Older</a>') + '</nav>') + '</section>'
  return sheet('Activity', OWNER_LINKS.filter(([href]) => href !== '/activity'), body)
}
const PILLS = { signin: 'blue', invitations: 'green', people: 'amber', exports: 'blue', owner: 'amber', transfers: 'green', refusals: 'red' }

// ── a person's own page ──

/**
 * `view` is `{ person: { name, email, profile, joined (ISO or null) }, owner (bool), apps: [{ slug, name }], csrf, notice? }`. Everyone downloads their data; a member can delete their account
 * (typing their address); the owner is told how they leave instead, and finds the export of each app.
 */
export function accountPage (view) {
  const { person, owner, apps } = view
  const note = view.notice === undefined ? '' : '<div class="said' + (view.notice.bad === true ? ' bad' : '') + '" role="' + (view.notice.bad === true ? 'alert' : 'status') + '"><p>' + esc(view.notice.text) + '</p></div>'
  const details = '<section class="panel"><h2>Your details</h2><dl class="kv"><div><dt>Name</dt><dd>' + esc(person.name) + '</dd></div><div><dt>Email</dt><dd>' + esc(person.email) + '</dd></div><div><dt>Profile</dt><dd>' + esc(person.profile) +
    '</dd></div>' + (person.joined === null ? '' : '<div><dt>Joined</dt><dd>' + esc(String(person.joined).slice(0, 10)) + '</dd></div>') + '</dl></section>'
  const mine = '<section class="panel"><h2>Your data</h2><p>Download what this space holds about you: your details and your sessions (dates and kind of device). It holds no password and no sign-in token.</p>' +
    '<p><a class="btn" href="/api/me/export" download>Download my data</a></p><p class="sub"><a href="/privacy">How your data is used, kept and erased</a></p></section>'
  const team = !owner ? '' : '<section class="panel"><h2>The team’s data</h2><p>Everything of an app as one JSON file: its tables and fields, every row (archived ones too) and the list of its files.</p>' +
    (apps.length === 0 ? '<p class="dim">No app in this space yet.</p>' : '<p class="actions">' + apps.map((a) => '<a class="btn" href="/api/apps/' + esc(a.slug) + '/export.json" download>Export data' + (apps.length === 1 ? '' : ': ' + esc(a.name)) + '</a>').join('') + '</p>') + '</section>'
  const leave = owner
    ? '<section class="panel"><h2>Leaving as the owner</h2><p>The owner cannot delete their own account here, because the team would be left without one. To leave, export the data above, then take the app out of this space from Kybernos: that ends the space and hands the full copy back to your computer.</p></section>'
    : '<section class="panel"><h2>Delete my account</h2><p>This signs you out everywhere and erases your account: your name, your address, your password hash, your sessions and every invitation made for your address. The rows you added stay with the team, with an opaque id that points at nobody.</p>' +
      '<details class="ask"><summary class="btn sm danger">Delete my account</summary><form class="confirm wide" method="post" action="/account/delete">' + csrf(view.csrf) +
      '<div class="fld"><label for="del-confirm">Type your email address to confirm</label><input class="input" id="del-confirm" type="text" name="confirm" autocomplete="off" required maxlength="254"></div>' +
      '<button class="btn sm danger" type="submit">Yes, erase my account</button></form></details></section>'
  return sheet('Your account', owner ? OWNER_LINKS.filter(([href]) => href !== '/account') : [], note + details + mine + team + leave, true)
}

/** The page after an account is erased: no way back into the app, only the way to the sign-in. */
export const goodbye = () => document_('Account erased', '<div class="auth"><main class="card-auth"><div class="brand">' + KMARK + '<span>Team space</span></div>\n<h1>Your account was erased</h1>\n<p>You are signed out everywhere. Your name, address, password hash and sessions are gone from this space.</p><p><a class="btn" href="/">Go to the sign-in</a></p>' + MADE + LEGAL + '</main></div>')

// ── the privacy page ──

/**
 * What the space keeps, where, how long, and how each right is used. `view`: `{ contact (string | null), region, sessionDays, activityDays, mailProvider (string | null) }`. Plain statements
 * about what this app does; it says nothing about law. Public: no sign-in needed to read it.
 */
export function privacyPage (view) {
  const { contact, region, sessionDays, activityDays, mailProvider } = view
  const ask = contact === null || contact === '' ? 'ask the owner of this space.' : (/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(contact) ? '<a href="mailto:' + esc(contact) + '">' + esc(contact) + '</a>.' : esc(contact) + '.')
  const li = (...items) => '<ul>' + items.map((x) => '<li>' + x + '</li>').join('') + '</ul>'
  const body = [
    '<section class="panel"><h2>Who is responsible</h2><p>The owner of this team space decides what goes into it and why, and is responsible for it. Kybernos runs the computer the space lives on and the software it runs.</p><p>For any question about your data, ' + ask + '</p></section>',
    '<section class="panel"><h2>What is kept</h2>' + li(
      'Your name and email address, and the profile the owner gave you.',
      'A password hash: a scrambled form of your password that cannot be turned back into it. The password itself is never kept.',
      'Session cookies: while you are signed in, your browser holds a random cookie, and the space keeps its dates and the kind of device (for example “Chrome on macOS”). Your network address is not kept in the session.',
      'The rows your team adds, and who added or changed each one, as an opaque id, not a name.',
      'The activity log: sign-ins, invitations, changes to people, exports and refused requests. Failed sign-ins keep a masked address (like a***@example.com) and a short code made from the network address; no password, link or message is ever written to it.',
      'Invitations, with the address they were sent to, until they are used or the owner revokes them.') +
      (mailProvider === null ? '' : '<p>Invitation emails are sent through ' + esc(mailProvider) + ', which sees the address and the text of the invitation.</p>') + '</section>',
    '<section class="panel"><h2>Where it lives</h2><p>On one computer run by Kybernos, in ' + esc(region) + '. The app does not send your data anywhere else' + (mailProvider === null ? '.' : ', apart from the invitation emails above.') + '</p></section>',
    '<section class="panel"><h2>How long it is kept</h2>' + li(
      'The activity log: ' + activityDays + ' days, then it is deleted automatically.',
      'Sessions: ' + sessionDays + ' days after you last used them, or until you sign out or are removed.',
      'Used and expired invitations: they are deleted; an expired one is removed 30 days after it expires.',
      'Your account and what is in it: until you delete it or the owner removes you. The rows you added stay with the team.') + '</section>',
    '<section class="panel"><h2>Your rights, and how to use them here</h2>' + li(
      '<b>See</b> what is kept about you: <a href="/account">your account</a> shows your details.',
      '<b>Take it with you</b>: “Download my data” on your account page gives a JSON file. The owner can export all the data of an app the same way, from the menu.',
      '<b>Correct</b> it: your name and address were set when you joined. Ask the owner, who can remove you and invite you again with the right details. A row can be corrected by anyone whose profile lets them edit it.',
      '<b>Delete</b> it: “Delete my account” on your account page erases your account, password hash, sessions, invitations for your address and your address in the activity log. The owner can also remove you, with the same effect. The owner cannot delete themselves this way: they export the data and take the space down.',
      '<b>What stays</b> after an erasure: the rows you added keep an opaque id that no longer points to anyone, and the activity log keeps that something happened, not to whom.',
      'You can also contact your data protection authority.') + '</section>',
  ].join('\n')
  return document_('Privacy', '<div class="sheet"><header class="sheet-top"><a class="back" href="/">← Back to the app</a><h1>Privacy</h1></header>\n<main class="sheet-main narrow">\n<p class="sub lead">What this team space keeps about you, where it lives, how long it stays, and how you can see, take, correct or erase it.</p>\n' + body + '\n</main>\n<footer class="sheet-foot">' + MADE + '</footer></div>')
}
