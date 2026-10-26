// Skill vetting, the network half: GitHub (repository facts, the tree of a commit, one raw file) and the skills.sh audits through
// Kybernos's relay. Every function takes the `fetch` it uses, so the tests run on a fake one.
//
// Two rules learned the hard way (see docs/dev/skills-vetting.md): a burst of requests gets the address refused for a while, so every
// call waits its gap and the first refusal STOPS the stage instead of being retried; and a rate limit is never read as "the skill is gone".
export const SOURCE_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/
const SHA_RE = /^[0-9a-f]{40}$/

export class RateLimited extends Error {}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const AUDIT_STATUS = ['pass', 'warn', 'fail']

/** Counts of the audits of one skill: how many pass, warn, fail, which providers fail, and the date of the newest one. */
export const summariseAudits = (list) => {
  const out = { pass: 0, warn: 0, fail: 0, failed: [], latest: '' }
  for (const a of Array.isArray(list) ? list : []) {
    if (a === null || typeof a !== 'object' || AUDIT_STATUS.indexOf(a.status) < 0) continue
    out[a.status] += 1
    if (a.status === 'fail') out.failed.push(String(a.provider || 'unknown').slice(0, 40))
    if (typeof a.auditedAt === 'string' && a.auditedAt > out.latest) out.latest = a.auditedAt
  }
  out.latest = out.latest.slice(0, 10)
  return out
}

const pacer = (gapMs, sleep) => {
  let last = 0
  return async () => {
    const wait = gapMs - (Date.now() - last)
    if (wait > 0) await sleep(wait)
    last = Date.now()
  }
}

export const makeGithub = ({ fetchImpl = fetch, token = '', sleep = defaultSleep, gapMs = 300, timeoutMs = 20000 } = {}) => {
  const pace = pacer(gapMs, sleep)
  const headers = (accept) => ({ accept, 'user-agent': 'kybernos-vet-skills', ...(token === '' ? {} : { authorization: 'Bearer ' + token }) })
  const get = async (url, accept) => {
    await pace()
    let res
    try { res = await fetchImpl(url, { headers: headers(accept), signal: AbortSignal.timeout(timeoutMs) }) } catch (e) { return { status: 0 } }
    if (res.status === 429 || (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0')) throw new RateLimited('GitHub refused the request (rate limit): wait, or set GITHUB_TOKEN')
    return res
  }
  const api = (path, accept = 'application/vnd.github+json') => get('https://api.github.com' + path, accept)

  return {
    /** { status, archived, license }: 404 means gone, 0 means unreachable. */
    async repo(source) {
      const res = await api('/repos/' + source)
      if (res.status !== 200) return { status: res.status }
      const j = await res.json()
      return { status: 200, archived: j.archived === true, license: j.license !== null && j.license !== undefined && typeof j.license.spdx_id === 'string' ? j.license.spdx_id : null }
    },
    /** The commit HEAD points at, as a 40-hex sha (the tiny `sha` media type), or null. */
    async commit(source) {
      const res = await api('/repos/' + source + '/commits/HEAD', 'application/vnd.github.sha')
      if (res.status !== 200) return null
      const sha = (await res.text()).trim()
      return SHA_RE.test(sha) ? sha : null
    },
    /** The whole tree of a commit: { status, sha, truncated, entries: [{ path, type, sha, size }] }. */
    async tree(source, commit) {
      const res = await api('/repos/' + source + '/git/trees/' + commit + '?recursive=1')
      if (res.status !== 200) return { status: res.status, entries: [] }
      const j = await res.json()
      const entries = (Array.isArray(j.tree) ? j.tree : []).map((e) => ({ path: String(e.path), type: String(e.type), sha: String(e.sha), size: Number.isInteger(e.size) ? e.size : 0 }))
      return { status: 200, sha: String(j.sha), truncated: j.truncated === true, entries }
    },
    /** One file at a commit, as text cut to `maxBytes`; null when it cannot be read. Raw files are not part of the API rate limit. */
    async raw(source, ref, path, maxBytes = 256 * 1024) {
      await pace()
      let res
      try { res = await fetchImpl('https://raw.githubusercontent.com/' + source + '/' + ref + '/' + path.split('/').map(encodeURIComponent).join('/'), { headers: { 'user-agent': 'kybernos-vet-skills' }, signal: AbortSignal.timeout(timeoutMs) }) } catch (e) { return null }
      if (res.status !== 200) return null
      const text = await res.text()
      return text.length > maxBytes ? text.slice(0, maxBytes) : text
    }
  }
}

export const makeRelay = ({ base, fetchImpl = fetch, sleep = defaultSleep, gapMs = 2500, timeoutMs = 20000 } = {}) => {
  const pace = pacer(gapMs, sleep)
  let stopped = null
  return {
    get stopped() { return stopped },
    /** { ok: true, audits } (empty when nothing is published), or { ok: false } once the relay refused: the stage stops at the first refusal. */
    async audits(source, name) {
      if (stopped !== null) return { ok: false, skipped: true }
      await pace()
      let res
      try { res = await fetchImpl(base + '/skills/audit/' + source + '/' + name, { headers: { 'user-agent': 'kybernos-vet-skills' }, signal: AbortSignal.timeout(timeoutMs) }) } catch (e) { stopped = 0; return { ok: false } }
      if (res.status === 404) return { ok: true, audits: summariseAudits([]) }
      if (res.status !== 200) { stopped = res.status; return { ok: false } }
      let j
      try { j = await res.json() } catch (e) { stopped = 0; return { ok: false } }
      return { ok: true, audits: summariseAudits(j !== null && typeof j === 'object' ? j.audits : []) }
    }
  }
}
