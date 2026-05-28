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
  version:                  number;
  owner:                    'js' | 'native';
  source:                   'app_open' | 'js_background' | 'native_significant_location' | 'native_precise_cache' | 'native_fallback_city' | 'native_visited_place_cache';
  cityKey:                  string;
  /** Effective prayer/display location. Used for UI, widget, cache lookup,
   *  schedule metadata and debugging. Never use this alone for notification bodies. */
  displayName:              string;
  /** Human-friendly label used ONLY in notification body text.
   *  Derived from displayName: "Kista, Stockholm" → "Stockholm".
   *  Optional so old native-written state (without this field) is still valid. */
  notificationDisplayName?: string;
  lat:                      number;
  lng:                      number;
  date:                     string;
  method:                   number;
  school:                   number;
  todayT?:                  Record<string, string>;
  tomT?:                    Record<string, string>;
  /** Stable fingerprint of the full 1-to-7 day prayer schedule that was queued.
   *  Written by JS when a multi-day schedule is set; absent when native writes
   *  state (native only covers today+tomorrow). When present, scheduleStateUnchanged
   *  can short-circuit the per-day comparison loop. */
  weekTimesHash?:           string;
  dhikrEnabled:             boolean;
  prePrayerOffset:          number;   // 0 = off; matches hidayah_prayer_reminder_offset
  updatedAt:                number;   // Unix seconds
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
 * Reads the full andalus_visited_prayer_locations array from App Group.
 * Returns null if nothing has been written yet.
 * Used for debugging — call on app startup to verify the visited cache state.
 */
