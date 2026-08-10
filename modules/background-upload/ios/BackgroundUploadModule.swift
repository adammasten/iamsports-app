import ExpoModulesCore
import Foundation

// Phase 0b spike — prove an iOS background URLSession keeps uploading a file-backed
// PUT while the app is backgrounded / the screen is locked.
//
// Scope for now: ONE presigned PUT per call (the simplest thing that proves the OS
// behavior). Multipart orchestration (many parts + Complete) and the force-quit
// relaunch hook (handleEventsForBackgroundURLSession) come next, once this works.

public class BackgroundUploadModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BackgroundUpload")

    Events("onProgress", "onComplete", "onError")

    OnCreate {
      // Route native → JS events through this module instance. Marshalled to main.
      BackgroundUploader.shared.emit = { [weak self] name, body in
        DispatchQueue.main.async { self?.sendEvent(name, body) }
      }
    }

    // Sanity check that the module is linked and callable from JS.
    AsyncFunction("ping") { () -> String in
      return "background-upload alive"
    }

    // Enqueue a background upload of `fileUri` (a local file:// path) to `uploadUrl`
    // (a presigned/signed PUT URL) with the given request `headers` (e.g. content-type).
    // Resolves once ENQUEUED; the result arrives via events.
    AsyncFunction("startUpload") { (uploadId: String, fileUri: String, uploadUrl: String, headers: [String: String]) in
      BackgroundUploader.shared.start(uploadId: uploadId, fileUri: fileUri, uploadUrl: uploadUrl, headers: headers)
    }
  }
}

// Owns the single background URLSession (one stable identifier) + its delegate.
final class BackgroundUploader: NSObject, URLSessionDataDelegate, URLSessionTaskDelegate {
  static let shared = BackgroundUploader()

  var emit: ((String, [String: Any]) -> Void)?

  private var session: URLSession!
  private var uploadIdByTask: [Int: String] = [:]   // taskIdentifier -> our uploadId
  private var responseBody: [Int: Data] = [:]        // collect body for error/ETag diagnostics
  private let lock = NSLock()

  private override init() {
    super.init()
    let config = URLSessionConfiguration.background(withIdentifier: "com.masten32.iamsports.upload")
    config.isDiscretionary = false          // start ASAP; don't wait for wifi + power
    config.sessionSendsLaunchEvents = true   // relaunch to finish on completion (used later)
    config.waitsForConnectivity = true       // ride out gym-wifi drops
    session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
  }

  func start(uploadId: String, fileUri: String, uploadUrl: String, headers: [String: String]) {
    guard let url = URL(string: uploadUrl) else {
      emit?("onError", ["uploadId": uploadId, "error": "Invalid upload URL"])
      return
    }
    let path = fileUri.hasPrefix("file://")
      ? String(fileUri.dropFirst("file://".count)).removingPercentEncoding ?? fileUri
      : fileUri
    let fileURL = URL(fileURLWithPath: path)
    guard FileManager.default.fileExists(atPath: path) else {
      emit?("onError", ["uploadId": uploadId, "error": "File not found: \(path)"])
      return
    }

    var request = URLRequest(url: url)
    request.httpMethod = "PUT"
    for (k, v) in headers { request.setValue(v, forHTTPHeaderField: k) }

    let task = session.uploadTask(with: request, fromFile: fileURL)
    lock.lock(); uploadIdByTask[task.taskIdentifier] = uploadId; lock.unlock()
    task.resume()
  }

  // MARK: - URLSession delegate

  func urlSession(_ session: URLSession, task: URLSessionTask,
                  didSendBodyData bytesSent: Int64, totalBytesSent: Int64,
                  totalBytesExpectedToSend: Int64) {
    guard totalBytesExpectedToSend > 0 else { return }
    lock.lock(); let id = uploadIdByTask[task.taskIdentifier]; lock.unlock()
    guard let uploadId = id else { return }
    let progress = Double(totalBytesSent) / Double(totalBytesExpectedToSend)
    emit?("onProgress", ["uploadId": uploadId, "progress": progress])
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    lock.lock()
    responseBody[dataTask.taskIdentifier, default: Data()].append(data)
    lock.unlock()
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    lock.lock()
    let uploadId = uploadIdByTask[task.taskIdentifier] ?? "unknown"
    uploadIdByTask[task.taskIdentifier] = nil
    let bodyData = responseBody[task.taskIdentifier]
    responseBody[task.taskIdentifier] = nil
    lock.unlock()

    let http = task.response as? HTTPURLResponse
    let status = http?.statusCode ?? -1
    let etag = http?.value(forHTTPHeaderField: "Etag") ?? http?.value(forHTTPHeaderField: "ETag")
    let bodyText = bodyData.flatMap { String(data: $0, encoding: .utf8) }

    if let error = error {
      emit?("onError", ["uploadId": uploadId, "error": error.localizedDescription])
    } else if (200...299).contains(status) {
      emit?("onComplete", ["uploadId": uploadId, "status": status, "etag": etag ?? ""])
    } else {
      emit?("onError", ["uploadId": uploadId, "status": status, "body": bodyText ?? ""])
    }
  }
}
