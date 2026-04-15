//
//  HidayahWidget.swift
//  HidayahWidget
//
//  Bönetider-widget — small, medium och large.
//
//  Datakällor (i prioritetsordning):
//  1. App Groups "andalus_widget_data" om det gäller dagens datum → används direkt.
//  2. Lat/lng från App Groups + aladhan.com API → om datat är gammalt (app inte öppnad idag).
//  3. Stockholm-koordinater → om appen aldrig öppnats.
//

import WidgetKit
import SwiftUI

// MARK: - Constants

private let kAccent    = Color(red: 36/255,  green: 100/255, blue: 93/255)
private let kHighlight = Color(red: 100/255, green: 210/255, blue: 195/255) // readable on dark green
private let kGold      = Color(red: 202/255, green: 180/255, blue: 136/255) // matches app dark mode #cab488
private let kBgTop     = Color(red: 18/255,  green: 30/255,  blue: 25/255)
private let kBgBottom  = Color(red:  8/255,  green: 16/255,  blue: 13/255)
private let kAppGroup = "group.com.anonymous.Hidayah"
private let kDataKey  = "andalus_widget_data"

// MARK: - App Groups JSON model

private struct StoredPrayer: Decodable {
    let name: String   // Swedish display name
    let time: String   // "HH:mm"
}

private struct StoredData: Decodable {
    let city:      String
    let latitude:  Double?   // optional — absent in data written by older app versions
    let longitude: Double?
    let prayers:   [StoredPrayer]
    let date:      String    // "yyyy-MM-dd" in UTC (JS toISOString)
}

// MARK: - Domain model

struct Prayer: Identifiable {
    var id: String { name }
    let name: String
    let time: Date
}

struct PrayerEntry: TimelineEntry {
    let date:       Date
    let current:    Prayer
    let next:       Prayer
    let allPrayers: [Prayer]
    let city:       String

    static func placeholder(at now: Date = .now) -> PrayerEntry {
        let offsets: [(String, Double)] = [
            ("Fajr",       -7*3600), ("Shuruq", -5*3600),
            ("Dhuhr",      -1*3600), ("Asr",         3*3600),
            ("Maghrib",     5*3600), ("Isha",         6*3600),
        ]
        let all = offsets.map { Prayer(name: $0.0, time: now.addingTimeInterval($0.1)) }
        return PrayerEntry(date: now, current: all[2], next: all[3],
                           allPrayers: all, city: "Stockholm")
    }
}

// MARK: - App Groups reader

/// Tries to read today's prayer data from the App Group container.
/// Returns non-nil only when the stored date matches today.
private func readAppGroupData() -> StoredData? {
    guard
        let defaults = UserDefaults(suiteName: kAppGroup),
        let raw      = defaults.data(forKey: kDataKey),
        let stored   = try? JSONDecoder().decode(StoredData.self, from: raw)
    else { return nil }

    // The JS side stores UTC date; compare to local today to be lenient:
    // accept if either UTC date or local date matches (covers post-22:00 edge case).
    let localToday = localISODate(Date())
    let utcToday   = utcISODate(Date())
    guard stored.date == localToday || stored.date == utcToday else { return nil }

    return stored
}

/// Reads last-known location from App Groups even if prayer data is stale.
/// Tries individual keys first (always written), then falls back to JSON blob,
/// then to Stockholm default.
private func readStoredLocation() -> (lat: Double, lng: Double, city: String) {
    guard let defaults = UserDefaults(suiteName: kAppGroup) else {
        return (59.3293, 18.0686, "Stockholm")
    }

    // Individual keys — written reliably by every version of WidgetDataModule
    let lat  = defaults.double(forKey: "prayer_lat")
    let lng  = defaults.double(forKey: "prayer_lng")
    let city = defaults.string(forKey: "prayer_city") ?? ""

    if lat != 0 && lng != 0 && !city.isEmpty {
        return (lat, lng, city)
    }

    // Fallback: try JSON blob (covers old module versions that didn't write individual keys)
    if let raw    = defaults.data(forKey: kDataKey),
       let stored = try? JSONDecoder().decode(StoredData.self, from: raw),
       let bLat   = stored.latitude, let bLng = stored.longitude,
       bLat != 0 && bLng != 0 {
        return (bLat, bLng, stored.city)
    }

    return (59.3293, 18.0686, "Stockholm")
}

// MARK: - Time helpers

private func localISODate(_ d: Date) -> String { isoDate(d, tz: .current) }
private func utcISODate  (_ d: Date) -> String { isoDate(d, tz: TimeZone(identifier: "UTC")!) }

private func isoDate(_ d: Date, tz: TimeZone) -> String {
    var cal = Calendar(identifier: .gregorian); cal.timeZone = tz
    let c = cal.dateComponents([.year, .month, .day], from: d)
    return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
}

