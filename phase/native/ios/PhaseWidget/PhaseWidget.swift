import WidgetKit
import SwiftUI

// Phase home-screen widget: Fatigue, Sleep, Water and Stress rings.
// Add this file to the **PhaseWidget** widget-extension target.

private let appGroup = "group.com.phase.app" // must match PhaseWidgetPlugin.appGroup

// MARK: - Data

struct WidgetMetric: Codable, Identifiable {
    let key: String
    let label: String
    let value: String
    /// Compact value for inside a ring, e.g. "Med" for Medium.
    let short: String
    let detail: String
    let fill: Double
    let tone: String
    var id: String { key }
}

struct WidgetSnapshot: Codable {
    struct Cycle: Codable { let day: Int; let phase: String }
    let v: Int
    let date: String
    let updatedAt: Double
    let cycle: Cycle?
    let metrics: [WidgetMetric]

    static let sample = WidgetSnapshot(
        v: 1, date: isoDay(Date()), updatedAt: 0, cycle: Cycle(day: 10, phase: "Follicular phase"),
        metrics: [
            WidgetMetric(key: "fatigue", label: "Fatigue", value: "Mild", short: "Mild", detail: "A little tired", fill: 0.33, tone: "ok"),
            WidgetMetric(key: "sleep", label: "Sleep", value: "7.5h", short: "7.5h", detail: "Goal 8h", fill: 0.94, tone: "good"),
            WidgetMetric(key: "water", label: "Water", value: "5/8", short: "5/8", detail: "3 to go", fill: 0.63, tone: "ok"),
            WidgetMetric(key: "stress", label: "Stress", value: "Low", short: "Low", detail: "Nice and calm", fill: 0.33, tone: "good"),
        ])
}

func isoDay(_ date: Date) -> String { DateFormatter.iso.string(from: date) }

func loadSnapshot() -> WidgetSnapshot? {
    guard let json = UserDefaults(suiteName: appGroup)?.string(forKey: "snapshot"),
          let data = json.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
}

// MARK: - Timeline

struct PhaseEntry: TimelineEntry {
    let date: Date
    /// nil = the user hasn't opened Phase yet (or has logged out).
    let metrics: [WidgetMetric]?
    let cycleText: String?
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> PhaseEntry { entry(for: Date(), snapshot: .sample) }

    func getSnapshot(in context: Context, completion: @escaping (PhaseEntry) -> Void) {
        completion(entry(for: Date(), snapshot: loadSnapshot() ?? (context.isPreview ? .sample : nil)))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<PhaseEntry>) -> Void) {
        let now = Date()
        let midnight = Calendar.current.startOfDay(for: now.addingTimeInterval(86_400))
        let snap = loadSnapshot()
        // A second entry at midnight empties the rings for the new day until the user logs.
        let entries = [entry(for: now, snapshot: snap), entry(for: midnight, snapshot: snap)]
        completion(Timeline(entries: entries, policy: .after(midnight.addingTimeInterval(60))))
    }

    private func entry(for date: Date, snapshot: WidgetSnapshot?) -> PhaseEntry {
        guard let snap = snapshot else { return PhaseEntry(date: date, metrics: nil, cycleText: nil) }
        let today = isoDay(date)
        let stale = snap.date != today
        let metrics = snap.metrics.map { m in
            stale ? WidgetMetric(key: m.key, label: m.label, value: "—", short: "—", detail: "Not logged", fill: 0, tone: "none") : m
        }
        var cycleText: String? = nil
        if let c = snap.cycle {
            var day = c.day
            if stale, let from = DateFormatter.iso.date(from: snap.date) {
                day += Calendar.current.dateComponents([.day], from: from, to: Calendar.current.startOfDay(for: date)).day ?? 0
            }
            cycleText = stale ? "Day \(day)" : "Day \(day) · \(c.phase.replacingOccurrences(of: " phase", with: ""))"
        }
        return PhaseEntry(date: date, metrics: metrics, cycleText: cycleText)
    }
}

extension DateFormatter {
    static let iso: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
}

// MARK: - Design tokens (match src/components/MetricRings.tsx)

extension Color {
    init(hex: UInt32, alpha: Double = 1) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255,
                  opacity: alpha)
    }
    static let phaseBackground = Color(hex: 0x241A1C)
    static let phaseText = Color(hex: 0xFFF5F0)
    static let phaseMuted = Color(hex: 0xBFAEB0)
    static let phaseTrack = Color.white.opacity(0.12)
    static let phaseRose = Color(hex: 0xF2798A)

    static func tone(_ tone: String) -> Color {
        switch tone {
        case "good": return Color(hex: 0x7FD1B0)
        case "ok": return Color(hex: 0xF2B35E)
        case "alert": return Color(hex: 0xF2798A)
        default: return Color.white.opacity(0.28)
        }
    }
}

