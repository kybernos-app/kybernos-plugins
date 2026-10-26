# `@local/kybernos-pulse`

Tells you when an automation finished, failed or waits for your approval, without keeping Kybernos in front, and brings you back to Kybernos
with one click. A module of the Kybernos Suite: **off by default**, switched on in Settings › Kybernos Suite (its card says « Active after restart »), then it has its own page, **Settings › Widget**.

## What the user sees

- **A floating window**, always on top of the other windows: a hero line (« 2 things need you »), an *Inbox* (to do / results) and a *Now* tab
  (the runs being followed). Each card has an arrow that brings the Kybernos tab forward and opens the Automations page; a finished run can be
  made *quiet* (no banner for it any more), any card can be dismissed. It is opened from Settings › Widget (« Show it »): the browser wants a click.
- **System banners**, once per event, through the browser's Notification API. Never for what is older than ten minutes (opening a tab does not
  flood you); at most three at once; one tag per event so that two open tabs cannot show it twice. Clicking one brings Kybernos forward.
- **A count** on the tab title and, when Kybernos is installed as an app (Chrome, Edge), on its Dock icon.
- **The Kybernos icon in the Mac menu bar** (next to Wi-Fi), from a small Mac app, `helper/` (see below): the K with the number of things that wait for
  you, a dot (orange: an approval waits, red: a failure, blue: a run is going), and a click lists the automations, newest need first. It works with the
  browser closed and puts up the system banners itself.
- **Settings › Widget**: show or close the window, when to be told (*something needs me*, the default: a failure or an approval waiting;
  *every run*; *never*), the banner and badge switches, the browser permission, the quiet automations.

## What it follows

Only what the Automations scheduler started. Its own record (`tasks.json`, the `history` of each automation) says which runs exist; the
engine's session journal says how each stands (the same events the Automations page reads): `turn/start`, `turn/end` with an error reason when the
turn failed, `approval/asked` and `approval/decided`, `tool/call`. A run that was already over when the module was switched on makes no item
(no flood on the first pass); a run still waiting for an approval does appear. When an approval is answered its card goes away by itself.
Nothing is guessed from the text of an answer.

Not in this version: the model going silent, the computer being busy, skill proposals, the day timeline, the plan and key gauges, the message
and call to Kaby, the orb and the pill. They are in the mockup, not in the code.

## The browser's rules

- The floating window uses **Document Picture-in-Picture**: Chrome, Edge, Brave, Vivaldi, Opera (116+). Safari does not have it, Firefox is not
  something to count on: there, banners and the count still work and the page says so.
- Kybernos must stay **open in a tab** (pinned or reduced is fine). If DSH or the tab stops, the window closes.
- It opens **from a click**, never by itself, and its place is the person's. Closing the tab closes it.
- Banners need the browser's permission, asked once, from the button on the page.
- The orb and the pill are not built. The menu-bar icon is the Mac app below.

## The Mac menu-bar app (`helper/`)

A single small Swift program (no dependency, macOS 13 or later), built on the Mac that uses it:

```bash
bash packages/kybernos-pulse/helper/build.sh --run     # builds "Kybernos Pulse.app" under helper/build/ (signed ad hoc) and opens it
```

- It **only reads** `GET /kybernos-pulse/state` of the local DSH every ten seconds (and when the menu opens), with the header
  `X-Kybernos-Helper: v1; banners=ok|off`. It sends no cookie and writes nothing to DSH: reading an item as read, dismissing it or changing a setting stays
  in the floating window.
- The host answers `helper: { seen, banners }` for 45 seconds after its last read. **Settings › Widget** shows « Running » from it, and while the app
  has the right to post notifications the browser puts no banner up and marks none as shown (the app does, and remembers which, so a restart repeats nothing).
- A banner: once per event, not for what is older than ten minutes, three at most at once; a click opens Kybernos in the browser.
- Options: `--port 3080` (or `KYBERNOS_PORT`), `--lang fr|en` (the Mac's language otherwise), `--selftest state.json` (prints the menu a state would give, no window).
- A click on a row opens `http://127.0.0.1:<port>/` in the default browser. It does not bring an already open Kybernos tab forward, and there is no deep link
  to the Automations page yet.
- Not done: signing with a Developer ID (another Mac needs it), starting at login, a menu that is a panel with the tabs of the floating window.

`test-helper.mjs` keeps the Swift side honest without building it: the fields it decodes exist in a real answer, the header is the one the route reads, it never
writes, and its K is the K of `kbBrandArt`.

## Host routes

Under `/kybernos-pulse/`, served before DSH's own authentication, so each one fences the Host and the origin.

| Route | Does |
|---|---|
| `GET state` | `{ settings, inbox, running, unread, banners, helper }`: the inbox, the runs being followed, which items deserve a banner, whether the Mac menu-bar app is reading |
| `POST settings` | a patch: `level` (`need` \| `every` \| `never`), `banners`, `badge`, `muted` (list), `mute` / `unmute` (one name) |
| `POST inbox` | `{ action: read \| read-all \| dismiss \| banner-shown, id?, ids? }` |

The two writes need a strict same-origin request **and** DSH's signed session cookie (`docs/dev/route-origin-rule.md`): `session-guard.mjs` is the
terminal's code, word for word.

## Files

`<DSH home>/kybernos/pulse/pulse.json` (`0600`): the settings, the inbox (100 items at most) and what the watcher has already seen. Names and
counts of runs only, never the text of an answer. It reads `<DSH home>/kybernos/tasks.json` and the engine's session journals; it writes nothing else.

## Code

| File | Role |
|---|---|
| `pulse-core.mjs` | the pure rules: settings, reading a journal, the watcher's pass, the banners (no disk, no clock) |
| `pulse-host.mjs` | the store, the watcher and the routes, with their I/O handed in |
| `index.js` | the real I/O, the timer (a pass every 15 s), the route cleanup |
| `client.js` | the Settings section, the floating window, the banners, the badge |
| `session-guard.mjs`, `lib-session-test.mjs` | copies of the shared write guard and its test helper |
| `helper/` | the Mac menu-bar app (Swift package, `build.sh`); reads the state route only |

No engine patch. Slot used: `settings.section`.

## Tests

```bash
cd packages/kybernos-pulse && for t in test*.mjs; do node "$t" || exit 1; done
```

`test-core.mjs` (rules and the watcher's pass), `test-host.mjs` (store, watcher on a real folder, routes, `apply` with a missing service),
`test-write-guard.mjs` (each write with no header, a foreign origin, no cookie, a forged cookie, the real pair), `test-client.mjs` (the sentences,
the panel, the page on a stand-in, the window on a fake Picture-in-Picture, the banners and the badge on a fake page).

## Known limits

- A pass looks at the runs fired in the last six hours, at most 20 journals per pass, every 15 seconds: a run that ends is announced within
  about 15 seconds, not instantly.
- A run started by « Run now » that the scheduler does not record in its history is not followed.
- The link on a card opens the Automations page, not that run's page (the page offers no address for a single run yet).
- Not yet checked on a real browser: that the arrow of the floating window really brings the Kybernos tab to the front, that the window can be
  opened again after a reload, the window's minimum size.
