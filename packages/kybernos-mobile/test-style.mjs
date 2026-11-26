// The phone panel's styles must follow the theme: a primary button's text colour is its theme pair, never a literal.
// Measured on the owner's real GUI (2026-10-12): `color: white` on the brand fill, which the Neutre theme makes
// near-white, gave a contrast of 1.05:1: the "Allow" and "Add a phone" buttons looked empty.
//
//   node packages/kybernos-mobile/test-style.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')
let count = 0
const ok = (label, fn) => { fn(); count++; console.log('ok  ', label) }

const rule = (selector) => {
  const start = source.indexOf('\n' + selector + '{')
  assert.notEqual(start, -1, selector + ' is defined')
  return source.slice(start, source.indexOf('}', start))
}

ok('the primary button takes its text colour from the theme, not a literal white', () => {
  const css = rule('.kbmr-primary')
  assert.match(css, /color:var\(--dsw-alias-label-primary-foreground/, 'the label colour is the button pair')
  assert.doesNotMatch(css.replace(/var\([^)]*\)/g, ''), /color:\s*(white|#fff\b|#ffffff)/i, 'no literal white left outside a fallback')
})

ok('the primary fill is the theme\'s button fill (the brand token is only the fallback)', () => {
  assert.match(rule('.kbmr-primary'), /background:var\(--dsw-alias-button-primary-fill/)
})

// The safe areas: inside the phone app the app's own frame already keeps the status bar and the navigation bar out of the web view and Android's WebView reports them again, so a page that
// pads with a bare env() pads twice (measured on a real phone, 2026-10-25: the menu button 44 px too low on top of the page titles, a white band at the top of every page).
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'mobile.css'), 'utf8')
ok('mobile.css never pads with a bare env(): every safe area goes through --kb-sat / --kb-sab', () => {
  const bare = css.split('\n').filter((l) => /env\(safe-area-inset/.test(l) && !/var\(--kb-sa[tb], env\(safe-area-inset-(top|bottom), 0px\)\)/.test(l) && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
  assert.deepEqual(bare, [], 'bare env() left')
})
ok('the app sets both variables to zero, from the first paint (class set by the app) or once the plugin is up', () => {
  assert.match(css, /html\.kb-native-insets,\s*html\.kb-app\s*\{[^}]*--kb-sat:\s*0px;[^}]*--kb-sab:\s*0px;/)
})
ok('the other bundles that pad a fixed box with a safe area use the same variables', () => {
  for (const f of ['../kybernos-usage/client.js', 'client.js']) {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), f), 'utf8')
    const lines = src.split('\n').filter((l) => /env\(safe-area-inset/.test(l))
    assert.ok(lines.every((l) => /var\(--kb-sa[tb],\s*env\(safe-area-inset/.test(l.replace(/\s+/g, ' '))), f + ' has a bare env()')
  }
})

// Responsiveness measured on a real phone with the system's font size at 145 % (2026-10-25).
ok('the new-chat field is tall enough for the two lines of its hint at any text size: its height follows the line height (`lh`), only on the screen that has the hero slots', () => {
  assert.match(css, /\[data-slot="conversation\.composer"\]:has\(\[data-slot\^="conversation\.hero\."\]\) :is\(\[data-composer-input\], \[data-input-scroll\]\) \{\s*min-height: calc\(2lh \+ 4px\) !important;/)
})
ok('a page title and its "How it works" pill wrap instead of squeezing the title onto two lines (the rule belongs to the core plugin, which owns kb6-)', () => {
  const core = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../kybernos-plugin/client.js'), 'utf8')
  assert.match(core, /\.kb6-titlerow\{display:flex;flex-wrap:wrap;/)
  assert.doesNotMatch(css, /\.kb6-titlerow/)
})
ok('the hint of the field in a conversation is small enough to show whole on one line (it was cut at "@ fi…"), the new-chat screen keeps its own size', () => {
  assert.match(css, /\[data-slot="conversation\.composer"\]:not\(:has\(\[data-slot\^="conversation\.hero\."\]\)\) \[data-composer-placeholder\] \{\s*font-size: 12px !important;/)
})
ok('the new-chat screen starts at the top when its content is taller than the area (`safe center`): the headline is never cut above the scroll start', () => {
  assert.match(css, /\[data-content-phase="hero"\] > \[data-conversation-scroll\] \{\s*justify-content: safe center !important;/)
})

// The phone's look, slice 1 (2026-11-07): the block below 600 px and the loading card.
const cssSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'mobile.css'), 'utf8')
const lookStart = cssSrc.indexOf('@media (max-width: 600px) {')
const lookEnd = cssSrc.indexOf('\n}\n', lookStart)
const look = cssSrc.slice(lookStart, lookEnd + 3)
ok('the look below 600 px is ONE block after the 700 px layer, so deleting it gives the layer back unchanged', () => {
  assert.ok(lookStart > cssSrc.lastIndexOf('@media (max-width: 700px)'), 'after the last 700 px block')
  assert.equal(cssSrc.split('@media (max-width: 600px) {').length - 1, 1, 'one block')
  assert.match(look, /--kbmob-row: 52px;[\s\S]*--kbmob-head: 56px;/, 'the mockup scale is in tokens')
})
ok('the look has no colour of its own: the engine\'s tokens only, no hex, no rgb()', () => {
  assert.doesNotMatch(look, /#[0-9a-fA-F]{3,8}\b/)
  assert.doesNotMatch(look, /\brgba?\(/)
  assert.match(look, /--kbmob-bg: var\(--dsw-alias-bg-base/)
})
ok('the menu is the whole page; the shelf\'s old row of tiles is not styled here any more (the Kybernos plugin draws ONE slider of the same drawings, `.kb8-ncs`, and hides the old row itself)', () => {
  assert.doesNotMatch(look, /newchat-visuals/)
  assert.match(look, /width: 100vw !important;/)
  assert.match(look, /\[data-sidebar-mask\]/)
})
ok('Settings is one flat list: every page shows, the group names are labels that do nothing', () => {
  assert.match(look, /\[data-kb-fold-cell\]:not\(\[data-kb-shown\]\) \{\s*display: flex !important;/)
  assert.match(look, /\[data-kb-fold-toggle\] \{\s*pointer-events: none;/)
})
ok('the title of a page (kb6-) is styled by the core plugin, which owns it, at the same 600 px', () => {
  assert.doesNotMatch(cssSrc, /\.kb6-titlerow/)
  const core = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../kybernos-plugin/client.js'), 'utf8')
  assert.match(core, /@media \(max-width:600px\)\{\n\.kb6-headrow>\.kb6-headcol\{display:contents\}/)
  assert.match(core, /\.kb6-headrow>\.kb6-headcol>\.kb6-titlerow\{position:fixed;[^}]*var\(--kb-sat,env\(safe-area-inset-top,0px\)\)/)
})
ok('the loading card (boot.css, a head row of its own, at every width) shows the K, hides its hint, and never hides the failure text', () => {
  const boot = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'boot.css'), 'utf8')
  assert.doesNotMatch(boot, /@media/, 'no media query: web and phone alike')
  assert.doesNotMatch(cssSrc, /data-dsh-boot/, 'not in the phone sheet')
  assert.match(boot, /\[data-dsh-boot\] > :first-child > :first-child \{[^}]*viewBox='0 0 32\.5 36'/)
  assert.match(boot, /\[data-dsh-boot\] \[data-dsh-boot-spinner\] ~ \* \{\s*display: none !important;/)
  // the only display:none of the card goes through the spinner, which a failure card does not have
  assert.equal((boot.match(/display: none/g) || []).length, 1)
})

// The phone's look, slice 2 (2026-11-07): no outlines, 44 px targets, the home's chips in the "+" sheet, bottom sheets, the shell's entries.
ok('no line draws a surface in the look: borders are transparent, a 1 px line is only ever the sheet\'s separator', () => {
  const lines = look.split('\n').filter((l) => /\bborder(-top|-bottom|-left|-right|-inline|-block)?(-width)?:\s*[1-9]\d*px/.test(l))
  assert.deepEqual(lines, [], 'a border drawn in the look')
  assert.match(look, /\.kbnm, \.kb8-nc-cloud[^{]*\{\s*border-color: transparent !important;/)
  assert.match(look, /\.kbnm-btn:not\(\.kbnm-primary\)/, 'the primary button keeps its own fill')
  assert.match(look, /\.kb8-chip:not\(\.on\)/, 'the selected chip keeps its own fill')
})
ok('the look names only stable hooks: no hashed class of the engine, no [class*=]', () => {
  assert.doesNotMatch(look, /\[class[*^$|~]?=/)
  assert.doesNotMatch(look, /\.(?!kb)[A-Za-z0-9-]{5,8}_[A-Za-z]+\b/, 'a hashed class of the engine (ours start with kb)')
  assert.match(look, /\[data-kb-beta\]/, 'the BETA tag is parked by the hook the core plugin puts on it')
})
ok('a small control keeps a 44 px hit area (the glyph can stay small)', () => {
  assert.match(look, /\.kbhp-btn, \.kb6-helpbtn, \.kbln-help-btn, \.kbat-help, \.kbcl-hl, \.kb6-tb-ghost, \.kb6-tb-vbtn, \.kb6-utab, \.kb8-chip, \.kbsf-seg button, button\.kb-seg, \.kb7-subtabs button \{\s*min-width: 44px !important;\s*min-height: 44px !important;/)
  assert.match(look, /\[data-composer-card\] button:has\(svg\[data-icon\*="microphone"\]\),\s*\[data-composer-card\] button\[aria-haspopup\]:not\(\[data-kb="model-seat"\]\),\s*\[data-shortcut-modal="sidebar"\] button\[aria-label\] \{\s*min-width: 44px !important;\s*\}/, 'the microphone and the composer\'s popup chips (access mode...) reach 44 px wide')
})
ok('the home parks its chips (kept in the page for the engine\'s menus), the "+" sheet holds them', () => {
  assert.match(look, /:has\(> \[data-slot="conversation\.hero\.agentPreset"\]\),[\s\S]*?position: fixed !important;[\s\S]*?opacity: 0 !important;[\s\S]*?pointer-events: none !important;/)
  assert.match(look, /\[data-composer-card\] button:has\(svg\[data-icon\*="chevron-down"\]\):not\(\[data-kb="model-seat"\]\)/, 'the access chip, found by what it holds, not by its language')
})
ok('the engine\'s menus rise from the bottom as sheets: a handle, a scrim, a drag, a z-index above the scrim', () => {
  assert.match(look, /\[role="menu"\]:not\(\.kbmob-sheet\),\s*\[data-trigger-menu\],\s*[^{]+ \{\s*position: fixed !important;\s*inset: auto 0 0 0 !important;/)
  assert.match(look, /translateY\(var\(--kbmob-drag, 0px\)\)/)
  assert.match(look, /\.kbmob-scrim \{[^}]*z-index: 1000;/)
  assert.match(look, /\[data-kbmob-lift\] \{\s*z-index: auto !important;\s*will-change: auto !important;/)
  assert.match(look, /\[data-kbmob-lift\] \{[^}]*isolation: auto !important;/)
  assert.match(look, /\[data-kbmob-lift="sticky"\] \{\s*position: relative !important;/)
  // the Settings back bar: a real button lies over the pseudo-element bar, transparent, hidden while the list shows, and not hidden with the strip's other children
  assert.match(cssSrc, /\[data-kbmob-page\] > div:first-child > :not\(\[data-kbmob-backbtn\]\) \{\s*display: none !important;/, 'the strip hides everything but the back button')
  assert.match(cssSrc, /:not\(\[data-kbmob-page\]\) \[data-kbmob-backbtn\] \{\s*display: none !important;/, 'no button while the list shows')
  assert.match(cssSrc, /\[data-kbmob-page\] \[data-kbmob-backbtn\] \{\s*position: absolute;[^}]*width: calc\(100% - 64px\);[^}]*background: transparent;/, 'the button is transparent and leaves the cross its 64 px')
  assert.match(look, /box-shadow: 0 -12px 40px var\(--kbmob-shadow\)/)
})
ok('the page\'s one primary action floats at the bottom right, and the core plugin leaves room under the last row', () => {
  assert.match(look, /\.kb6-headrow \.kb8-primary \{\s*position: fixed !important;\s*right: 16px !important;/)
  const core = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../kybernos-plugin/client.js'), 'utf8')
  assert.match(core, /\*:has\(>\.kb6-headrow \.kb8-primary\)\{padding-bottom:calc\(88px \+ var\(--kb-sab,env\(safe-area-inset-bottom,0px\)\)\)!important\}/)
})
ok('the corner button is a back arrow on a page and the menu on the home and in a chat; the engine\'s own glyph under it is hidden while the drawer is shut', () => {
  assert.match(look, /html\[data-kbmob-view="page"\] \.kbmob-menu \.kbmob-back-ico \{\s*display: block;/)
  assert.match(look, /svg\[data-icon="dsw-icon-panel-left-outline-regular"\] \{\s*opacity: 0;/)
})
ok('menu C2, the app only: a drawer 88 % wide over a dimmed page, the wordmark and the search, no collapse button to see, no « New chat » row, no engine footer', () => {
  const app = 'html\\.kb-app'
  assert.match(look, new RegExp(app + ' \\{\\s*--kbmob-drawer-w: min\\(88vw, 400px\\);'))
  assert.match(look, new RegExp(app + ' \\[data-slot="root"\\] > div:has\\(> \\[data-shell-overlay\\]\\) > div:has\\(> \\[data-slot="sidebar"\\]\\) \\{\\s*width: var\\(--kbmob-drawer-w\\) !important;'))
  assert.match(look, new RegExp(app + ' \\[data-slot="root"\\] > div:has\\(> \\[data-shell-overlay\\]\\):not\\(\\[data-sidebar-collapsed\\]\\)::before \\{\\s*display: block !important;'), 'the dimmed page is back')
  assert.match(look, /\[data-window-drag\] \[data-sidebar-toggle\] \{\s*position: absolute;[^}]*opacity: 0;[^}]*pointer-events: none;/)
  assert.match(look, /\.kb4-ncwrap \{\s*display: none !important;/)
  // the browser keeps the whole-page menu: nothing of C2 is outside `html.kb-app` except the dock, the page and their own classes
  // Simple (Kaby mode, `kb-kaby`) is the same drawer, with the rows its locked preset keeps: no rule of the phone look leaves it out
  assert.ok(!/kb-kaby/.test(look), 'no rule of the phone look excludes Simple: its drawer, its dock and its account menu are the app\'s')
  assert.match(look, /width: 100vw !important;/)
})
ok('menu C2: ONE scrolling area (workspaces, Pinned, Recents) built by `order` out of the boxes the engine keeps, found by data-slot / role / data-row-key', () => {
  assert.match(look, /\[data-slot="sidebar"\] div:has\(> \[data-slot="sidebar\.workspaces"\]\) \{\s*display: flex !important;\s*flex-direction: column;[^}]*overflow-y: auto !important;/)
  assert.match(look, /\[role="tree"\] > \* \{\s*display: contents !important;/)
  assert.match(look, /\[role="tree"\] > \* > :has\(> \[data-row-key\^="workspace:"\]\) \{\s*order: 1;/)
  assert.match(look, /\.kbpin_section \{\s*order: 3;/)
  assert.match(look, /\[role="tree"\]::after \{\s*order: 4;\s*content: attr\(data-kbmob-recents\);/)
  assert.match(look, /\[role="tree"\] > \* > :has\(> \[data-row-key\^="session:"\]\) \{\s*order: 5;/)
  assert.match(look, /\[role="tree"\] > \* > \[data-row-key\^="overflow:"\] \{\s*order: 6;/)
  assert.match(look, /\.kbpin_section\[data-kbpin-empty\] \{\s*display: none;/, 'an empty Pinned takes no room')
  assert.match(look, /\[role="tree"\]\[data-kbmob-filter\] > :not\(\[data-kbmob-picked\]\) > :has\(> \[data-row-key\^="session:"\]\),[^{]*\{\s*display: none !important;/, 'the workspace filter')
})
ok('menu C2: the dock is the avatar and a white « + New chat » pill over a fade, only while the drawer is open; the avatar opens the web\'s account menu, drawn as a bottom sheet', () => {
  assert.match(cssSrc, /\n\.kbmob-sheet-mask,\s*\.kbmob-sheet,\s*\.kbmob-dock,\s*\.kbmob-where \{\s*display: none;\s*\}/, 'off by default, at every width')
  assert.doesNotMatch(cssSrc, /kbmob-settings/, 'the app\'s own Settings page is gone: the web\'s account menu replaces it')
  assert.match(look, /body:has\(\[data-slot="root"\] > div:not\(\[data-sidebar-collapsed\]\)\) \.kbmob-dock \{[^}]*position: fixed;[^}]*width: var\(--kbmob-drawer-w\);[^}]*linear-gradient\(to top, var\(--kbmob-sheet\) 58%, transparent\);[^}]*pointer-events: none;/)
  assert.match(look, /\.kbmob-avatar \{[^}]*border-radius: 50%;/)
  assert.match(look, /\.kbmob-newchat \{[^}]*border-radius: 24px;[^}]*background: var\(--kbmob-fg\);[^}]*color: var\(--kbmob-bg\);/)
  // the web\'s footer card is in the page but not drawn: its menu is the avatar\'s, and the one thing drawn is that menu (a child takes `visibility` back)
  assert.match(look, /\[data-slot="sidebar\.settings"\] \{\s*display: none !important;/, 'the engine\'s Settings trigger is not drawn')
  assert.match(look, /\[data-slot="sidebar\.footer\.action"\] \{[^}]*display: block !important;[^}]*position: fixed;[^}]*width: 0;[^}]*height: 0;[^}]*visibility: hidden;[^}]*pointer-events: none;/, 'the card stays in the page, out of the flow and invisible')
  assert.match(look, /\[data-slot="sidebar\.footer\.action"\] \[role="menu"\] \{\s*visibility: visible;\s*pointer-events: auto;/, 'its menu is the one thing drawn')
  assert.match(cssSrc, /\[role="menu"\] \[role="menuitem"\],[^{]*\{[^}]*min-height: 46px;/, 'the sheet rows are at least 46 px')
})
ok('round 7 on the real phone: the settings rows wrap (the control goes under a long text), Settings is edge to edge, the feedback box keeps its height, the arrow of a native row is not drawn', () => {
  assert.match(cssSrc, /7c\. A page's setting rows/)
  assert.match(cssSrc, /nav \+ div \+ div, \[data-shortcut-modal="settings"\]\[data-kbmob-page\] > nav \+ div:last-child > :not\(:first-child\)\) div:has\(> :first-child:nth-last-child\(2\):not\(button, select, input, \[role\]\)\):has\(> :last-child:is\([^)]*\), > :last-child :is\(button, select, input\)\)[^{]*\{\s*flex-wrap: wrap !important;/, 'a row = a text box and a control box (or a box that holds one); wraps')
  assert.doesNotMatch(cssSrc.replace(/\/\*[\s\S]*?\*\//g, ''), /:has\([^()]*(\([^()]*\)[^()]*)*:has\(/, 'no :has() inside a :has(): the browser drops it')
  assert.match(cssSrc, /> :first-child \{\s*flex: 1 1 auto !important;\s*min-width: min\(100%, 260px\) !important;/, 'the text keeps 260 px or the control goes under it')
  assert.match(cssSrc, /html \[data-shortcut-modal="settings"\] \{\s*width: 100% !important;\s*max-width: none !important;\s*border-radius: 0 !important;/, 'edge to edge')
  assert.match(cssSrc, /\[role="dialog"\] textarea\[id="kbfb-msg"\] \{\s*flex: none !important;\s*min-height: 120px !important;/, 'the feedback message box does not shrink')
  assert.match(cssSrc, /html\[data-kbmob-caps~="account"\] \[role="menu"\] \[data-kb="menu-account"\] > span\[aria-hidden="true"\],\s*html\[data-kbmob-caps~="referral"\] \[role="menu"\] \[data-kb="menu-referral"\] > span\[aria-hidden="true"\] \{\s*display: none;/, 'no « leaves the app » arrow on a native row')
})
ok('menu C2: « Where Kybernos runs » is a line under the chat title, only in a chat, with a 44 px target made of padding', () => {
  assert.match(look, /html\.kb-app\[data-kbmob-view="chat"\] \.kbmob-where \{\s*position: fixed;[^}]*min-height: 44px;[^}]*padding: 14px 10px;/)
  assert.match(look, /\.kbmob-where\[data-place="cloud"\] \.kbmob-where-dot \{/)
  // round 5 on the real phone: the header's bottom line (56 px) crossed the pill's text; the header is taller while the pill is there, the title stays where it was
  assert.match(look, /\[data-kbmob-view="chat"\]:has\(\.kbmob-where\) \[data-slot="conversation\.header"\] > header \{\s*min-height: 66px !important;\s*padding-bottom: 16px !important;/)
})
ok('the composer\'s model-chip rules do not reach the rows of the model menu drawn inside the same slot (the tick took half the row, the names looked centred)', () => {
  assert.match(cssSrc, /\[data-slot="conversation\.input\.model"\] button:not\(\[role="menu"\] \*\) \{\s*width: 100%;/)
  assert.match(cssSrc, /\[data-slot="conversation\.input\.model"\] button:not\(\[role="menu"\] \*\) > span \{\s*display: inline !important;/)
})
ok('the line under an answer is ONE line of flat icons: the five stars (30 px) and the usage icon in it, « Report » a flag at its end with 36 px kept free for it, no clock, the tags of a rated card on a line of their own', () => {
  assert.match(cssSrc, /div:has\(> \[data-slot="conversation\.chat\.assistant-actions"\]\) \{\s*flex-wrap: wrap !important;\s*align-items: center !important;\s*gap: 0 !important;\s*height: auto !important;\s*min-height: 36px;\s*margin-top: 4px !important;/)
  assert.match(cssSrc, /\.kbq-rating \{\s*flex: none;\s*margin: 0 !important;\s*padding: 0 !important;\s*gap: 0 !important;\s*border: 0 !important;[^}]*background: none !important;\s*box-shadow: none !important;/)
  assert.match(cssSrc, /\.kbq-rating:has\(\.kbq-rating-merci\) \{\s*order: 9;\s*flex: 1 0 100%;/)
  assert.match(cssSrc, /\.kbq-rating \.kbq-rating-question \{\s*display: none !important;/)
  assert.match(cssSrc, /\.kbq-rating \.kbq-rating-etoile \{\s*width: 30px !important;\s*min-width: 30px !important;\s*height: 36px !important;/)
  assert.doesNotMatch(cssSrc, /data-kbmob-open/, 'no collapsed star any more: the five stars are always there')
  // the flag: drawn over the last 36 px of the line, which the line keeps free; it comes back into the flow (under the line) while its form is open
  assert.match(cssSrc, /\[data-slot="conversation\.chat\.turnTail"\]:has\(> \[data-kb="report-tail"\] > button\[data-act="report-open"\]\) ~ div:has\(> \[data-slot="conversation\.chat\.assistant-actions"\]\) \{\s*padding-inline-end: 36px;/)
  assert.match(cssSrc, /\[data-slot="conversation\.chat\.turnTail"\] > \[data-kb="report-tail"\]:has\(> button\[data-act="report-open"\]\) \{\s*position: absolute;\s*top: 4px;\s*inset-inline-end: 0;/)
  assert.match(cssSrc, /\[data-kb="report-tail"\] > button\[data-act="report-open"\] \{[^}]*width: 36px;\s*height: 36px;[^}]*text-indent: 100%;[^}]*font-size: 12px;\s*text-decoration: none;/)
  assert.match(cssSrc, /\[data-kb="report-tail"\] > button\[data-act="report-open"\]::before \{\s*content: "";\s*position: absolute;[^}]*mask: url\("data:image\/svg\+xml/)
  // the clock goes, the usage button stays: what is hidden is what is neither a button nor holds one
  assert.match(cssSrc, /> \[class\*="_endInfo"\] > :not\(button\):not\(:has\(button\)\) \{\s*display: none !important;/)
})
ok('the same line shown on a TAP (html[data-kb-msg-actions="tap"], the locked phone preset): every button and the flag are 44 px zones, the line keeps 44 px free for the flag, the stars stay as they are', () => {
  const tap = cssSrc.slice(cssSrc.indexOf('/* 5b. The same line when it comes on a TAP'))
  const upto = tap.slice(0, tap.indexOf('/* What client.js marked as wider than the page'))
  assert.ok(upto.length > 200, 'the block is there')
  // nothing of it applies without the mark
  for (const rule of upto.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((r) => r.trim()).filter((r) => r !== '')) assert.match(rule, /^html\[data-kb-msg-actions="tap"\]/, 'every selector starts with the mark: ' + rule.slice(0, 60))
  assert.match(upto, /html\[data-kb-msg-actions="tap"\] div:has\(> \[data-slot="conversation\.chat\.assistant-actions"\]\) \{\s*min-height: 44px;/)
  assert.match(upto, /> button,\s*html\[data-kb-msg-actions="tap"\] \[data-slot="conversation\.chat\.assistant-actions"\] > div > button \{\s*width: 44px;\s*height: 44px;\s*min-width: 44px;/)
  assert.match(upto, /~ div:has\(> \[data-slot="conversation\.chat\.assistant-actions"\]\) \{\s*padding-inline-end: 44px;/)
  assert.match(upto, /\[data-kb="report-tail"\]:has\(> button\[data-act="report-open"\]\) \{\s*top: 0;\s*width: 44px;\s*height: 44px;/)
  assert.match(upto, /\[data-kb="report-tail"\] > button\[data-act="report-open"\] \{\s*width: 44px;\s*height: 44px;\s*min-height: 44px;/)
  assert.doesNotMatch(upto, /kbq-rating/, 'the stars are not touched (the owner has not confirmed them)')
})
ok('menu C2: the search icon the search plugin puts in the Workspaces heading is not drawn (on engine 0.2.1 it comes first and pushed the heading 45 px right of the rows)', () => {
  assert.match(look, /html\.kb-app \[data-slot="sidebar\.workspaces"\] \[data-kb="search-header"\] \{\s*display: none !important;/)
})

// The drawer's rows (2026-11-07, measured on a real phone: at 54 px per row the chats were pushed off the screen).
ok('the menu\'s rows are 46 px, 17 px text, a 14 px gap and a 22 px icon (the mockup\'s 54 px pushed the chats off the screen); no row goes below 44 px', () => {
  const m = /\[data-slot="sidebar"\] nav:has\(\[data-slot="sidebar\.panellist"\]\) button \{([^}]*)\}/.exec(look)
  assert.ok(m !== null, 'the rule')
  assert.match(m[1], /min-height: 46px;/)
  assert.match(m[1], /font-size: var\(--kbmob-fs-body\);/)
  assert.match(m[1], /gap: 14px;/)
  assert.match(look, /nav:has\(\[data-slot="sidebar\.panellist"\]\) button svg \{\s*width: 22px;\s*height: 22px;/)
  const px = Number(/min-height: (\d+)px/.exec(m[1])[1])
  assert.ok(px >= 44, 'a touch target')
})
ok('the tree\'s icon buttons keep a 44 px hit area and grow their glyph: 24 px for the « + » of a workspace (found by its place: a phone draws no aria-keyshortcuts), 20 px for the others', () => {
  assert.match(look, /\[data-slot="sidebar"\] \[role="tree"\] button svg \{\s*width: 20px !important;\s*height: 20px !important;/)
  assert.match(look, /\[role="treeitem"\]\[data-row-key\^="workspace:"\] button:last-of-type svg \{\s*width: 24px !important;\s*height: 24px !important;/)
  assert.doesNotMatch(look, /aria-keyshortcuts/, 'DSH draws the shortcut on a desktop only: a rule keyed on it never reaches a phone')
  // the button itself is left alone (44 x 44 from the engine): no rule of the look sets a smaller size on a tree button
  assert.doesNotMatch(look, /\[role="tree"\][^{]*button(?!:last-of-type svg| svg)[^{]*\{[^}]*(width|height): (\d|[1-3]\d|4[0-3])px/)
})
ok('an empty Pinned block is hidden on a phone through the core plugin\'s own flag (the signature\'s format is not read), and shown again when a chat is pinned', () => {
  assert.match(look, /\[data-slot="sidebar"\] \.kbpin_section\[data-kbpin-empty\] \{\s*display: none;/)
  assert.doesNotMatch(look, /data-kbpin-sig/)
  const core = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../kybernos-plugin/client.js'), 'utf8')
  const at = core.indexOf("const sig = JSON.stringify([replie, kbe('Pinned'), groups])")
  assert.ok(at > 0, 'the render')
  const next = core.slice(at, at + 520)
  assert.match(next, /if \(total === 0\) section\.setAttribute\('data-kbpin-empty', ''\); else section\.removeAttribute\('data-kbpin-empty'\)/)
  assert.ok(next.indexOf('data-kbpin-empty') < next.indexOf("=== sig) {"), 'set before the unchanged-signature return, so it can never be stale')
  assert.doesNotMatch(cssSrc.slice(0, lookStart), /data-kbpin-empty/, 'wide screens keep the Pinned block')
})

ok('a pinned chat keeps ONE « … » of 44 x 44 at the end of its row (a phone has no hover, where the core plugin shows the row\'s buttons); archive and unpin stay in its menu', () => {
  assert.match(look, /\.kbpin_row \.kbpin_actions \{\s*display: flex;/)
  assert.match(look, /\.kbpin_row \.kbpin_act:not\(\.kbpin_more\) \{\s*display: none;/)
  assert.match(look, /\.kbpin_row \.kbpin_more \{\s*width: 44px;\s*height: 44px;/)
  assert.match(look, /\.kbpin_row \.kbpin_open \{\s*padding-inline-end: 48px !important;/, 'the title leaves room for it, hover or not')
  const core = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../kybernos-plugin/client.js'), 'utf8')
  assert.match(core, /act\('kbpin_more', [^\n]*'more', 16, \(b\) => kbPinsMenuOpen\(b, row, id, titre\)\)/, 'the class the look relies on is the one that opens the menu')
  assert.match(core, /items = \[\s*\{ icon: 'pin', label: kbe\('Unpin session'\)/, 'the menu holds Unpin')
  assert.doesNotMatch(cssSrc.slice(0, lookStart), /kbpin_more|kbpin_act/, 'a computer keeps the hover buttons as they are')
})

ok('a pinned row is a Recents row on the phone (round 3): the title and the folder are 48 px at 15 px (the Complete rows of the engine), the rename field 40 px, the chevron 16 px, the notice at the caption size; the spinner slot is left alone', () => {
  assert.match(look, /--kbmob-fs-row: calc\(15px \/ var\(--kbmob-tsa\)\)/, 'the size follows the phone scale like the other sizes of the layer')
  assert.match(look, /\[data-slot="sidebar"\] \.kbpin_row \.kbpin_open \{\s*height: 48px !important;\s*line-height: 48px !important;\s*font-size: var\(--kbmob-fs-row\) !important;/)
  assert.match(look, /\[data-slot="sidebar"\] \.kbpin_folder \{\s*height: 48px !important;[^}]*font-size: var\(--kbmob-fs-row\) !important;/)
  assert.match(look, /\[data-slot="sidebar"\] \.kbpin_row \.kbpin_edit \{\s*height: 40px !important;\s*font-size: var\(--kbmob-fs-row\) !important;/)
  assert.match(look, /\[data-slot="sidebar"\] \.kbpin_header \.kbpin_chevron svg \{\s*width: 16px !important;\s*height: 16px !important;/)
  assert.doesNotMatch(look, /\.kbpin_state\s*[{,]/, 'the spinner slot belongs to another session: no rule of ours styles it')
  assert.doesNotMatch(cssSrc.slice(0, lookStart), /kbpin_folder|kbpin_edit/, 'a computer keeps the pinned rows as they are')
})

ok('« Show in Finder » is hidden in a chat\'s menu on a phone only, found by its icon inside the menu of a session row; Copy Session ID, Pin, Rename, Fork and Archive are not touched', () => {
  const m = /(\[role="menu"\]:has\([^)]*\) div:has\([^{]*\)) \{\s*display: none !important;\s*\}/.exec(look.slice(look.indexOf('Show in Finder')))
  assert.ok(m !== null, 'the rule is in the phone block')
  assert.match(m[1], /\[data-slot\^="sidebar\.workspaces\.session\.menu"\]/, 'only the menu of a session row (the folder pickers use the same icon)')
  assert.match(m[1], /svg\[data-icon="dsw-icon-folder-open-outline-regular"\]/, 'by the icon: the label changes with the system and the language')
  assert.doesNotMatch(m[1], /_|\[class\*=/, 'no hashed class')
  for (const keep of ['pin-outline', 'edit-outline', 'branch-outline', 'copy-outline', 'archive-outline']) assert.ok(!m[1].includes(keep), keep + ' stays')
  assert.doesNotMatch(cssSrc.slice(0, lookStart), /folder-open-outline/, 'a wide screen keeps the entry')
})

ok('the frame keeps its three tracks (sidebar, main, right bar) with the side ones at 0: DSH puts the main column in the SECOND track, so a single track left it in an implicit one, 56 px wide on a page with a narrow content (Front desk)', () => {
  assert.match(cssSrc, /\[data-slot="root"\] > div:has\(> \[data-shell-overlay\]\) \{\s*grid-template-columns: 0 minmax\(0, 1fr\) 0 !important;/)
  assert.doesNotMatch(cssSrc, /grid-template-columns: minmax\(0, 1fr\) !important/, 'the one-track template is gone')
})
ok('the two columns that stay in the flow are PLACED by the look (page in the middle track, right bar in the last), not left to the engine: in the Android app the engine\'s own grid-area was not in force and every screen was blank (page in the 0 px track, empty right bar over the whole screen, 2026-11-07)', () => {
  const frame = '\\[data-slot="root"\\] > div:has\\(> \\[data-shell-overlay\\]\\)'
  // the page: the frame's direct div that is none of the others (sidebar mask, right bar, bottom row, overlay, leading seat, the sidebar's own wrapper)
  assert.match(cssSrc, new RegExp(frame + ' > div:not\\(\\[data-sidebar-mask\\], \\[data-rightbar-col\\], \\[data-shell-bottom\\], \\[data-shell-overlay\\], \\[data-shell-leading\\], :has\\(> \\[data-slot="sidebar"\\]\\)\\) \\{\\s*grid-area: 1 / 2 !important;'))
  assert.match(cssSrc, new RegExp(frame + ' > \\[data-rightbar-col\\] \\{\\s*grid-area: 1 / 3 !important;'))
  // stable hooks only: no hashed class of the engine
  assert.doesNotMatch(cssSrc.match(new RegExp(frame + ' > div:not[^{]+\\{[^}]*\\}'))[0], /_centerCol|_rightbarCol|\[class\*=/)
})

ok('a global page starts below the fixed title band whatever the engine pads above it: the page\'s own container carries the whole clearance (band + 4 px, at 0 engine padding in the Android app it sat at y 12 under the band), the engine\'s panel padding is taken off where it exists, a page with a title of its own keeps the engine\'s 48 px', () => {
  assert.match(look, /html \*:has\(> \.kb6-headrow\) \{\s*padding-top: calc\(var\(--kbmob-head, 56px\) \+ var\(--kb-sat, env\(safe-area-inset-top, 0px\)\) \+ 4px\) !important;/)
  assert.match(look, /:where\(\[data-global-panel\]\):has\(\.kb6-headrow\) \{\s*padding-top: 0 !important;/)
  assert.match(look, /\[data-global-panel\]:not\(:has\(\.kb6-headrow\)\) \{\s*padding-top: calc\(48px \+ var\(--kb-sat, env\(safe-area-inset-top, 0px\)\)\) !important;/)
})

ok('the dropdown of a page\'s floating action (Skills, Agent Teams) is a bottom sheet like the engine\'s menus: same rule, same handle, rows of 52 px, only on a phone', () => {
  const sel = '.kb6-headrow .kb8-primary + :is(.kb-menu, .kb8-newmenu)'
  const esc = sel.replace(/[.+()]/g, '\\$&')
  assert.match(look, new RegExp('\\[role="menu"\\]:not\\(\\.kbmob-sheet\\),\\s*\\[data-trigger-menu\\],\\s*' + esc + ' \\{\\s*position: fixed !important;\\s*inset: auto 0 0 0 !important;'), 'in the sheet rule')
  assert.ok(look.includes(sel + '::before'), 'the handle')
  assert.match(look, new RegExp(esc + ' > button \\{\\s*min-height: 52px !important;'), 'the rows')
  assert.doesNotMatch(cssSrc.slice(0, lookStart), /kb-menu|kb8-newmenu/, 'a wide screen keeps the dropdown under its button')
})

ok('Settings, on a phone: the page head has no « Open configuration file » (found by the slot every page has it in), the cross is 44 px (beating the engine\'s own min-width), the back chevron is drawn apart from its label at a thumb\'s size', () => {
  assert.match(look, /\[data-shortcut-modal="settings"\] \[data-slot="settings\.action"\] \{\s*display: none !important;/)
  assert.match(look, /\[data-shortcut-modal="settings"\] button:has\(\[data-slot="settings\.close"\]\) \{\s*min-width: 44px !important;\s*min-height: 44px !important;/)
  assert.match(cssSrc, /\[data-kbmob-page\] > div:first-child::before \{\s*content: "\\2039";[^}]*font-size: calc\(var\(--kbmob-fs-title\) \* 1\.5\);/, 'the chevron is the size of a title and a half (a token, not a new literal)')
  assert.match(cssSrc, /\[data-kbmob-page\] > div:first-child::after \{\s*content: attr\(data-kbmob-back\);/, 'the label follows it')
  assert.match(cssSrc, /padding: calc\(24px \+ var\(--kb-sat, env\(safe-area-inset-top, 0px\)\)\) 16px 8px 16px !important;/, 'the list leaves room above its first row')
  assert.doesNotMatch(cssSrc.slice(0, lookStart), /settings\.action|settings\.close/, 'a computer keeps the button')
})

ok('Auto Routing, « Advanced settings »: the summary wraps under its title instead of sitting in a second column', () => {
  assert.match(look, /\[data-kb="auto-advanced"\] \{\s*flex-wrap: wrap !important;/)
  assert.match(look, /\[data-kb="auto-advanced"\] small \{\s*flex: 1 1 100%;/)
})

ok('Activity log: a row is a small card (three columns, the two side ones of a fixed width so that every row lines up; the first line when / family / result, the second what / tokens), the head row and the two hidden columns stay hidden, no width of the log\'s own survives', () => {
  assert.match(look, /\.kblg-table,\s*\.kblg-table tbody \{\s*display: block;/)
  assert.match(look, /\.kblg-table thead \{\s*display: none;/)
  assert.match(look, /\.kblg-table tr \{\s*display: grid;\s*grid-template-columns: minmax\(0, 1fr\) 6\.5em 6em;/)
  assert.match(look, /\.kblg-table td \{[^}]*width: auto !important;[^}]*padding: 0 !important;/)
  for (const [n, area] of [[1, '1 / 1'], [2, '1 / 2'], [5, '1 / 3'], [3, '2 / 1 / 3 / 3'], [6, '2 / 3']]) assert.ok(look.includes('.kblg-table td:nth-child(' + n + ') { grid-area: ' + area + ';'), 'column ' + n)
  assert.match(look, /\.kblg-table td:nth-child\(4\),\s*\.kblg-table td:nth-child\(7\) \{\s*display: none;/)
  assert.doesNotMatch(cssSrc.slice(0, lookStart), /kblg-/, 'a computer keeps the table')
})

ok('the small targets found page by page on a real phone (406 px) are 44 px: the card star and « Details » of Skills, the tabs of Automations and Front desk, the mode switch and buttons of Connectors, « Customize », the Cloud Computer line, the engine\'s right-bar button, and the fields of a page', () => {
  const m = /(\.kbs-star-btn, [^{]+) \{\s*min-width: 44px !important;\s*min-height: 44px !important;/.exec(look)
  assert.ok(m !== null, 'the rule is in the phone block')
  for (const sel of ['.kbs-star-btn', '.kb8-ghost', 'button.kbs-link', '.kbfd-tab', '.kbfd-btn', '.kbcp-btn', '.kb-cust', '.kb8-nc-main', '.kb8-nc-act', '[data-sidebar-right-expand]', '[data-slot="main"] [data-kb^="section-"]', '[data-slot="main"] [data-kb^="mode-"]']) assert.ok(m[1].includes(sel), sel)
  assert.doesNotMatch(m[1], /_|\[class\*=/, 'no hashed class: the engine\'s button is found by its own data attribute')
  assert.match(cssSrc, /\[data-slot="main"\] input:where\([^{]*\) \{\s*min-height: 44px;/, 'a field of a page')
  assert.doesNotMatch(cssSrc.slice(0, lookStart), /kbfd-tab|kbs-star-btn|kb-cust|sidebar-right-expand/, 'a computer keeps the sizes')
})

ok('Settings on a phone says its own placement, whichever engine draws it: the flat panel (0.2.2) gets an explicit grid (title strip, nav, header with the cross, page), the nav-first one (0.2.1) puts the cross on the bar instead of in a row of its own', () => {
  const flat = '\\[data-shortcut-modal="settings"\\]:has\\(> div:first-child \\+ nav\\)'
  assert.match(cssSrc, new RegExp(flat + ' \\{[^}]*grid-template-columns: minmax\\(0, 1fr\\) auto !important;'), 'two columns: the title and the cross')
  assert.match(cssSrc, new RegExp(flat + '[^{]*> div:first-child \\{\\s*grid-area: 1 / 1 !important;'), 'the title strip')
  assert.match(cssSrc, new RegExp(flat + '[^{]*> nav \\{\\s*grid-area: 2 / 1 / 3 / 3 !important;'), 'the nav')
  assert.match(cssSrc, /\[data-kbmob-page\] > nav \+ div:last-child \{\s*position: relative;/, 'the old layout: the content block is the cross\'s frame')
  assert.match(cssSrc, /\[data-kbmob-page\] > nav \+ div:last-child > div:first-child \{\s*position: absolute;\s*top: 0;/, 'the cross sits on the bar')
  assert.doesNotMatch(cssSrc.slice(cssSrc.indexOf('[data-kbmob-page] > nav + div:last-child {'), cssSrc.indexOf('[data-kbmob-page] > nav + div:last-child {') + 900), /_[A-Za-z0-9]{4,}_|\[class\*=/, 'no hashed class')
})

ok('the credit notice (kybernos-cloud) is a block the width of the screen on a phone: the text takes the whole width, the button sits under it, the cross is in the top right corner; a computer keeps its row', () => {
  assert.match(look, /\[data-kb="quota-notice"\] \{\s*display: grid !important;\s*grid-template-columns: minmax\(0, 1fr\);/)
  assert.match(look, /\[data-kb="quota-notice"\] \{[^}]*left: var\(--kbmob-pad\) !important;\s*right: var\(--kbmob-pad\) !important;\s*width: auto !important;\s*max-width: none !important;\s*transform: none !important;/)
  assert.match(look, /\[data-kb="quota-notice"\] > button\[data-kb="quota-notice-open"\] \{\s*justify-self: start;\s*min-height: 44px;/)
  assert.match(look, /\[data-kb="quota-notice"\] > button:last-child \{\s*position: absolute;\s*top: 0;\s*inset-inline-end: 0;\s*width: 44px;\s*height: 44px;/)
  assert.doesNotMatch(cssSrc.slice(0, lookStart), /quota-notice/, 'a computer keeps the notice as it is')
})

ok('on a touch screen every chat row keeps its « … » at its end, 44 x 44 (the engine shows it under the pointer only), in the 0.2.1 shape of the row too (no context-menu mark on the button): the actions box by its CSS-module name, the button by its place (never by an icon name: engine 0.2.1 draws none), the time and the quick buttons not drawn', () => {
  const touchStart = cssSrc.indexOf('@media (max-width: 700px) and (pointer: coarse), (max-height: 500px) and (pointer: coarse) {')
  assert.notEqual(touchStart, -1, 'the touch block')
  const touch = cssSrc.slice(touchStart, cssSrc.indexOf('\n}\n', touchStart) + 3)
  const row = '\\[data-slot="sidebar"\\] \\[role="treeitem"\\]\\[data-row-key\\^="session:"\\]'
  assert.match(touch, new RegExp(row + ' > \\[class\\*="_rowActions"\\],\\s*' + row + ' > \\[class\\*="_rowActions"\\] > :not\\(\\[class\\*="_rowQuickActions"\\]\\) \\{\\s*display: flex !important;\\s*position: static !important;'), 'the box and its wrapper')
  assert.match(touch, new RegExp(row + ' > \\[class\\*="_rowActions"\\] \\{\\s*width: auto !important;\\s*min-width: 44px;\\s*height: 44px !important;'), 'the box is at least 44 x 44 and grows only if the engine puts more than the « … » in it')
  // round 5, engine 0.2.1: Archive and Pin beside the « … » overflowed the box and the « … » sat on the time. Round 9 (the Xiaomi: a titled chat showed its time and THREE buttons): the « … » is found by its
  // PLACE (a button that is the box's own child or sits in a child that is not the quick actions), never by an ellipsis icon, which engine 0.2.1 does not draw by name (`data-icon="svg"` everywhere)
  const main = ':has\\(> button, > :not\\(\\[data-slot="sidebar\\.workspaces\\.session\\.row\\.action"\\]\\):not\\(\\[class\\*="_rowQuickActions"\\]\\) button\\)'
  assert.match(touch, new RegExp(row + ' > \\[class\\*="_rowActions"\\]' + main + ' > \\[data-slot="sidebar\\.workspaces\\.session\\.row\\.action"\\],\\s*' + row + ' > \\[class\\*="_rowActions"\\]' + main + ' > \\[class\\*="_rowQuickActions"\\],\\s*' + row + ':has\\(> \\[class\\*="_rowActions"\\] > button, > \\[class\\*="_rowActions"\\] > :not\\(\\[data-slot="sidebar\\.workspaces\\.session\\.row\\.action"\\]\\):not\\(\\[class\\*="_rowQuickActions"\\]\\) button\\) > \\[class\\*="_time"\\] \\{\\s*display: none !important;'), 'Archive, Pin and the time are not drawn next to the « … », whatever its icon is called')
  assert.doesNotMatch(touch, /_rowActions"\]:has\(svg\[data-icon\*="ellipsis"\]\) > \[data-slot="sidebar\.workspaces\.session\.row\.action"\]/, 'the hiding no longer waits for an ellipsis icon')
  assert.match(touch, new RegExp('\\[class\\*="_rowActions"\\] button:has\\(svg\\[data-icon\\*="ellipsis"\\]\\),\\s*' + row + ' \\[class\\*="_rowActions"\\]:not\\(:has\\(svg\\[data-icon\\*="ellipsis"\\]\\)\\) button:not\\(\\[class\\*="_rowQuickActions"\\] \\*\\):not\\(\\[data-slot="sidebar\\.workspaces\\.session\\.row\\.action"\\] \\*\\) \\{\\s*display: flex !important;\\s*min-width: 44px !important;'), 'the « … » is 44 x 44, and no button of the quick-actions wrapper is shown')
  assert.doesNotMatch(touch.slice(touch.indexOf('A chat row:')), /data-context-menu-trigger|"workspace:"|aria-label/, 'no mark an older engine lacks, no label that is translated, the workspace rows are not touched')
  assert.doesNotMatch(cssSrc.replace(touch, ''), /_rowActions/, 'a computer keeps the row as the engine draws it')
})

ok('the chips of the composer (access mode, activity) take the same 44 px as every button of the card: no 40 px exception left', () => {
  assert.match(cssSrc, /\[data-composer-card\] button \{\s*min-width: 44px;\s*min-height: 44px;/)
  assert.doesNotMatch(cssSrc, /conversation\.input\.permission"\] button,\s*\[data-composer-card\] \[data-slot="conversation\.input\.activity"\] button \{\s*min-width: 40px;/)
})

ok('the Android app does not draw the maintenance pages\' computer-only parts (engine audit, « unknown » cards, update check, suite update banner); a browser and a computer keep them', () => {
  const hooks = ['maintenance-status', 'maintenance-tiles', 'maintenance-auto-update', 'maintenance-refresh', 'maintenance-details-toggle', 'maintenance-details', 'suite-maj', 'suite-maj-en-cours', 'suite-verifier']
  const m = look.match(/html\.kb-app-android :is\(([^)]*)\) \{\s*display: none !important;/)
  assert.ok(m, 'the rule is there')
  for (const h of hooks) assert.ok(m[1].includes('[data-kb="' + h + '"]'), h)
  assert.ok(!m[1].includes('maintenance-version'), 'the app\'s own version line stays')
  assert.doesNotMatch(cssSrc.slice(0, lookStart), /maintenance-|suite-maj/, 'a computer keeps them')
})

ok('the tab rows of a page keep every label on one line and slide sideways; the Connectors buttons without a fill take the second card tone (no bare text-looking button)', () => {
  assert.match(look, /\[data-slot="main"\] \[role="tablist"\] \{\s*flex-wrap: nowrap !important;\s*overflow-x: auto !important;/)
  assert.match(look, /\[data-slot="main"\] \[role="tablist"\] > \* \{\s*flex: 0 0 auto !important;\s*white-space: nowrap !important;/)
  assert.match(look, /\.kbnm-btn:not\(\.kbnm-primary\), \.kas-btn, \.kb-cust, \.kbsf-seg, \.kb8-tile, \.kbcp-btn:not\(\.primary\) \{\s*border-color: transparent !important;\s*background-color: var\(--kbmob-card2\) !important;/)
})

ok('the Cloud Computer pill on Home shows its whole description: icon and title on the first line, the sentence below, no line clamp', () => {
  assert.match(look, /\.kb8-nc-main \{\s*flex-wrap: wrap !important;/)
  assert.match(look, /\.kb8-nc-main \.kb8-nc-d \{\s*display: block !important;\s*-webkit-line-clamp: unset !important;\s*overflow: visible !important;\s*flex: 1 1 100% !important;/)
})

ok('D4: the plain-text explainers a phone does not need first are hidden by their hooks (the Agent Teams line, the Marketplace line, the Creations hint, the Automations line and note), and the Agent Teams panel shows its copy', () => {
  assert.match(css, /\[data-kb="kybers-sub"\],\s*\[data-kb="market-sub"\],\s*\[data-kb="type-hint-text"\],\s*\[data-kb="automation-onboard-sub"\],\s*\[data-kb="automation-onboard-note"\] \{\s*display: none !important;/)
  assert.match(css, /\[data-kb="kybers-help-sub"\]\[hidden\],\s*\[data-kb="market-help-sub"\]\[hidden\] \{\s*display: block !important;/)
  assert.ok(!/\[data-kb="automation-help-lead"\][^{]*\{\s*display: none/.test(css), 'the lead of the reopened guide stays')
})

ok('D14: the Web Search order arrows are 32 px squares side by side, the engine switches get a 46 x 44 hit area, the Theme preview zones are at least 32 px', () => {
  assert.match(css, /\[data-kb="websearch-engine"\] :has\(> \[data-act="up"\]\) \{\s*flex-direction: row !important;\s*gap: 0 !important;/)
  assert.match(css, /\[data-kb="websearch-engine"\] \[data-act="up"\],\s*\[data-kb="websearch-engine"\] \[data-act="down"\] \{\s*min-width: 32px !important;\s*min-height: 32px !important;/)
  assert.match(css, /\[data-kb="websearch-switch"\]::before \{\s*inset: -12px -6px !important;/)
  assert.match(css, /\[data-kb="theme-zone"\] \{\s*min-width: 32px !important;\s*min-height: 32px !important;/)
})

ok('Settings list: on a phone no row of the list looks selected (the engine marks General at open and the last page after the arrow), the list still opens first, and desktop is not touched', () => {
  const rule = css.match(/\[data-shortcut-modal="settings"\]:not\(\[data-kbmob-page\]\) button\[aria-current="true"\] \{\s*background: transparent !important;\s*font-weight: 400 !important;\s*\}/)
  assert.ok(rule, 'the selected row of the list is drawn like the others')
  assert.ok(css.indexOf('@media (max-width: 700px)') < rule.index, 'the rule sits inside the phone media block, not on desktop')
  assert.ok(!/\[aria-current="true"\][^{]*\{[^}]*display: none/.test(css), 'no row of the list is hidden')
})

ok('Skills toolbar: one layout whatever the search does (as wide as the page, controls at the left in the same order, the open search on its own full-width row below, the page action keeps its place)', () => {
  assert.match(css, /\.kb6-headrow > \.kb6-toolbar \{\s*flex: 1 1 100% !important;/)
  assert.match(css, /\.kb6-toolbar \.kb6-tb-tools \{\s*display: contents !important;/)
  assert.match(css, /\.kb6-toolbar \.kb6-tb-tools > \.kb6-tb-search \{\s*order: 9 !important;\s*flex: 1 1 100% !important;/)
  assert.match(css, /\.kb6-toolbar \.kb6-tb-row > \.kb6-tb-trailing,\s*\.kb6-toolbar \.kb6-tb-row > \.kb6-tb-add \{\s*margin-inline-start: 6px !important;/)
})

ok('Skill sheet: a full-screen sheet on a phone (above the engine\'s dialog cap), sticky header and footer, Install takes the width, GitHub and the star are 48 px icon buttons (the words stay for screen readers), labels above values, the front matter a plain list', () => {
  assert.match(css, /html \[data-kb="skill-popup"\] \{\s*width: 100% !important;\s*max-width: none !important;\s*height: 100% !important;/)
  assert.match(css, /\.kbs-win-back \{\s*padding: 0 !important;/)
  assert.match(css, /\[data-kb="skill-popup"\] \.kbsf-dacts \{\s*position: sticky !important;\s*bottom: 0 !important;/)
  assert.match(css, /\[data-kb="skill-popup"\] \.kbsf-dacts > \.kb8-primary \{\s*flex: 1 1 auto !important;/)
  assert.match(css, /\[data-kb="skill-popup"\] \.kbsf-dacts > \[data-kb="act-github"\] > span \{\s*position: absolute !important;\s*width: 1px !important;/)
  assert.match(css, /\[data-kb="skill-popup"\] \.kb-local-rows \.row \{\s*flex-direction: column !important;/)
  assert.match(css, /\[data-kb="skill-popup"\] \.kbs-md \.fm \{\s*display: block !important;/)
  assert.match(css, /\[data-kb="skill-popup"\] \.kbs-audit \.ligne \{\s*font-family: inherit !important;\s*font-size: 15px !important;/)
  assert.ok(!/\[data-kb="skill-popup"\][^{]*\{[^}]*display: none/.test(css), 'nothing of the sheet is hidden')
})

ok('Models page: a provider\'s name is written in full on a phone (it wraps), not cut with an ellipsis', () => {
  assert.match(css, /\[data-kbm="prov-voir"\],\s*\*:has\(> \[data-kbm="prov-voir"\]\) \{\s*white-space: normal !important;\s*overflow: visible !important;\s*text-overflow: clip !important;/)
})

ok('Home: the line the app writes above a dead composer is a 44 px button in the phone block only', () => {
  assert.match(css, /\[data-kbmob-pick-line\] \{[^}]*min-height: 44px !important;/)
  assert.ok(cssSrc.indexOf('data-kbmob-pick-line') > lookStart, 'only written in the phone look block')
})

ok('Home: on a phone the logo (20 x 22), the headline (20 px / 600, three words at most), the hint, the model name and the Cloud card are smaller and quieter, the typed text keeps 16 px, nothing is hidden, and a computer keeps its Home', () => {
  assert.match(css, /\[data-slot="conversation\.hero\.brand\.mark"\] svg \{\s*width: 20px !important;\s*height: 22px !important;/)
  assert.match(css, /\[data-kb-hero\],\s*\[data-kb-hero\] \* \{\s*font-size: 20px !important;\s*font-weight: 600 !important;/)
  assert.match(css, /\[data-composer-placeholder\] \{\s*font-size: 14px !important;/)
  assert.match(css, /\[data-composer-card\] \[data-kb="model-seat"\] > span \{\s*font-size: 12px !important;/)
  assert.match(css, /\[data-composer-card\] \[data-kb="model-seat"\] \{[^}]*max-width: none !important;[^}]*min-height: 44px !important;/, 'the name shows as much as the row allows, the touch target stays 44 px')
  assert.match(css, /\.kb8-nc-main \.kb8-nc-t \{\s*font-size: 11px !important;/)
  assert.match(css, /\.kb8-nc-main \.kb8-nc-d \{\s*font-size: 10px !important;/)
  assert.ok(!/data-composer-input\][^{]*\{[^}]*font-size: (?:1[0-5]|[0-9])(?:\.\d+)?px/.test(css), 'the typed text is not made smaller than 16 px (iOS zooms the page below it)')
  assert.ok(!/model-seat"\][^{]*\{[^}]*display: none/.test(css) && !/kb-hero\][^{]*\{[^}]*display: none/.test(css), 'nothing of Home is hidden')
  const home = css.slice(css.indexOf('HOME, calmer'), css.indexOf('HOME, calmer') + 3000)
  for (const sel of ['conversation.hero.brand.mark', 'data-kb-hero', 'data-composer-placeholder', 'model-seat', 'kb8-nc-t']) assert.ok(cssSrc.indexOf(sel, lookStart) > 0, sel + ' is only written in the phone look block')
  assert.doesNotMatch(cssSrc.slice(0, lookStart), /conversation\.hero\.brand\.mark|data-kb-hero|kb8-nc-d/, 'a computer keeps its Home as it is')
  assert.ok(home.length > 0)
})

ok('mobile.css names no label the engine translates: the drawer\'s nav is found by the slot it holds, so French and English get the same rules (« Global panels » is « Panneaux globaux »)', () => {
  const bare = cssSrc.replace(/\/\*[\s\S]*?\*\//g, '')
  assert.doesNotMatch(bare, /\[(?:aria-label|title|placeholder)[~|^$*]?=/, 'no selector is keyed on the value of a label, a title or a placeholder (all of them are translated)')
  const navRules = bare.match(/\[data-slot="sidebar"\] nav[^{]*\{/g) || []
  assert.ok(navRules.length >= 3, 'the three rules of the drawer\'s nav (rows, their icons, the hairline) are there')
  assert.ok(navRules.every((s) => s.includes('nav:has([data-slot="sidebar.panellist"])')), 'each of them finds the nav by the slot it holds, not by a word or a hashed class')
})

ok('message flow code blocks scroll horizontally on small screens (700 px / landscape touch) without touching desktop or font sizes', () => {
  const m = /\[data-slot="conversation\.chat\.flow"\] pre \{\s*overflow-x: auto;\s*\}/.exec(cssSrc)
  assert.ok(m !== null, 'overflow-x: auto is set on message flow pre')
  assert.ok(m.index > cssSrc.indexOf('@media (max-width: 700px)') && m.index < lookStart, 'inside the 700 px / landscape touch phone block')
})

console.log(`\n${count} tests passed`)
