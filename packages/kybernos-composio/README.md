# `@local/kybernos-composio`

Connects DSH agents to Composio's MCP server with the user's API key, and gives the user a browsable
catalog of connectable apps plus a form for custom MCP connectors.

## What the user sees

- **Key and mode panel** in the bundle's configuration slot (the UI text points to Settings, Plugins,
  kybernos-composio): "Local" mode takes a `ck_...` key and shows an "MCP" probe result; "Cloud" mode only
  shows a link to the Composio dashboard (no behaviour behind it was verified).
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
  localStorage.
- A "Kybernos" pill on the engine's Plugins page that shows only `@local/kybernos-*` bundles.

## MCP entry (`cordis.patch.yml`)

Inserts a `composio` entry of `@deepseek-ai/dsh-mcp-client`: streamable-http to
`https://connect.composio.dev/mcp`, header `x-consumer-api-key` from `process.env.COMPOSIO_API_KEY`, 180 s
tool timeout, `failOnStartupError: false`, up to 10 reconnects. Without a key it fails quietly.

## Host routes

| Route | Behaviour |
| --- | --- |
| `GET /kybernos/composio/catalog` | the `catalog.js` array (100 apps, 99 SVG logos, about 400 KB), ETag, `max-age=3600` |
| `GET /kybernos/composio/connections?toolkits=a,b` | read-only; up to 40 slugs; with none it scans the account; always 200 with `configured`, `stale`, `error`; only `id`, `alias`, `status`, `accountType`, `isDefault` are returned |
| `GET`, `POST`, `DELETE /kybernos/composio/connecteurs[?nom=]` | custom connectors; exact-origin guard, JSON required on `POST` |

A custom connector (name `^[a-z][a-z0-9-]{0,30}$`) is either `streamable-http` (http/https URL) or `stdio`
(absolute executable under `/usr/bin`, `/bin`, `/usr/sbin`, `/sbin`, `/usr/local/{bin,sbin}` or
`/opt/homebrew/{bin,sbin}`; at most 8 arguments of 200 characters; no line break in arguments, cwd, env or
headers). It becomes active after the next DSH start.

## Files, settings, environment

All paths use the home directory (`$DSH_HOME` is not honoured) and profile `web`:

- `~/.dsh/.env`: reads `COMPOSIO_API_KEY` (fallback when the credentials service is missing or fails);
  writes `NAME=value` lines for secrets typed in the connector form (the value is written as is, and a
  value holding a line break is refused with a 400 before anything is written).
- `~/.dsh/kybernos/connecteurs.json`: the connectors list (written).
- `~/.dsh/profiles/web/cordis.patch.yml`: marked blocks `# connecteur:<name>` are added and removed (written).
- Browser storage: `composio.apiKey`, `composio.mode`, `composio.authLinks` (10 min TTL),
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
node test-host.mjs     # 57 checks, temp HOME
node test-client.mjs   # 81 checks, no browser
```

`test-host.mjs` covers only the connectors route: hostile origin, non-JSON content type, command path rules,
YAML injection through arguments, env and header names or values, argument limits, nothing written on a
refusal, and the secrets written to `.env` (`$&`, `$$`, `` $` ``, `$'` kept as typed; a line break refused;
all in the temp HOME). Two of those checks only assert "not a command-validation 400" and answer 500 in the
sandbox (no profile folder). `test-client.mjs` loads `client.js` with a fake module loader and reaches two
pure parts through the `composio` export (`webUrl`, `carteHtml`): which card action URLs become a link, the
stored authorization link, and a scan of the embedded logos for active content. The catalog and connections
routes, key resolution, the MCP calls and the React page have no test.
Regenerate the catalog with `KYBERNOS_REPO=<cloud repo checkout> node scripts/build-catalog.mjs`
(`scripts/inject-catalog.mjs` is an obsolete guard that writes nothing).

## Known limits

- The key lives twice: in the browser for this UI, and in `~/.dsh/.env` for the agents (copied by hand,
  then DSH restarted, as the panel says).
- `catalog` and `connections` have no `Origin` check; only `connecteurs` does.
- The local catalog is 100 apps; "Load the full catalog" fetches the rest of the names from the Kybernos proxy.
- UI strings exist in French and English only; French is the default.
