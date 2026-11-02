// What the bridge says to a person in a chat. English is the base (decision D1); French is used when the sender's Telegram
// `from.language_code` starts with « fr », English for anything else or when it is missing.
//
// Only what a person READS in the chat goes through here. The operator's console (daemon log lines, CLI usage and errors) is English
// only and is written directly where it is produced. The task handed to DSH is addressed to the model, not to the person: it stays
// English too (see buildTask in runner.mjs).
//
// `{name}` is a placeholder. A key with a `.one` twin is used when the variable `n` is 1, so a count is right for one.

const EN = {
  help: [
    'Available commands:',
    '/new — start over on a fresh DSH session',
    '/status — session, working folder, queue and last run',
    '/help — this message',
    '',
    'Any other message is sent to DeepSeek Harness; the answer comes back here.',
  ].join('\n'),
  denied: [
    '⛔ This chat is not allowed to drive this DeepSeek Harness.',
    'ID to allow: {id}',
    'On the machine: `telegram-daemon --allow {id}`',
  ].join('\n'),
  queueFull: '⏳ Queue full ({n} messages). Wait for the current turn to finish.',
  'queueFull.one': '⏳ Queue full (1 message). Wait for the current turn to finish.',
  queued: '⏳ Queued (position {n}).',
  newSession: '🆕 Fresh session: the next message starts a new DSH session.',
  working: '⏳ DeepSeek Harness is working…',
  tool: '🔧 {name}',
  toolUnknown: '🔧 tool',
  stepDone: 'step {n} done',
  emptyReply: '(empty reply)',
  emptyText: '(empty)',
  timedOut: 'timed out ({n} s)',
  exitCode: 'code {n}',
  turnFailed: '❌ Turn failed: {reason}',
  fileMissing: '⚠️ file not found: {file}',
  fileFailed: '⚠️ could not send the file: {reason}',
  'status.title': '📊 Bridge status',
  'status.channel': '• channel: {v}',
  'status.session': '• session: {v}',
  'status.sessionNew': '(fresh at the next message)',
  'status.folder': '• folder: {v}',
  'status.dsh': '• DSH: {v}',
  'status.message': '• message: {v}',
  'status.running': 'running',
  'status.idle': 'idle',
  'status.queue': ' · queue {n}',
  'status.lastTurn': '• last turn: {v}',
  'status.lastOk': 'ok in {s} s ({tokens} tokens)',
  'status.lastFail': 'failed in {s} s ({tokens} tokens)',
  'status.lastNone': 'none',
  'status.daemon': '• daemon: {n} min',
}

const FR = {
  help: [
    'Commandes disponibles :',
    '/new — repartir sur une session DSH vierge',
    '/status — session, dossier de travail, file et dernière exécution',
    '/help — ce message',
    '',
    'Tout autre message est envoyé à DeepSeek Harness ; la réponse arrive ici.',
  ].join('\n'),
  denied: [
    '⛔ Ce chat n’est pas autorisé à piloter ce DeepSeek Harness.',
    'Identifiant à autoriser : {id}',
    'Côté machine : `telegram-daemon --allow {id}`',
  ].join('\n'),
  queueFull: '⏳ File pleine ({n} messages). Attends la fin du tour en cours.',
  'queueFull.one': '⏳ File pleine (1 message). Attends la fin du tour en cours.',
  queued: '⏳ En file d’attente (position {n}).',
  newSession: '🆕 Session suivante neuve : le prochain message crée une nouvelle session DSH.',
  working: '⏳ DeepSeek Harness travaille…',
  tool: '🔧 {name}',
  toolUnknown: '🔧 outil',
  stepDone: 'étape {n} terminée',
  emptyReply: '(réponse vide)',
  emptyText: '(vide)',
  timedOut: 'délai dépassé ({n} s)',
  exitCode: 'code {n}',
  turnFailed: '❌ Échec du tour : {reason}',
  fileMissing: '⚠️ fichier introuvable : {file}',
  fileFailed: '⚠️ envoi du fichier impossible : {reason}',
  'status.title': '📊 État du pont',
  'status.channel': '• canal : {v}',
  'status.session': '• session : {v}',
  'status.sessionNew': '(neuve au prochain message)',
  'status.folder': '• dossier : {v}',
  'status.dsh': '• DSH : {v}',
  'status.message': '• message : {v}',
  'status.running': 'en cours',
  'status.idle': 'au repos',
  'status.queue': ' · file {n}',
  'status.lastTurn': '• dernier tour : {v}',
  'status.lastOk': 'ok en {s} s ({tokens} tokens)',
  'status.lastFail': 'échec en {s} s ({tokens} tokens)',
  'status.lastNone': 'aucun',
  'status.daemon': '• démon : {n} min',
}

/** 'fr' when a Telegram `language_code` is French (fr, fr-CA, fr_FR…), 'en' for anything else or nothing. */
export function pickLang(code) {
  return String(code ?? '').trim().toLowerCase().split(/[-_]/)[0] === 'fr' ? 'fr' : 'en';
}

/** The sentence `key` in `lang` (English when the language or the key is unknown), its `{placeholders}` filled from `vars`. */
export function t(lang, key, vars = {}) {
  const table = lang === 'fr' ? FR : EN;
  const k = vars.n === 1 && `${key}.one` in EN ? `${key}.one` : key;
  const text = table[k] ?? EN[k] ?? key;
  return text.replace(/\{(\w+)\}/g, (whole, name) => (vars[name] !== undefined ? String(vars[name]) : whole));
}

/** Every key of a table, for the test that checks both languages say the same things. */
export const keysOf = (lang) => Object.keys(lang === 'fr' ? FR : EN);
