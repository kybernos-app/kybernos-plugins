// Test a plugin's browser half FROM A WORKTREE on the real GUI, before it is merged.
//
// `dsh web` serves every plugin client as ONE combined request
//   /plugins/??@local/a/client.js,@local/b/client.js,…&rev=<hash>
// and the hash validates the exact list, so a combination of our own cannot be asked for. What can be
// done is to rewrite the RESPONSE: in a throw-away Chrome, intercept it over CDP and replace the text
// of a served file by the text of the same file in the worktree. Nothing is written anywhere (the
// shared tree, which is what the user's GUI loads, is never touched) and nothing but this browser sees
// the change. Host code (index.js) cannot be tested this way: it only loads when `dsh web` restarts.
//
//   const swap = await swapBundles(page, [{ name: 'kybernos-language' }])      // worktree = this repo
//   await page.send('Page.reload', {})
//   swap.report()   // → [{ file, replaced: true|false }]
//
// A file is found in the response by its text as served from `servedRoot` (default: the shared tree,
// i.e. the checkout `dsh web` runs from). If the shared tree has uncommitted edits of that file the
// text no longer matches what is served: `replaced` is then false and the caller must say so.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// The checkout `dsh web` runs from is the repository's MAIN working tree: the parent of the common git dir.
const mainWorkingTree = () => {
  try { return dirname(resolve(REPO, execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: REPO, encoding: 'utf8' }).trim())) } catch (e) { return REPO }
}
export const SHARED_TREE = process.env.KB_SHARED_TREE || mainWorkingTree()

/**
 * @param page   a CDP page from scripts/cdp-lib.mjs (see scripts/live-page.mjs)
 * @param list   [{ name: 'kybernos-language', file?: 'client.js' }]
 * @param opts   { servedRoot, mineRoot, extraPatterns }
 */
export async function swapBundles(page, list, opts = {}) {
  const servedRoot = opts.servedRoot || SHARED_TREE
  const mineRoot = opts.mineRoot || REPO
  const jobs = list.map((it) => {
    const rel = join('packages', it.name, it.file || 'client.js')
    return { file: rel, served: readFileSync(join(servedRoot, rel), 'utf8'), mine: readFileSync(join(mineRoot, rel), 'utf8'), replaced: false }
  })
  page.on('Fetch.requestPaused', async (p) => {
    // Other interceptors (the fake disk route of lib-language-flow.mjs) share the event: only the combined
    // plugin bundle, and only once its response is there, is ours.
    if (p.request.url.indexOf('/plugins/??') < 0 || p.responseStatusCode === undefined) return
    try {
      const answer = await page.send('Fetch.getResponseBody', { requestId: p.requestId })
      const body = answer.result // cdp-lib hands back the raw message: { id, result }
      let text = body.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body
      for (const j of jobs) {
        const at = text.indexOf(j.served)
        if (at >= 0) { text = text.slice(0, at) + j.mine + text.slice(at + j.served.length); j.replaced = true }
      }
      const headers = (p.responseHeaders || []).filter((h) => !/^(content-length|content-encoding|transfer-encoding)$/i.test(h.name))
      await page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: p.responseStatusCode || 200, responseHeaders: headers, body: Buffer.from(text, 'utf8').toString('base64') })
    } catch (e) {
      try { await page.send('Fetch.continueResponse', { requestId: p.requestId }) } catch (e2) { /* gone */ }
    }
  })
  // A bundle the browser already holds in its cache never reaches the interceptor: switch the cache off for this page.
  await page.send('Network.enable', {})
  await page.send('Network.setCacheDisabled', { cacheDisabled: true })
  // `Fetch.enable` replaces the patterns of an earlier call: whoever else intercepts passes theirs in `extraPatterns`.
  await page.send('Fetch.enable', { patterns: (opts.extraPatterns || []).concat([{ urlPattern: '*plugins/??*', requestStage: 'Response' }]) })
  return { report: () => jobs.map((j) => ({ file: j.file, replaced: j.replaced })) }
}
