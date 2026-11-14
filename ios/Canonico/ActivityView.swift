import SwiftUI

struct ActivityView: View {
    @EnvironmentObject var state: AppState
    @State private var events: [AuditEvent] = []
    @State private var error: String?
    @State private var undoing: AuditEvent?

    private let undoable: Set<String> = ["retire", "restore", "pin", "unpin", "correct", "patch", "resolve", "supersede", "maintenance_approve"]

    var body: some View {
        NavigationStack {
            List {
                if let error { ErrorBanner(message: error) { Task { await load() } } }
                if events.isEmpty && error == nil {
                    EmptyStateView(icon: "clock.arrow.circlepath", text: L10n.t("activity.empty")).listRowBackground(Color.clear)
                }
                ForEach(events) { e in
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: icon(e.action))
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(color(e.action))
                            .frame(width: 32, height: 32)
                            .background(color(e.action).opacity(0.12), in: Circle())
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(alignment: .firstTextBaseline) {
                                Text(e.summary ?? e.action ?? "").font(.subheadline.weight(.medium))
                                    .fixedSize(horizontal: false, vertical: true)
                                Spacer(minLength: 6)
                                if let a = e.action { Badge(text: a, color: color(a)) }
                            }
                            if let r = e.reason, r != e.summary { Text(r).font(.footnote).foregroundStyle(.secondary) }
                            Text("\(e.actor ?? "") · \(Fmt.timestamp(e.at))").font(.caption2).foregroundStyle(.tertiary)
                        }
                    }
                    .padding(.vertical, 4)
                    .swipeActions {
                        if let a = e.action, undoable.contains(a) {
                            Button(L10n.t("activity.undo")) { undoing = e }.tint(Palette.amber)
                        }
                    }
                    .contextMenu {
                        if let a = e.action, undoable.contains(a) {
                            Button(L10n.t("activity.undo"), systemImage: "arrow.uturn.backward") { undoing = e }
                        }
                    }
                }
            }
            .navigationTitle(L10n.t("tab.activity"))
            .refreshable { await load() }
            .task(id: "\(state.projectId)-\(state.memoryVersion)") { await load() }
            .confirmationDialog(L10n.t("activity.undoConfirm"), isPresented: Binding(get: { undoing != nil }, set: { if !$0 { undoing = nil } }), titleVisibility: .visible) {
                Button(L10n.t("activity.undo"), role: .destructive) {
                    if let e = undoing { Task { await undo(e) } }
                }
            } message: {
                Text(undoing?.summary ?? "")
            }
        }
    }

    private func icon(_ action: String?) -> String {
        switch action {
        case "retire": return "archivebox.fill"
        case "restore": return "arrow.uturn.backward"
        case "pin", "unpin": return "pin.fill"
        case "correct", "patch": return "pencil"
        case "resolve": return "arrow.triangle.branch"
        default: return "clock.fill"
        }
    }

    private func color(_ action: String?) -> Color {
        action == "retire" ? Palette.amber : Palette.binding
    }

    private func load() async {
        do {
            events = try await API.shared.request("GET", "/audit", query: ["limit": "100"])
            events.sort { $0.at > $1.at }
            error = nil
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func undo(_ e: AuditEvent) async {
        do {
            try await API.shared.send("POST", "/audit/\(e.id)/undo", body: ["actor": state.actorName, "reason": L10n.t("activity.undoReason")])
            state.show(L10n.t("activity.undone"))
            state.memoryChanged()
        } catch {
            state.show(error.localizedDescription)
        }
    }
}
