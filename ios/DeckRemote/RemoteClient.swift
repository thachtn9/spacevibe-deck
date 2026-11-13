import Foundation

private final class NoRemoteRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

struct RemoteClient {
    let connection: RemoteConnection
    private static let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.urlCache = nil
        config.httpCookieStorage = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: config, delegate: NoRemoteRedirects(), delegateQueue: nil)
    }()

    private func request<T: Decodable>(_ path: String, method: String = "GET", body: Data? = nil,
                                       requestId: String? = nil, query: [URLQueryItem] = []) async throws -> T {
        guard var components = URLComponents(url: connection.server.appendingPathComponent(path), resolvingAgainstBaseURL: false) else {
            throw RemoteError.message("The computer address is invalid. Pair this device again.")
        }
        if !query.isEmpty { components.queryItems = query }
        guard let url = components.url else { throw RemoteError.message("The computer address is invalid.") }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: method == "GET" ? 10 : 35)
        request.httpMethod = method
        request.httpBody = body
        request.setValue("Bearer \(connection.token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body { request.setValue("application/json", forHTTPHeaderField: "Content-Type"); request.httpBody = body }
        if let requestId { request.setValue(requestId, forHTTPHeaderField: "Idempotency-Key") }
        let (data, response) = try await Self.session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw RemoteError.message("Deck did not return a response.") }
        guard (200...299).contains(http.statusCode) else {
            let message = (try? JSONDecoder().decode(ErrorBody.self, from: data).error) ?? "Deck could not complete this request."
            throw RemoteError.http(http.statusCode, message)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func encode<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(value)
    }

    func info() async throws -> RemoteInfo { try await request("v1/info") }
    func sessions() async throws -> [RemoteSession] { try await request("v1/sessions") }
    func screen(_ id: String) async throws -> RemoteScreen { try await request("v1/sessions/\(id)/screen") }
    func quota() async throws -> QuotaResponse { try await request("v1/quota") }
    func folders(_ path: String?) async throws -> RemoteFolders {
        try await request("v1/folders", query: path.map { [URLQueryItem(name: "path", value: $0)] } ?? [])
    }
    func send(_ id: String, text: String, generation: String, requestId: String) async throws -> InputResult {
        try await request("v1/sessions/\(id)/input", method: "POST", body: encode(InputBody(text: text, generation: generation)), requestId: requestId)
    }
    func create(_ body: CreateSessionBody, requestId: String) async throws -> RemoteSession {
        try await request("v1/sessions", method: "POST", body: encode(body), requestId: requestId)
    }
}
