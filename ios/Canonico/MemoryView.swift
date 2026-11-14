import SwiftUI

struct MemoryView: View {
    @EnvironmentObject var state: AppState
    @State private var topics: [Topic] = []
    @State private var search = ""
    @State private var error: String?
    @State private var loading = false

    var filtered: [Topic] {
        let s = search.trimmingCharacters(in: .whitespaces).lowercased()
        return s.isEmpty ? topics : topics.filter { $0.label.lowercased().contains(s) || $0.id.contains(s) }
    }

    var body: some View {
        NavigationStack {
            List {
                if let error { ErrorBanner(message: error) { Task { await load() } } }
                ForEach(filtered) { t in
                    NavigationLink(value: t.id) {
                        HStack(spacing: 12) {
                            Image(systemName: "square.stack.3d.up.fill")
                                .font(.subheadline)
                                .foregroundStyle(Palette.binding)
                                .frame(width: 32, height: 32)
                                .background(Palette.bindingSoft, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                            Text(t.label).font(.body)
                            Spacer()
                            Text("\(t.factIds?.count ?? 0)")
                                .font(.caption.monospacedDigit().weight(.semibold))
                                .foregroundStyle(.secondary)
                                .padding(.horizontal, 8).padding(.vertical, 3)
                                .background(Color(.tertiarySystemFill), in: Capsule())
                        }
                        .padding(.vertical, 2)
                    }
                }
            }
            .overlay {
                if loading && topics.isEmpty { ProgressView() }
                else if !loading && filtered.isEmpty && error == nil {
                    EmptyStateView(icon: search.isEmpty ? "square.stack.3d.up" : "magnifyingglass", text: L10n.t("memory.empty"))
                }
            }
            .navigationTitle(L10n.t("tab.memory"))
            .navigationDestination(for: String.self) { TopicDetailView(topicId: $0) }
            .searchable(text: $search, prompt: L10n.t("memory.search"))
            .refreshable { await load() }
            .task(id: "\(state.projectId)-\(state.memoryVersion)") { await load() }
        }
    }

    private func load() async {
        loading = true
        do {
            topics = try await API.shared.request("GET", "/topics", query: ["project_id": state.projectId])
            error = nil
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
        }
        loading = false
    }
}

enum FactSheet: Identifiable {
    case retire(Fact), pin(Fact), correct(Fact), detail(Fact)
    var id: String {
        switch self {
        case .retire(let f): return "r\(f.id)"
        case .pin(let f): return "p\(f.id)"
        case .correct(let f): return "c\(f.id)"
        case .detail(let f): return "d\(f.id)"
        }
    }
}

struct TopicDetailView: View {
    let topicId: String
    @EnvironmentObject var state: AppState
    @State private var chain: TopicChain?
    @State private var error: String?
    @State private var sheet: FactSheet?
    @State private var justRetired = false
    @Environment(\.dismiss) private var dismiss

    private var facts: [Fact] { chain?.facts ?? [] }

    /// The binding fact: a pinned active fact wins, else the newest active fact nothing supersedes.
    private var binding: Fact? {
        let active = facts.filter { !$0.isRetired }
        if let p = active.first(where: { $0.isPinned }) { return p }
        return active.filter { $0.supersededBy == nil && $0.type != "SUPERSEDED" && $0.type != "OPEN" }
            .sorted { ($0.date ?? "") > ($1.date ?? "") }.first
    }

    private var replaced: [Fact] {
        facts.filter { $0.id != binding?.id && ($0.type == "SUPERSEDED" || ($0.supersededBy != nil && $0.isRetired)) }
            .sorted { ($0.date ?? "") < ($1.date ?? "") }
    }

    private var stillActive: [Fact] {
        facts.filter { $0.id != binding?.id && $0.supersededBy != nil && !$0.isRetired && $0.type != "SUPERSEDED" }
    }

    private var others: [Fact] {
        let shown = Set(([binding].compactMap { $0 } + replaced + stillActive).map(\.id))
        return facts.filter { !shown.contains($0.id) }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let chain { Text(chain.topic.label).font(.subheadline).foregroundStyle(.secondary).padding(.top, -8) }
                if let error { ErrorBanner(message: error) { Task { await load() } } }
                if chain == nil && error == nil { ShimmerLines().cardStyle() }

                if justRetired { askAgainBanner.transition(.move(edge: .top).combined(with: .opacity)) }

                if let b = binding { bindingCard(b) }

                ForEach(stillActive) { f in staleCard(f) }
                    .transition(.asymmetric(insertion: .opacity, removal: .scale(scale: 0.95).combined(with: .opacity)))

                if !replaced.isEmpty {
                    sectionHeader(L10n.t("memory.replaced", replaced.count), icon: "clock.arrow.circlepath")
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(replaced.reversed().enumerated()), id: \.element.id) { i, f in
                            replacedRow(f, last: i == replaced.count - 1)
                        }
                    }
                    .padding(.vertical, 6)
                    .cardStyle()
                }

