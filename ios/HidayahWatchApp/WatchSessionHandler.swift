import WatchConnectivity
import WidgetKit

// Singleton WCSession delegate for the Watch app.
// Receives prayer payload from the iPhone app and writes it to the shared
// watchOS App Group so the HidayahWatchWidget can read it.
final class WatchSessionHandler: NSObject, ObservableObject, WCSessionDelegate {
    static let shared = WatchSessionHandler()

    private let appGroup    = "group.com.anonymous.Hidayah"
    private let watchDataKey = "watch_prayer_data"

    private override init() { super.init() }

    func activate() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
        NSLog("[WatchSession] WCSession activation requested")
    }

    // Called when new context arrives while the app is running.
    func session(_ session: WCSession,
                 didReceiveApplicationContext applicationContext: [String: Any]) {
        if let prayerData = applicationContext["watchPrayerData"] as? [String: Any] {
            persist(prayerData)
        }
    }

    // Called when activation completes — pick up any context sent while app was inactive.
    func session(_ session: WCSession,
                 activationDidCompleteWith activationState: WCSessionActivationState,
                 error: Error?) {
        NSLog("[WatchSession] activated: state=%d", activationState.rawValue)
        guard activationState == .activated else { return }
        let ctx = session.receivedApplicationContext
        if let prayerData = ctx["watchPrayerData"] as? [String: Any] {
            persist(prayerData)
        }
    }

    private func persist(_ data: [String: Any]) {
        guard let defaults = UserDefaults(suiteName: appGroup),
              let jsonData = try? JSONSerialization.data(withJSONObject: data)
        else {
            NSLog("[WatchSession] failed to persist data")
            return
        }
        defaults.set(jsonData, forKey: watchDataKey)
        defaults.synchronize()
        NSLog("[WatchSession] prayer data persisted: city=%@",
              (data["city"] as? String) ?? "?")
        WidgetCenter.shared.reloadAllTimelines()
        WidgetCenter.shared.reloadTimelines(ofKind: "HidayahWatchWidget")
    }
}
