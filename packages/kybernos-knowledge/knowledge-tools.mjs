// ═══════════════════════════════════════════════════════════════════════════
// kybernos-knowledge — DSH agent tools (`knowledge_search`, `knowledge_list`).
//
// Read-only tools registered on DSH's `tools` service via the same defineTool
// / literalDefinition seam used by kybernos-front-desk.
// ═══════════════════════════════════════════════════════════════════════════

import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const TOOL_SEARCH = 'knowledge_search'
export const TOOL_LIST = 'knowledge_list'

const candidates = (home) => [
  join(home, 'profiles', 'web', 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js'),
  '/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js',
  '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js'
]

async function loadDefineTool (home) {
  for (const file of candidates(home)) {
    if (!existsSync(file)) continue
    try {
      const m = await import(file)
      if (typeof m?.defineTool === 'function') return m.defineTool
    } catch { /* fallback to literalDefinition */ }
  }
  return undefined
}

export const literalDefinition = (o) => ({
  name: o.name,
  description: o.description,
  parameters: { type: 'object', properties: o.parameters, required: o.required || [] },
  output: { schema: {}, render: (args, value) => o.render(args, value) },
  execute: o.execute
})

export const specDefinition = (o) => ({
  name: o.name,
  description: o.description,
  parameters: o.parameters,
  output: { schema: { type: 'json' }, render: (args, value) => o.render(args, value) },
  execute: o.execute
})

export function buildKnowledgeTools (store) {
  const searchSpec = {
    name: TOOL_SEARCH,
    description: 'Search the local Kybernos knowledge base (indexed workspace Markdown, text, CSV, DOCX, and PDF documents) and return citable passages.',
    parameters: {
      query: { type: 'string', description: 'Search query (keywords or phrase).' },
      collection: { type: 'string', description: 'Optional collection ID or name to restrict the search.' },
      frontDeskOnly: { type: 'boolean', description: 'When true, search only collections shared with Front Desk.' },
      limit: { type: 'number', description: 'Maximum passages to return (1-10, default 6).' }
    },
    required: ['query'],
    execute: async (args = {}) => {
      const q = typeof args.query === 'string' ? args.query.trim() : ''
      if (q === '') return { ok: false, error: 'query-required', results: [] }
      const limit = Math.max(1, Math.min(10, Number(args.limit) || 6))
      return store.search({
        query: q,
        collection: typeof args.collection === 'string' ? args.collection : '',
        frontDeskOnly: args.frontDeskOnly === true,
        limit
      })
    },
    render: (_args, value) => {
      if (!value || value.ok === false) return 'Knowledge search error: ' + String((value && value.error) || 'unknown')
      if (!Array.isArray(value.results) || value.results.length === 0) {
        return 'No matching passages found in the local knowledge base for "' + String(value.query || '') + '".'
      }
      const lines = ['Knowledge base hits (' + value.results.length + ' of ' + value.totalHits + '):']
      for (let i = 0; i < value.results.length; i += 1) {
        const r = value.results[i]
        lines.push('[' + (i + 1) + '] ' + r.citation + ' (score ' + r.score + ')')
        lines.push('    ' + r.snippet)
      }
      return lines.join('\n')
    }
  }

  const listSpec = {
    name: TOOL_LIST,
    description: 'List indexed local knowledge collections and, optionally, the documents inside a given collection.',
    parameters: {
      collection: { type: 'string', description: 'Optional collection ID or name to inspect its indexed documents.' }
    },
    required: [],
    execute: async (args = {}) => {
      const col = typeof args.collection === 'string' ? args.collection.trim() : ''
      if (col !== '') return store.listDocuments(col)
      return { ok: true, collections: store.listCollections() }
    },
    render: (_args, value) => {
      if (!value || value.ok === false) return 'Knowledge list error: ' + String((value && value.error) || 'unknown')
      if (Array.isArray(value.documents)) {
        const header = 'Collection "' + value.collection.name + '" (' + value.documents.length + ' documents, wiki: ' + value.collection.wikiPath + '):'
        if (value.documents.length === 0) return header + '\n(no supported documents indexed)'
        return [header, ...value.documents.slice(0, 40).map((d) => '- ' + d.relPath + ' (' + d.format + ', ' + d.chunks + ' chunks)')].join('\n')
      }
      const cols = Array.isArray(value.collections) ? value.collections : []
      if (cols.length === 0) return 'No local knowledge collections are configured yet.'
      return [
        'Local knowledge collections (' + cols.length + '):',
        ...cols.map((c) => '- ' + c.id + ' ("' + c.name + '"): ' + c.docCount + ' docs, ' + c.chunkCount + ' chunks' + (c.includeFrontDesk ? ' [front-desk]' : '') + ' · wiki: ' + c.wikiPath)
      ].join('\n')
    }
  }

  return [searchSpec, listSpec]
}

export async function registerKnowledgeTools (tools, store, home, log = () => {}) {
  const defineTool = await loadDefineTool(home)
  const specs = buildKnowledgeTools(store)
  const disposers = []
  for (const spec of specs) {
    const def = defineTool !== undefined ? defineTool(specDefinition(spec)) : literalDefinition(spec)
    const off = tools.register(def)
    if (typeof off === 'function') disposers.push(off)
    log('tool "' + spec.name + '" registered')
  }
  return () => { for (const off of disposers.splice(0).reverse()) { try { off() } catch { /* ignore */ } } }
}
