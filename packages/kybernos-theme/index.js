// kybernos-theme — moitié hôte.
//
// V1 : le client fait tout (jetons via overrideTokens, fond d'écran, police,
// persistance localStorage). Le fichier hôte est obligatoire pour le manifest
// mais peut rester vide — voir la convention des paquets locaux.
//
// Prévu en v2 (documenté ici pour ne pas le perdre) :
//   - routes HTTP propres /kybernos-theme/{config,wallpaper} pour une
//     persistance durable hors navigateur (DSH Desktop utilise des ports
//     aléatoires, localStorage ne suffit alors plus — le constat est celui de
//     dsh-wallpaper-engine) ;
//   - webserver/index-inject pour l'anti-flash avant hydratation.
export function apply() {}
