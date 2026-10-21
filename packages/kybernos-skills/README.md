# `@local/kybernos-skills`

The **Skills** screen of Kybernos: list the skills DSH knows about, switch them on and off, create one, and find and
install more from the public skills.sh index. The catalogue comes from DSH's own skill registry, not from folder scans.

It is part of the **socle** (`socle: true` in `packages/kybernos-hub/catalog.json`): always on.

## What the user sees

- The **Skills** tab of the Kybernos *Resources* page. The bundle fills the slot `main.kybernos-skills`, which
  `@local/kybernos` (core) declares and mounts; with this bundle off, the core falls back to its own skills page.
- **Featured** (the landing tab): the 24 picks Kybernos proposes, as cards with a cover, the title, a one-line outcome, the creator and the
  install count on the right of the title, the security verdict of the five skills.sh providers, and what the skill needs (a key, a
  sign-in). *Install* and *Details* appear on hover and on focus (always on touch); *Install* opens the usual confirmation and the page
  stays on Featured; *Use* copies `/name`. Categories, search and order come from the shared bar, which also switches **cards or list** (the list is one
  row per pick: a square thumbnail, the outcome, creator, count, verdicts and the same two actions, always visible); « Cover background » is
  Tint or Plain. Both choices are kept per browser. *Details* opens the pick **on the width of the page** (not in a side panel): its picture and
  title at the top as on the card, then the facts, the live audits and the start of the repository's real `SKILL.md` side by side; *Back*
  returns to the grid or the list, and installing from there keeps the pick open (it flips to *Installed*).
  The data is `featured-picks.json` (below); with a host that does not have the route the tab is hidden and Yours is the landing tab.
- **Yours**: skills of this profile, with a banner for **what Kaby suggests** (dashed cards, a Review panel with the checks, Accept / Edit / Discard, a Journal button, an Origin filter and a **Learned** badge on what was accepted), search, state / source filters, sorting, an active toggle on each card (read-only rows
  when the folder is not writable) and a Featured row kept by a star. A click on a card opens a **panel on the right** (the list
  stays): the skill's real `SKILL.md` as it is on disk, its folder (copyable), and the actions the host says it can do for that
  skill — *Open folder*, *Edit* (opens `SKILL.md` in the text editor of this machine), *Duplicate* (a copy in your own skills
  folder under a free name, its `name:` renamed) and *Delete* (a confirmation that names the folder first; permanent, writable
  roots only). A copy of the invocation to paste in the composer is on the card.
- **Discover**: the skills.sh ranking (all-time / trending / hot), search, the first-party "curated" set, security audits of a
  skill, one-click install of GitHub-hosted skills. A click on a row opens its **own panel**: its repository, the folder it sits
  in, its description and the start of its `SKILL.md` (read from the repository itself), who publishes it, its audits. *Install*
  asks first: a dialog says, for that skill, which archive is downloaded, where the skill is found, and the exact folder it is
  copied to (a copy, never a link). It reads the index through Kybernos's own relay (`services/skills-index`), so it works for
  every user with no token. The table shows 20 rows a page by default (20 / 50 / 100 / 250 in the bar), with the pager under it only; the
  SKILL and INSTALLATIONS headers sort the rows of the page (a second click flips the direction: the index itself is ranked by the
  upstream, so the order applies to the rows loaded); each row says **installed** or carries an *Install* button (which asks first).
