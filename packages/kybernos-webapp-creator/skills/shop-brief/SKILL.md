---
name: shop-brief
description: "Cadrer une boutique en ligne en 5 questions fermées et produire shop.json (nom, slogan, secteur, palette, accès). Use when the person asks for a shop, a boutique, an online store (« je veux vendre… », « une boutique… »)."
---

# shop-brief — la boutique cadrée en 45 secondes

Le sablier du produit : brief 45 s · config 1:15 · produits 1:30 · en ligne 1:30. Ce skill couvre
le brief ; `shop-setup` prend le relais. Jamais plus de **5 questions fermées**.

## Les questions (choix proposés, jamais « décrivez-moi »)

1. **Secteur** : mode · alimentation · artisanat · beauté · santé · tech · maison · sport · services ;
2. **Identité** : le nom (saisie libre, la seule) et un slogan parmi 3 propositions ;
3. **Catalogue** : d'où viennent les produits ? CSV · saisie au chat · « je les ajoute après » ;
4. **Palette** : montrer les aperçus du kit par domaine — le user **choisit des yeux** ;
5. **Accès** : boutique ouverte (défaut) ou protégée par clé.

## Écrire `shop.json` (à côté du brief `webapp.json`)

```json
{
  "version": 1,
  "nom": "Atelier Café",
  "slogan": "Le café, honnête et vivant.",
  "annonce": "Livraison offerte dès 45 €",
  "sections": ["announcement", "header", "hero", "chips", "products", "cart", "best", "faq", "footer"],
  "palette": { "paper": "#f7f2e9", "accent": "#b4551f", "ink": "#241a12" }
}
```

## Règles

- La palette = des **valeurs de tokens** (`--tk-*`), jamais du CSS libre ; une palette de domaine
  du kit se copie et s'ajuste d'un accent.
- `acces: cle` si le catalogue touche santé, droit, contacts, paiements (RGPD — non négociable).
- Ce qui n'est pas dans `shop.json` n'existe pas ; une envie en cours de route met à jour le fichier.
- Terminer par : « Brief posé — je configure ? » et passer la main à `shop-setup`.
