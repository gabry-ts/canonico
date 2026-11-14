import Foundation

struct Fact: Codable, Identifiable, Hashable {
    let id: String
    var projectId: String?
    var topic: String?
    var value: String
    var type: String?
    var status: String?
    var docId: String?
    var quote: String?
    var date: String?
    var supersedes: String?
    var supersededBy: String?
    var confidence: Double?
    var retiredBy: String?
    var retiredAt: String?
    var retiredReason: String?
    var pinned: Bool?
    var docTitle: String?

    var isRetired: Bool { status == "retired" }
    var isPinned: Bool { pinned ?? false }
    var sourceLabel: String {
        guard let docId else { return "" }
        let last = docId.split(separator: "/").last.map(String.init) ?? docId
        return last.replacingOccurrences(of: "-", with: " ")
            .replacingOccurrences(of: "meeting 00", with: "meeting ")
    }
}

struct Topic: Codable, Identifiable, Hashable {
    let id: String
    var projectId: String?
    var label: String
    var factIds: [String]?
}

struct TopicChain: Codable {
    var topic: Topic
    var facts: [Fact]
    var changes: Int?
}

struct Citation: Codable, Hashable {
    var docId: String
    var quote: String?
}

struct PlainHit: Codable, Hashable {
    var docId: String
    var quote: String?
    var rank: Int?
}

struct AskResponse: Codable {
    var question: String?
    var status: String
    var answer: String?
    var binding: Fact?
    var superseded: [Fact]?
    var conflicts: [Fact]?
    var citations: [Citation]?
    var changedBecause: String?
    var answerId: String?
    var plainRetrieval: PlainHit?
}

struct AuditEvent: Codable, Identifiable, Hashable {
    let id: String
    var at: String
    var actor: String?
    var action: String?
    var factId: String?
    var reason: String?
    var summary: String?
    var projectId: String?
}

struct MaintenanceItem: Codable, Identifiable {
    let id: String
    var fact: Fact?
    var reason: String?
    var detail: String?
    var proposedAction: String?
    var status: String?
}

struct Conflict: Codable, Identifiable {
    let id: String
    var topic: String?
    var status: String?
    var summary: String?
    var facts: [Fact]
}

struct OpenQuestion: Codable, Identifiable {
    let id: String
    var topic: String?
    var question: String
    var status: String?
    var docId: String?
    var openedAt: String?
}

struct Member: Codable {
    var id: String
    var name: String
    var email: String?
    var orgRole: String?
}

struct Me: Codable {
    var member: Member?
    var role: String?
    var name: String?
    var title: String?
}

struct LoginResponse: Codable {
    var member: Member?
    var token: String?
}

struct Project: Codable, Identifiable, Hashable {
    let id: String
    var name: String
    var description: String?
}

struct ProjectList: Codable {
    var items: [Project]
}

enum Fmt {
    static func date(_ iso: String?) -> String {
        guard let iso, iso.count >= 10 else { return iso ?? "" }
        let inF = DateFormatter()
        inF.locale = Locale(identifier: "en_US_POSIX")
        inF.dateFormat = "yyyy-MM-dd"
        guard let d = inF.date(from: String(iso.prefix(10))) else { return iso }
        let out = DateFormatter()
        out.locale = Locale(identifier: L10n.lang)
        out.dateFormat = "d MMM yyyy"
        return out.string(from: d)
    }

    static func timestamp(_ iso: String?) -> String {
        guard let iso else { return "" }
        let f = ISO8601DateFormatter()
        guard let d = f.date(from: iso) else { return date(iso) }
        let out = DateFormatter()
        out.locale = Locale(identifier: L10n.lang)
        out.dateStyle = .medium
        out.timeStyle = .short
        return out.string(from: d)
    }

    /// First sentence of an answer, used as the headline.
    static func headline(_ s: String?) -> String {
        guard let s, !s.isEmpty else { return "" }
        if let r = s.range(of: ". ") { return String(s[..<r.lowerBound]) + "." }
        return s
    }

    static func rest(_ s: String?) -> String {
        guard let s, let r = s.range(of: ". ") else { return "" }
        return String(s[r.upperBound...])
    }
}
