// ── Le siège des épingles dans le navigateur Workspaces du paquet DSH installé ─
// Le navigateur de la sidebar (`@deepseek-ai/dsh-client-ui-workspace`) n'offre
// aucune couture pour ajouter une section ni une entrée de menu de rangée : tout
// est interne au paquet. Ce script y pose donc le patch, de façon IDEMPOTENTE :
//
//   1. le bloc `kybernos:pins` (état client, CSS, icône, entrée de menu, section) ;
//   2. `Pin` / `Unpin` dans les deux menus de rangée (dossier et conversation) ;
//   3. la section « Pinned » rendue AVANT la liste des Workspaces ;
//   4. les libellés (en + zh) : Pin, Unpin, Pinned.
//
// L'état vient de l'hôte (`GET/POST /kybernos/pins`, fichier
// `~/.dsh/.kyber-pins.json`) : la sidebar n'écrit rien elle-même.
//
// À rejouer après chaque mise à jour de DSH (l'installation npm écrase le
// paquet), puis recharger la page de la GUI.
//
// DEUX FORMES DU BUNDLE, et pas une seule liste d'ancres :
//   · `0.1.6` — le menu de rangée est écrit sur place (`items: sessionMenuItems`,
//     `onSelect`), et la rangée reçoit `onRename` / `onFork` / `onArchive` ;
//   · `0.1.7` — le menu de conversation devient un SIÈGE
//     (`sidebar.workspaces.session.menu.item`) : la rangée reçoit
//     `onRenameRequest` + `renderSlot`, n'a plus ni `sessionMenuItems` ni
//     `onSelect`, et `Pin` y est déjà livré par DSH (voir le compte rendu).
// La forme est reconnue par une SONDE stable (elle survit à la pose), et chaque
// règle qui diffère dit sa variante dans `formes['0.1.7']`. Le robot de cycle de
// vie rejouant ce script APRÈS un retour arrière vers 0.1.6, les deux formes
// restent servies : aucune n'est remplacée en silence.
//
// Usage :
//   node scripts/patch-dsh-workspace-pins.mjs                # applique (idempotent)
//   node scripts/patch-dsh-workspace-pins.mjs --check        # vérifie, ne touche à rien
//   node scripts/patch-dsh-workspace-pins.mjs --revert       # retire le patch
//   node scripts/patch-dsh-workspace-pins.mjs --dsh <racine> # vise une autre installation
//
// Sortie : 0 = conforme après l'opération, 1 = écart (--check) ou échec.
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { racineDeclaree, resoudreCopie, refuserRacine, versionDuMoteur } from './racine-dsh.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const PKG = '@deepseek-ai/dsh-client-ui-workspace'
const CLIENT_REL = join('lib', 'client.js')
const BACKUP_SUFFIX = '.kybernos-pins.orig'

const args = process.argv.slice(2)
const CHECK = args.indexOf('--check') >= 0
const REVERT = args.indexOf('--revert') >= 0

// ── La racine DSH visée, et le paquet à patcher ─────────────────────────────
// `--dsh <racine>` est OBLIGATOIRE (voir racine-dsh.mjs) : FAIT FOI, sans repli
// sur l'installation globale — sinon un banc visé par erreur de frappe se ferait
// patcher en silence, et un « ✓ » vert mesurerait une autre copie que celle que
// DSH charge. La sonde `require.resolve` depuis le dépôt a été retirée pour la
// même raison (mesure du 23/09/2026).
const racine = racineDeclaree(args)
const resolution = resoudreCopie(racine, PKG)
if (resolution.copie === null) refuserRacine(resolution.motif, 'patch-dsh-workspace-pins.mjs')

/** La version du moteur visé : lue sur le moteur RÉSOLU, jamais devinée. */
const versionDsh = versionDuMoteur(resolution.moteur)

// ── Le bloc injecté : état client, CSS, icône, entrée de menu, section ───────
// Le code injecté vit dans scripts/dsh-pins-client.js (lisible et vérifiable à
// part) : il est inséré tel quel entre ses deux marqueurs kybernos:pins:begin/end.
const PINS_BLOCK = readFileSync(join(HERE, 'dsh-pins-client.js'), 'utf8').replace(/\n$/, '')

