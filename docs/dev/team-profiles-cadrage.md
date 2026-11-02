# One DSH per team: cadrage (2026-11-02, nothing built)

The owner chose the **complete profile** for a team: memory, connectors, skills, agents, automations and settings follow the team, not only
the model route, billing and work folder (`docs/dev/teams.md` says what the space model covers today).

## Why the space model cannot get there

Every known exposure in `teams.md` (a turn billed to two teams, the deferred switch, the chat that keeps personal memory in its history,
the lost draft) comes from one thing: **one model route and one data folder per DSH instance**. Extending the space model means wiring
each bundle to the active team by hand; a second instance per team separates everything at once.

## Facts measured on 2026-11-02

- A DSH profile (`~/.dsh/profiles/<name>`) is only the set of installed plugins and their config (`web`: 1.0 GB). Our data
  (`~/.dsh/kybernos`, 3.7 GB), the sessions (0.9 GB), skills, mcp and credentials live in the DSH home. `--profile` alone separates nothing
  that matters: it takes a `DSH_HOME` per team.
- The real DSH is 680 MB resident.
- 101 plugin files name `.dsh`; 76 of them read `DSH_HOME`. Sorted: of the other 25, only three really built `<os home>/.dsh` themselves
  (the Claude memory import, the Webapp Creator's apps folder, skills and settings); the rest were comments, display strings, browser code
  or build scripts.
- `scripts/sandbox/` already runs a whole isolated DSH (APFS clone of the profile, own `HOME`/`DSH_HOME`, own port). The recipe exists.

## Design (recommended): one DSH per team, all alive at once

- Personal stays the DSH on :3080, untouched. A team gets its own home (`DSH_HOME`), its own port (remembered), its own cloud state whose
  model route names that team for good. No route rewrite, no switch guard.
- The switch in the account menu becomes "open that team's DSH" (started if it is not running). Nothing restarts: chats and automations of
  every team keep running.
- What follows from it: billing is fixed per instance; the team's own memory, written freely by the agent, lives in its home; personal
  memory is absent from its home (the account's memory on the server stays cut, see step 2); connectors, skills, agents, automations, settings are the team's own. Kaby, Telegram and
  personal scheduled work stay in Personal.
- Cost: about 0.7 GB of memory per running team; the profile clone is cheap at first and grows apart; a plugin update must reach every
  home; a new team needs a first setup (see decision 2).
- Kept for the record: one DSH restarted on another home at each switch. No extra memory, but it interrupts chats and only the active
  team's automations run.

## Steps

0. **Done.** Every server-side bundle honours `DSH_HOME`: the three strays are fixed, each with a behavioural test (`kybernos-memory`,
   `kybernos-webapp-creator`), and `scripts/test-dsh-home.mjs` now scans every runtime file under `packages/` and fails on one that builds
   `<os home>/.dsh` without reading `DSH_HOME`. No change of behaviour when `DSH_HOME` is unset.
1. **Done** (`packages/kybernos-cloud/team-instances.mjs`, three routes `/kybernos-cloud/team-dsh/{open,stop,list}`, README section of the
   bundle): the home is a copy-on-write copy of the personal profile, re-pointed at itself; a team DSH starts on first open on a port it keeps
   (3300-3399), stops itself after 30 minutes with no page, no reply running and no active automation, and the personal DSH never stops.
   Played with a stand-in `dsh` (unit) and with a real one on a sandbox (`scripts/check-team-dsh-live.mjs`: 12 s to mounted, own `DSH_HOME`,
   cloud plugin answers, clean stop). No supervisor is needed: nothing starts at boot. Nothing in the menu calls it yet.
   Found on the way:
   - **1b, the bundles: sorted (2026-11-02).** A copy of the personal profile loads everything the personal DSH loads, so the bundles were
     checked for a service two DSH could not both run. Method: a pattern scan of every bundle in the profile (fixed ports, `listen`, timers,
     LaunchAgents, `launchctl`, pid files), then the code around each hit read in sessions, mobile, free-llms, memory, call, multi-device,
     skills, workers, maintenance, computers, pulse, models and cloud, plus the core plugin's timers (record load, widget bridge tick,
     gateway watcher, templates shelf). Result: only two belong to the computer and are left out of a team's profile
     (`PERSONAL_ONLY_BUNDLES`: the restart tool aimed at :3080, the apps and LaunchAgents installer). None of the others starts a
     machine-level service by itself: no fixed port (the `3080` in the code is always the default of `DSH_WEB_PORT`, which a team DSH sets),
     no MCP server binds a port, the sessions watch (a LaunchAgent) is installed on demand and not at mount, the phone link reconnects only
     the phones paired in its own home (none, in a new one), and the timers (memory tidy, janitor, E2B sweeper, pulse, image heal,
     connections sync) all work on their own home. One real finding, fixed: the model-routing command of `kybernos-auto` always aimed at
     :3080 and would have asked the personal DSH from inside a team's (`hoteOf` in `cli/auto-router.mjs` now follows `DSH_WEB_PORT`).
     Limits: the engine's own `@deepseek-ai/*` bundles were not audited, and two DSH running together on a real machine (not a sandbox) were
     not played.
   - **What a team DSH should not offer is a menu question, not a loading one** (step 3). They belong to the account or the computer, not to
     a team: Settings › Kaby, the Telegram and WhatsApp doors and the Home computer (`/kybernos-cloud/telegram|whatsapp|computer/*`,
     `kyby/*`), Phone and channels. Connectors are the one case in between: which apps are switched on is per home, so per team, but the
     OAuth connections behind them belong to the account (decision 2 below).
   - **One secret per home, and what that does to sign-in (corrected 2026-11-02).** A new home makes its own `.credentials.yaml`, hence its
     own browser-session secret. Earlier text here feared that two DSH on `127.0.0.1` would sign each other out because cookies ignore the
     port. The session cookie's NAME is derived from host and port (`dsh-auth-<hash of 127.0.0.1:PORT>`, `docs/dev/live-testing.md`,
     `scripts/cdp-lib.mjs`), so each DSH has its own cookie and they coexist. A person signs in to each DSH once, through its signed
     address (`dsh web: http…?token=…` in its log), which `team-dsh/open` will hand to the page. Not yet seen with two DSH in one browser.
     Step 4 no longer shares the secret.
