// Test helper (not a test: the name does not start with "test"). A very small React for the tests that cut a component out of client.js and run it
// as it is: function components, useState / useRef / useEffect / useMemo / useCallback, a re-render when a state changes, effects run after the render,
// and the one rule the real React enforces that a looser fake hides: a component must call the SAME hooks in the SAME order on every render. A component
// that returns early before some of its hooks renders fewer of them the next time, and the real React throws (« Rendered fewer hooks than expected »,
// minified error #300) and the engine drops the dock entry for good. This fake throws the same way.
//
//   const lite = createLite()
//   const root = lite.mount(lite.React.createElement(Component, props))
//   root.update(lite.React.createElement(Component, otherProps))   // same component, new props: the instance (and its hooks) is kept
//   await root.settle()
//   lite.find(root.tree, (n) => n.props['data-kb'] === 'x')

const flat = (list) => list.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false && c !== true)
const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))

export function createLite () {
  let CUR = null
  const Fragment = 'fragment'
  const React = {
    Fragment,
    createElement (type, props, ...children) {
      const p = Object.assign({}, props || {})
      const kids = flat(children)
      if (kids.length === 1) p.children = kids[0]
      else if (kids.length > 1) p.children = kids
      return { $$: true, type, props: p, key: p.key !== undefined && p.key !== null ? String(p.key) : null, kids }
    },
    useState (init) {
      const slot = CUR.slot()
      if (slot.state === undefined) {
        const root = CUR.root
        slot.state = { v: typeof init === 'function' ? init() : init }
        slot.set = (nv) => {
          const v = typeof nv === 'function' ? nv(slot.state.v) : nv
          if (!Object.is(v, slot.state.v)) { slot.state.v = v; root.pending = true }
        }
      }
      return [slot.state.v, slot.set]
    },
    useRef (init) { const slot = CUR.slot(); if (slot.ref === undefined) slot.ref = { current: init }; return slot.ref },
    useMemo (fn, deps) { const slot = CUR.slot(); if (slot.memo === undefined || !same(slot.deps, deps)) { slot.memo = { v: fn() }; slot.deps = deps } return slot.memo.v },
    useCallback (fn, deps) { return React.useMemo(() => fn, deps) },
    useEffect (fn, deps) {
      const slot = CUR.slot()
      if (slot.ran !== true || deps === undefined || !same(slot.deps, deps)) CUR.root.effects.push({ slot, fn })
      slot.deps = deps
    },
  }
  const mount = (element) => {
    const root = {
      pending: false, effects: [], instances: new Map(), tree: null, element,
      render () {
        const seen = new Set()
        const visit = (el, path) => {
          if (el === null || el === undefined || typeof el === 'boolean') return null
          if (typeof el === 'string' || typeof el === 'number') return { text: String(el) }
          if (Array.isArray(el)) return { tag: '#', props: {}, children: flat(el).map((c, i) => visit(c, path + '.' + (c && c.key !== null && c.key !== undefined ? c.key : i))).filter((c) => c !== null) }
          if (typeof el.type === 'function') {
            seen.add(path)
            let inst = root.instances.get(path)
            if (inst === undefined) { inst = { slots: [], i: 0, last: null }; root.instances.set(path, inst) }
            inst.i = 0
            const prev = CUR
            CUR = { root, slot: () => { const k = inst.i++; if (inst.slots[k] === undefined) inst.slots[k] = {}; return inst.slots[k] } }
            let out
            try { out = el.type(el.props) } finally { CUR = prev }
            // What the real React checks at the end of every render of a mounted component.
            if (inst.last !== null && inst.i !== inst.last) {
              throw new Error((inst.i < inst.last ? 'Rendered fewer hooks than expected (' + inst.i + ' instead of ' + inst.last + '): React error #300' : 'Rendered more hooks than during the previous render (' + inst.i + ' instead of ' + inst.last + '): React error #310'))
            }
            inst.last = inst.i
            return visit(out, path + '>')
          }
          const children = flat(el.kids).map((c, i) => visit(c, path + '/' + (c && c.key !== null && c.key !== undefined ? c.key : i))).filter((c) => c !== null)
          return { tag: el.type, props: el.props, children }
        }
        root.effects = []
        root.tree = visit(root.element, 'r')
        for (const [p, inst] of [...root.instances]) {
          if (seen.has(p)) continue
          for (const s of inst.slots) if (typeof s.cleanup === 'function') { try { s.cleanup() } catch (e) { /* unmount */ } }
          root.instances.delete(p)
        }
        const todo = root.effects
        for (const e of todo) { if (typeof e.slot.cleanup === 'function') { try { e.slot.cleanup() } catch (err) { /* cleanup */ } } }
        for (const e of todo) { e.slot.ran = true; const c = e.fn(); e.slot.cleanup = typeof c === 'function' ? c : undefined }
      },
      /** Same component at the same place, new props: the hooks are kept, as when the engine re-renders a dock entry. */
      update (next) { root.element = next; root.pending = false; root.render() },
      /** Lets effects, promises and timers run, and re-renders while a state changed. `busy()` (optional) says whether the test still has a request in flight. */
      async settle (busy) {
        for (let quiet = 0, laps = 0; quiet < 4;) {
          if (++laps > 600) throw new Error('the screen never settles (a state that changes on every render?)')
          let rounds = 0
          while (root.pending === true && rounds++ < 60) { root.pending = false; root.render() }
          await new Promise((r) => setTimeout(r, 3))
          if (root.pending === true || (typeof busy === 'function' && busy() === true)) quiet = 0
          else quiet += 1
        }
      },
      unmount () {
        for (const inst of root.instances.values()) for (const s of inst.slots) if (typeof s.cleanup === 'function') { try { s.cleanup() } catch (e) { /* unmount */ } }
        root.instances.clear()
        root.tree = null
      },
    }
    root.render()
    return root
  }
  const walk = (node, fn) => { if (node === null || node === undefined) return; fn(node); for (const c of node.children || []) walk(c, fn) }
  /** Every element (not text) of the tree for which `pred` is true. */
  const find = (tree, pred) => { const out = []; walk(tree, (n) => { if (n.tag !== undefined && n.tag !== '#' && pred(n)) out.push(n) }); return out }
  const textOf = (node) => (node === null || node === undefined ? '' : (node.text !== undefined ? node.text : (node.children || []).map(textOf).join('')))
  return { React, mount, find, textOf }
}
