import Foundation
import XCTest

private let testKey = "test-only-placeholder-not-a-credential"
private let question: [String: Any] = [
    "type": "choice", "instructions": "Classify this segment.",
    "criteria": ["sponsor": "Paid promotion", "content": "Editorial content", "uncertain": "Unclear"]
]
private let goodAnswer: [String: Any] = [
    "type": "choice", "choice": "sponsor", "confidence": 0.8,
    "probabilities": ["sponsor": 0.96, "content": 0.03, "uncertain": 0.01]
]

private func apiData(_ answer: [String: Any] = goodAnswer, extra: [String: Any] = [:]) -> Data {
    let value = ["model": TypeSafeService.model, "answers": ["segment_0": answer]] as [String: Any]
    return try! JSONSerialization.data(withJSONObject: value.merging(extra) { _, new in new })
}

private func classification(_ id: String = "tab-1-video-1", state: Any = "A video transcript", questions: [String: Any] = ["segment_0": question]) -> [String: Any] {
    ["type": "typesafe:classify", "requestId": id,
     "request": ["model": TypeSafeService.model, "state": state, "questions": questions]]
}

private final class MemoryStore: TypeSafeKeyStore {
    var key: String?
    var fail = false
    init(_ key: String? = testKey) { self.key = key }
    func read() throws -> String? { if fail { throw TypeSafeFailure.keyStorage }; return key }
    func save(_ key: String) throws { if fail { throw TypeSafeFailure.keyStorage }; self.key = key }
    func remove() throws { if fail { throw TypeSafeFailure.keyStorage }; key = nil }
}

private final class Cancellation: TypeSafeCancellation {
    var cancelled = false
    func cancel() { cancelled = true }
}

private final class FakeTransport: TypeSafeTransport {
    var result: Result<Data, TypeSafeFailure>? = .success(apiData())
    var requests: [URLRequest] = []
    var completions: [(Result<Data, TypeSafeFailure>) -> Void] = []
    var tokens: [Cancellation] = []
    let sent = DispatchSemaphore(value: 0)

    func send(_ request: URLRequest, completion: @escaping (Result<Data, TypeSafeFailure>) -> Void) -> TypeSafeCancellation {
        requests.append(request)
        completions.append(completion)
        let token = Cancellation()
        tokens.append(token)
        if let result = result { completion(result) }
        sent.signal()
        return token
    }
}

private final class StubURLProtocol: URLProtocol {
    static var respond: ((StubURLProtocol) -> Void)?
    static var requestCount = 0
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.requestCount += 1
        Self.respond?(self)
    }
    override func stopLoading() {}
    func reply(status: Int = 200, data: Data = apiData(), length: Int? = nil) {
        var headers = ["Content-Type": "application/json"]
        if let length = length { headers["Content-Length"] = String(length) }
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
}

final class TypeSafeTests: XCTestCase {
    @objc func testProvisionedKeychainLifecycle() throws {
        guard ProcessInfo.processInfo.environment["VIDEO_FLOW_KEYS_KEYCHAIN_SMOKE"] == "1" else {
            throw XCTSkip("Set VIDEO_FLOW_KEYS_SIGNED_EXTENSION to run the real Keychain smoke with its development profile.")
        }
        // A unique service keeps this test completely separate from a saved API key.
        let service = "com.tristdrum.VideoFlowKeys.tests.\(UUID().uuidString)"
        let store = TypeSafeKeychain(service: service)
        defer { try? store.remove() }
        XCTAssertNil(try store.read())
        try store.save(testKey)
        XCTAssertEqual(try TypeSafeKeychain(service: service).read(), testKey)
        try store.save("updated-test-only-placeholder")
        XCTAssertEqual(try store.read(), "updated-test-only-placeholder")
        try store.remove()
        XCTAssertNil(try store.read())
    }

    private func invoke(_ service: TypeSafeService, _ message: Any?, file: StaticString = #filePath, line: UInt = #line) -> [String: Any] {
        let done = DispatchSemaphore(value: 0)
        var result: [String: Any] = [:]
        service.handle(message) { result = $0; done.signal() }
        XCTAssertEqual(done.wait(timeout: .now() + 5), .success, "Native completion timed out", file: file, line: line)
        return result
    }

