# `@local/kybernos-composio`

Connects DSH agents to Composio's MCP server with the user's API key, gives the user a browsable catalog of
connectable apps, and manages the user's own MCP servers (remote HTTP or a local command): add, paste, edit, test,
switch off, delete.

## What the user sees

- **Key panel** in the bundle's configuration slot (Settings, Plugins, kybernos-composio): one field for the
  `ck_...` key (Composio "For You", the personal product) and three lines that say what is true: where the key is
  (`~/.dsh/.env` on this machine, or the environment DSH was launched with, which cannot be changed from here),
  whether Composio accepts it, and whether the running agents hold the same one (they read it when DSH starts, so a
  key saved now is used by them after a restart). Saving checks the key with Composio first: a rejected key is not
  saved. The page keeps no copy of the key: one an older version left in this browser is offered for saving, then
  removed. There is no Platform key field: Composio's For You and Platform are separate projects (`ck_` vs `ak_`
  keys, different headers, and the accounts of one do not exist in the other), so a cloud mode cannot come from a key
  typed here. It comes from the Kybernos account: see "Kybernos connections" below (the toggle that used to stand here
  stored a flag nothing read, and is gone).
- **Failures are shown as failures**: a rejected key (401), a rate limit (429), no answer in time or no network
  replace the "No app connected yet" message, with the same codes as the host.
- **Connections page** (mounted by `@local/kybernos-plugin` in its Connectors page; three sub-tabs):
  - *Yours* and *Discover*: search, category facets, 24 apps per page. Add an account through an authorization link
    opened in a new tab (polled up to 2.5 min until ACTIVE), remove one. The account label is its alias, else its
    type, else its id: the host never passes on the e-mail Composio holds.
  - *Kybernos connections* (the second mode of *Yours*, shown only when the active server offers it): the person's
    apps linked once to their Kybernos account through the server's own Composio Platform project, so every agent of
    theirs uses them with no key on this machine (ADR 0008 of the Kybernos server). A switch above the list chooses
    between this and the personal key (one at a time, the last choice is remembered). The list shows a state per
    connection (active, pending, failed, expired, disabled), the quota ("3 of 4", a pending request counts), and the
    actions on hover (cancel a pending one, remove, retry or reconnect). "Connect an app" searches the server's
    catalogue (48 apps at a time, "Show more" for the rest), then either sends the person to the app's own page in a new tab (the row stays pending and the page
    asks the server about that one connection every 5 s, 10 minutes at most) or, for an app with no OAuth, takes its
    API key (sent once, never stored, logged or shown again). A refused add that may have gone through says to check
    the list, and is never sent twice. Not signed in to Kybernos: a button starts the pairing right there. The page
    asks the cloud half of this machine (`/kybernos-cloud/connections*`, which holds the account's token); with a
    cloud half that does not know those routes, or a server that does not announce `services.connections`, the
    switch is not shown at all. The agents get three tools for the same connections from that same cloud half
    (`packages/kybernos-cloud/README.md`).
  - *MCP servers*: one row per server with what DSH says of it. The actions (switch on/off, Test, Edit, Delete)
    appear when the row is hovered or has the keyboard focus (always visible on a touch screen). The "+ Add an MCP
    server" menu offers a form or pasting JSON.
- **The form** edits any server, including the ones the `connecteur-personnalise` skill wrote (they are read in full;
  saving one moves it to the form's standard block, without its comments, after the old file is backed up). The name
  is locked unless "Rename…" is chosen (the old block goes, the new one comes, its secrets follow). A secret shows
  whether it has a value, never the value; "Replace" types a new one. "Test without saving" runs the draft. A server
  the form cannot write back exactly (a computed value, an option it does not know) opens read only, with the reason.
- **Pasting JSON** takes the `mcpServers` block a server's documentation gives. Secret-looking values (an API key in
  a header, a token in an env variable) become `$NAME` references and secrets for `~/.dsh/.env`; a bare `npx` is
  replaced by the path the host finds; a program in a folder that is not trusted yet offers "Allow this folder";
  SSE servers are flagged (DSH handles streamable HTTP and stdio only).
- **Chat cards**: a fenced block with language `kybernos-carte` and a JSON list of items (`titre`, `type`,
  `etat`, `desc`, `slug`, `actionUrl`...) is replaced by resource cards. The JSON is model output, so a
  card's `actionUrl` becomes a link only if it is an absolute `http:`/`https:` URL (opened with
  `rel="noreferrer noopener"`) or an internal `kb:` command (`kb:accept:<text>`, `kb:<tab>`, handled by the
  bundle, never navigated to); anything else (`javascript:`, `data:`, relative, malformed) shows the label as
  plain text. A `kb:accept:<text>` button sends its text into the conversation AS THE USER'S MESSAGE, and
  the card is model output (it can be built from a mail the agent read): a click first shows the exact
  text in a confirmation, and a text over 500 characters is refused (the limit of the kybernos bundle's
  `kb-accept-text` listener, which drops anything longer).
