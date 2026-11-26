// kybernos-db/share: the start of the page that shows a shared dashboard. Browser only: it is the last file the viewer build pastes in (see viewer.mjs), and nothing imports it.
// The snapshot comes from the page itself (`<script type="application/json" id="kv-doc">`, a file that was sent) or from the address the server's page names (`data-doc`, else the
// path of this page plus `.json`). A protected snapshot asks for the password and opens in this browser; a wrong one asks again, with no limit and nothing sent.

async function kvLoad (root) {
  const embedded = document.getElementById('kv-doc')
  if (embedded !== null) return JSON.parse(embedded.textContent)
  const url = root.getAttribute('data-doc') || (location.pathname.replace(/\/+$/, '') + '.json')
  const res = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-cache' })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  return res.json()
}

function kvShow (root, tree, focus) {
  root.replaceChildren(kvMount(document, tree))
  if (focus === true) { const input = root.querySelector('input'); if (input !== null) input.focus() }
}

function kvOpenPage (root, doc) {
  const checked = kvCheck(doc)
  if (checked === null) { kvShow(root, kvMessage('This page cannot be shown', 'It is not a snapshot this page knows how to draw.')); return }
  document.title = kvStr(checked.title, 120) || 'Dashboard'
  kvShow(root, kvPage(checked))
}

function kvAskPassword (root, envelope, error) {
  document.title = 'Protected dashboard'
  kvShow(root, kvLock({
    error,
    onOpen: async (password) => {
      kvShow(root, kvLock({ busy: true, onOpen: () => {} }))
      try { kvOpenPage(root, JSON.parse(await openSealed(envelope, password))) } catch (e) {
        const code = e !== null && typeof e === 'object' ? e.code : ''
        kvAskPassword(root, envelope, code === 'password' ? 'Wrong password, or this file was changed.' : code === 'unsupported' ? e.message : 'This protected page cannot be opened.')
      }
    },
  }), true)
}

async function kvBoot () {
  const root = document.getElementById('kv-root')
  if (root === null) return
  let doc = null
  try { doc = await kvLoad(root) } catch (e) { kvShow(root, kvMessage('This page could not be loaded', 'The link may have been removed, or it has expired.')); return }
  if (isSealed(doc)) kvAskPassword(root, doc, ''); else kvOpenPage(root, doc)
}
