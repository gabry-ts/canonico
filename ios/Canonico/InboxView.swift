import SwiftUI

struct InboxView: View {
    @EnvironmentObject var state: AppState
    @State private var tab = 0
    @State private var queue: [MaintenanceItem] = []
    @State private var conflicts: [Conflict] = []
    @State private var questions: [OpenQuestion] = []
    @State private var error: String?
    @State private var resolving: Conflict?
    @State private var closing: OpenQuestion?

    var body: some View {
        NavigationStack {
            List {
                Picker("", selection: $tab) {
                    Text(L10n.t("review.maintenance")).tag(0)
                    Text(L10n.t("review.conflicts")).tag(1)
                    Text(L10n.t("review.questions")).tag(2)
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 8, trailing: 0))

                if let error { ErrorBanner(message: error) { Task { await load() } } }

                switch tab {
                case 0: maintenanceSection
                case 1: conflictSection
                default: questionSection
                }
            }
            .navigationTitle(L10n.t("tab.review"))
            .refreshable { await load() }
            .task(id: "\(state.projectId)-\(state.memoryVersion)") { await load() }
            .sheet(item: $resolving) { c in ResolveConflictSheet(conflict: c) { await load() }.environmentObject(state) }
            .sheet(item: $closing) { q in CloseQuestionSheet(question: q) { await load() }.environmentObject(state) }
        }
    }

    private var pending: [MaintenanceItem] { queue.filter { $0.status == nil || $0.status == "pending" } }

    @ViewBuilder
    private var maintenanceSection: some View {
        if pending.isEmpty {
            EmptyStateView(icon: "checkmark.seal", text: L10n.t("review.emptyStale")).listRowBackground(Color.clear)
        }
        ForEach(pending) { item in
            VStack(alignment: .leading, spacing: 8) {
                if let f = item.fact {
                    HStack {
                        Text(f.value).font(.headline)
                        Spacer()
                        Badge(text: item.proposedAction ?? "", color: Palette.amber, dot: true)
                    }
                    Text("\(f.sourceLabel) · \(Fmt.date(f.date))").font(.caption.monospaced()).foregroundStyle(.secondary)
                }
                if let d = item.detail { Text(d).font(.footnote).foregroundStyle(.secondary) }
                HStack {
                    Button(L10n.t("review.approve")) { Task { await decide(item, "approve") } }
                        .buttonStyle(.borderedProminent)
                        .buttonBorderShape(.capsule)
                    Button(L10n.t("review.keep"), systemImage: "lock") { Task { await decide(item, "dismiss") } }
                        .buttonStyle(.bordered)
                        .buttonBorderShape(.capsule)
                    Spacer()
                    if let topic = item.fact?.topic {
                        NavigationLink("") { TopicDetailView(topicId: topic) }.frame(width: 20)
                    }
                }
                .controlSize(.small)
            }
            .padding(.vertical, 6)
        }
    }

    @ViewBuilder
    private var conflictSection: some View {
        let open = conflicts.filter { $0.status == "open" || $0.status == nil }
        if open.isEmpty { EmptyStateView(icon: "arrow.triangle.branch", text: L10n.t("review.emptyConflicts")).listRowBackground(Color.clear) }
        ForEach(open) { c in
            VStack(alignment: .leading, spacing: 6) {
                Text(c.topic ?? "").font(.caption.monospaced()).foregroundStyle(.secondary)
                if let s = c.summary { Text(s).font(.subheadline) }
                ForEach(c.facts) { f in
                    Text("• \(f.value) · \(f.sourceLabel) · \(Fmt.date(f.date))").font(.caption)
                }
                Button(L10n.t("review.resolve")) { resolving = c }
                    .buttonStyle(.bordered).controlSize(.small)
            }
            .padding(.vertical, 4)
        }
    }

    @ViewBuilder
    private var questionSection: some View {
        let open = questions.filter { $0.status == "open" || $0.status == nil }
        if open.isEmpty { EmptyStateView(icon: "questionmark.bubble", text: L10n.t("review.emptyQuestions")).listRowBackground(Color.clear) }
        ForEach(open) { q in
            VStack(alignment: .leading, spacing: 6) {
                Text(q.question).font(.subheadline)
                Text("\(q.docId ?? "") · \(Fmt.date(q.openedAt))").font(.caption2.monospaced()).foregroundStyle(.secondary)
                Button(L10n.t("review.close")) { closing = q }
                    .buttonStyle(.bordered).controlSize(.small)
            }
            .padding(.vertical, 4)
        }
    }

    private func load() async {
        let q: [String: String?] = ["project_id": state.projectId]
        do {
            async let a: [MaintenanceItem] = API.shared.request("GET", "/maintenance/queue", query: q)
            async let b: [Conflict] = API.shared.request("GET", "/conflicts", query: q)
            async let c: [OpenQuestion] = API.shared.request("GET", "/open-questions", query: q)
            (queue, conflicts, questions) = try await (a, b, c)
            state.inboxCount = pending.count
            error = nil
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func decide(_ item: MaintenanceItem, _ action: String) async {
        do {
            try await API.shared.send("POST", "/maintenance/\(item.id)/\(action)", body: ["actor": state.actorName])
            state.show(L10n.t(action == "approve" ? "review.approved" : "review.kept"))
            Haptics.success()
            state.memoryChanged()
            await load()
        } catch {
            state.show(error.localizedDescription)
        }
    }
}

struct ResolveConflictSheet: View {
    let conflict: Conflict
    let onDone: () async -> Void
    @EnvironmentObject var state: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var winner: String = ""
    @State private var reason = ""
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                if let s = conflict.summary { Section { Text(s).font(.subheadline) } }
                Section(L10n.t("review.winner")) {
                    Picker("", selection: $winner) {
                        ForEach(conflict.facts) { f in
                            VStack(alignment: .leading) {
                                Text(f.value)
                                Text("\(f.sourceLabel) · \(Fmt.date(f.date))").font(.caption).foregroundStyle(.secondary)
                            }
                            .tag(f.id)
                        }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                }
                Section(L10n.t("fact.reason")) { TextField(L10n.t("fact.reason"), text: $reason) }
                if let error { Section { ErrorBanner(message: error) } }
            }
            .navigationTitle(L10n.t("review.resolve"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L10n.t("common.cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L10n.t("common.confirm")) { Task { await submit() } }
                        .disabled(winner.isEmpty || reason.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .onAppear { if winner.isEmpty { winner = conflict.facts.last?.id ?? "" } }
        }
    }

    private func submit() async {
        do {
            try await API.shared.send("POST", "/conflicts/\(conflict.id)/resolve", body: ["winning_fact_id": winner, "reason": reason, "actor": state.actorName])
            state.memoryChanged()
            await onDone()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct CloseQuestionSheet: View {
    let question: OpenQuestion
    let onDone: () async -> Void
    @EnvironmentObject var state: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var note = ""
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section { Text(question.question) }
                Section(L10n.t("review.note")) { TextField(L10n.t("review.note"), text: $note, axis: .vertical) }
                if let error { Section { ErrorBanner(message: error) } }
            }
            .navigationTitle(L10n.t("review.close"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L10n.t("common.cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L10n.t("common.confirm")) { Task { await submit() } }
                        .disabled(note.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }

    private func submit() async {
        do {
            try await API.shared.send("POST", "/open-questions/\(question.id)/close", body: ["note": note, "actor": state.actorName])
            state.memoryChanged()
            await onDone()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
