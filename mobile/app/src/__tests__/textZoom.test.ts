import { MAX_TEXT_ZOOM, webTextZoom } from '../textZoom'

describe('webTextZoom', () => {
  it('follows the system font size up to the ceiling', () => {
    expect(webTextZoom(1)).toBe(100)
    expect(webTextZoom(1.1)).toBe(110)
    expect(webTextZoom(1.15)).toBe(115)
  })
  it('caps a large font size (145 % is what broke the layout on a real phone)', () => {
    expect(webTextZoom(1.45)).toBe(MAX_TEXT_ZOOM)
    expect(webTextZoom(2)).toBe(MAX_TEXT_ZOOM)
  })
  it('never shrinks the text below 100 %, and ignores a value that is not a number', () => {
    expect(webTextZoom(0.85)).toBe(100)
    expect(webTextZoom(NaN)).toBe(100)
    expect(webTextZoom(0)).toBe(100)
    expect(webTextZoom(-3)).toBe(100)
    expect(webTextZoom(Infinity)).toBe(100)
  })
  it('takes another ceiling when asked', () => {
    expect(webTextZoom(1.45, 130)).toBe(130)
    expect(webTextZoom(1.2, 130)).toBe(120)
  })
})
