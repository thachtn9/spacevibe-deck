import SwiftUI

struct NewSessionView: View {
    @EnvironmentObject private var store: DeckStore
    @Environment(\.dismiss) private var dismiss
    @State private var directory: String?
    @State private var folders: RemoteFolders?
    @State private var loading = false
    @State private var creating = false
    @State private var error: String?
    @State private var agentId = "codex"
    @State private var accountId: String?
    @State private var requestId = remoteRequestId()
    let onCreated: (RemoteSession) -> Void

    var body: some View {
        Form {
            Section("Run on your computer") {
                Picker("Agent", selection: $agentId) {
                    Text("Codex").tag("codex"); Text("AGY").tag("agy"); Text("Shell").tag("shell")
                }
                if agentId != "shell" {
                    Picker("Account", selection: $accountId) {
                        Text("Default profile").tag(String?.none)
                        ForEach(store.quota?.snapshot?.accounts.filter { $0.agent == agentId } ?? []) { account in
                            Text(account.name).tag(Optional(account.accountId))
                        }
                    }
                }
            }.disabled(creating)
            Section {
                if let folders {
                    Text(folders.path).font(.footnote).textSelection(.enabled)
                    if let parent = folders.parent {
                        Button { directory = parent } label: { Label("Parent folder", systemImage: "arrow.up") }
                    }
                    ForEach(folders.entries) { folder in
                        Button { directory = folder.path } label: {
                            HStack { Label(folder.name, systemImage: "folder"); Spacer(); Image(systemName: "chevron.right").foregroundStyle(.secondary) }
                        }
                    }
                    if folders.entries.isEmpty { Text("No subfolders").foregroundStyle(.secondary) }
                    if folders.truncated { Text("Showing the first 500 folders.").font(.footnote).foregroundStyle(.secondary) }
                }
                if loading { ProgressView("Loading folders…") }
                if !loading && folders == nil {
                    Button("Retry folder loading") { Task { await loadFolders() } }
                }
            } header: { Text("Choose a folder") } footer: {
                Text("Folders belong to your computer. The new session also appears in Deck desktop.")
            }.disabled(creating || loading)
            if let error { Section { Text(error).font(.footnote).foregroundStyle(.red) } }
        }
        .navigationTitle("New session")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(creating) } }
        .safeAreaInset(edge: .bottom) {
            Button {
                guard let folders, let connection = store.connection, let client = store.client else { return }
                creating = true; error = nil
                let body = CreateSessionBody(path: folders.path, agentId: agentId == "shell" ? nil : agentId, accountId: agentId == "shell" ? nil : accountId)
                Task {
                    do {
                        let session = try await client.create(body, requestId: requestId)
                        guard store.connection?.id == connection.id else { creating = false; return }
                        store.recordCreated(session)
                        onCreated(session); dismiss()
                    } catch { error = "\(error.localizedDescription) Check Sessions before starting a different request." }
                    creating = false
                }
            } label: {
                HStack { if creating { ProgressView() }; Text(creating ? "Creating session…" : "Create session here") }.frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.borderedProminent)
            .disabled(folders == nil || loading || creating || !store.online)
            .padding().background(.bar)
        }
        .interactiveDismissDisabled(creating)
        .task(id: directory) { await loadFolders() }
        .task { await store.refreshQuota() }
        .onChange(of: directory) { _, _ in requestId = remoteRequestId() }
        .onChange(of: agentId) { _, _ in accountId = nil; requestId = remoteRequestId() }
        .onChange(of: accountId) { _, _ in requestId = remoteRequestId() }
    }

    @MainActor private func loadFolders() async {
        guard let connection = store.connection, let client = store.client else { return }
        let target = directory
        loading = true; error = nil
        do {
            let result = try await client.folders(target)
            guard store.connection?.id == connection.id, directory == target, !Task.isCancelled else { return }
            folders = result
        } catch {
            guard directory == target, !Task.isCancelled else { return }
            folders = nil; error = error.localizedDescription
        }
        loading = false
    }
}
