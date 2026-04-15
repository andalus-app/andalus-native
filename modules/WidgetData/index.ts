import { requireOptionalNativeModule } from 'expo-modules-core';

// Optional — app continues normally if the native module is unavailable.
// Widget data updates are silently skipped in that case.
const NativeModule = requireOptionalNativeModule('WidgetDataModule');

export interface WidgetPrayerTime {
  name: string;
  time: string;
}

export interface WidgetHijriDate {
  day: number;
  monthNumber: number;
  monthNameEn: string;
  year: number;
}

export interface WidgetData {
  city: string;
  /** Decimal latitude — stored so widget can re-fetch when data is stale */
  latitude: number;
  /** Decimal longitude — stored so widget can re-fetch when data is stale */
  longitude: number;
  prayers: WidgetPrayerTime[];
  hijri: WidgetHijriDate;
  /** "yyyy-MM-dd" gregorian date string — used by widget to detect stale data */
  date: string;
  timestamp: number;
}

/**
 * Writes prayer data to the App Group shared UserDefaults and triggers
 * WidgetKit to reload all timelines. Call this after every successful
 * prayer time fetch in AppContext.
 */
export async function updateWidgetData(data: WidgetData): Promise<void> {
  if (!NativeModule) return;
  return NativeModule.updateWidgetData(data);
}

/**
 * Forces a WidgetKit timeline reload without writing new data.
 * Useful when returning from background to ensure widgets are current.
 */
export async function reloadWidgets(): Promise<void> {
  if (!NativeModule) return;
  return NativeModule.reloadWidgets();
}
