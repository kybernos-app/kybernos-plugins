> **Naming update (2026-10-28, owner).** The visual layer (earlier "theme": token overlay, presets)
> is now the **style**; the installable sector unit (earlier "sector pack"/"pack") is now the
> **theme**. Code paths stay unchanged (`packages/kybernos-theme`, `theme-presets.json`) until the
> product-rename batch (kybernos-theme → kybernos-style) lands.

# A2-registry-points — test strategy (written before any code)

Batch: `A2-registry-points` — "Registry: read `themes/`, `skills/`, `teams/`, `automations/` folders with per-point validators".
Perimeter is the twelve files of the delegation contract, and nothing else.
Read on `dev` at `fc0005e3` (2026-10-27). Every `file:line` below was opened in this tree; the anchors the delegation
gave and that do not hold are listed under **corrections**.

Baseline measured on this tree before writing (all exit 0, so none of them can be a DoD — see `DoD:`):
`packages/kybernos-registry/test-registry.mjs`, `test-host.mjs`, `test-skill.mjs`, `test-write-guard.mjs`,
`packages/kybernos-skills/test-index.mjs`, `scripts/test-seed-skills-drift.mjs`, `scripts/test-plugin-manifest.mjs`,
`scripts/test-plugin-scan.mjs`, `scripts/test-layout.mjs`, `node scripts/build-catalog.mjs --check`,
`node scripts/garde-depot.mjs` (1868 tracked files, 0 error, 0 warning).

lane: **A** — critical, by file adjacency rather than by changed behaviour. `packages/kybernos-registry/host.mjs:166-170`
carries the origin fence and the signed-session guard (`sameOrigin`, `writeGuard`) of the six routes, and
`packages/kybernos-skills/index.js:1707-1712` documents the same guard on `/install`; a batch that lists those files is
reviewed as critical. A2 plans **no diff** in those lines (no route added, no guard touched: `host.mjs:151-158` stays six
routes), so the reviewer may close it as B only after `git diff` proves both hunks untouched — see AMBIGUITY 1.

## interpretations

I1. **Where the shape of a contribution is declared.** (a) In the point contract at runtime — a new optional
`files: "json" | "folder"` on `definePoint` (`packages/kybernos-registry/registry.mjs:199-210`), the only authority the
registry actually reads (`registry.mjs:301`, `host.mjs:114`), mirrored by an optional `files` on the manifest's
`provides` entry (`packages/kybernos-registry/plugin.schema.json:214-229`) so a reader, the conformance tool and the A4
page see the shape; (b) manifest only — the registry would have to read the manifests of installed plugins, which it does
not do today, or the field would be decorative; (c) a hard-coded map of point name → shape inside `registry.mjs`.
**Chosen: (a).** It is the only option where what is declared is what is enforced, it is additive (a point that says
nothing keeps `json`, so `kybernos/core#domain-pack` — `packages/kybernos-plugin/domain-pack.mjs:230`, `max: 12` — and
`kybernos/dashboards#preset` do not move), and it gives `manifest.mjs:84` a rule a schema cannot state (a folder cannot be
checked by a JSON schema). (c) is rejected: the registry would carry third-party point names, while `definePoint` accepts
any `owner/name#point` (`registry.mjs:201`).

I2. **What `raw` is for a folder contribution.** (a) An envelope `{ name: "<folder name>", files: [{ path, content }] }`;
(b) the text of `SKILL.md` alone; (c) `{ text, files }`. **Chosen: (a)** — it is exactly the input of the skill checker the
owner already has (`validateTeamSkill`, `packages/kybernos-skills/team-skills.mjs:188-228`, which also carries the bounds:
50 files, 256 KiB per file, 1 MiB per skill, `team-skills.mjs:9-16`), so the point's validator is an adapter over existing
code and A2 writes no second implementation of skill rules. (b) loses the "files inside kept" requirement; (c) invents a
third shape for nothing.

I3. **What one contribution is.** For a `json` point (today's rule, unchanged): one flat `*.json` file at the root of
`dir` (`registry.mjs:240`). For a `folder` point: one immediate sub-directory of `dir`, read recursively. **Chosen**,
with the bounds of I2 and `LIMITS.file` (`registry.mjs:20`, 256 KiB): depth ≤ 4, ≤ 50 files, ≤ 1 MiB per contribution. The
registry does not know what a skill is: a folder without `SKILL.md` is refused by the point's validator, not by the
registry (per-point validators, "reject, never trim").

I4. **The cap counts contributions.** For a `folder` point `point.max` counts folders, not files; the message keeps the
verb of `registry.mjs:241` and names the unit (`holds more than N folders: only the first N are read`). A non-directory
entry at the root of a folder point's `dir` is **named** in `rejected`, never silently dropped (today's filter drops it
unseen — measured: `rejected: []`).

