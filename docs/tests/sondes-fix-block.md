# Probe notebook — the BLOCK grounds of the adversarial review (stage 1: probes only)

> Verdict being answered: `docs/tests/revue-adversariale.md` **BLOCK**, grounds 1 (F-41/F-42), 2 (F-25/F-26/F-1),
> 3 (F-39/F-40) and 5 (F-27). Written 2026-10-28 by the test-writer stage, **before** any product fix: every probe below
> is red on this tree, on purpose, and the fix stage turns it green. No file under `packages/` was edited to get here.

## What this stage measured

| | |
|---|---|
| `node scripts/run-all-tests.mjs` | **532 test files, 522 green, 10 RED** (177 s) — the review's own ten, none added by this stage |
| The ten reds (pre-existing, untouched) | `test-consistency-guards`, `test-help-mounts`, `test-help`, `test-layout`, `test-no-legacy-hosts`, `test-plugin-scan`, `test-readmes`, `test-signposts`, `packages/kybernos-plugin/test-settings-nav`, `packages/kybernos-servers/test-host` |
| `node scripts/garde-depot.mjs` | 0 error, 3 warnings — the same three pre-existing personal-path warnings (F-47), none from these files |
| Probes | 4 files, 46 checks, **23 red**, each probe exits 1 |

The brief cites `docs/tests/porte-go-verdicts.md D8` for the pre-existing list: that file has no `D8` section — its
§G item 10 records **6 reds at gate time** (2026-10-28 ~02:10). The measured list at this HEAD is the review's ten, so
that is the baseline used here. **Ground 4 (the ten reds) is out of this stage's scope**: the brief fixes grounds
1 → 2 → 3 → 5, and this stage adds none.

## Where the probes live, and why they are outside the merge gate

`scripts/run-all-tests.mjs` (`discover`, lines 25-50) collects `scripts/test-*.mjs`, `packages/*/test*.mjs`, and the two
`test/` folders run by `node --test`. A probe that is red by design would therefore **grow a NEW red** in the gate that
AGENTS.md forbids — so the probes sit in `docs/tests/probes/`, are run by hand, and the table at the end says where each
assertion must land in the collected suite before the merge. They are not fixtures of the deliverable; they are the
yardstick the fix is measured with.

```bash
node docs/tests/probes/probe-import-invariant.mjs      # ground 1
node docs/tests/probes/probe-catalogue-trust.mjs       # ground 2
node docs/tests/probes/probe-wizard-invariants.mjs     # ground 3
node docs/tests/probes/probe-market-contract.mjs       # ground 5
```

---

## GROUND 1 — the import path destroys the person's records (F-41/F-42, data loss)

**Frozen rule it breaks.** `A1-theme-seam-strategy.md:261-267` (A1-1, ratified as written): « The `me` record is never
touched (byte for byte), the import gets a free name ("Soigne (2)") and a suffixed id »; and « the import never evicts a
theme the person kept ». Anchor: `packages/kybernos-theme/preset-store.mjs:219-243`.

**Probe:** `docs/tests/probes/probe-import-invariant.mjs` (7 checks, 6 red, exit 1).

1. **(a) any id.** Twelve cases: for each id in `soigne`, `u-mine`, `x-1`, `a` — the person's `source:'me'` record —
   import (i) the slug of the name `Soigne`, (ii) an explicit id equal to the record's, (iii) an explicit id under another
   name. The record must stay **byte for byte** (exact serialisation compared), and the import must land on a record of
   its own (or refuse with a reason), never on the person's. Today **9 of the 12** overwrite it: `source:'me'` becomes
   `'file'` and the settings are replaced.
2. **(b) the suffixed-id collision.** Records `u-mine/"Soigne"` (me) and `soigne-2/"Cabinet"` (gallery, `gid:'cab'`,
   `v:3`); import `Soigne`. No record of another name may be rewritten, the stranger keeps its `gid`/`v`, and the import
   answers its own name. Today `soigne-2` is rewritten (`source` gallery→file, settings replaced, **`gid` and `v`
   dropped**) and the import answers `{ ok:true, id:'soigne-2', name:'Cabinet' }` — the victim's own name.

Captured failing output (`node docs/tests/probes/probe-import-invariant.mjs`, exit 1):

