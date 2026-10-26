import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { ScrollView, Text } from 'react-native'
import { useFit } from '../fit'

function Probe({ max }: { max: number }) {
  const f = useFit(max)
  return <ScrollView testID="s" onLayout={f.onLayout} onContentSizeChange={f.onContentSizeChange}><Text testID="tier">{String(f.tier)}</Text></ScrollView>
}
const layout = (h: number) => fireEvent(screen.getByTestId('s'), 'layout', { nativeEvent: { layout: { height: h } } })
const content = (h: number) => fireEvent(screen.getByTestId('s'), 'contentSizeChange', 300, h)
const later = (ms: number) => act(async () => { jest.advanceTimersByTime(ms) })
const tier = () => Number(screen.getByTestId('tier').props.children)

describe('useFit', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('stays at tier 0 while the content fits', async () => {
    await render(<Probe max={3} />)
    await layout(600); await content(500); await later(200)
    expect(tier()).toBe(0)
  })
  it('steps down one tier at a time while the content is taller than the room, and stops when it fits', async () => {
    await render(<Probe max={3} />)
    await layout(600); await content(720); await later(70)
    expect(tier()).toBe(1)
    await content(650); await later(70)
    expect(tier()).toBe(2)
    await content(590); await later(500)
    expect(tier()).toBe(2)
  })
  it('keeps stepping when a tier changes nothing about the height (no new measure arrives)', async () => {
    await render(<Probe max={3} />)
    await layout(600); await content(720); await later(70)
    await later(70); await later(70); await later(200)
    expect(tier()).toBe(3)
  })
  it('never goes past the last tier (the scroll view is then the safety net)', async () => {
    await render(<Probe max={2} />)
    await layout(300); await content(900)
    for (let i = 0; i < 8; i++) await later(70)
    expect(tier()).toBe(2)
  })
  it('does nothing before it knows the room', async () => {
    await render(<Probe max={3} />)
    await content(900); await later(300)
    expect(tier()).toBe(0)
  })
})
