import WidgetKit
import SwiftUI

// MARK: - Constants
private let kAppGroup    = "group.com.anonymous.Hidayah"
private let kWatchDataKey = "watch_prayer_data"   // written by HidayahWatchApp via WCSession

// MARK: - Data models (same structure as iOS andalus_widget_data JSON)
private struct StoredPrayer: Decodable {
    let name: String
    let time: String   // "HH:mm"
}

private struct StoredData: Decodable {
    let city:    String
    let prayers: [StoredPrayer]
    let date:    String   // "yyyy-MM-dd"
}

// MARK: - Domain model
struct WatchPrayer {
    let name: String
    let time: Date
}

struct WatchEntry: TimelineEntry {
    let date:        Date
    let next:        WatchPrayer?    // nil = no data yet
    let city:        String
}

// MARK: - Helpers
private func localISODate(_ d: Date) -> String {
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = .current
    let c = cal.dateComponents([.year, .month, .day], from: d)
    return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
}

private func parseTime(_ raw: String, on day: Date) -> Date? {
    let clean = raw.components(separatedBy: " ").first ?? raw
    let parts  = clean.split(separator: ":").compactMap { Int($0) }
    guard parts.count >= 2 else { return nil }
    var c = Calendar.current.dateComponents([.year, .month, .day], from: day)
    c.hour = parts[0]; c.minute = parts[1]; c.second = 0
    return Calendar.current.date(from: c)
}

// MARK: - Read watchOS App Group cache
private func readWatchCache() -> (next: WatchPrayer, city: String)? {
    guard
        let defaults = UserDefaults(suiteName: kAppGroup),
        let raw      = defaults.data(forKey: kWatchDataKey),
        let stored   = try? JSONDecoder().decode(StoredData.self, from: raw),
        stored.date  == localISODate(.now)
    else { return nil }

    let now = Date()
    let prayers = stored.prayers.compactMap { p -> WatchPrayer? in
        guard let t = parseTime(p.time, on: now) else { return nil }
        return WatchPrayer(name: p.name, time: t)
    }
    guard !prayers.isEmpty else { return nil }
    let next = prayers.first(where: { $0.time > now }) ?? prayers.first!
    return (next, stored.city)
}

// MARK: - Provider
struct WatchProvider: TimelineProvider {
    func placeholder(in context: Context) -> WatchEntry {
        WatchEntry(date: .now, next: nil, city: "")
    }

    func getSnapshot(in context: Context, completion: @escaping (WatchEntry) -> Void) {
        if let (next, city) = readWatchCache() {
            completion(WatchEntry(date: .now, next: next, city: city))
        } else {
            completion(WatchEntry(date: .now, next: nil, city: ""))
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<WatchEntry>) -> Void) {
        if let (next, city) = readWatchCache() {
            let entry  = WatchEntry(date: .now, next: next, city: city)
            // Reload 2 minutes after the next prayer passes
            let reload = next.time.addingTimeInterval(2 * 60)
            completion(Timeline(entries: [entry], policy: .after(reload)))
        } else {
            // No data yet — check again in 5 minutes
            let entry  = WatchEntry(date: .now, next: nil, city: "")
            let reload = Date().addingTimeInterval(5 * 60)
            completion(Timeline(entries: [entry], policy: .after(reload)))
        }
    }
}

// MARK: - Views
private let timeFmt: DateFormatter = {
    let f = DateFormatter(); f.dateFormat = "HH:mm"; return f
}()

private struct NoDataView: View {
    var body: some View {
        VStack(spacing: 2) {
            Image(systemName: "iphone")
                .font(.system(size: 10))
            Text("Öppna\nHidayah")
                .font(.system(size: 9))
                .multilineTextAlignment(.center)
        }
        .foregroundStyle(.secondary)
    }
}

private struct CircularView: View {
    let entry: WatchEntry
    var body: some View {
        if let next = entry.next {
            VStack(spacing: 1) {
                Text(next.name)
                    .font(.system(size: 10, weight: .semibold))
                    .minimumScaleFactor(0.7)
                    .lineLimit(1)
                Text(timeFmt.string(from: next.time))
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .minimumScaleFactor(0.7)
            }
        } else {
            NoDataView()
        }
    }
}

private struct RectangularView: View {
    let entry: WatchEntry
    var body: some View {
        if let next = entry.next {
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(next.name)
                        .font(.headline)
                        .fontWeight(.semibold)
                        .lineLimit(1)
                    Text(entry.city)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer()
                Text(timeFmt.string(from: next.time))
                    .font(.title2)
                    .fontWeight(.bold)
                    .monospacedDigit()
            }
        } else {
            Text("Öppna Hidayah på iPhone")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(2)
                .multilineTextAlignment(.center)
        }
    }
}

private struct InlineView: View {
    let entry: WatchEntry
    var body: some View {
        if let next = entry.next {
            Text("\(next.name) \(timeFmt.string(from: next.time))")
        } else {
            Text("Öppna Hidayah")
        }
    }
}

private struct CornerView: View {
    let entry: WatchEntry
    var body: some View {
        if let next = entry.next {
            VStack(spacing: 0) {
                Text(String(next.name.prefix(3)))
                    .font(.system(size: 8, weight: .semibold))
                    .minimumScaleFactor(0.7)
                Text(timeFmt.string(from: next.time))
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .minimumScaleFactor(0.7)
            }
        } else {
            Image(systemName: "moon.stars")
                .font(.system(size: 12))
        }
    }
}

struct WatchEntryView: View {
    let entry: WatchEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        switch family {
        case .accessoryCircular:
            CircularView(entry: entry)
        case .accessoryInline:
            InlineView(entry: entry)
        case .accessoryCorner:
            CornerView(entry: entry)
        default:
            RectangularView(entry: entry)
        }
    }
}

// MARK: - Widget
struct HidayahWatchWidget: Widget {
    let kind = "HidayahWatchWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: WatchProvider()) { entry in
            WatchEntryView(entry: entry)
        }
        .configurationDisplayName("Hidayah – Bönetid")
        .description("Visar nästa bönetid från din iPhone.")
        .supportedFamilies([
            .accessoryCircular,
            .accessoryRectangular,
            .accessoryInline,
            .accessoryCorner,
        ])
    }
}