- A "Kybernos" pill on the engine's Plugins page that shows only `@local/kybernos-*` bundles.

## What a server's row says

DSH watches `cordis.patch.yml` and reloads it by itself about 2 to 3 seconds after a write (measured on DSH
0.2.0-rc.2 in an isolated instance: add, change, rename and remove all took effect with the same process, and an
entry with `disabled: true` is skipped), so a saved server needs no restart. The row shows what DSH says, read with
`pluginInventory.list()` and `tools.schemas()`:

| Chip | Meaning |
| --- | --- |
| Active · N tools | the entry is loaded and registered N tools (`mcp__<name>__*`) |
| Loaded · no tool | loaded but registered nothing: with `failOnStartupError: false` a server that cannot start stays "active" with no tools, so this is said, not hidden; Test shows why |
| Failed to load | DSH could not load the entry |
| Loading… | just saved: the page asks again every 2 s for 12 s |
| Not loaded: restart DSH | still not loaded after that: DSH did not reload its configuration |
| Disabled | `disabled: true` in the block |
| Configured | DSH's services are not reachable (tests, an older engine): no claim is made |

## MCP entry (`cordis.patch.yml`)

Inserts a `composio` entry of `@deepseek-ai/dsh-mcp-client`: streamable-http to
`https://connect.composio.dev/mcp`, header `x-consumer-api-key` from `process.env.COMPOSIO_API_KEY`, 180 s
tool timeout, `failOnStartupError: false`, up to 10 reconnects. Without a key it fails quietly.
After those 10 failed attempts (about 2.5 minutes: delays double from 0.5 s up to 30 s) `dsh-mcp-client`
gives up, unregisters the Composio tools and does not try again until DSH restarts (read in its source, not
fixable from here; `reconnect.maxAttempts` can be raised in the patch if that is preferred).
`!!js` header values are evaluated when the entry loads and `process.env` is read at DSH's start: a changed
`.env` reaches the agents after a restart (measured: a reload alone does not re-evaluate it).

## Host routes