```
✗ the person's record is untouched, byte for byte, in every case (3/12) — {"failing":9,"examples":[{"case":"the slug of the name (soigne)",
  "before":"{\"id\":\"soigne\",\"name\":\"Soigne\",\"source\":\"me\",\"at\":1000,\"settings\":{\"acc\":\"#000001\"}}",
  "after":"{\"id\":\"soigne\",\"name\":\"Soigne\",\"source\":\"file\",\"at\":1000,\"settings\":{\"acc\":\"#abcdef\"}}",…}]}
✗ the import lands on a record of its own (or refuses) in every case (3/12) — {"failing":9,…}
✗ ...and never rewrites its source or its settings — {"failing":9,…}
✗ no record of another name is rewritten (a collision never touches a stranger) — {"rewritten":["soigne-2"],"strangers":["soigne-2"],
  "answer":{"ok":true,"id":"soigne-2","preset":{"id":"soigne-2","name":"Cabinet","source":"file","at":1000,"settings":{"acc":"#abcdef"}}},…}
✗ the unrelated record keeps its name, its catalogue link (gid) and its version (v) — {"id":"soigne-2","name":"Cabinet","source":"file",…}
✗ the import answers its own name, never the name of the record it collided with — {"ok":true,"id":"soigne-2","preset":{"id":"soigne-2","name":"Cabinet",…}}
FAILED — ground 1, import invariant (7 checks)
```

**What the fix must make true** (`preset-store.mjs`, both branches): an import never replaces a record whose
`source === 'me'` (whatever id it names); and the suffixed-candidate walk matches only a record the import itself
created — identified by the import's own name/`gid`, never by "an id already exists" alone. A1-1 names the remedy: free
name + suffixed id (the probe also accepts a clean `{ ok:false }`, because a refusal is not data loss; the spec's remedy
is the free name). The existing narrowing at `test-preset-store.mjs:150-162` ("a different id") is what let this ship.

---

## GROUND 2 — the trust level is minted by the document, and the verifiers have no caller (F-25/F-26/F-1)

