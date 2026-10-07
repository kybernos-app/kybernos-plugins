# Spec — Page Workers : vue en liste (v3, post re-challenge)

Statut : INTÉGRÉE POUR IMPLÉMENTATION — re-challenge v2 par un modèle
différent (REVOIR : 4 bloquants + 14 mineurs), tous traités ci-dessous.
Par ta politique « un correctif n'est jamais validé par son auteur », la v3
fera l'objet d'une re-vérification par un tiers après implémentation (voir
DoD). Un 2ᵉ challenge d'écriture de spec serait du bruit : les 4 bloquants du
2ᵉ relevaient de CONSTATS sur le harnais, pas de goûts — ils sont désormais
tranchés par la source (extraits du harnais cités en §5).
Bundle : `kybernos-workers` (client uniquement — contrat hôte inchangé)
Date : 08/10/2026

## 1. Problème

La page Workers affiche chaque worker en **carte** (grille `auto-fill
minmax(320px,1fr)`). Avec 4 workers et ~8 blocs par carte, la page défile sur
~1 600 px et la comparaison entre workers est impossible.

## 2. Objectif

Une **liste** : une ligne compacte par worker, balayable d'un coup d'œil,
détail dépliable, plusieurs lignes ouvertes en même temps (comparer). Mêmes
données, mêmes actions, zéro changement hôte, harnais vert sans le modifier.

Non-goals : nouveaux workers (chantier providers maison, séparé) ; changement
du contrat `/kybernos-workers/*` ; réorganisation de la navigation.

## 3. Données réellement disponibles (contrat `/state`, workers-host.mjs l.336-341)