| Route | Behaviour |
| --- | --- |
| `GET /kybernos/composio/catalog` | the `catalog.js` array (100 apps, 98 SVG logos, about 360 KB), ETag, `max-age=3600` (a corrected catalog reaches a browser up to an hour late) |
| `GET /kybernos/composio/connections?toolkits=a,b[&fresh=1]` | read-only; up to 40 slugs (lower-cased, a leading `_` allowed); with none it scans the account; always 200 with `configured`, `stale`, `error`; only `id`, `alias`, `status`, `accountType`, `isDefault` are returned; `fresh=1` (at most 5 slugs) skips the 2 minute cache, for polling an account being authorized |
| `GET`, `POST`, `DELETE /kybernos/composio/key` | whether there is a key, where it comes from and whether the running agents hold it (`agents`: `same`, `different`, `none`); `POST { key }` checks it with Composio (a 401/403 is refused, a network failure saves it as unverified) and writes `COMPOSIO_API_KEY` to the DSH `.env`; `DELETE` removes the line. The key is never returned. A key from the launching environment is a 409 |
| `POST /kybernos/composio/accounts` | `{ action: 'add', toolkit }` starts a connection and returns the address to authorize at (http(s) only); `{ action: 'remove', toolkit, accountId }` removes one account; both answer with the toolkit's accounts, taken from Composio's own reply (the pending account is in the reply to an add; a second call to list is only the fallback); an upstream failure is a 502 with the code |
| `GET`, `POST`, `DELETE /kybernos/composio/connecteurs[?nom=]` | the servers: each with `source` (`form` or `skill`), `editable` (and `readOnlyReason`), `live`, `secretsSet`; `POST` saves (or renames with `renameFrom`); exact-origin guard, JSON required; body at most 200000 bytes (413) |
| `POST /kybernos/composio/connecteurs/test` | `{ nom }` for a saved server (run as DSH starts it, whatever folder its command is in), or a full draft with the secrets typed in the form (held to the rules of a save); returns the tools or a coded failure |
| `GET`, `POST`, `DELETE /kybernos/composio/connecteurs/commande` | `GET ?command=npx` says where a program is and whether its folder is trusted; `POST { dir }` confirms a folder; `DELETE ?dir=` forgets it |

`connections` never answers 5xx. Composio's gateway answers 502 for roughly half of the requests at times (measured on a real account, 2026-10-06: 11 of 20 with one session, 12 of 20 initializes, 7 of 20 with no session at all; any method, any toolkit), so a read, and the `initialize` before it, is asked again up to 4 times on a 502, 503 or 504; a write (add, remove) never is, because an add could create a second pending account. `error` says what failed, so an empty list that comes with an error is not
"nothing connected": `no-credential`, `401` (key rejected, also when a tool error says so), `429`,
`timeout`, `offline`, another HTTP status, `bad-response` (not a JSON-RPC answer: an HTML page...),
`rpc-error`, `tool-error`, `invalid-toolkits` (a list with no valid slug: it is not turned into a scan). The
account scan stops at the first failing batch, says `partial: true` and is only cached (5 min) when complete; the
last complete answer of the same key is served `stale` for up to 30 minutes when Composio fails. Caches and the MCP
session are keyed by a hash of the API key, an expired session (404) is started again once, and one
deadline (12 s) covers a whole exchange, headers and body. If the public list of apps cannot be fetched the scan
runs on the 100 local apps for 30 s only and says it is partial.

A server (name `^[a-z][a-z0-9-]{1,30}$`, not `composio`, not the id or serverName of another entry
of the patch) is either `streamable-http` (https URL, or http for localhost only; no `user:password@`) or
`stdio` (absolute executable under `/usr/bin`, `/bin`, `/usr/sbin`, `/sbin`, `/usr/local/{bin,sbin}`,
`/opt/homebrew/{bin,sbin}` or a folder the person confirmed; at most 8 arguments of 200 characters, given as a list
or as a line split like a shell does for single and double quotes; no control character in arguments, cwd, env or
headers; no repeated env or header name; an optional tool timeout from 1 s to 1 h). A confirmed folder must be a real
folder (no link), owned by the user or root, not writable by group or others, and not a broad one (`/`, the home, the
temp folder...): it is checked at every use, so a folder that becomes writable stops being trusted at once. Secret names
that `dsh-app-boot` refuses in a `.env` (`DSH_*`, `HOME`, `PATH`, `EDITOR`, `XDG_*`, `DYLD_*`, `NODE_OPTIONS`...) are a
400: DSH would not start.

