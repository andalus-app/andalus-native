// NativeNotificationScheduler.swift
// Schedules prayer notifications natively using UNUserNotificationCenter.
// No React Native JS runtime required. Called from LocationBackgroundManager
// when iOS delivers a significant-location-change event.
//
// Significant-location monitoring allows iOS to relaunch the app for low-power
// location events in supported conditions. It is more reliable than JS-only
// background location, but still controlled by iOS and can be affected by
// Background App Refresh settings, permissions, Low Power Mode, and user/system
// behavior. It does not guarantee delivery in all termination cases.
//
// ── Location resolution ──────────────────────────────────────────────────────
// Uses a two-tier location index:
//   Tier 1: bundledLocations (110 Swedish cities, always available)
//   Tier 2: andalus_location_index (cities user has visited, dynamic)
// Combined, they cover the most common travel scenarios in Sweden.
// For a user in Haparanda: Tier 1 has Haparanda at 65.8355°N → exact match.
// For a user in Spånga (Stockholm municipality): nearest bundled is Stockholm.
//
// MAX-DISTANCE SAFETY: if the nearest resolved city is > kMaxFallbackDistanceKm
// away the scheduler refuses to schedule uncertain data, sets needsPrayerRefresh,
// and leaves existing notifications untouched.
//
// ── Prayer cache ─────────────────────────────────────────────────────────────
// Reads from andalus_multi_city_cache (dict of cityKey → city cache).
// JS writes one entry per city after each successful prayer fetch — the cache
// accumulates entries for every city the user has opened the app in.
// Midnight rollover: if cache.tomorrowDate == today, uses tomT as today's times.
//
// ── Managed notification identifiers ────────────────────────────────────────
// Main prayers (10):   andalus-prayer-{today|tomorrow}-{fajr|dhuhr|asr|maghrib|isha}
// Dhikr (2):           andalus-dhikr-{today|tomorrow}  (only when dhikrReminder = true)
// Pre-prayer reminders: hidayah-pre-prayer-YYYY-MM-DD-{prayer} (today + tomorrow)
//
// Does NOT touch: announcements, Allah's Names, Zakat, Al-Kahf, live-stream.
//
// ── Collision prevention ─────────────────────────────────────────────────────
// Both JS and Native use identical identifiers. Because each side cancels then
// reschedules the same set, duplicates are structurally impossible. The
// andalus_notification_schedule_state key tracks the last scheduled times so
// whichever side runs first does not redundantly reschedule identical times.

import Foundation
import UserNotifications

// MARK: - Shared identifier constants
// Keep in sync with notifications.ts constants.

let kPrayerIdentifiers: [String] = {
    let slots   = ["today", "tomorrow"]
    let prayers = ["fajr", "dhuhr", "asr", "maghrib", "isha"]
    return slots.flatMap { s in prayers.map { "andalus-prayer-\(s)-\($0)" } }
}()

let kDhikrIdentifiers        = ["andalus-dhikr-today", "andalus-dhikr-tomorrow"]
let kPrePrayerPrefix         = "hidayah-pre-prayer-"

// MARK: - App Group keys

private let kAppGroup            = "group.com.anonymous.Hidayah"
private let kSettingsKey         = "andalus_settings_native"
private let kLocationIndexKey    = "andalus_location_index"
private let kMultiCityCacheKey   = "andalus_multi_city_cache"
private let kScheduleStateKey    = "andalus_notification_schedule_state"

// Maximum distance (km) at which a bundled fallback city is considered reliable.
// If the nearest resolved city exceeds this, native will NOT schedule notifications
// (uncertain data), will set needsPrayerRefresh so JS refreshes on next app open,
// and will leave existing notifications untouched.
private let kMaxFallbackDistanceKm: Double = 100.0

// MARK: - Static fallback location index
// Always available regardless of which cities the user has opened the app in.
// Covers 110 Swedish cities so native can resolve locations across all of Sweden
// without the user having previously opened the app in that area.

private struct StaticCity {
    let name:        String  // normalized lowercase — matches JS getEffectivePrayerCity().toLowerCase()
    let displayName: String
    let lat:         Double
    let lng:         Double
}

