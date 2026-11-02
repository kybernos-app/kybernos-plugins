// kybernos-refs — browser half.
//
// Links of an assistant message become small SOURCE CHIPS placed at the END of their block (sentence, list item), so
// long addresses stop breaking the reading flow. One chip per block: the first source's name, a coloured initial, and
// « +N » when the block cites several; a click opens a card that lists every source of the block (title, site, a link
// that opens in a new tab).
//
// What this code never does:
//   - touch DOM that React manages structurally: the original link stays in place (hidden by CSS), and ONE node (the
//     chip + its card) is added to the block; React does not know it and has not to remove it;
//   - reorder anything that is already in the right place: a pass that finds the block unchanged writes nothing, and
//     the observer ignores the mutations our own nodes make. (The first version moved EVERY chip to the end of the
//     block on every pass: with two chips in a block they swapped places forever, 5 times a second, and the observer
//     re-armed itself on its own moves — the « two tags that switch places and move » the owner reported.)
//   - transform links outside messages (`div[class*="_markdown_"]`) or inside code (`pre`, `code`).
//
// Loaded through window.__ModuleLoader__.load — same shape as the ui-* packages. RUNNER CONTRACT (incident of 26/09,
// measured): the FACTORY must RETURN a cordis plugin — an object with `apply(ctx)`. A factory that returns nothing
// gives « invalid plugin, received undefined » and breaks the whole entry. On an evaluation error a DISABLED plugin is
// returned: it degrades, the GUI is kept.
window.__ModuleLoader__.load({
  id: '@local/kybernos-refs',
  factory() {
    try {

      // ── CSS ──────────────────────────────────────────────────────────────
      // --dsw-alias-* tokens measured live (26/09/2026): the citation grey is the token DSH provides (the bg-layer-2
      // of kbm-pill is white-on-white in light); the hover wash is a background-image so it ADDS to the grey (in the
      // `background` shorthand it replaces it and disappears).
      const css = `
[data-kyb-replaced] { display: none !important; }
.kyb-refs-cite { display: inline-flex; white-space: nowrap; position: relative; vertical-align: baseline; margin-left: 6px; }
.kyb-refs-chip {
  position: relative; display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 9px 0 4px;
  border-radius: 12px; font-size: 12px; line-height: 1; text-decoration: none; cursor: pointer; vertical-align: -0.5px;
  /* !important: the message's link selector (._markdown_ a) wins on specificity and painted the chip link-blue. */
  color: var(--dsw-alias-label-secondary, #cfd3d6) !important;
  text-decoration: none !important;
  background-color: var(--dsw-alias-markdown-citation, rgba(128, 128, 128, 0.16)) !important;
}
.kyb-refs-chip:hover, .kyb-refs-cite.kyb-refs-open .kyb-refs-chip {
  color: var(--dsw-alias-label-primary, inherit) !important;
  background-image: linear-gradient(var(--dsw-alias-interactive-bg-hover-accent, rgba(128, 128, 128, 0.16)), var(--dsw-alias-interactive-bg-hover-accent, rgba(128, 128, 128, 0.16)));
}
.kyb-refs-chip:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #5b8cff); outline-offset: 1px; }
/* The initial: a coloured disc, its hue taken from the site's name so the same site always has the same colour. */
.kyb-refs-av {
  flex: none; display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 50%;
  font-size: 9.5px; font-weight: 700; line-height: 1; text-transform: uppercase; color: #fff;
  background: hsl(var(--kyb-h, 220) 55% 44%);
}
.kyb-refs-card .kyb-refs-av { width: 22px; height: 22px; font-size: 12px; }
.kyb-refs-more { font-size: 11px; font-weight: 600; opacity: 0.7; }
.kyb-refs-card {
  display: none; position: absolute; bottom: calc(100% + 8px); left: 0; z-index: 30;
  width: 320px; max-width: min(320px, 86vw); max-height: 300px; overflow-y: auto; padding: 6px; text-align: left; white-space: normal;
  background: var(--dsw-alias-bg-base, #151517);
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.25));
  border-radius: 12px;
  box-shadow: var(--dsw-elevation-prominent, 0 4px 16px rgba(0, 0, 0, 0.2));
}
.kyb-refs-cite.kyb-refs-open .kyb-refs-card { display: block; }
.kyb-refs-cite.kyb-refs-below .kyb-refs-card { bottom: auto; top: calc(100% + 8px); }
.kyb-refs-row {
  display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: 8px; text-decoration: none !important;
  color: var(--dsw-alias-label-primary, inherit) !important;
}
.kyb-refs-row:hover, .kyb-refs-row:focus-visible { background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.14)); outline: none; }
.kyb-refs-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.kyb-refs-title { font-size: 13px; font-weight: 600; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kyb-refs-host { font-size: 11.5px; line-height: 1.2; color: var(--dsw-alias-label-secondary, #cfd3d6); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kyb-refs-ext { flex: none; font-size: 12px; color: var(--dsw-alias-label-secondary, #cfd3d6); }
`

      // KB-REFS-PURE-BEGIN
      // Pure helpers: no DOM, no network. Cut out of this file and run by test-refs.mjs.

      var SECOND_LEVEL = ['co', 'com', 'org', 'net', 'gov', 'edu', 'ac']

      /** « www.llm-stats.com » → « llm-stats »; « www.bbc.co.uk » → « bbc »; never throws. */
      function siteName(host) {
        var h = String(host === undefined || host === null ? '' : host).toLowerCase().replace(/^www\d*\./, '')
        var parts = h.split('.').filter(function (p) { return p !== '' })
        if (parts.length === 0) return 'source'
        if (parts.length === 1) return parts[0]
        var n = parts.length
        var i = n - 2
        // a country suffix with a second level (bbc.co.uk, gov.uk, example.com.au): the name is one label further left
        if (n >= 3 && parts[n - 1].length === 2 && SECOND_LEVEL.indexOf(parts[n - 2]) >= 0) i = n - 3
        return parts[i] === 'www' ? parts.slice(i + 1).join('.') || h : parts[i]
      }

      /** The host of a URL without « www. »; the input itself when it is not a URL. */
      function siteHost(url) {
        try { return new URL(String(url)).hostname.replace(/^www\d*\./, '') } catch (e) { return String(url) }
      }

      /** A stable hue (0–359) from a site name: the same site is always the same colour. */
      function hueOf(name) {
        var s = String(name)
        var h = 0
        for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360
        return h
      }

      /** The distinct links of a block, in document order (the first of two identical addresses wins). */
      function distinct(links) {
        var seen = {}
        var out = []
        for (var i = 0; i < links.length; i++) {
          var u = String(links[i].href)
          if (Object.prototype.hasOwnProperty.call(seen, u)) continue
          seen[u] = true
          out.push(links[i])
        }
        return out
      }

      /** What a chip shows: the first source's name and « +N » for the others. */
      function chipLabel(links) {
        if (links.length === 0) return { name: 'source', more: 0 }
        return { name: siteName(siteHost(links[0].href)), more: links.length - 1 }
      }

      /** Identity of a group: the chip is rebuilt only when this changes (a link added by streaming, a text completed). */
      function signature(links) {
        return links.map(function (l) { return String(l.href) + '\t' + String((l.textContent || '')).trim() }).join('\n')
      }
      // KB-REFS-PURE-END

      // ── DOM helpers ──────────────────────────────────────────────────────
      // Set at ACTIVATION (apply), not at module load: the runner starts the plugin after the shell has hydrated.

      var BLOCKS = 'p, li, h1, h2, h3, h4, h5, blockquote, dd, dt, td, th'

      function el(tag, cls) {
        var e = document.createElement(tag)
        if (cls) e.className = cls
        return e
      }

      function avatar(name) {
        var a = el('span', 'kyb-refs-av')
        a.textContent = String(name).charAt(0) || '?'
        a.style.setProperty('--kyb-h', String(hueOf(name)))
        a.setAttribute('aria-hidden', 'true')
        return a
      }

      function closeAll() {
        document.querySelectorAll('.kyb-refs-cite.kyb-refs-open').forEach(function (c) {
          c.classList.remove('kyb-refs-open', 'kyb-refs-below')
          var chip = c.querySelector('.kyb-refs-chip')
          if (chip) chip.setAttribute('aria-expanded', 'false')
        })
      }

      /** Opens (or closes) the card of a chip, clamped to the viewport edges. */
      function toggle(cite) {
        var was = cite.classList.contains('kyb-refs-open')
        closeAll()
        if (was) return
        var chip = cite.querySelector('.kyb-refs-chip')
        if (!chip) return
        cite.classList.add('kyb-refs-open')
        chip.setAttribute('aria-expanded', 'true')
        var card = cite.querySelector('.kyb-refs-card')
        if (card) {
          var r = chip.getBoundingClientRect()
          var width = Math.min(320, Math.max(220, Math.min(320, window.innerWidth * 0.86)))
          var height = Math.min(300, card.scrollHeight + 12)
          cite.classList.toggle('kyb-refs-below', r.top < height + 24)
          var overflow = r.left + width - (window.innerWidth - 12)
          card.style.left = overflow > 0 ? (-overflow) + 'px' : '0px'
        }
      }

      /** The chip + card of ONE block, for its distinct links. */
      function buildGroup(links, sig) {
        var cite = el('span', 'kyb-refs-cite')
        cite.setAttribute('data-kyb-refs', '1')
        cite.setAttribute('data-kyb-sig', sig)
        var label = chipLabel(links)

        var chip = el('a', 'kyb-refs-chip')
        chip.href = links[0].href
        chip.setAttribute('aria-haspopup', 'dialog')
        chip.setAttribute('aria-expanded', 'false')
        chip.append(avatar(label.name))
        var name = el('span', 'kyb-refs-name')
        name.textContent = label.name
        chip.append(name)
        if (label.more > 0) {
          var more = el('span', 'kyb-refs-more')
          more.textContent = '+' + label.more
          chip.append(more)
        }

        var card = el('span', 'kyb-refs-card')
        card.setAttribute('role', 'dialog')
        links.forEach(function (l) {
          var host = siteHost(l.href)
          var row = el('a', 'kyb-refs-row')
          row.href = l.href
          row.target = '_blank'
          row.rel = 'noreferrer noopener'
          row.title = l.href
          row.append(avatar(siteName(host)))
          var body = el('span', 'kyb-refs-body')
          var title = el('span', 'kyb-refs-title')
          title.textContent = (l.textContent || '').trim() || host
          var hostLine = el('span', 'kyb-refs-host')
          hostLine.textContent = host
          body.append(title, hostLine)
          var ext = el('span', 'kyb-refs-ext')
          ext.textContent = '↗'
          ext.setAttribute('aria-hidden', 'true')
          row.append(body, ext)
          card.append(row)
        })
        cite.append(chip, card)
        return cite
      }

      function ownChild(block) {
        for (var i = 0; i < block.children.length; i++) {
          if (block.children[i].classList && block.children[i].classList.contains('kyb-refs-cite')) return block.children[i]
        }
        return null
      }

      /** Puts the group where it belongs and writes NOTHING when it is already there. */
      function place(block, group) {
        var before = null
        // a list item that holds a nested list: the chip ends the item's own text, before the nested list
        if (block.tagName === 'LI') {
          for (var i = 0; i < block.children.length; i++) {
            var t = block.children[i].tagName
            if (t === 'UL' || t === 'OL') { before = block.children[i]; break }
          }
        }
        if (before !== null) {
          if (group.parentNode !== block || group.nextElementSibling !== before) block.insertBefore(group, before)
        } else if (group.parentNode !== block || block.lastChild !== group) {
          block.append(group)
        }
      }

      function blockOf(link) {
        return link.closest(BLOCKS) || link.parentElement
      }

      // ── the pass ─────────────────────────────────────────────────────────
      // Idempotent: it writes the DOM only when something is missing (a link not yet replaced, a block whose links
      // changed, text streamed in after the chip) — otherwise it touches nothing and the observer falls asleep.

      function pass() {
        document.querySelectorAll('div[class*="_markdown_"]').forEach(function (message) {
          var perBlock = new Map()
          message.querySelectorAll('a[href^="http"]').forEach(function (link) {
            // The whole wrapper (chip, card, rows) is out: the chip IS an <a href^=http>, and leaving it in the selector
            // made chips transform each other (cascade measured on 26/09: 42 cites → 1 938 in a few passes).
            if (link.closest('.kyb-refs-cite')) return
            if (link.closest('pre, code')) return
            var block = blockOf(link)
            if (!block) return
            if (!perBlock.has(block)) perBlock.set(block, [])
            perBlock.get(block).push(link)
          })
          perBlock.forEach(function (links, block) {
            var uniq = distinct(links)
            links.forEach(function (l) { if (!l.hasAttribute('data-kyb-replaced')) l.setAttribute('data-kyb-replaced', '1') })
            var sig = signature(uniq)
            var group = ownChild(block)
            if (group !== null && group.getAttribute('data-kyb-sig') === sig) { place(block, group); return }
            var fresh = buildGroup(uniq, sig)
            if (group !== null) {
              if (group.classList.contains('kyb-refs-open')) {
                fresh.classList.add('kyb-refs-open')
                fresh.querySelector('.kyb-refs-chip').setAttribute('aria-expanded', 'true')
              }
              group.replaceWith(fresh)
            }
            place(block, fresh)
          })
        })
      }

      /** A mutation record caused by our own nodes: it must not wake the pass again. */
      function isOurs(record) {
        if (record.target && record.target.closest && record.target.closest('.kyb-refs-cite')) return true
        var moved = Array.prototype.slice.call(record.addedNodes).concat(Array.prototype.slice.call(record.removedNodes))
        if (moved.length === 0) return false
        return moved.every(function (n) { return n.nodeType === 1 && n.classList && n.classList.contains('kyb-refs-cite') })
      }

      // ── the plugin returned to the runner ────────────────────────────────
      // All DOM wiring (styles, listeners, observer) is set at activation, once per page.

      return {
        apply() {
          var styleTag = document.createElement('style')
          styleTag.dataset.plugin = '@local/kybernos-refs'
          styleTag.textContent = css
          document.head.append(styleTag)

          document.addEventListener('click', function (e) {
            var chip = e.target.closest ? e.target.closest('.kyb-refs-chip') : null
            if (chip) {
              if (e.metaKey || e.ctrlKey || e.shiftKey) return // native open of the first link
              e.preventDefault()
              toggle(chip.closest('.kyb-refs-cite'))
              return
            }
            if (!e.target.closest || !e.target.closest('.kyb-refs-card')) closeAll()
          }, true)

          document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') closeAll()
          }, true)

          var scheduled = null
          var observer = new MutationObserver(function (records) {
            if (scheduled) return
            if (records.every(isOurs)) return
            scheduled = setTimeout(function () {
              scheduled = null
              try { pass() } catch (err) { console.warn('[kybernos-refs] pass interrupted:', err) }
            }, 200)
          })
          observer.observe(document.documentElement, { childList: true, subtree: true })
          pass()
        }
      }

    } catch (err) {
      console.warn('[kybernos-refs] disabled:', err)
      return { apply() { /* plugin disabled after a load error */ } }
    }
  }
})
