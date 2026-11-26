// kybernos-knowledge — browser half: Settings -> Knowledge Base.
// Lets the user register local workspaces or document folders (.md, .txt, .csv,
// .docx, .pdf), re-index them incrementally, share collections with Front Desk,
// and run live citable BM25 searches.
//
// Zero external deps; guarded with outer try/catch so a client error never
// affects DSH boot. Strict bilingual FR (tu) / EN via kt(fr, en).

window.__ModuleLoader__.load({
  id: '@local/kybernos-knowledge',
  factory (require) {
    try {
      const React = require('react')
      const h = React.createElement
      const { useState, useEffect, useCallback } = React

      const lang = () => {
        try {
          const l = window.__KB_LANG_RESOLVE__ && window.__KB_LANG_RESOLVE__()
          const s = String(l || '')
          return (s === 'kybernos' || s.split(/[-_]/)[0] === 'fr') ? 'fr' : 'en'
        } catch { return 'en' }
      }
      const kt = (fr, en) => (lang() === 'fr' ? fr : en)

      const pageHead = (props) => { try { if (window.__KB_HELP__ && window.__KB_HELP__.Title) return h(window.__KB_HELP__.Title, props) } catch (e) { /* the bare title below */ } return h(props.as || 'h2', { className: 'kbhp-title' + (props.className ? ' ' + props.className : '') }, props.title, props.after) }

      const api = async (path, body) => {
        const init = body === undefined
          ? { method: 'GET', credentials: 'same-origin', headers: { accept: 'application/json' } }
          : { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) }
        const res = await fetch('/kybernos-knowledge' + path, init)
        let json = null
        try { json = await res.json() } catch { json = null }
        return { ok: res.ok && json !== null && json.ok !== false, status: res.status, json }
      }

      const friendlyError = (code) => {
        const c = String(code || '')
        if (c === 'path-required') return kt('Indique un dossier local à indexer.', 'Enter a local folder path to index.')
        if (c === 'folder-not-found') return kt('Ce dossier est introuvable sur cet ordinateur.', 'That folder was not found on this computer.')
        if (c === 'not-a-directory') return kt('Ce chemin n’est pas un dossier.', 'That path is not a folder.')
        if (c === 'max-collections-reached') return kt('Limite de 20 collections atteinte.', 'Limit of 20 collections reached.')
        if (c === 'sign-in required') return kt('Session requise pour enregistrer.', 'Sign-in required to save changes.')
        return c || kt('Opération impossible.', 'Action failed.')
      }

      const formatCount = (docs, chunks) => String(docs || 0) + ' ' + kt('doc(s)', 'doc(s)') + ' · ' + String(chunks || 0) + ' ' + kt('passage(s)', 'passage(s)')

      const css = [
        '.kbkn-wrap{max-width:740px;display:flex;flex-direction:column;gap:16px;padding:4px 0 28px}',
        '.kbkn-sub{margin:0;font-size:13px;opacity:.78;line-height:1.45}',
        '.kbkn-card{border:1px solid var(--border-subtle,rgba(128,128,128,.22));border-radius:10px;padding:14px 16px;background:var(--surface-1,transparent);display:flex;flex-direction:column;gap:10px}',
        '.kbkn-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
        '.kbkn-input{flex:1;min-width:180px;padding:7px 10px;border-radius:7px;border:1px solid var(--border-subtle,rgba(128,128,128,.3));background:transparent;color:inherit;font:inherit;font-size:13px}',
        '.kbkn-btn{padding:7px 12px;border-radius:7px;border:1px solid var(--border-subtle,rgba(128,128,128,.3));background:transparent;color:inherit;cursor:pointer;font-size:12.5px;font-weight:500}',
        '.kbkn-btn-primary{background:var(--accent,#2563eb);border-color:var(--accent,#2563eb);color:#fff}',
        '.kbkn-btn:disabled{opacity:.5;cursor:default}',
        '.kbkn-badge{display:inline-block;padding:2px 7px;border-radius:999px;font-size:11px;border:1px solid var(--border-subtle,rgba(128,128,128,.3));opacity:.88}',
        '.kbkn-meta{font-size:12px;opacity:.72;word-break:break-all}',
        '.kbkn-err{font-size:12.5px;color:#dc2626}',
        '.kbkn-hit{border-top:1px solid var(--border-subtle,rgba(128,128,128,.16));padding-top:9px;display:flex;flex-direction:column;gap:4px}',
        '.kbkn-cite{font-size:12px;font-weight:600}',
        '.kbkn-snip{font-size:12.5px;opacity:.88;line-height:1.45}'
      ].join('\n')

      const Page = () => {
        const [collections, setCollections] = useState([])
        const [summary, setSummary] = useState({ collections: 0, docs: 0, chunks: 0 })
        const [loading, setLoading] = useState(true)
        const [busy, setBusy] = useState(false)
        const [err, setErr] = useState('')
        const [name, setName] = useState('')
        const [rootPath, setRootPath] = useState('')
        const [frontDesk, setFrontDesk] = useState(false)
        const [query, setQuery] = useState('')
        const [hits, setHits] = useState(null)

        const refresh = useCallback(async () => {
          setLoading(true)
          const r = await api('/collections')
          setLoading(false)
          if (r.ok && r.json) {
            setCollections(Array.isArray(r.json.collections) ? r.json.collections : [])
            setSummary(r.json.summary || { collections: 0, docs: 0, chunks: 0 })
            setErr('')
          } else {
            setErr(friendlyError(r.json && r.json.error))
          }
        }, [])

        useEffect(() => { refresh() }, [refresh])

        const onAdd = async (ev) => {
          if (ev && ev.preventDefault) ev.preventDefault()
          setBusy(true); setErr('')
          const r = await api('/collections/add', { name, rootPath, includeFrontDesk: frontDesk })
          setBusy(false)
          if (!r.ok) { setErr(friendlyError(r.json && r.json.error)); return }
          setName(''); setRootPath(''); setFrontDesk(false)
          await refresh()
        }

        const onReindex = async (id) => {
          setBusy(true); setErr('')
          const r = await api('/collections/reindex', id ? { id } : {})
          setBusy(false)
          if (!r.ok) { setErr(friendlyError(r.json && r.json.error)); return }
          await refresh()
        }

        const onToggleFrontDesk = async (col) => {
          setBusy(true); setErr('')
          const r = await api('/collections/update', { id: col.id, includeFrontDesk: !col.includeFrontDesk })
          setBusy(false)
          if (!r.ok) { setErr(friendlyError(r.json && r.json.error)); return }
          await refresh()
        }

        const onRemove = async (col) => {
          setBusy(true); setErr('')
          const r = await api('/collections/remove', { id: col.id })
          setBusy(false)
          if (!r.ok) { setErr(friendlyError(r.json && r.json.error)); return }
          setHits(null)
          await refresh()
        }

        const onSearch = async (ev) => {
          if (ev && ev.preventDefault) ev.preventDefault()
          const q = String(query || '').trim()
          if (q === '') { setHits(null); return }
          setBusy(true); setErr('')
          const r = await api('/search?q=' + encodeURIComponent(q) + '&limit=8')
          setBusy(false)
          if (!r.ok) { setErr(friendlyError(r.json && r.json.error)); return }
          setHits(r.json)
        }

        return h('div', { className: 'kbkn-wrap', 'data-kb': 'knowledge-page' },
          pageHead({ id: 'kybernos-knowledge', title: kt('Base de connaissances', 'Knowledge Base') }),
          h('p', { className: 'kbkn-sub' },
            kt(
              'Indexe tes dossiers locaux (.md, .txt, .csv, .docx, .pdf) en passages citables et wiki Markdown, accessibles à Kaby et à l’Accueil client.',
              'Index local folders (.md, .txt, .csv, .docx, .pdf) into citable passages and a Markdown wiki, usable by Kaby and Front Desk.'
            )
          ),
          err ? h('div', { className: 'kbkn-err', role: 'alert' }, err) : null,

          h('form', { className: 'kbkn-card', onSubmit: onAdd },
            h('strong', null, kt('Ajouter un dossier', 'Add a folder')),
            h('div', { className: 'kbkn-row' },
              h('input', {
                className: 'kbkn-input',
                type: 'text',
                value: name,
                placeholder: kt('Nom (ex. Docs boutique)', 'Name (e.g. Shop docs)'),
                onChange: (e) => setName(e.target.value)
              }),
              h('input', {
                className: 'kbkn-input',
                type: 'text',
                value: rootPath,
                placeholder: kt('Chemin du dossier local', 'Local folder path'),
                onChange: (e) => setRootPath(e.target.value)
              })
            ),
            h('div', { className: 'kbkn-row' },
              h('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px' } },
                h('input', { type: 'checkbox', checked: frontDesk, onChange: (e) => setFrontDesk(e.target.checked) }),
                kt('Partager avec l’Accueil client (faits à valider)', 'Share with Front Desk (facts to review)')
              ),
              h('button', { className: 'kbkn-btn kbkn-btn-primary', type: 'submit', disabled: busy },
                busy ? kt('Indexation…', 'Indexing…') : kt('Indexer ce dossier', 'Index folder')
              )
            )
          ),

          h('div', { className: 'kbkn-card' },
            h('div', { className: 'kbkn-row', style: { justifyContent: 'space-between' } },
              h('strong', null, kt('Collections indexées', 'Indexed collections') + ' (' + summary.collections + ')'),
              h('span', { className: 'kbkn-meta' }, formatCount(summary.docs, summary.chunks))
            ),
            loading
              ? h('div', { className: 'kbkn-meta' }, kt('Chargement…', 'Loading…'))
              : collections.length === 0
                ? h('div', { className: 'kbkn-meta' }, kt('Aucune collection configurée pour l’instant.', 'No collections configured yet.'))
                : collections.map((col) => h('div', { key: col.id, className: 'kbkn-hit' },
                    h('div', { className: 'kbkn-row', style: { justifyContent: 'space-between' } },
                      h('div', { className: 'kbkn-row' },
                        h('strong', null, col.name),
                        h('span', { className: 'kbkn-badge' }, formatCount(col.docCount, col.chunkCount)),
                        col.includeFrontDesk ? h('span', { className: 'kbkn-badge' }, kt('Accueil client', 'Front Desk')) : null
                      ),
                      h('div', { className: 'kbkn-row' },
                        h('button', { className: 'kbkn-btn', type: 'button', disabled: busy, onClick: () => onReindex(col.id) }, kt('Réindexer', 'Re-index')),
                        h('button', { className: 'kbkn-btn', type: 'button', disabled: busy, onClick: () => onToggleFrontDesk(col) },
                          col.includeFrontDesk ? kt('Retirer de l’Accueil', 'Hide from Front Desk') : kt('Partager Accueil', 'Share Front Desk')
                        ),
                        h('button', { className: 'kbkn-btn', type: 'button', disabled: busy, onClick: () => onRemove(col) }, kt('Supprimer', 'Remove'))
                      )
                    ),
                    h('div', { className: 'kbkn-meta' }, col.rootPath),
                    col.wikiPath ? h('div', { className: 'kbkn-meta' }, kt('Wiki : ', 'Wiki: ') + col.wikiPath) : null
                  ))
          ),

          h('form', { className: 'kbkn-card', onSubmit: onSearch },
            h('strong', null, kt('Tester une recherche', 'Test a search')),
            h('div', { className: 'kbkn-row' },
              h('input', {
                className: 'kbkn-input',
                type: 'search',
                value: query,
                placeholder: kt('Cherche un mot-clé ou une phrase…', 'Search a keyword or phrase…'),
                onChange: (e) => setQuery(e.target.value)
              }),
              h('button', { className: 'kbkn-btn', type: 'submit', disabled: busy }, kt('Rechercher', 'Search'))
            ),
            hits !== null
              ? (hits.results.length === 0
                  ? h('div', { className: 'kbkn-meta' }, kt('Aucun passage trouvé.', 'No matching passages found.'))
                  : hits.results.map((r, i) => h('div', { key: i, className: 'kbkn-hit' },
                      h('div', { className: 'kbkn-cite' }, r.citation),
                      h('div', { className: 'kbkn-snip' }, r.snippet)
                    )))
              : null
          )
        )
      }

      const insertStyle = (cssText) => {
        const tag = document.createElement('style')
        tag.dataset.plugin = '@local/kybernos-knowledge'
        tag.textContent = cssText
        document.head.append(tag)
        return () => { tag.remove() }
      }

      return {
        name: 'kybernos-knowledge',
        inject: ['slots'],
        __test: { kt, friendlyError, formatCount, api, Page, css },
        apply (ctx) {
          if (!ctx || !ctx.slots) return
          ctx.effect(() => insertStyle(css), 'kybernos-knowledge: styles')
          ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register(
            { name: 'settings.section', id: 'kybernos-knowledge', order: 18, label: kt('Base de connaissances', 'Knowledge Base') },
            (props) => h(Page, props)
          )), 'kybernos-knowledge: settings section')
        }
      }
    } catch (e) {
      try { console.error('[kybernos-knowledge] load failed — plugin disabled, GUI preserved', e) } catch { /* ignore */ }
      return { apply () {} }
    }
  }
})