    private func checkFailure(_ result: [String: Any], _ code: TypeSafeFailure, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(result["ok"] as? Bool, false, file: file, line: line)
        XCTAssertEqual(result["error"] as? String, code.rawValue, file: file, line: line)
        XCTAssertEqual(Set(result.keys), ["ok", "error"], file: file, line: line)
        let serialized = String(data: try! JSONSerialization.data(withJSONObject: result), encoding: .utf8)!
        XCTAssertFalse(serialized.contains(testKey), file: file, line: line)
    }

    private func networkService() -> TypeSafeService {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubURLProtocol.self]
        StubURLProtocol.requestCount = 0
        return TypeSafeService(store: MemoryStore(), transport: TypeSafeURLTransport(configuration: configuration))
    }

    @objc func testKeyLifecycleDoesNotReturnCredential() {
        let store = MemoryStore(nil)
        let transport = FakeTransport()
        let service = TypeSafeService(store: store, transport: transport)
        XCTAssertEqual(invoke(service, ["type": "typesafe:key-status"])["configured"] as? Bool, false)
        let saved = invoke(service, ["type": "typesafe:save-key", "key": testKey])
        XCTAssertEqual(Set(saved.keys), ["ok", "configured"])
        XCTAssertEqual(saved["configured"] as? Bool, true)
        let reopened = TypeSafeService(store: store, transport: transport)
        XCTAssertEqual(invoke(reopened, ["type": "typesafe:key-status"])["configured"] as? Bool, true)
        XCTAssertEqual(invoke(reopened, ["type": "typesafe:remove-key"])["configured"] as? Bool, false)
        checkFailure(invoke(service, classification()), .keyUnavailable)
        XCTAssertTrue(transport.requests.isEmpty)
    }

    @objc func testKeyInputAndStorageErrorsAreSanitized() {
        let store = MemoryStore()
        let service = TypeSafeService(store: store, transport: FakeTransport())
        for key in ["", "a\r\nAuthorization: bad", String(repeating: "x", count: 4097)] {
            checkFailure(invoke(service, ["type": "typesafe:save-key", "key": key]), .invalidRequest)
        }
        store.fail = true
        checkFailure(invoke(service, ["type": "typesafe:key-status"]), .keyStorage)
        checkFailure(invoke(service, ["type": "typesafe:save-key", "key": testKey]), .keyStorage)
        checkFailure(invoke(service, ["type": "typesafe:remove-key"]), .keyStorage)
    }

    @objc func testFixedDestinationModelAndPrivateHeaders() {
        let transport = FakeTransport()
        transport.result = .success(apiData(extra: ["debug": testKey, "usage": ["key": testKey]]))
        let result = invoke(TypeSafeService(store: MemoryStore(), transport: transport), classification())
        XCTAssertEqual(result["ok"] as? Bool, true)
        let request = transport.requests[0]
        XCTAssertEqual(request.url?.absoluteString, "https://api.typesafe.ai/v1/systemone")
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.timeoutInterval, 30)
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer \(testKey)")
        let body = try! JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any]
        XCTAssertEqual(body["model"] as? String, "jev-1.13.0")
        let serialized = String(data: try! JSONSerialization.data(withJSONObject: result), encoding: .utf8)!
        XCTAssertFalse(serialized.contains(testKey))
        XCTAssertFalse(serialized.contains("debug"))
        XCTAssertFalse(String(data: request.httpBody!, encoding: .utf8)!.contains(testKey))
    }

    @objc func testRequestValidationPreventsNetworkCalls() {
        let transport = FakeTransport()
        let service = TypeSafeService(store: MemoryStore(), transport: transport)
        checkFailure(invoke(service, nil), .invalidRequest)
        checkFailure(invoke(service, ["type": "typesafe:get-key"]), .invalidRequest)
        checkFailure(invoke(service, ["type": "typesafe:key-status", "url": "https://example.test"]), .invalidRequest)
        var message = classification()
        message["requestId"] = "invalid id"
        checkFailure(invoke(service, message), .invalidRequest)
        for model in ["jev-latest", "jev-1.12.0"] {
            var request = classification()["request"] as! [String: Any]
            request["model"] = model
            message = classification(); message["request"] = request
            checkFailure(invoke(service, message), .invalidRequest)
        }
        var request = classification()["request"] as! [String: Any]
        request["url"] = "https://example.test"
        message = classification(); message["request"] = request
        checkFailure(invoke(service, message), .invalidRequest)
        checkFailure(invoke(service, classification(state: true)), .invalidRequest)
        checkFailure(invoke(service, classification(questions: [:])), .invalidRequest)
        var wrongQuestion = question; wrongQuestion["type"] = "noul"
        checkFailure(invoke(service, classification(questions: ["segment_0": wrongQuestion])), .invalidRequest)
        XCTAssertTrue(transport.requests.isEmpty)
    }

    @objc func testUTF8AndTotalRequestBudgets() {
        let transport = FakeTransport()
        let service = TypeSafeService(store: MemoryStore(), transport: transport)
        checkFailure(invoke(service, classification(state: String(repeating: "🙂", count: 8100))), .invalidRequest)
        checkFailure(invoke(service, classification(state: String(repeating: "x", count: 32_000))), .invalidRequest)
        var largeQuestion = question
        largeQuestion["instructions"] = String(repeating: "x", count: 20_000)
        let questions = ["a": largeQuestion, "b": largeQuestion, "c": largeQuestion, "d": largeQuestion]
        checkFailure(invoke(service, classification(questions: questions)), .invalidRequest)
        XCTAssertTrue(transport.requests.isEmpty)
    }

    @objc func testMalformedAndIncompleteAPIResponses() {
        let transport = FakeTransport()
        let service = TypeSafeService(store: MemoryStore(), transport: transport)
        let invalid = [Data("not JSON".utf8), Data("[]".utf8), apiData(extra: ["answers": [:]]),
                       apiData(extra: ["model": "jev-latest"]), Data(repeating: 32, count: 256_001)]
        for data in invalid {
            transport.result = .success(data)
            checkFailure(invoke(service, classification()), .invalidResponse)
        }
        for changes: [String: Any] in [["confidence": true], ["choice": "other"],
                                      ["probabilities": ["sponsor": 1.1, "content": 0, "uncertain": 0]],
                                      ["probabilities": ["sponsor": 0.9, "content": 0.9, "uncertain": 0.9]],
                                      ["probabilities": ["sponsor": true, "content": 0, "uncertain": 0]],
                                      ["probabilities": ["sponsor": 0.95, "content": 0.05]]] {
            transport.result = .success(apiData(goodAnswer.merging(changes) { _, new in new }))
            checkFailure(invoke(service, classification()), .invalidResponse)
        }
    }

    @objc func testCancellationDiscardsLateResultsAndDoesNotCancelOtherTabs() {
        let transport = FakeTransport(); transport.result = nil
        let service = TypeSafeService(store: MemoryStore(), transport: transport)
        let first = expectation(description: "first cancelled")
        let second = expectation(description: "second completes")
        service.handle(classification("tab-1")) { self.checkFailure($0, .cancelled); first.fulfill() }
        XCTAssertEqual(transport.sent.wait(timeout: .now() + 2), .success)
        service.handle(classification("tab-2")) { XCTAssertEqual($0["ok"] as? Bool, true); second.fulfill() }
        XCTAssertEqual(transport.sent.wait(timeout: .now() + 2), .success)
        XCTAssertEqual(invoke(service, ["type": "typesafe:cancel", "requestId": "tab-1"])["ok"] as? Bool, true)
        XCTAssertTrue(transport.tokens[0].cancelled)
        XCTAssertFalse(transport.tokens[1].cancelled)
        transport.completions[0](.success(apiData()))
        transport.completions[1](.success(apiData()))
        wait(for: [first, second], timeout: 2)
    }

    @objc func testReusedRequestIDCannotReceiveOldResponse() {
        let transport = FakeTransport(); transport.result = nil
        let service = TypeSafeService(store: MemoryStore(), transport: transport)
        let first = expectation(description: "first cancelled")
        let second = expectation(description: "second succeeds")
        service.handle(classification()) { self.checkFailure($0, .cancelled); first.fulfill() }
        XCTAssertEqual(transport.sent.wait(timeout: .now() + 2), .success)
        _ = invoke(service, ["type": "typesafe:cancel", "requestId": "tab-1-video-1"])
        service.handle(classification()) { XCTAssertEqual($0["ok"] as? Bool, true); second.fulfill() }
        XCTAssertEqual(transport.sent.wait(timeout: .now() + 2), .success)
        transport.completions[0](.success(apiData()))
        transport.completions[1](.success(apiData()))
        wait(for: [first, second], timeout: 2)
    }

    @objc func testRemovingOrReplacingKeyCancelsRequests() {
        for mutation in [["type": "typesafe:remove-key"], ["type": "typesafe:save-key", "key": "another-test-only-placeholder"]] {
            let transport = FakeTransport(); transport.result = nil
            let service = TypeSafeService(store: MemoryStore(), transport: transport)
            let done = expectation(description: "old key request cancelled")
            service.handle(classification()) { self.checkFailure($0, .cancelled); done.fulfill() }
            XCTAssertEqual(transport.sent.wait(timeout: .now() + 2), .success)
            XCTAssertEqual(invoke(service, mutation)["ok"] as? Bool, true)
            XCTAssertTrue(transport.tokens[0].cancelled)
            transport.completions[0](.success(apiData()))
            wait(for: [done], timeout: 2)
        }
    }

    @objc func testHTTPFailuresAreSanitized() {
        let service = networkService()
        for (status, failure): (Int, TypeSafeFailure) in [(401, .authentication), (403, .authentication), (422, .invalidRequest),
                                                        (429, .rateLimited), (529, .serviceUnavailable), (500, .serviceUnavailable)] {
            StubURLProtocol.respond = { $0.reply(status: status, data: Data(testKey.utf8)) }
            checkFailure(invoke(service, classification()), failure)
        }
    }

    @objc func testNetworkTimeoutAndFailure() {
        let service = networkService()
        for (code, failure): (URLError.Code, TypeSafeFailure) in [(.timedOut, .timeout), (.notConnectedToInternet, .network)] {
            StubURLProtocol.respond = { $0.client?.urlProtocol($0, didFailWithError: URLError(code)) }
            checkFailure(invoke(service, classification()), failure)
        }
    }

    @objc func testRedirectCannotForwardCredential() {
        let service = networkService()
        StubURLProtocol.respond = { stub in
            let target = URL(string: "https://example.test/collect")!
            let response = HTTPURLResponse(url: stub.request.url!, statusCode: 307, httpVersion: nil, headerFields: ["Location": target.absoluteString])!
            stub.client?.urlProtocol(stub, wasRedirectedTo: URLRequest(url: target), redirectResponse: response)
        }
        checkFailure(invoke(service, classification()), .invalidResponse)
        XCTAssertEqual(StubURLProtocol.requestCount, 1)
    }

    @objc func testResponseLimitsWithAndWithoutContentLength() {
        let service = networkService()
        StubURLProtocol.respond = { $0.reply(data: apiData(), length: 256_001) }
        checkFailure(invoke(service, classification()), .invalidResponse)
        StubURLProtocol.respond = { $0.reply(data: Data(repeating: 32, count: 256_001)) }
        checkFailure(invoke(service, classification()), .invalidResponse)
    }

    @objc func testURLSessionSuccessfulRoundTrip() {
        let service = networkService()
        StubURLProtocol.respond = { $0.reply() }
        XCTAssertEqual(invoke(service, classification())["ok"] as? Bool, true)
    }

}

let suite = XCTestSuite(forTestCaseClass: TypeSafeTests.self)
suite.run()
exit(suite.testRun?.hasSucceeded == true && suite.testCaseCount > 0 ? 0 : 1)