private let bundledLocations: [StaticCity] = [
    // ── Original 25 ──────────────────────────────────────────────────────────
    StaticCity(name: "stockholm",       displayName: "Stockholm",       lat: 59.3293, lng: 18.0686),
    StaticCity(name: "göteborg",        displayName: "Göteborg",        lat: 57.7089, lng: 11.9746),
    StaticCity(name: "malmö",           displayName: "Malmö",           lat: 55.6050, lng: 13.0038),
    StaticCity(name: "uppsala",         displayName: "Uppsala",         lat: 59.8586, lng: 17.6389),
    StaticCity(name: "västerås",        displayName: "Västerås",        lat: 59.6162, lng: 16.5528),
    StaticCity(name: "örebro",          displayName: "Örebro",          lat: 59.2753, lng: 15.2134),
    StaticCity(name: "linköping",       displayName: "Linköping",       lat: 58.4108, lng: 15.6214),
    StaticCity(name: "helsingborg",     displayName: "Helsingborg",     lat: 56.0467, lng: 12.6945),
    StaticCity(name: "jönköping",       displayName: "Jönköping",       lat: 57.7826, lng: 14.1618),
    StaticCity(name: "norrköping",      displayName: "Norrköping",      lat: 58.5877, lng: 16.1924),
    StaticCity(name: "lund",            displayName: "Lund",            lat: 55.7047, lng: 13.1910),
    StaticCity(name: "umeå",            displayName: "Umeå",            lat: 63.8258, lng: 20.2630),
    StaticCity(name: "gävle",           displayName: "Gävle",           lat: 60.6749, lng: 17.1413),
    StaticCity(name: "borås",           displayName: "Borås",           lat: 57.7210, lng: 12.9401),
    StaticCity(name: "södertälje",      displayName: "Södertälje",      lat: 59.1955, lng: 17.6253),
    StaticCity(name: "eskilstuna",      displayName: "Eskilstuna",      lat: 59.3666, lng: 16.5077),
    StaticCity(name: "karlstad",        displayName: "Karlstad",        lat: 59.3793, lng: 13.5036),
    StaticCity(name: "växjö",           displayName: "Växjö",           lat: 56.8777, lng: 14.8091),
    StaticCity(name: "halmstad",        displayName: "Halmstad",        lat: 56.6745, lng: 12.8577),
    StaticCity(name: "sundsvall",       displayName: "Sundsvall",       lat: 62.3908, lng: 17.3069),
    StaticCity(name: "huddinge",        displayName: "Huddinge",        lat: 59.2366, lng: 17.9810),
    StaticCity(name: "botkyrka",        displayName: "Botkyrka",        lat: 59.2005, lng: 17.8280),
    StaticCity(name: "järfälla",        displayName: "Järfälla",        lat: 59.4131, lng: 17.8340),
    StaticCity(name: "sollentuna",      displayName: "Sollentuna",      lat: 59.4282, lng: 17.9508),
    StaticCity(name: "solna",           displayName: "Solna",           lat: 59.3597, lng: 18.0009),
    // ── Norrland ─────────────────────────────────────────────────────────────
    StaticCity(name: "luleå",           displayName: "Luleå",           lat: 65.5848, lng: 22.1567),
    StaticCity(name: "skellefteå",      displayName: "Skellefteå",      lat: 64.7507, lng: 20.9528),
    StaticCity(name: "piteå",           displayName: "Piteå",           lat: 65.3172, lng: 21.4794),
    StaticCity(name: "boden",           displayName: "Boden",           lat: 65.8252, lng: 21.6886),
    StaticCity(name: "kiruna",          displayName: "Kiruna",          lat: 67.8558, lng: 20.2253),
    StaticCity(name: "gällivare",       displayName: "Gällivare",       lat: 67.1339, lng: 20.6528),
    StaticCity(name: "kalix",           displayName: "Kalix",           lat: 65.8558, lng: 23.1430),
    StaticCity(name: "haparanda",       displayName: "Haparanda",       lat: 65.8355, lng: 24.1368),
    StaticCity(name: "östersund",       displayName: "Östersund",       lat: 63.1792, lng: 14.6357),
    StaticCity(name: "örnsköldsvik",    displayName: "Örnsköldsvik",    lat: 63.2909, lng: 18.7153),
    // ── Dalarna / Gävleborg / södra Norrland ─────────────────────────────────
    StaticCity(name: "falun",           displayName: "Falun",           lat: 60.6065, lng: 15.6355),
    StaticCity(name: "borlänge",        displayName: "Borlänge",        lat: 60.4858, lng: 15.4360),
    StaticCity(name: "mora",            displayName: "Mora",            lat: 61.0070, lng: 14.5430),
    StaticCity(name: "ludvika",         displayName: "Ludvika",         lat: 60.1496, lng: 15.1878),
    StaticCity(name: "avesta",          displayName: "Avesta",          lat: 60.1455, lng: 16.1679),
    StaticCity(name: "hudiksvall",      displayName: "Hudiksvall",      lat: 61.7289, lng: 17.1049),
    StaticCity(name: "bollnäs",         displayName: "Bollnäs",         lat: 61.3482, lng: 16.3946),
    StaticCity(name: "söderhamn",       displayName: "Söderhamn",       lat: 61.3037, lng: 17.0592),
    StaticCity(name: "sandviken",       displayName: "Sandviken",       lat: 60.6216, lng: 16.7755),
    StaticCity(name: "nynäshamn",       displayName: "Nynäshamn",       lat: 58.9034, lng: 17.9479),
    // ── Stockholmsregionen ────────────────────────────────────────────────────
    StaticCity(name: "täby",            displayName: "Täby",            lat: 59.4439, lng: 18.0687),
    StaticCity(name: "nacka",           displayName: "Nacka",           lat: 59.3105, lng: 18.1637),
    StaticCity(name: "haninge",         displayName: "Haninge",         lat: 59.1687, lng: 18.1374),
    StaticCity(name: "tyresö",          displayName: "Tyresö",          lat: 59.2433, lng: 18.2290),
    StaticCity(name: "upplands-väsby",  displayName: "Upplands Väsby",  lat: 59.5184, lng: 17.9113),
    StaticCity(name: "märsta",          displayName: "Märsta",          lat: 59.6216, lng: 17.8548),
    StaticCity(name: "vallentuna",      displayName: "Vallentuna",      lat: 59.5344, lng: 18.0776),
    StaticCity(name: "åkersberga",      displayName: "Åkersberga",      lat: 59.4794, lng: 18.2997),
    StaticCity(name: "norrtälje",       displayName: "Norrtälje",       lat: 59.7570, lng: 18.7049),
    StaticCity(name: "enköping",        displayName: "Enköping",        lat: 59.6361, lng: 17.0777),
    // ── Sörmland / Östergötland / norra Småland ───────────────────────────────
    StaticCity(name: "strängnäs",       displayName: "Strängnäs",       lat: 59.3774, lng: 17.0312),
    StaticCity(name: "katrineholm",     displayName: "Katrineholm",     lat: 58.9959, lng: 16.2072),
    StaticCity(name: "nyköping",        displayName: "Nyköping",        lat: 58.7528, lng: 17.0079),
    StaticCity(name: "motala",          displayName: "Motala",          lat: 58.5371, lng: 15.0365),
    StaticCity(name: "mjölby",          displayName: "Mjölby",          lat: 58.3259, lng: 15.1236),
    StaticCity(name: "finspång",        displayName: "Finspång",        lat: 58.7058, lng: 15.7674),
    StaticCity(name: "tranås",          displayName: "Tranås",          lat: 58.0372, lng: 14.9782),
    StaticCity(name: "värnamo",         displayName: "Värnamo",         lat: 57.1860, lng: 14.0400),
    StaticCity(name: "nässjö",          displayName: "Nässjö",          lat: 57.6531, lng: 14.6968),
    StaticCity(name: "eksjö",           displayName: "Eksjö",           lat: 57.6664, lng: 14.9721),
    // ── Kalmar / Gotland / Blekinge / norra Skåne ────────────────────────────
    StaticCity(name: "kalmar",          displayName: "Kalmar",          lat: 56.6634, lng: 16.3568),
    StaticCity(name: "oskarshamn",      displayName: "Oskarshamn",      lat: 57.2646, lng: 16.4484),
    StaticCity(name: "västervik",       displayName: "Västervik",       lat: 57.7584, lng: 16.6373),
    StaticCity(name: "visby",           displayName: "Visby",           lat: 57.6348, lng: 18.2948),
    StaticCity(name: "karlskrona",      displayName: "Karlskrona",      lat: 56.1612, lng: 15.5869),
    StaticCity(name: "ronneby",         displayName: "Ronneby",         lat: 56.2094, lng: 15.2760),
    StaticCity(name: "karlshamn",       displayName: "Karlshamn",       lat: 56.1703, lng: 14.8619),
    StaticCity(name: "kristianstad",    displayName: "Kristianstad",    lat: 56.0294, lng: 14.1567),
    StaticCity(name: "hässleholm",      displayName: "Hässleholm",      lat: 56.1589, lng: 13.7668),
    StaticCity(name: "ängelholm",       displayName: "Ängelholm",       lat: 56.2428, lng: 12.8622),
    // ── Skåne / Halland / södra Götaland ─────────────────────────────────────
    StaticCity(name: "landskrona",      displayName: "Landskrona",      lat: 55.8708, lng: 12.8302),
    StaticCity(name: "trelleborg",      displayName: "Trelleborg",      lat: 55.3751, lng: 13.1569),
    StaticCity(name: "ystad",           displayName: "Ystad",           lat: 55.4295, lng: 13.8204),
    StaticCity(name: "simrishamn",      displayName: "Simrishamn",      lat: 55.5565, lng: 14.3504),
    StaticCity(name: "varberg",         displayName: "Varberg",         lat: 57.1056, lng: 12.2508),
    StaticCity(name: "falkenberg",      displayName: "Falkenberg",      lat: 56.9055, lng: 12.4912),
    StaticCity(name: "kungsbacka",      displayName: "Kungsbacka",      lat: 57.4875, lng: 12.0762),
    StaticCity(name: "alingsås",        displayName: "Alingsås",        lat: 57.9300, lng: 12.5334),
    StaticCity(name: "lerum",           displayName: "Lerum",           lat: 57.7705, lng: 12.2690),
    StaticCity(name: "kungälv",         displayName: "Kungälv",         lat: 57.8706, lng: 11.9805),
    // ── Västra Götaland / Värmland / Västmanland ──────────────────────────────
    StaticCity(name: "trollhättan",     displayName: "Trollhättan",     lat: 58.2837, lng: 12.2886),
    StaticCity(name: "uddevalla",       displayName: "Uddevalla",       lat: 58.3498, lng: 11.9356),
    StaticCity(name: "vänersborg",      displayName: "Vänersborg",      lat: 58.3807, lng: 12.3234),
    StaticCity(name: "skövde",          displayName: "Skövde",          lat: 58.3903, lng: 13.8461),
    StaticCity(name: "lidköping",       displayName: "Lidköping",       lat: 58.5052, lng: 13.1577),
    StaticCity(name: "mariestad",       displayName: "Mariestad",       lat: 58.7097, lng: 13.8237),
    StaticCity(name: "kristinehamn",    displayName: "Kristinehamn",    lat: 59.3098, lng: 14.1081),
    StaticCity(name: "arvika",          displayName: "Arvika",          lat: 59.6553, lng: 12.5852),
    StaticCity(name: "köping",          displayName: "Köping",          lat: 59.5140, lng: 15.9926),
    StaticCity(name: "sala",            displayName: "Sala",            lat: 59.9199, lng: 16.6066),
    // ── Örebro / norra Dalarna / Ångermanland / inre Norrland ─────────────────
    StaticCity(name: "fagersta",        displayName: "Fagersta",        lat: 60.0042, lng: 15.7932),
    StaticCity(name: "arboga",          displayName: "Arboga",          lat: 59.3949, lng: 15.8388),
    StaticCity(name: "kumla",           displayName: "Kumla",           lat: 59.1277, lng: 15.1434),
    StaticCity(name: "lindesberg",      displayName: "Lindesberg",      lat: 59.5939, lng: 15.2304),
    StaticCity(name: "härnösand",       displayName: "Härnösand",       lat: 62.6323, lng: 17.9379),
    StaticCity(name: "sollefteå",       displayName: "Sollefteå",       lat: 63.1667, lng: 17.2667),
    StaticCity(name: "lycksele",        displayName: "Lycksele",        lat: 64.5954, lng: 18.6735),
    StaticCity(name: "vilhelmina",      displayName: "Vilhelmina",      lat: 64.6242, lng: 16.6550),
    StaticCity(name: "arjeplog",        displayName: "Arjeplog",        lat: 66.0517, lng: 17.8861),
    StaticCity(name: "jokkmokk",        displayName: "Jokkmokk",        lat: 66.6066, lng: 19.8232),
    // ── Övriga ───────────────────────────────────────────────────────────────
    StaticCity(name: "malung",          displayName: "Malung",          lat: 60.6833, lng: 13.7167),
    StaticCity(name: "sveg",            displayName: "Sveg",            lat: 62.0346, lng: 14.3658),
    StaticCity(name: "strömstad",       displayName: "Strömstad",       lat: 58.9395, lng: 11.1712),
    StaticCity(name: "lysekil",         displayName: "Lysekil",         lat: 58.2743, lng: 11.4358),
    StaticCity(name: "ulricehamn",      displayName: "Ulricehamn",      lat: 57.7916, lng: 13.4142),
]

