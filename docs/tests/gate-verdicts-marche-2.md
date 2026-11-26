# Gate verdicts — marche 2, the two corrected specs (validateur-spec, fail-closed)

Run: cold re-judgement over `A6-theme-installer` and `A7-theme-marketplace` after the owners's M1-M5
correction cycle, 2026-10-28 ~05:35-05:50 (Europe/Paris). Full files read cold on disk (455 and 722
lines). Every anchor was re-checked against the declared baseline `2ac67fb4` (`git show
2ac67fb4:<path>`); the post-baseline campaign files were re-checked on disk (`git cat-file -e` fails
on each, carve-outs honest). This file is the campaign artifact for the marche-2 gate.

Calibration (same as the marche pass): AMEND when a gate check fails in substance — a false premise
that changes what is built or reviewed, an unapplied bound decision, or a dishonest baseline record.
Isolated anchor slips are listed per spec as re-pin fixes and do not flip a verdict on their own; the
owner may veto any GO on the strength of a listed slip.

Ground truth (measured this run, not quoted from the specs):

- **M1 wire**: consistent across both files. ONE document (`kind: "kybernos-plugin-catalogue"`), ONE
  reader (`packages/kybernos-plugin/theme-installer.mjs`, `verifyCatalogue`/`verifyEntry`/
  `verifyArchive`), ONE path (`<DSH home>/kybernos/themes.json` record; no catalogue file path), ONE
  route (`GET /kybernos/themes`) — all A6's; A7 consumes the route and yields its reader, path, route
  and document `kind`. A6's wire section names A7-theme-marketplace as the second consumer and lists
  what A7 drops (its reader/path/route/kind/frozen names/`install.spec`) and the DoDs it rewrites
  (D1/D2/D4/D8) — verified item by item against A7's rewritten file. A7's "shared source" table,
  dropped list and cross-batch wires name A6 and its sections. The two files agree on where the
  listing lives (A6's `client.js`, the card list A7's entry point opens).
- **M2 venue**: two three-line sets, cited in both files, verified disjoint at the baseline — A6
  (`client.js:15849-15861` view branch, `:26169` `kbOpenPage.views`, `:26468-26469` menu rows) and
  A7 (`:3005-3016` `KB_NAV_KEYS`, `:33675` look group's `mots`, `:33696` `ICONES`) — content dumped
  line by line at `2ac67fb4`, each exactly what its spec claims; no shared line or range.
- **M3 one-click**: held in both (A6 INT3/E2/V5, A7 INT6/E1/V8/D7): the click is the person's consent
  for the theme shell (style + field); the kit keeps the wizard's ticks (un-ticked = skipped and
  reported); automations always `active: false` + `approvals: "ask"`.
- **M4 defaults**: held (A6 AMB1-6 each ratified with its one-word veto; A7 points at A6's §AMB1-5
  instead of restating them): staging order (inert package before the one ask), Remove keeps the kit,
  ONE `Themes` page with A7's listing a view over it, contributed `skills/` write deferred, official
  key = refuse unverifiable sources.
- **M5 re-pins**: all seven landed and verified exactly at the baseline — `index.js:30` (the packs
  import), `plugin.json:67` (`fs.write:dsh-home`), `plugin.json:51` (`ui.slot:conversation.view`),
  `registry.mjs:37-39` (symlink refusal), `plugin-contract.md:86` (the `author` row),
  `packages/kybernos-hub/client.js:295` (`KB-PLUGINS-PURE-BEGIN`), `A2-registry-points-strategy.md:19`
  (the lane line). Every post-baseline campaign file cite carries an explicit "campaign file,
  post-baseline" carve-out (A6 names its three inline; A7's head note names its four plus its A6
  carve-out) — `git cat-file -e 2ac67fb4:<path>` fails on each, measured.
- **Anchor sweep** (mechanical over every explicit `file:line`, short names resolved by the specs' own
  conventions): A6 223 anchors, 0 out of range; A7 205 anchors, 0 out of range. Content spot-checks
  (~25 load-bearing claims dumped at the baseline): the two signed messages, "nothing is parsed before
  its signature verifies", the catalogue document shape and `seq` rule, sources/pinning, the five
  levels and "a level never survives a change", the kit ticks and the three switch rules, the registry
  preview, `sourceOf`/stored level, `kt`/`pair`, the hub's `settings.section` order 29 and try/catch,
  `test-settings-nav.mjs:117-121`, the `KB-OB-CORE` extraction idiom, `pack.kit`, A2's theme-id
  vocabulary, the manifest fields — all exact.
- **DoD discrimination**: all 15 commands (A6 7, A7 8) extracted verbatim from the spec files and run
  cold from the repository root. **All 15 exit 1 today, each for the reason its spec quotes** —
  `ERR_MODULE_NOT_FOUND` on `theme-installer.mjs` (A6 D1/D2/D5/D6), the `KB-TH-CORE` absence (A6
  D3/D4), A6 D7 silent exit 1, A7's eight quoted `FAIL:` lines. No DoD is green today.
- **Six sections** `e2e:` `vision:` `capture:` `maquette:` `unit:` `DoD:` at line start: present in
  both specs.
- **Perimeters**: A6's declared four files vs A7's (`client.js` two marked blocks + three granted
  rows, `test-theme-market.mjs`, `README.md` one line, the out-of-git maquette) — disjoint at the
  declared level, the `client.js` overlap bounded to disjoint venue lines plus each batch's own marked
  blocks; A7 registers no route (D4, its Lane falsifier).

---

## docs/tests/A6-theme-installer-strategy.md

