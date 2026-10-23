# `@local/kybernos-summary`

A **Summary** tab in the chat's right sidebar: what the chat is doing, on one page.

## What the user sees

Right sidebar › **+** › **Summary**. Four sections (a fifth when there is something to show, see below), each folded with a click and carrying its count:

| Section | What it lists | Where it comes from |
| --- | --- | --- |
| Agents | the sub-agents of this chat, with their mode | projection `subagentCatalog` |
| Progress | the agent's task list: done (struck through), in progress, to do | projection `todos`, the list the engine shows above the composer |
| Execution context | the skills it loaded, then the tools it called: MCP servers first (with their tools on hover), native tools by use | the chat's tool calls (`skill`, `mcp__<server>__<tool>`, …) |
| Files | the files it wrote or edited; a click opens one in the sidebar | `write` / `edit` calls (`file_path`) |

**Latest only** limits skills, tools and files to the current turn (from the person's last message on); one click switches it to
the whole chat, and the choice is remembered in this browser. Agents and Progress always show the current state: a task list and
a crew are standing things, not turn things.

**Learned in this chat** appears only when Kaby did something with skills in the chat on screen, and lists one row per skill:
a **suggestion** that still waits for the person (with a **Review** button that opens the Skills page on it; an improvement of an
existing skill says so), a skill **applied by Kaby** (with its score, and a « not reviewed yet » chip until the person has looked), a
skill the person **created** from a suggestion, and a skill the chat **reused** (« used in N chats »; a skill created here and loaded
only here is not listed twice). The grey line under the rows says that nothing is applied for the person: a suggestion waits for their
yes, unless their own settings (Settings › Learned skills) say otherwise. It is about the whole chat, so **Latest only** does not touch
it. The rows come from `GET /kybernos-skills/learned/session?sessionId=<id>` (host route of `kybernos-skills`, read-only, same origin):
the tab asks once when it opens for a chat, once more when the chat's tool-call count changes (after a half-second settle, so a burst of
calls asks once) and every 30 s while the page is visible. An older host, a refusal, a 404 or an answer that is not JSON leaves the
section out silently, never an error row. Nothing new is stored; the only trace is a pointer (`kybernos.skills.review`, in
`sessionStorage`) left by **Review** so that the Skills page knows which suggestion to show.

## How it works

No host route of its own, no file, nothing stored: the four sections are read in the browser from what the engine already holds, and
the fifth from the one read-only route above.

- a probe in the composer dock (`conversation.composer.dock`, id `kybernos-summary-probe`) reads `useChat((c) => c.nodes.valuesCache)`
  and `useProjection('todos' | 'subagentCatalog')` and files them under the session id (twelve sessions at most);
- the tab body (`sidebar.right.pane.tab`) reads that store for the chat on screen and derives the four sections
  (`derive` in `client.js`, pure and tested); the fifth is `learnedRows` (pure) fed by `watchLearned` (the schedule above).

The tab is registered with `ctx.sidebarRightTabs`, so it shows in the sidebar's **+** guide like any other tab. It does not open by
itself.

## Honest limits

- It is a view of the chat on screen, not a log: a session that was never opened in this browser has nothing filed yet.
- A skill is read from the `skill` tool call (`name`, else `skill`); a skill the person invoked with `/name` is not a tool call
  and is not listed.
- Sub-agents come from the engine's catalog, so their calls are not merged into the parent's tools.
- Files are the ones written or edited through the file tools; a file made by a shell command is not seen.
- « Learned in this chat » needs a host that serves the learned-skills route of `kybernos-skills`; on an older one the section is simply absent.

## Tests

```bash
cd packages/kybernos-summary && node test-host.mjs && node test-client.mjs
```

No engine patch. Slots used: `conversation.composer.dock`, `sidebar.right.pane.tab` (and the `sidebarRightTabs` registry).