// MARK: - Data models

struct LocationIndexEntry: Codable {
    let cityKey:     String
    let displayName: String
    let lat:         Double
    let lng:         Double
    let method:      Int
    let school:      Int
}

private struct NativeSettings: Decodable {
    let notifications:           Bool
    let calculationMethod:       Int
    let school:                  Int
    let dhikrReminder:           Bool
    let prePrayerReminderOffset: Int?   // nil when field absent (old data); treat as 0

    var effectivePrePrayerOffset: Int { prePrayerReminderOffset ?? 0 }
}

/// One entry in the multi-city cache dict (andalus_multi_city_cache).
/// JS writes "date" and "tomorrowDate"; CodingKeys map them to today/tomorrow.
private struct NativeCityCache: Decodable {
    let cityKey:     String
    let displayName: String
    let lat:         Double
    let lng:         Double
    let method:      Int
    let school:      Int
    let today:       String   // "yyyy-MM-dd"
    let tomorrow:    String   // "yyyy-MM-dd"
    let todayT:      [String: String]
    let tomT:        [String: String]?
    let updatedAt:   Double

    enum CodingKeys: String, CodingKey {
        case cityKey, displayName, lat, lng, method, school
        case today    = "date"         // JS field name
        case tomorrow = "tomorrowDate" // JS field name
        case todayT, tomT, updatedAt
    }
}

