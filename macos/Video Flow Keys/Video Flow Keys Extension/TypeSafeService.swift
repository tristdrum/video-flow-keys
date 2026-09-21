import Foundation

enum TypeSafeFailure: String, Error {
    case invalidRequest = "invalid-request"
    case keyUnavailable = "key-unavailable"
    case keyStorage = "key-storage-failed"
    case authentication = "authentication"
    case rateLimited = "rate-limited"
    case serviceUnavailable = "service-unavailable"
    case timeout = "timeout"
    case cancelled = "cancelled"
    case invalidResponse = "invalid-response"
    case network = "network-error"
}

protocol TypeSafeCancellation { func cancel() }
protocol TypeSafeTransport {
    func send(_ request: URLRequest, completion: @escaping (Result<Data, TypeSafeFailure>) -> Void) -> TypeSafeCancellation
}

/// Safari restricts native messaging to this extension. The background script
/// separately authenticates popup/content senders; native input is still bounded.
final class TypeSafeService {
    static let endpoint = URL(string: "https://api.typesafe.ai/v1/systemone")!
    static let model = "jev-1.13.0"
    static let responseLimit = 256_000
    private let store: TypeSafeKeyStore
    private let transport: TypeSafeTransport
    private let queue = DispatchQueue(label: "com.tristdrum.VideoFlowKeys.typesafe")
    private struct ActiveRequest {
        let generation: UUID
        let cancellation: TypeSafeCancellation
    }
    private var active: [String: ActiveRequest] = [:]

    init(store: TypeSafeKeyStore, transport: TypeSafeTransport) {
        self.store = store
        self.transport = transport
    }

    func handle(_ input: Any?, completion: @escaping ([String: Any]) -> Void) {
        queue.async {
            do {
                guard let message = input as? [String: Any], let type = message["type"] as? String else {
                    throw TypeSafeFailure.invalidRequest
                }
                switch type {
                case "typesafe:key-status":
                    try Self.requireKeys(message, ["type"])
                    completion(["ok": true, "configured": try self.store.read() != nil])
                case "typesafe:save-key":
                    try Self.requireKeys(message, ["type", "key"])
                    guard let rawKey = message["key"] as? String else { throw TypeSafeFailure.invalidRequest }
                    let key = rawKey.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !key.isEmpty, key.utf8.count <= 4096,
                          key.utf8.allSatisfy({ $0 >= 33 && $0 <= 126 }) else { throw TypeSafeFailure.invalidRequest }
                    try self.store.save(key)
                    self.cancelAll()
                    completion(["ok": true, "configured": true])
                case "typesafe:remove-key":
                    try Self.requireKeys(message, ["type"])
                    try self.store.remove()
                    self.cancelAll()
                    completion(["ok": true, "configured": false])
                case "typesafe:cancel":
                    try Self.requireKeys(message, ["type", "requestId"])
                    let id = try Self.requestID(message)
                    self.active.removeValue(forKey: id)?.cancellation.cancel()
                    completion(["ok": true])
                case "typesafe:classify":
                    try Self.requireKeys(message, ["type", "requestId", "request"])
                    let id = try Self.requestID(message)
                    guard self.active[id] == nil, self.active.count < 8 else { throw TypeSafeFailure.invalidRequest }
                    let (body, questionIDs) = try Self.requestBody(message["request"])
                    guard let key = try self.store.read(), !key.isEmpty else { throw TypeSafeFailure.keyUnavailable }
                    var request = URLRequest(url: Self.endpoint, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
                    request.httpMethod = "POST"
                    request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
                    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                    request.httpBody = body
                    let generation = UUID()
                    let cancellation = self.transport.send(request) { result in
                        self.queue.async {
                            // Removed/cancelled work must never deliver a usable late result.
                            guard self.active[id]?.generation == generation else {
                                completion(Self.error(.cancelled))
                                return
                            }
                            self.active.removeValue(forKey: id)
                            do {
                                let data = try result.get()
                                completion(["ok": true, "data": try Self.validatedResponse(data, questionIDs: questionIDs)])
                            } catch {
                                completion(Self.error(error as? TypeSafeFailure ?? .invalidResponse))
                            }
                        }
                    }
                    self.active[id] = ActiveRequest(generation: generation, cancellation: cancellation)
                default:
                    throw TypeSafeFailure.invalidRequest
                }
            } catch {
                completion(Self.error(error as? TypeSafeFailure ?? .keyStorage))
            }
        }
    }

    private func cancelAll() {
        let tasks = Array(active.values)
        active.removeAll()
        tasks.forEach { $0.cancellation.cancel() }
    }

    private static func error(_ error: TypeSafeFailure) -> [String: Any] { ["ok": false, "error": error.rawValue] }

    private static func requireKeys(_ value: [String: Any], _ keys: Set<String>) throws {
        guard Set(value.keys) == keys else { throw TypeSafeFailure.invalidRequest }
    }

    private static func requestID(_ message: [String: Any]) throws -> String {
        guard let id = message["requestId"] as? String, !id.isEmpty, id.utf8.count <= 160,
              id.utf8.allSatisfy({ (45...58).contains($0) || (65...90).contains($0) || (97...122).contains($0) || $0 == 95 }) else {
            throw TypeSafeFailure.invalidRequest
        }
        return id
    }

    private static func jsonData(_ value: Any) throws -> Data {
        do { return try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed, .sortedKeys]) }
        catch { throw TypeSafeFailure.invalidRequest }
    }

    private static func requestBody(_ input: Any?) throws -> (Data, Set<String>) {
        guard let request = input as? [String: Any], request["model"] as? String == model,
              let state = request["state"], state is String || state is [String: Any] || state is [Any],
              let questions = request["questions"] as? [String: Any], !questions.isEmpty, questions.count <= 128 else {
            throw TypeSafeFailure.invalidRequest
        }
        try requireKeys(request, ["model", "state", "questions"])
        let stateBytes = try jsonData(state).count
        var longest = 0
        for (id, rawQuestion) in questions {
            guard !id.isEmpty, id.utf8.count <= 80,
                  let question = rawQuestion as? [String: Any], question["type"] as? String == "choice",
                  let instructions = question["instructions"], instructions is String || instructions is [String: Any] || instructions is [Any],
                  let criteria = question["criteria"] as? [String: Any], Set(criteria.keys) == ["sponsor", "content", "uncertain"],
                  criteria.values.allSatisfy({ $0 is String }) else { throw TypeSafeFailure.invalidRequest }
            try requireKeys(question, ["type", "instructions", "criteria"])
            longest = max(longest, try jsonData(question).count)
        }
        let body = try jsonData(request)
        // UTF-8 bytes deliberately under-use the documented 32k/64k token limits.
        guard stateBytes + longest <= 32_000, body.count <= 64_000 else { throw TypeSafeFailure.invalidRequest }
        return (body, Set(questions.keys))
    }

    private static func probability(_ input: Any?) -> Double? {
        guard let number = input as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        let value = number.doubleValue
        return value.isFinite && (0...1).contains(value) ? value : nil
    }

    private static func validatedResponse(_ data: Data, questionIDs: Set<String>) throws -> [String: Any] {
        guard data.count <= responseLimit,
              let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              value["model"] as? String == model,
              let answers = value["answers"] as? [String: Any], Set(answers.keys) == questionIDs else {
            throw TypeSafeFailure.invalidResponse
        }
        var safeAnswers: [String: Any] = [:]
        for (id, rawAnswer) in answers {
            guard let answer = rawAnswer as? [String: Any], answer["type"] as? String == "choice",
                  let choice = answer["choice"] as? String, ["sponsor", "content", "uncertain"].contains(choice),
                  let probabilities = answer["probabilities"] as? [String: Any],
                  Set(probabilities.keys) == ["sponsor", "content", "uncertain"],
                  let sponsor = probability(probabilities["sponsor"]), let content = probability(probabilities["content"]),
                  let uncertain = probability(probabilities["uncertain"]),
                  let confidence = probability(answer["confidence"]), abs(sponsor + content + uncertain - 1) <= 0.02 else {
                throw TypeSafeFailure.invalidResponse
            }
            safeAnswers[id] = ["type": "choice", "choice": choice, "confidence": confidence,
                               "probabilities": ["sponsor": sponsor, "content": content, "uncertain": uncertain]]
        }
        // No raw server text, unknown metadata, request headers, or credential is returned.
        return ["model": model, "answers": safeAnswers]
    }
}