private func parsePrayers(_ stored: [StoredPrayer]) -> [Prayer] {
    let cal   = Calendar.current
    let today = cal.startOfDay(for: Date())
    return stored.compactMap { sp -> Prayer? in
        let parts = sp.time.split(separator: ":").compactMap { Int($0) }
        guard parts.count >= 2 else { return nil }
        var c = cal.dateComponents([.year, .month, .day], from: today)
        c.hour = parts[0]; c.minute = parts[1]; c.second = 0
        guard let date = cal.date(from: c) else { return nil }
        return Prayer(name: sp.name, time: date)
    }.sorted { $0.time < $1.time }
}

// MARK: - aladhan.com fallback fetch

private let kPrayerOrder  = ["Fajr", "Sunrise", "Dhuhr", "Asr", "Maghrib", "Isha"]
private let kSwedishNames = [
    "Fajr": "Fajr", "Sunrise": "Shuruq",
    "Dhuhr": "Dhuhr", "Asr": "Asr", "Maghrib": "Maghrib", "Isha": "Isha",
]

private struct AladhanResponse: Decodable {
    struct Data: Decodable {
        struct Meta: Decodable { let timezone: String }
        let timings: [String: String]
        let meta:    Meta
    }
    let data: Data
}

private func fetchFromAPI(lat: Double, lng: Double,
                          completion: @escaping ([Prayer]) -> Void) {
    let ts  = Int(Date().timeIntervalSince1970)
    let url = URL(string:
        "https://api.aladhan.com/v1/timings/\(ts)"
        + "?latitude=\(lat)&longitude=\(lng)&method=3"
    )!

    URLSession.shared.dataTask(with: url) { data, _, _ in
        guard
            let data,
            let resp = try? JSONDecoder().decode(AladhanResponse.self, from: data)
        else { completion([]); return }

        let tz  = TimeZone(identifier: resp.data.meta.timezone) ?? .current
        var cal = Calendar.current; cal.timeZone = tz
        let today = cal.startOfDay(for: Date())
        var result: [Prayer] = []

        for key in kPrayerOrder {
            guard let raw  = resp.data.timings[key],
                  let name = kSwedishNames[key] else { continue }
            let parts = raw.split(separator: ":").compactMap { Int($0) }
            guard parts.count >= 2 else { continue }
            var c = cal.dateComponents([.year, .month, .day], from: today)
            c.hour = parts[0]; c.minute = parts[1]; c.second = 0; c.timeZone = tz
            if let date = cal.date(from: c) {
                result.append(Prayer(name: name, time: date))
            }
        }
        completion(result.sorted { $0.time < $1.time })
    }.resume()
}

// MARK: - Current/next helper

private func currentAndNext(prayers: [Prayer], at now: Date) -> (Prayer, Prayer) {
    guard !prayers.isEmpty else {
        let d = Prayer(name: "Fajr", time: now.addingTimeInterval(3_600))
        return (d, d)
    }
    var current = prayers.last!
    var nextIdx = 0
    for (i, p) in prayers.enumerated() where p.time <= now {
        current = p; nextIdx = (i + 1) % prayers.count
    }
    var next = prayers[nextIdx]
    if next.time <= now {
        next = Prayer(name: next.name, time: next.time.addingTimeInterval(86_400))
    }
    return (current, next)
}

private func buildEntries(prayers: [Prayer], city: String) -> [PrayerEntry] {
    let now = Date()
    var entries: [PrayerEntry] = []
    let (cur0, nxt0) = currentAndNext(prayers: prayers, at: now)
    entries.append(PrayerEntry(date: now, current: cur0, next: nxt0,
                               allPrayers: prayers, city: city))
    for prayer in prayers where prayer.time > now {
        let (cur, nxt) = currentAndNext(prayers: prayers, at: prayer.time)
        entries.append(PrayerEntry(date: prayer.time, current: cur, next: nxt,
                                   allPrayers: prayers, city: city))
    }
    return entries
}

// MARK: - Provider

struct PrayerProvider: TimelineProvider {

    func placeholder(in context: Context) -> PrayerEntry { .placeholder() }

    func getSnapshot(in context: Context,
                     completion: @escaping (PrayerEntry) -> Void) {
        if let stored = readAppGroupData() {
            let prayers = parsePrayers(stored.prayers)
            if !prayers.isEmpty {
                let now = Date()
                let (cur, nxt) = currentAndNext(prayers: prayers, at: now)
                completion(PrayerEntry(date: now, current: cur, next: nxt,
                                       allPrayers: prayers, city: stored.city))
                return
            }
        }
        completion(.placeholder())
    }

