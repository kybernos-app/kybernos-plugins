import { checkAnthropicKey, createSettings, keyHint, KEY_SLOT, PROMPT_SLOT, SecureStorage } from '../settings'

const GOOD = 'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv_-0123'
const memory = (): SecureStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>()
  return { data, get: async (n) => data.get(n) ?? null, set: async (n, v) => { data.set(n, v) }, remove: async (n) => { data.delete(n) } }
}

describe('checkAnthropicKey', () => {
  it('accepts a key and trims the line break, spaces and quotes a paste brings', () => {
    expect(checkAnthropicKey(GOOD)).toEqual({ ok: true, key: GOOD })
    expect(checkAnthropicKey('  ' + GOOD + '\n')).toEqual({ ok: true, key: GOOD })
    expect(checkAnthropicKey('"' + GOOD + '"')).toEqual({ ok: true, key: GOOD })
  })
  it('refuses an empty paste, text with spaces, and something that is not an Anthropic key', () => {
    expect(checkAnthropicKey('   ')).toMatchObject({ ok: false })
    expect(checkAnthropicKey('sk-ant-one two')).toMatchObject({ ok: false, reason: expect.stringContaining('spaces') })
    expect(checkAnthropicKey('sk-ant-short')).toMatchObject({ ok: false })
    expect(checkAnthropicKey('sk-proj-abcdefghijklmnopqrstuvwxyz')).toMatchObject({ ok: false })
    expect(checkAnthropicKey('hello world')).toMatchObject({ ok: false })
  })
  it('never puts the refused text in its answer', () => {
    const r = checkAnthropicKey('sk-ant-secret-short')
    expect(JSON.stringify(r)).not.toContain('secret')
  })
})

describe('settings', () => {
  it('stores a valid key only, shows its last four characters, and removes it', async () => {
    const store = memory(); const s = createSettings(store)
    expect(await s.keyHint()).toBeNull()
    expect(await s.save('nope')).toMatchObject({ ok: false })
    expect(store.data.size).toBe(0)
    expect(await s.save(GOOD + '\n')).toEqual({ ok: true, key: GOOD })
    expect(store.data.get(KEY_SLOT)).toBe(GOOD)
    expect(await s.keyHint()).toBe(keyHint(GOOD)); expect(await s.keyHint()).toBe('…0123')
    await s.remove()
    expect(await s.keyHint()).toBeNull(); expect(store.data.has(KEY_SLOT)).toBe(false)
  })
  it('gives the engine its key as ANTHROPIC_API_KEY, or nothing', async () => {
    const store = memory(); const s = createSettings(store)
    expect(await s.engineEnv()).toEqual({})
    await s.save(GOOD)
    expect(await s.engineEnv()).toEqual({ ANTHROPIC_API_KEY: GOOD })
  })
  it('treats an unreadable storage as no key, never as a failed start', async () => {
    const broken: SecureStorage = { get: async () => { throw new Error('keychain locked') }, set: async () => { throw new Error('keychain locked') }, remove: async () => { throw new Error('x') } }
    const s = createSettings(broken)
    expect(await s.engineEnv()).toEqual({}); expect(await s.keyHint()).toBeNull()
    expect(await s.promptDone()).toBe(true) // an unreadable flag must not trap the user in the first-run screen
    await expect(s.markPromptDone()).resolves.toBeUndefined()
  })
  it('remembers that the first-run screen was shown', async () => {
    const store = memory(); const s = createSettings(store)
    expect(await s.promptDone()).toBe(false)
    await s.markPromptDone()
    expect(store.data.get(PROMPT_SLOT)).toBe('1'); expect(await s.promptDone()).toBe(true)
  })
})