I5. **Who writes a contributed skill to `<DSH home>/skills`.** **Chosen for A2: nobody — the batch is read-only.** The
five `seed-skills.mjs` copies must stay identical (`scripts/test-seed-skills-drift.mjs:16`) and a sixth is forbidden;
`seedSkills` copies only `<name>/SKILL.md` (`packages/kybernos-registry/seed-skills.mjs:62-72`), so it cannot carry a
folder's sibling files, and teaching it to would change all five copies — four of them outside this batch
(`kybernos-theme`, `kybernos-plugin`, `kybernos-dashboards`, `kybernos-slash`). The disk write is therefore written as a
platform-evolution request, not smuggled in. See AMBIGUITY 2.

I6. **`packages/kybernos-skills/plugin.json` keeps `version: 1.0.0`** (no bump in this batch). A bump changes
`packages/kybernos-hub/catalog.json` (`scripts/build-catalog.mjs:198` copies `mf.version`), a file no Phase A batch owns,
and `scripts/test-layout.mjs:81` fails on a stale catalogue. Adding a point is additive in the contract, not a version
event.

AMBIGUITY: 1 — the lane. A file of the perimeter (`host.mjs`) holds the auth guard, so the rule makes the batch A; the batch plans no diff there, which would make it B. Arbitrate: A with a proof of zero diff in `host.mjs:166-170`, or B on the owner's word?

AMBIGUITY: 2 — the seeding of a plugin-shipped skill folder. A2 reads a skill folder as one contribution but writes nothing to `<DSH home>/skills` (I5), so a vertical pack's skills reach the registry and not the agents. A3 (end-to-end packs) needs the write side. Arbitrate: (i) A2 stays read-only and the write belongs to the owner (`kybernos/skills`) in a later batch; (ii) A2 extends the five `seed-skills.mjs` copies together, in the same PR, with `scripts/test-seed-skills-drift.mjs` untouched — which puts four foreign packages in this batch; (iii) A2 ships the write in `kybernos-skills/index.js` and accepts a second implementation of the "never over a person-edited file" rule that the drift test cannot see. The writer recommends (i).

AMBIGUITY: 3 — the name of the new point field. Pinned here as `files` with the enum `["json","folder"]` (I1), and A4's page and the contract's `provides` row must use the same word. If the owner prefers `contribution` or `shape`, say so now: the DoD commands below are written against `files` and will fail otherwise.

## out of scope

- `kybernos/dashboards#preset` and any `dashboards/` (or `presets/`) folder: not in A2's folder list (contract row,
  `docs/dev/plugin-contract.md:266`), though the strategy example lists it
  (`docs/etudes/2026-10-27-sector-packs-strategy.md:62`). Decided, recorded, not built.
- Defining `kybernos/theme#theme` (batch A1-theme-seam), `kybernos/core#team-template` and
  `kybernos/core#automation-template` (batch A2-pack-format). A2 **consumes** them; its tests stub them.
- Any write to `<DSH home>/skills` or `<DSH home>/kybernos/**` (I5), and any sixth `seed-skills.mjs` copy.
- `packages/kybernos-registry/client.js` and every other UI file: no page, no wording, no screenshot in this batch.
- The real scan folder (`<DSH home>/kybernos/plugins/<author>/<name>/` of the docs vs
  `<DSH home>/profiles/web/node_modules/<name>/` of the code): reported for A4, **not** changed here.
- All docs prose (`docs/dev/plugin-contract.md`, `docs/dev/domain-packs.md`): A4. The only docs path in this batch is
  `docs/dev/schemas/plugin.schema.json`, as the byte-identical copy of the bundle's schema
  (`packages/kybernos-registry/test-registry.mjs:350`).
- Any engine patch, any new route, any change to the six routes or their guards (`host.mjs:151-158`).

## corrections to the delegation (measured, not guessed)