    func getTimeline(in context: Context,
                     completion: @escaping (Timeline<PrayerEntry>) -> Void) {

        let midnight = Calendar.current.startOfDay(for: Date()).addingTimeInterval(86_400 + 60)

        // ── Path 1: App Groups has fresh data for today ───────────────────────
        if let stored = readAppGroupData() {
            let prayers = parsePrayers(stored.prayers)
            if !prayers.isEmpty {
                let entries = buildEntries(prayers: prayers, city: stored.city)
                completion(Timeline(entries: entries, policy: .after(midnight)))
                return
            }
        }

        // ── Path 2: Stale / missing → fetch from aladhan.com with stored location
        let (lat, lng, city) = readStoredLocation()
        fetchFromAPI(lat: lat, lng: lng) { prayers in
            guard !prayers.isEmpty else {
                // API failed — retry in 15 min
                let timeline = Timeline(entries: [PrayerEntry.placeholder()],
                                        policy: .after(Date().addingTimeInterval(900)))
                completion(timeline)
                return
            }
            let entries = buildEntries(prayers: prayers, city: city)
            completion(Timeline(entries: entries, policy: .after(midnight)))
        }
    }
}

// MARK: - Shared helpers

private let timeFmt: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "HH:mm"
    return f
}()

// MARK: - Hero state

private enum HeroState {
    case prayer(Prayer)       // label "Nästa bön"
    case shuruq(Date)         // label "Tid kvar till Shuruq"
    case halvaNatten(Date)    // label "Tid kvar till halva natten"
}

/// Picks the nearest upcoming event from {next actual prayer, Shuruq, Halva natten}.
/// The caller renders the correct label per state — Shuruq and Halva natten
/// are never presented as prayers.
private func computeHeroState(allPrayers: [Prayer], now: Date) -> HeroState {
    let five = allPrayers.filter { kFivePrayers.contains($0.name) }

    let nextPrayer: Prayer = five.first { $0.time > now }
        ?? five.first.map { Prayer(name: $0.name, time: $0.time.addingTimeInterval(86_400)) }
        ?? Prayer(name: "Fajr", time: now.addingTimeInterval(3_600))

    let shuruqTime: Date? = allPrayers.first { $0.name == "Shuruq" || $0.name == "Soluppgång" }?.time

    let halvaNattenTime: Date? = {
        guard let maghrib = five.first(where: { $0.name == "Maghrib" }),
              let fajr    = five.first(where: { $0.name == "Fajr" })
        else { return nil }
        var fajrAdj = fajr.time
        if fajrAdj <= maghrib.time { fajrAdj = fajrAdj.addingTimeInterval(86_400) }
        return maghrib.time.addingTimeInterval(fajrAdj.timeIntervalSince(maghrib.time) / 2)
    }()

    var candidates: [(HeroState, Date)] = [(.prayer(nextPrayer), nextPrayer.time)]
    if let s = shuruqTime,      s > now { candidates.append((.shuruq(s),      s)) }
    if let h = halvaNattenTime, h > now { candidates.append((.halvaNatten(h), h)) }

    return candidates.min(by: { $0.1 < $1.1 })?.0 ?? .prayer(nextPrayer)
}

// MARK: - Small Focus widget

struct SmallFocusWidgetView: View {
    let entry: PrayerEntry

    private var heroState: HeroState {
        computeHeroState(allPrayers: entry.allPrayers, now: entry.date)
    }

