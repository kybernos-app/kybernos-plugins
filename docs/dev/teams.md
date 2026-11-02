# Teams in DSH: one person, several human teams

A person can belong to several human teams (shared workspaces of the Kybernos server) and move between them in DSH without ever mixing
money, memory or work folders. This page is the map: the rules, where each lives, the seams it uses, what it does not do, and how to
test it. The details of each part are in `packages/kybernos-cloud/README.md` (sections « Team space: the personal memory is cut »,
« Team skills », « The footer menu ») and in the header comment of each module named below.

## The rules

A **space** is the person's Personal workspace or one team. Exactly one space is **active** at a time.

1. **Whoever is active is billed.** DSH has ONE model route per instance, and its `x-kybernos-workspace` header names the active space.
   Switching a space rewrites that route (about 0.2 s on the host, up to 3 s before DSH applies it).
2. **The active space follows the chat on screen.** A chat whose folder is a team's folder bills that team; every other chat bills
   Personal. Opening a chat, loading the page on one, or sending the first message of a new chat in a team folder makes that space
   active (`chat-space.mjs`, the `follow-chat` block of `client.js`, the claim-time switch in `index.js`).
3. **No switch while a reply runs.** The host refuses `space/active` with `turn_running` while any reply is in flight (counted from the
   engine's `agent/status` events, bounded by age so a missed event can never stick). A switch that follows a chat is **deferred**: the
   page says which reply is running in which team and the switch happens by itself when the last reply ends. Without this, a reply's
   second request would carry the new team's header and one answer would be billed to two teams.
4. **Personal memory is cut in a team space.** Injection, the memory and lesson tools, and automatic capture. Team lessons, the
   per-folder instructions and « Propose to team » stay. Fail closed: anything that cannot be read counts as a team
   (`team-space.mjs`, `kybernos-memory/team-space.mjs`, the seam `Symbol.for('kybernos.space')`).
5. **One folder per team.** `<Documents>/Kybernos/<Team>` is made when a team is created, joined or first activated (the team name comes
   from other people: it is sanitised, and two teams of one name get distinct folders). It is recorded in
   `kybernos-cloud-folders.json` beside the state file (a sign-out wipes the state, not the folders). A manual switch opens a **new chat**
   in that folder; a switch back to Personal opens one in the workspace the person used before (`team-folder.mjs`).
6. **Usage is shown as a percent, never as money.** Footer card, switch rows and plan card show the server's `used_percent` per window.
   A return time is shown only when a window is used up (the windows are rolling: there is no reset moment to announce before that).
7. **Limits and money live on the web page.** The team pool is what the plan bought; an admin can only lower what each member may use,
   on the web page « Team settings » (« Spending caps »). DSH only links to it (« Manage », « Add credits »).
8. **Joining** a team: « Join with an invitation link » pastes the link or token, previews it, then accepts it with the device token. The
   token is only ever sent to the active server's own API, never to the host of a pasted link (the `join-link` block of `client.js`, and the routes `invitation/preview` and `invitation/accept` below).

## Where the code is

| What | Where |
|---|---|
| Which team a chat belongs to, the in-flight reply counter, folder-to-team resolution | `packages/kybernos-cloud/chat-space.mjs` |
| Team folders: sanitising, creation, the record file | `packages/kybernos-cloud/team-folder.mjs` |
| « Is the active space a team? » for the memory cut | `packages/kybernos-cloud/team-space.mjs`, `packages/kybernos-memory/team-space.mjs` |
| Account menu, plan card, composer cues, the follower, the folder navigation | `packages/kybernos-cloud/client.js` (blocks `follow-chat`, the menu and cue stores) |
| Host switch (`switchSpace`), claim-time switch, turn counter wiring, join, folders | `packages/kybernos-cloud/index.js` |
| Team lessons and skills (shared knowledge, with review) | `team-lessons.mjs`, `team-skills.mjs` |

Host routes (all under `/kybernos-cloud/`, same-origin guarded; the ones that change who is billed need the signed session): `space/active`,
`space/applied`, `space/for-folder`, `space/busy`, `space/folder`, `space/create`, `spaces/summary`, `invitation/preview`, `invitation/accept`.

## The seams it uses (no engine patch)

- DSH client services: `workspaces.create({ path })` (registers a folder as a DSH workspace, idempotent), `uiWorkspace.startSession(id)`
  (a new chat in a workspace), the sessions and workspaces stores (the chat on screen and its folder).
- Engine events: `agent/status` (a reply starts and ends), `agent/inbox/claimed` (a message is claimed, before its first request),
  `agent/disposed`.
- `systemPrompt.context` and `tools.register` for the memory cut; a frozen global seam for « is the active space a team ».

## What it does not do (known exposure)

- A message typed in a new chat **during a deferred switch** is billed to the old team until the switch is applied.
- Turns that are not a person's chat (Kaby's own session, Telegram, scheduled work) are billed to whichever space is active. Kaby's own
  folder counts as Personal.
- A session that began in Personal keeps its earlier memory in its history after a switch to a team; a new chat is the clean way.
- A chat's folder cannot change (a session's working folder is immutable), which is why a switch opens a new chat. An unsent draft
  typed on the page that is left is not carried over.
- Windows and Linux are untested; so is a hosted DSH instance.

## Tests

- Unit: `test-chat-space.mjs`, `test-chat-space-host.mjs`, `test-follow-chat.mjs`, `test-turn-guard-host.mjs`, `test-team-folder*.mjs`,
  `test-join-link.mjs`, `test-join-host.mjs`, `test-teams-menu.mjs` (all in `packages/kybernos-cloud/`), `scripts/test-team-memory-cut.mjs`,
  `scripts/test-team-folder-rule.mjs`. They run in the CI loop.
- Live, on a sandbox DSH (`docs/dev/live-testing.md`: `scripts/sandbox/setup.sh`, `start.sh`, `source scripts/sandbox/env.sh`):
  `scripts/check-footer-live.mjs` (menu, plan card, cues, switching), `check-follow-chat-live.mjs`, `check-join-live.mjs`,
  `check-team-folder-live.mjs`. Each must pass several runs in a row: they read facts, not fixed delays.
- End to end with two made-up accounts on a local replica of the server, the real DSH pages driven through two sandboxes, and a recording
  proxy that shows the headers and bodies of the model requests: `scripts/e2e-teams-run.sh` (`up`, `run [j1 j2 j9 ...]`, `down`; needs
  `KB_E2E_DIR`, a private folder outside git, and `KB_SERVER_DIR`, a checkout of the server; about 1 GB of disk per sandbox). The journeys
  are in `scripts/e2e-teams/` (billing, memory, folders, invitation, usage states, roles, shapes, web page, follow-the-chat). It never
  touches the ports of a developer's own replica or DSH.

## Traps

- A team with no plan cannot answer a model call: creating or joining one does not make it active by itself.
- On macOS and Windows two folder names that differ only by case are one folder; the comparison folds case.
- A chat opened in a non-team folder switches the active space to Personal, including when the person was in a team: that is the rule, not a bug.
