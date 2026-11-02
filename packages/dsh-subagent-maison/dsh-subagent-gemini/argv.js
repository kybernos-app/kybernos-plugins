// Fabrique d'argv du run one-shot Gemini CLI (gemini --skip-trust -y -p) — pur,
// testable sans DSH. -y = exécute outils/écriture sans confirmation ;
// --skip-trust = headless dans un dossier non « trusted ». Auth par clé API
// (GEMINI_API_KEY en env, jamais en dur) — le compte Google gratuit est coupé
// par Google (IneligibleTierError), seule la clé API marche. Aucun modèle en dur.
export const argv = (bin, model, taches) => {
  const a = [bin, '--skip-trust', '-y']
  if (model != null && model !== '') a.push('-m', model)
  a.push('-p', taches.join('\n\n'))
  return a
}