**The test** starts a stdio server like DSH does (the parent environment minus names that look like a credential
`KEY|PASSWORD|SECRET|TOKEN` and every `DSH_*`, then the server's own env; the same rule as
`@deepseek-ai/dsh-subprocess`), speaks newline-delimited JSON-RPC (`initialize`, `tools/list`) and kills the process;
an http server gets the same two calls with its headers. A `$NAME` token is replaced by the value typed in the form,
else the `.env`, else this process's environment; a name with no value anywhere is reported, and no secret value is
ever returned (they are redacted from every text, including what a server writes on stderr). At most 3 tests run at
once. An OAuth challenge (`401` with a `www-authenticate` carrying `resource_metadata`) is flagged: DSH's client only
sends fixed headers.

## Files, settings, environment

All paths are under the DSH home, resolved like DSH does (`$DSH_HOME` when set, `~` expanded, else
`<home>/.dsh`), and profile `web`:

- `<home>/.env`: `COMPOSIO_API_KEY` (read with `parseEnv` like DSH; the credentials service reads the `.env` layers
  as they were when DSH started, so a value that comes from one is read again from the file); secrets typed in the
  server form are written as `NAME=value` lines. Each value is written in the first form (bare, `'single'`,
  `` `backtick` `` or `"double"` quotes) that `parseEnv` reads back exactly, every line that defines the name is
  replaced, and the edit is refused if it would change another variable or if no quote can hold the value (400).
  Deleting a server removes the secrets the form wrote for it (recorded by name in the sidecar, never by value)
  when no other server or patch entry uses them.
- `<home>/kybernos/connecteurs.json`: the servers saved by the form. A file that is corrupt or unreadable is never
  read as an empty list: `POST` and `DELETE` answer 409 and leave it alone (a copy is kept next to it, five at most),
  and `GET` still lists the patch blocks.
- `<home>/kybernos/connecteurs-roots.json`: the extra folders commands may run from (see above), 0600.
- `<home>/profiles/web/cordis.patch.yml`: marked blocks `# connecteur:<name>` are added, replaced and removed.
  A block ends at the first top-level line that is not its own, so blocks other writers append after it (Workers,
  Outils) and hand-added entries are kept. The whole resulting text is parsed with the `js-yaml` that ships with
  DSH, as DSH parses it, before anything is written (it is looked up from the profile folder, the DSH home, this
  plugin and the launcher: when none is reachable the reply says `validated: false`); the previous patch is
  kept as `cordis.patch.yml.bak-composio-<time>` (ten kept). Deleting the last block of a file that holds
  nothing else removes the file: an empty one makes DSH fail at boot.
- Writes go through a temp file and a rename, files are 0600 when created (the folder 0700; an existing file keeps
  its mode, a symlink stays a symlink). The patch is written first; if the `.env` or sidecar step then fails, the
  files already written are put back and the reply (500) says so, without a path.
- Browser storage: `composio.authLinks` (10 min TTL), `kybernos.pluginsFilter`; reads `kybernos.theme.lang`, and
  reads then removes `composio.apiKey`, where the previous version kept the key.

## DSH seams and network

