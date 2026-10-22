// ═══════════════════════════════════════════════════════════════════════════
// kybernos-sessions — client v3 « status light » (faithful to the mockup).
//
// Redesign of the status row of the DSH composer (slot `conversation.composer.dock`)
// after docs/handoff/session-status/maquette-session-status-light.html:
//   • 5 pills with a STATE label (the same words as the mockup):
//       💻 local   : Unsaved / Shared / In review / Add to project / Saved
//       ☁️  sync    : Up to date / To send / To fetch / Sync needed / No remote
//       🔀 review  : No review / Checks running / Check failed / Changes asked /
//                    Waiting for review / Ready to merge / Merged
//       📖 Memory N   (ledger runs of the agent team)
//       💡 Lessons N   (lessons learned)
//   • a click opens a floating card: title + plain sentence + visual (2- or
//     4-step stepper, computer↔GitHub diagram) + action (dry run → Confirm & run)
//     + a collapsible « Details » section.
//   • Real data: GET /kybernos-sessions/state (sync = the main folder when we
//     are in a worktree; pr = gh pr view, cached host side).
//   • Actions: POST /kybernos-sessions/{isolate,commit,close,push,fetch,sync,pr}.
// The pills are English, in sentences anyone can follow without being a developer. The « Kybernos Settings » block of
// Settings › General has an English base and a French twin (a pair helper `kt(fr, en)`, French in « tu »).
// ═══════════════════════════════════════════════════════════════════════════

