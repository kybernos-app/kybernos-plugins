// What a visitor can read from the service itself (refusals, consent wording). English is the source; French lives in its own
// dictionary so the language gate (scripts/test-no-french-literals.mjs) sees it as translation data, not code.

const EN = {
  'busy': 'The assistant is busy right now. Please try again in a moment.',
  'closed': 'The assistant is not available right now. You can leave a message for the shop another way.',
  'limit.day': 'The assistant has reached its limit for today. Please come back tomorrow, or contact the shop directly.',
  'limit.visitor': 'You have reached the limit of this assistant for today. Please come back tomorrow.',
  'limit.rate': 'Too many messages in a short time. Please wait a minute.',
  'too_long': 'That message is too long. Please shorten it.',
  'empty': 'Please write a message.',
  'error': 'Something went wrong on our side. Please try again, or leave a message for the shop.',
  'consent.ask': 'May I remember {what} so the shop can help you faster next time? You can ask me to forget it at any time.',
  'field.first_name': 'your first name',
  'field.email': 'your email address',
  'field.preference': 'one preference',
  'consent.yes': 'Yes, remember',
  'consent.no': 'No thanks',
  'consent.saved': 'Done. You can see and erase what is remembered in "My data".',
  'consent.declined': 'No problem, nothing is kept.',
  'forgotten': 'Done. What was remembered about you has been erased.',
  'approval.wait': 'I have passed your request to the shop. They will confirm it.',
  'level.needed': 'I cannot do this on this channel. The shop will help you directly.',
  'unknown.action': 'I cannot do that. The shop will help you directly.',
};

const FR = {
  'busy': 'L’assistant est occupé en ce moment. Réessaie dans un instant.',
  'closed': 'L’assistant n’est pas disponible pour le moment. Tu peux laisser un message à la boutique autrement.',
  'limit.day': 'L’assistant a atteint sa limite pour aujourd’hui. Reviens demain, ou contacte directement la boutique.',
  'limit.visitor': 'Tu as atteint la limite de cet assistant pour aujourd’hui. Reviens demain.',
  'limit.rate': 'Trop de messages en peu de temps. Patiente une minute.',
  'too_long': 'Ce message est trop long. Raccourcis-le, s’il te plaît.',
  'empty': 'Écris un message.',
  'error': 'Un problème est survenu de notre côté. Réessaie, ou laisse un message à la boutique.',
  'consent.ask': 'Puis-je retenir {what} pour que la boutique t’aide plus vite la prochaine fois ? Tu peux me demander de l’oublier à tout moment.',
  'field.first_name': 'ton prénom',
  'field.email': 'ton adresse e-mail',
  'field.preference': 'une préférence',
  'consent.yes': 'Oui, retenir',
  'consent.no': 'Non merci',
  'consent.saved': 'C’est fait. Tu peux voir et effacer ce qui est retenu dans « Mes données ».',
  'consent.declined': 'Pas de souci, rien n’est gardé.',
  'forgotten': 'C’est fait. Ce qui était retenu sur toi a été effacé.',
  'approval.wait': 'J’ai transmis ta demande à la boutique. Elle la confirmera.',
  'level.needed': 'Je ne peux pas faire cela sur ce canal. La boutique t’aidera directement.',
  'unknown.action': 'Je ne peux pas faire cela. La boutique t’aidera directement.',
};

const DICT = { en: EN, fr: FR };

/** The text for `key` in `lang` (falls back to English), with `{name}` placeholders filled from `vars`. */
export function t(lang, key, vars = {}) {
  const raw = (DICT[lang] && DICT[lang][key]) || EN[key] || key;
  return raw.replace(/\{(\w+)\}/g, (_, name) => (vars[name] === undefined ? '' : String(vars[name])));
}

export const LANGS = Object.keys(DICT);
