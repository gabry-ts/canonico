import AppKit

// Renders the 1024x1024 app icon: a blue rounded "C" mark on white.
let size = 1024
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
NSColor.white.setFill()
NSRect(x: 0, y: 0, width: size, height: size).fill()
let blue = NSColor(calibratedRed: 0.15, green: 0.39, blue: 0.92, alpha: 1)
let plate = NSBezierPath(roundedRect: NSRect(x: 192, y: 192, width: 640, height: 640), xRadius: 150, yRadius: 150)
blue.setFill()
plate.fill()
let ring = NSBezierPath()
ring.appendArc(withCenter: NSPoint(x: 512, y: 512), radius: 190, startAngle: 40, endAngle: 320)
ring.lineWidth = 92
ring.lineCapStyle = .round
NSColor.white.setStroke()
ring.stroke()
NSGraphicsContext.restoreGraphicsState()
let data = rep.representation(using: .png, properties: [:])!
try! data.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
