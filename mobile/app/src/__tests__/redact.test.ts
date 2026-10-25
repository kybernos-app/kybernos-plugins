import { redact } from '../redact'

describe('redact', () => {
  it('hides the sign-in token', () => {
    expect(redact('dsh web: http://127.0.0.1:5000/?token=Zm9vYmFy&x=1')).toBe('dsh web: http://127.0.0.1:5000/?token=…&x=1')
  })
  it('hides model keys', () => {
    expect(redact('key sk-ant-api03-AbCdEf123456_-xyz and sk-proj1234567890abcdef12345')).toBe('key sk-ant-… and sk-…')
  })
  it('leaves ordinary text alone', () => {
    expect(redact('the task-list is sk-short and token is fine')).toBe('the task-list is sk-short and token is fine')
  })
})
