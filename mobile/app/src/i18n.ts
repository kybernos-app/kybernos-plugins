/** The app's own screens (welcome, consent, loading) speak English or French. The web interface has its own language setting; this is only for what shows before it. */
export type Lang = 'en' | 'fr'

export const detectLang = (locale: string | null | undefined): Lang => (typeof locale === 'string' && /^fr(\b|[-_])/i.test(locale.trim()) ? 'fr' : 'en')

/** The phone's language; anything unreadable counts as English. */
export const deviceLang = (): Lang => {
  try { return detectLang(Intl.DateTimeFormat().resolvedOptions().locale) } catch { return 'en' }
}
