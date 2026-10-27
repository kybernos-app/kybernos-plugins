---
name: webapp-publish
description: "Publier une app construite sur son lien *.kaby.app : mode d'accès, slug, test de fumée depuis l'extérieur, et la dépublication. Use when the app is built and the person wants it live on its link."
---

# webapp-publish — du local au lien, sans surprise

Le domaine est `kaby.app` (commandé le 2026-10-27, wildcard `*.kaby.app`).
Publier, c'est exposer une app à Internet : ce skill est le garde-fou.

## Avant tout (contraintes critiques)

- **L'accès est confirmé à voix haute** : « clé de lien » (défaut) ou « public » —
  jamais de publication sur une supposition. `donnees: personnel` → la clé est
  OBLIGATOIRE, quel que soit le souhait.
- **Slug** : un label, minuscules, 32 caractères max, mots réservés refusés
  (www, api, app, kaby, admin, mail, static) ; vérifier qu'il est libre avant de le
  réserver.
- **Pas de publication sans passe UI verte** : la DoD de `webapp-build` est la
  condition, pas une formalité.

## Le parcours

1. **Réserver le slug** (dépublier = le libérer).
2. **Publier** via le runtime d'apps : `https://<slug>.kaby.app` (+ la clé si
   `acces: cle`).
3. **Test de fumée depuis l'extérieur** (curl, pas le navigateur local) :
   - `200` avec la clé, **page de refus sans la clé** (la preuve, c'est le refus) ;
   - TLS valide partout (le TLD `.app` est HSTS-preload : il n'y a pas, il n'y aura
     jamais de HTTP) ;
   - une écriture de démo visible dans la mini base après rechargement.
4. **Rapport court** : le lien, le mode d'accès, la commande de dépublication, et
   où vivent les données (la mini base reste locale, chez la personne).

## Vie de l'app

- Une MAJ de code = re-publier ; la version précédente reste récupérable
  (retour arrière).
- Toute suppression se dit : le lien affiche une page explicite, jamais un trou.
- Une app qui ne se met plus à jour depuis 90 jours reçoit un rappel avant pause.
