# A3-vertical-content — test strategy (written before any code)

| | |
|---|---|
| Batch | `A3-vertical-content` — two vertical packs end to end: cabinet medical + recrutement SSII |
| Campaign | Phase A of `docs/etudes/2026-10-27-sector-packs-strategy.md` (sections 3, 4, 8 → lines 44-105, 146-157) |
| Lane | **B** (no file of this batch touches auth, billing, RLS, migrations or secrets) |
| Author role | `redacteur-spec` — this file only; no code, no test module, no pack edited here |
| Binding contract | skill `contrat-pack-vertical` (primitives first, custom UI in Settings, theme = token overlay, cited or labelled) |
| Verdict on disk | `docs/tests/triage.md:1-3` (`chemin: complet`, sensitive files: `client.js`, `registry.mjs`, `preset-store.mjs`) |
| Status | spec; every anchor below was read in this repo on 2026-10-27 |

## What the batch ships, and what each file is for

| File | Role |
|---|---|
| `packages/kybernos-plugin/domains/sante.json` | the cabinet-medical pack, already shipped (`:1-14` identity, `:41-69` home + menu words, `:70-76` agents, `:77-329` goals and kit) — gains one `"theme": "cabinet-medical"` reference |
| `packages/kybernos-plugin/domains/recrutement.json` | new pack `recrutement` (SSII recruitment), content **PROPOSAL** (no source on this machine, see `maquette:`) |
| `packages/kybernos-plugin/domains/skills/` | *permission, not an obligation*: folders here are allowed only for a skill the new pack names with `source: "kybernos"` (see I1) |
| `catalog/themes/cabinet-medical.json` | theme source, id = the pack's theme id, `acc` = `#1B7F76` (`sante.json:5`) |
| `catalog/themes/recrutement-ssii.json` | theme source, `acc` = the new pack's accent (**proposal** hex) |
| `catalog/themes/_catalogue.json` | `{ seq, publishedAt }` — raised by `build --bump` (`scripts/themes-catalogue.mjs:66-70`) |
| `packages/kybernos-theme/gallery.json` | **generated** shipped catalogue (`scripts/themes-catalogue.mjs:27,71-73`); never hand-edited |

## Interpretations (the request admits several)

**I1 — what "`sante.json` gains its … final kit content" means.**
(a) minimal: the *only* change is the `theme` reference; the kit already is final because the five goals at `:78-147`, `:148-196`, `:197-230`, `:231-278`, `:279-328` are exactly notes, appointments, messages, activity, learning.
(b) additive: new goals and new bundled `SKILL.md` folders under `domains/skills/`.
**Chosen: (a).** Any new goal, skill name or sentence would be invented (contract 4; no source exists), and `domains/skills/` is *already* fully referenced — `packages/kybernos-plugin/test-domain-pack.mjs:222-225` fails on any skill folder no pack names, so an unused folder is a red suite. Consequence: the batch may leave `packages/kybernos-plugin/domains/skills/` **untouched** and still be complete.

**I2 — where the word "PROPOSAL" physically lives.**
(a) outside the JSON: in the sortie's citation table, in this spec, and in A4's "Build a sector pack" page;
(b) inside the pack, as a new key.
**Chosen: (a).** The pack shape is frozen by A2 (`v, id, order, accent, icon, name, tagline, keywords, home, legacyJobs, menu, mode, agents, goals` + `theme`), and today's validator refuses any other key — measured: a `theme` key added to `sante.json` in memory returns `ok=false, errors=["pack: unknown key \"theme\""]` (`packages/kybernos-plugin/domain-pack.mjs:71`). A free-text "status" key would be refused the same way. → `AMBIGUITY:` 2.

**I3 — the recruitment accent hex.** No file on disk carries one; the brief gives only `#1B7F76` for cabinet medical (`sante.json:5`). **(a)** propose a hex, labelled *proposal*, arbitrated by the human later; **(b)** block the pack until a source supplies it. **Chosen: (a)** — a theme is data, the person keeps the last word (strategy doc `:98-101`), and the batch must ship a theme to be testable; but the value is *not* cited and stays flagged. → `AMBIGUITY:` 1.

**I4 — the free `order` number.** Shipped orders today: `edu 10, sante 20, immo 30, droit 40, fin 50, com 60, mkt 70, dev 80, general 99` (read from each `domains/*.json`). Free candidates include **90** and 15. **Chosen: 90** — it lists the new field after the existing run and before the catch-all `general` (99), and it leaves the contributed-pack clamp `50..98` (`domain-pack.mjs:233`) without squeezing anyone, since collisions are in any case settled by `order` then `id` (`:251`). Proof it is free: no shipped pack declares 90, and no `domains/*.json` other than `recrutement.json` declares 90 or the id `recrutement` (DoD 4).

