# `@local/kybernos-composio`

Connects DSH agents to Composio's MCP server with the user's API key, and gives the user a browsable
catalog of connectable apps plus a form for custom MCP connectors.

## What the user sees

- **Key panel** in the bundle's configuration slot (the UI text points to Settings, Plugins,
  kybernos-composio): it takes a `ck_...` key (Composio "For You", the personal product) and shows an "MCP"
  probe result. The panel also asks the HOST (`GET /connections`) and says whether the agents have a key
  (`COMPOSIO_API_KEY` in `~/.dsh/.env`) and whether Composio accepts it: the key saved in the browser alone
  proves nothing about the agents. There is no "Cloud" mode: the toggle that used to be here stored a flag
  nothing read, and promised connectors for cloud agents that a `ck_` key cannot give (Composio's For You and
  Platform are separate projects: `ck_` vs `ak_` keys, different headers, and the accounts of one do not
  exist in the other). The Kybernos server runs its own Platform integration (`/v1/connections`, scoped to the
  user's Kybernos key); a real cloud mode would go through that, not through a Platform key typed here.
- **Failures are shown as failures**: a rejected key (401), a rate limit (429), no answer in time or no
  network replace the "No app connected yet" message, with the same codes as the host (see below).
- **Connections page** (tabs "Yours" and "Discover", search, category facets, 24 apps per page): add an
  account through an authorization link opened in a new tab (polled up to 2.5 min until ACTIVE), remove one,
  and list, add or delete custom connectors. The component is exported as `composio.page` and mounted by
  `@local/kybernos-plugin` in its Resources page (tab `composio`); not checked in the live GUI.
- **Chat cards**: a fenced block with language `kybernos-carte` and a JSON list of items (`titre`, `type`,
  `etat`, `desc`, `slug`, `actionUrl`...) is replaced by resource cards. The JSON is model output, so a
  card's `actionUrl` becomes a link only if it is an absolute `http:`/`https:` URL (opened with
  `rel="noreferrer noopener"`) or an internal `kb:` command (`kb:accept:<text>`, `kb:<tab>`, handled by the
  bundle, never navigated to); anything else (`javascript:`, `data:`, relative, malformed) shows the label as
  plain text. The same http(s) rule applies to the authorization link Composio returns and to the one kept in
  localStorage. A `kb:accept:<text>` button sends its text into the conversation AS THE USER'S MESSAGE, and
  the card is model output (it can be built from a mail the agent read): a click first shows the exact
  text in a confirmation, and a text over 500 characters is refused (the limit of the kybernos bundle's `kb-accept-text` listener, which drops anything longer).
- A "Kybernos" pill on the engine's Plugins page that shows only `@local/kybernos-*` bundles.

## MCP entry (`cordis.patch.yml`)

Inserts a `composio` entry of `@deepseek-ai/dsh-mcp-client`: streamable-http to
`https://connect.composio.dev/mcp`, header `x-consumer-api-key` from `process.env.COMPOSIO_API_KEY`, 180 s
tool timeout, `failOnStartupError: false`, up to 10 reconnects. Without a key it fails quietly.
After those 10 failed attempts (about 2.5 minutes: delays double from 0.5 s up to 30 s) `dsh-mcp-client`
gives up, unregisters the Composio tools and does not try again until DSH restarts (read in its source, not
fixable from here; `reconnect.maxAttempts` can be raised in the patch if that is preferred).

## Host routes

| Route | Behaviour |
| --- | --- |
| `GET /kybernos/composio/catalog` | the `catalog.js` array (100 apps, 98 SVG logos, about 360 KB), ETag, `max-age=3600` (a corrected catalog reaches a browser up to an hour late) |
| `GET /kybernos/composio/connections?toolkits=a,b` | read-only; up to 40 slugs (lower-cased, a leading `_` allowed); with none it scans the account; always 200 with `configured`, `stale`, `error`; only `id`, `alias`, `status`, `accountType`, `isDefault` are returned |
| `GET`, `POST`, `DELETE /kybernos/composio/connecteurs[?nom=]` | custom connectors; exact-origin guard, JSON required on `POST`; body at most 200000 bytes (413) |

`connections` never answers 5xx. `error` says what failed, so an empty list that comes with an error is not
"nothing connected": `no-credential`, `401` (key rejected, also when a tool error says so), `429`,
`timeout`, `offline`, another HTTP status, `bad-response` (not a JSON-RPC answer: an HTML page...),
`rpc-error`, `tool-error`, `invalid-toolkits` (a list with no valid slug: it is not turned into a scan). The
account scan stops at the first failing batch, says `partial: true` and is only cached (5 min) when complete; the
last complete answer of the same key is served `stale` for up to 30 minutes when Composio fails. Caches and the MCP
session are keyed by a hash of the API key, an expired session (404) is started again once, and one
deadline (12 s) covers a whole exchange, headers and body. If the public list of apps cannot be fetched the scan
runs on the 100 local apps for 30 s only and says it is partial.

A custom connector (name `^[a-z][a-z0-9-]{1,30}$`, not `composio`, not the id or serverName of another entry
of the patch) is either `streamable-http` (https URL, or http for localhost only; no `user:password@`) or
`stdio` (absolute executable under `/usr/bin`, `/bin`, `/usr/sbin`, `/sbin`, `/usr/local/{bin,sbin}` or
`/opt/homebrew/{bin,sbin}`; at most 8 arguments of 200 characters, given as a list or as a line split like a
shell does for single and double quotes; no control character in arguments, cwd, env or headers; no repeated
env or header name). It becomes active after the next DSH start. Secret names that `dsh-app-boot` refuses in a
`.env` (`DSH_*`, `HOME`, `PATH`, `EDITOR`, `XDG_*`, `DYLD_*`, `NODE_OPTIONS`...) are a 400: DSH would not start.

## Files, settings, environment

All paths are under the DSH home, resolved like DSH does (`$DSH_HOME` when set, `~` expanded, else
`<home>/.dsh`), and profile `web`:

- `<home>/.env`: reads `COMPOSIO_API_KEY` with `parseEnv` like DSH (fallback when the credentials service is
  missing or fails); writes `NAME=value` lines for secrets typed in the connector form. Each value is written in
  the first form (bare, `'single'`, `` `backtick` `` or `"double"` quotes) that `parseEnv` reads back exactly, every
  line that defines the name is replaced, and the edit is refused if it would change another variable or if no
  quote can hold the value (400). Deleting a connector removes the secrets the form wrote for it (recorded by name
  in the sidecar, never by value) when no other connector or patch entry uses them.
- `<home>/kybernos/connecteurs.json`: the connectors list. A file that is corrupt or unreadable is never read as
  an empty list: `POST` and `DELETE` answer 409 and leave it alone (a copy is kept next to it, five at most),
  and `GET` still lists the patch blocks with `state` and `error`.
- `<home>/profiles/web/cordis.patch.yml`: marked blocks `# connecteur:<name>` are added, replaced and removed.
  A block ends at the first top-level line that is not its own, so blocks other writers append after it (Workers,
  Outils) and hand-added entries are kept. The whole resulting text is parsed with the `js-yaml` that ships with
  DSH, as DSH parses it, before anything is written (it is looked up from the profile folder, the DSH home, this
  plugin and the launcher: when none is reachable the reply says `validated: false`); the previous patch is
  kept as `cordis.patch.yml.bak-composio-<time>` (ten kept). Deleting the last connector of a file that holds
  nothing else removes the file: an empty one makes DSH fail at boot.
- Writes go through a temp file and a rename, files are 0600 when created (the folder 0700; an existing file keeps
  its mode, a symlink stays a symlink). The patch is written first; if the `.env` or sidecar step then fails, the
  files already written are put back and the reply (500) says so, without a path.
- Browser storage: `composio.apiKey`, `composio.authLinks` (10 min TTL),
  `kybernos.pluginsFilter`; reads `kybernos.theme.lang`.

## DSH seams and network

- Host: `webServer`, `credentials` (reference `COMPOSIO_API_KEY`, resolved on every request, never cached),
  `ctx.effect`. Client: `inject: ['timer', 'slots', 'locale']`, slot `plugins.bundle.config` keyed
  `@local/kybernos-composio`, plus DOM scans of chat code blocks and of the Plugins page. No `remote.*` is
  used, although `package.json` lists `@deepseek-ai/dsh-api-remotes` among seven client dependencies.
- Network: `https://connect.composio.dev/mcp` (from the host, and from the browser with the key kept in
  localStorage); `https://kybernos-proxy-production.up.railway.app/v1/connections/apps` (public app list,
  from both); links to `https://dashboard.composio.dev/`.

## Tests

```bash
node test-host.mjs     # 528 checks with a DSH engine on the machine (454 without), temp HOME and DSH_HOME
node test-client.mjs   # 166 checks, no browser
```

`test-host.mjs` covers the connectors route (hostile origin, content type, command rules, YAML injection, the
files it writes and how it fails), the connections route with a stubbed `fetch` (errors, timeouts, caches, key
rotation, session expiry), the catalog route and `DSH_HOME`. DSH's own boot code is the judge when the machine has
an engine (`~/.dsh/kybernos/moteur/*`, read only): `loadLayeredEnv` on the `.env` the route writes,
`loadOverlayPatches` on the patch, the engine's list of refused `.env` names compared with ours, and `js-yaml`
for the broken-patch cases; without one (CI) those checks are reported as skipped and the rest runs
(`NO_DSH_ENGINE=1` plays that on a machine that has one). `test-client.mjs` loads `client.js` with a fake module
loader and a stubbed `fetch` and reaches the pure parts through the `composio` export: card URLs and the confirmed
`kb:accept:` action, the stored authorization link, the MCP client (key change, session expiry, timeouts), the
search, the args field round trip, error and host-state texts, and a structural check of every catalog logo
(`scripts/svg-check.mjs`). The React page itself has no test.
Regenerate the catalog with `KYBERNOS_REPO=<cloud repo checkout> node scripts/build-catalog.mjs`: it repairs the
mangled markup the cloud repo carries, checks every logo and stops on a defect.

## Known limits

- The key lives twice: in the browser for this UI, and in `~/.dsh/.env` for the agents (copied by hand,
  then DSH restarted, as the panel says).
- `catalog` and `connections` have no `Origin` check; only `connecteurs` does.
- The local catalog is 100 apps (the Airparser logo cannot be rebuilt from the cloud repo: it shows the app's
  initial); "Load the full catalog" fetches the rest of the names from the Kybernos proxy.
- UI strings exist in French and English only; French is the default for `kybernos` and `fr`, English for every
  other locale.
- About twenty `kb7-*` class names are defined both here and in the kybernos bundle's sheet for this tab (it
  themes the page on purpose, so the same name there overrides this one). That cost the error banner its
  text in the dark theme, where the other sheet fills and writes it in the same red: the banner has its own
  class (`kbcp-err`). Anything new on this page should take a `kbcp-` name.
- `kybernos-plugin/client.js` carries its own copy of the MCP client (`kbConnMcp`) and of the `kb-accept-text`
  listener: they do not get the fixes made here.
