import AppKit
import Foundation

/// Render branding/app-icon.svg to a square PNG with a clear (transparent) canvas.
/// Usage: render-app-icon <svg> <png> [size]

guard CommandLine.arguments.count >= 3 else {
  fputs("usage: render-app-icon <svg> <png> [size]\n", stderr)
  exit(2)
}

let svgPath = CommandLine.arguments[1]
let outPath = CommandLine.arguments[2]
let size = CommandLine.arguments.count >= 4
  ? CGFloat(Double(CommandLine.arguments[3]) ?? 1024)
  : 1024

guard let image = NSImage(contentsOf: URL(fileURLWithPath: svgPath)) else {
  fputs("failed to load svg: \(svgPath)\n", stderr)
  exit(1)
}

guard let rep = NSBitmapImageRep(
  bitmapDataPlanes: nil,
  pixelsWide: Int(size),
  pixelsHigh: Int(size),
  bitsPerSample: 8,
  samplesPerPixel: 4,
  hasAlpha: true,
  isPlanar: false,
  colorSpaceName: .deviceRGB,
  bytesPerRow: 0,
  bitsPerPixel: 0
) else {
  fputs("failed to allocate bitmap\n", stderr)
  exit(1)
}
rep.size = NSSize(width: size, height: size)

NSGraphicsContext.saveGraphicsState()
guard let ctx = NSGraphicsContext(bitmapImageRep: rep) else {
  fputs("no graphics context\n", stderr)
  exit(1)
}
NSGraphicsContext.current = ctx
ctx.cgContext.clear(CGRect(x: 0, y: 0, width: size, height: size))
image.draw(
  in: NSRect(x: 0, y: 0, width: size, height: size),
  from: .zero,
  operation: .sourceOver,
  fraction: 1.0,
  respectFlipped: true,
  hints: [.interpolation: NSImageInterpolation.high]
)
NSGraphicsContext.restoreGraphicsState()

guard let png = rep.representation(using: .png, properties: [:]) else {
  fputs("png encode failed\n", stderr)
  exit(1)
}

do {
  try png.write(to: URL(fileURLWithPath: outPath))
} catch {
  fputs("write failed: \(error)\n", stderr)
  exit(1)
}

print("wrote \(outPath)")
