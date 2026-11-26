// ── Recherche dans le sélecteur de modèle du composeur (paquet DSH installé) ──
//
// La liste des modèles (siège `conversation.input.model`, paquet
// `@deepseek-ai/dsh-client-ui-model-selection`) n'offre aucun filtre : ouvrir le
// menu, choisir « Modèle », puis chercher à l'œil dans une liste groupée par
// fournisseur. Aucun siège de plugin ne permet de s'insérer DANS cette liste :
// le champ de recherche vit donc dans le bundle client, que chaque mise à jour
// de DSH réécrit sans rien dire.
//
// Ce script y pose, de façon IDEMPOTENTE :
//   1. un champ de recherche en tête du panneau « Modèle » (icône, saisie,
//      effacement) et le filtre groupé/modèle qu'il pilote ;
//   2. le raccourci clavier du champ : ↓/↑ descendent vers le modèle courant (ou
//      le premier résultat), Entrée choisit le premier résultat, Échap vide
//      d'abord la recherche puis remonte d'un panneau ;
//   3. le focus du champ à l'ouverture du panneau « Modèle » ;
//   4. la copie zh/en des nouvelles clés (placeholder, aria, effacement,
//      « aucun résultat »).
//
// Rien n'est deviné : chaque modification est une paire (ancre, ajout) dont
// l'ancre doit apparaître EXACTEMENT une fois. Un morceau déjà posé est reconnu
// par sa sortie, donc le script peut être rejoué après chaque mise à jour de
// DSH. Le fichier écrit est d'abord contrôlé (`node --check`) dans un fichier
// temporaire puis renommé en place : le watcher HMR de la GUI ne voit jamais un
// bundle à moitié écrit.
//
// Deux formes du bundle sont couvertes : celle de 0.1.6-alpha.2 (forme
// d'origine) et celle de 0.1.7-alpha.1, pour qu'un retour en arrière ne casse
// pas la retouche. Entre les deux, seul le CSS du chevron des cellules a changé
// d'ancre (d'où les `variantes` d'un morceau), et les icônes du jeu DSH ont été
// renommées (d'où l'adaptation des sorties au paquet primitives installé).
//
// Usage :
//   node scripts/patch-dsh-model-search.mjs             # applique (idempotent)
//   node scripts/patch-dsh-model-search.mjs --check     # vérifie, n'écrit rien
//   node scripts/patch-dsh-model-search.mjs --revert    # retire la recherche
//   node scripts/patch-dsh-model-search.mjs --dsh <racine>
//
// Preuve de bout en bout (GUI réelle, CDP) : node scripts/verif-model-search.mjs
//
// Sortie : 0 = conforme après l'opération ; 1 = écart (--check), conflit ou échec.
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { racineDeclaree, resoudreCopie, refuserRacine, versionDuMoteur } from './racine-dsh.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const PKG = '@deepseek-ai/dsh-client-ui-model-selection'
const CLIENT_REL = join('lib', 'client.js')
/** Les versions contre lesquelles les ancres ont été relevées : avertissement, pas refus. */
const POUR = ['0.1.6-alpha.2', '0.1.7-alpha.1']

const args = process.argv.slice(2)
const CHECK = args.indexOf('--check') >= 0
const REVERT = args.indexOf('--revert') >= 0

