import WidgetKit
import SwiftUI

// MARK: - Constants
private let kAppGroup     = "group.com.anonymous.Hidayah"
private let kWatchDataKey = "watch_prayer_data"

// MARK: - Data models
private struct StoredPrayer: Decodable {
    let name: String
    let time: String
}

private struct StoredHijri: Decodable {
    let day:         Int
    let monthNumber: Int?
    let monthNameEn: String?
    let year:        Int
}

private struct StoredData: Decodable {
    let city:    String
    let prayers: [StoredPrayer]
    let date:    String
    let hijri:   StoredHijri?
}

// MARK: - Domain models
struct WatchPrayer {
    let name: String
    let time: Date
}

struct LargeWatchEntry: TimelineEntry {
    let date:          Date
    let allPrayers:    [WatchPrayer]
    let nextIndex:     Int
    let city:          String
    let hijriDay:      Int?
    let hijriMonthNum: Int?
    let hijriMonthEn:  String?
    let hijriYear:     Int?
}

// MARK: - Formatters
private let timeFmt: DateFormatter = {
    let f = DateFormatter(); f.dateFormat = "HH:mm"; return f
}()

private let dateFmt: DateFormatter = {
    let f = DateFormatter()
    f.locale = Locale(identifier: "sv_SE")
    f.dateFormat = "d MMM"
    return f
}()

private func fmtDate(_ date: Date) -> String {
    let s = dateFmt.string(from: date)
    let parts = s.components(separatedBy: " ")
    guard parts.count == 2 else { return s }
    let month = parts[1].prefix(1).uppercased() + parts[1].dropFirst()
    return "\(parts[0]) \(month)"
}

// MARK: - Hidayah brand colors
private let wGold   = Color(red: 202/255, green: 180/255, blue: 136/255) // #cab488
private let wBgTop  = Color(red:  18/255, green:  30/255, blue:  25/255)
private let wBgBot  = Color(red:   8/255, green:  16/255, blue:  13/255)
private let wAccent = Color(red:  36/255, green: 100/255, blue:  93/255)

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

private func prayerIcon(_ name: String) -> String {
    switch name {
    case "Fajr":        return "fajr.fill"
    case "Soluppgång":  return "sunrise.fill"
    case "Dhuhr":       return "sun.max.fill"
    case "Asr":         return "asr.fill"
    case "Maghrib":     return "sunset.fill"
    case "Isha":        return "moon.stars.fill"
    default:
        let n = name.lowercased()
        if n.hasPrefix("faj")                       { return "fajr.fill" }
        if n.hasPrefix("sol") || n.hasPrefix("sun") { return "sunrise.fill" }
        if n.hasPrefix("dh")  || n.hasPrefix("zu")  { return "sun.max.fill" }
        if n.hasPrefix("as")                        { return "asr.fill" }
        if n.hasPrefix("ma")                        { return "sunset.fill" }
        if n.hasPrefix("is")                        { return "moon.stars.fill" }
        return "sun.max.fill"
    }
}

private func shortPrayerLabel(_ name: String) -> String {
    name == "Soluppgång" ? "Sol." : name
}

// "{day} / {monthNum} {Abbrev.}"  e.g. "6 / 9 Rmdn."
private func hijriStr(day: Int?, monthNum: Int?, monthEn: String?) -> String? {
    guard let d = day else { return nil }
    let abbrev: String
    if let m = monthEn?.lowercased(), !m.isEmpty {
        if      m.hasPrefix("muh")                       { abbrev = "Muh." }
        else if m.hasPrefix("saf")                       { abbrev = "Saf." }
        else if m.hasPrefix("rabi") && m.contains("aw") { abbrev = "R.I" }
        else if m.hasPrefix("rabi")                      { abbrev = "R.II" }
        else if m.hasPrefix("jum") && m.contains("aw")  { abbrev = "J.I" }
        else if m.hasPrefix("jum")                       { abbrev = "J.II" }
        else if m.hasPrefix("raj")                       { abbrev = "Raj." }
        else if m.hasPrefix("shaw")                      { abbrev = "Shaw." }
        else if m.hasPrefix("sha")                       { abbrev = "Sha." }
        else if m.hasPrefix("ram")                       { abbrev = "Rmdn." }
        else if m.contains("qa")                         { abbrev = "D.Qad." }
        else if m.contains("hij")                        { abbrev = "D.Hij." }
        else { abbrev = String(monthEn!.prefix(4)) + "." }
    } else {
        abbrev = ""
    }
    if let n = monthNum, !abbrev.isEmpty { return "\(d) / \(n) \(abbrev)" }
    if let n = monthNum                  { return "\(d) / \(n)" }
    if !abbrev.isEmpty                   { return "\(d) \(abbrev)" }
    return "\(d)"
}

