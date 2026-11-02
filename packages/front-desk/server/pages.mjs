// The visitor's chat page, and the pieces the owner's pages share (owner-pages.mjs). One HTML file with an inline style and script under
// a CSP nonce, no external request, and every piece of data is put in the page with textContent, never as markup. The script and the
// stylesheet are real files under ./ui. English is the source; French lives in its own dictionary.

import fs from 'node:fs';

const read = (name) => fs.readFileSync(new URL(`./ui/${name}`, import.meta.url), 'utf8');
const CHAT_JS = read('chat.js');
const CHAT_CSS = read('chat.css');

const CHAT_EN = {
  placeholder: 'Write your message…', send: 'Send', ai: 'AI assistant', aiNote: 'You are talking to an AI assistant.',
  mydata: 'My data', remembered: 'What is remembered about you', nothing: 'Nothing is remembered about you.',
  erase: 'Erase everything', eraseConfirm: 'Click again to confirm', close: 'Close',
  typing: 'Typing…', neterr: 'Could not reach the assistant. Please try again.',
  first_name: 'First name', email: 'Email', preference: 'Preference', yes: 'Yes, remember', no: 'No thanks',
  owner: 'The shop', joined: 'A person from the shop is now answering you.', preview: 'Preview of the draft: nothing here is real, nothing is kept.',
};
const CHAT_FR = {
  placeholder: 'Écris ton message…', send: 'Envoyer', ai: 'Assistant IA', aiNote: 'Tu parles à un assistant IA.',
  mydata: 'Mes données', remembered: 'Ce qui est retenu sur toi', nothing: 'Rien n’est retenu sur toi.',
  erase: 'Tout effacer', eraseConfirm: 'Clique encore pour confirmer', close: 'Fermer',
  typing: 'Écrit…', neterr: 'Impossible de joindre l’assistant. Réessaie.',
  first_name: 'Prénom', email: 'E-mail', preference: 'Préférence', yes: 'Oui, retenir', no: 'Non merci',
  owner: 'La boutique', joined: 'Une personne de la boutique te répond maintenant.', preview: 'Aperçu du brouillon : rien ici n’est réel, rien n’est gardé.',
};

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** JSON that is safe inside a <script type="application/json"> block. */
export const safeJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028').replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');

export const BASE_CSS = `
:root{--bg:#fbfaf7;--card:#fff;--ink:#1d2421;--ink2:#5b655f;--line:#dcd9d0;--well:#f1efe9;--warn:#fff3cd;--warnink:#6b4e00;--ok:#e3f3e8;--okink:#155d2e;--bad:#fde4e1;--badink:#8a1c12}
@media (prefers-color-scheme:dark){:root{--bg:#141816;--card:#1c211f;--ink:#e8ece9;--ink2:#9aa6a0;--line:#2f3733;--well:#242a27;--warn:#3a3114;--warnink:#f0d589;--ok:#183524;--okink:#8fdcab;--bad:#3d1b17;--badink:#f4b3ab}}
*{box-sizing:border-box}html,body{margin:0;height:100%}[hidden]{display:none!important}
body{background:var(--bg);color:var(--ink);font:16px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
button{font:inherit;color:inherit;border:1px solid var(--line);background:var(--card);border-radius:10px;padding:8px 14px;cursor:pointer}
button:hover{background:var(--well)}button:focus-visible,textarea:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--brand,#2F6B54);outline-offset:2px}
button.primary{background:var(--brand,#2F6B54);border-color:var(--brand,#2F6B54);color:#fff}button.primary:hover{filter:brightness(1.08)}
button[disabled]{opacity:.55;cursor:default}
`;

/** `preview`: the owner's view of the draft (inside the Atelier): same page, its own API, nothing kept in the browser. */
export function chatPage({ fiche, nonce, preview = false }) {
  const lang = fiche.language;
  const T = lang === 'fr' ? CHAT_FR : CHAT_EN;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(fiche.name)}</title><style nonce="${nonce}">${BASE_CSS}
:root{--brand:${fiche.brand.color}}
${CHAT_CSS}</style></head><body>
<div class="app"><header><div class="logo" id="logo" aria-hidden="true"></div><div class="t"><span id="name"></span><small id="hello"></small></div><button type="button" id="mydata"></button></header>
<div id="log" role="log" aria-live="polite"></div>
<form id="f" autocomplete="off"><textarea id="in" rows="1" maxlength="2000" aria-label="message"></textarea><button class="primary" id="send" type="submit"></button></form>
<div class="note" id="ainote"></div>
<div class="panel" id="panel" role="dialog" aria-modal="true" aria-labelledby="ph"><div class="panel-in"><h2 id="ph" class="h0"></h2><dl id="fields"></dl><p id="none"></p><div class="btns"><button type="button" id="erase"></button><button type="button" id="close"></button></div><p id="pmsg" class="muted"></p></div></div>
</div>
<script type="application/json" id="cfg">${safeJson({ slug: fiche.slug, lang, name: fiche.name, hello: fiche.brand.greeting, t: T, preview })}</script>
<script nonce="${nonce}">${CHAT_JS}</script></body></html>`;
}
