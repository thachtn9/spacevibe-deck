import Foundation
import SwiftUI

@MainActor
final class DeckStore: ObservableObject {
    @Published private(set) var connection = ConnectionVault.load()
    @Published private(set) var info: RemoteInfo?
    @Published private(set) var sessions: [RemoteSession] = []
    @Published private(set) var online = false
    @Published private(set) var connectionError: String?
    @Published private(set) var quota: QuotaResponse?
    @Published private(set) var quotaError: String?
    @Published var drafts: [String: SessionDraft] = [:]
    @Published var sending: Set<String> = []
    @Published var inputNotes: [String: String] = [:]
    @Published var scrollAnchors: [String: Int] = [:]
    var screens: [String: RemoteScreen] = [:]

    var client: RemoteClient? { connection.map { RemoteClient(connection: $0) } }

    func connect(_ value: String) async throws {
        var candidate = try RemoteConnection.parse(value)
        let answer = try await RemoteClient(connection: candidate).info()
        guard answer.protocolVersion == 1 else { throw RemoteError.message("Update Deck Remote to connect to this Deck version.") }
        candidate.name = answer.name
        try ConnectionVault.save(candidate)
        connection = candidate; info = answer; sessions = []; quota = nil
        drafts = [:]; screens = [:]; inputNotes = [:]; scrollAnchors = [:]
        online = true; connectionError = nil
        await refreshSessions()
    }

    func disconnect() throws {
        try ConnectionVault.remove()
        connection = nil; info = nil; sessions = []; quota = nil; online = false
        drafts = [:]; screens = [:]; inputNotes = [:]; scrollAnchors = [:]
    }

    func refreshSessions() async {
        guard let connection, let client else { return }
        do {
            if info == nil {
                let answer = try await client.info()
                guard self.connection?.id == connection.id, !Task.isCancelled else { return }
                guard answer.protocolVersion == 1 else { throw RemoteError.message("Update Deck Remote to connect to this Deck version.") }
                info = answer
            }
            let answer = try await client.sessions()
            guard self.connection?.id == connection.id, !Task.isCancelled else { return }
            sessions = answer; online = true; connectionError = nil
            let ids = Set(answer.map(\.id))
            screens = screens.filter { ids.contains($0.key) }
        } catch {
            guard self.connection?.id == connection.id, !Task.isCancelled else { return }
            online = false
            connectionError = "Cannot reach Deck. Keep the computer online and check your LAN or Tailscale connection."
        }
    }

    func refreshQuota() async {
        guard let connection, let client else { return }
        do {
            let answer = try await client.quota()
            guard self.connection?.id == connection.id, !Task.isCancelled else { return }
            quota = answer; quotaError = answer.error
        } catch {
            guard self.connection?.id == connection.id, !Task.isCancelled else { return }
            quotaError = "Quota is unavailable. The last reading may be out of date."
        }
    }

    func recordCreated(_ session: RemoteSession) {
        sessions.removeAll { $0.id == session.id }
        sessions.append(session)
    }

    func setDraft(_ text: String, for id: String) {
        if drafts[id]?.text == text { return }
        drafts[id] = SessionDraft(text: text)
        inputNotes[id] = nil
    }

    func send(to id: String, screen: RemoteScreen) async {
        guard online, !sending.contains(id), let connection, let client else { return }
        var draft = drafts[id] ?? SessionDraft()
        guard draft.text.utf8.count <= 32_768 else { inputNotes[id] = "Use up to 32 KB of text."; return }
        if draft.generation == nil { draft.generation = screen.session.generation }
        drafts[id] = draft
        sending.insert(id)
        defer { sending.remove(id) }
        do {
            let answer = try await client.send(id, text: draft.text, generation: draft.generation!, requestId: draft.requestId)
            guard self.connection?.id == connection.id else { return }
            if drafts[id]?.requestId == draft.requestId { drafts[id] = SessionDraft() }
            inputNotes[id] = answer.status == "sent" ? nil : "Text was inserted. Check the terminal, then tap Enter to submit it."
        } catch {
            guard self.connection?.id == connection.id else { return }
            if let rejected = error as? RemoteError, rejected.definitelyRejected {
                if drafts[id]?.requestId == draft.requestId { drafts[id] = SessionDraft(text: draft.text) }
                inputNotes[id] = error.localizedDescription
            } else {
                inputNotes[id] = "\(error.localizedDescription) The action may have reached Deck. Retry checks the same request; it does not send it twice."
            }
        }
    }
}
