import SwiftUI

@main
struct CanonicoApp: App {
    @StateObject private var state = AppState()
    @AppStorage("lang") private var lang = "en"
    @AppStorage("theme") private var theme = "system"

    var scheme: ColorScheme? {
        switch theme {
        case "light": return .light
        case "dark": return .dark
        default: return nil
        }
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if state.loggedIn {
                    RootTabs()
                } else {
                    LoginView()
                }
            }
            .id(lang)
            .environmentObject(state)
            .environment(\.locale, Locale(identifier: lang))
            .preferredColorScheme(scheme)
            .tint(Palette.binding)
            .overlay(alignment: .bottom) {
                if let t = state.toast {
                    ToastView(text: t).padding(.bottom, 96)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .animation(.spring(response: 0.4, dampingFraction: 0.85), value: state.toast)
            .task { if state.loggedIn { await state.loadMe() } }
        }
    }
}

struct RootTabs: View {
    @EnvironmentObject var state: AppState
    var body: some View {
        TabView(selection: $state.tab) {
            AskView()
                .tabItem { Label(L10n.t("tab.ask"), systemImage: "bubble.left.and.text.bubble.right") }
                .tag(0)
            MemoryView()
                .tabItem { Label(L10n.t("tab.memory"), systemImage: "square.stack.3d.up") }
                .tag(1)
            InboxView()
                .tabItem { Label(L10n.t("tab.review"), systemImage: "tray") }
                .badge(state.inboxCount)
                .tag(2)
            ActivityView()
                .tabItem { Label(L10n.t("tab.activity"), systemImage: "clock.arrow.circlepath") }
                .tag(3)
            SettingsView()
                .tabItem { Label(L10n.t("tab.settings"), systemImage: "person.crop.circle") }
                .tag(4)
        }
        .sensoryFeedback(.selection, trigger: state.tab)
    }
}

struct LoginView: View {
    @EnvironmentObject var state: AppState
    @State private var user = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?
    @State private var showForm = false
    @State private var appeared = false
    @FocusState private var field: Field?

    private enum Field { case user, password }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Spacer().frame(height: 56)

                BrandMark(size: 64)
                    .scaleEffect(appeared ? 1 : 0.8)
                    .opacity(appeared ? 1 : 0)

                Text("Canonico")
                    .font(.system(.largeTitle, design: .default, weight: .bold))
                    .padding(.top, 24)
                Text(L10n.t("login.tagline"))
                    .font(.title3)
                    .foregroundStyle(.secondary)
                    .padding(.top, 6)
                    .fixedSize(horizontal: false, vertical: true)

                VStack(alignment: .leading, spacing: 14) {
                    feature("checkmark.seal.fill", Palette.binding, L10n.t("login.feature1"))
                    feature("text.quote", .secondary, L10n.t("login.feature2"))
                    feature("archivebox.fill", Palette.amber, L10n.t("login.feature3"))
                }
                .padding(.top, 32)
                .opacity(appeared ? 1 : 0)
                .offset(y: appeared ? 0 : 12)

                Button {
                    Haptics.tap()
                    Task { await run { _ = try await API.shared.demoLogin() } }
                } label: {
                    HStack(spacing: 10) {
                        if busy && !showForm {
                            ProgressView().tint(.white)
                        } else {
                            Image(systemName: "person.crop.circle.badge.checkmark")
                        }
                        Text(L10n.t("login.demo")).fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .foregroundStyle(.white)
                    .background(Palette.binding, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .shadow(color: Palette.binding.opacity(0.3), radius: 10, y: 4)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(L10n.t("login.demo"))
                .disabled(busy)
                .padding(.top, 40)

                Button {
                    withAnimation(.spring(response: 0.4, dampingFraction: 0.85)) { showForm.toggle() }
                    if showForm { field = .user }
                } label: {
                    HStack(spacing: 4) {
                        Text(L10n.t("login.or"))
                        Image(systemName: "chevron.down").font(.caption.weight(.semibold))
                            .rotationEffect(.degrees(showForm ? 180 : 0))
                    }
                    .font(.subheadline.weight(.medium))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                }
                .buttonStyle(.plain)
                .foregroundStyle(Palette.binding)
                .padding(.top, 6)

                if showForm {
                    VStack(spacing: 0) {
                        TextField(L10n.t("login.username"), text: $user)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .textContentType(.username)
                            .keyboardType(.emailAddress)
                            .submitLabel(.next)
                            .focused($field, equals: .user)
                            .onSubmit { field = .password }
                            .padding(.horizontal, 16).padding(.vertical, 14)
                        Divider().padding(.leading, 16)
                        SecureField(L10n.t("login.password"), text: $password)
                            .textContentType(.password)
                            .submitLabel(.go)
                            .focused($field, equals: .password)
                            .onSubmit { signIn() }
                            .padding(.horizontal, 16).padding(.vertical, 14)
                    }
                    .background(Palette.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Palette.hairline))
                    .transition(.move(edge: .top).combined(with: .opacity))

                    Button(action: signIn) {
                        Text(L10n.t("login.signin")).fontWeight(.semibold)
                            .frame(maxWidth: .infinity).padding(.vertical, 12)
                    }
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.roundedRectangle(radius: 14))
                    .disabled(busy || user.isEmpty || password.isEmpty)
                    .padding(.top, 12)
                    .transition(.opacity)

                    Text(L10n.t("login.hint"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .padding(.top, 10)
                        .transition(.opacity)
                }

                if let error { ErrorBanner(message: error).padding(.top, 16) }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(
            ZStack(alignment: .top) {
                Palette.background
                LinearGradient(colors: [Palette.binding.opacity(0.14), .clear], startPoint: .top, endPoint: .center)
            }
            .ignoresSafeArea()
        )
        .onAppear { withAnimation(.spring(response: 0.6, dampingFraction: 0.8).delay(0.05)) { appeared = true } }
    }

    private func feature(_ icon: String, _ color: Color, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: icon)
                .font(.body.weight(.semibold))
                .foregroundStyle(color)
                .frame(width: 24)
            Text(text).font(.subheadline).foregroundStyle(.primary.opacity(0.85))
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func signIn() {
        guard !user.isEmpty, !password.isEmpty else { return }
        Task { await run { _ = try await API.shared.login(user: user, password: password) } }
    }

    private func run(_ op: () async throws -> Void) async {
        busy = true
        error = nil
        do {
            try await op()
            await state.didLogin()
        } catch {
            self.error = error.localizedDescription
        }
        busy = false
    }
}
