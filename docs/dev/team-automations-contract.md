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
    "status": "approved", "schedule": { "mode": "cron", "cron": "0 9 * * 1" }, "needs": ["gmail", "slack"], "prompt_chars": 212,
    "proposed_by_name": "Camille", "proposed_at": "…", "reviewed_by_name": "Julien", "reviewed_at": "…",
    "note": "…", "review_note": "…", "replaces": null, "superseded_by": null, "mine": false
  }] }
```

`id` is an integer (DSH matches it as digits). `note` and `review_note` are shown to the proposer and to admins only. `replaces` (on a `proposed` row) is the id of the currently approved automation with the same
`key`, so the admin sees an update and not a new automation, and fetches both with `GET /{id}` to show the changes. A single automation (`GET /{id}`) is the same object plus `"prompt": "…"`.

## Errors

The vocabulary of the skills module, plus the automation-specific ones.

| Status | Body | When |
| --- | --- | --- |
| 400 | `{error: "invalid_automation", reason, field?}` | `reason` is one of `key`, `name`, `description`, `prompt`, `schedule` (a `once` schedule, a bad shape, a time zone sent), `needs`, `binary`, `too_large` |
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

## The plugin side (for information, not part of the contract)

- `kybernos-cloud`: `/kybernos-cloud/team/automations` (list), `…/item?id=`, `…/check`, `…/add`, `…/review`, `…/retire`, `…/delete`, and `team-automations.mjs`, its pure half (limits, the canonical form and `version`, the words of the
  server's answers). They call the server above with the account token, for the ACTIVE workspace, and turn every refusal into one word. Writes need the signed session.
- `kybernos-plugin` (the owner of `tasks.json`): `POST /kybernos/automation/pack {id}` reads one of the person's automations and returns the proposal (the definition above, nothing else); `POST /kybernos/automation/install {…}`
  writes the copy. The page moves the definition between the two; the server never sees a local id and the plugins never import each other.
- **The installed copy** is a normal automation, **paused** (`active: false`), owned by the person, with a mark `team: { workspaceId, id, key, version, contentHash, installedAt }`. `contentHash` is the SHA-256 of
  its own `{ name, prompt, schedule, needs }` at install; the copy counts as **edited** when the hash of what it holds now is different. It never replaces an automation that exists: an update on an edited copy asks (keep mine / save mine
  as a separate automation then update / replace). The person chooses where it runs and the approval mode (« Ask me first » by default), and cannot turn it on while an app it needs is not connected.
- A webhook copy mints its own secret at install and shows its address only to its owner.
- The segment is locked, with the reason in words, when the person is signed out, in a personal space, on a plan without the feature (`plan_required`), on a server without the routes, or offline.