**Frozen rule it breaks.** `A6-theme-installer-strategy.md:42` (verified before anything reaches the manager, the
catalogue's signature first, then the archive hash, then the author/reviewer signatures) and `:75` (« the level
`verifyEntry` computed »); `A7:122-141` (levels come from A6's verifier). Anchors:
`theme-installer.mjs:137-182` (`verifyEntry`/`verifyArchive`), `:445-480` (`catalogueView`), `:468` (the copied level),
`index.js:10751-10755` (the only `handleThemes` caller — no `catalogues` port).

**Probe:** `docs/tests/probes/probe-catalogue-trust.mjs` (14 checks, 8 red, exit 1). It runs A6's own route on its own
temp store with a **really signed** catalogue (`node:crypto` ed25519), through the route's own `source-add` + GET.

1. **(a) a self-pinned source never mints `official`.** The person adds their own source with its own key (TOFU); the
   document claims `level:'official'` and its manifest claims `trust:'official', official:true`. The entry is signed by
   the same key (author signature only). The level that comes out must be `community` — `official` requires the
   `kybernos/` namespace **and** a key in `officialKeys`, and no such key ships. Today: `level:"official"`, copied
   straight from the document.
2. **(b) an unverifiable author signature is refused.** Same catalogue, `authorSig` signed by another key: no card, and
   the `refused` lines carry the verifier's own code (`signature`). Today: the card is offered with `level:"official"`
   and `refused: []` — proof that `verifyEntry` never runs on this path.
3. **(c) production call sites.** A static sweep of every production `.mjs`/`.js` under `packages/` (test files
   excluded): `verifyArchive` has **0** call sites outside its own definition; `catalogueView` never calls
   `verifyEntry`; and the catalogue view still reads `newest.level`. The same section proves `verifyEntry` itself is
   sane (a yanked entry is refused) — the verifier is right, the route does not use it.
4. **(d)** `verifyArchive` itself is sane: real bytes verify (hash + author signature → `community`), other bytes are
   refused on `hash`, an archive over `IMPORT_MAX` (8 MiB) on `size`. Its missing caller is (c).

Captured failing output (`node docs/tests/probes/probe-catalogue-trust.mjs`, exit 1):

```
✗ the document's own level: "official" is NOT the level that comes out — {"id":"kybernos/medecin","version":"1.0.0","catalogueKey":"self-1","level":"official",…}
✗ ...the level is the one an author signature earns: community — {…"level":"official"…}
✗ ...and the manifest's own trust claims change nothing — {…"level":"official"…}
✗ no card is offered for an unverified author signature — [{"id":"kybernos/medecin",…,"level":"official",…}]
✗ the refusal is named with the verifier's own code (signature) — []
✗ verifyArchive has a call site in the production path (today: none) — []
✗ the route's read path calls verifyEntry (today: the level is copied instead) — "const catalogueView = (sources, catalogues) => {…}"
✗ the catalogue view never reads a level from the document (`newest.level` nowhere in theme-installer.mjs) —
  "        level: typeof newest.level === 'string' ? newest.level : 'community',"
FAILED — ground 2, catalogue trust (14 checks)
```

**What the fix must make true (lead decision M16 — WIRE the transport, do not cut the half):** `handleThemes` gets real
catalogue bytes from the declared sources through the bounded download rules `A6:42` names
(`packages/kybernos-hub/telechargement.mjs`: https only, size cap, streamed while hashed, tar listing that may not leave
its folder — copied, not imported, as `themes-catalogue.mjs:97-104` already does); every offered entry goes through
`verifyEntry` (level computed, `officialKeys` empty/shipped-key-only), the archive through `verifyArchive` before it is
handed to the manager; the level never comes from the document; and `index.js:10751` passes the fetched `catalogues`
port so the marketplace stops being empty. Probe (c) then greens without a test ever calling the verifiers itself.

---

## GROUND 3 — the two frozen A1-kit-wizard invariants are red because they are file-wide (F-39/F-40)

**Frozen text under test.** `A1-kit-wizard-strategy.md:259-290` (DoD 4: `__KB_THEME_APPLY__` « appears exactly once »,
file-wide) and `:95-99` (the `pack.kit` grep count 0 — a measured claim in a DECISION section, F-40).

**Probe:** `docs/tests/probes/probe-wizard-invariants.mjs` (9 checks, 3 red, exit 1). It states the **consumer-aware**
form the spec must take, on the same text the DoD reads:

1. **(a)** the file holds **exactly one** raw `__KB_THEME_APPLY__` read, and it is inside `KB-OB-CORE` (the block that
   publishes `kbObThemeSeam`); the wizard UI calls the helper, never the window. Today: **2** reads —
   `client.js:26089` (the marketplace's `kbThPorts().style`) and `:36961` (`kbObThemeSeam`).
2. **(b)** no other consumer holds a raw read: `KB-TH-CORE`, the page's `kbThPorts().style` (in the wiring section
   after `KB-TH-CORE-END`, client.js:26087-26092) and the `KB-MARKET-*` blocks must go through the published helper;
   the theme bundle still publishes the seam once. Today the style port reads `window.__KB_THEME_APPLY__` itself.
3. **(c)** inside the wizard's own blocks (`KB-OB-CORE` + `KB-OB-UI`) the `pack.kit` family (`pack.kit`, `.kit.teams`,
   `.kit.automations`, `kit.themes`) appears **zero** times, and `kbObKitOf` still derives the kit from the goals.
   **Passes today** — which is the point: the invariant the spec *meant* survives a second consumer; only the file-wide
   counting is broken.
4. **(d)** prints, as evidence and not as an assertion, the file-wide numbers and where the hits are (the marketplace's
   legitimate `plan.kit` use), i.e. why a file-wide count can only be red on a merged tree.

Captured failing output (`node docs/tests/probes/probe-wizard-invariants.mjs`, exit 1):

```
(a) one published seam: exactly one raw read, inside the wizard's own block
  ✗ the file holds exactly ONE read of __KB_THEME_APPLY__ (today: two, one of them the marketplace's) — {"count":2,"lines":[26089,36961]}
  ✗ ...and that read sits inside KB-OB-CORE, the block that publishes the seam helper — {"lines":[26089,36961],"coreBeginsAt":36544}
  ✓ the wizard's UI applies the look through the published helper, never a bare window read
(b) no other consumer holds a raw read
  ✓ KB-TH-CORE (the installer page and the published install seam) reads no raw seam: it goes through the helper
  ✗ ...its style port (kbThPorts().style) holds no raw read either — {"excerpt":"const kbThPorts = () => {…"}
  ✓ the marketplace blocks hold no raw read at all
  ✓ the theme bundle still publishes the seam once
(c) the narrowed pack.kit invariant: zero in the wizard's own blocks
  ✓ KB-OB-CORE + KB-OB-UI contain no pack.kit / .kit.teams / .kit.automations / kit.themes (today: zero — the spec's meaning survives)
  ✓ the wizard still derives its kit from the pack's goals (kbObKitOf)
(d) what a FILE-WIDE count says (evidence, not an assertion)
  · file-wide raw seam reads: 2 (lines 26089, 36961)
  · file-wide pack.kit family: [{".kit.teams":2},{".kit.automations":2}] — all of it outside KB-OB (the marketplace's legitimate use)
FAILED — ground 3, consumer-aware invariants (9 checks)
```

