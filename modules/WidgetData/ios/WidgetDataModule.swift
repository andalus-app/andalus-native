// WidgetDataModule.swift — Expo native module.
// Writes prayer data to the App Group shared UserDefaults and triggers
// WidgetKit to reload all timelines.

import ExpoModulesCore
import WidgetKit

public class WidgetDataModule: Module {

    private let appGroupID             = "group.com.anonymous.Hidayah"
    private let widgetDataKey          = "andalus_widget_data"
    private let effectiveScheduleKey   = "andalus_current_effective_prayer_schedule"
    private let visitedLocationsKey    = "andalus_visited_prayer_locations"
    private let kMaxVisitedEntries     = 100
    private let kDedupeProximityKm     = 0.5

    private func haversineKm(lat1: Double, lng1: Double, lat2: Double, lng2: Double) -> Double {
        let R  = 6371.0
        let φ1 = lat1 * .pi / 180, φ2 = lat2 * .pi / 180
        let Δφ = (lat2 - lat1) * .pi / 180
        let Δλ = (lng2 - lng1) * .pi / 180
        let a  = sin(Δφ/2) * sin(Δφ/2) + cos(φ1) * cos(φ2) * sin(Δλ/2) * sin(Δλ/2)
        return R * 2 * atan2(sqrt(a), sqrt(1 - a))
    }

