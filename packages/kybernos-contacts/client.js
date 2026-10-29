// kybernos-contacts — browser half. Nothing to draw in this release: the page arrives with a later lot. The factory still returns a plugin, as the loader
// requires, and never throws.
window.__ModuleLoader__.load({
  id: '@local/kybernos-contacts',
  factory: () => {
    try {
      return { name: 'kybernos-contacts', apply () {} }
    } catch (e) {
      console.warn('[kybernos-contacts] disabled:', e)
      return { apply () {} }
    }
  }
})