2. **Done** (`index.js` of the cloud bundle, `pinnedSpace`): a team's own DSH answers its team as the active space, for good. Nothing switches
   it (`space/active` answers `espace_fixe` for any other space), nothing follows a chat (`space/for-folder` says `follow: false`, the
   claim-time switch decides nothing), so the model route names that team from the first mount. A team the person has since left is still
   named, so the server refuses the turn instead of billing Personal. The home starts signed in: at every opening the host copies the
   personal session (token, user, server; not the list of teams, the plan or the model-route record, which the team DSH reads itself) into
   the team home if it holds no connection, and the server registry with it. One session, two DSH: signing out of a team's DSH does not
   revoke it, and signing out of the personal one ends both (the team DSH clears itself at its next call). The record of the team folders
   is the personal home's, read by every DSH (a second record would make `<Documents>/Kybernos/<Team>` look taken). Played on a sandbox with
   a real `dsh web` and a made-up session (`scripts/check-team-dsh-live.mjs`: signed in, team active, refuses to switch).
   **Memory (2b), decided while doing it:** the copied session also opens the person's account memory on the server, so that stays cut in
   a team's DSH (the existing team-space cut, unchanged). The local lessons are different: the home is the team's alone, so the memory bundle
   uses them there (`seam.ownHome()`, `lessonsCut` in `kybernos-memory/team-space.mjs`); the side doors that name the personal memory stay
   refused. A bundle without the new seam field keeps the old, closed behaviour.
