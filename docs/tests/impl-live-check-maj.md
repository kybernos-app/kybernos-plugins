# Implementation — the live wizard check, aligned with the shipped packs (MAINTENANCE)

**Verdict: pass.** The six live assertions the campaign measured against data that has since
changed now match what ships, and they are proved on a genuinely theme-less input (M11) and on the
shipped note copy (M10). Nothing else moved: the pre-existing cascade and the Kit-scroll breach are
untouched, and no new red appeared.

- Tree: this checkout, HEAD `4ddb135e` (A6 + A7 merged) plus the working tree's uncommitted files.
  The campaign notebook (`docs/tests/campagne-tests.md`) is stamped to `9c3dfe3d` + A7's diff; this
  report is measured on today's tree (see §6).
- Sandbox: `bash scripts/sandbox/start.sh` (port 3098), state reset to a clean kit before the first
  run. The check signs in with the signed session cookie, never the stale token URL.
- Every figure below is a command's output; the raw logs are `/tmp/kb-live-before-clean.txt`,
  `/tmp/kb-live-after-maj.txt`, `/tmp/kb-live-base.txt` (the pre-campaign `2ac67fb4` run kept by the
  campaign) and `/tmp/kb-live.txt` (the campaign's own 30).

## 1. Files touched

| File | Change |
|---|---|
| `scripts/check-onboarding-live.mjs` | **the only source file**: +41 −12 (nine hunks, §3) |
| `docs/tests/impl-live-check-maj.md` | this report |

No frozen fixture file exists and none was added: the check reads the host's own
`GET /kybernos/domains` at run time (it embeds no pack JSON), so the « no style » fixture is built
inside the check from that answer (§3.3).

## 2. The six rows, before → after

Campaign §3A, one line each (labels kept verbatim except the two whose wording became false).

| # | Check | Why it was red | After |
|---|---|---|---|
| 1 | `the field of work is asked, with the nine fields the packs ship as tiles…` | A3 shipped a tenth pack (`recrutement`); the host serves and the page draws 10 tiles | **green** — expects ten (label says ten) |
| 2 | `a field without a style shows no style line on the Kit screen` | the run's field, Education, carries `"theme": "education"` since A8, so the line is drawn | **green** — the run is served the same pack without that key |
| 3 | `…and the kit applies no style for it: the seam is never called \| ["education"]` | same cause: the seam is called with `education` | **green** — no call, read only once the kit step has left |
| 4 | `the complete answer carries the theme field — null here…` | same cause: the body carried `"theme":"education"` | **green** — `null`, because the served pack carries no theme key (label reworded) |
| 5 | `the host serves the nine packs, none rejected \| {ids:[10 ids],rejected:0}` | A3's tenth pack | **green** — the ten ids in the loader's order |
| 6 | `a field with a style announces it on the Kit screen with one plain line… \| This field's look is applied with the kit. Settings › Theme keeps the last word.` | the check demanded `/Style/`; M10 rules the copy names the page as it exists today (`Theme`) | **green** — expects `Settings › Theme keeps the last word` |

The campaign's own arithmetic in its §4 counts **six** rows (three no-style, one wording, two
counts); the brief's « 6 drifts + 1 wording » describes the same six. Campaign-attributable reds:
**6 → 0**.

## 3. The assertions updated (one line each)

1. **Tiles** (`5c`): `=== 9` → `=== 10`, label « nine » → « ten », with the count's provenance in a
   comment: one file per field in `packages/kybernos-plugin/domains/*.json` (ten since A3's
   `recrutement`), read sorted by `order` in `packages/kybernos-plugin/domain-pack.mjs`
   (`packs.sort`) — so the tiles and the route's ids are that one list.
2. **Route ids** (`5e`): the frozen list gains `recrutement` before `general` — the loader's `order`
   (edu 10, sante 20, immo 30, droit 40, fin 50, com 60, mkt 70, dev 80, recrutement 90,
   general 99), verified by running the loader itself (`count 10 rejected 0`). Still frozen on
   purpose: a pack that stops being served or a rejected file must show here.
3. **The no-style fixture** (M11): the run's own field (`NO_STYLE_PACK = 'edu'`) is served as the
   host's own pack **with its single `theme` key removed** — a response-stage rewrite of
   `GET /kybernos/domains`, never a pack written in the check. Nothing else in that pack changes.
4. **New proof of the fixture**, before it is leaned on: *« the no-style fixture is the host's own
   Education pack with its one theme key removed (M11 — A8 themed it) »* — the shipped answer names
   `"education"`, the copy the page got is that same object minus `theme` and nothing else (whole-body
   comparison), so the fixture cannot drift silently. The styled path stays live in `6b` on Health's
   real pack (`cabinet-medical`).
5. **The complete answer** (`5c`): label now says *« null here, because the served Education pack
   carries no theme key »* (the old clause « Education names no style » had become false); the
   assertion itself is unchanged (`theme === null`, `profil === 'edu'`).
6. **The note copy** (`6b`): `/Style/` → `/Settings › Theme keeps the last word/`, with a comment
   that M10 ties this expectation to A5's rename: the check follows the page, it does not lead it.
