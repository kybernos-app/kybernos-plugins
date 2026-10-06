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
  - A path is relative and ASCII: `/`-separated segments, each matching `[A-Za-z0-9_][A-Za-z0-9._-]*` (so no `..`, no hidden
    segment like `.git`, no `\`, no empty segment, no leading `/`), at most 200 characters, no path twice.
  - At most 50 files, 256 KiB per file, 1 MiB in total. Binary content is refused.
  - A secret scan on every file refuses the skill (`scan_rejected`); the patterns of `_skillrepos.py` are the reference.
- `version`: SHA-256 (hex) of the files, computed by the server over the canonical listing: for each file sorted by `path`
  (ASCII, so the same order in any language), `path`, a NUL byte, the content's byte length in decimal (UTF-8 bytes), a NUL byte,
  the content bytes. The client recomputes it after a download and refuses a mismatch. What an admin approved is therefore exactly
  what a member installs.
  Test vector (checked against an independent Python implementation): the two files
  `SKILL.md` = `---\nname: demo\ndescription: "A demo"\n---\n\n# demo\n` and `notes/a.md` = `é\n` (3 bytes) give
  `ebeb1967f2fba1a8f440ee917f7a12cd4b1a2089dab2615ea31d319cc63ef4cb`.

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
| 400 | `{error: "invalid_skill", reason, file?}` | `reason` is one of `name`, `no_skill_md`, `frontmatter` (SKILL.md must carry the same `name` and a non-empty `description`), `bad_path`, `binary`, `too_many_files`, `file_too_large`, `too_large` (the total); `file` names the offender when there is one |
| 400 | `{error: "scan_rejected", file}` | a secret was found (the match itself is never returned) |
| 401 / 403 | as lessons | no identity / `admin_required` |
| 404 | `{error: "Workspace not found"}` or `{error: "Team skill not found"}` | not a member of the workspace (same answer as an unknown one) / no such skill, or someone else's proposal. These two texts are what the plugin tells apart from a server that has no Team skills at all (any other 404): keep them exact |
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

Built (host halves, tested against a stand-in server; the screen is not built yet):

- `kybernos-cloud`: `/kybernos-cloud/team/skills` (list), `…/item?id=` (one skill with its files), `…/add`, `…/review`,
  `…/retire`, `…/delete`. They call the server above with the account token, for the ACTIVE workspace, only on the Team plan
  (`teamWorkspace`, like lessons), and turn every refusal into one word (`team-skills.mjs`). They are not on the console relay's
  allowlist: that one serves the Team console iframe only.
- `kybernos-skills`: `POST /kybernos-skills/team/pack {root, name}` reads a skill of one of the two writable roots into a proposal
  (text only, hidden files and symlinks left out, secret scan, the version), and `POST /kybernos-skills/team/install {root?, name,
  version, files}` recomputes the version, checks every path and writes the folder atomically, **never over an existing folder**.
  Both are POST and same-origin guarded because they carry skill content.
- The page moves the files between the two (the server never sees a local path, the plugins never import each other).

To build: the Skills screen gets a **Team** segment next to *Yours* and *Discover* (maquette: approved skills with *Install*, *My
proposals*, *Propose*, and for admins a review queue showing the files before approving). Without the route (an older or a
different server) the segment says « not available on this server », never an error.
