// The owner's two pages: the Atelier (the draft, the gate, the preview) and the Boîte (conversations, contacts, what is left to do).
// Their scripts are real files under ./ui (so they can be syntax-checked and read like code) and are put inline under the page's CSP
// nonce. English is the source; French lives in its own dictionary. Data reaches the page with textContent only, never as markup.

import fs from 'node:fs';
import { BASE_CSS, esc, safeJson } from './pages.mjs';

const read = (name) => fs.readFileSync(new URL(`./ui/${name}`, import.meta.url), 'utf8');
const KIT = read('kit.js');
const CSS = read('owner.css');
const BOITE_JS = read('boite.js');
const ATELIER_JS = read('atelier.js');

const ACT_EN = {
  'act.leave_message': 'left a message for the shop', 'act.request_callback': 'asked for a callback', 'act.note_visitor': 'remembered a detail (with consent)',
  'act.forget_visitor': 'erased the visitor', 'act.list_slots': 'listed free appointment slots', 'act.book_appointment': 'booked an appointment',
  'act.order_status': 'told the state of an order', 'act.report_unanswered': 'noted a question it could not answer',
};
const ACT_FR = {
  'act.leave_message': 'a laissé un message pour la boutique', 'act.request_callback': 'a demandé un rappel', 'act.note_visitor': 'a retenu un détail (avec accord)',
  'act.forget_visitor': 'a effacé le visiteur', 'act.list_slots': 'a listé les créneaux libres', 'act.book_appointment': 'a pris un rendez-vous',
  'act.order_status': 'a donné l’état d’une commande', 'act.report_unanswered': 'a noté une question sans réponse',
};

const SHARED_EN = {
  token: 'Owner token', open: 'Open', badToken: 'Wrong token.', refresh: 'Refresh', none: 'Nothing.', you: 'You', send: 'Send',
  f_first_name: 'First name', f_email: 'Email', f_preference: 'Preference', erase: 'Erase', eraseConfirm: 'Click again to confirm',
  ch_site: 'Website', ch_tg: 'Telegram', ch_wa: 'WhatsApp', ch_tel: 'Phone', ch_web: 'Web',
  l1: '1 · anonymous', l2: '2 · sender checked by the channel', l3: '3 · one-time code',
};
const SHARED_FR = {
  token: 'Jeton du propriétaire', open: 'Ouvrir', badToken: 'Jeton incorrect.', refresh: 'Actualiser', none: 'Rien.', you: 'Toi', send: 'Envoyer',
  f_first_name: 'Prénom', f_email: 'E-mail', f_preference: 'Préférence', erase: 'Effacer', eraseConfirm: 'Clique encore pour confirmer',
  ch_site: 'Site', ch_tg: 'Telegram', ch_wa: 'WhatsApp', ch_tel: 'Téléphone', ch_web: 'Web',
  l1: '1 · anonyme', l2: '2 · expéditeur vérifié par le canal', l3: '3 · code à usage unique',
};