// Custom SVG symbol from Assets.xcassets, tinted via foregroundColor
private struct PrayerSymbol: View {
    let name: String
    let size: CGFloat
    var body: some View {
        Image(name)
            .renderingMode(.template)
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
    }
}

// MARK: - Small complication cache reader
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

// MARK: - Large widget cache reader
private func readWatchCacheFull() -> LargeWatchEntry? {
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

    let nextIdx = prayers.firstIndex(where: { $0.time > now }) ?? 0
    return LargeWatchEntry(
        date:          now,
        allPrayers:    prayers,
        nextIndex:     nextIdx,
        city:          stored.city,
        hijriDay:      stored.hijri?.day,
        hijriMonthNum: stored.hijri?.monthNumber,
        hijriMonthEn:  stored.hijri?.monthNameEn,
        hijriYear:     stored.hijri?.year
    )
}

// MARK: - Provider
struct LargeWatchProvider: TimelineProvider {
    private func emptyEntry() -> LargeWatchEntry {
        LargeWatchEntry(
            date: .now, allPrayers: [], nextIndex: 0, city: "",
            hijriDay: nil, hijriMonthNum: nil, hijriMonthEn: nil, hijriYear: nil
        )
    }
    func placeholder(in context: Context) -> LargeWatchEntry { emptyEntry() }
    func getSnapshot(in context: Context, completion: @escaping (LargeWatchEntry) -> Void) {
        completion(readWatchCacheFull() ?? emptyEntry())
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<LargeWatchEntry>) -> Void) {
        if let entry = readWatchCacheFull() {
            let nextTime = entry.allPrayers.indices.contains(entry.nextIndex)
                ? entry.allPrayers[entry.nextIndex].time
                : Date().addingTimeInterval(5 * 60)
            completion(Timeline(entries: [entry], policy: .after(nextTime.addingTimeInterval(2 * 60))))
        } else {
            completion(Timeline(entries: [emptyEntry()], policy: .after(Date().addingTimeInterval(5 * 60))))
        }
    }
}

// MARK: - Small complication provider
struct WatchEntry: TimelineEntry {
    let date: Date
    let next: WatchPrayer?
    let city: String
}

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
            completion(Timeline(entries: [entry], policy: .after(next.time.addingTimeInterval(2 * 60))))
        } else {
            completion(Timeline(entries: [WatchEntry(date: .now, next: nil, city: "")],
                                policy: .after(Date().addingTimeInterval(5 * 60))))
        }
    }
}

// Small complication views
private struct SmallNoDataView: View {
    var body: some View {
        VStack(spacing: 2) {
            Image(systemName: "iphone").font(.system(size: 10))
            Text("Öppna\nHidayah").font(.system(size: 9)).multilineTextAlignment(.center)
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
                    .minimumScaleFactor(0.7).lineLimit(1)
                Text(timeFmt.string(from: next.time))
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .monospacedDigit().minimumScaleFactor(0.7)
            }
        } else { SmallNoDataView() }
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
                    .font(.system(size: 8, weight: .semibold)).minimumScaleFactor(0.7)
                Text(timeFmt.string(from: next.time))
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .monospacedDigit().minimumScaleFactor(0.7)
            }
        } else {
            Image(systemName: "moon.stars").font(.system(size: 12))
        }
    }
}

struct WatchEntryView: View {
    let entry: WatchEntry
    @Environment(\.widgetFamily) private var family
    var body: some View {
        switch family {
        case .accessoryCircular: CircularView(entry: entry)
        case .accessoryInline:   InlineView(entry: entry)
        default:                 CornerView(entry: entry)
        }
    }
}

// Liten komplikation — circular, inline, corner (INTE rectangular)
struct HidayahWatchWidget: Widget {
    let kind = "HidayahWatchWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: WatchProvider()) { entry in
            WatchEntryView(entry: entry)
        }
        .configurationDisplayName("Hidayah – Bönetid")
        .description("Visar nästa bönetid.")
        .supportedFamilies([
            .accessoryCircular,
            .accessoryInline,
            .accessoryCorner,
        ])
    }
}

