// @local/kybernos-terminal — client bundle.
//
// Dresses the shell fences of the DSH chat as terminal windows (mac title bar,
// `$` prompt) — DOM decoration + CSS only, the native DOM stays in place and
// the native buttons (wrap, copy) keep working. No vendor bundle needed: the
// styling is pure CSS tokens, so theme switches repaint for free.
//
// DOM contract (as measured on DSH 0.2.0-rc.2, same markers dsh-mermaid relies on):
//   div.md-code-block
//     [data-code-block-banner]   → heading (language label) + native actions
//     [data-code-block-content]  → pre (shiki when highlighted, plain otherwise): the source, left untouched
// The label names the language ONLY when DSH can highlight it (bash, sh, zsh, shell...); any other
// fence reads "Code block" and carries no class, so `console`, `shell-session` and `pwsh` never show
// their name. A transcript still gives itself away by its first line, a `$ ` prompt (see isShellBlock).
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
          /* The `$` prompt is inline text at the start of the first line. It used to sit OUTSIDE the <pre>
             (absolute, shifted left by its own width) and the <pre>'s overflow clipped it. Being a pseudo
             element it is not part of textContent, so copy and run never see it. */
          '.md-code-block.' + MARK + '.kbtrm-prompt pre code::before { content: "$ "; color: var(--dsw-alias-state-success-primary, #28c840); pointer-events: none; user-select: none; }',
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

      /** True for a fence DSH did not highlight: its source is a plain <pre>, not a shiki one. */
      function isUnhighlighted(block) {
        return block.querySelector('pre.shiki, pre[class*="shiki"]') === null
      }

      /** A `$ command` transcript (`console`, `shell-session`): the first line opens with a prompt. */
      function isTranscript(block) {
        var pre = block.querySelector('pre')
        return pre !== null && /^\s*\$ \S/.test(pre.textContent)
      }

      /** True when this code block is a shell fence. */
      function isShellBlock(block) {
        var banner = block.querySelector(BANNER_SELECTOR)
        var info = banner && banner.firstElementChild ? banner.firstElementChild.textContent.trim().toLowerCase() : ''
        if (LANGS.indexOf(info) >= 0) return true
        for (var i = 0; i < LANGS.length; i += 1) {
          if (block.querySelector('code.language-' + LANGS[i])) return true
        }
        /* DSH 0.2 only names a language it can highlight, so a `console` or `shell-session` fence reads
           "Code block". Its source is the only trace left; never read it on a highlighted block, which
           carries its own language. */
        return isUnhighlighted(block) && isTranscript(block)
      }

      /** Already dressed? */
      function isDressed(block) { return block.classList.contains(MARK) }

      /** The commands of the fence. A transcript runs only its `$ ` lines, never the output between them. */
      function sourceOf(block) {
        var pre = block.querySelector('pre')
        var text = pre ? pre.textContent : ''
        if (block.dataset.kbTerminalTranscript === '1') {
          var commands = []
          var continued = false
          text.split('\n').forEach(function (line) {
            if (/^\s*\$ /.test(line)) {
              commands.push(line.replace(/^\s*\$ /, ''))
              continued = /\\\s*$/.test(line)
            } else if (continued) {
              commands.push(line)
              continued = /\\\s*$/.test(line)
            }
          })
          return commands.join('\n').trim()
        }
        return text.replace(/^\s*\$\s/, '').trim()
      }

      /** POST the command to the host route, with the page's own session cookie. Never throws. */
      function lancer(commande) {
        return fetch('/kybernos-terminal/run', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ commande: commande })
        }).then(function (r) {
          return r.json().catch(function () { return { ok: false, erreur: 'HTTP ' + r.status } })
        }).catch(function (e) {
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
          /* No confirm: user decision of 08/10 — the click runs it. */
          var zone = zoneSortie(block)
          afficherSortie(zone, 'pending', '⏳ running…')
          run.disabled = true
          lancer(commande).then(function (r) {
            run.disabled = false
            if (r && r.ok === true) {
              var sortie = (r.stdout || '')
              if (r.stderr) sortie += (sortie ? '\n' : '') + r.stderr
              var texte = sortie || (r.code === 0 ? '(no output)' : '')
              var entete = r.timedOut === true ? '— timeout (30 s) —\n' : ''
              if (r.code !== 0) entete += 'exit ' + r.code + (sortie ? '\n' : '')
              afficherSortie(zone, r.code === 0 && r.timedOut !== true ? 'ok' : 'err', entete + texte)
            } else {
              afficherSortie(zone, 'err', '✗ ' + ((r && r.erreur) || 'failed'))
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
        /* A fence recognised by its `$ ` lines (not by a language label) is a transcript. */
        var named = LANGS.indexOf(lang.toLowerCase()) >= 0 || block.querySelector('code[class*="language-"]') !== null
        if (!named && isTranscript(block)) block.dataset.kbTerminalTranscript = '1'
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
            delete blocks.dataset.kbTerminalTranscript
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
      // An exception here would break the whole entry ("Failed to load plugins")
      // and leave the GUI unusable: degrade instead, plugin disabled.
      console.error('[kybernos-terminal] evaluation failed — plugin disabled', error)
    }
    return module.exports
  }
})