The two frozen commands themselves, run verbatim today:

```
$ bash <DoD 4 block, A1-kit-wizard-strategy.md:260-289>
FAIL wiring: __KB_THEME_APPLY__ appears 2 time(s): exactly one, in the core helper
exit=1

$ node -e '…split(client.js) on pack.kit/.kit.teams/.kit.automations/kit.themes…'
pack.kit 0 · .kit.teams 2 · .kit.automations 2 · kit.themes 0      (total 4, all outside KB-OB)
```

**The spec edit this stage proposes** — replace DoD 4's file-wide seam count (and narrow the `:97` measurement) with
this consumer-aware check, which passes the moment the marketplace is routed through the one helper:

```bash
node --input-type=module -e '
import { readFileSync } from "node:fs"
const s = readFileSync("packages/kybernos-plugin/client.js", "utf8")
const core = s.slice(s.indexOf("// KB-OB-CORE-BEGIN"), s.indexOf("// KB-OB-CORE-END"))
const ui = s.slice(s.indexOf("// KB-OB-UI-BEGIN"), s.indexOf("// KB-OB-UI-END"))
const ports = s.slice(s.indexOf("const kbThPorts = () => {"), s.indexOf("const kbThPresence ="))
const reads = (t) => t.split("__KB_THEME_APPLY__").length - 1
const bad = []
if (reads(s) !== 1) bad.push("__KB_THEME_APPLY__ is read " + reads(s) + " time(s) in the file: ONE raw reader, in the core")
if (reads(core) !== 1) bad.push("the one raw read is not in KB-OB-CORE")
if (reads(ui) !== 0) bad.push("the wizard UI reads the window itself instead of kbObThemeSeam")
if (reads(ports) !== 0) bad.push("the installer page style port reads the window itself instead of the published helper")
for (const t of ["pack.kit", ".kit.teams", ".kit.automations", "kit.themes"]) {
  const n = (core + ui).split(t).length - 1
  if (n !== 0) bad.push("the wizard consumes " + t + " (" + n + ")")
}
if (bad.length) { for (const b of bad) console.log("FAIL wiring: " + b); process.exit(1) }
console.log("ok   wiring: one published seam, and the wizard consumes no pack.kit")
'
```

and `A1-kit-wizard-strategy.md:97` becomes: « the wizard's blocks (`KB-OB-CORE` + `KB-OB-UI`) contain no occurrence of
`pack.kit`, `.kit.teams`, `.kit.automations` or `kit.themes` (grep count 0); `client.js` as a whole does, in the
marketplace's `plan.kit` rendering — a second consumer this batch does not own ». The rest of DoD 4 (`kitApply` applies
through `kbObThemeApplied`, the `complete` post carries `theme`, the Kit screen shows `kit-theme`) stays untouched and
green, and stays file-scoped where it is genuinely the wizard's own.

**The code edit:** `kbThPorts().style` (client.js:26087-26092) stops reading `window.__KB_THEME_APPLY__` and calls the
one published helper (`kbObThemeSeam(...)`), so the file-wide raw read becomes 1 again — no alias, no second door.

---

## GROUND 5 — the suites prove fixtures, not the product (F-27)

**What the review measured.** `marketCards` reads `entry.manifest.{name,description,author,license}` while the route
sends **flat** `name`/`author`/`licence` and no description (`client.js:30473-30480` vs `theme-installer.mjs:463-476`);
`marketReport` reads `result.added/skipped/failed` and `answer.plan` while the published seam answers
`{ ok, id, version, report }` (`client.js:30576-30601` vs `:26197`). Both fixtures — the review cites
`test-theme-market.mjs:27-64,191`, measured on this tree at **26-65** (the three entries and `VIEW`) and **169-174**
(the §7 plan) — bake the shapes the readers expect.

**Probe:** `docs/tests/probes/probe-market-contract.mjs` (16 checks, 6 red, exit 1) — the reviewer's own recipe, with
both halves cut out of the two packages and run as the product runs them:

1. **Cards.** A really signed catalogue goes through A6's own `handleThemes` (POST `source-add`, then GET); **its actual
   answer** is fed to A7's own `marketCards` (extracted from `KB-MARKET-PURE`, the shipped suites' idiom). The card must
   carry the theme's name (`Medical practice`), a description, the author, the licence, the version, the archive hash
   and size, and the level the verifier computed. Today every textual field is `""`.
