# Retours à corriger — 30/10/2026

Liste tenue au fil de l'eau des points remontés en chat (améliorations et bugs).
**Règle de ce chantier : on liste, on ne corrige pas encore.** Aucun fichier applicatif
n'est touché tant que la liste n'est pas close.

## Améliorations

| # | Surface | Demande (verbatim) | Ce qu'on attend | Priorité | État |
|---|---|---|---|---|---|
| 1 | Menu « More » des entrées (barre latérale : `+` ▸ More) | « caches cette partie ds le menu » + capture 590×228 (sha256 `2f5f83c9…d1eb`) | Le menu ne montre plus les deux rangées « Browse other plugins » et « Create your plugin » | P3 | **corrigé** (30/10) — `client.js` (bloc `<kb-hide-native-rows>`, effet `kybernos: hide the native « More » row of the sidebar`), `test-hidden-native-rows.mjs` ; prouvé en live |
| 3 | Menu latéral — ordre et visibilité | « on devrait pouvoir organiser l'ordre des éléments de menu et leur visibilité dans un plugin » | Ordre + visibilité réglables et persistés, réglables depuis un plugin | P2 | listé — options étudiées |
| 4 | Automations ▸ segment « Team » (Team automations) | « je ne sais pas si Team automations are for team spaces, fonctionne ou pas » | Une fonction qui ne peut pas aboutir est **grisée + « Bientôt »**, jamais une carte de verrou ambiguë ou un bouton mort | P2 | **corrigé** (30/10) — « Bientôt » grisé sans CTA pour `server`/`absent`, bouton Serveurs mort retiré ; `test-soon-states.mjs` 4 ✓ |
| 5 | « Partager cette création » (fiche Partager) | « même remarque pour share creation » | Même politique : action impossible = grisée + « Bientôt », avec la vraie raison | P2 | **corrigé** (30/10) — bouton grisé expliqué quand le compte manque ; `test-soon-states.mjs` |
| 8 | Agent Team ▸ détail (onglets de la page) | « d'agent team details, mets roles avant identity ds l'ordre des onglets » | L'onglet **Roles** avant **Identity** : `['Roles', 'Identity', 'Workflow', …]` | P3 (cosmétique, 2 lignes + 1 test) | **corrigé** (30/10) — `client.js:15160` + `:15448`, `test-naming.mjs:121-127` vert ; preuve écran à la fin du lot |
| 9 | Menu pied de page ▸ Upgrade (et dialogue Upgrade) — `kybernos-cloud` | « ds menu - Upgrade - Extra credits (15,000 credits) n'est plus d'actualité, c'est mnt un système de topup » | Parler de **top-up** (recharger), pas de « crédits supplémentaires » ; et suivre le contrat du serveur (montant vs pack) | P2 (dit une chose fausse au moment de payer) | **corrigé** (30/10) — libellés top-up FR/EN + `grant_usd` géré ; `test-topup-labels.mjs` 3 ✓ |
| 6 | Connecteurs ▸ Découvrir | « on devrait afficher tous les connecteurs composio (+1500 connecteurs avec logo…) le user doit se connecter pour accéder, ou utiliser sa propre clé composio, c'est pour inciter les users à créer un compte » | Le catalogue complet lisible, le verrou à l'action, deux portes (compte Kybernos / clé perso) | P2 | **maquette v1 livrée** — `docs/handoff/connectors-catalog/maquette-v1/` |

## Bugs

| # | Surface | Constat (verbatim) | Ce qu'on attend | Priorité | État |
|---|---|---|---|---|---|
| 2 | Barre latérale gauche, menu Kybernos | « dans le menu, il faudrait que les icônes et les titres soient alignés (collapsé ou non) » + capture 526×1046 (sha256 `fa6f957d…cdfe`) | Une seule colonne d'icônes, une seule colonne de libellés, dans les deux états | P2 | listé — mesuré |
| 7 | Chat ▸ barre latérale droite, onglet « Dashboard » (plugin `kybernos-dashboards`) | « quand j'active le plugin dashboard, il y a toujours le dernier dashboard qui s'affiche à droite d'un chat, même quand je le ferme, il revient » | Le panneau reste fermé quand on le ferme, et n'affiche jamais le dashboard d'un autre chat | P2 (le panneau revient et vole la place) | **corrigé** (30/10) — pane strict + fermeture respectée ; `test-open-guard.mjs` 4 ✓, dashboard rebâti |

