// kybernos-refs — moitié hôte.
//
// V1 : le client fait tout (transformation DOM des liens markdown des messages
// en pastilles de fin de phrase, maquette v3 docs/handoff/references-epurees/
// maquette-v3). Le fichier hôte est obligatoire pour le manifest mais reste
// vide — même convention que kybernos-theme.
//
// Prévu en v2 (documenté ici pour ne pas le perdre) :
//   - une bascule « pastilles ↔ liens » persistée (l'équivalent du #bascule
//     de la maquette), posée dans le menu d'apparence ;
//   - la récupération du titre réel des pages côté hôte (aujourd'hui le titre
//     de la carte est le texte du lien).
export function apply() {}
