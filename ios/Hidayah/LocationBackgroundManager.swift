// LocationBackgroundManager.swift
// Two complementary background-location mechanisms:
//
// 1. Significant-location-change monitoring (CLLocationManager)
//    Cell-tower based, low power, survives termination. iOS fires at its
//    own discretion for moves of ~500 m–3 km. Good catch-all but unreliable
//    for short urban hops (Kista ↔ Spånga, ~6 km).
//
// 2. CLCircularRegion monitoring around recently visited places
//    Fires the moment the user crosses a 500 m boundary around a cached
//    visited place. Far more reliable for known locations than
//    significant-location-change for short urban moves.
//    iOS allows up to 20 monitored regions per app; we use ≤ 15.
//
// On any location event (significant-change OR region entry):
//   - Requires andalus_autoLocation = true in App Group.
//   - Writes prayer_lat / prayer_lng.
//   - Calls NativeNotificationScheduler.trySchedule which:
//       • Finds nearest valid visited place (5 km radius) OR
//       • Reuses effective JS-precise schedule (25 km) OR
//       • Resolves nearest bundled city (100 km safety cap)
//     and writes complete widget data (city, prayer times) for the winner.
//   - Sets needsPrayerRefresh = true so JS does a full refresh on next open.
//   - Calls WidgetCenter.reloadAllTimelines().
//
// Debug events:
//   Every key event is appended to andalus_native_bg_debug_events (max 20).
//   Read from JS via WidgetDataModule.getNativeBgDebugEvents() to diagnose
//   TestFlight failures without Xcode attached.
//
// NOTE: Force-quit suppresses significant-location-change relaunch.
// Region-entry relaunch works even after force-quit in some iOS versions but
// is not guaranteed. Normal backgrounding/suspension always works.

import CoreLocation
import WidgetKit

// MARK: - Minimal decodable for region refresh (avoids cross-module dependency)

private struct VisitedPlaceForRegion: Decodable {
    let locationKey: String
    let displayName: String
    let lat:         Double
    let lng:         Double
    let lastUsedAt:  Double
}

// MARK: - LocationBackgroundManager

final class LocationBackgroundManager: NSObject, CLLocationManagerDelegate {

    static let shared = LocationBackgroundManager()

    private let manager  = CLLocationManager()
    private let appGroup = "group.com.anonymous.Hidayah"

    private let kVisitedLocationsKey   = "andalus_visited_prayer_locations"
    private let kDebugEventsKey        = "andalus_native_bg_debug_events"
    private let kRegionPrefix          = "hidayah-visited-"
    private let kMaxMonitoredRegions   = 15
    private let kRegionRadiusMeters: Double = 500
    private let kMaxDebugEvents        = 20