struct NotificationScheduleState: Codable {
    var version:                 Int
    var owner:                   String   // "js" | "native"
    var source:                  String   // "app_open" | "js_background" | "native_significant_location"
    var cityKey:                 String
    var displayName:             String
    var lat:                     Double
    var lng:                     Double
    var date:                    String
    var method:                  Int
    var school:                  Int
    var todayT:                  [String: String]?
    var tomT:                    [String: String]?
    var dhikrEnabled:            Bool
    var prePrayerOffset:         Int
    var updatedAt:               Double   // Unix seconds
}

// MARK: - Scheduler

final class NativeNotificationScheduler {

    static let shared = NativeNotificationScheduler()
    private init() {}

    // MARK: - Entry point

    func trySchedule(lat: Double, lng: Double, defaults: UserDefaults,
                     completion: @escaping (Bool) -> Void) {

        // 1. Settings
        guard let settings = readSettings(defaults) else {
            NSLog("[NativeNotif] No settings — skipping"); completion(false); return
        }
        guard settings.notifications else {
            NSLog("[NativeNotif] Notifications disabled — skipping"); completion(false); return
        }

        // 2. Nearest city — combine static bundled list with dynamic visited-city index
        let nearest = resolveNearest(lat: lat, lng: lng, settings: settings, defaults: defaults)
        guard let nearest else {
            NSLog("[NativeNotif] Cannot resolve nearest city — skipping"); completion(false); return
        }
        let nearestKm = haversineKm(lat1: lat, lng1: lng, lat2: nearest.lat, lng2: nearest.lng)
        NSLog("[NativeNotif] Nearest: %@ (%.1f km) — key: %@",
              nearest.displayName, nearestKm, nearest.cacheKey)

        // Safety: refuse to schedule when the nearest known city is too far away.
        // Prayer times from a distant city would be wrong. Signal JS to refresh
        // on next app open and keep any existing notifications intact.
        guard nearestKm <= kMaxFallbackDistanceKm else {
            NSLog("[NativeNotif] Nearest fallback %@ is %.1f km away — exceeds %.0f km limit, keeping existing notifications",
                  nearest.displayName, nearestKm, kMaxFallbackDistanceKm)
            markNeedsPrayerRefresh(defaults)
            completion(false)
            return
        }

        // 3. Prayer cache for nearest city
        let multiCache = readMultiCityCache(defaults)
        guard let cityCache = multiCache?[nearest.cacheKey] else {
            NSLog("[NativeNotif] No cache for %@ — setting needsPrayerRefresh", nearest.cacheKey)
            markNeedsPrayerRefresh(defaults)
            completion(false); return
        }

        // Resolve today/tomorrow prayer times with midnight rollover support
        guard let resolved = resolveTimings(from: cityCache) else {
            NSLog("[NativeNotif] Cache stale for %@ (date: %@) — setting needsPrayerRefresh",
                  nearest.cacheKey, cityCache.today)
            markNeedsPrayerRefresh(defaults)
            completion(false); return
        }

        // 4. Skip if nothing changed
        let existing = readScheduleState(defaults)
        if !rescheduleNeeded(nearest: nearest, resolved: resolved, settings: settings,
                             existing: existing) {
            NSLog("[NativeNotif] Schedule unchanged — skipping"); completion(false); return
        }

        // 5. Permission check then schedule
        UNUserNotificationCenter.current().getNotificationSettings { [weak self] ns in
            guard let self else { completion(false); return }
            guard ns.authorizationStatus == .authorized ||
                  ns.authorizationStatus == .provisional else {
                NSLog("[NativeNotif] Permission not granted (%ld)", ns.authorizationStatus.rawValue)
                completion(false); return
            }
            self.performSchedule(nearest: nearest, resolved: resolved,
                                 settings: settings, defaults: defaults)
            completion(true)
        }
    }

