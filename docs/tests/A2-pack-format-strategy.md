> **Naming update (2026-10-28, owner).** The visual layer (earlier "theme": token overlay, presets)
> is now the **style**; the installable sector unit (earlier "sector pack"/"pack") is now the
> **theme**. Code paths stay unchanged (`packages/kybernos-theme`, `theme-presets.json`) until the
> product-rename batch (kybernos-theme → kybernos-style) lands.

# A2-pack-format — test strategy (written before any code)

Batch: `A2-pack-format` — *pack format: theme reference, multi-point merge, host routes, onboarding state*.
Campaign: Phase A of the sector-packs strategy (`docs/etudes/2026-10-27-sector-packs-strategy.md`, sections 3, 4, 8).
Binding contracts: skill `contrat-pack-vertical` (build contract 1-4), `AGENTS.md`, `docs/dev/domain-packs.md`, `docs/dev/plugin-contract.md`.
Triage verdict on disk: `docs/tests/triage.md` (`chemin: complet`).

**Lane: B (standard); status: BLOCKED (fail-closed) on `index.js:30` — see the blocking point below.** No file of this batch touches auth, billing, RLS, migrations or secrets: `plugin.json` gains two `provides` entries and no permission,
`onboarding-state.mjs` is pure, `domain-pack.mjs` is pure, and the only `index.js` lines touched sit in the route zone that already calls
`sameOriginStrict` / `writeRefused` without changing either. Reviewer note: the diff must show **zero** change on those two guards — if it does not, the batch
becomes lane A on the spot.

## Write perimeter (and the one place it bites)

| File | What changes |
|---|---|
| `packages/kybernos-plugin/domain-pack.mjs` | one optional pack key, two point definitions + validators, the kit merge, `packsOf` |
| `packages/kybernos-plugin/index.js` | route zone only: `domainPacks` (`:10707-10715`), boot-time `definePoint` (`:10716`), the onboarding POST echo (`:10775-10777`) |
| `packages/kybernos-plugin/onboarding-state.mjs` | `theme` field: `defaultState` `:92-106`, `publicView` `:109-121`, `complete` `:124-145` |
| `packages/kybernos-plugin/plugin.json` | `provides` `:30-41` gains two entries |
| `packages/kybernos-plugin/test-domain-pack.mjs` | new checks; `loadPacks` at `:181` stays; the shipped-set assertions at `:257`, `:290` and `:322-327` are widened by interpretation 11 |
| `packages/kybernos-plugin/test-onboarding-state.mjs` | new checks on the `theme` field |

**Status: BLOCKED (fail-closed) — no code is written until the human answers.** The delegation's perimeter is the routes zone (`~10694-10790`) only, but `index.js:30` is the single import line from `domain-pack.mjs` and the two new points plus `packsOf` cannot reach the host without a name added to it.
This document does not grant itself the line: `:30` is **outside** the granted perimeter, so every DoD below stays red by construction and none may be claimed. The human chooses: (a) **grant one line at `:30`** (recommended: not a route, not a guard, no behaviour), or
(b) **re-scope** to the library-only half — `theme` key, the two validators, the merge and the onboarding field, with no host wiring (no observable route change; the `e2e:` 2-4 of this spec drops with it).
No honest third way: `domainPacks()` is synchronous, so a dynamic `import()` inside the zone cannot feed it, and abusing a property of `DOMAIN_POINT` would be an invented seam. This is the first AMBIGUITY below;
until it is answered, no file of this batch is written, no DoD is claimed, and the batch report says **blocked**.

## Verified anchors (read in the tree, not remembered)

- `domain-pack.mjs:71` — the `only()` key list of a pack (14 keys today); `:76` — `accent` is one `#rrggbb`; `:35` `TEAM_RE`, `:37` `COLOR_RE`, `:23` `ICONS`.
- `domain-pack.mjs:230-233` — `DOMAIN_POINT` (owner `kybernos/core`, version `1.0`, kind `data`, class `instruction`, `max: 12`), `DOMAIN_POINT_REF`, `CONTRIBUTED_ORDER {min:50,max:98}`.
- `domain-pack.mjs:240-253` — `mergePackSets(shipped, contributions)`: id collision refused, legacy-job clash refused, order clamped `:249`, re-sorted `:251`.
- `index.js:10707-10715` — `domainPacks()`: `registry.definePoint(DOMAIN_POINT)` then `mergePackSets(shipped, registry.contributions(DOMAIN_POINT_REF))`, `catch` → shipped only.
- `index.js:10716` — boot-time `definePoint`; `:10717-10721` — `GET /kybernos/domains` (`{ ok, packs, rejected }`); `:10725-10740` — `POST /kybernos/domain/skill`
  ("only a name some pack lists as bundled is accepted", `:10733-10734`); `:10741-10778` — `/kybernos/onboarding` GET (`:10749` spreads `...view`) and POST (`:10773-10777`).
- `onboarding-state.mjs:6-11` — the comment that keeps `ONBOARDING_VERSION = 1`, and the constant; `:92-106` `defaultState`; `:109-121` `publicView`; `:124-145` `complete`
  (keeps a saved value when the client sends none, as `agents` does at `:142`); `:148-151` `chooseDomain`; `:154` `replay`.
- `test-domain-pack.mjs:181` — `loadPacks(join(here, 'domains'))` (the real folder); `:257` — the exact shipped id list in order; `:322-327` — the hardcoded file list of the
  "no path, no markup" check; `:330-339` — manifest ↔ code sync (`DOMAIN_POINT_REF`, version/class/kind, `OWNER_VERSION` major); `:370-399` — the end-to-end on a real
  profile + real `createRegistry` (consent gate `:388-390`); `:401` — `42 checks passed`.
- `test-onboarding-state.mjs:21-30` — an older file still reads `completed: true`; `:125-134` — the `agents` precedent for an added field; `:163` — `18 checks passed`.
- `registry.mjs:199-210` — `definePoint` (`version "x.y"`, `kind 'data'`, class in `['inert','instruction']`, `validate`), idempotent (`:207`); `:204` — `max` falls back
  to `LIMITS.files` (32); `:241` — a folder over `point.max` files is truncated and reported; `:274-276` — a plugin contributing to an `instruction` point needs consent.