- Host: `webServer`, `credentials` (`resolve` and `describe` of `COMPOSIO_API_KEY`, resolved on every request,
  never cached), `pluginInventory` and `tools` (read only, for each server's state), `ctx.effect`. Client:
  `inject: ['timer', 'slots', 'locale']`, slot `plugins.bundle.config` keyed `@local/kybernos-composio`, plus DOM
  scans of chat code blocks and of the Plugins page. No `remote.*` is used, although `package.json` lists
  `@deepseek-ai/dsh-api-remotes` among seven client dependencies.
- Network: from the host, `https://connect.composio.dev/mcp` and
  `https://kybernos-proxy-production.up.railway.app/v1/connections/apps` (public app list; the page also fetches
  it for "Load the full catalog"); a server's own address when it is tested; links to
  `https://dashboard.composio.dev/`. The page itself never contacts Composio.

## Tests

```bash
cd packages/kybernos-composio
node test-host.mjs         # 528 checks with a DSH engine on the machine (454 without): the routes, the files they write
node test-connecteurs.mjs  # 63 (40): reading, editing, renaming, state, test route, trusted folders
node test-key.mjs          # the key and the accounts, against a stand-in for Composio (it can answer 502s)
node test-probe.mjs        # 29: the connector test against fake HTTP and stdio servers
node test-block-read.mjs   # 31 (15): reading a block back, and refusing what cannot be written back
node test-client.mjs       # 233: the pure parts of the page, no browser
```

`test-host.mjs` covers the first routes (hostile origin, content type, command rules, YAML injection, the files they
write and how they fail), the connections route with a stubbed `fetch` (errors, timeouts, caches, key rotation,
session expiry), the catalog route and `DSH_HOME`. DSH's own boot code is the judge when the machine has an engine
(`~/.dsh/kybernos/moteur/*`, read only): `loadLayeredEnv` on the `.env` the route writes, `loadOverlayPatches` on the
patch, the engine's list of refused `.env` names compared with ours, and `js-yaml` for the broken-patch cases; without
one (CI) those checks are reported as skipped and the rest runs (`NO_DSH_ENGINE=1` plays that on a machine that has
one). `test-client.mjs` loads `client.js` with a fake module loader and reaches the pure parts through the `composio`
export: card URLs and the confirmed `kb:accept:` action, the stored authorization link, the key panel's state, the
server rows' state, test failure texts, the JSON import, the form's round trip, the search, error texts, the
Kybernos connections mode (when it exists, what a failed call leaves of a list, which word becomes which sentence in
both languages, and that an API key has nowhere to go but its one call), and a structural check of every catalog logo (`scripts/svg-check.mjs`) and that the page never reaches Composio itself.
`lib-test.mjs` is the shared harness (a host in a temp HOME, fake HTTP and stdio MCP servers, a stand-in for
Composio). The React page itself has no browser test here; it was driven in a real DSH (see
`docs/dev/live-testing.md`): `scripts/check-connectors-live.mjs` for the MCP servers tab and
`scripts/check-connections-live.mjs` for Kybernos connections (a stand-in server that speaks ADR 0008, on an isolated
instance).
Regenerate the catalog with `KYBERNOS_REPO=<cloud repo checkout> node scripts/build-catalog.mjs`: it repairs the
mangled markup the cloud repo carries, checks every logo and stops on a defect.

## Known limits

- Composio's gateway is flaky (see above): the page can still show "Composio has a passing problem (502)" after the retries, and an add or remove that fails must be tried again by hand.
- The hot reload was measured on an isolated DSH 0.2.0-rc.2 instance (and then on the real one: a server added, switched, renamed and deleted from the page was loaded each time within seconds) (its `hmr` watcher is enabled when DSH runs
  with a profile). If a DSH does not reload, the row says "Not loaded: restart DSH" after 12 s instead of waiting.
- A stdio server that writes logs on stdout still works in DSH's client, but the test counts those lines and says so.
- The state of a server needs DSH's `pluginInventory` service; without it the row only says "Configured".
- `catalog` and `connections` have no `Origin` check; the routes that write do.
- The local catalog is 100 apps (the Airparser logo cannot be rebuilt from the cloud repo: it shows the app's
  initial); "Load the full catalog" fetches the rest of the names from the Kybernos proxy.
- UI strings exist in French and English only; French is the default for `kybernos` and `fr`, English for every
  other locale.
- About twenty `kb7-*` class names are defined both here and in the kybernos bundle's sheet for this tab (it
  themes the page on purpose, so the same name there overrides this one). That cost the error banner its
  text in the dark theme, where the other sheet fills and writes it in the same red: the banner has its own
  class (`kbcp-err`). Anything new on this page uses a `kbcp-` name.
- A key saved from the page reaches the chat agents after a DSH restart: the `!!js` header is evaluated when the
  entry loads and `process.env` is read at start. Re-activating the entry from the host would avoid the restart; it
  is not done.
