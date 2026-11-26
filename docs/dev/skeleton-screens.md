# Skeleton screens: one helper for every list

A list that is being read for the first time shows **bones** — grey shapes in the boxes of the real rows — instead of an empty
page or a line of « Loading… ». The core plugin owns the helper; every other bundle reads it and falls back to plain text
when it is not there.

## The rules a caller keeps

1. **Same box.** A skeleton row uses the real row's own classes (same grid, same height), with bones where the text goes, so
   the first real row lands exactly where its bones were (the live check measures it: ≤ 6 px).
2. **Only when there is nothing yet.** Bones show while a request is in flight *and* no earlier data exists. A refresh keeps
   the list it has (dim it, as the Skills ranking does) and never blanks it.
3. **Never left spinning.** An error or an empty answer replaces the bones with the real state: the error with its way to try
   again, the empty list with its own message.
4. **Calm.** A soft shimmer on the bones; on arrival the rows fade in (about 200 ms, 25 ms between rows) — the first twelve
   only, so a 500-row list does not animate for seconds. Under `prefers-reduced-motion: reduce` there is no shimmer and no
   movement: the rows just appear. Colours come from the theme (`--dsw-alias-label-primary` at 7–15 %), so light and dark are
   both right.

## The helper (`packages/kybernos-plugin/client.js`, « Skeleton screens »)

| | |
|---|---|
| `kbBone(w, h, extra?, radius?)` | one bone; `extra` is `'round'` or `'pill'` |
| `kbBoneLine(w, lineH, boneH?)` | a text line: a box of the line's height with a shorter bone centred in it |
| `kbSkelWrap(label, className, children)` | the wrapper: `role="status"`, `aria-busy`, one announcement, no pointer events |
| `kbIn(i)` | the class suffix that makes the *i*-th real row fade in (`''` from the 13th on) |

Other bundles read the same four from `window.__KB_SKEL__` (`bone`, `line`, `wrap`, `appear`), at render time:

```js
const skel = () => { try { return window.__KB_SKEL__ || null } catch (e) { return null } }
const k = skel()
return k === null ? loadingText : k.wrap('Loading…', 'my-table', rows.map((r, i) => h('div', { className: 'my-row kb-sk-row' }, k.bone('60%', 12))))
```

## Where it is applied

| Where | Bundle | Seen live |
|---|---|---|
| Creations (cards and list, with the tiles and the line under them) | kybernos-plugin | yes, shift 0 px |
| Agent Teams (cards and rows), the Marketplace's kybernos.app block | kybernos-plugin | yes |
| Workspaces, and the tabs of a project page (Threads, Documents, Goals, Budget…) | kybernos-plugin | yes |
| Automations (it had its own skeleton and animation; it uses this one now) | kybernos-plugin | yes, shift 0 px |
| Settings › Tools, Voice engines | kybernos-plugin | yes |
| Skills: Yours, Discover, Team | kybernos-skills | yes, shift 0 px |
| Settings › Workers, Kybernos Suite | kybernos-workers, kybernos-hub | yes, within 3 px |
| Settings › Web Search, Free LLMs | kybernos-websearch, kybernos-free-llms | yes, shift 0 px |
| Connectors: Yours, Discover | kybernos-composio | yes (same card height) |
| Settings › Memory & Lessons | kybernos-memory | bones yes; no signed-in data to compare the rows with |
| Settings › AI provider and models (table body) | kybernos-models | by reading the code only: the page reads through an RPC the live check cannot hold |

Left as they are, and why:

- **Theme gallery** (kybernos-theme) already has its own tile skeleton (own CSS, reduced motion handled). The file is French
  throughout, so touching it triggers the translate-when-touched rule: a separate piece of work.
- **Atlas** (kybernos-atlas) shows a staged page with one progress line per source it reads: more informative than bones, and
  not a list.
- **Account page, memories list** (kybernos-cloud) needs a signed-in Kybernos account to render at all; there is no account
  in the isolated instance, so it could not be seen.
- **Workspace usage dashboard** (a standalone page built with `innerHTML`): an imperative render path with no component to hang
  the helper on.
- **Crew follow-up**: a crew card's height depends on the roles it declares, so bones could not match the real cards (a
  guess would shift the page, which is the thing the skeleton is there to avoid).
- **Insight**, **Runs**, the **session teams** popover and the in-row line of a chat-content search: a status line or a
  chart, not a list that has rows to draw (the popover's data is already there by the time it is opened: its badge counts it).

## Checking it

`scripts/check-pages-live.mjs` (section « skeletons ») holds the host's answer back with CDP `Fetch`, looks at the bones
(announced once, shimmering), releases the answer and measures where the first row lands; then repeats under reduced motion.
It runs on an isolated instance: see `live-testing.md`.
