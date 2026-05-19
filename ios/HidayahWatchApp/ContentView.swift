import SwiftUI

struct ContentView: View {
    @ObservedObject private var session = WatchSessionHandler.shared

    private let brandGold = Color(red: 202/255, green: 180/255, blue: 136/255)
    private let bgTop     = Color(red:  18/255, green:  30/255, blue:  25/255)
    private let bgBot     = Color(red:   8/255, green:  16/255, blue:  13/255)

    private var nextPrayerName: String? {
        let now = Date()
        let cal = Calendar.current
        for p in session.dayPrayers {
            let raw   = p.time.components(separatedBy: " ").first ?? p.time
            let parts = raw.split(separator: ":").compactMap { Int($0) }
            guard parts.count >= 2 else { continue }
            var c = cal.dateComponents([.year, .month, .day], from: now)
            c.hour = parts[0]; c.minute = parts[1]; c.second = 0
            if let t = cal.date(from: c), t > now { return p.name }
        }
        return nil
    }

    var body: some View {
        ZStack {
            LinearGradient(colors: [bgTop, bgBot], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()

            if session.dayPrayers.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "iphone.circle")
                        .font(.system(size: 24))
                        .foregroundColor(brandGold.opacity(0.6))
                    Text("Öppna Hidayah\npå iPhone")
                        .font(.system(size: 12))
                        .multilineTextAlignment(.center)
                        .foregroundColor(.white.opacity(0.5))
                }
            } else {
                let nextName = nextPrayerName
                ScrollView {
                    VStack(spacing: 2) {
                        if !session.city.isEmpty {
                            Text(session.city.capitalized)
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundColor(brandGold.opacity(0.65))
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.bottom, 4)
                        }
                        ForEach(session.dayPrayers) { prayer in
                            PrayerRow(prayer: prayer,
                                      isNext: prayer.name == nextName,
                                      gold: brandGold)
                        }
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 8)
                }
            }
        }
    }
}

private struct PrayerRow: View {
    let prayer: DayPrayer
    let isNext: Bool
    let gold:   Color

    private var isPast: Bool {
        guard !isNext else { return false }
        let now = Date()
        let cal = Calendar.current
        let raw   = prayer.time.components(separatedBy: " ").first ?? prayer.time
        let parts = raw.split(separator: ":").compactMap { Int($0) }
        guard parts.count >= 2 else { return false }
        var c = cal.dateComponents([.year, .month, .day], from: now)
        c.hour = parts[0]; c.minute = parts[1]; c.second = 0
        guard let t = cal.date(from: c) else { return false }
        return t <= now
    }

    var body: some View {
        HStack {
            Text(prayer.name)
                .font(.system(size: 13, weight: isNext ? .bold : .regular))
                .foregroundColor(isNext ? gold : .white.opacity(isPast ? 0.32 : 0.85))
            Spacer()
            Text(prayer.time.components(separatedBy: " ").first ?? prayer.time)
                .font(.system(size: 13, weight: isNext ? .semibold : .regular, design: .monospaced))
                .foregroundColor(isNext ? gold : .white.opacity(isPast ? 0.32 : 0.70))
        }
        .padding(.vertical, 5)
        .padding(.horizontal, 6)
        .background(isNext ? gold.opacity(0.13) : Color.clear)
        .cornerRadius(7)
    }
}
