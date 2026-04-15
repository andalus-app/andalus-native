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
        HidayahLargeWidget()           // large – Focus Mode
        HidayahOverviewWidget()        // large – Overview Mode
#if os(iOS)
        HidayahLockFocusWidget()       // lock screen – countdown timer
        HidayahLockOverviewWidget()    // lock screen – daily overview
#endif
    }
}
