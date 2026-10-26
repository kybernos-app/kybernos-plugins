import { createSettings, CONSENT_SLOT, CONSENT_VERSION, KEEP_RUNNING_SLOT, WELCOME_SLOT, REMINDERS_SLOT, SecureStorage } from '../settings'

const memory = (): SecureStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>()
  return { data, get: async (n) => data.get(n) ?? null, set: async (n, v) => { data.set(n, v) }, remove: async (n) => { data.delete(n) } }
}

describe('settings', () => {
  it('treats an unreadable storage as nothing stored, never as a failure', async () => {
    const broken: SecureStorage = { get: async () => { throw new Error('keychain locked') }, set: async () => { throw new Error('keychain locked') }, remove: async () => { throw new Error('x') } }
    const s = createSettings(broken)
    expect(await s.consented()).toBe(false) // the engine is not started on a storage that cannot tell
    expect(await s.welcomeSeen()).toBe(false) // an unreadable flag shows the welcome page again rather than hiding it for good
    await expect(s.markWelcomeSeen()).resolves.toBeUndefined()
  })
  it('keeps the two Background switches, off until turned on, and off again when turned off', async () => {
    const store = memory(); const s = createSettings(store)
    expect(await s.keepRunning()).toBe(false); expect(await s.reminders()).toBe(false)
    await s.setKeepRunning(true); await s.setReminders(true)
    expect(store.data.get(KEEP_RUNNING_SLOT)).toBe('1'); expect(store.data.get(REMINDERS_SLOT)).toBe('1')
    expect(await s.keepRunning()).toBe(true); expect(await s.reminders()).toBe(true)
    await s.setKeepRunning(false); await s.setReminders(false)
    expect(store.data.has(KEEP_RUNNING_SLOT)).toBe(false); expect(await s.reminders()).toBe(false)
  })
  it('reads the switches as off when the storage cannot be read', async () => {
    const broken: SecureStorage = { get: async () => { throw new Error('locked') }, set: async () => { throw new Error('locked') }, remove: async () => { throw new Error('locked') } }
    const s = createSettings(broken)
    expect(await s.keepRunning()).toBe(false); expect(await s.reminders()).toBe(false)
    await expect(s.setKeepRunning(true)).resolves.toBeUndefined()
  })
  it('remembers that the welcome page was seen', async () => {
    const store = memory(); const s = createSettings(store)
    expect(await s.welcomeSeen()).toBe(false)
    await s.markWelcomeSeen()
    expect(store.data.get(WELCOME_SLOT)).toBe('1'); expect(await s.welcomeSeen()).toBe(true)
  })
  it('asks the agreement again for an older text (version 1 was the text that named Anthropic by default)', async () => {
    const store = memory(); store.data.set('kybernos.ai-consent', '1'); const s = createSettings(store)
    expect(await s.consented()).toBe(false)
    await s.giveConsent()
    expect(await s.consented()).toBe(true)
  })
})

describe('consent to send what is written to the AI provider', () => {
  it('is absent until given, stored with the version of the text, and gone once withdrawn', async () => {
    const store = memory(); const s = createSettings(store)
    expect(await s.consented()).toBe(false)
    await s.giveConsent()
    expect(store.data.get(CONSENT_SLOT)).toBe(CONSENT_VERSION); expect(await s.consented()).toBe(true)
    await s.withdrawConsent()
    expect(await s.consented()).toBe(false); expect(store.data.has(CONSENT_SLOT)).toBe(false)
  })
  it('asks again when the text it was given for is an older version', async () => {
    const store = memory(); const s = createSettings(store)
    store.data.set(CONSENT_SLOT, CONSENT_VERSION + '-old')
    expect(await s.consented()).toBe(false)
  })
  it('never lets an unreadable storage count as an agreement, and never throws on a write that fails', async () => {
    const broken: SecureStorage = { get: async () => { throw new Error('keychain locked') }, set: async () => { throw new Error('x') }, remove: async () => { throw new Error('x') } }
    const s = createSettings(broken)
    expect(await s.consented()).toBe(false)
    await expect(s.giveConsent()).resolves.toBeUndefined(); await expect(s.withdrawConsent()).resolves.toBeUndefined()
  })
})
