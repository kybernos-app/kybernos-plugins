# Test cases: the Team relay, Select server (open half) and the Team console

Written and run on 2026-10-05. Every case says what is proven, where it runs, and how it last went. « Auto » runs in CI with no
account and no DSH (`packages/*/test*.mjs`). « Live » drives a real GUI with `scripts/live-page.mjs` and is run by hand
(`docs/dev/live-testing.md`). A case with no automated home says so: those are the gaps, listed at the end.

How to run everything of this page:

```bash
for t in packages/*/test*.mjs; do (cd "$(dirname "$t")" && node "$(basename "$t")") || exit 1; done    # what CI does
node scripts/check-relay-real.mjs                                  # live, READ-ONLY, the running host and the deployed API
node scripts/check-team-live.mjs                                   # live, READ-ONLY, the real GUI and the hosted console
node scripts/check-team-live.mjs --console-file <workspace-console.html>   # hermetic: the console you are editing, a stand-in host
```

The paid module has its own cases: `docs/test-cases.md` in the private paid-modules repo.

## A. The Team relay (host route, broker, console)

| ID | Case | Where | Last run |
|---|---|---|---|
| REL-01 | The allowlist accepts exactly `/v1/me`, `/v1/workspaces`, `…/members\|providers\|models`, `…/llm/budget\|models\|catalog\|billing`, `…/llm/usage` (date-only `from`/`to`), for a workspace of this account, case-insensitive uuid | Auto `kybernos-cloud/test-relay.mjs` | 51/51 |
| REL-02 | It refuses: another API route (keys, device pairing, lessons), the LLM keys, a member sub-path, dot segments, an encoded traversal, a protocol-relative or absolute URL, a query on a route that takes none, a foreign parameter, a non-date value, a repeated parameter, an empty / non-string / very long target, a workspace that is not the account's (`espace_inconnu`), a non-uuid id | Auto, same file | pass |
| REL-03 | Strict origin: no Origin and no Referer refused; this server's Origin or Referer allowed (IPv4, localhost, IPv6 loopback); another origin, the console's own origin, another port, `null` and `file:` refused; a forged Host header does not help; a request without headers is refused, not a crash | Auto, same file | pass |
| REL-04 | The route is a strict guarded GET; not connected → no call; an allowed path is called on the main API with the token as `Authorization` only; the answer is `{ ok, status, body }` and carries no token; the page's own headers (cookie, origin) never reach the API; a refused status comes back as `ok:false`, not as success; an off-list path makes no call | Auto, same file | pass |
| REL-05 | The dispatcher applies the strict guard to strict routes; no relay rule names keys, invites, removal, checkout or subscribe | Auto, same file (drift) | pass |
| REL-06 | The broker hears only the console's own iframe at its exact origin, ignores non-objects, forwards a GET with the path URL-encoded and same-origin credentials, answers with the same id to the exact origin (never `*`), refuses POST / missing id / missing path / very long path / object id with no call to the host, and turns an unreachable host into `ok:false, status 0` | Auto `kybernos-plugin/test-console-broker.mjs` (the code is cut out of `client.js`, not copied) | 15/15 |
| REL-07 | The key hand-off route is private: strict origin, 403 to an outside caller with no Origin or a foreign Origin, the console URL carries the gateway and no key | Auto `kybernos-plugin/test-ws-console-key.mjs`; Live `check-team-live` (menu section) | 26/26; pass |
| REL-08 | The console in a host page, no key anywhere: it announces itself, shows live data (team id, name, creation date, plan and balance, members, providers, models, usage, billing), calls no gateway of its own, asks only for allowlisted paths, and asks for what each page needs | Live hermetic `check-team-live --console-file` (relay section; the broker is the shipped one, the allowlist is the real `relayCheck`) | 89 checks in the whole run, 0 failed |
| REL-09 | A write is refused in the console with a plain sentence before it leaves the page; a route with no translation is refused in the page too | Live hermetic, same run | pass |
| REL-10 | Not signed in: the console says « Sign in to Kybernos Cloud in the app » and shows no live data | Live hermetic, same run | pass |
| REL-11 | LLM service down (the relay answers 503): the banner says credits, usage and billing could not be loaded and members are live; the plan is a dash and « Not available right now », no balance of zero, no plan in the sidebar; Usage shows dashes; the Kybernos provider card goes, the team's own provider stays | Live hermetic, same run | pass |
| REL-12 | Members come from the main API by user id: the signed-in person is named from `/v1/me` and marked owner, the others show a short id, no invented name or email; the crumbs name the real workspace; no sample invitation counts as pending | Live hermetic, same run | pass |
| REL-13 | In the REAL DSH, the hosted console reads through the host relay (the page's resource timing shows `/kybernos-cloud/relay` calls) and every path is on the allowlist | Live `check-team-live` (menu section) | 58 checks, 0 failed |
| REL-14 | The RUNNING host has the route, the deployed API has the relay (200, or 503 « not configured », never 404), members have the expected shape, a workspace that is not the account's is refused by the host, no origin / foreign origin → 403, a path off the allowlist and a dot-segment path are refused, the route is GET only | Live `check-relay-real.mjs` (READ-ONLY, prints no id or name) | 19/19 |

Server side of the relay (`/v1/workspaces/{id}/llm/*`, private app repo): 22 Python tests (master key 403, anonymous 401, non-member 404,
billing admin-only, five GET routes, 503 when unconfigured, generic 502/404, the key never returned), run with
`python3 -m unittest core.middleware.test_llm_relay`. 22/22.

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
| SEL-20 | The page's loader: the active server's console, web app and name replace the defaults; a server that names no gateway gets none; every failure (refused, non-OK, foreign answer, invalid server, no fetch) leaves the defaults and never throws | Auto `kybernos-plugin/test-server-client.mjs` (the loader is cut out of `client.js`) | 12/12 |
| SEL-21 | The console, the cloud page and the store read the loaded server, not a literal; opening « Teams settings » asks for the active server before probing its console | Auto, same file | pass |
| SEL-23 | The page's loader also reads the active workspace from `/kybernos-cloud/status`: carried when it is a string, empty when not signed in or malformed; the console URL carries `ws` only then | Auto `kybernos-plugin/test-server-client.mjs` | pass |
| SEL-22 | The Settings nav still orders About last and leaves room under the last tab after the « Servers » entries were added | Auto `kybernos-plugin/test-settings-nav.mjs` | 8/8 |
| SEL-30 | The running host serves `GET /kybernos-cloud/server`: the active server, every server with `connected`, one active, no token | Live `check-relay-real.mjs` | pass (4 checks) |
| SEL-31 | The route table of the cloud host, including `/relay`, `/server`, `/server/apply` | Auto `kybernos-cloud/test-cloud-host.mjs` (it had been red since the relay merge; repaired) | 107/107 |

## C. The Team console (private app repo, `apps/app/public/workspace-console.html`)

> **Since the new server became the default**, the console DSH shows is the NEW server's own copy (`src/modules/console/console.html` of
> kybernos-server, « from now on this is the copy that is kept »), and it reads through the host relay only. These cases were written
> against the old console: run on 2026-10-08 against the new one (`check-team-live.mjs --console-file`, hermetic), 37 checks pass (no
> script error, no overflow, the menu opens the console with the active server's `gw`, empty) and 48 fail, all of them tied to the OLD
> console: the label baseline (`team-console-labels.json`: pages `security`, `access`, `keys`, `providers` and ~70 labels no longer
> exist) and the stand-in hosts (`lib-fake-team-gateway.mjs`, `lib-fake-relay-host.mjs`, the old API's data shapes). They must be
> re-baselined against the new console; the live behaviour of the new console in DSH was checked by hand against the local replica.

| ID | Case | Where | Last run |
|---|---|---|---|
| CON-01 | No label is silently lost: the 168-label baseline per page, with the approved removals listed | Live `check-team-live` (labels section) | pass, both modes |
| CON-02 | Nothing is wider than its column, on every page and every inner tab | Live `check-team-live` | pass |
| CON-03 | No script error and no `undefined` / `NaN` on any page | Live `check-team-live` | pass |
| CON-04 | The data bridge with a key against a stand-in gateway (id, name, date, plan, balance, members and side panel, providers, models, usage, billing) | Live hermetic `check-team-live --console-file` | pass (9 checks) |
| CON-05 | Controls and scroll height are measured with one rule (observation, not a threshold): 171 → 101 controls | `check-team-live` observations | recorded |
| CON-06 | DSH-aligned controls (ink pill primary that inverts with the theme, 8 px outline, 12 px grey fields, pill segments, underline tabs, joined KPI strip, flat rows) in the dark and light themes | Manual, screenshots reviewed | reviewed 2026-10-05 |
| CON-07 | Blocks are bordered like the mockup; the Plan page is: identity row, plan block, credits and auto-recharge side by side (equal top, second one to the right); the members table still fits its column inside a bordered block | Live hermetic `check-team-live --console-file` (relay section + overflow section) | pass |
| CON-08 | The Team Settings page is folded into Plan & Credits (one page less): no `team` page, Plan & Credits first; the workspace ID is a discreet circled « ID » (24 px at most, labelled « Copy workspace ID »), a click copies the full id and says « Workspace ID copied » | Live hermetic, same run; the label baseline lists the page as removed with the owner's approval | pass |
| CON-09 | One workspace selector: inside the app the console's selector only SHOWS the workspace (no menu opens), and with `ws` in the iframe URL the console opens on the workspace the app has active, not on the first one; standalone, the menu is headed « Switch workspace » | Live hermetic, same run; Auto `kybernos-plugin/test-server-client.mjs` (the app carries `ws` only when a workspace is known) | pass |

## Gaps (no automated home yet)

- **The LLM numbers on screen.** On the OLD stack the LLM gateway service (the console's and the relay's upstream) was not served
  anywhere (`/v1/teams/*` answered 404), so the relay answered 503 and REL-11 was the behaviour. The NEW server serves plan, credits,
  usage and billing itself (`/v1/workspaces/{id}/llm/*`); the old stack is now only an opt-in (`docs/dev/servers.md`).
- **Writes** (invites, roles, budgets, whitelist, keys, auto-recharge): not built, so not tested; the console says « Read-only for now ».
- **Names and emails of members**: the main API keeps neither; the console shows ids.
- **The relay from a web page** (not DSH): only the DSH broker exists.
- **Multi-currency billing** (customer per workspace, manual prices): not built.
- **Windows and Linux** path handling of the registry and connection files: only macOS was run.
- **Pairing against a real company server**: only the start and the pending state are covered (a fake server), not a claimed code.