C1. **The host already answers the points.** `host.mjs:114` returns `points: registry.points()` from `/kybernos-registry/state`,
`registry.mjs:300-301` builds them, and `test-host.mjs:54` asserts it. Nothing is missing there, so A2 changes **no line of
`host.mjs`**. The doc's `GET /kybernos-registry/points` (`plugin-contract.md:253`) describes a route that does not exist
(the answer lives in `/state`); A2 adds no route (interdit) and leaves that sentence to A4.
C2. **The delegation's whole `dod` list is green on this tree** (see the baseline above). It proves nothing about A2 and is
kept below as a regression gate, not as a DoD.
C3. **`themes/`, `teams/` and `automations/` work today** when their points are JSON points: `dir` is arbitrary and the
reader walks any folder name (`registry.mjs:236-241`; `presets/` at `test-registry.mjs:96-97` proves it). Measured with a
throw-away profile: one contribution per folder for both `teams/` and `automations/`. Those cases are regression guards,
not evidence; the only new mechanic is the folder shape (skills).
C4. **The citation for the seeding rule is wrong in the delegation.** `docs/etudes/2026-10-27-webapp-creator-cadrage.md:129`
is about TLDs; the "never over a person-edited file" rule is at `:161` and `:189` of that document.
C5. **Schema anchors:** `$defs.provided` is `plugin.schema.json:214-229`, `$defs.extension` is `:231-240` (the delegation
gave 214-229 for both). The `provides`/`extends` references are at `:87-88`; `extends` requires `dir` for a data plugin
through `:167-169`.
C6. `scripts/test-seed-skills-drift.mjs:2` says the module "exists four times" while `:16` lists **five** copies. Not fixed
here (that file is in the perimeter only if a sixth copy appeared); recorded so nobody re-derives the wrong count.
C7. `scripts/plugin-manifest.mjs` is a two-line re-export of `packages/kybernos-registry/manifest.mjs`, so the new manifest
rule is enforced by `scripts/test-layout.mjs:107-122` and `scripts/build-catalog.mjs:221` without a second copy to keep in sync.

e2e: one data plugin ships a whole vertical, and the registry reads it point by point.
The journey (added to `packages/kybernos-registry/test-registry.mjs`, whose fixture `fresh()`/`install()` already builds a
real DSH profile — `:40-66`): one installed package `acme/vertical` declares five `extends` — `domains` (`kybernos/core#domain-pack`),
`themes` (`kybernos/theme#theme`, a JSON stub), `skills` (`kybernos/skills#skill`, the point this batch defines),
`teams` (`kybernos/core#team-template`, a JSON stub), `automations` (`kybernos/core#automation-template`, a JSON stub) —
with the person's consent given; then: every point answers with its own contributions and only its own, one broken
contribution (a skill folder without `SKILL.md`) is skipped with its error list while the four others still contribute,
nothing in the package is imported or executed (`test-registry.mjs:250-265` already proves that invariant and must stay
green), and the same package with one invalid contribution never changes DSH's boot (the registry is created lazily,
`host.mjs:11-12`; nothing here runs at boot). The e2e has **no browser leg**: the batch ships no page (see `vision:`), so
the journey is the registry's own end-to-end on a temp profile, which is what an installed pack sees.
Proof: DoD 1, DoD 2, DoD 6 below.

vision: **not applicable** — reason: A2 adds no pixel. The only page that consumes the registry is
`packages/kybernos-registry/client.js`, which is outside the perimeter and unchanged; the new field travels in an existing
JSON answer (`host.mjs:114`) that the page ignores. There is nothing to look at, so no screenshot would be evidence, and
`docs/tests/` keeps no image (repo rule 4). It becomes applicable the day a page shows a pack's points and their
contributions — that is a client batch, not this one.

capture: **not applicable** — reason: same as `vision:`; no UI state to capture, and a PNG in git is an error
(`scripts/garde-depot.mjs`). What is captured instead, and is the evidence for this batch: the exit code and the last line
of each DoD command, verbatim, in the batch report — including every failure met on the way, with its message
(the delegation asks for that, and the four red lines recorded below are the shape of it).

maquette: **not applicable** — reason: no interface is drawn or changed, so there is no mockup to validate; the validated
mockups of Phase A (`docs/handoff/vertical-medecin/maquette-v1/`, `docs/handoff/vertical-recrutement-ssii/maquette-v1/`,
outside this repository) concern batch A3 and its visual surfaces, not the registry's reader. No mockup is invented for a
data layer; if one were, it would be a custom screen smuggled into a pack — forbidden by the build contract.

unit: the cases to add, file by file, plus what must not move.

**`packages/kybernos-registry/registry.mjs`** (the only reader):
- `definePoint` accepts `files` (`"json"` | `"folder"`, absent = `"json"`), keeps it idempotent (`:207-209`: the same
  definition told again must still keep the scan — `test-registry.mjs:285` pins that), and **throws** the existing
  `'registry: a point needs …'` error for any other value (a typo must not be silently dropped: today `definePoint` keeps
  only known keys, so an unknown one vanishes — measured).