final class TypeSafeURLTransport: TypeSafeTransport {
    private let configuration: URLSessionConfiguration

    init(configuration: URLSessionConfiguration = .ephemeral) {
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 45
        self.configuration = configuration
    }

    func send(_ request: URLRequest, completion: @escaping (Result<Data, TypeSafeFailure>) -> Void) -> TypeSafeCancellation {
        let operation = TypeSafeURLOperation(completion: completion)
        operation.start(request, configuration: configuration)
        return operation
    }
}

private final class TypeSafeURLOperation: NSObject, URLSessionDataDelegate, TypeSafeCancellation, @unchecked Sendable {
    private let completion: (Result<Data, TypeSafeFailure>) -> Void
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var data = Data()
    private var finished = false

    init(completion: @escaping (Result<Data, TypeSafeFailure>) -> Void) { self.completion = completion }

    func start(_ request: URLRequest, configuration: URLSessionConfiguration) {
        let delegateQueue = OperationQueue()
        delegateQueue.maxConcurrentOperationCount = 1
        session = URLSession(configuration: configuration, delegate: self, delegateQueue: delegateQueue)
        task = session?.dataTask(with: request)
        task?.resume()
    }

    func cancel() { task?.cancel() }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        // Never forward the authorization header to a redirect destination.
        completionHandler(nil)
        finish(.failure(.invalidResponse))
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let http = response as? HTTPURLResponse, http.url == TypeSafeService.endpoint else {
            completionHandler(.cancel)
            finish(.failure(.invalidResponse))
            return
        }
        guard (200...299).contains(http.statusCode) else {
            completionHandler(.cancel)
            let failure: TypeSafeFailure
            switch http.statusCode {
            case 401, 403: failure = .authentication
            case 429: failure = .rateLimited
            case 400, 422: failure = .invalidRequest
            default: failure = .serviceUnavailable
            }
            finish(.failure(failure))
            return
        }
        guard response.expectedContentLength <= TypeSafeService.responseLimit else {
            completionHandler(.cancel)
            finish(.failure(.invalidResponse))
            return
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive chunk: Data) {
        guard !finished else { return }
        guard data.count + chunk.count <= TypeSafeService.responseLimit else {
            finish(.failure(.invalidResponse))
            return
        }
        data.append(chunk)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error = error as? URLError {
            finish(.failure(error.code == .timedOut ? .timeout : error.code == .cancelled ? .cancelled : .network))
        } else if error != nil {
            finish(.failure(.network))
        } else {
            finish(.success(data))
        }
    }

    private func finish(_ result: Result<Data, TypeSafeFailure>) {
        guard !finished else { return }
        finished = true
        completion(result)
        session?.invalidateAndCancel()
        session = nil
    }
}
