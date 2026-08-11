import ExpoModulesCore
import Foundation

// Background uploader (Phase 0b). An iOS background URLSession keeps file-backed PUT
// tasks running while the app is backgrounded / the screen is locked.
//
//   • startUpload         — ONE presigned PUT (proven; used for moderate files).
//   • startMultipartUpload — split the file into parts, upload each to its presigned
//                            S3 UploadPart URL, collect ETags. For big 2–5 GB games.
//
// Multipart parts are staged as file-backed temp files and all enqueued up front (iOS
// runs independent tasks in any order and rate-limits scheduling NEW work from the
// background — so we enqueue everything while foregrounded). Still TODO: force-quit
// resume + the handleEventsForBackgroundURLSession relaunch hook.

struct UploadPart: Record {
  @Field var partNumber: Int = 0
  @Field var url: String = ""
}

public class BackgroundUploadModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BackgroundUpload")

    Events("onProgress", "onComplete", "onError")

    OnCreate {
      BackgroundUploader.shared.emit = { [weak self] name, body in
        DispatchQueue.main.async { self?.sendEvent(name, body) }
      }
    }

    AsyncFunction("ping") { () -> String in
      return "background-upload alive"
    }

    // Single presigned PUT. Resolves once ENQUEUED; result via onComplete/onError.
    AsyncFunction("startUpload") { (uploadId: String, fileUri: String, uploadUrl: String, headers: [String: String]) in
      BackgroundUploader.shared.startSingle(uploadId: uploadId, fileUri: fileUri, uploadUrl: uploadUrl, headers: headers)
    }

    // Multipart. `parts` come from the multipart-upload Edge Function (partNumber + a
    // presigned UploadPart URL each); `partSize` sets the byte boundaries. onComplete
    // fires with { uploadId, parts:[{partNumber, etag}] } — JS then calls the Edge
    // Function's 'complete' action with those ETags.
    AsyncFunction("startMultipartUpload") { (uploadId: String, fileUri: String, partSize: Int, parts: [UploadPart]) in
      BackgroundUploader.shared.startMultipart(uploadId: uploadId, fileUri: fileUri, partSize: partSize, parts: parts)
    }
  }
}

// Per-multipart-upload state.
final class MultipartJob {
  let uploadId: String
  let fileSize: Int64
  let totalParts: Int
  var etags: [Int: String] = [:]      // partNumber -> ETag
  var bytesSent: [Int: Int64] = [:]   // partNumber -> bytes sent (progress)
  var tempFiles: [URL] = []
  var failed = false
  init(uploadId: String, fileSize: Int64, totalParts: Int) {
    self.uploadId = uploadId; self.fileSize = fileSize; self.totalParts = totalParts
  }
  var totalSent: Int64 { bytesSent.values.reduce(0, +) }
}

final class BackgroundUploader: NSObject, URLSessionDataDelegate, URLSessionTaskDelegate {
  static let shared = BackgroundUploader()

  var emit: ((String, [String: Any]) -> Void)?

  private var session: URLSession!
  // taskIdentifier -> (uploadId, partNumber?). partNumber nil = single PUT.
  private var taskCtx: [Int: (uploadId: String, partNumber: Int?)] = [:]
  private var jobs: [String: MultipartJob] = [:]
  private var responseBody: [Int: Data] = [:]
  private let lock = NSLock()

  private override init() {
    super.init()
    let config = URLSessionConfiguration.background(withIdentifier: "com.masten32.iamsports.upload")
    config.isDiscretionary = false
    config.sessionSendsLaunchEvents = true
    config.waitsForConnectivity = true
    session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
  }

  private func resolvePath(_ fileUri: String) -> String {
    if fileUri.hasPrefix("file://") {
      return String(fileUri.dropFirst("file://".count)).removingPercentEncoding ?? fileUri
    }
    return fileUri
  }

  // MARK: - Single PUT

  func startSingle(uploadId: String, fileUri: String, uploadUrl: String, headers: [String: String]) {
    guard let url = URL(string: uploadUrl) else {
      emit?("onError", ["uploadId": uploadId, "error": "Invalid upload URL"]); return
    }
    let path = resolvePath(fileUri)
    guard FileManager.default.fileExists(atPath: path) else {
      emit?("onError", ["uploadId": uploadId, "error": "File not found: \(path)"]); return
    }
    var request = URLRequest(url: url)
    request.httpMethod = "PUT"
    for (k, v) in headers { request.setValue(v, forHTTPHeaderField: k) }
    let task = session.uploadTask(with: request, fromFile: URL(fileURLWithPath: path))
    lock.lock(); taskCtx[task.taskIdentifier] = (uploadId, nil); lock.unlock()
    task.resume()
  }

  // MARK: - Multipart

