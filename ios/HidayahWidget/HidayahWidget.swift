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
private let kAppGroup      = "group.com.anonymous.Hidayah"
private let kDataKey       = "andalus_widget_data"
private let kBgDetectedKey = "backgroundLocationDetectedAt"

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
    let timestamp: Double?   // Unix seconds — absent in older payloads; nil hides the timestamp label
}

// MARK: - Domain model

struct Prayer: Identifiable {
    var id: String { name }
    let name: String
    let time: Date
}

struct PrayerEntry: TimelineEntry {
    let date:          Date
    let current:       Prayer
    let next:          Prayer
    let allPrayers:    [Prayer]
    let city:          String
    let lastUpdatedAt: Date?   // when widget data was last written; nil hides the timestamp

    static func placeholder(at now: Date = .now) -> PrayerEntry {
        let offsets: [(String, Double)] = [
            ("Fajr",       -7*3600), ("Shuruq", -5*3600),
            ("Dhuhr",      -1*3600), ("Asr",         3*3600),
            ("Maghrib",     5*3600), ("Isha",         6*3600),
        ]
        let all = offsets.map { Prayer(name: $0.0, time: now.addingTimeInterval($0.1)) }
        return PrayerEntry(date: now, current: all[2], next: all[3],
                           allPrayers: all, city: "Stockholm", lastUpdatedAt: nil)
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

private func buildEntries(prayers: [Prayer], city: String, lastUpdatedAt: Date? = nil) -> [PrayerEntry] {
    let now = Date()
    var dates = Set<Date>()
    dates.insert(now)

    // Prayer transition points
    for prayer in prayers where prayer.time > now {
        dates.insert(prayer.time)
    }

    // Halva natten transition — needed so hero state switches when halvaNatten passes
    let five = prayers.filter { kFivePrayers.contains($0.name) }
    var halvaNattenTime: Date? = nil
    if let maghrib = five.first(where: { $0.name == "Maghrib" }),
       let fajr    = five.first(where: { $0.name == "Fajr" }) {
        var fajrAdj = fajr.time
        if fajrAdj <= maghrib.time { fajrAdj = fajrAdj.addingTimeInterval(86_400) }
        halvaNattenTime = maghrib.time.addingTimeInterval(fajrAdj.timeIntervalSince(maghrib.time) / 2)
        if let ht = halvaNattenTime, ht > now { dates.insert(ht) }
    }

    // Coarse near-prayer entries: every minute for last 5 minutes, then at 30/20/10 s
    let coarseOffsets: [TimeInterval] = [-300, -240, -180, -120, -60, -30, -20, -10]
    for prayer in prayers where prayer.time > now {
        for offset in coarseOffsets {
            let t = prayer.time.addingTimeInterval(offset)
            if t > now { dates.insert(t) }
        }
    }
    if let ht = halvaNattenTime, ht > now {
        for offset in coarseOffsets {
            let t = ht.addingTimeInterval(offset)
            if t > now { dates.insert(t) }
        }
    }

    // Per-second entries for the last 60 s before the next hero event only.
    // iOS lock screen renders Text(.timer) as "<1 minut" below 60 s — explicit
    // per-second entries let the view display a static "0:ss" string instead.
    let nextHeroTime: Date? = {
        switch computeHeroState(allPrayers: prayers, now: now) {
        case .prayer(let p):     return p.time
        case .shuruq(let t):     return t
        case .halvaNatten(let t): return t
        }
    }()
    if let net = nextHeroTime, net > now {
        for s in 1...60 {
            let t = net.addingTimeInterval(-Double(s))
            if t > now { dates.insert(t) }
        }
    }

    return dates.sorted().map { t in
        let (cur, nxt) = currentAndNext(prayers: prayers, at: t)
        return PrayerEntry(date: t, current: cur, next: nxt,
                           allPrayers: prayers, city: city, lastUpdatedAt: lastUpdatedAt)
    }
}

// MARK: - Provider

struct PrayerProvider: TimelineProvider {

    func placeholder(in context: Context) -> PrayerEntry { .placeholder() }

    func getSnapshot(in context: Context,
                     completion: @escaping (PrayerEntry) -> Void) {
        NSLog("[Widget] PrayerProvider.getSnapshot called")
        if let stored = readAppGroupData() {
            let prayers = parsePrayers(stored.prayers)
            if !prayers.isEmpty {
                let now = Date()
                let (cur, nxt) = currentAndNext(prayers: prayers, at: now)
                let lastUpdatedAt = stored.timestamp.map { Date(timeIntervalSince1970: $0) }
                NSLog("[Widget] getSnapshot: city=%@ ts=%.0f", stored.city, stored.timestamp ?? 0)
                completion(PrayerEntry(date: now, current: cur, next: nxt,
                                       allPrayers: prayers, city: stored.city,
                                       lastUpdatedAt: lastUpdatedAt))
                return
            }
        }
        NSLog("[Widget] getSnapshot: no valid data — placeholder")
        completion(.placeholder())
    }

    func getTimeline(in context: Context,
                     completion: @escaping (Timeline<PrayerEntry>) -> Void) {

        let midnight = Calendar.current.startOfDay(for: Date()).addingTimeInterval(86_400 + 60)

        let defaults        = UserDefaults(suiteName: kAppGroup)
        let locationChanged = defaults?.bool(forKey: "needsPrayerRefresh") ?? false
        NSLog("[Widget] PrayerProvider.getTimeline: locationChanged=%@", locationChanged ? "yes" : "no")

        // ── Path 1: App Groups has today's data AND either no location change
        //   OR native has ALREADY written fresh widget data for the new location ──
        //
        // When needsPrayerRefresh is true, native may have already resolved the new
        // city via the visited-places cache and written a complete, authoritative blob
        // (city + prayers + timestamp). We detect this by comparing the blob's timestamp
        // against backgroundLocationDetectedAt: if blob.timestamp > detectedAt, native
        // wrote AFTER the location event and the data is correct — use Path 1 so the
        // widget shows the right city AND "Uppdaterad kl HH:mm" immediately.
        // JS still sees needsPrayerRefresh=true and does a full refresh on next app open.
        if let stored = readAppGroupData() {
            let prayers = parsePrayers(stored.prayers)
            if !prayers.isEmpty {
                let bgDetectedAt = defaults?.double(forKey: kBgDetectedKey) ?? 0
                let blobTs       = stored.timestamp ?? 0
                // nativeFresh: native wrote the blob AFTER this location event fired.
                let nativeFresh  = locationChanged && blobTs > 0 && bgDetectedAt > 0 && blobTs > bgDetectedAt
                NSLog("[Widget] getTimeline stored: city=%@ blobTs=%.0f bgDetectedAt=%.0f nativeFresh=%@",
                      stored.city, blobTs, bgDetectedAt, nativeFresh ? "YES" : "NO")

                if !locationChanged || nativeFresh {
                    let lastUpdatedAt = stored.timestamp.map { Date(timeIntervalSince1970: $0) }
                    NSLog("[Widget] getTimeline PATH-1: city=%@ updatedAt=%.0f Asr=%@",
                          stored.city, blobTs,
                          stored.prayers.first(where: { $0.name == "Asr" })?.time ?? "?")
                    let entries = buildEntries(prayers: prayers, city: stored.city,
                                               lastUpdatedAt: lastUpdatedAt)
                    NSLog("[Widget] getTimeline PATH-1: %d entries policy=midnight", entries.count)
                    completion(Timeline(entries: entries, policy: .after(midnight)))
                    return
                }
            }
        }

        // ── Path 2: Stale / missing / location changed AND native hasn't resolved yet ──
        //
        // fetchFromAPI is in-memory only — does NOT write to App Group or UserDefaults.
        // Reached only when needsPrayerRefresh is true AND the blob's timestamp is not
        // newer than backgroundLocationDetectedAt (native hasn't written yet).
        // City comes from prayer_city (written by native in writeWidgetDataFromSource).
        // lastUpdatedAt is nil — hide "Uppdaterad" until native writes and Path 1 takes over.
        let (lat, lng, city) = readStoredLocation()
        NSLog("[Widget] getTimeline PATH-2: city=%@ lat=%.4f lng=%.4f", city, lat, lng)
        fetchFromAPI(lat: lat, lng: lng) { prayers in
            guard !prayers.isEmpty else {
                NSLog("[Widget] getTimeline PATH-2: API failed — retry in 15 min")
                let timeline = Timeline(entries: [PrayerEntry.placeholder()],
                                        policy: .after(Date().addingTimeInterval(900)))
                completion(timeline)
                return
            }
            let updatedAt: Date? = locationChanged ? nil : Date()
            // When locationChanged, use a short policy so WidgetKit MUST call
            // getTimeline again within 15 min for every widget kind — even kinds
            // that were throttled after reloadAllTimelines(). By that point,
            // native/JS will have resolved the new city and nativeFresh (Path 1)
            // will pick it up. Without this, throttled widgets stay on the stale
            // midnight-policy timeline until the next day.
            let policy: TimelineReloadPolicy = locationChanged
                ? .after(Date().addingTimeInterval(900))
                : .after(midnight)
            NSLog("[Widget] getTimeline PATH-2: fetched %d prayers city=%@ updatedAt=%@ policy=%@",
                  prayers.count, city, updatedAt != nil ? "set" : "nil",
                  locationChanged ? "15min" : "midnight")
            let entries = buildEntries(prayers: prayers, city: city, lastUpdatedAt: updatedAt)
            completion(Timeline(entries: entries, policy: policy))
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
            HStack(alignment: .center) {
                Text("\(entry.city) • \(mediumDateFmt.string(from: entry.date))")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundColor(.white.opacity(0.55))
                    .lineLimit(1)
                if let ts = entry.lastUpdatedAt {
                    Spacer(minLength: 4)
                    Text("Uppdaterad \(timeFmt.string(from: ts))")
                        .font(.system(size: 9, weight: .regular))
                        .foregroundColor(.white.opacity(0.28))
                        .lineLimit(1)
                }
            }
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
            Text(largeDateFmt.string(from: entry.date))
                .font(.system(size: 11, weight: .regular))
                .foregroundColor(.white.opacity(0.40))
                .frame(maxWidth: .infinity, alignment: .trailing)
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
            Text(largeDateFmt.string(from: entry.date))
                .font(.system(size: 11, weight: .regular))
                .foregroundColor(.white.opacity(0.40))
                .frame(maxWidth: .infinity, alignment: .trailing)
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

    /// Live countdown timer — updates every second on AOD without WidgetKit entries.
    /// Text(.timer) renders correctly on both regular lock screen and Always On Display.
    @ViewBuilder
    private func lockCountdown(to target: Date) -> some View {
        Text(target, style: .timer)
            .font(.system(size: 22, weight: .bold).monospacedDigit())
            .foregroundStyle(.primary)
            .lineLimit(1)
            .minimumScaleFactor(0.75)
            .frame(maxWidth: .infinity, alignment: .leading)
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
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            lockCountdown(to: p.time)
            Text("Går in \(timeFmt.string(from: p.time))")
                .font(.system(size: 12, weight: .medium).monospacedDigit())
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)

        case .shuruq(let t):
            Text("Tid kvar till Shuruq")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                .frame(maxWidth: .infinity, alignment: .leading)
            lockCountdown(to: t)
            Text("Går in \(timeFmt.string(from: t))")
                .font(.system(size: 12, weight: .medium).monospacedDigit())
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)

        case .halvaNatten(let t):
            Text("Tid kvar till halva natten")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.70)
                .frame(maxWidth: .infinity, alignment: .leading)
            lockCountdown(to: t)
            Text("Går in \(timeFmt.string(from: t))")
                .font(.system(size: 12, weight: .medium).monospacedDigit())
                .foregroundStyle(.secondary)
                .lineLimit(1)
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

// MARK: - Lock Screen Arc widget — prayer timeline visualization

/// Compact countdown: "1t, 4m" / "59m" / "50s" / "0s"
private func compactCountdown(from now: Date, to target: Date) -> String {
    let secs = max(0, Int(target.timeIntervalSince(now).rounded()))
    if secs < 60 { return "\(secs)s" }
    let totalMins = secs / 60
    if totalMins < 60 { return "\(totalMins)m" }
    return "\(totalMins / 60)t, \(totalMins % 60)m"
}

/// Builds a minute-level + final-60-second timeline for the arc widget.
/// Generates minute-level entries from now until the next five prayer,
/// per-second entries for the final 60 seconds, then transition-only entries
/// for the remaining prayers. This keeps countdown text accurate to ≤1 minute
/// even when the device is sleeping.
private func buildLockArcEntries(prayers: [Prayer],
                                  city: String,
                                  lastUpdatedAt: Date? = nil) -> [PrayerEntry] {
    let now  = Date()
    let five = prayers.filter { kFivePrayers.contains($0.name) }
    var dates = Set<Date>()
    dates.insert(now)

    let nextFive = five.first { $0.time > now }

    if let next = nextFive {
        // Minute-level entries: one entry per minute from now until the next prayer.
        // WidgetKit picks the latest entry whose .date ≤ current clock time, so each
        // entry renders the exact remaining minutes at that snapshot.
        var cursor = now.addingTimeInterval(60)
        while cursor < next.time {
            dates.insert(cursor)
            cursor = cursor.addingTimeInterval(60)
        }
        // Per-second entries for the final 60 s so "50s", "49s"… display correctly.
        for s in 1...60 {
            let candidate = next.time.addingTimeInterval(-Double(s))
            if candidate > now { dates.insert(candidate) }
        }
        // Transition entry exactly at the prayer time.
        dates.insert(next.time)
    }

    // Transition-only entries for all remaining prayers beyond nextFive.
    // After nextFive fires, WidgetKit will request a fresh timeline, which
    // will in turn generate new minute-level entries for the following prayer.
    for prayer in five where prayer.time > (nextFive?.time ?? now) {
        dates.insert(prayer.time)
    }

    return dates.sorted().map { t in
        let (cur, nxt) = currentAndNext(prayers: prayers, at: t)
        return PrayerEntry(date: t, current: cur, next: nxt,
                           allPrayers: prayers, city: city, lastUpdatedAt: lastUpdatedAt)
    }
}

struct LockArcProvider: TimelineProvider {

    func placeholder(in context: Context) -> PrayerEntry { .placeholder() }

    func getSnapshot(in context: Context,
                     completion: @escaping (PrayerEntry) -> Void) {
        NSLog("[Widget] LockArcProvider.getSnapshot called")
        if let stored = readAppGroupData() {
            let prayers = parsePrayers(stored.prayers)
            if !prayers.isEmpty {
                let now = Date()
                let (cur, nxt) = currentAndNext(prayers: prayers, at: now)
                let lastUpdatedAt = stored.timestamp.map { Date(timeIntervalSince1970: $0) }
                NSLog("[Widget] LockArc getSnapshot: city=%@ ts=%.0f", stored.city, stored.timestamp ?? 0)
                completion(PrayerEntry(date: now, current: cur, next: nxt,
                                       allPrayers: prayers, city: stored.city,
                                       lastUpdatedAt: lastUpdatedAt))
                return
            }
        }
        NSLog("[Widget] LockArc getSnapshot: no valid data — placeholder")
        completion(.placeholder())
    }

    func getTimeline(in context: Context,
                     completion: @escaping (Timeline<PrayerEntry>) -> Void) {
        let midnight        = Calendar.current.startOfDay(for: Date()).addingTimeInterval(86_400 + 60)
        let defaults        = UserDefaults(suiteName: kAppGroup)
        let locationChanged = defaults?.bool(forKey: "needsPrayerRefresh") ?? false
        NSLog("[Widget] LockArcProvider.getTimeline: locationChanged=%@", locationChanged ? "yes" : "no")

        // Same Path-1/Path-2 logic as PrayerProvider: use the stored blob whenever
        // native has already written fresh data for the new location (blob.timestamp >
        // backgroundLocationDetectedAt), so the widget shows the correct city and
        // "Uppdaterad kl HH:mm" immediately after a background location event.
        if let stored = readAppGroupData() {
            let prayers = parsePrayers(stored.prayers)
            if !prayers.isEmpty {
                let bgDetectedAt = defaults?.double(forKey: kBgDetectedKey) ?? 0
                let blobTs       = stored.timestamp ?? 0
                let nativeFresh  = locationChanged && blobTs > 0 && bgDetectedAt > 0 && blobTs > bgDetectedAt
                NSLog("[Widget] LockArc getTimeline stored: city=%@ blobTs=%.0f bgDetectedAt=%.0f nativeFresh=%@",
                      stored.city, blobTs, bgDetectedAt, nativeFresh ? "YES" : "NO")

                if !locationChanged || nativeFresh {
                    let lastUpdatedAt = stored.timestamp.map { Date(timeIntervalSince1970: $0) }
                    NSLog("[Widget] LockArc getTimeline PATH-1: city=%@ updatedAt=%.0f", stored.city, blobTs)
                    let entries = buildLockArcEntries(prayers: prayers, city: stored.city,
                                                      lastUpdatedAt: lastUpdatedAt)
                    NSLog("[Widget] LockArc getTimeline PATH-1: %d entries policy=midnight", entries.count)
                    completion(Timeline(entries: entries, policy: .after(midnight)))
                    return
                }
            }
        }

        let (lat, lng, city) = readStoredLocation()
        NSLog("[Widget] LockArc getTimeline PATH-2: city=%@ lat=%.4f lng=%.4f", city, lat, lng)
        fetchFromAPI(lat: lat, lng: lng) { prayers in
            guard !prayers.isEmpty else {
                NSLog("[Widget] LockArc getTimeline PATH-2: API failed — retry in 15 min")
                let timeline = Timeline(entries: [PrayerEntry.placeholder()],
                                        policy: .after(Date().addingTimeInterval(900)))
                completion(timeline)
                return
            }
            let updatedAt: Date? = locationChanged ? nil : Date()
            let policy: TimelineReloadPolicy = locationChanged
                ? .after(Date().addingTimeInterval(900))
                : .after(midnight)
            NSLog("[Widget] LockArc getTimeline PATH-2: fetched %d prayers city=%@ updatedAt=%@ policy=%@",
                  prayers.count, city, updatedAt != nil ? "set" : "nil",
                  locationChanged ? "15min" : "midnight")
            let entries = buildLockArcEntries(prayers: prayers, city: city,
                                              lastUpdatedAt: updatedAt)
            completion(Timeline(entries: entries, policy: policy))
        }
    }
}

private let kPrayerSymbols: [String: String] = [
    "Fajr":    "sunrise.fill",
    "Dhuhr":   "sun.max.fill",
    "Asr":     "cloud.sun.fill",
    "Maghrib": "sunset.fill",
    "Isha":    "moon.stars.fill",
]

struct PrayerArcLockScreenView: View {
    let entry: PrayerEntry

    private var fivePrayers: [Prayer] {
        entry.allPrayers.filter { kFivePrayers.contains($0.name) }
    }

    /// The most recent five-prayer whose time has already passed.
    private var currentFive: Prayer? {
        fivePrayers.last { $0.time <= entry.date }
    }

    /// The next upcoming five-prayer.
    private var nextFive: Prayer? {
        fivePrayers.first { $0.time > entry.date }
    }

    /// Index of the node that should be filled (= index of the next prayer, or last).
    private var activeNodeIndex: Int {
        fivePrayers.firstIndex { $0.time > entry.date } ?? (fivePrayers.count - 1)
    }

    private var countdownText: String {
        guard let next = nextFive else {
            return fivePrayers.last.map { timeFmt.string(from: $0.time) } ?? "--"
        }
        return compactCountdown(from: entry.date, to: next.time)
    }

    var body: some View {
        if fivePrayers.isEmpty {
            Text("--")
                .font(.system(size: 12))
                .foregroundStyle(.primary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            VStack(alignment: .center, spacing: 4) {
                arcCanvas
                    .frame(maxWidth: .infinity)
                    .layoutPriority(1)
                textRow
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    // MARK: Arc canvas

    private let tVals: [CGFloat] = [0.0, 0.25, 0.5, 0.75, 1.0]

    private var arcCanvas: some View {
        ZStack {
            // Arc line + filled circle behind active icon.
            Canvas { ctx, size in
                let active   = activeNodeIndex
                let yBase    = size.height * 0.86
                let yControl = size.height * 0.04
                let xPad     = size.width  * 0.03
                let p0       = CGPoint(x: xPad,              y: yBase)
                let p1       = CGPoint(x: size.width - xPad, y: yBase)
                let control  = CGPoint(x: size.width * 0.5,  y: yControl)

                var arcPath = Path()
                arcPath.move(to: p0)
                arcPath.addQuadCurve(to: p1, control: control)
                var arcCtx = ctx
                arcCtx.opacity = 0.35
                arcCtx.stroke(arcPath, with: .foreground,
                              style: StrokeStyle(lineWidth: 1.2, lineCap: .round))

                // Filled disc behind the active prayer icon.
                if active < tVals.count {
                    let pt = bezierPoint(t: tVals[active], p0: p0, control: control, p1: p1)
                    let r: CGFloat = 8
                    ctx.fill(Path(ellipseIn: CGRect(x: pt.x - r, y: pt.y - r,
                                                    width: r * 2, height: r * 2)),
                             with: .foreground)
                }
            }

            // SF Symbol icons positioned along the bezier curve.
            // GeometryReader gives real pixel size so icon positions match the arc exactly.
            // .primary foreground adapts automatically to both lit lock screen and AOD.
            GeometryReader { geo in
                let size     = geo.size
                let yBase    = size.height * 0.86
                let yControl = size.height * 0.04
                let xPad     = size.width  * 0.03
                let p0       = CGPoint(x: xPad,              y: yBase)
                let p1       = CGPoint(x: size.width - xPad, y: yBase)
                let control  = CGPoint(x: size.width * 0.5,  y: yControl)

                ForEach(Array(fivePrayers.prefix(5).enumerated()), id: \.element.id) { i, prayer in
                    let pt       = bezierPoint(t: tVals[i], p0: p0, control: control, p1: p1)
                    let isActive = i == activeNodeIndex
                    let isPast   = i < activeNodeIndex
                    let symbol   = kPrayerSymbols[prayer.name] ?? "circle.fill"

                    Image(symbol)
                        .renderingMode(.template)
                        .resizable()
                        .scaledToFit()
                        .frame(width: isActive ? 13 : 10, height: isActive ? 13 : 10)
                        .foregroundStyle(.primary)
                        .opacity(isActive ? 1.0 : (isPast ? 0.22 : 0.50))
                        .position(pt)
                }
            }
        }
    }

    // MARK: Text row

    private var textRow: some View {
        HStack(alignment: .center, spacing: 0) {
            // Previous / current prayer name (left)
            Text(currentFive?.name ?? "")
                .font(.system(size: 10, weight: .regular))
                .foregroundStyle(.primary)
                .opacity(0.55)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .frame(maxWidth: .infinity, alignment: .leading)

            // Compact countdown (center) — use .timer for <60 s so AOD updates live.
            Group {
                if let next = nextFive,
                   next.time.timeIntervalSince(entry.date) < 60 {
                    Text(next.time, style: .timer)
                } else {
                    Text(countdownText)
                }
            }
            .font(.system(size: 12, weight: .semibold).monospacedDigit())
            .foregroundStyle(.primary)
            .lineLimit(1)
            .fixedSize(horizontal: true, vertical: false)

            // Next prayer name (right)
            Text(nextFive?.name ?? (fivePrayers.last?.name ?? ""))
                .font(.system(size: 10, weight: .regular))
                .foregroundStyle(.primary)
                .opacity(0.55)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
    }

    // MARK: Helpers

    private func bezierPoint(t: CGFloat,
                              p0: CGPoint,
                              control: CGPoint,
                              p1: CGPoint) -> CGPoint {
        let u = 1 - t
        return CGPoint(
            x: u*u*p0.x + 2*u*t*control.x + t*t*p1.x,
            y: u*u*p0.y + 2*u*t*control.y + t*t*p1.y
        )
    }
}

/// Lock Screen rectangular — Prayer timeline arc with compact countdown.
struct HidayahLockArcWidget: Widget {
    let kind = "HidayahLockArcWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: LockArcProvider()) { entry in
            PrayerArcLockScreenView(entry: entry)
                .containerBackground(for: .widget) { Color.clear }
        }
        .configurationDisplayName("Bönebåge")
        .description("Visar bönetiderna som en tidslinje med nedräkning.")
        .supportedFamilies([.accessoryRectangular])
    }
}

#endif // os(iOS) — closes block opened before LockScreenFocusView

// ═══════════════════════════════════════════════════════════════════════════════
// MARK: - Daily Content Widgets  (Allahs namn · Dagens Koranvers)
// ═══════════════════════════════════════════════════════════════════════════════

// MARK: - App Group reader for daily content

private let kDailyContentKey = "hidayah_daily_content_cache"

private struct DailyCache: Decodable {
    struct AllahNameData: Decodable {
        let nameNr: Int?
        let arabic: String; let transliteration: String
        let swedish: String; let explanation: String
    }
    struct VerseData: Decodable {
        let swedish: String; let surahName: String
        let surahNumber: Int; let ayahNumber: Int; let reference: String
    }
    struct HadithData: Decodable {
        let hadith_nr: Int?
        let arabic: String; let swedish: String; let source: String
    }
    let date: String; let allahName: AllahNameData; let quranVerse: VerseData
    let hadith: HadithData?
}

/// Returns today's cached daily content, or nil if the cache is missing or stale.
private func readDailyCache() -> DailyCache? {
    guard let d = UserDefaults(suiteName: kAppGroup)?.data(forKey: kDailyContentKey),
          let c = try? JSONDecoder().decode(DailyCache.self, from: d),
          c.date == localISODate(.now) else { return nil }
    return c
}

/// Next midnight + 1 minute — the daily refresh boundary for both widgets.
private func dailyMidnight() -> Date {
    Calendar.current.startOfDay(for: .now).addingTimeInterval(86_400 + 60)
}

/// Deterministic index into an array of `count` entries for today,
/// anchored at the given UTC date (same formula as JS rotation services).
private func epochDayIndex(year: Int, month: Int, day: Int, count: Int) -> Int {
    var dc = DateComponents()
    dc.year = year; dc.month = month; dc.day = day; dc.timeZone = TimeZone(identifier: "UTC")
    let epoch = Calendar(identifier: .gregorian).date(from: dc)!
    let cal   = Calendar(identifier: .gregorian)
    let days  = cal.dateComponents([.day], from: cal.startOfDay(for: epoch),
                                    to: cal.startOfDay(for: .now)).day ?? 0
    return ((days % count) + count) % count
}

// MARK: - Allah Name Entry, Provider & Views

struct AllahNameEntry: TimelineEntry {
    let date: Date
    let arabic: String; let transliteration: String
    let swedish: String; let explanation: String
    let nameNr: Int

    static let placeholder = AllahNameEntry(
        date: .now, arabic: "ٱلرَّحْمَـٰنُ",
        transliteration: "ar-Raḥmān", swedish: "Den Nåderike",
        explanation: "Allah är barmhärtig mot alla sina skapelser och skänker dem det de behöver.",
        nameNr: 1
    )
}

struct AllahNameProvider: TimelineProvider {
    func placeholder(in context: Context) -> AllahNameEntry { .placeholder }

    func getSnapshot(in context: Context, completion: @escaping (AllahNameEntry) -> Void) {
        completion(buildAllahEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<AllahNameEntry>) -> Void) {
        completion(Timeline(entries: [buildAllahEntry()], policy: .after(dailyMidnight())))
    }

    private func buildAllahEntry() -> AllahNameEntry {
        // Prefer App Group cache (written by JS on app open with exact asmaul_husna.json text)
        let idx = epochDayIndex(year: 2025, month: 1, day: 1, count: kAllahNames.count)
        if let c = readDailyCache() {
            return AllahNameEntry(date: .now,
                                  arabic: c.allahName.arabic, transliteration: c.allahName.transliteration,
                                  swedish: c.allahName.swedish, explanation: c.allahName.explanation,
                                  nameNr: c.allahName.nameNr ?? (idx + 1))
        }
        // Fallback: embedded data — same epoch 2025-01-01 as notifications.ts
        let n = kAllahNames[idx]
        return AllahNameEntry(date: .now,
                              arabic: n.arabic, transliteration: n.transliteration,
                              swedish: n.swedish, explanation: n.explanation,
                              nameNr: idx + 1)
    }
}

private struct AllahNameSmall: View {
    let entry: AllahNameEntry
    var body: some View {
        VStack(alignment: .center, spacing: 0) {
            Text(entry.arabic)
                .font(Font.custom("Amiri-Regular", size: 38))
                .foregroundColor(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.55)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity, alignment: .center)
            Text(entry.transliteration)
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(kGold)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .multilineTextAlignment(.center)
                .padding(.top, 7)
            Text(entry.swedish)
                .font(.system(size: 12, weight: .regular))
                .foregroundColor(.white.opacity(0.70))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .multilineTextAlignment(.center)
                .padding(.top, 3)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
    }
}

private struct AllahNameMedium: View {
    let entry: AllahNameEntry
    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 0) {
                Text("Allahs namn")
                    .font(.system(size: 10, weight: .semibold)).foregroundColor(kGold)
                VStack(alignment: .leading, spacing: 3) {
                    Text(entry.swedish)
                        .font(.system(size: 19, weight: .bold)).foregroundColor(.white)
                        .lineLimit(1).minimumScaleFactor(0.80)
                    Text(entry.transliteration)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(kGold.opacity(0.85)).lineLimit(1)
                }
                .padding(.top, 7)
                Spacer(minLength: 6)
                Text(entry.explanation)
                    .font(.system(size: 11, weight: .regular))
                    .foregroundColor(.white.opacity(0.55))
                    .lineLimit(3).fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            Text(entry.arabic)
                .font(Font.custom("Amiri-Regular", size: 56)).foregroundColor(.white)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.70)
                .frame(minWidth: 105, maxWidth: 105, maxHeight: .infinity)
        }
        .padding(EdgeInsets(top: 14, leading: 14, bottom: 12, trailing: 14))
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct AllahNameWidgetView: View {
    let entry: AllahNameEntry
    @Environment(\.widgetFamily) private var family
    var body: some View {
        switch family {
        case .systemSmall: AllahNameSmall(entry: entry)
        default:           AllahNameMedium(entry: entry)
        }
    }
}

struct HidayahAllahNameWidget: Widget {
    let kind = "HidayahAllahNameWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: AllahNameProvider()) { entry in
            AllahNameWidgetView(entry: entry)
                .containerBackground(
                    LinearGradient(colors: [kBgTop, kBgBottom],
                                   startPoint: .topLeading, endPoint: .bottomTrailing),
                    for: .widget)
                .widgetURL(URL(string: "hidayah://asmaul?nameNr=\(entry.nameNr)"))
        }
        .configurationDisplayName("Allahs namn")
        .description("Lär dig ett av Allahs 99 namn varje dag.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

// MARK: - Quran Verse Entry, Provider & Views

struct QuranVerseEntry: TimelineEntry {
    let date: Date
    let swedish: String; let surahName: String
    let surahNumber: Int; let ayahNumber: Int; let reference: String

    static let placeholder = QuranVerseEntry(
        date: .now,
        swedish: "Allah - det finns ingen [sann] gud utom honom, den Levande, den evige Vidmakthållaren.",
        surahName: "Al-Baqarah", surahNumber: 2, ayahNumber: 255, reference: "2:255"
    )
}

struct QuranVerseProvider: TimelineProvider {
    func placeholder(in context: Context) -> QuranVerseEntry { .placeholder }

    func getSnapshot(in context: Context, completion: @escaping (QuranVerseEntry) -> Void) {
        completion(buildVerseEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<QuranVerseEntry>) -> Void) {
        completion(Timeline(entries: [buildVerseEntry()], policy: .after(dailyMidnight())))
    }

    private func buildVerseEntry() -> QuranVerseEntry {
        // Prefer App Group cache (written by JS with exact Bernström translation)
        if let c = readDailyCache() {
            return QuranVerseEntry(date: .now, swedish: c.quranVerse.swedish,
                                   surahName: c.quranVerse.surahName,
                                   surahNumber: c.quranVerse.surahNumber,
                                   ayahNumber: c.quranVerse.ayahNumber,
                                   reference: c.quranVerse.reference)
        }
        // Fallback: curated verses, epoch 2024-01-01 matching JS dailyReminder.ts
        let v = kFallbackVerses[epochDayIndex(year: 2024, month: 1, day: 1, count: kFallbackVerses.count)]
        return QuranVerseEntry(date: .now, swedish: v.swedish, surahName: v.surahName,
                               surahNumber: v.surahNumber, ayahNumber: v.ayahNumber,
                               reference: v.reference)
    }
}

private struct DailyVerseSmall: View {
    let entry: QuranVerseEntry
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Dagens vers")
                .font(.system(size: 10, weight: .semibold))
                .foregroundColor(kGold).lineLimit(1)
            Spacer(minLength: 6)
            Text(entry.swedish)
                .font(.system(size: 11, weight: .regular))
                .foregroundColor(.white.opacity(0.85))
                .lineLimit(5).minimumScaleFactor(0.85)
            Spacer(minLength: 4)
            Text(entry.reference)
                .font(.system(size: 10, weight: .semibold))
                .foregroundColor(kGold.opacity(0.80)).lineLimit(1)
        }
        .padding(14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

private struct DailyVerseMedium: View {
    let entry: QuranVerseEntry
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Dagens Koranvers")
                .font(.system(size: 10, weight: .semibold)).foregroundColor(kGold)
            Spacer(minLength: 8)
            Text(entry.swedish)
                .font(.system(size: 12, weight: .regular))
                .foregroundColor(.white.opacity(0.85))
                .lineLimit(4).minimumScaleFactor(0.85)
            Spacer(minLength: 6)
            HStack(alignment: .center) {
                Text(entry.surahName)
                    .font(.system(size: 10, weight: .regular))
                    .foregroundColor(.white.opacity(0.38)).lineLimit(1)
                Spacer()
                Text(entry.reference)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundColor(kGold.opacity(0.80)).lineLimit(1)
            }
        }
        .padding(EdgeInsets(top: 14, leading: 14, bottom: 12, trailing: 14))
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

private struct DailyVerseWidgetView: View {
    let entry: QuranVerseEntry
    @Environment(\.widgetFamily) private var family
    var body: some View {
        switch family {
        case .systemSmall: DailyVerseSmall(entry: entry)
        default:           DailyVerseMedium(entry: entry)
        }
    }
}

struct HidayahDailyVerseWidget: Widget {
    let kind = "HidayahDailyVerseWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: QuranVerseProvider()) { entry in
            DailyVerseWidgetView(entry: entry)
                .containerBackground(
                    LinearGradient(colors: [kBgTop, kBgBottom],
                                   startPoint: .topLeading, endPoint: .bottomTrailing),
                    for: .widget)
                .widgetURL(URL(string: "hidayah://quran?verseKey=\(entry.surahNumber):\(entry.ayahNumber)"))
        }
        .configurationDisplayName("Dagens Koranvers")
        .description("Läs en ny Koranvers varje dag.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

// MARK: - Embedded Allah Names (99 entries)
// Source: asmaul_husna.json — same epoch 2025-01-01 UTC as notification service.
// Used as offline fallback before first app open writes the App Group cache.

private let kAllahNames: [(arabic: String, transliteration: String, swedish: String, explanation: String)] = [
    ("اللَّهُ", "Allah", "Allah", "Detta är ett av Allahs unika namn som betecknar hans heliga väsen och omfattar alla hans andra vackra och fullkomliga namn och egenskaper. Han är den ende sanne guden, den som dyrkas och som förtjänar att dyrkas av hela skapelsen på grund av sina gudomliga egenskaper."),
    ("الرَّبُّ", "ar-Rabb", "Herren", "Den som tar hand om och upprätthåller allt och alla. Ar-Rabb tar hand om sina tjänare – det vill säga alla människor och allt annat som Allah har skapat. Han styr allt som sker i världen, både stort och smått. Han ger oss allt vi behöver, både materiellt som mat och husrum, och immateriellt som kärlek och glädje. Han är Skaparen av allt som finns. Han skapade himlen, jorden och allt liv på dem. Han är den sanne Ägaren av allt och har fullständig kontroll över allting."),
    ("ٱلواحِدُ", "al-Wāḥid", "Den Ende", "Allah är unik. Han har ingen partner eller jämlike. Ingen kan jämföras med honom. Han är unik i sitt väsen, i sina egenskaper och i sina handlingar."),
    ("ٱلْأَحَدُ", "al-Aḥad", "Den Ende, den Unike", "Allah är fullkomligt unik. Han har ingen partner, jämlike eller motsvarighet. Ingen kan jämföras med honom. Han är enastående i sitt väsen, sina egenskaper och sina handlingar."),
    ("ٱلرَّحْمَـٰنُ", "ar-Raḥmān", "Den Nåderike", "Allah är barmhärtig mot alla sina skapelser. Han skapade dem och försåg dem med allt de behöver för att leva. Han skänker dem mat, vatten, luft och allt annat som krävs för deras överlevnad."),
    ("الرَّحِيمُ", "ar-Raḥīm", "Den Barmhärtige", "Allah är nådig mot sina troende tjänare. Han vägleder dem till tron och skänker dem evig belöning i paradiset."),
    ("الحَيُ", "al-Ḥayy", "Den Levande", "Han är den vars liv är absolut beständigt. Hans existens har varken början eller slut och påverkas inte av någon brist. Han lever ett fullkomligt liv, präglat av perfekta egenskaper. Namnet al-Ḥayy är ett bevis för att endast han är värd att dyrkas."),
    ("القَيُّومُ", "al-Qayyūm", "Den Självbestående, den evige Vidmakthållaren", "Allah är den absolut oberoende. Han behöver varken något eller någon för att existera. Han är den som skapar, styr och upprätthåller allt i universum. Han förser oss med allt vi behöver för att leva, och vi är i allt helt beroende av honom."),
    ("ٱلأَوَّلُ", "al-Awwal", "Den Förste", "Allah fanns innan allt annat. Han har alltid funnits och kommer alltid att finnas. Han har ingen början och inget slut. Han är den Evige."),
    ("ٱلْآخِرُ", "al-Akhir", "Den Siste", "Detta namn hör samman med al-Awwal. Tillsammans uttrycker de att Allah fanns före allt annat och att han består efter allt. Han har ingen början och inget slut. Han är den Evige."),
    ("ٱلظَّاهِرُ", "adh-Dhāhir", "Den Uppenbare, den Högste", "Allah är den som är över sin skapelse, upphöjd och överlägsen allt. Han är den Uppenbare som ingen kan undgå och den Högste som inget är över."),
    ("ٱلْبَاطِنُ", "al-Bāṭin", "Den Närmste", "Han är den Närmste som känner till allt. Han är nära sina tjänare och vakar ständigt över dem."),
    ("ٱلْوَارِثُ", "al-Wārith", "Den Bestående", "Allah är den som består när allt annat har upphört. När skapelsen slutar existera är det endast han som förblir."),
    ("الْقُدُّوسُ", "al-Quddūs", "Den Helige", "Allah är fullkomlig och fri från alla brister. Han är upphöjd över allt som inte är värdigt honom och bortom allt som människor kan föreställa sig."),
    ("السُّبُّوحُ", "as-Subbūḥ", "Den som är helt fri från brister, den Ärade", "Allah är fri från alla brister och allt som inte är värdigt honom. Han är fullkomlig och perfekt. Han behöver varken sova eller äta, och han har ingen familj."),
    ("السَّلاَمُ", "as-Salām", "Den Felfrie, den som skänker frid", "Namnet as-Salām betyder att Allah är fullkomlig och fri från alla brister. Han är perfekt i allt han gör och begår aldrig orättvisa. Han skänker sina tjänare frid och trygghet, både i denna värld och i nästa."),
    ("الْمُؤْمِنُ", "al-Mu'min", "Den som bekräftar sanningen, den som skänker trygghet", "Allah bekräftade sina budbärares sanning och vittnar om sig själv som den ende sanne Guden. Han uppfyller sitt löfte och skänker de troende säkerhet och frid."),
    ("الْحَقُ", "al-Ḥaqq", "Den absoluta Sanningen", "Allah är den som är sann i sin essens och i sin existens. Hans religion är sann, hans löften är sanna, och mötet med honom är sanning."),
    ("الْمُتَكَبِّرُ", "al-Mutakabbir", "Den Upphöjde, den som besitter all storhet", "Han är unik i sin storhet och makt. Allt är under hans kontroll. Hans storhet är ett majestät som endast tillkommer honom och som inte liknar arrogans."),
    ("الْعَظِيمُ", "al-ʿAdhīm", "Den Väldige", "Allah är den som besitter väldighet i sitt väsen och i sina egenskaper. Hans väsen är större än någon annans."),
    ("الْكَبِيرُ", "al-Kabīr", "Den Store", "Han är större än allt, och all vördnad tillkommer honom."),
    ("الْعَلِيُّ", "al-ʿAliyy", "Den Höge", "Allah är högt ovan sin skapelse och besitter all makt. Han är upphöjd i sitt väsen och i sina egenskaper, i sin status och i sin överlägsenhet."),
    ("الأَعْلَى", "al-Aʿlā", "Den Högste", "Allah är högt ovan sin skapelse och besitter all makt. Han är upphöjd i sin ställning och i sin överlägsenhet."),
    ("اللَّطِيفُ", "al-Laṭīf", "Den Välvillige", "Allah är den som är god mot sina tjänare och vägleder dem till godhet på sätt de inte fullt ut kan uppfatta. Hans välvilja når de av hans tjänare som han vill, som en särskild barmhärtighet."),
    ("الحَكِيمُ", "al-Ḥakīm", "Den Allvise", "Han är den som har skapat allt på det mest visa och fullkomliga sättet. Allt i hans skapelse har sin rätta plats och sitt bestämda ändamål."),
    ("ٱلْوَاسِعُ", "al-Wāsiʿ", "Den Allomfattande", "Han är den som har all kunskap och vars egenskaper är oändliga. Hans makt, herravälde, godhet och generositet är utan gräns."),
    ("ٱلْعَلِيمُ", "al-ʿAlīm", "Den Allvetande", "Han vet allt som har hänt och allt som kommer att hända. Han behöver aldrig bli informerad om något, för hans kunskap omfattar allt."),
    ("الْمَلِكُ", "al-Malik", "Konungen", "Allah har full kontroll över allt. Han gör vad han vill och ingen kan hindra honom. Hans befallningar genomförs alltid i hans rike."),
    ("ٱلْحَمِيدُ", "al-Ḥamīd", "Den Prisvärde", "All lov och pris tillkommer honom. Han är den som förtjänar beröm för sitt väsen, sina namn och egenskaper, och för alla sina handlingar."),
    ("ٱلْمَجِيدُ", "al-Majīd", "Den Ärofulle", "Allahs egenskaper är fyllda av ära och hans handlingar är goda och ärofulla. Han är Konungen, den ende som är fullkomlig och större än allt annat."),
    ("الْخَبِيرُ", "al-Khabīr", "Den Underkunnige", "Den som har full kännedom om allt. Han har fullständig kunskap om det fördolda och insikt om alla ting – till och med myrans fotspår i nattens mörker."),
    ("الْقَوِيُ", "al-Qawiyy", "Den Starke", "Han är den som äger all styrka. Ingens makt kan försvaga honom, och han kan aldrig bli maktlös. All styrka tillhör honom."),
    ("ٱلْمَتِينُ", "al-Matīn", "Den orubbligt Starke", "Han är den Starke som aldrig tröttas ut av det han gör. Hans styrka är fast, uthållig och oöverträffad."),
    ("الْعَزِيزُ", "al-ʿAzīz", "Den Mäktige, den Oövervinnlige", "Han är den som råder och som ensam har all makt och majestät. Alla starka är underkastade hans makt."),
    ("القَاهِرُ", "al-Qāhir", "Den Oemotstånglige", "Han utövar sin absoluta makt över alla sina tjänare, och ingen kan avvärja hans beslut."),
    ("الْقَهَّارُ", "al-Qahhār", "Den yttersta Härskaren", "Han utövar sin oinskränkta makt över alla sina tjänare och härskar med absolut auktoritet."),
    ("ٱلْقَادِرُ", "al-Qādir", "Den Mäktige", "Han skapade skapelsen genom sin makt och låter dem leva och dö. Om han vill att något ska ske säger han bara: 'Var!' – och det blir."),
    ("القَدِيرُ", "al-Qadīr", "Den Allsmäktige", "Han skapade skapelsen genom sin makt och låter dem leva och dö genom den."),
    ("المُقْتَدِر", "al-Muqtadir", "Den Allrådande", "Han är den som har makt att göra allt han vill. Ingenting kan hindra honom och ingenting kan stå emot hans beslut."),
    ("الْجَبَّارُ", "al-Jabbār", "Den Oemotståndlige", "Han är den som inte kan hindras och som tvingar sin vilja igenom. Han är också den som lagar det som är sönder och tröstar de sörjande."),
    ("الْخَالِقُ", "al-Khāliq", "Skaparen", "Han är den som skapar saker från intet på ett sätt som saknar like. Han skapar allt med fullkomlig precision."),
    ("الخَلَّاقُ", "al-Khallāq", "Den storslagne Skaparen", "Han är den som ständigt skapar, om och om igen, på det mest fulländade sätt. Hans skapande är outtömligt."),
    ("الْبَارِئُ", "al-Bāriʾ", "Frambringaren", "Han är den som frambringar allt till existens och ger det dess särpräglade natur, på det sätt han har bestämt."),
    ("الْمُصَوِّرُ", "al-Muṣawwir", "Formgivaren", "Han är den som ger skapelsen dess skepnader och utseenden. Han formar varje varelse på det sätt han vill, i enlighet med sin visdom."),
    ("الْمُهَيْمِنُ", "al-Muhaymin", "Den Övervakande, den Allhärskande", "Han är den som råder över hela skapelsen. Det han vill sker, och det han inte vill sker inte. Han vakar över skapelsernas handlingar och ord."),
    ("الحَافِظُ", "al-Ḥāfiḏh", "Bevakaren", "Han är den som skyddar sina tjänare från det som leder till undergång, både i deras tro och i deras världsliga liv."),
    ("الحَفِيظُ", "al-Ḥafīḏh", "Den ständigt Bevakande", "Han är den som bevarar allt han har skapat och som omfattar allt med sin kunskap. Han vakar över skapelsen i dess helhet."),
    ("ٱلْوَلِيُّ", "al-Waliyy", "Beskyddaren", "Han är den som tar hand om sin skapelse och skyddar dem. Han stödjer och hjälper dem, och han är nära sina tjänare."),
    ("المَوْلَى", "al-Mawlā", "Skyddsherren", "Han är den som råder över sin skapelse och beskyddar dem. Han är deras herre, beskyddare och hjälp."),
    ("النَّصِيرُ", "an-Naṣīr", "Hjälparen", "Han är den som ständigt hjälper sina sändebud, profeter och nära tjänare. De troende har ingen annan hjälpare eller bevarare än Allah."),
    ("ٱلْوَكِيلُ", "al-Wakīl", "Förvaltaren", "Han är den som ständigt sköter skapelsens angelägenheter och försörjer dem. Han är den som man kan förlita sig på i alla situationer."),
    ("الكَافِي", "al-Kāfī", "Den Tillräcklige", "Han är den som är helt och fullt tillräcklig för sina tjänare i alla angelägenheter. Han förser dem med allt de behöver, både materiellt och andligt."),
    ("ٱلصَّمَدُ", "al-Ṣamad", "Den Suveräne, den som skapelsen vänder sig till", "Han är den fullkomlige i all sin kunskap, styrka och makt. Allt i skapelsen vänder sig till honom i behov och nöd."),
    ("الرَّازِقُ", "ar-Rāziq", "Försörjaren", "Allah är den som garanterar försörjning och skänker sina tjänare det de behöver för att leva."),
    ("الرَّزَّاقُ", "ar-Razzāq", "Den ständige Försörjaren", "Allah är den som utan avbrott försörjer allt levande. Han ger rikligt, generöst och ständigt – hans försörjning tar aldrig slut."),
    ("الفَتَّاحُ", "al-Fattāḥ", "Skiljedomaren, den som ger seger", "Han är den som dömer mellan sina tjänare med rättvisa. Han öppnar portarna till sin nåd och öppnar hjärtan, sinnen och ögon för sanningen."),
    ("المُبِين", "al-Mubīn", "Den Uppenbare, den Klargörande", "Han är den som visar sina tjänare vägen till rätt ledning och klargör för dem vilka vägar som leder till villfarelse."),
    ("ٱلْهَادِي", "al-Hādī", "Vägledaren", "Han är den som vägleder sina tjänare till det som ger dem lycka, både i detta liv och i nästa. All vägledning är i hans hand."),
    ("الْحَكَمُ", "al-Ḥakam", "Domaren", "Han är den som ensam dömer bland sina tjänare. Hans domar verkställs alltid och är fulla av visdom och rättvisa."),
    ("ٱلرَّؤُوفُ", "ar-Ra'ūf", "Den Förbarmande", "Han är den som visar den högsta graden av barmhärtighet. Hans förbarmande är varsamt, djupt och fullkomligt."),
    ("الوَدُودُ", "al-Wadūd", "Den Kärleksfulle, den Älskade", "Han är den som älskar sina profeter, sändebud och de som följer dem. De troende älskar honom mer än något annat."),
    ("ٱلْبَرُّ", "al-Barr", "Den Gode", "Han är den som gång på gång skänker sina tjänare alla former av gott, i detta liv och i det nästa. Hans godhet är fullkomlig och hans gåvor har ingen gräns."),
    ("الْحَلِيمُ", "al-Ḥalīm", "Den Överseende", "Han skyndar inte med att straffa, utan han benådar, förlåter och döljer synder. Han fortsätter att skänka välsignelser och ger sina tjänare en chans att återvända."),
    ("الْغَفُورُ", "al-Ghafūr", "Den ständigt Förlåtande", "Han är den som gång på gång förlåter sina tjänare och inte ställer dem till svars för deras synder när de söker hans förlåtelse."),
    ("الْغَفَّارُ", "al-Ghaffār", "Den konstant Förlåtande", "Han är den som förlåter sina tjänare gång på gång, varje gång de återvänder till honom i ånger. Hans förlåtelse tar aldrig slut."),
    ("العَفُوُ", "al-ʿAfuww", "Benådaren", "Han är den som benådar och helt utplånar synder, så att de inte lämnar några spår efter sig."),
    ("ٱلتَّوَابُ", "at-Tawwāb", "Den som vägleder till ånger och godtar den", "Han är den som gång på gång öppnar vägarna till ånger. Han gläds över sina tjänares ånger och älskar dem som återvänder till honom."),
    ("الكَرِيمُ", "al-Karīm", "Den Generöse", "Han är den som är ytterst god och fullkomlig i alla aspekter. Han ger i överflöd, förlåter även när han har makt att straffa, och bryter aldrig sina löften."),
    ("الأَكْرَم", "al-Akram", "Den mest Generöse", "Han är den som ingen annan kan överträffa i generositet. Han är den mest fullkomlige och skänker alltid mer än vad någon kan föreställa sig."),
    ("الشَّاكِرُ", "ash-Shākir", "Den Uppskattande", "Han är den som erkänner sina tjänares gärningar och belönar dem. Han ger en liten handling en stor belöning."),
    ("الشَّكُورُ", "ash-Shakūr", "Den mycket Uppskattande", "Han är den som ger riklig belöning för små gärningar och mångdubblar sina tjänares uppriktiga handlingar utan gräns."),
    ("السَّمِيعُ", "as-Samīʿ", "Den Allhörande", "Han är den som hör allt – varje ord, varje ljud, varje suck, oavsett hur svagt eller dolt det är. Han besvarar sina tjänares böner i sin visdom."),
    ("ٱلْبَصِيرُ", "al-Baṣīr", "Den Allseende", "Han är den som ser allt med fullkomlig syn; ingenting är dolt för honom. Han ser till och med den svarta myran på en svart sten i nattens mörker."),
    ("الشَّهِيدُ", "ash-Shahīd", "Vittnet, den Närvarande", "Han är den som aldrig är frånvarande, utan alltid närvarande och vittnande. Ingenting undgår honom, varken stort eller smått."),
    ("الرَّقِيبُ", "ar-Raqīb", "Den Övervakande", "Han är den som alltid övervakar och observerar sin skapelse. Inget är dolt för honom – han känner till allt som sker, öppet och dolt."),
    ("القَرِيب", "al-Qarīb", "Den Nära", "Han är den som alltid är nära sina tjänare. Närheten visar sig genom omsorg, hjälp och besvarade böner."),
    ("ٱلْمُجِيبُ", "al-Mujīb", "Den Bönhörande", "Han är den som besvarar sina tjänares åkallan. Han har lovat att besvara deras böner, men hans svar sker alltid utifrån hans visdom."),
    ("المُحِيطُ", "al-Muḥīṭ", "Den Allomfattande", "Han är den som med sin kunskap, makt, hörsel och syn omsluter allt. Ingenting kan undgå honom."),
    ("الحَسِيبُ", "al-Ḥasīb", "Den som håller räkenskapen, den Tillräcklige", "Han är den som räknar varje handling, stor som liten. Han är också den som är tillräcklig för sina tjänare och tillgodoser deras behov."),
    ("ٱلْغَنيُّ", "al-Ghaniyy", "Den Självtillräcklige, den Oberoende", "Han är den som inte behöver någon, medan alla behöver honom. Han äger all rikedom och alla skatter i himlarna och på jorden."),
    ("الْوَهَّابُ", "al-Wahhāb", "Den ständigt Givande", "Han är den som ständigt skänker sin skapelse gåvor i en outtömlig ström av välvilja. Ingen kan hindra den han ger till."),
    ("المُقيِت", "al-Muqīt", "Den som ger näring", "Han är den som förser hela sin skapelse med näring och försörjning – både kroppslig och själslig. Han ger mat och dryck men också kunskap och vägledning."),
    ("الْقَابِضُ", "al-Qābiḍ", "Den som begränsar", "Han är den som i sin visdom håller tillbaka och begränsar försörjningen. Hans begränsning kan vara en prövning, en rening eller en vägledning."),
    ("الْبَاسِطُ", "al-Bāsiṭ", "Den som utvidgar", "Han är den som i sin nåd vidgar försörjningen och skänker rikedom, trygghet och lättnader till vem han vill. Ingen kan begränsa det han bestämmer att ge."),
    ("ٱلْمُقَدِّمُ", "al-Muqaddim", "Den som för fram", "Han är den som för fram och sätter främst vem han vill av sina tjänare i enlighet med sin eviga visdom."),
    ("ٱلْمُؤَخِّرُ", "al-Mu'akhkhir", "Den som håller tillbaka", "Han är den som i sin visdom håller tillbaka och fördröjer det han vill. Ingen kan påskynda det han beslutat att senarelägga."),
    ("الرَّفِيقُ", "ar-Rafīq", "Den Varsamme", "Allah är varsam i sina handlingar. Hans föreskrifter kom successivt, som ett tecken på hans omsorg om sina tjänare. Han är varsam och förhastar sig inte."),
    ("المَنَّان", "al-Mannān", "Den som skänker rikligt", "Han är den som översköljer sin skapelse med gåvor och välsignelser. Allt de har av liv, försörjning och vägledning kommer från honom."),
    ("الجَوَاد", "al-Jawād", "Den Frikostige", "Allahs frikostighet omfattar hela skapelsen utan undantag. Hans välsignelser tar aldrig slut och hans nåd lämnar ingen utanför."),
    ("المُحْسِنُ", "al-Muḥsin", "Den Välgörande", "Allah gör gott mot hela sin skapelse. Han låter dem leva, försörjer dem och tar hand om dem. All hans behandling präglas av Iḥsān."),
    ("السِّتِّيرُ", "as-Sittīr", "Den som döljer", "Allah är den som döljer sina tjänares brister och inte exponerar dem. Han älskar att även de döljer sina egna och andras fel."),
    ("الدَّيَّانُ", "ad-Dayyān", "Återgäldaren, den som håller räkenskapen", "Allah är den som slutligen håller räkenskapen med sin skapelse. Han återgäldar varje själ för vad den har gjort, gott som ont."),
    ("الشَّافِي", "ash-Shāfī", "Den som skänker bot", "Allah är den som botar alla sjukdomar – både inre och yttre. Ingen kan ge bot utom han, och när han skänker bot är den fullkomlig."),
    ("السَّيِّدُ", "as-Sayyid", "Den högsta Herren, den fullkomlige Mästaren", "Han äger hela skapelsen, och hela skapelsen är hans tjänare. All suveränitet och allt herravälde tillhör honom ensam."),
    ("الوِتْرُ", "al-Witr", "Den Ende, den Unike", "Allah är den ende i sin essens, sina egenskaper och sina handlingar. Han har varken partner eller jämlike, och ingen kan jämföras med honom."),
    ("الحَيِيُّ", "al-Ḥayiyy", "Den Blygsamme", "Detta namn bekräftar blyghet som en egenskap hos Allah på ett sätt som anstår hans majestät. Det är inte blyghet av svaghet, utan en ädel återhållsamhet baserad på hans generositet."),
    ("الطَّيِّبُ", "at-Ṭayyib", "Den Gode", "Allah är höjd över alla brister. Inget kommer från honom annat än det som är gott, och inget stiger upp till honom annat än det som är gott."),
    ("المُعْطِي", "al-Muʿṭī", "Givaren", "Allah är den som skänker och fördelar efter sin vilja. Ingen kan hindra det han väljer att ge, och ingen kan ge det han väljer att hålla tillbaka."),
    ("الجَمِيل", "al-Jamīl", "Den Vackre", "Allah är fullkomlig i all skönhet – i sin essens, sina namn, egenskaper och handlingar. Allt som är vackert i skapelsen är en återspegling av hans skönhet."),
]

// MARK: - Embedded Quran Verse Fallback (20 curated verses)
// Shown before first app open. After first open, JS writes exact Bernström
// translations via hidayah_daily_content_cache (App Group), which takes priority.

private struct FallbackVerse {
    let swedish: String; let surahName: String
    let surahNumber: Int; let ayahNumber: Int; let reference: String
}

private let kFallbackVerses: [FallbackVerse] = [
    FallbackVerse(
        swedish: "I Allahs, den Nåderikes, den Barmhärtiges namn. All lovprisning tillkommer Allah, världarnas Herre. Den Nåderike, den Barmhärtige. Han som råder på Domens dag. Dig dyrkar vi och till dig vänder vi oss om hjälp. Led oss på den raka vägen – vägen för dem som du har välsignat.",
        surahName: "Al-Fatiha", surahNumber: 1, ayahNumber: 1, reference: "1:1–7"),
    FallbackVerse(
        swedish: "Allah - det finns ingen [sann] gud utom honom, den Levande, den evige Vidmakthållaren. Slummer griper honom inte och inte heller sömn. Honom tillhör allt i himlarna och på jorden.",
        surahName: "Al-Baqarah", surahNumber: 2, ayahNumber: 255, reference: "2:255"),
    FallbackVerse(
        swedish: "Allah belastar inte en människa med mer än hon orkar. Hon [skördar] det [gott] som hon vinner och drabbas av det [onda] som hon förvärvar.",
        surahName: "Al-Baqarah", surahNumber: 2, ayahNumber: 286, reference: "2:286"),
    FallbackVerse(
        swedish: "Allah är tillräcklig för oss och han är den bäste förvaltaren.",
        surahName: "Al-Imran", surahNumber: 3, ayahNumber: 173, reference: "3:173"),
    FallbackVerse(
        swedish: "Varje levande varelse måste smaka döden, och på Domens dag skall ni få er fulla lön.",
        surahName: "Al-Imran", surahNumber: 3, ayahNumber: 185, reference: "3:185"),
    FallbackVerse(
        swedish: "Minns mig, och jag skall minnas er. Var tacksamma mot mig och var inte otacksamma.",
        surahName: "Al-Baqarah", surahNumber: 2, ayahNumber: 152, reference: "2:152"),
    FallbackVerse(
        swedish: "Och om mina tjänare frågar dig om mig – jag är nära. Jag besvarar den bedjandes bön när han åkallar mig.",
        surahName: "Al-Baqarah", surahNumber: 2, ayahNumber: 186, reference: "2:186"),
    FallbackVerse(
        swedish: "Om ni är tacksamma ökar jag er välsignelse, men om ni är otacksamma – mitt straff är hårt.",
        surahName: "Ibrahim", surahNumber: 14, ayahNumber: 7, reference: "14:7"),
    FallbackVerse(
        swedish: "Vår Herre! Skänk oss nåd från din sida och ordna de bästa förutsättningarna för oss i det vi har för händer.",
        surahName: "Al-Kahf", surahNumber: 18, ayahNumber: 10, reference: "18:10"),
    FallbackVerse(
        swedish: "Jag är Allah – det finns ingen [sann] gud utom jag! Dyrka mig och förrätta bönen till min åminnelse.",
        surahName: "Ta-Ha", surahNumber: 20, ayahNumber: 14, reference: "20:14"),
    FallbackVerse(
        swedish: "Det finns ingen gud utom dig. Ära vare dig! Jag var sannerligen bland dem som handlar orättfärdigt mot sig själva.",
        surahName: "Al-Anbiya", surahNumber: 21, ayahNumber: 87, reference: "21:87"),
    FallbackVerse(
        swedish: "Med svårigheten finns lättnad. Med svårigheten finns lättnad.",
        surahName: "Al-Inshirah", surahNumber: 94, ayahNumber: 5, reference: "94:5–6"),
    FallbackVerse(
        swedish: "Säg: O mina tjänare, som handlat orättfärdigt mot er själva – förtvivla aldrig om Allahs nåd. Allah förlåter alla synder. Han är den som förlåter, den Barmhärtige.",
        surahName: "Az-Zumar", surahNumber: 39, ayahNumber: 53, reference: "39:53"),
    FallbackVerse(
        swedish: "Han är Allah; det finns ingen gud utom han; Konungen, den Helige, den Felfrie, den som skänker trygghet, Beskyddaren, den Mäktige, den Oemotstånglige, den som besitter all storhet.",
        surahName: "Al-Hashr", surahNumber: 59, ayahNumber: 23, reference: "59:23"),
    FallbackVerse(
        swedish: "Han som skapade döden och livet för att pröva er – vem av er som handlar bäst. Han är den Allmäktige, den som förlåter.",
        surahName: "Al-Mulk", surahNumber: 67, ayahNumber: 2, reference: "67:2"),
    FallbackVerse(
        swedish: "Vid tidernas lopp! Sannerligen, [hela] mänskligheten är på väg mot fördärvet, utom de som tror och lever rättskaffens och råder varandra till sanningen och råder varandra till tålamod.",
        surahName: "Al-Asr", surahNumber: 103, ayahNumber: 1, reference: "103:1–3"),
    FallbackVerse(
        swedish: "Säg: Han är Allah, den Ende. Allah, den Suveräne. Han har inte avlat och inte heller blivit avlad. Och ingen är hans like.",
        surahName: "Al-Ikhlas", surahNumber: 112, ayahNumber: 1, reference: "112:1–4"),
    FallbackVerse(
        swedish: "O ni människor! Vi har sannerligen skapat er av man och kvinna och gjort er till folk och stammar för att ni skall lära känna varandra.",
        surahName: "Al-Hujurat", surahNumber: 49, ayahNumber: 13, reference: "49:13"),
    FallbackVerse(
        swedish: "Nådens Herres sanna tjänare är de som vandrar ödmjukt på jorden och som, när okunniga människor tilltalar dem, svarar: Fred!",
        surahName: "Al-Furqan", surahNumber: 25, ayahNumber: 63, reference: "25:63"),
    FallbackVerse(
        swedish: "Dyrka Allah och sätt ingenting vid hans sida, och visa godhet mot era föräldrar och mot närstående och faderlösa och fattiga och grannar.",
        surahName: "An-Nisa", surahNumber: 4, ayahNumber: 36, reference: "4:36"),
]

// ═══════════════════════════════════════════════════════════════════════════════
// MARK: - Dagens Hadith Widget  (medium only)
// ═══════════════════════════════════════════════════════════════════════════════

struct HadithEntry: TimelineEntry {
    let date: Date
    let arabic: String
    let swedish: String
    let source: String
    let hadith_nr: Int

    static let placeholder = HadithEntry(
        date: .now,
        arabic: "إِنَّمَا الْأَعْمَالُ بِالنِّيَّاتِ",
        swedish: "Handlingar bedöms utifrån avsikterna, och varje person belönas för vad han har haft för avsikt.",
        source: "Sahih ul-Bukhari 1",
        hadith_nr: 1
    )
}

struct HadithProvider: TimelineProvider {
    func placeholder(in context: Context) -> HadithEntry { .placeholder }

    func getSnapshot(in context: Context, completion: @escaping (HadithEntry) -> Void) {
        completion(buildEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<HadithEntry>) -> Void) {
        completion(Timeline(entries: [buildEntry()], policy: .after(dailyMidnight())))
    }

    private func buildEntry() -> HadithEntry {
        if let c = readDailyCache(), let h = c.hadith {
            return HadithEntry(date: .now, arabic: h.arabic, swedish: h.swedish, source: h.source,
                               hadith_nr: h.hadith_nr ?? 1)
        }
        let f = kFallbackHadiths[epochDayIndex(year: 2024, month: 1, day: 1, count: kFallbackHadiths.count)]
        return HadithEntry(date: .now, arabic: f.arabic, swedish: f.swedish, source: f.source,
                           hadith_nr: f.hadith_nr)
    }
}

private struct DailyHadithMediumView: View {
    let entry: HadithEntry
    var body: some View {
        ViewThatFits(in: .vertical) {
            fullLayout
            swedishOnlyLayout
        }
        .padding(EdgeInsets(top: 14, leading: 14, bottom: 12, trailing: 14))
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    // Arabic + Swedish — shown when both fit without crowding
    private var fullLayout: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Dagens Hadith")
                .font(.system(size: 10, weight: .semibold)).foregroundColor(kGold)
            Spacer(minLength: 6)
            Text(entry.arabic)
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(.white.opacity(0.50))
                .lineLimit(2).multilineTextAlignment(.trailing)
                .frame(maxWidth: .infinity, alignment: .trailing)
            Spacer(minLength: 6)
            Text(entry.swedish)
                .font(.system(size: 11, weight: .regular))
                .foregroundColor(.white.opacity(0.85))
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 6)
            Text(entry.source)
                .font(.system(size: 10, weight: .semibold))
                .foregroundColor(kGold.opacity(0.80)).lineLimit(1)
        }
    }

    // Swedish only — fallback when the hadith is too long to show both languages
    private var swedishOnlyLayout: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Dagens Hadith")
                .font(.system(size: 10, weight: .semibold)).foregroundColor(kGold)
            Spacer(minLength: 6)
            Text(entry.swedish)
                .font(.system(size: 11, weight: .regular))
                .foregroundColor(.white.opacity(0.85))
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 6)
            Text(entry.source)
                .font(.system(size: 10, weight: .semibold))
                .foregroundColor(kGold.opacity(0.80)).lineLimit(1)
        }
    }
}

struct HidayahDailyHadithWidget: Widget {
    let kind = "HidayahDailyHadithWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: HadithProvider()) { entry in
            DailyHadithMediumView(entry: entry)
                .containerBackground(
                    LinearGradient(colors: [kBgTop, kBgBottom],
                                   startPoint: .topLeading, endPoint: .bottomTrailing),
                    for: .widget)
                .widgetURL(URL(string: "hidayah://hadith/\(entry.hadith_nr)"))
        }
        .configurationDisplayName("Dagens Hadith")
        .description("Läs en ny hadith varje dag.")
        .supportedFamilies([.systemMedium])
    }
}

// MARK: - Embedded Hadith Fallback (shown before first app open)

private struct FallbackHadith {
    let arabic: String; let swedish: String; let source: String; let hadith_nr: Int
}

private let kFallbackHadiths: [FallbackHadith] = [
    FallbackHadith(
        arabic: "إِنَّمَا الْأَعْمَالُ بِالنِّيَّاتِ",
        swedish: "Handlingar bedöms utifrån avsikterna, och varje person belönas för vad han har haft för avsikt.",
        source: "Sahih ul-Bukhari 1", hadith_nr: 1),
    FallbackHadith(
        arabic: "الدِّينُ النَّصِيحَةُ",
        swedish: "Religionen är uppriktig rådgivning.",
        source: "Sahih ul-Muslim 55", hadith_nr: 1),
    FallbackHadith(
        arabic: "مَنْ كَانَ يُؤْمِنُ بِاللَّهِ وَالْيَوْمِ الْآخِرِ فَلْيَقُلْ خَيْرًا أَوْ لِيَصْمُتْ",
        swedish: "Den som tror på Allah och den Yttersta dagen, låt honom säga något gott eller tiga.",
        source: "Sahih ul-Bukhari 6136", hadith_nr: 1),
    FallbackHadith(
        arabic: "لَا يُؤْمِنُ أَحَدُكُمْ حَتَّى يُحِبَّ لِأَخِيهِ مَا يُحِبُّ لِنَفْسِهِ",
        swedish: "Ingen av er tror (fullständigt) förrän han önskar för sin broder det han önskar för sig själv.",
        source: "Sahih ul-Bukhari 13", hadith_nr: 15),
    FallbackHadith(
        arabic: "اتَّقِ اللَّهَ حَيْثُمَا كُنْتَ",
        swedish: "Frukta Allah var du än befinner dig, och låt en god gärning följa en dålig – den utplånar den. Och bemöt folk med ett gott uppträdande.",
        source: "At-Tirmidhi 1987", hadith_nr: 11),
]

// MARK: - Previews

#Preview(as: .systemSmall)           { HidayahFocusWidget()        } timeline: { PrayerEntry.placeholder() }
#Preview(as: .systemSmall)           { HidayahListWidget()          } timeline: { PrayerEntry.placeholder() }
#Preview(as: .systemMedium)          { HidayahWidget()              } timeline: { PrayerEntry.placeholder() }
#Preview(as: .systemLarge)           { HidayahLargeWidget()         } timeline: { PrayerEntry.placeholder() }
#Preview(as: .systemLarge)           { HidayahOverviewWidget()      } timeline: { PrayerEntry.placeholder() }
#if os(iOS)
#Preview(as: .accessoryRectangular)  { HidayahLockFocusWidget()     } timeline: { PrayerEntry.placeholder() }
#Preview(as: .accessoryRectangular)  { HidayahLockOverviewWidget()  } timeline: { PrayerEntry.placeholder() }
#Preview(as: .accessoryRectangular)  { HidayahLockArcWidget()       } timeline: { PrayerEntry.placeholder() }
#endif
#Preview(as: .systemSmall)           { HidayahAllahNameWidget()     } timeline: { AllahNameEntry.placeholder }
#Preview(as: .systemMedium)          { HidayahAllahNameWidget()     } timeline: { AllahNameEntry.placeholder }
#Preview(as: .systemSmall)           { HidayahDailyVerseWidget()    } timeline: { QuranVerseEntry.placeholder }
#Preview(as: .systemMedium)          { HidayahDailyVerseWidget()    } timeline: { QuranVerseEntry.placeholder }
#Preview(as: .systemMedium)          { HidayahDailyHadithWidget()   } timeline: { HadithEntry.placeholder }
