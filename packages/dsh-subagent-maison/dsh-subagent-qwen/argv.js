// Fabrique d'argv du run one-shot Qwen Code — pur, testable sans DSH.
// Qwen (Token Plan Alibaba, endpoint OpenAI-compatible) exige :
//   -y                      : exécute écriture/shell sans confirmation (yolo)
//   --auth-type openai      : mode clé API (pas OAuth navigateur)
//   --openai-api-key …      : la clé, fournie par le config du provider (env)
//   --openai-base-url …     : endpoint Token Plan (région ap-southeast-1)
// Aucune clé ni aucun modèle en dur : la clé vient de l'env (DASHSCOPE_API_KEY
// ou QWEN_TOKEN_PLAN_API_KEY) via le config du provider ; le modèle se règle
// dans le produit natif.
export const BASE_URL_DEFAUT = 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1'

export const argv = (bin, model, taches, opts = {}) => {
  const a = [bin, '-y', '--auth-type', 'openai']
  if (opts.apiKey != null && opts.apiKey !== '') a.push('--openai-api-key', opts.apiKey)
  a.push('--openai-base-url', opts.baseUrl ?? BASE_URL_DEFAUT)
  if (model != null && model !== '') a.push('-m', model)
  a.push('-p', taches.join('\n\n'))
  return a
}
