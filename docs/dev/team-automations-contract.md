# Team automations: the server contract

A Team can keep a **private catalogue of automations**. Any member proposes one of their automations, an owner or admin approves it, and every member can then
install it into their own DSH as a **paused copy that belongs to them**. This file is the contract between the plugins (this repo) and the server
(`kybernos-server`, a module next to `src/modules/skills`). Nothing implements it yet: it is written first so that the two halves can be built at the same time.

It mirrors Team skills (`docs/dev/team-skills-contract.md`) on purpose: same roles, same status flow, same error vocabulary, same guards. The difference is the thing
shared: a skill is a folder of text files; an automation is **one small definition** (a prompt, a rhythm, the apps it needs), so there is no file table and no path
rule. The UI is the Automations page's « Team » segment (mockup of 2026-10-24, « Partage d'automatisations d'équipe »).

## What a Team automation is

A **definition**, never a running thing and never a person's data. It carries only what a stranger needs to read and decide:

- `key`: `^[a-z0-9]+(?:-[a-z0-9]+)*$`, at most 64 characters. The identity of the automation inside a workspace (like a skill's `name`); the plugin derives it from the
  name (accents removed, lower case, other runs of characters become one `-`). An update is a new proposal with the same `key`.
- `name`: 1 to 120 characters after trimming, not only zero-width characters (the plugin's own rule for an automation's name).
- `description`: 1 to 500 characters of plain text, what it does, shown to every member in the list. The Propose sheet pre-fills it from the first sentence of the prompt.
- `prompt`: 1 to 8 000 characters (the plugin's cap). Text means no NUL and no half of a surrogate pair; otherwise `invalid_automation` / `binary`.
- `schedule`: either `{ "mode": "cron", "cron": "<5 fields>" }` or `{ "mode": "webhook" }`.
  - `once` (a one-time date) is **refused**: a shared automation is a standing one (`invalid_automation` / `schedule`).
  - There is **no time zone**: the cron is read in the installer's own zone, so « every day at 08:30 » is 08:30 where each member is.
  - The server only checks the shape: five whitespace-separated fields made of `0-9 * / , - A-Za-z`, at most 100 characters. The plugin parses it for real before it installs (it
    already refuses an expression that can never fire).
  - A webhook automation travels as a **kind**, never as an address or a secret: each copy mints its own.
- `needs`: up to 6 app slugs (Composio toolkit slugs, `^[a-z0-9_-]{2,40}$`), unique, sorted. Names only: no account, no token, no connection id.
- `version`: SHA-256 (hex) of the **canonical form**: the UTF-8 bytes of
  `JSON.stringify({ key, name, description, prompt, schedule, needs })` with the keys in exactly that order, `schedule` as `{ "mode": "cron", "cron": "<fields joined by one space>" }` or
  `{ "mode": "webhook" }`, and `needs` sorted. `JSON.stringify` as JavaScript writes it (non-ASCII characters stay as they are). The client recomputes it after a download and refuses a mismatch,
  so what an admin approved is exactly what a member installs.
  Test vectors (computed with `crypto.createHash('sha256')`):
  - `key` `invoice-reminder`, `name` `Invoice reminder`, `description` `Drafts a polite reminder for every invoice more than 30 days old.`, `prompt`
    `Every Monday, look at the invoices in Gmail labelled “To chase” that are more than 30 days old.\nFor each one, write a short, polite reminder in the client’s language and save it as a draft.\nNever send an e-mail yourself. Post the list of drafts in #finance.`
    (with real newlines), `schedule` `{ mode: "cron", cron: "0 9 * * 1" }`, `needs` `["slack", "gmail"]` give
    `40d2e6d589d77bc36888fd2d6a22354c77902a374f47723b1179a9bddf8e9c24` (canonical form of 477 characters).
  - `key` `hook-demo`, `name` `Hook demo`, `description` `Runs when called.`, `prompt` `Say hi.`, `schedule` `{ mode: "webhook" }`, `needs` `[]` give
    `e68467deacc2f458f0b1c5a0655c743e5b8ff1c81e20b9104c191a820f8fa5dd`.

**Trimming and the note.** `name`, `description` and `prompt` are trimmed (leading and trailing white space) before they are validated, stored and hashed; the plugin sends them already trimmed, and a server that
receives them untrimmed trims them before it computes `version`. `note` (the proposer's remark to the reviewers, optional) is at most 2 000 characters (`invalid_automation` / `too_large`) and is scanned like the rest. The
body of `POST` and `POST /check` is at most 128 KiB.

**Nothing a person cannot see (decision DL-09 of the 2026-10 recette, findings L2-18 and L2-20).** An admin approves what the sheet shows and a model reads every character, so a prompt whose visible
words are harmless and whose end is a run of Unicode tag characters installs an instruction nobody read. The text of a proposal is therefore looked at **as sent, before it is trimmed** (a BOM that `trim`
would take off is still refused), in `name`, `description`, `prompt`, `note`, the `cron` and every app name, and **refused, never removed**: the version is the SHA-256 of the exact text and every client computes
it too, so taking characters out would change the version the client expects. The answer is `400 invalid_automation` with `reason: "hidden"`, the `field`, `first` (the first one, as `U+E0041`) and `count`.
The check comes after the shape checks above (a name of nothing visible is still `name`, a NUL still `binary`).

- **Refused** (457 code points): the Unicode tags block U+E0000-U+E007F; the direction controls U+202A-U+202E and U+2066-U+2069; the zero-width space U+200B; the word joiner U+2060; the invisible operators
  U+2061-U+2064; the deprecated formatting characters U+206A-U+206F; the byte-order mark U+FEFF **anywhere** (a BOM is not text); the soft hyphen U+00AD; the Mongolian vowel separator U+180E; the interlinear
  marks U+FFF9-U+FFFB; the variation selectors U+E0100-U+E01EF; and the C0 and C1 controls except tab, line feed and carriage return (NUL included).
- **Kept**: U+200C and U+200D (the zero-width non-joiner and joiner: emoji sequences, Persian), U+200E and U+200F (the left-to-right and right-to-left marks: Arabic and Hebrew), U+FE0E and U+FE0F (text and
  emoji presentation), ordinary spaces and every other character. A text that was fine keeps its version: both test vectors above still hold.
- **The same set everywhere.** The server (`src/lib/hidden-text.ts`) and the three plugin clients (`kybernos-plugin/automation-team.mjs`, `kybernos-cloud/team-automations.mjs`,
  `kybernos-skills/team-skills.mjs`) carry it, and are all tested against one list of texts, [`hidden-text-vectors.json`](hidden-text-vectors.json) (`{note, text, accepted}`, written in escapes; the same file,
  byte for byte, as `test/fixtures/hidden-text-vectors.json` in the server; sha256 `e64586d672b86c3c9607c4420da4819e2810baeafdc4686d1605105d31d4e6b8`), and against the decision's table code point by code point
  (`scripts/test-hidden-text-clients.mjs`). It includes the 77, 59, 49 and 66 hidden characters the recette saw.
- **The secret scan reads the text without what draws nothing** (the refused set, and the joiners, marks and selectors that are kept, and the other default-ignorable characters): a key cut by a zero-width
  character, or by a joiner that text may hold, is still a key, on the same line number.
- **Data already stored is not migrated.** The read path (list, `GET /{id}`) is unchanged: an automation stored before the rule is listed and served as it was, with its version. Only new writes are refused.
  A copy already installed on a member's machine is not touched (the server never sees it; DSH does not re-scan installed tasks): it keeps its text. A stored definition that holds one cannot be **installed or
  updated** any more: the host refuses it (`hidden`, nothing written), and the review sheet says so instead of « Checked » (an admin should reject it; there is no counter of the characters yet).

**What never travels** (the plugin leaves it out when it builds the proposal; the server has no field for it): the keys, tokens and passwords of the person; webhook addresses and
secrets; run history and results; the files of the person's work folder; the connected accounts (only the app names in `needs`); where it runs (`runsOn`); its on/off state; the
notification choices; the session or workspace it was made in; the approval mode (each member chooses theirs at install).

**Secret scan.** Every text the members see or the copy runs is scanned: `name`, `description` and every line of `prompt` (the same rules as Team skills and the marketplace:
`src/lib/secret-scan.ts`, linear in the size of the text, the JWT pattern applied run by run). A hit refuses the proposal with `scan_rejected`, naming the `field` and, for the prompt, the 1-based
`line`. The match itself is never returned.

## Status flow

`proposed` → `approved` (by an owner or admin) or `rejected` (with a note). An `approved` automation can be `retired` by an admin.

- An owner or admin who adds one gets it `approved` at once, like a skill or a lesson.
- A member's proposal is **immutable**. Changing an automation means a new proposal with the same `key`.
- Approving a proposal whose `key` already has an approved version **replaces** it: the old row becomes `retired` and points to the new one (`superseded_by`). At most one `approved` row per
  `(workspace_id, key)`: a partial unique index.
- Nothing is offered to members as installable until it is `approved`.
- **Retiring or replacing never touches a copy a member already installed.** It keeps working; the member is offered the update, or sees that it is no longer offered.

## Guards

Same order as the skills module, so the same tests apply:

1. Identity is a valid session key (`metadata.user_id`); the master key gets 403.
2. The caller is an **active member** of the workspace, otherwise a generic 404 (no oracle on which workspaces exist).
3. The workspace's plan has the feature `team.automations` (a new premium feature key, in `catalogue/team.json` and the feature list of the billing module, given by the Team plan), otherwise
   **403 `plan_required`** with `{ error: "plan_required", feature: "team.automations" }`. A personal workspace has no such plan, so it gets the same answer. The plugin turns this into the locked
   state « Team plan » and never guesses from the plan's name.
4. Approve, reject, retire: owner or admin, otherwise 403 `admin_required`.

An access journal on the plugin side records who, when and what, **never the content** (`team-automations-access.jsonl`, like the skills one).

## Routes

All under `/v1/workspaces/{wid}/automations`. `wid` is explicit in the path. JSON in and out.

| Route | Who | Does |
| --- | --- | --- |
| `GET ?view=approved\|proposed\|mine\|all&limit=&offset=` | member | A page of **metadata, no prompt**. `approved` for everyone; `proposed` and `all` for admins; `mine` is the caller's own proposals. |
| `GET /{id}` | member | One automation **with its prompt**. A member sees an `approved` one, or their own proposal; an admin sees any. Anything else: 404. |
| `POST` | member | Propose `{key, name, description, prompt, schedule, needs, note?}`. `201`. An admin's automation is `approved` at once. |
| `POST /check` | member | The same body, **a dry run**: validates and scans, stores nothing. `200 { ok: true, version }` or the error the proposal would get. It lets the Propose sheet show « Checked » before « Send for review ». |
| `DELETE /{id}` | proposer, admin | A member withdraws their own proposal while it is `proposed`; an admin can delete any. |
| `POST /{id}/review` | admin | `{decision: "approve" \| "reject", note?}`. The definition is **not editable** at review: reject with a note, or propose a corrected version. |
| `POST /{id}/retire` | admin | An approved automation stops being offered. It stays in the history. |

A list answer, same shape as skills:

```jsonc
{ "workspace_id": "…", "role": "member", "view": "approved", "total": 3, "limit": 100, "offset": 0,
  "counts": { "approved": 3, "pending": 1 },
  "automations": [{
    "id": 12, "key": "invoice-reminder", "name": "Invoice reminder", "description": "…", "version": "<sha256>",
    "status": "approved", "revision": 3, "schedule": { "mode": "cron", "cron": "0 9 * * 1" }, "needs": ["gmail", "slack"], "prompt_chars": 212,
    "proposed_by_name": "Camille", "proposed_at": "…", "reviewed_by_name": "Julien", "reviewed_at": "…",
    "note": "…", "review_note": "…", "replaces": null, "superseded_by": null, "mine": false
  }] }
```

`id` is an integer (DSH matches it as digits). `revision` is the 1-based number of this version among the rows of the same `key` that were ever approved (`approved` or `retired`), ordered by approval time, so the page can say « v3 » and « v3 → v4 »; it is `null` on a `proposed` or `rejected` row. `note` and `review_note` are shown to the proposer and to admins only. `replaces` (on a `proposed` row) is the id of the currently approved automation with the same
`key`, so the admin sees an update and not a new automation, and fetches both with `GET /{id}` to show the changes. A single automation (`GET /{id}`) is the same object plus `"prompt": "…"`.

## Errors

The vocabulary of the skills module, plus the automation-specific ones.

| Status | Body | When |
| --- | --- | --- |
| 400 | `{error: "invalid_automation", reason, field?}` | `reason` is one of `key`, `name`, `description`, `prompt`, `schedule` (a `once` schedule, a bad shape, a time zone sent), `needs`, `binary`, `hidden` (an invisible or direction-changing character; `field` is `name`, `description`, `prompt`, `note`, `schedule` or `needs`, and the body carries `first` and `count`), `too_large` |
| 400 | `{error: "scan_rejected", field, line?}` | a secret was found (the match itself is never returned) |
| 401 / 403 | as skills | no identity / `admin_required` / `plan_required` |
| 404 | `{error: "Workspace not found"}` or `{error: "Team automation not found"}` | not a member (same answer as an unknown workspace) / no such automation, or someone else's proposal. These two texts are what the plugin tells apart from a server that has no Team automations at all (any other 404): keep them exact |
| 409 | `duplicate` | same `key` and same `version` already `proposed` or `approved` (`id`, `status` returned) |
| 409 | `not_pending`, `not_approved` | a review or retire that came too late (another admin was faster) |
| 409 | `team_full` | 100 approved automations |
| 413 | `too_large` | the body exceeds 128 KiB, answered before it is parsed |
| 429 | `too_many_proposals` | 5 pending proposals per member |

## Storage (a suggestion, not a requirement)

One table, `team_automations`: workspace, key, name, description, prompt, schedule (mode, cron), needs, version, status, proposer, reviewer, notes, counts, `superseded_by`. Two unique indexes carry the
rules: one approved row per `(workspace_id, key)`, and no second `proposed` or `approved` row with the same `(workspace_id, key, version)`. The account data export and the account deletion cover it, as they cover skills.

## The plugin side (for information, not part of the contract with the server)

Three pieces, which do not import each other (the page moves the data between them, the server never sees a local id):

**1. `kybernos-cloud`: the relay to the server.** `/kybernos-cloud/team/automations` (GET list, `?view=&limit=&offset=`), `/kybernos-cloud/team/automations/item?id=` (GET), `…/check`, `…/add`, `…/review`, `…/retire`,
`…/delete` (POST, strict same origin + the signed session), and `team-automations.mjs`, its pure half (limits, the canonical form and `version`, the words of the server's answers). They call the server above with the account
token, for the ACTIVE workspace, only in a team space (`teamWorkspace`), and turn every refusal into one word: `admin_required`, `plan_required`, `scan_rejected`, `invalid_automation`, `duplicate`, `not_pending`,
`not_approved`, `team_full`, `too_many_proposals`, `rate_limited` (the server's general limiter: a 429 that does not say `too_many_proposals`), `too_large`, `not_found`, `not_on_this_server`. They write an access journal that never holds content.

**2. `kybernos-plugin` host: the local half** (it owns `tasks.json`). All POST, strict same origin + the signed session (they carry prompts):

| Route | Body | Answer |
| --- | --- | --- |
| `/kybernos/automation/team-pack` | `{ id }` (a task id) | `{ ok: true, proposal: { key, name, description, prompt, schedule, needs, version }, team: null \| { workspaceId, id, key, version, edited } }` or `{ ok: false, error }` with `error` = `not_found`, `once_not_shareable`, `empty_prompt`, or `invalid_automation` with `reason: "hidden"` and the `field` (an invisible character in the prompt, the name or the description: nothing is packed). The description is pre-filled from the first sentence of the prompt (at most 200 characters, cut on a word). `schedule` is `{ mode: "cron", cron }` or `{ mode: "webhook" }` with no zone. `needs` are the task's slugs. Nothing else of the task is returned. |
| `/kybernos/automation/team-copies` | `{}` | `{ ok: true, copies: [{ taskId, workspaceId, id, key, version, edited, missingApps: [slug] }] }`: the local copies that came from a team (those with a `team` mark), `edited` as defined below. |
| `/kybernos/automation/team-install` | `{ definition: { id, key, name, description, prompt, schedule, needs, version }, workspaceId, approvals: "ask" \| "auto", turnOn: boolean }` | `{ ok: true, taskId, active, missingApps: [slug] }` or `{ ok: false, error }`. The host re-validates the definition with the rules above, **recomputes `version` and refuses a mismatch** (`version_mismatch`), refuses a `key` that already has a copy for that workspace (`already_installed`: use `team-update`), writes a **paused** automation through the same sanitizer and store as a created one (cron parsed and checked to be able to fire; the installer's own zone), `runsOn: "local"`, with the `team` mark. `active` is true only if `turnOn` and no app is missing. A webhook definition mints its own secret. |
| `/kybernos/automation/team-update` | `{ taskId, definition, mode: "keep" \| "both" \| "replace" }` | `{ ok: true, taskId, newTaskId? }` or `{ ok: false, error }`. `replace` rewrites name, prompt and needs from `definition`, and the schedule only if the person did not change it since install; active state, place, approval mode and notifications stay as they are; the mark moves to the new version. `both` first saves the current copy as a separate paused automation named « <name> (mine) » with no mark (`newTaskId`), then does `replace`. `keep` changes nothing (answers `ok`). An unedited copy accepts `replace` only. |

**The mark** on a copy: `team: { workspaceId, id, key, version, installedAt, base: { name, prompt, schedule, needs }, contentHash }`. `base` is the definition as installed (the member's own record of it: a retired
version is no longer served to members, so the « Changes since v3 » view is computed from `base` against the newly approved one). `contentHash` is the SHA-256 of the canonical JSON of `{ name, prompt, schedule, needs }` as installed
(schedule as `{ mode, cron? }`); a copy is **edited** when the hash of those four fields as they are now is different. The mark survives every ordinary edit of the automation.

**As built (piece 2).** The rules and the update logic are `packages/kybernos-plugin/automation-team.mjs` (pure; `test-automation-team.mjs`); the four routes are `kbTeamHandle` in `index.js` (`scripts/test-tasks-team.mjs`; each carries the strict
Origin and DSH's signed session, `test-write-guard.mjs`). What the table above leaves open:

- **Errors, beyond the ones named.** A definition that breaks a rule: `{ ok: false, error: "invalid_automation", reason, field }` with the server's own `reason` words (`key`, `name`, `description`, `prompt`, `schedule`, `needs`, `binary`, `hidden`) plus `id`; a cron
  the host cannot parse or that never fires is `reason: "schedule"`. Also `invalid_workspace`, `store_unreadable` (a `tasks.json` that cannot be trusted; nothing is written), and on `team-update` `not_found`, `not_a_team_copy`, `key_mismatch`,
  `invalid_mode` and `not_edited` (`keep` and `both` on a copy nobody edited). `already_installed` also carries the `taskId` of the copy. `team-pack` answers `invalid_schedule` for a stored cron outside the server's shape and `not_found` for a suggestion that was
  not added yet.
- **An every-minute rhythm** (under 5 minutes between runs) is refused as it is when an automation is created, `{ ok: false, error: "frequent schedule", everyMinutes }`, on `team-install` and on a `team-update` whose schedule would follow; the request
  goes through when it carries `confirmFrequent: true`.
- **`missingApps` is always `[]`**: which apps are connected is the page's knowledge (the Connectors row), not the host's. `active` is therefore true whenever `turnOn` is.
- **A copy proposes under its own `team.key`**, whatever its name became: that is what makes the proposal an update of the same automation.
- **`installedAt`** is the moment the installed version was written (install, or the last `replace`).
- **After a `replace` where the schedule did not follow**, `base` is still the team's definition, so the copy reads as edited and the next update does not take the schedule either. `both` saves the person's copy with a webhook of its own when it had one.

**3. The page (`kybernos-plugin` client): the Automations page.** A « Team » segment next to « Yours » and « Discover », the row menu entry « Propose to team… », and four sheets (Propose, Review, Install, Update) as in
the mockup. The segment is locked, with the reason in words, when the person is signed out, in a personal space, on a plan without the feature (`plan_required`), on a server without the routes, or offline. The page asks
`/kybernos-cloud/team/automations*` for the shared catalogue and `/kybernos/automation/team-*` for the local half.
