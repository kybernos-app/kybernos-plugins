// Skill vetting, the settings: config.json checked field by field, three environment overrides for the judge's model and address.
// The judge's key is never in the file: `judge.keyEnv` names the environment variable that holds it (AGENTS rule 7).
import { readFileSync } from 'node:fs'

const POSITIVE = ['minBodyChars', 'shortBodyChars', 'maxSkillMdBytes', 'maxFolderBytes', 'maxFolderFiles', 'maxFrontmatterScan', 'githubGapMs', 'relayGapMs']
const JUDGE_POSITIVE = ['maxOutputTokens', 'timeoutMs', 'retryDelayMs', 'maxCallsPerRun', 'maxSkillChars']
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])$/

/** https, or http on a loopback address; no user name, no query, no fragment; returned without a trailing slash. Throws on anything else. */
export const checkBaseUrl = (value, label) => {
  let u
  try { u = new URL(String(value)) } catch (e) { throw new Error(`${label} is not a URL`) }
  const secure = u.protocol === 'https:' || (u.protocol === 'http:' && LOOPBACK.test(u.hostname))
  if (!secure) throw new Error(`${label} must be https (or http on this machine)`)
  if (u.username !== '' || u.password !== '' || u.search !== '' || u.hash !== '') throw new Error(`${label} must not carry a user name, a query or a fragment`)
  return u.origin + u.pathname.replace(/\/+$/, '')
}

const positive = (obj, keys, label) => {
  for (const k of keys) if (!Number.isInteger(obj[k]) || obj[k] <= 0) throw new Error(`${label}.${k} must be a positive integer`)
}
const modelName = (v, label, allowEmpty) => {
  if (allowEmpty && v === '') return ''
  if (typeof v !== 'string' || !/^[\w./:@+-]{1,120}$/.test(v)) throw new Error(`${label} is not a model id`)
  return v
}

/** The checked config. `raw` is the parsed config.json, `env` the process environment. */
export const checkConfig = (raw, env = {}) => {
  if (raw === null || typeof raw !== 'object' || raw.judge === null || typeof raw.judge !== 'object') throw new Error('config.json has no "judge" block')
  positive(raw, POSITIVE, 'config')
  positive(raw.judge, JUDGE_POSITIVE, 'judge')
  const j = raw.judge
  if (typeof j.temperature !== 'number' || j.temperature < 0 || j.temperature > 2) throw new Error('judge.temperature must be between 0 and 2')
  if (typeof j.keyEnv !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(j.keyEnv)) throw new Error('judge.keyEnv must name an environment variable')
  const fallbackEnv = env.VET_JUDGE_FALLBACK_MODEL
  return {
    ...raw,
    relayBase: checkBaseUrl(raw.relayBase, 'relayBase'),
    judge: {
      ...j,
      baseUrl: checkBaseUrl(env.VET_JUDGE_BASE_URL || j.baseUrl, 'judge.baseUrl'),
      model: modelName(env.VET_JUDGE_MODEL || j.model, 'judge.model', false),
      fallbackModel: modelName(fallbackEnv === 'none' ? '' : (fallbackEnv || j.fallbackModel || ''), 'judge.fallbackModel', true)
    }
  }
}

export const loadConfig = (file, env = process.env) => checkConfig(JSON.parse(readFileSync(file, 'utf8')), env)
