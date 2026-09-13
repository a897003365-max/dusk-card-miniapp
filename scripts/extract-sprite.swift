// 单图本机提取。先由 Kimi Code 建议 Vision 路径，再按 Apple SDK 核对参数与输出格式。
// xcrun swiftc -O scripts/extract-sprite.swift -o /tmp/dusk-extract-sprite
// /tmp/dusk-extract-sprite /absolute/input.png /absolute/new-output.png [--neutral-background] [--neutral-hole=x,y,w,h]
// --neutral-background 仅用于已知灰色棋盘底，沿透明边界去掉 Vision 遗留的中性灰底边。
// --neutral-hole 只用于已人工定位的封闭孔洞；矩形内仍只去除中性灰，保留有色细线。
// --gray-range=low,high 将清理限制到实测背景灰度，避免误去掉主体的深灰条纹。
import Foundation
import Vision
import CoreImage
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

func emit(_ result: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: result, options: [.sortedKeys, .withoutEscapingSlashes])
    FileHandle.standardOutput.write(data + Data([10]))
}
func fail(_ message: String) -> Never { emit(["status": "fail", "error": message]); exit(1) }

guard CommandLine.arguments.count >= 3 else { fail("需要输入与新输出 PNG 的绝对路径") }
let options = Array(CommandLine.arguments.dropFirst(3))
let neutralBackground = options.contains("--neutral-background")
var holes: [[Int]] = []
var grayLow = 70, grayHigh = 245
for option in options {
    if option == "--neutral-background" { continue }
    if option.hasPrefix("--gray-range=") {
        let values = option.dropFirst("--gray-range=".count).split(separator: ",", omittingEmptySubsequences: false)
        let numbers = values.compactMap { Int($0) }
        guard values.count == 2, numbers.count == 2, numbers[0] >= 0, numbers[1] <= 255, numbers[0] < numbers[1] else { fail("灰度范围需要0到255内的low,high") }
        grayLow = numbers[0]; grayHigh = numbers[1]
        continue
    }
    guard option.hasPrefix("--neutral-hole=") else { fail("未知选项") }
    let values = option.dropFirst("--neutral-hole=".count).split(separator: ",", omittingEmptySubsequences: false)
    let numbers = values.compactMap { Int($0) }
    guard values.count == 4, numbers.count == 4, numbers.allSatisfy({ $0 >= 0 }), numbers[2] > 0, numbers[3] > 0 else { fail("孔洞矩形需要非负 x,y 与正 w,h") }
    holes.append(numbers)
}
let input = URL(fileURLWithPath: CommandLine.arguments[1]).standardizedFileURL
let output = URL(fileURLWithPath: CommandLine.arguments[2]).standardizedFileURL
guard CommandLine.arguments[1...2].allSatisfy({ $0.hasPrefix("/") }),
      input.pathExtension.lowercased() == "png", output.pathExtension.lowercased() == "png",
      input.resolvingSymlinksInPath() != output.resolvingSymlinksInPath() else { fail("仅接受不同的绝对 PNG 路径") }
guard !FileManager.default.fileExists(atPath: output.path) else { fail("输出已存在，拒绝覆盖") }
guard let source = CGImageSourceCreateWithURL(input as CFURL, nil),
      CGImageSourceGetType(source) as String? == UTType.png.identifier,
      let original = CGImageSourceCreateImageAtIndex(source, 0, nil) else { fail("无法解码输入 PNG") }
guard holes.allSatisfy({ $0[0] < original.width && $0[1] < original.height && $0[2] <= original.width - $0[0] && $0[3] <= original.height - $0[1] }) else { fail("孔洞矩形超出输入图像") }

