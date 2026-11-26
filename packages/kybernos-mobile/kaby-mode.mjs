// kybernos-mobile: the « Kaby mode » list, in one place.
//
// Kaby mode (the app's « Simple ») is a SWITCH the app's shell sets (a user-agent token, see KABY_UA_TOKEN): the same DSH, wherever it runs (a cloud computer, the person's own
// computer through the phone link, or an engine on the phone), opened on Kaby's conversation, with the phone's own screens: the drawer (the real sidebar), the account menu
// (the avatar) and Settings. Those three are NOT drawn here: they are the full app's screens, filtered by the locked « Simple » preset (kybernos-theme `locked-simple`, applied by
// the Kybernos plugin: the main menu's rows, the account menu's entries, the Settings pages). What this file hides is what the preset has no entry for: parts of the chat itself.
// What is shown and what is hidden is the two tables below and nothing else, so that changing the product's mind is one line here. This file is read by the host half (index.js
// builds the stylesheet from it, so the page paints already in Kaby mode) and by the tests; the browser half only needs the class `kb-kaby` and the declared hooks (`KABY_SHOW`).
//
// Every rule is keyed on what DSH and the other bundles keep stable (`data-slot`, `data-kb`, `data-shell-*`), never on a hashed class name nor on a translated label.
// A hidden thing is hidden by CSS and stays in the page: the desktop, the browser and the full app keep it.

import { MODE_CLASS } from './mode.mjs'

/** The user-agent token the shell puts after the app's own (`KybernosHost/<version> (ios|android) KabyMode/<n>`); `<n>` is the contract version the shell speaks, from 1 (0, or no token, is off). */
export const KABY_UA_TOKEN = 'KabyMode'
/** The highest contract version this build understands. A shell that says a higher one is served as this one. */
export const KABY_MODE_VERSION = 1
/** The class on `<html>` while Kaby mode is on. */
export const KABY_CLASS = 'kb-kaby'
/** The source of the user-agent test, kept as text so the host can put the same test in the page head (it runs before any bundle). */
export const KABY_UA_SOURCE = 'KybernosHost\\/[0-9][0-9A-Za-z.+-]* \\((?:ios|android)\\) ' + KABY_UA_TOKEN + '\\/([1-9][0-9]{0,2})'

/** What the person keeps. `probe` is the hook a live check looks for; `where` says which bundle draws it. */
export const KABY_SHOW = Object.freeze([
  { id: 'conversation', what: 'Kaby’s conversation, opened directly (no sidebar, no list of chats)', probe: '[data-slot="conversation.chat.flow"]', where: 'kybernos-kyber openChat()' },
  { id: 'composer', what: 'The composer: the message field, attach (+) and send', probe: '[data-slot="conversation.composer.bar"]', where: 'DSH' },
  { id: 'answers', what: 'The answers, with copy and the rating', probe: '[data-slot="conversation.chat.node"]', where: 'DSH' },
  { id: 'approval', what: 'DSH’s own approval card (Reject / Allow once), answered in the page', probe: '[data-slot*="approval"]', where: 'DSH' },
  { id: 'report', what: 'The « Report » link under each finished answer (store rule)', probe: '[data-kb="report-tail"]', where: 'kybernos-mobile' },
  { id: 'drawer', what: 'The phone’s own drawer, the real sidebar: its rows are the ones the locked Simple preset keeps (Kaby, Reminders, Apps), then the chats (Recents) and the dock at its foot; the burger in the corner opens it', probe: '[data-kb="mobile-menu"]', where: 'kybernos-mobile (the drawer), kybernos-plugin (the rows)' },
  { id: 'account-menu', what: 'The avatar in the drawer’s dock: it opens the real account menu, filtered by the locked Simple preset (spaces, plan, appearance, help, feedback; Settings, Referral and Sign out always)', probe: '[data-kb="mobile-avatar"]', where: 'kybernos-mobile, kybernos-cloud (the menu), kybernos-plugin (the filter)' },
  { id: 'settings', what: 'DSH’s real Settings, reached from the avatar’s menu, filtered to the pages the locked Simple preset keeps (General, Kaby, Memory & Lessons, Connectors, Usage, Theme, Language, About); About carries the sections only the phone can offer (Notifications, Your computer, Account and plan, Help and report, Need more?, then App settings, licences, automations on this phone)', probe: '[data-shortcut-modal="settings"]', where: 'DSH, kybernos-plugin (the filter), kybernos-maintenance (About), kybernos-mobile (its parts)' },
  { id: 'mode-switch', what: '« Need more? » in About (the app’s parts): the line that asks the shell for Advanced mode (`set-mode`); drawn only when the shell says it can (`shell-state` with `capabilities.mode`), so a build that has no Advanced mode shows nothing', probe: '[data-kb="kaby-mode-switch"]', where: 'kybernos-mobile' },
  { id: 'connect-card', what: 'The card « Kaby wants to connect <app> » (Connect / Not now)', probe: '[data-kb="kaby-connect-card"]', where: 'kybernos-mobile' },
])

