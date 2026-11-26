---
name: loader
description: Creates a custom animated loading indicator (the thinking loader) from a short description, as one self-contained animated SVG that Settings > Theme > Animation picks up by itself. Use when the user describes a loading, thinking or spinner animation they want, or types /loader (or /skill-loader) followed by a description.
whenToUse: The user wants a new loading or thinking animation, for example "three bouncing dots that follow my accent colour".
---

# Loader: one animated SVG file, picked up automatically

You turn a description into ONE self-contained animated SVG and save it where the
Theme plugin looks for it. No code, no restart, nothing to install. The user can also
start this from the chat with `/skill-loader <description>`; the Theme settings page
offers a button that copies that command.

## Steps

1. Restate the idea in one sentence. Ask a question only if it changes the result
   (one colour or several?). Default: one colour, drawn with `currentColor`.
2. Pick a slug: kebab-case, at most 40 characters, e.g. `three-bouncing-dots`. Get a
   free path with the command under "Free path" (it adds -2, -3 when the name is taken).
   NEVER overwrite an existing file without asking the user first.
3. Write the SVG to that path with your file-writing tool.
4. Run the check under "Check" on it. Fix and re-run until it prints OK.
5. Reply (see "Reply").

## Free path

Replace the slug at the end of the command; it prints the path to write:

```
node -e 'const fs=require("fs"),p=require("path"),os=require("os"),d=p.join(process.env.DSH_HOME||p.join(os.homedir(),".dsh"),"kybernos","loaders");fs.mkdirSync(d,{recursive:true});let f=p.join(d,process.argv[1]+".svg"),n=1;while(fs.existsSync(f))f=p.join(d,process.argv[1]+"-"+(++n)+".svg");console.log(f)' three-bouncing-dots
```

## Hard rules

- Root: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">`. Width and height
  are optional. At most 8 KB. No `<text>`, no fonts.
- Loop of 1 to 2 seconds, `infinite`. Animate with CSS `@keyframes` inside a `<style>`
  element (preferred) or SMIL (`<animate>`). SMIL ignores the reduced-motion rule below,
  so use it only for what CSS cannot do (animating `d` or `r`).
- Never: `<script>`, `<foreignObject>`, `<image>`, `<iframe>`, `<link>`, `<audio>`,
  `<video>`, `<embed>`, `<object>`, event attributes (`onload=`), `javascript:`,
  `@import`, backslashes, any `href` or `url()` that does not start with `#`.
- One colour: every shape uses `currentColor` (fill or stroke) and varies only with
  `fill-opacity` / `opacity`. The app tints it with the theme accent.
  Several colours: fixed hex colours, and say in your reply that it will not follow the accent.
- Legible from 14 px to 40 px: stroke width at least 4, dot radius at least 3.5, gaps at
  least 3, at most about a dozen shapes. No hairlines, no fine detail, no blur.
- Respect reduced motion: end the `<style>` with
  `@media (prefers-reduced-motion: reduce){*{animation:none!important}}`
  and make the base style (no animation) a meaningful still frame, never an empty one.
- Stagger with NEGATIVE `animation-delay` values, so the first frame is already mid-loop.

## Transform origins (a real bug in our first presets)

In SVG the default transform origin is the top-left corner of the viewBox, so a dot that
scales or rotates swings around the corner. Always set it:

- a shape that scales or rotates around ITS OWN centre:
  `transform-box: fill-box; transform-origin: center`
- a group, or the whole drawing, that rotates around the CENTRE OF THE ICON:
  `transform-box: view-box; transform-origin: 24px 24px`
- a CSS `transform` animation replaces the element's `transform="..."` attribute: put the
  attribute on a wrapping `<g>`, animate the child.

## Example (one colour, three bouncing dots)

```
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" role="img" aria-label="Loading">
  <style>
    .d{fill:currentColor;fill-opacity:.55;transform-box:fill-box;transform-origin:center;animation:b 1.2s ease-in-out infinite}
    .d2{animation-delay:-1.05s}.d3{animation-delay:-.9s}
    @keyframes b{0%,80%,100%{transform:translateY(0);fill-opacity:.4}40%{transform:translateY(-8px);fill-opacity:1}}
    @media (prefers-reduced-motion: reduce){*{animation:none!important}}
  </style>
  <circle class="d" cx="10" cy="26" r="4.5"/><circle class="d d2" cx="24" cy="26" r="4.5"/><circle class="d d3" cx="38" cy="26" r="4.5"/>
</svg>
```

A spinner is the same idea: `.spin{transform-box:view-box;transform-origin:24px 24px;animation:r 1s linear infinite}`
with `@keyframes r{to{transform:rotate(360deg)}}` on a `<g class="spin">` around a stroked arc.

## Check (the app applies the same refusals again)

Replace FILE with the path from "Free path":

```
node --input-type=module - FILE <<'JS'
import { readFileSync } from 'node:fs'
const s = readFileSync(process.argv[2], 'utf8')
const d = s.replace(/&#x([0-9a-f]+);?/gi, (m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);?/g, (m, n) => String.fromCodePoint(+n)).toLowerCase()
const bad = []
if (s.length > 8192) bad.push('over 8 KB')
if (!/^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/.test(s) || !/<\/svg>\s*$/.test(s)) bad.push('must be one <svg>...</svg>')
if (!s.includes('viewBox="0 0 48 48"')) bad.push('viewBox must be "0 0 48 48"')
if (/<(\w+:)?(script|foreignobject|iframe|image|img|link|audio|video|embed|object|source|meta|base)\b/.test(d)) bad.push('forbidden element')
if (/[\s"'\/]on[a-z]+\s*=/.test(d)) bad.push('event handler')
if (/(java|vb)script:/.test(d.replace(/[\s\x00-\x1f]/g, ''))) bad.push('script scheme')
if (/\\|@import/.test(d)) bad.push('backslash or @import')
if (/[\s"'\/](src|srcset|poster|action)\s*=|attributename\s*=\s*["']?(\w+:)?href/.test(d)) bad.push('external resource')
if (/href\s*=\s*["']?\s*[^#\s"']|url\(\s*["']?\s*[^#\s"']/.test(d)) bad.push('href/url() must start with #')
console.log(bad.length ? 'REFUSED: ' + bad.join('; ') : 'OK, ' + s.length + ' bytes')
process.exit(bad.length ? 1 : 0)
JS
```

## Reply

Short, in the user's language: the file path; whether it is one colour (follows the
accent) or fixed colours; that it is picked up automatically, with no restart, under
Settings > Theme > Animation > "Mes animations" (the name shown is the file name with
hyphens turned into spaces); that deleting the file, or the trash button there, removes
it. If it does not show up within a few seconds the app refused the file: re-run the check.
Offer one variation (speed, size, colour) as a NEW file.
