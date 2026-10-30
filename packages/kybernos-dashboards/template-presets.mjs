// kybernos-dashboards: the presets the installed templates ship (the point `kybernos/dashboards#preset`, preset-point.mjs), as the Presets gallery and the
// « Overview » row of the Business group read them. Pure: the registry comes in through a port and is asked when a request comes, never at boot.
import { slug } from './model.mjs'
import { LIMITS, POINT_REF, validateDashboardPreset } from './preset-point.mjs'

/**
 * THE one place that decides whose presets are offered: the ACTIVE template's (the Business pages show one template at a time), while it is installed. `plugin` is
 * the registry's record of the plugin that contributes (or `null` when the registry does not know it); the registry itself only hands back the contributions of a
 * plugin that is enabled and valid. `active` is the id of the template the Business pages follow, or `null` when none is chosen (then every installed template's).
 */
export const isOffered = (plugin, active = null) => plugin !== null && plugin !== undefined && plugin.status === 'ok' && (typeof active !== 'string' || active === '' || plugin.id === active)

/** The id a template's dashboard is known by on the page: `<template>-<file>` (`real-estate-overview`), a valid dashboard id. */
export const presetIdOf = (pluginId, fileId) => slug(String(pluginId).split('/').pop() + '-' + fileId, 'template-dashboard')

/**
 * The presets of the installed templates: `[{ id, name, desc, widgets, menu, overview, template: { id, name } }]`, at most LIMITS.presets. `taken` are the ids of the
 * built-in presets (a template never takes one of them). Each contribution is checked again, because the registry may be another version than the one that wrote
 * this file. Never throws; no registry, or a broken one, is no preset.
 */
export function templatePresets (registry, taken = [], active = null) {
  const out = []
  try {
    if (registry === null || registry === undefined || typeof registry.contributions !== 'function') return out
    const plugins = new Map()
    for (const p of typeof registry.plugins === 'function' ? registry.plugins() : []) if (p !== null && typeof p === 'object' && typeof p.id === 'string') plugins.set(p.id, p)
    const seen = new Set(taken)
    for (const c of registry.contributions(POINT_REF)) {
      if (c === null || typeof c !== 'object' || typeof c.plugin !== 'string') continue
      const plugin = plugins.get(c.plugin) || null
      if (!isOffered(plugin, active)) continue
      const checked = validateDashboardPreset(c.value, c.value !== null && typeof c.value === 'object' ? c.value.id : undefined)
      if (checked.ok !== true) continue
      const id = presetIdOf(c.plugin, checked.value.id)
      if (seen.has(id)) continue
      seen.add(id)
      const v = checked.value
      out.push({ id, name: v.name, desc: v.desc, widgets: v.widgets, menu: v.menu === undefined ? null : v.menu, overview: v.overview === true, template: { id: c.plugin, name: String(plugin.name || c.plugin).slice(0, 80) } })
      if (out.length >= LIMITS.presets) break
    }
  } catch (e) { out.length = 0 }
  return out
}

/** The word of the Business row, in both languages: the template's own `menu`, else « Overview ». */
export const rowLabel = (preset) => {
  const m = preset !== null && preset !== undefined && preset.menu !== null && typeof preset.menu === 'object' ? preset.menu : null
  return m === null || typeof m.en !== 'string' ? { en: 'Overview', fr: 'Vue d’ensemble' } : { ...m, fr: typeof m.fr === 'string' ? m.fr : m.en }
}

/** The dashboard the row opens: the first template preset marked `overview`, else the first one; `null` when no template ships any. */
export const overviewOf = (presets) => {
  const list = Array.isArray(presets) ? presets : []
  return list.find((p) => p.overview === true) || list[0] || null
}
