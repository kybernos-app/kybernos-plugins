# Connecteurs — tout le catalogue, verrouillé au moment d'agir (maquette v1)

Demande du 30/10/2026 : afficher **tous** les connecteurs Composio (≈ 1 500, logos compris) dans
Connecteurs, et que l'utilisateur doive **se connecter** (compte Kybernos) ou **apporter sa clé
Composio** pour s'en servir — pour inciter à créer un compte.

- Niveau : **interactive** (voir `cadrage.md`).
- Source : **capture** (`.chasse-bugs-ui/captures/w6-connectors-discover.png` et `w0-connectors.png`,
  écran réel du 30/10, hors dépôt car `.chasse-bugs-ui/` est gitignoré) + **données réelles**
  (`donnees-catalogue.js`, `donnees-logos.js`, extraits de `packages/kybernos-composio/catalog.js`).
- Ouvrir : double-clic sur `index.html`. Aucune ressource réseau, `dsh.css` est local.

## Ce qui est réel, ce qui est proposé

**Réel (recopié, pas inventé)**

- 100 apps et **98 logos SVG** extraits de `packages/kybernos-composio/catalog.js` (fichier de
  394 420 octets, en-tête « 100 apps, 98 real SVG logos »). Descriptions et catégories verbatim.
- Les 5 connexions de l'onglet « Tes apps » (Gmail, Google Calendar, Google Drive, Google Sheets,
  Outlook) et le bloc « Custom connectors » viennent de la capture `w0-connectors.png`.
- Les libellés du verrou : « Composio a refusé la clé API (401). Vérifie-la dans le panneau de la
  clé. » (`kb.cp.err.401`), « ta clé Composio ou ton compte Kybernos » (`kb.cp.intro.s1b`),
  « Ajoute ta clé Composio dans Réglages › Connecteurs pour activer les connexions. » (`kb.cp.nokey`),
  « Charger le catalogue complet » (`kb.cp.loadall`), « Composio — ta propre clé » (`kb.cp.pv.composio`).
- La géométrie : grille `repeat(auto-fill, minmax(300px, 1fr))` gap 14, carte r16 / p18 / min-height
  170, tuile de logo 42 px r10 (SVG 74 %), titre 15 px/650, catégorie 11 px, description 12,5 px
  2 lignes, onglet 34 px, champ 46 px — mesurés et recopiés dans `extrait-composio.css`
  (43 règles verbatim, `fichier:ligne` en tête de chaque bloc).

**Proposé (n'existe pas encore dans le produit)**

- Le **compteur** « environ 1 559 » : la seule source est un commentaire du dépôt
  (`packages/kybernos-composio/index.js:145`, « The PUBLIC catalog (proxy, about 1559 apps) »).
  L'API Composio répond 401 sans clé (mesuré le 30/10), donc le nombre n'est **pas** mesuré ici.
- Le **voile de bas de grille** (le catalogue s'arrête, le verrou prend le relais) : aujourd'hui le
  verrou ne parle qu'à l'action — « Ajouter une connexion » reste actif et renvoie le message
  d'erreur (`packages/kybernos-composio/client.js:2708`, `:2391`, `:2555`).
- La **feuille à deux portes** (« Créer un compte Kybernos » / « J'apporte ma clé Composio ») : le
  produit a une bascule de mode et un écran « Connecte ton compte Kybernos », mais **aucun écran de
  création de compte dans Connecteurs** (elle vit ailleurs : pied de barre latérale, onboarding).
- L'état « clé acceptée » qui lève le verrou et affiche « Ajouter une connexion » sur chaque carte.

**Écart assumé, à trancher avant de coder** : « Load the full catalog » appelle aujourd'hui
`GET /kybernos-cloud/connections/apps` et **remplace** les 100 apps par la liste du serveur : hors
des 100, les apps arrivent **sans logo** (monogramme) et **avec une description vide**
(`client.js:2374`). La promesse « avec leurs logos » de cette maquette dépend donc du proxy
Kybernos, pas du client : c'est le point à vérifier avec la moitié cloud.

## Parcours joué (et où le regarder)

| Gestes | État |
|---|---|
| Arrivée, catalogue + voile + bandeau du verrou | `01-defaut.png` |
| Bascule thème sombre (jetons, aucune couleur en dur) | `02-sombre.png` |
| Onglet « Tes apps » (5 connexions + custom connectors) | `03-tes-apps.png` |
| Clic sur une carte → feuille à deux portes | `04-feuille-deux-portes.png` |
| « J'apporte ma clé » → clé courte → refus 401 | `05-cle-refusee-401.png` |
| Survol d'une carte non connectée → « Se connecter » | `06-survol-cta.png` |
| 480 px : une colonne, voile pleine largeur | `07-etroit-480.png` |

Captures dans `.chasse-bugs-ui/maquettes/connectors-catalog/` (gitignoré : règle « pas de média en
git »). Raccourcis de démonstration dans l'URL, déterministes : `#dark`, `#yours`, `#sheet`, `#key`,
`#error`, `#hover`.

## Vérifié — et ce qui ne l'a pas été

- **Pas de portier automatique** : `scripts/check-maquette.mjs` et `maquette-new.mjs` n'existent ni
  dans ce dépôt ni dans ses worktrees (`find` sur `.claude/worktrees`), donc `maquette.json` est
  écrit mais **non joué**. La vérification a été manuelle : les 7 captures ont été relues une par une.
- **Pas de capture live fraîche** : le Chrome de debug (9333) n'écoute pas dans cette session ; les
  deux captures source datent du 30/10 (même écran, même build).
- **Non joué** : l'OAuth réel d'une app, l'écran Réglages › Connecteurs, le mode « compte Kybernos »
  (aucun appel réseau dans la maquette), la sidebar dépliée (elle porte des titres de sessions
  personnels, donc montrée repliée).
- **Non mesuré** : le nombre réel d'apps du catalogue Composio (401 sans clé).

## Fichiers

- `index.html` — la scène (un seul écran, états dedans).
- `dsh.css` — jetons + contrôles DSH, repris de `docs/handoff/webapp-creator/maquette-v1/dsh.css`
  (primitives `@deepseek-ai/dsh-client-ui-primitives@0.1.7-alpha.1` ; l'installation est en
  0.2.2-alpha.2, donc **à régénérer** avec le kit quand il revient).
- `donnees-catalogue.js` / `donnees-logos.js` — données réelles, générées depuis `catalog.js`.
- `extrait-composio.css`, `etat-gating.md` — les deux relevés de source (contrôles, verrouillage),
  écrits par deux agents en parallèle ; ils citent `fichier:ligne` et ne devinent rien.
- `cadrage.md`, `regard.md`, `verdict.md`, `maquette.json`.
