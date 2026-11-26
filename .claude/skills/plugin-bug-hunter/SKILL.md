---
name: plugin-bug-hunter
description: Hunt behaviour bugs in the CODE of the Kybernos plugins (host routes, persistence, security guards, automations, concurrency, the test suite itself) with several read-only agents in lanes, prove each finding with a script, merge them into one ledger, then fix them in batches with a failing test first. Use when asked to hunt bugs in the plugins, audit a package's code, run a "chasse aux bugs" on the code, or check a package before a release. For what a screen looks like, use ux-bug-hunter instead.
---

# Plugin bug hunter

One campaign, two phases: **hunt** (read-only agents, one lane each, every finding proven) and **fix** (one batch at a time, the worst first, each fix
with a test that fails without it). The screen is ux-bug-hunter's job; this skill is about behaviour that is wrong in the code. Read `AGENTS.md` first.
First run: 2026-11-08 (3 lanes, 23 findings, 2 P0 and 7 P1 bugs, all of lots 1 to 3 fixed the same evening).

## 1. Prepare (the lead, before any agent)

1. **Baseline:** `node scripts/run-all-tests.mjs` once (about 140 s, in the background: a shell command dies at 300 s). Note the red, the flaky and the
   skips: a flaky file is a first suspect, a skip is code nobody tests.
2. **Where bugs live:** lines and churn per package (`git log --since=21.days --oneline -- packages/<p> | wc -l`). Lanes go where the code moves.
3. **A scratch folder outside git** (for example `../chasse-bugs-plugins-<date>/` with `constats/` and `repro/`) and a `CONSIGNES.md` in it that every agent
   reads: the rules of section 2, the bug families of section 3, the output of section 4.
4. **Tell the person the strategy and wait for the go**: lanes, what is not covered, the budget.

## 2. Lanes and rules of the hunt

A lane is a package (or part of one) x an angle. Run **three lanes at a time**, about 40 minutes each; six at once cost more and were not faster.
Lanes that paid on 2026-11-08: the server side of `kybernos-plugin` (automations), `kybernos-cloud` from the security angle, the health of the test suite.
Not yet hunted: `kybernos-plugin/client.js`, the data packages (`kybernos-db`, `dsh-db-viewer`, `kybernos-dashboards`), the realtime ones
(`kybernos-sessions`, `-mobile`, `-multi-device`, `-call`, `messaging`, `front-desk`).

