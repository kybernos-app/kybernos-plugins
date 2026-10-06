# Team skills: the server contract

A Team can keep a **private catalogue of skills**. Any member proposes a skill, an owner or admin approves it, and every member
can then install it into their own DSH. This file is the contract between the plugins (this repo) and the server. **No server
implements it yet**: the plugin is built and tested against a fake one, and the new server implements the routes below.

It mirrors Team lessons (`/v1/workspaces/{id}/lessons`: propose, review, retire) on purpose: same roles, same status flow, same
error vocabulary, same guards. A server that already has the lessons module has almost nothing new to invent.

## What a Team skill is

A DSH skill is a folder: a `SKILL.md` plus optional text files next to it. A Team skill is that folder, stored on the server.

- `name`: `^[a-z0-9]+(?:-[a-z0-9]+)*$` (DSH's own rule), at most 64 characters. It is the folder name once installed.
- `description`: non-empty, at most 1 024 characters (what DSH requires of a skill).
- `files`: `[{ "path": "SKILL.md", "content": "..." }, ...]`. Text only, UTF-8.
  - `SKILL.md` must be present, and its frontmatter `name` must equal `name` and carry a non-empty `description`.
  - A path is relative, uses `/`, at most 200 characters, with no `..`, no leading `/`, no `\`, no empty segment.
  - At most 50 files, 256 KiB per file, 1 MiB in total. Binary content is refused.
  - A secret scan on every file refuses the skill (`scan_rejected`); the patterns of `_skillrepos.py` are the reference.
- `version`: SHA-256 (hex) of the files, computed by the server over the canonical listing: for each file sorted by `path`,
  `path`, a NUL byte, the content's byte length in decimal, a NUL byte, the content bytes. The client recomputes it after a
  download and refuses a mismatch. What an admin approved is therefore exactly what a member installs.

## Status flow

`proposed` → `approved` (by an owner or admin) or `rejected` (with a note). An `approved` skill can be `retired` by an admin.

- An owner or admin who adds a skill gets it `approved` at once, like a lesson.
- A member's proposal is **immutable**. Changing a skill means a new proposal with the same `name`.
- Approving a proposal whose `name` already has an approved version **replaces** it: the old row becomes `retired` and points
  to the new one (`superseded_by`). At most one `approved` row per `(workspace_id, name)`: a partial unique index.
- Nothing is offered to members as installable until it is `approved`.

## Guards

Same order as the lessons module, so the same tests apply:

1. Identity is a valid session key (`metadata.user_id`); the master key gets 403.
2. The caller is an **active member** of the workspace, otherwise a generic 404 (no oracle on which workspaces exist).
3. Approve, reject, retire: owner or admin, otherwise 403 `admin_required`.

Team skills are **reserved to the Team plan**. That is a **product rule applied by the app**, as for lessons: the plugin shows
the segment locked (« Team plan ») in a personal workspace or on another plan, and the server checks membership only (a
personal workspace has one member, so nothing leaks). An access journal records who,
when and what, **never the content** (`team-skills-access.jsonl`, like `team-lessons-access.jsonl`).

## Routes

All under `/v1/workspaces/{wid}/skills`. `wid` is explicit in the path. JSON in and out.

| Route | Who | Does |
| --- | --- | --- |
| `GET ?view=approved\|proposed\|mine\|all&limit=&offset=` | member | A page of **metadata, no files**. `approved` for everyone; `proposed` and `all` for admins; `mine` is the caller's own proposals. |
| `GET /{id}` | member | One skill **with its files**. A member sees an `approved` one, or their own proposal; an admin sees any. Anything else: 404. |
| `POST` | member | Propose `{name, description, files, note?, display_name?}`. `201`. An admin's skill is `approved` at once. |
| `DELETE /{id}` | proposer, admin | A member withdraws their own proposal while it is `proposed`; an admin can delete any. |
| `POST /{id}/review` | admin | `{decision: "approve" \| "reject", note?, display_name?}`. The files are **not editable** at review: reject with a note, or propose a corrected version. |
| `POST /{id}/retire` | admin | An approved skill stops being offered. It stays in the history. |

A list answer, same shape as lessons:

```jsonc
{ "workspace_id": "…", "role": "member", "view": "approved", "total": 3, "limit": 100, "offset": 0,
  "counts": { "approved": 3, "pending": 1 },
  "skills": [{
    "id": 12, "name": "release-notes", "description": "…", "version": "<sha256>",
    "status": "approved", "files": 4, "bytes": 5120,
    "proposed_by_name": "Ana", "proposed_at": "…", "reviewed_by_name": "Sam", "reviewed_at": "…",
    "note": "…", "review_note": "…", "replaces": null, "superseded_by": null, "mine": false
  }] }
```

`replaces` (on a `proposed` row) is the id of the currently approved skill with the same `name`, so the admin sees an update
and not a new skill. A single skill (`GET /{id}`) is the same object plus `"files": [{ "path", "content" }]` (the count moves
to `files_count`).

## Errors

The vocabulary of the lessons module, plus the skill-specific ones.

| Status | Body | When |
| --- | --- | --- |
| 400 | `{error: "invalid_skill", reason}` | `reason` is one of `name`, `description`, `no_skill_md`, `frontmatter`, `bad_path`, `binary`, `too_many_files`, `file_too_large` |
| 400 | `{error: "scan_rejected", file}` | a secret was found (the match itself is never returned) |
| 401 / 403 / 404 | as lessons | no identity / `admin_required` / unknown workspace, skill or someone else's proposal |
| 409 | `duplicate` | same `name` and same `version` already `proposed` or `approved` (`id`, `status` returned) |
| 409 | `not_pending`, `not_approved` | a review or retire that came too late (another admin was faster) |
| 409 | `team_full` | 100 approved skills |
| 413 | `too_large` | the body exceeds the total cap before it is parsed |
| 429 | `too_many_proposals` | 5 pending proposals per member |

## Storage (a suggestion, not a requirement)

Two tables are enough: `team_skills` (one row per proposal and version: workspace, name, description, version, status,
proposer, reviewer, notes, counts, `superseded_by`) and `team_skill_files` (`skill_id`, `path`, `content`, primary key on both).
Same family as `team_lessons`. A new server without Supabase can keep the same shape in its own database. Two unique indexes
carry the rules: one approved row per `(workspace_id, name)`, and no second `proposed` or `approved` row with the same
`(workspace_id, name, version)`.

## The plugin side (for information, not part of the contract)

- DSH host routes `/kybernos-cloud/team/skills*` call the server with the account token, like `/kybernos-cloud/team/lessons*`.
  They are not on the console relay's allowlist: that one serves the Team console iframe only.
- The Skills screen gets a **Team** segment next to *Yours* and *Discover*: approved skills with *Install*, *My proposals*,
  *Propose* (from a local skill), and for admins a review queue showing the file list before approving.
- *Install* copies the files into `~/.dsh/skills/<name>` with the same containment rules as a GitHub install, after checking
  `version`. A skill that already exists there is never overwritten silently.
- Without the route (an older or a different server), the segment shows « not available on this server », never an error.
