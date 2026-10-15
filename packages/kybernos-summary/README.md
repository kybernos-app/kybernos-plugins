# `@local/kybernos-summary`

A **Summary** tab in the chat's right sidebar: what the chat is doing, on one page.

## What the user sees

Right sidebar › **+** › **Summary**. Four sections, each folded with a click and carrying its count:

| Section | What it lists | Where it comes from |
| --- | --- | --- |
| Agents | the sub-agents of this chat, with their mode | projection `subagentCatalog` |
| Progress | the agent's task list: done (struck through), in progress, to do | projection `todos`, the list the engine shows above the composer |
| Execution context | the skills it loaded, then the tools it called: MCP servers first (with their tools on hover), native tools by use | the chat's tool calls (`skill`, `mcp__<server>__<tool>`, …) |
| Files | the files it wrote or edited; a click opens one in the sidebar | `write` / `edit` calls (`file_path`) |

**Latest only** limits skills, tools and files to the current turn (from the person's last message on); one click switches it to
the whole chat, and the choice is remembered in this browser. Agents and Progress always show the current state: a task list and
a crew are standing things, not turn things.

## How it works

No host route, no file, nothing sent: everything is read in the browser from what the engine already holds.

- a probe in the composer dock (`conversation.composer.dock`, id `kybernos-summary-probe`) reads `useChat((c) => c.nodes.valuesCache)`
  and `useProjection('todos' | 'subagentCatalog')` and files them under the session id (twelve sessions at most);
- the tab body (`sidebar.right.pane.tab`) reads that store for the chat on screen and derives the four sections
  (`derive` in `client.js`, pure and tested).

The tab is registered with `ctx.sidebarRightTabs`, so it shows in the sidebar's **+** guide like any other tab. It does not open by
itself.

## Honest limits

- It is a view of the chat on screen, not a log: a session that was never opened in this browser has nothing filed yet.
- A skill is read from the `skill` tool call (`name`, else `skill`); a skill the person invoked with `/name` is not a tool call
  and is not listed.
- Sub-agents come from the engine's catalog, so their calls are not merged into the parent's tools.
- Files are the ones written or edited through the file tools; a file made by a shell command is not seen.

## Tests

```bash
cd packages/kybernos-summary && node test-host.mjs && node test-client.mjs
```

No engine patch. Slots used: `conversation.composer.dock`, `sidebar.right.pane.tab` (and the `sidebarRightTabs` registry).
