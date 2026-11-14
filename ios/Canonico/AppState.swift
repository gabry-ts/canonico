import SwiftUI

enum L10n {
    static var lang: String {
        let v = UserDefaults.standard.string(forKey: "lang") ?? "en"
        return v == "it" ? "it" : "en"
    }

    private static var bundles: [String: Bundle] = [:]

    static func t(_ key: String) -> String {
        let l = lang
        let bundle: Bundle
        if let b = bundles[l] {
            bundle = b
        } else if let p = Bundle.main.path(forResource: l, ofType: "lproj"), let b = Bundle(path: p) {
            bundles[l] = b
            bundle = b
        } else {
            bundle = .main
        }
        return bundle.localizedString(forKey: key, value: key, table: nil)
    }

    static func t(_ key: String, _ args: CVarArg...) -> String {
        String(format: t(key), locale: Locale(identifier: lang), arguments: args)
    }
}

@MainActor
final class AppState: ObservableObject {
    @Published var loggedIn: Bool = API.shared.token != nil
    @Published var me: Me?
    @Published var projects: [Project] = []
    @Published var projectId: String = UserDefaults.standard.string(forKey: "projectId") ?? "proj-clearpath" {
        didSet { UserDefaults.standard.set(projectId, forKey: "projectId") }
    }
    @Published var inboxCount: Int = 0
    @Published var memoryVersion: Int = 0
    @Published var toast: String?
    @Published var tab: Int = 0
    @Published var askAgainRequest: UUID?

    var actorName: String { me?.name ?? me?.member?.name.components(separatedBy: " ").first ?? "Giulia" }
    var projectName: String { projects.first { $0.id == projectId }?.name ?? "" }

    init() {
        NotificationCenter.default.addObserver(forName: .canonicoUnauthorized, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in
                API.shared.token = nil
                self?.me = nil
                self?.loggedIn = false
            }
        }
    }

    func didLogin() async {
        loggedIn = true
        await loadMe()
    }

    func loadMe() async {
        me = try? await API.shared.request("GET", "/me")
        if let list: ProjectList = try? await API.shared.request("GET", "/projects") {
            projects = list.items
            if !projects.contains(where: { $0.id == projectId }), let first = projects.first { projectId = first.id }
        }
        await refreshInbox()
    }

    func refreshInbox() async {
        let q: [String: String?] = ["project_id": projectId]
        let items: [MaintenanceItem] = (try? await API.shared.request("GET", "/maintenance/queue", query: q)) ?? []
        inboxCount = items.filter { $0.status == nil || $0.status == "pending" }.count
    }

    func memoryChanged() {
        memoryVersion += 1
        Task { await refreshInbox() }
    }

    func logout() async {
        await API.shared.logout()
        me = nil
        loggedIn = false
    }

    /// Switches to the Ask tab and re-asks the last question.
    func askAgain() {
        tab = 0
        askAgainRequest = UUID()
    }

    func show(_ message: String) {
        toast = message
        Task {
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            if toast == message { toast = nil }
        }
    }
}