3. **Done: the menu (3a) and the hiding (3b). The desktop window is not.** Choosing a team in the account menu asks the host (`team-dsh/open`, which
   now also answers the team's signed address, the one its log printed) and opens that address with `window.open` in a window named after the
   team (`kybernos-team-<id>`), so a second choice finds the same window. The card says "Starting…" meanwhile (not "Switching…": nothing is billed
   differently in the DSH that shows the menu). From a team's DSH, "Personal" opens the personal DSH (`team-dsh/personal`: the personal DSH writes
   its port in its home, a team's DSH reads it; default 3080), and another team opens its own. A browser that refuses a window opened this long after
   the click gets a notice with an "Open" action. The page knows it is in a team's DSH from `state.team_dsh`. The old switch stays behind a flag
   the host always sends (`own_dsh`) until step 5, so the live checks that play it still stand; what still moves the personal DSH to a team is
   only what follows a chat on screen, a team just created, and the claim-time switch: all of step 5. Played on the real page of a sandbox with the
   host's answers stubbed (`scripts/check-team-switch-live.mjs`, 14 checks) and, for the host, on a real `dsh web` (`check-team-dsh-live.mjs`).
   **3b, done (2026-11-02): what belongs to the account stays out of a team's DSH (Kaby, the Telegram and WhatsApp doors, the Home computer, Phone and
   channels).** Three parts, none of them a page reading `state.team_dsh` (the other bundles cannot read the cloud bundle's state before they draw):
   - *The pages are not loaded.* `PERSONAL_ONLY_BUNDLES` now also holds `kybernos-kyber` (Kaby's page, the doors, the Home computer), `kybernos-kaby-customisation`
     (Settings › Kaby) and `kybernos-mobile` (the phone link: its Settings page and the account-menu row, which only exists while the bundle publishes `__KB_MOBILE__`).
     A home made before the list grew is brought up to date when its DSH next starts (`leaveOutPersonalBundles`; never while it runs, the manifest is hot-loaded).
     Price: the phone bundle also lays the page out on a narrow screen, so a team's DSH has no such layout until the phone has its own road (below).
   - *The server refuses them.* In a team's DSH the cloud bundle answers `403 personal_only` on `kyber`, `kyby/*`, `telegram/*`, `whatsapp/*` and `computer/*`
     (`personalOnlyRoute`, applied by the route wrapper) and closes the seam to the phone link (`/v1/remote/`). The new-chat page's Home computer line reads
     `kyber` and goes quiet on a refusal, so it needed no change. The cloud computers of the agents (`computers*`, plural) are not the Home computer and stay.
   - *The first-run wizard.* Found by looking at the real page: a new home opened on « Welcome to Kybernos ». A team's home now starts with the wizard done
     (`seedOnboarding`), carrying over only tastes (language, interface mode, style preset), never who the person is or what they said about themselves.
   Left as it is, and inert in a team's DSH: the host half of Kaby in the cloud bundle (its prompt block, the unattended gate), which acts on a Kaby chat a team home does not
   have. Played in `packages/kybernos-cloud/test-team-personal-only.mjs` (a real HTTP server, the wrapper itself), `test-team-instances.mjs` and, on real pages of the sandbox
   side by side with the personal DSH, `scripts/check-team-hidden-live.mjs` (14 checks: no Kaby in the sidebar nor in Settings, no « Phone and channels », no Home
   computer line, no wizard; the personal page has all of them).
   **Desktop app: not done** (its own repository, see decision 3).
4. Seed rules: what else is copied from Personal when a team home is created (the interface language; the person's own provider keys, decision 2). The Kybernos session is already seeded (step 2), and the first-run wizard's tastes (language, interface mode, style preset) with it (step 3b).
5. Retire the single-instance switch code (follow-the-chat, turn guard, deferred switch, claim-time switch). Dead-code rider.
6. Two-account live test on the existing `scripts/e2e-teams-run.sh` harness.

The phone (`kybernos-mobile`, `PLAN.md`) embeds one Node engine in the app, started once per process ("a crash needs a relaunch"), about 200 to
460 MB resident: it cannot hold several DSH. Later, and not yet checked on a device: one home at a time, a team switch relaunching the app on
the other `DSH_HOME` (step 0 is what makes that possible). The other road is the phone as a remote of the DSH running on the computer, one
connection per team (`PLAN.md` section 9, a proposal, nothing built).

## Decisions for the owner

1. **Decided 2026-11-02: all teams alive at once.**
2. A new team's first setup: language and theme copied from Personal; model keys asked once per team, or shared from Personal. A shared
   key means the team's DSH can read the person's own key.
3. **Decided 2026-11-02: a team opens in its own window.** Desktop app (`kybernos-desktop`, read 2026-11-02): it is built for one engine. One
   window with the DSH in a view fenced to `127.0.0.1:<one port>` (`KYBERNOS_PORT`, 3080 by default), no preload in that view, and any
   `window.open` to a loopback address goes to the system browser. So a team's click would today open the browser, not an app window.
   Needed there, in its own repository: a second window per team on its port (3300-3399) when the page opens such an address (the signed one that
   `team-dsh/open` will hand over; the cookie name comes from host and port, so no separate cookie jar is needed). The page still gets no app API: its
   only channel stays `window.open` to a loopback port.
