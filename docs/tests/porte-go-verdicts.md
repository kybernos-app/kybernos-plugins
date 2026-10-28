# Porte GO — pass 2 : verdicts et arbitrages (phase A)

Run `dev-team-a5-et-porte` (duo: `opencode-go/deepseek-v4.1-flash` rédacteur A5,
`xiaomi-token-plan-ams/mimo-v2.6-pro` validateur), 2026-10-28 ~02:10. Ce document
rassemble les verdicts sur les SEPT specs et réduit les 33 ambiguïtés signalées à
la liste réelle des décisions du owner. Rien ne part en implémentation avant ces
arbitrages (doctrine fail-closed) ; le cycle de correction n°2 (borné à 2) part
après.

## 1. Verdicts

| Spec | Verdict | Blame | Cause racine (une ligne) |
|---|---|---|---|
| A1-theme-seam | **AMEND** | spec-error | la table de corrections propage une erreur (« pas de `appliquerTout` » alors qu'il est à :3954), 37 clés SETTINGS_KEYS et non 40, deux épingles périmées dans kybernos-plugin |
| A1-kit-wizard | **AMEND** | exploration-error | 48/67 ancrages périmés (les bannières de nommage ont décalé les lignes ; l'arbre jugé porte aussi un diff non commité de +338 lignes) |
| A2-pack-format | **AMEND** | spec-error | les 12 épingles de la zone de routes sont fausses aux deux points de référence ; l'assurance « les ancrages empruntés tombent toujours justes » est mesurée fausse |
| A2-registry-points | **AMEND** | exploration-error | baseline falsifiée : « tous exit 0 » est faux — `test-layout` exit 1 (kybernos-log), `test-plugin-scan` exit 1 (kybernos-pulse), run-all-tests = **6 ROUGES** avant tout code |
| A3-vertical-content | **AMEND** | spec-error | la prétendue dépendance A2 est fausse (double patch de test-domain-pack.mjs), 8 ancrages erronés, et les maquettes existent MAINTENANT (le hex d'accent recrutement doit en être cité) |
| A4-starter-docs | **NO-GO** | spec-error | contrat gelé auto-contradictoire (note de tête vs corps : trois voix sur un livrable) — inimplétable tel quel |
| A5-style-rename | **AMEND** | spec-error | deux scripts cités au mauvais chemin, « 40 clés » = 37, chemin vers 0 rouge mal décrit ; séquencement A5 en dernier = correct et commandé |

Points forts mesurés par le validateur (à conserver lors de la correction) :
les DoD sont discriminantes partout (chaque commande échoue aujourd'hui pour la
raison exacte citée), zéro « déjà vert », la posture fail-closed de A2 est tenue,
A5 est la spec la mieux mesurée du lot.

## 2. Décisions à trancher (owner) — la vraie liste

### A. Méthode (1 décision, 5 specs)
1. **Épinglage des ancrages** : ancrer chaque spec sur un **SHA de base** (2ac67fb4)
   déclaré dans son en-tête + ré-épingler à l'ouverture de l'implémentation.
   *Reco : les deux — le SHA rend les specs vérifiables pour toujours, le
   ré-épinglage couvre le diff en cours.*

### B. A4 — les deux lectures BINDING (racine du NO-GO)
2. **Forme du fichier de thème du starter** : l'entrée complète de catalogue
   (note de tête) **ou** `{ id, name, settings }` (corps + A1 I7) ?
   *Reco : le corps — `sanitizePreset` rejette `description` : l'entrée complète
   perdrait de la donnée en silence.*
3. **Clé de la table de la page** : les lettres I1..I5 (corps, DoD D4) **ou** les
   ids de points (note de tête) ? *Reco : les ids de points, et **retirer les
   lettres I** partout (elles sont surchargées : trois specs le signalent
   indépendamment).*

### C. A2-pack-format — le BLOQUANT
4. **`index.js:30`** (la ligne d'import unique des domain-packs) : accorder la
   ligne au périmètre *Reco : oui — ce n'est ni une route ni une garde* — ou
   re-scoper le lot à la moitié bibliothèque (les e2e 2-4 tombent).

### D. Contenu et design
5. **Hex d'accent recrutement** : les maquettes existent désormais
   (`docs/handoff/theme-recrutement-ssii/maquette-v1`) — l'accent dessiné est
   `#4F5BD5`, marqué proposition. *Reco : le citer depuis la maquette et le
   marquer « proposal » — ou donner le hex métier officiel.*
6. **Les deux verticales** : campagne = `sante` + `recrutement` (décision déjà
   prise par le owner le 2026-10-27) — la stratégie a été alignée. Ratification
   de forme.

### E. A5 — migration (1 décision réelle)
7. **Base installée** : sans migration + note de release (lane B) **ou** carte de
   renommage dans l'aligneur (migration de profil, lane A) ?
   *Reco : lane B — aucune base installée significative à ce jour.*
8. *Défauts A5 restants à ratifier* : routes/ids renommés avec le paquet (oui) ;
   le fichier `theme-presets.json` garde son nom (oui) ; le wording des skins
   reporté (oui).

### F. A1 — défauts de couture à ratifier (5 items)
9. Nom de thème déjà pris par la personne → jamais toucher l'enregistrement
   « me », id suffixé (exception à l'idempotence) ; bag sans id → entrée « Mes
   styles » localisée ; store hors-ligne → enregistrement local, l'apply
   réussit ; `source` du thème de pack → vocabulaire existant (`gallery`/`file`) ;
   affichage Kit → une ligne non interactive sans nom de preset ; consentement →
   le thème monte avec kitApply (« Pas maintenant » le saute).
   *Reco : ratifier tous ces défauts — ils sont cohérents entre eux.*

### G. Hygiène du dépôt (bloquant lointain mais réel)
10. **run-all-tests = 6 ROUGES avant tout code** : kybernos-log (bundle non
    tracké du chantier voisin), kybernos-pulse (exec non déclaré), + 2 littéraux
    français d'un diff non commité, + 3 fichiers non attribués. La règle « 0
    rouge avant merge » ne peut pas passer tant que ce n'est pas attribué :
    soit la session voisine les termine, soit on les tickette aujourd'hui.

## 3. Ce qui est déjà tranché par les faits
- Les maquettes existent (régénérées le 28/10 dans le repo actif) : les AMBIGUITY
  « maquettes absentes » de A1-kit-wizard et A3 sont résolues — elles deviennent
  la référence de design du Kit et de l'accent recrutement.
- Les deux verticales = `sante` + `recrutement` (décision owner du 27/10,
  stratégie alignée le 28/10).