// MARK: - Shared no-data view
private struct LargeNoDataView: View {
    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: "iphone.circle")
                .font(.system(size: 18))
                .foregroundColor(wGold.opacity(0.65))
            Text("Öppna Hidayah\npå iPhone")
                .font(.system(size: 10))
                .multilineTextAlignment(.center)
                .foregroundColor(.white.opacity(0.50))
        }
    }
}

// ================================================================================
// MARK: - Widget 1: Nästa bön
// ================================================================================

private struct NextPrayerLargeBodyView: View {
    let entry: LargeWatchEntry

    // Detects always-on / ambient display (klockan ej aktiv)
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced

    private var nextPrayer: WatchPrayer? {
        guard !entry.allPrayers.isEmpty,
              entry.allPrayers.indices.contains(entry.nextIndex)
        else { return nil }
        return entry.allPrayers[entry.nextIndex]
    }

    // "17 Maj  ·  30 Dhul-Qa'dah"
    private var dateLine: String? {
        let gregorian = fmtDate(entry.date)
        if let d = entry.hijriDay, let m = entry.hijriMonthEn, !m.isEmpty {
            return "\(gregorian)  ·  \(d) \(m)"
        }
        return gregorian
    }

    // Kompakt format för ambient-läge: "1t 5m" eller "45m"
    private func compactRemaining(to prayerTime: Date) -> String {
        let remaining = max(prayerTime.timeIntervalSince(entry.date), 0)
        let totalMin  = Int(remaining) / 60
        let h = totalMin / 60
        let m = totalMin % 60
        return h > 0 ? "\(h)t \(m)m" : "\(m)m"
    }

    var body: some View {
        ZStack {
            LinearGradient(colors: [wBgTop, wBgBot], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()

            if let next = nextPrayer {
                VStack(spacing: 0) {
                    Spacer()

                    // Bönenamn
                    Text(next.name)
                        .font(.system(size: 22, weight: .bold))
                        .foregroundColor(.white)

                    Spacer().frame(height: 6)

                    // Timer — centrerad i pill
                    // · Aktivt läge (klockan vaken):  live countdown "0:45:22"
                    // · Ambient/always-on:             kompakt statisk "1t 5m"
                    Group {
                        if isLuminanceReduced {
                            Text(compactRemaining(to: next.time))
                        } else {
                            Text(next.time, style: .timer)
                        }
                    }
                    .font(.system(size: 20, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .foregroundColor(wGold)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 6)
                    .background(
                        RoundedRectangle(cornerRadius: 12)
                            .fill(wAccent.opacity(0.40))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(wGold.opacity(0.25), lineWidth: 0.5)
                            )
                    )
                    .padding(.horizontal, 20)   // ← luft runt pillret så det inte fyller hela bredden

                    Spacer()

                    // Datum + hijri
                    if let line = dateLine {
                        Text(line)
                            .font(.system(size: 9, weight: .regular))
                            .foregroundColor(.white.opacity(0.42))
                            .lineLimit(1)
                            .minimumScaleFactor(0.75)
                    }
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
            } else {
                LargeNoDataView()
            }
        }
    }
}

// ================================================================================
// MARK: - Widget 2: Bönetidslinje
// ================================================================================

private struct PrayerStepView: View {
    let prayer:  WatchPrayer
    let isNext:  Bool
    let isPast:  Bool

    var body: some View {
        VStack(spacing: 2) {
            PrayerSymbol(name: prayerIcon(prayer.name), size: 14)
                .foregroundColor(isNext ? wGold : .white)

            Text(shortPrayerLabel(prayer.name))
                .font(.system(size: 7, weight: isNext ? .bold : .regular))
                .foregroundColor(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.6)

            Text(timeFmt.string(from: prayer.time))
                .font(.system(size: 7, weight: isNext ? .semibold : .regular, design: .monospaced))
                .foregroundColor(wGold)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 5)
        .padding(.horizontal, 1)
        .background(isNext ? wAccent.opacity(0.30) : Color.clear)
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(isNext ? wGold.opacity(0.55) : Color.clear, lineWidth: 0.8)
        )
        .cornerRadius(8)
    }
}

private struct TimelineProgressBar: View {
    let count:     Int
    let nextIndex: Int