    // MARK: - Location resolution

    /// Combines Tier-1 (bundled static cities) with Tier-2 (dynamic App Group index).
    /// Returns the nearest city across both, with a constructed cache key.
    private func resolveNearest(lat: Double, lng: Double,
                                settings: NativeSettings,
                                defaults: UserDefaults) -> ResolvedCity? {
        let method = settings.calculationMethod
        let school = settings.school

        // Tier 1: bundled — always available
        let staticBest = bundledLocations.min(by: {
            haversineKm(lat1: lat, lng1: lng, lat2: $0.lat, lng2: $0.lng)
          < haversineKm(lat1: lat, lng1: lng, lat2: $1.lat, lng2: $1.lng)
        })

        // Tier 2: dynamic visited cities
        let dynamicBest: LocationIndexEntry? = readLocationIndex(defaults)?.min(by: {
            haversineKm(lat1: lat, lng1: lng, lat2: $0.lat, lng2: $0.lng)
          < haversineKm(lat1: lat, lng1: lng, lat2: $1.lat, lng2: $1.lng)
        })

        // Pick the overall nearest
        if let s = staticBest, let d = dynamicBest {
            let ds = haversineKm(lat1: lat, lng1: lng, lat2: s.lat, lng2: s.lng)
            let dd = haversineKm(lat1: lat, lng1: lng, lat2: d.lat, lng2: d.lng)
            if dd < ds {
                return ResolvedCity(displayName: d.displayName,
                                    lat: d.lat, lng: d.lng,
                                    cacheKey: d.cityKey)
            }
        }
        if let d = dynamicBest {
            // Dynamic is only candidate
            return ResolvedCity(displayName: d.displayName,
                                lat: d.lat, lng: d.lng,
                                cacheKey: d.cityKey)
        }
        guard let s = staticBest else { return nil }
        // Bundled city: construct cache key using user's current method/school
        let cacheKey = "\(s.name)_\(method)_\(school)"
        return ResolvedCity(displayName: s.displayName, lat: s.lat, lng: s.lng,
                            cacheKey: cacheKey)
    }