  func startMultipart(uploadId: String, fileUri: String, partSize: Int, parts: [UploadPart]) {
    let path = resolvePath(fileUri)
    guard FileManager.default.fileExists(atPath: path) else {
      emit?("onError", ["uploadId": uploadId, "error": "File not found: \(path)"]); return
    }
    let fileURL = URL(fileURLWithPath: path)
    let attrs = try? FileManager.default.attributesOfItem(atPath: path)
    let fileSize = (attrs?[.size] as? NSNumber)?.int64Value ?? 0
    guard fileSize > 0, partSize > 0 else {
      emit?("onError", ["uploadId": uploadId, "error": "Empty file or bad part size"]); return
    }

    let job = MultipartJob(uploadId: uploadId, fileSize: fileSize, totalParts: parts.count)
    lock.lock(); jobs[uploadId] = job; lock.unlock()

    guard let handle = try? FileHandle(forReadingFrom: fileURL) else {
      emit?("onError", ["uploadId": uploadId, "error": "Could not open file"]); return
    }
    defer { try? handle.close() }

    for part in parts.sorted(by: { $0.partNumber < $1.partNumber }) {
      let offset = Int64(part.partNumber - 1) * Int64(partSize)
      let length = min(Int64(partSize), fileSize - offset)
      if length <= 0 { continue }
      guard let url = URL(string: part.url) else { continue }
      do {
        try handle.seek(toOffset: UInt64(offset))
        let data = handle.readData(ofLength: Int(length))
        let tempURL = FileManager.default.temporaryDirectory
          .appendingPathComponent("mpu-\(uploadId)-p\(part.partNumber).tmp")
        try data.write(to: tempURL)
        lock.lock(); job.tempFiles.append(tempURL); lock.unlock()

        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        let task = session.uploadTask(with: request, fromFile: tempURL)
        lock.lock(); taskCtx[task.taskIdentifier] = (uploadId, part.partNumber); lock.unlock()
        task.resume()
      } catch {
        lock.lock(); job.failed = true; lock.unlock()
        emit?("onError", ["uploadId": uploadId, "error": "part \(part.partNumber): \(error.localizedDescription)"])
      }
    }
  }

  private func cleanup(_ job: MultipartJob) {
    for f in job.tempFiles { try? FileManager.default.removeItem(at: f) }
  }

  // MARK: - URLSession delegate

  func urlSession(_ session: URLSession, task: URLSessionTask,
                  didSendBodyData bytesSent: Int64, totalBytesSent: Int64,
                  totalBytesExpectedToSend: Int64) {
    lock.lock(); let ctx = taskCtx[task.taskIdentifier]; lock.unlock()
    guard let ctx = ctx else { return }
    if let partNumber = ctx.partNumber {
      lock.lock(); let job = jobs[ctx.uploadId]; job?.bytesSent[partNumber] = totalBytesSent
      let progress = (job != nil && job!.fileSize > 0) ? Double(job!.totalSent) / Double(job!.fileSize) : 0
      lock.unlock()
      if job != nil { emit?("onProgress", ["uploadId": ctx.uploadId, "progress": progress]) }
    } else {
      guard totalBytesExpectedToSend > 0 else { return }
      emit?("onProgress", ["uploadId": ctx.uploadId, "progress": Double(totalBytesSent) / Double(totalBytesExpectedToSend)])
    }
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    lock.lock(); responseBody[dataTask.taskIdentifier, default: Data()].append(data); lock.unlock()
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    lock.lock()
    let ctx = taskCtx[task.taskIdentifier]
    taskCtx[task.taskIdentifier] = nil
    let bodyData = responseBody[task.taskIdentifier]
    responseBody[task.taskIdentifier] = nil
    lock.unlock()
    guard let ctx = ctx else { return }

    let http = task.response as? HTTPURLResponse
    let status = http?.statusCode ?? -1
    let etag = http?.value(forHTTPHeaderField: "Etag") ?? http?.value(forHTTPHeaderField: "ETag")
    let bodyText = bodyData.flatMap { String(data: $0, encoding: .utf8) }

    // Single PUT
    guard let partNumber = ctx.partNumber else {
      if let error = error {
        emit?("onError", ["uploadId": ctx.uploadId, "error": error.localizedDescription])
      } else if (200...299).contains(status) {
        emit?("onComplete", ["uploadId": ctx.uploadId, "status": status, "etag": etag ?? ""])
      } else {
        emit?("onError", ["uploadId": ctx.uploadId, "status": status, "body": bodyText ?? ""])
      }
      return
    }

    // Multipart part
    lock.lock(); let job = jobs[ctx.uploadId]; lock.unlock()
    guard let job = job else { return }

    if let error = error {
      lock.lock(); job.failed = true; lock.unlock()
      emit?("onError", ["uploadId": ctx.uploadId, "part": partNumber, "error": error.localizedDescription])
      return
    }
    if (200...299).contains(status), let etag = etag {
      lock.lock()
      job.etags[partNumber] = etag
      let done = job.etags.count == job.totalParts && !job.failed
      var payload: [[String: Any]] = []
      if done {
        payload = job.etags.sorted { $0.key < $1.key }.map { ["partNumber": $0.key, "etag": $0.value] }
        cleanup(job)
        jobs[ctx.uploadId] = nil
      }
      lock.unlock()
      if done { emit?("onComplete", ["uploadId": ctx.uploadId, "parts": payload]) }
    } else {
      lock.lock(); job.failed = true; lock.unlock()
      emit?("onError", ["uploadId": ctx.uploadId, "part": partNumber, "status": status, "body": bodyText ?? ""])
    }
  }
}
