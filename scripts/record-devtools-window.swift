// Compile (macOS 15 SDK, arm64):
// xcrun swiftc -swift-version 5 -parse-as-library scripts/record-devtools-window.swift -o /tmp/dusk-window-recorder
// Usage: /tmp/dusk-window-recorder --window-id 15627 --title '晚霞来信-抽卡验收-2DBUUV' --duration 8 --output /tmp/dusk-capture.mov
// Only desktopIndependentWindow is used. Existing screen-capture permission is required;
// this program never requests permission and never captures a display, region, or audio.
// Apple API references:
// https://developer.apple.com/documentation/screencapturekit/sccontentfilter/init(desktopindependentwindow:)
// https://developer.apple.com/documentation/screencapturekit/capturing-screen-content-in-macos
// https://developer.apple.com/documentation/avfoundation/avassetwriter/finishwriting(completionhandler:)

import AppKit
import AVFoundation
import CoreGraphics
import CoreMedia
import CoreVideo
import Darwin
import Foundation
import ScreenCaptureKit

private struct CaptureFailure: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

private func outputJSON(_ value: [String: Any], error: Bool = false) {
    let data = (try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])) ?? Data("{}".utf8)
    let handle = error ? FileHandle.standardError : FileHandle.standardOutput
    handle.write(data)
    handle.write(Data([10])) // FileHandle writes directly; no buffered stdout to flush.
}

private struct Options {
    let windowID: CGWindowID
    let title: String
    let duration: Double
    let output: URL

    init(_ arguments: [String]) throws {
        let keys = ["--window-id", "--title", "--duration", "--output"]
        guard arguments.count == 8 else {
            throw CaptureFailure(message: "需要 --window-id ID --title 完整标题 --duration 秒数 --output 新文件.mov")
        }
        var values: [String: String] = [:]
        for index in stride(from: 0, to: arguments.count, by: 2) {
            let key = arguments[index]
            guard keys.contains(key), values[key] == nil else {
                throw CaptureFailure(message: "未知或重复参数：\(key)")
            }
            values[key] = arguments[index + 1]
        }
        guard let idText = values["--window-id"], let id = UInt32(idText), id > 0,
              let title = values["--title"], !title.isEmpty,
              let durationText = values["--duration"], let duration = Double(durationText),
              duration.isFinite, duration > 0, duration <= 10,
              let outputPath = values["--output"], !outputPath.isEmpty else {
            throw CaptureFailure(message: "window-id 必须有效，标题不能为空，duration 必须大于 0 且不超过 10 秒")
        }
        let output = URL(fileURLWithPath: outputPath).standardizedFileURL
        guard output.pathExtension.lowercased() == "mov" else {
            throw CaptureFailure(message: "输出必须使用 .mov 扩展名")
        }
        guard !FileManager.default.fileExists(atPath: output.path) else {
            throw CaptureFailure(message: "输出已存在，拒绝覆盖：\(output.path)")
        }
        var isDirectory: ObjCBool = false
        let parent = output.deletingLastPathComponent().path
        guard FileManager.default.fileExists(atPath: parent, isDirectory: &isDirectory),
              isDirectory.boolValue, FileManager.default.isWritableFile(atPath: parent) else {
            throw CaptureFailure(message: "输出父目录不存在或不可写：\(parent)")
        }
        self.windowID = id
        self.title = title
        self.duration = duration
        self.output = output
    }
}

private struct WindowBinding: Sendable {
    let id: CGWindowID
    let title: String
    let processID: pid_t

