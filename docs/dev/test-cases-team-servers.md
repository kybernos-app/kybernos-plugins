# Test cases: Select server (open half) and the Team console page

Written and run on 2026-10-05. Every case says what is proven, where it runs, and how it last went. « Auto » runs in CI with no
account and no DSH (`packages/*/test*.mjs`). « Live » drives a real GUI with `scripts/live-page.mjs` and is run by hand
(`docs/dev/live-testing.md`). A case with no automated home says so: those are the gaps, listed at the end.

How to run everything of this page:

```bash
for t in packages/*/test*.mjs; do (cd "$(dirname "$t")" && node "$(basename "$t")") || exit 1; done    # what CI does
node scripts/check-server-real.mjs                                 # live, READ-ONLY, the running host: the open server route
node scripts/check-team-live.mjs --console-file <workspace-console.html>   # the console page you are editing (needs its address given)
```

The Servers page has its own cases, SRV-01 to SRV-21, in `docs/dev/servers-page-spec.md` (§ 8).

## A. The Team relay (host route, broker, console): retired

The relay route (`GET /kybernos-cloud/relay`), the page-side broker that answered the console's iframe, the key hand-off route (`/kybernos/ws-console-key`) and the
embedded console itself were removed on 2026-10-16 with the read-only account frame (`docs/dev/frame-removal.md`): the account menu opens the app in the browser, so
nothing frames the console in DSH. Cases REL-01, 02, 04 (the allowlist, the route), 06 (the broker), 07 (the key route), 08 to 14 (the console in a host page, the real
host, the deployed API) tested the removed pieces and are gone with them. Two of them pinned something that stays and moved:

| ID | Case | Where | Last run |
|---|---|---|---|
| REL-03 | Strict origin: no Origin and no Referer refused; this server's Origin or Referer allowed (IPv4, localhost, IPv6 loopback); another origin, another port, `null` and `file:` refused; a forged Host header does not help; a request without headers is refused, not a crash | Auto `kybernos-cloud/test-console-link.mjs` (who may ask) | pass |
| REL-05 | The dispatcher applies the strict guard to strict routes (the console link is one) | Auto, same file (drift) | pass |
| REL-15 | The removal itself: no `/kybernos-cloud/relay` route, no `/kybernos/ws-console-key` route or helper, none of the frame's code or messages in the page, and the stand-ins and live scenes that drove them are gone | Auto `scripts/test-frame-removal.mjs`; `test-cloud-host.mjs` (the route table is exact) | pass |

## B. Select server, open half

