// Maquettes made on the fly for the tests: nothing here is stored as a fixture file (contract rule 7 of
// docs/dev/office-editors-open-save-contract-2026-11-03.md). Two small pages shaped like the real ones the editor was tried on:
// « creator » (style block + linked stylesheet + sections of blocks, one script) and « catalog » (texts built by a script from a data file).

const CREATOR = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Creator</title>
<link rel="stylesheet" href="dsh.css">
<style>
.kb-title { color: #222; font-size: 28px }
.kb-card { color: #444; padding: 12px }
.kb-lead { color: #666 }
</style>
</head>
<body>
<header class="kb-top">
  <h1 class="kb-title">Create your app</h1>
  <p class="kb-lead">Describe what you need and Kaby builds it.</p>
</header>
<main>
  <section class="kb-steps">
    <h2>Steps</h2>
    <div class="kb-card" data-step="1"><svg width="16" height="16" viewBox="0 0 24 24"><path d="M3 12h18"/></svg> First step</div>
    <div class="kb-card">Second step</div>
    <div class="kb-card" id="third">Third step</div>
  </section>
  <section class="kb-more">
    <h2>More</h2>
    <p>Some text &amp; more, with a <a href="#more">link</a>.</p>
    <button type="button" id="go">Go</button>
  </section>
</main>
<script>
document.getElementById('go').addEventListener('click', function () {})
</script>
</body>
</html>
`

const DSH_CSS = ':root { --bg: #fff; --fg: #111 }\nbody { margin: 0; color: var(--fg); background: var(--bg) }\n'

const CATALOG = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Catalog</title>
<link rel="stylesheet" href="dsh.css">
<style>
.card { color: #333; border: 1px solid #ddd }
.name { color: #111 }
</style>
</head>
<body>
<h1>Connectors</h1>
<p class="lead">Pick an app to connect.</p>
<div id="grid"></div>
<script src="data.js"></script>
<script>
var g = document.getElementById('grid')
window.KB_CATALOG.forEach(function (a) { var d = document.createElement('div'); d.className = 'card'; d.textContent = 'Connect ' + a.n; g.appendChild(d) })
</script>
</body>
</html>
`

/** The Gmail description of the catalog data file, written once as a whole literal (typographic apostrophe included). */
export const GMAIL_TEXT = 'Gmail is Google’s email service, featuring spam protection, search functions, and seamless integration with other G Suite apps for productivity'

const catalogData = () => {
  const apps = [{ n: 'Gmail', c: 'email', d: GMAIL_TEXT }]
  for (let i = 1; i < 100; i++) apps.push({ n: `App ${i}`, c: i % 3 === 0 ? 'email' : i % 3 === 1 ? 'chat' : 'files', d: `App ${i} does one thing well and nothing else (${i}).` })
  return 'window.KB_CATALOG = ' + JSON.stringify(apps) + ';\n'
}

/** { name: { 'index.html': text, 'dsh.css': text, ['data.js': text] } }, fresh on every call. */
export const fixtures = () => ({
  creator: { 'index.html': CREATOR, 'dsh.css': DSH_CSS },
  catalog: { 'index.html': CATALOG, 'dsh.css': DSH_CSS, 'data.js': catalogData() },
})