2. **Report.** A real `planTheme` plan goes through A6's own `kbThApply` (extracted from `KB-TH-CORE`, fake ports); its
   answer is wrapped exactly as the published seam wraps it (`{ ok, id, version, report }`) and fed to A7's own
   `marketReport` through the page's own call convention (`:30660,:30664`). The report must draw the style and its
   accent, the kit line, and the answered counters. Today: **zero rows** without a plan, and no `added` row with one.

Captured failing output (`node docs/tests/probes/probe-market-contract.mjs`, exit 1):

```
✗ the card carries the theme's name, as the route sent it — {"card":{"id":"kybernos/medecin","version":"1.0.0","name":"","description":"","author":"","license":"",…},
  "routeName":{"en":"Medical practice","fr":"Cabinet médical"}}
✗ the card carries a description — {"id":"kybernos/medecin",…,"description":""…}
✗ the card carries the author — {"id":"kybernos/medecin",…,"author":""…}
✗ the card carries the licence — {"id":"kybernos/medecin",…,"license":""…}
✗ the answered counters are drawn even when the answer carries no plan (today: zero rows) — []
✗ the report draws A6's plan: the style and its accent, the kit, then what was added — [{"kind":"style","text":"Style","id":"clinic-style","acc":"#1B7F76"},
  {"kind":"kit","text":"Adds 1 skill and 1 team"}]
FAILED — ground 5, market contract (16 checks)
```

**What the fix must make true:** `marketCards` reads the shape the route emits (flat `name`/`author`/`licence`, and the
route gains `description` so the card has one), `marketReport` reads `answer.report` (and the answer carries the plan the
report needs), and `test-theme-market.mjs` **stops baking** its two fixtures: it feeds a real `handleThemes` GET answer
and a real `kbThApply` answer, exactly as this probe does.

---

## Promotion table — where each assertion must land before the merge

| Probe assertion | Collected test it must become part of |
|---|---|
| (1a) any-id `me` record byte-for-byte; (1b) stranger untouched with `gid`/`v` | `packages/kybernos-theme/test-preset-store.mjs`, import section (replacing the "different id" narrowing at 150-162) |
| (2a) self-pinned source never `official`; (2b) unsigned entry refused | `packages/kybernos-plugin/test-theme-installer.mjs`, catalogue section |
| (2c) `verifyEntry`/`verifyArchive` production call sites; no `newest.level` | `packages/kybernos-plugin/test-theme-installer.mjs` (source check) |
| (5 cards) real GET answer → card fields | `packages/kybernos-plugin/test-theme-market.mjs` §1 (replacing the fixtures at 26-65) |
| (5 report) real seam answer → report rows | `packages/kybernos-plugin/test-theme-market.mjs` §7 (replacing the baked plan at 169-174) |
| (3) one raw seam read, in `KB-OB-CORE`; no other consumer raw; `pack.kit` zero in the wizard's blocks | `scripts/test-onboarding.mjs` (the wizard's collected suite) + the consumer-aware DoD 4 command in `A1-kit-wizard-strategy.md` |

Until then the probes stay in `docs/tests/probes/` (run by hand, deliberately outside discovery). When the assertions
are collected, the probe files are either deleted or kept as this notebook's executable evidence — the fix stage
chooses, but the merge gate must carry them.

## What this stage did NOT do

- No file under `packages/` or `scripts/` was edited; the four probes and this notebook are the only additions.
- No spec file was edited: the Ground 3 scoping is **proposed** above (ready to paste) and the specs stay as the review
  found them until the fix stage accepts it.
- Ground 4 (the ten pre-existing reds) was measured, not touched.
- No commit: the files are new and uncommitted (`docs/tests/probes/`, this file).

## Hand-off order for the fix stage

1. **Ground 1** first (user data): `applyPreset`'s two branches, then promote (1a)/(1b) into `test-preset-store.mjs`.
2. **Ground 2** (M16): wire the catalogue + archive transport through `verifyEntry`/`verifyArchive`, then promote (2a)-(2c).
3. **Ground 5**: fix the two wire shapes and replace the fixtures with the contract test.
4. **Ground 3**: route `kbThPorts().style` through the published helper, re-scope DoD 4 and `:97`, promote (3).
5. Re-run `node scripts/run-all-tests.mjs` and the four probes: 0 new red, and each probe green.
