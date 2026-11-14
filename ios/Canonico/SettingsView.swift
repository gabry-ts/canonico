import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var state: AppState
    @AppStorage("lang") private var lang = "en"
    @AppStorage("theme") private var theme = "system"
    @State private var confirmReset = false
    @State private var busy = false

    var body: some View {
        NavigationStack {
            Form {
                Section(L10n.t("settings.account")) {
                    HStack(spacing: 12) {
                        ZStack {
                            Circle().fill(Palette.bindingSoft)
                            Text(String((state.me?.name ?? state.me?.member?.name ?? "?").prefix(1))).font(.headline).foregroundStyle(Palette.binding)
                        }
                        .frame(width: 44, height: 44)
                        VStack(alignment: .leading) {
                            Text(state.me?.member?.name ?? state.me?.name ?? "—").font(.headline)
                            Text([state.me?.title, state.me?.role].compactMap { $0 }.joined(separator: " · ")).font(.footnote).foregroundStyle(.secondary)
                            if let e = state.me?.member?.email { Text(e).font(.caption).foregroundStyle(.secondary) }
                        }
                    }
                }

                if !state.projects.isEmpty {
                    Section(L10n.t("settings.project")) {
                        Picker(L10n.t("settings.project"), selection: $state.projectId) {
                            ForEach(state.projects) { p in Text(p.name).tag(p.id) }
                        }
                        .onChange(of: state.projectId) { state.memoryChanged() }
                    }
                }

                Section(L10n.t("settings.appearance")) {
                    Picker(L10n.t("settings.language"), selection: $lang) {
                        Text("English").tag("en")
                        Text("Italiano").tag("it")
                    }
                    Picker(L10n.t("settings.theme"), selection: $theme) {
                        Text(L10n.t("settings.system")).tag("system")
                        Text(L10n.t("settings.light")).tag("light")
                        Text(L10n.t("settings.dark")).tag("dark")
                    }
                }

                Section {
                    Button(L10n.t("settings.reset"), systemImage: "arrow.counterclockwise") { confirmReset = true }
                        .disabled(busy)
                } footer: {
                    Text(L10n.t("settings.resetFooter"))
                }

                Section {
                    Button(L10n.t("settings.logout"), role: .destructive) { Task { await state.logout() } }
                } footer: {
                    Text("\(API.baseURL.absoluteString) · v\(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "") (\(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""))")
                }
            }
            .navigationTitle(L10n.t("tab.settings"))
            .confirmationDialog(L10n.t("settings.resetConfirm"), isPresented: $confirmReset, titleVisibility: .visible) {
                Button(L10n.t("settings.reset"), role: .destructive) { Task { await reset() } }
            }
        }
    }

    private func reset() async {
        busy = true
        do {
            try await API.shared.send("POST", "/demo/reset")
            state.memoryChanged()
            state.show(L10n.t("settings.resetDone"))
        } catch {
            state.show(error.localizedDescription)
        }
        busy = false
    }
}