/**
 * What the person does not get in Kaby mode. One row per thing: `id` (a word), `what` (plain words), `why`, and `css`, the selectors the rule hides (a list, joined with a comma).
 * Rows are applied in order; none of them hides a hook of KABY_SHOW (the test checks that on the text of the selectors, the live check on the real page).
 */
export const KABY_HIDE = Object.freeze([
  { id: 'header', what: 'DSH’s chat header (the title, Teams, the call button, « More actions », the Chat / Journal / Trajectory views, the right-bar button)',
    why: 'A chat on the phone is Kaby’s conversation, not a workbench; the way out of it is the drawer’s burger, which is not part of the header. The phone call stays out until the owner decides about live calls.',
    css: ['[data-slot="conversation.header"]', '[data-slot="conversation.session.header"]'] },
  { id: 'rightbar', what: 'The right bar (files, changes, details, the tabs) and the empty bottom row of the shell',
    why: 'A workbench tool: no room for it on a phone, and the empty bottom row is a strip with nothing in it.',
    css: ['[data-rightbar-col]', '[data-slot="rightbar"]', '[data-slot^="rightbar."]', '[data-shell-bottom]'] },
  { id: 'composer-options', what: 'In the composer, five controls of the engine: the access-mode shield, the « / » commands button, dictation, the input device and the artifact button, and the voice-input setup button',
    why: 'The preset has no permission, no slash-command line (the « + » list has the commands), no dictation (the shell has not planned the microphone) and no artifact button: kept hidden until the owner decides, one by one. Everything else of the composer is the web app\u2019s and is NOT hidden: the model picker (the person chooses among the whole Kybernos Models catalogue, the phone\u2019s own small model being one entry of that list) and the controls other bundles draw in the side slots (« Execution environment », « Run on »). Only the engine\u2019s own buttons of the left slot are hidden (a direct child `button`), never a control another bundle draws beside them.',
    css: ['[data-slot="conversation.input.permission"]', '[data-slot="conversation.input.left"] > button', '[data-slot="conversation.input.right"]', '[data-slot="conversation.input.activity"]'] },
  { id: 'kaby-strip', what: 'Kaby’s strip above the composer (the « Remote control · … », Telegram and « This computer · Ready » chips, « Customise Kaby », the help button)',
    why: 'Remote control and channels are not part of the phone app; the computer’s state is in About, under Settings.',
    css: ['[data-kb="kybernos-kyber-dock"]'] },
  { id: 'new-chat', what: 'The new-chat home’s workbench parts (the « Beta » badge, the full template shelf, the cloud-computer card, the folder and mode pickers)',
    why: 'The new-chat home IS shown in Simple (owner’s mock-up of 2026-11-24, list items 22 and 24): the small K, the headline (« A blank page ») and the phone’s own cards (ONE slider of the shelf’s drawings with « See all », `data-kb="ncs"`, not named `newchat-…`) stay. What is a workbench’s stays out: the badge, the full shelf and the cloud-computer line (`newchat-…`), the folder and mode pickers. The folder picker has no hook of its own: it is found by its folder icon (DSH 0.2.2-rc.1), not by its translated label. A hero part that holds the composer is never hidden: on DSH 0.2.2-rc.5 `conversation.hero.frame` wraps the composer of the new-chat page (it sat beside it on 0.2.1-rc.2), so hiding it left a blank page with no way to write; nor is the brand mark (the K).',
    css: ['[data-slot^="conversation.hero"]:not([data-slot="conversation.hero.brand.mark"]):not(:has([data-composer-input], [contenteditable="true"], [data-slot="conversation.composer.bar"]))', '[data-kb^="newchat-"]', '[data-kb-beta]', 'div:has(> button > svg[data-icon^="dsw-icon-folder-open"])'] },
  { id: 'model-keys', what: 'The « Add a model » button of the « No model to answer with yet » notice, and « A model on this computer » of the « This chat can’t answer yet » notice (own model keys, the model wizard)',
    why: 'The person’s model comes with the account; the notices’ « Sign in » button stays. The second notice has no hook for its first button: it stays too (phone engine 0.2.1-rc.2 shows it when the chat’s model has no key).',
    css: ['[data-kb="no-model-add"]', '[data-kb="need-model-local"]'] },
  { id: 'answer-extras', scope: 'mode', what: 'Under an answer: « summarize » and « Action »',
    why: 'They start work outside the conversation.',
    css: ['[data-kb-edit="summarize"]', '[data-kb-add]'] },
  { id: 'process', scope: 'mode', what: 'The agent’s steps in the chat: its thinking, its commands (bash) and its other tool calls, while it works and once it is done',
    why: 'Simple is the answer, a status and a door (owner’s list items 32 and 35: « Simple = answer + status + Details »): what the agent did on the way is not part of it. The status line the engine draws while the agent works and the « Worked n s » line under a finished turn stay: that line is the door. A tap on it makes the engine open the turn’s process (`aria-expanded="true"`), and then the steps it shows are shown: that is « Details »; the engine keeps every other step out of sight itself (`data-turn-process-hidden`), so what is covered here is what the engine shows without a tap (the thinking line while the agent works) and the tool cards. Interactive cards that ask the person (`ask_user_question`, approval cards `[data-slot*="approval"]` and connector asks `[data-kb="connector-ask"]`) are never hidden, even when nested inside a tool card or a process member. Limitation: DSH renders flow rows as flat siblings keyed by `data-chat-turn` without a per-turn wrapper, so pure CSS scopes the Details toggle to the flow; other finished turns still keep their collapsed members hidden through DSH’s own `data-turn-process-hidden`.',
    css: [
      // The scope is the chat's own flow (`[data-chat-flow]` also marks wrappers nested inside it, none of which holds the whole chat): no turn of it has its process open.
      // Per-turn CSS scoping is not possible without a per-turn DOM wrapper (DSH emits flat siblings keyed by data-chat-turn); DSH itself still hides other collapsed turns via data-turn-process-hidden.
      '[data-slot="conversation.chat.flow"]:not(:has([data-chat-flow-kind="turn-process"] button[aria-expanded="true"])) [data-turn-process-member]:not([data-turn-process-hidden]):not([data-slot*="approval"]):not([data-kb="connector-ask"]):not([data-tool="ask_user_question"]):not(:has([data-tool="ask_user_question"], [data-slot*="approval"], [data-kb="connector-ask"]))',
      '[data-slot="conversation.chat.flow"]:not(:has([data-chat-flow-kind="turn-process"] button[aria-expanded="true"])) [data-turn-process-inline]:not([data-turn-process-hidden]):not([data-slot*="approval"]):not([data-kb="connector-ask"]):not([data-tool="ask_user_question"]):not(:has([data-tool="ask_user_question"], [data-slot*="approval"], [data-kb="connector-ask"]))',
      '[data-slot="conversation.chat.flow"]:not(:has([data-chat-flow-kind="turn-process"] button[aria-expanded="true"])) [data-tool]:not([data-turn-process-hidden]):not([data-tool="ask_user_question"]):not([data-slot*="approval"]):not([data-kb="connector-ask"]):not(:has([data-tool="ask_user_question"], [data-slot*="approval"], [data-kb="connector-ask"]))'] },
  { id: 'store-controls', what: 'Buy, create-account and add-a-plugin controls (as in the full app)', why: 'Store rules (kybernos-host/STORES.md items 1, 5, 6): the same hooks the full app hides (STORE_HIDDEN in client.js).', css: [] },
])