- `points()` (`:300-301`) reports `files` for every point, defaulted, so `/state` carries it without a route change.
- `readExtension` (`:232-253`): `json` path untouched (flat `*.json`, cap in files, `readBounded` per file); the `folder`
  path reads one immediate sub-directory per contribution, recursively under the bounds of I3, refuses a link anywhere
  (`readBounded:39` for files, `lstat` for folders), names a non-directory root entry, keeps a folder entry only when its
  name matches `/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/` (the family of the JSON filter at `:240`; anything else is named in
  `rejected`, never shown raw), and passes
  `{ name, files: [{ path, content }] }` to `point.validate(raw, <folder name>)` in isolation (a validator that throws is
  still `'the check itself failed'`, `:248`).
- No other behaviour: consent (`:275-276`), statuses (`:213-230`), the JSON rejection messages, `warnOnce` (`:290-295`)
  unchanged.

**`packages/kybernos-registry/manifest.mjs`** (rule 3, after `:84`): a data point with `files: "folder"` and a `schema`
is a fault, worded `provides "<name>": a folder contribution cannot be checked by a JSON schema`; a **code** point with
`files` is a fault (the field describes a contribution, and a code point has none). Exactly-one-of stays as is.

**`packages/kybernos-registry/plugin.schema.json` and `docs/dev/schemas/plugin.schema.json`** — same edit, byte for byte
(DoD 4 asserts it): `$defs.provided.properties.files` = `{ "enum": ["json", "folder"], "description": … }`.

**`packages/kybernos-skills/plugin.json`** — one `provides` entry (text in the handoff below); `version`, `family`,
`entry`, `permissions`, `claims` untouched (I6, C7).

**`packages/kybernos-skills/index.js`** — the point object (`owner: 'kybernos/skills'`, `ownerVersion: '1.0.0'` by the
convention of `packages/kybernos-plugin/domain-pack.mjs:223-230`, `name: 'skill'`, `version: '1.0'`, `kind: 'data'`,
`class: 'instruction'`, `files: 'folder'`, `max: 32`, `validate` as an adapter over `validateTeamSkill` mapping
`{ ok: false, reason, file }` to `{ ok: false, errors: [...] }`), told through
`globalThis[Symbol.for('kybernos.registry')]` guarded by `try/catch` exactly like `packages/kybernos-plugin/index.js:10706`
— at boot **and** at the next question, because the registry may mount after this bundle (the core does the same,
`:10716`). `/kybernos-skills/install` (`:1807-1815`) keeps its contract byte for byte.

**`packages/kybernos-registry/test-registry.mjs`** — new cases, titles pinned so the DoD can grep them:
`one plugin ships five folders: each point reads its own, nothing runs`, `a skill folder is one contribution, its files kept whole`,
`a folder point refuses what it cannot trust, with its error list`, `a point says whether its contributions are files or folders`,
`a folder contribution cannot be checked by a JSON schema` (the last one imports `manifestErrors`).

**Must stay green, untouched:** the JSON point rules (`:216` symlinked folder, `:221` symlinked file, `:240` cap in
files, `:301` throwing validator), the schema pair (`:350`), the no-dynamic-code scan of the registry's sources (`:259-261`),
the six routes and the points answer (`test-host.mjs:26,54`), the five seeding copies
(`scripts/test-seed-skills-drift.mjs:16`), the first-party manifests as a set (`scripts/test-layout.mjs:107-122`), the
catalogue (`scripts/build-catalog.mjs --check`).

DoD: DoD 1 to DoD 6 **fail on this tree today** (each with its exact last line quoted, measured, not guessed) and must
exit 0 after the batch; DoD 7 is the repository gate, green today, kept because a batch is not done without it.
Run them from the repository root.