    // Metadata only, restricted to this window ID; no desktop images are read here.
    func verifyCurrentIdentity() throws {
        guard let entries = CGWindowListCopyWindowInfo(.optionIncludingWindow, id) as? [[String: Any]],
              let entry = entries.first(where: { ($0[kCGWindowNumber as String] as? NSNumber)?.uint32Value == id }),
              (entry[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == processID,
              entry[kCGWindowName as String] as? String == title else {
            throw CaptureFailure(message: "目标窗口已关闭、标题变化或所属进程变化；停止录制，不切换捕获目标")
        }
    }
}

private struct RecordingStats: Sendable {
    let frames: Int
    let droppedFrames: Int
}

// All mutable capture/writer state below is confined to sampleQueue.
private final class WindowRecorder: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    let sampleQueue = DispatchQueue(label: "dusk.single-window-recorder.samples")
    private let binding: WindowBinding
    private let writer: AVAssetWriter
    private let input: AVAssetWriterInput
    private let adaptor: AVAssetWriterInputPixelBufferAdaptor
    private let width: Int
    private let height: Int
    private let duration: Double
    private var accepting = true
    private var failure: Error?
    private var firstPTS: CMTime?
    private var lastPTS = CMTime.invalid
    private var lastPixelBuffer: CVPixelBuffer?
    private var frames = 0
    private var droppedFrames = 0
    private var finalizing = false

    init(binding: WindowBinding, output: URL, width: Int, height: Int, duration: Double) throws {
        self.binding = binding
        self.width = width
        self.height = height
        self.duration = duration
        writer = try AVAssetWriter(outputURL: output, fileType: .mov)
        input = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: max(2_000_000, min(24_000_000, width * height * 4)),
                AVVideoExpectedSourceFrameRateKey: 30,
                AVVideoMaxKeyFrameIntervalKey: 30,
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel
            ]
        ])
        input.expectsMediaDataInRealTime = true
        adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: width,
            kCVPixelBufferHeightKey as String: height
        ])
        super.init()
        guard writer.canAdd(input) else { throw CaptureFailure(message: "AVAssetWriter 不接受这个 H.264 视频输入") }
        writer.add(input) // No audio input is ever created.
        guard writer.startWriting() else { throw writer.error ?? CaptureFailure(message: "无法开始写入 MOV") }
        writer.startSession(atSourceTime: .zero)
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard accepting, type == .screen, sampleBuffer.isValid else { return }
        guard let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let rawStatus = attachments.first?[.status] as? Int,
              SCFrameStatus(rawValue: rawStatus) == .complete else { return }
        do {
            try binding.verifyCurrentIdentity()
            guard let pixel = CMSampleBufferGetImageBuffer(sampleBuffer),
                  CVPixelBufferGetWidth(pixel) == width, CVPixelBufferGetHeight(pixel) == height else {
                throw CaptureFailure(message: "捕获帧尺寸与已锁定的视频尺寸不一致")
            }
            let sourcePTS = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
            guard sourcePTS.isValid, sourcePTS.isNumeric else { throw CaptureFailure(message: "捕获帧时间戳无效") }
            if firstPTS == nil { firstPTS = sourcePTS }
            let pts = CMTimeSubtract(sourcePTS, firstPTS!)
            let finalFramePTS = max(0, duration - 1.0 / 30.0)
            guard pts.seconds <= finalFramePTS else { return }
            guard !lastPTS.isValid || CMTimeCompare(pts, lastPTS) > 0 else { return }
            guard writer.status == .writing else { throw writer.error ?? CaptureFailure(message: "视频写入器已停止") }
            guard input.isReadyForMoreMediaData else { droppedFrames += 1; return }
            guard adaptor.append(pixel, withPresentationTime: pts) else {
                throw writer.error ?? CaptureFailure(message: "视频帧写入失败")
            }
            lastPTS = pts
            lastPixelBuffer = pixel
            frames += 1
        } catch {
            failure = error
            accepting = false
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        sampleQueue.async {
            if self.failure == nil { self.failure = error }
            self.accepting = false
        }
    }

    func abort() async {
        await withCheckedContinuation { continuation in
            sampleQueue.async {
                self.accepting = false
                self.writer.cancelWriting()
                continuation.resume()
            }
        }
    }

    func finish(stopError: Error?) async throws -> RecordingStats {
        try await withCheckedThrowingContinuation { continuation in
            // stopCapture has completed; this serial queue drains earlier sample callbacks first.
            sampleQueue.async {
                self.accepting = false
                if let error = self.failure ?? stopError {
                    self.writer.cancelWriting()
                    continuation.resume(throwing: error)
                    return
                }
                guard self.frames > 0, let finalPixel = self.lastPixelBuffer else {
                    self.writer.cancelWriting()
                    continuation.resume(throwing: CaptureFailure(message: "没有收到任何完整窗口帧，录制失败"))
                    return
                }
                do { try self.binding.verifyCurrentIdentity() }
                catch { self.writer.cancelWriting(); continuation.resume(throwing: error); return }
                self.input.requestMediaDataWhenReady(on: self.sampleQueue) {
                    guard !self.finalizing else { return }
                    if self.writer.status != .writing {
                        self.finalizing = true
                        continuation.resume(throwing: self.writer.error ?? CaptureFailure(message: "结束录制时写入器已停止"))
                        return
                    }
                    guard self.input.isReadyForMoreMediaData else { return }
                    self.finalizing = true
                    // A static window may emit only its initial complete frame. Repeat that same
                    // authorized window frame at the end so a still capture retains the requested duration.
                    let finalPTS = CMTime(seconds: max(0, self.duration - 1.0 / 30.0), preferredTimescale: 60000)
                    if CMTimeCompare(finalPTS, self.lastPTS) > 0 {
                        guard self.adaptor.append(finalPixel, withPresentationTime: finalPTS) else {
                            let error = self.writer.error ?? CaptureFailure(message: "最后一帧写入失败")
                            self.writer.cancelWriting()
                            continuation.resume(throwing: error)
                            return
                        }
                        self.frames += 1
                    }
                    self.input.markAsFinished()
                    self.writer.endSession(atSourceTime: CMTime(seconds: self.duration, preferredTimescale: 60000))
                    let stats = RecordingStats(frames: self.frames, droppedFrames: self.droppedFrames)
                    self.writer.finishWriting {
                        if self.writer.status == .completed { continuation.resume(returning: stats) }
                        else { continuation.resume(throwing: self.writer.error ?? CaptureFailure(message: "MOV 未能完成封装")) }
                    }
                }
            }
        }
    }
}

