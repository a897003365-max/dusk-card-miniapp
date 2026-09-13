// Compile: xcrun swiftc scripts/check-sprite-alpha.swift -o /tmp/dusk-check-sprite-alpha
// Run: /tmp/dusk-check-sprite-alpha /absolute/image.png [/absolute/another.png ...]
// Reads PNGs only. A painted checkerboard has alpha 255 and fails this check.
// Bounds use decoded scanline coordinates; any edge contact is a warning, not failure.

import CoreGraphics
import Darwin
import Foundation
import ImageIO

struct AlphaCheckError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

func inspectPNG(_ path: String) throws -> [String: Any] {
    guard NSString(string: path).isAbsolutePath else {
        throw AlphaCheckError(message: "必须提供绝对路径")
    }
    let url = URL(fileURLWithPath: path)
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let type = CGImageSourceGetType(source), type as String == "public.png",
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        throw AlphaCheckError(message: "无法读取或解码 PNG")
    }
    let width = image.width
    let height = image.height
    let (pixelCount, pixelOverflow) = width.multipliedReportingOverflow(by: height)
    let (byteCount, byteOverflow) = pixelCount.multipliedReportingOverflow(by: 4)
    guard width > 0, height > 0, !pixelOverflow, !byteOverflow else {
        throw AlphaCheckError(message: "图像尺寸无效或超出可解码范围")
    }
    var pixels = [UInt8](repeating: 0, count: byteCount)
    let decoded = pixels.withUnsafeMutableBytes { buffer -> Bool in
        let layout = CGBitmapInfo.byteOrder32Big.rawValue | CGImageAlphaInfo.premultipliedLast.rawValue
        guard let context = CGContext(data: buffer.baseAddress, width: width, height: height,
                                      bitsPerComponent: 8, bytesPerRow: width * 4,
                                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: layout) else { return false }
        context.setBlendMode(.copy)
        context.interpolationQuality = .none
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        return true
    }
    guard decoded else { throw AlphaCheckError(message: "无法建立确定字节序的 RGBA 解码缓冲区") }

    var transparent = 0
    var semitransparent = 0
    var opaque = 0
    var alphaMin = 255
    var alphaMax = 0
    var minX = width, minY = height, maxX = -1, maxY = -1
    for y in 0..<height {
        for x in 0..<width {
            let alpha = Int(pixels[(y * width + x) * 4 + 3])
            alphaMin = min(alphaMin, alpha)
            alphaMax = max(alphaMax, alpha)
            if alpha == 0 { transparent += 1 }
            else {
                if alpha == 255 { opaque += 1 } else { semitransparent += 1 }
                minX = min(minX, x); maxX = max(maxX, x)
                minY = min(minY, y); maxY = max(maxY, y)
            }
        }
    }
    let hasContent = maxX >= 0
    let edges = ["left": hasContent && minX == 0, "top": hasContent && minY == 0,
                 "right": hasContent && maxX == width - 1, "bottom": hasContent && maxY == height - 1]
    let touchesEdge = edges.values.contains(true)
    var reasons: [String] = []
    if transparent == 0 { reasons.append("没有实际 alpha=0 的透明像素") }
    if !hasContent { reasons.append("整张图片完全透明，没有可见内容") }
    let bounds: Any = hasContent
        ? ["x": minX, "y": minY, "width": maxX - minX + 1, "height": maxY - minY + 1,
           "minX": minX, "minY": minY, "maxX": maxX, "maxY": maxY]
        : NSNull()
    return ["path": path, "width": width, "height": height, "pixelCount": pixelCount,
            "decodedFormat": "RGBA8-premultipliedLast-bigEndian", "sourceBitsPerComponent": image.bitsPerComponent,
            "transparentPixels": transparent, "semiTransparentPixels": semitransparent, "opaquePixels": opaque,
            "alphaMin": alphaMin, "alphaMax": alphaMax, "nonTransparentBounds": bounds,
            "touchesCanvasEdge": touchesEdge, "edges": edges,
            "status": reasons.isEmpty ? "pass" : "fail", "reasons": reasons,
            "warnings": touchesEdge ? ["非透明像素碰到画布边缘，请人工确认是否裁切"] : []]
}

let paths = Array(CommandLine.arguments.dropFirst())
var results: [[String: Any]] = []
if paths.isEmpty {
    results.append(["status": "fail", "error": "用法：check-sprite-alpha /absolute/image.png [...]，至少需要一个 PNG 路径"])
}
for path in paths {
    do { results.append(try inspectPNG(path)) }
    catch { results.append(["path": path, "status": "fail", "error": error.localizedDescription]) }
}
let passed = !results.isEmpty && results.allSatisfy { $0["status"] as? String == "pass" }
let report: [String: Any] = ["status": passed ? "pass" : "fail", "files": results]
do {
    let json = try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
    FileHandle.standardOutput.write(json)
    FileHandle.standardOutput.write(Data([10]))
} catch {
    FileHandle.standardError.write(Data("JSON 输出失败：\(error.localizedDescription)\n".utf8))
    exit(2)
}
exit(passed ? 0 : 1)