/** Les propriétés de la section, écrites au site de rendu (aucun hook hors du corps). */
const PINNED_SECTION_ELEMENT = [
  '(0, react_jsx_runtime.jsx)(PinnedSection, {',
  ' t: t, pins: pins, workspaces: orderedWorkspaces, list: list, useSessionStatus: useSessionStatus,',
  ' currentSessionId: mainSessionId, archivedSessionIds: archivedSessionIds, home: home,',
  ' startSession: startSession, onOpen: open, onFork: forkSession, onArchive: onSessionArchive, onRename: onSessionRename,',
  ' onRenameWorkspace: (workspaceId, title) => { setRenameTarget({ workspaceId, currentTitle: title }); setRenameDraft(title); setRenameError(null); },',
  ' onDeleteWorkspace: (workspaceId, title) => { setDeleteTarget({ workspaceId, title }); setDeleteError(null); }',
  '})',
].join('')

// En 0.1.7 le navigateur ne reçoit plus `forkSession` / `onSessionArchive` /
// `onSessionRename` : le fork et l'archivage sont devenus des sièges, et le
// renommage passe par `requestSessionRename`. La section ne peut donc plus
// recevoir que ce qui existe : l'ouverture gardée (`guardedOpen`, une Session
// archivée ne s'ouvre pas) et le renommage. Le fork/archivage des rangées
// épinglées y est perdu — il n'existe plus dans ce composant (voir compte rendu).
const PINNED_SECTION_ELEMENT_017 = [
  '(0, react_jsx_runtime.jsx)(PinnedSection, {',
  ' t: t, pins: pins, workspaces: orderedWorkspaces, list: list, useSessionStatus: useSessionStatus,',
  ' currentSessionId: mainSessionId, archivedSessionIds: archivedSessionIds, home: home,',
  // `SessionNodeItem` appelle `renderSlot` DEUX fois en 0.1.7 (menu + siège
  // `sidebar.workspaces.session.row.action`) et le second appel n'est pas gardé
  // côté DSH : monter la rangée épinglée sans ce prop faisait planter tout le
  // siège `sidebar.workspaces`. On le fait donc suivre, avec un repli inerte si
  // la portée ne l'expose pas (« typeof » ne lève jamais, même sur un
  // identifiant absent). En 0.1.6 ce prop n'existe pas : il n'est PAS ajouté à
  // la variante 0.1.6.
  ' renderSlot: typeof renderSlot === "function" ? renderSlot : function () { return null; },',
  // `pinnedSessionIds` : l'épinglage NATIF des conversations. La section s'en
  // sert pour l'APPARTENANCE (notre fichier ne porte plus que l'ordre) ; sans
  // lui — portée qui ne l'expose pas, ou 0.1.6 — elle retombe sur notre liste.
  ' pinnedSessionIds: typeof pinnedSessionIds === "undefined" ? void 0 : pinnedSessionIds,',
  ' startSession: startSession, onOpen: guardedOpen, onFork: void 0, onArchive: void 0, onRename: requestSessionRename,',
  ' onRenameWorkspace: (workspaceId, title) => { setRenameTarget({ workspaceId, currentTitle: title }); setRenameDraft(title); setRenameError(null); },',
  ' onDeleteWorkspace: (workspaceId, title) => { setDeleteTarget({ workspaceId, title }); setDeleteError(null); }',
  '})',
].join('')

// Le menu de conversation 0.1.7 : la rangée n'a plus d'`onSelect`, et son menu
// est la liste du siège `sidebar.workspaces.session.menu.item`. On rend la
// rangée « Pin » par les `items` du Menu (rendus AVANT les sièges, et DSH livre
// déjà un `pin` de son côté), et on garde `renderSlot` sous garde : la section
// « Pinned » monte la même rangée SANS `renderSlot` — sans cette garde elle
// planterait. Le renommage y est donc rendu ici même.
// On n'ajoute PLUS d'entrée « Pin » ici (décision du 22/09/2026 : « on garde
// leur système ») : le siège `sidebar.workspaces.session.menu.item` en fournit
// déjà une, native, et deux entrées homonymes entretenaient deux états — dont
// l'un ignorait les épingles de DSH. Notre section n'est donc plus peuplée que
// par `pinnedSessionIds` (voir `PinnedSection`). Il ne reste ici que le
// RENOMMAGE, perdu par la rangée 0.1.7.
const MENU_CONVERSATION_017 = [
  'items: [...(renderSlot === void 0 && onRename !== void 0 ? [{',
  ' id: "kyber-rename",',
  ' label: t("rename"),',
  ' icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEditOutlineRegular, {})',
  '}] : [])],',
  ' onSelect: (id) => {',
  ' if (id === "kyber-rename") { setMenuOpen(false); onRename(node.id, row.title); }',
  ' },',
  ' children: renderSlot === void 0 ? null : renderSlot("sidebar.workspaces.session.menu.item", {',
].join('')