- **Team**: a Team's private catalogue (contract: `docs/dev/team-skills-contract.md`). *Approved* skills with Install, Update (only
  over a team skill nobody edited), or "You have your own" when a skill of that name is yours; a skill opens on its files and an
  install panel. *My proposals* (with Withdraw, and the admin's note on a refusal) and a *Propose a skill* sheet that reads one of
  your skills, shows the files and the checks (text only, no secret) and sends it. For an owner or admin: *To review*, each proposal
  with its files and, for an update, what changed line by line, a warning when it comes with a script, Approve or Reject… with a
  note (an approval cannot edit the files); *Retired*, and *Retire from the team* on a skill's page. The tab is a lock with the
  reason when you are not signed in, not on the Team plan, or in a personal workspace, and it is hidden when `kybernos-cloud` is not
  loaded. It reads the account and the active workspace through `/kybernos-cloud/team/skills*`.
- **Add**: *Create a skill* (name, description, when to use, body, "do not announce to the model") and *Import from GitHub*
  (`owner/repo` + skill name). Strings are fr/en (`locale` service, falling back to `localStorage` `kybernos.theme.lang`, then `<html lang>`).

## Host routes

All under `/kybernos-skills/`, JSON; refusals come back as HTTP 200 `{ok:false, error}`, where `error` is a snake_case **code** (`invalid_name`, `root_not_allowed`, `index_unavailable`…) plus the facts its sentence needs (`source`, `name`, `http`, `max`…). The host never words a refusal: the screen does, in French and English (`he.<code>` in `client.js`; `test-client-strings.mjs` fails on a code without a sentence).

| Route | Does |
| --- | --- |
| `GET skills?q=&sessionId=` | registry skills (active) plus disabled ones: `{skills[], roots[], complete}` |
| `GET status` | writable roots, which registry answered |
| `GET index?view=all-time\|trending\|hot&page=&perPage=` | paginated skills.sh ranking (`perPage` ≤ 500) |
| `GET search?q=&limit=` · `GET curated` · `GET audit?source=&skill=` | search (q ≥ 2 chars, limit ≤ 100) · first-party set · audits |
| `POST toggle {root,name,active}` | renames `SKILL.md` ⇄ `SKILL.md.disabled` |
| `POST create {root?,name,description,whenToUse?,body?,modelInvocable?}` | writes a valid `SKILL.md` |
| `POST install {source,name,root?}` | downloads a GitHub archive, copies the skill folder (answers with the `folder` it sat in) |
| `GET preview?source=&name=` | a Discover card's `folder`, `description` and the start of its `SKILL.md`, read from the repository (listing of its files, then the one file); `found: false` when the repository has no such folder |
| `POST skill/read {root,name}` | the real `SKILL.md` (frontmatter included, 128 KiB cap), the folder, a file count and `actions {reveal, edit, duplicate, delete}`: what the host will accept, so the screen offers nothing it would refuse |
| `POST skill/reveal {root,name,target}` | `target` `folder` or `file`: opens it on this machine (`open`, `open -t`, `xdg-open`, `explorer`; one argument, no shell); refused from another address |
| `POST skill/duplicate {root,name}` | copies a listed skill (a read-only one too) into `<DSH home>/skills/<name>-copy[-n]`, renames `name:` in the frontmatter, leaves links, `.git`, `node_modules` and the Team mark behind |
| `POST skill/delete {root,name}` | removes the folder of a skill whose real path is inside a writable root; refuses a link, a root, a folder with no `SKILL.md` |
| `GET learned` · `GET learned/journal?limit=` | the suggestions Kaby made (with their checks), the skills accepted from them, and the journal with whether its hash chain holds (`docs/dev/learned-skills.md`) |
| `POST learned/from-lessons {lessons}` · `learned/accept {id,description?,body?}` · `learned/edit` · `learned/discard {id}` · `learned/restore {id}` · `learned/undo {name}` | a suggestion waits in a ledger, **not in the skills folder**; Accept writes the skill (never over an existing folder), keeps version 1 and journals; Discard keeps 30 days; Undo works only while `SKILL.md` is still the text that was written |
| `GET learned/settings` · `POST learned/settings/set {mode?,threshold?,cap?,notify?,privOk?}` · `GET learned/session?sessionId=` · `POST learned/keep {name}` · `POST learned/stop` | V1: what Kaby may do alone (**Settings › Learned skills**, `ask` by default), what happened to skills in one chat, « I read it, keep it », and the kill switch (every automatic change of the last 7 days goes back) |
| `GET learned/notice?sessionId=` · `POST learned/notice/answer` · `GET learned/notice/list` · `POST learned/notice/forget` · `GET learned/week?sessionId=` · `POST learned/week/hide` · `POST learned/shared {name}` | V2: a task the person asks again is noticed (rules on the chat index of Search everywhere, once a day at most), the weekly card of a blank chat, and « I proposed it to the team » (`docs/dev/learned-skills.md`) |
| `GET picks` | the picks Kybernos proposes (`featured-picks.json`, checked by `featured-picks.mjs`), each with a cover URL only when its file exists |
| `GET featured` · `POST featured/toggle` · `GET cover/<name>` | Featured list and cover images |
| `GET index-source` · `POST index-source/set {url}` | which relay the Discover index is read from (`origin`: `default`, `setting` or `env`; `editable: false` while the variable decides), and the setting that names another one (an empty `url` puts the default back) |
| `POST team/pack {root,name}` | reads a skill of a writable root into a Team proposal: text files only, no hidden file or symlink, secret scan, the SHA-256 version |
| `POST team/install {root?,name,version,files,teamId?,replace?}` | writes a Team skill (checks every path and the version first), atomically, **never over an existing folder** — except `replace: true` over a team skill whose files still hash to the version it was installed at |

## Files, settings, env

- `<DSH home>/kybernos/skills-learned.json` (the ledger of suggestions and of what was accepted, 0600), `skills-learned.audit.jsonl` (the journal,
  append-only, each line hashed with the one before) and `skills-learned-versions/<name>/<n>.md` (the text as accepted, last 10 per skill, 90 days).
  V1 adds `skills-learned-settings.json` (the person's level, line, weekly limit, notice, Law/Health unlock; `breaker` is the host's) and
  `skills-learned-sessions.json` (per chat: did it reach the outside world, names only). `learned-score.mjs` (the score by rules and the hard stops),
  `learned-settings.mjs`, `learned-taint.mjs`, `learned-tools.mjs`, and for V2 `learned-repeat.mjs` (the detector and what it remembers, in `skills-learned-notices.json`) and `learned-week.mjs` (the agent tools `skill_propose` / `skill_improve`, the prompt chunk and the two
  watchers) are the V1 host half, mounted guarded part by part from `apply(ctx)`.
  `learned.mjs` is the host half; `globalThis[Symbol.for('kybernos.learned-skills')]` is the frozen seam the automations half (kybernos-plugin) reads at
  call time; `window.__KB_LEARNED__` (`count`, `subscribe`, `refresh`) is what the menu dot and the lessons page read from the page half.

- Reads the roots DSH's registry resolves (project, custom, user, bundled). **Writes only** `~/.dsh/skills` and
  `~/.agents/skills`; writability is judged on the real path (a symlink leaving the root stays visible but read-only).
- `~/.dsh/kybernos-skills.json`: journal of the last 50 toggles (0600); not a source of truth (active = `SKILL.md` present).
- `<skill folder>/.kybernos-team.json`: written by a Team install (the approved version and the team skill id, hidden, never part of what a proposal sends); it lets the catalogue say `teamVersion` and `teamModified` and lets Update replace a folder nobody edited.
- `~/.dsh/kybernos/skills-index.json` (0600): the relay the user named on the Discover tab (`{version, url, updatedAt}`); absent = the Kybernos relay.
- `~/.dsh/kybernos/skills-featured.json` (0600) and `~/.dsh/kybernos/skills-featured/<name>.{png,webp,jpg,jpeg,svg}` (covers). The covers
  of the picks live there too, one transparent WebP per pick (`<id>.webp`, about 130 KB). They are **not in the repository** (AGENTS rule 4):
  a pick without its file draws a tile unless the host can fetch it: a pick ships the SHA-256 of its cover, and the cover route asks the relay
  for `<relay>/covers/<id>.webp` once (never more often than every ten minutes after a failure), keeps the file only if its bytes are a
  WebP of the shipped hash, and otherwise leaves the tile. `node scripts/prepare-covers.mjs --write-picks` records the hashes.
- `featured-picks.json` (shipped with the package): the 24 picks — id, source repository, category, title / outcome / example in English
  and French, `needs`, install count and audit verdicts read from skills.sh on `asOf`. A pick is only listed if no provider's audit is in
  failure and if the host's own install route installs it (`test-picks.mjs` guards the first; the second was checked by installing all 24).
- Reads the first event of `<DSH_HOME or ~/.dsh>/sessions/<project>/<session>/session.v3.jsonl.zstd` to learn an idle session's
  folder (so its project skills show). Temp dir `kybernos-skill-*` during install. Env: `DSH_HOME`, and optionally `KYBERNOS_SKILLS_INDEX_URL` (below).

## DSH seams, network

- Host: `ctx.inject(['webServer', 'skills'])`, so DSH's skill registry (`ctx.get('skills')`: `snapshot`, `invalidateCache`) is a
  hard dependency; optional `agents.roots()` and `agentPresets` (`standingKeyFor`, `serviceFor(agent,'skills')`) pick the right
  project view. Not verified on the oldest DSH of `dsh-compat.json`. Client: slot `main.kybernos-skills`, services `slots` and
  `locale`; no `ctx.remote` use. `package.json` injects seven DSH client services, only those two are used.
- Network, four fixed hosts, no caller URL followed: `https://codeload.github.com` (install; `source` must match `owner/repo`),
  `https://api.github.com` and `https://raw.githubusercontent.com` (the preview of a Discover card: the listing of one repository's
  files, then one `SKILL.md` of it; anonymous, read-only, answers kept five minutes, the 60-an-hour anonymous limit is reported
  as such and never retried; the file path comes from that listing) and
  `https://skills.kybernos.app/v1` (index, search, curated, audits; a bare GET, no credential; good answers cached
  5 min in memory). That is Kybernos's relay of the skills.sh API (`services/skills-index`, which holds the one Vercel token and
  caches answers at the CDN). Another relay is named by the `KYBERNOS_SKILLS_INDEX_URL` variable or by the setting on the Discover
  tab (**Source › Change**; the page shows which relay is in use): https, or http on a loopback address, no user name or password,
  no query or fragment — **one validator for both**. The variable wins; a value that is set but invalid (either way, a damaged
  settings file included) refuses the call and never falls back to the default. The answer is still read with a size cap, no
  credential is sent whatever the relay, and what one relay answered is never served for another. It also runs `tar`. If the
  relay is down, *Yours* and GitHub import still work and *Discover* says so, with **Try again** (one automatic second attempt
  first, for a 5xx or a network blink) and **Change** (the source).
