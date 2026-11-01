# Skills vs plugins: what is allowed to enter the catalogue

Decision of 2026-11-01, after two adversarial reviews (one in a fresh context, one by Claude Opus 5.5 on the
Anthropic API). The question was this, in the owner's words: *everything that is a creation goes through skills
(markdown + scripts) and a showcase on the Cloud Computer; avoid plugins as much as possible, except when
necessary (automation, app pack).*

The answer is yes to the direction and no to the reasoning. The first draft justified it with a context cost it
had measured wrong; the argument that survives the repository is **testability and coupling**, not tokens.

## What the measurement said

Every number below was read on the machine on 2026-11-01, not estimated.

| The claim | What the repository says | Verdict |
|---|---|---|
| A plugin is expensive: compatibility gate, tests, install | 52 packages, **498** `test-*.mjs` files, but **one** `dsh-compat.json` for the whole repo, whose 10.9 KB `note` admits `5/11 engine contracts`. There is no gate per package. | The cost is real; it is an **unpaid debt**, and fewer packages does not pay it. |
| The skills catalogue costs ~11 000 tokens per turn | 17 648 characters ≈ **4 400 tokens**. The first-turn floor of this project's sessions reads **39 480 to 42 032** `inputTokens` (re-read in `~/.dsh/sessions/` on 2026-11-01), never 76 835. | Wrong, and the 51 000 figure for tool definitions cannot fit inside a 40 742 total. |
| A skill is portable | **14** of 91 installed skills name a tool only this harness provides (`read_image`, `subagent`, `kybernos_dashboard`, `creer_slides`, `creer_motion`, `modeliser`). | False for 15 % of the folder. |
| A skill drifts silently, so give it a `--check` | **85** of 91 skills carry no executable at all. A `--check` would cover the 6 that already have a script. | Right diagnosis, 7 % of a remedy. |
| Promote a skill to a plugin when it is measured | `skills-learned.json` counts **8** learned skills; the other 91 are counted nowhere. | Not falsifiable as written. |
| The showcase is the Cloud Computer | The host route `POST /kybernos-cloud/computer/turn` does not exist; only the server-side dispatch accepts a `computer_id`, since 2026-10-15. | Half the pipe is missing. |

Two objections were found that the first draft had not seen, and they changed the decision:

1. **A skill that calls a plugin tool is a plugin client written in prose.** Avoiding plugins through skills adds
   untested consumers to the plugins that already exist: coupling goes up, and none of the 498 tests sees it.
2. **There is no rule for leaving.** Each installed skill costs ~48 tokens of catalogue per session whether it is
   used or not. Without an eviction rule, "skills first" grows the catalogue monotonically.

## The doctrine

1. **Nothing enters the catalogue without an executable test and a use counter.** A text nobody can run is
   documentation; it stays a document.
2. **A plugin is code with a contract gate, per package.** The way out of the plugin tax is one gate per package,
   not fewer packages. A package that cannot state its contract does not ship.
3. **A skill is the manual of a tested script.** The script is the product. A skill folder without an executable
   does not enter `~/.dsh/skills`.
4. **An entry with no measured invocation over 30 days leaves the catalogue.** The 91 installed skills have no
   exit today; that is the bug to fix first.
5. **A showcase opens by a link.** It is never a machine that must be woken to be seen. The Cloud Computer builds;
   the artefact and its proven link show.
6. **"Creation or not" is not a criterion.** The questions are: who triggers it, can it be tested, and what
   happens when it rots.
7. **A skill becomes a plugin when measured**, never by taste: repeated invocations, the same friction corrected
   three times, or a need to run while no agent is awake.

## The ratchet that holds it

`scripts/test-skills-ratchet.mjs` runs in `scripts/run-all-tests.mjs` with every other test, so neither number can
grow by accident. It counts two things in the skills folder, by name rather than by total:

- **R1** a skill with no executable in its folder — base **85**;
- **R2** a skill naming a harness-only tool — base **14**.

A name that appears fails the run. A name that leaves is free and is reported, so the ceiling gets lowered:

```
node scripts/test-skills-ratchet.mjs            # the checks
node scripts/test-skills-ratchet.mjs --update   # lower (or, in a reviewed diff, raise) the baseline
```

The baseline is `scripts/skills-ratchet-baseline.json`. On a machine without a skills folder the file prints
`SKIPPED:` and exits 0 — a skip is not a pass, and CI must not go red for a folder it does not have.
`KB_SKILLS_ROOT` points the scan at another tree, to prove a check fails on a folder that has the defect.

## What is not built yet

- **The use counter.** Nothing counts invocations of the 91 installed skills. Until it exists, rule 4 is a
  sentence without an instrument, and rules 1 and 7 stay partly declarative.
- **The per-package contract gate.** `dsh-compat.json` is still one file for the whole repository.
- **The host route** that runs a turn on the Cloud Computer (`computer/turn`, step 2 of
  `docs/dev/cloud-computer-run-on.md`).

## Where the rule is loaded

A doctrine read on a wiki page is not a rule. This one is quoted by the things that decide, so
that it loads at the moment of the choice and not when someone thinks of it:

| Where | What it says there |
|---|---|
| `packages/kybernos-registry/skills/plugin-creator/SKILL.md` | « Before the interview: is a plugin the answer? » — the three questions, asked before a plugin draft exists. |
| `feature-plugin-dsh` (installed skill) | « Le seuil d'entrée » — a bundle exists for what must run with no agent awake, and it names its contract. |
| `packages/kybernos-skills/learned.mjs` (`RULES`) | every learned skill ends with « A notice, not a program: name the job and its steps, never a tool only one harness provides. » |
| `scripts/test-skills-ratchet.mjs` | the two numbers that may only shrink, in the suite that must be green before a merge. |

A notice accepted from the Skills page lands in the skills folder and trips R1 **on purpose**:
the catalogue grows through a reviewed `--update`, not through a click nobody reads afterwards.

## How this was argued

Three passes, kept so that the next reader can reopen them: the author's draft; a fresh-context critique that
re-measured the repository; and an adversarial review by Claude Opus 5.5 given the measured corpus. A weaker
challenger (a 120B open model) was discarded — it invented a `~/.dsh/skills/registry.json`, attributed a skills
validation to `scripts/garde-depot.mjs` that the file does not contain, and read `scripts/live-page.mjs` as a
public link generator. **A challenger that cannot read the tree produces confident nonsense**; its critique is not
evidence.
