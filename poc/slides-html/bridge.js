// Runs INSIDE each sandboxed slide iframe (opaque origin: it cannot read the parent, only post messages to it).
// It tags the text leaves, switches them to editable on request, and reports edits plus a clean serialisation of the slide.
(function () {
  var SLIDE = Number(document.documentElement.getAttribute('data-slide') || 0)
  var SEL = 'h1,h2,h3,p,li,.num,.kicker,.lead,.label,td,th,blockquote,.ph,.source,.dot'
  var scene = document.querySelector('.slide')
  var leaves = Array.prototype.filter.call(scene.querySelectorAll(SEL), function (el) { return !el.querySelector(SEL) })
  var first = {}
  leaves.forEach(function (el, i) { el.setAttribute('data-kb', String(i)); first[i] = el.textContent })

  function serialise () {
    var copy = scene.cloneNode(true)
    Array.prototype.forEach.call(copy.querySelectorAll('[data-kb]'), function (el) { el.removeAttribute('data-kb'); el.removeAttribute('contenteditable'); el.removeAttribute('spellcheck') })
    return copy.outerHTML
  }

  var timer = null
  document.addEventListener('input', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-kb]') : null
    if (!el) return
    var id = el.getAttribute('data-kb')
    clearTimeout(timer)
    timer = setTimeout(function () {
      parent.postMessage({ type: 'kb-edit', slide: SLIDE, id: id, before: first[id], after: el.textContent, html: serialise() }, '*')
    }, 350)
  })
  // Enter must not create <div>s inside a heading: keep edits plain text.
  document.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.closest && e.target.closest('[data-kb]')) { e.preventDefault(); e.target.blur() } })

  window.addEventListener('message', function (e) {
    var m = e.data
    if (!m || typeof m !== 'object') return
    if (m.type === 'kb-mode') {
      leaves.forEach(function (el) { if (m.on) { el.setAttribute('contenteditable', 'plaintext-only'); el.setAttribute('spellcheck', 'false') } else { el.removeAttribute('contenteditable'); el.removeAttribute('spellcheck') } })
      document.body.classList.toggle('kb-edit', !!m.on)
    }
    if (m.type === 'kb-theme') document.body.setAttribute('data-theme', m.theme || '')
  })

  parent.postMessage({ type: 'kb-ready', slide: SLIDE, leaves: leaves.length }, '*')
})()
