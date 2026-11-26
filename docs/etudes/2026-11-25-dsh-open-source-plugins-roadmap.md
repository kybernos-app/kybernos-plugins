# Open-source DSH plugins benchmark & Kybernos catalogue roadmap

Date: 2026-11-25  
Status: completed — all approved tracks (1, 2, 3, 4, 6a, 6b) implemented and merged on `dev` (2026-11-26)

## Context & scope

On 2026-11-25 we surveyed the open-source DeepSeek Harness (DSH) ecosystem on `deepseek1024.com/plugins` (14,217 spec-screened packages across 11 categories, top install/star/npm charts) and cross-checked it against the ~56 bundles shipped in [`packages/`](../../packages), the plugin contract ([`docs/dev/plugin-contract.md`](../dev/plugin-contract.md)), and the catalogue doctrine ([`docs/dev/skills-vs-plugins.md`](../dev/skills-vs-plugins.md)).

### Already covered by Kybernos (no duplication)

Agent teams (`dsh-agent-teams`), usage and cost tracking (`dsh-cost-meter`), keyless web search (`dsh-free-search`), cross-session lessons and memory (`dsh-mnemon`), mobile/QR pairing (`dsh-pocket`), desktop notifications (`dsh-notification`), theme hub (`skin-center`), slides/motion/mockups (`open-design`), and local plugin registry (`dsh1024`).

### Explicitly excluded

- OAuth subscription wrappers for third-party consumer plans (`dsh-plugin-subscriptions`, `dsh-codex-subscription`): ToS and account-suspension risk.
- Cosmetic gadgets (`dsh-pet`, `dsh-wallpaper-engine`): outside target audience.
- Vision bridge for text-only models (`modlens`, `dsh-vision-router`): deprioritised in this wave.

## Approved tracks (1, 2, 3, 4, 6a, 6b)

To avoid package bloat and keep compatibility maintenance low, **only two tracks become new bundles** (`kybernos-guard` and `kybernos-knowledge`). The remaining tracks extend existing bundles, ship as tested skills + scripts, or wrap standard MCP/CDP connectors. Zero engine patches (`AGENTS.md` rule 1).

| Track | Capability | Reference DSH repos (license) | Kybernos form | New bundle? | Priority |
|---|---|---|---|---|---|
| **1** | Turn + file rewind (git & non-git) | `Anionex/dsh-turn-rewind` (BSD-3), `SiriLee/dsh-rewind` (MIT) | Extension of `kybernos-sessions` + `kybernos-changes` | No | **P1** |
| **2** | Context composition insight + preventive shell output compression | `bowenliang123/dsh-context`, `DeepTrial/dsh-bash-rtk` | View in `kybernos-usage` / `kybernos-log` + deterministic output filter | No | **P1** |
| **3** | Pre-step security guard & risk-based approval | `PerryLink/dsh-defend`, `moon09300731/dsh-approval-gate` | `kybernos-guard` (host hook, deterministic Pass 1 in v1) | **Yes** | **P1** |
| **4** | External chat import (ChatGPT, Claude, Cursor, Codex) | `Nwflower/dsh-chat-import` | Tested Node CLI script + `SKILL.md` (optional button in `kybernos-sessions`) | No | **P2** |
| **6a** | Local document knowledge base / Wiki (PDF, DOCX, MD) | `Tencent/WeKnora` | `kybernos-knowledge` (local index, Markdown wiki, `knowledge_search` tool, exposed to `kybernos-front-desk` in v1) | **Yes** | **P2** |
| **6b** | Authenticated browser control | `Tencent/BrowserSkill` | Guided Playwright / Chrome DevTools MCP connector in Tools, gated by `kybernos-guard` | No (v1) | **P3** |

## Approved v1 scoping decisions (2026-11-25)

1. **Track #1 (Turn + file rewind)** starts first:
   - Host-side persistent pre-mutation Change Ledger in `packages/kybernos-sessions/turn-rewind.mjs`, capturing first-touch snapshots per turn via `ctx.on('session/event')` and `ctx.on('tools/pre-execute')`.
   - Works in both git repositories and plain non-git folders without mutating git history.
   - Strict confinement inside workspace `realpath`, 4 MiB per-file snapshot cap, `.git/` excluded, automatic rescue point created before every restore, dry-run preview mandatory before execution (`exec: false` then `exec: true`).
   - Guarded routes under `/kybernos-sessions/rewind*` with host fence, same-origin check, and signed session cookie on POST (`session-guard.mjs`).
   - Surfaced in `kybernos-changes` via `window.__KB_SESSIONS_VIEW__` in both git and non-git folders (when checkpoints exist).

2. **Track #2 (Context insight + shell compression)**:
   - Builds on [`2026-10-28-context-budget-and-memory-janitor.md`](2026-10-28-context-budget-and-memory-janitor.md) and [`compaction-summary-fallback-2026-11-25.md`](compaction-summary-fallback-2026-11-25.md), which measured 64%–86% of session surface coming from tool dumps.
   - Read-only breakdown panel (system prompt, tools, memory/skills, history, tool dumps, compactions, cache hit rate) + pure-Node deterministic compression of verbose shell outputs before they enter history.

3. **Track #3 (`kybernos-guard`) — v1 = deterministic Pass 1 only**:
   - No LLM cost and < 2 ms latency per tool call.
   - Linear-time checks only: outbound secret detection/masking, destructive-command `block`/`ask` rules, and prompt-injection markers in external tool outputs.
   - Emits sanitised audit events to `kybernos-log`; optional LLM risk classifier (Pass 2, fail-safe) deferred to v2.

4. **Track #4 (Chat import)**:
   - Implemented as a tested executable script (`import-chats.mjs`) with a minimal `SKILL.md`, matching `docs/dev/skills-vs-plugins.md`.
   - v1 targets 4 high-impact sources: ChatGPT (`conversations.json`), Claude / Claude Code, Cursor, and Codex, with `--dry-run`, deduplication, and `kybernos-search` compatibility.

5. **Track #6a (`kybernos-knowledge`) — v1 covers Workspaces, Kaby, and `kybernos-front-desk`**:
   - Local-first incremental ingestion of workspace documents (`.md`, `.txt`, `.pdf`, `.docx`, `.csv`) into citable passages and auto-maintained Markdown wiki pages.
   - Zero heavy external daemon required in v1 (local lexical BM25/FTS index; optional local/cloud embeddings in v2).
   - Exposes `knowledge_search` to agents and a data extension point usable directly by `kybernos-front-desk`.

6. **Track #6b (Authenticated browser control)**:
   - Sequenced strictly **after** `kybernos-guard` (#3).
   - Uses a standard MCP/CDP browser bridge configured from Tools with a dedicated agent browser profile by default, domain allowlists, mandatory confirmation on form submit/payment/deletion, and untrusted-content tagging.
