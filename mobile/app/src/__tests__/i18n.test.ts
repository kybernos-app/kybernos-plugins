import { detectLang } from '../i18n'

describe('detectLang', () => {
  it('speaks French on a French phone, whatever the region or the separator', () => {
    for (const l of ['fr', 'fr-FR', 'fr_FR', 'fr-CA', 'FR-be', ' fr-CH ']) expect(detectLang(l)).toBe('fr')
  })
  it('speaks English everywhere else and when the language cannot be read', () => {
    for (const l of ['en', 'en-US', 'es-ES', 'ar', 'fra', 'frisian', '', null, undefined]) expect(detectLang(l as any)).toBe('en')
  })
})