**I5 — which tokens the two presets carry.** The accent is pinned by I3/`sante.json:5`; `mode`, `fontText`, `radius`, `ov` are the author's design choice *inside the existing vocabulary only*: keys from `preset-store.mjs:43-52`, `radius` from `{sharp, standard, soft}` (`packages/kybernos-theme/client.js:910`, `:3660`), `fontText` from the 30 ids of the `FONTS` table (`client.js:416-458`, e.g. `dsh, inter, georgia, jetbrains-mono`), `ov` keys `"<light|dark>:<token>"` (`preset-store.mjs:64`). No CSS, no URL, no a11y key.

**I6 — "one theme preset derived from its pack accent" is a *bidirectional* invariant**: the theme's `settings.acc` must equal `pack.accent` (case-insensitive), for both sectors. This is interface I3 of the campaign and it is what DoD 1 measures; it does not pin the recruitment hex itself.

## AMBIGUITY — needs a human, not a silent choice

AMBIGUITY: the recruitment accent hex has **no source** (neither the campaign brief, nor `sante.json`, nor `catalog/themes/*.json`). This spec leaves the value to the implementer as a *labelled proposal* and records one candidate for the ledger (`#2E5A88`), distinct from the nine shipped pack accents and the fourteen catalogue accents. Arbitrate: accept a proposal hex, or supply the métier's own hex (then it is cited and the label drops).