const BOITE_EN = {
  ...SHARED_EN, ...ACT_EN, title: 'Inbox', of: 'of', running: 'running now', stopped: 'The assistant is stopped.', stop: 'Stop the assistant', resume: 'Resume the assistant',
  needsYou: 'Needs you', approve: 'Approve', reject: 'Reject', tabChats: 'Conversations', tabTodo: 'To do', noChats: 'No conversation yet.',
  messages: 'Messages left for the shop', callbacks: 'Callback requests', bookings: 'Appointments', unanswered: 'Questions without an answer',
  answerHere: 'Write the fact the assistant should know', addAnswer: 'Add to the draft', dismiss: 'Ignore', answerAdded: 'Added to the draft. Publish it in the Atelier.',
  modeHuman: 'You are answering', modeAgent: 'The assistant is answering', handBack: 'Hand back to the assistant', takeOver: 'Take over',
  did: 'Assistant', waiting: 'waiting for you', replyPlaceholder: 'Write to the visitor…', replyTakes: 'Writing here takes the conversation over: the assistant stays quiet until you hand it back.',
  notDelivered: 'Saved, but it could not be sent on that channel.', contact: 'Contact card', channel: 'Channel', level: 'Identity level',
  remembered: 'Remembered, with consent', noneKnown: 'Nothing is remembered.', consentAt: 'agreed on', didHeading: 'What the assistant did',
  undo: 'Undo', undone: 'undone', export: 'Export', pickOne: 'Pick a conversation.',
};
const BOITE_FR = {
  ...SHARED_FR, ...ACT_FR, title: 'Boîte', of: 'sur', running: 'en cours', stopped: 'L’assistant est arrêté.', stop: 'Arrêter l’assistant', resume: 'Relancer l’assistant',
  needsYou: 'À toi de décider', approve: 'Accepter', reject: 'Refuser', tabChats: 'Conversations', tabTodo: 'À faire', noChats: 'Aucune conversation pour l’instant.',
  messages: 'Messages laissés pour la boutique', callbacks: 'Demandes de rappel', bookings: 'Rendez-vous', unanswered: 'Questions sans réponse',
  answerHere: 'Écris le fait que l’assistant doit connaître', addAnswer: 'Ajouter au brouillon', dismiss: 'Ignorer', answerAdded: 'Ajouté au brouillon. Publie-le dans l’Atelier.',
  modeHuman: 'Tu réponds', modeAgent: 'L’assistant répond', handBack: 'Rendre à l’assistant', takeOver: 'Prendre la main',
  did: 'Assistant', waiting: 'en attente de toi', replyPlaceholder: 'Écris au visiteur…', replyTakes: 'Écrire ici prend la conversation en main : l’assistant se tait jusqu’à ce que tu la lui rendes.',
  notDelivered: 'Enregistré, mais impossible de l’envoyer sur ce canal.', contact: 'Fiche du contact', channel: 'Canal', level: 'Niveau d’identité',
  remembered: 'Retenu, avec accord', noneKnown: 'Rien n’est retenu.', consentAt: 'accepté le', didHeading: 'Ce que l’assistant a fait',
  undo: 'Annuler', undone: 'annulé', export: 'Exporter', pickOne: 'Choisis une conversation.',
};

