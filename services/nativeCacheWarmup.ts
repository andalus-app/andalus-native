// nativeCacheWarmup.ts
// Pre-populates andalus_multi_city_cache for all 25 bundled fallback cities.
//
// WHY: NativeNotificationScheduler.swift can resolve any location in Sweden to
// the nearest bundled city, but it can only schedule if that city's prayer times
// exist in the native cache. Without warmup, Uppsala→Spånga would fail if the
// user has never opened the app in Stockholm.
//
// HOW:
//   - Runs in background after the main prayer fetch succeeds in AppContext.
//   - Reads the current cache and skips cities already cached for today with
//     the current method+school — no network activity on same-day re-opens.
//   - Fetches in batches of 3 to limit concurrent connections.
//   - Fire-and-forget: callers do not await.
//
// SETTINGS INVALIDATION:
//   Cache keys include method and school (e.g. "stockholm_3_0").
//   When settings change, new keys are populated on the next app open.
//   Old keys expire and are pruned by the 7-day logic in upsertCityPrayerCache.
//
// CITY LIST SYNC:
//   Must match bundledLocations in NativeNotificationScheduler.swift exactly.
//   If you add/remove cities here, update the Swift array too.

import { Platform } from 'react-native';
import { fetchPrayerTimes, fetchTomorrowPrayerTimes, calcMidnight } from './prayerApi';
import { upsertCityPrayerCache, getMultiCityCache } from '../modules/WidgetData';

// "dd-MM-yyyy" format required by the aladhan API
function apiDateStr(): string {
  const n = new Date();
  return String(n.getDate()).padStart(2, '0') + '-' +
         String(n.getMonth() + 1).padStart(2, '0') + '-' +
         n.getFullYear();
}