AMBIGUITY: where "explicitly-labelled PROPOSAL" is recorded. Chosen: outside the JSON (sortie + this spec + A4's page), because the frozen pack shape has no free-text key and the validator refuses unknown keys (`domain-pack.mjs:71`). If the human wants the label *inside* the artefact, that is a change to A2's frozen interface (a `provenance`/`status` key), not a change this batch may make.

AMBIGUITY: whether "final kit content" for cabinet medical authorises *new* goals or bundled skills (I1 (b)). Chosen minimal (I1 (a)) because every added sentence would be invented and `test-domain-pack.mjs:222-225` punishes an unused skill folder. Arbitrate if the sector owner has content that must land now.

## Lane

**B — standard.** No file in `fichiers` is a credential, billing, RLS or migration surface: all seven are JSON data (packs, theme sources, gallery) plus one folder that may receive Markdown. Falsifier that would flip this to A: any hunk touching `preset-store.mjs`, a route, a `cordis.patch.yml`, or a signature file — all of those belong to A1/A2 or to the maintainer (`themes.catalog.json.sig`, repo rule 7).

e2e: the journey the *content* must survive on the real GUI — and which step each batch owns.
- [ ] Fresh profile (no `onboarding.json`) → the wizard opens; the field step offers a "Santé" tile rendered from `sante.json:7-14` (name `en`/`fr`, tagline, icon `heart` at `:6`) and a "Recrutement SSII" tile from the proposal pack. Owning data: A3. Rendering: A1/A2 (unchanged wizard code).
- [ ] Picking Santé → goals step lists the five cited goals, in pack order (`:77-329`); the kit step recomputes skills/teams/automations/`soon` (`scripts/test-onboarding.mjs:120-126` is the existing proof of that recompute for `sante`).
- [ ] Agents step shows preset `prudent` **with the reason** (`sante.json:70-76`), never a bare preset name.
- [ ] Kit step: every automation is created **switched off**, every prompt drafts only (`sante.json:131-134`, `:186-189`, `:268-269`, `:318-319`); a team id in `teams` resolves to one of the three marketplace teams (`test-domain-pack.mjs:304-306`).
- [ ] Kit step: the sector's theme preset is **proposed and visible in the live miniature before confirming** (strategy `:100-101`). *Owned by A1-kit-wizard*; A3 only guarantees the preset exists under the id the pack names.
- [ ] After finish: Settings › Theme shows the sector preset applied; changing it is allowed and Settings wins over the pack (strategy `:98-100`). *A1*.
- [ ] Settings › Theme › **Gallery**: two new cards (name, author, `description.fr` + `.en`), each installable; install copies it to "My themes" with `source: 'gallery'`, `gid`, `v`, `author` (`packages/kybernos-theme/client.js:2060-2065`, shape asserted live at `scripts/check-theme-live.mjs:1627`). *The card is A3's data on an existing surface — this is the one end-to-end path A3 owns.*
- [ ] Reload the page and the app: the installed theme survives (`theme-presets.json`, `preset-store.mjs:1-8`), the field choice survives (`onboarding.json`, `docs/dev/domain-packs.md:107`).
- [ ] Negative journey: a bundle that names a theme id no file provides leaves the gallery and the wizard intact — a line in a list, never a boot failure (repo rule 2; strategy `:156-157`). Checked by inspection of the existing guards, not by a new test (A3 writes none).

vision: what must be *looked at*, and what must never be judged by eye.
- [ ] Read with `read_image`, and confirm: (1) both gallery cards show a readable name, author, description and a swatch, with no clipped or overflowing text; (2) the two swatches are **visibly different** (teal for cabinet medical, a blue-slate for recruitment — proposal); (3) the sector skin applied after install keeps labels legible in light **and** dark; (4) nothing overlaps at 430 px width.
- [ ] Vision must **not** be used for the accent hex, the `radius` token or the `fontText` id: a PNG cannot be sampled reliably and those are *data*. They are proven by `getComputedStyle` on `--dsw-*` (the method `scripts/check-theme-live.mjs:13-16` already uses) and by the JSON itself (DoD 1).
- [ ] Vision must **not** be used for a product claim either: if a card looks wrong but the data is right, the finding is a UI finding for A1's scope, recorded as such — not a pack edit.

capture: required, conditional on the GUI and on A1's seam — never silently skipped.
- [ ] Command: `node scripts/check-theme-live.mjs --only gallery,skins --shots <dir outside the repo>`. Its gallery section reads the expected card count **from `gallery.json` itself** (`scripts/check-theme-live.mjs:1543,1561,1573`), so two added themes cannot make it stale — and it exits **3** when there is no Chrome or no isolated sandbox (`:1542`). The wizard side is `scripts/check-onboarding-live.mjs`, **A1's** capture, not re-run here.
- [ ] Captures to keep, named in the sortie: `a3-gallery-light`, `a3-gallery-dark`, `a3-gallery-narrow` (430 px), `a3-skin-cabinet-light`, `a3-skin-recrutement-dark`.
- [ ] These files live **outside** the repository: repo rule 4 and `node scripts/garde-depot.mjs` (0 warning today, measured `1868 tracked files`) reject media and personal paths in git. The sortie names the folder; git never sees a PNG.
- [ ] If the capture cannot be produced (exit 3): the sortie records the exact exit code and message, and the capture item stays **open**, owned by A1. A skipped capture without that record is a NO-GO.

maquette: **not applicable, with the reason on the record.**
- The two mockups named by the campaign brief — `vertical-medecin/maquette-v1/` and `vertical-recrutement-ssii/maquette-v1/` under `docs/handoff/` of the design repo — **do not exist on this machine**: `dyad-apps/dsh-kybernos/docs/handoff/vertical-medecin` and `.../vertical-recrutement-ssii` are both absent, a depth-8 search for `*medecin*`, `*recrutement*`, `*vertical-*` under that repo returns nothing, and the only handoff folders in this repo are `docs/handoff/desktop-electron` and `docs/handoff/session-msg`.
- Therefore: **no maquette is reconstructed from memory**, no pixel, colour sample, label or figure is borrowed from a mockup, and the recruitment pack's every sentence is an explicitly-labelled **proposal** (contract 4). The maquette section is present because it is owed, not because it is done: the read-back by a métier eye (contract 7) **cannot happen** until those files exist, and that gap is recorded in the sortie as a cross-team item, not closed here.
- What replaces the maquette for review purposes is the *existing* preview surfaces, not a new drawing: the wizard's live miniature (`kbObPreviewOf`, `packages/kybernos-plugin/client.js:35791`) and the gallery card (`packages/kybernos-theme/client.js:2060-2065`). Both are primitives; neither is a screen smuggled into a pack.

unit: the deterministic levels the content must satisfy, and the traps that turn existing suites red.
- [ ] **L1 — theme source rules.** Each `catalog/themes/<id>.json` goes through `sanitizeTheme` (`packages/kybernos-theme/themes-catalogue.mjs:44-62`): id matches `THEME_ID_RE` (`:25`), name ≤ 40, author required ≤ 60, **`description.fr` and `.en` both required** ≤ 200 each (`:49-54`), `v` a positive integer (`:55`), **an a11y key is refused, not trimmed** (`:57-58`) — and the batch adds no a11y key, ever. The file must be named `<id>.json` (`scripts/themes-catalogue.mjs:43`) and the id must equal the `theme` value the pack names.
- [ ] **L1bis — silent drop is the trap.** An unknown settings key is *dropped*, not refused (`preset-store.mjs:104`); a token the browser does not know (`fontText`, `radius`) passes node and does nothing on screen. Hence DoD 1 asserts the surviving key set explicitly and cites `client.js:416-458` (fonts) and `:910` (radii) as the only legal values.
- [ ] **L2 — gallery identity.** `packages/kybernos-theme/gallery.json` must be **exactly** `buildDocument()` (`scripts/test-themes-catalogue.mjs:33-37`), and must stay readable by the host (`packages/kybernos-theme/test-themes-gallery.mjs:86-87`). Any hand edit is red. `seq` comes from `catalog/themes/_catalogue.json` (`scripts/themes-catalogue.mjs:52-57`), currently `{ seq: 2, publishedAt: "2026-10-15T00:00:00.000Z" }`.
- [ ] **L3 — pack shape.** `validatePack` (`domain-pack.mjs:69-190`) with its own limits (`:28`): 12 goals, 8 skills, 3 teams, 4 `soon`, 3 automations, 4 connectors, 2 search phrases, text ≤ 160, prompt ≤ 900, keyword ≤ 24. Both packs must come out of `loadPacks` (`:202-219`) with **no entry in `rejected`**. Today `theme` is not in the allowlist (`:71`) — that half is A2's (see dependencies).
- [ ] **L4 — the wizard-facing behaviour of the data**, judged by the two existing suites, which A3 does **not** rewrite: `scripts/test-onboarding.mjs` and `packages/kybernos-plugin/test-domain-pack.mjs`. The traps that new recruitment content can spring, all measured on current code:
  - cron shapes: `kbObCronLabel` only labels `M H * * *`, `M H * * 1-5`, `M H * * 0-6`, `M D * *`; anything else is printed as the raw cron (`client.js:35774-35782`), and `test-onboarding.mjs:164` then fails. So `*/5 * * * *`, `0 9 * * 1,3` or a 4-field cron is **forbidden content**.
  - keyword theft: a field is found by counting keywords that start a word of the sentence, longer keywords weighing 2 (`client.js:35759`), ties to the pack listed first. The phrases asserted at `test-onboarding.mjs:156-159` must keep their winners, so a recruitment keyword must not prefix `luxe` (expected `null`), `retail`, `manager`, `code` (→ `com`/`dev`), nor the words of `kiné en libéral à Lyon`, `lawyer in Paris`, `agent immobilier…`, `prof de maths`, `Comptable en cabinet`, `community manager et SEO`.
  - miniature caps: for **every** pack, at most 1 team, 3 starters, 7 skills and 3 automations in the preview (`test-onboarding.mjs:173` via `client.js:35791-35801`).
  - team ids: only `inbound-closer`, `research-desk`, `studencik` exist (`test-domain-pack.mjs:304-306`); a sector's own team is a `soon` line (free text, as `sante.json:137-142`), never an invented id.
  - bundled skills: any `source: "kybernos"` name needs `domains/skills/<name>/SKILL.md` with frontmatter whose description is 40..1024 chars and says « Use when », text 800..12000 chars (`test-domain-pack.mjs:209-221`), and no folder may be left unused (`:222-225`).
  - search phrases: 1-2 per goal, unique inside the pack, lower-case, 2..32 chars (`test-domain-pack.mjs:182-190`, `domain-pack.mjs:40`).
  - a goal must ask for *something* (`domain-pack.mjs:183`) and `fr` is **not** required by the validator — only `en` is (`:45-56`). The batch's own rule is bilingual, which is why DoD 4 checks `fr` separately.
- [ ] **L5 — the preset survives the two-sided check.** A catalogue theme becomes a library preset through `sanitizePreset` with `source: 'gallery'` (`preset-store.mjs:92-115`), and the page re-checks it (a11y stripped on the way in, `client.js:2098`). A theme whose settings are legal at the source cannot fail this step; the case worth a unit eye is `ov`: at most 40 keys, each `light:|dark:` + hex (`preset-store.mjs:64,70-79`).
- [ ] **L6 — what a tenth pack breaks in `test-domain-pack.mjs`, a file this batch may not write.** Measured by reading that file, not by running it. `:257` asserts the **exact** id list `['edu','sante','immo','droit','fin','com','mkt','dev','general']` and `:290` asserts the **exact** map `{ edu:'balanced', sante:'prudent', … }` of nine entries: a tenth pack turns both red, and `order: 90` places it before the catch-all `general` (99), which is precisely what breaks `:257`. A third site, `:322-327`, hardcodes the nine file names, so a tenth pack would silently escape the « no machine path, no markup » scan — a coverage gap, not a red, and it must be reported as a gap rather than mistaken for a pass.
- [ ] **L7 — the hard content guards a new pack must satisfy** (all in `test-domain-pack.mjs`, all already green for the nine): 4 to 6 goals (`:263`); every text object carries `fr` (`:267`); only skills of the `VERIFIED` list for a non-bundled source (`:271`, list at `:193-204`); `agents.why.fr` present (`:288`); `mode` other than `code` (`:289`, only `dev` is code mode); connectors that exist in the Connectors catalogue, with at least one goal offering one (`:298-302`); teams among the three marketplace ids (`:304-306`); **one accent per field, so the new hex must differ from all nine shipped accents** (`:253`); `home` of at least two ids from `HOME_IDS` (`:251`); `menu.labels` never renaming `kyber`, `skills`, `connectors`, `projects` (`:319`); and `legacyJobs: []` like `sante.json:46`, since the old-job map at `:311-313` and the clash check in `loadPacks` (`domain-pack.mjs:212`) both read that list.

DoD: deterministic boolean commands of this repo, **all measured red today** (exit 1), green only when the batch is done.
- [ ] **DoD 1 — the two sector themes exist, follow the host's rules, and carry their pack's accent.** Red now: `catalog/themes/cabinet-medical.json: missing` then `.../recrutement.json: missing`.
      node --input-type=module -e "
      import { existsSync, readFileSync } from 'node:fs'
      import { sanitizeTheme } from './packages/kybernos-theme/themes-catalogue.mjs'
      import { SETTINGS_KEYS } from './packages/kybernos-theme/preset-store.mjs'
      const pairs = [['sante', 'cabinet-medical'], ['recrutement', 'recrutement-ssii']]
      const problems = []
      for (const [pack, theme] of pairs) {
        const pf = 'packages/kybernos-plugin/domains/' + pack + '.json'
        const tf = 'catalog/themes/' + theme + '.json'
        if (!existsSync(pf)) { problems.push(pf + ': missing'); continue }
        if (!existsSync(tf)) { problems.push(tf + ': missing'); continue }
        const p = JSON.parse(readFileSync(pf, 'utf8'))
        const v = sanitizeTheme(JSON.parse(readFileSync(tf, 'utf8')))
        if (!v.ok) { problems.push(tf + ': ' + v.error); continue }
        if (v.theme.id !== theme) problems.push(tf + ': id ' + v.theme.id)
        if (p.theme !== theme) problems.push(pf + ': theme ' + p.theme)
        if (String(v.theme.settings.acc || '').toLowerCase() !== String(p.accent).toLowerCase()) problems.push(tf + ': acc ' + v.theme.settings.acc + ' is not the pack accent ' + p.accent)
        const unknown = Object.keys(v.theme.settings).filter((k) => SETTINGS_KEYS.indexOf(k) < 0)
        if (unknown.length) problems.push(tf + ': unknown settings ' + unknown.join(','))
      }
      if (problems.length) { console.error(problems.join('\n')); process.exit(1) }
      console.log('ok: ' + pairs.length + ' sector themes, accent = pack accent')
      "
- [ ] **DoD 2 — the shipped gallery was rebuilt, never hand-edited, and the sequence was bumped.** Red now: `missing from catalog/themes: cabinet-medical, recrutement-ssii` + `seq not bumped (HEAD 2, now 2)`.
      node --input-type=module -e "
      import { execFileSync } from 'node:child_process'
      import { readFileSync } from 'node:fs'
      import { buildDocument } from './scripts/themes-catalogue.mjs'
      const built = buildDocument()
      const shipped = JSON.parse(readFileSync('packages/kybernos-theme/gallery.json', 'utf8'))
      const ids = built.themes.map((t) => t.id)
      const missing = ['cabinet-medical', 'recrutement-ssii'].filter((id) => !ids.includes(id))
      const problems = []
      if (missing.length) problems.push('missing from catalog/themes: ' + missing.join(', '))
      if (JSON.stringify(shipped) !== JSON.stringify(built)) problems.push('gallery.json is not what the sources build (seq ' + shipped.seq + ' vs ' + built.seq + ')')
      const head = JSON.parse(execFileSync('git', ['show', 'HEAD:catalog/themes/_catalogue.json'], { encoding: 'utf8' }))
      if (!(built.seq > head.seq)) problems.push('seq not bumped (HEAD ' + head.seq + ', now ' + built.seq + ')')
      if (problems.length) { console.error(problems.join('\n')); process.exit(1) }
      console.log('ok: ' + ids.length + ' themes, seq ' + built.seq)
      "
      Must be preceded by `node scripts/themes-catalogue.mjs build --bump` (`scripts/themes-catalogue.mjs:65-74`), which is the only writer of `gallery.json`; `git diff --stat` then names **only** `catalog/themes/_catalogue.json` and `packages/kybernos-theme/gallery.json`.
- [ ] **DoD 3 — both packs are offered by the real loader, with the theme ids of interface I3.** Red now: `pack not offered: recrutement` + `sante: theme undefined (want cabinet-medical)`. **Cross-batch:** it stays red after A3 alone, with `rejected recrutement.json: pack: unknown key "theme"`, until A2 lets `theme` through.
      node --input-type=module -e "
      import { loadPacks } from './packages/kybernos-plugin/domain-pack.mjs'
      const r = loadPacks('packages/kybernos-plugin/domains')
      const ids = r.packs.map((p) => p.id)
      const problems = []
      for (const bad of r.rejected) problems.push('rejected ' + bad.file + ': ' + bad.errors.join(' | '))
      for (const id of ['sante', 'recrutement']) if (!ids.includes(id)) problems.push('pack not offered: ' + id)
      for (const [id, theme] of [['sante', 'cabinet-medical'], ['recrutement', 'recrutement-ssii']]) {
        const p = r.packs.find((x) => x.id === id)
        if (p && p.theme !== theme) problems.push(id + ': theme ' + p.theme + ' (want ' + theme + ')')
      }
      if (problems.length) { console.error(problems.join('\n')); process.exit(1) }
      console.log('ok: ' + ids.join(', '))
      "
- [ ] **DoD 4 — every displayed text is bilingual, and the new pack's id and order are free.** Red now: `no pack file: recrutement.json`.
      node --input-type=module -e "
      import { readdirSync, readFileSync } from 'node:fs'
      const dir = 'packages/kybernos-plugin/domains'
      const problems = []
      const packs = {}
      for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
        const id = f.slice(0, -5)
        try { packs[id] = JSON.parse(readFileSync(dir + '/' + f, 'utf8')) } catch (e) { problems.push(f + ': not JSON') }
      }
      for (const id of ['sante', 'recrutement']) if (!packs[id]) problems.push('no pack file: ' + id + '.json')
      const walk = (v, at, file) => {
        if (Array.isArray(v)) return v.forEach((x, i) => walk(x, at + '[' + i + ']', file))
        if (v === null || typeof v !== 'object') return
        const langs = Object.keys(v).filter((k) => ['en', 'fr', 'es', 'ar'].includes(k))
        if (langs.length > 0) {
          if (!langs.includes('fr')) problems.push(file + ' ' + at + ': no fr')
          for (const k of langs) if (typeof v[k] !== 'string' || v[k].trim() === '') problems.push(file + ' ' + at + '.' + k + ': empty')
          return
        }
        for (const k of Object.keys(v)) walk(v[k], at + '.' + k, file)
      }
      for (const id of ['sante', 'recrutement']) if (packs[id]) walk(packs[id], id, id + '.json')
      if (packs.recrutement) {
        const others = Object.entries(packs).filter(([id]) => id !== 'recrutement')
        if (others.some(([, p]) => p.order === packs.recrutement.order)) problems.push('order ' + packs.recrutement.order + ' is already taken')
        if (!Number.isInteger(packs.recrutement.order) || packs.recrutement.order < 1 || packs.recrutement.order > 99) problems.push('order ' + packs.recrutement.order + ' is not 1..99')
        if (others.some(([, p]) => p.id === packs.recrutement.id)) problems.push('id ' + packs.recrutement.id + ' is already taken')
      }
      if (problems.length) { console.error(problems.join('\n')); process.exit(1) }
      console.log('ok: ' + Object.keys(packs).length + ' packs, every text in fr, order ' + packs.recrutement.order + ' free')
      "
