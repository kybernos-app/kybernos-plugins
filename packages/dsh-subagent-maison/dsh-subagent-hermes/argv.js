// Fabrique d'argv du run one-shot Hermes — pur, testable sans DSH.
// NOTE : Hermes a un mode `serve` (backend headless) — câblage client serveur
// NON FAIT tant que la CLI `hermes` n'est pas installée ici. En attendant, on
// utilise le mode prompt one-shot. À réviser quand `hermes` sera présent.
export const argv = (bin, model, taches) => {
  const a = [bin]
  if (model != null && model !== '') a.push('-m', model)
  a.push(taches.join('\n\n'))
  return a
}