if #available(macOS 14.0, *) {
    do {
        let request = VNGenerateForegroundInstanceMaskRequest()
        let handler = VNImageRequestHandler(cgImage: original, orientation: .up)
        try handler.perform([request])
        guard let observation = request.results?.first, !observation.allInstances.isEmpty else { fail("未识别到前景主体") }
        let masked = try observation.generateMaskedImage(ofInstances: observation.allInstances, from: handler, croppedToInstancesExtent: false)
        let image = CIImage(cvPixelBuffer: masked)
        let space = CGColorSpace(name: CGColorSpace.sRGB)!
        let context = CIContext()
        guard let rendered = context.createCGImage(image, from: image.extent, format: .RGBA8, colorSpace: space),
              rendered.width == original.width, rendered.height == original.height else { fail("输出尺寸与输入不同") }

        // 不假设 Vision 的 CVPixelBuffer 格式；转换到确定的 RGBA8 后检查真实 alpha。
        var pixels = [UInt8](repeating: 0, count: rendered.width * rendered.height * 4)
        let decoded = pixels.withUnsafeMutableBytes { bytes -> Bool in
            let format = CGBitmapInfo.byteOrder32Big.rawValue | CGImageAlphaInfo.premultipliedLast.rawValue
            guard let bitmap = CGContext(data: bytes.baseAddress, width: rendered.width, height: rendered.height,
                                         bitsPerComponent: 8, bytesPerRow: rendered.width * 4, space: space, bitmapInfo: format) else { return false }
            bitmap.setBlendMode(.copy)
            bitmap.draw(rendered, in: CGRect(x: 0, y: 0, width: rendered.width, height: rendered.height))
            return true
        }
        guard decoded else { fail("无法检查输出 alpha") }
        var removedFringe = 0
        if neutralBackground {
            // 只清除与已透明背景连通的灰色像素，不按低饱和度抹掉主体内部细节。
            let width = rendered.width, count = width * rendered.height
            var seen = [Bool](repeating: false, count: count)
            var queue: [Int] = []
            queue.reserveCapacity(count)
            for index in 0..<count where pixels[index * 4 + 3] == 0 { seen[index] = true; queue.append(index) }
            var cursor = 0
            while cursor < queue.count {
                let index = queue[cursor], x = index % width
                cursor += 1
                for next in [x > 0 ? index - 1 : -1, x < width - 1 ? index + 1 : -1, index - width, index + width] {
                    if next < 0 || next >= count || seen[next] { continue }
                    seen[next] = true
                    let offset = next * 4, alpha = Int(pixels[offset + 3])
                    let colors = (0..<3).map { Int(pixels[offset + $0]) * 255 / alpha }
                    let low = colors.min()!, high = colors.max()!
                    if high - low <= 18 && low >= grayLow && high < grayHigh {
                        for channel in 0..<4 { pixels[offset + channel] = 0 }
                        queue.append(next)
                        removedFringe += 1
                    }
                }
            }
        }
        var removedHolePixels = 0
        for hole in holes {
            for y in hole[1]..<(hole[1] + hole[3]) {
                for x in hole[0]..<(hole[0] + hole[2]) {
                    let offset = (y * rendered.width + x) * 4, alpha = Int(pixels[offset + 3])
                    if alpha == 0 { continue }
                    let colors = (0..<3).map { Int(pixels[offset + $0]) * 255 / alpha }
                    let low = colors.min()!, high = colors.max()!
                    if high - low <= 18 && low >= grayLow && high < grayHigh {
                        for channel in 0..<4 { pixels[offset + channel] = 0 }
                        removedHolePixels += 1
                    }
                }
            }
        }
        var transparent = 0, visible = 0
        for index in stride(from: 3, to: pixels.count, by: 4) {
            if pixels[index] == 0 { transparent += 1 } else { visible += 1 }
        }
        guard transparent > 0, visible > 0 else { fail("输出全透明或无实际透明像素") }
        guard let cleanImage = pixels.withUnsafeMutableBytes({ bytes -> CGImage? in
            let format = CGBitmapInfo.byteOrder32Big.rawValue | CGImageAlphaInfo.premultipliedLast.rawValue
            return CGContext(data: bytes.baseAddress, width: rendered.width, height: rendered.height,
                             bitsPerComponent: 8, bytesPerRow: rendered.width * 4, space: space, bitmapInfo: format)?.makeImage()
        }) else { fail("无法创建清理后的图像") }
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil) else { fail("无法创建 PNG 编码器") }
        CGImageDestinationAddImage(destination, cleanImage, nil)
        guard CGImageDestinationFinalize(destination) else { fail("PNG 编码失败") }
        try (data as Data).write(to: output, options: .withoutOverwriting)
        emit(["status": "pass", "input": input.path, "output": output.path,
              "width": rendered.width, "height": rendered.height, "instances": observation.allInstances.count,
              "transparentPixels": transparent, "visiblePixels": visible,
              "removedNeutralFringePixels": removedFringe,
              "removedHolePixels": removedHolePixels,
              "requiresVisualReview": true])
    } catch { fail(error.localizedDescription) }
} else { fail("需要 macOS 14 或更新版本") }
