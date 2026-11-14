import SwiftUI
import UIKit

private enum ChatItem: Identifiable {
    case divider(UUID, String)
    case question(UUID, String)
    case answer(UUID, AskResponse, String)
    case pending(UUID)
    case error(UUID, String)

    var id: UUID {
        switch self {
        case .divider(let id, _), .question(let id, _), .answer(let id, _, _), .pending(let id), .error(let id, _): return id
        }
    }

    var slidesIn: Bool {
        if case .question = self { return true }
        return false
    }
}

enum ChatStyle {
    static let background = Color(.systemBackground)
    static let userBubble = Color(light: UIColor(white: 0.945, alpha: 1), dark: UIColor(white: 0.19, alpha: 1))
    static let composer = Color(light: UIColor(white: 0.965, alpha: 1), dark: UIColor(white: 0.15, alpha: 1))
    static let maxWidth: CGFloat = 680
}

struct AskView: View {
    @EnvironmentObject var state: AppState
    @State private var items: [ChatItem] = []
    @State private var input = ""
    @State private var busy = false
    @State private var todayShown = false
    @State private var confirmReset = false
    @FocusState private var focused: Bool

    @State private var lastQuestion: String?

    private var demoQuestion: String { L10n.t("ask.suggestion1") }
    private var suggestions: [(String, String)] {
        [(L10n.t("ask.suggestion1"), "clock"),
         (L10n.t("ask.suggestion2"), "checkmark.seal"),
         (L10n.t("ask.suggestion3"), "calendar")]
    }

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    Group {
                        if items.isEmpty {
                            emptyState
                                .containerRelativeFrame(.vertical, alignment: .center)
                        } else {
                            conversation
                        }
                    }
                    .frame(maxWidth: ChatStyle.maxWidth)
                    .frame(maxWidth: .infinity)
                    .contentShape(Rectangle())
                    .onTapGesture { focused = false }
                }
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: items.count) {
                    withAnimation(.spring(response: 0.45, dampingFraction: 0.9)) { proxy.scrollTo("bottom", anchor: .bottom) }
                }
                .onChange(of: focused) {
                    guard focused, !items.isEmpty else { return }
                    withAnimation { proxy.scrollTo("bottom", anchor: .bottom) }
                }
            }
            .background(ChatStyle.background)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                VStack(spacing: 10) {
                    if items.isEmpty && !busy { suggestionCards }
                    composer
                }
                .padding(.top, 10)
                .background(alignment: .top) {
                    LinearGradient(colors: [ChatStyle.background.opacity(0), ChatStyle.background], startPoint: .top, endPoint: UnitPoint(x: 0.5, y: 0.35))
                        .ignoresSafeArea(edges: .bottom)
                        .allowsHitTesting(false)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .navigationTitle(state.projectName.isEmpty ? L10n.t("tab.ask") : state.projectName)
            .toolbar {
                ToolbarItem(placement: .principal) { projectMenu }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button {
                        Haptics.tap()
                        newChat()
                    } label: { Image(systemName: "square.and.pencil") }
                    .accessibilityLabel(L10n.t("ask.newChat"))
                    .accessibilityIdentifier("newChat")
                    .disabled(items.isEmpty && !busy)

                    Menu {
                        Button(L10n.t("ask.clear"), systemImage: "trash") { newChat() }
                        Button(L10n.t("settings.reset"), systemImage: "arrow.counterclockwise") { confirmReset = true }
                    } label: { Image(systemName: "ellipsis") }
                }
            }
            .confirmationDialog(L10n.t("settings.resetConfirm"), isPresented: $confirmReset, titleVisibility: .visible) {
                Button(L10n.t("settings.reset"), role: .destructive) { Task { await resetDemo() } }
            }
            .onAppear { if input.isEmpty && items.isEmpty { input = demoQuestion } }
            .onChange(of: state.askAgainRequest) {
                guard state.askAgainRequest != nil else { return }
                input = lastQuestion ?? demoQuestion
                Task { await ask() }
            }
            .onChange(of: state.projectId) {
                newChat()
                input = demoQuestion
            }
        }
    }

    // MARK: Navigation

    private var projectMenu: some View {
        Menu {
            if state.projects.count > 1 {
                Picker(L10n.t("ask.switchProject"), selection: $state.projectId) {
                    ForEach(state.projects) { p in Text(p.name).tag(p.id) }
                }
            } else {
                Text(state.projectName)
            }
        } label: {
            HStack(spacing: 4) {
                Text(state.projectName.isEmpty ? L10n.t("tab.ask") : state.projectName)
                    .font(.headline)
                    .lineLimit(1)
                Image(systemName: "chevron.down")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(.secondary)
            }
            .foregroundStyle(.primary)
        }
        .tint(.primary)
        .accessibilityLabel(L10n.t("ask.switchProject"))
    }

    // MARK: Empty state

    private var emptyState: some View {
        VStack(spacing: 16) {
            BrandMark(size: 52)
            Text(L10n.t("ask.emptyTitle"))
                .font(.title2.weight(.semibold))
                .multilineTextAlignment(.center)
            Text(L10n.t("ask.emptySubtitle"))
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 32)
        .transition(.opacity)
    }

    private var suggestionCards: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(suggestions, id: \.0) { sug in
                    Button {
                        input = sug.0
                        Task { await ask() }
                    } label: {
                        VStack(alignment: .leading, spacing: 8) {
                            Image(systemName: sug.1)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Palette.binding)
                            Text(sug.0)
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(.primary)
                                .multilineTextAlignment(.leading)
                                .lineLimit(2, reservesSpace: true)
                        }
                        .padding(14)
                        .frame(width: 190, alignment: .leading)
                        .background(ChatStyle.composer, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Palette.hairline))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
        }
        .transition(.opacity.combined(with: .move(edge: .bottom)))
    }

    // MARK: Conversation

    private var conversation: some View {
        VStack(alignment: .leading, spacing: 22) {
            if state.projectId == "proj-clearpath" {
                divider(L10n.t("ask.lastMonday"))
                UserBubble(text: demoQuestion)
                staleAnswer
            }
            ForEach(items) { item in
                row(item).id(item.id)
                    .transition(item.slidesIn ? .asymmetric(insertion: .move(edge: .bottom).combined(with: .opacity), removal: .opacity) : .opacity)
            }
            Color.clear.frame(height: 4).id("bottom")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .animation(.spring(response: 0.45, dampingFraction: 0.85), value: items.map(\.id))
    }

    @ViewBuilder
    private func row(_ item: ChatItem) -> some View {
        switch item {
        case .divider(_, let t): divider(t)
        case .question(_, let q): UserBubble(text: q)
        case .pending:
            VStack(alignment: .leading, spacing: 10) {
                AssistantHeader()
                TypingIndicator()
                    .accessibilityLabel(L10n.t("ask.thinking"))
            }
        case .error(_, let m): ErrorBanner(message: m)
        case .answer(_, let r, let q):
            AssistantReply(res: r) {
                input = q
                Task { await ask() }
            }
        }
    }

    private func divider(_ text: String) -> some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .foregroundStyle(.tertiary)
            .textCase(.uppercase)
            .frame(maxWidth: .infinity)
    }

    private var staleAnswer: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "bubble.left.fill")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 22, height: 22)
                    .background(Color(.tertiarySystemFill), in: Circle())
                Text(L10n.t("ask.companyAssistant")).font(.subheadline.weight(.semibold)).lineLimit(1)
                Text(L10n.t("ask.plainTag")).font(.caption).foregroundStyle(.tertiary).lineLimit(1)
                Spacer(minLength: 0)
            }
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(L10n.t("ask.oldAnswer"))
                    .font(.body)
                    .strikethrough(color: .red.opacity(0.75))
                    .foregroundStyle(.secondary)
                Badge(text: L10n.t("ask.wrong"), color: .red, dot: true)
            }
            .padding(.leading, 30)
            Label(L10n.t("ask.oldSource"), systemImage: "doc.text")
                .font(.caption)
                .foregroundStyle(.tertiary)
                .padding(.leading, 30)
        }
        .opacity(0.9)
    }

    // MARK: Composer

    private var composer: some View {
        HStack(alignment: .bottom, spacing: 8) {
            TextField(L10n.t("ask.placeholder"), text: $input, axis: .vertical)
                .lineLimit(1...5)
                .font(.body)
                .focused($focused)
                .submitLabel(.send)
                .onSubmit { Task { await ask() } }
                .padding(.vertical, 9)
                .padding(.leading, 6)
                .accessibilityIdentifier("askField")

            Button {
                Task { await ask() }
            } label: {
                ZStack {
                    Circle().fill(canSend || busy ? Color.primary : Color.primary.opacity(0.12))
                    if busy {
                        ProgressView()
                            .controlSize(.small)
                            .tint(ChatStyle.background)
                    } else {
                        Image(systemName: "arrow.up")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(canSend ? ChatStyle.background : Color.secondary)
                    }
                }
                .frame(width: 34, height: 34)
                .animation(.easeOut(duration: 0.15), value: canSend)
            }
            .accessibilityIdentifier("send")
            .accessibilityLabel(L10n.t("ask.send"))
            .disabled(!canSend)
        }
        .padding(.leading, 12)
        .padding(.trailing, 5)
        .padding(.vertical, 5)
        .background(ChatStyle.composer, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).stroke(Palette.hairline))
        .frame(maxWidth: ChatStyle.maxWidth)
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }

    private var canSend: Bool {
        !busy && !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    // MARK: Actions

    private func newChat() {
        items = []
        todayShown = false
    }

    private func ask() async {
        let q = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty, !busy else { return }
        Haptics.tap()
        busy = true
        focused = false
        lastQuestion = q
        input = ""
        if !todayShown {
            todayShown = true
            items.append(.divider(UUID(), L10n.t("ask.today")))
        }
        items.append(.question(UUID(), q))
        let pid = UUID()
        items.append(.pending(pid))
        do {
            let body: [String: Any] = ["question": q, "project_id": state.projectId, "include_plain_retrieval": true, "locale": L10n.lang]
            let res: AskResponse = try await API.shared.request("POST", "/ask", body: body)
            replace(pid, with: .answer(UUID(), res, q))
            Haptics.success()
        } catch {
            replace(pid, with: .error(UUID(), error.localizedDescription))
        }
        busy = false
    }

    private func replace(_ id: UUID, with item: ChatItem) {
        if let i = items.firstIndex(where: { $0.id == id }) { items[i] = item }
    }

    private func resetDemo() async {
        do {
            try await API.shared.send("POST", "/demo/reset")
            newChat()
            input = demoQuestion
            state.memoryChanged()
            state.show(L10n.t("settings.resetDone"))
        } catch {
            state.show(error.localizedDescription)
        }
    }
}

