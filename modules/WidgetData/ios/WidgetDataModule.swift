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
    }
}
