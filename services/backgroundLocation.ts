import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { fetchPrayerTimes, fetchTomorrowPrayerTimes, calcMidnight } from './prayerApi';
import { schedulePrayerNotifications, refreshPrePrayerReminderNotifications } from './notifications';
import { nativeReverseGeocode } from './geocoding';
import { updateWidgetData } from '../modules/WidgetData';

export const BACKGROUND_LOCATION_TASK = 'HIDAYAH_BACKGROUND_LOCATION';

// Must match distanceInterval below so the secondary check is consistent.
const MIN_MOVE_METERS = 1000;

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getTodayStr(): string {
  const n = new Date();
  return (
    String(n.getDate()).padStart(2, '0') + '-' +
    String(n.getMonth() + 1).padStart(2, '0') + '-' +
    n.getFullYear()
  );
}

// Must be at module root — expo-task-manager requirement.
// iOS may launch the JS bundle in background without mounting any React view,
// so this handler must never depend on React state or component lifecycle.
TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }: TaskManager.TaskManagerTaskBody<{ locations: Location.LocationObject[] }>) => {
  if (error) return;
  const locations = (data as { locations: Location.LocationObject[] } | undefined)?.locations;
  if (!locations?.length) return;

  const { coords } = locations[locations.length - 1];

  try {
    // Respect manual city mode — never override if the user has disabled auto-location.
    const settingsRaw = await AsyncStorage.getItem('andalus_settings');
    const settings = settingsRaw ? JSON.parse(settingsRaw) : {};
    if (settings.autoLocation === false) return;

    const method: number = settings.calculationMethod ?? 3;
    const school: number = settings.school ?? 0;

    // Skip if the device hasn't moved meaningfully since the last processed location.
    // If no location is stored yet (first run / cache cleared), process unconditionally.
    const stored = await AsyncStorage.getItem('andalus_location');
    if (stored) {
      const storedLoc = JSON.parse(stored) as { lat: number; lng: number };
      if (distanceMeters(storedLoc.lat, storedLoc.lng, coords.latitude, coords.longitude) < MIN_MOVE_METERS) return;
    }

    const geo = await nativeReverseGeocode(coords.latitude, coords.longitude);
    const city = geo.subLocality && geo.city && geo.subLocality !== geo.city
      ? `${geo.subLocality}, ${geo.city}`
      : geo.city || geo.subLocality || '';
    const country = geo.country;

    const [todayRes, tomTimings] = await Promise.all([
      fetchPrayerTimes(coords.latitude, coords.longitude, getTodayStr(), method, school),
      fetchTomorrowPrayerTimes(coords.latitude, coords.longitude, method, school),
    ]);
    const todayT = { ...todayRes.timings, Midnight: calcMidnight(todayRes.timings.Maghrib, tomTimings.Fajr) || '' };
    const tomT   = { ...tomTimings, Midnight: '' };

    // Persist resolved location — read by notifications and pre-prayer reminder scheduler.
    await AsyncStorage.setItem('andalus_location', JSON.stringify({
      lat: coords.latitude,
      lng: coords.longitude,
      city,
      country,
    }));

    // Persist app state so AppContext hydrates the correct location on next foreground open.
    const appStateRaw = await AsyncStorage.getItem('andalus_app_state');
    if (appStateRaw) {
      const appState = JSON.parse(appStateRaw);
      appState.location = { latitude: coords.latitude, longitude: coords.longitude, city, country };
      await AsyncStorage.setItem('andalus_app_state', JSON.stringify(appState));
    }

    // Persist prayer cache so the app shows correct times immediately on next open
    // without waiting for a foreground network fetch.
    const cacheKey = coords.latitude.toFixed(4) + ',' + coords.longitude.toFixed(4) + ',' + method + ',' + school;
    await AsyncStorage.setItem('andalus_prayer_cache', JSON.stringify({
      key:    cacheKey,
      date:   getTodayStr(),
      todayT,
      tomT,
      hijri:  todayRes.hijri,
    }));

    // Write to the iOS widget App Group — same data shape used by AppContext.
    // This is the step that actually makes the widget show the new city without
    // requiring the user to open the app.
    if (Platform.OS === 'ios') {
      const h = todayRes.hijri;
      await updateWidgetData({
        city,
        latitude:  coords.latitude,
        longitude: coords.longitude,
        prayers: [
          { name: 'Fajr',       time: todayT.Fajr    ?? '' },
          { name: 'Soluppgång', time: todayT.Sunrise  ?? '' },
          { name: 'Dhuhr',      time: todayT.Dhuhr   ?? '' },
          { name: 'Asr',        time: todayT.Asr     ?? '' },
          { name: 'Maghrib',    time: todayT.Maghrib ?? '' },
          { name: 'Isha',       time: todayT.Isha    ?? '' },
        ],
        hijri: {
          day:         parseInt(h?.day           ?? '0', 10),
          monthNumber: parseInt(h?.month?.number ?? '0', 10),
          monthNameEn: h?.month?.en              ?? '',
          year:        parseInt(h?.year          ?? '0', 10),
        },
        date:      new Date().toISOString().slice(0, 10),
        timestamp: Date.now() / 1000,
      }).catch(() => {});
    }

    // Reschedule prayer notifications for the new city/times.
    await schedulePrayerNotifications(todayT, tomT, city);
    await refreshPrePrayerReminderNotifications();
  } catch {}
});

/**
 * Start background location updates. No-op if:
 * - Background permission is not "granted" (iOS requires Always)
 * - Updates are already running
 *
 * Use Location.hasStartedLocationUpdatesAsync (not TaskManager.isTaskRegisteredAsync)
 * because isTaskRegisteredAsync reflects JS task registration, not whether
 * startLocationUpdatesAsync has actually been called with the OS.
 */
export async function startBackgroundLocationUpdates(): Promise<void> {
  try {
    const { status } = await Location.getBackgroundPermissionsAsync();
    if (status !== 'granted') return;

    if (await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)) return;

    await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      // Fire only after the device has moved at least 1 km — avoids waking the
      // JS engine for tiny drifts while the user is stationary.
      distanceInterval:        1000,
      // Batch iOS updates: defer delivery until 1 km has accumulated OR 12 minutes
      // have passed, whichever comes first. Reduces wake-ups while travelling.
      deferredUpdatesDistance: 1000,
      deferredUpdatesInterval: 12 * 60 * 1000,
      // Never let iOS pause updates automatically. When set to true, iOS can
      // silently stop delivering location events (e.g. when a user is on public
      // transport), causing the widget to stay on the departure city indefinitely.
      pausesUpdatesAutomatically: false,
      // ActivityType.Other is safer than OtherNavigation — OtherNavigation hints
      // to CoreLocation that the user is in a navigation app, which can trigger
      // different power-saving heuristics.
      activityType: Location.ActivityType.Other,
      showsBackgroundLocationIndicator: false,
      foregroundService: {
        // Android only — iOS ignores this block.
        notificationTitle: 'Hidayah',
        notificationBody:  'Uppdaterar bönetider baserat på din plats',
        notificationColor: '#18311e',
      },
    });
  } catch {}
}

/** Stop background location updates. No-op if not running. */
export async function stopBackgroundLocationUpdates(): Promise<void> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    }
  } catch {}
}
