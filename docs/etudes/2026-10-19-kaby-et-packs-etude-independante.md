# Prompt de Kaby, Packs, paiements et hébergement : une étude indépendante (19 octobre 2026)

Version française de `docs/dev/kaby-packs-study-2026-10-19.md` (la version anglaise fait foi si les deux divergent).

Statut : étude seulement, rien n'est construit. Elle a été écrite à partir du besoin brut et des sources primaires, **avant** de lire l'autre étude sur le même sujet (`docs/etudes/2026-10-19-kaby-et-packs-spec-fonctionnelle.md`) ; le § 9 compare les deux après coup.

Le besoin (du propriétaire) : étudier open-instinct et ses équivalents ; donner un prompt avancé à Kaby ; évaluer le wallet Link pour les paiements ; Maritime est-il meilleur que Fly.io ; s'inspirer d'Open WebUI (Tools en Python exécutable, Skills avancés, Knowledge) et des plugins Claude utilisés comme des packs ; combiner le tout en une proposition cohérente.

## 1. Réponses courtes

1. **Le prompt de Kaby** : oui, le construire, mais comme un bloc court, en couches, versionné, avec un **jeu d'essais qui conditionne chaque modification**. Aujourd'hui il tient en cinq phrases. La sécurité ne vient pas du prompt : elle vient de la porte d'approbation qui existe déjà. Le prompt sert à ce que Kaby parle juste, sache où et quand il est, et traite le contenu extérieur comme de la donnée.
2. **Open-instinct et équivalents** : prendre quatre idées, laisser le reste. À prendre : le prompt en couches, un journal quotidien construit à partir de faits, des approbations liées à une action exacte, « accusé de réception puis suite » pour le travail long. À laisser : les sept cercles de confiance (Kaby n'a qu'un seul interlocuteur aujourd'hui), la pile iMessage/Inkbox, l'hébergement Vercel.
3. **Les Packs** : un pack vaut la peine d'être défini, comme un **paquet signé et versionné qui demande des permissions et n'en reçoit jamais du seul fait d'être installé**. Construire la plus petite version (manifeste, installation, désinstallation, deux packs maison) avant toute place de marché.
4. **Open WebUI** : prendre les Skills (chargement progressif) et l'idée qu'un modèle est un préréglage de prompt + outils + connaissance. **Ne pas prendre les Tools en Python côté serveur** : la documentation d'Open WebUI dit elle-même qu'en importer un revient à donner un accès shell au serveur. Notre équivalent est un script qui s'exécute sur l'ordinateur de la personne, derrière la porte d'approbation.
5. **Knowledge** : pas une base vectorielle d'abord. Des fichiers sur l'ordinateur de Kaby, retrouvés avec les outils de fichiers (grep, lecture), indexés seulement au-delà d'une certaine taille et seulement si la personne sait où les empreintes sont calculées.
6. **Wallet Link** : **ne pas l'intégrer maintenant.** Les paiements d'agent sont ouverts aux clients des États-Unis et du Canada uniquement (docs Stripe) ; la plupart des utilisateurs de Kybernos sont ailleurs. Garder le mécanisme d'approbation, et laisser un pack déclarer une permission `spend` qui, en v1, se résout en « Kaby prépare, la personne paie ».
7. **Maritime contre Fly** : **rester sur Fly ; faire un essai d'une journée sur Maritime, ne pas basculer.** Même famille d'isolation (Firecracker), réveil annoncé plus rapide, mais un plafond sur le nombre de machines éveillées en même temps, des régions inconnues et une entreprise inconnue. Le port de fournisseur de l'ADR 0052 rend un futur pilote peu coûteux.

## 2. Ce qui existe aujourd'hui (lu dans le code, 19 octobre 2026)

- **Le prompt de Kaby, côté DSH** (`packages/kybernos-cloud/kyby-native.mjs`, `kybyPrompt`) : un bloc `[KYBY]` de cinq phrases (qui est Kaby, un seul assistant sur deux corps, la langue de la personne et un ton simple et court, ne jamais inventer un souvenir, ne jamais prétendre avoir fait ce qui ne l'est pas) plus les 8 dernières lignes du fil partagé. Appliqué seulement à la session désignée par le fichier pointeur `~/.dsh/kybernos-kyby.json`.
- **Le prompt de Kaby, côté serveur** : le concierge est un kyber protégé nommé « Second You » (un nom, une catégorie et une accroche dans `kybers/service.ts`), qui répond par le tour hébergé ; un tour sur ordinateur ajoute « la source et la personne » au prompt par défaut de DSH (environ 15,6 k tokens de prompt mesurés, notes de l'ADR 0053).
- **Ce qui arrête une mauvaise action** : `tools/pre-execute` dans `kybernos-cloud` fait demander à la personne avant tout outil sauf `read`, `read_image`, `web_search`, `web_fetch`, avec trois boutons dans le chat ; une question sans réponse en dix minutes vaut refus (ADR 0053 § 14). C'est la vraie frontière de sécurité.
- **Mémoire** : mémoire du compte sur le serveur avec rappel par pertinence, injectée sous forme de bloc `[KYBERNOS MEMORY]` ; leçons ; recherche locale dans les conversations.
- **Skills** : les skills `SKILL.md` de DSH, l'index skills.sh, les sélections signées « Featured », les skills d'équipe sur le serveur. **Connexions** : le MCP de Composio avec la clé de la personne, les connexions Kybernos. **Ordinateurs** : Fly, un par personne, créé au premier usage, suspension/reprise mesurées (ADR 0052). **Canaux** : Telegram construit, WhatsApp étudié (`whatsapp-door-study-2026-10-19.md`).
- **Ce qui manque** : un guide de voix et d'étiquette, un profil de la personne qui ne soit pas « ce que la mémoire rappelle », la conscience du canal, de l'heure locale et de l'ordinateur sur lequel tourne le tour, une règle explicite sur le contenu extérieur, un journal, un jeu d'essais pour le prompt, et toute unité qui regroupe skills + connexions + fichiers + permissions.

## 3. Ce que les projets extérieurs enseignent

**Les trois projets « open instinct » n'ont aucun lien entre eux.** Tous trois clonent le même produit (un agent personnel auquel on écrit par SMS). Leur profondeur diffère beaucoup :

| Projet | Substance | Maturité (telle que lue) |
|---|---|---|
| `mariagorskikh/open-instinct` | Le seul avec une vraie conception : cœur TypeScript, une micro-VM Firecracker par personne sur Maritime, Inkbox pour le numéro et l'e-mail, Composio, Stripe Link. Docs d'architecture, de permissions, de protocole, de paiements, de sécurité. | MIT, v0.1, 365 étoiles, 837 tests, déploiement iMessage et Maritime réel marqué bêta |
| `Merit-Systems/OpenInstinct` | Un assistant iMessage qui utilise un navigateur, sur Vercel, navigateurs Kernel, Neon, wallet Link optionnel. Bonne discipline de mémoire. | MIT, « pas destiné à la production » |
| `samagra14/openinstinct` | Un agent Codex sur une VM derrière une ligne de messagerie. Surtout un script d'installation et des commandes dans le chat. | MIT, 5 commits, 7 étoiles |

**Ce que fait `mariagorskikh/open-instinct` et qui vaut d'être copié** (d'après son `ARCHITECTURE.md` et son `PERMISSIONS.md`) :

- **Le prompt est assemblé dans un ordre fixe de couches** : personnalité, profil du propriétaire, fiche de l'interlocuteur, capacités, résumé de mémoire, index des skills, étiquette du canal. Chaque couche est un fichier que le propriétaire peut modifier, et `instinct prompt --layers` dit quel fichier commande quelle section. La personnalité est semée une fois puis appartient au propriétaire.
- **Un moteur de politique tourne deux fois** : une fois pour décider quels outils le modèle voit seulement, une fois comme garde avant chaque appel. Les effets de bord passent uniquement par la garde, jamais par le prompt.
- **Une approbation est liée à un appel exact** (conversation, demandeur, outil, arguments hachés, montant à 5 % près), expire après 15 minutes, et ne compte que si elle vient du canal du propriétaire (jamais d'un e-mail ou d'un autre agent).
- **Le contenu extérieur est de la donnée** : tout ce qui n'est pas le propriétaire (messages d'autres personnes, e-mails, pages web, captures d'écran, autres agents) est enveloppé et étiqueté non fiable par le constructeur de prompt ; un e-mail ne monte jamais au-dessus d'un « partenaire » parce que `From` peut être falsifié ; une récupération web refuse les adresses privées et de métadonnées.
- **Un journal quotidien** (`memory/journal/AAAA-MM-JJ.md`) à côté de la mémoire durable, et un `audit.jsonl` en ajout seul que le propriétaire peut interroger dans le chat.
- **Accusé puis suite** : après une vingtaine de secondes l'agent répond « je m'en occupe » et livre le résultat plus tard.

Chez `Merit-Systems/OpenInstinct` : mémoire plafonnée par portée, éléments récents rappelés d'abord et le reste consultable ; **enregistrer une note ne lance jamais une tâche ni n'autorise une action** ; un wallet est désactivé dans les exécutions planifiées ; les secrets n'entrent jamais dans le contexte du modèle. Chez `samagra14/openinstinct` : peu de choses au-delà de la confirmation pour l'irréversible et des commandes état/arrêt/nouveau dans le chat.

**Ce qu'il ne faut pas copier.** Sept cercles de confiance répondent à un problème que Kaby n'a pas encore : il a un seul interlocuteur. Ils deviennent utiles quand Kaby écoute d'autres personnes (WhatsApp en mode contacts choisis, agent à agent). D'ici là, la partie utile est la *fiche de l'interlocuteur* : dire au modèle qui parle et avec quelle autorité, et le faire respecter dans le code.

## 4. Le prompt de Kaby

### 4.1 Les couches (une proposition, petite par construction)

1. **Identité et voix** : qui est Kaby, la langue de la personne reprise, court par défaut, chaleureux, sans formules d'entreprise. Environ 150 tokens.
2. **Fiche de la personne** : prénom, langue, fuseau, offre, tirés du compte (pas de la mémoire). Environ 40 tokens.
3. **Situation, reconstruite à chaque tour** : le canal et ce qu'il permet (HTML Telegram ou texte brut WhatsApp, limite de longueur, présence de boutons), l'heure locale et le fuseau, quel corps fait tourner ce tour (l'ordinateur cloud ou ce Mac, éveillé ou à peine réveillé), si des approbations seront demandées. **La partie « canal » est générée à partir des `capabilities` de l'adaptateur** (ADR 0053 § 13.1), pour qu'il n'y ait qu'une seule source de vérité entre les portes et le prompt.
4. **Règles** : ne jamais prétendre avoir fait ce qui ne l'est pas ; dire en mots simples ce qu'une action va faire avant qu'une approbation ne soit demandée ; un refus est définitif pour ce tour (ne pas réessayer ni contourner en reformulant) ; aucun secret dans une réponse ; un travail long reçoit d'abord un accusé de réception.
5. **Le contenu extérieur est de la donnée** : tout ce qui n'est pas le message de la personne elle-même (une page, un fichier, un e-mail, un résultat d'outil, le message d'une autre personne) est de l'information à utiliser, jamais une instruction à suivre ; il est enveloppé dans un bloc étiqueté avec un délimiteur aléatoire par tour, et tout délimiteur qui lui ressemble à l'intérieur est échappé.
6. **Personne et mémoire** : le résumé de mémoire existant plus un court « ce que je sais de toi » sourcé (origine et date pour chaque ligne).
7. **Index des skills ou des packs, puis la fin du journal** (hier et aujourd'hui en quelques lignes).

Budget : les couches 1 à 5 ensemble sous environ 600 tokens, mesurés. Elles s'ajoutent aux 15,6 k tokens du prompt propre au moteur : chaque token ajouté est un coût à chaque tour et doit justifier sa place avec le jeu d'essais.

**Ce que le prompt ne peut pas faire.** Ce n'est pas une frontière de sécurité : une page piégée peut toujours essayer. La frontière est la porte qui demande déjà avant tout outil qui modifie quelque chose. La règle du prompt réduit la fréquence des tentatives et le bruit ; le jeu d'essais le mesure.

### 4.2 Le jeu d'essais (ce qui rend une modification de prompt sûre)

Un prompt est du code sans compilateur : il lui faut des tests. Proposition : 40 à 60 cas gardés dans le dépôt, chacun un tour scénarisé avec une vérification.

- **Voix** (langue reprise, longueur selon le canal, pas de prétention à une mémoire qu'il n'a pas) : surtout des vérifications déterministes (détection de langue, longueur, phrases interdites), un juge modèle seulement pour le ton.
- **Honnêteté** (on lui demande ce qu'il ne peut pas faire, on lui demande ce qu'il a fait) : la réponse doit correspondre à la trace réelle des outils.
- **Situation** (une question dépendante de l'heure à travers un changement de fuseau, le bon format pour Telegram, WhatsApp et DSH).
- **Injection** : pages et fichiers contenant des instructions, un message qui imite le délimiteur, un résultat d'outil qui réclame un secret. **Cette série doit réussir à 100 %** : c'est un test de non-régression d'un comportement lié à la sécurité, pas une note de style.
- **Règle de passage** : aucune modification des couches 1 à 5 n'est fusionnée sans un passage comparé à la version précédente ; la série d'injection ne peut perdre aucun cas ; le reste ne peut pas descendre sous la référence.

### 4.3 Le journal quotidien, « qu'as-tu fait aujourd'hui ? »

Le construire **à partir de faits, pas de ce que le modèle se rappelle de lui-même** : les tâches, approbations (demandées, accordées, refusées), appels d'outils, messages envoyés et coûts déjà enregistrés par le serveur, écrits en lignes (heure, canal, corps, quoi, résultat). Un modèle écrit le résumé lisible en fin de journée à partir de ces lignes, et la réponse à la question lit les lignes. Cela garde vrai « ne jamais prétendre avoir fait ce qui ne l'est pas » même pour le journal. Ce sont des données personnelles : montrées à la personne, exportables et effaçables comme le reste du compte (registre de rétention et règles `account-data` du serveur). Hors du chemin critique du modèle : un seul appel de résumé par jour.

## 5. Les Packs

### 5.1 Ce que disent les références

- **Les plugins Claude** (référence du manifeste de plugin) : un dossier avec `skills/`, `commands/`, `agents/`, `hooks/`, des serveurs MCP, un `bin/` facultatif, un manifeste avec version, `dependencies` et `userConfig` (valeurs demandées à l'activation ; les valeurs `sensitive` vont dans le coffre d'identifiants du système). Portée utilisateur, projet ou locale ; espaces de noms ; désinstaller supprime le dossier de données du plugin sauf demande contraire. Il déclare ce que contient un plugin ; il ne déclare **pas** ce qu'il a le droit de faire, au-delà des hooks et des listes d'outils.
- **Open WebUI** : un *modèle* est un préréglage de prompt système, d'outils et de connaissance ; les *Skills* sont des dossiers `SKILL.md` chargés progressivement (un manifeste nom + description dans le prompt, le corps récupéré à la demande par un outil) ; *Knowledge* est un ensemble de documents retrouvés par recherche ou injectés en entier ; les *Tools* sont des scripts Python qui s'exécutent dans le processus du serveur. Privé par défaut, versions avec une seule marquée « Production », erreur de conflit quand deux personnes enregistrent en même temps. Leur page de sécurité est franche : créer ou importer un outil équivaut à un accès shell sur le serveur.
- **Open-instinct** : des skills en playbooks `SKILL.md` (privés sauf mention publique) plus le fichier de politique ; pas de notion de paquet.

### 5.2 Un pack pour Kybernos

Un **pack** est un paquet signé et versionné, installé pour une personne (ou une équipe). Son manifeste déclare :

- **Des skills** : dossiers `SKILL.md` (le format que DSH charge déjà).
- **Des scripts** : fichiers qui s'exécutent sur l'ordinateur de la personne uniquement, chacun avec un petit manifeste : entrées, hôtes joignables, chemins touchables, secrets référencés **par leur nom**. Ils passent par la même porte d'approbation que n'importe quel `bash` ; un script que la personne a approuvé peut être pré-approuvé **par son empreinte** pour qu'un script modifié redemande (l'idée de liaison d'open-instinct).
- **Les connexions nécessaires** : par nom et portée (`calendar:read`), jamais des identifiants.
- **Connaissance de départ** : fichiers ou liens copiés dans la connaissance de la personne à l'installation, avec un plafond de taille et une ligne de consentement.
- **Permissions demandées** : le pack demande, la personne accorde, chacune séparément et avec une échéance ; installer n'accorde rien. Une mise à jour qui ajoute une permission redemande.
- **Cas d'essai** (obligatoires pour les packs Featured) : le même format qu'au § 4.2.

Ce qu'un pack **ne peut pas** faire : écrire dans les couches du prompt système (le texte d'un tiers à cet endroit est une porte d'entrée pour l'injection) ; seules les descriptions de ses skills atteignent l'index des skills, en tant que donnée. Exécuter du code sur le serveur Kybernos ou dans le processus hôte de DSH (l'erreur d'Open WebUI). Augmenter lui-même ses permissions.

Cycle de vie : **aperçu** (ce qu'il contient et demande, en mots), **installation**, **octroi**, **mise à jour** (différence de contenu et de permissions), **désactivation**, **désinstallation** avec un reçu : les skills, scripts, octrois et la connaissance dérivée du pack sont retirés ; les productions de la personne restent ; une connexion utilisée par autre chose reste et la référence du pack à elle disparaît.

### 5.3 Interopérabilité et sa limite

Lire un plugin au format Claude comme un *import* (son `skills/` et son `.mcp.json`, avec `hooks/` et `bin/` refusés ou signalés, permissions déduites de ses serveurs MCP et de `allowed-tools`) ouvrirait un écosystème existant. **Non vérifié** : si le chargeur de skills de DSH respecte `allowed-tools`, et si les serveurs MCP d'un plugin peuvent être déclarés par pack dans un profil DSH sans redémarrage. Vérifier les deux avant de le promettre.

### 5.4 Knowledge

Knowledge, ce sont les documents que la personne (ou un pack) apporte ; la mémoire, c'est ce que Kaby a appris sur la personne. Les garder séparés.

- **v1 : des fichiers, pas des vecteurs.** Un dossier sur l'ordinateur de Kaby (le volume `/data` que l'ADR 0052 rend déjà seul porteur d'état), avec un petit fichier d'index (chemin, taille, empreinte, résumé d'une ligne). Retrouvailles par les outils de fichiers que Kaby a déjà (lister, grep, lire). La documentation d'Open WebUI va désormais dans le même sens : récupération par l'agent dans les fichiers, le RAG ciblé étant l'ancien défaut.
- **Un index vectoriel** seulement au-delà d'une certaine taille, et seulement après avoir dit à la personne **où les empreintes sont calculées** (un autre fournisseur veut dire que le contenu quitte l'ordinateur). Supprimer un document supprime ses morceaux.
- **Les fichiers suivent Kaby** : le même dossier est joignable depuis l'ordinateur cloud et, par une synchronisation que la personne active, depuis ce Mac. **Rien n'est indexé avant que le dossier soit là où la personne l'a choisi.**

## 6. Paiements : le wallet Link

Lu dans la documentation de Stripe (`docs.stripe.com/agentic-commerce/agents/link-agent-wallet`) :

- L'agent obtient un accès programmatique au compte Link d'un **client** par OAuth, crée une **demande de dépense** (montant, commerçant, un contexte d'au moins 100 caractères), le client l'approuve dans l'application ou le site Link (30 minutes), et Link renvoie un identifiant **à usage unique** : une carte virtuelle, un jeton de paiement partagé ou un Link Pay Token. La vraie carte n'est jamais exposée. Pour un agent hébergé, les données de carte doivent aller dans un fichier en `0600`, jamais sur stdout ni dans le contexte du modèle.
- **Disponibilité : paiements d'agent pour les clients des États-Unis et du Canada** ; informations financières pour les États-Unis seulement. Votre entreprise et les commerçants peuvent être n'importe où.
- Un agent hébergé a besoin d'un client OAuth confidentiel (un formulaire de demande ; le README d'open-instinct dit trois à cinq jours), et fait de votre entreprise un **destinataire des données financières du client**.
- Les plafonds (`agent_wallet_spend_limits` : par transaction, par jour, sur trente jours) sont lisibles par client ; l'approbation sans surveillance est annoncée, pas livrée (TechCrunch, 30 avril 2026).

**Adéquation.** Le principe correspond à celui de Kaby (demander d'abord, montant exact, expire). La géographie non : les langues et marchés de Kybernos sont le français, l'espagnol, l'arabe, l'anglais. L'intégrer maintenant, ce serait construire une fonction pour une minorité d'utilisateurs et prendre des obligations de destinataire de données pour elle.

**Proposition.**
1. Ne pas intégrer Link maintenant.
2. Garder un seul mécanisme d'approbation (commerçant et montant exacts, lié à l'action, avec expiration) dans la table des approbations, utilisé par toute future dépense.
3. Un pack peut déclarer une permission `spend` ; en v1 elle ne peut se résoudre qu'en **« Kaby prépare le panier ou le formulaire, la personne paie »**.
4. Proposer Link comme pack maison facultatif, montré seulement aux comptes des États-Unis et du Canada, **au moyen de la CLI de Stripe sur l'ordinateur de la personne** (`@stripe/link-cli` et ses skills publiés), de sorte que Kybernos ne touche jamais aux données de paiement. Il sert aussi de cas d'essai du modèle de permissions des packs.
5. Réévaluer quand Link ouvrira à l'EEE. Stripe Issuing pour agents n'est rapporté en préversion privée que par une source secondaire : pas un plan, et émettre des cartes ferait de Kybernos un programme de cartes avec sa propre charge de conformité.

## 7. Hébergement : Maritime ou Fly

| | Fly (ce que nous utilisons) | Maritime (ce que dit sa page) |
|---|---|---|
| Isolation | Micro-VM Firecracker par machine | Micro-VM Firecracker par agent, « sur du bare metal » ; l'hébergeur n'est pas nommé |
| Veille et réveil | La suspension avec mémoire fonctionne ; réveil mesuré de 0,7 à 1,7 s via le proxy ; **création à partir de rien environ 60 s** (ADR 0052 § 3 et le test de jeu) | Réveil « environ 0,6 s », nouvelle machine « 0,5 s » : affirmation de l'entreprise, non mesurée ici |
| État | Volume `/data` (0,15 USD par Go et par mois) ; le système de fichiers racine est remis à zéro à l'arrêt | Seul `/data` persiste : **le même modèle que le nôtre** |
| Forme du prix | À la seconde d'éveil ; un ordinateur de 1 Go en veille coûte environ 0,6 à 0,8 USD par mois, toujours allumé environ 6,9 (ADR 0052, mesuré/listé) | Forfait par machine : Starter 20 USD (20 machines, **5 éveillées**), Growth 100 USD (100, **25 éveillées**), Scale 500 USD (500, **60 éveillées**) ; machines supplémentaires 1,00 à 1,50 USD ; toujours allumé 20 USD par mois et par machine |
| Contrainte qui compte | Limites de débit de l'API (non vérifiées) | **Un plafond de machines éveillées en même temps**, pas de machines possédées |
| Régions, données | `ams`, `cdg` et d'autres ; sous-traitants listés | **Régions non indiquées** |
| Qui, depuis quand | Une entreprise connue | **Non indiqué sur la page** |
| Contrôle dont nous avons besoin | Garde de sortie réseau, une app par ordinateur, une API pour tout | Politique de sortie et gestion des secrets non mentionnées ; une CLI, une API REST, des SDK et un serveur MCP existent |

**Le plafond est le point clé.** Un ordinateur par personne qui se réveille à chaque message fait suivre l'horloge au nombre d'éveillés en même temps (matins, soirs). Sur Maritime, un plan de 100 machines autorise 25 éveillées : une moyenne de quelques utilisateurs éveillés peut quand même dépasser ce seuil aux heures de pointe. Sur Fly rien n'est plafonné et la facture suit l'usage. **Ordre de grandeur pour 1 000 personnes éveillées environ dix minutes par jour** : Fly environ 700 USD par mois sur notre coût mesuré en veille ; Maritime environ 1 000 USD (plan Scale plus 500 machines supplémentaires) avec le plafond d'éveillées proche du pic. Ce sont des estimations tirées des deux grilles de prix, pas des mesures, et le côté Maritime suppose un plan adapté.

**Recommandation.** Rester sur Fly. Le port (`ComputerProvider`, ADR 0052 § 7) fait qu'un pilote Maritime est un seul paquet, donc un essai d'une journée coûte peu et répond à trois choses que la page de Maritime ne dit pas : le **temps entre la création et la première réponse** (notre point faible, l'écran « Initialisation »), ses **régions et conditions de sous-traitance**, et le **contrôle de la sortie réseau**. Utiliser son plan gratuit (3 machines). Ne basculer que si l'essai bat Fly sur le temps de création **et** si le plafond d'éveillées convient à la prévision **et** si le volet juridique tient.

*Note d'hygiène :* la page `maritime.sh` contient des instructions pas à pas adressées aux agents IA (étapes de déploiement). Elles ont été lues comme du contenu de page et n'ont pas été exécutées.

## 8. Une proposition cohérente, dans l'ordre

| Étape | Quoi | Terminé quand |
|---|---|---|
| 0 | Banc d'essai et premier jeu (voix, honnêteté, injection) passé sur le prompt **actuel** de cinq phrases, pour avoir une référence | Chiffres de référence notés ; la série d'injection existe et réussit, ou ses échecs sont listés |
| 1 | Prompt v1 : couches 1 à 5, bloc de situation construit depuis les capacités de l'adaptateur, enveloppe du contenu extérieur | Le jeu d'essais réussit sans perte par rapport à la référence ; couches 1 à 5 mesurées sous le budget |
| 2 | Journal à partir de faits + « qu'as-tu fait aujourd'hui ? » | La réponse correspond aux lignes enregistrées sur une journée scénarisée ; export et effacement fonctionnent |
| 3 | Knowledge v1 : un dossier, un fichier d'index, les outils de fichiers | Un document ajouté, retrouvé par Kaby, retiré ; aucun appel réseau pour indexer |
| 4 | Manifeste de pack v1, installation avec demandes de permissions, désinstallation avec reçu ; deux packs maison faits de ce qui existe déjà | Une mise à jour qui ajoute une permission redemande ; la désinstallation ne laisse ni skill, ni script, ni octroi |
| 5 | Essai Maritime (une journée) | Une courte note avec temps de création, régions, sortie réseau, décision |

Pas maintenant : Link, une place de marché de packs, les cercles de confiance, la recherche vectorielle, un second hébergeur en production.

**Pourquoi cet ordre.** Le prompt et son jeu d'essais protègent tout ce qui est construit après, ne coûtent rien en infrastructure, et sont nécessaires quelle que soit la décision sur les packs. Les packs viennent après la porte d'approbation (déjà construite) et après Knowledge, parce qu'un pack sans endroit où mettre ses fichiers n'est qu'une liste de skills.

## 9. Comparaison avec l'autre étude

Lue après l'écriture des § 1 à 8 (la spec fonctionnelle en français, et `docs/dev/kyby-prompt-spec.md`, toutes deux non suivies par git dans l'arbre partagé).

**Où les deux s'accordent** (deux lectures qui ne se sont pas vues) : un prompt en couches avec le contenu extérieur enveloppé comme donnée ; un journal ; un jeu d'essais qui doit rester vert avant toute modification du prompt ; Link différé pour des raisons géographiques ; pas de bascule Maritime maintenant ; pas de recherche vectorielle en v1 (les fichiers d'abord) ; un pack qui contient des skills, des scripts écrits par l'agent, les connexions requises, une connaissance de départ et des permissions **demandées**, sans politique de confiance ni voix à l'intérieur ; les approbations avant les scripts ; une désinstallation propre ; pas de place de marché de code tiers. C'est un indice fort que le socle commun est le bon.

**Ce que l'autre étude a et qui manquait à celle-ci (à adopter) :**
1. **Un « oui » ancien n'est jamais un consentement pour une nouvelle action** (le `Kaby : je supprime X si tu dis oui` suivi d'un vieux `oui` venu de Telegram). Je l'avais manqué ; cela compte surtout dans le chat natif, où il n'y a pas de porte (voir plus bas).
2. **Une personnalité modifiable, voix seulement, stockée sur le compte, le noyau l'emportant**, avec un cas d'essai qui vérifie qu'une personnalité ne peut pas contredire le noyau. Je la livrerais après la v1 (une couche de plus à budgéter), sans l'abandonner.
3. **L'extraction de texte à l'entrée** (PDF, scans, tableurs) et **les questions tabulaires pour les CSV** plutôt que la recherche sémantique. Mon Knowledge v1 (§ 5.4) oubliait l'extraction ; sans elle un PDF n'est pas trouvable par grep.
4. **Un pack fabriqué en enregistrant une conversation qui a bien marché**, et la discipline de vérifier si un **export de kyber** fait déjà le travail avant un nouveau format. Je n'ai pas regardé l'export ni `marketplace-kyber.mjs` ; à faire avant le § 5.2.
5. **Le journal comme simple ajout en fin de tour**, par le crochet qui recopie déjà les tours (`mirrorTurn`). Moins coûteux que mes lignes côté serveur comme première étape. Sa limite : il ne voit que les tours du chat natif, pas ceux de Telegram ni du cloud, ce que ma version couvre. Commencer par la leur, passer aux lignes de faits quand ces portes en auront besoin.
6. **Couches stables d'abord, non fiables en dernier**, pour le cache du prompt.

**Où cette étude diffère ou corrige :**
1. **« Le moteur n'expose pas de point de contrôle avant chaque appel d'outil aux plugins » (leur B3) n'est plus exact.** La couture existe et sert : `ctx.on('tools/pre-execute', turnGate(ctx))` dans `kybernos-cloud/index.js`, que DSH attend. Le vrai manque est sa **portée** : `turnGate` renvoie `next()` sauf si `KYBERNOS_COMPUTER_ID` est défini et que la session est une session de tour, donc elle ne protège que l'ordinateur cloud. **Sur le Mac de la personne (le chat natif de Kaby), rien ne demande au-delà du préréglage propre à DSH.** Donc « approbations avant scripts » veut dire élargir cette porte à la session native de Kaby et aux scripts de packs, sans patch moteur (la règle 1 du dépôt est respectée).
2. **« Maritime est fondé par l'autrice d'open-instinct »** n'est **pas vérifié** : la page ne dit pas qui la dirige et une recherche n'a rien donné. Je ne m'appuierais pas dessus ; le plafond d'éveillées, les régions non indiquées et le temps de réveil non mesuré suffisent (§ 7).
3. **Taille et rigueur du jeu d'essais** : ils commencent par une vingtaine de cas (un bon départ) ; j'ajoute la règle ferme que la série d'injection ne perd jamais un cas, et un budget de tokens mesuré pour les couches d'identité.
4. **Le cache du prompt** : les deux agencements placent une ligne par tour (l'heure) au milieu du prompt. Une ligne qui change à chaque tour casse le préfixe en cache qui la suit, et l'ADR 0049 compte séparément les tokens en cache. On ne sait pas comment DSH assemble le bloc d'identité (une trouvaille antérieure dit qu'il arrive comme un instantané de contexte avec le rôle utilisateur, pas dans le message système) : mesurer l'effet sur le cache avant et après.
5. **Capacités venant de l'adaptateur** : la ligne « canal » de la couche de situation devrait être générée depuis les `capabilities` de la porte (étude WhatsApp, § 5), pas écrite à la main pour chaque canal.

**Proposition fusionnée.** Leur ordre (A, puis les fichiers, puis les approbations, puis le format de pack, paiements et ordinateurs à réveil rapide plus tard) est le bon et je le garderais. Ajouter à leur volet A : la règle du « oui » périmé, la barrière chiffrée d'injection et la vérification du cache. Ajouter à leur B3 : « élargir `turnGate` à la session native de Kaby et aux scripts de packs », ce qui en fait un petit changement plutôt qu'une question de moteur. Garder leurs listes « un pack contient / ne contient jamais » ; ajouter d'ici la signature du pack, l'empreinte de script qui redemande quand un script change, et la différence de permissions à la mise à jour.

## 10. Non vérifié

Si DSH respecte `allowed-tools` et les serveurs MCP par pack (§ 5.3) ; les temps réels de création et de réveil de Maritime, ses régions, son contrôle de sortie réseau et son propriétaire (§ 7) ; les affirmations de Stripe sur l'approbation sans surveillance et Issuing pour agents (§ 6) ; l'estimation de coût pour 1 000 personnes (§ 7, tirée des grilles de prix) ; le coût réel en tokens des couches 1 à 5 (§ 4.1, un budget à mesurer, pas une mesure). Le jeu d'essais est une conception, pas un passage.

Sources : les trois dépôts open-instinct et les `ARCHITECTURE.md` / `PERMISSIONS.md` du premier (GitHub) ; les docs d'Open WebUI sur Tools, Skills et Knowledge ; les docs de Claude Code sur le manifeste de plugin et sur les skills ; les pages Link Agent Wallet de Stripe et TechCrunch (30 avril 2026) ; la page `maritime.sh` ; les pages de tarifs et de suspension/reprise de Fly ; l'ADR 0052 et l'ADR 0053 de kybernos-server.
