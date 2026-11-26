# Densities

Typical values in g/cm³, enough for a first estimate. A supplier's datasheet wins; say "about" in the page and keep the value in one place (the `kit.add` call).

| Material | g/cm³ | | Material | g/cm³ |
|---|---|---|---|---|
| Beech | 0.70 | | Steel (carbon) | 7.85 |
| Oak | 0.75 | | Stainless steel | 8.0 |
| Walnut | 0.65 | | Cast iron | 7.2 |
| Ash | 0.68 | | Aluminium | 2.70 |
| Pine | 0.50 | | Brass | 8.5 |
| Plywood (birch) | 0.68 | | Copper | 8.96 |
| MDF | 0.75 | | Titanium | 4.51 |
| ABS | 1.05 | | Glass | 2.5 |
| PLA | 1.24 | | Ceramic (porcelain) | 2.4 |
| Nylon (PA6) | 1.14 | | Rubber | 1.1 |
| Polypropylene | 0.90 | | Foam (upholstery) | 0.03 |

Wood is anisotropic and moist: the figure is for air-dried timber. A part that is hollow in reality (a drawer, a shell, a casting) weighs what its modelled volume says, so model the hollow.

Mass in grams: `volume_mm3 / 1000 * density` (the report already gives `mass_g`).
