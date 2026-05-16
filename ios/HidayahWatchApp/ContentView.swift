import SwiftUI

struct ContentView: View {
    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "moon.stars.fill")
                .font(.system(size: 40))
                .foregroundStyle(.tint)
            Text("Hidayah")
                .font(.headline)
            Text("Lägg till widgeten\npå din urtavla")
                .font(.caption)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
        }
        .padding()
    }
}
