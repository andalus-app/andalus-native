// WidgetDataModule.swift — Expo native module.
// Writes prayer data to the App Group shared UserDefaults and triggers
// WidgetKit to reload all timelines.

import ExpoModulesCore
import WidgetKit

public class WidgetDataModule: Module {

    private let appGroupID    = "group.com.anonymous.Hidayah"
    private let widgetDataKey = "andalus_widget_data"

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
            NSLog("[WidgetData] WidgetKit reloadAllTimelines triggered ✓")
            promise.resolve(nil)
        }

        // reloadWidgets() → void
        AsyncFunction("reloadWidgets") { (promise: Promise) in
            WidgetCenter.shared.reloadAllTimelines()
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
    }
}
