---
name: shop-live
description: "Mettre la boutique en ligne : artefact sans secrets, déploiement, smoke test et CHRONO affiché. Use when the shop is configured and the person wants it live or testable on its link."
---

# shop-live — en ligne, prouvé, chronométré

Entrée : la boutique configurée (skill `shop-setup`). Sortie : un storefront accessible, un smoke
test vert, et le **chrono honnête** « brief → boutique vivante ».

## 1. L'artefact (porte fermée)

`node --input-type=module -e "import { buildDeploy, verifyDeploy } from '<paquet>/lib/deploy.mjs'; …"`
: le snapshot est vérifié par sommes SHA-256 et **refuse tout secret** (`.env`, clés Stripe) —
un refus du scan est une porte fermée, pas un avertissement.

## 2. La cible (le user choisit)

- **Son ordinateur exposé** : le runtime démarre l'app (gratuit ; le site dort avec l'ordinateur) ;
- **Fly.io** : provisioning de la machine (⚠️ **token requis — action du user**), secrets injectés
  hors dépôt, volume pour la mini base ;
- **Son Kybernos Computer** quand il en a un.

## 3. Le smoke test (obligatoire avant de dire « en ligne »)

1. La vitrine répond 200 et affiche les produits de la base ;
2. **Une commande de test réserve le stock** (la dispo baisse, le stock attend le paiement) ;
3. **Un webhook de paiement rejoué n'envoie pas de second email** (la table `emails` reste à 1) ;
4. Sans la clé d'accès, un refus quand `acces: cle`.

## 4. Le chrono (le produit se mesure)

Chronométrer le parcours réel : premier mot du brief → storefront de test vivant et smoke-testé.
Afficher « brief → boutique : X min Y s » avec ce que le sablier contenait — et dire en une ligne
ce qui en était **hors** (domaine personnalisé, activation Stripe, mentions légales). Un chrono qui
triche est un chrono qui ment.
