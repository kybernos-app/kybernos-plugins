# Kaby mode: what the app's shell has to do

Status: built in `kybernos-mobile` (browser half `client.js`, host half `index.js`, the list in `kaby-mode.mjs`), tested in `test-kaby-mode.mjs` and, on a real DSH at 390 px, in `scripts/check-kaby-mode-live.mjs`. The shell (the React Native app) is not in this repository: this page is what it must do. Nothing here is verified on a device.

« Kaby mode » (the **Simple** preset) is the phone app showing DSH as **Kaby's conversation, opened directly, inside the full app's own screens**: the phone's drawer, the account menu the avatar opens and Settings, each filtered by the locked « Simple » preset of the Theme plugin (`window.__KB_THEME_LOCKED__.get('locked-simple')`, read by the Kybernos plugin). There is no second app: the page draws no menu, no settings sheet and no page of its own (the owner's rule, 2026-11-22: « l'app simple est un preset de l'app complète »), only the chip that says who answers and the connection card. If the preset cannot be read, Simple shows the full app's drawer, account menu and Settings **unfiltered**. The shell switches it on; it does not depend on where DSH runs (a cloud computer, the person's own computer through the phone link, or an engine on the phone). Without the switch the full app is exactly as it was.

## 1. The switch

The WebView's user agent ends with the app's own token, then the Kaby one:

```
KybernosHost/<app version> (ios|android) KabyMode/<n>
```