const ATELIER_EN = {
  ...SHARED_EN, ...ACT_EN, title: 'Atelier', live: 'Live: version {n}', draftN: 'Draft: {n} change(s)', noDraft: 'No draft changes', discard: 'Discard the draft', discardConfirm: 'Click again to discard',
  gateTitle: 'Before you publish', cChanges: 'The draft has changes', cFacts: 'Every fact is checked', cFactsOpen: '{n} fact(s) still to check', cReview: 'You read what the assistant can really do',
  cChecks: 'The checks have not been run on this draft', cChecksOk: 'The {n} checks pass', cChecksBad: 'A check failed', iRead: 'I read it', iReadDone: 'Read', readSheet: 'Go and read it', runChecks: 'Run the checks', runAgain: 'Run again',
  publish: 'Publish', cannotPublish: 'Not published: something changed. Look at the list.',
  bNoChanges: 'nothing to publish', bFacts: '{n} fact(s) to check', bReview: 'read the list of what it can do', bChecks: 'run the checks', bChecksFailed: 'a check failed',
  ficheTitle: 'The fiche', ficheNote: 'What the assistant is told. A line with a bar on its left changed since the live version.',
  fName: 'Name', fLang: 'Language', fIdentity: 'About the shop', fTone: 'Tone', fGreeting: 'Greeting', fColor: 'Colour (#rrggbb)', fUnknown: 'When it does not know',
  fInstructions: 'Instructions', addInstruction: 'Add an instruction', fFacts: 'Facts', addFact: 'Add a fact (you check it by adding it)', add: 'Add', remove: 'Remove',
  validated: 'checked', toValidate: 'to check', source: 'source', validate: 'Check it',
  guardTitle: 'Guard-rails', guardNote: 'Read by the code, never shown to the assistant. Only you can change money and doors.',
  gActions: 'What it may do', level2: 'needs a verified sender', m_off: 'off', m_approve: 'you approve each time', m_auto: 'on its own',
  needs_calendar: 'needs the agenda switched on', needs_orders: 'needs a shop connector (not available yet)',
  gBudget: 'Money and memory', gDay: 'Daily cap ({c})', gVisitor: 'Per visitor ({c})', gRetention: 'Keep conversations (months)',
  gOrigins: 'Sites that may show the chat', gOriginsNote: 'Without a site here, the chat only works on its own link.', badOrigin: 'That is not a site address (for example https://www.my-shop.example).',
  gAgenda: 'Agenda', agendaOn: 'The assistant can offer and book appointment slots', aFrom: 'From', aTo: 'To', aSlot: 'Slot (minutes)', aHorizon: 'Days ahead',
  d0: 'Sun', d1: 'Mon', d2: 'Tue', d3: 'Wed', d4: 'Thu', d5: 'Fri', d6: 'Sat',
  sheetTitle: 'What the assistant can really do', sAuto: 'on its own', sApprove: 'with your approval', sNothing: 'It can only answer questions.',
  sBudget: 'It spends at most {day} a day, and {visitor} per visitor.', sMemory: 'It can remember, only after the visitor agrees: {fields}.',
  sOrigins: 'The chat can appear on: {list}.', sNoOrigins: 'The chat only works on its own link: no site is listed.', sRetention: 'Conversations are kept {n} months.',
  sCannot: 'It cannot reveal these settings, use a tool that is not listed, or read what is known about another visitor.',
  changesTitle: 'Changes since the live version', noChanges: 'None.', risk_low: 'look', risk_medium: 'careful', risk_high: 'money or doors',
  d_name: 'Name', d_language: 'Language', d_identity: 'About the shop', d_tone: 'Tone', d_unknown: 'When it does not know', 'd_brand.color': 'Colour', 'd_brand.greeting': 'Greeting',
  d_fact: 'Fact', d_instruction: 'Instruction', 'd_agenda.enabled': 'Agenda on', 'd_agenda.days': 'Agenda days', 'd_agenda.from': 'Agenda from', 'd_agenda.to': 'Agenda to',
  'd_agenda.slotMinutes': 'Slot length', 'd_agenda.horizonDays': 'Days ahead', 'd_agenda.timezone': 'Agenda time zone',
  'd_budget.dailyCapMicro': 'Daily cap', 'd_budget.visitorDailyCapMicro': 'Per-visitor cap', d_allowedOrigin: 'Allowed site', d_enabled: 'Assistant on', d_retentionMonths: 'Months kept',
  siteTitle: 'On your site', siteNote: 'Publish first: visitors see the live version, not the draft.', sitePublic: 'Public link of the chat:', siteScript: 'Or paste this on your site, before the closing body tag:',
  copy: 'Copy', copied: 'Copied', sitePublicMissing: 'The public address of this service is not set: the link above is the one you are on now.',
  siteNoOrigins: 'Add your site above, or the browser will refuse to show the chat there.', channels: 'Channels', chSite: 'Website: on', chTg: 'Telegram: connected (@{u})', chTgOff: 'Telegram: not connected',
  versionsTitle: 'Versions', restore: 'Restore', restoreConfirm: 'Click again to restore', journal: 'Journal',
  j_publish: 'published', j_rollback: 'restored', j_draft: 'edited the draft', j_discard: 'discarded the draft', j_review: 'read the list', j_checks: 'ran the checks',
  aboveCeiling: 'That value is above the limit the service allows.', previewTitle: 'Preview of your draft', previewNote: 'Nothing here is real: no message is kept and nothing is booked.', startOver: 'Start over',
};
const ATELIER_FR = {
  ...SHARED_FR, ...ACT_FR, title: 'Atelier', live: 'En ligne : version {n}', draftN: 'Brouillon : {n} changement(s)', noDraft: 'Pas de changement en brouillon', discard: 'Abandonner le brouillon', discardConfirm: 'Clique encore pour abandonner',
  gateTitle: 'Avant de publier', cChanges: 'Le brouillon a des changements', cFacts: 'Chaque fait est vérifié', cFactsOpen: '{n} fait(s) à vérifier', cReview: 'Tu as lu ce que l’assistant peut vraiment faire',
  cChecks: 'Les tests n’ont pas été lancés sur ce brouillon', cChecksOk: 'Les {n} tests passent', cChecksBad: 'Un test a échoué', iRead: 'Je l’ai lu', iReadDone: 'Lu', readSheet: 'Aller le lire', runChecks: 'Lancer les tests', runAgain: 'Relancer',
  publish: 'Publier', cannotPublish: 'Pas publié : quelque chose a changé. Regarde la liste.',
  bNoChanges: 'rien à publier', bFacts: '{n} fait(s) à vérifier', bReview: 'lis la liste de ce qu’il peut faire', bChecks: 'lance les tests', bChecksFailed: 'un test a échoué',
  ficheTitle: 'La fiche', ficheNote: 'Ce qu’on dit à l’assistant. Une ligne avec une barre à gauche a changé depuis la version en ligne.',
  fName: 'Nom', fLang: 'Langue', fIdentity: 'À propos de la boutique', fTone: 'Ton', fGreeting: 'Message d’accueil', fColor: 'Couleur (#rrggbb)', fUnknown: 'Quand il ne sait pas',
  fInstructions: 'Consignes', addInstruction: 'Ajouter une consigne', fFacts: 'Faits', addFact: 'Ajouter un fait (tu le vérifies en l’ajoutant)', add: 'Ajouter', remove: 'Retirer',
  validated: 'vérifié', toValidate: 'à vérifier', source: 'source', validate: 'Le vérifier',
  guardTitle: 'Garde-fous', guardNote: 'Lus par le code, jamais montrés à l’assistant. Toi seul peux changer l’argent et les portes.',
  gActions: 'Ce qu’il peut faire', level2: 'demande un expéditeur vérifié', m_off: 'éteint', m_approve: 'tu valides à chaque fois', m_auto: 'tout seul',
  needs_calendar: 'demande l’agenda activé', needs_orders: 'demande un connecteur de boutique (pas encore disponible)',
  gBudget: 'Argent et mémoire', gDay: 'Plafond par jour ({c})', gVisitor: 'Par visiteur ({c})', gRetention: 'Garder les conversations (mois)',
  gOrigins: 'Sites qui peuvent afficher le chat', gOriginsNote: 'Sans site ici, le chat ne marche que sur son propre lien.', badOrigin: 'Ce n’est pas une adresse de site (par exemple https://www.ma-boutique.example).',
  gAgenda: 'Agenda', agendaOn: 'L’assistant peut proposer et réserver des créneaux', aFrom: 'De', aTo: 'À', aSlot: 'Créneau (minutes)', aHorizon: 'Jours à l’avance',
  d0: 'Dim', d1: 'Lun', d2: 'Mar', d3: 'Mer', d4: 'Jeu', d5: 'Ven', d6: 'Sam',
  sheetTitle: 'Ce que l’assistant peut vraiment faire', sAuto: 'tout seul', sApprove: 'avec ton accord', sNothing: 'Il ne peut que répondre aux questions.',
  sBudget: 'Il dépense au plus {day} par jour, et {visitor} par visiteur.', sMemory: 'Il peut retenir, seulement si le visiteur est d’accord : {fields}.',
  sOrigins: 'Le chat peut apparaître sur : {list}.', sNoOrigins: 'Le chat ne marche que sur son propre lien : aucun site n’est listé.', sRetention: 'Les conversations sont gardées {n} mois.',
  sCannot: 'Il ne peut pas révéler ces réglages, utiliser un outil qui n’est pas listé, ni lire ce qu’on sait d’un autre visiteur.',
  changesTitle: 'Changements depuis la version en ligne', noChanges: 'Aucun.', risk_low: 'apparence', risk_medium: 'prudence', risk_high: 'argent ou portes',
  d_name: 'Nom', d_language: 'Langue', d_identity: 'À propos de la boutique', d_tone: 'Ton', d_unknown: 'Quand il ne sait pas', 'd_brand.color': 'Couleur', 'd_brand.greeting': 'Message d’accueil',
  d_fact: 'Fait', d_instruction: 'Consigne', 'd_agenda.enabled': 'Agenda activé', 'd_agenda.days': 'Jours de l’agenda', 'd_agenda.from': 'Agenda de', 'd_agenda.to': 'Agenda jusqu’à',
  'd_agenda.slotMinutes': 'Durée d’un créneau', 'd_agenda.horizonDays': 'Jours à l’avance', 'd_agenda.timezone': 'Fuseau de l’agenda',
  'd_budget.dailyCapMicro': 'Plafond par jour', 'd_budget.visitorDailyCapMicro': 'Plafond par visiteur', d_allowedOrigin: 'Site autorisé', d_enabled: 'Assistant activé', d_retentionMonths: 'Mois gardés',
  siteTitle: 'Sur ton site', siteNote: 'Publie d’abord : les visiteurs voient la version en ligne, pas le brouillon.', sitePublic: 'Lien public du chat :', siteScript: 'Ou colle ceci dans ton site, avant la balise de fin de body :',
  copy: 'Copier', copied: 'Copié', sitePublicMissing: 'L’adresse publique de ce service n’est pas définie : le lien ci-dessus est celui où tu es maintenant.',
  siteNoOrigins: 'Ajoute ton site plus haut, sinon le navigateur refusera d’y afficher le chat.', channels: 'Canaux', chSite: 'Site : actif', chTg: 'Telegram : connecté (@{u})', chTgOff: 'Telegram : non connecté',
  versionsTitle: 'Versions', restore: 'Restaurer', restoreConfirm: 'Clique encore pour restaurer', journal: 'Journal',
  j_publish: 'publié', j_rollback: 'restauré', j_draft: 'brouillon modifié', j_discard: 'brouillon abandonné', j_review: 'liste lue', j_checks: 'tests lancés',
  aboveCeiling: 'Cette valeur dépasse la limite permise par le service.', previewTitle: 'Aperçu de ton brouillon', previewNote: 'Rien ici n’est réel : aucun message n’est gardé et rien n’est réservé.', startOver: 'Recommencer',
};

