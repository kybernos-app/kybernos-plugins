// Fabrique d'argv du run one-shot — pur, testable sans DSH. Aucun modèle en dur.
export const argv = (bin, model, taches) => {
  const a = [bin]
  if (model != null && model !== '') a.push('-m', model)
  a.push('-p', taches.join('\n\n'))
  return a
}
