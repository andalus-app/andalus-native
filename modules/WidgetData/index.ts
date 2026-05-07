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

/**
 * Mirrors the JS autoLocation setting to App Group UserDefaults so the native
 * LocationBackgroundManager can respect it without the JS runtime being alive.
 * Call whenever autoLocation changes and on app startup.
 */
export async function setAutoLocation(enabled: boolean): Promise<void> {
  if (!NativeModule) return;
  return NativeModule.setAutoLocation(enabled);
}

export interface BackgroundLocationUpdate {
  latitude: number;
  longitude: number;
  /** Unix seconds — when iOS detected the significant location change. */
  detectedAt: number;
}

/**
 * Returns the background-detected location if the native monitor set
 * needsPrayerRefresh while the app was closed, null otherwise.
 * Call on app startup; if non-null, a full location + prayer-time refresh is needed.
 */
export async function getBackgroundLocationUpdate(): Promise<BackgroundLocationUpdate | null> {
  if (!NativeModule) return null;
  return NativeModule.getBackgroundLocationUpdate();
}

/**
 * Clears the needsPrayerRefresh flag after JS has completed the full refresh.
 */
export async function clearNeedsPrayerRefresh(): Promise<void> {
  if (!NativeModule) return;
  return NativeModule.clearNeedsPrayerRefresh();
}

/** Settings the native notification scheduler needs — mirrored to App Group on change. */
export interface NativeSettings {
  notifications:              boolean;
  calculationMethod:          number;
  school:                     number;
  dhikrReminder:              boolean;
  prePrayerReminderOffset:    number;  // 0 = off; 15 / 30 / 45 / 60 = enabled
}

/**
 * Mirrors notification-relevant settings to App Group so NativeNotificationScheduler
 * can read them without the JS runtime. Call on startup and when settings change.
 */
export async function setNativeSettings(settings: NativeSettings): Promise<void> {
  if (!NativeModule) return;
  return NativeModule.setNativeSettings(settings);
}

/** One entry in the native-readable location index. */
export interface LocationIndexEntry {
  cityKey:     string;   // e.g. "stockholm_3_0"
  displayName: string;   // e.g. "Stockholm"
  lat:         number;
  lng:         number;
  method:      number;
  school:      number;
}

/**
 * Upserts a location entry in the App Group location index (keyed by cityKey).
 * Called whenever the app resolves a city so the native scheduler can find
 * the nearest cached location without network access.
 */
export async function updateLocationIndexEntry(entry: LocationIndexEntry): Promise<void> {
  if (!NativeModule) return;
  return NativeModule.updateLocationIndexEntry(entry);
}

/** Shape of the native-readable prayer cache written to App Group. */
export interface NativePrayerCache {
  cityKey:      string;
  displayName:  string;
  lat:          number;
  lng:          number;
  date:         string;         // "yyyy-MM-dd" — Swift CodingKey maps this to "today"
  tomorrowDate: string;         // "yyyy-MM-dd" — Swift CodingKey maps this to "tomorrow"
  method:       number;
  school:       number;
  todayT:  Record<string, string>;
  tomT:    Record<string, string> | null;
  updatedAt:    number;         // Unix seconds — required for 7-day cache pruning
}

/**
 * Upserts today/tomorrow prayer times for one city into the multi-city App Group
 * cache (andalus_multi_city_cache). Call after every successful prayer-time fetch.
 * The cache accumulates entries for every city the user has opened the app in;
 * native uses it to schedule notifications without network access.
 */
export async function upsertCityPrayerCache(cache: NativePrayerCache): Promise<void> {
  if (!NativeModule) return;
  return NativeModule.upsertCityPrayerCache(cache);
}

/** Shared notification schedule metadata written by both JS and Native. */
export interface NotificationScheduleState {
  version:         number;
  owner:           'js' | 'native';
  source:          'app_open' | 'js_background' | 'native_significant_location';
  cityKey:         string;
  displayName:     string;
  lat:             number;
  lng:             number;
  date:            string;
  method:          number;
  school:          number;
  todayT?:         Record<string, string>;
  tomT?:           Record<string, string>;
  dhikrEnabled:    boolean;
  prePrayerOffset: number;   // 0 = off; matches hidayah_prayer_reminder_offset
  updatedAt:       number;   // Unix seconds
}

/**
 * Writes the JS notification schedule metadata to App Group.
 * Call after every successful schedulePrayerNotifications() so the native
 * scheduler can skip rescheduling when times are unchanged.
 */
export async function setNotificationScheduleState(
  state: NotificationScheduleState,
): Promise<void> {
  if (!NativeModule) return;
  return NativeModule.setNotificationScheduleState(state);
}

/**
 * Reads the last notification schedule state from App Group.
 * Returns null if nothing has been written yet.
 */
export async function getNotificationScheduleState(): Promise<NotificationScheduleState | null> {
  if (!NativeModule) return null;
  return NativeModule.getNotificationScheduleState();
}

/**
 * Reads the full andalus_multi_city_cache from App Group.
 * Returns an empty object if the cache has not been written yet.
 * Used by nativeCacheWarmup to check which cities are already fresh.
 */
export async function getMultiCityCache(): Promise<Record<string, unknown>> {
  if (!NativeModule) return {};
  return NativeModule.getMultiCityCache() ?? {};
}