    var body: some View {
        GeometryReader { proxy in
            let w    = proxy.size.width
            let step: CGFloat = count > 1 ? w / CGFloat(count - 1) : 0

            ZStack(alignment: .leading) {
                ForEach(0 ..< count, id: \.self) { i in
                    let cx: CGFloat = step * CGFloat(i)
                    let active = i == nextIndex
                    let sz: CGFloat = active ? 8 : 5
                    Circle()
                        .fill(active ? wGold : (i < nextIndex ? wGold.opacity(0.40) : Color.white.opacity(0.14)))
                        .frame(width: sz, height: sz)
                        .offset(x: cx - sz / 2, y: (8 - sz) / 2)
                }
            }
        }
        .frame(height: 8)
    }
}

private struct PrayerTimelineLargeBodyView: View {
    let entry: LargeWatchEntry

    private var nextPrayer: WatchPrayer? {
        guard !entry.allPrayers.isEmpty,
              entry.allPrayers.indices.contains(entry.nextIndex)
        else { return nil }
        return entry.allPrayers[entry.nextIndex]
    }

    var body: some View {
        ZStack {
            LinearGradient(colors: [wBgTop, wBgBot], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()

            VStack(alignment: .leading, spacing: 0) {

                // Header: "Tid kvar till Asr" + nedräkning
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    if let next = nextPrayer {
                        Text("Tid kvar till \(next.name)")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundColor(wGold)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)

                        Spacer(minLength: 4)

                        Text(next.time, style: .timer)
                            .font(.system(size: 11, weight: .bold, design: .monospaced))
                            .monospacedDigit()
                            .foregroundColor(wGold)
                    } else {
                        Text("Hidayah")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundColor(wGold)
                        Spacer()
                    }
                }
                .padding(.bottom, 8)

                if entry.allPrayers.isEmpty {
                    Spacer()
                    LargeNoDataView().frame(maxWidth: .infinity)
                    Spacer()
                } else {
                    HStack(spacing: 2) {
                        ForEach(entry.allPrayers.indices, id: \.self) { i in
                            PrayerStepView(
                                prayer: entry.allPrayers[i],
                                isNext: i == entry.nextIndex,
                                isPast: i < entry.nextIndex
                            )
                        }
                    }
                    .padding(.bottom, 7)

                    TimelineProgressBar(
                        count:     entry.allPrayers.count,
                        nextIndex: entry.nextIndex
                    )
                }
            }
            .padding(.horizontal, 10)
            .padding(.top, 8)
            .padding(.bottom, 8)
        }
    }
}

// ================================================================================
// MARK: - Widget definitions
// ================================================================================

struct HidayahNextPrayerLargeWidget: Widget {
    let kind = "HidayahNextPrayerLargeWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: LargeWatchProvider()) { entry in
            NextPrayerLargeBodyView(entry: entry)
        }
        .configurationDisplayName("Nästa bön")
        .description("Se nästa bön och nedräkning.")
        .supportedFamilies([.accessoryRectangular])
    }
}

struct HidayahPrayerTimelineLargeWidget: Widget {
    let kind = "HidayahPrayerTimelineLargeWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: LargeWatchProvider()) { entry in
            PrayerTimelineLargeBodyView(entry: entry)
        }
        .configurationDisplayName("Bönetidslinje")
        .description("Se dagens bönetider i en tydlig tidslinje.")
        .supportedFamilies([.accessoryRectangular])
    }
}

// ================================================================================
// MARK: - Widget 3: Bönetider Tidslinje (premium — focus + 6-prayer timeline)
// ================================================================================
//
// Design DNA matches the iOS lock-screen "Bönetider Tidslinje" widget:
//   • dark teal gradient background
//   • gold accent + subtle glow on hero icon
//   • gold divider
//   • 6-prayer timeline with abbreviations, times, checkmarks
//   • isLuminanceReduced (always-on) → neutral adaptive colours
//
// State machine (same rules as lock-screen widget):
//   Before Shuruq  → Shuruq highlighted, sunrise.fill icon
//   Shuruq–Dhuhr   → Dhuhr is focus, Shuruq marked past
//   After Isha     → "Halva natten om Xt Ym", moon.fill icon
//   After halvaNatten → "Fajr om Zt Wm"
//   Halva natten is NEVER shown in the 6-prayer timeline row.
//
// Countdown format: "om 57s" / "om 18m" / "om 3t 05m"  (Swedish, t not h)