// MARK: - Chat components

private struct UserBubble: View {
    let text: String
    var body: some View {
        HStack {
            Spacer(minLength: 56)
            Text(text)
                .font(.body)
                .foregroundStyle(.primary)
                .padding(.horizontal, 16).padding(.vertical, 10)
                .background(ChatStyle.userBubble, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                .textSelection(.enabled)
        }
    }
}

private struct AssistantHeader: View {
    var body: some View {
        HStack(spacing: 8) {
            BrandMark(size: 22)
            Text(L10n.t("ask.companyAssistant"))
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
        }
    }
}

private struct TypingIndicator: View {
    var body: some View {
        TimelineView(.animation) { ctx in
            let t = ctx.date.timeIntervalSinceReferenceDate
            HStack(spacing: 5) {
                ForEach(0..<3) { i in
                    let phase = sin((t * 2 * .pi / 1.1) - Double(i) * 0.7)
                    Circle()
                        .fill(Color.secondary)
                        .frame(width: 8, height: 8)
                        .scaleEffect(0.75 + 0.25 * (phase + 1) / 2)
                        .opacity(0.35 + 0.65 * (phase + 1) / 2)
                }
            }
        }
        .padding(.leading, 30)
        .padding(.vertical, 6)
    }
}

struct AssistantReply: View {
    @EnvironmentObject var state: AppState
    let res: AskResponse
    var onRegenerate: () -> Void = {}