    private struct ResolvedCity {
        let displayName: String
        let lat:         Double
        let lng:         Double
        let cacheKey:    String   // e.g. "stockholm_3_0"
    }

    // MARK: - Cache resolution with midnight rollover

    private struct ResolvedTimings {
        let todayDate:    String
        let tomorrowDate: String
        let todayT:       [String: String]
        let tomT:         [String: String]?
    }

    /// Returns today's and tomorrow's timings from the cache entry, with rollover:
    /// If `cache.tomorrowDate == today`, treats `cache.tomT` as today's times.
    /// Returns nil if the cache is entirely stale (both dates are in the past).
    private func resolveTimings(from cache: NativeCityCache) -> ResolvedTimings? {
        let todayStr    = isoDate(Date())
        let tomorrowStr = isoDate(Calendar.current.date(byAdding: .day, value: 1, to: Date())!)

        if cache.today == todayStr {
            // Normal case: cache was written today
            return ResolvedTimings(todayDate: cache.today,
                                   tomorrowDate: cache.tomorrow,
                                   todayT: cache.todayT,
                                   tomT: cache.tomT)
        }
        if cache.tomorrow == todayStr, let tomT = cache.tomT {
            // Midnight rollover: cache was written yesterday; tomT is now today
            // tomorrowDate is not available — native will only schedule today
            NSLog("[NativeNotif] Midnight rollover: using tomT as today's times")
            return ResolvedTimings(todayDate: todayStr,
                                   tomorrowDate: tomorrowStr,
                                   todayT: tomT,
                                   tomT: nil)
        }
        return nil
    }

    // MARK: - Change detection

    private func rescheduleNeeded(nearest: ResolvedCity,
                                  resolved: ResolvedTimings,
                                  settings: NativeSettings,
                                  existing: NotificationScheduleState?) -> Bool {
        guard let s = existing else {
            NSLog("[NativeNotif] No existing state — will schedule"); return true
        }
        if s.cityKey != nearest.cacheKey {
            NSLog("[NativeNotif] City changed: %@ → %@", s.cityKey, nearest.cacheKey); return true
        }
        if s.date != resolved.todayDate {
            NSLog("[NativeNotif] Date changed: %@ → %@", s.date, resolved.todayDate); return true
        }
        // Calculation settings change always requires a reschedule because prayer
        // times may differ even for the same city.
        if s.method != settings.calculationMethod {
            NSLog("[NativeNotif] Calculation method changed: %d → %d",
                  s.method, settings.calculationMethod); return true
        }
        if s.school != settings.school {
            NSLog("[NativeNotif] School/madhab changed: %d → %d",
                  s.school, settings.school); return true
        }
        if s.dhikrEnabled != settings.dhikrReminder {
            NSLog("[NativeNotif] Dhikr setting changed"); return true
        }
        if s.prePrayerOffset != settings.effectivePrePrayerOffset {
            NSLog("[NativeNotif] Pre-prayer offset changed: %d → %d",
                  s.prePrayerOffset, settings.effectivePrePrayerOffset); return true
        }
        let prayers = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"]
        for p in prayers {
            if absDiffMin(s.todayT?[p], resolved.todayT[p]) >= 1 {
                NSLog("[NativeNotif] %@ today time changed — rescheduling", p); return true
            }
        }
        NSLog("[NativeNotif] Schedule matches state — skipping")
        return false
    }

    // MARK: - Scheduling