Every hunter:
- is **read-only on the repo**: no edit, no branch, no worktree (bundles are served hot from disk: a write to a `client.js` is live in the person's GUI);
- writes its repro scripts in the scratch `repro/<lane>/`, uses `mkdtemp` for any file, never touches `~/.dsh` or `~/.kybernos`, never writes through `:3080`;
- **starts from churn** (`git log --since=21.days -p -- <packages>`), then the host side, then the client;
- **proves** a P0 or P1 with a runnable script (or a precise scenario with file:line); without proof the verdict is `suspect`;
- **writes each finding as it goes**: after EACH finding it rewrites `constats/<lane>.json` (a tmp file, then rename) or appends one line to
  `constats/<lane>.jsonl`, never only at the end (a hunter cut off on 2026-11-08 lost all its findings);
- reports behaviour only: no style, naming, docs or refactoring;
- keeps each command under two minutes and runs the full suite at most once.

## 3. Bug families (what to look for)

- **Persistence:** a write without tmp + rename, a read-modify-write across an `await` (two calls lose one), a file that does not parse read as empty and
  then rewritten (the data is gone), unbounded growth.
- **Guards:** a check that compares against the wrong thing (the session's first folder instead of the current one, `~/` taken as a folder name), a flag
  cleared by something that is not the person (a sub-agent's prompt is a user message too), a card that cuts what the person approves, a route that
  answers `Access-Control-Allow-Origin: null`, a gate that a quote in a file trips (the 2026-11-08 approval storm).
- **One per session where there can be several:** a Map keyed by session id when several runs share a chat (the run guard, the load cap).
- **Errors:** a catch that hides a failure, an unhandled rejection, a client factory without try/catch.
- **Time:** time zones and daylight saving, cron off-by-one, timers never cleared.
- **Tests that cannot fail:** a fixture that is refused for another reason (a link to a `.txt` in a "link is not followed" test), a limit tested only
  above it, a test that reads the maintainer's `~/.dsh` (red on CI), a skip not printed as `SKIPPED:` (counted nowhere), a port taken from `listen(0)`
  (the next ephemeral ports: flaky in the parallel suite). Prove it with a **mutant**:
  `node scripts/mutation-check.mjs --file <path> --from '<product text>' --to '<broken text>' --test <test path>` breaks the line in a temp copy of the
  tree and runs the test as CI does: `killed` (exit 0) the test can fail, `survived` (exit 1) it cannot; the repro of such a finding is that command.

## 4. Output and the ledger

Each lane writes `constats/<lane>.json`, an array of
`{ id, package, where: "path:line", family, severity: P0|P1|P2, verdict: bug|suspect, title, detail, repro, evidence, confidence, fix_hint }`
(at most 15, best first), or `constats/<lane>.jsonl` with one finding per line (a broken line is refused by its number, the others kept) and a five-line `constats/<lane>.md` with what it did NOT cover. Severity: P0 data lost or a security hole, P1 a feature fails,
P2 real but rare or contained.

Then the lead runs **`node scripts/bug-hunt-ledger.mjs <scratch folder> --out <scratch>/ledger.md`**: it refuses a malformed finding or a P0/P1 bug
without a repro (exit 1, listed), merges the findings two lanes made on the same lines, and writes the list worst first (`scripts/test-bug-hunt-ledger.mjs`
proves it). Add **`--verify`** (before triage, and again after the fixes): it runs every P0/P1 repro that names a `.mjs` inside the scratch folder
(`node <file>` from its folder, one at a time, 60 s each, a path outside refused) and adds a "Verify" section with each exit code (or timeout) and last
output line. It records, it does not judge: read the lines yourself before believing a finding or calling it fixed. Then report to the person: counts,
the worst ones in plain words, what was not covered, and the proposed batches.

## 5. Fixing, one batch at a time

1. A worktree from `dev` per batch (`git rev-list --count HEAD..dev` is 0). The lead fixes; agents are not needed for this part.
2. **The test first:** add the case to the package's test file and see it fail; then the fix; then the scratch repro must show the right behaviour
   (`bug-hunt-ledger.mjs <scratch> --verify` reruns them all).
3. `node scripts/garde-depot.mjs`, then `node scripts/run-all-tests.mjs` (0 red; `test-no-french-literals` wants French in the familiar form: "ton", not
   "votre"), commit with the finding ids, merge into `dev`, remove the worktree and the branch.
4. Host code (`index.js`, `*.mjs` of a package) only loads on a DSH restart: use the `relancer_dsh` tool, never a shell restart.
5. Update the package README or `docs/dev` where the behaviour is described.

## 6. Pitfalls met on the first run

- **Non-ASCII in a shell command is mangled** by the persistent shell of DSH (French quotes, accents and check marks dropped, words merged, sometimes the
  shell breaks). Write edits with an ASCII-only Python script that uses `\u` escapes, never put an accented character or a check mark in a command, and
  check the diff for non-ASCII lines before committing.
- **An approval storm in Full access** came from our own guard (`kybernos-cloud/untrusted-turn.mjs`): a hunter that printed the guard's own source
  tripped the "has read the web" mark for the whole chat. Fixed; if it comes back, look there first.
- **Stopping agents:** interrupt each one; one that is mid-turn may need a second interrupt.
- A teammate cut off before writing its JSON lost its findings: hence the write-as-you-go rule of section 2; put it in `CONSIGNES.md`.
