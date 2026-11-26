// The "studio": thumbnails + one stage. Every slide lives in a sandboxed iframe (no same-origin): the only way in or out is postMessage.
const $ = (s) => document.querySelector(s)
const main = $('#main'); const stage = $('#stage'); const wrap = $('#wrap'); const rail = $('#rail')
let deck = { title: '', theme: 'dark', version: 0, slides: [] }
let cur = 0; let editMode = false; let userRev = 0; let seenVersion = -1; let thumbTimer = null

async function api (path, opts) {
  const r = await fetch(path, opts)
  const j = await r.json()
  if (!r.ok) throw new Error(j.error || r.statusText)
  return j
}
const post = (path, body) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

function toast (msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on')
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2600)
}

function fit () {
  const s = Math.min((wrap.clientWidth - (document.body.classList.contains('presenting') ? 0 : 40)) / 1600, (wrap.clientHeight - (document.body.classList.contains('presenting') ? 0 : 40)) / 900)
  stage.style.transform = `scale(${Math.max(s, 0.1)})`
}

function renderRail (changed = []) {
  rail.textContent = ''
  deck.slides.forEach((_, i) => {
    const b = document.createElement('button')
    b.className = 'thumb' + (i === cur ? ' on' : '') + (changed.includes(i) ? ' new' : '')
    b.setAttribute('aria-label', `Slide ${i + 1}`)
    b.innerHTML = `<span class="n">${i + 1}</span><div class="mini"><iframe tabindex="-1" sandbox="allow-scripts" title="Slide ${i + 1} thumbnail" src="/slide/${i}.html?thumb=1&v=${deck.version}.${userRev}"></iframe></div>`
    b.addEventListener('click', () => select(i))
    rail.append(b)
  })
}

function select (i) {
  const n = deck.slides.length
  const none = n === 0
  $('#empty').hidden = !none
  stage.hidden = none
  for (const id of ['pdf', 'pptx']) { const a = $('#' + id); a.setAttribute('aria-disabled', String(none)); a.tabIndex = none ? -1 : 0 }
  $('#prev').disabled = none || i <= 0; $('#next').disabled = none || i >= n - 1
  $('#pos').textContent = none ? '' : `${Math.max(0, Math.min(i, n - 1)) + 1} / ${n}`
  if (none) { main.removeAttribute('src'); return }
  cur = Math.max(0, Math.min(i, n - 1))
  main.src = `/slide/${cur}.html?v=${deck.version}`
  rail.querySelectorAll('.thumb').forEach((t, k) => t.classList.toggle('on', k === cur))
}

function sendMode () { try { main.contentWindow.postMessage({ type: 'kb-mode', on: editMode }, '*') } catch { /* iframe not ready */ } }

async function load (changed = []) {
  deck = await api('/api/deck')
  seenVersion = deck.version
  $('#title').textContent = deck.title
  $('#ver').textContent = `v${deck.version}`
  $('#theme').value = deck.theme
  if (cur >= deck.slides.length) cur = 0
  renderRail(changed)
  select(cur)
  refreshAgent()
}

async function refreshAgent () {
  if ($('#agentbox').hidden) return
  const [e, s] = await Promise.all([api('/api/edits'), api('/api/state')])
  $('#edits').textContent = e.edits.length === 0 ? 'none yet' : JSON.stringify(e.edits.map((x) => ({ slide: x.slide + 1, was: x.before, now: x.after })), null, 2)
  $('#hist').textContent = ''
  s.history.forEach((h) => { const li = document.createElement('li'); li.textContent = `v${h.version} · ${h.who} · ${h.slides} slides` + (h.changed.length ? ` · changed ${h.changed.map((n) => n + 1).join(', ')}` : ''); $('#hist').append(li) })
}

window.addEventListener('message', (e) => {
  if (e.source !== main.contentWindow) return
  const m = e.data
  if (!m || typeof m !== 'object') return
  if (m.type === 'kb-ready') sendMode()
  if (m.type === 'kb-edit') {
    post('/api/edits', m).then((r) => {
      userRev = r.userRev
      refreshAgent()
      clearTimeout(thumbTimer)
      thumbTimer = setTimeout(() => { const t = rail.querySelectorAll('.thumb iframe')[m.slide]; if (t) t.src = `/slide/${m.slide}.html?thumb=1&v=${deck.version}.${userRev}` }, 600)
    }).catch((err) => toast(`Edit not saved: ${err.message}`))
  }
})

$('#prev').addEventListener('click', () => select(cur - 1))
$('#next').addEventListener('click', () => select(cur + 1))
$('#edit').addEventListener('click', () => {
  editMode = !editMode
  $('#edit').setAttribute('aria-pressed', String(editMode))
  sendMode()
  toast(editMode ? 'Click any text on the slide to edit it' : 'Editing off')
})
$('#theme').addEventListener('change', async (e) => { await post('/api/theme', { theme: e.target.value }); await load() })
$('#agent').addEventListener('click', () => {
  const box = $('#agentbox'); box.hidden = !box.hidden
  $('#agent').setAttribute('aria-pressed', String(!box.hidden))
  refreshAgent(); fit()
})
$('#clear').addEventListener('click', async () => { await api('/api/edits', { method: 'DELETE' }); refreshAgent() })
$('#present').addEventListener('click', async () => {
  document.body.classList.add('presenting'); editMode = false; $('#edit').setAttribute('aria-pressed', 'false'); sendMode()
  try { await document.documentElement.requestFullscreen() } catch { /* the class alone already hides the chrome */ }
  fit()
})
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) { document.body.classList.remove('presenting'); fit() } })
document.addEventListener('keydown', (e) => {
  if (e.target.closest && e.target.closest('select,input,textarea')) return
  if (e.key === 'ArrowRight' || e.key === 'PageDown') select(cur + 1)
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') select(cur - 1)
  if (e.key === 'Escape' && document.body.classList.contains('presenting')) { document.body.classList.remove('presenting'); if (document.fullscreenElement) document.exitFullscreen(); fit() }
})
window.addEventListener('resize', fit)

// The agent writes through PUT /api/deck at any time: poll, and flag the slides that changed.
async function poll () {
  try {
    const s = await api('/api/state')
    if (s.version !== seenVersion) {
      const changed = s.history[0]?.who === 'agent' ? s.history[0].changed : []
      await load(changed)
      if (seenVersion > 0 && changed.length) toast(`Agent updated slide${changed.length > 1 ? 's' : ''} ${changed.map((n) => n + 1).join(', ')}`)
    }
  } catch { /* server restarting */ }
}
setInterval(poll, 1500)
fit()
load().catch((e) => toast(e.message))