@main
private struct Main {
    static func main() async {
        if CommandLine.arguments.dropFirst().elementsEqual(["--help"]) {
            print("record-devtools-window --window-id ID --title EXACT_TITLE --duration SECONDS(0<d<=10) --output NEW_FILE.mov")
            return
        }
        do {
            let options = try Options(Array(CommandLine.arguments.dropFirst()))
            guard CGPreflightScreenCaptureAccess() else {
                throw CaptureFailure(message: "没有现成的屏幕录制权限；本程序不会请求或修改权限")
            }
            let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false)
            guard let window = content.windows.first(where: { $0.windowID == options.windowID }),
                  window.title == options.title,
                  let owner = window.owningApplication,
                  let application = NSRunningApplication(processIdentifier: owner.processID),
                  let appURL = application.bundleURL?.resolvingSymlinksInPath(),
                  let executable = application.executableURL?.resolvingSymlinksInPath() else {
                throw CaptureFailure(message: "窗口ID、完整标题或所属应用信息不匹配")
            }
            let expectedAppURL = URL(fileURLWithPath: "/Applications/wechatwebdevtools.app").resolvingSymlinksInPath()
            guard let expectedBundle = Bundle(url: expectedAppURL),
                  let expectedID = expectedBundle.bundleIdentifier,
                  let expectedExecutable = expectedBundle.executableURL?.resolvingSymlinksInPath(),
                  appURL == expectedAppURL, executable == expectedExecutable,
                  owner.bundleIdentifier == expectedID, application.bundleIdentifier == expectedID else {
                throw CaptureFailure(message: "目标窗口不属于已核验的 /Applications/wechatwebdevtools.app；拒绝录制")
            }
            let binding = WindowBinding(id: options.windowID, title: options.title, processID: owner.processID)
            try binding.verifyCurrentIdentity()
            let filter = SCContentFilter(desktopIndependentWindow: window)
            let scale = CGFloat(filter.pointPixelScale)
            let rect = filter.contentRect
            guard scale.isFinite, scale > 0, rect.width.isFinite, rect.height.isFinite, rect.width > 0, rect.height > 0 else {
                throw CaptureFailure(message: "目标窗口捕获尺寸无效")
            }
            let width = (Int(ceil(rect.width * scale)) + 1) / 2 * 2
            let height = (Int(ceil(rect.height * scale)) + 1) / 2 * 2
            let configuration = SCStreamConfiguration()
            configuration.width = width
            configuration.height = height
            configuration.minimumFrameInterval = CMTime(value: 1, timescale: 30)
            configuration.queueDepth = 5
            configuration.pixelFormat = kCVPixelFormatType_32BGRA
            configuration.showsCursor = false
            configuration.capturesAudio = false
            configuration.captureMicrophone = false
            configuration.ignoreShadowsSingleWindow = true
            configuration.includeChildWindows = false
            let recorder = try WindowRecorder(binding: binding, output: options.output, width: width, height: height, duration: options.duration)
            let stream = SCStream(filter: filter, configuration: configuration, delegate: recorder)
            do {
                try stream.addStreamOutput(recorder, type: .screen, sampleHandlerQueue: recorder.sampleQueue)
                try await stream.startCapture()
            } catch { await recorder.abort(); throw error }
            outputJSON(["event": "started", "windowId": options.windowID, "title": options.title,
                        "bundleId": expectedID, "appPath": appURL.path, "output": options.output.path,
                        "duration": options.duration, "width": width, "height": height, "fpsTarget": 30, "audio": false])
            var stopError: Error?
            do { try await Task.sleep(nanoseconds: UInt64(options.duration * 1_000_000_000)) }
            catch { stopError = error }
            do { try await stream.stopCapture() }
            catch { if stopError == nil { stopError = error } }
            let stats = try await recorder.finish(stopError: stopError)
            outputJSON(["event": "finished", "windowId": options.windowID, "output": options.output.path,
                        "frames": stats.frames, "droppedFrames": stats.droppedFrames,
                        "duration": options.duration, "width": width, "height": height, "fpsTarget": 30, "audio": false])
        } catch {
            outputJSON(["event": "error", "message": error.localizedDescription], error: true)
            exit(1)
        }
    }
}
