import Svg, { Circle, G, Polygon, Rect } from 'react-native-svg'

/** The Kybernos K: a red K with three white dots on its stem. The numbers are the web client's own (the block KB-BRAND-CORE of packages/kybernos-plugin/client.js, `kbBrandArt`);
 *  scripts/test-mobile-brand-assets.mjs fails if they drift. */
export const K_RED = '#f2372a'
export const K_BOX = { width: 32.5, height: 36 }
export const K_STEM = { x: 0, y: 0, width: 13, height: 36 }
export const K_ARM = '21,0 31,0 13,28.3 13,12.6'
export const K_LEG = '13,22 22,36 32.5,36 20.3,16.8 13,16.8'
export const K_DOTS = { cx: 6.5, cy: [7.5, 18, 28.5], r: 2.8 }

export function BrandMark({ height }: { height: number }) {
  return (
    <Svg width={(height * K_BOX.width) / K_BOX.height} height={height} viewBox={`0 0 ${K_BOX.width} ${K_BOX.height}`} accessibilityLabel="Kybernos" accessibilityRole="image">
      <G fill={K_RED}>
        <Rect x={K_STEM.x} y={K_STEM.y} width={K_STEM.width} height={K_STEM.height} />
        <Polygon points={K_ARM} />
        <Polygon points={K_LEG} />
      </G>
      <G fill="#fff">{K_DOTS.cy.map((y) => <Circle key={y} cx={K_DOTS.cx} cy={y} r={K_DOTS.r} />)}</G>
    </Svg>
  )
}
