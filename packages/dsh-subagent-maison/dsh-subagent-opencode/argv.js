// Fabrique d'argv du run one-shot — pur, testable sans DSH. Aucun modèle en dur.
export const argv = (bin, model, taches) => {
  const a = [bin, 'run']
  if (model != null && model !== '') a.push('-m', model)
  a.push('--dangerously-skip-permissions', taches.join('\n\n'))
  return a
}
