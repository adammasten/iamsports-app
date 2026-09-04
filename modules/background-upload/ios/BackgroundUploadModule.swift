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

// Per-multipart-upload state (rolling slice window — never all parts on disk at once).
final class MultipartJob {
  let uploadId: String
  let filePath: String
  let fileSize: Int64
  let partSize: Int64
  let totalParts: Int
  let urls: [Int: String]              // partNumber -> presigned UploadPart URL
  let windowSize: Int                  // how many parts staged on disk at once
  var etags: [Int: String] = [:]       // partNumber -> ETag (success)
  var bytesSent: [Int: Int64] = [:]    // partNumber -> bytes sent (progress)
  var tempFiles: [Int: URL] = [:]      // partNumber -> staged temp file (deleted on completion)
  var inflight: Set<Int> = []          // parts currently enqueued/uploading
  var nextToSlice: Int = 1             // next partNumber not yet staged
  var failedParts: Set<Int> = []       // parts that errored terminally (after native retries exhausted)
  var retries: [Int: Int] = [:]        // partNumber -> transient-retry attempts so far
  var finished = false                 // set once, under lock, so we emit the final event exactly once
  init(uploadId: String, filePath: String, fileSize: Int64, partSize: Int64,
       totalParts: Int, urls: [Int: String], windowSize: Int) {
    self.uploadId = uploadId; self.filePath = filePath; self.fileSize = fileSize
    self.partSize = partSize; self.totalParts = totalParts; self.urls = urls; self.windowSize = windowSize
  }
  var totalSent: Int64 { bytesSent.values.reduce(0, +) }
}

final class BackgroundUploader: NSObject, URLSessionDataDelegate, URLSessionTaskDelegate {
  static let shared = BackgroundUploader()
  // A transiently-failed part (network drop, 5xx, -997 "lost connection to background
  // transfer service") is re-enqueued up to this many times with backoff before it's
  // reported failed. Because a background session waits for connectivity, a re-enqueued
  // part resumes when the network returns — wifi OR cellular — which is what keeps an
  // hour-long upload alive when the coach walks out of wifi range.
  static let maxPartRetries = 5

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
    // Gym wifi throttles per-connection; 2 concurrent saturates the pipe better than 1
    // without the timeouts that 5–6 cause. (Locked decision: 128 MiB parts, 2 concurrent.)
    config.httpMaximumConnectionsPerHost = 2
    // A full game can take an hour+ and pass through dead zones; give the whole resource
    // a generous 48h deadline so a long no-signal stretch doesn't make iOS give up.
    config.timeoutIntervalForResource = 48 * 60 * 60
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
    let attrs = try? FileManager.default.attributesOfItem(atPath: path)
    let fileSize = (attrs?[.size] as? NSNumber)?.int64Value ?? 0
    guard fileSize > 0, partSize > 0, !parts.isEmpty else {
      emit?("onError", ["uploadId": uploadId, "error": "Empty file / bad part size / no parts"]); return
    }

    var urlMap: [Int: String] = [:]
    for p in parts { urlMap[p.partNumber] = p.url }

    let job = MultipartJob(
      uploadId: uploadId, filePath: path, fileSize: fileSize, partSize: Int64(partSize),
      totalParts: parts.count, urls: urlMap, windowSize: min(3, parts.count)
    )
    lock.lock(); jobs[uploadId] = job; lock.unlock()

