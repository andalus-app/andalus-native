import SwiftUI

@main
struct HidayahWatchApp: App {
    @StateObject private var session = WatchSessionHandler.shared

    var body: some Scene {
        WindowGroup {
            ContentView()
                .onAppear { session.activate() }
        }
    }
}