    private override init() {
        super.init()
        manager.delegate = self

        // Refresh monitored regions when JS writes new visited-place cache.
        // WidgetDataModule posts this notification after every upsert.
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleVisitedPlacesUpdated),
            name: NSNotification.Name("HidayahVisitedPlacesUpdated"),
            object: nil
        )
    }

    // MARK: - Setup (call from AppDelegate on every launch)

    /// Must be called from application(_:didFinishLaunchingWithOptions:) on every launch
    /// including background relaunches triggered by location or region events.
    func setup() {
        let status = manager.authorizationStatus
        NSLog("[LocationBG] setup: authorizationStatus=%ld", status.rawValue)

        if let defaults = UserDefaults(suiteName: appGroup) {
            appendDebugEvent(defaults, event: "setup",
                             message: "authorizationStatus=\(status.rawValue)",
                             authStatus: Int(status.rawValue))
        }

        switch status {
        case .authorizedAlways:
            manager.startMonitoringSignificantLocationChanges()
            NSLog("[LocationBG] setup: significant location monitoring started ✓")
            if let defaults = UserDefaults(suiteName: appGroup) {
                refreshMonitoredRegions(defaults: defaults)
            }
        case .notDetermined:
            NSLog("[LocationBG] setup: not determined — deferred until permission granted")
        case .authorizedWhenInUse:
            NSLog("[LocationBG] setup: whenInUse — Always required; background monitoring not active")
            if let defaults = UserDefaults(suiteName: appGroup) {
                appendDebugEvent(defaults, event: "earlyReturn",
                                 message: "authorizedWhenInUse — background monitoring unavailable. User must grant Always in Settings.")
            }
        case .denied:
            NSLog("[LocationBG] setup: denied — monitoring not started")
        case .restricted:
            NSLog("[LocationBG] setup: restricted — monitoring not started")
        @unknown default:
            NSLog("[LocationBG] setup: unknown status %ld", status.rawValue)
        }
    }

    // MARK: - CLLocationManagerDelegate — authorization

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        NSLog("[LocationBG] authorization changed: status=%ld", status.rawValue)

        if let defaults = UserDefaults(suiteName: appGroup) {
            appendDebugEvent(defaults, event: "authChange",
                             message: "authorizationStatus=\(status.rawValue)",
                             authStatus: Int(status.rawValue))
        }

        switch status {
        case .authorizedAlways:
            manager.startMonitoringSignificantLocationChanges()
            NSLog("[LocationBG] authorizedAlways — significant location monitoring started ✓")
            if let defaults = UserDefaults(suiteName: appGroup) {
                refreshMonitoredRegions(defaults: defaults)
            }
        default:
            manager.stopMonitoringSignificantLocationChanges()
            // Stop all hidayah regions
            for region in manager.monitoredRegions where region.identifier.hasPrefix(kRegionPrefix) {
                manager.stopMonitoring(for: region)
            }
            NSLog("[LocationBG] authorization no longer Always — monitoring stopped")
        }
    }

    // MARK: - CLLocationManagerDelegate — significant location change

    func locationManager(_ manager: CLLocationManager,
                         didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else {
            NSLog("[LocationBG] didUpdateLocations: empty array")
            return
        }

        let lat = loc.coordinate.latitude
        let lng = loc.coordinate.longitude
        NSLog("[LocationBG] didUpdateLocations: lat=%.4f lng=%.4f hAcc=%.0fm", lat, lng, loc.horizontalAccuracy)

        guard let defaults = UserDefaults(suiteName: appGroup) else {
            NSLog("[LocationBG] ERROR: App Group not accessible")
            return
        }

        appendDebugEvent(defaults, event: "didUpdateLocations",
                         lat: lat, lng: lng,
                         message: String(format: "hAcc=%.0fm", loc.horizontalAccuracy),
                         authStatus: Int(manager.authorizationStatus.rawValue))

        let autoLocationObj = defaults.object(forKey: "andalus_autoLocation")
        let autoLocation    = autoLocationObj as? Bool ?? false
        guard autoLocation else {
            let reason = autoLocationObj == nil ? "key missing" : "false"
            NSLog("[LocationBG] didUpdateLocations: autoLocation=%@ — early return", reason)
            appendDebugEvent(defaults, event: "earlyReturn",
                             lat: lat, lng: lng,
                             message: "autoLocation=\(reason)")
            return
        }

        processLocationEvent(lat: lat, lng: lng, defaults: defaults, trigger: "significantChange")
    }

    // MARK: - CLLocationManagerDelegate — region monitoring

    func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        guard region.identifier.hasPrefix(kRegionPrefix) else { return }

        let locationKey = String(region.identifier.dropFirst(kRegionPrefix.count))
        NSLog("[LocationBG] didEnterRegion: %@", locationKey)

        guard let defaults = UserDefaults(suiteName: appGroup) else { return }

        let autoLocation = defaults.object(forKey: "andalus_autoLocation") as? Bool ?? false
        guard autoLocation else {
            NSLog("[LocationBG] didEnterRegion: autoLocation off — skip")
            return
        }

        // Resolve the visited place coordinates from the cache
        guard let raw    = defaults.data(forKey: kVisitedLocationsKey),
              let places = try? JSONDecoder().decode([VisitedPlaceForRegion].self, from: raw),
              let place  = places.first(where: { $0.locationKey == locationKey })
        else {
            NSLog("[LocationBG] didEnterRegion: locationKey=%@ not found in cache", locationKey)
            appendDebugEvent(defaults, event: "earlyReturn",
                             message: "didEnterRegion: locationKey=\(locationKey) not in visited cache")
            return
        }

        NSLog("[LocationBG] didEnterRegion matched: %@ (%.4f, %.4f)",
              place.displayName, place.lat, place.lng)
        appendDebugEvent(defaults, event: "didEnterRegion",
                         lat: place.lat, lng: place.lng,
                         message: "Entered region for \(place.displayName)",
                         displayName: place.displayName)

        processLocationEvent(lat: place.lat, lng: place.lng, defaults: defaults, trigger: "regionEntry")
    }

    func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
        // Exit events intentionally ignored — we only act on entry.
    }

    func locationManager(_ manager: CLLocationManager,
                         monitoringDidFailFor region: CLRegion?,
                         withError error: Error) {
        NSLog("[LocationBG] region monitoring failed: %@ — %@",
              region?.identifier ?? "nil", error.localizedDescription)
        if let defaults = UserDefaults(suiteName: appGroup) {
            appendDebugEvent(defaults, event: "earlyReturn",
                             message: "regionMonitoringFail: \(region?.identifier ?? "nil") \(error.localizedDescription)")
        }
    }

    func locationManager(_ manager: CLLocationManager,
                         didStartMonitoringFor region: CLRegion) {
        NSLog("[LocationBG] monitoring started: %@", region.identifier)
    }

    func locationManager(_ manager: CLLocationManager,
                         didFailWithError error: Error) {
        NSLog("[LocationBG] location error: %@", error.localizedDescription)
    }

    // MARK: - Shared location event processing

    /// Common path for both significant-location-change and region-entry events.
    private func processLocationEvent(lat: Double, lng: Double,
                                      defaults: UserDefaults,
                                      trigger: String) {
        // Write new coordinates so widget Path-2 uses them even if trySchedule fails.
        defaults.set(lat, forKey: "prayer_lat")
        defaults.set(lng, forKey: "prayer_lng")
        defaults.set(true, forKey: "needsPrayerRefresh")
        defaults.set(Date().timeIntervalSince1970, forKey: "backgroundLocationDetectedAt")
        defaults.synchronize()

        NativeNotificationScheduler.shared.trySchedule(lat: lat, lng: lng,
                                                       defaults: defaults) { [weak self] (scheduled: Bool) in
            guard let self else { return }

            if scheduled {
                NSLog("[LocationBG] (%@) native notifications rescheduled", trigger)
            } else {
                NSLog("[LocationBG] (%@) notification reschedule skipped — JS will handle on open", trigger)
            }

            // Log the outcome so we can read it from JS on next app open
            if let d = UserDefaults(suiteName: self.appGroup) {
                let widgetCity = self.readCurrentWidgetCity(d)
                self.appendDebugEvent(d,
                                      event: "reloadTimelines",
                                      lat: lat, lng: lng,
                                      message: "trigger=\(trigger) scheduled=\(scheduled) widgetCity=\(widgetCity ?? "nil")",
                                      displayName: widgetCity)
            }

            WidgetCenter.shared.reloadAllTimelines()
            NSLog("[LocationBG] (%@) WidgetCenter.reloadAllTimelines called at ts=%.0f",
                  trigger, Date().timeIntervalSince1970)

            // Also reload each widget kind individually so WidgetKit schedules a
            // getTimeline call for every family, even if reloadAllTimelines is throttled.
            let widgetKinds = [
                "HidayahWidget", "HidayahPremiumMediumWidget", "HidayahFocusWidget", "HidayahListWidget",
                "HidayahLargeWidget", "HidayahOverviewWidget",
                "HidayahLockFocusWidget", "HidayahLockOverviewWidget", "HidayahLockArcWidget",
            ]
            for kind in widgetKinds {
                WidgetCenter.shared.reloadTimelines(ofKind: kind)
            }
            NSLog("[LocationBG] (%@) reloadTimelines(ofKind:) called for %d kinds",
                  trigger, widgetKinds.count)
        }
    }

    // MARK: - Region monitoring refresh

    /// Refreshes CLCircularRegion monitoring for the most recently visited places.
    /// Uses a diff strategy: keeps existing regions that are still valid, adds new ones,
    /// removes stale ones. Safe to call on every app launch or visited-places update.
    /// Must be called on the main thread (CLLocationManager requirement).
    func refreshMonitoredRegions(defaults: UserDefaults) {
        guard manager.authorizationStatus == .authorizedAlways else {
            NSLog("[LocationBG] refreshMonitoredRegions: not authorizedAlways — skip")
            return
        }

        let places: [VisitedPlaceForRegion]
        if let raw  = defaults.data(forKey: kVisitedLocationsKey),
           let arr  = try? JSONDecoder().decode([VisitedPlaceForRegion].self, from: raw) {
            // Most recently used first, capped at kMaxMonitoredRegions
            places = Array(arr.sorted { $0.lastUsedAt > $1.lastUsedAt }.prefix(kMaxMonitoredRegions))
        } else {
            places = []
        }

        let desiredIDs  = Set(places.map { kRegionPrefix + $0.locationKey })
        let existingIDs = Set(manager.monitoredRegions
            .filter { $0.identifier.hasPrefix(kRegionPrefix) }
            .map    { $0.identifier })

        // Remove regions no longer needed
        for region in manager.monitoredRegions where region.identifier.hasPrefix(kRegionPrefix) {
            if !desiredIDs.contains(region.identifier) {
                manager.stopMonitoring(for: region)
                NSLog("[LocationBG] region removed: %@", region.identifier)
            }
        }

        // Add new regions
        for place in places {
            let id = kRegionPrefix + place.locationKey
            guard !existingIDs.contains(id) else { continue }
            let region = CLCircularRegion(
                center:     CLLocationCoordinate2D(latitude: place.lat, longitude: place.lng),
                radius:     kRegionRadiusMeters,
                identifier: id
            )
            region.notifyOnEntry = true
            region.notifyOnExit  = false
            manager.startMonitoring(for: region)
            NSLog("[LocationBG] region added: %@ (%.4f, %.4f) r=%.0fm",
                  place.displayName, place.lat, place.lng, kRegionRadiusMeters)
        }

        NSLog("[LocationBG] refreshMonitoredRegions: %d desired, %d total after refresh",
              places.count, manager.monitoredRegions.filter { $0.identifier.hasPrefix(kRegionPrefix) }.count)
    }

    // MARK: - Notification from WidgetDataModule

    @objc private func handleVisitedPlacesUpdated() {
        // Called when JS writes a new visited place. Refresh region monitoring
        // on the main thread (CLLocationManager requirement).
        DispatchQueue.main.async { [weak self] in
            guard let self,
                  let defaults = UserDefaults(suiteName: self.appGroup) else { return }
            self.refreshMonitoredRegions(defaults: defaults)
        }
    }

    // MARK: - Debug event log

    /// Appends one event to andalus_native_bg_debug_events (max 20).
    /// Readable from JS via WidgetDataModule.getNativeBgDebugEvents().
    private func appendDebugEvent(_ defaults: UserDefaults,
                                  event: String,
                                  lat: Double? = nil,
                                  lng: Double? = nil,
                                  message: String,
                                  source: String? = nil,
                                  displayName: String? = nil,
                                  authStatus: Int? = nil) {
        var events: [[String: Any]] = []
        if let d   = defaults.data(forKey: kDebugEventsKey),
           let arr = try? JSONSerialization.jsonObject(with: d) as? [[String: Any]] {
            events = arr
        }

        var entry: [String: Any] = [
            "ts":      Date().timeIntervalSince1970,
            "event":   event,
            "message": message,
        ]
        if let lat         { entry["lat"]         = lat }
        if let lng         { entry["lng"]         = lng }
        if let source      { entry["source"]      = source }
        if let displayName { entry["displayName"] = displayName }
        if let authStatus  { entry["authStatus"]  = authStatus }

        events.append(entry)
        if events.count > kMaxDebugEvents {
            events = Array(events.suffix(kMaxDebugEvents))
        }

        if let data = try? JSONSerialization.data(withJSONObject: events) {
            defaults.set(data, forKey: kDebugEventsKey)
            // Do not call synchronize() here — we're often in a fast path;
            // the OS will flush within a few seconds.
        }
    }

    // MARK: - Helpers

    private func readCurrentWidgetCity(_ defaults: UserDefaults) -> String? {
        guard let d       = defaults.data(forKey: "andalus_widget_data"),
              let obj     = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
              let city    = obj["city"] as? String else { return nil }
        return city
    }
}
