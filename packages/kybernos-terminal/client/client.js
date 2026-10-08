// @local/kybernos-terminal — client bundle.
//
// Dresses the shell fences of the DSH chat as terminal windows (mac title bar,
// `$` prompt) — DOM decoration + CSS only, the native DOM stays in place and
// the native buttons (wrap, copy) keep working. No vendor bundle needed: the
// styling is pure CSS tokens, so theme switches repaint for free.
//
// DOM contract (stable markers, same ones dsh-mermaid relies on):
//   div.md-code-block
//     [data-code-block-banner]   → heading (language label) + native actions
//     pre (shiki)                → the source, left untouched
window.__ModuleLoader__.load({
  id: '@local/kybernos-terminal',
  factory: () => {
    var module = { exports: {} }
    var exports = module.exports
    try {
      var NAME = 'kybernos-terminal'
      var ROOT_SELECTOR = 'div.md-code-block'
      var BANNER_SELECTOR = '[data-code-block-banner]'
      var MARK = 'kbtrm'
      var LANGS = ['bash', 'sh', 'shell', 'zsh', 'console', 'shell-session', 'powershell', 'pwsh']
      var DEBOUNCE_MS = 120

      function injectStyle() {
        var style = document.createElement('style')
        style.dataset.plugin = NAME
        style.textContent = [
          /* The native language label makes room for the terminal title bar. */
          '.' + MARK + ' ' + BANNER_SELECTOR + ' > div:first-child > span:first-child { display: none; }',
          /* Terminal chrome: dots + window name, inline with the native actions. */
          '.kbtrm-bar { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; }',
          '.kbtrm-bar i { width: 11px; height: 11px; border-radius: 50%; flex: none; }',
          '.kbtrm-bar i:nth-child(1) { background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #ff5f57) 80%, var(--dsw-alias-markdown-code-block, #141517)); }',
          '.kbtrm-bar i:nth-child(2) { background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #febc2e) 80%, var(--dsw-alias-markdown-code-block, #141517)); }',
          '.kbtrm-bar i:nth-child(3) { background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #28c840) 80%, var(--dsw-alias-markdown-code-block, #141517)); }',
          '.kbtrm-name { font-family: var(--dsw-font-markdown-code-font-family, ui-monospace, Menlo, monospace); font-size: 12px; color: var(--dsw-alias-label-tertiary, currentColor); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }',
          /* The `$` prompt sits on the first rendered line of the source. */
          '.md-code-block.' + MARK + '.kbtrm-prompt pre { position: relative; }',
          '.md-code-block.' + MARK + '.kbtrm-prompt pre::before { content: "$ "; position: absolute; left: 0; transform: translateX(-100%); color: var(--dsw-alias-state-success-primary, #28c840); font-family: var(--dsw-font-markdown-code-font-family, ui-monospace, Menlo, monospace); pointer-events: none; user-select: none; }',
          /* The ▶ run button, inline with the native actions. */
          '.kbtrm-run { color: var(--dsw-alias-state-success-primary, #28c840); font-size: 12px; line-height: 1; width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: 6px; background: transparent; cursor: pointer; }',
          '.kbtrm-run:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.15)); }',
          '.kbtrm-run:disabled { opacity: .45; cursor: default; }',
          /* The output area under the code. */
          '.kbtrm-out { margin: 0 14px 12px; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1, transparent); background: var(--dsw-alias-bg-layer-1, transparent); font-family: var(--dsw-font-markdown-code-font-family, ui-monospace, Menlo, monospace); font-size: 12px; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 320px; overflow-y: auto; color: var(--dsw-alias-label-secondary, currentColor); }',
          '.kbtrm-out[data-kb-terminal-state="pending"] { color: var(--dsw-alias-label-tertiary, currentColor); }',
          '.kbtrm-out[data-kb-terminal-state="err"] { border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #ff5f57) 45%, transparent); }'
        ].join('')
        document.head.append(style)
        return function () { style.remove() }
      }

      /** True when this code block is a shell fence. */
      function isShellBlock(block) {
        var banner = block.querySelector(BANNER_SELECTOR)
        var info = banner && banner.firstElementChild ? banner.firstElementChild.textContent.trim().toLowerCase() : ''
        if (LANGS.indexOf(info) >= 0) return true
        for (var i = 0; i < LANGS.length; i += 1) {
          if (block.querySelector('code.language-' + LANGS[i])) return true
        }
        return false
      }

      /** Already dressed? */
      function isDressed(block) { return block.classList.contains(MARK) }

      /** The verbatim source of the fence (the <pre> content). */
      function sourceOf(block) {
        var pre = block.querySelector('pre')
        return pre ? pre.textContent.replace(/^\s*\$\s/, '').trim() : ''
      }

      /** POST the command to the host route. Never throws. */
      function lancer(commande) {
        return fetch('/kybernos-terminal/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ commande: commande })
        }).then(function (r) { return r.json() }).catch(function (e) {
          return { ok: false, erreur: String(e && e.message ? e.message : e) }
        })
      }

      /** The output area under the code: pending / result / error. */
      function zoneSortie(block) {
        var zone = block.querySelector('.' + MARK + '-out')
        if (zone) return zone
        zone = document.createElement('div')
        zone.className = MARK + '-out'
        zone.hidden = true
        block.append(zone)
        return zone
      }

      function afficherSortie(zone, etat, texte) {
        zone.hidden = false
        zone.dataset.kbTerminalState = etat
        zone.textContent = texte
      }

      function ajouterBoutonRun(block) {
        var banner = block.querySelector(BANNER_SELECTOR)
        var actions = banner ? banner.lastElementChild : null
        if (!actions) return
        var run = document.createElement('button')
        run.type = 'button'
        run.className = MARK + '-run'
        run.setAttribute('aria-label', 'Run')
        run.title = 'Run'
        run.textContent = '▶'
        run.addEventListener('click', function () {
          var commande = sourceOf(block)
          if (commande === '') return
          /* Pas de confirm : décision utilisateur du 08/10 — le clic exécute. */
          var zone = zoneSortie(block)
          afficherSortie(zone, 'pending', '⏳ exécution…')
          run.disabled = true
          lancer(commande).then(function (r) {
            run.disabled = false
            if (r && r.ok === true) {
              var sortie = (r.stdout || '')
              if (r.stderr) sortie += (sortie ? '\n' : '') + r.stderr
              var texte = sortie || (r.code === 0 ? '(aucune sortie)' : '')
              var entete = r.timedOut === true ? '— timeout (30 s) —\n' : ''
              if (r.code !== 0) entete += 'exit ' + r.code + (sortie ? '\n' : '')
              afficherSortie(zone, r.code === 0 && r.timedOut !== true ? 'ok' : 'err', entete + texte)
            } else {
              afficherSortie(zone, 'err', '✗ ' + ((r && r.erreur) || 'échec'))
            }
          })
        })
        actions.prepend(run)
      }

      function dress(block) {
        var banner = block.querySelector(BANNER_SELECTOR)
        if (!banner) return
        var lang = banner.firstElementChild ? banner.firstElementChild.textContent.trim() : 'sh'
        var bar = document.createElement('div')
        bar.className = MARK + '-bar'
        bar.append(
          document.createElement('i'),
          document.createElement('i'),
          document.createElement('i')
        )
        var name = document.createElement('span')
        name.className = MARK + '-name'
        name.textContent = '~ zsh'
        bar.append(name)
        banner.firstElementChild.before(bar)
        block.classList.add(MARK)
        block.dataset.kbTerminalLang = lang.toLowerCase()
        /* The prompt only when the source does not already start with one. */
        var pre = block.querySelector('pre')
        var text = pre ? pre.textContent : ''
        if (pre && /^\s*\$\s/.test(text) === false) block.classList.add(MARK + '-prompt')
        ajouterBoutonRun(block)
      }

      function scan() {
        var blocks = document.querySelectorAll(ROOT_SELECTOR)
        for (var i = 0; i < blocks.length; i += 1) {
          var block = blocks[i]
          if (isDressed(block)) continue
          if (isShellBlock(block)) dress(block)
        }
      }

      function apply(ctx) {
        if (typeof document === 'undefined' || typeof window === 'undefined') return
        if (window.__KB_TERMINAL_ACTIVE__) return
        window.__KB_TERMINAL_ACTIVE__ = true

        var removeStyle = injectStyle()
        var timer = 0

        function schedule() {
          if (timer) window.clearTimeout(timer)
          timer = window.setTimeout(function () { timer = 0; scan() }, DEBOUNCE_MS)
        }

        /* `documentElement`, never `body`: this bundle is evaluated from <head>,
           where `body` is still null (the dsh-mermaid lesson). */
        var observer = new MutationObserver(schedule)
        observer.observe(document.documentElement, { childList: true, subtree: true })
        scan()

        var dispose = function () {
          if (!window.__KB_TERMINAL_ACTIVE__) return
          window.__KB_TERMINAL_ACTIVE__ = false
          observer.disconnect()
          if (timer) window.clearTimeout(timer)
          for (var bars of document.querySelectorAll('.' + MARK + '-bar')) bars.remove()
          for (var outs of document.querySelectorAll('.' + MARK + '-out')) outs.remove()
          for (var runs of document.querySelectorAll('.' + MARK + '-run')) runs.remove()
          for (var blocks of document.querySelectorAll('.md-code-block.' + MARK)) {
            blocks.classList.remove(MARK, MARK + '-prompt')
            delete blocks.dataset.kbTerminalLang
          }
          removeStyle()
        }

        if (ctx && typeof ctx.effect === 'function') ctx.effect(function () { return dispose })
        else if (ctx && typeof ctx.on === 'function') ctx.on('dispose', dispose)
      }

      exports.name = NAME
      exports.inject = []
      exports.apply = apply
    } catch (error) {
      // An exception here would break the whole entry (« Failed to load plugins »)
      // and leave the GUI unusable: degrade instead, plugin disabled.
      console.error('[kybernos-terminal] evaluation failed — plugin disabled', error)
    }
    return module.exports
  }
})
