# Triage des remontées de bugs — 28/10/2026, 18:45 (reprise après redémarrage DSH)

**Source :** `~/.dsh/tools/collecte-bugs.mjs` (run 18:35, sans réseau) — 5 fiches en file, **2 nouvelles** arrivées après le run de 03:15.
**Statut :** fiches examinées et qualifiées ; **aucune correction de code appliquée** (décision utilisateur en attente).
**Envoi vers le relais Kybernos :** non retenté (relais `github_indisponible` constaté le 27/10).

## Tableau

| Fiche | Gravité | Verdict | Preuve mesurée | Geste à faire |
|---|---|---|---|---|
| `beta:93953fad…` — « Error: glob search failed … /Users/miled/dyad-apps/dsh-kybernos » vue dans les réflexions | **P2** (bloque tout travail fichier, contournable en changeant d'espace) | **Bug confirmé, reproduit** | **6 espaces sur 13** de `~/.dsh/storages/workspace.json` pointent sur des dossiers supprimés : `/Users/miled/dyad-apps/dsh-kybernos` (264 sessions), `…/testing` (57), `…/temp` (28), `…/llm-orchestrator-mcp` (8), `…/enerteam-poc-report` (2), `…/trading-bot` (0). Reproduction : `glob` sur le chemin supprimé rend mot pour mot `glob search failed (exit 2): rg: … No such file or directory (os error 2)` | (1) À l'ouverture d'une session, cwd inexistant ⇒ message clair + choix d'espace, au lieu du stderr brut ; (2) relier un espace à son dossier renommé (les 6 ci-dessus) ; (3) garde dans le collector/GUI pour ne pas offrir un espace mort |
| `beta:a1e9eec2…` — « une session qui crée une session devrait rester dans le même répertoire (ou proposer) » | **P3** (amélioration, gêne récurrente) | **Amélioration réelle, cause trouvée** | `session/create` accepte `cwd` **ou** `workspaceId` (`dsh-api-session-controller` : `createSession(request)`, `defaultCwd` utilisé quand aucun des deux n'est nommé) ; les appels du plugin passent `{}` : `packages/kybernos-plugin/index.js:3402` (`sc.create({})`) et `gateway-watcher.mjs:585` (`rpc('session/create', { request: {} })`) | Transmettre le cwd de la session parente (ou le `workspaceId` de la tâche) ; si aucun n'est résoluble, **proposer** au lieu de retomber sur l'espace par défaut |

## Ce qui reste de la file

- **P2 « bloc Workspaces recouvre le bloc natif »** (run 03:15) : toujours **à reproduire** — pas de capture, protocole de repro joint à la note du matin. Aucun correctif ne se pose sans mesure.
- **Jauge quota 100 % rouge** (27/10) : **réfutée** — comportement voulu, documenté (`docs/dev/servers.md:142`) et verrouillé (`packages/kybernos-cloud/test-quota-notice.mjs:163-164`). Reste une **décision produit** (jauge contextuelle selon la route active), pas un bug.

## Signaux qualité

- 2 notes basses (`~/.dsh/kybernos/quality/rating.jsonl`), toutes deux motif **`verbose`** (3/5 puis 2/5, commentaires « bcp d'infos », « devrai réondre de manère simple »).
- 3 pouces (2 négatifs, 1 positif) sur octobre, sans extrait de texte : non exploitables tels quels.

## Non prouvé

- Que les sessions de l'ancien espace soient **toutes** bloquées : 264 sessions l'hébergent, mais seules celles relancées dans ce cwd échouent ; le rapport d'origine ne dit pas laquelle.
- Le lien exact entre le texte vu « dans les réflexions » et le flux d'outils : la reproduction prouve le message, pas la surface d'affichage.

---

## Correctifs livrés — 28/10, 19:05 (même session, après accord)

### A · `beta:93953fad` — dossier disparu : dire, marquer, relier

- **Hôte** : route `GET /kybernos/workspaces-health` → une ligne par espace `{ workspaceId, path, exists }` ; règle extraite en module pur `packages/kybernos-plugin/workspace-health.mjs` (`workspaceHealthRows`), testée sans moteur.
- **Page Projets** : bandeau « 6 dossiers introuvables » + phrase d'explication + bouton **« Relier un dossier… »** (sélecteur natif → `workspaces.create({path})`, jamais de réécriture silencieuse) ; chaque carte d'un dossier disparu porte le badge **« Dossier introuvable »** (jeton de thème, aucune couleur littérale).
- **Preuve live** : `node scripts/check-workspaces-health-live.mjs` → **11/11 asserts verts** sur la GUI réelle : route OK, 6 manquants exacts, bandeau = compte annoncé, bouton présent, **6 badges sur les deux pages**, couleurs de thème. Capture sombre : `/tmp/kb-ws-shots/workspaces-missing.png`.
- **Non joué** : le clic « Relier un dossier… » (ouvre le sélecteur natif sur la machine) et le thème clair (changer le thème persiste dans le profil).

### B · `beta:a1e9eec2` — une session fille reste dans le dossier

- **Règle pure** `requestedWorkspaceId` (module ci-dessus) : l'id nommé par le client est honoré s'il existe au registre, sinon ignoré (on retombe sur le défaut du moteur, jamais une erreur) — testé.
- **Hôte** : l'action `start-chat` (`packages/kybernos-plugin/index.js`) passe `{ workspaceId }` au `sessionController` (contrat vérifié : `create({workspaceId})` dans `dsh-api-session-controller`).
- **Client** : `kbCurrentWorkspaceId()` (espace de la session à l'écran) remplace « l'espace le plus récent » comme cible de `kbShellStartSession`, et est transmis par `kbCreerSessionVierge` aux deux voies (shell + hôte).
- **Non joué de bout en bout** : le clic qui crée une session (créerait une session vide dans l'historique de la personne) ; la règle et le contrat moteur sont testés, le parcours est lu.

### État de la suite

`node scripts/run-all-tests.mjs` : **531 verts / 5 rouges**, les 5 rouges appartiennent à l'autre chantier en cours (`BUILTIN_API` : `api.kybernos.app` ≠ `server.kybernos.app`, retrait de patchs) — aucun ne touche les espaces.