// "yyyy-MM-dd" format used in cache storage and Swift date comparison
function isoDateStr(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

interface FallbackCity {
  name:        string;   // normalized lowercase — matches Swift bundledLocations[i].name
  displayName: string;
  lat:         number;
  lng:         number;
}

// Keep in sync with bundledLocations in NativeNotificationScheduler.swift.
const FALLBACK_CITIES: FallbackCity[] = [
  { name: 'stockholm',   displayName: 'Stockholm',   lat: 59.3293, lng: 18.0686 },
  { name: 'göteborg',    displayName: 'Göteborg',     lat: 57.7089, lng: 11.9746 },
  { name: 'malmö',       displayName: 'Malmö',        lat: 55.6050, lng: 13.0038 },
  { name: 'uppsala',     displayName: 'Uppsala',      lat: 59.8586, lng: 17.6389 },
  { name: 'västerås',    displayName: 'Västerås',     lat: 59.6162, lng: 16.5528 },
  { name: 'örebro',      displayName: 'Örebro',       lat: 59.2753, lng: 15.2134 },
  { name: 'linköping',   displayName: 'Linköping',    lat: 58.4108, lng: 15.6214 },
  { name: 'helsingborg', displayName: 'Helsingborg',  lat: 56.0467, lng: 12.6945 },
  { name: 'jönköping',   displayName: 'Jönköping',    lat: 57.7826, lng: 14.1618 },
  { name: 'norrköping',  displayName: 'Norrköping',   lat: 58.5877, lng: 16.1924 },
  { name: 'lund',        displayName: 'Lund',         lat: 55.7047, lng: 13.1910 },
  { name: 'umeå',        displayName: 'Umeå',         lat: 63.8258, lng: 20.2630 },
  { name: 'gävle',       displayName: 'Gävle',        lat: 60.6749, lng: 17.1413 },
  { name: 'borås',       displayName: 'Borås',        lat: 57.7210, lng: 12.9401 },
  { name: 'södertälje',  displayName: 'Södertälje',   lat: 59.1955, lng: 17.6253 },
  { name: 'eskilstuna',  displayName: 'Eskilstuna',   lat: 59.3666, lng: 16.5077 },
  { name: 'karlstad',    displayName: 'Karlstad',     lat: 59.3793, lng: 13.5036 },
  { name: 'växjö',       displayName: 'Växjö',        lat: 56.8777, lng: 14.8091 },
  { name: 'halmstad',    displayName: 'Halmstad',     lat: 56.6745, lng: 12.8577 },
  { name: 'sundsvall',   displayName: 'Sundsvall',    lat: 62.3908, lng: 17.3069 },
  { name: 'huddinge',    displayName: 'Huddinge',     lat: 59.2366, lng: 17.9810 },
  { name: 'botkyrka',    displayName: 'Botkyrka',     lat: 59.2005, lng: 17.8280 },
  { name: 'järfälla',    displayName: 'Järfälla',     lat: 59.4131, lng: 17.8340 },
  { name: 'sollentuna',  displayName: 'Sollentuna',   lat: 59.4282, lng: 17.9508 },
  { name: 'solna',       displayName: 'Solna',        lat: 59.3597, lng: 18.0009 },
];

/**
 * Warms up andalus_multi_city_cache for all 25 bundled fallback cities.
 * Safe to call on every app open — skips cities already fresh for today.
 * Runs 3 cities at a time, fire-and-forget.
 *
 * After this completes, NativeNotificationScheduler can reschedule Uppsala→Spånga
 * (or any bundled-city transition) without the user having previously visited that city.
 */
export async function warmupNativeCache(method: number, school: number): Promise<void> {
  if (Platform.OS !== 'ios') return;

  const today = isoDateStr();

  // Read current cache to avoid redundant fetches
  const existing = await getMultiCityCache().catch(() => ({}));

  // Determine which cities actually need fetching
  const toFetch = FALLBACK_CITIES.filter(city => {
    const key    = `${city.name}_${method}_${school}`;
    const cached = (existing as Record<string, Record<string, unknown>>)[key];
    if (!cached) return true;

    // Wrong calculation settings (user changed method/school)
    if (cached.method !== method || cached.school !== school) return true;

    // Stale: neither 'date' nor 'tomorrowDate' matches today
    // (tomorrowDate match covers the midnight-rollover case)
    const cacheDate    = cached.date    as string | undefined;
    const cacheTomDate = cached.tomorrowDate as string | undefined;
    if (cacheDate !== today && cacheTomDate !== today) return true;

    return false;
  });

  if (toFetch.length === 0) return;

  if (__DEV__) {
    console.log(`[NativeCacheWarmup] warming ${toFetch.length} cities (method=${method} school=${school})`);
  }

  // Batch fetches: 3 concurrent cities at a time.
  // 25 cities × 2 API calls each = 50 calls total on first launch (cold cache).
  // With batches of 3: ~9 rounds × ~500 ms/round ≈ 5–8 s of background activity.
  // Subsequent same-day opens skip all fetches (0 calls).
  // 200 ms inter-batch delay keeps the API load gentle across the full warmup.
  const BATCH = 3;
  for (let i = 0; i < toFetch.length; i += BATCH) {
    const results = await Promise.allSettled(
      toFetch.slice(i, i + BATCH).map(city => fetchAndCache(city, method, school)),
    );
    if (__DEV__) {
      results.forEach((r, idx) => {
        if (r.status === 'rejected') {
          const cityName = toFetch[i + idx]?.displayName ?? '?';
          console.warn(`[NativeCacheWarmup] failed for ${cityName}:`, r.reason);
        }
      });
    }
    // Pause between batches so we do not flood aladhan.com
    if (i + BATCH < toFetch.length) {
      await new Promise<void>(resolve => setTimeout(resolve, 200));
    }
  }

  if (__DEV__) {
    console.log('[NativeCacheWarmup] complete');
  }
}

async function fetchAndCache(
  city: FallbackCity,
  method: number,
  school: number,
): Promise<void> {
  const [todayRes, tomTimings] = await Promise.all([
    fetchPrayerTimes(city.lat, city.lng, apiDateStr(), method, school),
    fetchTomorrowPrayerTimes(city.lat, city.lng, method, school),
  ]);

  const todayT: Record<string, string> = {
    ...todayRes.timings,
    Midnight: calcMidnight(todayRes.timings.Maghrib, tomTimings.Fajr) || '',
  };
  const tomT: Record<string, string> = { ...tomTimings, Midnight: '' };

  const now      = new Date();
  const tomorrow = new Date(Date.now() + 86_400_000);

  await upsertCityPrayerCache({
    cityKey:      `${city.name}_${method}_${school}`,
    displayName:  city.displayName,
    lat:          city.lat,
    lng:          city.lng,
    date:         isoDateStr(now),
    tomorrowDate: isoDateStr(tomorrow),
    method,
    school,
    todayT,
    tomT,
    updatedAt:    Date.now() / 1000,
  });
}