/** Les deux lignes identiques posées sur chaque rangée de conversation. */
const SESSION_ROW_PIN_LINES = [
  'pinned: kyberPinsState.sessions.includes(node.id),',
  'onTogglePin: () => { kyberPinsToggle("session", node.id, !kyberPinsState.sessions.includes(node.id)); },',
]

const WORKSPACE_ROW_PIN_LINES = [
  'pinned: kyberPinsState.workspaces.includes(group.workspaceId),',
  'onTogglePin: group.workspaceId === void 0 ? void 0 : () => { kyberPinsToggle("workspace", group.workspaceId, !kyberPinsState.workspaces.includes(group.workspaceId)); },',
]

// ── La forme du bundle : deux sondes stables, choisies avant toute règle ─────
// Les sondes sont des PRÉFIXES de la signature de `SessionNodeItem` : elles
// survivent à la pose (on n'ajoute que des propriétés en fin de liste), donc
// `--check` et `--revert` retombent sur la même forme que la pose.
const SONDE_016 = 'function SessionNodeItem({ node, currentId, now, onOpen, onRename, onFork, onArchive, onReveal, drag, flat = false, t'
const SONDE_017 = 'function SessionNodeItem({ node, currentId, now, onOpen, onRenameRequest, renderSlot, onReveal, drag, flat = false, t'
// 0.1.7-rc.2 : `flat = false` disparaît de la signature de SessionNodeItem,
// et ProjectRowItem gère un raccourci `newShortcut` (l'appel arbre y insère
// `shortcuts.find((row) => row.id === "session.new")`).
const SONDE_RC2 = 'function SessionNodeItem({ node, currentId, now, onOpen, onRenameRequest, renderSlot, onReveal, drag, t'
const FORME_016 = '0.1.6'
const FORME_017 = '0.1.7'
const FORME_RC2 = '0.1.7-rc2'
const detecterForme = (texte) => {
  if (texte.indexOf(SONDE_RC2) >= 0) return FORME_RC2
  if (texte.indexOf(SONDE_017) >= 0) return FORME_017
  if (texte.indexOf(SONDE_016) >= 0) return FORME_016
  return null
}

