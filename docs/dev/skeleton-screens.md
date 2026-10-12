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

Creations (cards and list, with the tiles and the line under them), Kybers (cards and rows) and the Marketplace's kybernos.app
block, Workspaces, Automations, Skills (Yours, Discover, Team). The Automations page had its own skeleton with its own
animation; it now uses this one. See the pull request for what is *not* covered and why.

## Checking it

`scripts/check-pages-live.mjs` (section « skeletons ») holds the host's answer back with CDP `Fetch`, looks at the bones
(announced once, shimmering), releases the answer and measures where the first row lands; then repeats under reduced motion.
It runs on an isolated instance: see `live-testing.md`.
