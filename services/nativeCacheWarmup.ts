// nativeCacheWarmup.ts
// Pre-populates andalus_multi_city_cache for all 110 bundled fallback cities.
//
// WHY: NativeNotificationScheduler.swift can resolve any location in Sweden to
// the nearest bundled city, but it can only schedule if that city's prayer times
// exist in the native cache. Without warmup, Haparanda→Haparanda would fail if
// the user has never opened the app there before.
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
  // ── Original 25 ──────────────────────────────────────────────────────────────
  { name: 'stockholm',        displayName: 'Stockholm',        lat: 59.3293, lng: 18.0686 },
  { name: 'göteborg',         displayName: 'Göteborg',         lat: 57.7089, lng: 11.9746 },
  { name: 'malmö',            displayName: 'Malmö',            lat: 55.6050, lng: 13.0038 },
  { name: 'uppsala',          displayName: 'Uppsala',          lat: 59.8586, lng: 17.6389 },
  { name: 'västerås',         displayName: 'Västerås',         lat: 59.6162, lng: 16.5528 },
  { name: 'örebro',           displayName: 'Örebro',           lat: 59.2753, lng: 15.2134 },
  { name: 'linköping',        displayName: 'Linköping',        lat: 58.4108, lng: 15.6214 },
  { name: 'helsingborg',      displayName: 'Helsingborg',      lat: 56.0467, lng: 12.6945 },
  { name: 'jönköping',        displayName: 'Jönköping',        lat: 57.7826, lng: 14.1618 },
  { name: 'norrköping',       displayName: 'Norrköping',       lat: 58.5877, lng: 16.1924 },
  { name: 'lund',             displayName: 'Lund',             lat: 55.7047, lng: 13.1910 },
  { name: 'umeå',             displayName: 'Umeå',             lat: 63.8258, lng: 20.2630 },
  { name: 'gävle',            displayName: 'Gävle',            lat: 60.6749, lng: 17.1413 },
  { name: 'borås',            displayName: 'Borås',            lat: 57.7210, lng: 12.9401 },
  { name: 'södertälje',       displayName: 'Södertälje',       lat: 59.1955, lng: 17.6253 },
  { name: 'eskilstuna',       displayName: 'Eskilstuna',       lat: 59.3666, lng: 16.5077 },
  { name: 'karlstad',         displayName: 'Karlstad',         lat: 59.3793, lng: 13.5036 },
  { name: 'växjö',            displayName: 'Växjö',            lat: 56.8777, lng: 14.8091 },
  { name: 'halmstad',         displayName: 'Halmstad',         lat: 56.6745, lng: 12.8577 },
  { name: 'sundsvall',        displayName: 'Sundsvall',        lat: 62.3908, lng: 17.3069 },
  { name: 'huddinge',         displayName: 'Huddinge',         lat: 59.2366, lng: 17.9810 },
  { name: 'botkyrka',         displayName: 'Botkyrka',         lat: 59.2005, lng: 17.8280 },
  { name: 'järfälla',         displayName: 'Järfälla',         lat: 59.4131, lng: 17.8340 },
  { name: 'sollentuna',       displayName: 'Sollentuna',       lat: 59.4282, lng: 17.9508 },
  { name: 'solna',            displayName: 'Solna',            lat: 59.3597, lng: 18.0009 },
  // ── Norrland ─────────────────────────────────────────────────────────────────
  { name: 'luleå',            displayName: 'Luleå',            lat: 65.5848, lng: 22.1567 },
  { name: 'skellefteå',       displayName: 'Skellefteå',       lat: 64.7507, lng: 20.9528 },
  { name: 'piteå',            displayName: 'Piteå',            lat: 65.3172, lng: 21.4794 },
  { name: 'boden',            displayName: 'Boden',            lat: 65.8252, lng: 21.6886 },
  { name: 'kiruna',           displayName: 'Kiruna',           lat: 67.8558, lng: 20.2253 },
  { name: 'gällivare',        displayName: 'Gällivare',        lat: 67.1339, lng: 20.6528 },
  { name: 'kalix',            displayName: 'Kalix',            lat: 65.8558, lng: 23.1430 },
  { name: 'haparanda',        displayName: 'Haparanda',        lat: 65.8355, lng: 24.1368 },
  { name: 'östersund',        displayName: 'Östersund',        lat: 63.1792, lng: 14.6357 },
  { name: 'örnsköldsvik',     displayName: 'Örnsköldsvik',     lat: 63.2909, lng: 18.7153 },
  // ── Dalarna / Gävleborg / södra Norrland ─────────────────────────────────────
  { name: 'falun',            displayName: 'Falun',            lat: 60.6065, lng: 15.6355 },
  { name: 'borlänge',         displayName: 'Borlänge',         lat: 60.4858, lng: 15.4360 },
  { name: 'mora',             displayName: 'Mora',             lat: 61.0070, lng: 14.5430 },
  { name: 'ludvika',          displayName: 'Ludvika',          lat: 60.1496, lng: 15.1878 },
  { name: 'avesta',           displayName: 'Avesta',           lat: 60.1455, lng: 16.1679 },
  { name: 'hudiksvall',       displayName: 'Hudiksvall',       lat: 61.7289, lng: 17.1049 },
  { name: 'bollnäs',          displayName: 'Bollnäs',          lat: 61.3482, lng: 16.3946 },
  { name: 'söderhamn',        displayName: 'Söderhamn',        lat: 61.3037, lng: 17.0592 },
  { name: 'sandviken',        displayName: 'Sandviken',        lat: 60.6216, lng: 16.7755 },
  { name: 'nynäshamn',        displayName: 'Nynäshamn',        lat: 58.9034, lng: 17.9479 },
  // ── Stockholmsregionen ────────────────────────────────────────────────────────
  { name: 'täby',             displayName: 'Täby',             lat: 59.4439, lng: 18.0687 },
  { name: 'nacka',            displayName: 'Nacka',            lat: 59.3105, lng: 18.1637 },
  { name: 'haninge',          displayName: 'Haninge',          lat: 59.1687, lng: 18.1374 },
  { name: 'tyresö',           displayName: 'Tyresö',           lat: 59.2433, lng: 18.2290 },
  { name: 'upplands-väsby',   displayName: 'Upplands Väsby',   lat: 59.5184, lng: 17.9113 },
  { name: 'märsta',           displayName: 'Märsta',           lat: 59.6216, lng: 17.8548 },
  { name: 'vallentuna',       displayName: 'Vallentuna',       lat: 59.5344, lng: 18.0776 },
  { name: 'åkersberga',       displayName: 'Åkersberga',       lat: 59.4794, lng: 18.2997 },
  { name: 'norrtälje',        displayName: 'Norrtälje',        lat: 59.7570, lng: 18.7049 },
  { name: 'enköping',         displayName: 'Enköping',         lat: 59.6361, lng: 17.0777 },
  // ── Sörmland / Östergötland / norra Småland ───────────────────────────────────
  { name: 'strängnäs',        displayName: 'Strängnäs',        lat: 59.3774, lng: 17.0312 },
  { name: 'katrineholm',      displayName: 'Katrineholm',      lat: 58.9959, lng: 16.2072 },
  { name: 'nyköping',         displayName: 'Nyköping',         lat: 58.7528, lng: 17.0079 },
  { name: 'motala',           displayName: 'Motala',           lat: 58.5371, lng: 15.0365 },
  { name: 'mjölby',           displayName: 'Mjölby',           lat: 58.3259, lng: 15.1236 },
  { name: 'finspång',         displayName: 'Finspång',         lat: 58.7058, lng: 15.7674 },
  { name: 'tranås',           displayName: 'Tranås',           lat: 58.0372, lng: 14.9782 },
  { name: 'värnamo',          displayName: 'Värnamo',          lat: 57.1860, lng: 14.0400 },
  { name: 'nässjö',           displayName: 'Nässjö',           lat: 57.6531, lng: 14.6968 },
  { name: 'eksjö',            displayName: 'Eksjö',            lat: 57.6664, lng: 14.9721 },
  // ── Kalmar / Gotland / Blekinge / norra Skåne ────────────────────────────────
  { name: 'kalmar',           displayName: 'Kalmar',           lat: 56.6634, lng: 16.3568 },
  { name: 'oskarshamn',       displayName: 'Oskarshamn',       lat: 57.2646, lng: 16.4484 },
  { name: 'västervik',        displayName: 'Västervik',        lat: 57.7584, lng: 16.6373 },
  { name: 'visby',            displayName: 'Visby',            lat: 57.6348, lng: 18.2948 },
  { name: 'karlskrona',       displayName: 'Karlskrona',       lat: 56.1612, lng: 15.5869 },
  { name: 'ronneby',          displayName: 'Ronneby',          lat: 56.2094, lng: 15.2760 },
  { name: 'karlshamn',        displayName: 'Karlshamn',        lat: 56.1703, lng: 14.8619 },
  { name: 'kristianstad',     displayName: 'Kristianstad',     lat: 56.0294, lng: 14.1567 },
  { name: 'hässleholm',       displayName: 'Hässleholm',       lat: 56.1589, lng: 13.7668 },
  { name: 'ängelholm',        displayName: 'Ängelholm',        lat: 56.2428, lng: 12.8622 },
  // ── Skåne / Halland / södra Götaland ─────────────────────────────────────────
  { name: 'landskrona',       displayName: 'Landskrona',       lat: 55.8708, lng: 12.8302 },
  { name: 'trelleborg',       displayName: 'Trelleborg',       lat: 55.3751, lng: 13.1569 },
  { name: 'ystad',            displayName: 'Ystad',            lat: 55.4295, lng: 13.8204 },
  { name: 'simrishamn',       displayName: 'Simrishamn',       lat: 55.5565, lng: 14.3504 },
  { name: 'varberg',          displayName: 'Varberg',          lat: 57.1056, lng: 12.2508 },
  { name: 'falkenberg',       displayName: 'Falkenberg',       lat: 56.9055, lng: 12.4912 },
  { name: 'kungsbacka',       displayName: 'Kungsbacka',       lat: 57.4875, lng: 12.0762 },
  { name: 'alingsås',         displayName: 'Alingsås',         lat: 57.9300, lng: 12.5334 },
  { name: 'lerum',            displayName: 'Lerum',            lat: 57.7705, lng: 12.2690 },
  { name: 'kungälv',          displayName: 'Kungälv',          lat: 57.8706, lng: 11.9805 },
  // ── Västra Götaland / Värmland / Västmanland ──────────────────────────────────
  { name: 'trollhättan',      displayName: 'Trollhättan',      lat: 58.2837, lng: 12.2886 },
  { name: 'uddevalla',        displayName: 'Uddevalla',        lat: 58.3498, lng: 11.9356 },
  { name: 'vänersborg',       displayName: 'Vänersborg',       lat: 58.3807, lng: 12.3234 },
  { name: 'skövde',           displayName: 'Skövde',           lat: 58.3903, lng: 13.8461 },
  { name: 'lidköping',        displayName: 'Lidköping',        lat: 58.5052, lng: 13.1577 },
  { name: 'mariestad',        displayName: 'Mariestad',        lat: 58.7097, lng: 13.8237 },
  { name: 'kristinehamn',     displayName: 'Kristinehamn',     lat: 59.3098, lng: 14.1081 },
  { name: 'arvika',           displayName: 'Arvika',           lat: 59.6553, lng: 12.5852 },
  { name: 'köping',           displayName: 'Köping',           lat: 59.5140, lng: 15.9926 },
  { name: 'sala',             displayName: 'Sala',             lat: 59.9199, lng: 16.6066 },
  // ── Örebro / norra Dalarna / Ångermanland / inre Norrland ────────────────────
  { name: 'fagersta',         displayName: 'Fagersta',         lat: 60.0042, lng: 15.7932 },
  { name: 'arboga',           displayName: 'Arboga',           lat: 59.3949, lng: 15.8388 },
  { name: 'kumla',            displayName: 'Kumla',            lat: 59.1277, lng: 15.1434 },
  { name: 'lindesberg',       displayName: 'Lindesberg',       lat: 59.5939, lng: 15.2304 },
  { name: 'härnösand',        displayName: 'Härnösand',        lat: 62.6323, lng: 17.9379 },
  { name: 'sollefteå',        displayName: 'Sollefteå',        lat: 63.1667, lng: 17.2667 },
  { name: 'lycksele',         displayName: 'Lycksele',         lat: 64.5954, lng: 18.6735 },
  { name: 'vilhelmina',       displayName: 'Vilhelmina',       lat: 64.6242, lng: 16.6550 },
  { name: 'arjeplog',         displayName: 'Arjeplog',         lat: 66.0517, lng: 17.8861 },
  { name: 'jokkmokk',         displayName: 'Jokkmokk',         lat: 66.6066, lng: 19.8232 },
  // ── Övriga ───────────────────────────────────────────────────────────────────
  { name: 'malung',           displayName: 'Malung',           lat: 60.6833, lng: 13.7167 },
  { name: 'sveg',             displayName: 'Sveg',             lat: 62.0346, lng: 14.3658 },
  { name: 'strömstad',        displayName: 'Strömstad',        lat: 58.9395, lng: 11.1712 },
  { name: 'lysekil',          displayName: 'Lysekil',          lat: 58.2743, lng: 11.4358 },
  { name: 'ulricehamn',       displayName: 'Ulricehamn',       lat: 57.7916, lng: 13.4142 },
];

/**
 * Warms up andalus_multi_city_cache for all 110 bundled fallback cities.
 * Safe to call on every app open — skips cities already fresh for today.
 * Runs 3 cities at a time, fire-and-forget.
 *
 * After this completes, NativeNotificationScheduler can reschedule for any
 * bundled city (e.g. Haparanda, Kiruna, Visby) without the user having
 * previously visited that city.
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
  // 110 cities × 2 API calls each = 220 calls total on first launch (cold cache).
  // With batches of 3: ~37 rounds × ~500 ms/round ≈ 18–25 s of background activity.
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
