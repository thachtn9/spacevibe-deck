import Foundation

struct RemoteConnection: Codable, Identifiable, Equatable {
    let id: UUID
    let server: URL
    let token: String
    var name: String

    static func parse(_ value: String) throws -> RemoteConnection {
        guard value.utf8.count < 16_384,
              let link = URLComponents(string: value.trimmingCharacters(in: .whitespacesAndNewlines)),
              link.scheme == "deckremote", link.host == "connect" else {
            throw RemoteError.message("Copy a connection from Deck Settings → Remote, then paste it here.")
        }
        let items = link.queryItems ?? []
        func item(_ name: String) -> String? { items.first { $0.name == name }?.value }
        guard let serverValue = item("server"), let parts = URLComponents(string: serverValue),
              let server = parts.url, let host = parts.host,
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
              parts.scheme == "https" || (parts.scheme == "http" && isPrivateHost(host)),
              let token = item("token"), token.count == 64,
              token.allSatisfy({ $0.isHexDigit && $0.isASCII }) else {
            throw RemoteError.message("Use HTTPS or a private LAN/Tailscale address with a valid Deck pairing key.")
        }
        return RemoteConnection(id: UUID(), server: server, token: token, name: item("name") ?? host)
    }

    private static func isPrivateHost(_ value: String) -> Bool {
        let host = value.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
        if host == "localhost" || host == "::1" || host.hasSuffix(".local") || host.hasSuffix(".ts.net") { return true }
        if host.contains(":") { return host.hasPrefix("fc") || host.hasPrefix("fd") || host.hasPrefix("fe80:") }
        let octets = host.split(separator: ".").compactMap { Int($0) }
        guard octets.count == 4, octets.allSatisfy({ (0...255).contains($0) }) else { return false }
        return octets[0] == 10 || octets[0] == 127 ||
            (octets[0] == 172 && (16...31).contains(octets[1])) ||
            (octets[0] == 192 && octets[1] == 168) ||
            (octets[0] == 169 && octets[1] == 254) ||
            (octets[0] == 100 && (64...127).contains(octets[1]))
    }
}

struct RemoteInfo: Decodable {
    let protocolVersion: Int
    let name: String
    let root: String
}

struct RemoteSession: Decodable, Identifiable, Hashable {
    let id: String
    let generation: String
    let paneId: Int
    let tabKey: Int
    let title: String
    let path: String?
    let agentId: String?
    let account: String?
    let phase: String
    let attention: String
    let startedAt: Double

    var agentLabel: String {
        switch agentId { case "codex": "Codex"; case "agy": "AGY"; default: "Shell" }
    }
    var folderName: String { path.map { URL(fileURLWithPath: $0).lastPathComponent } ?? "Other sessions" }
    var statusLabel: String {
        if attention != "none" { return "Needs attention" }
        switch phase { case "working": return "Working"; case "exited": return "Agent ended"; default: return "Ready" }
    }
}

struct RemoteScreen: Decodable {
    let text: String
    let capturedAtMs: Double
    let alive: Bool
    let session: RemoteSession
}

struct RemoteFolder: Decodable, Identifiable {
    var id: String { path }
    let name: String
    let path: String
}

struct RemoteFolders: Decodable {
    let root: String
    let path: String
    let parent: String?
    let entries: [RemoteFolder]
    let truncated: Bool
}

struct QuotaAccount: Decodable, Identifiable {
    var id: String { "\(agent):\(accountId)" }
    let agent: String
    let accountId: String
    let name: String
    let active: Bool
    let state: String
    let limited: Bool
    let observedAtMs: Double?
    let fiveHour: Double?
    let weekly: Double?
    let fiveHourResetAtMs: Double?
    let weeklyResetAtMs: Double?

    enum CodingKeys: String, CodingKey {
        case agent, name, active, state, limited, observedAtMs, fiveHour, weekly, fiveHourResetAtMs, weeklyResetAtMs
        case accountId = "id"
    }
    var isStale: Bool { observedAtMs.map { Date().timeIntervalSince1970 * 1000 - $0 > 300_000 } ?? true }
}

struct QuotaSnapshot: Decodable {
    let checkedAtMs: Double
    let accounts: [QuotaAccount]
}

struct QuotaResponse: Decodable {
    let snapshot: QuotaSnapshot?
    let stale: Bool
    let error: String?
}

struct CreateSessionBody: Encodable {
    let path: String
    let agentId: String?
    let accountId: String?
}

struct InputBody: Encodable { let text: String; let generation: String }
struct InputResult: Decodable { let status: String }
struct ErrorBody: Decodable { let error: String }

enum RemoteError: LocalizedError {
    case message(String)
    case http(Int, String)
    var errorDescription: String? { switch self { case .message(let value), .http(_, let value): value } }
    var definitelyRejected: Bool {
        switch self { case .http(let status, _): [400, 401, 403, 404, 412, 413, 415, 429].contains(status); default: false }
    }
}

func remoteRequestId() -> String { "\(Int64(Date().timeIntervalSince1970 * 1000))-\(UUID().uuidString)" }

struct SessionDraft {
    var text = ""
    var requestId = remoteRequestId()
    var generation: String?
}