/**
 * One row's rule. A row is keyed on the class of the axis it belongs to: `scope: 'mode'` (the technical view: what Simple folds, whatever the screen and the host) follows `html.kb-simple`;
 * every other row is the phone app's own frame (`scope: 'phone'`, the default) and follows `html.kb-kaby`, the class the shell's user agent sets. See mode.mjs for the three axes.
 */
export const classOf = (row) => (row.scope === 'mode' ? MODE_CLASS : KABY_CLASS)
const asRule = (selectors, cls = KABY_CLASS) => selectors.map((s) => 'html.' + cls + ' ' + s).join(',\n') + ' { display: none !important; }'

/**
 * The whole stylesheet of Kaby mode, from the one table. Pure. There is no layout rule: the page is the phone's own (mobile.css), whose frame is one column at this width whatever the
 * engine remembers of the right bar.
 */
export function kabyCss (hide = KABY_HIDE) {
  const out = ['/* kybernos-mobile: Kaby mode (generated from kaby-mode.mjs; applies only under html.' + KABY_CLASS + ') */']
  for (const row of hide) {
    if (!Array.isArray(row.css) || row.css.length === 0) continue
    out.push('/* ' + row.id + ' (' + (row.scope === 'mode' ? 'mode' : 'phone') + '): ' + row.what.replace(/\*\//g, '* /') + ' */', asRule(row.css, classOf(row)))
  }
  return out.join('\n') + '\n'
}

/**
 * The few lines that put the class on `<html>` before the first paint: the same test as the browser half, in the page head. `<` never appears in it, so it cannot close its tag.
 * A page that refuses inline scripts simply does not get it: the browser half sets the class as soon as it runs.
 */
export const KABY_EARLY_SCRIPT = '(function(){try{if(/' + KABY_UA_SOURCE + '/.test(navigator.userAgent))document.documentElement.classList.add(\'' + KABY_CLASS + '\')}catch(e){}})()'

export const KABY_STYLE_ID = 'kbmob-kaby'
export const KABY_ROUTE = '/kybernos-mobile/kaby.css'

/** The head rows for one index render: the stylesheet, then the early script. Never throws. */
export function kabyRows () {
  try {
    const css = kabyCss()
    if (/<\/style/i.test(css)) return []
    return [
      { kind: 'html', placement: 'head', html: '<style id="' + KABY_STYLE_ID + '">' + css + '</style>' },
      { kind: 'html', placement: 'head', html: '<script>' + KABY_EARLY_SCRIPT + '</script>' },
    ]
  } catch (e) { return [] }
}
