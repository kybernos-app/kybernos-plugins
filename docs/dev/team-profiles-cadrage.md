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
  memory is simply absent (no cut to maintain); connectors, skills, agents, automations, settings are the team's own. Kaby, Telegram and
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
   - **One secret per home.** A new home makes its own `.credentials.yaml`, hence its own browser-session secret. Cookies ignore the port, so
     two DSH on `127.0.0.1` would sign each other out. Step 4 shares that one secret across the homes (single sign-in everywhere).
2. The team instance's cloud state is bound to its team (fixed route).
3. The account menu opens the team's DSH; "Personal" returns to :3080.
4. Seed rules: what is copied from Personal when a team home is created.
5. Retire the single-instance switch code (follow-the-chat, turn guard, deferred switch, claim-time switch). Dead-code rider.
6. Two-account live test on the existing `scripts/e2e-teams-run.sh` harness.

The phone runs one engine: one home at a time with a restart, later.

## Decisions for the owner

1. **Decided 2026-11-02: all teams alive at once.**
2. A new team's first setup: language and theme copied from Personal; model keys asked once per team, or shared from Personal. A shared
   key means the team's DSH can read the person's own key.
3. Where a team opens: its own window, or the same window pointed at the team's address (the desktop app's wiring was not checked).
