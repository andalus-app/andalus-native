import WatchConnectivity

// Sends prayer payload to the paired Apple Watch via WCSession.
// Called from WidgetDataModule.updateWidgetData after the iOS App Group is written.
final class WatchConnectivityBridge: NSObject, WCSessionDelegate {
    static let shared = WatchConnectivityBridge()

    private override init() {
        super.init()
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
        NSLog("[WatchConnectivity] iOS session activation requested")
    }

    func sendPrayerData(_ data: [String: Any]) {
        guard WCSession.isSupported(),
              WCSession.default.activationState == .activated,
              WCSession.default.isWatchAppInstalled
        else {
            NSLog("[WatchConnectivity] skip send — not paired/activated")
            return
        }
        do {
            try WCSession.default.updateApplicationContext(["watchPrayerData": data])
            NSLog("[WatchConnectivity] updateApplicationContext sent: city=%@",
                  (data["city"] as? String) ?? "?")
        } catch {
            NSLog("[WatchConnectivity] updateApplicationContext failed: %@",
                  error.localizedDescription)
        }
    }

    // MARK: WCSessionDelegate (iOS-only methods)
    func session(_ session: WCSession,
                 activationDidCompleteWith activationState: WCSessionActivationState,
                 error: Error?) {
        NSLog("[WatchConnectivity] iOS session activated: state=%d watchAppInstalled=%@",
              activationState.rawValue,
              session.isWatchAppInstalled ? "true" : "false")
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}

    func sessionDidDeactivate(_ session: WCSession) {
        WCSession.default.activate()
    }
}
