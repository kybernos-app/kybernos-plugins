/**
 * dsh-mermaid — host half.
 *
 * The plugin is purely client-side: it only adds rendering to the page (no route,
 * no service, no tool). The host half exists because the profile loader composes
 * this package as an ordinary entry; `apply` therefore has nothing to do and must
 * start nothing.
 */
export const name = 'dsh-mermaid'

/** No-op: all the work lives in `client/client.js`. */
export function apply() {}
