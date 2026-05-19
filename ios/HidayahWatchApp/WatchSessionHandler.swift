import WatchConnectivity
import WidgetKit

struct DayPrayer: Identifiable {
    let id:   String
    let name: String
    let time: String
}

final class WatchSessionHandler: NSObject, ObservableObject, WCSessionDelegate {
    static let shared = WatchSessionHandler()

    private let appGroup     = "group.com.anonymous.Hidayah"
    private let watchDataKey = "watch_prayer_data"

    @Published var dayPrayers: [DayPrayer] = []
    @Published var city: String = ""

    private override init() { super.init() }

    func activate() {
        loadFromDefaults()
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
        NSLog("[WatchSession] WCSession activation requested")
    }

    func session(_ session: WCSession,
                 didReceiveApplicationContext applicationContext: [String: Any]) {
        if let prayerData = applicationContext["watchPrayerData"] as? [String: Any] {
            persist(prayerData)
        }
    }

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
        updatePublished(from: data)
        WidgetCenter.shared.reloadAllTimelines()
        WidgetCenter.shared.reloadTimelines(ofKind: "HidayahWatchWidget")
    }

    private func loadFromDefaults() {
        guard let defaults = UserDefaults(suiteName: appGroup),
              let raw  = defaults.data(forKey: watchDataKey),
              let json = try? JSONSerialization.jsonObject(with: raw) as? [String: Any]
        else { return }
        updatePublished(from: json)
    }

    private func updatePublished(from data: [String: Any]) {
        DispatchQueue.main.async { [weak self] in
            self?.city = (data["city"] as? String) ?? ""
            if let prayers = data["prayers"] as? [[String: Any]] {
                self?.dayPrayers = prayers.compactMap { p in
                    guard let name = p["name"] as? String,
                          let time = p["time"] as? String
                    else { return nil }
                    return DayPrayer(id: name, name: name, time: time)
                }
            }
        }
    }
}