private func symbol(for key: String) -> String {
    switch key {
    case "fatigue": return "battery.25"
    case "sleep": return "moon.fill"
    case "water": return "drop.fill"
    default: return "wind"
    }
}

// MARK: - Views

struct RingView<Content: View>: View {
    let fill: Double
    let tone: String
    let lineWidth: CGFloat
    @ViewBuilder var content: Content

    var body: some View {
        ZStack {
            if tone == "none" {
                Circle().stroke(Color.tone(tone), style: StrokeStyle(lineWidth: 1.5, dash: [3, 4]))
            } else {
                Circle().stroke(Color.phaseTrack, lineWidth: lineWidth)
                if fill > 0 {
                    Circle()
                        .trim(from: 0, to: max(fill, 0.04))
                        .stroke(Color.tone(tone), style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                }
            }
            content
        }
        .padding(lineWidth / 2)
    }
}

struct Brand: View {
    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "circle.lefthalf.filled").font(.system(size: 11, weight: .bold)).foregroundColor(.phaseRose)
            Text("PHASE").font(.system(size: 11, weight: .bold)).foregroundColor(.phaseMuted)
        }
    }
}

struct EmptyStateView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Brand()
            Spacer()
            Text("Open Phase to start tracking fatigue, sleep, water and stress.")
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(.phaseText)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

struct MediumView: View {
    let entry: PhaseEntry
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Brand()
                Spacer()
                Text(entry.cycleText ?? "Today").font(.system(size: 11)).foregroundColor(.phaseMuted)
            }
            HStack(spacing: 6) {
                ForEach(entry.metrics ?? []) { m in
                    VStack(spacing: 4) {
                        RingView(fill: m.fill, tone: m.tone, lineWidth: 6) {
                            Text(m.short)
                                .font(.system(size: 13, weight: .semibold).monospacedDigit())
                                .minimumScaleFactor(0.6)
                                .lineLimit(1)
                                .foregroundColor(.phaseText)
                                .padding(.horizontal, 6)
                        }
                        .frame(width: 58, height: 58)
                        Text(m.label.uppercased())
                            .font(.system(size: 9, weight: .bold))
                            .foregroundColor(.phaseMuted)
                    }
                    .frame(maxWidth: .infinity)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(m.label): \(m.value == "—" ? "not logged" : m.value). \(m.detail)")
                }
            }
        }
    }
}

struct SmallView: View {
    let entry: PhaseEntry
    private let columns = [GridItem(.flexible(), spacing: 4), GridItem(.flexible(), spacing: 4)]
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Brand()
                Spacer()
                if let c = entry.cycleText { Text(c.components(separatedBy: " · ").first ?? c).font(.system(size: 10)).foregroundColor(.phaseMuted) }
            }
            LazyVGrid(columns: columns, spacing: 6) {
                ForEach(entry.metrics ?? []) { m in
                    VStack(spacing: 2) {
                        RingView(fill: m.fill, tone: m.tone, lineWidth: 4.5) {
                            Image(systemName: symbol(for: m.key))
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundColor(m.tone == "none" ? .phaseMuted : Color.tone(m.tone))
                        }
                        .frame(width: 38, height: 38)
                        Text(m.short)
                            .font(.system(size: 11, weight: .semibold).monospacedDigit())
                            .foregroundColor(.phaseText)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(m.label): \(m.value == "—" ? "not logged" : m.value)")
                }
            }
        }
    }
}

struct PhaseWidgetView: View {
    @Environment(\.widgetFamily) var family
    let entry: PhaseEntry
    var body: some View {
        Group {
            if entry.metrics == nil {
                EmptyStateView()
            } else if family == .systemSmall {
                SmallView(entry: entry)
            } else {
                MediumView(entry: entry)
            }
        }
        .phaseWidgetBackground()
    }
}

extension View {
    @ViewBuilder func phaseWidgetBackground() -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            containerBackground(Color.phaseBackground, for: .widget)
        } else {
            padding().background(Color.phaseBackground)
        }
    }
}

// MARK: - Widget

struct PhaseMetricsWidget: Widget {
    let kind = "PhaseMetricsWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            PhaseWidgetView(entry: entry)
        }
        .configurationDisplayName("Phase")
        .description("Fatigue, sleep, water and stress at a glance.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

@main
struct PhaseWidgetBundle: WidgetBundle {
    var body: some Widget { PhaseMetricsWidget() }
}
