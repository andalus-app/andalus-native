import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { fetchPrayerTimes, fetchTomorrowPrayerTimes, calcMidnight } from './prayerApi';
import { schedulePrayerNotifications, refreshPrePrayerReminderNotifications, getNotificationDisplayName, computeWeekTimesHash, PRAYER_LOOKAHEAD_DAYS } from './notifications';
import { getPrayerTimesForRange } from './monthlyCache';
import { getIfisTimesForRange } from './ifisApi';
import { nativeReverseGeocode } from './geocoding';
import {
  getIfisTodayAndTomorrow, matchIfisCity, getIfisCityDisplayName,
  normalizeIfisCity, getIfisCitiesForMatching,
} from './ifisApi';
import {
  updateWidgetData,
  upsertCityPrayerCache,
  setNotificationScheduleState,
  getNotificationScheduleState,
  setEffectivePrayerSchedule,
  type NotificationScheduleState,
  type EffectivePrayerSchedule,
} from '../modules/WidgetData';
import { refreshVisitedPlaceMultiDayCache } from './visitedPlacesRefresh';
import { getEffectivePrayerCity } from './monthlyCache';

export const BACKGROUND_LOCATION_TASK = 'HIDAYAH_BACKGROUND_LOCATION';

const CACHE_KEY = 'andalus_prayer_cache';

