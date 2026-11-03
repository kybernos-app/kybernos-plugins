# Publish a page: `<slug>.kaby.app`, our domain, our Vercel, through the server

Status: **contract, 2026-11-03** (owner's decision, in his words: « le publish utilise notre domaine et notre Vercel via le serveur, exemple `pizzaone.kaby.app` »).
Nothing of it is deployed. This page is what the server (`kybernos-server`, module `sites`) and the plugin (`kybernos-cloud`, tool `site_publish`) are both built against.

## Why this shape

- Kaby (WhatsApp, Telegram, its chat in DSH) builds a page, a person asks « put it online » and nothing could do it: the cloud computer's public host is the DSH gate only, and the server
  never stores or serves HTML written by a person (ADR 0007 § 8c, `/s/<id>` shows data through a page of ours). Kaby improvised tunnels and was refused (measured on WhatsApp, 2026-11-03).
- The static page is hosted by **Vercel**, not by our server: the server only forwards the files to Vercel with its own token and records who owns which name. The HTML never
  sits on our API origin; every site has its own origin under `kaby.app`, a registrable domain that is not `kybernos.app` (cadrage of 2026-10-27, § 6).
- Measured 2026-11-03 (read only, `vercel` CLI): the domain `kaby.app` is registered at Vercel in the team `platon-ai-agent` (« AI Agent »), its name servers are Vercel's, a wildcard
  certificate `*.kaby.app` exists (renews), the wildcard DNS record points to Vercel and `https://pizzaone.kaby.app` answers `404 DEPLOYMENT_NOT_FOUND` from Vercel. The apex and
  `links-test.kaby.app` point to Fly (the apex is the server's, `links-test` is the shared-links test server): the publish never touches them. The domain must NOT be attached to a
  Vercel project as a whole (cadrage 2026-10-27): each site gets its own project and its own subdomain.
- Apps with a database (the Apps / team-space hosting, ADR 0061) are another thing and stay as designed: this is the static page, the 5-minute « put my page online ».

## The server's routes (user token, same envelope and errors as the rest of `/v1`)

`POST /v1/sites` — create or replace the site of a name.

```json
{ "slug": "pizzaone", "title": "Pizza One", "files": [ { "path": "index.html", "content_base64": "..." }, { "path": "img/hero.jpg", "content_base64": "..." } ] }
```

- `slug`: 3 to 32 characters, `[a-z0-9-]`, no leading or trailing `-`, no `--`. Reserved words are refused (`www api app kaby kybernos admin mail static help skills dev staging links links-test assets cdn status docs blog` and anything that starts with `kb-` or `xn--`).
- `files`: 1 to 50 files, `path` relative, `/`-separated, no `..`, no leading `/`, no dot-file, at most 120 characters, **one `index.html` at the root**, extensions in `html htm css js mjs json txt xml svg png jpg jpeg gif webp avif ico woff woff2 webmanifest`.
  At most 2 MiB a file and 4 MiB in all once decoded. Anything else is `400 invalid_files` (the message says which file and why).
- Same owner, same slug: a new deployment replaces the live one (`updated: true`). Another owner holds the slug: `409 slug_taken`.
- `200 { "slug", "url": "https://pizzaone.kaby.app", "state": "live", "updated": false, "files": 2, "bytes": 18234 }` once the deployment is ready (the route waits for Vercel up to 60 s; a deployment that is
  still building after that is `202 { state: "building", retry_after_seconds: 5 }` and a second `POST` with the same body is the same deployment, not a second one).
- Errors: `400 invalid_slug | reserved_slug | invalid_files`, `409 slug_taken`, `413 too_big`, `402`/`403` per the plan when the plan carries the limit (`too_many_sites`, default 3 sites a person, `SITES_MAX_PER_USER`), `429 rate_limited`, `502 host_error` (Vercel refused or was unreachable: a plain sentence, never the token, never Vercel's raw body), `404 not_found` when the feature is off (`SITES_*` unset: the routes do not exist, like the Telegram door).

`GET /v1/sites` — `{ sites: [ { slug, url, title, state, created_at, updated_at, files, bytes } ] }`, the caller's own, newest first.

`DELETE /v1/sites/{slug}` — takes the site down (Vercel project deleted, the name freed): `{ removed: true }`; `404` for a name that is not the caller's.

`POST /v1/admin/sites/{slug}/takedown` — owner-only (second factor, as the snapshots' takedown): the site disappears, the name is kept (`taken_down`), an audit event says who. A public page can be reported: the contact is the one of the privacy page.

## The computer's route (a cloud computer's restricted token)

`POST /v1/computer/sites` — the same body plus `"job_id"` (the turn the call belongs to, as `POST /v1/computer/approvals`: it must be a turn addressed to THIS computer and still running for its person).
Same answers. The site belongs to the computer's owner. The route is in the computer token's list (otherwise `403 computer_route_not_allowed`). Nothing else of the sites is reachable with that token.

## What the server keeps

`product.sites`: `id`, `owner_user_id`, `slug` (unique, lower case, also for a removed or taken-down site: a name is not reused by someone else the minute it is freed — 30 days), `title`, `vercel_project_id`,
`state` (`live | removed | taken_down`), `files`, `bytes`, `created_at`, `updated_at`, `removed_at`. Never the files themselves. Audit events: `site.published`, `site.updated`, `site.removed`, `site.taken_down` (slug, owner, bytes; never a file name or a word of the page).

## What the server does on Vercel (adapter behind a port, with a fake for the tests)

Env: `SITES_VERCEL_TOKEN` (secret, a token of the team, never printed or logged), `SITES_VERCEL_TEAM` (team id), `SITES_DOMAIN` (`kaby.app`), `SITES_MAX_PER_USER`. All three of the first set or the module is off.

1. Project `kaby-site-<slug>` (created by the first deployment), framework `null`, no build.
2. `POST /v13/deployments?teamId=…` with `name`, `project`, `target: "production"`, `files: [{ file, data, encoding: "base64" }]`, `projectSettings: { framework: null }`. Wait for `readyState: READY` (poll `GET /v13/deployments/{id}`).
3. `POST /v10/projects/{project}/domains?teamId=…` `{ "name": "<slug>.kaby.app" }` (idempotent: « already in use by this project » is a success).
4. Remove: `DELETE /v9/projects/{project}?teamId=…`.

A `vercel.json` is added to every bundle (unless the person's own is there, which is then refused: `invalid_files`): `cleanUrls`, headers `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: SAMEORIGIN`.
No cookie, no server function: static only.

## The plugin's tool (`kybernos-cloud`)

`site_publish { path, slug? , title? }` — `path` is a file (an `index.html`) or a folder (with `index.html`) inside the chat's working folder. It builds the bundle with the same limits, calls `POST /v1/sites`
(account token on the person's computer) or `POST /v1/computer/sites` (the computer's token on a cloud computer), and says the link or the refusal in one plain sentence. It **asks the person first**, on both bodies,
in plain words (« Publish the page on pizzaone.kaby.app ») because it puts something on the public internet; the mandate never covers it. A name is chosen with the person (Kaby proposes one, the server says if it is taken).
`site_list` and `site_remove` read and take down the person's own sites (the removal asks first).
