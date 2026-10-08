// Fabrique d'argv du run one-shot Hermes (hermes -m <modèle> -z PROMPT) — pur,
// testable sans DSH. Aucun nom de modèle en dur (politique) : le modèle vient du
// config/ENV du provider, ou est découvert à l'exécution (trouverModeleFree sur
// le portail) car le défaut du portail est cassé (404) et les payants exigent
// des crédits. `-m` doit PRÉCÉDER `-z` (sinon -z avale l'argument).
export const argv = (bin, model, taches) => {
  const a = [bin]
  if (model != null && model !== '') a.push('-m', model)
  a.push('-z', taches.join('\n\n'))
  return a
}
