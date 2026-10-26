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
- **Settings › Widget**: show or close the window, when to be told (*something needs me*, the default: a failure or an approval waiting;
  *every run*; *never*), the banner and badge switches, the browser permission, the quiet automations.

## What it follows

Only what the Automations scheduler started. Its own record (`tasks.json`, the `history` of each automation) says which runs exist; the
engine's session journal says how each stands (the same events the Automations page reads): `turn/start`, `turn/end` with an error reason when the
turn failed, `approval/asked` and `approval/decided`, `tool/call`. A run that was already over when the module was switched on makes no item
(no flood on the first pass); a run still waiting for an approval does appear. When an approval is answered its card goes away by itself.
Nothing is guessed from the text of an answer.

Not in this version: the model going silent, the computer being busy, skill proposals, the day timeline, the plan and key gauges, the message
and call to Kaby. They are in the mockup, not in the code.

## The browser's rules

- The floating window uses **Document Picture-in-Picture**: Chrome, Edge, Brave, Vivaldi, Opera (116+). Safari does not have it, Firefox is not
  something to count on: there, banners and the count still work and the page says so.
- Kybernos must stay **open in a tab** (pinned or reduced is fine). If DSH or the tab stops, the window closes.
- It opens **from a click**, never by itself, and its place is the person's. Closing the tab closes it.
- Banners need the browser's permission, asked once, from the button on the page.
- The orb, the pill and a menu-bar icon would need a small native desktop app. Not here.

## Host routes

Under `/kybernos-pulse/`, served before DSH's own authentication, so each one fences the Host and the origin.

| Route | Does |
|---|---|
| `GET state` | `{ settings, inbox, running, unread, banners }`: the inbox, the runs being followed, which items deserve a banner |
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
