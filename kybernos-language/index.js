// kybernos-language — moitié hôte.
//
// Le client fait tout : sélection de la langue d'interface, génération des
// traductions par le modèle LLM actif (route hôte `POST /kybernos/i18n-translate`
// servie par @local/kybernos), cache local `kybernos.i18n.<lang>`, direction
// (dir/lang) posée sur <html>.
//
// Ce bundle est un satellite DÉBRANCHABLE : retiré du profil, il ne reste que
// la maquette fr/en livrée par @local/kybernos — aucune autre surface ne casse.
// La racine `kbt/kbf` vit dans @local/kybernos et lit `window.__KB_I18N_ACTIVE__`
// quand ce plugin est là, la table bilingue sinon.
export function apply() {}