export async function getVisitedPrayerLocations(): Promise<unknown[] | null> {
  if (!NativeModule) return null;
  return NativeModule.getVisitedPrayerLocations() ?? null;
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

/**
 * Precise effective prayer schedule written by JS to App Group after every
 * successful prayer fetch. Native reads this FIRST in trySchedule() before
 * falling back to fallback-city resolution. This ensures suburb-level prayer
 * times (e.g. Kista Asr 17:01) are used instead of the nearest bundled
 * municipality times (Stockholm Asr 17:00) when a background location event
 * fires and the user is still near the last JS-resolved location.
 */
export interface EffectivePrayerSchedule {
  /** Full precise geocoded name — "Kista, Stockholm" or "Stockholm". */
  displayName:             string;
  /** Label shown in notification body only — "Stockholm" for all Stockholm-area suburbs. */
  notificationDisplayName: string;
  /** Multi-city cache key — e.g. "stockholm_3_0". Optional for legacy compat. */
  locationKey?:            string;
  lat:                     number;
  lng:                     number;
  /** "yyyy-MM-dd" — today's date when the schedule was fetched. */
  date:                    string;
  /** "yyyy-MM-dd" — tomorrow's date. */
  tomorrowDate:            string;
  todayTimes:              Record<string, string>;
  tomorrowTimes:           Record<string, string> | null;
  method:                  number;
  school:                  number;
  highLatitudeRule?:       string;
  updatedAt:               number;   // Unix seconds
  source:                  'js_precise_location' | 'js_background';
}

/**
 * Writes the precise effective prayer schedule to App Group
 * (key: andalus_current_effective_prayer_schedule).
 * Call after every successful prayer fetch in AppContext and backgroundLocation.
 */
export async function setEffectivePrayerSchedule(
  schedule: EffectivePrayerSchedule,
): Promise<void> {
  if (!NativeModule) return;
  return NativeModule.setEffectivePrayerSchedule(schedule);
}

/**
 * One entry in the visited prayer locations cache (andalus_visited_prayer_locations).
 * Written by JS after every precise prayer fetch so native can match coordinates to
 * previously-visited places with suburb-level accuracy (e.g. "Spånga, Stockholm").
 */
export interface VisitedPrayerLocation {
  /** Slug derived from displayName — "Spånga, Stockholm" → "spanga_stockholm". */
  locationKey:             string;
  /** Full geocoded name — "Spånga, Stockholm" or "Järfälla". */
  displayName:             string;
  /** Notification body label — "Stockholm" for all Stockholm-area suburbs. */
  notificationDisplayName: string;
  lat:                     number;
  lng:                     number;
  method:                  number;
  school:                  number;
  /** "yyyy-MM-dd" — today's date when the entry was written. */
  date:                    string;
  /** "yyyy-MM-dd" — tomorrow's date. */
  tomorrowDate:            string;
  todayTimes:              Record<string, string>;
  tomorrowTimes:           Record<string, string> | null;
  /**
   * Rolling 7-day cache keyed by "yyyy-MM-dd".
   * Native reads dailyTimesByDate[today] first; falls back to date/todayTimes
   * for entries written before this field was introduced.
   */
  dailyTimesByDate?:       Record<string, Record<string, string>>;
  /** Unix seconds — when this entry was written. */
  updatedAt:               number;
  /** Unix seconds — updated on every write; used for LRU eviction at 100 entries. */
  lastUsedAt:              number;
  source:                  'js_precise_location' | 'js_background';
}

/**
 * Upserts a visited prayer location entry in the App Group cache
 * (key: andalus_visited_prayer_locations, max 100 entries, LRU eviction).
 *
 * Matching order: locationKey → displayName → proximity (< 0.5 km).
 * The native significant-location scheduler reads this FIRST (before the
 * effective schedule) so that a 2.0 km radius match gives suburb-precise
 * prayer times even when the phone is locked.
 *
 * After writing, the native module posts HidayahVisitedPlacesUpdated which
 * causes LocationBackgroundManager to refresh its CLCircularRegion set so
 * the newly cached place has a 500 m geofence immediately.
 */
export async function upsertVisitedPrayerLocation(entry: VisitedPrayerLocation): Promise<void> {
  if (!NativeModule) return;
  return NativeModule.upsertVisitedPrayerLocation(entry);
}

/**
 * Returns the last ≤ 20 native background debug events persisted to App Group.
 * Each event: { ts, event, lat?, lng?, message, source?, displayName?, authStatus? }
 *
 * Events are written by LocationBackgroundManager on every key background action:
 *   - "setup"              — app launched, authorizationStatus recorded
 *   - "authChange"         — CLAuthorizationStatus changed
 *   - "didUpdateLocations" — significant-location-change fired
 *   - "didEnterRegion"     — geofence entry for a cached visited place
 *   - "reloadTimelines"    — WidgetCenter.reloadAllTimelines() called (includes selected city)
 *   - "earlyReturn"        — any early-return path with reason
 *
 * Use this on app startup to diagnose TestFlight failures without Xcode:
 *   if nativeLocationDidFire is absent → iOS never delivered a location event
 *   if didEnterRegion present but widget stale → bug in data write path
 *   if authStatus != 4 (authorizedAlways) → user has only "When In Use"
 */
export async function getNativeBgDebugEvents(): Promise<unknown[]> {
  if (!NativeModule) return [];
  return NativeModule.getNativeBgDebugEvents() ?? [];
}

/**
 * Clears the four App Group prayer-cache keys that may contain UTC-shifted date
 * strings written by the old JS logic (Fix 1). Called once at app startup when
 * prayerCacheDateKeyVersion < 2. Idempotent — absent keys are silently skipped.
 *
 * Keys cleared:
 *   andalus_visited_prayer_locations          (visited places + dailyTimesByDate)
 *   andalus_multi_city_cache                  (multi-city fallback cache)
 *   andalus_current_effective_prayer_schedule (effective schedule)
 *   andalus_notification_schedule_state       (schedule state / change detection)
 *
 * Does NOT touch: user settings, calculation method/school, notification
 * preferences, Quran/bookmarks, widget display data, or AsyncStorage.
 */
export async function clearPrayerCachesForMigration(): Promise<void> {
  if (!NativeModule) return;
  return NativeModule.clearPrayerCachesForMigration();
}

export interface VerseDay {
  swedish:     string;
  arabic:      string;
  surahName:   string;
  surahNumber: number;
  ayahNumber:  number;
  reference:   string;
}

/**
 * Writes a 30-day verse lookup map to App Group (key: hidayah_verse_30day_cache).
 * The widget reads today's entry from this map, so it shows the correct verse
 * even if the app hasn't been opened for up to 30 days.
 */
export async function setVerse30DayCache(payload: {
  version:   number;
  writtenAt: string;
  verses:    Record<string, VerseDay>;
}): Promise<void> {
  if (!NativeModule) return;
  return NativeModule.setVerse30DayCache(payload);
}

/**
 * Writes today's Allah name and Quran verse to the App Group daily content
 * cache (key: hidayah_daily_content_cache) and triggers timeline reloads for
 * HidayahAllahNameWidget and HidayahDailyVerseWidget.
 *
 * Safe to call on every app open — idempotent, non-blocking.
 */
export async function updateDailyContent(payload: {
  date:      string;    // "yyyy-MM-dd"
  updatedAt: number;    // Unix seconds
  allahName: {
    nameNr:          number;
    arabic:          string;
    transliteration: string;
    swedish:         string;
    explanation:     string;
  };
  quranVerse: {
    swedish:     string;
    surahName:   string;
    surahNumber: number;
    ayahNumber:  number;
    reference:   string;
    arabic:      string;
  };
  hadith: {
    hadith_nr: number;
    arabic:    string;
    swedish:   string;
    source:    string;
  };
}): Promise<void> {
  if (!NativeModule) return;
  return NativeModule.updateDailyContent(payload);
}