- `registry.mjs:297-344` — the seam: `definePoint`, `contributions(ref)` → `[{ plugin, level, class, file, value }]` (with `file` = `dir/name.json`).
- `plugin-contract.md:93` (a `provides` entry: `{ name, version, kind, class?, summary?, schema?, validator? }`), `:197` (one of schema / `validator: "builtin"`),
  `:263-272` (the point table: `kybernos/core#team-template` and `kybernos/core#automation-template` are listed as "Today: `KB_MARKET_TEAMS` / a block in the core client").
- `docs/dev/domain-packs.md:65-75` — what applying a pack does (skills → the two routes, teams → `kybers/create`, automations → `POST /kybernos/tasks {active:false}`);
  `:108` — the row "Theme per field … **next**" this campaign closes.
- Team template vocabulary cited from `client.js:23303-23361` (`KB_MARKET_TEAMS`: `id, name, color, icon, category, desc, mission, topology, tags, skills, roles[{id,kind,provider,model,prompt}], stages[{id,roles,mode,cap,gate,inputs}]`)
  and `client.js:5914` — `FORMES = ['pool', 'pipeline', 'adversarial', 'mapreduce', 'loop']`.
- Automation template vocabulary cited from `client.js:7814-7830` (`KB_TPLS`: `id, cat, icon, title, cadence, cron, desc, tags, apps, steps[[kind, pair]], needs, guard, ask[{q,o}]`)
  and `test-automation-templates.mjs:36` (the field list), `:29` (the four `cat` ids of `KB_TPL_CATS`, `client.js:7808`), `:42` (a step is `ai` or `act`, 2-6 per template), `:43` (2-4 questions, at least two options each), `:44` (needs, tags and apps are non-empty), `:46` (a template with no cron says webhook in its cadence).
- Theme ids: `preset-store.mjs:26` `ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/`; `:43-52` `SETTINGS_KEYS` (`acc`, `fontText`, `radius`…); `:92-115` `sanitizePreset`.

## Interpretations (the request admits several; chosen + why)

1. **The `theme` key is a reference, not a payload.** A pack carries **one** string id (`/^[a-z0-9][a-z0-9-]{0,40}$/`, the same vocabulary as `TEAM_RE` at
   `domain-pack.mjs:35`), never settings bytes, never CSS. Chosen because build contract 3 makes the theme a token overlay and because §4.2 of the strategy keeps
   Settings › Style as the last word; the host must not copy a preset into a pack file.
   *Rejected alternative:* carrying the settings inline in the pack (would make the pack a theme store and re-open free CSS).
2. **The id is checked by shape only; its existence is resolved when it is applied.** A pack must not become invalid because the person deleted a preset — that
   would turn a data plugin into a 5xx or a greyed card. Chosen because `domain-pack.mjs` validates statelessly (`:68`) and has no access to `<DSH home>`.
3. **`theme` travels in the served payload as `null` when absent**, exactly like `order` defaults to 50 and `mode` to `bureau` (`domain-pack.mjs:187`). A `null`
   is easier to read for the wizard than a missing key.