Par worker : `id, nom, genre ('connexion'|'mcp'|'non-supporté'), via, paquet,
binaire, connexion (bool), installe, ligne (outil existante du profil),
dernier { quand, controles[{id, code, etat, detail}] }`.
**Dérivés client** (comme aujourd'hui) : politique affichée ← `ligne` ;
texte d'aide ← `indice()` ; libellé d'un contrôle ← couple `id + ':' + code`.

## 4. Architecture DOM décisive (tranchée par la source)

Le harnais lit les textes par `p.textContent('[data-kb="wk-card-<id>"]')` —
**textContent inclut les nœuds masqués** (« Carte a memory of what it needs »).
Conséquence : le **panneau détail est TOUJOURS dans le DOM**, replié par CSS
(`.kbwk-item[data-ferme="1"] .kbwk-detail{display:none}` ou `hidden` — les deux
préservent textContent). Rien n'a besoin d'être visuellement présent dans la
rangée fermée pour que le harnais soit vert. Chaque `data-kb` existe **une
seule fois** au DOM (25+ ancres : `wk-card-`, `wk-check-`, `wk-apply-`,
`wk-install-`, `wk-<id>-expose`, `wk-<id>-arrierePlan`, `wk-all`) — jamais de
duplication rangée/panneau.

`.kbwk-msg` (`.ok`/`.bad`, `role="status"`) : le harnais le cherche
`document.querySelectorAll('.kbwk-msg.ok')` — placé **sous la rangée, hors du
panneau repli** : il reste visible après « Appliquer » même avec le détail
fermé (bloquant 2 traité). La séquence l.270 (`waitForFunction` sur
`.kbwk-msg.ok` contenant `bak-workers`) passe aussi.

## 5. Contraintes harnais vérifiées (extraits sources)

- `carte()` = `p.textContent('[data-kb="wk-card-…"]')` → tout le texte exigé
  (`bak-workers-…`, `restart DSH`, `Last check:`, `/usr/local/bin/codex
  1.0.0`, `Logged in using ChatGPT`, `git introuvable`, `do not expose them`,
  `defined elsewhere… exposed yes, background yes`, `Delegation by the lead`)
  vit dans l'ITEM (rangée + panneau masqué) — §4 le garantit.
- `ids.join() === 'claude-code,codex,zcode,hermes'` (l.161) fige l'**ordre du
  registre hôte** → l'ordre DOM des items = l'ordre de `/state`. **Aucun tri
  client** : le tri par genre/nom (bloquant du 2ᵉ relecteur) est ABANDONNÉ —
  une coïncidence aujourd'hui ne vaut pas garantie.
- Hermes (l.166) : `$$('[data-kb="wk-card-hermes"] button')` doit rendre **0
  bouton** → item hermes sans aucun `<button>`, non cliquable, non focusable.
- `$$('.kbwk-ctl li')` doit compter **5** lignes dans l'item codex après un
  check complet → le `<ul class="kbwk-ctl">` vit **dans le panneau** (jamais
  dans un `<button>` : `<ul>` dans `<button>` est du HTML invalide et le
  résumé de colonne ne peut pas porter 5 `<li>`) — bloquants 1 et 4 traités.
- `.kbwk-relance` doit rester **null** après un install refusé (l.237) → le
  bandeau n'apparaît que sur `restart === true`, comme aujourd'hui.
- `$$('.kbwk select') === 0` et aucun texte `parallel|Parallel|Maximum
  duration|Read-only` (l.168) → inchangé.
- `document.documentElement.scrollWidth <= innerWidth + 1` à 390 px (l.303) →
  le CSS responsive doit éviter tout scroll horizontal (§8).
- Champs visibles dans la rangée fermée exigés par `attendreCarte` (regex sur
  textContent de l'item — masqué OK) : `Ready`, `Not checked yet`, `Not
  installed on this machine`, `Not signed in`, `Cannot write`, `partly
  verified`, `Mounted: restart DSH`, `Prêt`, `Connexion non montée`,
  `Délégation par le lead`, `Binaire trouvé dans le PATH de DSH`,
  `Install failed` + `EACCES`, `defined elsewhere…`.

## 6. Cible visuelle

### 6.1 En-tête (inchangé)

`Workers` + sous-titre + « Comment ça marche » + « Tout vérifier ». **Ajout** :
compteur `x prêts · y à régler · z non supportés` avec équations **fermées**
(chaque worker compte exactement une fois) :
- `x` = `dernier` existe ET tous `controles[].etat === 'ok'` ET `genre ≠ 'non-supporté'`
- `z` = `genre === 'non-supporté'`
- `y` = total − x − z (couvre : non monté, non vérifié, échec, partiel, etc.)
Les deux notes de bas de page (`do not expose them`, `calls no model`)
restent dans `.kbwk`, visibles, sous la liste (l.167).

### 6.2 Item de liste

`role="list"` → une `role="listitem"` par worker, `data-kb="wk-card-<id>"`
(migration explicite depuis la carte). Préfixe CSS : `kbwk` uniquement.

**Rangée compacte (~56 px, pas 44 px — les preuves vivent dans le panneau
masqué, §4)**, `border-bottom` l1, hover `bg-layer-1`, grille
`grid-template-columns: 170px 1fr 150px auto auto` :

| Zone | Contenu | Note |
|---|---|---|
| Statut | point coloré + libellé court des 10 états réels (i18n, §9) | 170 px |
| Identité | nom en gras ; dessous 12 px tertiaire : `paquet` ou `via`, `ellipsis` + `title` ; badge genre en pilule en **fin logique** du nom | 1fr |
| Contrôles | résumé : `5/5 ✓` (5 = `controles.length` après check), `✗ <libellé du premier contrôle en échec>` (dérivé id+code), `?` si partiel, `—` si `controles` vide ou `dernier` absent (pas de division par zéro) ; `title` = liste complète | 150 px |
| Politique | les DEUX interrupteurs `exposé`/`arrière-plan` **côte à côte** (~90 px), `aria-label` + `title`, légende unique sous l'en-tête de colonne | — |
| Actions | `Revérifier` / `Installer la connexion` / (hermes : rien) ; chevron `⌄` **sauf hermes** | auto |

### 6.3 Panneau détail (TOUJOURS dans le DOM **et toujours visible**)

**Décision assumée (révisée après relecture tiers) : PAS d'accordéon.** La
v3 promettait un repli par CSS + bascule `aria-expanded` ; c'est incompatible
avec le harnais qui *clique* `wk-apply-*`/`wk-install-*` via `p.click`
(exige une visibilité réelle) et matche des textes par regex dans `wk-card-*`.
Un repli rendrait les actions injouables. Le spec est réaligné sur le code :
**le détail reste visible en permanence** ; la compacité vient de la rangée
(56 px) et de la suppression du padding carte, pas d'un accordéon. Le harnais
(DoD §10.1) et les clics jouables (DoD §10.2) passent ainsi sans exception.

Contenu = l'ancienne carte : `.kbwk-ctl li` (5 lignes de preuve), `Last
check:`, aide (`indice()`), note « ligne d'outil existante », `Appliquer au
profil` (`data-kb` `wk-apply-<id>`), `Installer la connexion` si besoin. Les
`.kbwk-msg` (`.ok`/`.bad`) sont **hors du bloc détail**, toujours visibles.

### 6.4 Zone d'identité et focus (pas de bascule)

L'item est un `div` non interactif au clavier. Le bloc identité (`.kbwk-nom`)
place le **badge genre en fin logique du nom** (RTL-safe, `.kbwk-b` après le
nom dans `.kbwk-nom`). Les interrupteurs et les actions sont des boutons
tabulables indépendants. Aucun bouton de bascule (accordéon abandonné — §6.3).

### 6.5 États limites (14 mineurs du 2ᵉ)

- `controles = []` ou `dernier = null` → résumé `—` (pas de `0/0`).
- `genre` inconnu → badge repli « inconnu » + rangée sans bouton (comme hermes).
- Dédoublonnage par `id` : si `/state` envoie deux fois le même id, le premier
  gagne (la `key` React est `w.id`).
- Pendant `check`/`install`/`policy` : point statut pulsant (classe `busy`).
- Compteur : pluriel FR (`prêt/prêts`, `non supporté/non supportés`) ; EN
  invariant (`ready`/`to fix`/`not supported`).

### 6.6 Responsive et thèmes

- < 640 px : chaque item se replie sur **3 lignes** (statut / identité /
  contrôles, les actions à droite) — la spec disait « 2 lignes », le code en
  fait 3 : c'est le choix fait, réaligné ici. À 390 px **aucun scroll
  horizontal** (test l.303) : `min-width:0` sur les cellules, ellipsis sur
  les textes longs.
- Tokens `--dsw-alias-*` uniquement : clair/sombre servis par le thème.

## 7. Ordre

**Ordre du registre hôte (`/state`), inchangé** (l.161 le fige) — aucun tri
client. L'ordre actuel (claude-code, codex, zcode, hermes) est conservé tel
quel.

## 8. Implémentation

- Un seul fichier : `packages/kybernos-workers/client.js`. Bloc rendu réécrit ;
  logique d'action et `index.js`, `workers-host.mjs` : intouchés. Pas d'état
  `ouverts` (accordéon abandonné — §6.3).
- Dead-code rider : suppression `.kbwk-grid` et `.kbwk-card` (leur CSS) ;
  conservées pour le harnais : `.kbwk`, `.kbwk-empty`, `.kbwk-relance`,
  `.kbwk-msg(.ok/.bad)`, `.kbwk-ctl li`, `.kbwk-btn`.

## 9. i18n (contradiction kt() / packs traitée)

`kybernos-workers` utilise `kt(fr, en)` inline. Plutôt qu'un big-bang vers une
table `STR` (qui casserait les 43 `kt` et risquerait le harnais), le code
**collecte** chaque `kt(fr, en)` à l'exécution dans `PACK_STRINGS` (indexé par
la source fr) et **publie** `window.__KB_I18N_PACKS__.push({id:
'kybernos-workers', keys: {'workers.<source fr>': {fr, en}}})` à chaque rendu —
ids préfixés `workers.` (contrat i18n du 08/10), résolution pack traduit →
en → fr. Le repli `kt` reste fr/en (règle du dépôt) ; les traductions es/…
arrivent par le pack, servi par la page Langue.

## 10. Plan de vérification (DoD)

1. `scripts/test-workers-gui.mjs` au vert **sans modifier une ligne du
   harnais** (25+ ancres, textes, comptages).
2. Harnais live : actions jouées réellement (Revérifier → occupation ;
   toggles → brouillon puis Appliquer → écriture profil vérifiée par `cat` ;
   bandeau relance ; message `.kbwk-msg.ok` visible).
3. Captures **lues** par vision : clair + sombre, erreur globale, 390 px sans
   scroll horizontal (détail toujours visible — pas d'accordéon, §6.3).
4. Mesure : liste < 900 px de hauteur utile pour 4 workers (rangées compactes).
5. i18n : le vocabulaire `kt` est publié dans `__KB_I18N_PACKS__` (ids
   `workers.*`) ; les traductions es/… arrivent par la page Langue.
6. **Re-vérification par un tiers** (ta politique) : un agent qui n'a pas
   écrit le code relit le diff + rejoue le PoC harnais avant validation.

## 11. Risques (revus)

- Panneau masqué = beaucoup de nœud DOM dans le document : acceptable (4
  items max, ~5 `li` chacun), mais `display:none` plutôt que `visibility`
  pour ne pas participer au layout.
- Le réconciliateur du shell ne doit pas être perturbé : aucun nœud déplacé
  hors du conteneur de la page.
