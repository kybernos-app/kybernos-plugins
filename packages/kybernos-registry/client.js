// kybernos-registry: browser half. It publishes ONE versioned object, window.__KB__, in place of the loose window.__KB_*__ globals
// (docs/dev/plugin-contract.md, section 6.5), and keeps the page's view of the plugins the host half has read.
//
//   const dash = window.__KB__?.use('kybernos/dashboards', '^1')   a service, or null: it never throws
//   window.__KB__.provide('kybernos/dashboards', '1.2.0', service) the owner of a service publishes it
//   window.__KB__.extend('kybernos/dashboards#source', impl)        a code contribution to a point (kept; nothing calls it until a point asks)
//   window.__KB__.status('acme/shop-dashboards')                    'ok' | 'disabled' | 'invalid' | 'absent' | …
//   window.__KB__.reason('kybernos/dashboards', '^1')               why use() answered null: 'absent' | 'version'
//   window.__KB__.on('change', fn)  ·  window.__KB__.refresh()  ·  window.__KB__.plugins()  ·  window.__KB__.points()
//
// A bundle must still work without it (`window.__KB__?.…`, then the old global): nothing here is a hard dependency. No page, no DOM.
//
// Loaded through window.__ModuleLoader__.load. RUNNER CONTRACT: the FACTORY must RETURN a plugin object (`apply(ctx)`); on an evaluation
// error a DISABLED plugin is returned: it degrades, the GUI is kept. The object is created when the file is evaluated (not in `apply`), so a
// bundle that mounts after this one finds it; a bundle that mounts before it simply does not find it and falls back.
window.__ModuleLoader__.load({
  id: '@local/kybernos-registry',
  factory () {
    try {
      // KB-SEAM-BEGIN
      var ID = /^[a-z][a-z0-9-]{1,31}\/[a-z][a-z0-9-]{1,39}$/
      var POINT = /^[a-z][a-z0-9-]{1,31}\/[a-z][a-z0-9-]{1,39}#[a-z][a-z0-9-]{1,31}$/
      // Versions and ranges: a copy of version.mjs (the bundles import nothing from each other; test-client.mjs compares the two on a table).
      function compareVersions (a, b) {
        function split (v) { var p = String(v == null ? '' : v).split('-'); var core = p[0]; var pre = p.length > 1 ? p.slice(1).join('-') : ''; return { n: core.split('.').map(function (x) { return parseInt(x, 10) || 0 }), pre: pre === '' ? [] : pre.split('.') } }
        var x = split(a); var y = split(b); var i
        for (i = 0; i < Math.max(x.n.length, y.n.length); i += 1) { var d = (x.n[i] || 0) - (y.n[i] || 0); if (d !== 0) return d < 0 ? -1 : 1 }
        if (x.pre.length === 0 && y.pre.length === 0) return 0
        if (x.pre.length === 0) return 1
        if (y.pre.length === 0) return -1
        for (i = 0; i < Math.max(x.pre.length, y.pre.length); i += 1) {
          var p1 = x.pre[i]; var q1 = y.pre[i]
          if (p1 === undefined) return -1
          if (q1 === undefined) return 1
          var pn = /^\d+$/.test(p1); var qn = /^\d+$/.test(q1)
          if (pn && qn) { var e = parseInt(p1, 10) - parseInt(q1, 10); if (e !== 0) return e < 0 ? -1 : 1 } else if (pn !== qn) return pn ? -1 : 1
          else if (p1 !== q1) return p1 < q1 ? -1 : 1
        }
        return 0
      }
      var COMPARATOR = /^(\^|~|>=|<=|>|<|=)?(\d+)(?:\.(\d+))?(?:\.(\d+))?(-[0-9A-Za-z.-]+)?$/
      function comparator (text) {
        var m = COMPARATOR.exec(text)
        if (m === null) return null
        var op = m[1] || '='; var major = Number(m[2])
        var minor = m[3] === undefined ? undefined : Number(m[3]); var patch = m[4] === undefined ? undefined : Number(m[4])
        var base = major + '.' + (minor === undefined ? 0 : minor) + '.' + (patch === undefined ? 0 : patch) + (m[5] || '')
        if (op === '^') {
          var upper
          if (major > 0 || minor === undefined) upper = major > 0 ? (major + 1) + '.0.0' : '1.0.0'
          else if (minor > 0 || patch === undefined) upper = '0.' + (minor + 1) + '.0'
          else upper = '0.0.' + (patch + 1)
          return { op: op, base: base, upper: upper }
        }
        if (op === '~') return { op: op, base: base, upper: minor === undefined ? (major + 1) + '.0.0' : major + '.' + (minor + 1) + '.0' }
        return { op: op, base: base }
      }
      function satisfies (version, range) {
        if (typeof range !== 'string' || range.length === 0 || range.length > 120 || !/^\d+(\.\d+){0,2}(-[0-9A-Za-z.-]+)?$/.test(String(version))) return false
        var parts = range.trim().split(/\s+/)
        if (parts.length > 4) return false
        var set = parts.map(comparator)
        if (set.some(function (c) { return c === null })) return false
        return set.every(function (c) {
          var d = compareVersions(version, c.base)
          if (c.op === '^' || c.op === '~') return d >= 0 && compareVersions(version, c.upper) < 0
          if (c.op === '>=') return d >= 0
          if (c.op === '<=') return d <= 0
          if (c.op === '>') return d > 0
          if (c.op === '<') return d < 0
          return d === 0
        })
      }

      /** The seam. `load()` answers the host's `{ plugins, points }` (a promise) or rejects; nothing else is assumed. */
      function createSeam (load) {
        var providers = new Map()
        var extensions = new Map()
        var listeners = []
        var known = { plugins: [], points: [] }
        function emit () { listeners.slice().forEach(function (fn) { try { fn() } catch (e) { /* a listener cannot break the seam */ } }) }
        var seam = {
          version: 1,
          /** Publishes the service of a plugin: one per plugin id, replaced by a later call. */
          provide: function (id, version, service) {
            if (!ID.test(String(id)) || !/^\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$/.test(String(version)) || service === null || service === undefined) return false
            providers.set(id, { version: version, service: service })
            emit()
            return true
          },
          /** The service, if it is there and its version satisfies `range`; otherwise null. Never throws. */
          use: function (id, range) {
            var p = providers.get(id)
            if (p === undefined) return null
            if (range !== undefined && range !== null && !satisfies(p.version, range)) return null
            return p.service
          },
          /** Why use() answers null: 'absent' (nobody published it) or 'version' (it is there, the range does not match); null when it is usable. */
          reason: function (id, range) {
            var p = providers.get(id)
            if (p === undefined) return 'absent'
            return range !== undefined && range !== null && !satisfies(p.version, range) ? 'version' : null
          },
          /** A code contribution to a point ("owner/name#point"). Returns the function that withdraws it. */
          extend: function (point, impl) {
            if (!POINT.test(String(point)) || impl === null || impl === undefined) return function () {}
            var list = extensions.get(point) || []
            var entry = { impl: impl }
            list.push(entry)
            extensions.set(point, list)
            emit()
            return function () { var l = extensions.get(point) || []; var i = l.indexOf(entry); if (i >= 0) { l.splice(i, 1); emit() } }
          },
          extensions: function (point) { return (extensions.get(point) || []).map(function (e) { return e.impl }) },
          plugins: function () { return known.plugins.slice() },
          points: function () { return known.points.slice() },
          /** 'ok' for a service this page holds; else the host's status of an installed plugin; else 'absent'. */
          status: function (id) {
            if (providers.has(id)) return 'ok'
            var p = known.plugins.filter(function (x) { return x.id === id })[0]
            return p === undefined ? 'absent' : p.status
          },
          on: function (event, fn) {
            if (event !== 'change' || typeof fn !== 'function') return function () {}
            listeners.push(fn)
            return function () { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1) }
          },
          /** Asks the host what it has read. Resolves true when the answer was understood; never rejects. */
          refresh: function () {
            return Promise.resolve().then(load).then(function (s) {
              if (s === null || typeof s !== 'object' || !Array.isArray(s.plugins) || !Array.isArray(s.points)) return false
              known = { plugins: s.plugins, points: s.points }
              emit()
              return true
            }).catch(function () { return false })
          }
        }
        return seam
      }
      // KB-SEAM-END

      if (window.__KB__ === undefined || window.__KB__ === null || window.__KB__.version !== 1) {
        window.__KB__ = createSeam(function () {
          return fetch('/kybernos-registry/state', { headers: { accept: 'application/json' } }).then(function (r) { return r.ok ? r.json() : null })
        })
        // A bundle that mounted before this one could not publish: it listens for this event and offers its service again.
        try { window.dispatchEvent(new CustomEvent('kybernos:registry')) } catch (e) { /* no events here */ }
      }
      return {
        name: 'kybernos-registry',
        apply: function () {
          try { window.__KB__.refresh() } catch (e) { /* the seam still works without the host's list */ }
          return function () { /* nothing to undo: the seam stays for the pages that hold it */ }
        },
        __test: { createSeam: createSeam, satisfies: satisfies, compareVersions: compareVersions }
      }
    } catch (err) {
      console.warn('[kybernos-registry] disabled:', err)
      return { apply: function () { /* plugin disabled after a load error */ } }
    }
  }
})