4. **The kit merge attaches to the contributing plugin's own pack, under a new `kit` key, and never mutates authored goals.** A contribution whose `plugin` has
   no offered pack is **reported** in `rejected`, not silently dropped (the repo's habit: a file that fails is left out *and* reported, `domain-pack.mjs:7`).
   Chosen over "append the ids into `goal.teams` / `goal.automations`" because that would rewrite data the pack author wrote and would invent journey logic
   host-side (build contract 1-2). The alternative is a wire change for the wizard — see the kit-wire DECISION below.
5. **`pack.kit` appears only when something was contributed.** With no contribution the payload is byte-identical to today, which is what the "unchanged" DoD
   relies on and what keeps every existing client working.
6. **The four folders are reached through one table, `KIT_POINTS`, and only two of them are owned here.** `teams/` and `automations/` are validated in this batch;
   `themes/` (`kybernos/theme#theme`, batch A1-theme-seam) and `skills/` (`kybernos/skills#skill`, batch A2-registry-points) are listed by reference only — an
   unregistered point contributes `[]` (`registry.mjs:328`), so their absence changes nothing. No cross-bundle import, ever.
7. **`theme` in `publicView` is public.** It sits with `profil`, `model` and `agents` (`onboarding-state.mjs:109-121`), not with `about` and `customGoals`
   (private because they are typed personal text, `:49-52`, `:66-68`). A preset id is not personal text. See AMBIGUITY 5.
8. **`theme` is kept when a client sends none, and cleared by no one** in this batch (`agents` semantics, `:142`). Removing a theme is Settings › Style's job,
   not the wizard's.
9. **`chooseDomain` does not touch `theme`.** Choosing a field later changes the field and the goals, nothing else (its comment, `:147`).
10. **Numeric bounds marked "(proposal)" below are pack-format decisions of this batch**, not product constants: they are labelled as required by build
    contract 4 because no existing file fixes them. Their *shape* is cited; their *number* is ours, and the human may change a number without changing a test's intent.
11. **The shipped-set assertions at `test-domain-pack.mjs:257`, `:290` and `:322-327` are made A3-proof inside this batch's own file**: `:257` keeps the nine current ids in their current relative order with `general` last, extras allowed anywhere (order guard kept, exact list dropped);
    `:290` (today an exact nine-id `agents.preset` map, read on disk) keeps the nine `id → preset` pairs and requires every further pack's preset to be one of `PRESETS`; `:322-327` iterates the packs `loadPacks` really returned (a tenth file is swept too).
    Chosen because A3's tenth pack would otherwise redden `:257` **and** `:290`, and A3 may not write this file.

## AMBIGUITY (the human arbitrates; the batch cannot settle these silently)

AMBIGUITY: **`index.js:30` vs the write perimeter** — grant one import line, or re-scope the batch; fail-closed until the human answers (blocking point above), because without it the two new points cannot be defined in the host.
**DECISION (was AMBIGUITY 2) — the kit wire is `pack.kit = { themes?, skills?, teams?, automations? }`; authored goals are never mutated.** The consumer is **recorded as deferred**, not left open: batch A1-kit-wizard measures that the wizard reads no `pack.kit` today and will render contributed kit rows only in a later phase (`docs/tests/A1-kit-wizard-strategy.md:81-89`).
This phase therefore serves and tests the slices; the contract for the phase that consumes them is frozen here — read this shape verbatim, no second wire, no mutation of `goal.teams`/`goal.automations`.
AMBIGUITY: **the interface catalogue** — the delegation cites "interface I1" and "interface I4"; no file under `docs/` defines an interface list (searched).
This document therefore *is* the wire: pack `theme` (I4, the onboarding field) and the `kit` slices (I1, what the wizard resolves). If the campaign keeps an
interface catalogue elsewhere, it must be published in the repo or the labels retired.
AMBIGUITY: **the theme id vocabulary** — the pack regex `/^[a-z0-9][a-z0-9-]{0,40}$/` is *narrower* than the preset store's `ID_RE`
(`/^[a-z0-9][a-z0-9-]{0,63}$/`, `preset-store.mjs:26`), so a preset whose id is 41-63 characters can never be named by a pack. Widen the pack key to 63, or
accept that such a preset is unreferenceable. This batch implements 40 (the delegation's letter) and states the consequence.
AMBIGUITY: **`theme` is served by the pre-sign-in GET** — `GET /kybernos/onboarding` is answered before DSH's own sign-in (`onboarding-state.mjs:51-52`).
Choosing "public" (interpretation 7) means any local page can read which style preset the person picked. It is a real (small) disclosure decision, not a detail.
AMBIGUITY: **who fixes `test-domain-pack.mjs:257` and `:290` when A3 adds a pack** — this batch widens both to relative-order/pair assertions (interpretation 11). If the campaign
prefers the exact-set equality, then A3 needs a one-line exception on a file this batch owns, and the merge order matters.

## Out of scope (what this batch must not do)

- **Applying a theme.** No call into `preset-store.mjs`, no `createPresetStore`, no write of `theme-presets.json`, no `apply` seam: that is batch A1-theme-seam
  (interfaces and the wizard Kit step). This batch only carries an id and remembers it.
- **Declaring `kybernos/theme#theme` or `kybernos/skills#skill`**, and any `themes/` or `skills/` validator: batch A1-theme-seam and batch A2-registry-points.
- **Any change to `packages/kybernos-registry/**`** (the folder scan, `manifest.mjs`, `registry.mjs`) — batch A2-registry-points.
- **Any change to `packages/kybernos-plugin/client.js`**: no wizard step, no kit rendering, no miniature, no install call — batch A1-kit-wizard.
- **Any new host route.** The three families stay the three families (`/kybernos/domains`, `/kybernos/domain/skill`, `/kybernos/onboarding`); the new data rides
  in their existing payloads (repo rule 1: zero new engine patch, and the delegation forbids new route families).
- **Pack content**: `domains/*.json` and any `catalog/**` (batch A3-vertical-content). The two shipped sectors of A3 (`sante` exists today; the recruitment pack
  does not) are not touched here — the DoD only asserts this batch leaves every real pack file loadable and in order.
- **A new pack key other than `theme`**; a second accent; an `a11y` key; free CSS; a fonts URL. All of them stay refused (`domain-pack.mjs:71`, `:45`).
- **Raising `ONBOARDING_VERSION`** (`onboarding-state.mjs:6-11`: it would reopen the wizard for everyone).
- **The starter template and the "Build a theme" page** — batch A4-starter-docs.
- **i18n of the new strings** beyond the pack's own language objects (`LANGS`, `domain-pack.mjs:18`); no new UI string is introduced here.
- **Per-goal enforcement of the kit bounds.** Templates are bounded *per file*; a goal is not re-counted against `LIMITS` (`:28`).

## The format this batch freezes

**Final pack key list (15 keys, `domain-pack.mjs:71` + `theme`).** `v`, `id`, `order`, **`theme`**, `accent`, `icon`, `name`, `tagline`, `keywords`, `home`,
`legacyJobs`, `menu`, `mode`, `agents`, `goals`. `theme` is optional, one string, `/^[a-z0-9][a-z0-9-]{0,40}$/`, read as `null` when absent. Everything else in
`:71-77` is unchanged; an unknown key is still an error, never trimmed (`:45`).

**`plugin.json` provides block added after the existing entry (`:30-41`).** Exactly these two objects; `name` must satisfy the manifest schema
(`^[a-z][a-z0-9-]{1,31}$`, `docs/dev/schemas/plugin.schema.json`), `version` is `x.y`, `class` is required for a data point:

```json
{
  "name": "team-template",
  "version": "1.0",
  "kind": "data",
  "class": "instruction",
  "validator": "builtin",
  "summary": { "en": "A ready-made Agent Team a pack can offer in its kit: roles, stages, bounded prompts." }
},
{
  "name": "automation-template",
  "version": "1.0",
  "kind": "data",
  "class": "instruction",
  "validator": "builtin",
  "summary": { "en": "A ready-made automation a pack can offer in its kit, always created switched off." }
}
```

`summary` is a localized object with `en` (as the existing entry at `:37-39`); no `fr` is required for a first-party plugin here (the manifest schema asks for
`en` only through `text160`). No `permissions`, `claims` or `requires` change: the two points belong to the owner the manifest already declares.

**Merge rules for the four contribution folders.** One table in `domain-pack.mjs`:

| Folder | Point ref | Owner | Validator | Slice written into the pack | This batch |
|---|---|---|---|---|---|
| `themes/` | `kybernos/theme#theme` | `kybernos/theme` | batch A1-theme-seam | `kit.themes` | reference only |
| `skills/` | `kybernos/skills#skill` | `kybernos/skills` | batch A2-registry-points | `kit.skills` | reference only |
| `teams/` | `kybernos/core#team-template` | `kybernos/core` | **here** (`validateTeamTemplate`) | `kit.teams` | owned |
| `automations/` | `kybernos/core#automation-template` | `kybernos/core` | **here** (`validateAutomationTemplate`) | `kit.automations` | owned |

Join rule: a contribution `{ plugin, file, value }` reaches **only** the packs whose `from` equals `plugin` (`mergePackSets` sets `from` at `:249`). A shipped pack
(`from === undefined`) never receives a `kit`. The file's name without `.json` is the template's `id` (`validateTeamTemplate(raw, fileId)` mirrors
`validatePack(raw, fileId)`, `:68-74`). Entries are sorted by `(from, file)` so the payload is stable. Each entry is flat, citable (build contract 4):
`{ ...value, from: plugin, file: 'teams/x.json' }`. A contributed template whose `plugin` ships no offered pack becomes
`{ file: '<plugin>:<file>', errors: ['no pack of <plugin> is offered: the template would go nowhere'] }` in `rejected`. `max: 12` files per point (proposal,
mirrors `DOMAIN_POINT.max` at `:230`, under the registry ceiling at `:204`). `CONTRIBUTED_ORDER` keeps applying to **packs only** (`:249`).

**`teams/` — accepted shape** (subset of `KB_MARKET_TEAMS`, `client.js:23303-23361`; every text is a pack text object, `en` required, `LIMITS.text` 160 unless noted):

| Field | Rule |
|---|---|
| `id` | `TEAM_RE` (`:35`), must equal the file name |
| `name`, `desc`, `mission` | `textOf` — required for `name`, optional otherwise |
| `topology` | one of `pool`, `pipeline`, `adversarial`, `mapreduce`, `loop` (`client.js:5914`) |
| `tags` | 0-6 lower-case words (`KEYWORD_RE`, `:40`) |
| `roles` | 1-6 objects `{ id (ID_RE), kind ('scout'|'doer'|'checker'), prompt (textOf, `LIMITS.prompt` 900), provider?, model? (tokens) }`, ids unique (bound: proposal; the three shipped teams use 3-5) |
| `stages` | 1-6 objects `{ id, roles (ids declared above, ≥1), mode ('once'|'forEach'), cap (integer 1-8), gate (boolean), inputs (stage ids declared earlier) }` (bound: proposal; the shipped teams use 3) |
| `skills` | 0-6 skill names (`SKILL_RE`, `:31`) (bound: proposal) |
| `color`, `icon`, `category` | optional: `COLOR_RE` (`:37`), `ICONS` (`:23`), a lower-case token |

Refusals: unknown key, any non-plain value, an HTML angle bracket (`textOf`, `:55`), a role count of 0, a stage naming a role or a stage that does not exist, an
empty prompt, an id that is not the file name.

**`automations/` — accepted shape** (subset of `KB_TPLS`, `client.js:7814-7830`; `steps[0]` is a kind, the rest are texts):

| Field | Rule |
|---|---|
| `id` | `ID_RE` (`:30`), must equal the file name |
| `cat`, `icon` | optional tokens (`KB_TPL_CATS` ids today: `social`, `prospecting`, `support`, `skills`, `test-automation-templates.mjs:29`) |
| `title`, `cadence`, `desc` | `textOf`, `title` and `desc` required |
| `cron` | optional, `CRON_RE` (`:39`); absent means the cadence carries the trigger, as at `client.js:7815` |
| `tags` | 1-6 lower-case words (`test-automation-templates.mjs:44`) |
| `apps` | 1-4 app slugs (`APP_RE`, `:34`, `test-automation-templates.mjs:44`) |
| `steps` | 2-6 objects `{ kind ('ai'|'act'), text (textOf, `LIMITS.prompt` 900) }` (`test-automation-templates.mjs:42`) |
| `needs` | 1-4 texts: what the person must have (`test-automation-templates.mjs:44`) |
| `guard` | **1-4 texts, required** — the "never without approval" lines; the guard is what makes a contributed automation safe (build contract 5) |
| `ask` | 2-4 objects `{ q (textOf), o (2-6 texts) }` (`test-automation-templates.mjs:43`) |

Refusals: unknown key, fewer than 2 or more than 6 `steps`, an empty `guard`, `ask` outside 2-4 questions, `ask.o` under two options, an empty `needs` or
`tags`, a cron with fewer than five fields, an id that is not the file name. The bounds above are **cited from the client's own catalogue test**, not chosen: a
contributed template is drawn and turned into a chat by the same code as a shipped one, so a looser shape would create a second class of template the page cannot
render. One declared divergence: the client's rule "no cron ⇒ the cadence says webhook" (`test-automation-templates.mjs:46`) is **not** enforced here — the
cadence of a pack automation is often a sentence ("every morning at 8") and the wizard creates the schedule itself; if the human wants the rule, it is one
line in the validator.

**Onboarding route change** (`index.js:10741-10778`, inside the perimeter). `publicView` gains `theme`, so `GET` carries it with no route edit (`:10749` spreads
`...view`). `POST {action:"complete"}` already passes the body to `onboardingComplete(state, body)` (`:10773`); the only route edit is the echo, which becomes
`{ ok: true, completed: true, profil, uiMode, model, lang, theme: next.theme, goals, agents }` (`:10775-10777`). `{action:"domain"}` (`:10762-10771`) and
`{action:"replay"}` (`:10758-10761`) do not read `theme`.

e2e: the journey this batch must not break, then the ones it must make possible, anchored on the existing end-to-end block
`test-domain-pack.mjs:370-399`, which builds a real profile (`package.json` + `node_modules/<name>/plugin.json` + an empty `cordis.patch.yml`), constructs a real
`createRegistry`, and walks consent (`:388-390`).

1. **Today's journey, unchanged.** A data plugin with only `domains/` is `needs-consent` while it brings an `instruction` point (`registry.mjs:274-276`); before
   consent `GET /kybernos/domains` offers nothing new; after `setConsent` the pack appears with `from` and the shipped packs keep their order (`:355`), the
   catch-all `general` last (`:356`). Nothing in this batch may move that.
2. **Four folders, one plugin, one pack.** The fixture plugin grows `teams/clinic-assist.json` and `automations/daily-recall.json` (the `themes/` and `skills/`
   folders stay out of the assertion until A1 and A2-registry-points land their points). Expected: still `needs-consent`; after consent the merged pack
   `acme/clinic` carries `kit.teams[0].id === 'clinic-assist'` with `from: 'acme/clinic'` and `file: 'teams/clinic-assist.json'`, `kit.automations[0].id ===
   'daily-recall'`, and **no shipped pack has a `kit` key**.
3. **One bad file, one line, never a 5xx.** A `teams/` file with an unknown key is refused by *its* point (`entry.extends[].rejected`, and the `rejected` list of
   the route payload grows by one) while the good ones still merge — the same fault tolerance as `:397` for packs.
4. **A template for a pack that is not offered** is reported (`no pack of acme/other is offered`) and merges nothing.
5. **A theme the person picked survives a real round trip** on `onboarding.json`: complete with `theme`, reload, `GET` still answers it; an older file (no
   `theme`) still answers `completed: true` with `theme: null`.
6. **A broken registry.** `packsOf(shipped, registryThatThrows)` answers the shipped packs (the existing `catch` at `index.js:10714`), never an error: a bundle
   must never stop DSH from starting (repo rule 2).

Not an e2e in this batch: the wizard's Kit step applying the preset (A1), and any third-party install from a catalogue (phase B). They are written here as
*followed by*, not as owned.

vision: not applicable in this batch, and here is why. No pixel of the product changes: the batch carries data, two validators, one merge table, one route echo and one
state field. The two surfaces the strategy associates with it are drawn elsewhere — the wizard's Kit step and its live miniature belong to
`packages/kybernos-plugin/client.js` (batch A1-kit-wizard, a file this batch is forbidden to write), and the theme itself is applied by the preset store, not by
this code. Reading a screenshot of the wizard today would show the *previous* build and prove nothing about `kit` or `theme`.

What replaces the eye here, and must be in the acceptance evidence: the served payload (`GET /kybernos/domains`) printed once, and the state file
(`onboarding.json`) printed before and after a complete — both quoted in the PR. That is a *citation* test, not a visual one, and it is deterministic.

capture: no capture, declared. No screenshots, no video, no `read_image`: a PNG of an unchanged screen is not evidence, and this batch changes no screen (see
`vision:`). The repo accepts no media in git anyway (`scripts/garde-depot.mjs`, `AGENTS.md` rule 4), so a capture could not even be committed as proof.

The deterministic substitutes, which the batch *must* produce and quote:
- the merged payload for the fixture plugin (`packs[].theme`, `packs[].kit.teams[0]`, and the absence of `kit` on shipped packs);
- the two rejections, verbatim (`teams/x.json: …`, `acme/other:teams/y.json: no pack of acme/other is offered…`);
- `onboarding.json` after `POST {action:"complete", theme:"clinic-teal"}` and after an older file is read.

If the human wants a screen anyway, the only honest one is the A1 wizard Kit step — and it must be captured there, not here.

maquette: not applicable, declared. This batch has no UI to mock up: build contract 2 sends custom screens to Settings and this batch opens no Settings screen; build
contract 3 makes the theme a token overlay, which is a preset id, not a layout. Writing a mockup here would be inventing a screen the campaign did not ask for
(a custom screen smuggled into a pack — exactly what the contract forbids).

The mockups the campaign names (`docs/handoff/vertical-medecin/maquette-v1/`, `docs/handoff/vertical-recrutement-ssii/maquette-v1/`) are **not on this machine** — measured 2026-10-27:
the `dyad-apps/dsh-kybernos` tree is absent, the same absence recorded by `docs/tests/A3-vertical-content-strategy.md` and `A1-kit-wizard-strategy.md:79`. They are not needed here: this batch
never sees them, and the one datum it borrows is the accent rule — one `#rrggbb` per sector (`#1B7F76`, cited by the delegation), never a second colour (`domain-pack.mjs:37`, `:76`).

unit: pure checks, no host, no port, no clock. All of it lives in the two test files this batch owns. Each item says what must be *refused*, because a validator that only
accepts is not a validator.

**`test-domain-pack.mjs` — what is added (≥ 8 new checks; the file must stay green)**

1. *One theme id per pack.* Valid id kept; absent reads `null`; `validatePack(pack, 'demo').pack.theme === 'sante-teal'`.
2. *A bad theme is a theme error.* `'Sante Teal'`, `'-x'`, `'x'.repeat(41)`, `7`, `{}`, `['a']` → `ok: false` **and** an error matching `/^theme: /`, and **no**
   `unknown key` in the list (today's only reason for refusing is the unknown key, `:71` — the test must prove the door opened then closed again).
3. *The door did not widen.* A pack carrying `css`, `accent2`, `a11y` or a second `accent` is still refused with `unknown key` (`:45`), with a valid `theme` present.
4. *Team template check.* The fixture is accepted whole; `topology: 'hive'`, `roles: []`, a stage naming an undeclared role, `name: {}` (no `en`), a 901-character
   prompt, an unknown key, and an id that is not the file name are each refused.
5. *Automation template check.* The fixture is accepted; one step, `guard: []`, `ask[0].o` with one option, `needs: []`, `tags: []`, `cron: '* * * *'`, an unknown key,
   and an id that is not the file name are each refused.
6. *Points ↔ manifest.* Every point in `CORE_POINTS` (`domain-pack.mjs`) has a `provides` entry in `plugin.json` with the same `version`/`class`/`kind`,
   `validator: 'builtin'`, `owner === manifest.id`, and `provides.length === 3` — the existing sync check at `:330-339` generalised, so a fourth point cannot be
   added without its manifest line.
7. *The kit table.* `KIT_POINTS` names the four folders exactly once each, with the two owned here first-class and the two foreign ones referenced only.
8. *The merge, per plugin.* Contributions reach only their own plugin's pack; shipped packs carry no `kit`; the order/`from`/id-collision rules of `:240-253` are
   unchanged when the third argument is omitted (`mergePackSets(shipped, [])` deep-equals `shipped.packs`); a stray plugin is reported.
9. *`packsOf`.* Calls `definePoint` for all three owned points; a registry that throws, or `null`, leaves the shipped packs; the shipped id order is untouched.
10. *The real folder still loads.* `loadPacks(join(here, 'domains'))` (`:181`) — every real file, `rejected` empty, the "no path, no markup" sweep iterating
    what `loadPacks` returned (`:322-327`), and the nine-id order (`:257`) and preset pairs (`:290`) checked as tolerant of an extra pack.
11. *End to end with the real registry* (`:370-399`), extended with `teams/` and `automations/` folders as in `e2e:` 2-4.

**`test-onboarding-state.mjs` — what is added (≥ 2 new checks)**

12. *The field exists and an older file reads it as null.* `defaultState(NOW).theme === null`; `publicView({version:1, completed:true, profil:'produit'}).theme === null`;
    `ONBOARDING_VERSION` still `1` (`:21-30` keeps meaning the same thing).
13. *Round trip and keeping.* `complete(fresh, {theme:'clinic-teal'}).theme === 'clinic-teal'`; `publicView(...).theme` answers it; a later `complete` that sends no
    `theme` keeps it (`agents`, `:142`); `replay` keeps it; `chooseDomain` leaves it alone; `''`, `'Sante Teal'`, `41` chars, `7`, `{}` read `null`.

**Invariants that must not move (checked by the same files, not new)**

- `loadPacks` still returns the nine shipped packs in their relative order, `general` last (`:257`), with their `agents.preset` values (`:290`) — both rewritten as tolerant assertions (interpretation 11), never silently dropped.
- `mergePackSets` id collision / legacy-job clash / `CONTRIBUTED_ORDER` clamp (`:246-249`, `:354-357`) unchanged.
- `POST /kybernos/domain/skill` still refuses any name no pack lists (`index.js:10733-10734`) — untouched zone, no test to add, one line of the PR to show it.

DoD: every command below **was run on the current tree and fails there**; the observed message is quoted next to it (`Failures recorded`). All are deterministic: no
port, no clock, no network, no `<DSH home>` write. Run them from the repository root. A checkbox is ticked only when the command exits 0.

- [ ] **D1 — a pack accepts one theme id, refuses a bad one as a `theme` error.**
  ```
  node --input-type=module -e 'const m = await import("./packages/kybernos-plugin/domain-pack.mjs"); const assert = (await import("node:assert/strict")).default; const pack = (extra) => ({ v: 1, id: "demo", accent: "#1B7F76", icon: "heart", name: { en: "Demo" }, tagline: { en: "T" }, goals: [{ id: "g1", name: { en: "G" }, title: { en: "T" }, desc: { en: "D" }, skills: [{ source: "kybernos", name: "notes", d: { en: "d" } }] }], ...extra }); const ok = m.validatePack(pack({ theme: "sante-teal" }), "demo"); assert.equal(ok.ok, true, JSON.stringify(ok.errors)); assert.equal(ok.pack.theme, "sante-teal"); assert.equal(m.validatePack(pack({}), "demo").pack.theme, null); for (const bad of ["Sante Teal", "-x", "x".repeat(41), 7, {}, ["a"]]) { const r = m.validatePack(pack({ theme: bad }), "demo"); assert.equal(r.ok, false, "accepted " + JSON.stringify(bad)); assert.ok(r.errors.some((e) => /^theme: /.test(e)), JSON.stringify(bad) + " -> " + JSON.stringify(r.errors)) }'
  ```
- [ ] **D2 — an unknown key still refused, with a valid `theme` next to it.**
  ```
  node --input-type=module -e 'const m = await import("./packages/kybernos-plugin/domain-pack.mjs"); const assert = (await import("node:assert/strict")).default; const pack = (extra) => ({ v: 1, id: "demo", accent: "#1B7F76", icon: "heart", name: { en: "Demo" }, tagline: { en: "T" }, theme: "sante-teal", goals: [{ id: "g1", name: { en: "G" }, title: { en: "T" }, desc: { en: "D" }, skills: [{ source: "kybernos", name: "notes", d: { en: "d" } }] }], ...extra }); assert.equal(m.validatePack(pack({}), "demo").ok, true); for (const k of ["css", "accent2", "a11y"]) { const r = m.validatePack(pack({ [k]: "#000000" }), "demo"); assert.equal(r.ok, false, k); assert.ok(r.errors.some((e) => /unknown key/.test(e) && e.indexOf(k) >= 0), k + " -> " + JSON.stringify(r.errors)) }'
  ```
- [ ] **D3 — the `theme` id is remembered by the onboarding state, null on an older file.**
  ```
  node --input-type=module -e 'const s = await import("./packages/kybernos-plugin/onboarding-state.mjs"); const assert = (await import("node:assert/strict")).default; const NOW = new Date("2026-10-27T00:00:00.000Z"); assert.equal(s.ONBOARDING_VERSION, 1); const fresh = s.defaultState(NOW); assert.equal(fresh.theme, null); assert.equal(s.publicView(fresh).theme, null); assert.equal(s.publicView({ version: 1, completed: true, profil: "produit" }).theme, null); const done = s.complete(fresh, { profil: "sante", theme: "sante-teal" }, NOW); assert.equal(done.theme, "sante-teal"); assert.equal(s.publicView(done).theme, "sante-teal"); assert.equal(s.complete(done, { profil: "sante" }, NOW).theme, "sante-teal"); assert.equal(s.complete(done, { theme: "droit-ink" }, NOW).theme, "droit-ink"); assert.equal(s.replay(done).theme, "sante-teal"); assert.equal(s.chooseDomain(done, { profil: "droit", goals: [] }).theme, "sante-teal"); for (const bad of ["", "Sante Teal", "x".repeat(41), 7, {}]) assert.equal(s.complete(fresh, { theme: bad }, NOW).theme, null)'
  ```
- [ ] **D4 — the two template validators accept their fixture and refuse what the client could not install.**
  ```
  node --input-type=module -e 'const m = await import("./packages/kybernos-plugin/domain-pack.mjs"); const assert = (await import("node:assert/strict")).default; const team = { id: "clinic-assist", name: { en: "Clinic desk" }, desc: { en: "Answers the phone" }, mission: { en: "Sorts requests" }, topology: "pipeline", tags: ["clinic"], roles: [{ id: "greeter", kind: "doer", prompt: { en: "Take the call." } }, { id: "verifier", kind: "checker", prompt: { en: "Check it." } }], stages: [{ id: "sort", roles: ["greeter"], mode: "once", cap: 1, gate: false, inputs: [] }, { id: "verify", roles: ["verifier"], mode: "once", cap: 1, gate: true, inputs: ["sort"] }] }; const okTeam = m.validateTeamTemplate(team, "clinic-assist"); assert.equal(okTeam.ok, true, JSON.stringify(okTeam.errors)); assert.equal(okTeam.value.id, "clinic-assist"); for (const bad of [{ ...team, css: "body{}" }, { ...team, topology: "hive" }, { ...team, roles: [] }, { ...team, stages: [{ id: "sort", roles: ["ghost"], mode: "once", cap: 1, gate: false, inputs: [] }] }, { ...team, name: {} }, { ...team, roles: [{ id: "greeter", kind: "doer", prompt: { en: "x".repeat(901) } }] }]) assert.equal(m.validateTeamTemplate(bad, "clinic-assist").ok, false, JSON.stringify(bad).slice(0, 60)); assert.equal(m.validateTeamTemplate(team, "other").ok, false); const auto = { id: "daily-recall", cat: "prospecting", title: { en: "Daily recall" }, cadence: { en: "Every weekday at 8" }, cron: "0 8 * * 1-5", desc: { en: "Prepares the list" }, tags: ["recall"], steps: [{ kind: "ai", text: { en: "Read the list" } }, { kind: "act", text: { en: "Queue the drafts" } }], needs: [{ en: "A list of people" }], guard: [{ en: "Never writes to anyone." }], ask: [{ q: { en: "Where is the list?" }, o: [{ en: "In a sheet" }, { en: "In a file" }] }] }; const okAuto = m.validateAutomationTemplate(auto, "daily-recall"); assert.equal(okAuto.ok, true, JSON.stringify(okAuto.errors)); for (const bad of [{ ...auto, guard: [] }, { ...auto, steps: [{ kind: "ai", text: { en: "only one" } }] }, { ...auto, ask: [{ q: { en: "Who?" }, o: [{ en: "One" }] }] }, { ...auto, needs: [] }, { ...auto, tags: [] }, { ...auto, cron: "* * * *" }, { ...auto, css: "x" }]) assert.equal(m.validateAutomationTemplate(bad, "daily-recall").ok, false, JSON.stringify(bad).slice(0, 60)); assert.equal(m.validateAutomationTemplate(auto, "other").ok, false)'
  ```
- [ ] **D5 — a plugin's `teams/` and `automations/` fold into its own pack, never another's, and nothing changes without contributions.**
  ```
  node --input-type=module -e 'const m = await import("./packages/kybernos-plugin/domain-pack.mjs"); const assert = (await import("node:assert/strict")).default; const shipped = m.loadPacks("./packages/kybernos-plugin/domains"); assert.deepEqual(m.mergePackSets(shipped, []).packs, shipped.packs); const value = m.validatePack({ v: 1, id: "clinic", accent: "#1B7F76", icon: "heart", name: { en: "Clinic" }, tagline: { en: "T" }, goals: [{ id: "g1", name: { en: "G" }, title: { en: "T" }, desc: { en: "D" }, skills: [{ source: "kybernos", name: "notes", d: { en: "d" } }] }] }, "clinic").pack; const packs = [{ plugin: "acme/clinic", file: "domains/clinic.json", value }]; const add = { "kybernos/core#team-template": [{ plugin: "acme/clinic", file: "teams/clinic-assist.json", value: { id: "clinic-assist" } }], "kybernos/core#automation-template": [{ plugin: "acme/clinic", file: "automations/daily-recall.json", value: { id: "daily-recall" } }] }; const merged = m.mergePackSets(shipped, packs, add); const clinic = merged.packs.find((p) => p.id === "clinic"); assert.equal(clinic.kit.teams.length, 1); assert.equal(clinic.kit.teams[0].id, "clinic-assist"); assert.equal(clinic.kit.teams[0].from, "acme/clinic"); assert.equal(clinic.kit.teams[0].file, "teams/clinic-assist.json"); assert.equal(clinic.kit.automations.length, 1); assert.equal(merged.packs.filter((p) => p.from === undefined).every((p) => p.kit === undefined), true); const stray = m.mergePackSets(shipped, packs, { "kybernos/core#team-template": [{ plugin: "acme/other", file: "teams/x.json", value: { id: "x" } }] }); assert.equal(stray.packs.find((p) => p.id === "clinic").kit.teams.length, 0); assert.ok(stray.rejected.some((r) => /no pack of acme\/other is offered/.test(r.errors.join())), JSON.stringify(stray.rejected.slice(-1)))'
  ```
- [ ] **D6 — every point the code defines is declared in the manifest; the kit table names the four folders once each.**
  ```
  node --input-type=module -e 'const m = await import("./packages/kybernos-plugin/domain-pack.mjs"); const assert = (await import("node:assert/strict")).default; const { readFileSync } = await import("node:fs"); const manifest = JSON.parse(readFileSync("packages/kybernos-plugin/plugin.json", "utf8")); assert.equal(Array.isArray(m.CORE_POINTS), true); assert.deepEqual(m.CORE_POINTS.map((p) => p.ref).sort(), ["kybernos/core#automation-template", "kybernos/core#domain-pack", "kybernos/core#team-template"]); for (const { ref, def } of m.CORE_POINTS) { const name = ref.split("#")[1]; const d = manifest.provides.find((p) => p.name === name); assert.ok(d !== undefined, name + " is not declared in plugin.json provides"); assert.deepEqual([d.version, d.class, d.kind, d.validator], [def.version, def.class, def.kind, "builtin"], name); assert.equal(def.owner, manifest.id) } assert.equal(manifest.provides.length, 3); assert.deepEqual(m.KIT_POINTS.map((p) => p.ref), ["kybernos/theme#theme", "kybernos/skills#skill", "kybernos/core#team-template", "kybernos/core#automation-template"])'
  ```
- [ ] **D7 — `packsOf` defines the three points and survives a broken registry.**
  ```
  node --input-type=module -e 'const m = await import("./packages/kybernos-plugin/domain-pack.mjs"); const assert = (await import("node:assert/strict")).default; const shipped = m.loadPacks("./packages/kybernos-plugin/domains"); const defined = []; const fake = { version: 1, definePoint: (d) => { defined.push(d) }, contributions: (ref) => (ref === "kybernos/core#team-template" ? [{ plugin: "acme/clinic", file: "teams/x.json", value: { id: "x" } }] : []) }; const r = m.packsOf(shipped, fake); assert.equal(defined.length, 3); assert.deepEqual(r.packs.map((p) => p.id), shipped.packs.map((p) => p.id)); const bad = { version: 1, definePoint: () => { throw new Error("boom") }, contributions: () => { throw new Error("boom") } }; assert.deepEqual(m.packsOf(shipped, bad).packs, shipped.packs); assert.deepEqual(m.packsOf(shipped, null).packs, shipped.packs); assert.deepEqual(m.packsOf(shipped, undefined).packs, shipped.packs)'
  ```
- [ ] **D8 — the two test files grew, and are green.**
  ```
  node packages/kybernos-plugin/test-domain-pack.mjs > /tmp/kb-a2-domain.out && grep -qE '^(5[0-9]|[6-9][0-9]|[1-9][0-9]{2,}) checks passed$' /tmp/kb-a2-domain.out && node packages/kybernos-plugin/test-onboarding-state.mjs > /tmp/kb-a2-onboarding.out && grep -qE '^([2-9][0-9]|[1-9][0-9]{2,}) checks passed$' /tmp/kb-a2-onboarding.out
  ```
- [ ] **D9 — the onboarding route echoes the theme (source contract, the zone this batch owns).**
  ```
  node --input-type=module -e 'const assert = (await import("node:assert/strict")).default; const { readFileSync } = await import("node:fs"); const src = readFileSync("packages/kybernos-plugin/index.js", "utf8"); assert.ok(/theme: next\.theme/.test(src), "the complete answer does not echo theme"); assert.ok(/registry\.contributions\(KIT_POINTS|packsOf\(shippedPacks\(\), registrySeam\(\)\)|mergePackSets\(shipped, registry\.contributions\(DOMAIN_POINT_REF\)/.test(src))'
  ```
- [ ] **D10 — a tenth shipped pack inserted between `dev` and `general` does not redden the suite (the A3 scenario).**
  ```
  t=$(mktemp -d) && mkdir -p "$t/packages/kybernos-plugin" && cp packages/kybernos-plugin/test-domain-pack.mjs packages/kybernos-plugin/domain-pack.mjs packages/kybernos-plugin/plugin.json packages/kybernos-plugin/package.json "$t/packages/kybernos-plugin/" && cp -R packages/kybernos-plugin/domains "$t/packages/kybernos-plugin/domains" && ln -s "$PWD/packages/kybernos-plugin/client.js" "$t/packages/kybernos-plugin/client.js" && ln -s "$PWD/packages/kybernos-composio" "$t/packages/kybernos-composio" && ln -s "$PWD/packages/kybernos-registry" "$t/packages/kybernos-registry" && node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('$t/packages/kybernos-plugin/domains/general.json','utf8'));p.id='osteo';p.order=90;p.accent='#123456';p.legacyJobs=[];fs.writeFileSync('$t/packages/kybernos-plugin/domains/osteo.json',JSON.stringify(p))" && node "$t/packages/kybernos-plugin/test-domain-pack.mjs"; rc=$?; if [ -n "$t" ]; then rm -rf "$t"; fi; exit $rc
  ```
  The copy carries the batch's own test file and domains; `osteo.json` is `general.json` with a new id, order 90 (between `dev` and the catch-all), a unique accent and no
  legacy job. It fails today at the exact nine-id assertion (`:257`) and must pass after the widening of `:257`, `:290` and `:322-327`.

**Regression gate — already green today, therefore *not* a DoD (listed because the batch contract asks for it; a red here blocks the merge anyway).**
Measured on the current tree: `node scripts/garde-depot.mjs` → `1868 tracked files — 0 error(s), 0 warning(s)` (exit 0);
`node scripts/test-lifecycle-engine.mjs` → `82 assertions, 0 échec` (exit 0); `node scripts/test-paquet.mjs` → `111 assertions, 0 échec(s)` (exit 0);
`node scripts/run-all-tests.mjs --only domain` → 1 green; `--only onboarding` → 2 green. Before a merge into `dev`: `node scripts/run-all-tests.mjs`, 0 red, no
"known red". A compat bump is not needed: `dsh-compat.json` is not touched by this batch.

**Failures recorded on the current tree (run at `dev`, 2026-10-27, before any write to the batch's files)**

| Command | Exit | Message |
|---|---|---|
| D1 | 1 | `AssertionError [ERR_ASSERTION]: ["pack: unknown key \"theme\""]` / `false !== true` |
| D2 | 1 | fails on the first `assert.equal(m.validatePack(pack({}), "demo").ok, true)` because `theme` is unknown |
| D3 | 1 | `AssertionError: Expected values to be strictly equal: + undefined - null` at `fresh.theme` |
| D4 | 1 | `TypeError: m.validateTeamTemplate is not a function` |
| D5 | 1 | `TypeError: Cannot read properties of undefined (reading 'teams')` (`clinic.kit`) |
| D6 | 1 | `AssertionError: Expected values to be strictly equal` at `Array.isArray(m.CORE_POINTS)` (`false !== true`) |
| D7 | 1 | `TypeError: m.packsOf is not a function` |
| D8 | 1 | `42 checks passed` / `18 checks passed` — under the 50 / 20 thresholds |
| D9 | 1 | `AssertionError: the complete answer does not echo theme` |
| D10 | 1 | `AssertionError [ERR_ASSERTION]: listed in the pack's own order, the catch-all last` (the exact nine-id assertion, `test-domain-pack.mjs:257`) |

Two incidents met while preparing this document, kept because the contract says to record failures rather than ignore them: a first D1 fixture used `id: "g"`
for a goal and was refused with `goals[0].id: not a valid id` (the goal id minimum is 2 characters, `domain-pack.mjs:30`), so the fixture is now `g1`; and
`timeout(1)` does not exist on this machine (`bash: timeout: command not found`), so the three gate scripts were run without it and finished on their own.

## What the PR must quote (short, per `AGENTS.md` rule 10)

The final pack key list, the two `provides` objects, the four-row merge table, the `kit` slice of one fixture pack, the one-line onboarding echo, and the proof
that the nine shipped ids and their presets are untouched (`:257`/`:290` green, `general` last) and that a tenth shipped pack does not redden the suite (D10).

## Revision (gate `AMEND`, 2026-10-27)

Four fixes on the spec only; no code, no other batch's file. Every replacement above line 333 kept the same number of source lines, so the anchors this file lends to
sibling specs (`A1-kit-wizard-strategy.md:90-91`, `:93`, `:155`, `:220`) still land on the same paragraphs — re-read during this revision.

1. **The perimeter is fail-closed, not argued.** `index.js:30` is outside the granted routes zone and this batch grants itself nothing; the batch is **BLOCKED** until the human
   grants that one line or re-scopes (blocking point, first `AMBIGUITY:`). No DoD is claimed before the answer.
2. **The A3-proofing is complete at `test-domain-pack.mjs:290`.** The exact nine-id `agents.preset` map is widened with `:257` (nine ids in relative order, `general` last, extras
   anywhere — not a prefix, which a pack ordered at 90 would break) and `:322-327` (sweep over what `loadPacks` returned); D10 proves it by running the batch's own test file on a
   tenth shipped pack inserted at order 90.
3. **The kit wire is a decision, not an open question.** `pack.kit = { themes?, skills?, teams?, automations? }`, authored goals never mutated; the consumer is **assigned and
   recorded as deferred**: batch A1-kit-wizard consumes this shape verbatim in a later phase and reads no `pack.kit` today (`docs/tests/A1-kit-wizard-strategy.md:81-89`). The former
   AMBIGUITY 2 therefore moved to a `DECISION`; the remaining `AMBIGUITY:` lines are the human's.
4. **An invented exemplar removed while re-reading (not in the gate's list).** The `maquette:` section claimed the campaign mockups "do exist"; the `dsh-kybernos` tree is absent
   (measured 2026-10-27, same absence as `docs/tests/A3-vertical-content-strategy.md` and `A1-kit-wizard-strategy.md:79`). The section now says they are absent, and that this
   batch needs none of them.
