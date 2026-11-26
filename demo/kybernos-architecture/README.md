# Kybernos — la carte (maquette interactive d'architecture)

Une page autonome (un seul fichier, aucune ressource réseau) qui explique **où tourne quoi** :
ce qui tourne chez toi, ce qui tourne sans toi, et ce qui sort de la machine.

Ouvrir `index.html` (double-clic). Rien à installer, rien à lancer.

## Versions

| Dossier | Quoi |
|---|---|
| `index.html` | la carte d'origine : 26 briques, 4 lieux, 8 parcours |
| `light-en.html` | la même carte en lecture claire et en anglais |
| `v2/index.html` | **v2** : deux lectures (couches *ce que c'est* / lieux *où ça tourne*), sections repliables, icônes, filtres par couche, fiche pontante |
| `v2/index-en.html` | la v2 en anglais (bouton `FR` / `EN` dans l'en-tête, la vue est conservée) |

La v2 est décrite dans [`v2/NOTES.md`](v2/NOTES.md) : modèle, gestes, ce qui a été
mesuré, limites et décisions ouvertes. Les preuves d'écran sont dans
`v2/captures/` (dossier local, non versionné).

## Comment on s'en sert

| Geste | Ce que ça fait |
|---|---|
| Un **parcours** dans la colonne de gauche | allume son chemin : une brique = un état, une ligne = un flux |
| Les **étapes numérotées** sous le parcours | sautent directement à l'étape ; `→` / `←` au clavier aussi |
| **Espace** | lecture automatique (3,6 s par étape), re-appuyer pour arrêter |
| **1 … 8** | sélectionne le parcours |
| **Clic sur une brique** | fiche : rôle, ce qui la traverse, ce qu'elle ne fait pas, où ça se règle, source |
| **Sombre / Clair** | bascule de thème (les deux sont réglés) |
| **Vue d'ensemble** | tout rallumé, aucun parcours |

## Ce que la carte contient

- **26 briques** dans 4 zones : *Chez toi* (7), *Ton serveur Kybernos* (8), *Les machines qui tournent sans toi* (7), *Le reste du monde* (4).
- **8 parcours** : automation locale · automation sur l'ordinateur cloud · Kaby depuis Telegram · télécommande téléphone · accès à l'ordinateur cloud · appel vocal · ajout d'un serveur custom · ce que le serveur voit de toi.
- **5 types de flux** : reste sur la machine (teal), parle au serveur (violet), chiffré de bout en bout (bleu), sortie fournisseur (ambre), webhook entrant (rose).

La carte est **honnête par construction** : chaque brique porte sa source et ses limites, reprises des documents du dépôt, et les pastilles disent ce qui n'est pas construit ou pas déployé (WhatsApp, relais télécommande, chat → ordinateur cloud, switch des tours Telegram).

## Identité visuelle

- **Logo** : un carré arrondi en dégradé (teal → bleu → violet) au « K » sombre, avec un nœud : dessiné en SVG inline, aucune image, aucune police d'icônes. Décliné en favicon (data URI) sur les deux pages.
- **Icônes** : 28 pictogrammes maison sur une grille 24×24, trait 1,7, bouts ronds (téléphone, terminal, Kaby, horloge, workers, micro, cloud, éclair, clé, volume, bouclier, webhook, graphe MCP, serveur, compte, étincelle, avion, bulle, onde, cube, prise, livre, relais, bouton, bulle-flèche). Sur la carte, l'icône **remplace la barrette de couleur** à gauche de la carte : la couleur reste réservée aux flux.

## Sources (état au 20/10/2026)

| Brique | Document |
|---|---|
| DSH local, Kaby, workers, mémoire | `README.md`, `packages/kybernos-kyber/README.md`, `packages/kybernos-workers/README.md` |
| Serveur, custom server, compte/quota, apps connectées | `docs/dev/servers.md`, `docs/dev/servers-page-spec.md` |
| Ordinateur cloud, automations, accès, volume, egress | `docs/dev/computers.md`, `docs/dev/cloud-computer-run-on.md` |
| Télécommande | `docs/dev/mobile-remote.md`, `docs/etudes/2026-10-19-deux-pwa-telecommande-et-kaby.md` |
| Canaux (Telegram, WhatsApp) | `packages/messaging/README.md`, `docs/dev/whatsapp-door-study-2026-10-19.md` |
| Appels | `packages/kybernos-call/README.md` |
| Webhooks, dispatch des tours | `docs/dev/cloud-computer-run-on.md` |
| Sandboxes E2B | `packages/kybernos-computers/README.md` |
| Porte d'hébergement | `packages/kybernos-gate/README.md`, `docs/dev/hosted-instances.md` |

## Ce qui a été vérifié (et comment)

Mesuré avec Chrome (Playwright) sur la page réelle, captures dans `captures/` :

- 8/8 parcours joués : 4, 5, 5, 3, 4, 5, 4, 4 étapes, aucun parcours vide, aucune erreur console (sauf `favicon.ico`, absent par choix d'autonomie).
- Compteur d'étapes, désactivation de `Précédent/Suivant` aux bornes, `Vue d'ensemble` qui éteint tout.
- Clic brique → fiche complète (rôle, traversée, limites, où, source, parcours liés) ; `Échap` et clic hors fiche ferment.
- Clavier : `→` passe 1/4 → 2/4 ; `1…8` changent de parcours.
- Thème clair capturé (`captures/arch-11.png`), pas de valeur en dur hors jetons.
- Téléphone 390 px et 480 px : zones empilées, tiroir « Parcours », barre d'étapes compacte, aucun débordement horizontal de page.
- Aucune ressource réseau : polices système, CSS local, données dans le fichier.

**Ce qui n'est pas vérifié** : rien de ce schéma n'est une mesure du système en marche — c'est une lecture des contrats et des mesures déjà consignées dans les documents ci-dessus. Les chiffres cités (réveil 3,0–3,7 s, sommeil 0,5–0,7 s, image 563 Mo, 4 sandboxes) viennent de ces documents, pas d'une nouvelle campagne.

## Limites connues de la maquette

- Le routage des lignes est orthogonal (gouttières + bus au-dessus de la bande du bas) ; pour les briques de la colonne de droite, le conduit longe le panneau et peut se lire comme un cadre.
- Sur téléphone, les lignes sont masquées (les zones s'empilent) : le parcours se lit dans la liste d'étapes et la barre du bas.
- Les libellés sont en français ; la version anglaise serait une traduction à faire, pas un changement de structure.
- `captures/` est un dossier de preuve, à ne pas committer (règle dépôt : pas de médias).

## Revues

### Claude Opus 5.5 — 20/10/2026

Critique adversariale des deux pages (fichiers + docs sources). Verdict rendu : **exactitude 5/10, clarté 4/10**. Six erreurs factuelles relevées, vérifiées une par une contre les documents :

| Constat d'Opus | Vérification | Correction |
|---|---|---|
| WhatsApp « étude seule » alors que la décision est un pont Baileys beta | vrai (décision 19/10 ; numéro relié sur dev le 20/10) | carte + page light : « beta, dev seulement » |
| Accès « un mot de passe » alors que la production passe par un ticket | vrai (`computers.md` : mot de passe = machine de dev) | « ticket à usage unique (mot de passe en dev) » |
| Réveil et sommeil inversés | vrai (`suspend 3,0–3,7 s / resume 0,5–0,7 s`) | chronos remis dans le bon sens |
| Kaby « choisit où il travaille » | partiellement vrai : le sélecteur règle les canaux (Telegram) ; le chat local reste ici | reformulé + limite ajoutée |
| Approbations « trois boutons » sur un tour d'ordinateur | vrai : la machine tourne en `danger-full-access`, approbations `never`, et les approbations de canal ne sont pas construites | croix + limite corrigées |
| Appels « construits » alors qu'aucun appel réel n'a été joué | vrai (`kybernos-call` § Known limits) | badge « jamais joué en direct » |

Défauts d'interface corrigés : échelle plancher 0,9 et tiroir dès 1240 px (lisibilité), **couleurs réservées aux flux** (cartes neutres, la zone porte son teint), **flèches** sur les tracés, suppression du bouton « Statuts réels » (la vérité n'est plus une option), carte centrée et agrandie jusqu'à 1,12.

Laissé de côté, assumé : une seule source de données pour les deux pages ; le **chemin par défaut d'un tour Telegram** (runner de la plateforme quand le switch est fermé) n'est pas dessiné ; la distinction des jetons (appareil, ordinateur restreint, billet du relais) n'est pas montrée ; le conduit des sorties longe encore le panneau de droite.