// ── Les règles : chacune sait dire si elle est déjà posée, la poser, la retirer ─
// Une règle est décrite pour 0.1.6 ; `formes['0.1.7']` donne sa variante (mêmes
// clés que la règle, y compris `sansObjet` quand la fonction est portée par une
// autre règle dans cette forme).
const RULES = [
  {
    id: 'bloc-pins',
    kind: 'block',
    start: '/* kybernos:pins:begin',
    end: '/* kybernos:pins:end */',
    where: 'after',
    anchor: ['const EXPAND_SLIDE_MS = 300;'],
    stale: ['/* ── Épingles de la sidebar (kybernos:pins) ──'],
    lines: PINS_BLOCK.split('\n'),
  },
  {
    id: 'signature-rangee-dossier',
    kind: 'sub',
    old: 'function ProjectRowItem({ group, containsCurrentDescendant = false, onToggle, onCreate, actions, drag, home, t }) {',
    new: 'function ProjectRowItem({ group, containsCurrentDescendant = false, onToggle, onCreate, actions, drag, home, t, pinned = false, onTogglePin }) {',
    formes: {
      [FORME_RC2]: {
        old: 'function ProjectRowItem({ group, containsCurrentDescendant = false, onToggle, onCreate, actions, drag, home, newShortcut, t }) {',
        new: 'function ProjectRowItem({ group, containsCurrentDescendant = false, onToggle, onCreate, actions, drag, home, newShortcut, t, pinned = false, onTogglePin }) {',
      },
    },
  },
  {
    id: 'signature-rangee-conversation',
    kind: 'sub',
    old: 'function SessionNodeItem({ node, currentId, now, onOpen, onRename, onFork, onArchive, onReveal, drag, flat = false, t }) {',
    new: 'function SessionNodeItem({ node, currentId, now, onOpen, onRename, onFork, onArchive, onReveal, drag, flat = false, t, pinned = false, onTogglePin }) {',
    formes: {
      [FORME_017]: {
        // 0.1.7 : `onRename` devient `onRenameRequest`, `renderSlot` apparaît,
        // `onFork`/`onArchive` disparaissent de la rangée (sièges). La section
        // « Pinned » passe encore `onRename` : on l'accepte pour son renommage.
        old: 'function SessionNodeItem({ node, currentId, now, onOpen, onRenameRequest, renderSlot, onReveal, drag, flat = false, t }) {',
        new: 'function SessionNodeItem({ node, currentId, now, onOpen, onRenameRequest, renderSlot, onReveal, drag, flat = false, t, pinned = false, onTogglePin, onRename }) {',
      },
      [FORME_RC2]: {
        old: 'function SessionNodeItem({ node, currentId, now, onOpen, onRenameRequest, renderSlot, onReveal, drag, t }) {',
        new: 'function SessionNodeItem({ node, currentId, now, onOpen, onRenameRequest, renderSlot, onReveal, drag, t, pinned = false, onTogglePin, onRename }) {',
      },
    },
  },
  {
    id: 'menu-dossier-entree',
    kind: 'sub',
    old: 'const workspaceMenuItems = [{',
    new: 'const workspaceMenuItems = [...pinMenuItems(t, pinned, onTogglePin), {',
  },
  {
    id: 'menu-dossier-commentaire',
    kind: 'sub',
    old: '/* v8 ignore next -- Menu can emit only the rename and delete rows supplied above. */',
    new: '/* v8 ignore next -- Menu can emit only the pin, rename and delete rows supplied above. */',
  },
  {
    id: 'menu-dossier-selection',
    kind: 'insert',
    where: 'before',
    anchor: ['if (id !== "rename" && id !== "delete") return;'],
    lines: ['if (id === "pin") { if (onTogglePin !== void 0) onTogglePin(); return; }'],
  },
  {
    id: 'menu-conversation-entree',
    kind: 'sub',
    old: 'const sessionMenuItems = [',
    new: 'const sessionMenuItems = [...pinMenuItems(t, pinned, onTogglePin),',
    formes: {
      [FORME_017]: {
        old: 'children: renderSlot("sidebar.workspaces.session.menu.item", {',
        new: MENU_CONVERSATION_017,
      },
      [FORME_RC2]: {
        old: 'children: renderSlot("sidebar.workspaces.session.menu.item", {',
        new: MENU_CONVERSATION_017,
      },
    },
  },
  {
    id: 'menu-conversation-selection',
    kind: 'insert',
    where: 'before',
    anchor: ['if (id === "rename") onRename(node.id, row.title);'],
    lines: ['if (id === "pin") { if (onTogglePin !== void 0) onTogglePin(); return; }'],
    formes: {
      [FORME_017]: { sansObjet: 'menu-conversation-entree' },
      [FORME_RC2]: { sansObjet: 'menu-conversation-entree' },
    },
  },
  {
    id: 'rangee-dossier-arbre',
    kind: 'insert',
    where: 'after',
    anchor: [
      '(0, react_jsx_runtime.jsx)(ProjectRowItem, {',
      'group,',
      'containsCurrentDescendant: currentAncestors.has(group.key),',
      'home,',
      't,',
    ],
    lines: WORKSPACE_ROW_PIN_LINES,
    formes: {
      [FORME_RC2]: {
        anchor: [
          '(0, react_jsx_runtime.jsx)(ProjectRowItem, {',
          'newShortcut: shortcuts.find((row) => row.id === "session.new"),',
          'group,',
          'containsCurrentDescendant: currentAncestors.has(group.key),',
          'home,',
          't,',
        ],
      },
    },
  },
  {
    id: 'rangee-conversation-arbre',
    kind: 'insert',
    where: 'after',
    anchor: [
      'return (0, react_jsx_runtime.jsx)(SessionNodeItem, {',
      'node,',
      'currentId: current,',
    ],
    lines: SESSION_ROW_PIN_LINES,
  },
  {
    id: 'rangee-conversation-plate',
    kind: 'insert',
    where: 'after',
    anchor: [
      'return (0, react_jsx_runtime.jsx)(SessionNodeItem, {',
      'node,',
      'currentId,',
    ],
    lines: SESSION_ROW_PIN_LINES,
  },
  {
    id: 'abonnement-navigateur',
    kind: 'insert',
    where: 'after',
    anchor: ['const [query, setQuery] = (0, react.useState)("");'],
    lines: ['const pins = useKyberPins();'],
  },
  {
    id: 'rendu-section',
    kind: 'sub',
    old: 'children: wide && (normalizedQuery !== "" ? (0, react_jsx_runtime.jsx)(SearchResults, {',
    new: 'children: wide && ((0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [normalizedQuery === "" && ' + PINNED_SECTION_ELEMENT + ', normalizedQuery !== "" ? (0, react_jsx_runtime.jsx)(SearchResults, {',
    formes: {
      [FORME_017]: {
        new: 'children: wide && ((0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [normalizedQuery === "" && ' + PINNED_SECTION_ELEMENT_017 + ', normalizedQuery !== "" ? (0, react_jsx_runtime.jsx)(SearchResults, {',
      },
      [FORME_RC2]: {
        new: 'children: wide && ((0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [normalizedQuery === "" && ' + PINNED_SECTION_ELEMENT_017 + ', normalizedQuery !== "" ? (0, react_jsx_runtime.jsx)(SearchResults, {',
      },
    },
  },
  {
    id: 'rendu-fermeture',
    kind: 'tail',
    suffix: '] })',
    before: ['}))', '}),'],
    startsWith: '(0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {',
  },
  {
    id: 'libelles-en',
    kind: 'insert',
    where: 'after',
    anchor: ['"menu.fork": "Fork session",'],
    lines: ['"menu.pin": "Pin",', '"menu.unpin": "Unpin",', '"section.pinned": "Pinned",', '"pins.reorder": "Reorder: drag, or Alt+\u2191/\u2193",', '"pins.collapse": "Collapse Pinned",', '"pins.expand": "Expand Pinned",'],
  },
  {
    id: 'libelles-zh',
    kind: 'insert',
    where: 'after',
    anchor: ['"menu.fork": "分叉会话",'],
    lines: ['"menu.pin": "置顶",', '"menu.unpin": "取消置顶",', '"section.pinned": "已置顶",', '"pins.reorder": "重新排序：拖拽或 Alt+\u2191/\u2193",', '"pins.collapse": "收起已置顶",', '"pins.expand": "展开已置顶",'],
  },
]

