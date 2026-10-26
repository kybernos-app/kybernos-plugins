# Skills · vetting the picks

`node scripts/vet-skills.mjs` checks the skills Kybernos proposes (`packages/kybernos-skills/featured-picks.json`) and keeps what it learned
in `scripts/vet-skills/ledger.json`. It is run by a maintainer, on a schedule or by hand; users never run it and never pay for it.

## Why

The security audits of skills.sh (Socket, Snyk, Gen, Runlayer, ZeroLeaks) say whether a skill is *dangerous*, not whether it is *useful*.
On 2026-10-26 `grill-me`, our most installed pick (1.36 M), turned out to be a 36-character body that says `Call the Skill tool with "grilling"`:
it passes all five audits, and the installer copies one folder, so the user receives a skill that calls a skill they do not have.
Off-the-shelf linters (skill-check, tested the same day) report the same style warnings for it as for `pdf`. This tool checks the part nobody else does:
**can the model do the job from what the install brings?**

## What a pass does

1. For each source repository (about 10 for the 24 picks): the facts that move without a commit (archived, licence), the commit `HEAD` points at, and
   its whole tree (3 GitHub requests). The tree gives every folder a git hash for free.
2. For each pick, **one key** = the hash of its folder plus the hashes of the folders it hands over to or reads from (`dependencies`).
   The skill is **unchanged** when that key is the key stored in the ledger. Then nothing is downloaded: only the audits are read again
   (one request every 2.5 s, stopped at the first refusal).
3. A skill that is **new**, **updated** (folder or dependency changed, or it moved), under **rules** that changed (`RULES_VERSION` in `core.mjs`) or
   **forced** (`--all`) is downloaded (its `SKILL.md`, the licence file) and checked against the rules below.
4. With `--judge`, the LLM judge reads the skills that passed the code and whose text has no verdict yet.
5. The ledger is written; the report lists only what is new, changed or not a plain pass.

Measured on the real 24 picks (2026-10-26): first pass 74 s, second pass 10 s with `--no-audits` (24 unchanged, nothing downloaded,
the only line of the ledger that moved is `lastPassAt`). It costs nothing in money.

**Frequency.** The cost follows the changes, not the calendar: once a week by hand is the proposal; daily would cost the same few requests.
A new commit in a source repository is only noticed (and the skill analysed again) if it touches the skill's folder or a dependency.

## Rules (RULES_VERSION 1)

A finding is `reject` (would ship a broken or unsafe skill), `flag` (a person looks) or `info` (a fact, never blocks).
The verdict is the worst level that is not waived.

| Rule | Level | When |
| --- | --- | --- |
| `skill_not_found`, `repo_ambiguous` | reject | no folder has a `SKILL.md` whose header `name` is the pick's id, or several do (the installer matches by header name and refuses an ambiguous skill; so do we) |
| `frontmatter_incomplete` | reject | no `name` or no `description` in the header |
| `empty_body` | reject | body under 500 characters |
| `delegates` | reject / flag | the text calls another skill (`Skill tool ... "x"`): reject when the body is under 800 characters, flag otherwise |
| `needs_sibling` | reject | a line that says it is required (`PREREQUISITE`, `must`, ...) reads `../other-skill/`, a folder the installer does not copy |
| `sibling_reference` | flag | `../other-skill/` appears as a pointer (see also, setup) |
| `needs_binary` | flag | the header declares command-line tools (`requires.bins`) |
| `secret_like` | reject | something shaped like a key or a token |
| `injection_marker` | flag | "ignore previous instructions", "do not tell the user", `curl ... | sh`, `base64 -d` |
| `skill_md_big`, `folder_big`, `folder_many_files` | flag | `SKILL.md` over 24 KB, folder over 5 MB or 200 files |
| `repo_gone`, `audit_fail` | reject | the repository is gone; a skills.sh provider says `fail` |
| `repo_archived` | flag | the repository is archived |
| `licence_restricted`, `licence_unspecified`, `audit_warn`, `audits_missing`, `mentions_sibling` | info | facts for the decision |
| `judge_reject`, `judge_flag` | flag | the judge's opinion, confirmed by the second model; it never rejects a skill by itself |
| `judge_overruled` | info | the first model alerted and the second model cleared the skill: kept on the record, counts for nothing |

The thresholds are in `scripts/vet-skills/config.json`. **A rule change bumps `RULES_VERSION`**, so every skill is analysed once more.

**Waivers.** A person accepts a known defect by writing it in the ledger: `"waivers": { "some-skill": { "needs_binary": { "reason": "the card says it needs the tool" } } }`.
The finding stays in the report (marked waived) and stops counting. `info` findings cannot be waived (there is nothing to accept).