- [ ] **DoD 5 — the pack schema accepts a theme reference (the A2 dependency, stated as a command).** Red now: exit 1; `domain-pack.mjs:71` has no `'theme'` in its allowlist.
      grep -q "'theme'" packages/kybernos-plugin/domain-pack.mjs
- Gates (green **today**, must stay green — these are not DoDs, and none may be "fixed" from this batch):
  `node packages/kybernos-plugin/test-domain-pack.mjs` (0 today), `node scripts/run-all-tests.mjs --only themes` (3 files green today), `node scripts/test-onboarding.mjs` (exit 0 today), `node scripts/garde-depot.mjs && node scripts/test-lifecycle-engine.mjs && node scripts/test-paquet.mjs` (0 / 82 assertions / 111 assertions today), and `node scripts/run-all-tests.mjs` before any merge into `dev`.
  If `test-onboarding.mjs` or `test-domain-pack.mjs` turns red on the new content, the exact message is recorded in the sortie as a cross-batch item — **neither file is patched here** (`scripts/test-onboarding.mjs` belongs to A1-kit-wizard; the validator belongs to A2-pack-format). Two reds are *expected*, not mysteries: the id-list equality at `test-domain-pack.mjs:257` and the preset map at `:290` (L6), both caused by a tenth pack and both owned by A2-pack-format.