    @ViewBuilder
    private var heroSection: some View {
        switch heroState {
        case .prayer(let p):
            Text("Nästa bön")
                .font(.system(size: 10, weight: .semibold))
                .foregroundColor(kGold)
            Text(p.name)
                .font(.system(size: 18, weight: .semibold))
                .foregroundColor(kGold)
                .padding(.top, 3)
            Text(p.time, style: .timer)
                .font(.system(size: 24, weight: .bold).monospacedDigit())
                .foregroundColor(kGold)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .padding(.top, 4)
            Text("Startar \(timeFmt.string(from: p.time))")
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(.white.opacity(0.60))
                .padding(.top, 3)
        case .shuruq(let t):
            Text("Tid kvar till Shuruq")
                .font(.system(size: 10, weight: .semibold))
                .foregroundColor(.white.opacity(0.60))
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
            Text(t, style: .timer)
                .font(.system(size: 24, weight: .bold).monospacedDigit())
                .foregroundColor(kGold)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .padding(.top, 8)
            Text("Startar \(timeFmt.string(from: t))")
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(.white.opacity(0.60))
                .padding(.top, 3)
        case .halvaNatten(let t):
            Text("Tid kvar till\nhalva natten")
                .font(.system(size: 10, weight: .semibold))
                .foregroundColor(.white.opacity(0.60))
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
            Text(t, style: .timer)
                .font(.system(size: 24, weight: .bold).monospacedDigit())
                .foregroundColor(kGold)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .padding(.top, 8)
            Text("Startar \(timeFmt.string(from: t))")
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(.white.opacity(0.60))
                .padding(.top, 3)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            heroSection

            Spacer(minLength: 6)

            Text(entry.city)
                .font(.system(size: 10, weight: .regular))
                .foregroundColor(.white.opacity(0.38))
                .lineLimit(1)
        }
        .padding(14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

// MARK: - Small List widget

struct SmallListWidgetView: View {
    let entry: PrayerEntry

    private var fivePrayers: [Prayer] {
        entry.allPrayers.filter { kFivePrayers.contains($0.name) }
    }

    /// Last prayer whose time has already passed — the one currently active.
    private var currentFive: Prayer? {
        fivePrayers.last { $0.time <= entry.date }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(entry.city)
                .font(.system(size: 10, weight: .regular))
                .foregroundColor(.white.opacity(0.40))
                .lineLimit(1)
                .padding(.bottom, 6)

            VStack(spacing: 0) {
                ForEach(Array(fivePrayers.enumerated()), id: \.element.id) { idx, prayer in
                    let isCurrent = prayer.name == currentFive?.name
                    let isPast    = prayer.time < entry.date && !isCurrent

                    HStack(spacing: 0) {
                        Text(prayer.name)
                            .font(.system(size: 13, weight: isCurrent ? .semibold : .regular))
                            .foregroundColor(
                                isCurrent ? .white :
                                isPast    ? .white.opacity(0.28) :
                                            .white.opacity(0.52)
                            )
                        Spacer()
                        Text(timeFmt.string(from: prayer.time))
                            .font(.system(size: 13, weight: isCurrent ? .semibold : .regular).monospacedDigit())
                            .foregroundColor(
                                isCurrent ? .white :
                                isPast    ? .white.opacity(0.22) :
                                            .white.opacity(0.44)
                            )
                    }
                    .frame(height: 22)

                    if idx < fivePrayers.count - 1 {
                        Rectangle()
                            .fill(Color.white.opacity(0.07))
                            .frame(height: 0.5)
                    }
                }
            }
        }
        .padding(EdgeInsets(top: 13, leading: 13, bottom: 11, trailing: 13))
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

// MARK: - Medium widget

private let mediumDateFmt: DateFormatter = {
    let f = DateFormatter()
    f.locale = Locale(identifier: "sv_SE")
    f.dateFormat = "d MMMM"
    return f
}()

private let largeDateFmt: DateFormatter = {
    let f = DateFormatter()
    f.locale = Locale(identifier: "sv_SE")
    f.dateFormat = "d MMMM yyyy"
    return f
}()

private let kFivePrayers = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"]

struct MediumWidgetView: View {
    let entry: PrayerEntry

    private var heroState: HeroState {
        computeHeroState(allPrayers: entry.allPrayers, now: entry.date)
    }

    private var fivePrayers: [Prayer] {
        entry.allPrayers.filter { kFivePrayers.contains($0.name) }
    }

    /// Prayer row always highlights the next actual prayer, independent of hero state.
    private var nextFiveForRow: Prayer? {
        fivePrayers.first { $0.time > entry.date }
    }

    @ViewBuilder
    private var heroSection: some View {
        switch heroState {
        case .prayer(let p):
            Text("Nästa bön")
                .font(.system(size: 10, weight: .semibold))
                .foregroundColor(kGold)
            Text(p.name)
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(kGold)
                .padding(.top, 3)
            Text(p.time, style: .timer)
                .font(.system(size: 26, weight: .bold).monospacedDigit())
                .foregroundColor(kGold)
                .lineLimit(1)
                .minimumScaleFactor(0.85)
                .padding(.top, 4)
            Text("Startar \(timeFmt.string(from: p.time))")
                .font(.system(size: 10, weight: .medium))
                .foregroundColor(.white.opacity(0.70))
                .padding(.top, 3)
        case .shuruq(let t):
            Text("Tid kvar till Shuruq")
                .font(.system(size: 10, weight: .semibold))
                .foregroundColor(.white.opacity(0.70))
            Text(t, style: .timer)
                .font(.system(size: 26, weight: .bold).monospacedDigit())
                .foregroundColor(kGold)
                .lineLimit(1)
                .minimumScaleFactor(0.85)
                .padding(.top, 7)
            Text("Startar \(timeFmt.string(from: t))")
                .font(.system(size: 10, weight: .medium))
                .foregroundColor(.white.opacity(0.70))
                .padding(.top, 3)
        case .halvaNatten(let t):
            Text("Tid kvar till halva natten")
                .font(.system(size: 10, weight: .semibold))
                .foregroundColor(.white.opacity(0.70))
                .lineLimit(1)
                .minimumScaleFactor(0.85)
            Text(t, style: .timer)
                .font(.system(size: 26, weight: .bold).monospacedDigit())
                .foregroundColor(kGold)
                .lineLimit(1)
                .minimumScaleFactor(0.85)
                .padding(.top, 7)
            Text("Startar \(timeFmt.string(from: t))")
                .font(.system(size: 10, weight: .medium))
                .foregroundColor(.white.opacity(0.70))
                .padding(.top, 3)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {

            // ── 1. HERO ──────────────────────────────────────────────────────
            heroSection

            Spacer(minLength: 8)

            // ── 2. PRAYER ROW ─────────────────────────────────────────────────
            HStack(alignment: .center, spacing: 0) {
                ForEach(Array(fivePrayers.enumerated()), id: \.element.id) { idx, prayer in
                    let isHighlit = prayer.name == nextFiveForRow?.name
                    if idx > 0 {
                        Rectangle()
                            .fill(Color.white.opacity(0.15))
                            .frame(width: 1, height: 20)
                    }
                    VStack(alignment: .center, spacing: 2) {
                        Text(prayer.name)
                            .font(.system(size: 9, weight: isHighlit ? .semibold : .regular))
                            .foregroundColor(isHighlit ? kGold : .white.opacity(0.4))
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                        Text(timeFmt.string(from: prayer.time))
                            .font(.system(size: 10, weight: isHighlit ? .semibold : .regular).monospacedDigit())
                            .foregroundColor(isHighlit ? kGold : .white.opacity(0.35))
                            .lineLimit(1)
                    }
                    .frame(maxWidth: .infinity)
                }
            }

            // ── 3. FOOTER ─────────────────────────────────────────────────────
            Text("\(entry.city) • \(mediumDateFmt.string(from: entry.date))")
                .font(.system(size: 10, weight: .medium))
                .foregroundColor(.white.opacity(0.55))
                .padding(.top, 6)
        }
        .padding(EdgeInsets(top: 16, leading: 14, bottom: 14, trailing: 14))
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

// MARK: - Large Focus widget

struct LargeFocusWidgetView: View {
    let entry: PrayerEntry

    private var heroState: HeroState {
        computeHeroState(allPrayers: entry.allPrayers, now: entry.date)
    }

    private var fivePrayers: [Prayer] {
        entry.allPrayers.filter { kFivePrayers.contains($0.name) }
    }

    /// Prayer row always highlights the next actual prayer, independent of hero state.
    private var nextFiveForRow: Prayer? {
        fivePrayers.first { $0.time > entry.date }
    }

    @ViewBuilder
    private var heroSection: some View {
        switch heroState {
        case .prayer(let p):
            Text("Nästa bön")
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(kGold)
            Text(p.name)
                .font(.system(size: 22, weight: .semibold))
                .foregroundColor(kGold)
                .padding(.top, 4)
            Text(p.time, style: .timer)
                .font(.system(size: 34, weight: .bold).monospacedDigit())
                .foregroundColor(kGold)
                .lineLimit(1)
                .minimumScaleFactor(0.85)
                .padding(.top, 5)
            Text("Startar \(timeFmt.string(from: p.time))")
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(.white.opacity(0.65))
                .padding(.top, 4)
                .padding(.bottom, 16)
        case .shuruq(let t):
            Text("Tid kvar till Shuruq")
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(.white.opacity(0.65))
            Text(t, style: .timer)
                .font(.system(size: 34, weight: .bold).monospacedDigit())
                .foregroundColor(kGold)
                .lineLimit(1)
                .minimumScaleFactor(0.85)
                .padding(.top, 10)
            Text("Startar \(timeFmt.string(from: t))")
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(.white.opacity(0.65))
                .padding(.top, 4)
                .padding(.bottom, 16)
        case .halvaNatten(let t):
            Text("Tid kvar till halva natten")
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(.white.opacity(0.65))
            Text(t, style: .timer)
                .font(.system(size: 34, weight: .bold).monospacedDigit())
                .foregroundColor(kGold)
                .lineLimit(1)
                .minimumScaleFactor(0.85)
                .padding(.top, 10)
            Text("Startar \(timeFmt.string(from: t))")
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(.white.opacity(0.65))
                .padding(.top, 4)
                .padding(.bottom, 16)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {

            // ── 1. HERO ──────────────────────────────────────────────────────
            heroSection

            // ── 2. PRAYER LIST ───────────────────────────────────────────────
            VStack(spacing: 0) {
                ForEach(Array(fivePrayers.enumerated()), id: \.element.id) { idx, prayer in
                    let isHighlit = prayer.name == nextFiveForRow?.name
                    let isPast    = prayer.time < entry.date && !isHighlit

                    HStack(spacing: 0) {
                        Text(prayer.name)
                            .font(.system(size: 14, weight: isHighlit ? .semibold : .regular))
                            .foregroundColor(
                                isHighlit ? kGold :
                                isPast    ? .white.opacity(0.28) :
                                            .white.opacity(0.52)
                            )
                        Spacer()
                        Text(timeFmt.string(from: prayer.time))
                            .font(.system(size: 14, weight: isHighlit ? .semibold : .regular).monospacedDigit())
                            .foregroundColor(
                                isHighlit ? kGold :
                                isPast    ? .white.opacity(0.22) :
                                            .white.opacity(0.45)
                            )
                    }
                    .frame(height: 28)

                    if idx < fivePrayers.count - 1 {
                        Rectangle()
                            .fill(Color.white.opacity(0.08))
                            .frame(height: 0.5)
                            .padding(.horizontal, 2)
                    }
                }
            }

            Spacer(minLength: 8)

            // ── 3. FOOTER ────────────────────────────────────────────────────
            HStack(alignment: .center) {
                Text(entry.city)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(.white.opacity(0.55))
                    .lineLimit(1)
                Spacer()
                Text(largeDateFmt.string(from: entry.date))
                    .font(.system(size: 12, weight: .regular))
                    .foregroundColor(.white.opacity(0.45))
            }
        }
        .padding(EdgeInsets(top: 16, leading: 18, bottom: 14, trailing: 18))
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

// MARK: - Large Overview widget

struct LargeOverviewWidgetView: View {
    let entry: PrayerEntry

    private var fivePrayers: [Prayer] {
        entry.allPrayers.filter { kFivePrayers.contains($0.name) }
    }

    /// The currently active prayer: last one whose time has passed.
    private var currentFive: Prayer? {
        fivePrayers.last { $0.time <= entry.date }
    }

    private var halvaNattenTime: Date? {
        guard let maghrib = fivePrayers.first(where: { $0.name == "Maghrib" }),
              let fajr    = fivePrayers.first(where: { $0.name == "Fajr" })
        else { return nil }
        var fajrAdj = fajr.time
        if fajrAdj <= maghrib.time { fajrAdj = fajrAdj.addingTimeInterval(86_400) }
        return maghrib.time.addingTimeInterval(fajrAdj.timeIntervalSince(maghrib.time) / 2)
    }

    /// Supplementary context shown below the list — not a prayer row.
    private var secondary: (label: String, time: Date)? {
        let now = entry.date
        guard let fajr  = fivePrayers.first(where: { $0.name == "Fajr" }),
              let dhuhr = fivePrayers.first(where: { $0.name == "Dhuhr" }),
              let isha  = fivePrayers.first(where: { $0.name == "Isha" })
        else { return nil }
        if now >= fajr.time && now < dhuhr.time,
           let s = entry.allPrayers.first(where: { $0.name == "Shuruq" || $0.name == "Soluppgång" }) {
            return ("Shuruq", s.time)
        }
        if now >= isha.time, let h = halvaNattenTime {
            return ("Halva natten", h)
        }
        return nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {

            // ── 1. HEADER ────────────────────────────────────────────────────
            HStack(alignment: .center) {
                Text(entry.city)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(.white.opacity(0.55))
                    .lineLimit(1)
                Spacer()
                Text(largeDateFmt.string(from: entry.date))
                    .font(.system(size: 12, weight: .regular))
                    .foregroundColor(.white.opacity(0.45))
            }
            .padding(.bottom, 16)

            // ── 2. PRAYER LIST ───────────────────────────────────────────────
            VStack(spacing: 0) {
                ForEach(Array(fivePrayers.enumerated()), id: \.element.id) { idx, prayer in
                    let isCurrent = prayer.name == currentFive?.name
                    let isPast    = prayer.time < entry.date && !isCurrent

                    HStack(spacing: 0) {
                        Text(prayer.name)
                            .font(.system(size: 15, weight: isCurrent ? .semibold : .regular))
                            .foregroundColor(
                                isCurrent ? .white :
                                isPast    ? .white.opacity(0.28) :
                                            .white.opacity(0.52)
                            )
                        Spacer()
                        Text(timeFmt.string(from: prayer.time))
                            .font(.system(size: 15, weight: isCurrent ? .semibold : .regular).monospacedDigit())
                            .foregroundColor(
                                isCurrent ? .white :
                                isPast    ? .white.opacity(0.22) :
                                            .white.opacity(0.45)
                            )
                    }
                    .frame(height: 40)

                    if idx < fivePrayers.count - 1 {
                        Rectangle()
                            .fill(Color.white.opacity(0.08))
                            .frame(height: 0.5)
                            .padding(.horizontal, 2)
                    }
                }
            }

            Spacer(minLength: 8)

            // ── 3. SECONDARY (Shuruq or Halva natten — not a prayer row) ─────
            if let sec = secondary {
                Rectangle()
                    .fill(Color.white.opacity(0.08))
                    .frame(height: 0.5)
                    .padding(.bottom, 10)
                HStack {
                    Text(sec.label)
                    Spacer()
                    Text(timeFmt.string(from: sec.time))
                }
                .font(.system(size: 12, weight: .regular))
                .foregroundColor(.white.opacity(0.40))
            }
        }
        .padding(EdgeInsets(top: 16, leading: 18, bottom: 14, trailing: 18))
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

// MARK: - Widget definitions

/// Small – Focus Mode: countdown to next event (prayer, Shuruq, or Halva natten).
struct HidayahFocusWidget: Widget {
    let kind = "HidayahFocusWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: PrayerProvider()) { entry in
            SmallFocusWidgetView(entry: entry)
                .containerBackground(
                    LinearGradient(colors: [kBgTop, kBgBottom],
                                   startPoint: .topLeading,
                                   endPoint: .bottomTrailing),
                    for: .widget
                )
        }
        .configurationDisplayName("Nästa händelse")
        .description("Visar nästa bön eller händelse med nedräkning.")
        .supportedFamilies([.systemSmall])
    }
}

/// Small – Full List Mode: all five prayers with active highlight.
struct HidayahListWidget: Widget {
    let kind = "HidayahListWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: PrayerProvider()) { entry in
            SmallListWidgetView(entry: entry)
                .containerBackground(
                    LinearGradient(colors: [kBgTop, kBgBottom],
                                   startPoint: .topLeading,
                                   endPoint: .bottomTrailing),
                    for: .widget
                )
        }
        .configurationDisplayName("Alla bönetider")
        .description("Visar alla bönetider för dagen.")
        .supportedFamilies([.systemSmall])
    }
}

/// Medium: dynamic hero + prayer row.
struct HidayahWidget: Widget {
    let kind = "HidayahWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: PrayerProvider()) { entry in
            MediumWidgetView(entry: entry)
                .containerBackground(
                    LinearGradient(colors: [kBgTop, kBgBottom],
                                   startPoint: .topLeading,
                                   endPoint: .bottomTrailing),
                    for: .widget
                )
        }
        .configurationDisplayName("Bönetider")
        .description("Nästa händelse och alla bönetider i en rad.")
        .supportedFamilies([.systemMedium])
    }
}

/// Large – Focus Mode: dynamic hero + prayer list.
struct HidayahLargeWidget: Widget {
    let kind = "HidayahLargeWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: PrayerProvider()) { entry in
            LargeFocusWidgetView(entry: entry)
                .containerBackground(
                    LinearGradient(colors: [kBgTop, kBgBottom],
                                   startPoint: .topLeading,
                                   endPoint: .bottomTrailing),
                    for: .widget
                )
        }
        .configurationDisplayName("Bönetider – Fokus")
        .description("Nästa händelse med nedräkning och dagslista.")
        .supportedFamilies([.systemLarge])
    }
}

/// Large – Overview Mode: full daily prayer list with active highlight.
struct HidayahOverviewWidget: Widget {
    let kind = "HidayahOverviewWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: PrayerProvider()) { entry in
            LargeOverviewWidgetView(entry: entry)
                .containerBackground(
                    LinearGradient(colors: [kBgTop, kBgBottom],
                                   startPoint: .topLeading,
                                   endPoint: .bottomTrailing),
                    for: .widget
                )
        }
        .configurationDisplayName("Bönetider – Översikt")
        .description("Alla bönetider för dagen med aktiv bönetid markerad.")
        .supportedFamilies([.systemLarge])
    }
}

// MARK: - Lock Screen views & widget definitions (iOS 16+ only)

#if os(iOS)

struct LockScreenFocusView: View {
    let entry: PrayerEntry

    private var heroState: HeroState {
        computeHeroState(allPrayers: entry.allPrayers, now: entry.date)
    }

    @ViewBuilder
    private var heroSection: some View {
        switch heroState {
        case .prayer(let p):
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text("Nästa bön")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.secondary)
                Text("·")
                    .font(.system(size: 11, weight: .regular))
                    .foregroundStyle(.tertiary)
                Text(p.name)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.primary)
                Spacer()
                Text("Startar \(timeFmt.string(from: p.time))")
                    .font(.system(size: 11, weight: .regular).monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            Text(p.time, style: .timer)
                .font(.system(size: 28, weight: .bold).monospacedDigit())
                .foregroundStyle(.primary)
                .lineLimit(1)
                .minimumScaleFactor(0.85)
                .frame(maxWidth: .infinity, alignment: .leading)

        case .shuruq(let t):
            HStack(alignment: .firstTextBaseline, spacing: 0) {
                Text("Tid kvar till Shuruq")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.secondary)
                Spacer()
                Text("Startar \(timeFmt.string(from: t))")
                    .font(.system(size: 11, weight: .regular).monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            Text(t, style: .timer)
                .font(.system(size: 28, weight: .bold).monospacedDigit())
                .foregroundStyle(.primary)
                .lineLimit(1)
                .minimumScaleFactor(0.85)
                .frame(maxWidth: .infinity, alignment: .leading)

        case .halvaNatten(let t):
            HStack(alignment: .firstTextBaseline, spacing: 0) {
                Text("Tid kvar till halva natten")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.secondary)
                Spacer()
                Text("Startar \(timeFmt.string(from: t))")
                    .font(.system(size: 11, weight: .regular).monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            Text(t, style: .timer)
                .font(.system(size: 28, weight: .bold).monospacedDigit())
                .foregroundStyle(.primary)
                .lineLimit(1)
                .minimumScaleFactor(0.85)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            heroSection
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

// MARK: - Lock Screen Overview widget view

private let kAbbreviations: [String: String] = [
    "Fajr": "FJR", "Dhuhr": "DHR", "Asr": "ASR", "Maghrib": "MGR", "Isha": "ISH",
]

struct LockScreenOverviewView: View {
    let entry: PrayerEntry

    private var fivePrayers: [Prayer] {
        entry.allPrayers.filter { kFivePrayers.contains($0.name) }
    }

    private var nextPrayer: Prayer? {
        fivePrayers.first { $0.time > entry.date }
    }

    var body: some View {
        HStack(alignment: .center, spacing: 0) {
            ForEach(Array(fivePrayers.enumerated()), id: \.element.id) { idx, prayer in
                prayerColumn(prayer: prayer, showDivider: idx > 0)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder
    private func prayerColumn(prayer: Prayer, showDivider: Bool) -> some View {
        let isNext = prayer.name == nextPrayer?.name
        let abbr   = kAbbreviations[prayer.name] ?? prayer.name
        if showDivider {
            Rectangle()
                .fill(Color.primary.opacity(0.15))
                .frame(width: 1, height: 22)
        }
        VStack(alignment: .center, spacing: 2) {
            Text(abbr)
                .font(.system(size: 9, weight: isNext ? .bold : .medium))
                .foregroundStyle(.primary)
                .opacity(isNext ? 1.0 : 0.45)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Text(timeFmt.string(from: prayer.time))
                .font(.system(size: 11, weight: isNext ? .bold : .regular).monospacedDigit())
                .foregroundStyle(.primary)
                .opacity(isNext ? 1.0 : 0.55)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Lock Screen widget definitions

/// Lock Screen rectangular – Focus: countdown timer to next event.
struct HidayahLockFocusWidget: Widget {
    let kind = "HidayahLockFocusWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: PrayerProvider()) { entry in
            LockScreenFocusView(entry: entry)
                .containerBackground(for: .widget) { Color.clear }
        }
        .configurationDisplayName("Nästa händelse")
        .description("Nedräkning till nästa bön, Shuruq eller halva natten.")
        .supportedFamilies([.accessoryRectangular])
    }
}

/// Lock Screen rectangular – Overview: all five prayer times in one row.
struct HidayahLockOverviewWidget: Widget {
    let kind = "HidayahLockOverviewWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: PrayerProvider()) { entry in
            LockScreenOverviewView(entry: entry)
                .containerBackground(for: .widget) { Color.clear }
        }
        .configurationDisplayName("Alla bönetider")
        .description("Alla fem bönetider på låsskärmen.")
        .supportedFamilies([.accessoryRectangular])
    }
}

#endif // os(iOS) — closes block opened before LockScreenFocusView

// MARK: - Previews

#Preview(as: .systemSmall)           { HidayahFocusWidget()        } timeline: { PrayerEntry.placeholder() }
#Preview(as: .systemSmall)           { HidayahListWidget()          } timeline: { PrayerEntry.placeholder() }
#Preview(as: .systemMedium)          { HidayahWidget()              } timeline: { PrayerEntry.placeholder() }
#Preview(as: .systemLarge)           { HidayahLargeWidget()         } timeline: { PrayerEntry.placeholder() }
#Preview(as: .systemLarge)           { HidayahOverviewWidget()      } timeline: { PrayerEntry.placeholder() }
#if os(iOS)
#Preview(as: .accessoryRectangular)  { HidayahLockFocusWidget()     } timeline: { PrayerEntry.placeholder() }
#Preview(as: .accessoryRectangular)  { HidayahLockOverviewWidget()  } timeline: { PrayerEntry.placeholder() }
#endif