                if !others.isEmpty {
                    sectionHeader(L10n.t("memory.other"), icon: "tray.full")
                    ForEach(others) { f in otherRow(f) }
                }
            }
            .padding(16)
        }
        .background(Palette.background)
        .animation(.spring(response: 0.45, dampingFraction: 0.85), value: stillActive.map(\.id))
        .animation(.spring(response: 0.45, dampingFraction: 0.85), value: justRetired)
        .sensoryFeedback(.success, trigger: justRetired) { _, new in new }
        .navigationTitle(L10n.t("memory.believes"))
        .navigationBarTitleDisplayMode(.large)
        .refreshable { await load() }
        .task(id: state.memoryVersion) { await load() }
        .sheet(item: $sheet) { s in
            FactActionSheet(sheet: s, binding: binding, onRetired: { justRetired = true }) { await load() }
                .environmentObject(state)
        }
    }

    private var askAgainBanner: some View {
        HStack(spacing: 12) {
            Image(systemName: "checkmark.circle.fill").font(.title2).foregroundStyle(.green)
            Text(L10n.t("fact.retiredBanner")).font(.subheadline.weight(.medium))
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 4)
            Button {
                Haptics.tap()
                state.askAgain()
                dismiss()
            } label: {
                Label(L10n.t("ask.askAgain"), systemImage: "arrow.clockwise")
                    .font(.subheadline.weight(.semibold))
            }
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.capsule)
            .accessibilityIdentifier("askAgain")
        }
        .cardStyle(Color.green.opacity(0.10), stroke: Color.green.opacity(0.25))
    }

    private func sectionHeader(_ text: String, icon: String) -> some View {
        Label(text, systemImage: icon)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 4)
            .padding(.top, 4)
    }

    private func bindingCard(_ b: Fact) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Badge(text: L10n.t(b.isPinned ? "fact.pinned" : "fact.binding"), color: Palette.binding, dot: true, filled: true)
                Spacer()
                Text(Fmt.date(b.date)).font(.caption.monospaced()).foregroundStyle(Palette.binding)
            }
            Text(b.value).font(.largeTitle.weight(.bold)).fixedSize(horizontal: false, vertical: true)
            if let q = b.quote { QuoteBlock(text: q) }
            SourceLine(fact: b)
            Divider().opacity(0.6)
            factMenu(b)
        }
        .cardStyle(Palette.bindingSoft, stroke: Palette.binding.opacity(0.25))
        .contentShape(Rectangle())
        .onTapGesture { sheet = .detail(b) }
    }

    private func replacedRow(_ f: Fact, last: Bool) -> some View {
        Button { sheet = .detail(f) } label: {
            HStack(alignment: .top, spacing: 12) {
                VStack(spacing: 0) {
                    Circle()
                        .strokeBorder(Color.secondary.opacity(0.5), lineWidth: 1.5)
                        .frame(width: 10, height: 10)
                        .padding(.top, 5)
                    if !last {
                        Rectangle().fill(Color.secondary.opacity(0.25)).frame(width: 1.5)
                    }
                }
                .frame(width: 12)
                VStack(alignment: .leading, spacing: 3) {
                    Text(f.value).font(.body).strikethrough().foregroundStyle(.secondary)
                    HStack(spacing: 4) {
                        Text(Fmt.date(f.date)).font(.caption2.monospaced())
                        Text("· \(f.sourceLabel)").font(.caption2).lineLimit(1)
                    }
                    .foregroundStyle(.tertiary)
                    if f.isRetired {
                        Label(L10n.t("memory.retiredBy", f.retiredBy ?? ""), systemImage: "archivebox")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                }
                .padding(.bottom, last ? 0 : 14)
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func staleCard(_ f: Fact) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Badge(text: L10n.t("fact.stillActive"), color: Palette.amber, dot: true)
                Spacer()
                Text("\(Fmt.date(f.date)) · \(f.sourceLabel)").font(.caption2.monospaced()).foregroundStyle(Palette.amber).lineLimit(1)
            }
            Text(f.value).font(.title.weight(.bold))
            HStack(alignment: .center, spacing: 12) {
                Text(L10n.t("memory.staleNote")).font(.footnote).foregroundStyle(Palette.amber)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                Button {
                    Haptics.tap()
                    sheet = .retire(f)
                } label: {
                    Label(L10n.t("fact.retire"), systemImage: "archivebox")
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 4)
                }
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
                .tint(Palette.amber)
                .accessibilityIdentifier("retireStale")
            }
        }
        .cardStyle(Palette.amberSoft, stroke: Palette.amber.opacity(0.35))
    }

    private func otherRow(_ f: Fact) -> some View {
        Button { sheet = .detail(f) } label: {
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(f.value).font(.body.weight(.medium)).strikethrough(f.isRetired)
                    Spacer()
                    Badge(text: f.isRetired ? L10n.t("fact.retired") : (f.type ?? ""), color: .gray)
                }
                Text("\(Fmt.date(f.date)) · \(f.sourceLabel)").font(.caption2.monospaced()).foregroundStyle(.secondary)
            }
            .cardStyle()
        }
        .buttonStyle(.plain)
    }

    private func factMenu(_ f: Fact) -> some View {
        HStack(spacing: 8) {
            Button(f.isPinned ? L10n.t("fact.unpin") : L10n.t("fact.pin"), systemImage: f.isPinned ? "pin.slash" : "pin") { sheet = .pin(f) }
            Button(L10n.t("fact.correct"), systemImage: "pencil") { sheet = .correct(f) }
            Button(L10n.t("fact.retire"), systemImage: "archivebox") { sheet = .retire(f) }
        }
        .font(.caption.weight(.medium))
        .buttonStyle(.bordered)
        .buttonBorderShape(.capsule)
        .controlSize(.small)
    }

    private func load() async {
        do {
            chain = try await API.shared.request("GET", "/topics/\(topicId)/chain")
            error = nil
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct FactActionSheet: View {
    let sheet: FactSheet
    let binding: Fact?
    var onRetired: () -> Void = {}
    let onDone: () async -> Void
    @EnvironmentObject var state: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var reason = ""
    @State private var value = ""
    @State private var busy = false
    @State private var error: String?
    @State private var overrideMode: FactSheet?

    private var effective: FactSheet { overrideMode ?? sheet }

    private var fact: Fact {
        switch effective {
        case .retire(let f), .pin(let f), .correct(let f), .detail(let f): return f
        }
    }

    private var mode: String {
        switch effective {
        case .retire: return "retire"
        case .pin: return "pin"
        case .correct: return "correct"
        case .detail: return "detail"
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text(fact.value).font(.title2.weight(.bold)).strikethrough(fact.isRetired)
                            Spacer()
                            if fact.isRetired {
                                Badge(text: L10n.t("fact.retired"), color: .gray)
                            } else if fact.id == binding?.id {
                                Badge(text: L10n.t("fact.binding"), color: Palette.binding)
                            } else if fact.supersededBy != nil && fact.type != "SUPERSEDED" {
                                Badge(text: "● " + L10n.t("fact.stillActive"), color: Palette.amber)
                            }
                        }
                        Text("\(fact.sourceLabel) · \(Fmt.date(fact.date))").font(.caption.monospaced()).foregroundStyle(.secondary)
                        if let q = fact.quote { QuoteBlock(text: q, color: .secondary, collapsible: mode == "retire") }
                        if fact.isRetired, let r = fact.retiredReason {
                            Text(L10n.t("fact.retiredReason", fact.retiredBy ?? "", r)).font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 4)
                }

                switch mode {
                case "retire":
                    Section(L10n.t("fact.reason")) {
                        TextField(L10n.t("fact.reasonPlaceholder"), text: $reason, axis: .vertical)
                            .lineLimit(1...3)
                    }
                    if let b = binding, b.id != fact.id {
                        Section(L10n.t("fact.after")) {
                            HStack {
                                Text(L10n.t("fact.nextAnswer")).foregroundStyle(.secondary)
                                Spacer()
                                Label("\(b.value) · \(b.sourceLabel)", systemImage: "checkmark.seal.fill")
                                    .foregroundStyle(Palette.binding).font(.footnote.weight(.medium))
                            }
                            HStack {
                                Text(fact.value).strikethrough().foregroundStyle(.secondary)
                                Spacer()
                                Text(L10n.t("fact.retiredByToday", state.actorName)).font(.footnote).foregroundStyle(.secondary)
                            }
                        }
                    }
                    Section {
                        Label(L10n.t("fact.auditNote"), systemImage: "clock.badge.checkmark").font(.footnote).foregroundStyle(.secondary)
                    }
                case "pin":
                    Section(L10n.t("fact.reason")) { TextField(L10n.t("fact.pinPlaceholder"), text: $reason) }
                case "correct":
                    Section(L10n.t("fact.newValue")) { TextField(fact.value, text: $value) }
                    Section(L10n.t("fact.reason")) { TextField(L10n.t("fact.correctPlaceholder"), text: $reason) }
                default:
                    Section {
                        if fact.isRetired {
                            Button(L10n.t("fact.restore"), systemImage: "arrow.uturn.backward") { Task { await restore() } }
                        } else {
                            Button(L10n.t("fact.retire"), systemImage: "archivebox") { switchTo(.retire(fact)) }
                            Button(fact.isPinned ? L10n.t("fact.unpin") : L10n.t("fact.pin"), systemImage: "pin") { switchTo(.pin(fact)) }
                            Button(L10n.t("fact.correct"), systemImage: "pencil") { switchTo(.correct(fact)) }
                        }
                    }
                    Section {
                        LabeledContent(L10n.t("fact.type"), value: fact.type ?? "")
                        LabeledContent("ID", value: fact.id)
                        if let c = fact.confidence { LabeledContent(L10n.t("fact.confidence"), value: String(format: "%.2f", c)) }
                        LabeledContent(L10n.t("fact.document"), value: fact.docId ?? "")
                    }
                }

                if let error { Section { ErrorBanner(message: error) } }
            }
            .listSectionSpacing(.compact)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L10n.t("common.cancel")) { dismiss() } }
            }
            .safeAreaInset(edge: .bottom) {
                if mode != "detail" {
                    Button {
                        Task { await confirm() }
                    } label: {
                        Group {
                            if busy { ProgressView().tint(.white) } else { Text(confirmTitle).fontWeight(.semibold) }
                        }
                        .frame(maxWidth: .infinity).padding(.vertical, 12)
                    }
                    .buttonStyle(.borderedProminent)
                    .buttonBorderShape(.roundedRectangle(radius: 14))
                    .tint(mode == "retire" ? Color.red : Palette.binding)
                    .disabled(busy || reason.trimmingCharacters(in: .whitespaces).isEmpty || (mode == "correct" && value.trimmingCharacters(in: .whitespaces).isEmpty))
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                }
            }
            .onAppear {
                if case .retire = sheet, reason.isEmpty { reason = L10n.t("fact.reasonDefault") }
            }
        }
        .presentationDetents(mode == "retire" ? [.medium, .large] : [.large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(24)
    }

    private func switchTo(_ s: FactSheet) {
        if case .retire = s { reason = L10n.t("fact.reasonDefault") } else { reason = "" }
        overrideMode = s
    }

    private var title: String {
        switch mode {
        case "retire": return L10n.t("fact.retireTitle")
        case "pin": return fact.isPinned ? L10n.t("fact.unpin") : L10n.t("fact.pin")
        case "correct": return L10n.t("fact.correct")
        default: return L10n.t("fact.detail")
        }
    }

    private var confirmTitle: String {
        switch mode {
        case "retire": return L10n.t("fact.confirmRetire")
        case "pin": return fact.isPinned ? L10n.t("fact.unpin") : L10n.t("fact.pin")
        default: return L10n.t("fact.saveCorrection")
        }
    }

    private func confirm() async {
        busy = true
        error = nil
        let r = reason.trimmingCharacters(in: .whitespaces)
        do {
            switch mode {
            case "retire":
                try await API.shared.send("POST", "/facts/\(fact.id)/retire", body: ["reason": r, "actor": state.actorName])
                state.show(L10n.t("fact.retiredToast", fact.value))
                Haptics.success()
                onRetired()
            case "pin":
                let path = fact.isPinned ? "unpin" : "pin"
                try await API.shared.send("POST", "/facts/\(fact.id)/\(path)", body: ["reason": r, "actor": state.actorName])
                state.show(L10n.t(fact.isPinned ? "fact.unpinnedToast" : "fact.pinnedToast"))
            default:
                try await API.shared.send("PATCH", "/facts/\(fact.id)", body: ["value": value.trimmingCharacters(in: .whitespaces), "reason": r, "actor": state.actorName])
                state.show(L10n.t("fact.correctedToast"))
            }
            state.memoryChanged()
            await onDone()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
        busy = false
    }

    private func restore() async {
        busy = true
        do {
            try await API.shared.send("POST", "/facts/\(fact.id)/restore", body: ["actor": state.actorName])
            state.show(L10n.t("fact.restoredToast", fact.value))
            state.memoryChanged()
            await onDone()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
        busy = false
    }
}
