/**
 * dsh-media-player — host half.
 *
 * The plugin is purely client-side: it only adds a preview renderer to the
 * page (no route, no service, no tool). The host half exists because the
 * profile loader composes this package like any other entry; `apply` has
 * nothing to do and must start nothing at all.
 */
export const name = 'dsh-media-player'

/** No-op: all the work lives in `client/client.js`. */
export function apply() {}