// ── Le moteur de règles ─────────────────────────────────────────────────────
const indentOf = (line) => {
  const match = /^[\t ]*/.exec(line)
  return match === null ? '' : match[0]
}
const sameLine = (a, b) => a.trim() === b.trim()
const locateBlock = (lines, anchor) => {
  const hits = []
  for (let i = 0; i + anchor.length <= lines.length; i += 1) {
    let ok = true
    for (let j = 0; j < anchor.length; j += 1) {
      if (sameLine(lines[i + j], anchor[j]) !== true) { ok = false; break }
    }
    if (ok === true) hits.push(i)
  }
  return hits
}
const indentLines = (block, indent) => block.map((line) => (line.trim() === '' ? '' : indent + line))

/** La règle telle qu'elle s'écrit pour cette forme du bundle. */
const reglePour = (rule, forme) => {
  const variante = rule.formes === undefined ? undefined : rule.formes[forme]
  return variante === undefined ? rule : Object.assign({}, rule, variante)
}

/** État d'une règle : 'applied' (déjà posée), 'absent' (à poser), ou une erreur. */
const ruleState = (lines, rule) => {
  if (rule.kind === 'sub') {
    const hasNew = lines.join('\n').indexOf(rule.new) >= 0
    const hasOld = lines.join('\n').indexOf(rule.old) >= 0
    if (hasNew === true && hasOld === true) return { state: 'applied' }
    if (hasNew === true) return { state: 'applied' }
    if (hasOld === true) return { state: 'absent' }
    return { state: 'error', error: 'ancre introuvable' }
  }
  if (rule.kind === 'insert') {
    const hits = locateBlock(lines, rule.anchor)
    if (hits.length !== 1) return { state: 'error', error: hits.length === 0 ? 'ancre introuvable' : 'ancre ambiguë (' + String(hits.length) + ')' }
    const at = rule.where === 'after' ? hits[0] + rule.anchor.length : hits[0]
    const from = rule.where === 'after' ? at : at - rule.lines.length
    const present = from >= 0 && lines.slice(from, from + rule.lines.length).every((line, index) => sameLine(line, rule.lines[index]))
    return present === true ? { state: 'applied', at: at, from: from } : { state: 'absent', at: at, from: from }
  }
  if (rule.kind === 'block') {
    const starts = []
    for (let i = 0; i < lines.length; i += 1) if (lines[i].trim().startsWith(rule.start) === true) starts.push(i)
    if (starts.length > 1) return { state: 'error', error: 'bloc dupliqué (' + String(starts.length) + ')' }
    if (starts.length === 1) {
      const at = starts[0]
      const ends = []
      for (let i = at + 1; i < lines.length; i += 1) if (lines[i].trim() === rule.end) { ends.push(i); break }
      if (ends.length === 0) return { state: 'error', error: 'marqueur de fin manquant' }
      return { state: 'applied', at: at, end: ends[0] }
    }
    const text = lines.join('\n')
    const vieux = rule.stale.filter((marqueur) => text.indexOf(marqueur) >= 0)
    if (vieux.length > 0) return { state: 'error', error: 'bloc sans marqueurs déjà posé : --revert avec la version qui l’a posé' }
    const hits = locateBlock(lines, rule.anchor)
    if (hits.length !== 1) return { state: 'error', error: hits.length === 0 ? 'ancre introuvable' : 'ancre ambiguë (' + String(hits.length) + ')' }
    return { state: 'absent', at: hits[0] + rule.anchor.length }
  }
  if (rule.kind === 'tail') {
    const hits = []
    for (let i = 0; i + 3 <= lines.length; i += 1) {
      const stripped = lines[i].trim().split(rule.suffix).join('')
      if (stripped !== rule.before[0]) continue
      if (sameLine(lines[i + 1], rule.before[1]) !== true) continue
      if (lines[i + 2].trim().startsWith(rule.startsWith) !== true) continue
      hits.push(i)
    }
    if (hits.length !== 1) return { state: 'error', error: hits.length === 0 ? 'queue de liste introuvable' : 'queue de liste ambiguë (' + String(hits.length) + ')' }
    const line = lines[hits[0]]
    return line.indexOf(rule.suffix) >= 0 ? { state: 'applied', at: hits[0] } : { state: 'absent', at: hits[0] }
  }
  return { state: 'error', error: 'règle inconnue: ' + String(rule.kind) }
}