## The judge

An LLM reads the `SKILL.md` and answers four questions in a fixed JSON shape (`self_sufficient`, `delivers_outcome`, `delegates`, `injection_suspected`) and
gives a verdict `ok`, `flag` or `reject` with at most four short reasons. It sees the catalogue card (title, outcome), the file names, the declared tools and the text.

Guard rails: the text is untrusted data between markers and the prompt says so; the judge has no tool; an `ok` that contradicts its own booleans is lowered
to `flag` in code; a model is only used after it passed the **calibration**; calls per run are capped; the key goes only to the configured address.
A judge verdict can only raise a flag for a person. It is cached by the skill's key, the prompt version and the model, so an unchanged skill is never judged twice.

**Second opinion.** The first model (`model`) is asked first. If it finds nothing (`ok`) it is the only call. If it says `flag` or `reject`, the next model (`fallbackModel`, assumed the stronger)
is asked **before anyone is alerted**, and **its answer decides**, whichever way. Both answers are kept in the ledger (`judge.opinions`, in order). A flag the second model confirms is raised
as `judge_reject` / `judge_flag` ("confirmed by ..."); one it clears raises nothing but leaves a `judge_overruled` information finding with the first model's reasons (visible with `--verbose`).
If the second model cannot answer, or there is only one calibrated model, the first answer stands and the flag says "not confirmed"; such a stored verdict is put to the second model on the next
`--judge` pass. Cost: one extra call per alert, and only for alerts. The price of the rule: a doubt the first model had and the second did not see is not alerted (it stays in the ledger).

**Settings** (`scripts/vet-skills/config.json`, `judge` block; the three variables override the file):

| Key | Default | Meaning |
| --- | --- | --- |
| `baseUrl` (`VET_JUDGE_BASE_URL`) | `https://ai-gateway.vercel.sh/v1` | any OpenAI-compatible `/chat/completions`; https, or http on this machine, no credentials in the URL |
| `keyEnv` | `AI_GATEWAY_API_KEY` | the **name** of the variable that holds the key. The key is never in a file |
| `model` (`VET_JUDGE_MODEL`) | `nvidia/nemotron-3.5-lightning-free` | tried first; free, 1 M context, tagged for structured output on the gateway's model list |
| `fallbackModel` (`VET_JUDGE_FALLBACK_MODEL`, `none` to disable) | `anthropic/claude-haiku-5-5` | used when the first model fails, answers outside the shape, or is rate-limited twice |
| `temperature`, `maxOutputTokens`, `timeoutMs`, `retryDelayMs` | 0, 1200, 90 000, 4 000 | |
| `maxCallsPerRun`, `maxSkillChars` | 40, 24 000 | the budget of a run; the text is cut here |