    public func definition() -> ModuleDefinition {

        Name("WidgetDataModule")

        // updateWidgetData(data: Object) → void
        AsyncFunction("updateWidgetData") { (data: [String: Any], promise: Promise) in
            NSLog("[WidgetData] updateWidgetData called. city=%@ lat=%@ lng=%@",
                  (data["city"] as? String) ?? "nil",
                  String(describing: data["latitude"]),
                  String(describing: data["longitude"]))

            guard let defaults = UserDefaults(suiteName: self.appGroupID) else {
                NSLog("[WidgetData] ERROR: UserDefaults(suiteName: %@) returned nil — App Group not accessible", self.appGroupID)
                promise.reject("APP_GROUP_UNAVAILABLE",
                               "App Group \(self.appGroupID) is not configured.")
                return
            }
            NSLog("[WidgetData] App Group accessible ✓")

            // ── 1. Write the full JSON blob (used by widget for today's prayers) ──
            do {
                let jsonData = try JSONSerialization.data(withJSONObject: data)
                defaults.set(jsonData, forKey: self.widgetDataKey)
                NSLog("[WidgetData] JSON blob written (%d bytes)", jsonData.count)
            } catch {
                NSLog("[WidgetData] ERROR serializing: %@", error.localizedDescription)
                promise.reject("SERIALIZATION_FAILED", error.localizedDescription)
                return
            }

            // ── 2. Write individual location keys as a reliable separate fallback ──
            // These survive format changes to the JSON blob and are always readable.
            if let lat = data["latitude"]  as? Double { defaults.set(lat,  forKey: "prayer_lat");  NSLog("[WidgetData] prayer_lat = %f", lat)  }
            if let lng = data["longitude"] as? Double { defaults.set(lng,  forKey: "prayer_lng");  NSLog("[WidgetData] prayer_lng = %f", lng)  }
            if let city = data["city"]     as? String { defaults.set(city, forKey: "prayer_city"); NSLog("[WidgetData] prayer_city = %@", city) }

            defaults.synchronize()
            WidgetCenter.shared.reloadAllTimelines()
            let prayerKinds = [
                "HidayahWidget", "HidayahFocusWidget", "HidayahListWidget",
                "HidayahLargeWidget", "HidayahOverviewWidget",
                "HidayahLockFocusWidget", "HidayahLockOverviewWidget", "HidayahLockArcWidget",
            ]
            for kind in prayerKinds { WidgetCenter.shared.reloadTimelines(ofKind: kind) }
            NSLog("[WidgetData] WidgetKit reloadAllTimelines + %d individual kinds triggered ✓", prayerKinds.count)
            promise.resolve(nil)
        }

        // reloadWidgets() → void
        AsyncFunction("reloadWidgets") { (promise: Promise) in
            WidgetCenter.shared.reloadAllTimelines()
            let prayerKinds = [
                "HidayahWidget", "HidayahFocusWidget", "HidayahListWidget",
                "HidayahLargeWidget", "HidayahOverviewWidget",
                "HidayahLockFocusWidget", "HidayahLockOverviewWidget", "HidayahLockArcWidget",
            ]
            for kind in prayerKinds { WidgetCenter.shared.reloadTimelines(ofKind: kind) }
            promise.resolve(nil)
        }

        // updateDailyContent(payload: Object) → void
        // Writes today's Allah name and Quran verse to the App Group daily content
        // cache (hidayah_daily_content_cache) and reloads the daily content widgets.
        // Called on every app open — safe to call repeatedly.
        AsyncFunction("updateDailyContent") { (payload: [String: Any], promise: Promise) in
            guard let defaults = UserDefaults(suiteName: self.appGroupID) else {
                promise.resolve(nil); return
            }
            if let data = try? JSONSerialization.data(withJSONObject: payload) {
                defaults.set(data, forKey: "hidayah_daily_content_cache")
                defaults.synchronize()
                NSLog("[WidgetData] daily content cache updated: date=%@",
                      (payload["date"] as? String) ?? "?")
            }
            WidgetCenter.shared.reloadTimelines(ofKind: "HidayahAllahNameWidget")
            WidgetCenter.shared.reloadTimelines(ofKind: "HidayahDailyVerseWidget")
            WidgetCenter.shared.reloadTimelines(ofKind: "HidayahDailyHadithWidget")
            promise.resolve(nil)
        }

        // setAutoLocation(enabled: Bool) → void
        // Mirrors the JS autoLocation setting to App Group so the native
        // LocationBackgroundManager can respect it without the JS runtime.
        AsyncFunction("setAutoLocation") { (enabled: Bool, promise: Promise) in
            guard let defaults = UserDefaults(suiteName: self.appGroupID) else {
                promise.resolve(nil); return
            }
            defaults.set(enabled, forKey: "andalus_autoLocation")
            defaults.synchronize()
            NSLog("[WidgetData] andalus_autoLocation = %@", enabled ? "true" : "false")
            promise.resolve(nil)
        }

        // getBackgroundLocationUpdate() → { latitude, longitude, detectedAt } | null
        // Returns non-nil only when the native location monitor detected a new position
        // and the JS layer hasn't handled it yet (needsPrayerRefresh == true).
        AsyncFunction("getBackgroundLocationUpdate") { (promise: Promise) in
            guard let defaults = UserDefaults(suiteName: self.appGroupID) else {
                promise.resolve(nil); return
            }
            guard defaults.bool(forKey: "needsPrayerRefresh") else {
                promise.resolve(nil); return
            }
            let lat = defaults.double(forKey: "prayer_lat")
            let lng = defaults.double(forKey: "prayer_lng")
            guard lat != 0, lng != 0 else {
                promise.resolve(nil); return
            }
            let detectedAt = defaults.double(forKey: "backgroundLocationDetectedAt")
            promise.resolve([
                "latitude":   lat,
                "longitude":  lng,
                "detectedAt": detectedAt,
            ] as [String: Any])
        }

        // clearNeedsPrayerRefresh() → void
        // Called by JS after a successful full prayer-time refresh. No-op if
        // the flag was never set (safe to call unconditionally on each refresh).
        AsyncFunction("clearNeedsPrayerRefresh") { (promise: Promise) in
            guard let defaults = UserDefaults(suiteName: self.appGroupID) else {
                promise.resolve(nil); return
            }
            let wasSet = defaults.bool(forKey: "needsPrayerRefresh")
            defaults.removeObject(forKey: "needsPrayerRefresh")
            defaults.removeObject(forKey: "backgroundLocationDetectedAt")
            if wasSet {
                defaults.synchronize()
                NSLog("[WidgetData] needsPrayerRefresh cleared after successful refresh")
            }
            promise.resolve(nil)
        }

        // setNativeSettings(settings: Object) → void
        // Mirrors notification-relevant JS settings to App Group so the native
        // NativeNotificationScheduler can read them without the JS runtime.
        AsyncFunction("setNativeSettings") { (settings: [String: Any], promise: Promise) in
            guard let defaults = UserDefaults(suiteName: self.appGroupID) else {
                promise.resolve(nil); return
            }
            if let data = try? JSONSerialization.data(withJSONObject: settings) {
                defaults.set(data, forKey: "andalus_settings_native")
                defaults.synchronize()
                NSLog("[WidgetData] andalus_settings_native updated")
            }
            promise.resolve(nil)
        }

        // updateLocationIndexEntry(entry: Object) → void
        // Reads the existing location index from App Group, upserts the given entry
        // (matched by cityKey), and writes back. Idempotent — safe to call on every
        // city resolve.
        AsyncFunction("updateLocationIndexEntry") { (entry: [String: Any], promise: Promise) in
            guard let defaults = UserDefaults(suiteName: self.appGroupID) else {
                promise.resolve(nil); return
            }
            guard let cityKey = entry["cityKey"] as? String, !cityKey.isEmpty else {
                promise.resolve(nil); return
            }

            // Decode existing index; start with empty array on missing or corrupt data.
            var entries: [[String: Any]] = []
            if let existing = defaults.data(forKey: "andalus_location_index"),
               let decoded  = try? JSONSerialization.jsonObject(with: existing) as? [[String: Any]] {
                entries = decoded.filter { ($0["cityKey"] as? String) != cityKey }
            }
            entries.append(entry)

            if let data = try? JSONSerialization.data(withJSONObject: entries) {
                defaults.set(data, forKey: "andalus_location_index")
                defaults.synchronize()
                NSLog("[WidgetData] location index updated: %@ (%d entries)", cityKey, entries.count)
            }
            promise.resolve(nil)
        }

        // upsertCityPrayerCache(cache: Object) → void
        // Reads andalus_multi_city_cache (dict of cityKey → cache), upserts the entry
        // for the given city, and writes back. Entries for old days are pruned to keep
        // the cache lean (only last 7 days per city).
        AsyncFunction("upsertCityPrayerCache") { (cache: [String: Any], promise: Promise) in
            guard let defaults = UserDefaults(suiteName: self.appGroupID) else {
                promise.resolve(nil); return
            }
            guard let cityKey = cache["cityKey"] as? String, !cityKey.isEmpty else {
                promise.resolve(nil); return
            }

            var dict: [String: Any] = [:]
            if let existing = defaults.data(forKey: "andalus_multi_city_cache"),
               let decoded  = try? JSONSerialization.jsonObject(with: existing) as? [String: Any] {
                dict = decoded
            }
            dict[cityKey] = cache

            // Prune entries not updated in > 7 days to bound cache size.
            let cutoff = Date().timeIntervalSince1970 - 7 * 86_400
            dict = dict.filter { (_, v) in
                guard let entry = v as? [String: Any],
                      let ts    = entry["updatedAt"] as? Double else { return false }
                return ts >= cutoff
            }

            if let data = try? JSONSerialization.data(withJSONObject: dict) {
                defaults.set(data, forKey: "andalus_multi_city_cache")
                defaults.synchronize()
                NSLog("[WidgetData] multi-city cache upserted: %@ (%d cities)", cityKey, dict.count)
            }
            promise.resolve(nil)
        }

        // setNotificationScheduleState(state: Object) → void
        // Writes the JS notification schedule metadata to App Group so the native
        // scheduler can read it and skip rescheduling when times are unchanged.
        AsyncFunction("setNotificationScheduleState") { (state: [String: Any], promise: Promise) in
            guard let defaults = UserDefaults(suiteName: self.appGroupID) else {
                promise.resolve(nil); return
            }
            if let data = try? JSONSerialization.data(withJSONObject: state) {
                defaults.set(data, forKey: "andalus_notification_schedule_state")
                defaults.synchronize()
                NSLog("[WidgetData] notification schedule state updated (owner=%@)",
                      (state["owner"] as? String) ?? "?")
            }
            promise.resolve(nil)
        }

        // getNotificationScheduleState() → Object | null
        AsyncFunction("getNotificationScheduleState") { (promise: Promise) in
            guard let defaults = UserDefaults(suiteName: self.appGroupID),
                  let data     = defaults.data(forKey: "andalus_notification_schedule_state"),
                  let obj      = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else { promise.resolve(nil); return }
            promise.resolve(obj)
        }

        // getVisitedPrayerLocations() → Array | null
        // Returns the full andalus_visited_prayer_locations array so JS can log
        // the cache state on app open for debugging.
        AsyncFunction("getVisitedPrayerLocations") { (promise: Promise) in
            guard let defaults = UserDefaults(suiteName: self.appGroupID),
                  let data     = defaults.data(forKey: self.visitedLocationsKey),
                  let arr      = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
            else { promise.resolve(nil); return }
            promise.resolve(arr)
        }

        // getMultiCityCache() → Object (dict of cityKey → cache entry)
        // Used by nativeCacheWarmup.ts to check which cities are already fresh
        // before deciding whether to fetch from the network.
        AsyncFunction("getMultiCityCache") { (promise: Promise) in
            guard let defaults = UserDefaults(suiteName: self.appGroupID),
                  let data     = defaults.data(forKey: "andalus_multi_city_cache"),
                  let obj      = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else { promise.resolve([:] as [String: Any]); return }
            promise.resolve(obj)
        }

        // setEffectivePrayerSchedule(schedule: Object) → void
        // Writes the precise JS-resolved prayer schedule to App Group so the native
        // notification scheduler reads this BEFORE falling back to fallback-city
        // resolution. This ensures suburb-level precision (e.g. Kista Asr 17:01) is
        // preserved when a significant-location-change fires without JS being alive.
        AsyncFunction("setEffectivePrayerSchedule") { (schedule: [String: Any], promise: Promise) in
            guard let defaults = UserDefaults(suiteName: self.appGroupID) else {
                promise.resolve(nil); return
            }
            if let data = try? JSONSerialization.data(withJSONObject: schedule) {
                defaults.set(data, forKey: self.effectiveScheduleKey)
                defaults.synchronize()
                NSLog("[WidgetData] effective prayer schedule updated: displayName=%@ notifLabel=%@ Asr=%@ source=%@",
                      (schedule["displayName"] as? String) ?? "?",
                      (schedule["notificationDisplayName"] as? String) ?? "?",
                      ((schedule["todayTimes"] as? [String: Any])?["Asr"] as? String) ?? "?",
                      (schedule["source"] as? String) ?? "?")
            }
            promise.resolve(nil)
        }

        // upsertVisitedPrayerLocation(entry: Object) → void
        // Reads andalus_visited_prayer_locations (array of visited place entries),
        // upserts the given entry (matched by locationKey, then displayName, then
        // proximity < 0.5 km to avoid GPS-drift duplicates), and writes back.
        // LRU eviction keeps at most 100 entries (sorted by lastUsedAt descending).
        // Native NativeNotificationScheduler reads this cache FIRST in trySchedule(),
        // before the effective schedule, so suburb-precise times win within 2.0 km.
        AsyncFunction("upsertVisitedPrayerLocation") { (entry: [String: Any], promise: Promise) in
            guard let defaults = UserDefaults(suiteName: self.appGroupID) else {
                promise.resolve(nil); return
            }
            guard let locationKey = entry["locationKey"] as? String, !locationKey.isEmpty else {
                promise.resolve(nil); return
            }
            guard let lat = entry["lat"] as? Double, let lng = entry["lng"] as? Double,
                  lat != 0 || lng != 0 else {
                promise.resolve(nil); return
            }
            guard let todayTimes = entry["todayTimes"] as? [String: Any], !todayTimes.isEmpty else {
                promise.resolve(nil); return
            }

            var entries: [[String: Any]] = []
            if let existing = defaults.data(forKey: self.visitedLocationsKey),
               let decoded  = try? JSONSerialization.jsonObject(with: existing) as? [[String: Any]] {
                entries = decoded
            }

            let displayName = entry["displayName"] as? String ?? ""
            let entryDate   = entry["date"] as? String ?? "?"

            NSLog("[WidgetData] upsertVisited: locationKey=%@ displayName=%@ lat=%.4f lng=%.4f date=%@ Asr=%@",
                  locationKey, displayName, lat, lng, entryDate,
                  (todayTimes["Asr"] as? String) ?? "?")

            // Dump all existing entries before match so we can see what's already cached
            for (i, e) in entries.enumerated() {
                let eLat  = e["lat"]         as? Double ?? 0
                let eLng  = e["lng"]         as? Double ?? 0
                let eDist = self.haversineKm(lat1: lat, lng1: lng, lat2: eLat, lng2: eLng)
                NSLog("[WidgetData]   existingEntry[%d]: locationKey=%@ displayName=%@ lat=%.4f lng=%.4f date=%@ dist=%.2fkm",
                      i,
                      e["locationKey"]  as? String ?? "?",
                      e["displayName"]  as? String ?? "?",
                      eLat, eLng,
                      e["date"]         as? String ?? "?",
                      eDist)
            }

            // Match priority:
            //   1. locationKey exact match  — strongest identity signal
            //   2. displayName exact match  — same resolved place, possibly different GPS drift
            //   3. proximity < 0.5 km       — ONLY for legacy entries that have no locationKey
            //                                 AND no displayName (e.g. old unnamed entries).
            //                                 Never overwrite a place with a distinct identity.
            var matchIdx:    Int?    = nil
            var matchReason: String  = "none"

            // ── 1. locationKey ────────────────────────────────────────────────────────
            if let idx = entries.firstIndex(where: { ($0["locationKey"] as? String) == locationKey }) {
                matchIdx    = idx
                matchReason = "locationKey"

            // ── 2. displayName ────────────────────────────────────────────────────────
            } else if !displayName.isEmpty,
                      let idx = entries.firstIndex(where: { ($0["displayName"] as? String) == displayName }) {
                matchIdx    = idx
                matchReason = "displayName"

            // ── 3. Proximity — only for anonymous legacy entries ───────────────────────
            // An existing entry is only eligible if it has no locationKey AND no displayName,
            // so that two distinct resolved places (e.g. "Spånga, Stockholm" and
            // "Barkarby, Järfälla") can never merge via GPS proximity.
            } else {
                for (idx, e) in entries.enumerated() {
                    let eKey     = e["locationKey"] as? String ?? ""
                    let eDisplay = e["displayName"]  as? String ?? ""
                    guard eKey.isEmpty && eDisplay.isEmpty else {
                        // Both old and new entries have clear identities — never proximity-merge.
                        NSLog("[WidgetData] upsertVisited: SKIP proximity merge: distinct identity old=%@ new=%@",
                              eDisplay.isEmpty ? eKey : eDisplay,
                              displayName.isEmpty ? locationKey : displayName)
                        continue
                    }
                    guard let eLat = e["lat"] as? Double, let eLng = e["lng"] as? Double else { continue }
                    let dist = self.haversineKm(lat1: lat, lng1: lng, lat2: eLat, lng2: eLng)
                    if dist < self.kDedupeProximityKm {
                        matchIdx    = idx
                        matchReason = String(format: "legacyProximity(%.3fkm<%.1fkm)", dist, self.kDedupeProximityKm)
                        break
                    }
                }
            }

            if let idx = matchIdx {
                let old = entries[idx]
                NSLog("[WidgetData] upsertVisited: UPDATE match=%@ idx=%d oldKey=%@ oldDisplay=%@ oldLat=%.4f oldLng=%.4f oldDate=%@ → newKey=%@ newDisplay=%@ newLat=%.4f newLng=%.4f newDate=%@",
                      matchReason, idx,
                      old["locationKey"]  as? String ?? "?",
                      old["displayName"]  as? String ?? "?",
                      old["lat"]          as? Double ?? 0,
                      old["lng"]          as? Double ?? 0,
                      old["date"]         as? String ?? "?",
                      locationKey, displayName, lat, lng, entryDate)
                entries[idx] = entry
            } else {
                NSLog("[WidgetData] upsertVisited: INSERT new visited place locationKey=%@ displayName=%@ lat=%.4f lng=%.4f (cache now has %d entries)",
                      locationKey, displayName, lat, lng, entries.count + 1)
                entries.append(entry)
            }

            // LRU eviction: keep newest 100 by lastUsedAt
            if entries.count > self.kMaxVisitedEntries {
                entries.sort { ($0["lastUsedAt"] as? Double ?? 0) > ($1["lastUsedAt"] as? Double ?? 0) }
                entries = Array(entries.prefix(self.kMaxVisitedEntries))
                NSLog("[WidgetData] visited places: evicted LRU entries, kept %d", self.kMaxVisitedEntries)
            }

            if let data = try? JSONSerialization.data(withJSONObject: entries) {
                defaults.set(data, forKey: self.visitedLocationsKey)
                defaults.synchronize()
                NSLog("[WidgetData] visited places cache written: locationKey=%@ displayName=%@ Asr=%@ (%d entries)",
                      locationKey, displayName,
                      (todayTimes["Asr"] as? String) ?? "?",
                      entries.count)
            }

            // Notify LocationBackgroundManager to refresh CLRegion monitoring so the
            // newly cached place has a geofence immediately. This is the mechanism that
            // makes native background work without audio: instead of waiting for a
            // coarse significant-location-change event, iOS fires didEnterRegion the
            // moment the user crosses the 500 m boundary of a cached visited place.
            DispatchQueue.main.async {
                NotificationCenter.default.post(
                    name: NSNotification.Name("HidayahVisitedPlacesUpdated"),
                    object: nil
                )
            }

            promise.resolve(nil)
        }

        // getNativeBgDebugEvents() → Array
        // Returns the last 20 native background debug events persisted to App Group.
        // Call on app startup to diagnose TestFlight failures without Xcode attached.
        AsyncFunction("getNativeBgDebugEvents") { (promise: Promise) in
            guard let defaults = UserDefaults(suiteName: self.appGroupID),
                  let data     = defaults.data(forKey: "andalus_native_bg_debug_events"),
                  let arr      = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
            else {
                promise.resolve([] as [[String: Any]])
                return
            }
            promise.resolve(arr)
        }

        // clearPrayerCachesForMigration() → void
        // One-time migration helper for Fix 1 (UTC→local date strings).
        // Clears the four App Group keys that may contain UTC-shifted date values
        // written by the old JS logic. Absent keys are silently skipped.
        // Does NOT touch: user settings, calculation method/school, notification
        // preferences, Quran/bookmarks, widget display data, or any key outside
        // the prayer-time cache namespace.
        AsyncFunction("clearPrayerCachesForMigration") { (promise: Promise) in
            guard let defaults = UserDefaults(suiteName: self.appGroupID) else {
                NSLog("[CacheMigration] App Group unavailable — cannot clear caches")
                promise.resolve(nil); return
            }
            let keysToRemove: [(key: String, label: String)] = [
                ("andalus_visited_prayer_locations",         "visitedPrayerLocations"),
                ("andalus_multi_city_cache",                 "multiCityCache"),
                ("andalus_current_effective_prayer_schedule","effectiveSchedule"),
                ("andalus_notification_schedule_state",      "scheduleState"),
            ]
            for pair in keysToRemove {
                if defaults.object(forKey: pair.key) != nil {
                    defaults.removeObject(forKey: pair.key)
                    NSLog("[CacheMigration] Cleared %@ (%@)", pair.label, pair.key)
                } else {
                    NSLog("[CacheMigration] Already absent: %@ (%@)", pair.label, pair.key)
                }
            }
            defaults.synchronize()
            NSLog("[CacheMigration] All prayer caches cleared — ready for v2 rebuild")
            promise.resolve(nil)
        }
    }
}
