import SwiftUI

struct SessionsView: View {
    @EnvironmentObject private var store: DeckStore
    @State private var search = ""
    @State private var path: [String] = []
    @State private var showingNewSession = false
    let showConnection: () -> Void

    private var filtered: [RemoteSession] {
        store.sessions.filter { session in
            search.isEmpty || [session.title, session.path ?? "", session.agentLabel, session.account ?? ""]
                .joined(separator: " ").localizedCaseInsensitiveContains(search)
        }
    }

    var body: some View {
        NavigationStack(path: $path) {
            List {
                Section {
                    Label(store.online ? (store.connection?.name ?? "Connected") : "Disconnected · showing last update",
                          systemImage: store.online ? "desktopcomputer" : "wifi.slash")
                        .font(.footnote).foregroundStyle(.secondary)
                    if let error = store.connectionError { Text(error).font(.footnote) }
                }
                ForEach(Array(Set(filtered.map { $0.path ?? "" })).sorted(), id: \.self) { folder in
                    Section(folder.isEmpty ? "Other sessions" : URL(fileURLWithPath: folder).lastPathComponent) {
                        ForEach(filtered.filter { ($0.path ?? "") == folder }) { session in
                            NavigationLink(value: session.id) { SessionRow(session: session) }
                        }
                    }
                }
                if filtered.isEmpty {
                    ContentUnavailableView(search.isEmpty ? "No running sessions" : "No matching sessions",
                        systemImage: "terminal", description: Text(search.isEmpty ? "Open a session in Deck, or tap + to start one in a shared folder." : "Try a folder, agent or account name."))
                }
            }
            .navigationTitle("Sessions")
            .searchable(text: $search, prompt: "Folder, agent or account")
            .refreshable { await store.refreshSessions() }
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button(action: showConnection) { Label("Connection", systemImage: "desktopcomputer") }
                    Button { showingNewSession = true } label: { Label("New session", systemImage: "plus") }
                        .disabled(!store.online)
                }
            }
            .navigationDestination(for: String.self) { id in SessionView(sessionId: id) }
            .sheet(isPresented: $showingNewSession) {
                NavigationStack { NewSessionView { session in path.append(session.id) } }
            }
        }
    }
}

struct SessionRow: View {
    let session: RemoteSession
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(session.title).font(.headline).lineLimit(2)
            HStack {
                Text([session.agentLabel, session.account].compactMap { $0 }.joined(separator: " · "))
                Spacer()
                Text(session.statusLabel)
            }.font(.caption).foregroundStyle(.secondary)
        }.padding(.vertical, 4)
    }
}

struct SessionView: View {
    @EnvironmentObject private var store: DeckStore
    @Environment(\.scenePhase) private var scenePhase
    @State private var currentId: String
    @State private var screen: RemoteScreen?
    @State private var screenError: String?
    @State private var showingSwitcher = false
    @State private var followOutput = true
    @FocusState private var composing: Bool

    init(sessionId: String) { _currentId = State(initialValue: sessionId) }

    private var session: RemoteSession? { store.sessions.first { $0.id == currentId } }
    private var draft: Binding<String> { Binding(get: { store.drafts[currentId]?.text ?? "" }, set: { store.setDraft($0, for: currentId) }) }
    private var canSend: Bool {
        store.online && screen?.session.id == currentId && screen?.alive == true &&
        screenError == nil && !store.sending.contains(currentId) && (store.drafts[currentId]?.text.utf8.count ?? 0) <= 32_768
    }

    var body: some View {
        VStack(spacing: 0) {
            if let session {
                HStack {
                    Text([session.agentLabel, session.account, session.statusLabel].compactMap { $0 }.joined(separator: " · "))
                    Spacer()
                    Toggle("Follow output", isOn: $followOutput).labelsHidden()
                }.font(.caption).foregroundStyle(.secondary).padding(.horizontal).padding(.vertical, 8)
            }
            if let error = screenError {
                Text(error).font(.footnote).foregroundStyle(.secondary).padding()
            }
            terminal
        }
        .navigationTitle(session?.title ?? "Session")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { composing = false; showingSwitcher = true } label: { Label("Switch session", systemImage: "list.bullet") }
            }
            ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("Done") { composing = false } }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(alignment: .leading, spacing: 8) {
                if let note = store.inputNotes[currentId] { Text(note).font(.footnote).foregroundStyle(.secondary) }
                HStack(alignment: .bottom, spacing: 12) {
                    TextField("Type a command or instruction", text: draft, axis: .vertical)
                        .lineLimit(1...6).textFieldStyle(.roundedBorder)
                        .textInputAutocapitalization(.never).autocorrectionDisabled().focused($composing)
                        .disabled(store.sending.contains(currentId))
                    Button {
                        guard let screen, screen.session.id == currentId else { return }
                        let target = currentId
                        Task { await store.send(to: target, screen: screen) }
                    } label: {
                        if store.sending.contains(currentId) { ProgressView() }
                        else { Text((store.drafts[currentId]?.text ?? "").isEmpty ? "Enter" : "Send") }
                    }.buttonStyle(.borderedProminent).disabled(!canSend).frame(minHeight: 44)
                }
            }.padding().background(.bar)
        }
        .sheet(isPresented: $showingSwitcher) {
            NavigationStack {
                List(store.sessions) { session in
                    Button {
                        currentId = session.id; screen = store.screens[session.id]; screenError = nil
                        showingSwitcher = false
                    } label: { SessionRow(session: session).foregroundStyle(.primary) }
                }
                .navigationTitle("Switch session")
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { showingSwitcher = false } } }
            }
        }
        .task(id: "\(currentId):\(scenePhase == .active)") {
            guard scenePhase == .active, let connection = store.connection, let client = store.client else { return }
            let target = currentId
            screen = store.screens[target]
            while !Task.isCancelled {
                do {
                    let answer = try await client.screen(target)
                    guard currentId == target, store.connection?.id == connection.id, !Task.isCancelled else { return }
                    screen = answer; store.screens[target] = answer; screenError = nil
                } catch {
                    guard currentId == target, !Task.isCancelled else { return }
                    screenError = "\(error.localizedDescription) Showing the last screen."
                }
                do { try await Task.sleep(for: .seconds(screenError == nil ? 1 : 4)) } catch { return }
            }
        }
    }

    private var terminal: some View {
        ScrollViewReader { proxy in
            ScrollView(.vertical) {
                ScrollView(.horizontal) {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(Array((screen?.text ?? "Waiting for the session screen…").components(separatedBy: "\n").enumerated()), id: \.offset) { index, line in
                            Text(line.isEmpty ? " " : line)
                                .font(.system(.footnote, design: .monospaced)).textSelection(.enabled)
                                .fixedSize(horizontal: true, vertical: false).id(index)
                        }
                        Color.clear.frame(height: 1).id("bottom")
                    }.scrollTargetLayout().padding()
                }
            }
            .scrollPosition(id: Binding<Int?>(get: { store.scrollAnchors[currentId] }, set: { store.scrollAnchors[currentId] = $0 }))
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: screen?.capturedAtMs) { _, _ in
                if followOutput { proxy.scrollTo("bottom", anchor: .bottom) }
            }
            .onChange(of: followOutput) { _, follow in if follow { proxy.scrollTo("bottom", anchor: .bottom) } }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color(uiColor: .systemBackground))
    }
}
