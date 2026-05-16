//
//  HidayahWidgetBundle.swift
//  HidayahWidget
//

import WidgetKit
import SwiftUI

@main
struct HidayahWidgetBundle: WidgetBundle {
    var body: some Widget {
        HidayahFocusWidget()           // small – Focus Mode
        HidayahListWidget()            // small – Full List Mode
        HidayahWidget()                // medium
        HidayahPremiumMediumWidget()   // medium – premium design
        HidayahLargeWidget()           // large – Focus Mode
        HidayahOverviewWidget()        // large – Overview Mode
#if os(iOS)
        HidayahLockFocusWidget()       // lock screen – countdown timer
        HidayahLockOverviewWidget()    // lock screen – daily overview
        HidayahLockArcWidget()         // lock screen – prayer arc timeline
#endif
        HidayahAllahNameWidget()       // small + medium – daily Allah name
        HidayahDailyVerseWidget()      // small + medium – daily Quran verse
        HidayahDailyHadithWidget()     // medium – daily Hadith
        // Apple Watch complications & Smart Stack
#if !os(macOS)
        HidayahWatchCircularWidget()   // accessoryCircular – Watch/lock-screen complication
#endif
        HidayahWatchCompactWidget()    // small – compact next-prayer card
        HidayahWatchSmartStackWidget() // small – full prayer overview
    }
}
