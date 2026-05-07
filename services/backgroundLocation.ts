import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { fetchPrayerTimes, fetchTomorrowPrayerTimes, calcMidnight } from './prayerApi';
import { schedulePrayerNotifications, refreshPrePrayerReminderNotifications } from './notifications';
import { nativeReverseGeocode } from './geocoding';
import {
  updateWidgetData,
  upsertCityPrayerCache,
  setNotificationScheduleState,
  getNotificationScheduleState,
  type NotificationScheduleState,
} from '../modules/WidgetData';
import { getEffectivePrayerCity } from './monthlyCache';

export const BACKGROUND_LOCATION_TASK = 'HIDAYAH_BACKGROUND_LOCATION';

const CACHE_KEY = 'andalus_prayer_cache';

function getTodayStr(): string {
  const n = new Date();
  return (
    String(n.getDate()).padStart(2, '0') + '-' +
    String(n.getMonth() + 1).padStart(2, '0') + '-' +
    n.getFullYear()
  );
}

// Returns the largest absolute difference (minutes) across the main prayers
// between two timing objects. Used to skip notification rescheduling when
// the user only moved a few hundred metres and prayer times didn't change.
function maxAbsPrayerDiffMinutes(
  prev: Record<string, string>,
  next: Record<string, string>,
): number {
  const keys = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
  let max = 0;
  for (const k of keys) {
    const p = prev[k]; const n = next[k];
    if (!p || !n) continue;
    const [ph, pm] = p.split(':').map(Number);
    const [nh, nm] = n.split(':').map(Number);
    if (isNaN(ph) || isNaN(pm) || isNaN(nh) || isNaN(nm)) continue;
    const diff = Math.abs((ph * 60 + pm) - (nh * 60 + nm));
    if (diff > max) max = diff;
  }
  return max;
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

    // Read previous prayer cache before fetching — used to decide whether
    // notification rescheduling is needed after this update.
    const prevCacheRaw = await AsyncStorage.getItem(CACHE_KEY).catch(() => null);
    const prevTodayT: Record<string, string> | null = prevCacheRaw
      ? (JSON.parse(prevCacheRaw).todayT ?? null)
      : null;

    // Read the current schedule state so we can detect a city-name change even
    // when prayer times are similar (e.g. native used "Stockholm", JS resolves
    // the precise suburb as "Kista, Stockholm").
    const prevScheduleDisplayName = Platform.OS === 'ios'
      ? await getNotificationScheduleState().then(s => s?.displayName ?? null).catch(() => null)
      : null;

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
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({
      key:    cacheKey,
      date:   getTodayStr(),
      todayT,
      tomT,
      hijri:  todayRes.hijri,
    }));

    // Write to the iOS widget App Group — same data shape used by AppContext.
    // This is the step that makes the widget show the new city without the user
    // opening the app (when the JS runtime is alive via background location mode).
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

    // Mirror prayer times to App Group multi-city cache so the native notification
    // scheduler can reschedule in the background if the app is later killed.
    if (Platform.OS === 'ios') {
      const effectiveCity    = getEffectivePrayerCity(city);
      const settingsRaw2     = await AsyncStorage.getItem('andalus_settings').catch(() => null);
      const settings2        = settingsRaw2 ? JSON.parse(settingsRaw2) : {};
      const method2: number  = settings2.calculationMethod ?? 3;
      const school2: number  = settings2.school ?? 0;
      const cityKey          = `${effectiveCity.toLowerCase()}_${method2}_${school2}`;
      const todayDate        = new Date();
      const tomorrowDate     = new Date(Date.now() + 86_400_000);
      const reminderRaw      = await AsyncStorage.getItem('hidayah_prayer_reminder_offset').catch(() => null);
      const reminderOffset   = reminderRaw ? parseInt(reminderRaw, 10) : 0;

      await upsertCityPrayerCache({
        cityKey,
        displayName:  effectiveCity,
        lat:          coords.latitude,
        lng:          coords.longitude,
        date:         todayDate.toISOString().slice(0, 10),
        tomorrowDate: tomorrowDate.toISOString().slice(0, 10),
        method:       method2,
        school:       school2,
        todayT,
        tomT: tomT ?? null,
        updatedAt:    Date.now() / 1000,
      }).catch(() => {});

      const scheduleState: NotificationScheduleState = {
        version:         1,
        owner:           'js',
        source:          'js_background',
        cityKey,
        displayName:     effectiveCity,
        lat:             coords.latitude,
        lng:             coords.longitude,
        date:            todayDate.toISOString().slice(0, 10),
        method:          method2,
        school:          school2,
        todayT,
        tomT:            tomT ?? undefined,
        dhikrEnabled:    settings2.dhikrReminder ?? false,
        prePrayerOffset: isNaN(reminderOffset) ? 0 : reminderOffset,
        updatedAt:       Date.now() / 1000,
      };
      await setNotificationScheduleState(scheduleState).catch(() => {});
    }

    // Reschedule notifications if prayer times changed OR the city name (display label)
    // changed — the label appears in every notification body and must stay accurate.
    const effectiveCityForNotif = getEffectivePrayerCity(city);
    const timesChangedByMinute  = !prevTodayT || maxAbsPrayerDiffMinutes(prevTodayT, todayT) >= 1;
    const cityNameChanged        = prevScheduleDisplayName !== null && effectiveCityForNotif !== prevScheduleDisplayName;
    if (timesChangedByMinute || cityNameChanged) {
      await schedulePrayerNotifications(todayT, tomT, effectiveCityForNotif, { method, school });
      await refreshPrePrayerReminderNotifications();
    }
  } catch {}
});

/**
 * Start background location updates. No-op if:
 * - Background permission is not "granted" (iOS requires Always)
 * - Updates are already running
 *
 * distanceInterval: 500 m — avoids firing on GPS noise or short movements that
 * don't change prayer times. The native significant-location layer handles
 * city-to-city wakeups when the JS runtime is not alive.
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
      distanceInterval: 500,
      pausesUpdatesAutomatically: false,
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