## Cross-batch dependencies — recorded, never patched from here

| Dependency | What A3 needs | State today | Evidence |
|---|---|---|---|
| A2-pack-format | `theme` added to the pack allowlist + in the cleaned pack object, **and** the two exact-set assertions of `test-domain-pack.mjs` widened (`:257` id list, `:290` preset map) | **missing** — `pack: unknown key "theme"`; the sibling spec `docs/tests/A2-pack-format-strategy.md:83-85` widens `:257` and `:322-327` but leaves `:290` outside its perimeter, so `:290` must be added to it or `dev` stays red after A3 | `domain-pack.mjs:71`, cleaned object `:187`; `test-domain-pack.mjs:257,290` |
| A1-kit-wizard | the Kit step reads the pack's `theme` and applies the catalogue preset through the preset store | **missing** — the doc still says « no public apply-a-preset call was found » | `docs/dev/domain-packs.md:108` |
| A2-registry-points | `themes/`, `skills/`, `teams/`, `automations/` folder scans (not needed by *this* batch, which ships repo-folder content) | **missing** | strategy `:150-152` |
| A4 | the "Build a sector pack" page that carries the PROPOSAL label in public docs | **missing** | strategy `:155` |

## Out of scope

- The apply-a-preset seam, the Kit-step wiring and any line of `packages/kybernos-plugin/client.js` (A1-kit-wizard).
- The `theme` allowlist in `domain-pack.mjs`, the registry folder scan, and `docs/dev/domain-packs.md:108` moving from « next » to « wired » (A2-pack-format / A2-registry-points).
- `scripts/test-onboarding.mjs`, `packages/kybernos-plugin/test-domain-pack.mjs` and every other test file: **A3 writes no test and no module**.
- Signing: `catalog/themes.catalog.json` / `.sig` and `keygen --embed` are the maintainer's (repo rule 7, `scripts/themes-catalogue.mjs:14-17,101-117`). This batch touches no key and no signature.
- The starter template and the docs page (A4); any dashboard tile, miniapp or new listing binding for the two sectors (no declarative primitive yet — `docs/dev/domain-packs.md:110`); any sector-specific Agent Team; any connector work.
- Compatibility: `dsh-compat.json` is untouched — this batch adds data only, no surface, no engine.
- Any French prose in this repo's docs: English only (repo rule 6).