window.__ModuleLoader__.load({
  id: '@local/kybernos-sessions/client',
  factory (require) {
    const React = require('react')
    const h = React.createElement
    // DSH controls CSS, inlined (the browser loader does not resolve relative
    // requires — the same scheme as kybernos-models/client.js; source:
    // kybernos-sessions/dsh-css.js, a frozen extract whose generator is gone).
    const DSH_CONTROLS_CSS = "/* ── Button — the actions (capsule h36 r18, primary/ghost/outline/toolbar variants) ─────────────────────────────── */\n/* Capsule geometry from the figma Button component (1:155 instances:\n * h36, pad 14/7, gap 4, r18; the wide New Session form is r24 at h38 —\n * owners with the wide form set their own radius/width). */\n.kbm-btn {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  gap: 4px;\n  border: none;\n  border-radius: 18px;\n  cursor: pointer;\n  font-size: 14px;\n  line-height: 22px;\n  color: var(--dsw-alias-label-primary);\n  background: transparent;\n  padding: 0 14px;\n}\n\n.kbm-btn:disabled {\n  cursor: not-allowed;\n  opacity: 0.4;\n}\n\n.kbm-btn-md {\n  height: 36px;\n}\n\n/* Compact height for dense rows; no dedicated figma node (Icon_container\n * 28x28 is the icon-only form) — geometry is ours. */\n.kbm-btn-sm {\n  height: 28px;\n  font-size: 12px;\n  line-height: 18px;\n  padding: 0 10px;\n  border-radius: 14px;\n}\n\n.kbm-btn-primary {\n  background: var(--dsw-alias-button-primary-fill);\n  color: var(--dsw-alias-label-primary-foreground);\n}\n\n.kbm-btn-primary:hover:not(:disabled) {\n  background: var(--dsw-alias-button-primary-hover);\n}\n\n.kbm-btn-ghost:hover:not(:disabled) {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.kbm-btn-ghost:active:not(:disabled) {\n  background: var(--dsw-alias-interactive-bg-active);\n}\n\n/* Dialog Cancel (figma 451:18655): bordered capsule on transparent fill. */\n.kbm-btn-outline {\n  border: 0.5px solid var(--dsw-alias-border-l3);\n  background: transparent;\n}\n\n.kbm-btn-outline:hover:not(:disabled) {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.kbm-btn-toolbar {\n  background: var(--dsw-alias-button-tool-bar-fill);\n}\n\n.kbm-btn-toolbar:hover:not(:disabled) {\n  background: var(--dsw-alias-button-tool-bar-hover);\n}\n\n.kbm-btn-icon {\n  display: inline-flex;\n  width: 16px;\n  height: 16px;\n  align-items: center;\n  justify-content: center;\n}\n\n/* ── Input — the search field (wrap + icon + input) ─────────────────────────────── */\n.kbm-in-wrap {\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  height: 32px;\n  padding: 0 8px;\n  border: 0.5px solid var(--dsw-alias-border-l4);\n  border-radius: 8px;\n  background: var(--dsw-alias-bg-layer-1);\n}\n\n.kbm-in-wrap:focus-within {\n  border-color: var(--dsw-alias-brand-primary);\n}\n\n.kbm-in-icon {\n  display: inline-flex;\n  width: 16px;\n  height: 16px;\n  align-items: center;\n  justify-content: center;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.kbm-in-input {\n  flex: 1;\n  min-width: 0;\n  border: none;\n  outline: none;\n  background: transparent;\n  font-size: 14px;\n  line-height: 22px;\n  color: var(--dsw-alias-label-primary);\n}\n\n.kbm-in-input::placeholder {\n  color: var(--dsw-alias-label-dimmed);\n}\n\n/* ── Pill — the selectable filter chips ─────────────────────────────── */\n.kbm-pill {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  height: 24px;\n  padding: 0 8px;\n  border: none;\n  border-radius: 12px;\n  font-size: 12px;\n  line-height: 18px;\n  color: var(--dsw-alias-label-secondary);\n  background: var(--dsw-alias-bg-layer-2);\n}\n\n.kbm-pill-interactive {\n  cursor: pointer;\n}\n\n.kbm-pill-interactive:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.kbm-pill-active {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-button-ghost-active-fill);\n  box-shadow: inset 0 0 0 1px var(--dsw-alias-button-ghost-active-border);\n}\n\n/* ── Tag — the read-only labels (8 tones) ─────────────────────────────── */\n/* Capsule geometry is fixed: a tag reads as one size everywhere, and only its\n * palette varies. Tone colors ride background/border/color so a render site can\n * still position the tag with its own class without touching the palette. */\n.kbm-tag {\n  display: inline-flex;\n  align-items: center;\n  border-radius: 999px;\n  corner-shape: round;\n  padding: 1px 8px;\n  font-size: 11px;\n  line-height: 17px;\n  font-weight: 500;\n  white-space: nowrap;\n}\n\n.kbm-tag[data-tone='outline'] {\n  border: 0.5px solid var(--dsw-alias-border-l4);\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.kbm-tag[data-tone='solid'] {\n  background: var(--dsw-alias-label-primary);\n  color: var(--dsw-alias-bg-layer-3);\n}\n\n.kbm-tag[data-tone='neutral'] {\n  background: var(--dsw-alias-bg-module-platform);\n  color: var(--dsw-alias-label-secondary);\n}\n\n.kbm-tag[data-tone='quiet'] {\n  color: var(--dsw-alias-label-tertiary);\n}\n\n/* Status tones tint their own color for the fill, so a palette change moves\n * fill and text together and neither needs a second token. The tint is 10%,\n * except `warning`, which keeps the 12% the plugin inventory's conditional\n * tag shipped with — matching it is what makes this a pure consolidation. */\n.kbm-tag[data-tone='success'] {\n  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);\n  color: var(--dsw-alias-state-success-primary);\n}\n\n.kbm-tag[data-tone='info'] {\n  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent);\n  color: var(--dsw-alias-state-business-primary);\n}\n\n.kbm-tag[data-tone='warning'] {\n  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent);\n  color: var(--dsw-alias-state-warn-primary);\n}\n\n.kbm-tag[data-tone='danger'] {\n  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);\n  color: var(--dsw-alias-state-error-primary);\n}\n\n/* ── StateDot — the state dots (done/warning/error/idle) ─────────────────────────────── */\n/* Ongoing blue has no alias token (state-business-primary is the 500 step,\n * not this 450) — component-level var pinned to the static scale instead. */\n.kbm-dot,\n.kbm-dot-matrix {\n  --dsh-state-ongoing: var(--dsw-static-deepseek-450);\n}\n\n/* Solid states: same-color halo via a 0.10-opacity outer layer (::before)\n * with a 6/10-scale solid core. Layer color rides currentColor set per state. */\n.kbm-dot {\n  position: relative;\n  display: inline-block;\n  flex: none;\n}\n\n.kbm-dot::before {\n  content: '';\n  position: absolute;\n  inset: 0;\n  border-radius: 50%;\n  corner-shape: round;\n  background: currentColor;\n  opacity: 0.1;\n}\n\n.kbm-dot::after {\n  content: '';\n  position: absolute;\n  inset: 20%;\n  border-radius: 50%;\n  corner-shape: round;\n  background: currentColor;\n}\n\n.kbm-dot[data-state='done'] {\n  color: var(--dsw-alias-state-success-primary);\n}\n\n.kbm-dot[data-state='warning'] {\n  color: var(--dsw-alias-state-warn-primary);\n}\n\n.kbm-dot[data-state='error'] {\n  color: var(--dsw-alias-state-error-primary);\n}\n\n/* Idle is the absence of activity, not a fourth outcome: it stays on the\n * tertiary label color so it recedes beside the three outcome colors. */\n.kbm-dot[data-state='idle'] {\n  color: var(--dsw-alias-label-tertiary);\n}\n\n/* Pixel chase: each outer cell holds a discrete brightness step (flat keyframe\n * holds, no tweening — the retro feel), peaking when the chase hits it and\n * decaying over the next three cells. Phase offsets come from per-rect\n * animation-delay (index * -125ms) set inline by the component. */\n.kbm-dot-matrix {\n  flex: none;\n  color: var(--dsh-state-ongoing);\n}\n\n.kbm-dot-cell {\n  fill: currentColor;\n  opacity: 0.15;\n  animation: kbm-dsh-state-dot-chase 1s infinite;\n}\n\n@keyframes kbm-dsh-state-dot-chase {\n  0%, 12.4% { opacity: 1; }\n  12.5%, 24.9% { opacity: 0.6; }\n  25%, 37.4% { opacity: 0.35; }\n  37.5%, 100% { opacity: 0.15; }\n}\n\n/* ── Switch — the switches ─────────────────────────────── */\n/* The on/off appearance keys off aria-checked rather than a parallel class, so\n * the visual state cannot disagree with the state assistive technology reads.\n *\n * The track is a capsule: its radius is half its height, so the corners consume\n * the whole side and the global superellipse would square the ends off against\n * the round thumb inside it. `corner-shape: round` opts the track out, the way\n * every full-round radius does. The corner-shape spec does not catch this one —\n * it recognizes 50%, 100%, and radii at or above 99px, not a radius that is\n * full-round only relative to its own box. */\n.kbm-sw {\n  box-sizing: border-box;\n  position: relative;\n  flex: 0 0 auto;\n  width: 36px;\n  height: 20px;\n  padding: 2px;\n  border: 0;\n  border-radius: 10px;\n  corner-shape: round;\n  background: var(--dsw-alias-border-l3);\n  cursor: pointer;\n}\n\n.kbm-sw[aria-checked='true'] {\n  background: var(--dsw-alias-brand-primary);\n}\n\n.kbm-sw:disabled {\n  cursor: default;\n  opacity: 0.5;\n}\n\n.kbm-sw:focus-visible {\n  outline: 2px solid var(--dsw-alias-brand-primary);\n  outline-offset: 2px;\n}\n\n.kbm-sw-thumb {\n  display: block;\n  width: 16px;\n  height: 16px;\n  border-radius: 50%;\n  corner-shape: round;\n  background: var(--dsw-alias-label-primary-foreground);\n  transition: transform 120ms ease;\n}\n\n.kbm-sw[aria-checked='true'] .kbm-sw-thumb {\n  transform: translateX(16px);\n}\n\n/* ── Checkbox — the checkboxes ─────────────────────────────── */\n.kbm-ck {\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  font-size: 14px;\n  line-height: 20px;\n  color: var(--dsw-alias-label-primary);\n  cursor: pointer;\n}\n\n.kbm-ck input {\n  flex: 0 0 auto;\n  width: 16px;\n  height: 16px;\n  margin: 0;\n  accent-color: var(--dsw-alias-brand-primary);\n  cursor: inherit;\n}\n\n.kbm-ck input:focus-visible {\n  outline: 2px solid var(--dsw-alias-brand-primary);\n  outline-offset: 2px;\n}\n\n.kbm-ck:has(input:disabled) {\n  cursor: default;\n  opacity: 0.5;\n}\n\n/* ── Menu — the dropdown menus (routes, sort) ─────────────────────────────── */\n.kbm-menu-root {\n  position: relative;\n  display: inline-flex;\n}\n\n/* Dropdown card (figma MenuDropdown 122:9481 / 419:16920): menu surface,\n * r12, elevation-prominent (hairline stroke in shadow), 4px inset padding. */\n.kbm-menu-list,\n.kbm-menu-submenu {\n  /* min-widths below are the design's outer card widths — include the pad. */\n  box-sizing: border-box;\n  padding: 4px;\n  display: flex;\n  flex-direction: column;\n  gap: 0;\n  border: 0;\n  border-radius: 20px;\n  background: var(--dsw-specific-menu);\n  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);\n  box-shadow: var(--dsw-elevation-prominent);\n  /* Elevated surface: the scrollbar thumb takes the l2 elevation tokens. The\n     declaration sits on the card rather than on `.scrollable .viewport`\n     because the elevation is a property of this surface, and the custom\n     properties inherit down to whichever descendant actually scrolls (see\n     ui-theme styles/scrollbar.css for the rebinding contract). */\n  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);\n  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);\n}\n\n/* Primary card is 218 wide in the design across both hosts. */\n.kbm-menu-list {\n  position: absolute;\n  top: calc(100% + 4px);\n  left: 0;\n  z-index: 100;\n  min-width: 218px;\n  max-width: 360px;\n}\n\n/* Portal mode: fixed in the viewport, coordinates supplied inline from the\n * anchor rect (side/align resolved in JS, the in-place offset rules above\n * don't apply). Portaled lists must layer above modal overlays (z 1000) —\n * an anchor inside a dialog still expects its menu on top. */\n.kbm-menu-portal {\n  position: fixed;\n  top: auto;\n  left: auto;\n  z-index: 1100;\n}\n\n/* Open above the anchor (empty-state workspace chip: figma 122:9481). */\n.kbm-menu-sideTop {\n  top: auto;\n  bottom: calc(100% + 4px);\n}\n\n.kbm-menu-alignEnd {\n  left: auto;\n  right: 0;\n}\n\n/* Viewport fit: the card stops 12px short of the viewport's top/bottom edges\n * (24 = 2 × the portal MARGIN in Menu.tsx) and taller content scrolls inside\n * .viewport, so a pinned .footer stays visible. Menus with submenu rows skip\n * this class — the overflow clip would crop the side card, so they rely on\n * staying short. */\n.kbm-menu-scrollable {\n  max-height: calc(100vh - 24px);\n}\n\n.kbm-menu-viewport {\n  display: flex;\n  flex-direction: column;\n  min-height: 0;\n}\n\n.kbm-menu-scrollable .kbm-menu-viewport {\n  overflow-y: auto;\n}\n\n/* Pinned rows below the scroll region; l2 hairline (l1 is near-invisible on\n * the menu surface) mirrors the .separator spacing. */\n.kbm-menu-footer {\n  flex: none;\n  display: flex;\n  flex-direction: column;\n  margin-top: 4px;\n  padding-top: 4px;\n  border-top: 0.5px solid var(--dsw-alias-border-l2);\n}\n\n.kbm-menu-itemWrap {\n  position: relative;\n}\n\n/* Menu cell (figma .Menu_cell): min-h 40, r10, pad 10/8, 14/22 primary,\n * gap 8 between leading icon / label / trailing check. */\n.kbm-menu-item {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  width: 100%;\n  min-height: 40px;\n  padding: 8px 10px;\n  border: none;\n  border-radius: 10px;\n  background: transparent;\n  cursor: pointer;\n  font-size: 14px;\n  line-height: 22px;\n  color: var(--dsw-alias-label-primary);\n  text-align: left;\n}\n\n.kbm-menu-item:hover:not(:disabled) {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n/* Arrow navigation moves real focus, so the row the keyboard is on carries the\n   same fill the pointer gets: the fill is the row's focus indication, and the\n   browser's default ring would double it. */\n.kbm-menu-item:focus-visible:not(:disabled) {\n  background: var(--dsw-alias-interactive-bg-hover);\n  outline: none;\n}\n\n.kbm-menu-denseList .kbm-menu-item {\n  min-height: 34px;\n  padding-block: 5px;\n}\n\n.kbm-menu-denseList .kbm-menu-label {\n  padding-block: 4px;\n}\n\n.kbm-menu-list.kbm-menu-compactList,\n.kbm-menu-submenu.kbm-menu-compactList {\n  min-width: 164px;\n  padding: 2px;\n  border-radius: 7px;\n}\n\n.kbm-menu-compactList .kbm-menu-item {\n  min-height: 26px;\n  gap: 6px;\n  padding: 3px 7px;\n  border-radius: 5px;\n  font-size: 12px;\n  line-height: 18px;\n}\n\n.kbm-menu-compactList .kbm-menu-itemIcon {\n  width: 14px;\n  height: 14px;\n}\n\n.kbm-menu-compactList .kbm-menu-separator {\n  margin: 2px;\n}\n\n.kbm-menu-compactList .kbm-menu-label {\n  padding: 4px 7px;\n  font-size: 11px;\n  line-height: 16px;\n}\n\n.kbm-menu-item:disabled {\n  opacity: 0.4;\n  cursor: not-allowed;\n}\n\n.kbm-menu-itemIcon {\n  display: inline-flex;\n  flex: none;\n  width: 16px;\n  height: 16px;\n  align-items: center;\n  justify-content: center;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.kbm-menu-itemLabel {\n  flex: 1;\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.kbm-menu-check {\n  flex: none;\n  color: var(--dsw-alias-label-primary);\n}\n\n/* Selected cell keeps the plain fill (marker is the trailing check); the\n * class remains as a hook for owner-side emphasis. */\n.kbm-menu-selected {\n  background: transparent;\n}\n\n/* Fill-mode selection: the row holds the hover fill instead of a check. */\n.kbm-menu-selectedFill {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n/* Destructive row: error text/icon, danger hover fill. */\n.kbm-menu-danger {\n  color: var(--dsw-alias-state-error-primary);\n}\n\n.kbm-menu-danger .kbm-menu-itemIcon {\n  color: var(--dsw-alias-state-error-primary);\n}\n\n.kbm-menu-danger:hover:not(:disabled) {\n  background: var(--dsw-alias-interactive-bg-hover-danger);\n}\n\n.kbm-menu-danger:focus-visible:not(:disabled) {\n  background: var(--dsw-alias-interactive-bg-hover-danger);\n  outline: none;\n}\n\n/* Heading row: non-interactive small grey text, padding aligned with items. */\n.kbm-menu-label {\n  padding: 8px 10px;\n  font-size: 12px;\n  line-height: 16px;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n/* Separator cell (figma 122:9481): py 4 / px 2 around the hairline. */\n.kbm-menu-separator {\n  height: 0.5px;\n  margin: 4px 2px;\n  background: var(--dsw-alias-border-l1);\n}\n\n/* Nested card to the right of the parent row (figma 419:16920).\n * Bottom-aligned with the parent menu card (grows upward): itemWrap sits in\n * .list's 4px pad, so bottom: -4px matches the list's outer bottom edge.\n * Horizontal: list pad (4px) + 6px card gap = 10px past itemWrap — plain\n * `100% + 6px` collapses to ~2px between outer card edges.\n * ::before bridges the full gap so the pointer can cross without mouseLeave. */\n.kbm-menu-submenu {\n  position: absolute;\n  top: auto;\n  bottom: -4px;\n  left: calc(100% + 10px);\n  z-index: 101;\n  min-width: 163px;\n}\n\n.kbm-menu-submenu::before {\n  content: '';\n  position: absolute;\n  top: 0;\n  bottom: 0;\n  left: -10px;\n  width: 10px;\n}\n\n/* ── Modal — the detail surface ─────────────────────────────── */\n/* Full-viewport layer (figma Mask + Dialog 451:18655): mask + centered card. */\n.kbm-mdl-root {\n  position: fixed;\n  inset: 0;\n  z-index: 1000;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  padding: 24px;\n}\n\n/* User/spec mask: rgba(0,0,0,0.24) + blur(2px) via --dsw-alias-bg-mask-1 /\n   --dsw-mask-blur (light); dark theme raises mask opacity. */\n.kbm-mdl-mask {\n  position: absolute;\n  inset: 0;\n  background: var(--dsw-alias-bg-mask-1);\n  backdrop-filter: var(--dsw-mask-blur);\n}\n\n/* Dialog card: r24, elevation-prominent, layer-2 fill, pb 24. */\n.kbm-mdl-dialog {\n  position: relative;\n  z-index: 1;\n  display: flex;\n  flex-direction: column;\n  gap: 20px;\n  width: min(380px, 100%);\n  padding: 0 0 24px;\n  overflow: hidden;\n  border: 0;\n  border-radius: 24px;\n  background: var(--dsw-alias-bg-layer-2);\n  box-shadow: var(--dsw-elevation-prominent);\n}\n\n.kbm-mdl-content {\n  display: flex;\n  flex-direction: column;\n  width: 100%;\n}\n\n/* Header row (figma Title row): pad l24/t22/r14/b12, SPACE_BETWEEN —\n * title left, close button right. */\n.kbm-mdl-header {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  padding: 22px 14px 12px 24px;\n}\n\n.kbm-mdl-title {\n  margin: 0;\n  font-size: 16px;\n  line-height: 24px;\n  font-weight: 500; /* figma wt510, rendered 500 */\n  color: var(--dsw-alias-label-primary);\n}\n\n.kbm-mdl-close {\n  flex: none;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  width: 28px;\n  height: 28px;\n  border: none;\n  border-radius: 8px;\n  background: transparent;\n  cursor: pointer;\n  color: var(--dsw-alias-label-secondary);\n}\n\n.kbm-mdl-close:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n/* Description and body share the 332px content column (24px side pads). */\n.kbm-mdl-description {\n  margin: 0;\n  padding: 0 24px;\n  font-size: 14px;\n  line-height: 22px;\n  font-weight: 400;\n  color: var(--dsw-alias-label-primary);\n}\n\n.kbm-mdl-body {\n  display: flex;\n  flex-direction: column;\n  min-width: 0;\n  margin-top: 20px;\n  padding: 0 24px;\n}\n\n.kbm-mdl-footer {\n  display: flex;\n  align-items: center;\n  justify-content: flex-end;\n  gap: 8px;\n  padding: 0 24px;\n}\n\n/* ── Tooltip — the help bubbles ─────────────────────────────── */\n.kbm-tip-bubble {\n  position: fixed;\n  z-index: 100;\n  /* Fixed-position shrink-to-fit measures only the space from `left` to the\n     viewport edge, so anchors near the right edge would wrap early;\n     max-content sizes by the label alone, capped at half the viewport. */\n  width: max-content;\n  max-width: 50vw;\n  padding: 3px 7px;\n  border-radius: 8px;\n  background: var(--dsw-alias-tooltip-bg);\n  color: var(--dsw-static-neutral-bluish-00);\n  font-size: 13px;\n  line-height: 20px;\n  white-space: pre-line;\n  /* Unbreakable tokens (URLs, paths) must not push past max-width. */\n  overflow-wrap: break-word;\n  pointer-events: none;\n  animation: kbm-tooltip-in 150ms var(--ds-ease-in-out);\n}\n\n.kbm-tip-bubble[data-side='right'] {\n  transform: translateY(-50%);\n}\n\n.kbm-tip-bubble[data-side='bottom'] {\n  transform: translateX(-50%);\n}\n\n.kbm-tip-bubble[data-side='top'] {\n  transform: translate(-50%, -100%);\n}\n\n@keyframes kbm-tooltip-in {\n  from { opacity: 0; }\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .kbm-tip-bubble {\n    animation: none;\n  }\n}\n\n/* ── DisclosureRow — the expandable row (title + content side by side) ─────────────────────────────── */\n/* Shared disclosure header: [16px leading] gap 6 [title 13/24] at the default\n   size. The Settings font-size preference moves the row through the\n   body-published axis: title size follows the secondary tier\n   (--dsh-content-font-size-secondary: one step under the body — setting −1 at\n   ≤14, setting −2 above), and the row height, leading box, and glyph edge\n   shift by the body px delta so the icon keeps its optical share of the\n   line. */\n\n.kbm-dr-root {\n  display: flex;\n  flex-direction: column;\n  width: 100%;\n  min-width: 0;\n}\n\n.kbm-dr-row {\n  position: relative;\n  overflow: hidden;\n  display: flex;\n  align-items: center;\n  height: calc(24px + var(--dsh-content-font-delta, 0px));\n  min-width: 0;\n}\n\n.kbm-dr-row[data-expandable] {\n  cursor: pointer;\n}\n\n.kbm-dr-leading {\n  position: relative;\n  flex: none;\n  width: calc(16px + var(--dsh-content-font-delta, 0px));\n  height: calc(16px + var(--dsh-content-font-delta, 0px));\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  margin-right: 6px;\n  padding: 0;\n  border: none;\n  background: none;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n/* Flow-row glyphs render at 14px inside the 16px box; the CSS edge overrides\n   each svg's own width/height attributes so every registered icon scales\n   without a per-callsite size prop. StateDot (its svg carries data-state)\n   stays at its fixed figma size — it is a status mark, not text furniture. */\n.kbm-dr-leading svg:not([data-state]) {\n  width: calc(14px + var(--dsh-content-font-delta, 0px));\n  height: calc(14px + var(--dsh-content-font-delta, 0px));\n}\n\nbutton.kbm-dr-leading {\n  cursor: pointer;\n}\n\n.kbm-dr-iconIdle {\n  display: inline-flex;\n  opacity: 1;\n  transition: opacity 100ms ease;\n}\n\n.kbm-dr-chevronHover {\n  position: absolute;\n  inset: 0;\n  margin: auto;\n  opacity: 0;\n  transition: opacity 100ms ease;\n}\n\n.kbm-dr-row:hover .kbm-dr-iconIdle {\n  opacity: 0;\n}\n\n.kbm-dr-row:hover .kbm-dr-chevronHover {\n  opacity: 1;\n}\n\n.kbm-dr-title {\n  flex: none;\n  font-size: var(--dsh-content-font-size-secondary, 13px);\n  line-height: calc(24px + var(--dsh-content-font-delta, 0px));\n  color: var(--dsw-alias-label-secondary);\n}"

    // ── own styles (kbs-*) — geometry and tokens of the mockup ───────────────
    const CSS = `
/* Geometry aligned on the native DSH capsule (measured in the GUI:
   h22 · r24 · padding 1px 8px · 12px/400 · gap 6) — ours was h28, taller
   and bolder than the line it goes with, which looked « busy » on its own.
   15 px icon: 24 − 2 of border leaves it room to breathe. */
.kbs-pill{position:relative;display:inline-flex;align-items:center;gap:5px;height:24px;
  padding:0 8px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.10));
  border-radius:24px;background:transparent;color:var(--dsw-alias-label-secondary,#cfd3d6);
  font:inherit;font-size:12.5px;font-weight:500;line-height:1;cursor:pointer;white-space:nowrap}
/* The label is no longer painted: the row is made of icons (and their
   count). The word stays in the DOM — screen readers, the hover bubble and
   the test harness keep reading it word for word. */
.kbs-lib{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;
  clip-path:inset(50%);white-space:nowrap;border:0}
/* The Memory & Lessons pill states its name (the others are icon + count): it is the one people could
   not tell apart. Under 760 px the word goes back to the screen-reader-only form. */
.kbs-meter{height:6px;border-radius:3px;background:var(--dsw-alias-bg-layer-3,rgba(255,255,255,.12));overflow:hidden;margin:2px 0 8px}
.kbs-meter i{display:block;height:100%;border-radius:3px;background:var(--acc)}
.kbs-lib--vis{position:static;width:auto;height:auto;margin:0;overflow:visible;clip-path:none}
.kbs-pill .kbs-pillsep{width:1px;height:12px;background:var(--dsw-alias-border-l3,rgba(255,255,255,.16))}
.kbs-pill .kbs-d{font-weight:600;font-variant-numeric:tabular-nums;color:var(--dsw-alias-state-success-primary,#22c55e)}
@media (max-width:760px){.kbs-lib--vis{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip-path:inset(50%)}}
.kbs-pill .kbs-n{font-size:12.5px;line-height:1}
.kbs-pill:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.kbs-pill:focus-visible{outline:2px solid var(--acc);outline-offset:1px}
.kbs-pill[aria-expanded="true"]{border-color:var(--acc);color:var(--dsw-alias-label-primary,#e8eaec);
  background:color-mix(in srgb,var(--acc) 10%,transparent)}
/* The icon is neutral by default: the colour no longer says « which pill am I »
   but « this one asks for something ». The accent comes back on the gesture
   (kbs-pill--act) and on the pill whose card is open. */
.kbs-pill .kbs-ico{display:inline-flex;color:var(--dsw-alias-label-tertiary,#8a9096)}
.kbs-pill[aria-expanded="true"] .kbs-ico{color:var(--acc)}
/* P6 — the number takes the colour of the state (--acc): a purple « 22 » stands
   out without outliving the row, and rule 1 holds (the icons stay neutral). */
.kbs-pill .kbs-n{color:var(--acc,var(--dsw-alias-label-secondary,#cfd3d6));font-weight:600;font-variant-numeric:tabular-nums}
/* A pill with nothing to say steps back (losing nothing: icon, bubble, card
   and click stay). Hover and an open card light it up again. */
.kbs-pill{transition:opacity 120ms var(--ds-ease-in-out,ease)}
.kbs-pill--calme{opacity:.55}
.kbs-pill--calme:hover,.kbs-pill--calme:focus-visible,.kbs-pill--calme[aria-expanded="true"]{opacity:1}
.kbs-pill[aria-expanded="true"] .kbs-tip{display:none}
/* The positioning is carried by .kbs-pill .kbs-tip (0,2,0) and not .kbs-tip:
   the same class name .kbm-tip-bubble lives in the application's sheet,
   loaded AFTER ours — at equal specificity it won, and position:fixed
   with our bottom:calc(100% + 8px) (100 % of the WINDOW) put the bubble
   74 px above the viewport: the composer bubbles were invisible.
   Seen on the evening of 22/09 while filming the hover. */
.kbs-pill .kbs-tip{position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);
  pointer-events:none;opacity:0;transition:opacity 120ms var(--ds-ease-in-out,ease)}
.kbs-pill:hover .kbs-tip,.kbs-pill:focus .kbs-tip{opacity:1}
/* The two pills that stick to the right edge anchor their bubble on the right:
   centred, the « Lessons » bubble (437 px) left the window below 1400 px —
   measured at 1000 px (right edge 1049 for 1000) and at 760 px (833 for 760). */
.kbs-pill--bordDroit .kbs-tip{left:auto;right:0;transform:none}
/* P4 — a « Notes » card with two sections (Memory then Lessons): the card
   replaces the two old ones, the content is intact. */
.kbs-memwrap{display:flex;flex-direction:column;gap:12px}
.kbs-note-sec{display:flex;flex-direction:column;gap:6px}
.kbs-note-t{margin:0;font-size:11px;font-weight:600;letter-spacing:.3px;text-transform:uppercase;
  color:var(--dsw-alias-label-tertiary,#8a9096)}
/* The CARD of the last two pills follows the same rule (same cause, two
   surfaces): centred, it left the window at 900 px — 902 px for
   memory, 960 px for lessons. */
.kbs-popwrap.kbs-bordDroit .kbs-pop{left:auto;right:0;transform:none}

.kbs-popwrap{position:relative;display:inline-flex}
/* The shell's menu token is SEMI-TRANSPARENT (#30313680 in the dark theme):
   used as it is, the card let the composer show through
   (« Commit & merge locally » over « DeepSeek V4.1 Flash »). We keep the
   token — it follows the theme — but composited over the opaque base
   background, so the card is readable everywhere. */
.kbs-pop{position:absolute;bottom:calc(100% + 10px);left:50%;transform:translateX(-50%);z-index:70;
  width:min(340px,calc(100vw - 48px));max-height:min(560px,calc(100vh - 180px));overflow-y:auto;
  text-align:left;background:linear-gradient(var(--dsw-specific-menu,#1c1c1f),var(--dsw-specific-menu,#1c1c1f)),
    var(--dsw-alias-bg-base,#151517);
  border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.10));border-radius:18px;
  padding:12px 18px 8px;color:var(--dsw-alias-label-primary,#e8eaec);
  box-shadow:0 16px 44px rgba(0,0,0,.42);font-size:14px}
.kbs-pop-head{display:flex;align-items:center;gap:8px;min-height:32px}
.kbs-pop-name{flex:1;display:flex;align-items:center;gap:8px;font-size:13px;
  color:var(--dsw-alias-label-tertiary,#8a9096)}
.kbs-pop-name .kbs-ico{display:inline-flex;color:var(--acc)}
.kbs-x{width:30px;height:30px;border:0;background:transparent;border-radius:8px;
  color:var(--dsw-alias-label-tertiary,#8a9096);display:flex;align-items:center;justify-content:center;
  cursor:pointer;margin-right:-8px;padding:0}
.kbs-x:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.kbs-cartetitre{margin:10px 0 4px;font-size:18px;font-weight:700;line-height:1.25;
  color:var(--dsw-alias-label-primary,#e8eaec);text-wrap:balance}
.kbs-text{margin:0;font-size:14px;line-height:1.45;color:var(--dsw-alias-label-secondary,#cfd3d6);
  text-wrap:pretty}
.kbs-note-line{margin:8px 0 0;font-size:12.5px;line-height:1.45;color:var(--dsw-alias-label-tertiary,#8a9096)}
.kbs-code-in{font:12px/1.5 ui-monospace,Menlo,monospace;overflow-wrap:anywhere}

/* stepper (mockup .steps) — 2 steps (Saved → In the project) or 4 (PR) */
.kbs-steps{display:grid;margin-top:16px}
.kbs-step{display:flex;flex-direction:column;align-items:center;gap:5px}
.kbs-rail{width:100%;height:20px;display:flex;align-items:center}
.kbs-seg{flex:1;height:2.5px;background:var(--dsw-alias-border-l2,rgba(255,255,255,.10))}
.kbs-seg.on{background:var(--dsw-alias-state-success-primary,#22c55e)}
.kbs-sdot{width:20px;height:20px;border-radius:50%;flex:none;display:flex;align-items:center;
  justify-content:center;box-sizing:border-box}
/* Ink on the state fills (--acc is a state token or a pastel): white on them is 2.1 to 2.8:1, #0f1115 is 5.4:1 or more. */
.kbs-sdot.done{background:var(--dsw-alias-state-success-primary,#22c55e);color:#0f1115;border:0}
.kbs-sdot.next{border:2.5px solid var(--acc);background:transparent}
.kbs-sdot.todo{border:2px solid var(--dsw-alias-border-l3,rgba(255,255,255,.18));background:transparent}
.kbs-sdot.blocked{background:var(--acc);color:#0f1115;border:0}
.kbs-sl{font-size:12.5px;color:var(--dsw-alias-label-secondary,#cfd3d6);white-space:nowrap}
.kbs-sl.todo{color:var(--dsw-alias-label-tertiary,#8a9096)}
.kbs-sl.next,.kbs-sl.blocked{font-weight:600}

/* computer ↔ GitHub diagram (mockup .sync) */
.kbs-sync{margin-top:14px;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:10px}
.kbs-node{display:flex;flex-direction:column;align-items:center;gap:4px;font-size:11.5px;
  color:var(--dsw-alias-label-secondary,#cfd3d6);white-space:nowrap}
.kbs-node svg{color:var(--dsw-alias-label-primary,#e8eaec)}
.kbs-arrs{display:flex;flex-direction:column;gap:8px}
.kbs-arr{display:flex;align-items:center;gap:8px;color:var(--c)}
.kbs-arr.l{flex-direction:row-reverse}
.kbs-arr-l{font-size:11px;color:var(--c);min-width:86px;text-align:center;white-space:nowrap}
.kbs-line{flex:1;height:2px;background:color-mix(in srgb,var(--c) 40%,transparent);position:relative}
.kbs-line::after{content:'';position:absolute;top:-3px;width:8px;height:8px;
  border-top:2px solid var(--c);border-right:2px solid var(--c)}
.kbs-arr.r .kbs-line::after{right:0;transform:rotate(45deg)}
.kbs-arr.l .kbs-line::after{left:0;transform:rotate(-135deg)}

/* main action + dry-run plan */
.kbs-act{margin-top:14px}
.kbs-btn{width:100%;height:40px;border:0;border-radius:12px;background:var(--acc);color:#0f1115;
  font:inherit;font-size:14.5px;font-weight:600;cursor:pointer;padding:0 14px}
.kbs-btn:hover{filter:brightness(1.1)}
.kbs-hint{margin:6px 0 0;font-size:12.5px;line-height:1.4;color:var(--dsw-alias-label-tertiary,#8a9096);
  text-align:center}
.kbs-ok{height:40px;border-radius:12px;border:1px dashed var(--dsw-alias-border-l2,rgba(255,255,255,.10));
  display:flex;align-items:center;justify-content:center;font-size:13px;
  color:var(--dsw-alias-label-tertiary,#8a9096)}
.kbs-plan{display:flex;flex-direction:column;gap:4px}
.kbs-cmd{display:block;font:11px/1.7 ui-monospace,Menlo,monospace;
  color:var(--dsw-alias-label-secondary,#cfd3d6);background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));
  border-radius:6px;padding:1px 8px;overflow-wrap:anywhere}
.kbs-plan .kbs-btn{margin-top:6px}
.kbs-erreur{margin:6px 0 0;font-size:12.5px;line-height:1.45;color:var(--dsw-alias-state-error-primary,#ef4444);
  overflow-wrap:anywhere}
.kbs-done{margin:6px 0 0;font-size:12.5px;line-height:1.45;color:var(--dsw-alias-state-success-primary,#22c55e)}

/* footer + details */
.kbs-pied{margin-top:12px;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.07));padding-top:2px}
.kbs-more{display:flex;align-items:center;gap:6px;width:100%;min-height:32px;padding:0;border:0;
  background:none;color:var(--dsw-alias-label-tertiary,#8a9096);font:inherit;font-size:13px;cursor:pointer}
.kbs-more svg{transition:transform .15s}
.kbs-more[aria-expanded="true"] svg{transform:rotate(180deg)}
.kbs-detail{padding:4px 0 10px;display:flex;flex-direction:column;gap:10px}
.kbs-kv{display:grid;grid-template-columns:86px minmax(0,1fr);gap:8px;font-size:12.5px;line-height:1.45}
.kbs-kv dt{color:var(--dsw-alias-label-tertiary,#8a9096);overflow-wrap:anywhere}
.kbs-kv dd{margin:0;color:var(--dsw-alias-label-primary,#e8eaec);overflow-wrap:anywhere}
.kbs-lien{color:var(--acc);text-decoration:none;font-size:12.5px}
.kbs-lien:hover{text-decoration:underline}

/* memory & lessons */
.kbs-kybers{display:flex;gap:5px;flex-wrap:wrap;margin:10px 0 0}
.kbs-kyb{height:24px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.10));
  background:transparent;color:var(--dsw-alias-label-secondary,#cfd3d6);font:inherit;font-size:11.5px;
  cursor:pointer;padding:0 9px}
.kbs-kyb:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.kbs-kyb.on{border-color:var(--acc);color:var(--dsw-alias-label-primary,#e8eaec);
  background:color-mix(in srgb,var(--acc) 12%,transparent)}
.kbs-membres{display:flex;gap:5px;flex-wrap:wrap;margin:14px 0 0}
.kbs-membre{font-size:11.5px;padding:2px 9px;border-radius:999px;
  background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));
  color:var(--dsw-alias-label-secondary,#cfd3d6);white-space:nowrap}
.kbs-lessons{margin-top:6px;display:flex;flex-direction:column}
.kbs-lesson{padding:9px 0;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.07))}
.kbs-lesson:first-child{border-top:0}
.kbs-lesson time{font-size:11px;color:var(--dsw-alias-label-tertiary,#8a9096);font-variant-numeric:tabular-nums}
.kbs-lesson p{margin:2px 0 0;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary,#e8eaec);
  display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.kbs-detail .kbs-lesson p{-webkit-line-clamp:unset;display:block;overflow:visible}
.kbs-tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px}
.kbs-tag{font-size:10.5px;padding:1px 7px;border-radius:999px;
  background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));
  color:var(--dsw-alias-label-secondary,#cfd3d6)}
.kbs-vide{margin-top:10px;padding:16px 12px;border:1px dashed var(--dsw-alias-border-l2,rgba(255,255,255,.10));
  border-radius:10px;text-align:center;color:var(--dsw-alias-label-tertiary,#8a9096);font-size:12.5px}
.kbs-minirow{display:flex;align-items:center;gap:8px;margin-top:10px}
.kbs-minibtn{height:26px;padding:0 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.10));
  background:transparent;color:var(--dsw-alias-label-secondary,#cfd3d6);font:inherit;font-size:11.5px;cursor:pointer}
.kbs-minibtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.kbs-copie{font-size:11px;color:var(--dsw-alias-state-success-primary,#22c55e)}
/* memory gestures of THIS session (record / lesson / used) */
.kbs-memo{margin-top:8px;display:flex;flex-direction:column}
.kbs-memo-row{padding:8px 0;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.07))}
.kbs-memo-row:first-child{border-top:0}
.kbs-memo-head{display:flex;align-items:baseline;gap:8px;font-size:11px;
  color:var(--dsw-alias-label-tertiary,#8a9096);font-variant-numeric:tabular-nums}
.kbs-memo-kind{font-weight:600;color:var(--acc)}
.kbs-memo-row p{margin:2px 0 0;font-size:13px;line-height:1.45;color:var(--dsw-alias-label-primary,#e8eaec)}
/* Category icon before the title of a session: the glyph of the title
   (🎨…) is not rendered as a character, it becomes this SVG. Its shape says
   the category, its colour says the state of the work: grey as long as the
   work is not committed, green as soon as the session's last gesture on its
   folder was a commit. */
.kbs-titre-ico{display:inline-flex;flex:none;align-items:center;justify-content:center;
  width:15px;height:15px;margin:0 5px 0 0;vertical-align:-3px;
  color:var(--kbs-ico,var(--dsw-alias-label-tertiary,#8a9096))}
.kbs-titre-ico svg{display:block}
.kbs-titre-ico--fait{color:var(--dsw-alias-state-success-primary,#22c55e)}
/* Chat list — default display: the rows that fall out of the filter
   (work committed beyond the 2 guaranteed rows) are hidden by
   ATTRIBUTE, never by class nor by style: React rewrites className at
   every render, and a DOM without a style object (the test harness) must stay
   usable. The attribute survives the passes, so the rule is idempotent. */
[data-kbv="0"]{display:none!important}
/* Session summary: done / not done / can be closed, and the local gesture
   (commit & merge on the machine, no GitHub send). */
.kbs-bilan{margin-top:10px;display:flex;flex-direction:column;gap:2px}
.kbs-recap-row{display:flex;gap:10px;align-items:baseline;padding:7px 0;
  border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.07))}
.kbs-recap-row:first-child{border-top:0}
.kbs-recap-k{flex:none;width:74px;font-size:11px;font-weight:600;letter-spacing:.3px;
  text-transform:uppercase;color:var(--dsw-alias-label-tertiary,#8a9096)}
.kbs-recap-v{flex:1;min-width:0;font-size:13px;line-height:1.45;color:var(--dsw-alias-label-primary,#e8eaec)}
.kbs-recap-v b{font-weight:600}
.kbs-recap-att{color:var(--dsw-alias-label-tertiary,#8a9096);font-size:12px}
.kbs-pill--act{border-color:var(--acc)}
/* The « commit & merge » pill: it is a gesture, not only a state — it stands
   out at first glance when work is left on the machine. */
.kbs-pill--act{background:color-mix(in srgb,var(--acc) 12%,transparent)}
.kbs-pill--act .kbs-ico{color:var(--acc)}
/* « Kybernos Settings » page (Settings popup): a Yes/No switch per
   setting, written host side (the agent reads the same file). */
/* (29/09) Capped at 720px like Maintenance: the section does not stretch over
   the whole width of the Settings pane — the rows stay readable. */
.kbr-page{padding:0;max-width:720px;font-size:14px;line-height:normal}
/* (29/09) UNIFORMITY of the pane: the host DSH sections (Permission, Language,
   Font size…) share the General page with our 720px block and stayed
   full width — two widths on one page read as broken CSS. All the sections of
   the dialog are capped, host ones included. The _section suffix comes from the
   shell's source class name (stable across builds, only the hashed prefix
   changes). */
[role="dialog"] [class$="_section"]{max-width:720px}
.kbr-page h4{margin:0 0 2px}
.kbr-intro{margin:0 0 8px;color:var(--dsw-alias-label-secondary,#cfd3d6);font-size:13px}
.kbr-sub{margin:22px 0 4px;font-size:16px;font-weight:600;line-height:1.3;color:var(--dsw-alias-label-primary,#e8eaec)}
.kbr-row{display:flex;gap:16px;align-items:center;padding:16px 0;
  border-top:0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.kbr-row:last-of-type{border-bottom:0}
.kbr-txt{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.kbr-txt b{font-size:14px;font-weight:400;color:inherit}
.kbr-txt span{font-size:13px;color:var(--dsw-alias-label-tertiary,#8a9096);line-height:1.45}
.kbr-oui-non{flex:none;display:inline-flex;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.10));
  border-radius:999px;padding:3px;gap:2px}
.kbr-choix{min-width:56px;height:30px;padding:0 14px;border:0;border-radius:999px;background:transparent;
  color:var(--dsw-alias-label-secondary,#cfd3d6);font:inherit;font-size:13px;font-weight:600;cursor:pointer}
.kbr-choix:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.kbr-choix.on{background:var(--dsw-alias-button-primary-fill,#3b82f6);
  color:var(--dsw-alias-label-primary-foreground,#fff)}
.kbr-select{flex:none;min-width:200px;max-width:320px;height:36px;padding:0 14px;font-size:14px;
  color:var(--dsw-alias-label-primary,#e8eaec);background:var(--dsw-alias-bg-layer-3,rgb(53,54,56));
  border:0;border-radius:18px;cursor:pointer}
.kbr-select:disabled{opacity:.55;cursor:default}
.kbr-select:focus-visible{outline:2px solid var(--dsw-alias-button-primary-fill,#3b82f6);outline-offset:1px}
.kbr-note{margin:10px 0 0;font-size:12.5px;color:var(--dsw-alias-label-tertiary,#8a9096)}
.kbr-versions{margin:14px 0 0;padding-block-start:12px;font-size:12.5px;
  color:var(--dsw-alias-label-tertiary,#8a9096);border-block-start:.5px solid var(--dsw-alias-border-l2)}
.kbr-ok{margin:10px 0 0;font-size:12px;color:var(--dsw-alias-state-success-primary,#22c55e)}
.kbr-err{margin:10px 0 0;font-size:12px;color:var(--dsw-alias-state-error-primary,#ef4444)}
.kbr-warn{display:block;margin-top:4px;font-size:12px;color:var(--dsw-alias-state-warn-primary,#f59e0b)}
/* ── Auto routing (02/10): whitelist chips + choice menu ── */
`
    let cssPose = false
    const poserCss = () => {
      if (cssPose || typeof document === 'undefined') return
      const style = document.createElement('style')
      if (!document.getElementById('kbm-controls-style')) {
        const ctl = document.createElement('style')
        ctl.id = 'kbm-controls-style'
        ctl.textContent = DSH_CONTROLS_CSS
        document.head.appendChild(ctl)
      }
      style.id = 'kbs-style'
      style.textContent = CSS
      document.head.appendChild(style)
      cssPose = true
    }

    // ── accents — DSH tokens for the git states, mockup tints for
    // memory/lessons/review (icons only, readable on a dark background too) ──
    const ACC = {
      error: 'var(--dsw-alias-state-error-primary,#ef4444)',
      warn: 'var(--dsw-alias-state-warn-primary,#f59e0b)',
      business: 'var(--dsw-alias-state-business-primary,#4c8dff)',
      success: 'var(--dsw-alias-state-success-primary,#22c55e)',
      violet: '#a78bfa',
      cyan: '#38bdf8',
      teal: '#2dd4bf',
      pink: '#f472b6',
      idle: 'var(--dsw-alias-label-tertiary,#8a9096)'
    }
    const pl = (n, one, many) => n === 1 ? one : many
    const court = (iso) => (iso || '').slice(0, 10)
    const depuis = (iso) => {
      if (!iso) return null
      const ms = Date.now() - new Date(iso).getTime()
      if (!Number.isFinite(ms) || ms < 0) return null
      const mn = Math.floor(ms / 60000)
      if (mn < 1) return 'just now'
      if (mn < 60) return mn + ' min ago'
      const hh = Math.floor(mn / 60)
      if (hh < 24) return hh + ' h ago'
      return Math.floor(hh / 24) + ' d ago'
    }

    // ── icons (2px stroke, inherits currentColor) ───────────────────────────
    const ICONS = {
      laptop: '<path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16"/>',
      cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
      pr: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" y1="9" x2="6" y2="21"/>',
      book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
      brain: '<path d="M9.5 3A3.5 3.5 0 0 0 6 6.5c0 .4.1.8.2 1.1A3.5 3.5 0 0 0 4 10.8c0 1 .5 2 1.2 2.6A3.5 3.5 0 0 0 7 19a3 3 0 0 0 5-1V4.5A1.5 1.5 0 0 0 9.5 3z"/><path d="M14.5 3A3.5 3.5 0 0 1 18 6.5c0 .4-.1.8-.2 1.1A3.5 3.5 0 0 1 20 10.8c0 1-.5 2-1.2 2.6A3.5 3.5 0 0 1 17 19a3 3 0 0 1-5-1V4.5A1.5 1.5 0 0 1 14.5 3z"/>',
      bulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
      check: '<path d="M20 6 9 17l-5-5"/>',
      alert: '<path d="M12 6v8"/><path d="M12 19h.01"/>',
      chev: '<path d="m6 9 6 6 6-6"/>',
      merge: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9h3"/>',
      close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
      folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
      copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
      // ── session category glyphs (see GLYPHES) ────────────────────────────
      wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
      bug: '<path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M6.53 15C4.6 15.2 3 16.9 3 19"/><path d="M17.47 9c1.93-.2 3.53-1.9 3.53-4"/><path d="M18 13h4"/><path d="M17.47 15c1.93.2 3.53 1.9 3.53 4"/>',
      palette: '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
      plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
      chart: '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>',
      broom: '<path d="M14 10 21 3"/><path d="m9 8 7 7-2.2 2.2A4 4 0 0 1 11 18.4L4 20l1.6-7a4 4 0 0 1 1.2-2.8z"/><path d="m9.6 13.6-1.5 6.8"/><path d="m12.6 16.6-1.4 4.2"/>',
      help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
      // A speech bubble for a session no category could be given to: a chat is a conversation, whatever else it is. (The dot it
      // replaces read as « no icon was created »; the '?' help-circle before it read as an error.) `chatq` is the QUESTION
      // category: the same bubble with a question mark inside, so the two are never confused.
      chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
      chatq: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
      point: '<circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>'
    }
    const svg = (n, size, sw) => h('svg', {
      width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
      strokeWidth: sw || 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
      dangerouslySetInnerHTML: { __html: ICONS[n] }
    })

    // ── category icon before the title of a session ────────────────────────
    // The title of a session starts with a category glyph (naming rule:
    // 🛠️ feature, 🐛 fix, 🎨 UI/design, 📚 doc, 🔌 integration, 📊 data,
    // 🧹 cleanup, ❓ question). In the list, this glyph is not rendered as a
    // character: it becomes a real SVG, tinted by category. The glyph stays in
    // the title itself (it classifies the session everywhere: search, export,
    // other clients) and it is here that it is hidden — the DSH shell exposes no
    // slot for the header of a session row, so the decoration is done on the
    // rendered DOM.
    const GLYPHES = {
      '\u{1F6E0}': 'wrench', // 🛠 feature
      '\u{1F41B}': 'bug', // 🐛 fix
      '\u{1F3A8}': 'palette', // 🎨 UI/design
      '\u{1F4DA}': 'book', // 📚 doc
      '\u{1F50C}': 'plug', // 🔌 integration
      '\u{1F4CA}': 'chart', // 📊 data
      '\u{1F9F9}': 'broom', // 🧹 cleanup
      '\u{2753}': 'chatq' // ❓ question
    }
    // The word a category icon carries (its aria-label and tooltip): English is the base, kept in `data-mot`; the French twin is in MOTS_FR.
    const MOTS_GLYPHE = {
      '\u{1F6E0}': 'Feature', '\u{1F41B}': 'Fix', '\u{1F3A8}': 'UI/design',
      '\u{1F4DA}': 'Documentation', '\u{1F50C}': 'Integration', '\u{1F4CA}': 'Data',
      '\u{1F9F9}': 'Cleanup', '\u{2753}': 'Question'
    }
    // The colour no longer says the category (the shape does) but the state
    // of the work: grey by default, green when the work is committed.
    // What a row carries whose title is not classified yet: the icon is
    // there from the first naming, the category will come with the re-titling.
    const CATEGORIE_DEFAUT = { ico: 'chat', mot: 'Uncategorised' }
    // ── language: English is the base, French the twin (decision D1) ───────
    // The mark of a row says its category and whether its work is committed, and the « Kybernos Settings » block says its
    // labels, in the language of the interface: `kt(fr, en)` gives the French side for French (`kybernos` or an fr* tag)
    // and the English side for everything else; a translated language (es, ar…) is looked up by its French text in the
    // dictionary the language layer serves, and falls back to English. A resolver that throws or is absent gives English.
    const lang = () => {
      try { return String(typeof window.__KB_LANG_RESOLVE__ === 'function' ? window.__KB_LANG_RESOLVE__() : (document.documentElement.lang || 'en')) } catch (e) { return 'en' }
    }
    const kt = (fr, en) => {
      const l = lang()
      if (l === 'kybernos' || l.slice(0, 2) === 'fr') return fr
      if (l === 'en') return en
      try {
        const a = window.__KB_I18N_ACTIVE__
        if (a !== null && a !== undefined && a.dict !== null && typeof a.dict === 'object' && typeof a.dict[fr] === 'string') return a.dict[fr]
      } catch (e) { /* no dictionary: English */ }
      return en
    }
    const MOTS_FR = {
      Uncategorised: 'Non classé', Feature: 'Fonctionnalité', Fix: 'Correctif', 'UI/design': 'UI/design', Documentation: 'Documentation',
      Integration: 'Intégration', Data: 'Données', Cleanup: 'Nettoyage', Question: 'Question', Category: 'Catégorie'
    }
    const motAffiche = (en) => kt(MOTS_FR[en] !== undefined ? MOTS_FR[en] : en, en)
    const TEINTE_GRISE = 'var(--dsw-alias-label-tertiary,#8a9096)'
    const TEINTE_VERTE = 'var(--dsw-alias-state-success-primary,#22c55e)'
    const SVG_GLYPHE = (n, size) => '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24"' +
      ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"' +
      ' stroke-linejoin="round" aria-hidden="true">' + ICONS[n] + '</svg>'

    // First grapheme of the title, reduced to its category — without the variation
    // selector (🛠️ = U+1F6E0 U+FE0F) which is not part of the glyph.
    const glypheDe = (texte) => {
      if (typeof texte !== 'string' || texte.length === 0) return null
      let graphe = null
      try {
        if (typeof Intl !== 'undefined' && Intl.Segmenter) {
          const it = new Intl.Segmenter('fr', { granularity: 'grapheme' }).segment(texte)[Symbol.iterator]().next()
          if (!it.done) graphe = it.value.segment
        }
      } catch (e) { graphe = null }
      if (graphe === null || graphe === undefined) graphe = Array.from(texte)[0] || null
      if (graphe === null) return null
      const base = graphe.replace(/[\uFE0E\uFE0F]/g, '')
      if (GLYPHES[base] === undefined) return null
      return { graphe: graphe, ico: GLYPHES[base], mot: MOTS_GLYPHE[base] }
    }

    const noeudTexte = (el) => {
      const enfants = el.childNodes || []
      for (let i = 0; i < enfants.length; i++) if (enfants[i].nodeType === 3) return enfants[i]
      return null
    }

    // ── session categories: the title no longer carries an emoji ────────────
    // The naming (~/.dsh/tools/session-titre.mjs) no longer writes a pictogram
    // into the title: it files the category in the host's registry
    // (~/.dsh/kybernos/categories.json), indexed by session id. The session
    // row carries `data-row-key="session:<id>"`, so the match is EXACT — no
    // guessing on the text of the title. Titles still prefixed with an emoji
    // (sessions named before this change) stay recognised: the pictogram is the
    // fallback, and it is always removed from the rendered text. (The slugs are
    // the host's, decision.mjs; the word is English, its French twin is in MOTS_FR.)
    const CATEGORIE_PAR_SLUG = {
      fonctionnalite: { ico: 'wrench', mot: 'Feature' },
      correctif: { ico: 'bug', mot: 'Fix' },
      ui: { ico: 'palette', mot: 'UI/design' },
      doc: { ico: 'book', mot: 'Documentation' },
      integration: { ico: 'plug', mot: 'Integration' },
      donnees: { ico: 'chart', mot: 'Data' },
      nettoyage: { ico: 'broom', mot: 'Cleanup' },
      question: { ico: 'chatq', mot: 'Question' }
    }
    const CLE_CATEGORIES = 'kybernos.sessions.categories.v1'
    let CATEGORIES = {} // sessionId → slug
    let CATEGORIES_AUTO = {} // sessionId → true when the category comes from the automatic classification
    let CATEGORIES_LUES = 0

    const lireCategoriesCache = () => {
      try {
        if (typeof localStorage === 'undefined' || localStorage === null) return
        const brut = localStorage.getItem(CLE_CATEGORIES)
        if (!brut) return
        const o = JSON.parse(brut)
        if (o !== null && typeof o === 'object') CATEGORIES = o
      } catch (e) { /* unreadable cache: start again from the registry */ }
    }

    const lireCategories = async () => {
      if (typeof fetch !== 'function') return
      if (CATEGORIES_LUES !== 0 && Date.now() - CATEGORIES_LUES < 5000) return
      try {
        const r = await fetch('/kybernos-sessions/categories')
        if (!r || r.ok !== true) return
        const j = await r.json()
        if (!j || j.categories === null || typeof j.categories !== 'object') return
        const map = {}
        const autos = {}
        for (const id of Object.keys(j.categories)) {
          const e = j.categories[id]
          if (e !== null && typeof e === 'object' && CATEGORIE_PAR_SLUG[e.cat] !== undefined) { map[id] = e.cat; autos[id] = e.auto === true }
        }
        CATEGORIES = map
        CATEGORIES_AUTO = autos
        CATEGORIES_LUES = Date.now()
        try {
          if (typeof localStorage !== 'undefined' && localStorage !== null) localStorage.setItem(CLE_CATEGORIES, JSON.stringify(map))
        } catch (e) { /* quota: no matter */ }
      } catch (e) { /* registry unreachable: fall back on the pictogram */ }
    }

    // Session id read from the row (`data-row-key="session:<id>"`).
    const idDeLigne = (ligne) => {
      if (ligne === null || ligne === undefined || typeof ligne.getAttribute !== 'function') return ''
      const cle = String(ligne.getAttribute('data-row-key') || '')
      const i = cle.indexOf('session:')
      if (i !== -1) return cle.slice(8)
      // A row of the Pinned section (kybernos-plugin): a session row, same id, other attribute.
      return String(ligne.getAttribute('data-kbpin-kind') || '') === 'session' ? String(ligne.getAttribute('data-kbpin-id') || '') : ''
    }

    // Category of a row: the REGISTRY first, the pictogram of the title as
    // a fallback (sessions named before the emoji was removed).
    const categorieDeLigne = (ligne, legacy) => {
      const slug = CATEGORIES[idDeLigne(ligne)]
      if (slug !== undefined && CATEGORIE_PAR_SLUG[slug] !== undefined) return CATEGORIE_PAR_SLUG[slug]
      return legacy
    }

    // ── automatic classification of the initial title: the SVG from the first naming ─
    // The engine names the chat from the first message; with no recorded category,
    // the row keeps its « uncategorised » icon until an agent sets --cat.
    // The page therefore does the work itself: the title goes to the decision route (/kybernos-sessions/decision), where
    // the word rules answer first and the Study model only when they say nothing, and a settled verdict is recorded with
    // `auto:true`. An agent's naming (POST without `auto`) always replaces it, and is never re-classified here.
    const CLE_AUTOCAT = 'kybernos.sessions.autocat.v1'
    const DUREE_REESSAI_AUTOCAT = 10 * 60 * 1000 // a negative verdict is retried after 10 min, or if the title changes
    let AUTOCAT = {} // sessionId → { titre, slug (null = undecided verdict), ts }
    let AUTOCAT_FILE = [] // pending decisions — one request at a time
    let AUTOCAT_EN_COURS = false

    const lireAutocatCache = () => {
      try {
        if (typeof localStorage === 'undefined' || localStorage === null) return
        const brut = localStorage.getItem(CLE_AUTOCAT)
        if (!brut) return
        const o = JSON.parse(brut)
        if (o !== null && typeof o === 'object') AUTOCAT = o
      } catch (e) { /* unreadable cache: we classify again, no harm */ }
    }

    const ecrireAutocatCache = () => {
      try {
        if (typeof localStorage === 'undefined' || localStorage === null) return
        localStorage.setItem(CLE_AUTOCAT, JSON.stringify(AUTOCAT))
      } catch (e) { /* quota: no matter */ }
    }

    // Already answered for THIS title, and does the answer still hold? (a positive one for
    // good, a negative one until the retry.)
    const autocatResolu = (id, titre) => {
      const cache = AUTOCAT[id]
      if (cache === undefined || cache === null) return false
      if (String(cache.titre || '') !== titre) return false
      return cache.slug !== null || (Date.now() - Number(cache.ts || 0)) < DUREE_REESSAI_AUTOCAT
    }

    const classerUneAutomatique = async (entree) => {
      const { id, titre, ligne } = entree
      if (CATEGORIES[id] !== undefined && CATEGORIES_AUTO[id] !== true) return // an agent's naming: untouchable
      if (autocatResolu(id, titre) === true) return
      const r = await fetch('/kybernos-sessions/decision', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ categorie: titre }) })
      if (!r || r.ok !== true) throw new Error('decision HTTP ' + (r ? r.status : '?'))
      const v = await r.json()
      // `choisi`: the Study model settled it; `local`: the host classified it from the words of the title.
      const slug = (v !== null && typeof v === 'object' && v.ok === true && (v.motif === 'choisi' || v.motif === 'local') && CATEGORIE_PAR_SLUG[v.categorie] !== undefined) ? v.categorie : null
      AUTOCAT[id] = { titre, slug, ts: Date.now() }
      ecrireAutocatCache()
      if (slug === null) return // not sure (or no Study model): the provisional icon stays, a retry is planned
      const w = await fetch('/kybernos-sessions/categories', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session: id, cat: slug, titre, auto: true }) })
      if (!w || w.ok !== true) return // the registry refuses: retried on the next cycle
      CATEGORIES[id] = slug
      CATEGORIES_AUTO[id] = true
      try { if (ligne !== null && ligne !== undefined && ligne.isConnected === true) iconeDeLigne(ligne) } catch (e) { /* row rendered in the meantime: the next pass will paint it */ }
    }

    const pomperAutocat = () => {
      if (AUTOCAT_EN_COURS === true) return
      if (typeof document === 'undefined' || document.hidden === true) return
      if (typeof fetch !== 'function' || typeof localStorage === 'undefined' || localStorage === null) return
      const lignes = document.querySelectorAll('[class*="sessionRow"]')
      for (let i = 0; i < lignes.length; i++) {
        if (AUTOCAT_FILE.length >= 12) break // twelve decisions per pass (400 ms apart), never a burst
        const ligne = lignes[i]
        const el = ligne.querySelector('[class*="title"]')
        if (el === null || el === undefined) continue
        const provisoire = el.querySelector('.kbs-titre-ico[data-provisoire="1"]')
        const id = idDeLigne(ligne)
        if (id === '') continue
        if (CATEGORIES[id] !== undefined && CATEGORIES_AUTO[id] !== true) continue
        const texte = String(el.textContent || '').trim()
        if (texte.length < 4) continue // title still empty or a welcome one
        if (provisoire === null || provisoire === undefined) {
          // Already classified. It only comes back if the category comes from this page's AUTOMATIC classification and the title has
          // changed since (the engine re-titles after the recap: « Greeting » becomes the real subject).
          const avant = AUTOCAT[id]
          if (!(CATEGORIES_AUTO[id] === true && avant !== undefined && avant !== null && String(avant.titre || '') !== texte)) continue
        }
        if (autocatResolu(id, texte) === true) continue
        AUTOCAT_FILE.push({ id, titre: texte, ligne })
      }
      if (AUTOCAT_FILE.length === 0) return
      AUTOCAT_EN_COURS = true
      const suivante = async () => {
        const entree = AUTOCAT_FILE.shift()
        if (entree === undefined || entree === null) { AUTOCAT_EN_COURS = false; return }
        try { await classerUneAutomatique(entree) } catch (e) { /* host unreachable: retried at the next cycle */ }
        if (typeof setTimeout === 'function') setTimeout(suivante, 400)
        else suivante()
      }
      suivante()
    }

    // ── state of the work: is the session's work committed? ───────
    // The list of the sessions and the journal of each are readable through the
    // harness API (the routes the GUI itself uses). We look in them for the
    // last gesture of the session that touches its folder:
    //   • a successful commit (or merge)        → green;
    //   • a write in the folder                  → grey (work in progress);
    //   • nothing conclusive in the window read  → grey (the default).
    // The verdict is memoised per session and recomputed when its revision
    // (`updatedAt`) changes, so an ordinary cycle only re-reads the sessions
    // that have just moved.
    const OUTILS_ECRITURE = { write: 1, edit: 1, multiedit: 1, multi_edit: 1, apply_patch: 1, str_replace: 1, notebook_write: 1, notebook_edit: 1 }
    // Shell redirection: `> file`, `>> "my file"`. The negative lookahead
    // drops what is NOT a file — `2>&1`, `> =`, and above all the
    // comparisons of the code passed to `node -e '… if (i > 0) …'`. The prefix
    // excludes `=` so as not to read the `=>` arrow of a function as a
    // redirection vers un chemin relatif.
    const ECRITURE_BASH = /(^|[^|&>=])>{1,2}\s*(?![0-9=&])(?:"[^"]*"|'[^']*'|[^\s;|&)]+)|\btee\b|\bsed -i|\bcp\b|\bmv\b|\brm\b|\bmkdir\b|\bgit add\b|\bgit apply\b|\bpatch -p/
    // The BODY of a heredoc is data, not shell: `cat > /tmp/x.mjs
    // <<'EOF'` followed by JavaScript code must not be re-read as a series
    // of redirections. These bodies are removed before the command is analysed.
    const sansHeredoc = (cmd) => {
      const lignes = String(cmd).split('\n')
      const gardees = []
      let fin = null
      for (let i = 0; i < lignes.length; i++) {
        const l = lignes[i]
        if (fin !== null) { if (l.trim() === fin) fin = null; continue }
        const m = /<<-?\s*(?:"([^"]*)"|'([^']*)'|([A-Za-z_][A-Za-z0-9_]*))/.exec(l)
        gardees.push(l)
        if (m !== null) fin = m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3])
      }
      return gardees.join('\n')
    }
    // Visible targets of the redirections of a command (`> /tmp/x.mjs`).
    const ciblesRedirection = (cmd) => {
      const re = /(^|[^|&>=])>{1,2}\s*(?![0-9=&])("[^"]*"|'[^']*'|[^\s;|&)]+)/g
      const out = []
      let m = re.exec(cmd)
      while (m !== null) { out.push(String(m[2]).replace(/^["']|["']$/g, '')); m = re.exec(cmd) }
      return out
    }
    // A shell write INSIDE the folder, not only a command that
    // MENTIONS it: `cd <folder> && cat > /tmp/script.mjs` does not open the
    // work. RELATIVE targets run in the command's workdir
    // — the harness default being the work's folder, they count;
    // an explicit workdir outside the folder, or redirections that are all
    // absolute and outside the folder, rule the write out.
    const ecritureBashDansDossier = (cmd, dossier, wd) => {
      const rep = String(wd || '')
      if (rep !== '' && rep !== dossier && rep.indexOf(dossier + '/') !== 0) return false
      const utile = sansHeredoc(cmd)
      if (ECRITURE_BASH.test(utile) === false) return false
      const cibles = ciblesRedirection(utile)
      if (cibles.length > 0 && cibles.every((c) => c.charAt(0) === '/' && dansDossier(c, dossier) === false)) return false
      return true
    }
    // `git commit` can be preceded by global options (`-c key=value`, `-C dir`,
    // `--no-pager`): `git -c user.name=me commit` was NOT recognised, so a
    // piece of work that was committed stayed shown as « not saved ». And `\bgit merge\b`
    // matched `git merge-base` — a plain ancestry read passed for a
    // commit, which closed the work wrongly. One expression, two false
    // verdicts, in both directions.
    const COMMIT_BASH = /\bgit(?:\s+(?:-c\s+\S+|-C\s+\S+|--?[A-Za-z][\w-]*(?:=\S+)?))*\s+(?:commit|merge|cherry-pick)\b(?!-)|\bgit rebase --continue\b/
    const ANNULATION_BASH = /\bgit (checkout --|restore\b|stash\b|reset\b)/
    // v4: the memo now follows `asOfSeq` as well as `updatedAt` — the key
    // changes so that the verdicts already cached are recomputed once.
    const CLE_CACHE = 'kybernos.sessions.commits.v4'
    const CACHE_ETATS = new Map() // titre nu → { id, updatedAt, fait, quoi }
    // Window of the journal read when the state of a session is judged.
    // It was 24 messages: a commit followed by a lot of activity that
    // writes nothing (reads, greps, tests) left the window and the row
    // fell back to grey although the work WAS committed. We now read
    // the same window as `lireJournalSession` — the classification does not change,
    // only the depth of the read does.
    const JOURNAL_LU = 400
    let LISTE = { t: 0, items: [] }

    // The recorded title carries its glyph (🎨 …), the one rendered in the row
    // no longer does: we compare the two in the same form.
    const titreNu = (texte) => String(texte === null || texte === undefined ? '' : texte)
      .replace(/^[\p{Extended_Pictographic}\uFE0E\uFE0F\u200D\s]+/u, '')
      .replace(/\s+/g, ' ')
      .trim()

    const appelApi = async (methode, args) => {
      if (typeof fetch !== 'function') return null
      try {
        const r = await fetch('/api/' + methode, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            type: 'client-request',
            rpcId: (typeof crypto !== 'undefined' && crypto !== null && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
            method: methode,
            payload: { args: args }
          })
        })
        if (!r || r.ok !== true) return null
        const o = await r.json()
        return o && o.result && o.result.ok === true ? o.result.value : null
      } catch (e) { return null }
    }

    // Do the paths a command names fall inside the folder of the
    // session? Outside the folder (throwaway scripts in /tmp, for example) a
    // write does not concern the work.
    const dansDossier = (texte, dossier) => {
      if (dossier === '' || dossier === undefined) return true
      const chemins = String(texte).match(/\/[A-Za-z0-9._/-]{3,}/g) || []
      for (let i = 0; i < chemins.length; i++) {
        if (chemins[i] === dossier || chemins[i].indexOf(dossier + '/') === 0) return true
      }
      return false
    }

    // Verdict of each call, indexed by callId (a failed `tool/result`
    // carries `[exit code: N]`). Used by the classification of the journal AND by the reading
    // of the memory gestures.
    const resultatsAppels = (events) => {
      const resultats = new Map()
      for (let i = 0; i < events.length; i++) {
        const e = events[i]
        if (e.type !== 'tool/result') continue
        const src = ((e.data || {}).message || {}).source || {}
        if (src.callId) resultats.set(src.callId, /\[exit code: [1-9]/.test(JSON.stringify(e.data || {})) ? 'echec' : 'ok')
      }
      return resultats
    }

    const argsAppel = (d) => {
      try { return JSON.parse(d.arguments || '{}') } catch (err) { return {} }
    }

    // Classifies the journal of a session: the first gesture that counts, going
    // from the end, decides. A pure function — tested outside the browser.
    // `ecritures` counts the write gestures INSIDE the folder since the
    // last commit: it is the unsaved work of THIS session, as
    // opposed to the state of the folder (which other chats share).
    const classerJournal = (events, dossier) => {
      const resultats = resultatsAppels(events)
      let ecritures = 0
      const chemins = []
      let commit = false
      for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i]
        if (e.type !== 'tool/call') continue
        const d = e.data || {}
        const nom = String(d.name || '')
        const args = argsAppel(d)
        const cmd = String(args.command || '')
        // A heredoc can CONTAIN « git commit »: only the command is judged.
        const utile = nom === 'bash' ? sansHeredoc(cmd) : ''
        if (nom === 'bash' && COMMIT_BASH.test(utile)) {
          // A commit run FROM the work's folder is a commit OF the
          // work — even with no absolute path in the text: `git add … &&
          // git commit` via workdir (the harness default IS the session's
          // folder) was invisible, and all the work stayed shown as
          // « not saved ». Three ways to point at ANOTHER folder:
          // `--workdir`, `git -C <ailleurs>`, et `cd <ailleurs> && git commit`.
          // Only an ABSOLUTE path is informative: a relative `cd .` or `-C .`
          // says nothing and is still counted as the work.
          const absolu = (p) => p !== undefined && p !== '' && p.charAt(0) === '/'
          const wd = String(args.workdir || '')
          const gitC = (/(?:^|\s)-C\s+(\S+)/.exec(utile) || [])[1]
          const cd = (/^\s*cd\s+([^\s&;|]+)/.exec(utile) || [])[1]
          const effectif = absolu(wd) ? wd : (absolu(gitC) ? gitC : (absolu(cd) ? cd : ''))
          if (effectif !== '' && effectif !== dossier && effectif.indexOf(dossier + '/') !== 0) continue
          commit = resultats.get(d.callId) !== 'echec'
          break
        }
        if (nom === 'bash' && ANNULATION_BASH.test(utile)) continue
        const outil = OUTILS_ECRITURE[nom] === 1 || OUTILS_ECRITURE[nom.replace(/^mcp__[a-z0-9_]*__/, '')] === 1
        if (outil) {
          const chemin = String(args.file_path || args.path || '')
          if (chemin === '' || dansDossier(chemin, dossier)) {
            ecritures += 1
            if (chemin !== '' && chemins.indexOf(chemin) === -1 && chemins.length < 50) chemins.push(chemin)
          }
          continue
        }
        if (nom === 'bash' && ecritureBashDansDossier(cmd, dossier, String(args.workdir || ''))) ecritures += 1
      }
      const verdict = (quoi) => ({ fait: quoi === 'commit', quoi: quoi, ecritures: ecritures, chemins: chemins })
      if (commit && ecritures === 0) return verdict('commit')
      if (commit) return verdict('write after a commit')
      return verdict(ecritures > 0 ? 'write' : 'nothing conclusive')
    }

    // ── memory written INSIDE this session ───────────────────────────────────
    // The kyber-memory protocol written by `memory.cjs` (record / lesson /
    // used). These calls are read in the session's journal: it is the only
    // source that says what THIS session wrote or updated in memory,
    // as opposed to the agent team's ledger — which adds up all the
    // sessions of the machine.
    const SOUS_COMMANDES_MEMOIRE = { record: 1, lesson: 1, used: 1 }

    // Splits a shell command into tokens, respecting the quotes (the
    // notes and the lessons contain some).
    const jetons = (cmd) => {
      const mots = []
      const re = /"([^"]*)"|'([^']*)'|(\S+)/g
      let m = re.exec(cmd)
      while (m !== null) {
        mots.push(m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3]))
        m = re.exec(cmd)
      }
      return mots
    }

    const flagDe = (mots, nom) => {
      const i = mots.indexOf('--' + nom)
      if (i >= 0 && i + 1 < mots.length) return mots[i + 1]
      const prefixe = '--' + nom + '='
      for (let k = 0; k < mots.length; k++) if (mots[k].indexOf(prefixe) === 0) return mots[k].slice(prefixe.length)
      return null
    }

    // A pure function: the memory gestures of a session journal.
    const memoireDuJournal = (events) => {
      const resultats = resultatsAppels(events)
      const entrees = []
      for (let i = 0; i < events.length; i++) {
        const e = events[i]
        if (e.type !== 'tool/call') continue
        const d = e.data || {}
        if (String(d.name || '') !== 'bash') continue
        const cmd = String(argsAppel(d).command || '')
        if (cmd.indexOf('memory.cjs') === -1) continue
        const mots = jetons(cmd)
        let sous = null
        for (let j = 0; j < mots.length && sous === null; j++) {
          if (mots[j].indexOf('memory.cjs') === -1) continue
          for (let k = j + 1; k < mots.length && k < j + 9; k++) {
            if (SOUS_COMMANDES_MEMOIRE[mots[k]] === 1) { sous = mots[k]; break }
            if (mots[k].indexOf('--') !== 0) break
          }
        }
        if (sous === null) continue
        entrees.push({
          type: sous,
          ts: e.time ? new Date(e.time).toISOString() : null,
          kyber: flagDe(mots, 'kyber') || '',
          role: flagDe(mots, 'role') || '',
          outcome: flagDe(mots, 'outcome') || '',
          note: flagDe(mots, 'note') || '',
          text: flagDe(mots, 'text') || '',
          tags: (flagDe(mots, 'tags') || '').split(',').map((s) => s.trim()).filter((s) => s !== ''),
          index: flagDe(mots, 'index'),
          ok: resultats.get(d.callId) !== 'echec'
        })
      }
      // The two tools of the memory plugins write the same things as memory.cjs, by another door: a
      // lesson (`lesson_write`, @local/kybernos-memory) joins the lessons of this chat; an account memory
      // (`memory_write`, @local/kybernos-cloud) is listed apart — it is not a kyber ledger entry.
      const souvenirs = []
      for (let i = 0; i < events.length; i++) {
        const e = events[i]
        if (e.type !== 'tool/call') continue
        const d = e.data || {}
        const nom = String(d.name || '')
        if (nom !== 'lesson_write' && nom !== 'memory_write') continue
        const a = argsAppel(d)
        const ts = e.time ? new Date(e.time).toISOString() : null
        if (nom === 'lesson_write') {
          entrees.push({ type: 'lesson', ts, kyber: typeof a.kyber === 'string' && a.kyber !== '' ? a.kyber : 'default', role: '', outcome: '', note: '', text: String(a.text || ''),
            tags: Array.isArray(a.tags) ? a.tags.map((t) => String(t)) : [], index: null, ok: resultats.get(d.callId) !== 'echec' })
        } else {
          souvenirs.push({ ts, kind: String(a.kind || ''), text: String(a.content || ''), pinned: a.pinned === true })
        }
      }
      const kybers = []
      for (let i = 0; i < entrees.length; i++) {
        if (entrees[i].kyber !== '' && kybers.indexOf(entrees[i].kyber) === -1) kybers.push(entrees[i].kyber)
      }
      const garde = (t) => entrees.filter((x) => x.type === t && x.ok === true)
      return { entrees, kybers, records: garde('record'), lessons: garde('lesson'), used: garde('used'), souvenirs }
    }

    // ── journal of the current session (what THIS session did) ───────
    // Read through the harness API, as the list of sessions is: no
    // extra host route, so no server restart.
    // The list carries the `updatedAt` that decides whether a row must be re-read:
    // kept for 2 minutes, it made a committed row wait until the
    // next cycle (a green icon several minutes late). 20 s is enough to
    // avoid the hail of calls, and the 30 s pass then re-reads every
    // row within half a minute at the latest.
    const listerSessions = async (maintenant) => {
      if (LISTE.items.length === 0 || maintenant - LISTE.t > 20000) {
        const v = await appelApi('session/list', { _request: {} })
        if (v && Array.isArray(v.items)) LISTE = { t: maintenant, items: v.items }
      }
      return LISTE.items
    }

    const lireJournalSession = async (sessionId) => {
      const id = String(sessionId || '')
      if (id === '') return null
      const items = await listerSessions(Date.now())
      const nu = id.replace(/^session-/, '')
      let it = null
      for (let i = 0; i < items.length; i++) {
        const x = items[i]
        if (String((x && x.sessionId) || '').replace(/^session-/, '') === nu) { it = x; break }
      }
      if (it === null) return null
      const seq = ((it.projections || {}).asOfSeq) || 0
      const v = await appelApi('session/page', { request: { address: { kind: 'session', sessionId: it.sessionId }, throughSeq: seq, maxMessages: JOURNAL_LU } })
      const records = v && Array.isArray(v.records) ? v.records : []
      const events = []
      for (let i = 0; i < records.length; i++) if (records[i] && records[i].event) events.push(records[i].event)
      return { events, cwd: String(it.cwd || '') }
    }

    const lireCache = () => {
      try {
        if (typeof localStorage === 'undefined' || localStorage === null) return
        const brut = localStorage.getItem(CLE_CACHE)
        if (!brut) return
        const o = JSON.parse(brut)
        for (const t of Object.keys(o)) if (CACHE_ETATS.has(t) === false) CACHE_ETATS.set(t, o[t])
      } catch (e) { /* unreadable cache: we start from zero */ }
    }

    const ecrireCache = () => {
      try {
        if (typeof localStorage === 'undefined' || localStorage === null) return
        const o = {}
        let n = 0
        CACHE_ETATS.forEach((v, k) => { if (n < 200) { o[k] = v; n++ } })
        localStorage.setItem(CLE_CACHE, JSON.stringify(o))
      } catch (e) { /* quota: no matter */ }
    }

    // Paints an icon according to the known state of the work.
    const peindre = (marque, fait) => {
      if (marque.getAttribute('data-fait') === (fait ? '1' : '0')) return false
      marque.setAttribute('data-fait', fait ? '1' : '0')
      marque.setAttribute('style', '--kbs-ico:' + (fait ? TEINTE_VERTE : TEINTE_GRISE))
      marque.setAttribute('class', 'kbs-titre-ico' + (fait ? ' kbs-titre-ico--fait' : ''))
      const mot = motAffiche(marque.getAttribute('data-mot') || 'Category')
      const etat = fait ? kt('travail committé', 'work committed') : kt('travail non committé', 'work not committed')
      marque.setAttribute('aria-label', mot + ' — ' + etat)
      marque.setAttribute('title', mot + ' — ' + etat)
      return true
    }

    const appliquerTeintes = () => {
      if (typeof document === 'undefined') return 0
      const lignes = document.querySelectorAll('[class*="sessionRow"]')
      let n = 0
      for (let i = 0; i < lignes.length; i++) {
        const el = lignes[i].querySelector('[class*="title"]')
        if (el === null || el === undefined) continue
        const marque = el.querySelector('.kbs-titre-ico')
        if (marque === null || marque === undefined) continue
        const etat = CACHE_ETATS.get(titreNu(el.textContent || ''))
        if (peindre(marque, etat !== undefined && etat.fait === true)) n++
      }
      return n
    }

    const etatSession = (titre) => CACHE_ETATS.get(titreNu(titre)) || null

    // ── chat list: the DEFAULT display ────────────────────────────
    // Rule decided on 2026-09-21: by default the chat menu only shows
    // the chats whose work is NOT committed (the grey icon), capped at
    // 6 rows; never fewer than 2 rows, and the open row always stays
    // visible. Expanding the group (« Show N more sessions ») lifts the filter:
    // it is the only gesture that shows everything.
    const LIGNES_MAX = 6
    const LIGNES_MIN = 2
    const CLE_VU = 'data-kbv'
    // The « Show N more » gesture is NOT read in `aria-expanded`: DSH only sets it
    // to true at the LAST notch (when its limit becomes infinite). With
    // 99 hidden chats it takes nineteen clicks for the filter to deign to
    // lift — and meanwhile every click adds 5 rows that the filter hides again
    // at once: the user clicks and nothing happens. So we remember the
    // GESTURE on the section itself (`data-kbs-tout`), set by the click.
    const CLE_TOUT = 'data-kbs-tout'

    // A pure function — tested outside the browser (check-kybernos-session-icones).
    // Input: the rows of ONE group, in rendered order, `{ fait, ouvert }`.
    // `fait` = work committed; `null` = state not known yet, and we never
    // hide on ignorance (the row stays visible).
    // Output: the indexes to keep, in rendered order.
    const choisirLignes = (lignes) => {
      const n = lignes.length
      const garder = []
      const dedans = new Set()
      const ajouter = (i) => { if (i >= 0 && i < n && dedans.has(i) === false) { dedans.add(i); garder.push(i) } }
      for (let i = 0; i < n; i++) if (lignes[i].ouvert === true) ajouter(i)
      for (let i = 0; i < n && garder.length < LIGNES_MAX; i++) if (lignes[i].fait !== true) ajouter(i)
      for (let i = 0; i < n && garder.length < Math.min(LIGNES_MIN, n); i++) ajouter(i)
      garder.sort((a, b) => a - b)
      return garder
    }

    // The group section of a row: its nearest `groupSection` ancestor
    // (shell structure, checked for real):
    //   div.groupSection > [span(div.projectRow), span(div.sessionRow)…, button.sessionOverflow…]
    // Like `sessionRow` and `title`, the name is hashed by the DSH bundler: we
    // match the suffix, and if DSH renames it one day, the filter stops
    // applying instead of hiding at random. `parentNode` (not
    // `parentElement`): it is the only one of the two the test harness DOM exposes.
    const sectionDeLigne = (ligne) => {
      let p = ligne.parentNode
      while (p !== null && p !== undefined) {
        if (String(p.className || '').indexOf('groupSection') !== -1) return p
        p = p.parentNode
      }
      return null
    }

    const titreDeLigne = (ligne) => {
      const el = ligne.querySelector('[class*="title"]')
      return el === null || el === undefined ? '' : titreNu(el.textContent || '')
    }

    // State of THIS row: committed (true), in progress (false), unknown (null).
    const etatDeLigne = (ligne) => {
      const e = CACHE_ETATS.get(titreDeLigne(ligne))
      return e === undefined ? null : e.fait
    }

    const ligneOuverte = (ligne) => String(ligne.className || '').indexOf('selected') !== -1

    // Applies the rule to every rendered section. Returns the number of
    // rows whose visibility changed (0 = nothing to do, no write).
    const filtrerListe = () => {
      if (typeof document === 'undefined') return 0
      const lignes = document.querySelectorAll('[class*="sessionRow"]')
      if (lignes.length === 0) return 0
      const groupes = new Map()
      for (let i = 0; i < lignes.length; i++) {
        const section = sectionDeLigne(lignes[i])
        // Outside a project section (flat list, search results):
        // the rule does not apply — those lists show everything.
        if (section === null || section === undefined) continue
        if (groupes.has(section) === false) groupes.set(section, [])
        groupes.get(section).push(lignes[i])
      }
      const sections = []
      groupes.forEach((rows, section) => sections.push([section, rows]))
      let n = 0
      for (let s = 0; s < sections.length; s++) {
        const section = sections[s][0]
        const rows = sections[s][1]
        const bouton = section.querySelector('[class*="sessionOverflowButton"]')
        // Group expanded: the filter is lifted (« Show N more » = see all). Two
        // sources: DSH announces it (last notch, aria-expanded) or the user
        // clicked the button of THIS group (CLE_TOUT, set by surClicDeplier —
        // without it, the 5 rows expanded by a click stayed hidden).
        const deplie = (bouton !== null && bouton !== undefined && bouton.getAttribute('aria-expanded') === 'true') ||
          section.getAttribute(CLE_TOUT) === '1'
        let garder = null
        if (deplie === false) {
          const etats = []
          for (let i = 0; i < rows.length; i++) etats.push({ fait: etatDeLigne(rows[i]), ouvert: ligneOuverte(rows[i]) })
          garder = choisirLignes(etats)
        }
        for (let i = 0; i < rows.length; i++) {
          const vu = (garder !== null && garder.indexOf(i) === -1) ? '0' : '1'
          if (rows[i].getAttribute(CLE_VU) === vu) continue
          rows[i].setAttribute(CLE_VU, vu)
          n++
        }
      }
      return n
    }

    const rafraichirEtats = async () => {
      if (typeof document === 'undefined' || typeof fetch !== 'function') return 0
      if (document.hidden === true) return 0
      const lignes = document.querySelectorAll('[class*="sessionRow"]')
      if (lignes.length === 0) return 0
      const maintenant = Date.now()
      await listerSessions(maintenant)
      if (LISTE.items.length === 0) return 0
      const parTitre = new Map()
      for (let i = 0; i < LISTE.items.length; i++) {
        const it = LISTE.items[i]
        const t = titreNu((((it.projections || {}).values || {}).title) || '')
        if (t !== '' && parTitre.has(t) === false) parTitre.set(t, it)
      }
      let n = 0
      for (let i = 0; i < lignes.length && n < 12; i++) {
        const el = lignes[i].querySelector('[class*="title"]')
        if (el === null || el === undefined) continue
        const titre = titreNu(el.textContent || '')
        if (titre === '') continue
        const it = parTitre.get(titre)
        if (it === undefined || it.parentSessionId) continue
        // The memo is the safeguard: a journal is not re-read for nothing. But
        // `updatedAt` does NOT ADVANCE while the agent works (it only moves on
        // certain actions): a verdict computed early then stayed frozen, and the
        // row kept its grey after a commit. So we ALSO follow the sequence
        // number of the session (`asOfSeq`), which advances at every event.
        const seq = ((it.projections || {}).asOfSeq) || 0
        const deja = CACHE_ETATS.get(titre)
        if (deja !== undefined && deja.updatedAt === it.updatedAt && deja.asOfSeq === seq) continue
        const v = await appelApi('session/page', { request: { address: { kind: 'session', sessionId: it.sessionId }, throughSeq: seq, maxMessages: JOURNAL_LU } })
        const records = v && Array.isArray(v.records) ? v.records : []
        const events = []
        for (let k = 0; k < records.length; k++) if (records[k].event) events.push(records[k].event)
        const c = events.length > 0 ? classerJournal(events, String(it.cwd || '')) : { fait: false, quoi: 'unreadable journal' }
        CACHE_ETATS.set(titre, { id: it.sessionId, updatedAt: it.updatedAt, asOfSeq: seq, fait: c.fait, quoi: c.quoi })
        n++
      }
      if (n > 0) ecrireCache()
      appliquerTeintes()
      filtrerListe()
      return n
    }

    // Renders a row: icon placed before the title, glyph removed from the text.
    // Idempotent — React rewrites the text when the title changes, the glyph
    // then reappears and the next pass hides it again.
    //
    // A title still WITHOUT a pictogram is no longer left bare: from the first
    // naming the row gets the « uncategorised » icon (❓). The pictogram stays
    // the source of the REAL category when it exists, but the icon is
    // placed without it — and replaced as soon as a classified title arrives.
    const elementTitre = (ligne) => ligne.querySelector('.kbpin_open') || ligne.querySelector('[class*="title"]')

    const iconeDeLigne = (ligne) => {
      if (ligne === null || ligne === undefined) return false
      const el = elementTitre(ligne)
      if (el === null || el === undefined) return false
      const noeud = noeudTexte(el)
      const texte = noeud === null ? '' : (noeud.nodeValue || '')
      const legacy = glypheDe(texte)
      const trouve = categorieDeLigne(ligne, legacy)
      const deja = el.querySelector('.kbs-titre-ico')
      if (trouve === null) {
        // No name: nothing to dress (the session has just been created, the
        // first naming has not arrived yet).
        if (String(texte).trim() === '') return false
        if (deja !== null && deja !== undefined) return false
        const provisoire = document.createElement('span')
        provisoire.className = 'kbs-titre-ico'
        provisoire.setAttribute('role', 'img')
        provisoire.setAttribute('data-mot', CATEGORIE_DEFAUT.mot)
        provisoire.setAttribute('data-provisoire', '1')
        provisoire.innerHTML = SVG_GLYPHE(CATEGORIE_DEFAUT.ico, 15)
        if (noeud === null) el.appendChild(provisoire)
        else el.insertBefore(provisoire, noeud)
        const inconnu = etatSession(texte)
        peindre(provisoire, inconnu !== null && inconnu.fait === true)
        return true
      }
      // The pictogram of the title (if one is left) is never rendered: the
      // category is shown as an SVG, not as an emoji.
      const retirerGlyphe = () => { if (legacy !== null && noeud !== null) noeud.nodeValue = texte.slice(legacy.graphe.length) }
      if (deja !== null && deja !== undefined) {
        retirerGlyphe()
        // Category classified on the registry side after a first pass, or title
        // re-classified: the provisional icon gives way to the real category
        // (otherwise the row would keep its ❓ for life).
        if (deja.getAttribute('data-mot') !== trouve.mot) {
          deja.removeAttribute('data-provisoire')
          deja.setAttribute('data-mot', trouve.mot)
          deja.innerHTML = SVG_GLYPHE(trouve.ico, 15)
          const connu = etatSession(texte)
          peindre(deja, connu !== null && connu.fait === true)
          return true
        }
        return false
      }
      const marque = document.createElement('span')
      marque.className = 'kbs-titre-ico'
      marque.setAttribute('role', 'img')
      marque.setAttribute('data-mot', trouve.mot)
      marque.innerHTML = SVG_GLYPHE(trouve.ico, 15)
      if (noeud === null) el.appendChild(marque)
      else { el.insertBefore(marque, noeud); noeud.nodeValue = texte.slice(legacy === null ? 0 : legacy.graphe.length) }
      const connu = etatSession(texte)
      peindre(marque, connu !== null && connu.fait === true)
      return true
    }

    const decorerTitres = () => {
      if (typeof document === 'undefined') return 0
      // The native session rows AND the rows of the Pinned section: one chat, one icon, wherever it is listed.
      const lignes = document.querySelectorAll('[class*="sessionRow"], .kbpin_row[data-kbpin-kind="session"]')
      let n = 0
      for (let i = 0; i < lignes.length; i++) { try { if (iconeDeLigne(lignes[i])) n++ } catch (e) {} }
      return n
    }

    let prevu = false

    // ── switch to green as soon as the commit is made ────────────────────────────────────────
    // Without this, a row stayed grey for up to 2 minutes after the commit: the
    // cached list still carried the old `updatedAt`, so the re-read pass
    // skipped the row (`deja.updatedAt === it.updatedAt`). As soon as a
    // commit gesture appears in the thread (the command is rendered in the
    // conversation), the list is expired and re-read a second later — the
    // time for the harness journal to project the commit.
    let relire = null // the re-read pass installed by `suivreTitres`
    let relirePrevue = 0

    const texteNoeud = (n) => {
      if (n === null || n === undefined) return ''
      if (n.nodeType === 3) return String(n.nodeValue || '')
      if (typeof n.textContent === 'string') return n.textContent.slice(0, 4000)
      return ''
    }

    // Looks only at what has just arrived: the text of an added node, or the
    // data of a modified text node. Never the `target` of a childList
    // mutation — on the page body its textContent is the whole page, and
    // re-reading it at every mutation would be expensive.
    const commitDansMutations = (mutations) => {
      if (mutations === null || mutations === undefined || typeof mutations.length !== 'number') return false
      for (let i = 0; i < mutations.length; i++) {
        const m = mutations[i] || {}
        if (m.type === 'characterData' && COMMIT_BASH.test(texteNoeud(m.target))) return true
        const ajoutes = m.addedNodes || []
        for (let k = 0; k < ajoutes.length; k++) if (COMMIT_BASH.test(texteNoeud(ajoutes[k]))) return true
      }
      return false
    }

    let dernierePompe = 0
    const planifier = (mutations) => {
      if (commitDansMutations(mutations) && typeof relire === 'function') {
        LISTE.t = 0
        const t = Date.now()
        if (t - relirePrevue > 2000) {
          relirePrevue = t
          setTimeout(() => { if (typeof relire === 'function') relire() }, 1200)
        }
      }
      if (prevu) return
      prevu = true
      const tic = () => {
        prevu = false; decorerTitres(); filtrerListe()
        // New rows with no category: they are classified without waiting for the next 30 s cycle (at most once every 5 s).
        if (typeof Date !== 'undefined' && Date.now() - dernierePompe > 5000) { dernierePompe = Date.now(); setTimeout(() => { try { pomperAutocat() } catch (e) { /* tried again later */ } }, 1500) }
      }
      if (typeof window !== 'undefined' && window.requestAnimationFrame) window.requestAnimationFrame(tic)
      else setTimeout(tic, 16)
    }

    // Climbs from a clicked node up to the « Show N more » button (the click can
    // land on the text of the button). `parentNode`, never `closest`: the
    // harness outside a browser only exposes the first.
    const boutonDe = (noeud) => {
      let p = noeud
      while (p !== null && p !== undefined) {
        if (String(p.className || '').indexOf('sessionOverflowButton') !== -1) return p
        p = p.parentNode
      }
      return null
    }

    // Click on « Show N more sessions »: it is THE gesture that asks to see the
    // whole group. It is remembered on the section, and the pass is run again so
    // that the filter lifts at once.
    // `aria-expanded` says the state BEFORE this click: true = this click FOLDS, and the
    // group must go back to the default filter.
    const surClicDeplier = (ev) => {
      const bouton = boutonDe(ev === null || ev === undefined ? null : ev.target)
      if (bouton === null) return
      const section = sectionDeLigne(bouton)
      if (section === null || section === undefined) return
      if (bouton.getAttribute('aria-expanded') === 'true') section.removeAttribute(CLE_TOUT)
      else section.setAttribute(CLE_TOUT, '1')
      planifier()
    }

    // Follows the list of sessions: the rows appear, disappear and
    // re-render without warning (folded groups, search filter, renaming).
    const suivreTitres = () => {
      if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {}
      poserCss()
      lireCache()
      lireCategoriesCache()
      lireAutocatCache()
      decorerTitres()
      appliquerTeintes()
      filtrerListe()
      // The category registry comes from the host: we decorate, THEN we
      // re-read the states of the work. A title renamed with no emoji thus gets
      // its SVG on the next cycle (30 s), without ever staying without an icon.
      const revoir = () => {
        lireCategories()
          .then(() => { decorerTitres(); pomperAutocat(); return rafraichirEtats() })
          .catch(() => {})
      }
      relire = revoir
      if (typeof fetch === 'function') revoir()
      let minuteur = null
      if (typeof setInterval === 'function') minuteur = setInterval(revoir, 30000)
      const surVisibilite = () => { if (typeof document !== 'undefined' && document.hidden === false) revoir() }
      if (typeof document.addEventListener === 'function') document.addEventListener('visibilitychange', surVisibilite)
      // In CAPTURE: the filter must be lifted before React renders the rows
      // of the click, otherwise the MutationObserver pass hides them at once.
      if (typeof document.addEventListener === 'function') document.addEventListener('click', surClicDeplier, true)
      const observateur = new MutationObserver(planifier)
      observateur.observe(document.body, { childList: true, subtree: true, characterData: true })
      return () => {
        observateur.disconnect()
        relire = null
        if (minuteur !== null && typeof clearInterval === 'function') clearInterval(minuteur)
        if (typeof document.removeEventListener === 'function') {
          document.removeEventListener('visibilitychange', surVisibilite)
          document.removeEventListener('click', surClicDeplier, true)
        }
      }
    }

    // ── stepper (maquette .steps) : done / do this now / coming next / blocked
    function Stepper ({ labels, steps }) {
      return h('div', { className: 'kbs-steps', style: { gridTemplateColumns: 'repeat(' + steps.length + ',minmax(0,1fr))' } },
        steps.map((k, i) => {
          const left = i === 0 ? '' : (steps[i - 1] === 'done' ? 'on' : '')
          const right = i === steps.length - 1 ? '' : (k === 'done' ? 'on' : '')
          const inner = k === 'done' ? svg('check', 11, 3.5) : (k === 'blocked' ? svg('alert', 11, 3.5) : null)
          const mot = { done: 'done', next: 'do this now', todo: 'coming next', blocked: 'blocked' }[k]
          return h('div', { className: 'kbs-step', key: i, 'aria-label': labels[i] + ': ' + mot },
            h('div', { className: 'kbs-rail' },
              h('span', { className: 'kbs-seg ' + left }),
              h('span', { className: 'kbs-sdot ' + k }, inner),
              h('span', { className: 'kbs-seg ' + right })),
            h('div', { className: 'kbs-sl ' + k }, labels[i]))
        }))
    }

    // ── computer ↔ GitHub (mockup .sync) ────────────────────────────────
    function SyncVisual ({ toSend, toFetch }) {
      const arr = (dir, n, color, on, off) => h('div', { className: 'kbs-arr ' + dir, style: { '--c': n ? color : 'var(--dsw-alias-label-tertiary,#8a9096)' } },
        h('span', { className: 'kbs-arr-l' }, n ? on : off), h('span', { className: 'kbs-line' }))
      return h('div', { className: 'kbs-sync', role: 'img',
        'aria-label': (toSend ? toSend + ' to send' : 'nothing to send') + ', ' + (toFetch ? toFetch + ' to fetch' : 'nothing to fetch') },
        h('div', { className: 'kbs-node' }, svg('laptop', 20), h('span', null, 'Your computer')),
        h('div', { className: 'kbs-arrs' },
          arr('r', toSend, ACC.violet, toSend + ' to send', 'nothing to send'),
          arr('l', toFetch, ACC.cyan, toFetch + ' to fetch', 'nothing to fetch')),
        h('div', { className: 'kbs-node' }, svg('cloud', 20), h('span', null, 'GitHub')))
    }

    // ── action with a plan (dry run, then confirmation) ───────────────────────────
    function PlanAction ({ url, corps, label, hint }) {
      const [st, setSt] = React.useState(null)
      const lancer = (exec) =>
        fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...corps, exec }) })
          .then((r) => r.json()).then(setSt)
          .catch((e) => setSt({ ok: false, erreur: String(e) }))
      const echec = st !== null && st.ok === false
      const sec = st !== null && st.ok === true && st.dry === true
      const fait = st !== null && st.ok === true && st.dry !== true
      return h('div', { className: 'kbs-act' },
        st === null || echec
          ? h('button', { className: 'kbs-btn', onClick: () => lancer(false) }, label)
          : null,
        echec ? h('p', { className: 'kbs-erreur' }, st.erreur || kt('refusé', 'refused')) : null,
        sec
          ? h('div', { className: 'kbs-plan' },
              (st.commandes || []).map((c, i) => h('code', { className: 'kbs-cmd', key: i }, c)),
              h('button', { className: 'kbs-btn', onClick: () => lancer(true) }, kt('Confirmer et lancer', 'Confirm & run')))
          : null,
        fait ? h('p', { className: 'kbs-done' }, kt('Terminé ✓ — ', 'Done ✓ — ') + (st.message || 'ok')) : null,
        st === null && hint ? h('p', { className: 'kbs-hint' }, hint) : null)
    }

    // ── floating card (mockup .pop) ─────────────────────────────────────
    function Pop ({ idCarte, name, icon, accent, titre, texte, visuel, nav, action, details, onClose }) {
      const [det, setDet] = React.useState(false)
      // P2 — by keyboard, the card must be reachable: on opening, the focus
      // goes inside it (the WAI-ARIA dialog pattern), and it goes back to the pill when
      // it closes. Before, the card carried role="dialog" without ever receiving
      // the focus: « Confirm & run » did not exist for anyone who does not use a mouse.
      React.useEffect(() => {
        const carte = document.getElementById('kbs-carte-' + idCarte)
        if (carte && carte.focus) carte.focus()
        return () => {
          const puce = document.querySelector('.kbs-pill[data-kbs-pill="' + idCarte + '"]')
          if (puce && puce.focus) puce.focus()
        }
      }, [idCarte])
      React.useEffect(() => {
        const esc = (e) => { if (e.key === 'Escape') onClose() }
        const bas = (e) => {
          const t = e.target
          if (t.closest && (t.closest('.kbs-pop') || t.closest('.kbs-pill'))) return
          onClose()
        }
        document.addEventListener('keydown', esc)
        document.addEventListener('mousedown', bas)
        return () => { document.removeEventListener('keydown', esc); document.removeEventListener('mousedown', bas) }
      }, [onClose])
      return h('div', { className: 'kbs-pop', id: 'kbs-carte-' + idCarte, tabIndex: -1,
        style: { '--acc': accent }, role: 'dialog', 'aria-label': name },
        h('div', { className: 'kbs-pop-head' },
          h('span', { className: 'kbs-pop-name' }, svg(icon, 15), name),
          h('button', { className: 'kbs-x', 'aria-label': kt('Fermer', 'Close'), onClick: onClose }, svg('close', 15))),
        h('h3', { className: 'kbs-cartetitre' }, titre),
        texte ? h('p', { className: 'kbs-text' }, texte) : null,
        nav || null,
        visuel,
        action,
        details
          ? h('div', { className: 'kbs-pied' },
              h('button', { className: 'kbs-more', 'aria-expanded': String(det), onClick: () => setDet(!det) },
                kt('Détails', 'Details'), svg('chev', 14)))
          : null,
        det && details ? h('div', { className: 'kbs-detail' }, details) : null)
    }

    const Ligne = (b, s, i) => h('div', { className: 'kbs-kv', key: i || b }, h('dt', null, b), h('dd', null, s))

    function Copier ({ texte }) {
      const [copie, setCopie] = React.useState(false)
      const faire = () => {
        const ok = () => { setCopie(true); setTimeout(() => setCopie(false), 1600) }
        const repli = () => {
          const ta = document.createElement('textarea')
          ta.value = texte; ta.style.position = 'fixed'; ta.style.opacity = '0'
          document.body.appendChild(ta); ta.select()
          try { document.execCommand('copy'); ok() } catch (e) { /* rien */ }
          ta.remove()
        }
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(texte).then(ok, repli)
        else repli()
      }
      return h('div', { className: 'kbs-minirow' },
        h('button', { className: 'kbs-minibtn', onClick: faire }, kt('Copier en texte', 'Copy as text')),
        copie ? h('span', { className: 'kbs-copie' }, kt('copié ✓', 'copied ✓')) : null)
    }

    // ── local pill → state of THIS session (the other chats of the folder
    //    are no longer a label: they are said on click, in the card) ─────
    const nomDeChemin = (p) => {
      const t = String(p || '').replace(/\/+$/, '')
      const i = t.lastIndexOf('/')
      return i === -1 ? t : t.slice(i + 1)
    }

    function vueLocal (s, sessionId, travail) {
      if (!s) return { accent: ACC.idle, label: 'No folder', titre: 'No folder for this chat',
        texte: 'This chat has no project folder yet — its state will appear here once it runs in a workspace.',
        steps: null, action: null, details: null }
      const g = s.git
      // Outside git, the question is still asked: « is this folder a repository? »
      // and « is it an isolated copy? » — two explicit YES/NO answers, not an
      // absence of information.
      if (!g.git) return { accent: ACC.idle, label: 'Outside git', titre: 'Outside git',
        texte: 'This folder is not a git project: there is nothing to save, push or isolate here.',
        steps: null, action: null,
        details: [
          Ligne('Directory', h('code', { className: 'kbs-code-in' }, s.chemin || s.slug || '—'), 'dir'),
          Ligne('Git project', 'No', 'git'),
          Ligne('Worktree', 'No — there is no repository to attach a copy to', 'wt')
        ] }
      const wt = !!g.worktree
      const pr = s.pr
      const n = g.modifications > 0 ? g.modifications : 0
      const autres = Math.max(0, (s.sessionsActives || 0) - 1)
      const partage = autres > 0
      // The unsaved work of THIS session comes from its journal. Without a
      // readable journal, we fall back on the state of the folder — at best.
      const mesEcritures = travail === null ? n : travail.ecritures
      // The disk decides when it can: if this chat's files are no
      // longer dirty, there is nothing left to save — even when the commit
      // went through the button (no agent tool in the journal).
      const restes = restesDuChat(s, travail)
      const nonSauvees = restes !== null ? restes : (mesEcritures === null ? n : mesEcritures)
      const attribue = travail !== null
      // The files THIS chat wrote since its last commit. The folder,
      // for its part, is shared: its count says nothing about this chat — « 5 files » was
      // presented as the session's work while they belonged to seven
      // other chats. So we name this chat, and speak of the folder only apart.
      const mesChemins = attribue && Array.isArray(travail.chemins) ? travail.chemins : []
      const noms = mesChemins.slice(0, 3).map(nomDeChemin).join(', ')
      const ailleurs = partage && n > 0
        ? autres + ' other chat' + pl(autres, '', 's') + ' also work' + pl(autres, 's', '') + ' in this folder'
        : ''
      const detailCommun = [
        Ligne('Directory', h('code', { className: 'kbs-code-in' }, s.chemin || s.slug), 'dir'),
        Ligne('Git project', 'Yes', 'git'),
        Ligne('Worktree', wt
          ? h('code', { className: 'kbs-code-in' }, 'Yes — ' + nomDeChemin(g.worktree) + ' is this chat’s isolated copy')
          : 'No — this chat runs in the main folder', 'wt'),
        Ligne('Branch', h('code', { className: 'kbs-code-in' }, g.branche || '—'), 'br'),
        Ligne('Modified files', n > 0 ? String(n) + ' in this folder' : 'None', 'mod'),
        Ligne('Unsaved here', attribue
          ? (nonSauvees > 0
              ? (restes !== null ? nonSauvees + ' file' + pl(nonSauvees, '', 's') : nonSauvees + ' write' + pl(nonSauvees, '', 's')) +
                ' from this chat' + (noms !== '' ? ' — ' + noms + (mesChemins.length > 3 ? ', …' : '') : '')
              : 'Nothing from this chat')
          : 'journal unreadable — folder shown', 'sess'),
        Ligne('Active chats', s.sessionsActives + ' now (1 h) · ' + s.sessionsTotal + ' total (24 h)', 'ch'),
        Ligne('Isolated copies', (s.worktrees || 0) > 0 ? s.worktrees + ' in .worktrees/ next door' : 'None', 'wts')
      ]
      // Unsaved work OF THIS session (the shared folder no longer makes
      // a state of it on its own: it is said in the card).
      if (nonSauvees > 0) {
        const mesFichiers = (restes !== null ? nonSauvees + ' file' + pl(nonSauvees, '', 's') : nonSauvees + ' write' + pl(nonSauvees, '', 's')) + ' from this chat ' +
          (noms !== '' ? '(' + noms + (mesChemins.length > 3 ? ', …' : '') + ') ' : '') +
          pl(nonSauvees, 'isn’t', 'aren’t') + ' committed yet.'
        const phrase = attribue
          ? mesFichiers + (partage && n > 0 && n !== nonSauvees
              ? ' ' + (ailleurs !== '' ? ailleurs + ' — ' : '') + 'the folder shows ' + n + ' changed ' + pl(n, 'file', 'files') + ', which may include theirs.'
              : '')
          : (n > 0
              ? n + ' ' + pl(n, 'file', 'files') + ' changed' + (wt ? ' in your copy' : ' in the project') + '.'
              : nonSauvees + ' write' + pl(nonSauvees, '', 's') + ' from this chat.') +
            (partage
              ? ' ' + (ailleurs !== ''
                  ? ailleurs + ' — the listed files may not all be yours.'
                  : autres + ' other chat' + pl(autres, '', 's') + ' work' + pl(autres, 's', '') + ' in this folder too.')
              : '')
        return { accent: partage && attribue && n === 0 ? ACC.business : ACC.warn, label: 'Unsaved',
          titre: 'This chat has work that isn’t saved',
          texte: phrase + ' Save to avoid losing anything.',
          steps: ['next', 'todo'],
          action: h(PlanAction, { url: '/kybernos-sessions/commit', corps: { session: sessionId, chemins: mesChemins },
            label: 'Save my work',
            hint: 'Saves only the files this chat wrote, then pushes. Other chats’ files are left alone.' }),
          details: detailCommun }
      }
      // isolated copy under review.
      if (wt && pr && pr.etat === 'open') {
        return { accent: ACC.business, label: 'In review',
          titre: 'Your work is being reviewed',
          texte: 'It’s saved and on GitHub, waiting for a teammate’s OK. Nothing to do here.',
          steps: ['done', 'next'],
          action: null, details: detailCommun }
      }
      // isolated copy with unmerged commits.
      if (wt && g.nonFusionnes > 0) {
        return { accent: ACC.business, label: 'Add to project',
          titre: 'Saved, but not in the project yet',
          texte: 'Your separate copy is safe, but other sessions can’t see it yet.',
          steps: ['done', 'next'],
          action: h(PlanAction, { url: '/kybernos-sessions/commit', corps: { session: sessionId },
            label: 'Add to project',
            hint: 'Your copy gets combined with the main version. Dry-run first.' }),
          details: detailCommun }
      }
      // nothing unsaved for this chat — possibly work
      // left by the other chats of the same folder.
      if (ailleurs !== '') {
        return { accent: ACC.business, label: 'Saved',
          titre: 'This chat has nothing to save',
          texte: 'The folder shows ' + n + ' uncommitted ' + pl(n, 'file', 'files') + ', but they come from ' + ailleurs +
            ' — this chat’s own work is committed. Give this chat its own copy to stop stepping on each other.',
          steps: ['done', 'done'],
          action: h(PlanAction, { url: '/kybernos-sessions/isolate', corps: { session: sessionId },
            label: 'Give this chat its own copy',
            hint: 'Creates .worktrees/<name> on a NEW branch. Refuses a dirty tree.' }),
          details: detailCommun }
      }
      // everything is in its place.
      return { accent: ACC.success, label: 'Saved',
        titre: wt ? 'Everything is in the project' : 'Everything is saved',
        texte: wt ? 'Your copy is identical to the project. You can close it.' : 'You’re working directly on the project. Nothing to do.',
        steps: ['done', 'done'],
        action: wt
          ? h(PlanAction, { url: '/kybernos-sessions/close', corps: { chemin: s.chemin },
              label: 'Close this copy', hint: 'Merges into the base branch and removes the folder. Refuses dirty or unpushed work.' })
          : null,
        details: detailCommun }
    }

    // ── summary: done / not done / can be closed + LOCAL gesture ───────────
    // The « commit & merge into the local repo » gesture pushes NOTHING: it
    // commits only THIS chat's files, then brings the branch back into the
    // local base. It lives in the row (a pill), not at the bottom of a card:
    // it is the gesture one wants a click away.
    // The worktree does not write quite like the host: here the paths of the
    // journal can be absolute (the agent names its files in absolute form) or
    // relative (a tool run from the folder). They are brought back to the session's
    // folder before being compared with the list of dirty files.
    const relatifAuDossier = (p, dossier) => {
      const c = String(p || '').trim()
      if (c === '') return null
      if (c.charAt(0) !== '/') return c.replace(/^\.\//, '')
      const d = String(dossier || '').replace(/\/+$/, '')
      if (d === '' || c === d) return null
      return c.indexOf(d + '/') === 0 ? c.slice(d.length + 1) : null
    }
    const encoreSale = (sales, p) => (Array.isArray(sales) ? sales : []).some((x) => {
      const brut = String(x)
      const t = brut.replace(/\/+$/, '')
      return t === p || (brut.charAt(brut.length - 1) === '/' && p.indexOf(t + '/') === 0)
    })
    // How many of THIS chat's files are left to save, according to the disk.
    // `null` when the host does not give the list (an earlier version): we
    // then fall back on the journal's verdict, as before.
    const restesDuChat = (s, travail) => {
      const g = s && s.git
      if (!g || !g.git || !Array.isArray(g.sale)) return null
      const mes = travail !== null && Array.isArray(travail.chemins) ? travail.chemins : []
      const dedans = mes.map((p) => relatifAuDossier(p, s.chemin)).filter((p) => p !== null)
      // No file of the chat INSIDE this folder: its visible writes are
      // elsewhere (tools outside the repository), so nothing can be concluded from the disk.
      // Answering « 0 left » would say « everything is saved » to a chat that has
      // five modified files in the repository — seen for real on 22/09, the
      // journal window no longer went back far enough to see them.
      if (dedans.length === 0) return null
      return dedans.filter((p) => encoreSale(g.sale, p)).length
    }
    // Is this chat's work saved? The journal only sees the
    // commits run by an agent TOOL; the « Commit & merge » button
    // commits host side, so the row stayed « not saved » just after
    // a successful commit (seen for real on 22/09). The disk does not lie.
    const travailEnregistre = (s, travail) => {
      if (travail !== null && travail.fait === true) return true
      const restes = restesDuChat(s, travail)
      return restes === 0
    }

    function vueRecap (s, travail) {
      if (!s) return { accent: ACC.idle, label: 'Recap', act: false,
        tip: ['Recap', 'No folder for this chat'] }
      const g = s.git
      if (!g.git) return { accent: ACC.idle, label: 'Recap', act: false,
        tip: ['Recap', 'Not a git project', 'Nothing to commit — the chat can be closed'] }
      const n = g.modifications > 0 ? g.modifications : 0
      const restes = restesDuChat(s, travail)
      const nonSauvees = restes !== null
        ? restes
        : (travail === null ? n : (travail.ecritures === null ? n : travail.ecritures))
      const nonFusionnes = g.nonFusionnes > 0 ? g.nonFusionnes : 0
      // P7 — the chat can be clean while the repository is not: without
      // this line, « Nothing pending » made people think everything was tidy
      // (43 files and 21 commits ahead at the time of the measurement).
      const salesTotal = Array.isArray(g.sale) ? g.sale.length : 0
      const autresSales = restes !== null && salesTotal > restes ? salesTotal - restes : 0
      if (nonSauvees > 0) return { accent: ACC.warn, label: 'Commit & merge', act: true,
        tip: ['Recap', (restes !== null ? nonSauvees + ' file' + pl(nonSauvees, '', 's') + ' from this chat to save'
          : nonSauvees + ' write' + pl(nonSauvees, '', 's') + ' from this chat to save'),
          'Local only — nothing is sent to GitHub'] }
      if (nonFusionnes > 0) return { accent: ACC.business, label: 'Merge locally', act: true,
        tip: ['Recap', nonFusionnes + ' commit' + pl(nonFusionnes, '', 's') + ' not in the project yet',
          'Local only — nothing is sent to GitHub'] }
      return { accent: ACC.success, label: 'Recap', act: false,
        tip: ['Recap', 'Nothing pending',
          autresSales > 0 && nonFusionnes > 0
            ? autresSales + ' other file' + pl(autresSales, '', 's') + ' in the repo are dirty · ' + nonFusionnes + ' local commit' + pl(nonFusionnes, '', 's')
            : (autresSales > 0
                ? autresSales + ' other file' + pl(autresSales, '', 's') + ' in the repo ' + pl(autresSales, 'isn’t', 'aren’t') + ' committed'
                : (nonFusionnes > 0 ? nonFusionnes + ' local commit' + pl(nonFusionnes, '', 's') + ' not pushed' : (g.worktree ? 'The isolated copy can be closed' : 'You work in the main folder')))] }
    }

    // The card: the three sentences of the recap (done / not done / can be closed) and the
    // dry-run plan. « Can be closed » comes from the host (the same guards as
    // the closing): the GUI does not promise what the gesture would refuse.
    function RecapCard ({ s, sessionId, travail }) {
      const [cloture, setCloture] = React.useState(null)
      React.useEffect(() => {
        if (!s) return
        fetch('/kybernos-sessions/close-check', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session: sessionId })
        }).then((r) => r.json()).then((j) => setCloture(j))
          .catch(() => setCloture({ ok: false, cloturable: false, raison: 'check unavailable' }))
      }, [sessionId])
      const g = s ? s.git : { git: false }
      const git = !!g.git
      const wt = !!(git && g.worktree)
      const n = git && g.modifications > 0 ? g.modifications : 0
      const restes = restesDuChat(s, travail)
      const nonSauvees = !git ? 0 : (restes !== null
        ? restes
        : (travail === null ? n : (travail.ecritures === null ? n : travail.ecritures)))
      const mesChemins = travail !== null && Array.isArray(travail.chemins) ? travail.chemins : []
      const nonFusionnes = git && g.nonFusionnes > 0 ? g.nonFusionnes : 0
      // P7 — the files of the repository that are not this chat's.
      const salesTotal = git && Array.isArray(g.sale) ? g.sale.length : 0
      const autresSales = restes !== null && salesTotal > restes ? salesTotal - restes : 0
      const fait = !git
        ? 'Outside git — no checkpoints here'
        : (travailEnregistre(s, travail)
            ? 'This chat’s work is committed'
            : 'Nothing committed by this chat yet')
      const reste = !git
        ? 'Nothing to save in this folder'
        : (nonSauvees > 0
            ? (restes !== null
                ? nonSauvees + ' file' + pl(nonSauvees, '', 's') + ' from this chat ' + pl(nonSauvees, 'isn’t', 'aren’t') + ' committed'
                : nonSauvees + ' write' + pl(nonSauvees, '', 's') + ' from this chat ' + pl(nonSauvees, 'isn’t', 'aren’t') + ' committed')
            : (nonFusionnes > 0
                ? nonFusionnes + ' commit' + pl(nonFusionnes, '', 's') + ' not in the project yet'
                : 'Nothing pending'))
      const ferme = !git
        ? 'You can close this chat any time'
        : (cloture === null
            ? 'Checking…'
            : (cloture.cloturable === true
                ? (wt ? 'Yes — this copy can be merged, then removed' : 'Yes — nothing to merge')
                : 'Not yet — ' + String(cloture.raison || cloture.erreur || 'work is in the way')))
      const ligne = (k, v) => h('div', { className: 'kbs-recap-row' },
        h('span', { className: 'kbs-recap-k' }, k), h('span', { className: 'kbs-recap-v' }, v))
      const actionnable = git && (nonSauvees > 0 || nonFusionnes > 0)
      return h('div', { className: 'kbs-bilan' },
        ligne('Done', fait),
        ligne('Not done', reste),
        ligne('Closing', ferme),
        autresSales > 0 || nonFusionnes > 0
          ? ligne('Elsewhere', [
              autresSales > 0 ? autresSales + ' other file' + pl(autresSales, '', 's') + ' in the repo ' + pl(autresSales, 'isn’t', 'aren’t') + ' committed' : null,
              nonFusionnes > 0 ? nonFusionnes + ' local commit' + pl(nonFusionnes, '', 's') + ' to send' : null
            ].filter(Boolean).join(' · '))
          : null,
        actionnable
          ? h(PlanAction, {
              url: '/kybernos-sessions/commit',
              corps: { session: sessionId, chemins: mesChemins, local: true },
              label: nonFusionnes > 0 && nonSauvees === 0 ? 'Merge into the local project' : 'Commit & merge locally',
              hint: 'Local only: saves the files this chat wrote, then merges into the local base branch. Nothing is sent to GitHub.'
            })
          : null)
    }

    // ── sync pill (GitHub) — describes the PROJECT, not the isolated copy ────────
    function vueSync (s) {
      if (!s || !s.sync) return null
      const y = s.sync
      const a = y.commitsNonPousses > 0 ? y.commitsNonPousses : 0
      const b = y.commitsRecus > 0 ? y.commitsRecus : 0
      const ago = depuis(y.dernierFetch)
      const base = { toSend: a, toFetch: b }
      const details = [
        Ligne('Origin', h('code', { className: 'kbs-code-in' }, y.distant || '—'), 'or'),
        Ligne('Branch', h('code', { className: 'kbs-code-in' }, (y.branche || '—') + ' ↔ origin/' + (y.branche || '—')), 'br'),
        Ligne('To send', a > 0 ? String(a) : 'None', 'a'),
        Ligne('To fetch', b > 0 ? String(b) : 'None', 'b'),
        Ligne('Checked', ago ? ago : 'never fetched', 'f')
      ]
      if (!y.distant) return { accent: ACC.idle, label: 'No remote', titre: 'Not connected to GitHub',
        texte: 'This project has no remote — nothing to send or fetch.',
        visuel: h(SyncVisual, base), act: null, details }
      if (a > 0 && b > 0) return { accent: ACC.warn, label: 'Sync needed',
        titre: 'You and GitHub both have news',
        texte: a + ' to send, ' + b + ' to fetch. We fetch first, then send.',
        visuel: h(SyncVisual, base),
        act: h(PlanAction, { url: '/kybernos-sessions/sync', corps: { session: s.session },
          label: 'Fetch, then send', hint: 'Your own work isn’t lost.' }),
        details }
      if (a > 0) return { accent: ACC.violet, label: 'To send',
        titre: a + ' ' + pl(a, 'update', 'updates') + ' not on GitHub yet',
        texte: 'Your project is ahead of GitHub. Send it to keep a backup copy.',
        visuel: h(SyncVisual, base),
        act: h(PlanAction, { url: '/kybernos-sessions/push', corps: { session: s.session },
          label: 'Send to GitHub', hint: 'One more backup. Nothing changes for you.' }),
        details }
      if (b > 0) return { accent: ACC.cyan, label: 'To fetch',
        titre: 'GitHub has news',
        texte: b + ' ' + pl(b, 'update', 'updates') + ' arrived online. Fetch ' + pl(b, 'it', 'them') + ' to stay up to date.',
        visuel: h(SyncVisual, base),
        act: h(PlanAction, { url: '/kybernos-sessions/fetch', corps: { session: s.session },
          label: 'Fetch updates', hint: 'Your own work isn’t touched.' }),
        details }
      return { accent: ACC.success, label: 'Up to date',
        titre: 'Same on your computer and GitHub',
        texte: 'Nothing to send, nothing to fetch.',
        visuel: h(SyncVisual, base), act: null, details }
    }

    // ── review pill (a real pull request through gh) ──────────────────────────
    function vuePr (s) {
      if (!s || !s.git || !s.git.git) return null
      const g = s.git
      const pr = s.pr
      // on the base branch: the review does not apply (information)
      if (g.branche === g.base) {
        return { accent: ACC.violet, label: 'No review',
          titre: 'Reviews are for separate copies',
          texte: 'You are working on the main branch directly. Give this chat its own copy (Workspace pill) — then you can ask a teammate to check the work.',
          steps: ['todo', 'todo', 'todo', 'todo'], act: null, details: null }
      }
      if (!g.distant || !/github/.test(g.distant)) {
        return { accent: ACC.violet, label: 'No review', titre: 'No GitHub remote',
          texte: 'Reviews live on GitHub — this project has no remote.', steps: null, act: null, details: null }
      }
      if (!pr) {
        if (g.nonFusionnes <= 0) {
          return { accent: ACC.violet, label: 'No review', titre: 'Nothing to review yet',
            texte: 'Save some work in your copy first. Then you can ask a teammate to check it.',
            steps: ['todo', 'todo', 'todo', 'todo'], act: null, details: null }
        }
        return { accent: ACC.violet, label: 'No review', titre: 'Ask a teammate to check your work',
          texte: 'We put your copy on GitHub and open a review request. The project stays untouched until it’s accepted.',
          steps: ['next', 'todo', 'todo', 'todo'],
          act: h(PlanAction, { url: '/kybernos-sessions/pr', corps: { session: s.session, action: 'create' },
            label: 'Ask for review', hint: 'You can keep working meanwhile.' }),
          details: null }
      }
      const details = [
        Ligne('Request', '#' + pr.numero + ' — ' + (pr.titre || ''), 'n'),
        Ligne('Goes into', h('code', { className: 'kbs-code-in' }, pr.cible || '—'), 'cible'),
        Ligne('Branch', h('code', { className: 'kbs-code-in' }, pr.branche || '—'), 'br'),
        Ligne('Checks', { pass: 'passed ✓', fail: 'failed ✗', running: 'running…', none: 'none' }[pr.checks] || pr.checks, 'ck'),
        Ligne('Review', { approved: 'approved ✓', changes_requested: 'changes asked', review_required: 'waiting for a teammate' }[pr.revue] || pr.revue, 'rv'),
        pr.url ? Ligne('On GitHub', h('a', { className: 'kbs-lien', href: pr.url, target: '_blank', rel: 'noreferrer' }, 'open the review request ↗'), 'url') : null
      ]
      if (pr.etat === 'merged') return { accent: ACC.success, label: 'Merged',
        titre: 'Your work is in the project',
        texte: 'The review is done and GitHub has your work. Fetch the update to see it on your computer.',
        steps: ['done', 'done', 'done', 'done'], act: null, details }
      const ready = pr.checks === 'pass' && pr.revue === 'approved'
      const steps = ['done',
        pr.checks === 'pass' ? 'done' : pr.checks === 'fail' ? 'blocked' : 'next',
        pr.revue === 'approved' ? 'done' : pr.revue === 'changes_requested' ? 'blocked' : (pr.checks === 'pass' ? 'next' : 'todo'),
        ready ? 'next' : 'todo']
      if (pr.checks === 'fail') return { accent: ACC.error, label: 'Check failed',
        titre: 'An automatic check failed',
        texte: 'GitHub ran tests on your work and one didn’t pass. Ask Claude to look at it and fix it.',
        steps, act: null, details }
      if (pr.revue === 'changes_requested') return { accent: ACC.warn, label: 'Changes asked',
        titre: 'A teammate asked for changes',
        texte: 'They left comments on your work. Claude can address them, then GitHub checks again.',
        steps, act: null, details }
      if (pr.checks === 'running') return { accent: ACC.warn, label: 'Checks running',
        titre: 'GitHub is checking your work',
        texte: 'Automatic tests are running. This usually takes a few minutes.' + (pr.revue === 'approved' ? ' A teammate already approved it.' : ''),
        steps, act: null, details }
      if (!ready) return { accent: ACC.business, label: 'Waiting for review',
        titre: 'Waiting for a teammate’s OK',
        texte: 'The checks passed. Someone now has to look at your work and approve it.',
        steps, act: null, details }
      return { accent: ACC.success, label: 'Ready to merge',
        titre: 'Approved, ready to add',
        texte: 'The checks passed and a teammate approved. You can add it to the project.',
        steps, act: h(PlanAction, { url: '/kybernos-sessions/pr', corps: { session: s.session, action: 'merge' },
          label: 'Merge on GitHub', hint: 'The project gets your work.' }),
        details }
    }

    // ── the reading the « Changes » plugin consumes ───────────────────────────
    // The SAME facts as the four git pills (local, recap, GitHub, review), without their text or their
    // nodes: the neighbouring plugin makes one sentence of them. The gestures come out as descriptors
    // `{ url, corps, label, hint }` — what `PlanAction` receives — filed by ROLE, so that this plugin never
    // has to read a URL to know what a button does. Nothing is recomputed: the views above
    // stay the only source, so what that plugin shows cannot contradict the pills.
    const descripteur = (el) => (el !== null && el !== undefined && el.props !== undefined && el.props !== null && typeof el.props.url === 'string')
      ? { url: el.props.url, corps: el.props.corps || {}, label: el.props.label || '', hint: el.props.hint || '' } : null
    // `git status --porcelain` : « ?? » = new, « D » = deleted, « R » = renamed, « U »/« AA »/« DD » = conflict.
    const genreDeCode = (code) => {
      const c = String(code || '')
      if (c.indexOf('U') >= 0 || /^(AA|DD)$/.test(c)) return 'conflict'
      if (c === '??' || c.indexOf('A') >= 0) return 'new'
      if (c.indexOf('D') >= 0) return 'deleted'
      if (c.indexOf('R') >= 0) return 'renamed'
      return 'modified'
    }
    function faitsChangements (s, sessionId, travail) {
      if (!s) return { git: false, pourquoi: 'dossier' }
      const g = s.git
      if (!g || !g.git) return { git: false, pourquoi: 'git' }
      const n = g.modifications > 0 ? g.modifications : 0
      const restes = restesDuChat(s, travail)
      const mesChemins = travail !== null && Array.isArray(travail.chemins) ? travail.chemins : []
      const nonSauvees = restes !== null ? restes : (travail === null ? n : (travail.ecritures === null ? n : travail.ecritures))
      const nonFusionnes = g.nonFusionnes > 0 ? g.nonFusionnes : 0
      const y = s.sync || null
      const aEnvoyer = y !== null && y.commitsNonPousses > 0 ? y.commitsNonPousses : 0
      const aRecevoir = y !== null && y.commitsRecus > 0 ? y.commitsRecus : 0
      const github = !!(g.distant && /github\.com/i.test(g.distant))
      const autres = Math.max(0, (s.sessionsActives || 0) - 1)
      // The dirty files, with their kind when the host gives it (additive field `fichiers`), and what belongs to THIS
      // chat when the disk can say so (`restes` is not null).
      const miens = restes !== null
        ? new Set(mesChemins.map((p) => relatifAuDossier(p, s.chemin)).filter((p) => p !== null && encoreSale(g.sale, p)))
        : null
      const genres = new Map()
      if (Array.isArray(g.fichiers)) for (const f of g.fichiers) if (f !== null && typeof f === 'object') genres.set(String(f.chemin).replace(/\/+$/, ''), genreDeCode(f.code))
      const fichiers = (Array.isArray(g.sale) ? g.sale : []).slice(0, 200).map((p) => {
        const chemin = String(p).replace(/\/+$/, '')
        return { path: String(p), kind: genres.get(chemin) || null, mine: miens === null ? null : miens.has(chemin) }
      })
      const conflits = fichiers.filter((f) => f.kind === 'conflict').length
      // The gestures, by role: the one `vueLocal`, `vueSync` and `vuePr` would offer, plus the recap's local gesture.
      const actions = {}
      const poser = (role, d) => { if (d !== null && actions[role] === undefined) actions[role] = d }
      const w = vueLocal(s, sessionId, travail)
      const dw = descripteur(w.action)
      if (dw !== null) {
        if (/\/commit$/.test(dw.url)) poser(Array.isArray(dw.corps.chemins) ? 'save' : 'addToProject', dw)
        else if (/\/isolate$/.test(dw.url)) poser('isolate', dw)
        else if (/\/close$/.test(dw.url)) poser('closeCopy', dw)
      }
      if (nonSauvees > 0 || nonFusionnes > 0) {
        poser('saveLocal', { url: '/kybernos-sessions/commit', corps: { session: sessionId, chemins: mesChemins, local: true }, label: nonFusionnes > 0 && nonSauvees === 0 ? 'Merge into the local project' : 'Commit & merge locally', hint: '' })
      }
      const v = github ? vueSync(s) : null
      const dy = v !== null ? descripteur(v.act) : null
      if (dy !== null) poser(/\/sync$/.test(dy.url) ? 'sync' : /\/push$/.test(dy.url) ? 'push' : 'fetch', dy)
      const r = github ? vuePr(s) : null
      const dr = r !== null ? descripteur(r.act) : null
      if (dr !== null) poser(dr.corps.action === 'merge' ? 'merge' : 'askReview', dr)
      return {
        git: true,
        folder: s.chemin || '',
        branch: g.branche || '',
        base: g.base || '',
        isolated: !!g.worktree,
        isolatedName: g.worktree ? nomDeChemin(g.worktree) : '',
        remote: g.distant || null,
        github,
        unsaved: nonSauvees,
        unsavedKnown: restes !== null,
        files: fichiers,
        folderDirty: n,
        sharedWith: autres,
        ahead: aEnvoyer,
        behind: aRecevoir,
        notMerged: nonFusionnes,
        lastFetch: y !== null ? y.dernierFetch || null : null,
        conflicts: conflits,
        pr: s.pr ? { number: s.pr.numero, title: s.pr.titre || '', state: s.pr.etat, checks: s.pr.checks, review: s.pr.revue, url: s.pr.url || '' } : null,
        onBase: !!(g.branche && g.base && g.branche === g.base),
        actions
      }
    }
    // The « Changes » plugin reads this at every opening: the state of the folder AND the journal of the session (which says what
    // THIS chat wrote), like the pills. `null` when the route is silent.
    const lireChangements = async (sessionId) => {
      let etat = null
      try { etat = await fetch('/kybernos-sessions/state?session=' + encodeURIComponent(sessionId || '') + '&window=1').then((r) => r.json()) } catch (e) { return null }
      if (etat === null || typeof etat !== 'object') return null
      const s = etat.session ? Object.assign({}, etat.session, { session: sessionId }) : null
      let travail = null
      try { const j = await lireJournalSession(sessionId); travail = j !== null && j !== undefined ? classerJournal(j.events, j.cwd) : null } catch (e) { travail = null }
      return faitsChangements(s, sessionId, travail)
    }
    try { window.__KB_SESSIONS_VIEW__ = { version: 1, read: lireChangements } } catch (e) { /* no window: the Changes plugin then shows nothing and the four pills stay */ }

    // ── the row of pills ───────────────────────────────────────────────
    function Pills ({ sessionId }) {
      // The « Changes » plugin says the same thing in one chip: as long as it is active, the four git pills
      // keep quiet (Memory & Lessons stays). It signals this with `window.__KB_CHANGES_ACTIVE__` and with an event.
      const [changesOn, setChangesOn] = React.useState(() => typeof window !== 'undefined' && window.__KB_CHANGES_ACTIVE__ === true)
      React.useEffect(() => {
        const on = () => setChangesOn(window.__KB_CHANGES_ACTIVE__ === true)
        window.addEventListener('kybernos-changes-active', on)
        on()
        return () => window.removeEventListener('kybernos-changes-active', on)
      }, [])
      const [etat, setEtat] = React.useState(null)
      const [journal, setJournal] = React.useState(null)
      const [ouverte, setOuverte] = React.useState(null) // 'local' | 'recap' | 'sync' | 'pr' | 'notes' | null
      const [kyberChoisi, setKyberChoisi] = React.useState(null)
      const [onglet, setOnglet] = React.useState('mem') // 'mem' | 'les' : l'onglet de la carte Memory & Lessons
      // What the model gets from the account (X of N), read from the cloud plugin's routes — two calls with no remote
      // network (the host's cache). `null` when the cloud plugin is absent or the account disconnected: the
      // pill then falls back on what the journal of THIS chat knows.
      const [memInfo, setMemInfo] = React.useState(null)
      const lireMem = React.useCallback(async () => {
        try {
          const [l, r] = await Promise.all([
            fetch('/kybernos-cloud/memory/list?limit=1&session=' + encodeURIComponent(sessionId || '')).then((x) => x.json()),
            fetch('/kybernos-cloud/memory/settings').then((x) => x.json())
          ])
          setMemInfo(l && l.ok === true && l.budget && l.counts
            ? { sent: l.budget.sent, total: l.counts.all, used: l.budget.used, cap: l.budget.cap, picked: l.picked && l.picked.count > 0 ? l.picked.count : 0, capture: r && r.capture ? r.capture : null,
                actif: !r || !r.settings || (r.settings.memories === true && r.settings.context === true) }
            : null)
        } catch (e) { setMemInfo(null) }
      }, [])
      React.useEffect(() => {
        lireMem()
        const t = setInterval(lireMem, 30000)
        return () => clearInterval(t)
      }, [lireMem])
      // How many LESSONS were picked for this chat's latest message (the lessons plugin keeps it per session, like the memories').
      const [lesPicked, setLesPicked] = React.useState(0)
      const lireLecons = React.useCallback(async () => {
        try {
          const l = await fetch('/kybernos-memory/lessons?limit=1&session=' + encodeURIComponent(sessionId || '')).then((x) => x.json())
          setLesPicked(l && l.ok === true && l.picked && l.picked.count > 0 ? l.picked.count : 0)
        } catch (e) { setLesPicked(0) }
      }, [])
      // What the team's approved lessons add to this chat (the cloud plugin keeps it per session). Nothing when the account has no Team workspace.
      const [teamSent, setTeamSent] = React.useState(null)
      const lireEquipe = React.useCallback(async () => {
        try {
          const t = await fetch('/kybernos-cloud/team/status?session=' + encodeURIComponent(sessionId || '')).then((x) => x.json())
          setTeamSent(t && t.ok === true && t.sent && t.sent.count > 0 ? { count: t.sent.count, picked: t.sent.picked > 0 ? t.sent.picked : 0 } : null)
        } catch (e) { setTeamSent(null) }
      }, [])
      React.useEffect(() => {
        lireLecons()
        lireEquipe()
        const t = setInterval(() => { lireLecons(); lireEquipe() }, 30000)
        return () => clearInterval(t)
      }, [lireLecons, lireEquipe])

      const charger = React.useCallback(() => {
        fetch('/kybernos-sessions/state?session=' + encodeURIComponent(sessionId || '') + '&window=1')
          .then((r) => r.json()).then((j) => setEtat(j)).catch(() => setEtat(null))
      }, [sessionId])
      // The session journal says what the folder cannot say: what
      // THIS session wrote (unsaved) and what it wrote or
      // updated in memory. Read through the harness API — no host route.
      const lireJournal = React.useCallback(() => {
        lireJournalSession(sessionId).then((j) => setJournal(j)).catch(() => setJournal(null))
      }, [sessionId])
      React.useEffect(() => {
        poserCss()
        charger()
        lireJournal()
        const reveil = () => { charger(); lireJournal() }
        const t = setInterval(reveil, 30000)
        return () => clearInterval(t)
      }, [charger, lireJournal])

      if (etat === null) return null
      const s = etat.session
        ? Object.assign({}, etat.session, { session: sessionId })
        : null
      // state of THIS session's work (journal) + its memory (memory.cjs)
      const travail = journal !== null ? classerJournal(journal.events, journal.cwd) : null
      const memoire = journal !== null
        ? memoireDuJournal(journal.events)
        : { entrees: [], kybers: [], records: [], lessons: [], used: [], souvenirs: [] }
      const kybers = memoire.kybers
      const kyber = (kyberChoisi !== null && kybers.indexOf(kyberChoisi) >= 0) ? kyberChoisi : (kybers[0] || null)
      const bascule = (id) => { setOuverte(ouverte === id ? null : id); charger(); lireJournal() }
      const fermer = (id) => {
        setOuverte(null)
        const p = document.querySelector('[data-kbs-pill="' + id + '"]')
        if (p) p.focus({ preventScroll: true })
      }

      // ── local: the state of THIS session (not that of the shared folder) ──
      const w = vueLocal(s, sessionId, travail)
      // ── recap: done / not done / can be closed + the local gesture ──
      const rec = vueRecap(s, travail)
      const g = s && s.git
      const wTip = s === null
        ? ['Local', 'No folder for this chat']
        : ['Local', w.titre,
          !g.git ? 'Not a git project' : (g.branche + (g.worktree ? ' · worktree ' + nomDeChemin(g.worktree) : ' · main folder')),
          (s.chemin || ''),
          s.sessionsActives + ' chat' + pl(s.sessionsActives, '', 's') + ' active (1 h)' +
            ((s.worktrees || 0) > 0 ? ' · ' + s.worktrees + ' ' + pl(s.worktrees, 'copy', 'copies') + ' next door' : '')]

      // The two remote pills only make sense if the folder is linked to
      // a GitHub repository: with no GitHub remote there is neither send nor review — neither is
      // shown then.
      const github = !!(g && g.git && g.distant && /github\.com/i.test(g.distant))

      // ── sync ──
      const v = github ? vueSync(s) : null
      const sync = s && s.sync
      const vTip = !v ? null : ['GitHub sync', v.titre,
        sync && sync.distant ? (sync.commitsNonPousses > 0 ? sync.commitsNonPousses + ' to send' : 'nothing to send') + ' · ' +
          (sync.commitsRecus > 0 ? sync.commitsRecus + ' to fetch' : 'nothing to fetch') : 'no remote']

      // ── review ──
      const r = github ? vuePr(s) : null
      // P5 — a state that has a number paints it: « To send » without its count
      // forced a hover to know how many. The two other pills
      // already showed theirs, it was the only inconsistency of the row.
      const vBadge = !v || !sync ? null
        : v.label === 'To send' ? (sync.commitsNonPousses > 0 ? sync.commitsNonPousses : null)
          : v.label === 'To fetch' ? (sync.commitsRecus > 0 ? sync.commitsRecus : null)
            : v.label === 'Sync needed'
              ? (((sync.commitsNonPousses > 0 ? sync.commitsNonPousses : 0) + (sync.commitsRecus > 0 ? sync.commitsRecus : 0)) || null)
              : null

      const rTip = !r ? null : ['Review', r.titre,
        s && s.pr ? ('#' + s.pr.numero + ' · checks ' + s.pr.checks + ' · review ' + s.pr.revue)
          : (s && s.git && s.git.git ? s.git.branche + ' → ' + s.git.base : '')]

      // ── agent team selector: only those this session touched ──
      const switcher = kybers.length > 1
        ? h('div', { className: 'kbs-kybers' },
            kybers.map((k) => h('button', { key: k,
              className: 'kbs-kyb' + (kyber === k ? ' on' : ''),
              onClick: () => setKyberChoisi(k) }, k)))
        : null

      // ── memory: what THIS session wrote or updated (memory.cjs) ──
      // The agent team's ledger adds up all the sessions of the machine: so we
      // do not read the memory files, we read the gestures of the journal.
      const entKyber = kyber === null ? [] : memoire.entrees.filter((x) => x.kyber === kyber)
      const memFaites = entKyber.filter((x) => x.ok === true)
      const libelleMemo = (x) => x.type === 'record' ? kt('exécution enregistrée', 'run recorded') : (x.type === 'lesson' ? kt('leçon écrite', 'lesson written') : kt('leçon réutilisée', 'lesson reused'))
      const texteReutilisee = (x) => kt('leçon n° ' + x.index + ' — son compteur d’utilisations a été augmenté', 'lesson #' + x.index + ' — its uses counter was raised')
      const texteMemo = (x) => x.type === 'record'
        ? [x.role, x.outcome, x.note].filter((z) => z !== '' && z !== null).join(' · ')
        : (x.type === 'lesson' ? x.text : texteReutilisee(x))
      const ligneMemo = (x, i) => h('div', { className: 'kbs-memo-row', key: i },
        h('div', { className: 'kbs-memo-head' },
          h('span', { className: 'kbs-memo-kind' }, libelleMemo(x)),
          h('span', null, (x.kyber || '?') + (x.ts ? ' · ' + court(x.ts) : '')),
          x.ok === true ? null : h('span', { className: 'kbs-memo-kind', style: { color: 'var(--dsw-alias-state-error-primary,#ef4444)' } }, kt('échec', 'failed'))),
        h('p', null, texteMemo(x) || '—'))
      // ── lessons: written or reused INSIDE this session ───────────────
      // (the definition followed its consumer: the Notes block reads both.)
      const leconsSession = entKyber.filter((x) => (x.type === 'lesson' || x.type === 'used') && x.ok === true)
      const ligneLecon = (l, i) => h('div', { className: 'kbs-lesson', key: i },
        h('time', null, libelleMemo(l) + (l.ts ? ' · ' + court(l.ts) : '')),
        h('p', null, l.type === 'lesson' ? l.text : texteReutilisee(l)),
        (l.tags && l.tags.length) ? h('div', { className: 'kbs-tags' },
          l.tags.map((t, j) => h('span', { className: 'kbs-tag', key: j }, t))) : null)

      // ── Memory & Lessons: a pill that says its name ───────────────────
      // Before: « Notes », a book with no word (P4: one pill for two subjects), which only counted what THIS chat
      // had written and led nowhere. Now: the word, what the model gets from the account, what this chat
      // left, and the link to the Settings page. The counters do not get mixed: on the left the account's memory
      // (sent to the model), on the right the lessons of this chat; « +N » = what THIS chat wrote.
      const ecritsMem = memoire.souvenirs.length
      const nbLecons = leconsSession.length
      const ecritsLecons = leconsSession.filter((l) => l.type === 'lesson').length
      const delta = ecritsMem + ecritsLecons
      const rien = ecritsMem === 0 && nbLecons === 0 && memFaites.length === 0
      const notesAccent = ecritsMem > 0 || memFaites.length > 0 ? ACC.teal : (nbLecons > 0 ? ACC.pink : ACC.idle)
      const memBadge = memInfo !== null ? memInfo.sent : (memFaites.length > 0 ? memFaites.length : null)
      // The panel speaks the language of the page (kt: French for French, English for every other language); the plural stays in the words.
      const memDit = memInfo !== null
        ? kt(memInfo.sent + ' sur ' + memInfo.total + ' ' + (memInfo.total > 1 ? 'souvenirs' : 'souvenir') + ' ' + (memInfo.sent > 1 ? 'envoyés' : 'envoyé') + ' au modèle', memInfo.sent + ' of ' + memInfo.total + ' memories sent to the model')
        : kt('Mémoire du compte indisponible (connecte Kybernos Cloud)', 'Account memory unavailable (connect Kybernos Cloud)')
      const lesDit = nbLecons === 0
        ? kt('aucune leçon dans cette conversation', 'no lesson in this chat')
        : kt(nbLecons + ' ' + (nbLecons === 1 ? 'leçon' : 'leçons') + ' dans cette conversation', nbLecons + ' lesson' + pl(nbLecons, '', 's') + ' in this chat')
      const libMemoire = kt('Mémoire', 'Memory')
      const notesTip = [libMemoire, memDit, lesDit, delta > 0 ? kt(delta + ' ' + (delta === 1 ? 'écrit' : 'écrits') + ' par cette conversation', delta + ' written by this chat') : kt('Rien d’écrit par cette conversation pour l’instant', 'Nothing written by this chat yet')]
      const sectionNote = (titre, corps) => h('section', { className: 'kbs-note-sec', key: titre },
        h('h4', { className: 'kbs-note-t' }, titre), corps)
      const MOTS_CAPTURE = { jamais: ['n’a pas tourné depuis le démarrage de DSH', 'has not run since DSH started'], hors_connexion: ['non connecté', 'not connected'], desactivee: ['désactivée', 'switched off'],
        espace_equipe: ['désactivée dans un espace d’équipe', 'off in a team space'], sans_session: ['aucune session', 'no session'], tour_trop_court: ['tour trop court', 'turn too short'],
        llm_indisponible: ['aucun modèle disponible', 'no model available'], rien_a_retenir: ['rien à retenir', 'nothing worth keeping'], deja_connu: ['déjà connu', 'already known'], erreur: ['a échoué', 'failed'] }
      const ditCapture = (c) => c === null || c === undefined || c.status === undefined ? null
        : (c.status === 'ecrit'
          ? kt('a écrit ' + c.facts + ' ' + (c.facts > 1 ? 'souvenirs' : 'souvenir'), 'wrote ' + c.facts + (c.facts === 1 ? ' memory' : ' memories'))
          : (MOTS_CAPTURE[c.status] !== undefined ? kt(MOTS_CAPTURE[c.status][0], MOTS_CAPTURE[c.status][1]) : String(c.status)))
      const ligneSouvenir = (x, i) => h('div', { className: 'kbs-memo-row', key: 'sv' + i },
        h('div', { className: 'kbs-memo-head' }, h('span', { className: 'kbs-memo-kind' }, kt('souvenir enregistré', 'memory saved')), h('span', null, (x.kind || '?') + (x.pinned ? kt(' · épinglé', ' · pinned') : '') + (x.ts ? ' · ' + court(x.ts) : ''))),
        h('p', null, x.text || '—'))
      const pct = memInfo !== null && memInfo.total > 0 ? Math.max(2, Math.round(memInfo.sent / memInfo.total * 100)) : 0
      const visuelMem = h('div', { className: 'kbs-memwrap' },
        memInfo === null
          ? h('div', { className: 'kbs-vide' }, kt('La mémoire du compte n’est pas disponible ici : connecte Kybernos Cloud, ou active son plugin.', 'The account memory is not available here: connect Kybernos Cloud, or switch its plugin on.'))
          : h('div', null,
              h('div', { className: 'kbs-meter', role: 'img', 'aria-label': kt(memInfo.sent + ' sur ' + memInfo.total, memInfo.sent + ' of ' + memInfo.total) }, h('i', { style: { width: pct + '%' } })),
              h('p', { className: 'kbs-note-line' }, memInfo.actif === false
                ? kt('La mémoire est désactivée : rien n’est envoyé au modèle.', 'Memory is switched off: nothing is sent to the model.')
                : kt(memInfo.sent + ' sur ' + memInfo.total + ' · ' + memInfo.used + ' / ' + memInfo.cap + ' caractères · les plus récents d’abord, une part réservée aux épinglés',
                  memInfo.sent + ' of ' + memInfo.total + ' · ' + memInfo.used + ' / ' + memInfo.cap + ' characters · newest first, pinned ones reserved a share')),
              memInfo.picked > 0 && memInfo.actif !== false ? h('p', { className: 'kbs-note-line', 'data-kbs': 'picked' },
                kt((memInfo.picked > 1 ? 'Retenus' : 'Retenu') + ' pour ton dernier message : ' + memInfo.picked + ' ' + (memInfo.picked > 1 ? 'souvenirs' : 'souvenir') + ' qui y ' + (memInfo.picked > 1 ? 'correspondent' : 'correspond'),
                  'Picked for your latest message: ' + memInfo.picked + (memInfo.picked === 1 ? ' memory' : ' memories') + ' that match it')) : null,
              ditCapture(memInfo.capture) !== null ? h('p', { className: 'kbs-note-line' }, kt('Capture automatique : ', 'Auto-capture: ') + ditCapture(memInfo.capture)) : null),
        sectionNote(kt('Écrit par cette conversation', 'Written by this chat'), ecritsMem === 0 && memFaites.length === 0
          ? h('div', { className: 'kbs-vide' }, kt('Rien pour l’instant. Les souvenirs sont capturés à la fin d’un tour, ou enregistrés par l’agent.', 'Nothing yet. Memories are captured at the end of a turn, or saved by the agent.'))
          : h('div', { className: 'kbs-memo' }, memoire.souvenirs.slice(-3).map(ligneSouvenir).concat(memFaites.slice(-3).map(ligneMemo)))))
      const visuelLecons = h('div', { className: 'kbs-memwrap' },
        lesPicked > 0 ? h('p', { className: 'kbs-note-line', 'data-kbs': 'picked-lessons' }, kt((lesPicked > 1 ? 'Retenues' : 'Retenue') + ' pour ton dernier message : ' + lesPicked + ' ' + (lesPicked === 1 ? 'leçon' : 'leçons') + ' qui y ' + (lesPicked > 1 ? 'correspondent' : 'correspond'),
          'Picked for your latest message: ' + lesPicked + (lesPicked === 1 ? ' lesson' : ' lessons') + ' that match it')) : null,
        teamSent !== null ? h('p', { className: 'kbs-note-line', 'data-kbs': 'team-lessons' },
          kt('De ton équipe : ' + teamSent.count + ' ' + (teamSent.count === 1 ? 'leçon envoyée' : 'leçons envoyées') + (teamSent.picked > 0 ? ' (' + teamSent.picked + ' qui ' + (teamSent.picked > 1 ? 'correspondent' : 'correspond') + ' à ton dernier message)' : ''),
            'From your team: ' + teamSent.count + (teamSent.count === 1 ? ' lesson' : ' lessons') + ' sent' + (teamSent.picked > 0 ? ' (' + teamSent.picked + ' that match your latest message)' : ''))) : null,
        sectionNote(kt('Leçons de cette conversation', 'Lessons in this chat'), nbLecons === 0
          ? h('div', { className: 'kbs-vide' }, kt('Rien d’appris ni de réutilisé dans cette conversation pour l’instant.', 'Nothing learned or reused in this chat yet.'))
          : h('div', { className: 'kbs-lessons' }, leconsSession.slice(0, 3).map(ligneLecon))))
      const titreMemLecons = kt('Mémoire & Leçons', 'Memory & Lessons') // the name of the Settings page (kybernos-memory words it the same way)
      const notesPop = h(Pop, { idCarte: 'notes', name: titreMemLecons, icon: 'brain', accent: notesAccent,
        titre: onglet === 'mem' ? memDit : lesDit.charAt(0).toUpperCase() + lesDit.slice(1),
        texte: onglet === 'mem'
          ? kt('Ce que le compte retient sur toi, et ce qui arrive au modèle à chaque tour. Seul ce qu’a écrit CETTE conversation est listé — les autres conversations n’apparaissent jamais ici.',
            'What the account remembers about you, and what reaches the model on each turn. Only what THIS chat wrote is listed — other chats never appear here.')
          : kt('Les leçons sont écrites par un agent quand une attente a été contredite. Seules celles de cette conversation sont listées.', 'Lessons are written by an agent when an expectation was contradicted. Only this chat’s are listed.'),
        nav: h('div', { className: 'kbs-kybers', role: 'tablist', 'aria-label': kt('Mémoire et leçons', 'Memory and lessons') },
          [['mem', libMemoire], ['les', kt('Leçons', 'Lessons')]].map((t) => h('button', { key: t[0], role: 'tab', 'aria-selected': String(onglet === t[0]), 'data-kbs-tab': t[0],
            className: 'kbs-kyb' + (onglet === t[0] ? ' on' : ''), onClick: () => setOnglet(t[0]) }, t[1]))),
        visuel: h('div', null, onglet === 'mem' ? visuelMem : visuelLecons, onglet === 'les' ? switcher : null),
        action: h('div', { className: 'kbs-minirow' },
          h('button', { className: 'kbs-minibtn', 'data-kbs-act': 'open-memory', onClick: () => { fermer('notes'); ouvrirReglagesSection(titreMemLecons) } }, kt('Ouvrir Mémoire & Leçons ›', 'Open Memory & Lessons ›'))),
        onClose: () => fermer('notes'),
        details: h('div', null,
          sectionNote(kt('Registre de l’Agent Team', 'Agent Team ledger'), h('div', { className: 'kbs-memo' }, memFaites.map(ligneMemo))),
          h('dl', { style: { margin: '10px 0 0', display: 'flex', flexDirection: 'column', gap: 9 } },
            Ligne(kt('Exécutions enregistrées', 'Runs recorded'), String(memoire.records.length), 'rb'),
            Ligne(kt('Leçons écrites', 'Lessons written'), String(memoire.lessons.length), 'lb'),
            Ligne(kt('Leçons réutilisées', 'Lessons reused'), String(memoire.used.length), 'ub'),
            Ligne(kt('Souvenirs enregistrés', 'Memories saved'), String(memoire.souvenirs.length), 'mb'),
            Ligne(kt('Stockage', 'Storage'), h('code', { className: 'kbs-code-in' }, '~/.dsh/kybers/' + (kyber || '<kyber>') + '/memory'), 'st')),
          h(Copier, { key: 'cpm', texte: 'memory written in this chat\n' + memoire.souvenirs.map((x) => '- memory saved [' + (x.kind || '?') + '] ' + x.text).concat(memFaites.map((x) => '- ' + libelleMemo(x) + ' [' + (x.kyber || '?') + '] ' + (texteMemo(x) || ''))).join('\n') }),
          h(Copier, { key: 'cpl', texte: (kyber || 'agent team') + ' — lessons from this chat\n' + leconsSession.map((l) => '- ' + libelleMemo(l) + ' ' + (l.type === 'lesson' ? l.text : 'lesson #' + l.index)).join('\n') })) })

      const carte = (id) => {
        if (id === 'local') return h(Pop, { idCarte: 'local', name: 'Local', icon: 'laptop', accent: w.accent, titre: w.titre, texte: w.texte,
          visuel: w.steps ? h(Stepper, { labels: ['Saved', 'In the project'], steps: w.steps }) : null,
          action: w.action, details: w.details, onClose: () => fermer(id) })
        if (id === 'recap') return h(Pop, { idCarte: 'recap', name: 'Recap', icon: 'merge', accent: rec.accent,
          titre: 'Where this chat stands',
          texte: 'What is done, what is not, and whether this chat can be closed. The action below stays on this machine.',
          visuel: h(RecapCard, { s: s, sessionId: sessionId, travail: travail }),
          onClose: () => fermer(id) })
        if (id === 'sync') return h(Pop, { idCarte: 'sync', name: 'GitHub', icon: 'cloud', accent: v.accent, titre: v.titre, texte: v.texte,
          visuel: h('div', null,
            (s && g.worktree) ? h('p', { className: 'kbs-note-line' }, 'Your separate copy stays on your computer (normal): only the main project goes to GitHub.') : null,
            v.visuel),
          action: v.act,
          details: h('dl', { style: { margin: 0, display: 'flex', flexDirection: 'column', gap: 9 } }, v.details),
          onClose: () => fermer(id) })
        if (id === 'pr') return h(Pop, { idCarte: 'pr', name: 'Review request', icon: 'pr', accent: r.accent, titre: r.titre, texte: r.texte,
          visuel: r.steps ? h(Stepper, { labels: ['Sent', 'Checks', 'Approved', 'Merged'], steps: r.steps }) : null,
          action: r.act, details: r.details
            ? h('dl', { style: { margin: 0, display: 'flex', flexDirection: 'column', gap: 9 } }, r.details)
            : null, onClose: () => fermer(id) })
        return notesPop
      }

      const pill = (id, icon, accent, label, badge, tip, act, calme, opts) => {
        // The pill that sticks to the right edge anchors bubble AND card on the right: centred,
        // its card left the window (960 px for a viewport of 900 — measured).
        const bordDroit = id === 'notes'
        const props = {
          className: 'kbs-pill' + (act === true ? ' kbs-pill--act' : '') + (calme === true ? ' kbs-pill--calme' : '') +
            (bordDroit ? ' kbs-pill--bordDroit' : ''),
          style: { '--acc': accent }, 'data-kbs-pill': id,
          // The accessible name carries the word the eye no longer sees, plus the
          // number when there is one (without it, a screen reader would only have
          // a « 21 » with no subject).
          'aria-label': badge === null || badge === undefined ? label : label + ' · ' + badge,
          'aria-haspopup': 'dialog', 'aria-expanded': String(ouverte === id),
          'aria-controls': 'kbs-carte-' + id,
          onClick: () => bascule(id)
        }
        // The local gesture is marked as such: « commit & merge » is not one more
        // state, it is a button — the row says so to whoever reads it.
        if (act === true) props['data-kbs-quick'] = 'commit-merge'
        // The word of the pill comes back at the head of the bubble: that is where one looks
        // on hover, and the label is no longer painted on the row.
        // No line is lost — the first one is prefixed, not replaced.
        const lignes = tip.slice(0)
        if (lignes.length === 0) lignes.push(label)
        else if (lignes[0] !== label) lignes[0] = label + ' · ' + lignes[0]
        return h('span', { className: 'kbs-popwrap' + (bordDroit ? ' kbs-bordDroit' : ''), key: id },
          h('button', props,
            h('span', { className: 'kbs-ico' }, svg(icon, 15)),
            h('span', { className: 'kbs-lib' + (opts && opts.libelleVisible === true ? ' kbs-lib--vis' : '') }, label),
            badge !== null && badge !== undefined
              ? h('span', { className: 'kbs-n' }, String(badge))
              : null,
            opts && opts.extra ? opts.extra : null,
            h('span', { className: 'kbs-tip kbm-tip-bubble', role: 'tooltip' }, lignes.join('\n'))),
          ouverte === id ? carte(id) : null)
      }

      // What has nothing to say keeps quiet: the pill steps back instead of
      // painting its state. Whitelist of the « nothing to do » states — a new
      // state is therefore never switched off by accident.
      const MUETTES = new Set(['Saved', 'Outside git', 'No folder', 'Up to date', 'No remote', 'Recap', 'No review'])
      const calme = (o, badge) => o !== null && o !== undefined &&
        (badge === null || badge === undefined) && MUETTES.has(o.label)

      return h(React.Fragment, null,
        changesOn ? null : pill('local', 'laptop', w.accent, w.label, null, wTip, false, calme(w, null)),
        changesOn ? null : pill('recap', 'merge', rec.accent, rec.label, null, rec.tip, rec.act, calme(rec, null)),
        !changesOn && v ? pill('sync', 'cloud', v.accent, v.label, vBadge, vTip, false, calme(v, vBadge)) : null,
        !changesOn && r ? pill('pr', 'pr', r.accent, r.label, null, rTip, false, calme(r, null)) : null,
        pill('notes', 'brain', notesAccent, libMemoire, memBadge, notesTip, false, rien,
          { libelleVisible: true, extra: h(React.Fragment, null, h('span', { className: 'kbs-pillsep' }), svg('bulb', 15), h('span', { className: 'kbs-n' }, String(nbLecons)),
            delta > 0 ? h('span', { className: 'kbs-d' }, '+' + delta) : null) }))
    }

    // ── « Kybernos Settings » page (Settings popup) ──────────────────────
    // Settings, written host side in ~/.dsh/kybernos/settings.json — the
    // file read by the naming CLI and the health check. Without it,
    // a switch would only be GUI decoration.
    let kbCtx = null

    /** The CONFIGURED models, read from the harness settings service — the same
     *  source as the Models page, so never copied here. Each route carries
     *  EITHER `models[]` OR `modelOverrides.<id>`: the harness refuses both
     *  together. Returns `null` if the list is unreadable (and not `[]`, which means
     *  « no model configured »): mixing the two up would make people think of an
     *  empty harness. */
    const kbModeles = () => {
      try {
        const svc = (kbCtx === null || typeof kbCtx.get !== 'function') ? null : kbCtx.get('remote.settings')
        if (svc === null || svc === undefined || typeof svc.describe !== 'function') return Promise.resolve(null)
        return svc.describe().then((resp) => {
          if (resp === null || resp === undefined || resp.ok !== true) return null
          const v = (resp.value === null || resp.value === undefined) ? {} : resp.value
          const ns = (Array.isArray(v.namespaces) ? v.namespaces : []).filter((n) => n !== null && n !== undefined && n.ns === 'llm-pi-ai')[0]
          if (ns === undefined) return []
          const prov = (ns.value !== null && ns.value !== undefined && typeof ns.value.providers === 'object') ? ns.value.providers : {}
          const vus = {}
          const out = []
          // `entree`: the declared modalities (a wired field of the catalogue). The
          // health probe uses it so as not to ping an image model with
          // text — the Study model setting ignores this field.
          const ajouter = (route, id, entree) => {
            if (typeof route !== 'string' || route.length === 0 || typeof id !== 'string' || id.length === 0) return
            const cle = route + '/' + id
            if (vus[cle] === true) return
            vus[cle] = true
            out.push({ route, id, cle, entree: Array.isArray(entree) ? entree : null })
          }
          for (const route of Object.keys(prov)) {
            const prof = (prov[route] !== null && typeof prov[route] === 'object') ? prov[route] : {}
            for (const mo of (Array.isArray(prof.models) ? prof.models : [])) {
              if (mo !== null && typeof mo === 'object') ajouter(route, mo.id, mo.input)
            }
            const ov = (prof.modelOverrides !== null && typeof prof.modelOverrides === 'object') ? prof.modelOverrides : {}
            for (const id of Object.keys(ov)) {
              const ro = (ov[id] !== null && typeof ov[id] === 'object') ? ov[id] : {}
              ajouter(route, id, ro.input)
            }
          }
          out.sort((a, b) => (a.route === b.route
            ? (a.id < b.id ? -1 : (a.id > b.id ? 1 : 0))
            : (a.route < b.route ? -1 : 1)))
          return out
        }).catch(() => null)
      } catch (e) { return Promise.resolve(null) }
    }

    // ── « Kybernos only » organisation of the Settings dialog (variant D) ──
    // Zero core patch: the nav is put back in order INSIDE the DOM (the observ-
    // er heals it when the shell redraws it), « My space » is hidden
    // (it has its own page in the panel), and the rows of the General pane already
    // covered by Theme are not doubled.
    // MULTILINGUAL by construction: the host's locale (fr, en, Arabic RTL,
    // added languages…) decides the texts — so the recognition reads
    // NO label, it reasons in POSITIONS of the native list, which are stable
    // (the order comes from the slot registry, not from the language). MEASUREMENT of the
    // 0.2.0-rc.2 shell (01/10, native nav read in the DOM, 13 buttons):
    // REAL measurement in the DOM (01/10, first placement corrected by reading the
    // render — the assumed order was off):
    // 0 General · 1 Models · 2 Account · 3 Privacy · 4 Appearance ·
    // 5 Maintenance · 6 Built-in plugins · 7 Provider & models ·
    // 8 Agent presets · 9 Voice · 10 Commands · 11 Tools · 12 Plugins.
    // The old plan (My space hidden, Extensions header with IM bots)
    // no longer matched: orphan headers and badly distributed buttons.
    const RG_NB = 13
    // Kybernos: General (block) · Account · Privacy · Appearance · Provider ·
    // Voice · Maintenance — DSH: Commands · Models · Built-in · Plugins ·
    // Tools · Agent presets.
    const RG_TRI = [0, 2, 3, 4, 7, 9, 5, 10, 1, 6, 12, 11, 8] // order D in native positions
    const RG_ENTETES = [[0, 'Kybernos'], [7, 'DSH']] // in the SORTED order
    const RG_CACHEE = -1 // rc.2: no item left to hide (My space left the nav)
    // Rows of the General pane that are hidden (positions, a list of 10 children of which
    // the first is OUR block marked data-kbr="bloc"):
    // 2 Language · 3 Appearance · 4 Font size · 9 version footer.
    const RG_VOLET_CACHEES = [3, 4, 9]
    const rgTries = new WeakMap() // list → sorted buttons (detection of a React re-sort)
    const RG_STYLE_ID = 'kbr-reglages-style'

    function rgStyle () {
      if (document.getElementById(RG_STYLE_ID) !== null) return
      const el = document.createElement('style')
      el.id = RG_STYLE_ID
      el.textContent = '.kb-rg-groupe{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;opacity:.55;padding-block:14px 4px;padding-inline:12px;text-align:start;user-select:none;pointer-events:none}[dir="rtl"] .kb-rg-groupe{letter-spacing:0}'
      document.head.appendChild(el)
    }

    function rgRenommerGeneral (bouton) {
      if (bouton.dataset.kbRenomme === '1') return
      // The language of the interface decides (the same resolver as every label here): only a French UI gets « Général »;
      // English, and any language without a French twin, keep the shell's own « General » (reported 01/10: do not repaint
      // the tab in French when the user chose English — and no language at all is English, never French).
      const GENERAL = ['Général', 'General'] // [fr, en]
      const general = kt(GENERAL[0], GENERAL[1])
      if (general !== GENERAL[0]) { bouton.dataset.kbRenomme = '1'; return }
      const marche = [...bouton.childNodes].find((n) => n.nodeType === 3 && n.nodeValue !== null && n.nodeValue.trim() === 'General')
      if (marche === undefined) {
        // The label may live in a descendant: the last bare text that is equal.
        const tous = [...bouton.querySelectorAll('*')].flatMap((e) => [...e.childNodes])
        const profond = tous.find((n) => n.nodeType === 3 && n.nodeValue !== null && n.nodeValue.trim() === 'General')
        if (profond === undefined) return
        profond.nodeValue = profond.nodeValue.replace('General', general)
      } else {
        marche.nodeValue = marche.nodeValue.replace('General', general)
      }
      bouton.dataset.kbRenomme = '1'
    }

    function rgEnOrdre (liste) {
      const memo = rgTries.get(liste)
      if (memo === undefined) return false
      const visibles = [...liste.querySelectorAll(':scope > button')].filter((b) => b.style.display !== 'none')
      if (visibles.length !== memo.length) return false
      for (let i = 0; i < visibles.length; i++) if (visibles[i] !== memo[i]) return false
      let entetes = 0
      for (const el of liste.children) if (el.getAttribute('data-kb-groupe') !== null) entetes++
      return entetes === RG_ENTETES.length
    }

    function rgAppliquerNav (liste) {
      const boutons = [...liste.querySelectorAll(':scope > button')]
      if (boutons.length !== RG_NB) return // unexpected structure: undo nothing
      if (liste.dataset.kbReglages === '1' && rgEnOrdre(liste)) return
      const tries = RG_TRI.map((pos) => boutons[pos])
      for (const vieux of [...liste.querySelectorAll('[data-kb-groupe]')]) vieux.remove()
      if (RG_CACHEE >= 0) {
        const cache = boutons[RG_CACHEE]
        cache.style.display = 'none'
        liste.appendChild(cache)
      }
      rgRenommerGeneral(boutons[0])
      for (let i = 0; i < tries.length; i++) {
        for (const couple of RG_ENTETES) {
          if (couple[0] === i) {
            const entete = document.createElement('div')
            entete.setAttribute('data-kb-groupe', couple[1])
            entete.className = 'kb-rg-groupe'
            entete.textContent = couple[1]
            liste.appendChild(entete)
          }
        }
        liste.appendChild(tries[i])
      }
      rgTries.set(liste, tries)
      liste.dataset.kbReglages = '1'
    }

    function rgAppliquerVolet (dialogue) {
      // (29/09) The « Current version: … » footer now lives in the
      // Maintenance page: it is hidden by its text, WITHOUT the guard of the 10 children
      // (the shell's structure evolves and let the line escape).
      dialogue.querySelectorAll('div').forEach((d) => {
        const t = (d.textContent || '').trim()
        if (/^Current version:/.test(t) === true && t.length < 40 && d.style.display !== 'none') d.style.display = 'none'
      })
      const volet = dialogue.querySelector('[data-slot="settings.section"]')
      if (volet === null) return
      const bloc = volet.querySelector('[data-kbr="bloc"]')
      if (bloc === null) return // the General pane is not mounted (or not yet)
      const liste = bloc.parentElement
      // The list must have exactly 10 children, ours first — otherwise
      // (another version of the shell) nothing is hidden, to be safe.
      if (liste === null || liste.children.length !== 10 || liste.children[0] !== bloc) return
      const pied = liste.children[9]
      // (29/09) The native « Current version » footer stays hidden (row 9); its
      // value lives in the Maintenance page (State card: Engine · Plugin) —
      // no more copying into a span of General.
      if (pied !== undefined && pied !== null && pied.style.display !== 'none') pied.style.display = 'none'
      for (const pos of RG_VOLET_CACHEES) {
        const rangee = liste.children[pos]
        if (rangee.style.display !== 'none') rangee.style.display = 'none'
      }
    }

    function orchestrerReglages () {
      if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return () => {}
      rgStyle()
      let programmé = false
      const passe = () => {
        programmé = false
        try {
          const dialogues = document.querySelectorAll('[role="dialog"]')
          const dialogue = dialogues.length ? dialogues[dialogues.length - 1] : null
          if (dialogue === null) return
          const liste = dialogue.querySelector('[class*="navList"]')
          if (liste !== null) rgAppliquerNav(liste)
          rgAppliquerVolet(dialogue)
        } catch (e) { /* the dialog moves under our feet: the next pass will firm it up */ }
      }
      const demander = () => {
        if (programmé) return
        programmé = true
        setTimeout(passe, 120)
      }
      const observateur = new MutationObserver(demander)
      observateur.observe(document.body, { childList: true, subtree: true })
      // Guardian: the shell may re-sort its nav at a commit following our
      // pass — with no later mutation, the observer would not start again.
      // One pass per second while a dialog is open (14 nodes: negligible).
      const gardien = setInterval(passe, 1000)
      return () => { observateur.disconnect(); clearInterval(gardien) }
    }

    /** What the settings route refuses with, by its stable `code` ([fr, en]): the page words a refusal itself, in its own
     *  language, and never prints the host's sentence raw. A code it does not know shows the host's English sentence. */
    const ERR_REGLAGES = {
      'invalid-brain': ['Le modèle d’étude doit être un identifiant « fournisseur/modèle », « none » ou vide.', 'The Study model must be a “provider/model” identifier, “none” or empty.'],
      'invalid-voice-input': ['La source du micro doit être « native » ou « kybernos ».', 'The microphone source must be “native” or “kybernos”.'],
      'invalid-auto-whitelist': ['La liste Auto doit être un tableau d’identifiants « fournisseur/modèle », sans doublon.', 'The Auto list must be an array of “provider/model” identifiers, without duplicates.'],
      'settings-unreadable': ['settings.json est illisible : rien n’a été enregistré.', 'settings.json cannot be read, so nothing was saved.'],
      'settings-corrupt': ['settings.json n’est pas un objet JSON valide : rien n’a été enregistré. Corrige ou supprime le fichier, puis enregistre à nouveau.', 'settings.json is not a valid JSON object, so nothing was saved. Fix or remove the file, then save again.'],
      'settings-not-written': ['Le fichier de réglages n’a pas pu être écrit', 'The settings file could not be written']
    }
    const direErreur = (j) => {
      const code = j !== null && typeof j === 'object' && typeof j.code === 'string' ? j.code : ''
      if (Object.prototype.hasOwnProperty.call(ERR_REGLAGES, code)) {
        const paire = ERR_REGLAGES[code]
        // The system's own words (the reason a file could not be written) follow, untranslated.
        return kt(paire[0], paire[1]) + (code === 'settings-not-written' && typeof j.erreur === 'string' ? ' (' + j.erreur + ')' : '')
      }
      return j !== null && typeof j === 'object' && j.erreur ? String(j.erreur) : kt('Refusé par l’hôte.', 'Rejected by the host.')
    }

    /** The Study model row: what the select shows and says. Pure (the tests run it without a browser).
     *  `etude` is what the host says is in force (`mode`: choisi, auto, none or aucun; `auto`: the model Automatic uses, or
     *  ''); an older host sends none, and the row then reads from the setting alone. `modeles` is the configured list
     *  (null/undefined when unreadable: then nothing is claimed about a saved pick). */
    const etudeVue = (reglages, etude, modeles) => {
      const brain = reglages !== null && reglages !== undefined && typeof reglages.brain === 'string' ? reglages.brain : ''
      const mode = brain === 'none' ? 'none' : (brain === '' ? 'auto' : 'choisi')
      const info = etude !== null && etude !== undefined && typeof etude === 'object' ? etude : {}
      const cleAuto = typeof info.auto === 'string' && info.auto !== '' ? info.auto : (mode === 'auto' && typeof info.cle === 'string' ? info.cle : '')
      const libelleAuto = cleAuto !== ''
        ? kt('Automatique — ', 'Automatic — ') + cleAuto
        : (info.mode !== undefined ? kt('Automatique — aucun modèle n’est encore connecté', 'Automatic — no model is connected yet') : kt('Automatique', 'Automatic'))
      const introuvable = mode === 'choisi' && Array.isArray(modeles) && !modeles.some((mo) => mo.cle === brain)
      const role = kt('Il vérifie que tes modèles répondent toujours, aide à ranger ta mémoire, et décide quelle équipe d’agents et quelle icône de conversation conviennent. ',
        'It checks that your models still answer, helps tidy your memory, and decides which agent team and which chat icon fit. ')
      const envoi = kt('Le titre d’une conversation ne lui est envoyé que si les règles de mots ne savent pas la classer, et il reste sur cet ordinateur si c’est un modèle local.',
        'A chat title goes to it only when the word rules cannot place it, and stays on this machine if it is a local model.')
      let description
      if (mode === 'none') {
        description = kt('Aucun : aucun modèle n’est surveillé, aucune alerte de santé n’est levée, et rien n’est envoyé à un modèle pour ces questions — les règles de mots choisissent seules les icônes de conversation.',
          'None: no model is watched, no health warning is raised, and nothing is sent to a model for those questions — the word rules alone pick chat icons.')
      } else if (mode === 'auto') {
        description = cleAuto !== ''
          ? kt('Automatique : utilise ' + cleAuto + ', choisi parmi ce que tu as connecté. ', 'Automatic: using ' + cleAuto + ', picked from what you connected. ') + role + envoi
          : kt('Automatique : aucun modèle n’est encore connecté, donc rien n’est surveillé et les règles de mots choisissent seules les icônes de conversation. Connecte Kybernos Cloud, un de tes modèles ou un modèle local, et ça démarre tout seul.',
            'Automatic: no model is connected yet, so nothing is watched and the word rules alone pick chat icons. Connect the Kybernos Cloud, a model of yours or a local one, and it starts by itself.')
      } else description = kt('Ton choix. ', 'Your pick. ') + role + envoi
      return { mode, valeur: brain, libelleAuto, introuvable, description }
    }

    function ReglagesKybernos (...args) {
      try { return ReglagesCorps.apply(this, args) }
      catch (e) { window.__kbrPile = String((e && e.stack) || e).slice(0, 900); return h('div', { className: 'kbr-page', 'data-kbr': 'bloc' }, kt('Erreur : ', 'Error: ') + String(e).slice(0, 140)) }
    }
    function ReglagesCorps () {
      const [reglages, setReglages] = React.useState(null)
      const [erreur, setErreur] = React.useState(null)
      const [enregistre, setEnregistre] = React.useState(false)
      // `undefined` = list loading; `null` = list unreadable; array = the models.
      const [modeles, setModeles] = React.useState(undefined)
      // The Study model in force, as the host says it (`{actif, cle, mode, auto}`); `null` when the host does not say (an older
      // build) or cannot be reached.
      const [etude, setEtude] = React.useState(null)
      const autoDefauts = () => ({ renameAfterRecap: true, brain: '', voiceInput: 'kybernos' })
      // `undefined` = sonde en cours ; `null` = configuration illisible ; objet = `asr`.
      // Used ONLY to tell the truth when Kybernos is chosen but its
      // dictation is not ready: in that case the native microphone stays shown.
      // (29/09) The microphone setting lives in the Voice page of the plugin bundle —
      // this probe is no longer consumed here.
      React.useEffect(() => {
        poserCss()
        fetch('/kybernos-sessions/settings')
          .then((r) => r.json())
          .then((j) => {
            setReglages(j && j.reglages && typeof j.reglages === 'object' ? j.reglages : autoDefauts())
            setEtude(j && j.etude && typeof j.etude === 'object' ? j.etude : null)
          })
          .catch(() => { setReglages(autoDefauts()); setErreur(kt('Route des réglages injoignable — la valeur affichée est celle par défaut.', 'Settings route unreachable — the value shown is the default.')) })
        kbModeles().then((l) => setModeles(l))
      }, [])
      // NATIVE classes of the shell, copied live from a neighbouring row of the
      // same pane: our rows inherit the exact native CSS (typography, width,
      // alignment, RTL, theme) without recoding anything — and without breaking if DSH
      // renames its classes, since we copy again at every mount.
      const [natif, setNatif] = React.useState(null)
      React.useEffect(() => {
        try {
          const bloc = document.querySelector('[data-kbr="bloc"]')
          const liste = bloc && bloc.parentElement
          const source = liste ? [...liste.children].find((el) => el !== bloc && el.firstElementChild && el.firstElementChild.firstElementChild) : null
          if (!source) return
          const texte = source.firstElementChild
          const sel = source.querySelector('button, select')
          const carte = {
            row: typeof source.className === 'string' ? source.className : '',
            rowText: typeof texte.className === 'string' ? texte.className : '',
            title: texte.children[0] && typeof texte.children[0].className === 'string' ? texte.children[0].className : '',
            desc: texte.children[1] && typeof texte.children[1].className === 'string' ? texte.children[1].className : '',
            ctrl: source.lastElementChild !== texte && typeof source.lastElementChild.className === 'string' ? source.lastElementChild.className : '',
            sel: sel && typeof sel.className === 'string' ? sel.className : ''
          }
          if (carte.row && carte.rowText && carte.title && carte.desc) setNatif(carte)
        } catch (e) { /* outside the pane: the kbr fallback stays */ }
      }, [])
      if (reglages === null) return h('div', { className: 'kbr-page', 'data-kbr': 'bloc' }, '…')
      const oui = reglages.renameAfterRecap !== false
      // One writing path for every setting, so one place to read a refusal.
      const relireEtude = () => {
        fetch('/kybernos-sessions/settings').then((r) => r.json()).then((j) => { if (j && j.etude && typeof j.etude === 'object') setEtude(j.etude) }).catch(() => { /* the row keeps what it had */ })
      }
      const ecrire = (patch) => {
        setErreur(null)
        fetch('/kybernos-sessions/settings', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch)
        }).then((r) => r.json()).then((j) => {
          if (j && j.ok === true && j.reglages) {
            setReglages(j.reglages)
            // An OLDER host ignores a setting it does not know: say so, instead of
            // showing « Saved » on a file that took nothing (the setting would not
            // survive a reload of the page).
            const perdus = Object.keys(patch).filter((k) => j.reglages[k] === undefined)
            if (perdus.length > 0) {
              setErreur(kt('L’hôte n’a pas pris ce réglage (' + perdus.join(', ') + ') — il tourne sur une ancienne version : redémarre DSH pour l’appliquer pour de bon.',
                'The host did not take this setting (' + perdus.join(', ') + ') — it is running an older build: restart DSH to apply it for good.'))
            } else {
              setEnregistre(true)
              setTimeout(() => setEnregistre(false), 1600)
            }
            // The composer lives in ANOTHER client bundle (`@local/kybernos`):
            // without this announcement, changing the microphone source here would
            // only show after a page reload. Same window, same origin.
            try { window.dispatchEvent(new CustomEvent('kybernos:settings', { detail: j.reglages })) } catch (e) { /* context without a window */ }
            if (patch.brain !== undefined) relireEtude()
          } else setErreur(direErreur(j))
        }).catch((e) => setErreur(String(e && e.message ? e.message : e)))
      }
      const changer = (v) => { setReglages(Object.assign({}, reglages, { renameAfterRecap: v })); ecrire({ renameAfterRecap: v }) }
      const changerBrain = (v) => { setReglages(Object.assign({}, reglages, { brain: v })); ecrire({ brain: v }) }
      const choix = (valeur, mot, actif) => h('button', {
        type: 'button', className: 'kbr-choix' + (actif ? ' on' : ''),
        'data-valeur': valeur, 'aria-pressed': String(actif),
        onClick: () => changer(valeur === 'yes')
      }, mot)
      // The Study model row: three states (Automatic, a pick, None), read by the pure `etudeVue`.
      const vue = etudeVue(reglages, etude, modeles)
      const brain = vue.valeur
      const groupes = []
      if (Array.isArray(modeles)) {
        const parRoute = {}
        for (const mo of modeles) { if (parRoute[mo.route] === undefined) parRoute[mo.route] = []; parRoute[mo.route].push(mo) }
        for (const route of Object.keys(parRoute).sort()) {
          groupes.push(h('optgroup', { key: route, label: route },
            parRoute[route].map((mo) => h('option', { key: mo.cle, value: mo.cle }, mo.id))))
        }
      }
      return h('div', { className: 'kbr-page', 'data-kbr': 'bloc' },
        // (28/09, audit) 26px page title like Theme/Maintenance/Tools —
        // the native h4 (16px) was the only small page title of the dialog.
        h('div', { style: { display: 'flex', justifyContent: 'flex-end', width: '100%', marginBottom: 6 } }, (typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Help ? h(window.__KB_HELP__.Help, { id: 'kybernos-sessions' }) : null)),
        h('h4', { className: 'kb6-title', style: { fontSize: natif ? undefined : '26px' } }, kt('Réglages Kybernos', 'Kybernos Settings')),
        // ── at the very top: replay the onboarding ───────────────────────────
        // The wizard lives in the @local/kybernos bundle: we only emit the
        // window event it listens to — it POSTs {action:'replay'} to the host
        // and reopens its pages. No new CSS: the kbr-row / kbr-choix classes of
        // this page are enough.
        h('div', { className: natif ? natif.row : 'kbr-row', 'data-kbr': 'onboarding-replay' },
          h('div', { className: natif ? natif.rowText : 'kbr-txt' },
            h('div', { className: natif ? natif.title : undefined }, kt('Premiers pas', 'Onboarding')),
            h('div', { className: natif ? natif.desc : undefined }, kt('Les pages d’accueil sont passées à l’installation du plugin. Rejoue-les pour refaire ta profession, ton mode d’affichage, tes modèles et ton kit de départ.',
              'The welcome pages ran when the plugin was installed. Replay them to redo your profession, display mode, models and starter kit.'))),
          h('button', {
            type: 'button', className: 'kbr-choix on', 'data-kbr': 'onboarding-replay-btn',
            onClick: () => { try { window.dispatchEvent(new CustomEvent('kybernos:onboarding', { detail: { action: 'replay' } })) } catch (e) { /* context without a window */ } }
          }, kt('Rejouer', 'Replay'))),
        // The kit alone, later: the wizard's own page opens on the profession saved at the first run.
        h('div', { className: natif ? natif.row : 'kbr-row', 'data-kbr': 'starter-kit' },
          h('div', { className: natif ? natif.rowText : 'kbr-txt' },
            h('div', { className: natif ? natif.title : undefined }, kt('Kit de départ', 'Starter kit')),
            h('div', { className: natif ? natif.desc : undefined }, kt('Des skills et des équipes d’agents qui vont avec ton métier. Ouvre-le quand tu veux pour en ajouter, ou si tu changes de travail.',
              'Skills and agent teams that fit your profession. Open it any time to add more, or after a change of work.'))),
          h('button', {
            type: 'button', className: 'kbr-choix on', 'data-kbr': 'starter-kit-btn',
            onClick: () => { try { window.dispatchEvent(new CustomEvent('kybernos:onboarding', { detail: { action: 'kit' } })) } catch (e) { /* context without a window */ } }
          }, kt('Ouvrir', 'Open'))),
        // The block of switches has its own heading (audit C-06): the sentence below used to introduce Name each chat… / Study model /
        // Permission / Language / Font size with nothing above it to say what the block is.
        h('h5', { className: 'kbr-sub', 'data-kbr': 'behaviour-title' }, kt('Comportement', 'Behaviour')),
        h('p', { className: natif ? natif.desc : 'kbr-intro' }, kt('De petits interrupteurs qui changent la façon dont les plugins Kybernos travaillent avec tes conversations. Enregistrés sur cet ordinateur, tout de suite.',
          'Small switches that change how the Kybernos plugins work with your chats. Saved on this machine, right away.')),
        h('div', { className: natif ? natif.row : 'kbr-row', 'data-kbr': 'rename-after-recap' },
          h('div', { className: natif ? natif.rowText : 'kbr-txt' },
            h('div', { className: natif ? natif.title : undefined }, kt('Nommer chaque conversation à sa fin', 'Name each chat when it ends')),
            h('div', { className: natif ? natif.desc : undefined }, oui
              ? kt('Activé : quand une session de travail se termine, la conversation reçoit un titre court qui dit ce qui a été fait, et une icône qui lui va.',
                'On: when a work session ends, the chat gets a short title that says what was done, and an icon that fits.')
              : kt('Désactivé : une conversation garde le titre qu’elle a reçu au départ.', 'Off: a chat keeps the title it was given when it started.'))),
          h('div', { className: 'kbr-oui-non' + (natif && natif.ctrl ? ' ' + natif.ctrl : ''), role: 'group', 'aria-label': kt('Nommer chaque conversation à sa fin', 'Name each chat when it ends') },
            choix('yes', kt('Oui', 'Yes'), oui),
            choix('no', kt('Non', 'No'), !oui))),
        /* (29/09) « Composer microphone » now lives in the Voice page of the
           plugin bundle (same setting, same route /kybernos-sessions/settings)
           — next to the speech engine, where people go to look for it. */
        // The select shows « Automatic — <provider/model> »: that sentence must read in full (audit R-V-01, a 240px cap cut it at
        // « no model is conn… »). It takes the width of its longest option, up to the row; when the text beside it would be
        // squeezed (a narrow dialog, a long model id) the row wraps and the select drops under the description.
        h('div', { className: natif ? natif.row : 'kbr-row', 'data-kbr': 'brain', style: { flexWrap: 'wrap' } },
          h('div', { className: natif ? natif.rowText : 'kbr-txt', style: { flex: '1 1 260px' } },
            h('div', { className: natif ? natif.title : undefined }, kt('Modèle d’étude', 'Study model')),
            h('div', { className: natif ? natif.desc : undefined }, vue.description)),
          h('select', {
            className: natif && natif.sel ? natif.sel : 'kbr-select',
            // Recette 2026-10 (C-13/B6): 160px truncated the model names
            // (worse in RTL), and the title lived INSIDE style — never applied.
            // title as an attribute (tooltip = full name), width raised.
            style: { minWidth: '150px', maxWidth: '100%' }, 'data-kbr': 'brain-select', 'aria-label': kt('Modèle d’étude', 'Study model'),
            title: brain === '' ? vue.libelleAuto : brain,
            value: brain,
            disabled: modeles === undefined,
            onChange: (ev) => changerBrain(ev.target.value)
          },
            // Automatic first: it is the default, and it names the model it uses.
            h('option', { value: '' }, vue.libelleAuto),
            // A saved pick that is NOT configured anymore stays shown: otherwise the list would show Automatic while the file
            // says something else — the screen would lie about its own content.
            vue.introuvable ? h('option', { value: brain }, brain + kt(' — n’est plus configuré', ' — not configured anymore')) : null,
            groupes.length > 0 ? h('option', { value: '__autre', disabled: true }, kt('Choisir un autre…', 'Choose another…')) : null,
            groupes,
            h('option', { value: 'none' }, kt('Aucun', 'None')))),
        Array.isArray(modeles) && modeles.length === 0
          ? h('p', { className: 'kbr-note' }, kt('Aucun modèle n’est encore configuré dans Modèles : ajoute-en un là-bas et il apparaîtra dans cette liste.',
            'No model is configured in Models yet: add one there, and it will show up in this list.'))
          : null,
        modeles === null
          ? h('p', { className: 'kbr-note' }, kt('La liste des modèles n’a pas pu être lue — seuls « Automatique » et « Aucun » peuvent être choisis pour le moment.',
            'The model list could not be read from the harness — only “Automatic” and “None” can be chosen right now.'))
          : null,
        erreur !== null ? h('p', { className: 'kbr-err' }, erreur) : null,
        enregistre ? h('p', { className: 'kbr-ok' }, kt('Enregistré ✓', 'Saved ✓')) : null)
        // (29/09) The versions (DSH + Plugin) live in the Maintenance page
        // (State card: « Engine X · Plugin Y ») — no duplicate here.
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Model health — what the "study model" reports.
    //
    // The `brain` setting (Kybernos Settings) names the study model. When it is set, the configured models are
    // probed on the host (one real, tiny call each); a model that no longer answers is reported. Setting empty =
    // nobody is watching: no alert, even when the host is silent — we do not shout about a watch nobody asked for.
    //
    // This bundle owns the PROBE and the state, and draws nothing. The alert lives in the AI Provider & Models tab
    // only (user rule, 26/09/2026): kybernos-models renders it there, as a chip on the tab bar. The two bundles
    // meet on a small public contract, so neither imports the other:
    //   · `window.__kybernosHealth` = { version: 1, get(), recheck(), hide() } — `get()` is the view below, or
    //     `null` when there is nothing to say; `recheck()` forces a new probe; `hide()` silences it for one hour;
    //   · a `kybernos-health` event on `window`, fired after every change (read `get()` again).
    // Either bundle may be absent: without the chip nothing is drawn, without this bus the chip stays hidden.
    // ═══════════════════════════════════════════════════════════════════════════
    const SANTE_INTERVALLE = 18000000 // re-probe every 5 hours
    let santeEtat = null // last verdict from the host
    let santeEnCours = null // one probe at a time, shared
    let santeVerifie = false // a forced re-check is running
    // "Hide" lasts one hour and survives a reload: without that, a page refresh would bring back the alert that
    // was just dismissed.
    const SANTE_SILENCE_MS = 3600000
    const SANTE_CLE_SILENCE = 'kb-sante-silence'
    let santePrevue = false

    /** Failure code → cause id; the chip words each cause. Measured on the real profile: without it the alert lists
     *  nineteen names without saying WHY. */
    const SANTE_CAUSES = {
      UNKNOWN_MODEL: 'gone',
      INVALID_REQUEST: 'refused',
      PI_AI_ERROR: 'refused',
      AUTH: 'key',
      CONTEXT_WINDOW_EXCEEDED: 'text',
      TIMEOUT: 'silent',
      'SANS-REPONSE': 'silent',
      ABORTED: 'silent'
    }
    const santeCause = (code) => (Object.prototype.hasOwnProperty.call(SANTE_CAUSES, code) ? SANTE_CAUSES[code] : 'other')

    /** End of the silence asked for by "Hide" (0 if none). Persisted: a page reload must not bring back what was
     *  just dismissed. */
    const santeSilenceFin = () => {
      try {
        const v = parseInt(String(window.localStorage.getItem(SANTE_CLE_SILENCE) || '0'), 10)
        return isNaN(v) ? 0 : v
      } catch (e) { return 0 }
    }
    const santeEstTaise = () => santeSilenceFin() > Date.now()
    const santeTaire = () => {
      try { window.localStorage.setItem(SANTE_CLE_SILENCE, String(Date.now() + SANTE_SILENCE_MS)) } catch (e) {}
    }
    const santeOublierTaire = () => {
      try { window.localStorage.removeItem(SANTE_CLE_SILENCE) } catch (e) {}
    }

    /** What the chip shows, from a host verdict. `null` = nothing to say: nobody is watching, no model is failing,
     *  or the hour of silence is running. A pure function: the tests run it without a browser. */
    const santeVue = (etat, silenceFin, maintenant) => {
      if (etat === null || etat === undefined || etat.actif !== true) return null
      if (!Array.isArray(etat.alertes) || etat.alertes.length === 0) return null
      if (silenceFin > maintenant) return null
      const alertes = etat.alertes.map((a) => {
        const cle = String(a.cle)
        const coupe = cle.indexOf('/')
        const code = String(a.code || '')
        return {
          cle,
          route: typeof a.route === 'string' && a.route !== '' ? a.route : (coupe < 0 ? cle : cle.slice(0, coupe)),
          id: typeof a.modele === 'string' && a.modele !== '' ? a.modele : (coupe < 0 ? '' : cle.slice(coupe + 1)),
          code,
          cause: santeCause(code)
        }
      })
      return {
        total: Number(etat.total) > 0 ? Number(etat.total) : alertes.length,
        // Nothing answered at all: not N guilty models but a general failure (connection, keys) — the chip says so
        // instead of accusing the models, which would send the user to the wrong place.
        tousEnEchec: etat.tousEnEchec === true,
        verifieA: typeof etat.verifieA === 'string' ? etat.verifieA : null,
        alertes
      }
    }

    const santeAvertir = () => {
      try {
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
          window.dispatchEvent(new CustomEvent('kybernos-health'))
        }
      } catch (e) { /* no event support: the chip reads get() when it mounts */ }
    }

    /** Probes the host. Resolves `null` when there is nothing to say (no study model, silent service, unreadable
     *  list) — never an exception. */
    const kbSanteSonde = (force) => {
      // Hiding also stops the probe: an hour without an alert is an hour without real calls — a reading costs
      // tokens and rate limit.
      if (force !== true && santeEstTaise()) return Promise.resolve(null)
      if (santeEnCours !== null) return santeEnCours
      santeEnCours = (async () => {
        try {
          const lire = await fetch('/kybernos-sessions/settings', { method: 'GET' })
          if (!lire.ok) return null
          const reg = await lire.json()
          // Nobody is watching when the Study model in force is none (set to None, or Automatic with nothing connected): no probe.
          // An older host does not say what is in force: then the old rule, a model picked by the person is watching.
          const brain = (reg !== null && typeof reg === 'object' && reg.reglages !== undefined && typeof reg.reglages.brain === 'string') ? reg.reglages.brain : ''
          const actif = reg !== null && typeof reg === 'object' && reg.etude !== null && typeof reg.etude === 'object'
            ? reg.etude.actif === true
            : (brain !== '' && brain !== 'none')
          if (!actif) return null
          const tous = await kbModeles()
          if (tous === null || tous.length === 0) return null
          // Only models that can answer a TEXT message are probed: an image, audio or video model declared without
          // text input cannot answer a ping, and its silence would say nothing useful — counting it as "not
          // answering" would be a false witness. An EMPTY list = modality not declared (measured: the 14 text
          // models of the Groq/zai/ollama profile do not declare `input`; the harness renders them as an empty
          // array). "Not declared" is not "no text": we probe. Only a model that EXPLICITLY declares modalities
          // without text (image, audio, video) is left out.
          const modeles = tous.filter((m) => m.entree === null || m.entree === undefined ||
            m.entree.length === 0 || m.entree.includes('text'))
          if (modeles.length === 0) return null
          const reponse = await fetch('/kybernos-sessions/brain/health', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ models: modeles.map((m) => m.cle), force: force === true })
          })
          if (!reponse.ok) return null
          const etat = await reponse.json()
          return (etat !== null && typeof etat === 'object') ? etat : null
        } catch (e) { return null }
      })()
      const fin = () => { santeEnCours = null }
      santeEnCours.then(fin, fin)
      return santeEnCours
    }

    /** Stores a verdict and tells whoever listens. A fresh verdict does NOT lift the silence: only the elapsed
     *  hour, or a re-check, does. */
    const santeAppliquer = (etat) => {
      santeEtat = etat
      santeAvertir()
    }

    const santeBus = {
      version: 1,
      get: () => {
        const vue = santeVue(santeEtat, santeSilenceFin(), Date.now())
        return vue === null ? null : { ...vue, checking: santeVerifie }
      },
      recheck: () => {
        if (santeVerifie) return Promise.resolve()
        santeVerifie = true
        santeOublierTaire() // asking for a check is wanting the alert
        santeAvertir()
        const fin = () => { santeVerifie = false; santeAvertir() }
        return kbSanteSonde(true).then((etat) => { if (etat !== null) santeEtat = etat }).then(fin, fin)
      },
      hide: () => {
        santeTaire() // one hour without the alert, and without probing
        santeAvertir()
      }
    }

    /** Opens Settings on the section whose nav label is `libelle` (« Memory & Lessons »). If the nav is already
     *  showing, only the cell is clicked — clicking the trigger again would close Settings. Same two anchors as
     *  the cloud plugin's account menu: the trigger, then the nav cell BY ITS LABEL
     *  (the hashed class names change at every build). `false` when the trigger or the cell never shows up. */
    const ouvrirReglagesSection = async (libelle) => {
      const navVisible = () => { const nav = document.querySelector('[class*="navList"]'); return nav !== null && nav.offsetParent !== null }
      const trouver = () => Array.prototype.slice.call(document.querySelectorAll('[class*="navCell"]')).filter((x) => String(x.textContent || '').trim() === libelle)[0]
      if (!navVisible()) {
        const declencheur = document.querySelector('[class*="settingsArea"] button[class*="trigger"]') || document.querySelector('button[aria-label="Settings"]')
        if (declencheur === null) return false
        declencheur.click()
      }
      for (let i = 0; i < 40; i += 1) {
        const cellule = trouver()
        if (cellule !== undefined) { (cellule.querySelector('button,[role="button"]') || cellule).click(); return true }
        await new Promise((r) => setTimeout(r, 100))
      }
      return false
    }

    /** Watching: on load, every 5 hours, and after the chat's model changes (rule: "when a session opens and after
     *  a model change"). */
    const suivreSante = () => {
      // Same guard as `suivreTitres`: without a DOM (test harness) neither the bus nor a timer is set.
      if (typeof document === 'undefined' || typeof window === 'undefined') return () => {}
      const lancer = (force) => {
        santePrevue = false
        kbSanteSonde(force).then((etat) => {
          if (etat !== null) santeAppliquer(etat)
          else santeAvertir() // the hour of silence may have ended: let the chip re-read
        })
      }
      const planifier = (force) => {
        if (santePrevue) return
        santePrevue = true
        setTimeout(() => lancer(force === true), 300)
      }
      const premier = setTimeout(() => planifier(false), 2000)
      const minuteur = setInterval(() => planifier(false), SANTE_INTERVALLE)
      // After a change of the chat's model: the composer button carries the current model in its aria-label, and
      // that is the only stable trace.
      let modeleVu = null
      const surveillerModele = () => {
        const b = document.querySelector('button[aria-label^="Select model"]')
        const vu = b === null ? null : String(b.getAttribute('aria-label') || '')
        if (vu === null) return
        if (modeleVu !== null && vu !== modeleVu) planifier(true)
        modeleVu = vu
      }
      const minuteurModele = setInterval(surveillerModele, 5000)
      window.__kybernosHealth = santeBus
      return () => {
        clearTimeout(premier)
        clearInterval(minuteur)
        clearInterval(minuteurModele)
        if (window.__kybernosHealth === santeBus) delete window.__kybernosHealth
      }
    }

    // ── mounting: the composer dock receives { sessionId } ─────────────────
    function apply (ctx) {
      // Captured for the list of models, read by `kbCtx.get` INSIDE a try/catch:
      // adding it to `inject` would fail the whole mount if the service is missing.
      kbCtx = ctx
      ctx.effect(() => ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register(
        { name: 'conversation.composer.dock', id: 'kybernos-sessions', order: 5 },
        ({ sessionId }) => {
          try { return React.createElement(Pills, { sessionId }) } catch (e) { return null }
        }
      )), 'kybernos-sessions: pills composer.dock')
      // The settings page lives in the Settings popup: it is the same
      // settings file the naming CLI reads. Since variant D
      // (settings mockup v2), the Kybernos block registers in the slot of the
      // native General pane (`settings.general.item`, order -30 = first):
      // this panel becomes a merged « General » — our rows, then the
      // native rows WITH NO Kybernos equivalent (Permission, Work details,
      // Performance & usage, Developer tools, Send
      // behaviour), the ones that have an equivalent (Language, Appearance, Font
      // size — they live in Theme) being hidden by
      // the orchestrator below. No core patch.
      ctx.effect(() => ctx.slots.inject('settings.general.item', () => ctx.slots.register(
        { name: 'settings.general.item', id: 'kybernos-general', order: -30 },
        () => h(ReglagesKybernos))), 'kybernos-sessions: Kybernos block in General')
      ctx.effect(() => orchestrerReglages(), 'kybernos-sessions: orchestrator of the Settings dialog')
      // Independent of the slot: the list of sessions lives in the shell.
      ctx.effect(() => suivreTitres(), 'kybernos-sessions: category icon before the title')
      // Model health (the `brain` setting): the probe and the public bus the Models tab chip reads.
      ctx.effect(() => suivreSante(), 'kybernos-sessions: model health probe and bus')
    }
    return {
      // The export contract of a cordis entry: the services the context
      // MUST expose. Without `slots`, the ctx guard refuses `ctx.slots` and
      // the entry stays « loading » (the same contract as kybernos/kybernos-theme).
      inject: ['slots'],
      // Pure pieces, exposed for test-journal.mjs, test-sante.mjs and test-language.mjs.
      __test: { memoireDuJournal, santeVue, santeCause, suivreSante, faitsChangements, genreDeCode, descripteur, etudeVue, kt, direErreur, ERR_REGLAGES, motAffiche, CATEGORIE_PAR_SLUG, MOTS_FR, ReglagesKybernos, rgRenommerGeneral, Pills, PlanAction, Pop, Copier },
      apply
    }
  }
})