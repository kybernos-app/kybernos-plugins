import { isAppEntryMessage } from '../webMessage'

describe('isAppEntryMessage', () => {
  it('accepts the message the interface sends once it has its own settings entry', () => {
    expect(isAppEntryMessage(JSON.stringify({ kybernos: 'app-entry', entry: 'settings', version: 1 }))).toBe(true)
  })
  it('ignores everything else: other messages, other entries, text, numbers, huge strings, broken JSON', () => {
    expect(isAppEntryMessage(JSON.stringify({ kybernos: 'app-entry', entry: 'log' }))).toBe(false)
    expect(isAppEntryMessage(JSON.stringify({ kybernos: 'other', entry: 'settings' }))).toBe(false)
    expect(isAppEntryMessage('hello')).toBe(false)
    expect(isAppEntryMessage('null')).toBe(false)
    expect(isAppEntryMessage('{"kybernos":"app-entry","entry":"settings"')).toBe(false)
    expect(isAppEntryMessage(42)).toBe(false)
    expect(isAppEntryMessage(undefined)).toBe(false)
    expect(isAppEntryMessage(JSON.stringify({ kybernos: 'app-entry', entry: 'settings', pad: 'x'.repeat(300) }))).toBe(false)
  })
})