## Platform-evolution requests (a need no primitive covers — written, never smuggled)

1. **A sector's own Agent Team template.** A pack can only point at the three marketplace teams (`test-domain-pack.mjs:304-306`); a "recruitment desk" team would need the `kybernos/core#team-template` point declared in the strategy (`:60`) and a `teams/` folder scan (A2). Until then the pack carries a `soon` line, exactly as `sante.json:137-142` does.
2. **A listing bound to a datum.** The contract wants one view kind per datum (cards / list / calendar, strategy `:77-80`); the packs can only word the existing rows and pages (`docs/dev/domain-packs.md:103-106`), and dashboard tiles fed by a connected app still need a new source kind (`:110`). So this batch ships **no dashboard** and **no new listing**: pretending otherwise would be a custom screen smuggled into a pack.
3. **A first-class "proposal" provenance marker** for authored content (see `AMBIGUITY:` 2): today the label can only live in prose beside the pack, not in it.

## Verified source ledger (every anchor above was read in this repo)

| Claim | Anchor |
|---|---|
| cabinet medical identity, accent `#1B7F76`, icon `heart` | `packages/kybernos-plugin/domains/sante.json:2-14` |
| home order `doc, automation, sheet`; menu labels; hidden `documents` | `sante.json:41-45`, `:47-65`, `:66-68` |
| agents preset `prudent` + its reason | `sante.json:70-76` |
| five goals = notes, appointments, messages, activity, learning | `sante.json:78-147`, `:148-196`, `:197-230`, `:231-278`, `:279-328` |
| pack allowlist, `order` 1..99, accent `#rrggbb`, `ICONS`, `LIMITS` | `packages/kybernos-plugin/domain-pack.mjs:71`, `:75`, `:76`, `:22`, `:28`, `:187` |
| loader + sort, contributed clamp | `domain-pack.mjs:202-219`, `:216-217`, `:233`, `:251` |
| shipped orders `10…80, 99` | each `packages/kybernos-plugin/domains/*.json` (`order`) |
| `SETTINGS_KEYS`, `ID_RE`, `HEX6`, `OV_KEY`, silent drop of unknown keys | `packages/kybernos-theme/preset-store.mjs:43-52`, `:26`, `:63`, `:64`, `:104`, `:92-115` |
| theme id regex, a11y refusal, description in two languages | `packages/kybernos-theme/themes-catalogue.mjs:25`, `:57-58`, `:49-54`, `:44-62` |
| theme source shape (the model to imitate) | `catalog/themes/calcaire.json:1-22` |
| catalogue manifest `{ seq: 2, publishedAt }` | `catalog/themes/_catalogue.json:1-4` |
| build reads `catalog/themes/<id>.json`, writes `gallery.json`, `--bump` | `scripts/themes-catalogue.mjs:4-7`, `:27`, `:38-49`, `:52-57`, `:65-74` |
| shipped file name must equal its id | `scripts/themes-catalogue.mjs:43` |
| gallery.json must equal what the sources build | `scripts/test-themes-catalogue.mjs:33-37` |
| the host reads the shipped gallery | `packages/kybernos-theme/test-themes-gallery.mjs:86-87` |
| gallery → "My themes" install, a11y stripped page-side | `packages/kybernos-theme/client.js:2060-2065`, `:2098`, `:1847-1855` |
| font ids, radius enum | `packages/kybernos-theme/client.js:416-458`, `:910`, `:3660` |
| field-from-sentence scoring, cron label shapes, preview caps | `packages/kybernos-plugin/client.js:35753-35762`, `:35772-35782`, `:35791-35801` |
| sensitive fields are `droit` + `sante` | `packages/kybernos-plugin/client.js:35730` |
| wizard corpus, cron gate, preview caps, marketplace teams | `scripts/test-onboarding.mjs:156-159`, `:164`, `:173`; `packages/kybernos-plugin/test-domain-pack.mjs:304-306` |
| bundled skill + unused-folder rules, search phrases | `packages/kybernos-plugin/test-domain-pack.mjs:181`, `:209-221`, `:222-225`, `:182-190` |
| live gallery check reads its own count, exits 3 without a GUI | `scripts/check-theme-live.mjs:1543`, `:1561`, `:1573`, `:1542` |
| the theme seam is « next », saved choice is « wired » | `docs/dev/domain-packs.md:108`, `:107`, `:110` |
| shipped catalogue travels inside the Suite archive | `docs/dev/theme-gallery.md:12-13` |
| build contract 4 (cited or labelled), theme = token overlay, Phase A gate | `docs/etudes/2026-10-27-sector-packs-strategy.md:85-87`, `:93-105`, `:146-157` |
| the two named mockups are absent from disk | `find` depth 8 under `~/dyad-apps/dsh-kybernos`: nothing; `docs/handoff/` here holds only `desktop-electron`, `session-msg` |
| a tenth pack's hard guards: 4-6 goals, `fr` everywhere, only `VERIFIED` skills, `agents.why.fr`, one accent per field, connectors in the catalogue, three market teams, `home`, menu rows, `legacyJobs` | `packages/kybernos-plugin/test-domain-pack.mjs:263`, `:267`, `:271`, `:288`, `:289`, `:253`, `:298-302`, `:304-306`, `:251`, `:319`, `:311-313` |
| the two exact-set assertions a tenth pack turns red, and the file-name list it escapes | `packages/kybernos-plugin/test-domain-pack.mjs:257`, `:290`, `:322-327`; the sibling plan for them `docs/tests/A2-pack-format-strategy.md:83-85,100-101` |

Every value this spec could not cite is marked **proposal** above: the recruitment pack's texts, its accent hex (`#2E5A88` as a candidate, `AMBIGUITY:` 1), and its `order: 90` (free, proven by DoD 4).