const sh = (cmd, argv, cwd) => spawnSync(cmd, argv, { cwd: cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const dit = (t) => console.log(t)
const erreur = (t) => console.error(t)

// ── Où vit l'installation à patcher ─────────────────────────────────────────
// `--dsh <racine>` est OBLIGATOIRE (voir racine-dsh.mjs) : la copie visée est
// DÉCLARÉE par le robot de cycle de vie, jamais retrouvée par une sonde.
const racine = racineDeclaree(args)
const resolution = resoudreCopie(racine, PKG)
if (resolution.copie === null) refuserRacine(resolution.motif, 'patch-dsh-model-search.mjs')
const pkg = resolution.copie

// Le CSS du champ, identique dans les deux formes du bundle : il ne nomme que
// ses propres classes (`_7KE1Ra_search*`, préfixe stable du module).
const CSS_CHAMP = '._7KE1Ra_search{align-items:center;gap:6px;margin:2px 2px 6px;padding:0 8px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:10px;height:32px;display:flex}' +
  '._7KE1Ra_search:focus-within{border-color:var(--dsw-alias-state-business-primary)}' +
  '._7KE1Ra_searchIcon{color:var(--dsw-alias-label-tertiary);flex:none}' +
  '._7KE1Ra_searchInput{width:0;min-width:0;color:var(--dsw-alias-label-primary);font:inherit;background:0 0;border:none;outline:none;flex:1;padding:0;font-size:13px;line-height:20px}' +
  '._7KE1Ra_searchInput::placeholder{color:var(--dsw-alias-label-tertiary)}' +
  '._7KE1Ra_searchInput::-webkit-search-cancel-button{display:none}' +
  '._7KE1Ra_searchClear{color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;border-radius:6px;flex:none;place-items:center;padding:2px;display:grid}' +
  '._7KE1Ra_searchClear:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}'

// ── Les morceaux : avant → après ────────────────────────────────────────────
// Les chaînes « avant » sont copiées du bundle ; « après » contient toujours
// « avant » (insertion) ou le remplace (réécriture), jamais les deux. Quand le
// bundle a changé d'ancre entre deux versions, la forme d'origine vit dans
// `avant`/`apres` et la forme nouvelle en `variantes` : l'ancre absente du
// bundle en présence ne compte pas.
const MORCEAUX = [
  {
    nom: 'CSS du champ',
    avant: '._7KE1Ra_cellChevron{color:var(--dsw-alias-label-tertiary);flex:none}',
    apres: '._7KE1Ra_cellChevron{color:var(--dsw-alias-label-tertiary);flex:none}' + CSS_CHAMP,
    variantes: [
      {
        // 0.1.7 : la règle du chevron des cellules prend une taille explicite ;
        // le champ se pose après elle, comme avant.
        avant: '._7KE1Ra_cellChevron{width:12px;height:12px;color:var(--dsw-alias-label-tertiary);flex:none}',
        apres: '._7KE1Ra_cellChevron{width:12px;height:12px;color:var(--dsw-alias-label-tertiary);flex:none}' + CSS_CHAMP,
      },
    ],
  },
  {
    nom: 'classes du champ',
    avant: '\t\t\t"root": "_7KE1Ra_root",\n',
    apres: '\t\t\t"root": "_7KE1Ra_root",\n' +
      '\t\t\t"search": "_7KE1Ra_search",\n' +
      '\t\t\t"searchClear": "_7KE1Ra_searchClear",\n' +
      '\t\t\t"searchIcon": "_7KE1Ra_searchIcon",\n' +
      '\t\t\t"searchInput": "_7KE1Ra_searchInput",\n',
  },
  {
    nom: 'état de la recherche',
    avant: '\t\t\tconst [pane, setPane] = (0, react.useState)("root");\n',
    apres: '\t\t\tconst [pane, setPane] = (0, react.useState)("root");\n' +
      '\t\t\tconst [query, setQuery] = (0, react.useState)("");\n',
  },
  {
    nom: 'référence du champ',
    avant: '\t\t\tconst itemRefs = (0, react.useRef)([]);\n',
    apres: '\t\t\tconst itemRefs = (0, react.useRef)([]);\n' +
      '\t\t\tconst searchRef = (0, react.useRef)(null);\n',
  },
  {
    nom: 'calcul des groupes visibles',
    avant: '\t\t\t}))), [state.groups]);\n',
    apres: '\t\t\t}))), [state.groups]);\n' +
      '\t\t\tconst needle = query.trim().toLowerCase();\n' +
      '\t\t\t/** Un groupe survit si son nom répond ; sinon seuls ses modèles qui répondent restent. */\n' +
      '\t\t\tconst visibleGroups = (0, react.useMemo)(() => {\n' +
      '\t\t\t\tif (needle.length === 0) return state.groups.map((group) => ({\n' +
      '\t\t\t\t\tgroup,\n' +
      '\t\t\t\t\tmodels: group.models\n' +
      '\t\t\t\t}));\n' +
      '\t\t\t\tconst hit = (text) => typeof text === "string" && text.toLowerCase().includes(needle);\n' +
      '\t\t\t\treturn state.groups.map((group) => hit(group.name) || hit(group.id) ? {\n' +
      '\t\t\t\t\tgroup,\n' +
      '\t\t\t\t\tmodels: group.models\n' +
      '\t\t\t\t} : {\n' +
      '\t\t\t\t\tgroup,\n' +
      '\t\t\t\t\tmodels: group.models.filter((model) => hit(model.name) || hit(model.id))\n' +
      '\t\t\t\t}).filter((entry) => entry.models.length > 0);\n' +
      '\t\t\t}, [\n' +
      '\t\t\t\tstate.groups,\n' +
      '\t\t\t\tneedle\n' +
      '\t\t\t]);\n' +
      '\t\t\tconst hitCount = visibleGroups.reduce((count, entry) => count + entry.models.length, 0);\n',
  },
  {
    nom: 'focus du champ au forage',
    avant: '\t\t\tconst drill = (next) => {\n\t\t\t\tpaneFocus.current = "drill";\n\t\t\t\tsetPane(next);\n\t\t\t};\n',
    apres: '\t\t\tconst drill = (next) => {\n\t\t\t\tpaneFocus.current = next === "model" ? "search" : "drill";\n\t\t\t\tsetPane(next);\n\t\t\t};\n',
  },
  {
    nom: 'cible de focus « search »',
    avant: '\t\t\t\tif (intent === "drill") {\n',
    apres: '\t\t\t\tif (intent === "search") {\n' +
      '\t\t\t\t\t(searchRef.current ?? itemRefs.current.find((item) => item !== null && !item.disabled) ?? triggerRef.current)?.focus();\n' +
      '\t\t\t\t\treturn;\n' +
      '\t\t\t\t}\n' +
      '\t\t\t\tif (intent === "drill") {\n',
  },
  {
    nom: 'recherche vidée à l’ouverture',
    avant: '\t\t\tconst show = () => {\n\t\t\t\tsetPane("root");\n\t\t\t\tsetOpen(true);\n\t\t\t\treload();\n\t\t\t};\n',
    apres: '\t\t\tconst show = () => {\n\t\t\t\tsetPane("root");\n\t\t\t\tsetOpen(true);\n\t\t\t\tsetQuery("");\n\t\t\t\treload();\n\t\t\t};\n',
  },
  {
    nom: 'recherche vidée à la fermeture',
    avant: '\t\t\tconst close = (restoreFocus = false) => {\n\t\t\t\tsetOpen(false);\n\t\t\t\tsetPane("root");\n',
    apres: '\t\t\tconst close = (restoreFocus = false) => {\n\t\t\t\tsetOpen(false);\n\t\t\t\tsetPane("root");\n\t\t\t\tsetQuery("");\n',
  },
  {
    nom: '↓/↑ depuis le champ',
    avant: '\t\t\tconst moveFocus = (offset) => {\n' +
      '\t\t\t\tconst items = itemRefs.current.filter((item) => item !== null);\n' +
      '\t\t\t\tif (items.length === 0) return;\n' +
      '\t\t\t\tconst active = items.findIndex((item) => item === document.activeElement);\n' +
      '\t\t\t\titems[active === -1 ? offset > 0 ? 0 : items.length - 1 : (active + offset + items.length) % items.length]?.focus();\n' +
      '\t\t\t};\n',
    apres: '\t\t\tconst moveFocus = (offset) => {\n' +
      '\t\t\t\tconst items = itemRefs.current.filter((item) => item !== null);\n' +
      '\t\t\t\tif (items.length === 0) return;\n' +
      '\t\t\t\tconst active = items.findIndex((item) => item === document.activeElement);\n' +
      '\t\t\t\tif (active === -1 && searchRef.current !== null && document.activeElement === searchRef.current) {\n' +
      '\t\t\t\t\t(menuRef.current?.querySelector("[role=\\"menuitemradio\\"][aria-checked=\\"true\\"]:not([disabled])") ?? items.find((item) => !item.disabled) ?? items[0])?.focus();\n' +
      '\t\t\t\t\treturn;\n' +
      '\t\t\t\t}\n' +
      '\t\t\t\titems[active === -1 ? offset > 0 ? 0 : items.length - 1 : (active + offset + items.length) % items.length]?.focus();\n' +
      '\t\t\t};\n',
  },
  {
    nom: 'Échap vide d’abord la recherche',
    avant: '\t\t\t\tif (event.key === "Escape" && open) {\n' +
      '\t\t\t\t\tevent.preventDefault();\n' +
      '\t\t\t\t\tif (pane !== "root") back(pane);\n' +
      '\t\t\t\t\telse close(true);\n' +
      '\t\t\t\t\treturn;\n' +
      '\t\t\t\t}\n',
    apres: '\t\t\t\tif (event.key === "Escape" && open) {\n' +
      '\t\t\t\t\tevent.preventDefault();\n' +
      '\t\t\t\t\tif (pane === "model" && query.length > 0) {\n' +
      '\t\t\t\t\t\tsetQuery("");\n' +
      '\t\t\t\t\t\tsearchRef.current?.focus();\n' +
      '\t\t\t\t\t\treturn;\n' +
      '\t\t\t\t\t}\n' +
      '\t\t\t\t\tif (pane !== "root") back(pane);\n' +
      '\t\t\t\t\telse close(true);\n' +
      '\t\t\t\t\treturn;\n' +
      '\t\t\t\t}\n',
  },
  {
    nom: 'Entrée choisit le premier résultat',
    // L’ancre porte le début du bloc Tab : `if (!open) return;` apparaît deux
    // fois à ce niveau (l’effet de fermeture et le clavier du menu).
    avant: '\t\t\t\tif (!open) return;\n\t\t\t\tif (event.key === "Tab") {\n',
    apres: '\t\t\t\tif (!open) return;\n' +
      '\t\t\t\tif (event.key === "Enter" && pane === "model" && document.activeElement === searchRef.current) {\n' +
      '\t\t\t\t\tevent.preventDefault();\n' +
      '\t\t\t\t\tconst first = itemRefs.current.find((item) => item !== null && !item.disabled);\n' +
      '\t\t\t\t\tfirst?.click();\n' +
      '\t\t\t\t\treturn;\n' +
      '\t\t\t\t}\n' +
      '\t\t\t\tif (event.key === "Tab") {\n',
  },
  {
    nom: 'liste filtrée (groupes)',
    avant: 'children: state.groups.map((group) => {',
    apres: 'children: visibleGroups.map((entry) => {\n' +
      '\t\t\t\t\t\t\t\t\t\tconst group = entry.group;',
  },
  {
    nom: 'liste filtrée (modèles)',
    avant: 'group.models.map((model) => {',
    apres: 'entry.models.map((model) => {',
  },
  {
    nom: 'identité du modèle dans le DOM',
    // La recherche répond aussi sur l’identifiant du modèle et celui du
    // fournisseur (souvent plus précis que le libellé : « Z.ai: GLM 5.2 (free) »
    // a pour identifiant `z-ai/glm-5.2:free`). Ces deux attributs rendent cette
    // identité observable — donc la preuve exacte.
    avant: '\t\t\t\t\t\t\t\t\t\t\t\t\ttitle: model.name,\n',
    apres: '\t\t\t\t\t\t\t\t\t\t\t\t\ttitle: model.name,\n' +
      '\t\t\t\t\t\t\t\t\t\t\t\t\t"data-model-id": model.id,\n' +
      '\t\t\t\t\t\t\t\t\t\t\t\t\t"data-provider-id": group.id,\n',
  },
  {
    nom: 'champ de recherche dans le panneau',
    // L’ancre porte l’ouverture de l’élément des groupes : insérer sur la seule
    // ligne `className` placerait le champ DANS l’objet JSX des groupes.
    avant: '\t\t\t\t\t\t\t\t(0, react_jsx_runtime.jsx)("div", {\n' +
      '\t\t\t\t\t\t\t\t\tclassName: clsx(ModelSelect_module_css_default.groups, "scrollable"),\n',
    apres: '\t\t\t\t\t\t\t\tchoices.length > 0 && (0, react_jsx_runtime.jsxs)("div", {\n' +
      '\t\t\t\t\t\t\t\t\tclassName: ModelSelect_module_css_default.search,\n' +
      '\t\t\t\t\t\t\t\t\tchildren: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSearchOutline16, { className: ModelSelect_module_css_default.searchIcon }), (0, react_jsx_runtime.jsx)("input", {\n' +
      '\t\t\t\t\t\t\t\t\t\tref: searchRef,\n' +
      '\t\t\t\t\t\t\t\t\t\ttype: "search",\n' +
      '\t\t\t\t\t\t\t\t\t\tclassName: ModelSelect_module_css_default.searchInput,\n' +
      '\t\t\t\t\t\t\t\t\t\tvalue: query,\n' +
      '\t\t\t\t\t\t\t\t\t\tplaceholder: t("search.placeholder"),\n' +
      '\t\t\t\t\t\t\t\t\t\t"aria-label": t("search.aria"),\n' +
      '\t\t\t\t\t\t\t\t\t\tautoComplete: "off",\n' +
      '\t\t\t\t\t\t\t\t\t\tspellCheck: false,\n' +
      '\t\t\t\t\t\t\t\t\t\tonChange: (event) => {\n' +
      '\t\t\t\t\t\t\t\t\t\t\tsetQuery(event.currentTarget.value);\n' +
      '\t\t\t\t\t\t\t\t\t\t}\n' +
      '\t\t\t\t\t\t\t\t\t}), query.length > 0 && (0, react_jsx_runtime.jsx)("button", {\n' +
      '\t\t\t\t\t\t\t\t\t\ttype: "button",\n' +
      '\t\t\t\t\t\t\t\t\t\tclassName: ModelSelect_module_css_default.searchClear,\n' +
      '\t\t\t\t\t\t\t\t\t\t"aria-label": t("search.clear"),\n' +
      '\t\t\t\t\t\t\t\t\t\tonClick: () => {\n' +
      '\t\t\t\t\t\t\t\t\t\t\tsetQuery("");\n' +
      '\t\t\t\t\t\t\t\t\t\t\tsearchRef.current?.focus();\n' +
      '\t\t\t\t\t\t\t\t\t\t},\n' +
      '\t\t\t\t\t\t\t\t\t\tchildren: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCloseOutline16, { size: 14 })\n' +
      '\t\t\t\t\t\t\t\t\t})]\n' +
      '\t\t\t\t\t\t\t\t}),\n' +
      '\t\t\t\t\t\t\t\t(0, react_jsx_runtime.jsx)("div", {\n' +
      '\t\t\t\t\t\t\t\t\tclassName: clsx(ModelSelect_module_css_default.groups, "scrollable"),\n',
  },
  {
    nom: 'message « aucun résultat »',
    avant: '\t\t\t\t\t\t\t\tstate.status === "ready" && choices.length === 0 && (0, react_jsx_runtime.jsx)("div", {\n' +
      '\t\t\t\t\t\t\t\t\tclassName: ModelSelect_module_css_default.empty,\n' +
      '\t\t\t\t\t\t\t\t\tchildren: t("empty.models")\n' +
      '\t\t\t\t\t\t\t\t})\n',
    apres: '\t\t\t\t\t\t\t\tstate.status === "ready" && choices.length === 0 && (0, react_jsx_runtime.jsx)("div", {\n' +
      '\t\t\t\t\t\t\t\t\tclassName: ModelSelect_module_css_default.empty,\n' +
      '\t\t\t\t\t\t\t\t\tchildren: t("empty.models")\n' +
      '\t\t\t\t\t\t\t\t}),\n' +
      '\t\t\t\t\t\t\t\tchoices.length > 0 && hitCount === 0 && (0, react_jsx_runtime.jsx)("div", {\n' +
      '\t\t\t\t\t\t\t\t\tclassName: ModelSelect_module_css_default.empty,\n' +
      '\t\t\t\t\t\t\t\t\tchildren: t("empty.search", { query })\n' +
      '\t\t\t\t\t\t\t\t})\n',
  },
  {
    nom: 'copie zh',
    avant: '\t\t\t"empty.efforts": "当前模型未提供推理等级。"\n',
    apres: '\t\t\t"empty.efforts": "当前模型未提供推理等级。",\n' +
      '\t\t\t"search.placeholder": "搜索模型或提供方…",\n' +
      '\t\t\t"search.aria": "搜索模型",\n' +
      '\t\t\t"search.clear": "清除搜索",\n' +
      '\t\t\t"empty.search": "没有匹配 “{query}” 的模型。",\n',
  },
  {
    nom: 'copie en',
    avant: '\t\t\t"empty.efforts": "This model provides no reasoning effort levels."\n',
    apres: '\t\t\t"empty.efforts": "This model provides no reasoning effort levels.",\n' +
      '\t\t\t"search.placeholder": "Search models or providers…",\n' +
      '\t\t\t"search.aria": "Search models",\n' +
      '\t\t\t"search.clear": "Clear search",\n' +
      '\t\t\t"empty.search": "No model matches “{query}”.",\n',
  },
]

// ── Lecture de l'état ───────────────────────────────────────────────────────
const compter = (texte, aiguille) => {
  let n = 0
  let i = texte.indexOf(aiguille)
  while (i >= 0) {
    n += 1
    i = texte.indexOf(aiguille, i + 1)
  }
  return n
}
/** Formes d'un morceau telles que CE bundle peut les recevoir (0.1.6 puis 0.1.7). */
const formes = (morceau) => {
  const liste = [{ avant: morceau.avant, apres: adapterSortie(morceau.apres) }]
  for (const variante of morceau.variantes ?? []) liste.push({ avant: variante.avant, apres: adapterSortie(variante.apres) })
  return liste
}
/** 'pose' (une sortie présente), 'a-poser' (une seule ancre unique), 'conflit' (le reste). */
const etatMorceau = (texte, morceau) => {
  const candidates = formes(morceau)
  if (candidates.some((forme) => texte.includes(forme.apres) === true)) return 'pose'
  if (candidates.filter((forme) => compter(texte, forme.avant) === 1).length === 1) return 'a-poser'
  return 'conflit'
}

// ── Application / retrait, sur une copie en mémoire ─────────────────────────
const poser = (texte) => {
  let sortie = texte
  for (const morceau of MORCEAUX) {
    if (etatMorceau(sortie, morceau) !== 'a-poser') continue
    const forme = formes(morceau).find((candidat) => compter(sortie, candidat.avant) === 1)
    sortie = sortie.replace(forme.avant, forme.apres)
  }
  return sortie
}
const retirer = (texte) => {
  let sortie = texte
  for (const morceau of MORCEAUX) {
    for (const forme of formes(morceau)) {
      if (sortie.includes(forme.apres) === true) sortie = sortie.split(forme.apres).join(forme.avant)
    }
  }
  return sortie
}

// ── Résolution du paquet ────────────────────────────────────────────────────
if (sh('node', ['--version'], ROOT).status !== 0) {
  erreur('✗ node est requis pour contrôler le bundle patché')
  process.exit(1)
}
const clientPath = join(pkg, CLIENT_REL)
if (existsSync(clientPath) !== true) {
  erreur('✗ bundle client absent : ' + clientPath)
  process.exit(1)
}
const versionDsh = versionDuMoteur(resolution.moteur) ?? '?'

// ── Les icônes du champ : ce que cette installation expose ──────────────────
// 0.1.7 a renommé les icônes de `@deepseek-ai/dsh-client-ui-primitives`
// (« IconSearchOutline16 » → « IconSearchOutlineRegular »). Un nom disparu ne
// casse pas `node --check` : le composant vaudrait `undefined` au chargement et
// le champ ne s'afficherait pas. Le contrôle de syntaxe ne suffit donc pas —
// c'est le paquet primitives installé qui tranche, et la sortie insérée cite le
// nom qu'il expose. Le nom de 0.1.6 reste la forme de repli si les deux vivent.
const primitivesPath = (() => {
  const sonde = sh('node', ['-e', `process.stdout.write(require.resolve('@deepseek-ai/dsh-client-ui-primitives'))`], pkg)
  if (sonde.status === 0 && typeof sonde.stdout === 'string' && sonde.stdout.trim() !== '') return sonde.stdout.trim()
  return join(dirname(pkg), 'dsh-client-ui-primitives', 'lib', 'index.js')
})()
const primitives = existsSync(primitivesPath) === true ? readFileSync(primitivesPath, 'utf8') : ''
/** Paires (nom 0.1.6, nom 0.1.7) des icônes que le champ inséré référence. */
const ICONES = [
  ['IconSearchOutline16', 'IconSearchOutlineRegular'],
  ['IconCloseOutline16', 'IconCloseOutlineRegular'],
]
for (const [ancien, recent] of ICONES) {
  if (primitives.includes(ancien) !== true && primitives.includes(recent) !== true) {
    erreur('✗ ni « ' + ancien + ' » ni « ' + recent + ' » dans ' + primitivesPath)
    erreur('  la retouche ne peut pas nommer une icône que ce paquet n’expose pas : script à réadapter.')
    process.exit(1)
  }
}
/** Adapte une sortie relevée sur 0.1.6 au nom d'icône que cette installation expose. */
const adapterSortie = (texte) => {
  let sortie = texte
  for (const [ancien, recent] of ICONES) {
    if (primitives.includes(recent) === true) sortie = sortie.split(ancien).join(recent)
  }
  return sortie
}

let client = readFileSync(clientPath, 'utf8')
const etats = MORCEAUX.map((morceau) => ({ nom: morceau.nom, etat: etatMorceau(client, morceau) }))
const conflits = etats.filter((e) => e.etat === 'conflit')
const aPoser = etats.filter((e) => e.etat === 'a-poser')
const poses = etats.filter((e) => e.etat === 'pose')

// ── Rapport ─────────────────────────────────────────────────────────────────
dit('recherche du sélecteur de modèle — ' + pkg)
dit('  version DSH : ' + versionDsh + (POUR.includes(versionDsh) === true ? '' : ' (ancres relevées pour ' + POUR.join(', ') + ')'))
dit('  morceaux : ' + poses.length + ' posés · ' + aPoser.length + ' à poser · ' + conflits.length + ' en conflit')
for (const etat of etats) dit('    ' + (etat.etat === 'pose' ? '✓' : etat.etat === 'a-poser' ? '·' : '✗') + ' ' + etat.nom + (etat.etat === 'pose' ? ' — posé' : etat.etat === 'a-poser' ? ' — à poser' : ' — conflit'))
if (conflits.length > 0) {
  for (const morceau of MORCEAUX) {
    const etat = etats.find((e) => e.nom === morceau.nom)
    if (etat?.etat !== 'conflit') continue
    erreur('  ancre introuvable ou ambiguë pour « ' + morceau.nom + ' » : le bundle DSH a changé de forme, réadapter ce script.')
  }
}

if (CHECK === true) {
  const conforme = conflits.length === 0 && aPoser.length === 0
  dit(conforme === true ? '✓ recherche conforme' : '✗ recherche incomplète')
  process.exit(conforme === true ? 0 : 1)
}

if (conflits.length > 0) {
  erreur('✗ conflit — rien n’a été écrit')
  process.exit(1)
}

/** Écrit le bundle après contrôle de syntaxe, par renommage (le HMR ne voit jamais un fichier partiel). */
const ecrire = (texte) => {
  const temporaire = join(pkg, 'lib', 'client.kybernos-tmp.js')
  writeFileSync(temporaire, texte)
  const controle = sh('node', ['--check', temporaire], ROOT)
  if (controle.status !== 0) {
    rmSync(temporaire, { force: true })
    erreur('✗ syntaxe invalide après écriture — fichier en place inchangé')
    erreur(String(controle.stderr || '').split('\n').slice(0, 6).join('\n'))
    return false
  }
  const bac = join(tmpdir(), 'dsh-model-search-backup')
  mkdirSync(bac, { recursive: true })
  // La sauvegarde est le contenu AVANT écriture : le temporaire porte déjà le nouveau.
  copyFileSync(clientPath, join(bac, 'client.js.' + new Date().toISOString().replace(/[:.]/g, '-')))
  renameSync(temporaire, clientPath)
  return true
}

if (REVERT === true) {
  if (poses.length === 0) {
    dit('· rien à retirer (la recherche n’est pas posée)')
    process.exit(0)
  }
  if (ecrire(retirer(client)) !== true) process.exit(1)
  dit('✓ recherche retirée — ' + pkg)
  process.exit(0)
}

if (aPoser.length === 0) {
  dit('· déjà en place, rien à faire')
  process.exit(0)
}
if (ecrire(poser(client)) !== true) process.exit(1)
dit('✓ recherche posée — ' + pkg)
dit('  sauvegarde : ' + join(tmpdir(), 'dsh-model-search-backup'))
dit('→ la GUI reçoit le nouveau bundle au prochain chargement de page (HMR) ; sinon recharger la page.')
process.exit(0)
