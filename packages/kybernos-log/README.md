# `@local/kybernos-log`

The activity journal: one Settings page (**System** group) that answers « what did this machine send out,
and what did it cost? » — model calls with their tokens, connectors, web search, tools, and the calls nobody
asked for (automatic titles, compactions, probes).

## What it records

Metadata only, never content: when, which family, which session, which provider/model, how many tokens,
which tool (an MCP tool is a *connector*, `web_search` is a *web search*, anything else is a *tool*), and
why a call failed (retry code and short detail). No message body, no tool argument, no tool result.

Source: one subscription to `session/event` (the same event source `kybernos-call` follows). Storage: a
bounded ring on disk (`<DSH home>/kybernos/log/events.jsonl`, rotated at 8 MB) plus the last 4 000 records
in memory, so the page survives a restart and stays fast.

## Routes (read-only, fenced by Host and Origin)

| Route | What it answers |
|---|---|
| `GET /kybernos-log/events?types=llm,websearch&session=&q=&since=&before=&limit=` | the journal, newest last, filtered |
| `GET /kybernos-log/stats?days=1` | calls and tokens per day, per family, per model |
| `GET /kybernos-log/stream` | SSE: one `record` event per new line |

## Test

```bash
node packages/kybernos-log/test-host.mjs    # 41 assertions, no DSH, no network, no real disk
```