- `<n>` is the contract version the shell speaks, from `1`. This build speaks `1`: a shell that says `3` is served as `1` (the page tells it so in `kaby-ready`, field `modeVersion`).
- No token, `KabyMode/0`, a browser that carries the words but not the app's own token: **not** Kaby mode.
- Set it when the WebView is created and do not change it afterwards (the page tests it at load, in the page head already, so that the first paint is Kaby's).
- The same token works against any DSH 0.2.2-rc.1 that has `kybernos-mobile` ≥ 0.4.0; an older bundle ignores it (the full app shows).

### 1b. What the shell can open: `KybernosCaps/<list>` (the phone connection only)

A second token, separate from `KybernosHost/<v>`, is appended last by the shell to the user agent of the **phone connection's WebView** (the full app). The Kaby-mode WebView (the cloud computer) does **not** carry it:

```
phone connection:  KybernosHost/<app version> (ios|android) KybernosCaps/where,account,plans
Kaby mode:         KybernosHost/<app version> (ios|android) KabyMode/<n>
```

- The list is comma-separated, lower case, a fixed-order subset of `where,account,plans,referral,signout,mode,signin` (`referral` and `signout` are the app's later names, 2026-11-08; `mode` is the switch of section 9, 2026-11-20; `signin` is the sign-in door of section 1c, 2026-11-23): `where` only if the build has a server; `account`, `plans`, `referral` and `signout` only if the build has a server **and** an account on the phone; `signin` only if the build has a server and **no** account on the phone (section 1c). No token at all when the list is empty. It is set when the WebView is made, so it is constant for the page's life. (The app's older links `kybernos://settings` and `kybernos://log` need no entry.) A name the page does not know is ignored.
- The page draws an entry **only when the list names it**, and opens it as a link: `kybernos://account`, `kybernos://plans`, `kybernos://where` (and `kybernos://settings`, `kybernos://log` as before). A link cannot be probed, so a page that drew an entry the shell cannot open would show a button that does nothing: that is why the list exists.
- The app's avatar opens the web's account menu as a bottom sheet (page half, `kybernos-mobile`). Its rows **Account**, **Referral** and **Sign out** open `kybernos://account`, `kybernos://referral` and `kybernos://signout` when (and only when) the list names `account`, `referral`, `signout`; without the name the row keeps the web's act (a browser link for Account and Referral, the plugin's own sign-out).
- `account` listed: the shell has its own account door (the avatar), so the page **hides the drawer's own account block** (name, plan, menu with Account, Referral, Settings, Appearance, Sign out). Not listed: the block stays, as before.
- `where` listed: the page may draw the « where Kybernos runs » row (it only opens the link; the choice itself is the shell's). Not listed: no such row. Since step 6 the pill under the chat title is drawn only when the connection is a cloud one (`KybernosPlace/cloud`): the phone's own connection has one place, and the web's own execution-environment control in the composer does the job there. Nothing here draws a plan, a credit bar or a buying path.
- **Kaby mode has no token of its own.** What the shell has for the cards of « Settings › About » (the app's parts; the page « The Kybernos app » they were on is gone from Simple's list, item 28) is told by `shell-state` and `open-screen` (declared screens, section 5), as before. Since the page is now the phone's own drawer and account menu, the rules above also run in Simple **when the user agent carries `KybernosCaps`**: the phone connection's WebView does (the shell adds the list to the Simple user agent too), so there the drawer's account block is hidden and the avatar menu's Account, Referral and Sign out open the app's screens. A cloud connection's WebView that carries no list keeps the web's act on those rows (a browser link, the plugin's sign-out): the native screens stay one tap away on « Settings › About » (`open-screen`). **Open for the shell: declare the same list on the cloud connection's Simple user agent if the avatar's rows should open the native screens there too.**

### 1c. The sign-in door: `kybernos://signin` and `signin` in `KybernosCaps` (2026-11-23, page half built, shell half to build)

For a phone with **no account** (« this phone only »: the small model on the phone answers, nobody is signed in), the page needs one way to ask the shell for its own sign-in screen. It is a link of the same family as `kybernos://account`, `plans`, `where`, `referral` and `signout`:

```
kybernos://signin        no parameters
KybernosCaps/…,signin    listed when the build has a server AND no account is signed in on the phone
```

- **What the shell does.** It opens its own sign-in screen over the app: the same two steps as the first-run gate (e-mail, then the code), **with a Back** that returns to the page exactly as it was (the page stays loaded under it; the page cannot tell a Back from a sign-in that did not finish). Nothing is passed to it and nothing is answered: when the person signs in, the shell does the handover it already does (`handOverAccount`) and the page reloads once, as for any new account.
- **What the page does.** It calls `window.location.assign('kybernos://signin')` **only when `signin` is listed**; when it is not, it keeps exactly what it did before (the web's device-code card: the signed-out account menu's « Sign in » row, the padlock sheet's « Sign in », the model picker's « Sign in for more models » opening the Models page of Settings). Three places use it today: the footer of `kybernos-cloud` (the account menu's « Sign in » row, and the sheet of a padlocked drawer row, section 1d) and the model seat's line of `kybernos-plugin`. A link cannot be probed, so a page that offered it without the name would show a button that does nothing: that is why the name exists.
- **Constant for the page's life, and harmless when stale.** Like the rest of the list it is set when the WebView is made. The page offers the door only where nobody is signed in (the rows above do not exist for a signed-in person), so a list that still says `signin` after a sign-in does nothing; a list that lacks it after a sign-out falls back to the device-code card. A shell that rebuilds its WebView when the account changes gets the exact behaviour.
- **What the shell may reuse.** Its add-account screen (`AddAccountScreen`, which already has a first-run mode and a Back), opened with a one-step stack so a single Back closes it and gives the page back (not through an empty accounts list). That is the shell's choice; the page only needs the three things above.

### 1d. Padlocks on the signed-out phone (2026-11-23, page half built)

Nothing for the shell to build. While the page knows nobody is signed in (`kybernos-cloud`'s footer reads `/kybernos-cloud/status`) **and** the app is in Kaby mode, the rows of the drawer that the locked Simple preset lists in `options.padlock` (`tasks` = Reminders, `connectors` = Apps) carry a padlock and a tap on one opens a one-sentence sheet (« Reminders need an account » / « Apps need an account », « Sign in », « Not now ») instead of the page. The preset says which rows (`window.__KB_THEME_LOCKED__.options('locked-simple').padlock`, a deep copy); signed in, no list, or an unreadable preset = the drawer is the full app's.

## 2. What the shell must do (the list)

1. Set the user agent (section 1).
2. Listen to `onMessage` and answer `kaby-ready` with `shell-state` (section 3). Until it answers, the page treats every capability as absent and says so in words (no button that would do nothing).
3. Open an authorization address in the **system browser sheet** (section 4), never in the WebView itself: Google refuses embedded web views.
4. Handle **new windows** (section 6): `window.open` and `target="_blank"` open `https:` addresses in the system browser; they never replace the DSH page.
5. Open the four native screens when asked (`open-screen`, section 5).
6. Own the notification permission and what a notification says (section 7).
7. Keep the WebView alive and reachable while the app is in the background as long as it can (a running turn, a waiting approval); nothing in the page assumes it.

## 3. The messages

Page → shell: `window.ReactNativeWebView.postMessage(JSON.stringify(message))`. Shell → page: `webview.injectJavaScript('window.__KB_APP__ && window.__KB_APP__.receive(' + JSON.stringify(message) + '); true')`. Every message is `{ "kybernos": <type>, "version": 1, … }`. The page never throws on what it receives, answers `false` to anything it does not understand (wrong type, unknown id, unknown state, more than 8 KB), and never acts on a message that is not an answer to something it asked, except `shell-state` and `notifications-state`.

Page → shell:

| type | when | fields |
|---|---|---|
| `kaby-ready` | once, when the page has mounted Kaby mode | `mode: "kaby"`, `modeVersion`, `platform`, `appVersion` |
| `open-screen` | the person taps « My account », « My plan », « Help », « Where Kybernos runs » or « Open your phone's settings » | `screen`: `account` \| `plan` \| `help` \| `where` \| `notification-settings` (only a screen the shell declared) |
| `authorize` | the person taps « Connect » on « Kaby wants to connect X » | `id` (string, ours), `url` (https, or http on a loopback address), `app` (the app's slug), `name` (optional label) |
| `set-mode` | the person taps « Switch to Advanced » (« Need more? » in the app's parts of Settings › About) or « Switch to Simple » (Settings › The Kybernos app); **only when the shell declared `mode`** (section 9) | `mode`: `simple` \| `advanced` |
| `notifications-ask` | the first approval card of a load, or a reply that finished while the person was away, or the person's tap on « Turn on » | `id`, `why`: `approval` \| `reply` \| `settings` — **nothing else**: no text of the conversation, no name, no title |

The old `{ kybernos: "app-entry", entry: "settings", version: 1 }` is still sent once, after `kaby-ready`, for a shell that waits for it (a shell that drops its own fallback gear on that message keeps dropping it). **The page no longer draws a gear of its own in Simple**: Settings is the avatar → account menu → Settings, the real dialog filtered by the preset (nine pages).

Shell → page:

| type | when | fields |
|---|---|---|
| `shell-state` | after `kaby-ready`, and again whenever it changes | `capabilities`: `{ authorize: bool, notifications: bool, mode: bool, screens: [..] }` (`mode`: the shell can switch to Advanced, section 9; absent or false = the page draws no switch line) (screens the shell can open, from the list above); `notifications`: `granted` \| `denied` \| `undetermined` \| `unavailable`; `connection`: `cloud` \| `remote` \| `local` (where this DSH runs: a cloud computer, the person's own computer through the phone link, the engine on the phone) |
| `authorize-result` | the sheet is gone | `id` (the `authorize` message's), `state`: `returned` \| `dismissed` \| `failed` \| `unsupported` |
| `notifications-state` | after a `notifications-ask`, or when the permission changes | `state`: as above |

`window.__KB_APP__` (the seam for the other bundles) keeps `version, platform, appVersion, openSettings, openLog` as before and adds `mode: "kaby"`, `modeVersion`, `receive(message) → boolean`, `shell()`, `requestConnect({ toolkit, name })`, `askNotifications(why)`. `openSettings()` without an argument is the app's own settings link as before; `openSettings('account')` asks the shell for that screen.

## 4. Connecting an app (« Kaby wants to connect Gmail »)

How connectors authorize today (read in `kybernos-cloud` and `kybernos-composio`): the cloud half asks the server, `POST /kybernos-cloud/connections/link {toolkit}` → `{ redirectUrl, connection: { id, status: "pending" } }`; the page used to `window.open(redirectUrl)` in a tab; the person signs in on the provider's page; the server's own callback marks the connection `active`; the page learns it by asking `GET /kybernos-cloud/connections/item?id=…`. Through the phone link the route refuses (403 `refused_on_phone`, the session guard: it is done from the computer), and the own-key path (Composio) needs a key typed on a computer.

In Kaby mode, in order:

1. A request is only a card in « asking »: it comes from the page (`__KB_APP__.requestConnect`, or the window event `kb-connect-request` with `detail: { toolkit, name }`, for a bundle that has no handle on the seam). **Nothing leaves the phone until the person taps « Connect »**, and « Not now » sends nothing.
2. On « Connect »: if the shell did not declare `authorize`, the card says to update the app, and the server is not asked (no connection is started that nobody could finish). Otherwise the page asks the cloud half for the address.
3. The page posts `authorize`. The shell opens `url` in `ASWebAuthenticationSession` (iOS) or Custom Tabs (Android) and answers `authorize-result`: `returned` (the sheet came back to the app), `dismissed` (the person closed it), `failed` (it could not open), `unsupported`.
4. On `returned` or `dismissed` the page asks the server (`connections/item`, every 3 s, 40 times at most, then « not yet » with « Check again »). **Only the server's word** `active` makes the card say « connected »: the sheet's word proves nothing.
5. « Cancel » or « Not now » while a connection is pending removes the pending connection (unless the server says it became active), so it does not count against the plan.

The page refuses any `url` that is not `https:` (or `http:` on `127.0.0.1`, `localhost`, `[::1]`, for a test double) and any `authorize-result` for an id it did not ask.

Open, on the server side (not built here): the callback page that follows the provider's consent should end by sending the sheet back to the app (a `kybernos://connected` redirect, or a universal link) so that `returned` is not only a guess; without it the person closes the sheet by hand and the page finds out by asking (step 4), which works.

Open, on the producer side: nothing in Kaby's tools asks for a connection yet (`connections_list` only reads; the `connector-ask` card of `kybernos-cloud` is for a tool the connected app offers). The proposal is a host tool `connections_request({ toolkit })` that dispatches `kb-connect-request` to the page, on the same pattern as `connector-ask`; the card and the flow are ready for it.

## 5. The native screens

`account`, `plan`, `help`, `where`, `notification-settings`. The shell declares the ones it has; the cards of « Settings › About » show a button only for a declared screen and say plainly when none is (« this version cannot open it from here yet »). Account and plan are never opened by a web page in Kaby mode (see section 6).

## 6. The new-window problem

DSH and the bundles open windows with `window.open(url, '_blank')` and `target="_blank"` links (answers' links, help, billing). A WebView drops them or, worse, replaces the page. What the shell does: intercept every new-window request, open `https:` addresses in the system browser, ignore anything else (`javascript:`, `file:`, `data:`, an unknown scheme), never load it in the DSH view.

The three entries the owner named:

- **Account**, **Team settings**, **Referral**: all go through `POST /kybernos-cloud/console/link { section, workspace_id?, open: true }`. With `open: true` the **host** (the process DSH runs in) opens the system browser **on its own machine** and answers `opened: true`; when it cannot, it answers `opened: false` with the address and the page falls back on `window.open`. So, on a cloud computer (no display) the address comes back and the shell handles the new window; on **the person's own computer through the phone link the browser opens on the computer, not on the phone** (and the person sees nothing), (the console-link route is a POST: the session guard refuses a write through the phone link unless the route declares it only reads, which was not checked for this one); on the engine on the phone there is no opener, so the address comes back.
- Simple therefore does not use them: « Account and plan » on « Settings › About » sends `open-screen` (`account`, `plan`, `where`), which the shell shows in its own screens, and Referral opens `kybernos://referral`; the avatar's menu rows do the same when the user agent lists the capability (section 1b). Team settings has no entry in Simple (the preset hides it).
- Still reachable in Kaby mode and still using the console link: the « No model » / quota notice's sign-in and top-up buttons (`openConsole`). The shell's new-window handler covers the cloud and phone cases; the own-computer case is a gap to decide (proposal: in Kaby mode, route that button to `open-screen` `plan` / `account` too).

## 7. Notifications

- The page asks the shell with `notifications-ask`: on the first approval card of a page load (DSH's own card, hook `[data-slot*="approval"]`, or the connection card), on the first reply that finishes while the page was hidden (or the person has just come back after more than 3 s away), and on the person's tap on « Turn on ». The two automatic reasons ask at most once per load and only while the shell reports `undetermined`; the tap always goes through. The page keeps nothing (no storage): the shell holds the permission and is the one that must rate-limit (a shell that is asked twice for an undecided permission asks the system once).
- The shell shows the system permission prompt only when the app is active, then answers `notifications-state`.
- The « Notifications » card of « Settings › About » is drawn only when `shell-state` says `capabilities.notifications: true`. A shell that does not handle them gets no card (no line about what the app cannot do yet).
- **A notification never carries anyone's words.** The shell writes it itself from fixed strings by kind (« Kaby needs your answer », « Kaby has answered »): no title of the conversation, no text of the answer, no name of an app or a person, in the payload or on the lock screen. The `notifications-ask` message has no field that could carry any.
- How the shell learns that an approval is waiting while the WebView is suspended is not decided here (it needs a push from the server or a background task); the page only covers the moments it is running.

## 8. Layers: « a layer is open », « close the top one » (the page half is built; the shell half is to build)

A **layer** is whatever the person dismisses with Back without leaving the screen they are on: the menu (the drawer), a sheet or a popover (the model menu, the « + » sheet, the account menu, the « … » sheet), the Settings window, a dialog. **An in-page screen (Reminders = Automations, Apps, Skills…, the views whose `<html data-kbmob-view="page">`) is the lowest layer** (step 6, 2026-11-23): Back leaves it before the app is left. Until now the shell could only guess (it sends an Escape key into the page before « Press back again to exit »; measured: Escape closes the engine's menus and Settings, **not the drawer**, and an in-page screen is not « up »).

Page → shell, in the full app and in Kaby mode (every WebView that carries the `KybernosHost` token), like the other messages:

| type | when | fields |
|---|---|---|
| `layers` | once when the page has mounted (`depth: 0`), then on every change of the number or of the top layer (at most once per frame, never twice the same) | `depth`: 0 to 8, the layers the page can close by itself; `top`: `menu` \| `sheet` \| `settings` \| `dialog` \| `page` (absent when `depth` is 0) |

Shell → page:

| type | when | fields |
|---|---|---|
| `close-layer` | hardware Back, or the edge swipe, while the last `layers` said `depth` > 0 | none |

- `window.__KB_APP__.receive({ kybernos: 'close-layer', version: 1 })` closes the **top** layer and returns `true`; with no layer open it returns `false`. It then sends a new `layers` message. (`__KB_APP__.receive` exists in the full app from this change; in Kaby mode it already did.)
- The shell's rule: `depth` > 0 → send `close-layer` and do nothing else; `depth` = 0, or no `layers` message ever received (an older bundle) → what it does today (its own back, « Press back again to exit »). The page must not need the Escape guess any more; the shell may keep it for older bundles.
- Order, top first: a sheet or popover, a dialog, the Settings window, the menu (the drawer), a page. One `close-layer` closes one layer. The drawer open over a page is `depth: 2, top: "menu"`; a sheet over a page is `depth: 2, top: "sheet"`.
- **The page layer (step 6).** `close-layer` with a page on top leaves that page by ONE level: the page goes to the screen it was opened from (the chat, through the Kaby row of the drawer) and **opens the drawer over it** (`layers {depth: 1, top: "menu"}`). The sequence from « Reminders » is therefore: Back (page) → drawer over the chat; Back → the drawer shuts, `depth: 0`; Back → the shell's « Press back again to exit ». If the drawer was open over the page, the first Back shuts the drawer. The page is really left (the view under the drawer is the chat, `data-kbmob-view` is no longer `page`), so Back never cycles page, drawer, page, drawer. A shell that does not know `page` (a build before this one) drops the whole message and keeps its old behaviour (the exit question from a page).
- Second channel, for a plain browser and for a shell that only calls `webview.goBack()` (`canGoBack` is true while a layer is open): the page pushes **one history entry per open layer** (same address, the router's own state kept, plus a marker) and closes the top layer when that entry is popped. Both channels end in the same function, so they cannot disagree. The message is the one a shell should use (it works on the first page, when the WebView has no history).
- Nothing in either message carries text, a name or an address.
- **Page half, built** (`kybernos-mobile` 0.4.2: `createLayers`, `receiveShell`, `parseCaps` in `packages/kybernos-mobile/client.js`, checked by `test-layers.mjs` and read by hand in the sandbox with a fake `ReactNativeWebView`): it sends `layers`, closes the top layer on `close-layer` and on the system Back, draws the entries of §1b, and lets a sheet of the engine rise over a scrim. What it could not see is in §9.

## 9. The mode switch: Simple and Advanced (page half built 2026-11-20, shell half to build)

One app, two modes of the same engine: **Simple** is Kaby mode (this document), **Advanced** is the full app. A switch changes nothing the person made: same engine, same conversations, same memory, same models.

- **Storage and reload.** The shell keeps the mode in a slot of its own, `kybernos.mode` (`simple` or `advanced`, in the secure store as the theme is), read **when the WebView is made** and turned into the user agent: `simple` adds ` KabyMode/1` (section 1), `advanced` adds no `KabyMode` token. A switch = the shell writes the slot and builds the WebView again with the other user agent (a reload, a few seconds). The page keeps nothing: the web storage belongs to the engine's origin, which changes with its port, and the section 1 rule (the token does not change after the WebView exists) stays.
- **Default.** A fresh install starts in Simple. An app that was already used (the welcome screen seen) stays in Advanced, so a tester sees no change after the update and moves to Simple by hand.
- **Which connection.** The phone connection (the engine on the phone) is the one that switches: its `kabyMode` flag is read from the slot, where it was fixed to false. The cloud connection stays Simple, as it is. The Kaby app of the stores (cloud only, no engine on the phone) never declares `mode` and never offers the switch.
- **What the shell declares, so that the line is only drawn when it can work.** In Advanced (the phone connection's WebView): `mode` in `KybernosCaps/…` (section 1b). In Simple (the Kaby-mode WebView): `capabilities.mode: true` in `shell-state` (section 3). Absent or false: the page draws no line and nothing else changes.
- **What the page sends.** `{ "kybernos": "set-mode", "version": 1, "mode": "simple" | "advanced" }`, from « Settings › The Kybernos app › Simple mode » (Advanced) and « Settings › About › Need more? » (Simple: in the app's parts of About). The shell answers nothing and reloads; an unknown mode, or a shell that did not declare `mode`, is ignored. The page greys the button and says « Switching mode… » until the reload.
- **What the shell does not have to do.** Nothing about the drawer, the account menu, Settings, the reminders or the conversations list, or the model picker (the web app's own, in the composer, since step 6; there is no answer chip any more): they are the page's (the full app's own screens filtered by the locked preset, plus `mode-switch` of `kaby-mode.mjs`).

### 9b. Since 2026-11-24: one mode, resolved by the page, kept per account (the shell's slot becomes a mirror)

The owner's list items 35-37 make the mode **one choice for the whole app** (Simple or Complete, with two effects: the navigation preset and the technical view) that the person can switch from the page, and that follows the account, not the device. The page now owns the choice; the shell's slot is its **mirror**. What changes for the shell:

- **The order the page resolves it in**, once per load, in the page's head, before anything is drawn: (1) the person's explicit choice (`simple` or `complete`); (2) inside the app, the shell's word: ` KabyMode/<n>` in the user agent is Simple, no token is Complete (an app that was used before the switch stays what it was); (3) a touch device is Simple; (4) otherwise Complete. Never re-evaluated while the page lives, and the width of the window is never read (the web on a computer is not a mobile preset).
- **Where the choice is kept.** In the DSH folder of the account (`<dsh home>/kybernos/mobile-mode.json`, `GET|POST /kybernos-mobile/mode`, the newer `at` wins; the POST needs the page's Origin AND DSH's signed browser session, like every write route, so a choice made through the phone link is refused and kept on that device only), with a copy in the page's own storage; the host also puts the stored value in the head, because the phone's engine changes its origin at each start. A server-side preference shared by several DSH folders of one Kybernos account is the server's, not this plugin's (to build later).
- **What the shell keeps doing.** Keep the slot `kybernos.mode` and read it when the WebView is made, exactly as in section 9: it is the answer to « no explicit choice yet » (Auto). The page now sends `set-mode` **after** it has stored the choice, for every change of the **resulting** mode: `advanced` for Complete, `simple` for Simple; for Auto it sends the word Auto means on that device (`simple` inside the app under the shell's own Simple). The shell stores it and rebuilds its WebView, as before. If the shell does not rebuild within 6 seconds the page reloads itself, which is enough because an explicit choice beats the user agent.
- **What does not change.** The token still means « the shell's word », the contract's capabilities (`mode` in `shell-state` or in `KybernosCaps`) still decide whether the page may send `set-mode`, and the host class `kb-kaby` still means « inside the Kaby phone shell »: it is an axis of its own (the host), no longer the mode.
- **Native ask (nothing blocks the page half).** None is required. Optional: when the shell next shows its own mode switch, replace it by a link to the page's sheet (`kybernos://settings` already leads to the page) so that the two never disagree; and give the shell a way to *ask* the page what the account's choice is before it builds the WebView (a cold start under an explicit Complete first builds the Simple WebView, then the page reloads Complete: one extra reload on the first start after a change made on another device).

## 10. What is not verified

The shell side of all of this (the user agent, `injectJavaScript`, `onMessage`, the sheet, the permission prompt, the new-window handler, the background behaviour), the server callback page, a connection finished against a real provider, DSH's real approval card at 390 px (the hook is the engine's own slot name `conversation.approval.card`, read in its source; the live check could not provoke the card in a sandbox), and the dark theme. For §1b and §8 the page half was only run in a desktop browser engine (Chrome) with a fake `ReactNativeWebView` and a user agent set by hand: how WKWebView and the Android WebView treat `pushState`, `history.go(-1)` and `canGoBack`, the real hardware Back, the real `KybernosCaps` token the shell writes, and a tap on an entry opening the shell's own screen are not seen.
