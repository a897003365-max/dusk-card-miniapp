```swift
// cutout.swift — compile: xcrun swiftc -O cutout.swift -o cutout
// usage: ./cutout /abs/in.png /abs/out.png
import Foundation
import Vision
import CoreImage
import UniformTypeIdentifiers

func fail(_ msg: String) -> Never {
    print("{\"error\":\"\(msg)\"}")
    exit(1)
}

guard CommandLine.arguments.count == 3 else { fail("usage: cutout <abs_input.png> <abs_output.png>") }
let inPath = CommandLine.arguments[1], outPath = CommandLine.arguments[2]
guard inPath.hasPrefix("/"), outPath.hasPrefix("/") else { fail("paths must be absolute") }
guard inPath != outPath else { fail("refusing in-place modification") }
guard FileManager.default.fileExists(atPath: inPath) else { fail("input not found") }
guard !FileManager.default.fileExists(atPath: outPath) else { fail("refusing to overwrite output") }
guard inPath.lowercased().hasSuffix(".png"), outPath.lowercased().hasSuffix(".png") else { fail("png only") }

let inURL = URL(fileURLWithPath: inPath), outURL = URL(fileURLWithPath: outPath)
let data: Data
do { data = try Data(contentsOf: inURL) } catch { fail("cannot read input") }
guard let src = CGImageSourceCreateWithData(data as CFData, nil),
      let cg = CGImageSourceCreateImageAtIndex(src, 0, nil) else { fail("invalid input png") }

let req = VNGenerateForegroundInstanceMaskRequest()
let handler = VNImageRequestHandler(cgImage: cg)
do { try handler.perform([req]) } catch { fail("vision request failed: \(error.localizedDescription)") }
guard let obs = req.results?.first as? VNInstanceMaskObservation else { fail("no mask observation") }
guard !obs.allInstances.isEmpty else { fail("empty mask: no foreground instances") }

let masked: CVPixelBuffer
do { masked = try obs.generateMaskedImage(ofInstances: obs.allInstances, from: handler, croppedToInstances: false) }
catch { fail("mask generation failed: \(error.localizedDescription)") }

// verify non-empty alpha
CVPixelBufferLockBaseAddress(masked, .readOnly)
defer { CVPixelBufferUnlockBaseAddress(masked, .readOnly) }
let w = CVPixelBufferGetWidth(masked), h = CVPixelBufferGetHeight(masked)
let stride = CVPixelBufferGetBytesPerRow(masked)
var anyAlpha = false
if let base = CVPixelBufferGetBaseAddress(masked) {
    outer: for y in 0..<h {
        let row = base.advanced(by: y * stride).assumingMemoryBound(to: UInt8.self)
        for x in 0..<w where row[x * 4 + 3] > 0 { anyAlpha = true; break outer }
    }
}
guard anyAlpha else { fail("empty mask: zero alpha pixels") }

let ci = CIImage(cvPixelBuffer: masked)
let ctx = CIContext()
guard let outCG = ctx.createCGImage(ci, from: ci.extent) else { fail("render failed") }
guard outCG.width == cg.width, outCG.height == cg.height else { fail("size mismatch") }

let dest = CGImageDestinationCreateWithURL(outURL as CFURL, UTType.png.identifier as CFString, 1, nil)
guard let dest else { fail("cannot create output") }
CGImageDestinationAddImage(dest, outCG, nil)
guard CGImageDestinationFinalize(dest) else { fail("png write failed") }

print("{\"status\":\"ok\",\"instances\":\(obs.allInstances.count),\"width\":\(outCG.width),\"height\":\(outCG.height),\"output\":\"\(outPath)\"}")
```

Caveat: The generated mask can clip or feather very fine details (thin cords, string ties, small holes/gaps in the paper sheep) or bleed a faint gray fringe on antialiased edges against the checkerboard. After each run, zoom in and visually inspect those areas; regenerate from a higher-resolution source if artifacts appear.