// MARK: - Constants

private let kWatchTLPrayerKeys   = ["Fajr", "Soluppgång", "Dhuhr", "Asr", "Maghrib", "Isha"]
private let kWatchTLPrayerAbbrevs = ["FJR",  "SHR",        "DHR",  "ASR",  "MGR",     "ISH"]
// All six use custom SVG assets from Assets.xcassets — rendered via Image(name).
private let kWatchTLPrayerSymbols: [String] = [
    "fajr.fill",      "sunrise.fill", "sun.max.fill",
    "cloud.sun.fill", "sunset.fill",  "moon.stars.fill"
]
private let kWatchTLPrayerIsCustomAsset = [true, true, true, true, true, true]
private let kWatchTLFivePrayers = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"]

// MARK: - Helpers

private func wTLCountdown(from now: Date, to target: Date) -> String {
    let secs = max(0, Int(target.timeIntervalSince(now).rounded()))
    if secs < 60  { return "om \(secs)s" }
    let mins = secs / 60
    if mins < 60  { return "om \(mins)m" }
    let h = mins / 60; let m = mins % 60
    return String(format: "om %dt %02dm", h, m)
}

private func wTLSymbol(for name: String) -> String {
    if let i = kWatchTLPrayerKeys.firstIndex(of: name) { return kWatchTLPrayerSymbols[i] }
    return "clock"
}

private func wTLIsCustomAsset(for name: String) -> Bool {
    if let i = kWatchTLPrayerKeys.firstIndex(of: name) { return kWatchTLPrayerIsCustomAsset[i] }
    return false
}

private func wTLOrderedSix(from prayers: [WatchPrayer]) -> [WatchPrayer] {
    kWatchTLPrayerKeys.compactMap { name in prayers.first { $0.name == name } }
}

// MARK: - Hero state

private enum WatchTLHeroState {
    case prayer(WatchPrayer)
    case shuruq(Date)
    case halvaNatten(Date)
}

private func wTLHeroState(prayers: [WatchPrayer], now: Date) -> WatchTLHeroState {
    let five = prayers.filter { kWatchTLFivePrayers.contains($0.name) }

    let nextFive: WatchPrayer = five.first { $0.time > now }
        ?? five.first.map { WatchPrayer(name: $0.name, time: $0.time.addingTimeInterval(86_400)) }
        ?? WatchPrayer(name: "Fajr", time: now.addingTimeInterval(3_600))

    let halvaNattenTime: Date? = {
        guard let maghrib = five.first(where: { $0.name == "Maghrib" }),
              let fajr    = five.first(where: { $0.name == "Fajr" })
        else { return nil }
        var fajrAdj = fajr.time
        if fajrAdj <= maghrib.time { fajrAdj = fajrAdj.addingTimeInterval(86_400) }
        return maghrib.time.addingTimeInterval(fajrAdj.timeIntervalSince(maghrib.time) / 2)
    }()

    let shuruqTime = prayers.first { $0.name == "Soluppgång" }?.time

    var candidates: [(WatchTLHeroState, Date)] = [(.prayer(nextFive), nextFive.time)]
    if let s = shuruqTime,      s > now { candidates.append((.shuruq(s),      s)) }
    if let h = halvaNattenTime, h > now { candidates.append((.halvaNatten(h), h)) }

    return candidates.min(by: { $0.1 < $1.1 })?.0 ?? .prayer(nextFive)
}

// MARK: - Entry & provider

struct WatchTimelineEntry: TimelineEntry {
    let date:         Date
    let prayers:      [WatchPrayer]   // 6 ordered: Fajr…Isha
    let nextIndex:    Int             // index of next prayer; -1 = all passed
    let countdownStr: String          // "om Xs" / "om Ym" / "om Zt Wm"
}

struct WatchTimelineProvider: TimelineProvider {

    private func empty() -> WatchTimelineEntry {
        WatchTimelineEntry(date: .now, prayers: [], nextIndex: 0, countdownStr: "–")
    }

    func placeholder(in context: Context) -> WatchTimelineEntry { empty() }