function makeLocationKey(displayName: string): string {
  return displayName
    .toLowerCase()
    .replace(/å/g, 'a')
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function getTodayStr(): string {
  const n = new Date();
  return (
    String(n.getDate()).padStart(2, '0') + '-' +
    String(n.getMonth() + 1).padStart(2, '0') + '-' +
    n.getFullYear()
  );
}

function localIsoDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

    const method: number      = settings.calculationMethod ?? 3;
    const school: number      = settings.school ?? 0;
    const prayerSource: string = settings.prayerSource ?? 'aladhan';
    const savedIfisCity: string = settings.ifisCity ?? 'stockholm';

    // Read previous prayer cache before fetching — used to decide whether
    // notification rescheduling is needed after this update.
    const prevCacheRaw = await AsyncStorage.getItem(CACHE_KEY).catch(() => null);
    const prevCache = prevCacheRaw ? JSON.parse(prevCacheRaw) : null;
    const prevTodayT: Record<string, string> | null = prevCache?.todayT ?? null;
    const prevHijri: unknown = prevCache?.hijri ?? null;

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

    let todayT: Record<string, string>;
    let tomT: Record<string, string>;
    let hijri: any = null;
    let effectiveCity: string;
    let isIfis = false;

    if (prayerSource === 'ifis') {
      isIfis = true;
      // Try to match geocoded city to IFIS city list
      const knownCities  = getIfisCitiesForMatching();
      const normalizedGeo = normalizeIfisCity(geo.city || city);
      const autoMatched   = knownCities.find(c => c === normalizedGeo)
                         || matchIfisCity(geo.city || city, knownCities);
      const ifisCity      = autoMatched ?? savedIfisCity;

      // Persist updated city if changed
      if (ifisCity !== savedIfisCity) {
        const updatedSettings = { ...settings, ifisCity };
        await AsyncStorage.setItem('andalus_settings', JSON.stringify(updatedSettings)).catch(() => {});
        const appStateRaw2 = await AsyncStorage.getItem('andalus_app_state').catch(() => null);
        if (appStateRaw2) {
          try {
            const appState2 = JSON.parse(appStateRaw2);
            if (appState2.settings) appState2.settings.ifisCity = ifisCity;
            await AsyncStorage.setItem('andalus_app_state', JSON.stringify(appState2)).catch(() => {});
          } catch {}
        }
      }

      const ifisResult = await getIfisTodayAndTomorrow(ifisCity);
      todayT = ifisResult.todayT;
      tomT   = ifisResult.tomT ?? {};
      effectiveCity = getIfisCityDisplayName(ifisCity);
    } else {
      const [todayRes, tomTimings] = await Promise.all([
        fetchPrayerTimes(coords.latitude, coords.longitude, getTodayStr(), method, school),
        fetchTomorrowPrayerTimes(coords.latitude, coords.longitude, method, school),
      ]);
      todayT = { ...todayRes.timings, Midnight: calcMidnight(todayRes.timings.Maghrib, tomTimings.Fajr) || '' };
      tomT   = { ...tomTimings, Midnight: '' };
      hijri  = todayRes.hijri;
      effectiveCity = city;
    }

    // Persist resolved location — read by notifications and pre-prayer reminder scheduler.
    // Use separate city/subLocality fields (same format as the foreground prayer-tab write)
    // so the prayer tab can read cachedLoc.subLocality without having to split the string.
    await AsyncStorage.setItem('andalus_location', JSON.stringify({
      lat:         coords.latitude,
      lng:         coords.longitude,
      city:        geo.city        || city,
      subLocality: geo.subLocality || '',
      country,
    }));

    // Persist app state so AppContext hydrates the correct location on next foreground open.
    // Include suburb separately so prayer tab seed (_initCity) gets the right split.
    const appStateRaw = await AsyncStorage.getItem('andalus_app_state');
    if (appStateRaw) {
      const appState = JSON.parse(appStateRaw);
      appState.location = {
        latitude:  coords.latitude,
        longitude: coords.longitude,
        city:      geo.city        || city,
        suburb:    geo.subLocality || '',
        country,
      };
      await AsyncStorage.setItem('andalus_app_state', JSON.stringify(appState));
    }

    // Persist prayer cache for startup hydration
    if (isIfis) {
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({
        key:   `ifis:${effectiveCity.toLowerCase()}`,
        date:  getTodayStr(),
        todayT, tomT, hijri: prevHijri ?? null,
      })).catch(() => {});
    } else {
      const cacheKey = coords.latitude.toFixed(4) + ',' + coords.longitude.toFixed(4) + ',' + method + ',' + school;
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({
        key: cacheKey, date: getTodayStr(), todayT, tomT, hijri,
      })).catch(() => {});
    }

    // Write to the iOS widget App Group — same data shape used by AppContext.
    if (Platform.OS === 'ios') {
      const h = hijri;
      await updateWidgetData({
        city:      effectiveCity,
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
        hijri: (() => {
          const src: any = h ?? prevHijri;
          if (!src) return { day: 0, monthNumber: 0, monthNameEn: '', year: 0 };
          return {
            day:         parseInt(src.day           ?? '0', 10),
            monthNumber: parseInt(src.month?.number ?? '0', 10),
            monthNameEn: src.month?.en              ?? '',
            year:        parseInt(src.year          ?? '0', 10),
          };
        })(),
        date:      localIsoDate(),
        timestamp: Date.now() / 1000,
      }).catch(() => {});
    }

    // Mirror prayer times to App Group multi-city cache so the native notification
    // scheduler can reschedule in the background if the app is later killed.
    let scheduleState: NotificationScheduleState | null = null;
    if (Platform.OS === 'ios') {
      const settingsRaw2   = await AsyncStorage.getItem('andalus_settings').catch(() => null);
      const settings2      = settingsRaw2 ? JSON.parse(settingsRaw2) : {};
      const method2        = isIfis ? 3 : (settings2.calculationMethod ?? 3);
      const school2        = isIfis ? 0 : (settings2.school ?? 0);
      const alAdhanCity    = getEffectivePrayerCity(city);
      const cityKey        = isIfis
        ? `ifis_${(effectiveCity).toLowerCase()}`
        : `${alAdhanCity.toLowerCase()}_${method2}_${school2}`;
      const todayDate      = new Date();
      const tomorrowDate   = new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate() + 1);
      const reminderRaw    = await AsyncStorage.getItem('hidayah_prayer_reminder_offset').catch(() => null);
      const reminderOffset = reminderRaw ? parseInt(reminderRaw, 10) : 0;

      await upsertCityPrayerCache({
        cityKey,
        displayName:  effectiveCity,
        lat:          coords.latitude,
        lng:          coords.longitude,
        date:         localIsoDate(todayDate),
        tomorrowDate: localIsoDate(tomorrowDate),
        method:       method2,
        school:       school2,
        todayT,
        tomT: tomT ?? null,
        updatedAt:    Date.now() / 1000,
      }).catch(() => {});

      scheduleState = {
        version:                  1,
        owner:                    'js',
        source:                   'js_background',
        cityKey,
        displayName:              effectiveCity,
        notificationDisplayName:  getNotificationDisplayName(effectiveCity),
        lat:                      coords.latitude,
        lng:                      coords.longitude,
        date:                     localIsoDate(todayDate),
        method:                   method2,
        school:                   school2,
        todayT,
        tomT:                     tomT ?? undefined,
        dhikrEnabled:             settings2.dhikrReminder ?? false,
        prePrayerOffset:          isNaN(reminderOffset) ? 0 : reminderOffset,
        updatedAt:                Date.now() / 1000,
      };

      await setEffectivePrayerSchedule({
        displayName:             effectiveCity,
        notificationDisplayName: getNotificationDisplayName(effectiveCity),
        locationKey:             cityKey,
        lat:                     coords.latitude,
        lng:                     coords.longitude,
        date:                    localIsoDate(todayDate),
        tomorrowDate:            localIsoDate(tomorrowDate),
        todayTimes:              todayT,
        tomorrowTimes:           tomT ?? null,
        method:                  method2,
        school:                  school2,
        updatedAt:               Date.now() / 1000,
        source:                  'js_background',
      } as EffectivePrayerSchedule).catch(() => {});

      if (!isIfis && city) {
        refreshVisitedPlaceMultiDayCache(
          {
            locationKey:             makeLocationKey(city),
            displayName:             city,
            notificationDisplayName: getNotificationDisplayName(city),
            lat:                     coords.latitude,
            lng:                     coords.longitude,
            method:                  method2,
            school:                  school2,
            source:                  'js_background',
          },
          todayT,
          tomT ?? null,
        ).catch(() => {});
      }
    }

    // Reschedule notifications if prayer times changed OR the city name changed
    const notifCity            = isIfis ? effectiveCity : getEffectivePrayerCity(city);
    const timesChangedByMinute = !prevTodayT || maxAbsPrayerDiffMinutes(prevTodayT, todayT) >= 1;
    const cityNameChanged      = prevScheduleDisplayName !== null && notifCity !== prevScheduleDisplayName;
    let weekTimesHash: string | undefined;
    if (timesChangedByMinute || cityNameChanged) {
      // Build the multi-day dict (today/tomorrow + cache lookup) so we schedule
      // the full PRAYER_LOOKAHEAD_DAYS window even from the background path.
      const now      = new Date();
      const todayStr = localIsoDate(now);
      const tomStr   = localIsoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
      const dailyTimes: Record<string, Record<string, string>> = {};
      dailyTimes[todayStr] = todayT;
      if (tomT) dailyTimes[tomStr] = tomT;

      const extra = isIfis
        ? await getIfisTimesForRange(normalizeIfisCity(effectiveCity), PRAYER_LOOKAHEAD_DAYS)
            .catch(() => ({} as Record<string, Record<string, string>>))
        : await getPrayerTimesForRange(
            getEffectivePrayerCity(city),
            method, school,
            coords.latitude, coords.longitude,
            PRAYER_LOOKAHEAD_DAYS,
          ).catch(() => ({} as Record<string, Record<string, string>>));
      for (const [d, t] of Object.entries(extra)) {
        if (!dailyTimes[d]) dailyTimes[d] = t;
      }

      await schedulePrayerNotifications(dailyTimes, notifCity, { method, school });
      await refreshPrePrayerReminderNotifications();
      weekTimesHash = computeWeekTimesHash(dailyTimes);
    }

    // Write schedule state AFTER scheduling so schedulePrayerNotifications does not
    // read back this exact state and skip its own cancel+reschedule cycle.
    // Previously this write happened BEFORE the scheduling call, causing the
    // skip-check inside schedulePrayerNotifications to always match (it read back
    // the state we just wrote) and silently bypass the actual scheduling.
    if (scheduleState) {
      if (weekTimesHash) scheduleState.weekTimesHash = weekTimesHash;
      await setNotificationScheduleState(scheduleState).catch(() => {});
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