**DoD 1 — a folder point contributes one contribution per folder, its files kept whole.**
Fails today: `FAIL: contributions = [] / extends = [{"point":"kybernos/skills#skill","contributions":0,"rejected":[]}]`
```bash
node --input-type=module <<'JS'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRegistry } from './packages/kybernos-registry/registry.mjs'
const d = mkdtempSync(join(tmpdir(), 'a2-dod-'))
const w = (f, s) => { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, s) }
const p = join(d, 'profile'); const pkg = join(p, 'node_modules', 'kybernos-plugin-v')
w(join(p, 'package.json'), JSON.stringify({ dependencies: { 'kybernos-plugin-v': '1.0.0' }, dsh: { profile: { bundles: ['kybernos-plugin-v'] } } }))
w(join(pkg, 'package.json'), JSON.stringify({ name: 'kybernos-plugin-v', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
w(join(pkg, 'cordis.patch.yml'), '[]\n')
w(join(pkg, 'plugin.json'), JSON.stringify({ contract: 1, id: 'acme/vertical', kind: 'data', version: '1.0.0', name: { en: 'V' }, description: { en: 'd' }, author: { id: 'acme', name: 'A' }, license: 'CC-BY-4.0', pricing: 'free', requires: { kybernos: '^0.1', plugins: { 'kybernos/skills': '^1.0' } }, extends: [{ point: 'kybernos/skills#skill', range: '^1.0', dir: 'skills' }] }))
w(join(pkg, 'skills', 'consultation', 'SKILL.md'), '---\nname: consultation\ndescription: d\n---\n')
w(join(pkg, 'skills', 'consultation', 'reference.md'), 'x\n')
const r = createRegistry({ profileDir: p, stateFile: join(d, 's.json'), ttlMs: 0 })
r.definePoint({ owner: 'kybernos/skills', ownerVersion: '1.0.0', name: 'skill', version: '1.0', kind: 'data', class: 'instruction', files: 'folder', validate: (raw, id) => (raw !== null && typeof raw === 'object' && raw.name === id && Array.isArray(raw.files) ? { ok: true, value: { id, files: raw.files.map((f) => f.path).sort() } } : { ok: false, errors: ['an envelope { name, files: [{ path, content }] } is expected'] }) })
r.setConsent('acme/vertical', true)
const c = r.contributions('kybernos/skills#skill')
const point = r.points().find((x) => x.id === 'kybernos/skills#skill')
if (c.length !== 1 || c[0].value.id !== 'consultation' || c[0].value.files.join() !== 'SKILL.md,reference.md') { console.log('FAIL: contributions = ' + JSON.stringify(c) + ' / extends = ' + JSON.stringify(r.plugins()[0].extends)); process.exit(1) }
if (point === undefined || point.files !== 'folder') { console.log('FAIL: points() does not report files: ' + JSON.stringify(point)); process.exit(1) }
console.log('OK: one contribution per folder, its files kept, files: "folder" reported')
JS
```

**DoD 2 — a folder point refuses what it cannot trust, and names it.**
Fails today: `FAIL: a folder without SKILL.md is not refused with its error list: []`
```bash
node --input-type=module <<'JS'
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRegistry } from './packages/kybernos-registry/registry.mjs'
const d = mkdtempSync(join(tmpdir(), 'a2-dod2-'))
const w = (f, s) => { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, s) }
const p = join(d, 'profile'); const pkg = join(p, 'node_modules', 'kybernos-plugin-v')
w(join(p, 'package.json'), JSON.stringify({ dependencies: { 'kybernos-plugin-v': '1.0.0' }, dsh: { profile: { bundles: ['kybernos-plugin-v'] } } }))
w(join(pkg, 'package.json'), JSON.stringify({ name: 'kybernos-plugin-v', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
w(join(pkg, 'cordis.patch.yml'), '[]\n')
w(join(pkg, 'plugin.json'), JSON.stringify({ contract: 1, id: 'acme/vertical', kind: 'data', version: '1.0.0', name: { en: 'V' }, description: { en: 'd' }, author: { id: 'acme', name: 'A' }, license: 'CC-BY-4.0', pricing: 'free', requires: { kybernos: '^0.1', plugins: { 'kybernos/skills': '^1.0' } }, extends: [{ point: 'kybernos/skills#skill', range: '^1.0', dir: 'skills' }] }))
w(join(pkg, 'skills', 'good', 'SKILL.md'), '---\nname: good\ndescription: d\n---\n')
w(join(pkg, 'skills', 'README.md'), 'a stray file at the root of the folder\n')
w(join(pkg, 'skills', 'noskillmd', 'notes.md'), 'x\n')
w(join(pkg, 'skills', 'linked', 'SKILL.md'), '---\nname: linked\ndescription: d\n---\n')
mkdirSync(join(d, 'elsewhere'), { recursive: true })
w(join(d, 'elsewhere', 'stolen.md'), 'x\n')
symlinkSync(join(d, 'elsewhere', 'stolen.md'), join(pkg, 'skills', 'linked', 'stolen.md'))
const base = { owner: 'kybernos/skills', ownerVersion: '1.0.0', name: 'skill', version: '1.0', kind: 'data', class: 'instruction', files: 'folder' }
const check = (raw, id) => (raw !== null && typeof raw === 'object' && Array.isArray(raw.files) && raw.files.some((f) => f.path === 'SKILL.md') ? { ok: true, value: { id } } : { ok: false, errors: ['SKILL.md is missing'] })
const r = createRegistry({ profileDir: p, stateFile: join(d, 's.json'), ttlMs: 0 })
r.definePoint({ ...base, validate: check })
r.setConsent('acme/vertical', true)
const rej = JSON.stringify(r.plugins()[0].extends[0].rejected)
if (!/SKILL.md is missing/.test(rej)) { console.log('FAIL: a folder without SKILL.md is not refused with its error list: ' + rej); process.exit(1) }
if (!/symbolic link/.test(rej)) { console.log('FAIL: a link inside a contribution is not refused: ' + rej); process.exit(1) }
if (!/README\.md/.test(rej) || !/is not a folder/.test(rej)) { console.log('FAIL: a file at the root of a folder point is silently ignored: ' + rej); process.exit(1) }
if (r.contributions('kybernos/skills#skill').length !== 1) { console.log('FAIL: only "good" should contribute, got ' + r.contributions('kybernos/skills#skill').length); process.exit(1) }
r.definePoint({ ...base, max: 2, validate: check })
const capped = r.plugins()[0].extends[0]
if (capped.contributions > 2 || !/holds more than 2/.test(JSON.stringify(capped.rejected))) { console.log('FAIL: the per-point cap does not count folders: ' + JSON.stringify(capped)); process.exit(1) }
console.log('OK: a bad folder is skipped with its errors, a link is refused, a stray file is named, the cap counts folders')
JS
```