    @State private var shown = false
    @State private var quoteOpen = false
    @State private var feedback = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            AssistantHeader()

            VStack(alignment: .leading, spacing: 12) {
                Text(Fmt.headline(res.answer))
                    .font(.title3.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)
                    .reveal(shown, delay: 0)

                let rest = Fmt.rest(res.answer)
                if !rest.isEmpty {
                    Text(rest)
                        .font(.body)
                        .lineSpacing(3)
                        .foregroundStyle(.primary.opacity(0.85))
                        .fixedSize(horizontal: false, vertical: true)
                        .reveal(shown, delay: 0.12)
                }

                VStack(alignment: .leading, spacing: 10) {
                    sourceRow
                    if quoteOpen, let q = res.binding?.quote {
                        QuoteBlock(text: q)
                            .transition(.opacity.combined(with: .move(edge: .top)))
                    }
                    callout
                    conflicts
                }
                .reveal(shown, delay: 0.25)

                actions
                    .reveal(shown, delay: 0.35)
            }
            .padding(.leading, 30)
        }
        .textSelection(.enabled)
        .onAppear { shown = true }
    }

    // MARK: Parts

    @ViewBuilder
    private var sourceRow: some View {
        HStack(spacing: 8) {
            switch res.status {
            case "binding": Badge(text: L10n.t("fact.binding"), color: Palette.binding, dot: true)
            case "contested": Badge(text: L10n.t("ask.contested"), color: Palette.amber, dot: true)
            default: Badge(text: L10n.t("ask.noAnswer"), color: .gray)
            }
            if let b = res.binding {
                Button {
                    Haptics.tap()
                    withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) { quoteOpen.toggle() }
                } label: {
                    HStack(spacing: 5) {
                        Image(systemName: "doc.text").font(.caption2.weight(.semibold))
                        Text(b.sourceLabel).lineLimit(1)
                        Text("·")
                        Text(Fmt.date(b.date)).monospacedDigit().lineLimit(1)
                        if b.quote != nil {
                            Image(systemName: "chevron.down")
                                .font(.system(size: 9, weight: .bold))
                                .rotationEffect(.degrees(quoteOpen ? 180 : 0))
                        }
                    }
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 9).padding(.vertical, 4)
                    .background(Color(.tertiarySystemFill), in: Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("sourceChip")
                .accessibilityHint(L10n.t(quoteOpen ? "ask.hideQuote" : "ask.showQuote"))
            }
        }
    }

    @ViewBuilder
    private var callout: some View {
        if let b = res.binding, b.isPinned {
            note(L10n.t("ask.pinnedWins"), icon: "pin.fill")
        } else if let reason = res.changedBecause, !reason.isEmpty {
            note(L10n.t("ask.changedBecause", reason.trimmingCharacters(in: CharacterSet(charactersIn: ". "))), icon: "arrow.triangle.2.circlepath")
        }
    }

    @ViewBuilder
    private var conflicts: some View {
        if res.status == "contested", let cs = res.conflicts, !cs.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(cs) { f in
                    HStack(spacing: 8) {
                        Circle().fill(Palette.amber).frame(width: 6, height: 6)
                        Text(f.value).font(.subheadline.weight(.medium))
                        Spacer()
                        Text("\(f.sourceLabel) · \(Fmt.date(f.date))").font(.caption2.monospaced()).foregroundStyle(.secondary)
                    }
                }
            }
            .padding(12)
            .background(Palette.amberSoft, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }

    private var actions: some View {
        HStack(spacing: 4) {
            iconButton("doc.on.doc", label: L10n.t("ask.copy")) {
                UIPasteboard.general.string = res.answer ?? ""
                state.show(L10n.t("ask.copied"))
            }
            if let topic = res.binding?.topic ?? res.conflicts?.first?.topic {
                NavigationLink {
                    TopicDetailView(topicId: topic)
                } label: {
                    Label(L10n.t("memory.believes"), systemImage: "brain")
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(Palette.binding)
                        .padding(.horizontal, 10).frame(minHeight: 32)
                        .background(Palette.bindingSoft, in: Capsule())
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("openTopic")
            }
            iconButton("arrow.clockwise", label: L10n.t("ask.askAgain"), action: onRegenerate)
                .accessibilityIdentifier("regenerate")
            iconButton(feedback == 1 ? "hand.thumbsup.fill" : "hand.thumbsup", label: L10n.t("ask.good")) {
                feedback = feedback == 1 ? 0 : 1
            }
            iconButton(feedback == -1 ? "hand.thumbsdown.fill" : "hand.thumbsdown", label: L10n.t("ask.bad")) {
                feedback = feedback == -1 ? 0 : -1
            }
            Spacer(minLength: 0)
        }
        .padding(.leading, -8)
    }

    private func iconButton(_ icon: String, label: String, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.tap()
            action()
        } label: {
            Image(systemName: icon)
                .font(.footnote.weight(.medium))
                .foregroundStyle(.secondary)
                .frame(width: 32, height: 32)
                .contentShape(Rectangle())
                .contentTransition(.symbolEffect(.replace))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private func note(_ text: String, icon: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: icon).foregroundStyle(Palette.binding).font(.footnote.weight(.semibold))
            Text(text).font(.footnote).foregroundStyle(.primary.opacity(0.85)).fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.bindingSoft, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

private extension View {
    func reveal(_ shown: Bool, delay: Double) -> some View {
        self.opacity(shown ? 1 : 0)
            .offset(y: shown ? 0 : 6)
            .animation(.easeOut(duration: 0.35).delay(delay), value: shown)
    }
}
