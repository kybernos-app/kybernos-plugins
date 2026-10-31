# Team space, L7: e-mail invitations, data rights, activity log (plugin side)

What the plugins repository now does for a team space before launch, where it stops, and what the server session (L6) still owes. The code is in
`packages/kybernos-webapp-creator/templates/tables` (the template README has the routes, variables and limits).

## Decisions

1. **One mail adapter, Resend's HTTP API, configured by environment only** (`KB_MAIL_API_KEY`, `KB_MAIL_FROM`, `KB_MAIL_REPLY_TO`, and `KB_MAIL_API_BASE` for tests). No key keeps the old
   behaviour: nothing is sent and the owner copies the link. `fetch` is injected, one request, 10 s, no retry, no redirect, the key in one header. The provider's answer is read and
   **dropped**: only its status is logged. A failure is shown as « The e-mail could not be sent. Here is the link to give them yourself. » with the link; nothing of the provider reaches
   the owner, a log or the activity page. A bad setting never stops the app: it starts with the default mailer and logs the variable name.
2. **A person's data is theirs to see, take and erase** from the page they already have (`/account`): an export without tokens or hashes, and « Delete my account » with the address typed
   as confirmation. The owner cannot delete themselves (they export, then take the app out of the space). The owner's « Remove » runs the **same** erasure. It removes the account, the
   password hash, the sessions, every invitation for the address and every trace of the address and name in `auth.sqlite`, then checkpoints the log and rebuilds the file so the old bytes
   are not left in free pages. The tests search every table and the bytes of the file and its log, and a control proves that plain `DELETE`s leave the bytes.
3. **What an erasure leaves is said, not hidden**: rows of an app keep an opaque author id that points at nobody; the activity log keeps that something happened, not to whom.
4. **The owner's export of an app is the owner's session only** (a bearer gets `403`): it is data of people, and the owner's computer already has the snapshot routes for a full copy.
5. **The activity log is append-only and redacts at one door** (`lib/audit.mjs`): a fixed list of kinds, opaque ids, masked addresses, network addresses as a keyed short hash, no secret, link,
   token or message body anywhere. 90 days, cap 100 000 rows, pruned at start and daily. Owner-only page and API. It never stops a request or the start of the app.
6. **No claim of legal compliance anywhere.** `/privacy` states what the app does in plain words. **That text needs a lawyer's review before launch**, together with the owner's own purposes
   and the hosting's terms. `KB_REGION_LABEL` must only ever say what is true; unset, the page says « the EU region your team space was created in ».
7. **A latent bug found by looking at the real result**: the app's `Referrer-Policy: no-referrer` makes Chrome send `Origin: null` with a posted form, so the Origin check refused every
   server-rendered form (invitation, People, the new delete dialog). The pages now carry `<meta name="referrer" content="same-origin">` (measured: the header alone gives `null`, with the tag
   the origin). The existing http checks never saw it because they set the Origin by hand; the live check now submits the forms in Chrome.
8. **Sessions record the browser's User-Agent** (and only that) so « Chrome on macOS » can be shown; Better-Auth's address tracking stays off and sessions last 7 days, stated.

## What is left for the server session (L6)

- **Provision the provider key**: `KB_MAIL_API_KEY`, `KB_MAIL_FROM` (a domain the provider has verified: SPF and DKIM) and `KB_MAIL_REPLY_TO` as secrets of the space (`secrets`), never in the
  image or a log. **Switch click and open tracking off for the sending domain at the provider**: the e-mail has none, but a provider can rewrite links.
- **The region label and the contact**: set `KB_REGION_LABEL` (what is true for that space) and `KB_PRIVACY_CONTACT` per space. The privacy page names the mail provider only when mail is set up.
- **Backups**: an erasure does not reach a backup of the space. Decide how long backups live and say it on the privacy page (a sentence, then a test).
- **The paused page**: a space that is paused cannot serve `/privacy`; the host's own paused page must link a static copy of it or say who to ask.
- **What the hosting keeps**: its access logs, the sub-processors (the provider of the computer, the mail provider) and their retention; the privacy page covers only what the app does.
- **Leaving as the owner**: ending a space and handing the full copy back (release) is a host and DSH flow, not an app route; the account page only points at it.
- **No self-service change of name or address**: erase and be invited again. A rename flow needs a decision on what happens to the old address in the activity log.

## Tests

`test-tables-mail.mjs` and `test-tables-privacy.mjs` (no dependencies, in CI); `scripts/check-tables-app.mjs` (a second instance with a fake provider, the whole erasure scenario, the log);
`scripts/check-tables-front-live.mjs` (the pages, the export control and the delete dialog in Chrome, measured, at desktop and 390 px).

## Dead-code rider

Checked by grep over the template, the tests and the scripts: every export of the template modules (only constants and the client's pure helpers have no importer outside their file, none is
new), every import and top-level binding of the files touched. Removed: the unused `DAY_MS`, three `export`s on constants nothing imports (`SESSION_DAYS`, `RETENTION_MS`,
`DEFAULT_MAIL_BASE`), and the second copy of the member-row `DELETE` (the erasure now goes through `store.removeMember`). The old one-line mailer was replaced, not kept beside the new one.
Nothing else proved dead; the `scripts/patches.json` legacy patches are untouched (this change adds none).
