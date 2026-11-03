// In-page maquette editor of @local/kybernos-maquettes. One script tag added to the served copy of the maquette; everything it draws
// lives in a shadow root, so the maquette's own CSS cannot touch it and it cannot touch the maquette's.
// Nothing here writes to the file by itself: changes are staged in the page, then sent in one go by the Save button.
// The page runs in a sandbox (no origin, no cookie): every call to the host goes through the DSH page around it (see `bridge`).
// The words are French in the source and the English ones live in EN (see `t` and `i18n`).
(() => {
  if (window.__kyEdit) return; window.__kyEdit = true;
  const SCRIPT = document.currentScript;
  const FILE = (SCRIPT && SCRIPT.dataset.file) || 'index.html';
  const LANG = SCRIPT && SCRIPT.dataset.lang === 'fr' ? 'fr' : 'en';
  const F = LANG === 'fr', LQ = F ? '« ' : '“', RQ = F ? ' »' : '”', COL = F ? ' : ' : ': ';
  if (window.parent === window) return;   // opened on its own, outside the Maquettes page: no bridge, so no editor

  let palette = [];   // the blocks offered under « Insérer »: the server owns the list (/api/blocks), so it exists in one place
  const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const fill = (html, { src = '', alt = '' }) => html.replace(/\{\{src\}\}/g, attr(src)).replace(/\{\{alt\}\}/g, attr(alt));
  const IMG_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  const isImg = (f) => IMG_TYPES.includes(f.type);
  // ---- words: French is the source, English is looked up here (`tx` for a string, `i18n` for what is drawn); a missing entry shows the French ----
  const EN = {
    'Glisser pour déplacer ce bloc': 'Drag to move this block',
    'Choisir le bloc qui contient celui-ci': 'Choose the block that contains this one',
    'Taille, graisse et alignement du texte': 'Size, weight and alignment of the text',
    'Couleur du texte': 'Text colour',
    'Couleur de fond': 'Background colour',
    'Réglages : texte, couleurs, police, bordure, marges, taille…': 'Settings: text, colours, font, border, margins, size…',
    'Réglages': 'Settings',
    'Dupliquer (Cmd/Ctrl + D)': 'Duplicate (Cmd/Ctrl + D)',
    'Supprimer, après confirmation (Suppr)': 'Delete, after confirmation (Del)',
    'Ajouter un bloc ou une image': 'Add a block or a picture',
    'Ajouter': 'Add',
    'Aucun changement': 'No change',
    'Voir la liste des changements en attente': 'See the list of waiting changes',
    'Abandonner tous les changements en attente (le fichier n\'est pas touché)': 'Give up all waiting changes (the file is not touched)',
    'Annuler tout': 'Cancel all',
    'Écrire les changements dans le fichier (une copie de sécurité est gardée)': 'Write the changes into the file (a safety copy is kept)',
    'Enregistrer': 'Save',
    'Quitter le mode modification (les changements en attente sont gardés)': 'Leave edit mode (waiting changes are kept)',
    'Quitter': 'Leave',
    'Modifier cette page': 'Edit this page',
    'Modifier': 'Edit',
    'Annuler tous les changements ?': 'Cancel all changes?',
    'Tout annuler': 'Cancel all',
    'Ne rien faire (Échap)': 'Do nothing (Esc)',
    'Annuler': 'Cancel',
    'Supprimer cet élément ?': 'Delete this element?',
    'Supprimer': 'Delete',
    'Taille': 'Size',
    'Taille du texte, en pixels': 'Text size, in pixels',
    'Plus petit': 'Smaller',
    'Plus grand': 'Larger',
    'Graisse': 'Weight',
    'Épaisseur des traits du texte': 'Thickness of the letter strokes',
    'Épaisseur normale': 'Normal weight',
    'Texte en gras': 'Bold text',
    'Gras': 'Bold',
    'Alignement': 'Alignment',
    'Alignement du texte dans son bloc': 'Alignment of the text in its block',
    'À gauche': 'Left',
    'Centré': 'Centred',
    'À droite': 'Right',
    'À insérer par rapport à': 'Insert relative to',
    'À insérer': 'Insert',
    'à la fin de la page': 'at the end of the page',
    'la fin de la page': 'the end of the page',
    'la page': 'the page',
    'Rien ne permet d\'insérer ici.': 'Nothing can be inserted here.',
    'Après': 'After',
    'Avant': 'Before',
    'Dedans': 'Inside',
    'Placer le bloc après celui qui est choisi': 'Put the block after the chosen one',
    'Placer le bloc avant celui qui est choisi': 'Put the block before the chosen one',
    'Placer le bloc à l\'intérieur de celui qui est choisi': 'Put the block inside the chosen one',
    'ou l\'adresse d\'une image : https://…': 'or the address of a picture: https://…',
    'Cliquez sur un bloc, ou glissez-le sur la page. Une image déposée ou collée devient aussi un bloc.': 'Click a block, or drag it onto the page. A picture dropped or pasted also becomes a block.',
    'Collez une adresse d\'image qui commence par https://': 'Paste a picture address that starts with https://',
    'Rien ne permet d\'insérer ici : choisissez un bloc de la page.': 'Nothing can be inserted here: choose a block of the page.',
    'Seules les images PNG, JPEG, GIF et WebP sont acceptées.': 'Only PNG, JPEG, GIF and WebP pictures are accepted.',
    'Seules les images PNG, JPEG, GIF et WebP peuvent être déposées.': 'Only PNG, JPEG, GIF and WebP pictures can be dropped.',
    'Cette image dépasse 8 Mo.': 'This picture is larger than 8 MB.',
    'Image refusée : ': 'Picture refused: ',
    'Image remplacée': 'Picture replaced',
    'Rien en attente.': 'Nothing waiting.',
    'Retirer ce changement de la liste': 'Remove this change from the list',
    'Remet le fichier tel qu\'il était avant votre dernier enregistrement': 'Puts the file back as it was before your last save',
    'Revenir avant le dernier enregistrement': 'Go back to before the last save',
    'Remet la page comme elle était avant le premier enregistrement de l\'éditeur': 'Puts the page back as it was before the editor\'s first save',
    'Remettre la page d\'origine': 'Put the original page back',
    'Revenir avant le dernier enregistrement ?': 'Go back to before the last save?',
    'Le fichier reprend son contenu d\'avant. Les changements en attente sont abandonnés.': 'The file gets its previous content back. Waiting changes are given up.',
    'Revenir en arrière': 'Go back',
    'Remettre la page d\'origine ?': 'Put the original page back?',
    'La page reprend son contenu d\'avant le premier enregistrement de l\'éditeur : tous ses enregistrements sont perdus.': 'The page gets its content from before the editor\'s first save back: all its saves are lost.',
    'Page d\'origine remise': 'Original page put back',
    'Rien n\'a été enregistré par l\'éditeur : rien à remettre': 'The editor has saved nothing: nothing to put back',
    'Impossible de remettre l\'original : ': 'Could not put the original back: ',
    'Impossible de revenir en arrière : ': 'Could not go back: ',
    'Rien à annuler': 'Nothing to undo',
    'Fichier remis comme avant le dernier enregistrement': 'File put back as it was before the last save',
    'Rien à enregistrer': 'Nothing to save',
    'La page a changé depuis son ouverture (Kaby ou vous). Rien n\'a été écrit : rechargez la maquette.': 'The page changed since it was opened (Kaby or you). Nothing was written: reload the maquette.',
    'Refusé : ': 'Refused: ',
    ' Rien n\'a été écrit.': ' Nothing was written.',
    ' · identifiant(s) renommé(s) dans la copie (elle n\'est pas reliée au script de la page)': ' · id(s) renamed in the copy (it is not wired to the page script)',
    'Demande envoyée à Kaby : relisez-la dans la conversation': 'Request sent to Kaby: read it in the chat',
    'Le fichier a changé depuis : vos changements en attente ont été abandonnés.': 'The file changed since: your waiting changes were given up.',
    'le serveur ne répond pas': 'the server does not answer',
    'Supprimé. Ce changement est dans la liste : vous pouvez le retirer avant d\'enregistrer.': 'Deleted. This change is in the list: you can remove it before saving.',
    'Enregistrez d\'abord cette copie pour pouvoir changer son style.': 'Save this copy first to be able to change its style.',
    'Aucune règle partagée pour ça : choisissez « Cet élément » dans Réglages.': 'No shared rule for that: choose “This element” in Settings.',
    'Cet élément est généré par la page et n\'a pas de règle partagée : décrivez le changement à Kaby (Réglages).': 'This element is generated by the page and has no shared rule: describe the change to Kaby (Settings).',
    'Ce texte est composé par la page : ici, on change ses couleurs et sa taille. Pour le texte, décrivez le changement à Kaby (Réglages).': 'This text is composed by the page: here you change its colours and size. For the text itself, describe the change to Kaby (Settings).',
    'Ce texte est composé par la page : il ne se change pas ici. Les couleurs, la taille et la mise en page, oui ; pour le texte, décrivez le changement à Kaby ci-dessus.': 'This text is composed by the page: it cannot be changed here. Colours, size and layout can; for the text, describe the change to Kaby above.',
    'Ajoutée à la liste. Elle part vers Kaby avec « Enregistrer ».': 'Added to the list. It goes to Kaby with “Save”.',
    'Dites en une phrase ce que vous voulez changer, puis Entrée : la demande va dans la liste et part vers Kaby avec « Enregistrer ».': 'Say in one sentence what you want to change, then Enter: the request goes into the list and is sent to Kaby with “Save”.',
    'Je cherche d\'où vient ce texte…': 'Looking for where this text comes from…',
    'Ajouté pendant cette session : tout se modifie.': 'Added in this session: everything can be changed.',
    'Cet élément est fabriqué par la page : un changement de style vaut pour les': 'This element is built by the page: a style change applies to the',
    'éléments du même type.': 'elements of the same type.',
    'Élément fabriqué par la page : un changement de style vaut pour tous les éléments pareils.': 'Element built by the page: a style change applies to all similar elements.',
    'Ce bloc contient plusieurs textes : cliquez dans le texte, sur la page, pour les changer.': 'This block holds several texts: click in the text, on the page, to change them.',
    'Cet élément seulement, ou tous ceux qui partagent le même style dans le fichier': 'This element only, or all those sharing the same style in the file',
    'Seul cet élément change (le style est écrit sur lui)': 'Only this element changes (the style is written on it)',
    'Tous les éléments qui ont le même style changent (la règle partagée est modifiée)': 'All elements with the same style change (the shared rule is edited)',
    'Cet élément': 'This element',
    'Tous': 'All',
    'Appliquer les changements à': 'Apply changes to',
    'Contenu du texte': 'Text content',
    'Les mots de cet élément. Ce que vous écrivez ici apparaît aussitôt sur la page.': 'The words of this element. What you write here shows on the page at once.',
    'Remplacer…': 'Replace…',
    'Choisir une autre image dans vos fichiers': 'Choose another picture from your files',
    'Largeur': 'Width',
    'Largeur de l\'image : automatique ou une part de la largeur du bloc': 'Picture width: automatic or a share of the block width',
    'Description (pour qui ne voit pas l\'image)': 'Description (for who cannot see the picture)',
    'Lue par les lecteurs d\'écran, affichée si l\'image ne charge pas': 'Read by screen readers, shown if the picture does not load',
    'Adresse du lien': 'Link address',
    'Où mène le lien : https://…, mailto:… ou #ancre': 'Where the link goes: https://…, mailto:… or #anchor',
    'Décrire un changement (pour Kaby)': 'Describe a change (for Kaby)',
    'Fermer les réglages': 'Close settings',
    'Mise en page': 'Layout',
    'Mise en forme': 'Formatting',
    'Couleurs': 'Colours',
    'Couleur': 'Colour',
    'Typographie': 'Typography',
    'Bordure': 'Border',
    'Affichage': 'Display',
    'Marge intérieure': 'Padding',
    'Marge extérieure': 'Margin',
    'Disposition': 'Arrangement',
    'Couleurs, texte, bordure, affichage': 'Colours, text, border, display',
    'Couleur du texte et du fond': 'Colour of the text and the background',
    'Texte': 'Text',
    'Fond': 'Background',
    'Sans couleur de fond': 'No background colour',
    'Retire la couleur de fond : on voit ce qu\'il y a derrière': 'Removes the background colour: what is behind shows',
    'Police': 'Font',
    'Police de caractères : celle de la page, sans empattement, avec empattement ou à chasse fixe': 'Typeface: the page\'s own, sans serif, serif or monospace',
    'Actuelle': 'Current',
    'Sans empattement': 'Sans serif',
    'Avec empattement': 'Serif',
    'Chasse fixe': 'Monospace',
    'Interligne': 'Line height',
    'Interligne, en multiple de la taille du texte : 1,5 = une fois et demie': 'Line height, as a multiple of the text size: 1.5 = one and a half times',
    'Espace entre les lettres': 'Letter spacing',
    'Espace entre les lettres, en pixels (0 = normal)': 'Space between letters, in pixels (0 = normal)',
    'Justifié': 'Justified',
    'Italique': 'Italic',
    'Souligné': 'Underline',
    'Tout en majuscules': 'All capitals',
    'Épaisseur des traits : Normal = 400, Gras = 700': 'Stroke thickness: Normal = 400, Bold = 700',
    'Mince': 'Thin',
    'Moyen': 'Medium',
    'Demi-gras': 'Semi-bold',
    'Très gras': 'Extra bold',
    'Trait': 'Line',
    'Trait autour du bloc et coins arrondis': 'Line around the block and rounded corners',
    'Épaisseur du trait autour du bloc, en pixels (0 = pas de trait)': 'Thickness of the line around the block, in pixels (0 = no line)',
    'Style du trait : plein, tirets ou points': 'Line style: solid, dashed or dotted',
    'Couleur du trait autour du bloc': 'Colour of the line around the block',
    'Coins': 'Corners',
    'Arrondi des coins, en pixels (50% = rond)': 'Corner rounding, in pixels (50% = round)',
    'Plein': 'Solid',
    'Tirets': 'Dashed',
    'Points': 'Dotted',
    'Aucun': 'None',
    'Aucune': 'None',
    'Façon de ranger le bloc, transparence, ombre': 'How the block is laid out, opacity, shadow',
    'Façon dont le bloc se range : bloc, ligne, flex (souple) ou grille': 'How the block is laid out: block, inline, flex or grid',
    'Opacité': 'Opacity',
    'Opacité : 100 % = plein, 0 % = invisible': 'Opacity: 100 % = solid, 0 % = invisible',
    'Ombre': 'Shadow',
    'Ombre portée du bloc': 'The block\'s drop shadow',
    'Légère': 'Light',
    'Moyenne': 'Medium',
    'Forte': 'Strong',
    'Grille': 'Grid',
    'Bloc en ligne': 'Inline block',
    'En ligne': 'Inline',
    'Largeur et hauteur du bloc': 'Width and height of the block',
    'Hauteur': 'Height',
    'Largeur, en pixels ou avec une unité (%, rem…). « auto » = automatique': 'Width, in pixels or with a unit (%, rem…). “auto” = automatic',
    'Hauteur, en pixels ou avec une unité. « auto » = selon le contenu': 'Height, in pixels or with a unit. “auto” = from the content',
    'Largeur maximale, en pixels ou avec une unité. « none » = sans limite': 'Maximum width, in pixels or with a unit. “none” = no limit',
    'Monter ou descendre le bloc parmi ses voisins': 'Move the block up or down among its neighbours',
    'Monter': 'Move up',
    'Descendre': 'Move down',
    'Passer avant le bloc précédent': 'Go before the previous block',
    'Passer après le bloc suivant': 'Go after the next block',
    'Marge intérieure : l\'espace entre le bord du bloc et son contenu, en pixels': 'Padding: the space between the edge of the block and its content, in pixels',
    'Marge extérieure : l\'espace autour du bloc, en pixels': 'Margin: the space around the block, in pixels',
    'Les quatre côtés ensemble': 'All four sides together',
    'Chaque côté séparément': 'Each side separately',
    'Séparer : un réglage par côté': 'Separate: one setting per side',
    'Lier : un seul réglage pour les quatre côtés': 'Link: one setting for all four sides',
    'Haut': 'Top',
    'Droite': 'Right',
    'Bas': 'Bottom',
    'Gauche': 'Left',
    'Sens': 'Direction',
    'Sens de rangement : côte à côte (ligne) ou l\'un sous l\'autre (colonne)': 'Direction: side by side (row) or one under the other (column)',
    'Ligne': 'Row',
    'Colonne': 'Column',
    'Côte à côte': 'Side by side',
    'L\'un sous l\'autre': 'One under the other',
    'Alignement des éléments sur l\'autre axe': 'Alignment of the items on the other axis',
    'Répartition': 'Distribution',
    'Répartition des éléments le long du sens de rangement': 'Distribution of the items along the direction',
    'Comment les éléments contenus se rangent': 'How the contained items are arranged',
    'Espace entre les éléments rangés, en pixels': 'Space between the arranged items, in pixels',
    'Espace': 'Gap',
    'Étirer': 'Stretch',
    'Début': 'Start',
    'Fin': 'End',
    'Ligne de base': 'Baseline',
    'Espacé': 'Space between',
    'Réparti': 'Space around',
    'Égal': 'Space evenly',
    'nouveau': 'new',
    'données': 'data',
    'composé': 'composed',
    'généré': 'generated',
    'pour Kaby': 'for Kaby',
    '(élément généré)': '(generated element)',
    '(hérité)': '(inherited)',
    'texte modifié': 'text changed',
    'déplacé': 'moved',
    'dupliqué': 'duplicated',
    'supprimé': 'deleted',
    'avant': 'before',
    'après': 'after',
    'dans': 'in',
    'copie': 'copy',
    'Titre': 'Title',
    'Citation': 'Quote',
    'Légende': 'Caption',
    'Séparateur': 'Divider',
    'Bouton': 'Button',
    'Sélectionnez un seul morceau de texte à la fois (pas les icônes ni les liens)': 'Select one piece of text at a time (not the icons or links)',
    'Image': 'Picture',
    'Icône': 'Icon',
    'Liste': 'List',
    'Élément de liste': 'List item',
    'Champ': 'Field',
    'Étiquette': 'Label',
    'Tableau': 'Table',
    'Formulaire': 'Form',
    'En-tête': 'Header',
    'Pied de page': 'Footer',
    'Panneau': 'Panel',
    'Contenu': 'Content',
    'Bloc': 'Block',
    'Lien': 'Link',
    'image': 'picture',
    'adresse du lien': 'link address',
    'couleur du texte': 'text colour',
    'fond': 'background',
    'police': 'font',
    'taille': 'size',
    'interligne': 'line height',
    'espacement des lettres': 'letter spacing',
    'graisse': 'weight',
    'italique': 'italic',
    'souligné': 'underline',
    'majuscules': 'capitals',
    'alignement': 'alignment',
    'épaisseur du trait': 'line thickness',
    'style du trait': 'line style',
    'couleur du trait': 'line colour',
    'arrondi': 'rounding',
    'opacité': 'opacity',
    'ombre': 'shadow',
    'affichage': 'display',
    'marge intérieure': 'padding',
    'marge extérieure': 'margin',
    'largeur': 'width',
    'hauteur': 'height',
    'largeur max': 'max width',
    'hauteur min': 'min height',
    'sens de rangement': 'direction',
    'espace entre éléments': 'gap',
    'répartition': 'distribution',
    'haut': 'top',
    'droite': 'right',
    'bas': 'bottom',
    'gauche': 'left',
  };
  const tx = (fr) => (LANG === 'fr' || EN[fr] === undefined ? fr : EN[fr]);
  // Translates the text nodes and the title / placeholder / aria-label of `node` (the UI is built from French strings, so this is the one place that
  // knows English). A value with no entry is left alone, which also ends the loop of the observer below.
  function i18n(node) {
    if (LANG === 'fr') return;
    const one = (n) => {
      if (n.nodeType === 3) { const v = n.nodeValue, k = v.trim(); if (k && EN[k] !== undefined && EN[k] !== k) n.nodeValue = v.replace(k, EN[k]); return; }
      if (n.nodeType !== 1) return;
      for (const a of ['title', 'placeholder', 'aria-label']) { const v = n.getAttribute(a); if (v && EN[v] !== undefined && EN[v] !== v) n.setAttribute(a, EN[v]); }
    };
    const walk = (n) => { one(n); for (const c of n.childNodes) walk(c); };
    walk(node);
  }
  function startI18n() {
    if (LANG === 'fr') return;
    i18n(root);
    new MutationObserver((ms) => { for (const m of ms) { if (m.type === 'childList') m.addedNodes.forEach(i18n); else if (m.type === 'characterData') i18n(m.target); else i18n(m.target); } })
      .observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['title', 'placeholder', 'aria-label'] });
  }
  const ATTR_LABEL = { src: 'image', alt: 'description', href: 'adresse du lien' };
  const svg = (d) => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const TILE = {
    title: svg('<path d="M6 7V5h12v2M12 5v14M9 19h6"/>'), subtitle: svg('<path d="M7 8V6h10v2M12 6v12M9.5 18h5"/>'), text: svg('<path d="M4 7h16M4 12h16M4 17h10"/>'),
    list: svg('<path d="M9 7h11M9 12h11M9 17h11"/><circle cx="4.5" cy="7" r=".6"/><circle cx="4.5" cy="12" r=".6"/><circle cx="4.5" cy="17" r=".6"/>'),
    quote: svg('<path d="M10 8c-3 .5-5 2.5-5 6v3h5v-5H7.5M19 8c-3 .5-5 2.5-5 6v3h5v-5h-2.5"/>'),
    image: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-9 8"/>'),
    figure: svg('<rect x="3" y="4" width="18" height="11" rx="2"/><circle cx="8.5" cy="8.5" r="1.4"/><path d="M21 12l-4-4-6 7M6 19h12"/>'),
    imgtext: svg('<rect x="3" y="6" width="8" height="12" rx="1.5"/><path d="M14 8h7M14 12h7M14 16h5"/>'),
    cols2: svg('<rect x="3" y="5" width="8" height="14" rx="1.5"/><rect x="13" y="5" width="8" height="14" rx="1.5"/>'),
    cols3: svg('<rect x="3" y="5" width="5" height="14" rx="1.2"/><rect x="9.5" y="5" width="5" height="14" rx="1.2"/><rect x="16" y="5" width="5" height="14" rx="1.2"/>'),
    card: svg('<rect x="4" y="5" width="16" height="14" rx="3"/><path d="M8 10h8M8 14h5"/>'),
    section: svg('<rect x="3" y="4" width="18" height="16" rx="1.5" stroke-dasharray="3 2.5"/><path d="M7 9h10M7 13h6"/>'),
    divider: svg('<path d="M3 12h18"/><path d="M8 7l4-3 4 3M8 17l4 3 4-3"/>'),
    button: svg('<rect x="3" y="8" width="18" height="8" rx="4"/><path d="M9 12h6"/>'),
    link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  };
  for (const k of Object.keys(ATTR_LABEL)) ATTR_LABEL[k] = tx(ATTR_LABEL[k]);
  const NOSTRUCT = new Set(['html', 'head', 'body', 'script', 'style', 'link', 'meta', 'title', 'base']);
  const SKIP = new Set(['script', 'style', 'link', 'meta', 'template']);
  const VOIDS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
  const NOEDIT = new Set(['script', 'style', 'textarea', 'template', 'button', 'input', 'select', 'option', 'svg', 'img']);
  const NAMES = { h1: 'Titre', h2: 'Titre', h3: 'Titre', h4: 'Titre', h5: 'Titre', h6: 'Titre', p: 'Texte', span: 'Texte', small: 'Texte', strong: 'Texte', b: 'Texte', em: 'Texte', i: 'Texte', u: 'Texte', code: 'Code', blockquote: 'Citation', figcaption: 'Légende', figure: 'Figure', hr: 'Séparateur', a: 'Lien', button: 'Bouton', img: 'Image', svg: 'Icône', ul: 'Liste', ol: 'Liste', li: 'Élément de liste', input: 'Champ', textarea: 'Champ', select: 'Menu', label: 'Étiquette', table: 'Tableau', form: 'Formulaire', section: 'Section', header: 'En-tête', footer: 'Pied de page', nav: 'Navigation', main: 'Contenu', aside: 'Panneau', article: 'Article', body: 'Page', div: 'Bloc' };
  for (const k of Object.keys(NAMES)) NAMES[k] = tx(NAMES[k]);

  // ---- the bridge: every call to the host goes through the DSH page around this sandboxed one ----
  const calls = new Map(); let callSeq = 0;
  addEventListener('message', (e) => { const m = e.data; if (e.source !== parent || !m || m.kyEdit !== 1 || !calls.has(m.id)) return; const f = calls.get(m.id); calls.delete(m.id); f(m.reply); });
  const bridge = (type, payload = {}, transfer = []) => new Promise((resolve) => {
    const id = ++callSeq, timer = setTimeout(() => { calls.delete(id); resolve({ ok: false, error: 'timeout', why: tx('le serveur ne répond pas') }); }, 30000);
    calls.set(id, (reply) => { clearTimeout(timer); resolve(reply || { ok: false, why: '' }); });
    parent.postMessage({ kyEdit: 1, id, type, file: FILE, ...payload }, '*', transfer);
  });
  const api = (op, payload) => bridge('api', { op, ...payload });
  // pending changes and the message to show after a reload live in the DSH page (keyed by maquette and page), not here
  const kv = {
    cache: {},
    async load() { const r = await bridge('kv-get'); this.cache = (r && r.value) || {}; },
    get(k) { return this.cache[k]; },
    set(k, v) { if (v === null) delete this.cache[k]; else this.cache[k] = v; return bridge('kv-set', { key: k, value: v }); },
  };

  let on = false, pending = [], sel = null, baseHash = '', baseFiles = {}, seq = 0, scope = 'element', addWhere = 'after', dr = null, swallow = false;
  const store = { get() { return kv.get('state') || null; }, set(v) { return kv.set('state', v); } };
  const persist = () => store.set({ on, pending, hash: baseHash });   // awaited before a reload, so the DSH page has it when the page comes back
  const newId = () => 'n' + Date.now().toString(36) + (++seq);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const own = (el) => el.hasAttribute('data-ky-i');
  const idOf = (el) => { const v = el.getAttribute('data-ky-i'); return /^\d+$/.test(v) ? +v : v; };   // numbers = in the file, n… = added here
  const nearest = (el) => { let n = el; while (n && n.nodeType === 1 && !own(n)) n = n.parentElement; return n; };
  const hex2 = (n) => n.toString(16).padStart(2, '0');
  function parseColor(s) {
    const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return { hex: '#000000', a: 0 };
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { hex: '#' + hex2(p[0]) + hex2(p[1]) + hex2(p[2]), a: p.length > 3 ? p[3] : 1 };
  }
  const nice = (el) => { const t = el.tagName.toLowerCase(); return t === 'div' && !el.children.length && el.textContent.trim() ? tx('Texte') : NAMES[t] || t; };
  function desc(el) {
    const own1 = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join(' ').trim() || el.textContent.trim();
    return nice(el) + (own1 ? ` ${LQ}${own1.length > 26 ? own1.slice(0, 26) + '…' : own1}${RQ}` : '');
  }

  // ---- the page's own look must not leak in: everything below is drawn inside a shadow root ----
  let host, root, $, hov, hovTag, selb, chip, dropBox, tb, txtpop, pop, insm, list, bar, pill, toastEl, cfm;
  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font: 400 13px/1.4 -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif; letter-spacing: 0; text-transform: none; scrollbar-width: none; }
    *::-webkit-scrollbar { display: none; }
    b { font-weight: 500; }
    [hidden] { display: none !important; }
    .root { color-scheme: light; --acc:#2563eb; --on-acc:#fff; --warn:#b45309; --danger:#d92d20; --on-danger:#fff; --card:#fff; --ink:#1d2125; --line:rgba(21,24,27,.10); --mute:#7b818b; --bg:#f2f3f5; --hover:rgba(21,24,27,.06); --shadow:0 6px 20px rgba(15,20,28,.12), 0 1px 3px rgba(15,20,28,.08); color: var(--ink); }
    .root[data-theme=dark] { color-scheme: dark; --acc:#7aa7ff; --on-acc:#0b1220; --warn:#e8a959; --danger:#f26d63; --on-danger:#2a0d0b; --card:#212428; --ink:#eceef1; --line:rgba(255,255,255,.10); --mute:#939aa4; --bg:#2b2e33; --hover:rgba(255,255,255,.07); --shadow:0 6px 20px rgba(0,0,0,.4), 0 1px 3px rgba(0,0,0,.3); }
    .box { position: fixed; pointer-events: none; display: none; border-radius: 4px; }
    #hov { box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--acc) 55%, transparent); }
    #hov span { position: absolute; left: 0; top: -20px; background: var(--acc); color: var(--on-acc); font-size: 11px; font-weight: 500; padding: 0 7px; border-radius: 5px; white-space: nowrap; line-height: 18px; }
    #selb { box-shadow: 0 0 0 2px var(--acc); }
    #selb.locked { box-shadow: 0 0 0 2px var(--warn); }
    #selb .chip { position: absolute; left: 0; top: -22px; display: flex; gap: 6px; align-items: center; height: 20px; padding: 0 8px; border-radius: 6px; background: var(--acc); color: var(--on-acc); font-size: 11px; white-space: nowrap; }
    #selb .chip * { font-size: 11px; line-height: 20px; } #selb .chip b { font-weight: 500; } #selb .chip i { font-style: normal; font-weight: 400; opacity: .85; }
    #selb.locked .chip { background: var(--warn); color: var(--on-acc); }
    #selb.in .chip { top: 0; border-radius: 0 0 6px 0; }   /* no room above the element: the tag sits inside its frame */
    #drop { box-shadow: 0 0 0 2px var(--acc); background: color-mix(in srgb, var(--acc) 16%, transparent); }
    #drop.line { box-shadow: none; background: var(--acc); border-radius: 2px; }
    .panel { position: fixed; pointer-events: auto; background: var(--card); color: var(--ink); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow); }
    .dragging .panel { pointer-events: none; }
    #pop, #txtpop, #insm, #list, #cfm { max-width: calc(100vw - 16px); }
    @media (max-width: 520px) { #insm .tiles { grid-template-columns: repeat(3, 1fr); } }
    button { border: 0; background: transparent; color: inherit; border-radius: 8px; padding: 0 10px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-width: 32px; height: 32px; transition: background .12s; }
    button:hover:not(:disabled) { background: var(--hover); }
    button:focus-visible { outline: 2px solid var(--acc); outline-offset: -2px; }
    button:disabled { opacity: .3; cursor: default; }
    button svg { flex: none; }
    button.primary { background: var(--acc); color: var(--on-acc); font-weight: 500; padding: 0 14px; }
    button.primary:hover:not(:disabled) { background: var(--acc); filter: brightness(1.08); }
    button.line { border: 1px solid var(--line); }
    button.danger { background: var(--danger); color: var(--on-danger); font-weight: 500; padding: 0 14px; }
    button.danger:hover:not(:disabled) { background: var(--danger); filter: brightness(1.08); }
    button.sm { height: 28px; min-width: 28px; padding: 0 6px; }
    button.on { background: color-mix(in srgb, var(--acc) 16%, transparent); color: var(--acc); }
    .aa { font-size: 14px; font-weight: 500; }
    .sep { width: 1px; height: 18px; background: var(--line); margin: 0 4px; flex: none; }
    #tb { display: none; align-items: center; flex-wrap: wrap; gap: 1px; padding: 4px; white-space: nowrap; width: max-content; max-width: calc(100vw - 16px); }
    @media (max-width: 520px) { #tb .sep { display: none; } }   /* phone width: two rows, nothing hidden off the edge */
    #tb #b-more { padding: 0 12px 0 8px; }
    #tb #b-grip { cursor: grab; min-width: 24px; padding: 0 4px; color: var(--mute); } #tb #b-grip:active { cursor: grabbing; }
    #tb #b-add { color: var(--acc); font-weight: 500; background: color-mix(in srgb, var(--acc) 10%, transparent); padding: 0 12px 0 8px; }
    #tb #b-add:hover:not(:disabled) { background: color-mix(in srgb, var(--acc) 18%, transparent); }
    .sw { position: relative; width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; border-radius: 8px; cursor: pointer; flex: none; }
    .sw:hover { background: var(--hover); }
    .sw input { position: absolute; inset: 0; opacity: 0; width: 100%; height: 100%; cursor: pointer; }
    .sw .ico { position: relative; display: block; width: 18px; height: 18px; }
    .sw .bar { position: absolute; left: 1px; right: 1px; bottom: -3px; height: 3px; border-radius: 2px; background: #888; }
    .sw.dis { opacity: .3; pointer-events: none; }
    #txtpop, #insm, #list { padding: 12px 14px; width: 300px; }
    #cfm { padding: 14px; width: 300px; }
    #cfm .msg b { display: block; font-weight: 500; } #cfm .msg span { display: block; color: var(--mute); margin-top: 2px; overflow-wrap: anywhere; }
    #cfm .acts { display: flex; justify-content: flex-end; gap: 6px; margin-top: 12px; }
    .sec { margin: 0 0 12px; } .sec:last-child { margin-bottom: 0; }
    .sec h5 { margin: 0 0 4px; color: var(--mute); font-size: 12px; font-weight: 400; }
    .row { display: flex; gap: 10px; align-items: center; justify-content: space-between; margin: 6px 0; flex-wrap: wrap; }
    .row.col { flex-direction: column; align-items: stretch; gap: 4px; }
    .note { color: var(--mute); font-size: 12px; margin: 4px 0; }
    label.chk { display: inline-flex; gap: 8px; align-items: center; cursor: pointer; }
    input[type=checkbox] { width: 15px; height: 15px; accent-color: var(--acc); }
    input[type=text], input[type=number], select, textarea { border: 1px solid transparent; border-radius: 8px; padding: 0 10px; height: 30px; background: var(--bg); color: var(--ink); }
    input:focus, select:focus, textarea:focus { outline: 2px solid var(--acc); outline-offset: -1px; }
    input[type=text] { width: 100%; } input[type=number] { width: 72px; }
    textarea { padding: 6px 10px; height: auto; min-height: 56px; resize: none; width: 100%; }
    .seg { display: inline-flex; background: var(--bg); border-radius: 9px; padding: 2px; gap: 1px; }
    .seg button { height: 26px; border-radius: 7px; min-width: 32px; padding: 0 10px; }
    .seg button.on { background: var(--card); color: var(--ink); box-shadow: 0 1px 2px rgba(0,0,0,.18); }
    .seg.full { display: flex; } .seg.full button { flex: 1; white-space: nowrap; padding: 0 6px; }
    .stepper { display: inline-flex; align-items: center; background: var(--bg); border-radius: 9px; padding: 2px; }
    .stepper button { height: 26px; min-width: 32px; border-radius: 7px; font-size: 16px; }
    .stepper output { min-width: 52px; text-align: center; }
    #insm { width: 448px; }
    #insm .where { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: var(--mute); margin: 0 0 4px; font-size: 12px; } #insm .where b { color: var(--ink); }
    #insm .where span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #insm h4 { margin: 10px 0 5px; color: var(--mute); font-size: 12px; font-weight: 400; }
    #insm .tiles { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
    #insm .tile { flex-direction: column; height: 60px; gap: 4px; background: var(--bg); border-radius: 10px; cursor: grab; padding: 6px 2px; font-size: 12px; line-height: 1.2; text-align: center; }
    #insm .tile:active { cursor: grabbing; }
    #insm .tile:hover:not(:disabled) { background: color-mix(in srgb, var(--acc) 12%, transparent); color: var(--acc); }
    #insm .tile svg { width: 20px; height: 20px; }
    #insm .urlrow { display: flex; gap: 6px; margin-top: 6px; }
    #insm .hint { color: var(--mute); margin-top: 10px; font-size: 12px; }
    #list { width: 380px; max-height: 50vh; overflow: auto; padding: 6px 10px; }
    #list .it { display: flex; gap: 8px; align-items: center; padding: 6px 2px; border-bottom: 1px solid var(--line); }
    #list .it span { flex: 1; overflow-wrap: anywhere; } #list .it:last-child { border-bottom: 0; } .k { color: var(--mute); }
    #list .foot { display: flex; flex-direction: column; align-items: stretch; margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--line); }
    #list .foot button { justify-content: flex-start; color: var(--mute); }
    #bar { left: 50%; transform: translateX(-50%); bottom: 16px; display: none; align-items: center; justify-content: center; flex-wrap: wrap; gap: 2px; padding: 4px; border-radius: 22px; width: max-content; max-width: calc(100vw - 16px); }
    @media (max-width: 520px) { #bar { border-radius: 18px; } #bar .sep { display: none; } }
    #bar button { white-space: nowrap; border-radius: 18px; }
    #bar #cnt { color: var(--mute); padding: 0 8px 0 12px; } #bar #cnt svg { width: 14px; height: 14px; opacity: .7; }
    #bar #quit { color: var(--mute); }
    #bar #ins { color: var(--acc); font-weight: 500; background: color-mix(in srgb, var(--acc) 10%, transparent); padding: 0 14px 0 10px; }
    #bar #ins:hover:not(:disabled) { background: color-mix(in srgb, var(--acc) 18%, transparent); }
    #pill { right: 16px; top: 16px; height: 36px; padding: 0 16px 0 12px; border-radius: 18px; background: var(--acc); color: var(--on-acc); font-weight: 500; border: 0; }
    #pill:hover:not(:disabled) { background: var(--acc); filter: brightness(1.07); }
    #toast { left: 50%; transform: translateX(-50%); bottom: 64px; padding: 8px 14px; max-width: min(520px, 86vw); background: #23262a; color: #fff; border: 0; border-radius: 10px; }
    .root[data-theme=dark] #toast { background: #eceef1; color: #1d2125; }
    /* the inspector (« Réglages »): content, then two tabs of folding sections */
    #pop { width: 320px; padding: 0; }
    .ihead { position: sticky; top: 0; z-index: 1; display: flex; gap: 4px; align-items: center; padding: 10px 10px 8px; background: var(--card); border-bottom: 1px solid var(--line); border-radius: 12px 12px 0 0; }
    .pbody { padding: 10px 12px 12px; }
    .cl { display: block; color: var(--mute); font-size: 12px; margin: 0 0 4px; }
    .blk { margin: 0 0 10px; }
    .tabs { display: flex; margin: 4px -12px 8px; padding: 0 12px; border-bottom: 1px solid var(--line); }
    .tabs button { flex: 1; height: 34px; border-radius: 0; color: var(--mute); border-bottom: 2px solid transparent; margin-bottom: -1px; }
    .tabs button.on { background: transparent; color: var(--ink); border-bottom-color: var(--acc); font-weight: 500; }
    .acc { border-bottom: 1px solid var(--line); } .acc:last-child { border-bottom: 0; }
    .acc-h { width: 100%; justify-content: space-between; height: 38px; padding: 0 2px; border-radius: 0; font-weight: 500; }
    .acc-h svg { width: 14px; height: 14px; color: var(--mute); transition: transform .15s; } .acc.open .acc-h svg { transform: rotate(180deg); }
    .acc-b { display: none; padding: 2px 0 12px; } .acc.open .acc-b { display: block; }
    .g2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 0 0 8px; } .g2.one { grid-template-columns: 1fr; }
    .pill, .cf, .fld { display: flex; align-items: center; gap: 6px; min-width: 0; height: 32px; padding: 0 8px; background: var(--bg); border: 1px solid transparent; border-radius: 8px; }
    .pill:focus-within, .cf:focus-within, .fld:focus-within { border-color: var(--acc); }
    .pill:has(.bad), .cf:has(.bad) { border-color: var(--warn); }
    .pt { color: var(--mute); font-size: 12px; flex: none; }
    .pill input, .cf input[type=text] { border: 0; background: transparent; height: 28px; padding: 0; min-width: 0; width: 100%; text-align: right; }
    .pill input:focus, .cf input:focus, .fld select:focus { outline: none; }
    .fld select { border: 0; background: transparent; height: 28px; padding: 0; min-width: 0; width: 100%; text-align: right; text-align-last: right; cursor: pointer; }
    .fldr { margin: 0 0 8px; }
    .cs { position: relative; width: 18px; height: 18px; border-radius: 5px; border: 1px solid var(--line); flex: none; cursor: pointer; overflow: hidden; }
    .cs input { position: absolute; inset: -4px; width: 28px; height: 28px; opacity: 0; cursor: pointer; border: 0; padding: 0; }
    .cf .pt { margin-right: auto; }
    .sub { display: flex; align-items: center; justify-content: space-between; color: var(--mute); font-size: 12px; margin: 0 0 6px; }
    .srow { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0 0 8px; }
    .tgs { display: inline-flex; gap: 2px; background: var(--bg); border-radius: 9px; padding: 2px; }
    .tgs button { height: 26px; min-width: 32px; border-radius: 7px; }
    .tgs button.on { background: var(--card); color: var(--ink); box-shadow: 0 1px 2px rgba(0,0,0,.18); }
    .rng { display: flex; align-items: center; gap: 8px; height: 32px; } .rng output { min-width: 38px; text-align: right; }
    input[type=range] { accent-color: var(--acc); flex: 1; min-width: 0; height: 20px; padding: 0; background: transparent; }
  `;
  const ic = (d, fillMode) => `<svg width="17" height="17" viewBox="0 0 24 24" fill="${fillMode ? 'currentColor' : 'none'}" stroke="${fillMode ? 'none' : 'currentColor'}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const IC = {
    grip: '<svg width="10" height="16" viewBox="0 0 10 14" fill="currentColor"><circle cx="2.5" cy="2.5" r="1.3"/><circle cx="7.5" cy="2.5" r="1.3"/><circle cx="2.5" cy="7" r="1.3"/><circle cx="7.5" cy="7" r="1.3"/><circle cx="2.5" cy="11.5" r="1.3"/><circle cx="7.5" cy="11.5" r="1.3"/></svg>',
    dup: ic('<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H16"/>'),
    del: ic('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>'),
    plus: ic('<path d="M12 5v14M5 12h14"/>'),
    sliders: ic('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),
    chev: ic('<path d="m6 9 6 6 6-6"/>'),
    link: ic('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
    justify: ic('<path d="M4 6h16M4 12h16M4 18h16"/>'),
    parent: ic('<path d="M9 14 4 9l5-5"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>'),
    up: ic('<path d="M12 19V5M5 12l7-7 7 7"/>'), down: ic('<path d="M12 5v14M19 12l-7 7-7-7"/>'),
    tcol: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 16 12 3l7 13M7.8 11.5h8.4"/></svg>',
    fill: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5c3.4 3.9 5.8 6.9 5.8 9.8a5.8 5.8 0 0 1-11.6 0c0-2.9 2.4-5.9 5.8-9.8Z"/></svg>',
    pencil: ic('<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
    close: ic('<path d="M6 6l12 12M18 6 6 18"/>'),
    left: ic('<path d="M4 6h16M4 12h10M4 18h14"/>'), center: ic('<path d="M4 6h16M7 12h10M5 18h14"/>'), right: ic('<path d="M4 6h16M10 12h10M6 18h14"/>'),
  };

  function buildUi() {
    host = document.createElement('div'); host.setAttribute('data-ky-ui', '');
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style><div class="root">
      <div id="hov" class="box"><span></span></div><div id="drop" class="box"></div><div id="selb" class="box"><span class="chip"></span></div>
      <div id="tb" class="panel">
        <button id="b-grip" title="Glisser pour déplacer ce bloc">${IC.grip}</button>
        <button id="b-par" title="Choisir le bloc qui contient celui-ci">${IC.parent}</button>
        <i class="sep"></i>
        <button id="b-txt" title="Taille, graisse et alignement du texte"><span class="aa">Aa</span></button>
        <label class="sw" id="sw-color" title="Couleur du texte"><span class="ico">${IC.tcol}<i class="bar"></i></span><input type="color" id="b-color"></label>
        <label class="sw" id="sw-bg" title="Couleur de fond"><span class="ico">${IC.fill}<i class="bar"></i></span><input type="color" id="b-bg"></label>
        <i class="sep"></i>
        <button id="b-more" title="Réglages : texte, couleurs, police, bordure, marges, taille…">${IC.sliders}<span>Réglages</span></button>
        <button id="b-dup" title="Dupliquer (Cmd/Ctrl + D)">${IC.dup}</button><button id="b-del" title="Supprimer, après confirmation (Suppr)">${IC.del}</button>
        <i class="sep"></i>
        <button id="b-add" title="Ajouter un bloc ou une image">${IC.plus}<span>Ajouter</span></button>
      </div>
      <div id="txtpop" class="panel" hidden></div>
      <div id="pop" class="panel" hidden></div>
      <div id="insm" class="panel" hidden></div>
      <input type="file" id="i-file" accept="image/png,image/jpeg,image/gif,image/webp" hidden>
      <div id="list" class="panel" hidden></div>
      <div id="cfm" class="panel" hidden></div>
      <div id="bar" class="panel"><button id="ins" title="Ajouter un bloc ou une image">${IC.plus}<span>Ajouter</span></button><i class="sep"></i><button id="cnt" title="Voir la liste des changements en attente"><span>Aucun changement</span>${IC.chev}</button><button id="discard" title="Abandonner tous les changements en attente (le fichier n'est pas touché)">Annuler tout</button><button id="save" class="primary" title="Écrire les changements dans le fichier (une copie de sécurité est gardée)">Enregistrer</button><i class="sep"></i><button id="quit" title="Quitter le mode modification (les changements en attente sont gardés)">Quitter</button></div>
      <button id="pill" class="panel" title="Modifier cette page">${IC.pencil}<span>Modifier</span></button>
      <div id="toast" class="panel" hidden></div></div>`;
    document.documentElement.appendChild(host);
    $ = (s) => root.querySelector(s);
    startI18n();
    hov = $('#hov'); hovTag = $('#hov span'); selb = $('#selb'); chip = $('#selb .chip'); dropBox = $('#drop'); tb = $('#tb'); txtpop = $('#txtpop'); pop = $('#pop'); insm = $('#insm'); list = $('#list'); bar = $('#bar'); pill = $('#pill'); toastEl = $('#toast'); cfm = $('#cfm');
    const st = document.createElement('style'); st.setAttribute('data-ky-ui', '');
    st.textContent = '[contenteditable]{outline:none!important;caret-color:#2563eb}';   // live page only, never in the file
    document.head.appendChild(st);

    themeSync();
    pill.onclick = () => setOn(true);
    $('#quit').onclick = () => setOn(false);
    $('#discard').onclick = () => confirmBox({ anchor: bar, above: true, title: 'Annuler tous les changements ?', detail: F ? `${pending.length} changement${pending.length > 1 ? 's' : ''} en attente ${pending.length > 1 ? 'seront perdus' : 'sera perdu'}. Le fichier n'est pas touché.` : `${pending.length} waiting change${pending.length > 1 ? 's' : ''} will be lost. The file is not touched.`, ok: 'Tout annuler', danger: true, onOk: async () => { await dropUploads(pending, []); pending = []; await persist(); location.reload(); } });
    $('#save').onclick = save;
    $('#cnt').onclick = () => { closePops('list'); list.hidden = !list.hidden; renderList(); placeBelow(list, bar, true); };
    wirePop();

    // toolbar: keep the caret in the text when a button is pressed
    for (const p of [tb, txtpop]) p.addEventListener('mousedown', (e) => { if (!e.target.closest('input,select,textarea')) e.preventDefault(); });
    $('#b-grip').addEventListener('mousedown', (e) => { if (!sel || sel.sid == null) return; dr = { x: e.clientX, y: e.clientY, on: false, drop: null }; e.preventDefault(); });
    $('#b-dup').onclick = () => dupSel();
    $('#b-del').onclick = () => askDelete();
    $('#b-par').onclick = () => { const p = sel.el.parentElement; if (p && p !== document.body && p !== document.documentElement) select(p); };
    $('#b-add').onclick = () => openInsert(tb);
    $('#ins').onclick = () => openInsert(bar, true);
    $('#b-txt').onclick = () => { const was = !txtpop.hidden; closePops(); if (was) return; fillTxt(); txtpop.hidden = false; placeBelow(txtpop, tb); };
    $('#b-color').oninput = (e) => sty('color', e.target.value);
    $('#b-bg').oninput = (e) => sty('background-color', e.target.value);
    $('#b-more').onclick = () => { const was = !pop.hidden; closePops(); if (was) return; fillPop(); pop.hidden = false; dockPop(); };
    cfm.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); cfm.hidden = true; }
      else if (e.key === 'Delete' && cfm.dataset.kind === 'del') { e.preventDefault(); $('#c-ok').click(); }   // Suppr twice: the quick way for who knows
    });
  }
  const moveSel = (dir) => { const r = sibling(sel.el, dir); if (r) keep(stage({ op: 'move', id: sel.sid, ref: idOf(r), where: dir < 0 ? 'before' : 'after', tag: desc(sel.el), refTag: desc(r) })); };

  // size, weight and alignment of the chosen text, in one small panel
  function fillTxt() {
    const cs = getComputedStyle(sel.el), size = Math.round(parseFloat(cs.fontSize)), bold = parseInt(cs.fontWeight, 10) >= 600, al = /^(center|right)$/.test(cs.textAlign) ? cs.textAlign : 'left';
    txtpop.innerHTML = `
      <div class="row"><label title="Taille du texte, en pixels">Taille</label><span class="stepper"><button id="t-sm" title="Plus petit">−</button><output id="t-size">${size} px</output><button id="t-lg" title="Plus grand">+</button></span></div>
      <div class="row"><label title="Épaisseur des traits du texte">Graisse</label><span class="seg" id="t-w"><button data-w="400" title="Épaisseur normale"${bold ? '' : ' class="on"'}>Normal</button><button data-w="700" title="Texte en gras"${bold ? ' class="on"' : ''}>Gras</button></span></div>
      <div class="row"><label title="Alignement du texte dans son bloc">Alignement</label><span class="seg" id="t-a">${['left', 'center', 'right'].map((a) => `<button data-a="${a}" title="${{ left: 'À gauche', center: 'Centré', right: 'À droite' }[a]}"${al === a ? ' class="on"' : ''}>${IC[a]}</button>`).join('')}</span></div>`;
    const out = txtpop.querySelector('#t-size'), step = (d) => { const n = Math.max(6, Math.min(160, Math.round(parseFloat(getComputedStyle(sel.el).fontSize)) + d)); sty('font-size', n + 'px'); out.textContent = n + ' px'; };
    txtpop.querySelector('#t-sm').onclick = () => step(-1); txtpop.querySelector('#t-lg').onclick = () => step(1);
    txtpop.querySelectorAll('#t-w button').forEach((b) => (b.onclick = () => { sty('font-weight', b.dataset.w); txtpop.querySelectorAll('#t-w button').forEach((x) => x.classList.toggle('on', x === b)); }));
    txtpop.querySelectorAll('#t-a button').forEach((b) => (b.onclick = () => { sty('text-align', b.dataset.a); txtpop.querySelectorAll('#t-a button').forEach((x) => x.classList.toggle('on', x === b)); }));
  }

  const rootEl = () => root.querySelector('.root');
  // The editor wears the page's own theme: the first background that is not transparent, body then html, decides dark or light.
  function themeSync() {
    if (!root) return;
    let dark = matchMedia('(prefers-color-scheme: dark)').matches;
    for (const e of [document.body, document.documentElement]) {
      const c = parseColor(getComputedStyle(e).backgroundColor);
      if (c.a > 0) { const n = parseInt(c.hex.slice(1), 16); dark = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) < 140; break; }
    }
    const r = rootEl(), want = dark ? 'dark' : 'light';
    if (r.dataset.theme !== want) r.dataset.theme = want;
  }
  function closePops(except) {
    if (except !== 'list') list.hidden = true;
    pop.hidden = true; txtpop.hidden = true; insm.hidden = true; cfm.hidden = true;
  }
  // Asks before anything a click cannot take back. The safe button has the focus; Esc cancels.
  function confirmBox({ anchor, above, keepList, title, detail, ok, danger, kind, onOk }) {
    closePops(keepList ? 'list' : undefined);
    cfm.innerHTML = `<div class="msg"><b>${esc(title)}</b>${detail ? `<span>${esc(detail)}</span>` : ''}</div><div class="acts"><button id="c-no" class="line" title="Ne rien faire (Échap)">Annuler</button><button id="c-ok" class="${danger ? 'danger' : 'primary'}">${esc(ok)}</button></div>`;
    cfm.dataset.kind = kind || ''; cfm.hidden = false; placeBelow(cfm, anchor, above);
    $('#c-no').onclick = () => { cfm.hidden = true; };
    $('#c-ok').onclick = () => { cfm.hidden = true; onOk(); };
    $('#c-no').focus();
  }
  function askDelete() {
    if (!sel || sel.sid == null) return;
    confirmBox({ anchor: tb, title: 'Supprimer cet élément ?', detail: F ? `${desc(sel.el)}. Rien n'est écrit avant « Enregistrer » : vous pouvez encore retirer ce changement de la liste.` : `${desc(sel.el)}. Nothing is written before “Save”: you can still remove this change from the list.`, ok: 'Supprimer', danger: true, kind: 'del', onOk: removeSel });
  }
  // The « Modifier » button sits at the top right, and steps aside when the page has a control of its own there.
  const INTERACTIVE = 'a,button,input,select,textarea,summary,label,[role=button],[role=link],[onclick]';
  function placePill() {
    if (!pill || pill.hidden) return;
    pill.style.pointerEvents = 'none'; pill.style.right = '16px';
    const w = pill.offsetWidth, h = pill.offsetHeight, vw = document.documentElement.clientWidth;
    for (let i = 0; i < 3; i++) {
      const x1 = vw - parseFloat(pill.style.right) - w;
      let hit = null;
      for (const x of [x1 + 3, x1 + w / 2, x1 + w - 3]) { const e = document.elementFromPoint(x, 16 + h / 2); const c = e && e !== host && e.closest ? e.closest(INTERACTIVE) : null; if (c) { hit = c; break; } }
      if (!hit) break;
      pill.style.right = Math.min(vw - w - 8, Math.max(16, vw - hit.getBoundingClientRect().left + 10)) + 'px';
    }
    pill.style.pointerEvents = '';
  }
  function placeBelow(el, anchor, above) {
    const a = anchor.getBoundingClientRect(), vw = document.documentElement.clientWidth;
    const floor = (on && anchor !== bar ? bar.getBoundingClientRect().top : innerHeight) - 8;   // never under the bottom bar
    el.style.maxHeight = Math.min(640, Math.max(160, floor - 16)) + 'px'; el.style.overflowY = 'auto';
    const w = el.offsetWidth, h = el.offsetHeight;
    let top = above ? a.top - h - 8 : a.bottom + 8;
    if (!above && top + h > floor) top = a.top - h - 8;   // no room below: above the anchor
    top = Math.max(8, Math.min(top, floor - h));
    Object.assign(el.style, { left: Math.min(Math.max(8, a.left), vw - w - 8) + 'px', top: top + 'px', transform: 'none' });
  }
  let toastTimer = null;
  function toast(t, ms = 4200) {
    toastEl.textContent = t; toastEl.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms);
  }

  // ---- edit mode ----
  function setOn(v) {
    on = v; persist();
    pill.hidden = on; bar.style.display = on ? 'flex' : 'none';
    if (!on) { deselect(); hov.style.display = 'none'; closePops(); }
    refreshBar();
    pill.querySelector('span').textContent = 'Modifier' + (pending.length ? ` (${pending.length})` : '');
    placePill();
  }
  function deselect() { stopEdit(); sel = null; selb.style.display = 'none'; tb.style.display = 'none'; closePops(); }
  function refreshBar() {
    const n = pending.length, files = pending.filter((p) => p.type !== 'intent').length;
    $('#cnt span').textContent = n ? (F ? `${n} changement${n > 1 ? 's' : ''}` : `${n} change${n > 1 ? 's' : ''}`) : tx('Aucun changement');
    $('#discard').disabled = !n; $('#save').disabled = !files;
    if (!list.hidden) renderList();
  }

  // ---- what the page shows at once; the file changes only at "Enregistrer". Replayed after every reload. ----
  function liveStruct(p) {
    const get = (id) => document.querySelector(`[data-ky-i="${id}"]`);
    const el = p.id !== undefined ? get(p.id) : null, ref = p.ref !== undefined ? get(p.ref) : null;
    const put = (n, r, where) => { if (where === 'before') r.parentNode.insertBefore(n, r); else if (where === 'after') r.after(n); else r.appendChild(n); };
    if (p.op === 'del') { if (el) el.remove(); return null; }
    if (p.op === 'move') { if (el && ref && !el.contains(ref) && el !== ref) put(el, ref, p.where); return el; }
    if (p.op === 'dup') {
      if (!el) return null;
      const c = el.cloneNode(true);
      c.querySelectorAll('[data-ky-i]').forEach((x) => x.removeAttribute('data-ky-i'));
      c.setAttribute('data-ky-i', p.newId); c.setAttribute('data-ky-new', 'dup');
      for (const x of [c, ...c.querySelectorAll('[id]')]) if (x.id) x.id += '-copy';
      el.after(c); return c;
    }
    if (p.op === 'add') {
      if (!ref) return null;
      if (!p.html) return null;
      const t = document.createElement('template'); t.innerHTML = p.html;
      const n = t.content.firstElementChild; if (!n) return null;
      n.setAttribute('data-ky-i', p.newId); n.setAttribute('data-ky-new', 'add');   // « add »: typed text and styles inside it travel with the block itself
      put(n, ref, p.where); return n;
    }
    return null;
  }
  // Texts a script builds from the maquette's data files. They show the new words at once, in every place they appear
  // (the file changes the same way at « Enregistrer »). Only nodes the file itself does not hold: not in a numbered element, not in a new block.
  const pageTexts = (match, except) => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), out = [];
    for (let n = w.nextNode(); n; n = w.nextNode()) { const pe = n.parentElement; if (n !== except && pe && !own(pe) && !pe.closest('[data-ky-new]') && !/^(script|style)$/i.test(pe.tagName) && match(n.nodeValue)) out.push(n); }
    return out;
  };
  function replay() {
    for (const p of pending) {
      if (p.type === 'srctext') { for (const n of pageTexts((v) => v === p.before || v.trim() === p.before)) n.nodeValue = n.nodeValue === p.before ? p.after : n.nodeValue.replace(p.before, () => p.after); continue; }
      if (p.type === 'rule') { for (const sh of document.styleSheets) { let rs; try { rs = sh.cssRules; } catch (e) { continue; } for (const r of rs) if (r.type === 1 && r.selectorText && r.selectorText.trim() === p.selector) r.style.setProperty(p.prop, p.after); } continue; }
      if (p.type === 'struct') { liveStruct(p); continue; }
      const el = document.querySelector(`[data-ky-i="${p.id}"]`); if (!el) continue;
      if (p.type === 'style') el.style.setProperty(p.prop, p.after);
      if (p.type === 'attr') el.setAttribute(p.name, p.after);
      if (p.type === 'text') { const n = [...el.childNodes].filter((x) => x.nodeType === 3)[p.node]; if (n) n.nodeValue = p.after; }
    }
  }
  function upsert(key, patch) {
    const i = pending.findIndex((p) => p.key === key);
    if (patch === null) { if (i >= 0) pending.splice(i, 1); }
    else if (i >= 0) pending[i] = { ...pending[i], ...patch };
    else pending.push({ key, ...patch });
    persist(); refreshBar();
  }
  function stage(p) {
    const el = liveStruct(p);
    upsert('s' + Date.now() + '|' + (++seq), { type: 'struct', ...p });
    return el;
  }
  function keep(el) { if (el) select(el); else deselect(); }
  function removeSel() { if (!sel || sel.sid == null) return; stage({ op: 'del', id: sel.sid, tag: desc(sel.el) }); deselect(); toast('Supprimé. Ce changement est dans la liste : vous pouvez le retirer avant d\'enregistrer.'); }
  const movable = (n) => n && n.nodeType === 1 && own(n) && !SKIP.has(n.tagName.toLowerCase());
  function sibling(el, dir) { for (let n = dir < 0 ? el.previousElementSibling : el.nextElementSibling; n; n = dir < 0 ? n.previousElementSibling : n.nextElementSibling) if (movable(n)) return n; return null; }

  // ---- « Insérer »: blocks and pictures, by click or by drag onto the page ----
  // Where a new block goes: next to the chosen block, or at the end of the page when nothing is chosen.
  function target() {
    const a = sel && (sel.sid != null ? sel.el : nearest(sel.el));
    if (a && own(a) && !NOSTRUCT.has(a.tagName.toLowerCase())) return { el: a, ref: idOf(a), where: addWhere, refTag: desc(a), chosen: true };
    const holder = document.body;   // the end of the page is the end of the body, whatever the maquette calls its main frame
    const last = [...holder.children].filter(movable).pop();
    if (last) return { el: last, ref: idOf(last), where: 'after', refTag: tx('la fin de la page') };
    return own(holder) ? { el: holder, ref: idOf(holder), where: 'inside', refTag: tx('la page') } : null;
  }
  function openInsert(anchor, above) {
    const was = !insm.hidden; closePops(); if (was) return;
    renderInsert(); insm.hidden = false; placeBelow(insm, anchor, above);
  }
  function renderInsert() {
    const t = target(), groups = [...new Set(palette.map((b) => b.group))], gl = (g) => (palette.find((b) => b.group === g) || {}).groupLabel || g;
    insm.innerHTML = `
      <div class="where"><span>${t ? (t.chosen ? `À insérer par rapport à <b>${esc(t.refTag)}</b>` : 'À insérer <b>à la fin de la page</b>') : 'Rien ne permet d\'insérer ici.'}</span>
      ${t && t.chosen ? `<div class="seg" id="a-where">${[['after', 'Après', 'Placer le bloc après celui qui est choisi'], ['before', 'Avant', 'Placer le bloc avant celui qui est choisi'], ['inside', 'Dedans', 'Placer le bloc à l\'intérieur de celui qui est choisi']].map(([w, l, t]) => `<button data-w="${w}" title="${t}"${addWhere === w ? ' class="on"' : ''}>${l}</button>`).join('')}</div>` : ''}</div>
      ${groups.map((g) => `<h4>${esc(gl(g))}</h4><div class="tiles">${palette.filter((b) => b.group === g).map((b) => `<button class="tile" data-k="${b.kind}" title="${esc(b.label)}${b.needs ? (F ? ' : choisir une image' : ': choose a picture') : ''}">${TILE[b.kind] || ''}<span>${esc(b.label)}</span></button>`).join('')}</div>${g === 'images' ? '<div class="urlrow"><input type="text" id="i-url" placeholder="ou l\'adresse d\'une image : https://…"><button id="i-url-go" class="primary">Ajouter</button></div>' : ''}`).join('')}
      <div class="hint">Cliquez sur un bloc, ou glissez-le sur la page. Une image déposée ou collée devient aussi un bloc.</div>`;
    insm.querySelectorAll('#a-where button').forEach((b) => (b.onclick = () => { addWhere = b.dataset.w; renderInsert(); }));
    insm.querySelectorAll('.tile').forEach((b) => {
      b.onclick = () => insert(b.dataset.k, target());
      b.addEventListener('mousedown', (e) => { if (e.button !== 0) return; dr = { x: e.clientX, y: e.clientY, on: false, drop: null, kind: b.dataset.k }; e.preventDefault(); });
    });
    const url = insm.querySelector('#i-url'), go = () => {
      const v = url.value.trim();
      if (!/^https?:\/\/[^\s"'<>]+$/i.test(v)) { toast('Collez une adresse d\'image qui commence par https://'); return; }
      const t2 = target(); if (!t2) return; closePops();
      afterAdd(addBlock(palette.find((b) => b.kind === 'image'), t2, { src: v, alt: '' }));
    };
    insm.querySelector('#i-url-go').onclick = go; url.onkeydown = (e) => { if (e.key === 'Enter') go(); };
  }
  function pickImage() {
    return new Promise((ok) => {
      const f = $('#i-file'); f.value = '';
      f.onchange = () => ok(f.files[0] ? uploadFile(f.files[0]) : null); f.oncancel = () => ok(null);
      f.click();
    });
  }
  async function uploadFile(file) {
    if (!isImg(file)) { toast('Seules les images PNG, JPEG, GIF et WebP sont acceptées.'); return null; }
    if (file.size > 8 * 1048576) { toast('Cette image dépasse 8 Mo.'); return null; }
    let r;
    try { const bytes = await file.arrayBuffer(); r = await bridge('upload', { filename: file.name, bytes }, [bytes]); }
    catch (e) { r = { ok: false, why: String(e && e.message || e) }; }
    if (!r || !r.ok) { toast(tx('Image refusée : ') + (r && r.why || '')); return null; }
    return { src: r.src, alt: file.name.replace(/\.[^.]*$/, '').replace(/[-_]+/g, ' ').trim(), uploaded: !r.existed };
  }
  // Pictures sent for changes that are given up are removed again (the server keeps any a saved page uses).
  async function dropUploads(gone, kept) {
    const used = JSON.stringify(kept), srcs = [...new Set(gone.flatMap((p) => p.uploads || []))].filter((u) => !used.includes(u));
    if (srcs.length) await api('unupload', { srcs });   // the file stays if this fails, harmless
  }
  function addBlock(b, tgt, img) {
    const html = b.needs ? fill(b.html, img) : b.html;
    return stage({ op: 'add', kind: b.kind, label: b.label, html, ref: tgt.ref, where: tgt.where, newId: newId(), tag: tgt.refTag, uploads: img && img.uploaded ? [img.src] : [] });
  }
  async function insert(kind, tgt) {
    closePops();
    const b = palette.find((x) => x.kind === kind);
    if (!b || !tgt) { if (b) toast('Rien ne permet d\'insérer ici : choisissez un bloc de la page.'); return; }
    if (tgt.where === 'inside' && tgt.el && VOIDS.has(tgt.el.tagName.toLowerCase())) { toast(F ? `${nice(tgt.el)} ne peut rien contenir : choisissez « Après » ou « Avant ».` : `${nice(tgt.el)} cannot hold anything: choose “After” or “Before”.`); return; }
    let img = null; if (b.needs) { img = await pickImage(); if (!img) return; }
    afterAdd(addBlock(b, tgt, img));
  }
  async function insertFiles(files, tgt) {
    const b = palette.find((x) => x.kind === 'image'); let last = null;
    for (const f of files) {
      const img = await uploadFile(f); if (!img) continue;
      const t = last ? { ref: idOf(last), where: 'after', refTag: desc(last) } : tgt;
      last = addBlock(b, t, img);
    }
    afterAdd(last);
  }
  // the new block is chosen; if it holds words, they are selected so that typing replaces them
  function afterAdd(el) {
    if (!el) return;
    const t = [el, ...el.querySelectorAll('*')].find((n) => !NOEDIT.has(n.tagName.toLowerCase()) && snapText(n).length) || el;
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    select(t);
    if (sel && sel.editing) { const r = document.createRange(); r.selectNodeContents(t); const g = getSelection(); g.removeAllRanges(); g.addRange(r); }
  }

  // A block added here is saved as the markup it has now, so what was typed or styled inside it travels with it.
  function cleanHtml(root) {
    const c = root.cloneNode(true);
    c.querySelectorAll('[data-ky-i]').forEach((x) => x.remove());   // other blocks (added next to it, or moved into it) have their own change
    for (const x of [c, ...c.querySelectorAll('*')]) {
      for (const a of [...x.attributes]) if (a.name === 'contenteditable' || a.name.startsWith('data-ky')) x.removeAttribute(a.name);
      if (x.getAttribute('style') === '') x.removeAttribute('style');
    }
    return c.outerHTML;
  }
  const addOp = (root) => pending.find((x) => x.type === 'struct' && x.op === 'add' && String(x.newId) === root.getAttribute('data-ky-i'));
  function syncFresh(el) {
    const root = el.closest('[data-ky-new="add"]'), p = root && addOp(root);
    if (p) { p.html = cleanHtml(root); persist(); }
  }
  // A copy of anything on the page is a new block carrying its own markup, so it can be typed in and coloured at once.
  function copyHtml(el) {
    const c = el.cloneNode(true); let ids = 0;
    for (const x of [c, ...c.querySelectorAll('*')]) {
      for (const a of [...x.attributes]) if (a.name === 'contenteditable' || a.name.startsWith('data-ky')) x.removeAttribute(a.name);
      if (x.getAttribute('style') === '') x.removeAttribute('style');
      if (x.id) { x.id += '-copy'; ids++; }
    }
    return { html: c.outerHTML, ids };
  }
  function dupSel() {
    if (!sel || sel.sid == null) return;
    const p = sel.el.getAttribute('data-ky-new') === 'add' && addOp(sel.el);
    if (p) return keep(stage({ op: 'add', kind: p.kind, label: p.label, html: cleanHtml(sel.el), ref: sel.sid, where: 'after', newId: newId(), tag: desc(sel.el), uploads: p.uploads || [] }));
    const { html, ids } = copyHtml(sel.el);
    const c = stage({ op: 'add', kind: 'copy', label: tx('copie'), lenient: true, html, ref: sel.sid, where: 'after', newId: newId(), tag: desc(sel.el), uploads: [] });
    if (c && snapText(c).length) afterAdd(c); else keep(c);   // a copy of a text: its words are chosen, so typing replaces them
    if (ids) toast(F ? `Copie faite. ${ids} identifiant${ids > 1 ? 's' : ''} renommé${ids > 1 ? 's' : ''} (« -copy ») : la copie n'est pas reliée au script de la page.` : `Copy made. ${ids} id${ids > 1 ? 's' : ''} renamed (“-copy”): the copy is not wired to the page script.`, 6000);
  }
  // one attribute (picture file, description, link address)
  function setAttr(name, value) {
    if (!sel || !(sel.own || sel.fresh)) return;
    const el = sel.el;
    if (sel.fresh) { el.setAttribute(name, value); syncFresh(el); return; }
    const key = `${sel.id}|attr|${name}`, was = pending.find((p) => p.key === key);
    const before = was ? was.before : el.getAttribute(name);
    el.setAttribute(name, value);
    upsert(key, value === before ? null : { type: 'attr', id: sel.id, name, before, after: value, tag: desc(el), uploads: was ? was.uploads : [] });
  }

  // ---- choosing an element, typing in it ----
  function select(el, ev) {
    if (el.nodeType !== 1) el = el.parentElement;
    if (!el || el === host) return;
    const reopen = !pop.hidden;   // the settings stay open while another element is chosen
    stopEdit(); closePops();
    const inFile = own(el), isNew = inFile && el.hasAttribute('data-ky-new'), anc = nearest(el);
    const inNew = !inFile && !!el.closest('[data-ky-new]');
    const fresh = !!el.closest('[data-ky-new="add"]');   // part of a block added in this session: editable like the rest, saved with the block
    const sid = inFile && !NOSTRUCT.has(el.tagName.toLowerCase()) ? idOf(el) : null;   // what move / copy / delete can address
    const gen = !inFile && !inNew && !fresh;   // put there by the page's own script: no place of its own in the file
    sel = { el, own: inFile && !isNew, isNew, inNew, fresh, gen, sid, id: inFile && !isNew ? idOf(el) : null, ancId: anc && !anc.hasAttribute('data-ky-new') ? idOf(anc) : null, src: gen ? 'checking' : null, ev: ev && ev.clientX !== undefined ? { clientX: ev.clientX, clientY: ev.clientY } : null };
    scope = sel.own ? 'element' : 'rule';
    if ((sel.own || fresh) && el.tagName === 'BUTTON') sel.snap = snapText(el);   // a button's words are changed from « Réglages », not by typing in it
    syncUi();
    if (gen) checkSrc(sel); else startEdit(ev);
    if (reopen) { fillPop(); pop.hidden = false; dockPop(); }
  }
  // A text the page builds can be typed in when the very same words are written in a file of the maquette (its data):
  // that file is then changed at « Enregistrer ». When the page composes the text, nothing is found and it stays locked.
  const findMemo = new Map();
  async function findText(text) {
    if (findMemo.has(text)) return findMemo.get(text);
    let r = { n: 0, files: [] };
    const a = await api('find', { text }); if (a && a.ok) r = a;   // host away: stays locked
    findMemo.set(text, r); return r;
  }
  async function checkSrc(s) {
    const nodes = NOEDIT.has(s.el.tagName.toLowerCase()) ? [] : snapText(s.el), found = [];
    s.hasText = nodes.length > 0;
    for (const o of nodes) {
      const v = o.n.nodeValue, was = pending.find((p) => p.type === 'srctext' && (p.after === v || p.after === v.trim()));   // words already changed in this session
      const tries = was ? [[was.before, v !== v.trim() && was.after === v.trim()]] : v === v.trim() ? [[v, false]] : [[v, false], [v.trim(), true]];
      let hit = null;
      for (const [lit, trimmed] of tries) { const r = was ? { n: was.places, files: was.files } : await findText(lit); if (r.n) { hit = { ...o, lit, trimmed, hits: r.n, files: r.files }; break; } }
      if (!hit) { found.length = 0; break; }
      found.push(hit);
    }
    if (sel !== s) return;
    s.src = found.length && found.length === nodes.length ? 'ok' : 'none';
    if (s.src === 'ok') { s.gsnap = found; s.srcN = Math.max(...found.map((f) => f.hits)); s.srcFiles = [...new Set(found.flatMap((f) => f.files))]; }
    syncUi(true);
    if (s.src === 'ok') startEdit(s.ev);
    else if (s.hasText && !lockedTold.has(s.el)) { lockedTold.add(s.el); toast('Ce texte est composé par la page : ici, on change ses couleurs et sa taille. Pour le texte, décrivez le changement à Kaby (Réglages).', 6000); }
    if (!pop.hidden) fillPop();
  }
  const lockedTold = new WeakSet();
  // Text typed straight in the page: the browser's own plain-text editing on the chosen element, no library.
  function startEdit(ev) {
    const el = sel.el;
    if (!(sel.own || sel.fresh || (sel.gen && sel.src === 'ok')) || NOEDIT.has(el.tagName.toLowerCase())) return;
    const nodes = sel.gen ? sel.gsnap : snapText(el);
    if (!nodes.length) return;
    if (sel.gen) for (const g of nodes) { const t = g.n.nodeValue.trim(); g.others = t.length > 1 ? pageTexts((v) => v.trim() === t, g.n) : []; }   // the same words elsewhere on the page follow while typing
    el.setAttribute('contenteditable', 'plaintext-only');
    if (el.contentEditable !== 'plaintext-only') el.setAttribute('contenteditable', 'true');
    sel.editing = true; sel.snap = nodes;
    el.focus({ preventScroll: true });
    const range = ev && ev.clientX !== undefined && (document.caretRangeFromPoint ? document.caretRangeFromPoint(ev.clientX, ev.clientY) : null);
    if (range && el.contains(range.startContainer)) { const s = getSelection(); s.removeAllRanges(); s.addRange(range); }
  }
  const snapText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n, k) => ({ n, k, before: n.nodeValue })).filter(({ n }) => n.nodeValue.trim());
  function stopEdit() {
    if (!sel || !sel.editing) return;
    sel.editing = false; sel.el.removeAttribute('contenteditable'); sel.el.blur();
  }
  // Typing over a whole text makes the browser drop the text node and make a new one: the new one is the text now. When nothing new came, everything was
  // deleted: an empty text is kept, it is a valid patch.
  function keepNode(el, list, s) {
    if (s.n.parentNode === el) return;
    const fresh = [...el.childNodes].filter((c) => c.nodeType === 3 && !list.some((o) => o.n === c));
    if (list.length === 1 && fresh.length) {
      if (fresh.length > 1) { fresh[0].nodeValue = fresh.map((c) => c.nodeValue).join(''); fresh.slice(1).forEach((c) => c.remove()); }
      s.n = fresh[0]; return;
    }
    s.n.nodeValue = ''; el.appendChild(s.n);
  }
  function syncGen() {
    const el = sel.el;
    for (const g of sel.snap) {
      keepNode(el, sel.snap, g);
      const key = `src|${g.lit}`, now = g.trimmed ? g.n.nodeValue.trim() : g.n.nodeValue;
      for (const o of g.others || []) o.nodeValue = now;
      upsert(key, now === g.lit ? null : { type: 'srctext', before: g.lit, after: now, tag: desc(el), places: g.hits, files: g.files });
    }
  }
  function syncText() {
    const el = sel.el;
    if (sel.fresh) { syncFresh(el); return; }
    if (sel.gen) { syncGen(); return; }
    for (const s of sel.snap) {
      keepNode(el, sel.snap, s);
      const { n, k, before: b0 } = s;
      const key = `${sel.id}|t${k}`, before = (pending.find((p) => p.key === key) || {}).before ?? b0;
      upsert(key, n.nodeValue === before ? null : { type: 'text', id: sel.id, node: k, before, after: n.nodeValue, tag: desc(el) });
    }
  }

  // ---- styles: on the element itself, or on the shared rule of the file ----
  // The shared rule that decides how this element looks: any plain selector of the file (classes, ids, tags, « a b », « a > b », lists),
  // the most specific one wins, the later one on a tie. Not the ones with « : » (hover, not…), @media, or the whole page (html, body, *).
  const plainSel = (t) => { t = t.trim(); return !/[:@]/.test(t) && t !== '*' && !/^(html|body)$/i.test(t); };
  const specOf = (s) => { s = s.replace(/\[[^\]]*\]/g, '.a'); return [(s.match(/#[\w-]+/g) || []).length, (s.match(/\.[\w-]+/g) || []).length, (s.replace(/[#.][\w-]+/g, ' ').match(/(^|[\s>+~])[a-z][\w-]*/gi) || []).length]; };
  const cmpSpec = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  const bestRule = (arr) => arr.reduce((a, b) => (cmpSpec(b.spec, a.spec) >= 0 ? b : a));
  function findRule(el, prop) {
    const hits = [], any = [];
    for (const sh of document.styleSheets) {
      if (sh.ownerNode && sh.ownerNode.hasAttribute && sh.ownerNode.hasAttribute('data-ky-ui')) continue;
      let rs; try { rs = sh.cssRules; } catch (e) { continue; }
      for (const r of rs) {
        if (r.type !== 1 || !plainSel(r.selectorText)) continue;
        const parts = r.selectorText.split(',').map((x) => x.trim()).filter((x) => { try { return el.matches(x); } catch (e) { return false; } });
        if (!parts.length) continue;
        const h = { rule: r, spec: parts.map(specOf).sort(cmpSpec).pop(), file: sh.href ? sh.href.split('/').pop().split('?')[0] : null, styleId: sh.href ? null : +sh.ownerNode.getAttribute('data-ky-i') };
        any.push(h); if (r.style.getPropertyValue(prop)) hits.push(h);
      }
    }
    if (hits.length) return { ...bestRule(hits), add: false };
    const cls = any.filter((h) => h.rule.selectorText.includes('.')), pool = cls.length ? cls : any;   // prefer a class rule of the element itself
    return pool.length ? { ...bestRule(pool), add: true } : null;
  }
  function sty(prop, after) {
    if (!sel) return;
    if (sel.fresh) { sel.el.style.setProperty(prop, after); syncFresh(sel.el); syncUi(true); return; }   // a new block carries its own style
    if (sel.isNew || sel.inNew) { toast('Enregistrez d\'abord cette copie pour pouvoir changer son style.'); return; }
    const el = sel.el, cs = getComputedStyle(el), beforeText = (prop === 'text-decoration' ? cs.textDecorationLine : cs.getPropertyValue(prop)) || '';
    if (scope === 'rule' || !sel.own) {
      const h = findRule(el, prop);
      if (!h) { toast(sel.own ? 'Aucune règle partagée pour ça : choisissez « Cet élément » dans Réglages.' : 'Cet élément est généré par la page et n\'a pas de règle partagée : décrivez le changement à Kaby (Réglages).'); return; }
      const s = h.rule.selectorText.trim(), key = `rule|${h.file || h.styleId}|${s}|${prop}`, was = (pending.find((p) => p.key === key) || {}).beforeText ?? (h.add ? beforeText + ' ' + tx('(hérité)') : h.rule.style.getPropertyValue(prop));
      h.rule.style.setProperty(prop, after);
      const count = document.querySelectorAll(s).length;
      upsert(key, { type: 'rule', file: h.file, styleId: h.styleId, selector: s, prop, after, add: h.add, beforeText: was, tag: desc(el), count });
      if (!sel.told && count > 1) { sel.told = true; toast(F ? `Appliqué aux ${count} éléments « ${s} » : ils partagent le même style.` : `Applied to the ${count} “${s}” elements: they share the same style.`); }
    } else {
      const key = `${sel.id}|${prop}`, was = (pending.find((p) => p.key === key) || {}).beforeText ?? beforeText;
      el.style.setProperty(prop, after);
      upsert(key, { type: 'style', id: sel.id, prop, after, beforeText: was, tag: desc(el) });
    }
    syncUi(true);
  }
  // ---- « Réglages »: the inspector. The content first (words, picture, link), then two tabs of folding sections. ----
  // Every field writes through sty(): on the element itself, or on the shared rule when « Tous les pareils » is chosen.
  const insp = { tab: 'style', open: new Set(['colors', 'pad']), link: {} };
  const SIDES = [['top', 'Haut'], ['right', 'Droite'], ['bottom', 'Bas'], ['left', 'Gauche']];
  const CHECK = 'repeating-conic-gradient(#bbb 0 25%, #fff 0 50%) 0 0/8px 8px';
  const LEN = /^-?(\d+\.?\d*|\.\d+)(px|%|rem|em|vw|vh)?$/i;
  const TIP = {
    color: 'Couleur du texte', 'background-color': 'Couleur de fond du bloc', 'border-color': 'Couleur du trait autour du bloc',
    'font-family': 'Police de caractères : celle de la page, sans empattement, avec empattement ou à chasse fixe',
    'font-size': 'Taille du texte, en pixels', 'line-height': 'Interligne, en multiple de la taille du texte : 1,5 = une fois et demie',
    'letter-spacing': 'Espace entre les lettres, en pixels (0 = normal)', 'font-weight': 'Épaisseur des traits : Normal = 400, Gras = 700',
    'text-align': 'Alignement du texte dans son bloc', 'font-style': 'Italique', 'text-decoration': 'Souligné', 'text-transform': 'Tout en majuscules',
    'border-width': 'Épaisseur du trait autour du bloc, en pixels (0 = pas de trait)', 'border-radius': 'Arrondi des coins, en pixels (50% = rond)', 'border-style': 'Style du trait : plein, tirets ou points',
    display: 'Façon dont le bloc se range : bloc, ligne, flex (souple) ou grille', opacity: 'Opacité : 100 % = plein, 0 % = invisible', 'box-shadow': 'Ombre portée du bloc',
    padding: 'Marge intérieure : l\'espace entre le bord du bloc et son contenu, en pixels', margin: 'Marge extérieure : l\'espace autour du bloc, en pixels',
    width: 'Largeur, en pixels ou avec une unité (%, rem…). « auto » = automatique', height: 'Hauteur, en pixels ou avec une unité. « auto » = selon le contenu',
    'max-width': 'Largeur maximale, en pixels ou avec une unité. « none » = sans limite', 'min-height': 'Hauteur minimale, en pixels',
    'flex-direction': 'Sens de rangement : côte à côte (ligne) ou l\'un sous l\'autre (colonne)', gap: 'Espace entre les éléments rangés, en pixels',
    'align-items': 'Alignement des éléments sur l\'autre axe', 'justify-content': 'Répartition des éléments le long du sens de rangement',
  };
  const FAMILIES = [['system-ui, -apple-system, "Segoe UI", sans-serif', 'Sans empattement'], ['Georgia, "Times New Roman", serif', 'Avec empattement'], ['ui-monospace, "SF Mono", Menlo, Consolas, monospace', 'Chasse fixe']];
  const WEIGHTS = [['300', 'Mince'], ['400', 'Normal'], ['500', 'Moyen'], ['600', 'Demi-gras'], ['700', 'Gras'], ['800', 'Très gras']];
  const SHADOWS = [['none', 'Aucune'], ['0 1px 3px rgba(0,0,0,.15)', 'Légère'], ['0 4px 12px rgba(0,0,0,.18)', 'Moyenne'], ['0 12px 28px rgba(0,0,0,.28)', 'Forte']];
  const DISPLAYS = [['block', 'Bloc'], ['flex', 'Flex'], ['grid', 'Grille'], ['inline-block', 'Bloc en ligne'], ['inline', 'En ligne']];
  const BORDERS = [['none', 'Aucun'], ['solid', 'Plein'], ['dashed', 'Tirets'], ['dotted', 'Points']];
  const ALIGNS = [['stretch', 'Étirer'], ['flex-start', 'Début'], ['center', 'Centre'], ['flex-end', 'Fin'], ['baseline', 'Ligne de base']];
  const JUSTS = [['flex-start', 'Début'], ['center', 'Centre'], ['flex-end', 'Fin'], ['space-between', 'Espacé'], ['space-around', 'Réparti'], ['space-evenly', 'Égal']];
  const rnd = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
  const fam = (s) => { const n = (s.split(',')[0] || '').replace(/["']/g, '').trim(); return /^(-apple-system|system-ui|BlinkMacSystemFont|ui-sans-serif)$/i.test(n) ? 'Police du système' : n; };   // first name of a font stack
  const withCur = (opts, cur) => (!cur || opts.some(([v]) => v === cur) ? opts : [...opts, [cur, cur]]);
  // what was typed, as a CSS value (null = not valid, nothing is applied)
  function parseVal(kind, raw, d) {
    const v = raw.trim();
    if (kind === 'len') { if (v[0] === '-' && !d.neg) return null; if (LEN.test(v)) return /[a-z%]$/i.test(v) ? v : v + 'px'; return d.kw && d.kw.split(',').includes(v) ? v : null; }
    if (kind === 'num') return /^(\d+\.?\d*|\.\d+)$/.test(v) ? v : null;
    if (kind === 'hex') { const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v); return m ? '#' + (m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1]).toLowerCase() : null; }
    return null;
  }
  // a border width alone shows nothing while the border has no style
  function applyCss(prop, value) {
    if (!sel) return;
    if (prop === 'border-width' && parseFloat(value) > 0 && getComputedStyle(sel.el).borderTopStyle === 'none') {
      sty('border-style', 'solid');
      const s = pop.querySelector('[data-css="border-style"]'); if (s) s.value = 'solid';
    }
    sty(prop, value);
  }
  function swapImage() {
    return pickImage().then((img) => {
      if (!img) return;
      const was = pending.find((p) => p.key === `${sel.id}|attr|src`);
      setAttr('src', img.src);
      if (!sel.fresh) { const k = `${sel.id}|attr|src`, p = pending.find((x) => x.key === k); if (p) p.uploads = [...new Set([...(was ? was.uploads || [] : []), ...(img.uploaded ? [img.src] : [])])]; persist(); }
      else { const op = addOp(sel.el.closest('[data-ky-new="add"]')); if (op && img.uploaded) { op.uploads = [...(op.uploads || []), img.src]; persist(); } }
      if (!(sel.el.getAttribute('alt') || '').trim() && img.alt) setAttr('alt', img.alt);
      fillPop(); toast('Image remplacée');
    });
  }
  function fillPop() {
    const el = sel.el, cs = getComputedStyle(el), keepTop = pop.scrollTop, tag = el.tagName.toLowerCase();
    const canStyle = sel.fresh || (!sel.isNew && !sel.inNew), editable = sel.own || sel.fresh, canM = sel.sid != null;
    const h = canStyle && !sel.fresh ? findRule(el, 'color') : null, count = h ? document.querySelectorAll(h.rule.selectorText).length : 0;
    const raw = (p) => (el.style.getPropertyValue(p) || cs.getPropertyValue(p)).trim(), px = (p) => raw(p).replace(/px$/, '');
    const T = (p, t) => attr(t || TIP[p] || '');
    // one field of each kind: a length, a plain number, a colour, a menu, a row of choices, a toggle
    const len = (p, tg, o = {}) => `<label class="pill" title="${T(p, o.title)}"><span class="pt">${tg}</span><input type="text" data-css="${p}" data-kind="len"${o.neg ? ' data-neg="1"' : ''}${o.kw ? ` data-kw="${o.kw}"` : ''} value="${attr(o.val ?? px(p))}" spellcheck="false" autocomplete="off"></label>`;
    const col = (p, label, read = p) => { const c = parseColor(cs.getPropertyValue(read)), clear = c.a === 0; return `<div class="cf" title="${T(p)}"><label class="cs" style="background:${clear ? CHECK : c.hex}"><input type="color" data-css="${p}" data-kind="color" value="${c.hex}"></label><span class="pt">${label}</span><input type="text" data-css="${p}" data-kind="hex" value="${clear ? '' : c.hex}" placeholder="${clear ? 'aucune' : ''}" spellcheck="false" autocomplete="off"></div>`; };
    const menu = (p, label, opts, cur) => `<label class="fld" title="${T(p)}"><span class="pt">${label}</span><select data-css="${p}" data-kind="sel">${opts.map(([v, l]) => `<option value="${attr(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
    const seg = (p, items, cur) => `<span class="seg" data-seg="${p}">${items.map(([v, c, t]) => `<button data-v="${attr(v)}" title="${attr(t)}"${v === cur ? ' class="on"' : ''}>${c}</button>`).join('')}</span>`;
    const tog = (p, onV, offV, isOn, c, t) => `<button${isOn ? ' class="on"' : ''} data-tog="${p}" data-on="${onV}" data-off="${offV}" title="${attr(t)}">${c}</button>`;
    const acc = (key, title, tip, body) => `<div class="acc${insp.open.has(key) ? ' open' : ''}"><button class="acc-h" data-acc="${key}" title="${attr(tip)}"><span>${title}</span>${IC.chev}</button><div class="acc-b">${body}</div></div>`;
    const sides = (base) => {
      const linked = insp.link[base] ?? SIDES.every(([s]) => px(`${base}-${s}`) === px(`${base}-top`)), o = base === 'margin' ? { neg: true, kw: 'auto' } : {};
      return `<div class="sub"><span>${linked ? 'Les quatre côtés ensemble' : 'Chaque côté séparément'}</span><button class="sm${linked ? ' on' : ''}" data-link="${base}" title="${linked ? 'Séparer : un réglage par côté' : 'Lier : un seul réglage pour les quatre côtés'}">${IC.link}</button></div>`
        + (linked ? `<div class="g2 one">${len(base, 'Tous', { ...o, val: px(`${base}-top`) })}</div>` : `<div class="g2">${SIDES.map(([s, l]) => len(`${base}-${s}`, l, { ...o, title: `${TIP[base]} (${l.toLowerCase()})` })).join('')}</div>`);
    };

    // -- content: the words, the picture, the link --
    const nodes = sel.gen && sel.src !== 'ok' ? [] : (sel.snap || []);
    const textUi = nodes.length === 1
      ? `<div class="blk"><span class="cl">Contenu du texte</span><textarea id="p-text" title="Les mots de cet élément. Ce que vous écrivez ici apparaît aussitôt sur la page." rows="2">${esc(nodes[0].n.nodeValue.trim())}</textarea></div>`
      : nodes.length > 1 ? '<div class="note">Ce bloc contient plusieurs textes : cliquez dans le texte, sur la page, pour les changer.</div>' : '';
    const imgUi = tag === 'img' && editable ? `<div class="blk"><div class="row" style="margin:0 0 6px"><button id="p-swap" class="primary" title="Choisir une autre image dans vos fichiers">Remplacer…</button><label class="fld" style="width:132px" title="Largeur de l'image : automatique ou une part de la largeur du bloc"><span class="pt">Largeur</span><select id="p-width" data-kind="width">${['auto', '25%', '50%', '75%', '100%'].map((w) => `<option value="${w}"${(el.style.width || 'auto') === w ? ' selected' : ''}>${w === 'auto' ? 'Auto' : w}</option>`).join('')}</select></label></div><span class="cl">Description (pour qui ne voit pas l'image)</span><input type="text" id="p-alt" value="${attr(el.getAttribute('alt') || '')}" title="Lue par les lecteurs d'écran, affichée si l'image ne charge pas"></div>` : '';
    const linkUi = tag === 'a' && editable ? `<div class="blk"><span class="cl">Adresse du lien</span><input type="text" id="p-href" value="${attr(el.getAttribute('href') || '')}" placeholder="https://…" title="Où mène le lien : https://…, mailto:… ou #ancre"></div>` : '';
    const note = sel.fresh || sel.isNew ? 'Ajouté pendant cette session : tout se modifie.'
      : !sel.gen ? ''
      : sel.src === 'checking' ? 'Je cherche d\'où vient ce texte…'
      : sel.src === 'ok' ? (F ? `Ce texte est écrit dans ${sel.srcFiles.join(', ')} (${sel.srcN} endroit${sel.srcN > 1 ? 's' : ''}) : le changer change ce fichier.` : `This text is written in ${sel.srcFiles.join(', ')} (${sel.srcN} place${sel.srcN > 1 ? 's' : ''}): changing it changes that file.`)
      : sel.hasText ? 'Ce texte est composé par la page : il ne se change pas ici. Les couleurs, la taille et la mise en page, oui ; pour le texte, décrivez le changement à Kaby ci-dessus.'
      : 'Élément fabriqué par la page : un changement de style vaut pour tous les éléments pareils.';
    const scopeUi = !canStyle ? '<div class="note">Enregistrez d\'abord cette copie pour pouvoir changer son style.</div>'
      : !h ? '' : sel.own
        ? `<div class="blk"><span class="cl">Appliquer les changements à</span><span class="seg full" id="p-scope" title="Cet élément seulement, ou tous ceux qui partagent le même style dans le fichier">${[['element', 'Cet élément'], ['rule', `Tous les pareils (${count})`]].map(([k, l]) => `<button data-s="${k}" title="${k === 'element' ? 'Seul cet élément change (le style est écrit sur lui)' : 'Tous les éléments qui ont le même style changent (la règle partagée est modifiée)'}"${scope === k ? ' class="on"' : ''}>${l}</button>`).join('')}</span></div>`
        : `<div class="note">Cet élément est fabriqué par la page : un changement de style vaut pour les <b>${count}</b> éléments du même type.</div>`;

    // -- the Style tab --
    const bgClear = parseColor(cs.backgroundColor).a === 0, fs = parseFloat(cs.fontSize), fw = String(parseInt(cs.fontWeight, 10));
    const al = cs.textAlign === 'end' ? 'right' : /^(center|right|justify)$/.test(cs.textAlign) ? cs.textAlign : 'left';
    let lh = raw('line-height'); lh = /^[\d.]+$/.test(lh) ? lh : lh === 'normal' ? '' : String(rnd(parseFloat(lh) / (fs || 16)));
    const bw = parseFloat(cs.borderTopWidth) || 0, bs = cs.borderTopStyle, br = parseFloat(cs.borderTopLeftRadius) || 0, dsp = cs.display, op = Math.round((parseFloat(cs.opacity) || 0) * 100);
    const styleTab = [
      acc('colors', 'Couleurs', 'Couleur du texte et du fond', `<div class="g2">${col('color', 'Texte')}${col('background-color', 'Fond')}</div><label class="chk" title="Retire la couleur de fond : on voit ce qu'il y a derrière"><input type="checkbox" data-nobg="1"${bgClear ? ' checked' : ''}> Sans couleur de fond</label>`),
      acc('typo', 'Typographie', 'Police, taille, interligne, graisse, alignement', `
        <div class="fldr">${menu('font-family', 'Police', [['', fam(cs.fontFamily) + ' (actuelle)'], ...FAMILIES], '')}</div>
        <div class="fldr">${menu('font-weight', 'Graisse', withCur(WEIGHTS, fw), fw)}</div>
        <div class="g2">${len('font-size', 'Taille', { val: String(rnd(fs, 1)) })}<label class="pill" title="${T('line-height')}"><span class="pt">Interligne</span><input type="text" data-css="line-height" data-kind="num" value="${attr(lh)}" placeholder="auto" spellcheck="false" autocomplete="off"></label></div>
        <div class="g2 one">${len('letter-spacing', 'Espace entre les lettres', { neg: true, kw: 'normal', val: cs.letterSpacing === 'normal' ? '0' : px('letter-spacing') })}</div>
        <div class="srow"><span class="pt">Alignement</span>${seg('text-align', [['left', IC.left, 'À gauche'], ['center', IC.center, 'Centré'], ['right', IC.right, 'À droite'], ['justify', IC.justify, 'Justifié']], al)}</div>
        <div class="srow"><span class="pt">Mise en forme</span><span class="tgs">${tog('font-style', 'italic', 'normal', cs.fontStyle === 'italic', '<i style="font-family:Georgia,serif">I</i>', 'Italique')}${tog('text-decoration', 'underline', 'none', (cs.textDecorationLine || '').includes('underline'), '<u>S</u>', 'Souligné')}${tog('text-transform', 'uppercase', 'none', cs.textTransform === 'uppercase', 'AA', 'Tout en majuscules')}</span></div>`),
      acc('border', 'Bordure', 'Trait autour du bloc et coins arrondis', `
        <div class="g2">${len('border-width', 'Trait', { val: String(bw) })}${len('border-radius', 'Coins', { val: String(br) })}</div>
        <div class="fldr">${menu('border-style', 'Style', withCur(BORDERS, bs), bs)}</div>
        <div class="g2 one">${col('border-color', 'Couleur', 'border-top-color')}</div>`),
      acc('disp', 'Affichage', 'Façon de ranger le bloc, transparence, ombre', `
        <div class="fldr">${menu('display', 'Affichage', withCur(DISPLAYS, dsp), dsp)}</div>
        <div class="fldr rng" title="${T('opacity')}"><span class="pt">Opacité</span><input type="range" min="0" max="100" step="1" value="${op}" data-css="opacity" data-kind="range"><output>${op}%</output></div>
        <div class="fldr">${menu('box-shadow', 'Ombre', cs.boxShadow === 'none' ? SHADOWS : [['', 'Actuelle'], ...SHADOWS], cs.boxShadow === 'none' ? 'none' : '')}</div>`),
    ].join('');

    // -- the Mise en page tab --
    const flexy = /flex|grid/.test(dsp), ai = cs.alignItems === 'normal' ? 'stretch' : cs.alignItems, jc = cs.justifyContent === 'normal' ? 'flex-start' : cs.justifyContent;
    const layoutTab = [
      canM ? acc('pos', 'Position', 'Monter ou descendre le bloc parmi ses voisins', `<div class="row" style="margin:0"><button class="line" id="p-up" title="Passer avant le bloc précédent">${IC.up}Monter</button><button class="line" id="p-down" title="Passer après le bloc suivant">${IC.down}Descendre</button></div>`) : '',
      acc('pad', 'Marge intérieure', TIP.padding, sides('padding')),
      acc('mar', 'Marge extérieure', TIP.margin, sides('margin')),
      acc('dim', 'Dimensions', 'Largeur et hauteur du bloc', `<div class="g2">${len('width', 'Largeur', { kw: 'auto' })}${len('height', 'Hauteur', { kw: 'auto' })}</div><div class="g2">${len('max-width', 'Larg. max', { kw: 'none' })}${len('min-height', 'Haut. min')}</div>`),
      flexy ? acc('flex', 'Disposition', 'Comment les éléments contenus se rangent', `
        ${/flex/.test(dsp) ? `<div class="srow"><span class="pt">Sens</span>${seg('flex-direction', [['row', 'Ligne', 'Côte à côte'], ['column', 'Colonne', 'L\'un sous l\'autre']], cs.flexDirection.startsWith('column') ? 'column' : 'row')}</div>` : ''}
        <div class="g2 one">${len('gap', 'Espace', { kw: 'normal', val: /normal/.test(cs.rowGap) ? '0' : String(rnd(parseFloat(cs.rowGap), 1)) })}</div>
        <div class="fldr">${menu('align-items', 'Alignement', withCur(ALIGNS, ai), ai)}</div>
        <div class="fldr">${menu('justify-content', 'Répartition', withCur(JUSTS, jc), jc)}</div>`) : '',
    ].join('');

    pop.innerHTML = `
      <div class="ihead"><input type="text" id="p-intent" placeholder="Décrire un changement (pour Kaby)" title="Dites en une phrase ce que vous voulez changer, puis Entrée : la demande va dans la liste et part vers Kaby avec « Enregistrer »." autocomplete="off"><button id="p-x" class="sm" title="Fermer les réglages">${IC.close}</button></div>
      <div class="pbody">${textUi}${imgUi}${linkUi}${note ? `<div class="note blk">${esc(note)}</div>` : ''}
        <div class="tabs">${[['style', 'Style', 'Couleurs, texte, bordure, affichage'], ['layout', 'Mise en page', 'Marges, taille, position, disposition']].map(([k, l, t]) => `<button data-tab="${k}" title="${t}"${insp.tab === k ? ' class="on"' : ''}>${l}</button>`).join('')}</div>
        ${scopeUi}${insp.tab === 'style' ? styleTab : layoutTab}</div>`;
    const up = pop.querySelector('#p-up'), down = pop.querySelector('#p-down');
    if (up) { up.disabled = !sibling(el, -1); down.disabled = !sibling(el, 1); }
    pop.scrollTop = keepTop;
  }
  // Written once: the events of the inspector are caught on the panel itself, whatever it holds now.
  function wirePop() {
    const textInput = (ta) => {
      const g = (sel.gen ? sel.gsnap : sel.snap || [])[0]; if (!g) return;
      if (g.lead === undefined) { g.lead = g.n.nodeValue.match(/^\s*/)[0]; g.trail = g.n.nodeValue.match(/\s*$/)[0]; }
      g.n.nodeValue = g.lead + ta.value.replace(/\n/g, ' ') + g.trail; syncText(); syncUi(true);
    };
    pop.addEventListener('input', (e) => {
      const t = e.target, k = t.dataset.kind; if (!sel) return;
      if (t.id === 'p-text') return textInput(t);
      if (t.id === 'p-alt') return setAttr('alt', t.value);
      if (t.id === 'p-href') { const v = t.value.trim(); if (/^(https?:\/\/[^\s"'<>]+|mailto:[^\s"'<>]+|#[\w-]*)$/i.test(v) || /^(?!\/\/)(?![a-z][a-z0-9+.-]*:)[\w./%~-][\w./%~?&=#,+-]*$/i.test(v)) { t.classList.remove('bad'); t.style.outline = ''; setAttr('href', v); } else t.style.outline = '2px solid #b45309'; return; }
      if (!k || t.tagName === 'SELECT') return;
      const p = t.dataset.css;
      if (k === 'color') {
        applyCss(p, t.value); const row = t.closest('.cf'), hx = row.querySelector('[data-kind=hex]');
        row.querySelector('.cs').style.background = t.value; hx.value = t.value; hx.classList.remove('bad');
        if (p === 'background-color') pop.querySelector('[data-nobg]').checked = false;
      } else if (k === 'range') { t.nextElementSibling.textContent = t.value + '%'; applyCss(p, String(rnd(t.value / 100))); }
      else {
        if (!t.value.trim()) { t.classList.remove('bad'); return; }
        const v = parseVal(k, t.value, t.dataset); t.classList.toggle('bad', v === null);
        if (v === null) return;
        applyCss(p, v);
        if (k === 'hex') { const row = t.closest('.cf'); row.querySelector('.cs').style.background = v; row.querySelector('[data-kind=color]').value = v; if (p === 'background-color') pop.querySelector('[data-nobg]').checked = false; }
      }
    });
    pop.addEventListener('change', (e) => {
      const t = e.target; if (!sel) return;
      if (t.dataset.nobg) {
        const c = parseColor(getComputedStyle(sel.el).backgroundColor); if (c.a) sel.bgWas = c.hex;
        applyCss('background-color', t.checked ? 'transparent' : (sel.bgWas || '#ffffff')); fillPop();
      } else if (t.dataset.kind === 'width') { scope = 'element'; sty('width', t.value); }
      else if (t.dataset.kind === 'sel' && t.value !== '') { applyCss(t.dataset.css, t.value); if (t.dataset.css === 'display') { fillPop(); dockPop(); } }
    });
    pop.addEventListener('keydown', (e) => {
      if (e.target.id !== 'p-intent' || e.key !== 'Enter') return;
      const t = e.target.value.trim(); if (!t || !sel) return;
      upsert('i' + Date.now(), { type: 'intent', id: sel.own ? sel.id : sel.ancId, locked: !sel.own, tag: desc(sel.el), text: t }); e.target.value = '';
      toast('Ajoutée à la liste. Elle part vers Kaby avec « Enregistrer ».');
    });
    pop.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b || !sel) return;
      const d = b.dataset;
      if (b.id === 'p-x') { pop.hidden = true; }
      else if (b.id === 'p-up') moveSel(-1);
      else if (b.id === 'p-down') moveSel(1);
      else if (b.id === 'p-swap') swapImage();
      else if (d.tab) { insp.tab = d.tab; fillPop(); dockPop(); }
      else if (d.acc) { if (insp.open.has(d.acc)) insp.open.delete(d.acc); else insp.open.add(d.acc); b.parentElement.classList.toggle('open'); dockPop(); }
      else if (d.link) { insp.link[d.link] = !b.classList.contains('on'); fillPop(); dockPop(); }
      else if (d.s) { scope = d.s; b.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); }
      else if (d.v !== undefined && b.parentElement.dataset.seg) { applyCss(b.parentElement.dataset.seg, d.v); b.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); }
      else if (d.tog) { const now = !b.classList.contains('on'); applyCss(d.tog, now ? d.on : d.off); b.classList.toggle('on', now); }
    });
  }
  // The settings are a side panel, on the side the chosen element is not (a phone has no side: under the toolbar).
  function dockPop() {
    if (pop.hidden || !sel) return;
    const vw = document.documentElement.clientWidth, floor = bar.getBoundingClientRect().top - 8, w = Math.min(320, vw - 16);
    pop.style.width = w + 'px';
    const t = tb.getBoundingClientRect(), r = sel.el.getBoundingClientRect();
    if (vw < 720) {   // a phone: a sheet over the half of the screen where the element is not
      pop.style.maxHeight = Math.max(160, Math.min(innerHeight * 0.48, floor - 16)) + 'px'; pop.style.overflowY = 'auto';
      const low = r.top + r.height / 2 > innerHeight / 2;
      Object.assign(pop.style, { left: (vw - w) / 2 + 'px', top: (low ? 8 : floor - pop.offsetHeight) + 'px', transform: 'none' });
      return;
    }
    const rightFree = t.right <= vw - w - 24, leftFree = t.left >= w + 24;
    const right = rightFree !== leftFree ? rightFree : r.left + r.width / 2 <= vw / 2;
    pop.style.maxHeight = Math.max(160, floor - 16) + 'px'; pop.style.overflowY = 'auto';
    Object.assign(pop.style, { left: (right ? vw - w - 16 : 16) + 'px', top: '16px', transform: 'none' });
  }

  // ---- drawing: selection frame, floating toolbar ----
  function boxAt(box, el) {
    if (!el || el.nodeType !== 1 || !el.isConnected) { box.style.display = 'none'; return; }
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  }
  function syncUi(valuesOnly) {
    if (!sel || !sel.el.isConnected) { if (sel) deselect(); return; }
    const el = sel.el, cs = getComputedStyle(el), canStyle = sel.fresh || (!sel.isNew && !sel.inNew);
    selb.classList.toggle('locked', !!sel.gen && sel.src === 'none' && sel.hasText);
    boxAt(selb, el);
    tb.style.display = 'flex';
    // What it is, and where its words come from, is a tag on the frame, not a label in the toolbar (it would look like a field to type in).
    const status = sel.fresh || sel.isNew ? 'nouveau' : !sel.gen ? '' : sel.src === 'checking' ? '…' : sel.src === 'ok' ? 'données' : sel.hasText ? 'composé' : 'généré', nm = nice(el);
    if (chip.dataset.t !== nm + '|' + status) { chip.dataset.t = nm + '|' + status; chip.innerHTML = `<b>${esc(nm)}</b>${status ? `<i>${status}</i>` : ''}`; }
    $('#b-more').classList.toggle('on', !pop.hidden);
    const canM = sel.sid != null;
    $('#b-grip').disabled = !canM; $('#b-dup').disabled = !canM; $('#b-del').disabled = !canM;
    const par = el.parentElement; $('#b-par').disabled = !par || par === document.body || par === document.documentElement;
    $('#b-txt').disabled = !canStyle;
    $('#sw-color').classList.toggle('dis', !canStyle); $('#sw-bg').classList.toggle('dis', !canStyle);
    const c = parseColor(cs.color), bg = parseColor(cs.backgroundColor);
    $('#b-color').value = c.hex; $('#sw-color .bar').style.background = c.hex;
    $('#b-bg').value = bg.hex; $('#sw-bg .bar').style.background = bg.a === 0 ? 'repeating-conic-gradient(#bbb 0 25%, #fff 0 50%) 0 0/6px 6px' : bg.hex;
    // above the tag, or below the element when there is no room; the tag goes inside the frame when the element touches the top
    const r = el.getBoundingClientRect(), w = tb.offsetWidth, h = tb.offsetHeight, tagOut = r.top >= 28;
    selb.classList.toggle('in', !tagOut);
    let top = r.top - h - (tagOut ? 30 : 10); if (top < 8) top = Math.min(r.bottom + 10, innerHeight - h - 8);
    const vw = document.documentElement.clientWidth;   // without the page's scrollbar
    Object.assign(tb.style, { left: Math.min(Math.max(8, r.left), Math.max(8, vw - w - 8)) + 'px', top: Math.max(8, top) + 'px' });
    if (!valuesOnly) { if (!pop.hidden) dockPop(); if (!txtpop.hidden) placeBelow(txtpop, tb); }
  }
  setInterval(() => { themeSync(); if (on && sel) syncUi(true); }, 250);
  addEventListener('scroll', () => { if (on && sel) syncUi(true); }, true);
  addEventListener('resize', () => { closePops(); if (on && sel) syncUi(true); });   // a panel opened at the old size would stay where it was

  // ---- drag a block (by its grip, or by its body when it is not a text) onto another one ----
  function dropAt(e) {
    let t = document.elementFromPoint(e.clientX, e.clientY);
    if (!t || t === host) return null;
    const direct = own(t);
    t = nearest(t);
    if (!t || (sel && sel.el.contains(t))) return null;
    const mk = (n, where) => ({ ref: idOf(n), refEl: n, where, rect: n.getBoundingClientRect() });
    const chain = [];   // t and its ancestors that exist in the file, biggest first
    for (let n = t; n && n.nodeType === 1; n = n.parentElement) if (own(n) && !NOSTRUCT.has(n.tagName.toLowerCase())) chain.unshift(n);
    for (const n of chain) {   // the edge of a big block wins over what is inside it: that is how a section is dropped between two sections
      const r = n.getBoundingClientRect(), band = Math.min(10, r.height * 0.25);
      if (e.clientY - r.top < band) return mk(n, 'before');
      if (r.bottom - e.clientY < band) return mk(n, 'after');
    }
    const tag = t.tagName.toLowerCase(), r = t.getBoundingClientRect(), y = (e.clientY - r.top) / (r.height || 1);
    if (NOSTRUCT.has(tag)) return null;
    const where = direct && !VOIDS.has(tag) && r.height > 28 && y > 0.25 && y < 0.75 ? 'inside' : y < 0.5 ? 'before' : 'after';
    return mk(t, where);
  }
  function showDrop(dp) {
    if (!dp) { dropBox.style.display = 'none'; return; }
    const r = dp.rect;
    dropBox.classList.toggle('line', dp.where !== 'inside');
    const top = dp.where === 'before' ? r.top - 2 : dp.where === 'after' ? r.bottom - 2 : r.top, height = dp.where === 'inside' ? r.height : 4;
    Object.assign(dropBox.style, { display: 'block', left: r.left + 'px', width: r.width + 'px', top: top + 'px', height: height + 'px' });
  }

  // ---- the page's own events: while editing, a click chooses instead of acting ----
  const swallowAll = ['mousedown', 'mouseup', 'dblclick', 'pointerdown', 'pointerup', 'touchstart', 'submit', 'contextmenu'];
  function wirePage() {
    document.addEventListener('mousemove', (e) => {
      if (dr) {
        if (e.buttons === 0) { dr = null; showDrop(null); rootEl().classList.remove('dragging'); return; }
        if (!dr.on) { if (Math.hypot(e.clientX - dr.x, e.clientY - dr.y) < 6) return; dr.on = true; rootEl().classList.add('dragging'); if (dr.kind) insm.hidden = true; }
        hov.style.display = 'none'; dr.drop = dropAt(e); showDrop(dr.drop); return;
      }
      if (!on || e.target === host) return;
      const t = e.target; if (t.nodeType !== 1 || t === document.body || t === document.documentElement) { hov.style.display = 'none'; return; }
      if (sel && t === sel.el) { hov.style.display = 'none'; return; }   // the chosen one already has its frame and its toolbar
      boxAt(hov, t); hovTag.textContent = nice(t) + (own(t) ? '' : ' · ' + tx('généré'));
    }, true);
    document.addEventListener('mouseleave', () => { if (hov) hov.style.display = 'none'; }, true);
    document.addEventListener('mouseup', () => {
      if (!dr) return; const x = dr; dr = null; showDrop(null); rootEl().classList.remove('dragging');
      if (!x.on) return;
      swallow = true; setTimeout(() => { swallow = false; }, 0);
      if (x.kind) { const t = x.drop ? { el: x.drop.refEl, ref: x.drop.ref, where: x.drop.where, refTag: desc(x.drop.refEl) } : target(); insert(x.kind, t); return; }   // a block dragged from « Insérer »
      if (x.drop && sel && sel.sid != null) keep(stage({ op: 'move', id: sel.sid, ref: x.drop.ref, where: x.drop.where, tag: desc(sel.el), refTag: desc(x.drop.refEl) }));
    }, true);
    document.addEventListener('click', (e) => {
      if (!on || e.target === host) return;
      e.preventDefault(); e.stopPropagation();
      if (swallow || (sel && sel.editing && e.target === sel.el)) return;   // a click inside the text being typed only moves the caret
      select(e.target, e);
    }, true);
    document.addEventListener('mousedown', (e) => {
      if (!on || e.target === host) return;
      e.stopPropagation();
      if (e.button !== 0 || !sel || sel.sid == null || sel.editing || !sel.el.contains(e.target)) return;
      dr = { x: e.clientX, y: e.clientY, on: false, drop: null }; e.preventDefault();   // not a text: its body is its handle
    }, true);
    for (const t of swallowAll) if (t !== 'mousedown') document.addEventListener(t, (e) => { if (on && e.target !== host) { e.stopPropagation(); if (t === 'submit' || t === 'contextmenu') e.preventDefault(); } }, true);
    // a picture dropped from the desktop or pasted lands as an Image block
    const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    document.addEventListener('dragstart', (e) => { if (on && e.target !== host) e.preventDefault(); }, true);   // a picture of the page is moved with the grip, never dragged out natively (it would come back in as a "dropped file")
    document.addEventListener('dragover', (e) => { if (!on || !hasFiles(e)) return; e.preventDefault(); hov.style.display = 'none'; showDrop(dropAt(e)); }, true);
    document.addEventListener('dragleave', (e) => { if (e.relatedTarget === null) showDrop(null); }, true);
    document.addEventListener('drop', (e) => {
      if (!on || !hasFiles(e)) return;
      e.preventDefault(); e.stopPropagation(); showDrop(null);
      const files = [...e.dataTransfer.files].filter(isImg);
      if (!files.length) { toast('Seules les images PNG, JPEG, GIF et WebP peuvent être déposées.'); return; }
      const d = dropAt(e), t = d ? { el: d.refEl, ref: d.ref, where: d.where, refTag: desc(d.refEl) } : target();
      if (t) insertFiles(files, t);
    }, true);
    document.addEventListener('paste', (e) => {
      if (!on) return;
      const files = [...((e.clipboardData && e.clipboardData.files) || [])].filter(isImg);
      if (!files.length) return;
      e.preventDefault(); e.stopPropagation();
      const t = target(); if (t) insertFiles(files, t);
    }, true);
    // An edit that would reach past the text being typed (an icon, a link, another piece of text) is refused: it could not be written to the file the way it looks on the page.
    document.addEventListener('beforeinput', (e) => {
      if (!on || !sel || !sel.editing || sel.fresh || !sel.el.contains(e.target)) return;
      const own = new Set(sel.snap.map((x) => x.n)), sr = getSelection();
      const ranges = e.getTargetRanges ? e.getTargetRanges() : [];
      for (const t of ranges.length ? ranges : (sr.rangeCount ? [sr.getRangeAt(0)] : [])) {
        const r = document.createRange(); r.setStart(t.startContainer, t.startOffset); r.setEnd(t.endContainer, t.endOffset);
        const past = [...sel.el.childNodes].some((c) => !own.has(c) && !(c.nodeType === 3 && !c.nodeValue.trim()) && r.intersectsNode(c));
        if (past || sel.snap.filter((x) => r.intersectsNode(x.n)).length > 1) { e.preventDefault(); toast(tx('Sélectionnez un seul morceau de texte à la fois (pas les icônes ni les liens)')); return; }
      }
    }, true);
    document.addEventListener('input', (e) => { if (on && sel && sel.editing && sel.el.contains(e.target)) syncText(); }, true);
    // click a text and type; Esc leaves the text (the block stays chosen); then Suppr removes the block and Cmd/Ctrl+D copies it
    document.addEventListener('keydown', (e) => {
      if (!on || !sel || e.target === host) return;
      if (sel.editing) { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); stopEdit(); } return; }
      if (e.key === 'Escape') { deselect(); return; }
      if (sel.sid == null) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); askDelete(); }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); dupSel(); }
    }, true);
  }

  // ---- list of what is waiting, save ----
  const FIELD = {
    color: 'couleur du texte', 'background-color': 'fond', 'font-family': 'police', 'font-size': 'taille', 'line-height': 'interligne', 'letter-spacing': 'espacement des lettres', 'font-weight': 'graisse',
    'font-style': 'italique', 'text-decoration': 'souligné', 'text-transform': 'majuscules', 'text-align': 'alignement', 'border-width': 'épaisseur du trait', 'border-style': 'style du trait',
    'border-color': 'couleur du trait', 'border-radius': 'arrondi', opacity: 'opacité', 'box-shadow': 'ombre', display: 'affichage', padding: 'marge intérieure', margin: 'marge extérieure',
    width: 'largeur', height: 'hauteur', 'max-width': 'largeur max', 'min-height': 'hauteur min', 'flex-direction': 'sens de rangement', gap: 'espace entre éléments', 'align-items': 'alignement', 'justify-content': 'répartition',
  };
  for (const [b, l] of [['padding', 'marge intérieure'], ['margin', 'marge extérieure']]) for (const [s, n] of [['top', 'haut'], ['right', 'droite'], ['bottom', 'bas'], ['left', 'gauche']]) FIELD[`${b}-${s}`] = `${tx(l)} ${tx(n)}`;
  for (const k of Object.keys(FIELD)) if (!/-(top|right|bottom|left)$/.test(k)) FIELD[k] = tx(FIELD[k]);
  function describe(p) {
    if (p.type === 'text') return `<b>${esc(p.tag)}</b>${COL}${tx('texte modifié')}`;
    if (p.type === 'srctext') return F ? `<b>${esc(p.tag)}</b>${COL}texte modifié dans les données (${esc((p.files || []).join(', '))}, ${p.places || 1} endroit${p.places > 1 ? 's' : ''})` : `<b>${esc(p.tag)}</b>: text changed in the data (${esc((p.files || []).join(', '))}, ${p.places || 1} place${p.places > 1 ? 's' : ''})`;
    if (p.type === 'style') return `<b>${esc(p.tag)}</b>${COL}${FIELD[p.prop] || esc(p.prop)} ${esc(p.beforeText || '?')} → ${esc(p.after)}`;
    if (p.type === 'rule') return `<b>${F ? 'Tous les « ' : 'All “'}${esc(p.selector)}${F ? ' »' : '”'}</b> (${p.count})${COL}${FIELD[p.prop] || esc(p.prop)} → ${esc(p.after)}`;
    if (p.type === 'struct') {
      const w = tx({ before: 'avant', after: 'après', inside: 'dans' }[p.where]);
      if (p.op === 'move') return `<b>${esc(p.tag)}</b> ${tx('déplacé')} ${w} <b>${esc(p.refTag)}</b>`;
      if (p.op === 'dup') return `<b>${esc(p.tag)}</b> ${tx('dupliqué')}`;
      if (p.op === 'del') return `<b>${esc(p.tag)}</b> ${tx('supprimé')}`;
      return `${F ? 'Ajout : ' : 'Added: '}${esc(String(p.label || p.kind).toLowerCase())}, ${w} <b>${esc(p.tag)}</b>`;
    }
    if (p.type === 'attr') return `<b>${esc(p.tag)}</b>${COL}${ATTR_LABEL[p.name] || esc(p.name)} → ${esc(p.after)}`;
    return `<b>${esc(p.tag)}</b> ${tx('pour Kaby')}${p.locked ? ' ' + tx('(élément généré)') : ''}${COL}${LQ}${esc(p.text)}${RQ}`;
  }
  function renderList() {
    list.innerHTML = (pending.length ? pending.map((p, i) => `<div class="it"><span>${describe(p)}</span><button data-i="${i}" title="Retirer ce changement de la liste">${IC.close}</button></div>`).join('') : '<div class="it k">Rien en attente.</div>')
      + `<div class="foot"><button id="l-undo" title="Remet le fichier tel qu'il était avant votre dernier enregistrement">Revenir avant le dernier enregistrement</button><button id="l-reset" title="Remet la page comme elle était avant le premier enregistrement de l'éditeur">Remettre la page d'origine</button></div>`;
    list.querySelectorAll('.it button').forEach((b) => (b.onclick = async () => { const [gone] = pending.splice(+b.dataset.i, 1); await dropUploads([gone], pending); await persist(); location.reload(); }));
    list.querySelector('#l-undo').onclick = () => confirmBox({ anchor: list, keepList: true, title: 'Revenir avant le dernier enregistrement ?', detail: 'Le fichier reprend son contenu d\'avant. Les changements en attente sont abandonnés.', ok: 'Revenir en arrière', danger: true, onOk: async () => {
      await dropUploads(pending, []); const r = await api('undo', {}); pending = [];
      await kv.set('toast', r.ok ? tx('Fichier remis comme avant le dernier enregistrement') : (r.error === 'no-snapshot' ? tx('Rien à annuler') : tx('Impossible de revenir en arrière : ') + (r.why || '')));
      await persist(); location.reload(); } });
    list.querySelector('#l-reset').onclick = () => confirmBox({ anchor: list, keepList: true, title: 'Remettre la page d\'origine ?', detail: 'La page reprend son contenu d\'avant le premier enregistrement de l\'éditeur : tous ses enregistrements sont perdus.', ok: 'Remettre la page d\'origine', danger: true, onOk: async () => {
      const r = await api('reset', {}); pending = [];
      await kv.set('toast', r.ok ? tx('Page d\'origine remise') : (r.error === 'no-snapshot' ? tx('Rien n\'a été enregistré par l\'éditeur : rien à remettre') : tx('Impossible de remettre l\'original : ') + (r.why || '')));
      await persist(); location.reload(); } });
  }
  async function save() {
    const patches = pending.filter((p) => p.type !== 'intent').map(({ key, beforeText, tag, refTag, count, label, uploads, places, files, ...rest }) => rest);
    const intents = pending.filter((p) => p.type === 'intent');
    if (!patches.length && !intents.length) { toast(tx('Rien à enregistrer')); return; }
    let r = { ok: true, applied: 0, errors: [], notes: [] };
    if (patches.length) {
      r = await api('apply', { body: { baseHash, baseFiles, patches } });
      if (!r.ok) { toast(r.error === 'stale' ? tx('La page a changé depuis son ouverture (Kaby ou vous). Rien n\'a été écrit : rechargez la maquette.') : tx('Refusé : ') + (r.why || '') + tx(' Rien n\'a été écrit.')); return; }
    }
    // what the person asked Kaby to do goes to the chat (written for them to read and send), never sent by itself
    if (intents.length) await bridge('ask', { items: intents.map((p) => ({ tag: p.tag, text: p.text, locked: !!p.locked })) });
    const bad = r.errors.length, ids = r.notes && r.notes.length;
    const msg = (patches.length ? (LANG === 'fr' ? `Enregistré : ${r.applied} changement${r.applied > 1 ? 's' : ''}` : `Saved: ${r.applied} change${r.applied > 1 ? 's' : ''}`) : '')
      + (bad ? (LANG === 'fr' ? ` · ${bad} refusé${bad > 1 ? 's' : ''} (${r.errors[0].why})` : ` · ${bad} refused (${r.errors[0].why})`) : '')
      + (ids ? tx(' · identifiant(s) renommé(s) dans la copie (elle n\'est pas reliée au script de la page)') : '')
      + (intents.length ? (patches.length ? ' · ' : '') + tx('Demande envoyée à Kaby : relisez-la dans la conversation') : '');
    await kv.set('toast', msg);
    await dropUploads(pending, []);   // pictures replaced before saving: the host removes the ones the saved page does not use
    pending = []; await persist(); location.reload();
  }

  async function init() {
    await kv.load();
    const h = await api('hash', {});
    if (!h || !h.ok) return;   // the host does not know this page (link expired): no editor, the page stays as it is
    baseHash = h.hash; baseFiles = h.files || {};
    const pal = await bridge('api', { op: 'blocks', lang: LANG }); palette = pal && pal.ok ? pal.blocks : [];
    const saved = store.get(); let msg = kv.get('toast');
    if (saved && saved.hash === baseHash) { pending = saved.pending || []; on = !!saved.on; }
    else if (saved) { on = !!saved.on; if (saved.pending && saved.pending.length) msg = tx('Le fichier a changé depuis : vos changements en attente ont été abandonnés.'); }
    kv.set('toast', null);
    buildUi(); wirePage(); replay(); setOn(on);
    addEventListener('resize', placePill); setTimeout(placePill, 700);   // the page may build its own top-right controls after load
    if (msg) toast(msg, 6000);
  }
  if (document.readyState === 'complete') init(); else addEventListener('load', init);
})();
