import AppKit

// The Kybernos mark: a red K whose stem carries three white dots. The geometry is the one of `kbBrandArt` in
// packages/kybernos-plugin/client.js (favicon view box, dots of radius 3.3); `test-helper.mjs` fails when the two drift apart.
// BRAND-BEGIN
private let brandViewBox = CGRect(x: -3, y: -1, width: 38.5, height: 38)
private let brandStem = CGRect(x: 0, y: 0, width: 13, height: 36)
private let brandArm: [CGPoint] = [(21, 0), (31, 0), (13, 28.3), (13, 12.6)].map { CGPoint(x: $0.0, y: $0.1) }
private let brandLeg: [CGPoint] = [(13, 22), (22, 36), (32.5, 36), (20.3, 16.8), (13, 16.8)].map { CGPoint(x: $0.0, y: $0.1) }
private let brandDots: [CGPoint] = [(6.5, 7.5), (6.5, 18), (6.5, 28.5)].map { CGPoint(x: $0.0, y: $0.1) }
private let brandDotRadius: CGFloat = 3.3
// BRAND-END

private let brandRed = NSColor(srgbRed: 0xf2 / 255, green: 0x37 / 255, blue: 0x2a / 255, alpha: 1)

func dotColor(_ tone: Tone) -> NSColor? {
    switch tone {
    case .bad: return NSColor(srgbRed: 1.0, green: 0.23, blue: 0.19, alpha: 1) // the white ring around it is what shows on the red K
    case .ask: return NSColor(srgbRed: 1.0, green: 0.62, blue: 0.04, alpha: 1)
    case .run: return NSColor(srgbRed: 0.04, green: 0.52, blue: 1.0, alpha: 1)
    case .ok, .idle: return nil
    }
}

/// The K at `height` points, in colour. `dim` is for « Kybernos is not running »; `dot` is the little status dot at the top right.
func brandImage(height: CGFloat, dim: Bool, dot: NSColor?) -> NSImage {
    let width = height * brandViewBox.width / brandViewBox.height
    let image = NSImage(size: NSSize(width: width, height: height), flipped: true) { rect in
        guard let g = NSGraphicsContext.current?.cgContext else { return false }
        let s = rect.height / brandViewBox.height
        g.saveGState()
        g.scaleBy(x: s, y: s)
        g.translateBy(x: -brandViewBox.minX, y: -brandViewBox.minY)
        g.setAlpha(dim ? 0.4 : 1)
        g.setFillColor(brandRed.cgColor)
        g.fill(brandStem)
        for poly in [brandArm, brandLeg] {
            g.beginPath()
            g.move(to: poly[0])
            for p in poly.dropFirst() { g.addLine(to: p) }
            g.closePath()
            g.fillPath()
        }
        g.setFillColor(NSColor.white.cgColor)
        for c in brandDots {
            g.fillEllipse(in: CGRect(x: c.x - brandDotRadius, y: c.y - brandDotRadius, width: brandDotRadius * 2, height: brandDotRadius * 2))
        }
        if let dot = dot, !dim {
            let c = CGPoint(x: 31.5, y: 5.5), r: CGFloat = 6.2
            g.setFillColor(NSColor.white.cgColor)
            g.fillEllipse(in: CGRect(x: c.x - r - 1.6, y: c.y - r - 1.6, width: (r + 1.6) * 2, height: (r + 1.6) * 2))
            g.setFillColor(dot.cgColor)
            g.fillEllipse(in: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2))
        }
        g.restoreGState()
        return true
    }
    image.isTemplate = false
    return image
}