- `generer-pochettes.mjs` (manual, optional) draws Featured covers through an Alibaba image endpoint, with a `qwen-token-plan`
  key read from `~/.dsh/kybernos-models/providers.json`.

## Tests

`node packages/kybernos-skills/test-picks.mjs` covers the Featured picks: the reader (what it keeps and drops), the shipped file (24 valid picks,
both languages, no audit in failure), the `picks` route with its cover URLs, and the card on the screen (source level).

`node packages/kybernos-skills/test-origin.mjs` covers the POST same-origin guard, unit by unit and through the eleven POST routes
mounted on a fake context. `test-skill-routes.mjs` covers the panel's host half on a throw-away home (read, open, duplicate, delete,
the preview against a stub of the two GitHub hosts). `test-ui.mjs` renders the screen with a few lines of React and a fake host:
the panel next to the list, the actions only when the host lists them, a delete and an install that ask first, every Discover card
with its own detail, the publisher by repository. `test-index.mjs` covers the Discover routes against a local stand-in for the relay (what is asked,
that no credential is sent, failures not cached, the address override and the saved setting: same validation, the variable wins, a damaged file is refused, a change drops the cache). `test-dsh-home.mjs` covers `DSH_HOME`. `test-client-strings.mjs` checks the client's words (every key in French and English, every answer word has a sentence). `test-team-skills.mjs` covers the Team skills rules (version, validation, secret scan), the disk half of `team/pack` and `team/install`, the team mark and the replace-only-if-untouched swap, on a throw-away HOME (`docs/dev/team-skills-contract.md`). The install, create
and toggle logic is not tested; CI also syntax-checks the bundle (`node --check packages/kybernos-skills/*.js`).
The host exports its functions "for the harness" (`catalogueOf`, `toggleSkill`, `createSkill`, `installSkill`, …) but no other
harness is in this repo.

## Known limits

- The `index.js` header says "ten routes"; 12 are mounted (Featured and covers came later).
- DSH serves plugin routes before its own auth, so the POST guard (`sameOrigin`, same rule as `sameOriginStrict` in the core) requires
  an `Origin` (or a `Referer`) from this machine, compared with the socket's real listening address and not with the `Host` header.
  It cannot stop a local process that forges an `Origin`: only authentication would. The GET routes have no guard.
- *Delete* is permanent (no trash) and only reaches a skill folder inside `~/.dsh/skills` or `~/.agents/skills`; *Open folder* and
  *Edit* open a window on the machine DSH runs on, so a DSH reached from another address is not offered them. *Edit* hands
  `SKILL.md` to the machine's text editor: there is no in-app editor (a save route would have to keep the frontmatter valid, or the
  skill drops out of the registry).
- The Discover preview reads GitHub anonymously: 60 requests an hour per address. A limit is said as such, and what the panel
  cannot show (folder, description, text) is not shown; Install still searches the whole archive.
- Install copies with `dereference: true`: a symlink inside a downloaded repo would be followed (not tested). Skill content is
  third party; DSH does not audit it, the skills.sh verdicts are shown.
- `generer-pochettes.mjs` reads `providers.json`, which no bundle here writes.