const ruleApply = (lines, rule, state) => {
  if (rule.kind === 'block') {
    const indent = indentOf(lines[state.at - 1] === undefined ? lines[state.at] : lines[state.at - 1])
    const block = indentLines(rule.lines, indent)
    return [...lines.slice(0, state.at), ...block, ...lines.slice(state.at)]
  }
  if (rule.kind === 'sub') {
    const at = lines.join('\n').indexOf(rule.old)
    const text = lines.join('\n')
    return (text.slice(0, at) + rule.new + text.slice(at + rule.old.length)).split('\n')
  }
  if (rule.kind === 'insert') {
    const indent = rule.where === 'after'
      ? indentOf(lines[state.at - 1] === undefined ? lines[state.at] : lines[state.at - 1])
      : indentOf(lines[state.at])
    const block = indentLines(rule.lines, indent)
    return [...lines.slice(0, state.at), ...block, ...lines.slice(state.at)]
  }
  if (rule.kind === 'tail') {
    const out = [...lines]
    const line = out[state.at]
    out[state.at] = line.slice(0, line.length - 1) + rule.suffix + line.slice(line.length - 1)
    return out
  }
  return lines
}

const ruleRevert = (lines, rule, state) => {
  if (rule.kind === 'block') {
    return [...lines.slice(0, state.at), ...lines.slice(state.end + 1)]
  }
  if (rule.kind === 'sub') {
    const text = lines.join('\n')
    const at = text.indexOf(rule.new)
    if (at < 0) return lines
    return (text.slice(0, at) + rule.old + text.slice(at + rule.new.length)).split('\n')
  }
  if (rule.kind === 'insert') {
    const from = state.from === undefined ? state.at : state.from
    return [...lines.slice(0, from), ...lines.slice(from + rule.lines.length)]
  }
  if (rule.kind === 'tail') {
    const out = [...lines]
    out[state.at] = out[state.at].replace(rule.suffix, '')
    return out
  }
  return lines
}