    private func performSchedule(nearest: ResolvedCity,
                                 resolved: ResolvedTimings,
                                 settings: NativeSettings,
                                 defaults: UserDefaults) {
        let center = UNUserNotificationCenter.current()
        let now    = Date()
        let cal    = Calendar.current
        let todayBase    = cal.startOfDay(for: now)
        let tomorrowBase = cal.date(byAdding: .day, value: 1, to: todayBase)!
        let city = nearest.displayName

        // Remove stable prayer + dhikr identifiers synchronously (no need for async).
        var toRemove = kPrayerIdentifiers
        if settings.dhikrReminder { toRemove += kDhikrIdentifiers }
        center.removePendingNotificationRequests(withIdentifiers: toRemove)

        let prayerMap: [(String, String)] = [
            ("Fajr", "fajr"), ("Dhuhr", "dhuhr"), ("Asr", "asr"),
            ("Maghrib", "maghrib"), ("Isha", "isha"),
        ]

        // Today's main prayers
        for (apiKey, idKey) in prayerMap {
            guard let t = resolved.todayT[apiKey], !t.isEmpty,
                  let fire = parseTime(t, base: todayBase), fire > now else { continue }
            add(center, id: "andalus-prayer-today-\(idKey)",
                title: "Det är dags för \(apiKey)", body: "i \(city)", at: fire)
        }

        // Tomorrow's main prayers
        if let tomT = resolved.tomT {
            for (apiKey, idKey) in prayerMap {
                guard let t = tomT[apiKey], !t.isEmpty,
                      let fire = parseTime(t, base: tomorrowBase) else { continue }
                add(center, id: "andalus-prayer-tomorrow-\(idKey)",
                    title: "Det är dags för \(apiKey)", body: "i \(city)", at: fire)
            }
        }

        // Dhikr (60 min before Maghrib) — fixed body; JS will restore rotating message on open
        if settings.dhikrReminder {
            if let m = resolved.todayT["Maghrib"],
               let fire = parseTime(m, base: todayBase) {
                let t = fire.addingTimeInterval(-3600)
                if t > now {
                    add(center, id: "andalus-dhikr-today",
                        title: "Tid för dhikr",
                        body: "En timme kvar till Maghrib – minns Allah", at: t)
                }
            }
            if let tomT = resolved.tomT, let m = tomT["Maghrib"],
               let fire = parseTime(m, base: tomorrowBase) {
                add(center, id: "andalus-dhikr-tomorrow",
                    title: "Tid för dhikr",
                    body: "En timme kvar till Maghrib – minns Allah",
                    at: fire.addingTimeInterval(-3600))
            }
        }

        // Pre-prayer reminders — cancel by prefix first (they use date-based identifiers)
        let offset = settings.effectivePrePrayerOffset
        if offset > 0 {
            schedulePrePrayerReminders(
                offset: offset, resolved: resolved, city: city,
                todayBase: todayBase, tomorrowBase: tomorrowBase, now: now,
                center: center)
        } else {
            // Offset is "off" — cancel any stale pre-prayer reminders
            cancelPrePrayerReminders(center: center)
        }

        // Write schedule state
        let state = NotificationScheduleState(
            version:         1,
            owner:           "native",
            source:          "native_significant_location",
            cityKey:         nearest.cacheKey,
            displayName:     city,
            lat:             nearest.lat,
            lng:             nearest.lng,
            date:            resolved.todayDate,
            method:          settings.calculationMethod,
            school:          settings.school,
            todayT:          resolved.todayT,
            tomT:            resolved.tomT,
            dhikrEnabled:    settings.dhikrReminder,
            prePrayerOffset: offset,
            updatedAt:       Date().timeIntervalSince1970
        )
        writeScheduleState(state, defaults: defaults)
        NSLog("[NativeNotif] Scheduled for %@ (%@)", city, resolved.todayDate)
    }

    // MARK: - Pre-prayer reminders

    private func schedulePrePrayerReminders(offset: Int,
                                            resolved: ResolvedTimings,
                                            city: String,
                                            todayBase: Date,
                                            tomorrowBase: Date,
                                            now: Date,
                                            center: UNUserNotificationCenter) {
        cancelPrePrayerReminders(center: center) { [weak self] in
            guard let self else { return }
            let prayerKeys = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"]
            let days: [(timings: [String: String]?, base: Date, dateStr: String)] = [
                (resolved.todayT, todayBase, resolved.todayDate),
                (resolved.tomT,   tomorrowBase, resolved.tomorrowDate),
            ]
            for (timings, base, dateStr) in days {
                guard let timings else { continue }
                for key in prayerKeys {
                    guard let t = timings[key], !t.isEmpty,
                          let prayerFire = self.parseTime(t, base: base) else { continue }
                    let fire = prayerFire.addingTimeInterval(TimeInterval(-offset * 60))
                    if fire <= now { continue }
                    let id = "\(kPrePrayerPrefix)\(dateStr)-\(key.lowercased())"
                    self.add(center, id: id,
                             title: "\(key) närmar sig",
                             body:  "\(offset) min kvar",
                             at:    fire)
                }
            }
            NSLog("[NativeNotif] Pre-prayer reminders scheduled (%d min offset)", offset)
        }
    }

