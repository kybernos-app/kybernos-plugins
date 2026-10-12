// kybernos-websearch: host half.
//
// Registers ONE search provider with DSH's web seam (`ctx.web`) and keeps the choice among engines inside it, so that
// `web_search` works with no key at all and gets better with one. Routes for the Settings page: /kybernos-websearch/*.
//
// Keys go to DSH's credentials store (the same one the Models page writes), under the conventional names
// (BRAVE_API_KEY, TAVILY_API_KEY…): a key the person already exported is found without being entered again.
//
// Settings: <DSH_HOME>/kybernos/websearch/settings.json (no secret in it).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { createWebSearch, mountRoutes, PROVIDER_ID } from './host.mjs'
import { makeHttp } from './net.mjs'

export const name = 'kybernos-websearch'

const dshHome = () => process.env.DSH_HOME || join(homedir(), '.dsh')
export const settingsFile = () => join(dshHome(), 'kybernos', 'websearch', 'settings.json')

const readJsonFile = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch (e) { return null } }
const writeJsonFile = (file, doc) => {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = file + '.' + process.pid + '.tmp'
  writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n', { mode: 0o600 })
  renameSync(tmp, file)
}

/** The I/O the service needs, from DSH's context. Every read of a service happens at call time: DSH may publish it after us. */
export function ioOf (ctx, state = { registered: false }) {
  const credentials = () => { try { return ctx.get('credentials') || null } catch (e) { return null } }
  return {
    read: () => readJsonFile(settingsFile()),
    write: (doc) => writeJsonFile(settingsFile(), doc),
    resolveKey: async (ref) => {
      const svc = credentials()
      if (svc !== null && typeof svc.resolve === 'function') {
        const r = await svc.resolve(ref)
        if (r !== undefined && r !== null && typeof r.value === 'string' && r.value !== '') return r.value
      }
      const env = process.env[ref]
      return typeof env === 'string' && env !== '' ? env : null
    },
    describeKey: async (ref) => {
      const svc = credentials()
      if (svc !== null && typeof svc.describe === 'function') {
        const d = await svc.describe(ref)
        if (d !== undefined && d !== null) return { configured: d.configured === true, source: typeof d.source === 'string' ? d.source : null }
      }
      const env = process.env[ref]
      return { configured: typeof env === 'string' && env !== '', source: 'env' }
    },
    setKey: async (ref, value) => {
      const svc = credentials()
      if (svc === null || typeof svc.set !== 'function') throw new Error('credentials store unavailable')
      await svc.set(ref, value)
    },
    unsetKey: async (ref) => {
      const svc = credentials()
      if (svc === null || typeof svc.unset !== 'function') throw new Error('credentials store unavailable')
      await svc.unset(ref)
    },
    http: makeHttp(),
    seamSearch: async (query) => {
      const web = ctx.get('web')
      if (web === undefined || web === null || typeof web.search !== 'function') throw Object.assign(new Error('the web seam is not available'), { code: 'NO_SEAM' })
      return web.search({ query, maxResults: 3 })
    },
    seam: () => {
      let pinned = null
      try {
        const web = ctx.get('web')
        if (web !== undefined && web !== null && typeof web.searchProviderId === 'string') pinned = web.searchProviderId
      } catch (e) { /* no web seam */ }
      return { registered: state.registered, pinned }
    }
  }
}

export function apply (ctx) {
  try {
    const state = { registered: false }
    const svc = createWebSearch(ioOf(ctx, state))

    // The provider: registered when the web seam is there, and again if it is ever rebuilt.
    ctx.inject(['web'], (c) => {
      try {
        const web = c.web !== undefined ? c.web : ctx.get('web')
        web.registerSearchProvider(svc.provider)
        state.registered = true
        console.log('[kybernos-websearch] search provider "' + PROVIDER_ID + '" registered')
      } catch (e) {
        state.registered = false
        console.error('[kybernos-websearch] search provider not registered: ' + String((e && e.message) || e))
      }
    })

    // The Settings page's routes. A DSH with no web server goes without the page and still searches.
    // The service is read with `ctx.get`: a property read (`ctx.webServer`) throws when the plugin did not declare the
    // injection, which is what a hot activation hits (measured on the real DSH, 2026-10-12).
    const mountOn = (server) => {
      try {
        if (server === undefined || server === null) throw new Error('no web server')
        mountRoutes(server, svc, (fn, label) => ctx.effect(fn, label))
      } catch (e) {
        console.error('[kybernos-websearch] routes not mounted: ' + String((e && e.message) || e))
      }
    }
    const direct = ctx.get('webServer')
    if (direct !== undefined && direct !== null) mountOn(direct)
    else {
      ctx.inject(['webServer'], (c) => {
        let server
        try { server = c.webServer } catch (e) { server = undefined }
        if ((server === undefined || server === null) && typeof c.get === 'function') server = c.get('webServer')
        mountOn(server)
      })
    }
  } catch (e) {
    console.log('[kybernos-websearch] disabled: ' + String((e && e.message) || e))
  }
}
