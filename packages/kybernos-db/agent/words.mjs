// The words the person reads about a database, in English and French, and the one-line description of a field. Pure.
//
// The code and the agent's tools say « object »; the screen says what the template or the person chose. Until that setting exists the screen says « table ».

export const WORDS = { object: { en: 'table', fr: 'table' }, objects: { en: 'tables', fr: 'tables' }, db: { en: 'database', fr: 'base de données' } }

const TYPE = {
  text: { en: 'text', fr: 'texte' },
  longtext: { en: 'long text', fr: 'texte long' },
  number: { en: 'number', fr: 'nombre' },
  money: { en: 'amount', fr: 'montant' },
  date: { en: 'date', fr: 'date' },
  checkbox: { en: 'checkbox', fr: 'case à cocher' },
  choice: { en: 'choice', fr: 'choix' },
  multichoice: { en: 'multiple choice', fr: 'choix multiple' },
  person: { en: 'person', fr: 'personne' },
  url: { en: 'web address', fr: 'adresse web' },
  email: { en: 'email', fr: 'e-mail' },
  phone: { en: 'phone', fr: 'téléphone' },
  relation: { en: 'link', fr: 'lien' },
  attachment: { en: 'file', fr: 'fichier' },
}
const PROTECTION = { normal: { en: 'normal', fr: 'normal' }, personal: { en: 'personal', fr: 'personnel' }, sensitive: { en: 'sensitive', fr: 'sensible' }, secret: { en: 'secret', fr: 'secret' } }

/** The sentence pieces of the cards, as { en, fr } pairs. */
const SAY = {
  colon: { en: ':', fr: ' :' },
  to: { en: ' to ', fr: ' à ' },
  toThe: { en: ' to the ', fr: ' à la ' },
  ofThe: { en: ' of the ', fr: ' de la ' },
  closeOf: { en: ') of the ', fr: ') de la ' },
  addObject: { en: 'Add the ', fr: 'Ajouter la ' },
  titleMark: { en: ' — title', fr: ' — titre' },
  addField: { en: 'Add the field ', fr: 'Ajouter le champ ' },
  emptyRows: { en: '. Existing rows stay empty on this field.', fr: '. Les lignes existantes restent vides sur ce champ.' },
  link: { en: 'Link the ', fr: 'Relier la ' },
  newField: { en: 'new field ', fr: 'nouveau champ ' },
  severalOf: { en: 'each row can have several ', fr: 'chaque ligne peut avoir plusieurs ' },
  atMostOne: { en: 'each row has at most one ', fr: 'chaque ligne a au plus un(e) ' },
  shownAs: { en: 'seen from the other side as ', fr: 'vu de l’autre côté sous le nom ' },
  changeInverse: { en: 'name seen from the other side: ', fr: 'nom vu de l’autre côté : ' },
  changeName: { en: 'name: ', fr: 'nom : ' },
  changeProtection: { en: 'protection: ', fr: 'protection : ' },
  choicesAdded: { en: 'choices added: ', fr: 'choix ajoutés : ' },
  changeField: { en: 'Change the field ', fr: 'Modifier le champ ' },
  createDb: { en: 'Create the ', fr: 'Créer la ' },
  archive: { en: 'Archive the ', fr: 'Archiver la ' },
  keepNote: { en: '. Nothing is deleted: it leaves the lists and can be brought back.', fr: '. Rien n’est supprimé : elle quitte les listes et peut être restaurée.' },
  emptyFile: { en: ': an empty file on this computer.', fr: ' : un fichier vide sur cet ordinateur.' },
  askWrite: { en: 'The agent wants to write protected fields (', fr: 'L’agent veut écrire dans des champs protégés (' },
  askRead: { en: 'The agent wants to read protected fields (', fr: 'L’agent veut lire en clair des champs protégés (' },
  allowWrite: { en: '. Allow it?', fr: '. Autoriser ?' },
  allowRead: { en: ' in clear. Allow it?', fr: '. Autoriser ?' },
  required: { en: 'required', fr: 'obligatoire' },
  many: { en: ' (many)', fr: ' (plusieurs)' },
  shareFile: { en: 'The agent wants to write a page with a snapshot of ', fr: 'L’agent veut écrire une page avec un instantané ' },
  sharePublish: { en: 'The agent wants to publish a snapshot of ', fr: 'L’agent veut publier un instantané ' },
  shareUpdate: { en: 'The agent wants to update a link with a snapshot of ', fr: 'L’agent veut mettre à jour un lien avec un instantané ' },
  shareOfNamed: { en: 'the dashboard ', fr: 'du tableau de bord ' },
  shareOfThis: { en: 'this dashboard', fr: 'de ce tableau de bord' },
  shareNoRows: { en: ' (what its widgets show, never the rows)', fr: ' (ce que montrent ses widgets, jamais les lignes)' },
  shareToKeep: { en: ', to keep or send by hand', fr: ', à garder ou à envoyer à la main' },
  shareOnServer: { en: ' on the Kybernos server', fr: ' sur le serveur Kybernos' },
  shareSealed: { en: 'Protected by a password it cannot read: readers type it to open the page.', fr: 'Protégé par un mot de passe que le serveur ne peut pas lire : les lecteurs le saisissent pour ouvrir la page.' },
  sharePageOpen: { en: 'Not protected: anyone who gets the page can read it.', fr: 'Non protégé : quiconque reçoit la page peut la lire.' },
  shareLinkOpen: { en: 'Not protected: anyone who has the link can read it.', fr: 'Non protégé : quiconque a le lien peut le lire.' },
  sharePersonalOn: { en: 'It MAY PRINT PERSONAL FIELDS (names, e-mails…).', fr: 'Il PEUT AFFICHER DES CHAMPS PERSONNELS (noms, e-mails…).' },
  sharePersonalOff: { en: 'Personal fields are left out.', fr: 'Les champs personnels sont laissés de côté.' },
}
/** A piece of a card in a language. */
export const say = (key, lang) => SAY[key][lang]

export const typeWord = (type, lang) => (TYPE[type] || { en: String(type), fr: String(type) })[lang]
export const protectionWord = (level, lang) => (PROTECTION[level] || { en: String(level), fr: String(level) })[lang]

/** « Status (choice: To do, Doing), personal »: what a field is, for a card or a list. */
export function fieldLine (field, lang) {
  const parts = [typeWord(field.type, lang)]
  if (field.options) parts[0] += ': ' + field.options.map((o) => o.label).join(', ')
  if (field.type === 'relation') parts[0] += ' → ' + field.to + (field.many ? say('many', lang) : '')
  if (field.type === 'money') parts[0] += ' ' + field.currency
  if (field.required) parts.push(say('required', lang))
  if (field.protection !== 'normal') parts.push(protectionWord(field.protection, lang))
  return field.label + ' (' + parts.join(', ') + ')'
}

export const short = (s, n) => (typeof s === 'string' && s.length > n ? s.slice(0, n - 1) + '…' : String(s === undefined || s === null ? '' : s))