The key is a **dedicated Vercel AI Gateway key with a spending cap** (created by the maintainer in the Vercel dashboard; do not reuse the dev server's key).
Vercel's monthly free credit ends for good with a team's first credit purchase; the models priced 0 $ on the gateway's list are separate, and whether a team on the
paid tier can call them is to be seen on the first calibration. A full pass over the 24 picks is about 55 000 tokens in (the `SKILL.md` files measure 209 KB),
so even the paid fallback costs about a cent with a small model (an estimate from sizes, not a measured bill).

**Calibration.** `node scripts/vet-skills.mjs --calibrate` runs five golden cases (`scripts/vet-skills/golden/`) through each model of the chain (about 10 calls):
the hollow skill must be rejected, a good skill must be `ok`, a skill with a hidden exfiltration step *and a line addressed to the reviewer* must not be `ok` and must be
flagged as injection, a skill that does another job than its card must not be `ok` and must not deliver the outcome, and a good skill that needs a command-line tool, a declared
API key and has a "see also" line must be `ok` or `flag` (this one guards against a judge that is too strict). The result is stored per model and prompt version in
the ledger; `--judge` refuses a model that has not passed. A new prompt (`PROMPT_VERSION` in `judge.mjs`, now 2) means a new calibration and every skill judged again.

**What the real models showed (2026-10-26).** The free model is a reasoning model: with 1 200 output tokens it spent them all thinking and returned nothing (3 of 4 calibration
cases "not in the shape asked"); at 12 000 it answers in 13 to 20 s for 0 $, which is why `maxOutputTokens` is 12 000. The first judge run (prompt 1) over the 21 skills that passed the code rejected 8
and flagged 1, and most rejections were false alarms: the file list given to the judge was cut at 40 names (it said `scripts/recalc.py` was missing for a folder of 53 files), it counted
`pandoc` or a Firecrawl key as a defect, and a "see also" pointer as a hand-over. Prompt 2 shows the full list, passes the card's declared requirements, and says what is not a defect.
A judge's "reject" is only ever a flag for a person; do not read the first run's verdicts as findings.

Prompt 2 over the same 21: 17 `ok`, 4 `reject` (pdf, xlsx, tavily-research, firecrawl-competitive-intel), 21 calls, 0 $. Read against the real texts, **only xlsx looks right**
(the card promises charts, the text never teaches them: a card to reword, not a broken skill). pdf and tavily-research are false alarms (a Python library to install, a command-line tool and a
declared key counted as defects although the prompt says they are not); firecrawl-competitive-intel is a thin plan that needs the Firecrawl tools its card declares. A second opinion from
`claude-haiku-5-5` on those four (4 calls, nothing written) said `ok` for all four, and caught a real nit on pdf (the text says `FORMS.md` and `REFERENCE.md` in capitals, the folder has lowercase names).
Both models missed that `task-management` copies `${CLAUDE_PLUGIN_ROOT}/skills/dashboard.html`, a file that is not in the folder. So: the free model is a cheap first filter with poor precision on its rejections;
treat a judge flag as "read the reasons", not as a finding.

With the second-opinion rule (same day), re-judging the four contested skills took 7 calls: the free model did not repeat its rejection of `pdf` (same prompt, temperature 0: a reasoning model is not
deterministic), and `claude-haiku-5-5` cleared xlsx, tavily-research and firecrawl-competitive-intel. Judge alerts left on the 24 picks: none. The xlsx chart gap (the card promises charts, the text never teaches them)
survives only as a `judge_overruled` note in the ledger: it is a card to reword, and nothing will remind anyone.

## Commands

```
node scripts/vet-skills.mjs                     # the pass (code rules, GitHub, audits); writes the ledger
node scripts/vet-skills.mjs --no-audits         # same without the 24 relay requests (10 s)
AI_GATEWAY_API_KEY=... node scripts/vet-skills.mjs --calibrate
AI_GATEWAY_API_KEY=... node scripts/vet-skills.mjs --judge
node scripts/vet-skills.mjs --candidate owner/repo:skill-name   # vets one skill that is not a pick; writes nothing
node scripts/vet-skills.mjs --all | --only a,b | --dry-run | --verbose | --json | --strict
```

`GITHUB_TOKEN` (or `gh auth token`, tried automatically) lifts GitHub's anonymous limit of 60 requests an hour; a pass needs about 30.
A GitHub refusal stops the pass and writes nothing. The audit relay stops at its first refusal: a burst of requests once got our address refused for fifteen minutes.

## The ledger

`scripts/vet-skills/ledger.json`, one entry per pick: `source`, `path`, the `commit` it was analysed at, the folder's `treeSha`, its `deps`, the `key`, the rules version,
the findings of the text (`contentFindings`), the `signals` (gone, archived, licence, audits), the judge's record, and the resulting `verdict` and `findings`.
An entry that a pass learned nothing new about is left exactly as it was, so the file does not churn. It also holds the `waivers` and the `calibration` records.
It is a plain text file and is committed: its diff is the history of what changed upstream.

## Not done (yet)

- **The install is not pinned.** `installSkill` still downloads `tar.gz/HEAD` (`packages/kybernos-skills/index.js`). The ledger records the commit and the folder hash each skill was
  verified at, which is what makes pinning possible; until then a skill verified today can change tomorrow (the weekly pass notices, the user does not wait for it).
- **No discovery of candidates.** `--candidate` vets one named skill. Feeding the weekly scout's finds through it, and putting a "not vetted" label on the Discover tab, are separate changes.
- **Four verdicts were checked by hand, not all 21.** The 17 `ok` are unverified except `task-management`, `systematic-debugging` and `cold-email`.
- **Rule (owner, 2026-10-26): a pick the tool rejects is not shipped.** `grill-me`, `gws-gmail-triage` and `gws-workflow-meeting-prep` were taken out of `featured-picks.json` (24 → 21 picks); `scripts/test-vet-skills.mjs` fails if a shipped pick has no ledger entry or a `reject` verdict. A rejected skill can come back with a waiver written in the ledger. The 4 picks the code rules flagged (`canvas-design`, `design-taste-frontend`, `firecrawl-deep-research`, `tavily-research`) were read against their texts and stay, each with a waiver and its reason in the ledger. The `xlsx` card no longer promises charts (the text never teaches them).

## Tests

`node scripts/test-vet-skills.mjs`: the rules on texts that mirror the real defects, the incremental pass over a fake GitHub (including "nothing downloaded when nothing changed"),
the sources (rate limit, relay stop), the judge over a fake chat endpoint (shape, fallback, retry, budget, calibration) and the command line. No network.