    func getSnapshot(in context: Context, completion: @escaping (WatchTimelineEntry) -> Void) {
        completion(loadEntry(at: .now) ?? empty())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<WatchTimelineEntry>) -> Void) {
        guard let all = loadAllPrayers() else {
            completion(Timeline(entries: [empty()], policy: .after(Date().addingTimeInterval(5 * 60))))
            return
        }
        let midnight = Calendar.current.startOfDay(for: .now).addingTimeInterval(86_400 + 60)
        completion(Timeline(entries: buildEntries(from: all), policy: .after(midnight)))
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private func loadAllPrayers() -> [WatchPrayer]? {
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
        return prayers.isEmpty ? nil : prayers
    }

    private func loadEntry(at date: Date) -> WatchTimelineEntry? {
        guard let all = loadAllPrayers() else { return nil }
        return makeEntry(from: all, at: date)
    }

    private func makeEntry(from all: [WatchPrayer], at date: Date) -> WatchTimelineEntry {
        let six     = wTLOrderedSix(from: all)
        let nextIdx = six.firstIndex { $0.time > date } ?? -1
        let hero    = wTLHeroState(prayers: all, now: date)
        let heroT: Date = {
            switch hero {
            case .prayer(let p):      return p.time
            case .shuruq(let t):      return t
            case .halvaNatten(let t): return t
            }
        }()
        return WatchTimelineEntry(
            date:         date,
            prayers:      six,
            nextIndex:    nextIdx,
            countdownStr: wTLCountdown(from: date, to: heroT)
        )
    }

    private func buildEntries(from all: [WatchPrayer]) -> [WatchTimelineEntry] {
        let now = Date()
        var dates = Set<Date>()
        dates.insert(now)

        for p in all where p.time > now { dates.insert(p.time) }

        // Halva natten transition
        let five = all.filter { kWatchTLFivePrayers.contains($0.name) }
        if let maghrib = five.first(where: { $0.name == "Maghrib" }),
           let fajr    = five.first(where: { $0.name == "Fajr" }) {
            var adj = fajr.time
            if adj <= maghrib.time { adj = adj.addingTimeInterval(86_400) }
            let hn = maghrib.time.addingTimeInterval(adj.timeIntervalSince(maghrib.time) / 2)
            if hn > now { dates.insert(hn) }
        }

        // Coarse near-hero entries + per-second final 60 s
        let heroT: Date? = {
            switch wTLHeroState(prayers: all, now: now) {
            case .prayer(let p):      return p.time
            case .shuruq(let t):      return t
            case .halvaNatten(let t): return t
            }
        }()
        if let ht = heroT, ht > now {
            for off: TimeInterval in [-300, -240, -180, -120, -60, -30, -20, -10] {
                let t = ht.addingTimeInterval(off); if t > now { dates.insert(t) }
            }
            for s in 1...60 {
                let t = ht.addingTimeInterval(-Double(s)); if t > now { dates.insert(t) }
            }
        }

        return dates.sorted().map { makeEntry(from: all, at: $0) }
    }
}

// MARK: - View

private struct WatchTimelineBodyView: View {
    let entry: WatchTimelineEntry
    @Environment(\.isLuminanceReduced) private var dimmed

    private var accentClr:  Color { dimmed ? Color(white: 0.85)           : wGold }
    private var mainClr:    Color { dimmed ? Color(white: 0.72)           : .white.opacity(0.90) }
    private var mutedClr:   Color { dimmed ? Color(white: 0.52)           : .white.opacity(0.45) }
    private var passedClr:  Color { dimmed ? Color(white: 0.38)           : .white.opacity(0.28) }
    private var dividerClr: Color { dimmed ? Color(white: 0.22).opacity(0.50) : wGold.opacity(0.25) }
    private var dotClr:     Color { dimmed ? Color(white: 0.38)           : wGold.opacity(0.40) }

    private var hero: WatchTLHeroState {
        guard !entry.prayers.isEmpty else {
            return .prayer(WatchPrayer(name: "Fajr", time: entry.date))
        }
        return wTLHeroState(prayers: entry.prayers, now: entry.date)
    }

    private var heroIcon: String {
        switch hero {
        case .shuruq:        return "sunrise.fill"
        case .halvaNatten:   return "moon.stars.fill"
        case .prayer(let p): return wTLSymbol(for: p.name)
        }
    }

    // All hero states use custom assets from Assets.xcassets.
    private var heroIsCustomAsset: Bool { true }