**DoD 3 — the point contract says files or folders.**
Fails today: `FAIL: a point without files defaults to "json": {"id":"kybernos/skills#skill",…,"contributions":0}`
```bash
node --input-type=module <<'JS'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRegistry } from './packages/kybernos-registry/registry.mjs'
const d = mkdtempSync(join(tmpdir(), 'a2-dod3-'))
const r = createRegistry({ profileDir: d, stateFile: join(d, 's.json'), ttlMs: 0 })
const def = { owner: 'kybernos/skills', ownerVersion: '1.0.0', name: 'skill', version: '1.0', kind: 'data', class: 'instruction', validate: () => ({ ok: true, value: {} }) }
r.definePoint(def)
const json = r.points().find((p) => p.id === 'kybernos/skills#skill')
if (json === undefined || json.files !== 'json') { console.log('FAIL: a point without files defaults to "json": ' + JSON.stringify(json)); process.exit(1) }
r.definePoint({ ...def, files: 'folder' })
const folder = r.points().find((p) => p.id === 'kybernos/skills#skill')
if (folder === undefined || folder.files !== 'folder') { console.log('FAIL: files: "folder" is kept: ' + JSON.stringify(folder)); process.exit(1) }
let threw = false
try { r.definePoint({ ...def, name: 'other', files: 'folders' }) } catch (e) { threw = /a point needs/.test(e.message) }
if (!threw) { console.log('FAIL: files: "folders" (a typo) is accepted instead of raising "a point needs …"'); process.exit(1) }
console.log('OK: files defaults to json, folder is kept, a bad value raises')
JS
```

