/** The app's settings that are secrets: the model key lives in the device's secure storage (iOS Keychain, Android Keystore through expo-secure-store), never in a file, and reaches the engine
 *  only as the environment variable ANTHROPIC_API_KEY when it starts. Everything here works against a small storage interface so it is tested without a device. */
export interface SecureStorage {
  get(name: string): Promise<string | null>
  set(name: string, value: string): Promise<void>
  remove(name: string): Promise<void>
}

export const KEY_SLOT = 'kybernos.anthropic-key'
/** Set once the first-run key screen has been shown (or skipped), so it does not come back at every launch. */
export const PROMPT_SLOT = 'kybernos.key-prompt-done'

/** Switches of the Background section (both off until the person turns them on). */
export const KEEP_RUNNING_SLOT = 'kybernos.keep-running'
export const REMINDERS_SLOT = 'kybernos.reminders'

const ANTHROPIC_KEY = /^sk-ant-[A-Za-z0-9_-]{20,}$/

export type KeyCheck = { ok: true; key: string } | { ok: false; reason: string }

/** A pasted key often carries a trailing newline or quotes: trim them, then check the shape (not that the key works: only a request tells). */
export const checkAnthropicKey = (raw: string): KeyCheck => {
  const key = raw.trim().replace(/^(["'`])(.*)\1$/, '$2').trim()
  if (key === '') return { ok: false, reason: 'Paste your Anthropic key first.' }
  if (/\s/.test(key)) return { ok: false, reason: 'A key has no spaces or line breaks: paste only the key.' }
  if (!ANTHROPIC_KEY.test(key)) return { ok: false, reason: 'This does not look like an Anthropic key (it starts with sk-ant- and is longer).' }
  return { ok: true, key }
}

/** What the screen shows of a stored key: the last four characters, nothing more. */
export const keyHint = (key: string): string => '…' + key.slice(-4)

export const createSettings = (store: SecureStorage) => ({
  /** The hint of the stored key, or null when there is none (or the storage cannot be read). */
  async keyHint(): Promise<string | null> {
    try { const k = await store.get(KEY_SLOT); return k ? keyHint(k) : null } catch { return null }
  },
  async save(raw: string): Promise<KeyCheck> {
    const check = checkAnthropicKey(raw)
    if (check.ok) await store.set(KEY_SLOT, check.key)
    return check
  },
  async remove(): Promise<void> { await store.remove(KEY_SLOT) },
  /** The environment handed to the engine when it starts. An unreadable storage is an engine without a key, never a failed start. */
  async engineEnv(): Promise<Record<string, string>> {
    try { const k = await store.get(KEY_SLOT); return k ? { ANTHROPIC_API_KEY: k } : {} } catch { return {} }
  },
  async keepRunning(): Promise<boolean> { try { return (await store.get(KEEP_RUNNING_SLOT)) === '1' } catch { return false } },
  async setKeepRunning(on: boolean): Promise<void> { try { if (on) await store.set(KEEP_RUNNING_SLOT, '1'); else await store.remove(KEEP_RUNNING_SLOT) } catch { /* the switch then shows its old state */ } },
  async reminders(): Promise<boolean> { try { return (await store.get(REMINDERS_SLOT)) === '1' } catch { return false } },
  async setReminders(on: boolean): Promise<void> { try { if (on) await store.set(REMINDERS_SLOT, '1'); else await store.remove(REMINDERS_SLOT) } catch { /* the switch then shows its old state */ } },
  async promptDone(): Promise<boolean> {
    try { return (await store.get(PROMPT_SLOT)) === '1' } catch { return true }
  },
  async markPromptDone(): Promise<void> {
    try { await store.set(PROMPT_SLOT, '1') } catch { /* it shows again next time */ }
  },
})
export type Settings = ReturnType<typeof createSettings>