    private func cancelPrePrayerReminders(center: UNUserNotificationCenter,
                                          completion: (() -> Void)? = nil) {
        center.getPendingNotificationRequests { requests in
            let ids = requests
                .filter { $0.identifier.hasPrefix(kPrePrayerPrefix) }
                .map    { $0.identifier }
            if !ids.isEmpty {
                center.removePendingNotificationRequests(withIdentifiers: ids)
                NSLog("[NativeNotif] Cancelled %d stale pre-prayer reminders", ids.count)
            }
            completion?()
        }
    }

    // MARK: - Helpers

    private func add(_ center: UNUserNotificationCenter,
                     id: String, title: String, body: String, at date: Date) {
        let content       = UNMutableNotificationContent()
        content.title     = title
        content.body      = body
        content.sound     = .default
        let comps = Calendar.current.dateComponents(
            [.year, .month, .day, .hour, .minute], from: date)
        let trigger = UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)
        center.add(UNNotificationRequest(identifier: id, content: content, trigger: trigger)) { err in
            if let err {
                NSLog("[NativeNotif] Failed to schedule %@: %@", id, err.localizedDescription)
            }
        }
    }

    /// Parses "HH:mm" (may have trailing " (EET)") into a Date on `base` calendar day.
    private func parseTime(_ raw: String, base: Date) -> Date? {
        let s = raw.replacingOccurrences(of: "\\s*\\(.*\\)", with: "",
                                         options: .regularExpression)
                   .trimmingCharacters(in: .whitespaces)
        let parts = s.split(separator: ":").compactMap { Int($0) }
        guard parts.count >= 2, parts[0] < 24, parts[1] < 60 else { return nil }
        return Calendar.current.date(bySettingHour: parts[0], minute: parts[1],
                                     second: 0, of: base)
    }

    private func isoDate(_ date: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f.string(from: date)
    }

    private func haversineKm(lat1: Double, lng1: Double,
                              lat2: Double, lng2: Double) -> Double {
        let R  = 6371.0
        let φ1 = lat1 * .pi / 180, φ2 = lat2 * .pi / 180
        let Δφ = (lat2 - lat1) * .pi / 180
        let Δλ = (lng2 - lng1) * .pi / 180
        let a  = sin(Δφ/2) * sin(Δφ/2) + cos(φ1) * cos(φ2) * sin(Δλ/2) * sin(Δλ/2)
        return R * 2 * atan2(sqrt(a), sqrt(1 - a))
    }

    private func absDiffMin(_ a: String?, _ b: String?) -> Int {
        guard let a, let b else { return (a == nil) == (b == nil) ? 0 : 99 }
        let ap = a.split(separator: ":").compactMap { Int($0) }
        let bp = b.split(separator: ":").compactMap { Int($0) }
        guard ap.count >= 2, bp.count >= 2 else { return 99 }
        return abs((ap[0] * 60 + ap[1]) - (bp[0] * 60 + bp[1]))
    }

    private func markNeedsPrayerRefresh(_ defaults: UserDefaults) {
        defaults.set(true, forKey: "needsPrayerRefresh")
        defaults.set(Date().timeIntervalSince1970, forKey: "backgroundLocationDetectedAt")
        defaults.synchronize()
    }

    // MARK: - App Group reads / writes

    private func readSettings(_ defaults: UserDefaults) -> NativeSettings? {
        guard let d = defaults.data(forKey: kSettingsKey) else { return nil }
        return try? JSONDecoder().decode(NativeSettings.self, from: d)
    }

    func readLocationIndex(_ defaults: UserDefaults) -> [LocationIndexEntry]? {
        guard let d = defaults.data(forKey: kLocationIndexKey) else { return nil }
        return try? JSONDecoder().decode([LocationIndexEntry].self, from: d)
    }

    private func readMultiCityCache(_ defaults: UserDefaults) -> [String: NativeCityCache]? {
        guard let d = defaults.data(forKey: kMultiCityCacheKey) else { return nil }
        return try? JSONDecoder().decode([String: NativeCityCache].self, from: d)
    }

    func readScheduleState(_ defaults: UserDefaults) -> NotificationScheduleState? {
        guard let d = defaults.data(forKey: kScheduleStateKey) else { return nil }
        return try? JSONDecoder().decode(NotificationScheduleState.self, from: d)
    }

    func writeScheduleState(_ state: NotificationScheduleState, defaults: UserDefaults) {
        guard let d = try? JSONEncoder().encode(state) else { return }
        defaults.set(d, forKey: kScheduleStateKey)
        defaults.synchronize()
    }
}