const DICT = { boite: { en: BOITE_EN, fr: BOITE_FR }, atelier: { en: ATELIER_EN, fr: ATELIER_FR } };

const LOGIN = (T) => `<div class="card" id="login" hidden><form id="lf" class="row"><input id="tok" type="password" autocomplete="off" placeholder="${esc(T.token)}" aria-label="${esc(T.token)}"><button class="primary" type="submit">${esc(T.open)}</button></form><p class="muted tight" id="lm"></p></div>`;

function shell({ fiche, nonce, which, body, js }) {
  const T = DICT[which][fiche.language] || DICT[which].en;
  return `<!doctype html><html lang="${fiche.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(fiche.name)} · ${esc(T.title)}</title><style nonce="${nonce}">${BASE_CSS}
:root{--brand:${fiche.brand.color}}
${CSS}</style></head><body>
${body(T)}
<script type="application/json" id="cfg">${safeJson({ t: T })}</script>
<script nonce="${nonce}">${KIT}
${js}</script></body></html>`;
}

export function boitePage({ fiche, nonce }) {
  return shell({
    fiche, nonce, which: 'boite', js: BOITE_JS,
    body: (T) => `${LOGIN(T)}
<div id="main" hidden>
<div class="top"><h1 id="shop"></h1><span id="state"></span><div class="meterbox"><div class="meter"><i id="mb"></i></div><span id="mt"></span></div>
<button type="button" id="refresh">${esc(T.refresh)}</button><button type="button" id="kill"></button></div>
<div class="bar" id="approvals" hidden></div>
<div class="cols"><div class="col" id="list" aria-label="${esc(T.tabChats)}"></div><div class="col mid" id="chat"></div><div class="col" id="side"></div></div></div>`,
  });
}

export function atelierPage({ fiche, nonce }) {
  return shell({
    fiche, nonce, which: 'atelier', js: ATELIER_JS,
    body: (T) => `${LOGIN(T)}
<div id="main" hidden>
<div class="top"><h1 id="shop"></h1><span id="state"></span><span class="push"></span><button type="button" id="discard">${esc(T.discard)}</button></div>
<div class="bar" id="flash" hidden role="status"></div>
<div class="atelier"><div class="left">
<div class="card"><h2>${esc(T.gateTitle)}</h2><div id="gate"></div></div>
<div class="card" id="fiche"></div><div class="guard" id="guard"></div><div class="card" id="sheet"></div><div class="card" id="changes"></div><div class="card" id="site"></div><div class="card" id="versions"></div>
</div><div class="right"><div class="row between"><h2 class="h0">${esc(T.previewTitle)}</h2><button type="button" id="prevReset">${esc(T.startOver)}</button></div><p class="note h0">${esc(T.previewNote)}</p>
<iframe id="preview" title="${esc(T.previewTitle)}"></iframe></div></div></div>`,
  });
}
