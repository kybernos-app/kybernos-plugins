/** The app's own settings, kept in the device's secure storage (iOS Keychain, Android Keystore through expo-secure-store): the agreement to send what is written to the AI provider, the welcome page
 *  seen, and the two Background switches. The model key is NOT here: it is pasted in the first-run wizard of DSH and kept by DSH (packages/kybernos-plugin, packages/kybernos-models).
 *  Everything here works against a small storage interface so it is tested without a device. */
export interface SecureStorage {
  get(name: string): Promise<string | null>
  set(name: string, value: string): Promise<void>
  remove(name: string): Promise<void>
}

/** Set once the welcome page has been seen: a first launch shows it, later ones do not. */
export const WELCOME_SLOT = 'kybernos.welcome-seen'

/** The person's agreement to send what they write to their AI provider (Apple 5.1.2(i)). The stored value is the version of the text they agreed to: a materially changed text asks again. */
export const CONSENT_SLOT = 'kybernos.ai-consent'
export const CONSENT_VERSION = '3' // 2: the text no longer names one provider by default (it names Kybernos and the provider of the person's own key). 3: the same meaning in two short sentences, the detail one tap away

/** Switches of the Background section (both off until the person turns them on). */
export const KEEP_RUNNING_SLOT = 'kybernos.keep-running'
export const REMINDERS_SLOT = 'kybernos.reminders'

export const createSettings = (store: SecureStorage) => ({
  async keepRunning(): Promise<boolean> { try { return (await store.get(KEEP_RUNNING_SLOT)) === '1' } catch { return false } },
  async setKeepRunning(on: boolean): Promise<void> { try { if (on) await store.set(KEEP_RUNNING_SLOT, '1'); else await store.remove(KEEP_RUNNING_SLOT) } catch { /* the switch then shows its old state */ } },
  async reminders(): Promise<boolean> { try { return (await store.get(REMINDERS_SLOT)) === '1' } catch { return false } },
  async setReminders(on: boolean): Promise<void> { try { if (on) await store.set(REMINDERS_SLOT, '1'); else await store.remove(REMINDERS_SLOT) } catch { /* the switch then shows its old state */ } },
  /** True only when the stored agreement is for the current text. An unreadable storage asks again: it never lets the engine start without it. */
  async consented(): Promise<boolean> { try { return (await store.get(CONSENT_SLOT)) === CONSENT_VERSION } catch { return false } },
  async giveConsent(): Promise<void> { try { await store.set(CONSENT_SLOT, CONSENT_VERSION) } catch { /* it asks again at the next launch */ } },
  async withdrawConsent(): Promise<void> { try { await store.remove(CONSENT_SLOT) } catch { /* nothing more can be done here */ } },
  /** True once the welcome page was seen. An unreadable storage shows it again rather than hiding it for good. */
  async welcomeSeen(): Promise<boolean> { try { return (await store.get(WELCOME_SLOT)) === '1' } catch { return false } },
  async markWelcomeSeen(): Promise<void> { try { await store.set(WELCOME_SLOT, '1') } catch { /* it shows again next time */ } },
})
export type Settings = ReturnType<typeof createSettings>