**DoD 4 — the manifest and the schema say what a folder point is, and the two schema copies stay identical.**
Fails today: `FAIL: the owner manifest with a folder point is refused: /provides/0/files is not a known key`
```bash
node --input-type=module <<'JS'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { manifestErrors } from './packages/kybernos-registry/manifest.mjs'
const dir = 'packages/kybernos-skills'
const real = JSON.parse(readFileSync(join(dir, 'plugin.json'), 'utf8'))
const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
const zone = JSON.parse(readFileSync('dsh-compat.json', 'utf8')).dsh
const ctx = { firstParty: true, dir: 'kybernos-skills', packageJson: pkg, suiteZone: zone, fileExists: (rel) => existsSync(join(dir, rel)) }
const withPoint = { ...real, provides: [{ name: 'skill', version: '1.0', kind: 'data', class: 'instruction', summary: { en: 'A skill folder: SKILL.md and the files beside it.' }, validator: 'builtin', files: 'folder' }] }
const accepted = manifestErrors(withPoint, ctx)
if (accepted.length !== 0) { console.log('FAIL: the owner manifest with a folder point is refused: ' + accepted.join(' | ')); process.exit(1) }
const withSchema = JSON.parse(JSON.stringify(withPoint)); withSchema.provides[0].schema = 'skills.schema.json'
const refused = manifestErrors(withSchema, { ...ctx, fileExists: () => true }).join(' | ')
if (!/a folder contribution cannot be checked by a JSON schema/.test(refused)) { console.log('FAIL: a folder point with a schema is refused in other words: ' + refused); process.exit(1) }
const asCode = JSON.parse(JSON.stringify(withPoint)); asCode.provides[0] = { name: 'skill', version: '1.0', kind: 'code', files: 'folder' }
if (!/files/.test(manifestErrors(asCode, ctx).join(' | '))) { console.log('FAIL: a code point may claim a contribution shape'); process.exit(1) }
const both = ['packages/kybernos-registry/plugin.schema.json', 'docs/dev/schemas/plugin.schema.json'].map((f) => readFileSync(f, 'utf8'))
if (both[0] !== both[1]) { console.log('FAIL: the two schema copies differ'); process.exit(1) }
const files = JSON.parse(both[0]).$defs?.provided?.properties?.files
if (JSON.stringify(files?.enum) !== '["json","folder"]') { console.log('FAIL: $defs.provided.files is ' + JSON.stringify(files)); process.exit(1) }
console.log('OK: a folder point needs a validator, a schema or a code point is refused, both copies carry files')
JS
```

**DoD 5 — `kybernos/skills` owns `kybernos/skills#skill`: declared, told at boot, tolerated when the registry is absent.**
Fails today: `FAIL: the bundle does not define kybernos/skills#skill through the seam: undefined`
```bash
node --input-type=module <<'JS'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const home = mkdtempSync(join(tmpdir(), 'a2-dod5-'))
process.env.HOME = home; process.env.USERPROFILE = home; process.env.DSH_HOME = join(home, '.dsh')
const SEAM = Symbol.for('kybernos.registry')
globalThis[SEAM] = { version: 1, definePoint (d) { (globalThis.__points ??= []).push(d) } }
const m = await import('./packages/kybernos-skills/index.js')
const ctx = { get: () => undefined, inject: () => {}, effect: () => {} }
m.apply(ctx)
const told = (globalThis.__points ?? [])[0]
if (told === undefined || told.owner !== 'kybernos/skills' || told.name !== 'skill' || told.kind !== 'data' || told.class !== 'instruction' || told.files !== 'folder' || typeof told.validate !== 'function') { console.log('FAIL: the bundle does not define kybernos/skills#skill through the seam: ' + JSON.stringify(told)); process.exit(1) }
const manifest = JSON.parse(readFileSync('./packages/kybernos-skills/plugin.json', 'utf8'))
const entry = (manifest.provides ?? []).find((p) => p.name === 'skill')
if (entry === undefined || entry.kind !== 'data' || entry.class !== 'instruction' || entry.validator !== 'builtin' || entry.files !== 'folder') { console.log('FAIL: plugin.json does not declare the point: ' + JSON.stringify(entry)); process.exit(1) }
delete globalThis[SEAM]
try { m.apply(ctx) } catch (e) { console.log('FAIL: the bundle stops when the registry is absent: ' + e.message); process.exit(1) }
console.log('OK: declared in plugin.json, told at boot, absent registry tolerated')
JS
```

**DoD 6 — the journey case and the folder-rule cases exist and are green.**
Fails today: `packages/kybernos-registry/test-registry.mjs` has none of these lines (verified absent).
```bash
node packages/kybernos-registry/test-registry.mjs > /tmp/a2-registry.txt && \
grep -qF '✓ one plugin ships five folders: each point reads its own, nothing runs' /tmp/a2-registry.txt && \
grep -qF '✓ a skill folder is one contribution, its files kept whole' /tmp/a2-registry.txt && \
grep -qF '✓ a folder point refuses what it cannot trust, with its error list' /tmp/a2-registry.txt && \
grep -qF '✓ a point says whether its contributions are files or folders' /tmp/a2-registry.txt && \
grep -qF '✓ a folder contribution cannot be checked by a JSON schema' /tmp/a2-registry.txt
```

**DoD 7 — the gates of the repo, run whole.**
```bash
node scripts/garde-depot.mjs && node scripts/test-lifecycle-engine.mjs && node scripts/test-paquet.mjs
```
This one is the pre-push gate of `AGENTS.md`, not evidence about A2: it is green today. It is listed because the batch
cannot be declared done without it.

## regression gate (green today — a red here is a regression, not a missing feature)

