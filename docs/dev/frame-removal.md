# Removal of the read-only account frame (WP-24, decision D7 of the 2026-10-16 audit)

DSH used to draw the server's console in its content zone: an iframe (Team settings, Account, Referral), answered by a page-side broker, fed by a host relay
route that held the device token and by a second route that handed it an admin key. Since `034fb3c` the account menu opens the app **in the browser**, signed
in (the console link, ADR 0054 of the server: `/account#<page>&ws=<team>`, never frameable: CSP `frame-ancestors 'none'`). Nothing in the menu refers to the frame
any more, and every change in it sent the person to the browser anyway. The owner decided to remove it (dead code, AGENTS rule 3), **only what is proven dead**.

The proof is below: for each piece, who calls it (grep over `packages/`, `scripts/`, `services/`, `docs/`; the route audit `node scripts/audit-routes.mjs --table` for the
host routes) and the verdict. `scripts/test-frame-removal.mjs` pins the absence (it fails on the tree before this change: 17 checks).

## The pieces, their callers, the verdict

| # | Piece | Where | Callers found | Verdict |
|---|---|---|---|---|
| 1 | The iframe component `KbWsConsole` (theme sync, key post, reachability probe, retry card, « Open in browser » card) | `kybernos-plugin/client.js` (the brief placed it in kybernos-cloud: the cloud bundle has no frame code, it only called the core's bridge until `034fb3c`) | `KbWsConsoleMain` only | **dead**, deleted |
| 2 | `KbWsConsoleMain`, the `wsconsole` view of `KybersMain`, the `wsPage` store field, the `.kbwsif*` styles | same | reachable only through the bridge (3) | **dead**, deleted |
| 3 | The bridge `window.__kbOpenWsConsole` (`kbOuvrirWsConsole`, `KB_WS_CONSOLE_VIEW`) | same | no bundle (`kybernos-cloud` pins its absence: `test-cloud-client.mjs`); only `check-footer-live.mjs` (frame scenes) and `check-team-live.mjs` (menu section) | **dead**, deleted with both scenes |
| 4 | The postMessage broker (`kbApi`, `kbSwitchSpace`, `kbNewSpace`, `kbOpenBrowser`, `kbConsoleReady`, `kbConsoleKey`, `kbConsoleTheme` and their replies) | same, inside `KbWsConsole` | heard only the console's own iframe at its exact origin | **dead**, deleted |
| 5 | « The frame follows the active workspace » (`fix/embed-follows-active-space`): `frameIdentity`, `seenServer`, the focus / visibility / event effect, the `ws` of the console address | same | the frame only | **dead**, deleted |
| 6 | The events `kybernos-cloud:server-changed` and `kybernos-cloud:space-changed` | listeners in the frame (5) and in `kybernos-cloud/client.js` (the Cloud card and the Kybernos section) | `server-changed`: **no dispatcher anywhere**. `space-changed`: one dispatcher, the broker (4) | **dead**, the two listeners of the cloud client deleted |
| 7 | The address builders (`kbWsConsole`, `kbWsOrigin`, `kbConsoleUrl`, `kbConsolePage`, `kbConsoleDark`, `kbConsoleLang`, `kbWsCfg`, `kbDevOverrides` and the `kybernos.dev` / `kybernos.ws.*` overrides) | same | the frame only (the overrides were read only for the console and the gateway) | **dead**, deleted |
| 8 | The dictionary entries `kbui.ws.*` (11) | same | seven read by the frame; `title`, `sub`, `row.d`, `open` were already read by nothing. No pack, no other file names them | **dead**, deleted |
| 9 | `kbServer` fields `api`, `name`, `console`, `gateway`, `workspace`, `computer` and the `/kybernos-cloud/status` read of `kbServerLoad` | same | the frame only. `kbServer.web` has five live readers (four public share links, the referral / account page address) | fields **dead**, deleted; `web` **kept**, the loader now reads `/kybernos-cloud/server` alone |
| 10 | Host route `GET /kybernos-cloud/relay`, `relayRoute`, `relayCheck`, `relayRules`, `RELAY_RULES`, `RELAY_ALLOW_*`, the helpers `RELAY_DATE`, `RELAY_UUID`, `relayInt`, `relayUuid`, their exports | `kybernos-cloud/index.js` | the broker (4); scripts `check-relay-real`, `check-footer-live`, `check-team-live`, `lib-fake-relay-host`; no other bundle (the phone link's « relay » is its own) | **dead**, deleted (about 100 lines) |
| 11 | Kept in the same block: `UUID_SRC` and `sameOriginStrict` | same | `UUID_SRC`: the console link and the active-space check. `sameOriginStrict`: the dispatcher guards 17 `strict` routes (console link, plans, quote, billing, turns, the Kaby and computer actions, instructions write) | **live**, kept; their tests moved to `test-console-link.mjs` |
| 12 | Host route `GET /kybernos/ws-console-key` and `ws-console-key.mjs` (`wsConsoleKeyReply`) | `kybernos-plugin/index.js` | the frame (key post) and `check-team-live` | **dead**, deleted |
| 13 | The setting `wsAdminKey` of `<DSH home>/kybernos/settings.json` | the settings file | nothing reads it now; `kybernos-auto` and `kybernos-sessions` keep unknown keys when they save (their tests pin that) | **kept as data** (never deleted from a person's file); no reader |
| 14 | `/kybernos-cloud/space/active`, `/space/create`, `/console/link` | `kybernos-cloud/index.js` | the Cloud card's team switcher (`callLocal('/space/active')`, `callLocal('/space/create')`) and the account menu (`ouvrirAppli`, `POST /console/link`). The route audit lists only `lib-fake-relay-host` for the first two because it does not read `callLocal` | **live**, kept |
| 15 | The `computer` flag of `GET /kybernos-cloud/server` and `services/computer-image/patch-console.mjs` (+ its Dockerfile line) | host, image | the cloud computer image is built from the release tag `KB_REF` (v1.0.0-beta.8), whose page still frames the console; the patch makes it say « open in your browser » on a computer. The host `index.js` of this checkout is copied over the release's | **still used by the image**, kept; the patch exits 0 untouched when the page has no frame (pinned by the test); both go the day `KB_REF` moves to a release without the frame |
| 16 | The profile fields `console` and `services.gateway` (`server-profile.mjs`, `docs/dev/servers.md`) | host | the registry format users write by hand, validated and returned by `/kybernos-cloud/server`; the page reads neither now | **kept** (schema, and the image's older page); decision below |
| 17 | `test-relay.mjs` | `kybernos-cloud` | the relay | deleted; its `sameOriginStrict` checks and the dispatcher drift check moved to `test-console-link.mjs` |
| 18 | `test-console-broker.mjs`, `test-frame-follows-space.mjs`, `test-ws-console-key.mjs`, `ws-console-key.mjs` | `kybernos-plugin` | the broker, the follow-the-space code, the key route | deleted |
| 19 | `test-server-client.mjs` (the loader, the console address, the overrides) | `kybernos-plugin` | the loader (kept) and the console (dead) | **rewritten** for the web address only |
| 20 | `test-cloud-client.mjs` « frame half » | `kybernos-cloud` | nothing left of it: `034fb3c` already turned it into the checks that the menu has **no** bridge and opens the console link | kept as is (they pin the absence in the cloud client) |
| 21 | `test-cloud-host.mjs`: `/kybernos-cloud/relay` in the expected route list | `kybernos-cloud` | the table is asserted exact (`routes.size`) | entry removed, one explicit assertion added |
| 22 | `test-no-legacy-hosts.mjs`: the shape of `kbServer` | `scripts` | the loader | updated (`{ web: KB_BUILTIN_API }`) |
| 23 | `lib-fake-relay-host.mjs` | `scripts` | `check-team-live` only | deleted |
| 24 | `lib-fake-team-gateway.mjs` | `scripts` | `check-team-live` (bridge section) and `lib-fake-relay-host` | deleted |
| 25 | `check-relay-real.mjs` | `scripts` | nobody; READ-ONLY smoke of the relay on the real host | relay half **dead**; its `GET /kybernos-cloud/server` half is live, so the file became `check-server-real.mjs` (SEL-30) |
| 26 | `check-team-live.mjs`: the menu / iframe / key section, the data-bridge section, the relay section | `scripts` | the frame, the gateway key mode, the relay | **dead**, deleted |
| 27 | `check-team-live.mjs`: « console » (every page of the hosted console) and « labels », with `team-console-labels.json` | `scripts` | no caller in this repo: they read the **server's** console page, now loaded by address (`--console-url` / `--console-file`) | **kept**, decision below |
| 28 | `check-footer-live.mjs`: the scenes « The core's embedded console », « The frame's account pages », « The frame's team pages », the stand-in consoles, the registry helpers, the relay recorder | `scripts` | the frame | **dead**, deleted; the scenes of the menu (the three entries, Upgrade, a server that does not answer, 390 px, the Kybernos section, Remote control) are untouched |
| 29 | Docs: `live-testing.md`, `test-cases-team-servers.md`, `servers.md`, the READMEs of `kybernos-cloud` and `kybernos-plugin`, `route-origin-rule.md` | `docs/`, `packages/` | the pieces above | updated (REL-01..14 and CON-04/07/08/09 retired, REL-15 added) |
| 30 | `help.json` of every bundle, the Suite catalogue description of `kybernos-cloud` (`scripts/build-catalog.mjs`) | | grep: none mentions the frame, the relay or the console | nothing to change |

## What the route audit says

`node scripts/audit-routes.mjs`: 388 routes before, **386** after (183 answer GET, 11 of them strict instead of 13). `/kybernos-cloud/relay` (GET, strict) and
`/kybernos/ws-console-key` (GET, strict) are gone from the table; no write route is concerned. DSH's web server answers 404 for a path nobody registers;
`scripts/test-frame-removal.mjs` mounts every bundle's routes through the audit and checks that neither path is in the table.

## Numbers

28 files touched; **2,173 lines deleted, 345 added** (the added ones are this note, the absence test, the smaller loader test, the renamed smoke script, the moved strict-origin checks and the
rewritten doc passages). Of the deleted lines: **527 are shipped code** (the page 375, the two hosts 108, the key helper 32, the cloud client 12), 643 are four whole test files, 64 more are the
loader test's, 798 are scripts (the live scenes and the stand-ins), 134 are docs. Seven files are deleted outright (`ws-console-key.mjs` and its test, the broker test, the follow-the-space test,
`test-relay.mjs`, the two stand-in libraries); `check-relay-real.mjs` became `check-server-real.mjs`.

## Verification

- `scripts/test-frame-removal.mjs` (new, in CI with the other `scripts/test-*.mjs`): the files are gone, the routes are not mounted (cloud host table, core host source, the route audit's
  table), the page names none of the frame's messages, helpers, routes or events, nothing in `packages/` or `scripts/` names the removed routes or the bridge, the image patch is
  harmless on a page without the frame. It fails on the tree before this change.
- Every test file of CI's two loops (`scripts/test-*.mjs`, `packages/*/test*.mjs`: 326 files) passes, and so do the repository gates (`garde-depot`, `test-lifecycle-engine`, `test-paquet`).
- `scripts/check-footer-live.mjs` in an isolated sandbox (own `DSH_HOME`, own port): **156 checks pass, none fails, none skipped**. It counted 189 before; the 33 that went are the frame
  scenes' (the console stand-ins, the account pages' and the team pages' relay reads, the follow-the-server and override checks). The scene « Team settings, Account and Referral — the app,
  in the browser », the keyboard scenes, Upgrade, a server that does not answer, 390 px, the Kybernos section and Remote control are all in the 156.
- The sandbox host answers **404** for `/kybernos-cloud/relay` and `/kybernos/ws-console-key`, exactly like a path nobody registered, and 200 for `/kybernos-cloud/server` (read-only probe).
- `scripts/check-cloud-menu-live.mjs` exits 3 in the sandbox (« not run »): it needs a connected account, which a sandbox does not have. Not run, so not claimed: its
  « no Open the console entry » and workspace-switcher wording checks (the footer check's connected scenes do assert the menu's skeleton, Team settings, Account and Referral).

## Left for the owner

1. **`check-team-live.mjs` « console » and « labels » sections and `team-console-labels.json`** read the server's console page (given by address). DSH does not frame it any more and nothing
   in this repo calls the script. Kept because they are not provably dead; if the server no longer serves `/workspace-console`, delete the three.
2. **The profile fields `console` and `services.gateway`** (`servers.json`) are read by no page of this checkout. They are the registry's documented format and the image's older page still
   reads them: remove them from `server-profile.mjs` and `servers.md` together with `patch-console.mjs` when the image moves to a release without the frame.
3. **`kbServer.web` is read once, at page load** (the frame used to refresh it whenever it was open). A server switch while the page stays up leaves the share-link address of the first load until
   the next load; the account menu is not affected (the host reads the active server for the console link).
