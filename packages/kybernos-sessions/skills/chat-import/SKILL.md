---
name: chat-import
description: Imports external chat histories (ChatGPT, Claude / Claude Code, Cursor, Codex) into local DSH sessions searchable in Kybernos, with dry-run preview and deterministic deduplication.
whenToUse: The user wants to import or migrate existing conversations from ChatGPT, Claude, Claude Code, Cursor, or Codex into Kybernos / DSH.
---

# Chat Import

This skill is the manual for `scripts/import-chats.mjs`, a zero-dependency Node.js script that converts exported conversations into local DSH session journals (`session.v4.jsonl.zstd`).

## Supported sources

- **ChatGPT**: OpenAI `conversations.json` export (walks the active `current_node` branch).
- **Claude**: Claude.ai `conversations.json` export or Claude Code `.jsonl` session transcripts.
- **Cursor**: Exported Cursor chat/composer `.json` files.
- **Codex**: Codex CLI `.jsonl` rollout transcripts.

## Procedure

1. Ask the user for the path to their exported `.json` / `.jsonl` file (or folder of exports) and, if they want imported chats attached to a specific workspace folder, that workspace path.
2. Always run a **dry-run preview first** so nothing is written before the user confirms:

   ```bash
   node scripts/import-chats.mjs "<path>" --dry-run --json
   ```

   Optional flags:
   - `--source auto|chatgpt|claude|cursor|codex` (defaults to `auto`)
   - `--cwd "<workspace-path>"` (attaches imported sessions to a specific workspace)
   - `--limit <N>` (caps the number of conversations imported in one pass)
   - `--dsh-home "<dir>"` (defaults to `$DSH_HOME` or `~/.dsh`)

3. Summarize the dry-run counts (`imported`, `skipped` duplicates, `errors`) and a few titles to the user.
4. Once the user confirms, run the same command without `--dry-run`:

   ```bash
   node scripts/import-chats.mjs "<path>" --cwd "<workspace-path>" --json
   ```

5. Tell the user how many sessions were imported and skipped, and note that imported sessions are immediately searchable via Search everywhere (⌘K / Ctrl+K).

## Guarantees

- **Idempotent**: re-running on the same export skips already-imported conversations by deterministic hash ID (`imp-<hash>`).
- **Atomic and private**: session files are written atomically with mode `0600` under `$DSH_HOME/sessions/`.
- **Local only**: nothing leaves the user's computer.