verdict: GO
blame: none
raison: Every mandated check passes on measured ground truth. The M1 wire is this batch's shape and
it names A7-theme-marketplace as its second consumer of `GET /kybernos/themes`, lists what A7 drops
and which of its DoDs it rewrites (verified to match A7's rewritten file), and carries the one-word
reverse; no second source, reader, path or route appears anywhere in the file. M2's three venue lines
are cited and verified disjoint from A7's three at the baseline. M3 and M4 hold: the one-click rule is
argued through INT3 (the click is the shell's consent, the ticks authoritative, an empty tick list
writes nothing — D3 asserts it), and all six former AMBIGUITYs are ratified decisions with their
one-word vetoes kept. M5's three re-pins landed exactly (verified line by line at `2ac67fb4`) and the
three campaign-file cites carry explicit carve-outs (measured: `git show 2ac67fb4:` fails on all
three). Anchor sweep 223 checks, 0 bad; 7/7 DoDs run cold exit 1 for the quoted reasons and none
contradicts the unit section (D3's `added: 5` matches the unit's own example); six sections at line
start; the write perimeter is declared as exactly the four files and contains no engine patch, no
compat bump and no registry/theme file. Re-pin fixes, non-flipping: (1) `§GET`'s cite for "the
embedded manifest's name, author, licence, points and permissions" points at `plugin-contract.md:
415-423` (the levels table and the card sentence) — the manifest's own fields are `:78-:95` (A7 cites
them exactly; the claim itself is true); (2) `README.md:15-18` (the sidebar sentence) is attributed to
"this batch's edit" by A7's file table, while this spec's declared perimeter is four files and never
names `README.md` — one line must move (see ambiguities).

## docs/tests/A7-theme-marketplace-strategy.md

verdict: AMEND
blame: spec-error
raison: The correction cycle itself is sound and complete: the M1 yield matches A6's wire item for
item (its reader/path/route/kind and frozen names dropped, `D8` greps they stay absent; D1/D2/D4/D8
rewritten; "Depends on A6 — lands after" stated); M2's three granted rows are cited and disjoint from
A6's (verified at the baseline: `KB_NAV_KEYS :3005-3016`, look `mots :33675`, `ICONES :33696`); M3 and
M4 hold (INT6, E1, V8, D7; the defaults point at A6's ratified §AMB1-5); M5's four re-pins landed
exactly and the carve-outs are explicit; anchor sweep 205 checks, 0 bad; 8/8 DoDs run cold exit 1 with
exactly the quoted `FAIL:` lines; six sections at line start. It fails in substance on one internal
contradiction of its own DoD/unit pair: **D2 forbids the literal `sha256` in the `KB-MARKET-PURE`
block** (`/(createPublicKey|createHash|sha256|verifyEntry|verifyCatalogue|officialKeys)/`), **while
the unit section requires that same block to carry `sha256`** — `marketCards`' card fields include
`source`, `sha256`, `size`, and `marketInstallable` must check `entry.archive.sha256`. No conforming
implementation can make D2 exit 0; the spec's own done-condition ("the batch is done when D1-D8 exit
0") is unreachable as written, and the only way through is to game the regex (name the field via key
enumeration), which is not an implementation. The fix is one token: drop `sha256` from D2's forbidden
list (`createHash`/`createPublicKey` already forbid hashing) — or drop `sha256`/`size` from the card
fields and restate `marketInstallable`'s presence check. Re-pin fixes, non-flipping: (1) D4's note
claims it proves "the route is registered **once**, by A6's file, **in the whole tree**", but its
`grep -l "path: '/kybernos/themes'" packages/kybernos-plugin/index.js | wc -l` can only ever answer 0
or 1 for that one file — a duplicate registration in another file (or in `index.js` itself) passes;
narrow the claim or grep the plugin's route files; (2) the wires table's "the seam's argument
`{ source: 'catalogue', id, version }` … (A6's amendment freezes both)" is unbacked: A6 names
`__KB_THEME_INSTALL__`/`__KB_THEME_REMOVE__` (`§unit`) but freezes no call signature, so the wire is
frozen on A7's side only (see ambiguities); (3) the `README.md` row's "the sidebar sentence (`:15-18`)
is A6's page and A6's edit" contradicts A6's declared four-file perimeter (same fix as A6's slip 2);
(4) `kybernos-models/client.js:2756-2761` (vision judgement line) drops the `packages/` prefix used
everywhere else; (5) correction 11's quote of A6 `§owe` ("in A7's own bundle") is stale — A6 on disk
says "A7's list is A7's code", with no bundle claim.

---

## Remaining ambiguities (the owner's, nothing here is settled by the gate)

1. **(A6/A7) Who owns `packages/kybernos-plugin/README.md:15-18`** — A7's file table calls it "A6's
   edit", A6's write perimeter is four files and never names `README.md`. Either A6 adds
   `README.md:15-18` to its perimeter (and to its "nothing else moves" discipline) or A7's row drops
   the attribution; as the files stand, that hunk is unowned.
2. **(A7) The install seam's call signature** — `{ source: 'catalogue', id, version }` is frozen by
   A7's INT6/unit only; A6's unit names the two globals but freezes no argument, and A7's wires row
   claims "A6's amendment freezes both". One word from the owner: A6 adopts the signature in its unit
   line (preferred — the wire then has both ends), or A7's row drops "freezes both" and the signature
   stays A7's assumption against a seam whose shape A6 may choose differently.
3. **(A7) The D2 fix direction** — drop `sha256` from D2's forbidden regex (keeping
   `createHash`/`createPublicKey`, which is what "hashes or verifies" means), or drop `sha256`/`size`
   from `marketCards`' card fields and restate `marketInstallable`'s presence check without naming the
   field. Either one resolves the contradiction; the first is the smaller edit and keeps the card
   self-sufficient for A6's installer.
