# `@local/kybernos-log`

The activity journal: one Settings page (**System** group) that answers « what did this machine send out,
and what did it cost? » — model calls with their tokens, connectors, web search, tools, and the calls nobody
asked for (automatic titles, compactions, probes).

## What it records

Metadata only, never content: when, which family, which session, which provider/model, how many tokens,
which tool (an MCP tool is a *connector*, `web_search` is a *web search*, anything else is a *tool*), and
why a call failed (retry code and short detail), and each session's title (made from its first message, then from its answer). No message body, no tool argument, no tool result.

Source: one subscription to `session/event` (the same event source `kybernos-call` follows). Storage: a
bounded ring on disk (`<DSH home>/kybernos/log/events.jsonl`, rotated at 8 MB) plus the last 4 000 records
in memory, so the page survives a restart and stays fast.

## Routes (read-only, fenced by Host and Origin)

| Route | What it answers |
|---|---|
| `GET /kybernos-log/events?types=llm,websearch&session=&q=&since=&before=&limit=` | the journal, newest last, filtered, with `titles`: the title of each chat of the page (from the whole file, not only the ring) |
| `GET /kybernos-log/stats?days=1` | per day: calls, tokens, failures, unasked calls, per family, per model, and `hours` (24 buckets of the same) |
| `GET /kybernos-log/stream` | SSE: one `record` event per new line |
| `GET /kybernos-log/terminal?stream=out\|err&before=&after=&limit=500&q=&plugin=` | what DSH prints in its terminal (`<DSH home>/logs/dsh-web.out.log` or `.err.log`), read from the end (4 MB at most), numbered lines newest last, the total, the plugin tags seen; secrets masked; **under DSH's signed session cookie** (`session-guard.mjs`) |

## The page

Two tabs. **Calls**: four cards for today with a sparkline per hour, one toolbar line (search, period, *Errors only*, *Live*,
a menu with Refresh and Copy JSON), family chips with their counts, and the rows grouped by day, 50 per page. The page reads the
whole ring once (it is 4 000 records at most) and builds its rows itself: a tool call and its result are one row, a turn's start
and end are one row, and consecutive identical failures collapse into one (« failed ×3 »). The pager, the chips, the day
headers and the *Errors only* count all count those rows, so the page shows one number everywhere. *Live* asks only for what is
new and never moves the page: new rows wait behind a « N new calls · show » pill.

**Terminal**: Output or Errors (two files with no timestamps, never merged), a filter, a plugin select, *Follow* (every 2 s with
`after=`), Copy, « Load 500 older lines », a separator at each DSH start, identical lines collapsed. Tokens, keys and passwords
are hidden by the host before a line leaves it; a plugin may still print a file path or an error message.

## Test

```bash
node packages/kybernos-log/test-host.mjs    # 112 assertions, no DSH, no network, no real disk
node packages/kybernos-log/test-client.mjs  # 114 assertions: the real page on a small hook runtime, against a mocked host
```
