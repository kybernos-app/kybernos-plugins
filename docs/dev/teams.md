# Teams in DSH: one person, several human teams

A person can belong to several human teams (shared workspaces of the Kybernos server) and move between them in DSH without ever mixing
money, memory or work folders. This page is the map: the rules, where each lives, the seams it uses, what it does not do, and how to
test it. The details of each part are in `packages/kybernos-cloud/README.md` (sections « Team space: the personal memory is cut »,
« Team skills », « The footer menu ») and in the header comment of each module named below.

## The rules

A **space** is the person's Personal workspace or one team. Every space has a DSH of its own (decided 2026-11-02, `docs/dev/team-profiles-cadrage.md`): the
personal DSH answers Personal, and each team has a DSH with its own `DSH_HOME`, port, memory, connectors, skills, agents, automations and settings. Each
answers ONE space for good.

1. **Whoever runs the DSH is billed.** A DSH has ONE model route and its `x-kybernos-workspace` header names its space. Nothing moves a route from one
   space to another (`pinnedSpace` in `index.js`: a team's DSH answers `espace_fixe` to any other space).
2. **Choosing a team opens its DSH.** The account menu asks the host (`team-dsh/open`, `team-instances.mjs`): the team's DSH is started when it is not
   running (a few seconds, stopped after 30 minutes idle) and the page opens it in a window named after the team. « Personal », asked from a team's
   DSH, opens the personal DSH (`team-dsh/personal`). A team created with a plan, or joined, is opened the same way; one without a plan opens nothing
   and the page says so.
3. **A turn is held to the model route.** Before a turn the host checks that the route still names the DSH's space; a stale one is re-aligned, else the turn is
   refused with one sentence naming the team (`holdForStaleRoute`, `StaleRouteRefusal`; repair tries after 10 s, 30 s and 2 min). A reply can therefore
   never be billed to two teams.
4. **Personal memory is cut in a team space.** Injection, the memory and lesson tools, and automatic capture. Team lessons, the
   per-folder instructions and « Propose to team » stay. Fail closed: anything that cannot be read counts as a team
   (`team-space.mjs`, `kybernos-memory/team-space.mjs`, the seam `Symbol.for('kybernos.space')`).
5. **One folder per team.** `<Documents>/Kybernos/<Team>` is made when a team is created, joined or first opened (the team name comes
   from other people: it is sanitised, and two teams of one name get distinct folders). It is recorded in
   `kybernos-cloud-folders.json` in the personal home (a sign-out wipes the state, not the folders; `team-folder.mjs`).
6. **Usage is shown as a percent, never as money.** Footer card, switch rows and plan card show the server's `used_percent` per window.
   A return time is shown only when a window is used up (the windows are rolling: there is no reset moment to announce before that).
7. **Limits and money live on the web page.** The team pool is what the plan bought; an admin can only lower what each member may use,
   on the web page « Team settings » (« Spending caps »). DSH only links to it (« Manage », « Add credits »).
8. **Joining** a team: « Join with an invitation link » pastes the link or token, previews it, then accepts it with the device token. The
   token is only ever sent to the active server's own API, never to the host of a pasted link (the `join-link` block of `client.js`, and the routes `invitation/preview` and `invitation/accept` below).

## Where the code is

| What | Where |
|---|---|
| A team's own DSH: start on demand, ports 3300-3399, the registry, the copied session, the first-run seed, what is left out | `packages/kybernos-cloud/team-instances.mjs` |
| Team folders: sanitising, creation, the record file | `packages/kybernos-cloud/team-folder.mjs` |
| « Is the active space a team? » for the memory cut | `packages/kybernos-cloud/team-space.mjs`, `packages/kybernos-memory/team-space.mjs` |
| Account menu, plan card, composer cues, opening a team's DSH | `packages/kybernos-cloud/client.js` (the menu and cue stores, `pickSpace`) |
| Route mend (`switchSpace`), the turn hold, join, create, folders, `pinnedSpace` | `packages/kybernos-cloud/index.js` |
| Team lessons and skills (shared knowledge, with review) | `team-lessons.mjs`, `team-skills.mjs` |

Host routes (all under `/kybernos-cloud/`, same-origin guarded; the ones that change who is billed need the signed session): `space/active`,
`space/applied`, `space/folder`, `space/create`, `spaces/summary`, `invitation/preview`, `invitation/accept`, `team-dsh/open`, `team-dsh/stop`, `team-dsh/list`, `team-dsh/personal`.

## The seams it uses (no engine patch)

- Engine events: `agent/pre-step` (the turn hold), `agent/disposed`.
- `systemPrompt.context` and `tools.register` for the memory cut; a frozen global seam for « is the active space a team ».

## What it does not do (known exposure)

- Turns that are not a person's chat (Telegram, scheduled work) are billed to the space of the DSH that runs them. Kaby, the Telegram and WhatsApp doors,
  the Home computer and the phone link belong to the account: they are left out of a team's DSH (`personal_only`).
- The person's own provider keys stay in the personal DSH (the credential store is not copied, and keys in the environment are not handed on); a team's
  DSH gets the team's models through the copied Kybernos session. Copying keys on request is not built.
- A team's DSH is a second window and a second process (about 1 GB of disk when its home is first made). The phone cannot hold several: one home at a
  time, later.
- Windows and Linux are untested; so is a hosted DSH instance.

## Tests

- Unit: `test-route-hold.mjs`, `test-team-instances.mjs`, `test-team-personal-only.mjs`, `test-team-folder*.mjs`,
  `test-join-link.mjs`, `test-join-host.mjs`, `test-teams-menu.mjs`, `test-cloud-client.mjs` (the rendered page; run it with React on `NODE_PATH`, else that part is
  skipped) (all in `packages/kybernos-cloud/`), `scripts/test-team-memory-cut.mjs`, `scripts/test-team-folder-rule.mjs`. They run in the CI loop.
- Live, on a sandbox DSH (`docs/dev/live-testing.md`: `scripts/sandbox/setup.sh`, `start.sh`, `source scripts/sandbox/env.sh`):
  `scripts/check-footer-live.mjs` (menu, plan card, cues), `check-team-switch-live.mjs` (the page opens a team's DSH), `check-team-dsh-live.mjs`,
  `check-team-hidden-live.mjs` (what a team's DSH leaves out), `check-join-live.mjs`. Each must pass several runs in a row: they read
  facts, not fixed delays.
- End to end with two made-up accounts on a local replica of the server, the real DSH pages driven through two sandboxes, and a recording
  proxy that shows the headers and bodies of the model requests: `scripts/e2e-teams-run.sh` (`up`, `run [j1 j2 j9 ...]`, `down`; needs
  `KB_E2E_DIR`, a private folder outside git, and `KB_SERVER_DIR`, a checkout of the server; about 1 GB of disk per sandbox). The journeys
  are in `scripts/e2e-teams/` (billing, memory, folders, invitation, usage states, roles, shapes, web page, a team's own DSH). It never
  touches the ports of a developer's own replica or DSH.

## Traps

- A team with no plan cannot answer a model call: creating or joining one does not make it active by itself.
- On macOS and Windows two folder names that differ only by case are one folder; the comparison folds case.
- A chat opened in a non-team folder switches the active space to Personal, including when the person was in a team: that is the rule, not a bug.