7. **No vacuous « never called »** (`5c`): the seam-absence read now waits for the kit step to have
   left (`waitFor` on the kit rows disappearing or the « n added » state) before it counts calls —
   before the installs are in, « no call yet » and « no call » were the same string. Tightening, not
   loosening.
8. **Re-runnability** (`forgetKitTeams`): the second automation the kit makes, « Learn my business »
   (fr « Apprendre mon métier »), is now cleaned like the first. Left behind, a second run found it
   made, ticked one row less, and every count on the Kit screen drifted — the same pollution the
   campaign recorded in its §3B caveat (« the second run is not a clean A/B »). Found by measurement:
   a first, polluted run scored 67 reds with the kit blocked mid-install; after the cleanup the
   baseline is the 28 below. It changes no expectation.
9. **Comment only** (top of file): `NO_STYLE_PACK` documents why the run's field is theme-less.

## 4. Measurements (same tree, same sandbox, clean kit, back to back)

Command, both runs:

```
bash scripts/sandbox/start.sh                       # port 3098
source scripts/sandbox/env.sh && KB_SHOT_DIR=/tmp/kb-live-check-maj/<run> node scripts/check-onboarding-live.mjs
```

| | Before (old check) | After (new check) |
|---|---|---|
| `check(s) FAILED` | **28** | **22** |
| `ok` lines | 158 | 165 |
| exit | 1 | 1 |
| screens measured | 27 | 27 |
| campaign-attributable reds | **6** | **0** |
| FIT report | 27 screens; kit over 987 (Education), 1054 (Finance) | 27 screens; kit over 949 (Education), 1054 (Finance) |
| skips | none | none |

The Education overflow shrinking by exactly 38 px is the style line the theme-less fixture no longer
draws; the screen still overflows by 949 px, which is the **ticketed** breach (`docs/tests/campagne-tests.md`
§3C and anomaly 8), untouched here.

## 5. Perimeter proof

- **Exact delta, no new red.** Label sets compared with `comm`: the six labels of §2 are in the
  before-set and absent from the after-set; the after-set has **no label the before-set did not
  have** (the four reworded labels — tiles, route ids, complete answer, fixture proof — are green,
  so they appear in neither set).
- **Remaining reds are the pre-existing cascade.** All 22 are in the `2ac67fb4` run's set
  (`/tmp/kb-live-base.txt`, 64 fails, 63 distinct labels): the model question and its pairing
  (`the question can be left for later`, the pairing/paste/other-providers rows, the account block),
  the Settings hand-over, `the workspaces page is titled… "Workspaces"`, the Creations order, and the
  composer's three card rows. None is in a file this batch touched.
- **The cascade was not touched.** No expectation of it was changed, skipped or reordered; the first
  failure of the before-run is the first failure of the after-run, at the same place.
- **The Kit-scroll breach was not « fixed ».** It is measured (FIT line above), still over, and
  remains the ticket's.
- **The invariants suite did not forbid the change, and still passes.** Run **before** the first
  edit: `node scripts/test-live-checks.mjs` → `ALL GREEN` (its onboarding invariants pin
  `FINISHED_FIRST_RUN`, the verdict-in-`finally`, and the kit rows read after the `pdf` mark —
  all still matched after the change). Run **after**: `ALL GREEN` (50 checks). `node --check
  scripts/check-onboarding-live.mjs` passes.
- **Nothing loosened.** The only relaxed-looking edit is /Style/ → /Settings › Theme…/, which is the
  ruling and is *stricter* (it now asserts the whole sentence); counts went up, not down; the fixture
  gained a provenance assertion it never had; the seam-absence read got a completion condition.

## 6. Caveats and out of scope

1. **The tree moved after the campaign.** The campaign measured 30 reds at `9c3dfe3d` + A7's
   uncommitted diff; today's HEAD is `4ddb135e` (`themes: the installer and the marketplace (A6 + A7)`).
   On today's tree the same six rows are red again (proved by the before-run), but **two** of the
   campaign's 30 no longer reproduce — `the miniature starts level with the subtitle, within 2 px`
   and `hovering a field shows it at once…` now pass — hence 28, not 30, at baseline. That pair is
   not this batch's: it is a tree movement, recorded so nobody reads 28 as « two fixed here ».
2. **The fixture's perimeter, stated plainly.** The run plays a *theme-less copy* of Education, so
   the wizard's no-style path is exercised on a genuinely theme-less input while its content
   assertions (kit rows, goals, memory text, menu wording) still come from the real pack. The
   *shipped* themed path is not simulated: `6b` proves it live with Health's real `theme`
   (`cabinet-medical`), the line's copy, the seam call and a real look change (`the look really
   changed`, green).
3. **A doc still says nine** — `docs/dev/domain-packs.md:157` (« nine here: … general »). It is A3's
   doc, not this batch's file; reported, not edited.
4. **The pre-existing cascade and the Kit-scroll breach are open tickets**, per the campaign's §4
   anomalies 7 and 8. This batch deliberately leaves both.