```bash
node scripts/run-all-tests.mjs --only kybernos-registry
node scripts/run-all-tests.mjs --only test-host
node scripts/run-all-tests.mjs --only test-write-guard
node scripts/run-all-tests.mjs --only test-skill
node scripts/run-all-tests.mjs --only kybernos-skills/test-index
node scripts/run-all-tests.mjs --only test-seed-skills-drift
node scripts/run-all-tests.mjs --only test-plugin-scan
node scripts/run-all-tests.mjs --only test-plugin-manifest
node scripts/build-catalog.mjs --check
node scripts/run-all-tests.mjs          # the gate before a merge into dev, 0 red
```
Read them as regression only: measured green on `fc0005e3` before any line of A2 existed, so none of them proves the batch.
`--only test-host`, `--only test-write-guard` and `--only test-skill` each select dozens of files across packages
(32, 26 and 4 — `node scripts/run-all-tests.mjs --only test-host --list`): they are wide by design, not precise.

## handoff (for batch A4-starter-docs and for A1/A2-pack-format)

**Exact text for A4's spec rows — manifest and schema delta.**

`plugin.schema.json`, inside `$defs.provided.properties` (`:214-229`), after `validator`:
```json
"files": { "enum": ["json", "folder"], "description": "The shape of one contribution: 'json' (default) one flat .json file per contribution, 'folder' one folder per contribution whose files are read whole. A data point whose contributions are folders has a validator, never a schema." }
```
`manifest.mjs`, rule 3, right after `:84`:
```js
    if (p.kind === 'data' && p.files === 'folder' && p.schema !== undefined) fault('provides "' + p.name + '": a folder contribution cannot be checked by a JSON schema')
    if (p.kind === 'code' && p.files !== undefined) fault('provides "' + p.name + '": files describes a data point\'s contributions')
```
`registry.mjs`, the point contract comment at `:199` and the check at `:201-204`:
`{ owner, ownerVersion, name, version "x.y", kind "data", class "inert"|"instruction", files? "json"|"folder" (default "json"), validate(raw, fileId), max? }`
and, for a folder point, `raw = { name: "<folder name>", files: [{ path: "SKILL.md", content: "<utf8>" }, …] }`, `fileId = <folder name>`.
The contract's `provides` row (`docs/dev/plugin-contract.md:93`) and §6.2/§6.4 still describe the old shape: that is A4's row.

**The real scan location** (for A4 to align `docs/dev/plugin-contract.md:259-260` and `:477`, which say
`<DSH home>/kybernos/plugins/<author>/<name>/`): the code reads what DSH's own plugin manager installed —
`<DSH home>/profiles/web/node_modules/<name>/` (`packages/kybernos-registry/host.mjs:32`, `registry.mjs:93-106`), skipping
`@local/` and `@deepseek-ai/` (`registry.mjs:86`), following a link only at the top for `file:`/`link:` sources
(`registry.mjs:103-104`) and never inside a package (`:35-43`, `:238`). The documented folder is not read at all.

**The seeding decision for plugin-shipped skills:** read-only in A2 (I5, AMBIGUITY 2) — no sixth copy, no write, the disk
install is a platform-evolution request. A pack's skill therefore reaches the registry and the consent screen, not yet the
agents; A3 must not be declared end to end for skills until that request is built.

**Points this batch defines:** `kybernos/skills#skill` 1.0 only (`kybernos/skills`, `data`, `instruction`, `files: folder`,
`max: 32`, `ownerVersion: 1.0.0`) — declared in `packages/kybernos-skills/plugin.json` and `definePoint`-ed there.
**Points it consumes, stubbed in its tests and never defined here:** `kybernos/theme#theme` (A1-theme-seam),
`kybernos/core#team-template`, `kybernos/core#automation-template` (A2-pack-format), plus `kybernos/core#domain-pack`
already shipped (`packages/kybernos-plugin/domain-pack.mjs:230`). `kybernos/dashboards#preset` is out of scope.

**Failures met while writing this strategy (recorded, not ignored):**
1. A first probe used `id: 'acme/v'` and the manifest was refused — `/id does not match ^[a-z][a-z0-9-]{1,31}/[a-z][a-z0-9-]{1,39}$` (the owner segment needs two characters). Probes use `acme/vertical`.
2. A first version of DoD 2 expected two contributions with `max: 2` over three folders; the cap makes the third folder unread, so the "no `SKILL.md`" refusal was unreachable. Rewritten with the cap exercised in a second pass.
3. The delegation's `dod` list, its "add the points answer" and its `themes/teams/automations` evidence were all already true on this tree (C1–C3).
