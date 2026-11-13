import SwiftUI

struct QuotaView: View {
    @EnvironmentObject private var store: DeckStore
    let active: Bool

    var body: some View {
        List {
            if let error = store.quotaError {
                Section { Label(error, systemImage: "exclamationmark.triangle").font(.footnote).foregroundStyle(.secondary) }
            }
            ForEach(["codex", "agy"], id: \.self) { agent in
                let accounts = store.quota?.snapshot?.accounts.filter { $0.agent == agent } ?? []
                if !accounts.isEmpty {
                    Section(agent == "codex" ? "Codex" : "AGY") {
                        ForEach(accounts) { account in
                            VStack(alignment: .leading, spacing: 12) {
                                HStack {
                                    Text(account.name).font(.headline)
                                    Spacer()
                                    if account.active { Text("Active").font(.caption).foregroundStyle(.secondary) }
                                }
                                quotaWindow("5h", value: account.fiveHour, reset: account.fiveHourResetAtMs)
                                quotaWindow("1w", value: account.weekly, reset: account.weeklyResetAtMs)
                                if account.state != "ready" { Text("Quota unavailable").font(.caption).foregroundStyle(.secondary) }
                                else if account.isStale || store.quota?.stale == true || store.quotaError != nil {
                                    Text("Cached reading").font(.caption).foregroundStyle(.secondary)
                                }
                                if account.limited { Text("Account is limited").font(.caption).foregroundStyle(.secondary) }
                            }.padding(.vertical, 8)
                        }
                    }
                }
            }
            if store.quota?.snapshot?.accounts.isEmpty ?? true {
                ContentUnavailableView("No quota reading", systemImage: "chart.bar",
                    description: Text("Quota comes from CLI Manager on your computer. Pull to refresh."))
            }
        }
        .navigationTitle("Quota")
        .refreshable { await store.refreshQuota() }
        .task(id: active) {
            guard active else { return }
            while !Task.isCancelled {
                await store.refreshQuota()
                do { try await Task.sleep(for: .seconds(30)) } catch { return }
            }
        }
    }

    private func quotaWindow(_ label: String, value: Double?, reset: Double?) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label).font(.caption)
                Spacer()
                Text(value.map { "\($0.formatted(.number.precision(.fractionLength(0...1))))% remaining" } ?? "Unknown")
                    .font(.caption).monospacedDigit()
            }
            if let value { ProgressView(value: min(100, max(0, value)), total: 100).accessibilityLabel("\(label) remaining quota") }
            if let reset {
                Text("Resets \(Date(timeIntervalSince1970: reset / 1000).formatted(date: .abbreviated, time: .shortened))")
                    .font(.caption2).foregroundStyle(.secondary)
            }
        }
    }
}