// ── Exécution ───────────────────────────────────────────────────────────────
const pkgDir = resolution.copie
const target = join(pkgDir, CLIENT_REL)
if (existsSync(target) !== true) {
  console.error('✗ bundle client introuvable : ' + target)
  process.exit(1)
}
const original = readFileSync(target, 'utf8')
const FORME = detecterForme(original)
if (FORME === null) {
  console.error('✗ forme de bundle inconnue (ni 0.1.6 ni 0.1.7) : ancres à relever dans ' + target)
  process.exit(1)
}
let lines = original.split('\n')
const report = []
let failed = false

for (const rule of RULES) {
  const regle = reglePour(rule, FORME)
  if (regle.sansObjet !== undefined) {
    report.push('  · ' + rule.id + ' (sans objet en ' + FORME + ' : portée par ' + regle.sansObjet + ')')
    continue
  }
  const state = ruleState(lines, regle)
  if (state.state === 'error') {
    report.push('  ✗ ' + rule.id + ' — ' + state.error)
    failed = true
    continue
  }
  if (CHECK === true) {
    report.push((state.state === 'applied' ? '  ✓ ' : '  ✗ ') + rule.id + ' — ' + state.state)
    if (state.state !== 'applied') failed = true
    continue
  }
  if (REVERT === true) {
    if (state.state === 'applied') {
      lines = ruleRevert(lines, regle, state)
      report.push('  ↩ ' + rule.id)
    } else report.push('  · ' + rule.id + ' (déjà absent)')
    continue
  }
  if (state.state === 'applied') {
    report.push('  · ' + rule.id + ' (déjà posée)')
    continue
  }
  lines = ruleApply(lines, regle, state)
  report.push('  + ' + rule.id)
}

console.log('patch épingles — ' + target)
console.log('  bundle ' + FORME + (versionDsh === null ? '' : ' — DSH ' + versionDsh))
console.log(report.join('\n'))

// Le fichier est un module ES servi à la GUI : une faute de syntaxe casserait
// tout le paquet. On le parse après écriture, et on restaure sinon.
const syntaxeValide = () => {
  const syntax = spawnSync('node', ['--check', target], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (syntax.status === 0) return true
  console.error('✗ syntaxe invalide après écriture — fichier restauré')
  console.error(String(syntax.stderr || '').split('\n').slice(0, 6).join('\n'))
  return false
}

if (CHECK === true) {
  console.log(failed === true ? '✗ patch incomplet' : '✓ patch conforme')
  process.exit(failed === true ? 1 : 0)
}
if (failed === true) {
  // Retrait demandé et ancres introuvables : c'est le cas NORMAL quand on vient
  // de changer le bloc injecté (`dsh-pins-client.js`) — le bundle porte encore
  // l'ANCIENNE version, que les règles ne savent plus reconnaître. Le script a
  // gardé le fichier d'origine à la première pose : on le restaure, sinon on
  // restait coincé avec un bundle patché impossible à retirer proprement
  // (mesuré deux fois pendant la montée en 0.1.7).
  if (REVERT === true && existsSync(target + BACKUP_SUFFIX) === true) {
    writeFileSync(target, readFileSync(target + BACKUP_SUFFIX, 'utf8'), 'utf8')
    if (syntaxeValide() === true) {
      console.log('✓ patch retiré — restauré depuis la sauvegarde ' + BACKUP_SUFFIX)
      process.exit(0)
    }
    writeFileSync(target, original, 'utf8')
    console.error('✗ la sauvegarde ' + BACKUP_SUFFIX + ' ne passe pas la syntaxe — rien écrit')
    process.exit(1)
  }
  console.error('✗ aucune écriture : une ancre a disparu (mise à jour de DSH ?)')
  process.exit(1)
}
if (REVERT === true) {
  writeFileSync(target, lines.join('\n'), 'utf8')
  if (syntaxeValide() !== true) {
    writeFileSync(target, original, 'utf8')
    process.exit(1)
  }
  console.log('✓ patch retiré')
  process.exit(0)
}

const next = lines.join('\n')
if (next !== original && existsSync(target + BACKUP_SUFFIX) !== true) {
  copyFileSync(target, target + BACKUP_SUFFIX)
  console.log('  sauvegarde : ' + target + BACKUP_SUFFIX)
}
writeFileSync(target, next, 'utf8')

if (syntaxeValide() !== true) {
  writeFileSync(target, original, 'utf8')
  process.exit(1)
}
console.log('✓ patch appliqué et syntaxe validée')
