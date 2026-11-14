import Foundation

struct APIError: LocalizedError {
    var status: Int
    var message: String
    var errorDescription: String? { message }
}

extension Notification.Name {
    static let canonicoUnauthorized = Notification.Name("canonicoUnauthorized")
    static let canonicoMemoryChanged = Notification.Name("canonicoMemoryChanged")
}

final class API {
    static let shared = API()

    #if DEBUG
    static let baseURL = URL(string: "http://localhost:8000")!
    #else
    static let baseURL = URL(string: "https://canonico.magikarp.uk/api")!
    #endif

    private let tokenKey = "canonico.token"

    var token: String? {
        get { UserDefaults.standard.string(forKey: tokenKey) }
        set { UserDefaults.standard.set(newValue, forKey: tokenKey) }
    }

    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        return d
    }()

    func request<T: Decodable>(_ method: String, _ path: String, query: [String: String?] = [:], body: [String: Any]? = nil) async throws -> T {
        let data = try await raw(method, path, query: query, body: body)
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError(status: 0, message: "Unexpected response: \(error.localizedDescription)")
        }
    }

    @discardableResult
    func send(_ method: String, _ path: String, query: [String: String?] = [:], body: [String: Any]? = nil) async throws -> Data {
        try await raw(method, path, query: query, body: body)
    }

    private func raw(_ method: String, _ path: String, query: [String: String?], body: [String: Any]?) async throws -> Data {
        var comps = URLComponents(url: API.baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        let items = query.compactMap { k, v in v.map { URLQueryItem(name: k, value: $0) } }
        if !items.isEmpty { comps.queryItems = items }
        var req = URLRequest(url: comps.url!)
        req.httpMethod = method
        req.timeoutInterval = 60
        req.setValue(L10n.lang, forHTTPHeaderField: "Accept-Language")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        } else if method != "GET" {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = "{}".data(using: .utf8)
        }
        let data: Data
        let resp: URLResponse
        do {
            (data, resp) = try await URLSession.shared.data(for: req)
        } catch {
            if (error as? URLError)?.code == .cancelled || error is CancellationError { throw CancellationError() }
            throw APIError(status: 0, message: L10n.t("error.network"))
        }
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            if status == 401 && !path.hasPrefix("/auth/") {
                await MainActor.run { NotificationCenter.default.post(name: .canonicoUnauthorized, object: nil) }
            }
            var message = "HTTP \(status)"
            if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                if let m = obj["message"] as? String { message = m } else if let d = obj["detail"] as? String { message = d }
            }
            throw APIError(status: status, message: message)
        }
        return data
    }

    // MARK: Auth

    func demoLogin() async throws -> LoginResponse {
        let r: LoginResponse = try await request("POST", "/auth/demo-login")
        token = r.token
        return r
    }

    func login(user: String, password: String) async throws -> LoginResponse {
        let known = ["giulia": "giulia.ferri@meridianlabs.org", "sara": "sara.conti@meridianlabs.org", "luca": "luca.bassi@meridianlabs.org"]
        let trimmed = user.trimmingCharacters(in: .whitespaces).lowercased()
        let email = trimmed.contains("@") ? trimmed : (known[trimmed] ?? trimmed)
        let r: LoginResponse = try await request("POST", "/auth/login", body: ["email": email, "password": password])
        token = r.token
        return r
    }

    func logout() async {
        _ = try? await send("POST", "/auth/logout")
        token = nil
    }
}
