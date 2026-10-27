# Webapps pane — Webapp Creator mockup (v1)

A mockup of the new **"Webapps"** pane tab in DSH's right sidebar: the list of the webapps a person created from the chat (each one with its own mini SQLite base). Open `index.html` by double-click — no server, no network.

## Fidelity declaration

**`simple`** — one scene, one real gesture. Declared in `cadrage.md` (`fidelite: simple`) and in `maquette.json` (`"fidelite": "simple"`); the two agree.

- **Shown**: the list with one row, the empty state (reachable with the demo aid "empty the list"), and the state the gesture reaches (running).
- **The gesture**: click **Start** on a row → the dot goes `data-state="ongoing"`, Start becomes Stop (primary → outline), the tag reads "Running", and **Open** is enabled. Stop undoes it. One delegated click listener, deterministic, no timer.
- **Declared, not drawn** (see `hors-champ` in `cadrage.md`): the tab strip / Dashboard tab, the create form, the publish dialog, the row error state, the loading state.

## Data source

`~/.dsh/kybers/rdv-demo/export.json` (read-only, `kybernos-mini-crm/1` export of a real demo base):

- `rendezvous.compte = 8` → "8 bookings"
- `contacts.compte = 5` → "5 clients"
- `pack` → name "Démo — Prise de rendez-vous", shown in English as "Demo — Appointment booking".

Not in the export, so display-only: the slug `rdv-cabinet.kaby.app` (given in the brief; publishing on `*.kaby.app` comes later). It is rendered as a link-coloured label without `href`.

## Controls borrowed

All from `dsh.css` — copied byte for byte from `~/.dsh/skills/maquette-dsh/exemples/3-maquette-dsh/dsh.css` (extracted from `@deepseek-ai/dsh-client-ui-primitives@0.1.7-alpha.1`, `kbm-*` prefix):

| Control | Markup | Used for |
| --- | --- | --- |
| Button | `kbm-btn kbm-btn-sm kbm-btn-primary / -outline / -ghost` (+ `kbm-btn-icon` slot) | Start (primary), Stop (outline), Open (ghost) |
| Tag | `kbm-tag[data-tone]` | Running (success), Stopped / total (neutral) |
| StateDot | `kbm-dot[data-state=idle|ongoing]` + local 10×10 size | row state |
| Pill | `kbm-pill kbm-pill-interactive [kbm-pill-active]` | dark-mode toggle |

Small sm size (28 px) was chosen for the buttons because the row sits in a narrow sidebar. Local additions (all commented in the page): `.wc-row .kbm-dot` size (10 px — kbm-dot has no default size), and a colour for `data-state="ongoing"` (dsh.css colours idle/done/warning/error on the dot but not ongoing — in the app that state is a spinner; the mockup keeps a plain dot, coloured with `--dsw-alias-state-success-primary`).

No hex value, no `rgba()` in the page's own styles: only `var(--dsw-alias-*)` / `var(--ds-font-family-code)`. Font sizes go through a bridge of the product scale (24 / 18 / 14 / 13 / 12 / 11); because `dsh.css` exports no font-size token, each step is `var(--dsw-font-…-font-size, <scale value>)`, and 24 px is the scale value written once.

## Responsive and dark

- `@media (max-width: 480px)`: paddings tighten, the count line wraps fragment by fragment, the actions stay on the row; nothing is meant to overflow horizontally.
- Dark: the "Dark mode" pill toggles `data-ds-dark-theme` on `<body>`; the tokens do the rest, no dark colour written by hand.

## Files

`cadrage.md`, `index.html`, `dsh.css`, `maquette.json`, `README.md`.

`scripts/maquette-new.mjs` and `scripts/check-maquette.mjs` do not exist on this machine, so `cadrage.md` and `maquette.json` were written by hand following the skill, and the gate was **not run**.

## Verification status

**Visual review: pending, done by the caller.** The author did not open a browser, take a screenshot or look at any render; layout, contrast, the 480 px fold and the dark theme are unverified by sight.