    // Rolling slice window: stage ONLY the first `windowSize` parts. A 50 GB file sliced
    // up front would need +50 GB of disk; instead each completion stages the next part.
    for _ in 0..<job.windowSize { sliceNext(job) }
  }

  // Stage + enqueue the next not-yet-started part. Reads a byte range from the original
  // file into a temp file (a background URLSession body must be a file); the temp file is
  // deleted once that part completes (see didCompleteWithError).
  private func sliceNext(_ job: MultipartJob) {
    lock.lock()
    while job.nextToSlice <= job.totalParts &&
          (job.etags[job.nextToSlice] != nil || job.inflight.contains(job.nextToSlice)) {
      job.nextToSlice += 1
    }
    let partNumber = job.nextToSlice
    guard partNumber <= job.totalParts else { lock.unlock(); return }
    job.nextToSlice += 1
    job.inflight.insert(partNumber)
    lock.unlock()
    enqueuePart(job, partNumber)
  }

  // Stage a byte range from the original file into a temp file and enqueue a PUT for
  // exactly `partNumber`. Used to advance the window (sliceNext) AND to retry a part
  // that failed transiently. The caller must have already marked the part inflight.
  private func enqueuePart(_ job: MultipartJob, _ partNumber: Int) {
    guard let urlStr = job.urls[partNumber], let url = URL(string: urlStr) else {
      lock.lock(); job.inflight.remove(partNumber); job.failedParts.insert(partNumber); lock.unlock(); return
    }
    let offset = Int64(partNumber - 1) * job.partSize
    let length = min(job.partSize, job.fileSize - offset)
    guard length > 0 else {
      lock.lock(); job.inflight.remove(partNumber); lock.unlock(); return
    }

    do {
      let handle = try FileHandle(forReadingFrom: URL(fileURLWithPath: job.filePath))
      defer { try? handle.close() }
      try handle.seek(toOffset: UInt64(offset))
      let data = handle.readData(ofLength: Int(length))
      let tempURL = FileManager.default.temporaryDirectory
        .appendingPathComponent("mpu-\(job.uploadId)-p\(partNumber).tmp")
      try data.write(to: tempURL)
      lock.lock(); job.tempFiles[partNumber] = tempURL; lock.unlock()

      var request = URLRequest(url: url)
      request.httpMethod = "PUT"
      let task = session.uploadTask(with: request, fromFile: tempURL)
      lock.lock(); taskCtx[task.taskIdentifier] = (job.uploadId, partNumber); lock.unlock()
      task.resume()
    } catch {
      lock.lock(); job.inflight.remove(partNumber); job.failedParts.insert(partNumber); lock.unlock()
      emit?("onError", ["uploadId": job.uploadId, "part": partNumber, "error": "slice: \(error.localizedDescription)"])
    }
  }

  // A part is worth retrying on the same presigned URL when the failure is transient:
  // any network-layer error (connection lost, offline, -997) or a 5xx. A 403 (expired
  // URL) or other 4xx is NOT retryable here — those need JS to re-sign, handled on resume.
  private func isRetryable(error: Error?, status: Int) -> Bool {
    if status >= 400 && status < 500 { return false }
    if error != nil { return true }
    if status >= 500 || status < 0 { return true }
    return false
  }

  private func cleanup(_ job: MultipartJob) {
    for (_, f) in job.tempFiles { try? FileManager.default.removeItem(at: f) }
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

    // Multipart part (rolling window)
    lock.lock(); let job = jobs[ctx.uploadId]; lock.unlock()
    guard let job = job else { return }

    // Free this part's staged temp file regardless of outcome (enqueuePart re-creates it
    // on retry). Inflight is cleared only when the part is truly done (success or terminal
    // failure) — a part being retried stays inflight so the job isn't finalized early.
    lock.lock()
    if let tmp = job.tempFiles[partNumber] { try? FileManager.default.removeItem(at: tmp); job.tempFiles[partNumber] = nil }
    lock.unlock()

    if error == nil, (200...299).contains(status), let etag = etag {
      lock.lock(); job.etags[partNumber] = etag; job.failedParts.remove(partNumber)
      job.retries[partNumber] = nil; job.inflight.remove(partNumber); lock.unlock()
    } else if isRetryable(error: error, status: status) {
      lock.lock(); let attempts = job.retries[partNumber, default: 0]; lock.unlock()
      if attempts < Self.maxPartRetries {
        // Keep the part inflight, back off, then re-enqueue the SAME part. The background
        // session waits for connectivity, so this resumes when the network returns.
        lock.lock(); job.retries[partNumber] = attempts + 1; lock.unlock()
        let delay = min(60.0, pow(2.0, Double(attempts)))
        DispatchQueue.global().asyncAfter(deadline: .now() + delay) { [weak self] in
          self?.enqueuePart(job, partNumber)
        }
        return   // still active (retrying) — do NOT advance the window or finalize
      }
      lock.lock(); job.failedParts.insert(partNumber); job.inflight.remove(partNumber); lock.unlock()
      emit?("onError", ["uploadId": ctx.uploadId, "part": partNumber, "status": status,
                        "error": error?.localizedDescription ?? "retries exhausted", "body": bodyText ?? ""])
    } else {
      // Terminal for native (e.g. 403 expired URL) — resume re-signs these parts.
      lock.lock(); job.failedParts.insert(partNumber); job.inflight.remove(partNumber); lock.unlock()
      emit?("onError", ["uploadId": ctx.uploadId, "part": partNumber,
                        "status": status, "error": error?.localizedDescription ?? "", "body": bodyText ?? ""])
    }

    // Advance the rolling window — stage the next part (keeps ~windowSize on disk).
    sliceNext(job)

    // Finalize exactly once, when nothing is in flight and nothing is left to stage.
    lock.lock()
    let drained = job.inflight.isEmpty && job.nextToSlice > job.totalParts
    var emitDone = false, emitFail = false
    var payload: [[String: Any]] = []
    var failedList: [Int] = []
    if drained && !job.finished {
      job.finished = true
      if job.etags.count == job.totalParts && job.failedParts.isEmpty {
        emitDone = true
        payload = job.etags.sorted { $0.key < $1.key }.map { ["partNumber": $0.key, "etag": $0.value] }
        cleanup(job); jobs[ctx.uploadId] = nil
      } else {
        emitFail = true
        failedList = job.failedParts.sorted()   // keep the job so JS can retry these parts
      }
    }
    lock.unlock()

    if emitDone { emit?("onComplete", ["uploadId": ctx.uploadId, "parts": payload]) }
    else if emitFail { emit?("onError", ["uploadId": ctx.uploadId, "error": "incomplete", "failedParts": failedList]) }
  }
}
