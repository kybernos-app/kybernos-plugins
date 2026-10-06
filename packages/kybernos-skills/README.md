# `@local/kybernos-skills`

The **Skills** screen of Kybernos: list the skills DSH knows about, switch them on and off, create one, and find and
install more from the public skills.sh index. The catalogue comes from DSH's own skill registry, not from folder scans.

It is part of the **socle** (`socle: true` in `packages/kybernos-hub/catalog.json`): always on.

## What the user sees

- The **Skills** tab of the Kybernos *Resources* page. The bundle fills the slot `main.kybernos-skills`, which
  `@local/kybernos` (core) declares and mounts; with this bundle off, the core falls back to its own skills page.
- **Yours**: skills of this profile, with search, state / source filters, sorting, an active toggle (read-only rows when the
  folder is not writable), a Featured row kept by a star, a detail card, and a copy of the invocation to paste in the composer.
- **Discover**: the skills.sh ranking (all-time / trending / hot), search, the first-party "curated" set, security audits of a
  skill, one-click install of GitHub-hosted skills. It reads the index through Kybernos's own relay (`services/skills-index`), so
  it works for every user with no token.
- **Add**: *Create a skill* (name, description, when to use, body, "do not announce to the model") and *Import from GitHub*
  (`owner/repo` + skill name). Strings are fr/en (`locale` service, falling back to `localStorage` `kybernos.theme.lang`, then `<html lang>`).

## Host routes

All under `/kybernos-skills/`, JSON; refusals come back as HTTP 200 `{ok:false, error}`.

| Route | Does |
| --- | --- |
| `GET skills?q=&sessionId=` | registry skills (active) plus disabled ones: `{skills[], roots[], complete}` |
| `GET status` | writable roots, which registry answered |
| `GET index?view=all-time\|trending\|hot&page=&perPage=` | paginated skills.sh ranking (`perPage` ≤ 500) |
| `GET search?q=&limit=` · `GET curated` · `GET audit?source=&skill=` | search (q ≥ 2 chars, limit ≤ 100) · first-party set · audits |
| `POST toggle {root,name,active}` | renames `SKILL.md` ⇄ `SKILL.md.disabled` |
| `POST create {root?,name,description,whenToUse?,body?,modelInvocable?}` | writes a valid `SKILL.md` |
| `POST install {source,name,root?}` | downloads a GitHub archive, copies the skill folder |
| `GET featured` · `POST featured/toggle` · `GET cover/<name>` | Featured list and cover images |

## Files, settings, env

- Reads the roots DSH's registry resolves (project, custom, user, bundled). **Writes only** `~/.dsh/skills` and
  `~/.agents/skills`; writability is judged on the real path (a symlink leaving the root stays visible but read-only).
- `~/.dsh/kybernos-skills.json`: journal of the last 50 toggles (0600); not a source of truth (active = `SKILL.md` present).
- `~/.dsh/kybernos/skills-featured.json` (0600) and `~/.dsh/kybernos/skills-featured/<name>.{png,webp,jpg,jpeg,svg}` (covers).
- Reads the first event of `<DSH_HOME or ~/.dsh>/sessions/<project>/<session>/session.v3.jsonl.zstd` to learn an idle session's
  folder (so its project skills show). Temp dir `kybernos-skill-*` during install. Env: `DSH_HOME`, and optionally `KYBERNOS_SKILLS_INDEX_URL` (below).

## DSH seams, network

- Host: `ctx.inject(['webServer', 'skills'])`, so DSH's skill registry (`ctx.get('skills')`: `snapshot`, `invalidateCache`) is a
  hard dependency; optional `agents.roots()` and `agentPresets` (`standingKeyFor`, `serviceFor(agent,'skills')`) pick the right
  project view. Not verified on the oldest DSH of `dsh-compat.json`. Client: slot `main.kybernos-skills`, services `slots` and
  `locale`; no `ctx.remote` use. `package.json` injects seven DSH client services, only those two are used.
- Network, two fixed hosts, no caller URL followed: `https://codeload.github.com` (install; `source` must match `owner/repo`) and
  `https://kybernos-skills-index.vercel.app/v1` (index, search, curated, audits; a bare GET, no credential; good answers cached
  5 min in memory). That is Kybernos's relay of the skills.sh API (`services/skills-index`, which holds the one Vercel token and
  caches answers at the CDN). `KYBERNOS_SKILLS_INDEX_URL` points DSH at another relay (https, or http on a loopback address): a
  value that is set but invalid refuses the call and never falls back to the default. It also runs `tar`. If the relay is down,
  *Yours* and GitHub import still work and *Discover* says the index is unavailable.
- `generer-pochettes.mjs` (manual, optional) draws Featured covers through an Alibaba image endpoint, with a `qwen-token-plan`
  key read from `~/.dsh/kybernos-models/providers.json`.

## Tests

`node packages/kybernos-skills/test-origin.mjs` covers the POST same-origin guard, unit by unit and through the four POST routes
mounted on a fake context. `test-index.mjs` covers the Discover routes against a local stand-in for the relay (what is asked,
that no credential is sent, failures not cached, the address override). `test-dsh-home.mjs` covers `DSH_HOME`. The install, create
and toggle logic is not tested; CI also syntax-checks the bundle (`node --check packages/kybernos-skills/*.js`).
The host exports its functions "for the harness" (`catalogueOf`, `toggleSkill`, `createSkill`, `installSkill`, …) but no other
harness is in this repo.

## Known limits

- The `index.js` header says "ten routes"; 12 are mounted (Featured and covers came later).
- DSH serves plugin routes before its own auth, so the POST guard (`sameOrigin`, same rule as `sameOriginStrict` in the core) requires
  an `Origin` (or a `Referer`) from this machine, compared with the socket's real listening address and not with the `Host` header.
  It cannot stop a local process that forges an `Origin`: only authentication would. The GET routes have no guard.
- Install copies with `dereference: true`: a symlink inside a downloaded repo would be followed (not tested). Skill content is
  third party; DSH does not audit it, the skills.sh verdicts are shown.
- `generer-pochettes.mjs` reads `providers.json`, which no bundle here writes.