| ID | Case | Where | Last run |
|---|---|---|---|
| SEL-01 | A profile needs only `api`; `web` and `console` default to the server's OWN host (`<api>/workspace-console`; the old `api.x → x` convention is gone: it pointed at another host); services and name are optional; http only for loopback; a present-but-invalid field refuses the whole profile (no silent fallback); credentials, query, fragment, very long URL, `javascript:`, an id with a slash or upper case, the reserved built-in id are refused; profiles are frozen | Auto `kybernos-cloud/test-server-profile.mjs` | 42/42 |
| SEL-02 | `services.llm`: absent / null = chat goes to the api host (today's behaviour), a URL = that service, `false` = the server has no Kybernos LLM (no chat base) | Auto, same file | pass |
| SEL-03 | The registry: a missing, malformed or array file is « no registry »; valid entries are kept once each; invalid, duplicate and reserved ones are dropped and listed | Auto, same file | pass |
| SEL-04 | The active server: registry choice, built-in by default, an unknown `active` falls back to the built-in server and says so, the environment override wins and carries the other fields, an invalid override is ignored; each server keeps its own connection file, the built-in keeps today's name | Auto, same file | pass |
| SEL-10 | At boot the active server's catalogue is imported: chat goes to its address with its token, only product routes are kept, no other server is called | Auto `kybernos-cloud/test-server-switch.mjs` (four fake servers) | 27/27 |
| SEL-11 | Switching (`POST /server/apply`): the new catalogue, route and credential are the new server's, the old connection file is untouched, one server's token never reaches another, apply is idempotent | Auto, same file | pass |
| SEL-12 | A server with no Kybernos LLM: nothing is requested from it, the previous server's `kybernos` route and credential are removed, its sign-in is kept, a manual sync imports nothing | Auto, same file (fails if the rule is removed: mutation-tested) | pass |
| SEL-13 | A server whose LLM is a separate service: the catalogue is read there and chat goes there, never to a host deduced from the account | Auto, same file | pass |
| SEL-14 | Leaving a server for one this DSH is not signed in to removes the route left behind (fails if the cleanup is removed: mutation-tested) | Auto, same file | pass |
| SEL-15 | An unknown active server and a broken registry fall back to the built-in server, never a crash; each entry says whether this DSH is signed in to it (no token in the answer) | Auto, same file | pass |
| SEL-16 | No server address is hard-coded in the cloud host any more | Auto, same file | pass |
| SEL-17 | The built-in server is the NEW one (`BUILTIN_API`, one place to change at go-live): its web, console, LLM and connections endpoint are its own host, no gateway; an `api` override moves all of them; the old stack is one documented `servers.json` entry (the test reads the doc's block) | Auto `kybernos-cloud/test-server-profile.mjs` | pass |
| SEL-18 | No old-stack hostname in shipped code (`packages/`), the page's and the feedback's fallbacks equal `BUILTIN_API`, every allowlisted exception is used and says why | Auto `scripts/test-no-legacy-hosts.mjs` | pass |
| SEL-19 | A connection recorded for ANOTHER server (an install from before the new server became the default) is set aside, never used: its model route and credential are removed, its token reaches nobody | Auto `kybernos-cloud/test-unplug-host.mjs` | pass |
| SEL-20 | The page's loader: the active server's web address replaces the default; a server that names none, or a malformed one, leaves it; every failure (refused, non-OK, foreign answer, invalid server, no fetch) leaves the defaults and never throws | Auto `kybernos-plugin/test-server-client.mjs` (the loader is cut out of `client.js`) | pass |
| SEL-21 | The shared-page address reads the loaded server, not a literal; the loader asks the server route and nothing else (the console, gateway and workspace it used to carry went with the frame) | Auto, same file | pass |
| SEL-22 | The Settings nav still orders About last and leaves room under the last tab after the « Servers » entries were added | Auto `kybernos-plugin/test-settings-nav.mjs` | 8/8 |
| SEL-30 | The running host serves `GET /kybernos-cloud/server`: the active server, every server with `connected`, one active, no token | Live `check-server-real.mjs` | pass (4 checks) |
| SEL-31 | The route table of the cloud host is exact (`/server`, `/server/apply`, and no `/relay`) | Auto `kybernos-cloud/test-cloud-host.mjs` | pass |

## C. The Team console (private app repo, `apps/app/public/workspace-console.html`)

> **Since the new server became the default**, the console page is the NEW server's own copy (`src/modules/console/console.html` of kybernos-server). DSH no
> longer frames it (2026-10-16, `docs/dev/frame-removal.md`): what stays of `check-team-live.mjs` reads the page given by `--console-url` / `--console-file`. The
> label baseline (`team-console-labels.json`) was captured from the OLD console and must be re-baselined against the current page before the labels check means
> anything again; the cases that ran the console through a relay or against a stand-in gateway are retired with those pieces.

| ID | Case | Where | Last run |
|---|---|---|---|
| CON-01 | No label is silently lost: the 168-label baseline per page, with the approved removals listed | Live `check-team-live` (labels section) | pass, both modes |
| CON-02 | Nothing is wider than its column, on every page and every inner tab | Live `check-team-live` | pass |
| CON-03 | No script error and no `undefined` / `NaN` on any page | Live `check-team-live` | pass |
| CON-05 | Controls and scroll height are measured with one rule (observation, not a threshold): 171 → 101 controls | `check-team-live` observations | recorded |
| CON-06 | DSH-aligned controls (ink pill primary that inverts with the theme, 8 px outline, 12 px grey fields, pill segments, underline tabs, joined KPI strip, flat rows) in the dark and light themes | Manual, screenshots reviewed | reviewed 2026-10-05 |

## Gaps (no automated home yet)

- **Writes** (invites, roles, budgets, whitelist, keys, auto-recharge): not built, so not tested; the console says « Read-only for now ».
- **Names and emails of members**: the main API keeps neither; the console shows ids.
- **Multi-currency billing** (customer per workspace, manual prices): not built.
- **Windows and Linux** path handling of the registry and connection files: only macOS was run.
- **Pairing against a real company server**: only the start and the pending state are covered (a fake server), not a claimed code.