### Point 2 — la mesure (déplié, capture 526×1046)

Colonnes mesurées par script sur les pixels de la capture (pas à l'œil).

| Rangée | Icône (x) | Libellé (x) | Écart au libellé des rangées normales |
|---|---|---|---|
| Dashboards → Connectors (7 rangées) | 26–53 | **73** | référence |
| Overview → Sales and lettings (4 rangées) | 26–53 | **73** | 0 |
| En-tête « Business » (repliable) | chevron 23–38, icône 60–87 | **107** | **+34 px** |
| Sélecteur d'espace « Real estate agency » | 30–53 | **81** | **+8 px** |
| « More » (rangée native DSH) | 33–58 | **76** | +3 px |
| « Workspaces » (native) | 31–54 | 73 | 0 (libellé aligné, icône +5) |
| « Pinned » (native) | chevron 30–37, pas d'icône | 56 | hors grille |

Trois géométries se disputent la même colonne :

1. **les rangées du plugin** (`.kb4-item`, `client.js:8952`) : `padding-left .6em`, `gap .5em`,
   icône dans une boîte fixe `.kb4-ico{width:1.25em}` (`:8956`) → libellé à 2.35em ;
2. **l'en-tête de groupe** (`.kb4-grph`, `:8966`) : `padding-left .45em` **et** un chevron
   `.kb4-grpchev` inséré avant l'icône (`client.js:29366`), **et** un `font-size .95em` qui
   rescale tous ses `em` → +34 px mesurés ;
3. **le sélecteur d'espace** (`.kb4-scope`, `:8979`) : padding propre → +8 px.

Les rangées natives (« More », « Workspaces », « Pinned ») sont à l'axe de DSH, pas au nôtre :
elles ne bougeront qu'avec une marge compensatoire côté plugin.

État replié : `.kb4-item{width:36px;margin:1px auto;justify-content:center;gap:0}`
(`client.js:9052`) centre nos rangées dans une boîte de 36 px, tandis que `.kb4-grph` et
`.kb4-scope` passent `display:none` (`:8976`, `:8997`). **Non mesuré à l'écran** (Chrome de
debug 9333 muet dans cette session) : à capturer avant de corriger.

### Point 1 — où vit la demande, ce qu'on peut faire

Les deux rangées viennent du plugin natif DSH `@deepseek-ai/dsh-client-ui-entry-customization`
(moteur 0.2.2-alpha.2, `lib/client.js:78` libellés, `:149` injection dans le menu « More »).
« Browse other plugins » s'auto-masque quand la navigation plugins n'est pas exposée
(`client.js:40`) ; « Create your plugin » est rendu sans condition. **Corrigé le 30/10, autrement que prévu.** Le premier essai masquait les deux rangées en les
reconnaissant à leur texte, dans les 8 langues du bundle natif : `scripts/test-no-french-literals.mjs`
l'a refusé (2 ✗ — ces libellés français vivent hors dictionnaire), et c'était juste. La version livrée
masque **le lanceur « More » de la barre latérale** (`button[aria-haspopup="menu"]` + classe `panelRow`
du shell), donc la rangée **et** son menu : aucun mot, aucune langue à maintenir, et la règle CSS
`[data-kb-hidden-row]{display:none!important}` fait le reste. Dans la barre latérale, ce menu ne contient
que ces deux lignes (le natif ne remplit les vues repliées que pour la région « conversation »,
`lib/client.js:40`), donc le masquer ne perd rien. **Hors périmètre, à décider** : les menus « More » de
la conversation et de la barre de droite gardent ces deux lignes (ils peuvent porter les vues repliées).

Prouvé en live (GUI 127.0.0.1:3080, sonde CDP le 30/10 21:23) : `marked: 1`, `launchers: 1`,
`launchersHidden: 1`, et la capture
`.chasse-bugs-ui/preuves-2026-10-30/point1-barre-sans-More.png` où la rangée a disparu sans casser la
barre. Test : `packages/kybernos-plugin/test-hidden-native-rows.mjs` → 5 vérifications OK (matcher,
cas limites qui ne lèvent pas, idempotence, règle CSS + observateur présents, aucun libellé natif codé).

### Point 3 — ce qui existe déjà, et ce que valent les plugins du marché

