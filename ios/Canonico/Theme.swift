import SwiftUI
import UIKit

enum Palette {
    static let binding = Color(light: UIColor(red: 0.15, green: 0.39, blue: 0.92, alpha: 1),
                               dark: UIColor(red: 0.38, green: 0.58, blue: 1.0, alpha: 1))
    static let bindingSoft = binding.opacity(0.10)
    static let amber = Color(light: UIColor(red: 0.72, green: 0.45, blue: 0.02, alpha: 1),
                             dark: UIColor(red: 0.98, green: 0.72, blue: 0.25, alpha: 1))
    static let amberSoft = Color(red: 0.96, green: 0.70, blue: 0.15).opacity(0.13)
    static let card = Color(.secondarySystemGroupedBackground)
    static let background = Color(.systemGroupedBackground)
    static let hairline = Color.primary.opacity(0.07)
}

extension Color {
    init(light: UIColor, dark: UIColor) {
        self.init(UIColor { $0.userInterfaceStyle == .dark ? dark : light })
    }
}

enum Haptics {
    static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    static func tap() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
}

struct BrandMark: View {
    var size: CGFloat = 52
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.27, style: .continuous)
                .fill(LinearGradient(colors: [Palette.binding, Palette.binding.opacity(0.78)], startPoint: .topLeading, endPoint: .bottomTrailing))
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: size * 0.46, weight: .semibold))
                .foregroundStyle(.white)
        }
        .frame(width: size, height: size)
        .shadow(color: Palette.binding.opacity(0.35), radius: size * 0.25, y: size * 0.1)
    }
}

struct Badge: View {
    let text: String
    let color: Color
    var dot: Bool = false
    var filled: Bool = false
    var body: some View {
        HStack(spacing: 5) {
            if dot { Circle().fill(filled ? Color.white : color).frame(width: 6, height: 6) }
            Text(text)
        }
        .font(.caption2.weight(.semibold))
        .lineLimit(1)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(filled ? color : color.opacity(0.14), in: Capsule())
        .foregroundStyle(filled ? Color.white : color)
    }
}

struct QuoteBlock: View {
    let text: String
    var color: Color = Palette.binding
    var collapsible: Bool = false
    @State private var expanded = false

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            RoundedRectangle(cornerRadius: 1.5).fill(color).frame(width: 3)
            Text("\u{201C}\(text)\u{201D}")
                .font(.subheadline)
                .foregroundStyle(.primary.opacity(0.82))
                .lineLimit(collapsible && !expanded ? 2 : nil)
                .fixedSize(horizontal: false, vertical: true)
        }
        .contentShape(Rectangle())
        .onTapGesture {
            guard collapsible else { return }
            withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) { expanded.toggle() }
        }
    }
}

struct SourceChip: View {
    let label: String
    let date: String
    var color: Color = Palette.binding
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "doc.text").font(.caption2.weight(.semibold))
            Text(label).font(.caption.weight(.medium)).lineLimit(1)
            if !date.isEmpty {
                Text("·").font(.caption)
                Text(date).font(.caption.monospaced())
            }
        }
        .padding(.horizontal, 10).padding(.vertical, 5)
        .background(color.opacity(0.10), in: Capsule())
        .overlay(Capsule().stroke(color.opacity(0.22), lineWidth: 0.5))
        .foregroundStyle(color)
    }
}

struct SourceLine: View {
    let fact: Fact
    var body: some View {
        Label {
            Text(fact.docId ?? "").font(.caption.monospaced()).lineLimit(1)
        } icon: {
            Image(systemName: "doc.text")
        }
        .font(.caption)
        .foregroundStyle(Palette.binding)
    }
}

struct ErrorBanner: View {
    let message: String
    var retry: (() -> Void)?
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.red)
            Text(message).font(.footnote).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            if let retry { Button(L10n.t("common.retry"), action: retry).font(.footnote.weight(.semibold)) }
        }
        .padding(12)
        .background(Color.red.opacity(0.08), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

struct EmptyStateView: View {
    let icon: String
    let text: String
    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 34, weight: .light))
                .foregroundStyle(.tertiary)
            Text(text).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
    }
}

struct ShimmerLines: View {
    @State private var phase = false
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            bar(width: 0.45, height: 12)
            bar(width: 0.8, height: 20)
            bar(width: 0.6, height: 12)
        }
        .opacity(phase ? 0.45 : 1)
        .animation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true), value: phase)
        .onAppear { phase = true }
    }
    private func bar(width: CGFloat, height: CGFloat) -> some View {
        GeometryReader { g in
            RoundedRectangle(cornerRadius: height / 2, style: .continuous)
                .fill(Color.primary.opacity(0.08))
                .frame(width: g.size.width * width)
        }
        .frame(height: height)
    }
}

struct ToastView: View {
    let text: String
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
            Text(text).font(.footnote.weight(.medium)).fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(.regularMaterial, in: Capsule())
        .overlay(Capsule().stroke(Palette.hairline))
        .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
        .padding(.horizontal, 16)
    }
}

extension View {
    func cardStyle(_ fill: Color = Palette.card, stroke: Color = Palette.hairline) -> some View {
        self.padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(fill, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(stroke, lineWidth: 1))
            .shadow(color: .black.opacity(0.04), radius: 8, y: 2)
    }
}
