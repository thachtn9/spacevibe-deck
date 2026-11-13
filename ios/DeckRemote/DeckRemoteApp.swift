import SwiftUI

@main
struct DeckRemoteApp: App {
    @StateObject private var store = DeckStore()
    var body: some Scene { WindowGroup { DeckRootView().environmentObject(store) } }
}

struct DeckRootView: View {
    @EnvironmentObject private var store: DeckStore
    @Environment(\.scenePhase) private var scenePhase
    @State private var selectedTab = 0
    @State private var showingConnection = false
    @State private var incomingConnection = ""

    var body: some View {
        Group {
            if store.connection == nil {
                NavigationStack { ConnectionView(initialValue: incomingConnection).id(incomingConnection) }
            } else {
                TabView(selection: $selectedTab) {
                    SessionsView(showConnection: { incomingConnection = ""; showingConnection = true })
                        .tabItem { Label("Sessions", systemImage: "terminal") }.tag(0)
                    NavigationStack {
                        QuotaView(active: selectedTab == 1 && scenePhase == .active)
                    }
                    .tabItem { Label("Quota", systemImage: "chart.bar") }.tag(1)
                }
                .sheet(isPresented: $showingConnection) {
                    NavigationStack { ConnectionView(initialValue: incomingConnection, canCancel: true) }
                }
                .id(store.connection?.id)
            }
        }
        .task(id: scenePhase == .active ? store.connection?.id : nil) {
            guard scenePhase == .active, store.connection != nil else { return }
            while !Task.isCancelled {
                await store.refreshSessions()
                do { try await Task.sleep(for: .seconds(store.online ? 2 : 5)) } catch { return }
            }
        }
        .onOpenURL { url in
            incomingConnection = url.absoluteString
            showingConnection = store.connection != nil
        }
    }
}

struct ConnectionView: View {
    @EnvironmentObject private var store: DeckStore
    @Environment(\.dismiss) private var dismiss
    @State private var value: String
    @State private var connecting = false
    @State private var error: String?
    @State private var confirmDisconnect = false
    let canCancel: Bool

    init(initialValue: String = "", canCancel: Bool = false) {
        _value = State(initialValue: initialValue)
        self.canCancel = canCancel
    }

    var body: some View {
        Form {
            if let connection = store.connection {
                Section("Paired computer") {
                    LabeledContent("Computer", value: connection.name)
                    Text(connection.server.absoluteString).font(.footnote).foregroundStyle(.secondary)
                }
            }
            Section {
                SecureField("Connection from Deck", text: $value)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .privacySensitive().disabled(connecting)
                PasteButton(payloadType: String.self) { values in
                    if let first = values.first { value = first }
                }.disabled(connecting)
                Button {
                    connecting = true; error = nil
                    Task {
                        do { try await store.connect(value); value = ""; dismiss() }
                        catch { error = error.localizedDescription }
                        connecting = false
                    }
                } label: {
                    HStack { Text("Connect to computer"); Spacer(); if connecting { ProgressView() } }
                }.disabled(value.isEmpty || connecting)
            } header: { Text("Connect Deck Remote") } footer: {
                Text("On your computer, open Deck Settings → Remote. Enable remote access, choose your shared folder and address, then copy the connection. Keep both devices on the same LAN or Tailscale network.")
            }
            if let error { Section { Text(error).foregroundStyle(.red).accessibilityLabel("Connection error: \(error)") } }
            if store.connection != nil {
                Section {
                    Button("Forget this computer", role: .destructive) { confirmDisconnect = true }
                        .disabled(connecting || !store.sending.isEmpty)
                } footer: { Text("Sessions keep running on your computer when this app disconnects.") }
            }
            Section { Text("Deck’s always-on desktop usage analytics remain enabled.").font(.footnote).foregroundStyle(.secondary) }
        }
        .navigationTitle("Deck Remote")
        .toolbar { if canCancel { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() }.disabled(connecting) } } }
        .interactiveDismissDisabled(connecting)
        .confirmationDialog("Forget this computer?", isPresented: $confirmDisconnect, titleVisibility: .visible) {
            Button("Forget computer", role: .destructive) {
                do { try store.disconnect(); dismiss() } catch { self.error = error.localizedDescription }
            }
        } message: { Text("Your pairing key will be removed from this iPhone. Sessions remain on your computer.") }
    }
}
