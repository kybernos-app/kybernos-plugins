/**
 * dsh-media-player — moitié hôte.
 *
 * Le plugin est purement client : il n'ajoute qu'un renderer d'aperçu dans la
 * page (aucune route, aucun service, aucun outil). La moitié hôte existe parce
 * que le chargeur de profil compose ce paquet comme une entrée ordinaire ;
 * `apply` n'a donc rien à faire et ne doit surtout rien démarrer.
 */
export const name = 'dsh-media-player'

/** No-op : tout le travail vit dans `client/client.js`. */
export function apply() {}
