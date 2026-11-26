# Servers page: study (2026-10-19)

Status: **study + mockup (v3), nothing built.** Asked: better process, a help, Enterprise marketing text, add/remove servers, a commercial
name for the built-in server, and a way for anyone who knows a test server's credentials to add it (prod / staging / local switch).
Read first: `docs/dev/servers.md` (the open half), the paid module `packages/kybernos-servers` (private repo, its README and `docs/test-cases.md`).

## What exists today (checked 2026-10-19)

- The page is the **paid module** `kybernos-servers` (private repo), registered as a Settings section. The open half only reads the registry
  (`<DSH home>/kybernos/servers.json`) and applies it (`GET /kybernos-cloud/server`, `POST /kybernos-cloud/server/apply`). Add, switch and remove
  already exist, as host routes `/kybernos-servers/*`, with discovery from one address (`/.well-known/kybernos-server.json`).
- **Everything that adds or switches is behind the licence** (signed, offline). Without one the page is a list with a disabled « Add a server ».
  On the maintainer's machine there is no licence file, yet `servers.json` holds two hand-written entries (production, local): **the file is
  edited by hand because the page cannot be used.** That is the process problem.
- That hand-written production entry has the same `api` as the built-in server but another id, so it gets its **own connection file**
  (sign in twice) and shows as a second row. The module's `add` only de-duplicates against the registry, not against the built-in server.
- Sign-in is device pairing only: the code is approved in a browser, and the server asks for a **recent strong authentication** to approve it
  (a new device is a new credential for the whole account). There is no route that turns a password into a device token. A personal API key
  (`/v1/keys`) is accepted by `/v1/models`, `/v1/chat/completions` and `/v1/embeddings` only: it can power chat, not the account or Team pages.
- Discovery works against the real servers (both the local and the production server answer 200 with `schema: 1`), but both are named just
  « Kybernos », so a discovered server needs a name the user can change. The module's `discover()` also drops `services.connections`.
- Help: the shared « ? How it works » card is `window.__KB_HELP__.Help({ id, page })`; its text is `help.json`, shipped in the **public** catalogue
  (`scripts/build-catalog.mjs` reads `packages/<dir>/help.json` of this repo only). The paid module cannot ship a card of its own through that path.
- On `dev` the page sits in Settings › **Devices** (the 2026-10-18 reorganisation); the module's test-cases still say « Account ».
- The built-in server is already called « Kybernos Cloud » in its profile; what the user sees as the name is the host line (`api.kybernos.app`).
  Renaming the **host** is not a label change: the connection file records `api`, and a connection that belongs to another server than the
  active one is moved aside at start (`docs/dev/servers.md`, « An install left by the old stack »): every installed DSH would be signed out.

## Proposal (v3: address + account, nothing else)

A server is an address and the user's account on it. **No « test » / « company » distinction, no licence and no API key in the user's path.**
Same flow for Kybernos staging, a local server, a customer's own server.

1. **User flow (three gestures)**: paste the address the administrator gave; click « Add and sign in » (the server is checked on its own, its name
   shows, DSH switches to it without a second screen); confirm the code in the browser. Today it takes at least six more steps (paste a licence,
   type the address, check, add, switch, confirm the switch, sign in, confirm the code).
2. **Licence or key? Neither.** The licence belongs to the company that buys the server, not to each employee: the **server checks it itself**
   (it already has a licence module; a lapsed licence refuses new accounts and never locks anyone out). The API key only reaches
   `/v1/models`, `/v1/chat/completions`, `/v1/embeddings`: no account, team or memory, and a secret to handle. Both are out of the default
   flow; the key stays as « Other ways to sign in » (access key = models only; email + password, used once to confirm the code, never stored,
   only if the server accepts it).
3. **Consequences**: the DSH-side licence goes (`licence.mjs`, the `/kybernos-servers/licence` route, `mayAdd` / `maySwitchTo`, their tests: dead-code
   rider). What is sold is the server and its licence, not a button in DSH. With nothing paid left, the page can move to the **open repo**, which
   also fixes help: its own `help.json` then enters the public catalogue (otherwise `pages.servers` in `kybernos-cloud/help.json`).
4. **Names**: the row shows the commercial name and a one-line role (« Managed by Kybernos » for the built-in server, the host for the others);
   the host and the addresses the token goes to are in « Details », and the add dialog says « your sign-in goes only to <host> » with the full
   list one click away. The published name « Kybernos » is suggested as « Kybernos · <host> » so two servers never share a name; the name can be
   renamed. No host rename.
5. **Marketing**: an Enterprise card, always shown under the list (four claims that exist in the server today, see the
   mockup): « Talk to us » and « My company already has a server » (opens the add dialog). Copy and the contact address are the owner's.
6. **Registry and safety**: `add` also de-duplicates against the built-in server's `api`, with a one-time merge of the hand-written production
   entry; a neutral banner while the active server is not Kybernos Cloud.

Not chosen: a licence in the dialog (v2), licence-free « test » servers, a `kind` field in the profile.

## Where the work would go

| Repo | Files |
|---|---|
| open (`kybernos-plugins`, Apache-2.0), if the page moves here | new package `kybernos-servers` (page, host routes, `discovery.mjs`, its own `help.json`), docs, search entry, tests, `docs/dev/servers.md` |
| paid (`kybernos-plugins-pro`) | removal of the package (licence, issuing script, tests) once the profile is relinked |

The paid module is **linked into the real DSH profile**: do the move in worktrees, relink the profile in one step, never edit the linked checkout.
Server-side nothing is needed for the browser and key sign-ins; the password option needs the server's sign-in route checked first.

## Impact of the branch audit and Teams end-to-end sessions

- The real `servers.json` currently has `active: kybernos-local` (set 2026-10-18 22:12) for the Teams end-to-end run on `localhost:8791`.
  **Do not touch `servers.json`, the connection files or restart DSH** while that run is open.
- `scripts/worktree-clean.sh --base dev --apply` removes any worktree whose HEAD is in `dev` and that is clean; this worktree qualifies until it
  holds a commit or an untracked file (this study file is one on purpose).
- The paid repo was bundled by the audit (`kybernos-plugins-pro-all-refs-2026-10-18.bundle`, main = origin/main), so nothing there is at risk.
- The archived « server-help-page » patch belongs to the Kybernos **server** repo (its `/help` page), not to this one.

## Not verified

No GUI run, no test run, no licence issued. The password option, the access-key (models only) connection and the marketing claims are proposals.
Claims in the card (own server, own skills catalogue, BYOK, roles / second factor / limits) match server features read in its `AGENTS.md`;
**on a company server the connected apps and the phone link depend on its configuration**, and the help says so.
