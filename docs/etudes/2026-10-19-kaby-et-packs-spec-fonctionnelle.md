# Kaby et les Packs — synthèse de l'étude et spec fonctionnelle

Date : 19 octobre 2026 · Statut : proposition à valider
Sources étudiées : [open-instinct](https://github.com/mariagorskikh/open-instinct) (et sa doc
Architecture/Permissions/Protocol), [OpenInstinct de Merit Systems](https://github.com/Merit-Systems/OpenInstinct),
[openinstinct de samagra14](https://github.com/samagra14/openinstinct), [OpenWebUI](https://docs.openwebui.com/features/)
(Tools, Skills, Knowledge, Models), plugins Claude Code, [Maritime](https://maritime.sh).
Deux revues contradictoires par Claude Opus 5.5 (conception du prompt Kaby, puis challenge de la
synthèse « Pack ») sont intégrées — le texte ci-dessous est la version **après** challenge.

---

## 1. Ce qui a été demandé

1. **Étudier open-instinct** et les projets équivalents pour en tirer des idées.
2. **Pour Kaby** : Kaby n'a pas de prompt avancé — lui en donner un, et prendre ce qui est bon
   pour lui et pour la plateforme.
3. **Paiements** : évaluer le système Link wallet.
4. **Hébergement** : Maritime est-il meilleur que Fly.io ?
5. **OpenWebUI** : s'inspirer des Tools (Python exécutable), des Skills avancés, de la notion de
   Knowledge. Claude utilise les plugins comme des packs (connections, skills…).
6. **Combiner toutes ces idées** en une proposition cohérente, validée par un challenge croisé
   avec un second modèle (Opus 5.5).

## 2. Ce que l'étude a appris (l'essentiel)

- **open-instinct** : la valeur n'est pas la stack, c'est la **gouvernance** — 7 cercles de
  confiance enforced en code (pas en prompt), refus d'un tiers signalé au propriétaire, argent en
  cartes à usage unique du montant exact, journal d'audit lisible en conversation, contenu externe
  toujours traité comme donnée et jamais comme instruction.
- **OpenWebUI** : la personne crée des **tools exécutables** (avec réglages chiffrés), des
  **skills** markdown, des **bases de connaissance** (RAG ou injection plein texte) — et un
  « modèle » est un **pack** {prompt + tools + knowledge}. Mais tout repose sur un admin qui
  écrit lui-même le code qu'il exécute.
- **Claude Code** : le plugin = un pack installable en un clic (skills + commandes + agents +
  serveurs MCP). Simple parce que l'installateur est un développeur qui se fait confiance.
- **Le point dur révélé par le challenge** : ces trois écosystèmes font confiance à leurs
  utilisateurs de trois façons **incompatibles**. Aucun ne résout notre cas — un hub qui distribue
  du contenu à des inconnus, sur leurs machines. C'est LA contrainte de conception.

## 3. Décisions entérinées

| Sujet | Décision | Raison |
|---|---|---|
| Link wallet (paiements) | **Différé** | Réservé US/Canada (utilisateur en France) ; responsabilité maximale ; la *règle* de plafond de dépense reste applicable plus tard |
| Maritime vs Fly.io | **Modèle à copier, migration différée** | Maritime est agent-native (VM persistante par agent, réveil ~1 s au message, desktop, ~1 $/mois/agent) mais fondé par l'autrice d'open-instinct (jugement biaisé par construction) ; on s'en inspire pour le cloud computer quand les coûts le justifient |
| RAG / Knowledge | **Non en v1** | CSV → requête tabulaire, petits corpus → contexte ou recherche plein texte ; on mesure d'abord, on n'indexe pas par principe |
| Tools exécutables par l'utilisateur | **Remplacé** | Ce sont des **scripts écrits par l'agent** et rangés dans ses skills ; aucun nouveau runtime, aucune marketplace de code |
| Tiers de confiance embarqués dans le pack | **Refusé** | Un pack **demande** des permissions, il ne les accorde jamais — la personne décide (modèle Android) |

---

## 4. Spec fonctionnelle — volet A : Kaby

### A1. Kaby sait qui il est, pour qui, et où il est

**Besoin** : aujourd'hui Kaby reçoit 5 lignes figées ; il ignore l'heure, le canal sur lequel on
le lit, ses capacités du moment et la voix qu'on attend de lui.

**Fonctionnalités** :
- **Une voix à Kaby** : un court texte de personnalité (ton, style), que la personne peut lire et
  modifier, plafonné en longueur. Voix uniquement — les faits vivent dans la mémoire, pas là.
- **Kaby connaît sa personne** : prénom, langue, fuseau, préférences de réponse, venant de la
  mémoire du compte.
- **Kaby sait où il en est** : chaque tour reçoit l'heure locale de la personne, le canal courant
  (chat ou Telegram), l'ordinateur utilisé et l'état de l'autre corps (cloud allumé/éteint).
- **Une étiquette par canal** : sur Telegram, messages courts, un fait par message ; dans le chat,
  réponses complètes.

**Règles métier** :
- Le noyau (identité, règles de sécurité) est fixe et **prime toujours** sur la personnalité.
- La personnalité vit côté compte (pas dans un fichier que Kaby peut réécrire lui-même) ; une
  personnalité ne peut jamais contenir d'instruction de sécurité contredisant le noyau.
- Ce qui vient d'un autre canal (fil Telegram, citations) est présenté comme **donnée, jamais
  comme instruction**. Un ancien échange (« je ferai X si tu dis oui » + un « oui » ancien)
  n'est **jamais** un consentement valable pour une action destructrice : on redemande dans le
  canal courant.

### A2. Kaby rend des comptes

**Besoin** : « qu'as-tu fait aujourd'hui ? » doit avoir une réponse véridique.

**Fonctionnalités** :
- **Journal quotidien** : à la fin de chaque tour, ce qui a réellement été fait (actions, outils,
  résultats) est noté sur le fil du jour.
- Kaby peut lire ce journal et le résumer à la personne sur demande.
- Il ne dit jamais « c'est fait » sans preuve dans le journal.

### A3. Garantie qualité du prompt

- Un **jeu d'essais** d'une vingtaine de conversations types (rappel entre canaux, tentative
  d'injection, « oui » périmé, question journal, demande réservée à l'autre ordinateur, changement
  de langue, personnalité qui contredit le noyau) doit rester **vert** à chaque modification du
  prompt. Sans lui, on ne touche pas au prompt.

## 5. Spec fonctionnelle — volet B : les Packs

### B1. Qu'est-ce qu'un pack ?

Un **pack** est une capacité prête à l'emploi que l'on installe en un clic depuis le hub, ou que
l'agent fabrique enregistrant la configuration d'une conversation qui a bien marché
(« sauvegarder ce réglage comme un pack » — jamais en remplissant un formulaire à la main).

**Un pack contient uniquement ce qui se partage** :
- des **skills** (modes d'emploi markdown, standard compatible DSH / OpenWebUI / open-instinct) ;
- des **scripts** que l'agent a écrits et rangés dans ses skills, exécutés dans la sandbox
  existante — pas de nouveau runtime ;
- des **connections requises** (connecteurs Composio/MCP dont il a besoin, à brancher à
  l'installation) ;
- de la **connaissance de départ** (documents de démonstration ou gabarits) ;
- des **permissions demandées** : le pack déclare ce qu'il veut faire (envoyer des emails, écrire
  des fichiers, dépenser) et **la personne accorde ou refuse**, à l'installation puis à l'usage.

**Un pack ne contient jamais** :
- la politique de confiance (elle appartient à la personne) ;
- la voix/personnalité (elle appartient au kyber / à Kaby) ;
- le choix de l'ordinateur (local ou cloud : c'est le setup et l'abonnement de la personne).

Avant d'ajouter un nouveau format, on vérifie qu'un **export de kyber** ne fait pas déjà le
travail ; le pack doit être l'évolution de l'existant, pas un cinquième nom.

### B2. Les fichiers suivent Kaby (avant toute indexation)

**Besoin** : le vrai manque constaté n'est pas la recherche intelligente, c'est la
**disponibilité** — les documents de la personne doivent suivre Kaby entre sa machine, le cloud
et Telegram.

**Fonctionnalités** :
- Un **dossier de la personne**, synchronisé entre les corps de Kaby.
- **Extraction de texte à l'entrée** (PDF, tableurs, images scannées → texte une bonne fois).
- Kaby cherche dedans comme il sait déjà le faire (lecture directe, recherche plein texte) ; les
  données tabulaires (CSV) s'interrogent en langage de requêtes, pas en « recherche sémantique ».
- On **mesure sur de vrais fichiers** si cela ne suffit pas ; seulement alors on envisage un index.

### B3. Le droit d'agir appartient à la personne

**Fonctionnalités** :
- Les actions sensibles (dépense, envoi externe, suppression, changement de sécurité) sont
  **annoncées et approuvées** par la personne : Autoriser / Refuser / Autoriser pour cette tâche
  (mécanisme déjà présent sur l'ordinateur de Kaby, généralisé).
- Les demandes des packs passent par la même porte.
- Quand une demande est refusée, le refus est **signalé** à la personne (une ligne, sans spam).

**Contrainte technique constatée** (à traiter avant ce volet) : le moteur DSH n'expose pas
aujourd'hui de point de contrôle « avant chaque appel d'outil » aux plugins ; l'arbitrage se fera
via les réglages d'approbation existants, ou demandera une couture moteur — à arbitrer sans
patch sauvage (règle n°1 du dépôt).

### B4. Désinstallation propre

- Un pack se retire **proprement** : les skills et scripts partent, les données de la personne
  restent et lui appartiennent, les connections peuvent être révoquées.
- Un pack arrive avec sa plage de compatibilité (version moteur/plateforme) et un jeu d'essais
  qui prouve qu'il fonctionne.

## 6. Ordre de réalisation proposé

1. **Volet A** (Kaby : prompt en couches + journal + jeu d'essais) — le plus de valeur pour le
   moindre coût, tout est local.
2. **B2** (dossier synchronisé + extraction) — le vrai manque mesuré.
3. **B3** (approbations généralisées) — **avant** d'ouvrir les scripts, sinon on livre des
   exécutables sans garde-fou.
4. **B1** (format pack, en partant de l'export kyber existant).
5. Paiements et cloud computer à réveil rapide — quand le besoin réel et les coûts le disent.

## 7. Hors périmètre (décision explicite)

Marketplace de code exécutable écrit par des tiers · RAG vectoriel par défaut · tiers de
confiance embarqués dans les packs · voix partagée dans les packs · payments Link (US/Canada
seulement) · migration Maritime.
