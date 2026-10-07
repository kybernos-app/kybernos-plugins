// Fabrique d'argv du run one-shot Hermes (hermes -z PROMPT) — pur, testable
// sans DSH. Aucun modèle en dur : `-m` seulement si le produit en reçoit un.
// Le mode `serve` n'existe pas dans hermes-agent 0.21 : le one-shot est `-z`.
export const argv = (bin, model, taches) => {
  const a = [bin, '-z']
  if (model != null && model !== '') a.push('-m', model)
  a.push(taches.join('\n\n'))
  return a
}