    // Renders the hero icon, using the correct Image initializer for the asset type.
    @ViewBuilder
    private func heroIconView(color: Color, size: CGFloat = 16) -> some View {
        if heroIsCustomAsset {
            Image(heroIcon)
                .renderingMode(.template)
                .resizable()
                .scaledToFit()
                .frame(width: size, height: size)
                .foregroundColor(color)
        } else {
            Image(systemName: heroIcon)
                .font(.system(size: size, weight: .medium))
                .foregroundColor(color)
        }
    }

    private var heroName: String {
        switch hero {
        case .shuruq:        return "Shuruq"
        case .halvaNatten:   return "Halva natten"
        case .prayer(let p): return p.name
        }
    }

    private var heroTime: Date {
        switch hero {
        case .shuruq(let t):      return t
        case .halvaNatten(let t): return t
        case .prayer(let p):      return p.time
        }
    }

    // ── Focus row ─────────────────────────────────────────────────────────────

    private var focusRow: some View {
        HStack(alignment: .center, spacing: 7) {
            ZStack {
                if !dimmed {
                    heroIconView(color: wGold.opacity(0.22))
                        .blur(radius: 3)
                }
                heroIconView(color: accentClr)
            }
            .frame(width: 20, alignment: .center)

            VStack(alignment: .leading, spacing: 1) {
                HStack(alignment: .lastTextBaseline, spacing: 5) {
                    Text(heroName)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(accentClr)
                        .lineLimit(1)
                        .minimumScaleFactor(0.78)
                    Text(entry.countdownStr)
                        .font(.system(size: 11, weight: .regular).monospacedDigit())
                        .foregroundColor(mainClr)
                        .lineLimit(1)
                        .minimumScaleFactor(0.78)
                }
                Text(timeFmt.string(from: heroTime))
                    .font(.system(size: 10, weight: .regular).monospacedDigit())
                    .foregroundColor(mutedClr)
            }

            Spacer(minLength: 0)
        }
    }

    // ── Prayer cell — "FJR 02:05" inline, used in 2×3 grid ──────────────────

    @ViewBuilder
    private func prayerCell(_ prayer: WatchPrayer, idx: Int) -> some View {
        let isPast = entry.nextIndex == -1 || idx < entry.nextIndex
        let isNext = idx == entry.nextIndex
        let clr: Color = isPast ? passedClr : (isNext ? accentClr : mainClr.opacity(0.85))

        HStack(spacing: 3) {
            Text(kWatchTLPrayerAbbrevs[idx])
                .font(.system(size: 8, weight: isNext ? .bold : .regular))
                .foregroundColor(clr)
            Text(timeFmt.string(from: prayer.time))
                .font(.system(size: 8.5, weight: isNext ? .semibold : .regular, design: .monospaced))
                .foregroundColor(clr)
            if isPast {
                Image(systemName: "checkmark")
                    .font(.system(size: 6, weight: .bold))
                    .foregroundColor(passedClr)
            }
        }
        .lineLimit(1)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // ── Timeline grid — 2 rows × 3 columns ───────────────────────────────────

    private var timelineGrid: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 0) {
                ForEach(0..<3, id: \.self) { idx in
                    if idx < entry.prayers.count { prayerCell(entry.prayers[idx], idx: idx) }
                }
            }
            HStack(spacing: 0) {
                ForEach(3..<6, id: \.self) { idx in
                    if idx < entry.prayers.count { prayerCell(entry.prayers[idx], idx: idx) }
                }
            }
        }
    }

    // ── Root ──────────────────────────────────────────────────────────────────

    var body: some View {
        if entry.prayers.isEmpty {
            LargeNoDataView()
        } else {
            VStack(alignment: .leading, spacing: 0) {
                focusRow
                Rectangle()
                    .fill(dividerClr)
                    .frame(height: 1)
                    .padding(.vertical, 4)
                timelineGrid
            }
            .padding(.horizontal, 10)
            .padding(.top, 8)
            .padding(.bottom, 6)
        }
    }
}

// MARK: - Widget definition

struct HidayahWatchTimelineWidget: Widget {
    let kind = "HidayahWatchTimelineWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: WatchTimelineProvider()) { entry in
            WatchTimelineBodyView(entry: entry)
        }
        .configurationDisplayName("Bönetider Tidslinje")
        .description("Fokus på nästa bön med tidslinje för hela dagen.")
        .supportedFamilies([.accessoryRectangular])
    }
}
