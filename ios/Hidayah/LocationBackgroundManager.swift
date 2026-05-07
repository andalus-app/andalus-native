// LocationBackgroundManager.swift
// Low-power significant-location-change monitoring using CoreLocation.
//
// Significant-location monitoring allows iOS to relaunch the app for low-power
// location events in supported conditions. It is more reliable than JS-only
// background location, but still controlled by iOS and can be affected by
// Background App Refresh settings, permissions, Low Power Mode, and user/system
// behavior. It does not guarantee delivery in all termination cases.
//
// What this does on a location event:
//   - Requires andalus_autoLocation = true in App Group (written by JS on setting
//     change). If the key is absent or false, the update is dropped silently.
//   - Writes new prayer_lat / prayer_lng to App Group.
//   - Writes backgroundLocationDetectedAt — a separate signal that is NOT the same
//     as lastUpdatedAt (the prayer-data timestamp in andalus_widget_data).
//   - Sets needsPrayerRefresh = true so the JS layer does a full refresh on
//     next foreground open.
//   - Calls WidgetCenter.reloadAllTimelines() so the widget bypasses Path-1 and
//     fetches fresh prayer times via its own Path-2 API fallback.
//
// What this intentionally does NOT do:
//   - Does not write prayer_city  — city name is unknown without geocoding.
//   - Does not update andalus_widget_data — prayer times are not recalculated.
//   - Does not touch lastUpdatedAt — that timestamp only changes on a full JS refresh.
//
// Manual test cases:
//   A. Auto location ON, app closed, move Stockholm → Kista:
//      Expected: prayer_lat/lng updated, needsPrayerRefresh = true,
//      widget bypasses Path-1, fetches Kista prayer times via Path-2,
//      widget shows old city until app open completes full refresh.
//   B. Auto location OFF (manual city):
//      Expected: native handler returns immediately, no App Group changes.
//   C. Auto location ON, but key not yet written to App Group (first install):
//      Expected: native handler returns immediately (defaults to false = safe).
//   D. App open after scenario A (network available):
//      Expected: full refresh completes, needsPrayerRefresh cleared, widget
//      shows correct city + prayer times, lastUpdatedAt updated.
//   E. App open after scenario A (network unavailable):
//      Expected: refresh fails, needsPrayerRefresh stays set, retried on next open.

import CoreLocation
import WidgetKit

final class LocationBackgroundManager: NSObject, CLLocationManagerDelegate {

    static let shared = LocationBackgroundManager()

    private let manager  = CLLocationManager()
    private let appGroup = "group.com.anonymous.Hidayah"

    private override init() {
        super.init()
        manager.delegate = self
    }

    // MARK: - Setup

    /// Call once from AppDelegate.application(_:didFinishLaunchingWithOptions:).
    /// Safe on every launch — startMonitoringSignificantLocationChanges() is
    /// idempotent and required on background relaunches triggered by location events.
    func setup() {
        switch manager.authorizationStatus {
        case .authorizedAlways:
            manager.startMonitoringSignificantLocationChanges()
            NSLog("[LocationBG] Significant location monitoring started")
        case .notDetermined:
            // Authorization will be requested by the JS layer (expo-location).
            // We'll start monitoring once the user grants Always in the delegate below.
            NSLog("[LocationBG] Authorization not determined — will start after grant")
        default:
            NSLog("[LocationBG] Authorization not Always — monitoring not started")
        }
    }

    // MARK: - CLLocationManagerDelegate

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        switch manager.authorizationStatus {
        case .authorizedAlways:
            manager.startMonitoringSignificantLocationChanges()
            NSLog("[LocationBG] Authorization changed to Always — monitoring started")
        default:
            manager.stopMonitoringSignificantLocationChanges()
            NSLog("[LocationBG] Authorization changed — monitoring stopped")
        }
    }

    func locationManager(_ manager: CLLocationManager,
                         didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }

        guard let defaults = UserDefaults(suiteName: appGroup) else {
            NSLog("[LocationBG] ERROR: App Group not accessible")
            return
        }

        // Require explicit opt-in. If the key is absent (JS has never run on this install),
        // default to false — do not modify App Group data until the user has opened the
        // app and the setting has been written. This prevents unexpected city/prayer
        // overwrites on a fresh install before the user configures the app.
        let autoLocation = defaults.object(forKey: "andalus_autoLocation") as? Bool ?? false
        guard autoLocation else {
            NSLog("[LocationBG] autoLocation not enabled — skipping background location update")
            return
        }

        let lat = loc.coordinate.latitude
        let lng = loc.coordinate.longitude

        // Write new coordinates so the widget's Path-2 API fallback uses the new
        // location when today's prayer data becomes stale (e.g. after midnight).
        // prayer_city is intentionally left unchanged — it is stale until the JS layer
        // resolves the new city name via reverse geocoding on next foreground open.
        defaults.set(lat, forKey: "prayer_lat")
        defaults.set(lng, forKey: "prayer_lng")

        // needsPrayerRefresh and backgroundLocationDetectedAt are written here as a
        // baseline. The notification scheduler below may produce a successful reschedule
        // for a cached city, in which case those fields remain set so the JS layer
        // still does a full refresh (city name, hijri, widget data) on next open.
        defaults.set(true, forKey: "needsPrayerRefresh")
        defaults.set(Date().timeIntervalSince1970, forKey: "backgroundLocationDetectedAt")
        defaults.synchronize()

        // Attempt native notification rescheduling. This runs asynchronously
        // because UNUserNotificationCenter callbacks use completion handlers.
        // WidgetCenter reload is called regardless — widget Path-2 will use
        // the updated prayer_lat/lng even if notification scheduling is skipped.
        NativeNotificationScheduler.shared.trySchedule(lat: lat, lng: lng,
                                                       defaults: defaults) { scheduled in
            if scheduled {
                NSLog("[LocationBG] Native notifications rescheduled for new location")
            } else {
                NSLog("[LocationBG] Native notification reschedule skipped — JS will handle on next open")
            }
            WidgetCenter.shared.reloadAllTimelines()
        }

        NSLog("[LocationBG] Significant location detected: lat=%.4f lng=%.4f", lat, lng)
    }

    func locationManager(_ manager: CLLocationManager,
                         didFailWithError error: Error) {
        // Significant-location monitoring rarely fails; log and continue.
        NSLog("[LocationBG] Error: %@", error.localizedDescription)
    }
}