Le seam existe déjà, mais pour un seul groupe : `window.__KB_MENU__` (`client.js:28930-29030`)
accepte `register({ id, group: 'business', icon, labelKey, order })` — **un `order` par rangée**,
trié. Rien pour la visibilité. Les rangées du cœur sont écrites en dur (`client.js:29940-29960`)
et la visibilité n'existe qu'en constantes de compilation (`KB_SHOW_CLOUD_COMPUTER_ROW`,
`KB_SHOW_HOSTED`, `KB_SHOW_DOCS`).

**Recherche (30/10/2026) — plugins DSH open source qui font ordre/visibilité :**

| Plugin | Ce qu'il fait | Limite pour nous |
|---|---|---|
| [dsh-sidebar-manager](https://github.com/zuojinxin/dsh-sidebar-manager) (MIT) | replier / masquer / réordonner par glisser les entrées d'extension + onglets de vue | cible DSH 0.2.1-rc.2 ; se repère par classes CSS du shell |
| [dsh-sidebar-panels](https://github.com/NONEMIN/dsh-sidebar-panels) (MIT) | Réglages ▸ Général : cases + glisser-déposer, sync des interrupteurs natifs | agit sur les entrées du registre `sidebar.panellist` |
| [dsh-leftpanel](https://github.com/zhujiuyi/dsh-leftpanel) | un interrupteur par entrée `sidebar.panellist`, état persisté côté hôte | idem : une ligne par entrée |
| [dsh-sidebar-overflow](https://github.com/cxv117793-blip/dsh-sidebar-overflow) | range les entrées peu utilisées dans « More », avec recherche | même périmètre |

**Verdict : aucun ne couvre nos rangées.** Notre menu entier est **une seule** entrée du
registre natif — `slots.register({ id: 'kybers-menu', order: 5 }, SalesMenu)` (`client.js:29963`).
Ces plugins voient « Kybernos » comme une ligne : ils déplacent le menu entier ou les rangées
natives, pas Dashboards vs Contacts vs Skills.

**Proposition retenue :** généraliser le seam existant dans `kybernos-plugin` — `order` +
`hidden` par rangée (persistés, défauts = ordre actuel), une section Réglages ▸ Menu
(cases + glisser-déposer), et retirer les constantes `KB_SHOW_*`. Zéro dépendance externe.

### Point 4 — état réel de « Team automations » (lu dans le code)

- **Côté client : tout est écrit.** Onglet « Team » de la page Automations (`client.js:22365+`) :
  vues Approved / Mine / To review, feuilles Propose et Review, vérification de version
  (SHA-256) à l'installation.
- **Côté serveur : rien.** `docs/dev/team-automations-contract.md` le dit noir sur blanc :
  « Nothing implements it yet: it is written first so that the two halves can be built at the
  same time. »
- Donc le segment ne peut aboutir que sur un serveur qui implémente le contrat. Sinon le client
  affiche une **carte de verrou** avec six raisons distinctes (`kbtaLockKind`, `client.js:22462` ;
  rendu `KbTeamLocked`, `:22690`) : `signin`, `personal`, `plan`, `server`, `net`, `reconnect`.
- **La phrase que tu as vue** — « Les automatisations d'équipe sont pour les espaces d'équipe »
  (`kbta.lock.personal.t`, `client.js:2189`) — est la carte `personal` : l'espace actif est
  personnel, donc pas de catalogue d'équipe. C'est voulu, ce n'est pas un bug.

Le défaut : le verrou **parle de plan / d'espace alors que la vraie raison est « pas encore
livré côté serveur »**. Et le segment reste affiché et cliquable pour tout le monde.

**Proposition — trois états, un seul rendu par état :**

| Situation | Rendu |
|---|---|
| droits manquants (plan Team, espace personnel) | carte de verrou actuelle, avec son CTA (changer de plan / rejoindre une équipe) |
| fonction non livrée (serveur sans routes, contrat non implémenté) | **entrée grisée + pastille « Bientôt »**, `disabled`, infobulle d'une phrase ; aucun CTA |
| réseau / serveur en erreur | carte actuelle + « Réessayer » |

### Point 5 — « Partager cette création » (fiche Partager)

La fiche existe (`client.js:12265+`) et gère trois niveaux : **Moi / Équipe / Public**. Une
partie de la politique demandée est **déjà** en place :

- pour les types sans lien public, la ligne « Public » porte déjà la pastille « Bientôt »
  (`kbsd.soon`, `client.js:12562`) et la phrase « Pas encore de lien public pour ce type
  d'élément » (`kbsd.public.sub.soon`, `:12584`) ;
- le bouton du pied est `disabled` quand rien n'est partageable (`inactif`, `:12602`) et
  s'explique une fois (`share-link-none`, `:12607`).

Ce qui manque : le même traitement quand le cloud n'est pas connecté (`cloud === null`) — le
bouton est grisé mais sans pastille ni raison visible — et une règle uniforme pour les trois
niveaux.

### Politique commune « Bientôt » (proposition, points 4 et 5)

Le produit a déjà le motif à réutiliser, il suffit de l'appliquer partout :

| Motif | Où il vit aujourd'hui |
|---|---|
| bouton `disabled` + infobulle « Bientôt disponible » | `kbui.comingsoon` (`client.js:974`, posé à `:12036`) |
| pastille « bientôt » à côté d'une action | `.kb8-soon` (`:12043`), `kbat.soon` (`:953`) |
| ligne de fiche marquée « Bientôt » | `kbsd.soon` (`:1761`), `kbsd.public.sub.soon` (`:1758`) |
| bouton grisé + raison au survol | `kbui.delete.soon` (`:996`, `:15816`), `kbui.mm.soon` (`:1894`, `:27145`), `kbui.crew.addrole.soon` (`:1904`, `:27180`) |

Règle proposée, une seule ligne : **une action qui ne peut pas aboutir est grisée, porte
« Bientôt », et n'affiche jamais de CTA** ; une action bloquée par un droit garde un CTA qui
mène au plan ou à l'espace ; une action qui échoue par erreur réseau garde « Réessayer ».

### Point 6 — le catalogue complet et le verrou d'accès (maquette du 30/10)

Maquette interactive : [index.html](docs/handoff/connectors-catalog/maquette-v1/index.html) ·
[cadrage](docs/handoff/connectors-catalog/maquette-v1/cadrage.md) ·
[verdict](docs/handoff/connectors-catalog/maquette-v1/verdict.md).

Ce qui est **réel** : 100 apps et **98 logos SVG** extraits de `packages/kybernos-composio/catalog.js`
(394 420 octets), les 5 connexions et les custom connectors de la capture du 30/10, les libellés du
verrou (`kb.cp.err.401`, `kb.cp.nokey`, `kb.cp.loadall`, `kb.cp.pv.composio`), et la géométrie des
cartes (r16 / p18 / logo 42 / titre 15-650, mesurée dans `extrait-composio.css`).

Ce qui est **proposé** : le voile de fin de grille (le verrou ne parle qu'à l'action aujourd'hui,
`client.js:2708`), la feuille à deux portes avec « Créer un compte Kybernos » (il n'existe aucun
écran de création de compte dans Connecteurs), et le compteur « environ 1 559 » — seule source du
dépôt : `packages/kybernos-composio/index.js:145`.

**Le défaut à trancher avant de coder** : « Charger le catalogue complet » remplace aujourd'hui les
100 apps par la liste du serveur — hors des 100, **pas de logo** (monogramme) et **description
vidée** (`client.js:2374`). La promesse « tous les connecteurs avec logo » dépend donc du proxy
Kybernos, pas du client.

**Non vérifié** : le portier `check-maquette.mjs` n'existe pas dans ce dépôt (ni dans ses
worktrees) ; vérification manuelle sur 7 captures relues ; l'API Composio répond 401 sans clé, donc
le nombre d'apps n'est pas mesuré ici.

### Point 7 — le dashboard d'un autre chat, et le panneau qui se rouvre

Deux comportements distincts se cumulent, et les deux sont dans le code (lecture seule, rien corrigé).

**A. Le panneau montre le dashboard d'un autre chat.** `getCurrent(sessionId, strict)` renvoie, quand
la conversation courante n'a pas de dashboard, le dernier dashboard du **dernier chat qui en a écrit
un** : `if (strict !== true) return lastSession !== null ? current.get(lastSession) : null`
(`packages/kybernos-dashboards/dashboard-host.mjs:367-371`). Et le panneau interroge `state`
**sans `strict`** (`client.js:3115`), donc il tombe dans ce repli : n'importe quel chat affiche
« le dernier dashboard ». En plus, la clé de session n'est rafraîchie que toutes les 4 s
(`client.js:3258-3263`) et `setSession` n'efface jamais l'ancienne (`client.js:1924-1925`), donc un
chat qu'on vient de quitter peut encore être servi pendant quelques secondes.

**B. Fermé, il revient.** Sonde de 1,5 s (`client.js:3270-3284`) : quand un dashboard arrive,
`WANT_OPEN_UNTIL = Date.now() + 60000` (`:3279`) ; puis à chaque tick, **si le panneau n'est pas
visible, elle rappelle `openTab()`** (`:3282`). Or « pas visible » est exactement l'état d'un
panneau qu'on vient de fermer : pendant la minute qui suit, chaque fermeture est défaite au tick
suivant. Et toute nouvelle écriture du dashboard réarme la fenêtre (`at` change), donc ça peut
durer. À la recharge, la sonde repart de `seen = null` (`:3272`) et rouvre encore si le dashboard a
moins de 15 s.

**Ce qu'on attend** : le panneau reste fermé quand on le ferme (au moins jusqu'au prochain dashboard
*différent*), et n'affiche rien — ou un état vide neutre — dans un chat qui n'a pas de dashboard.

**Correction proposée (non exécutée)** : (1) passer le panneau en `state?strict=1` avec la session
courante, et rendre l'état vide quand ce chat n'en a pas ; (2) mémoriser le refus (par session, avec
le `at` du dashboard refusé) et ne pas rouvrir avant un nouveau `at` ; (3) arrêter la boucle dès que
le panneau s'est affiché une fois ou que l'utilisateur l'a fermé ; (4) vider `SESSION_ID` quand le
chat change. Un test qui joue « écrit un dashboard dans le chat A → ferme → ouvre le chat B » suffit
à garder les quatre.

### Point 8 — l'ordre des onglets d'une Agent Team

Un seul endroit décide de l'ordre, et un test le fige :

- ordre actuel : `const TABS = ['Identity', 'Roles', 'Workflow', kbt('kbui.skills'), kbt('kbui.insight'), kbt('kbui.quality'), kbt('kbui.connecteurs'), …]`
  — `packages/kybernos-plugin/client.js:15446` ;
- onglet d'ouverture : `React.useState('Identity')` — `client.js:15160` (indépendant de l'ordre) ;
- le test qui échouera si on ne le met pas à jour : `packages/kybernos-plugin/test-naming.mjs:122`,
  `assert.ok(src.includes("const TABS = ['Identity', 'Roles', 'Workflow',"))` — son intention est
  « l'onglet des rôles ne s'appelle pas Team », mais l'assertion code l'ordre en dur.

**Corrigé le 30/10** : `client.js:15160` ouvre sur `'Roles'` (trois lignes de commentaire disent
pourquoi), `client.js:15448` porte `['Roles', 'Identity', 'Workflow', …]`, et `test-naming.mjs:121-127`
garde les deux : l'ordre de la barre **et** l'ouverture sur le premier onglet (l'ancienne assertion
codait l'ordre en dur ; elle a rougi avant d'être mise à jour, donc elle garde vraiment).
`node packages/kybernos-plugin/test-naming.mjs` → 13 vérifications OK ; `node --check client.js` → parse OK ;
`test-nav-titles.mjs` → 18 ✓. Reste : capture de la page à la fin du lot.

À trancher : **l'onglet d'ouverture**. Aujourd'hui la page s'ouvre sur Identity
(`client.js:15160`) ; si Roles passe en premier, on peut soit laisser l'ouverture sur Identity (l'ordre
ne change que la barre), soit ouvrir sur Roles (le premier onglet = l'entrée). Ma reco : ouvrir sur
Roles si l'ordre change, sinon l'incohérence « premier onglet ≠ onglet affiché » se verra.

### Point 9 — « Extra credits » ne dit plus ce que le produit fait

Tout est dans `packages/kybernos-cloud/client.js`, et **aucune des deux chaînes ne code « 15 000 »** :
le nombre vient du catalogue public du serveur (`/plans`), donc les 15 000 sont la valeur de *ton*
serveur, pas une constante du dépôt.

- les libellés : `upTopup: 'Crédits supplémentaires'` / `'Extra credits'` (`:265`, `:556`),
  `upTopupSub` « Paiement unique, valables pendant… » (`:266`, `:557`), `upBuyCredits: 'Acheter des
  crédits'` (`:268`, `:559`), et l'action du menu `planAddCredits: 'Ajouter des crédits'`
  (`:212`, `:505`) rendue en `client.js:2990` (`data-kb="menu-plan-credits"`) ;
- la carte du dialogue Upgrade (`.kbup-topup`) : `client.js:2818-2835` lit
  `pack.grant_credits`, `pack.max_qty`, `pack.expires_months` et le prix ;
- **ce que le client ne lit pas** : `pack.grant_usd`, présent dans les fixtures du dépôt
  (`scripts/check-footer-live.mjs:66` : `{ grant_usd: '3.75', grant_credits: 13800, min_qty: 1,
  max_qty: 10, expires_months: 12 }`). Si le nouveau top-up se décrit en argent plutôt qu'en crédits,
  la carte affichera « undefined crédits » ou un pack périmé.

**Ce qui manque pour corriger proprement (une seule réponse)** : le nouveau système est-il un
**montant libre** (on recharge X € → X crédits) ou des **packs de crédits** à quantité libre
(ce que lit le client aujourd'hui) ? Selon la réponse, c'est un renommage + `grant_usd` géré
(montant libre), ou un renommage seul (même contrat, autre mot).

Renommage proposé, dans les deux langues : « Crédits supplémentaires » → **« Recharger des
crédits »** / « Top-up », « Ajouter des crédits » → « Recharger », et la carte devient « Top-up ·
<montant> ».

## Journal des corrections (30/10, une boucle par point)

Chaque point : 1 diff borné, son test, la preuve, et le doc mis à jour. Ordre d'exécution :
**8** (onglets) → **1** (rangée More) → **2** (axe du menu) → **7** (dashboard) → **9** (top-up) → **4/5** (Bientôt).

| Point | Ce qui a changé | Tests | Preuve |
|---|---|---|---|
| 8 | `client.js` : `TABS` = Roles · Identity…, ouverture sur Roles | `test-naming.mjs` (13 ✓, l'assertion d'ordre a rougi avant d'être mise à jour) | — |
| 1 | `client.js` : masque le lanceur « More » de la barre latérale (markup, pas de mots) + règle CSS | `test-hidden-native-rows.mjs` 5 ✓ | sonde CDP `launchersHidden: 1` + capture |
| 2 | `client.js` : en-tête de groupe et sélecteur d'espace sur l'axe des rangées (inset, gap, icône 1.25em, chevron à la fin, bord compensé) | `test-menu-axis.mjs` 4 ✓ | mesure live : **16.4 / 40.9** partout |
| 7 | `kybernos-dashboards` : pane en `state?strict=1` + état vide, clé de session effacée, fermeture respectée (plus de réouverture sur 60 s) | `test-open-guard.mjs` 4 ✓, `test-client`/`test-host` verts, bundle rebâti | à jouer avec deux chats (non fait ici) |
| 9 | `kybernos-cloud` : « Recharger des crédits » / « Top-up » (3 actions), `grant_usd` géré par `upGrantText` | `test-topup-labels.mjs` 3 ✓ | — |
| 4 | `client.js` : `server`/`absent` → carte « Bientôt » grisée (72 %), aucun CTA ; branche Serveurs devenue morte retirée | `test-soon-states.mjs` 4 ✓ | état serveur non reproductible ici |
| 5 | `client.js` : bouton de partage grisé expliqué quand `cloud === null` | `test-soon-states.mjs` | — |

Non traités, et pourquoi : **3** (ordre/visibilité du menu par plugin) est une fonctionnalité — seam
`window.__KB_MENU__` à généraliser + une section Réglages, c'est un lot à part, pas une correction ;
**6** est une maquette livrée, son implémentation est une décision produit (voir `verdict.md`).

## À trancher

- Point 1 : CSS de notre plugin (2) ou désactivation du bundle natif (1) ? Le (2) ne fait pas
  perdre les autres rangées du même bundle.
- Point 2 : unifier l'axe en CSS + compenser les rangées natives, et capturer l'état replié
  avant / après.
- Point 3 : in-house (recommandé) ou dépendance à un plugin du marché pour les seules rangées
  natives ?
- Points 4 et 5 : appliquer la règle « Bientôt » telle quelle ? Et faut-il **cacher** le
  segment Team tant que le serveur ne le sert pas, ou le laisser grisé en découverte ?
