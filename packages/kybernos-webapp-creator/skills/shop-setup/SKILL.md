---
name: shop-setup
description: "Configurer la boutique d'un shop.json : import de produits tolérant, palette appliquée, images validées — sans écrire une ligne de code. Use when a shop.json exists and the shop must be filled before going live."
---

# shop-setup — remplir la boutique, jamais coder

Entrée : `shop.json` (skill `shop-brief`). Sortie : la boutique prête à être mise en ligne par
`shop-live`. Tout passe par les API du gabarit `commerce` — zéro fichier de code touché.

## 1. Produits (l'import tolère le réel)

Importer CSV/JSON avec ses défauts assumés : prix « 12,90 € » ou « 12.90 » convertis en centimes,
colonnes manquantes = valeurs par défaut, **doublons de SKU signalés** (jamais fondus en silence).
Chaque produit : `nom` (≤200), `description`, `prix_cents`, `stock`. Un rapport d'erreurs honnête
termine l'import (« 47 lignes importées, 3 corrigées, 1 refusée : … »).

## 2. Palette

La palette de `shop.json` s'applique en tokens (`--tk-*`) : elle est lue par la vitrine au chargement.
Pour un secteur donné, partir de la palette du kit (le layout s'habille sans changer) et n'ajuster
que l'accent. Jamais de couleur en dur dans les sections.

## 3. Images

Upload par data-URL vers `POST /api/medias` — la chaîne **sniffe les octets magiques** (PNG/JPEG/WebP),
refuse au-delà de 500 Ko, et stocke hors racine publique. Rattacher par
`POST /api/produits/:id/image {media_id}`. Une image refusée se dit au user, elle ne se contourne pas.

## 4. Valider

Rejouer la suite de conformité du paquet (`node test-templates.mjs`) : elle vérifie produits,
réservation, webhooks et vitrine. Verte seulement = prêt pour `shop-live`.
