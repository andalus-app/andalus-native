// visitedPlacesRefresh.ts
// Keeps the visited-prayer-locations cache fresh for 7 days so native can use
// a cached visited place even if the app hasn't been opened for several days.
//
// WHY: the old entry only stored today+tomorrow.  After 2 days, native's
// resolveVisitedTimings() returned nil and native fell back to the less-precise
// effective schedule or bundled city — showing e.g. "Kista" instead of "Spånga".
//
// HOW:
//   - Today + tomorrow are seeded from already-fetched data (zero extra requests).
//   - Days 2–6 are fetched only when absent from the JS-side AsyncStorage cache,
//     in batches of max 2 to avoid network abuse.
//   - An immediate write guarantees the native entry has at least today+tomorrow
//     within milliseconds; a second write adds the extended days after fetch.
//   - Old (< today) dates are pruned on every call.
//   - The JS-side cache (andalus_visited_multi_day_v1) survives across app opens
//     so on most opens only 1–2 new days need to be fetched.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchPrayerTimes } from './prayerApi';
import { upsertVisitedPrayerLocation } from '../modules/WidgetData';

const MULTI_DAY_KEY  = 'andalus_visited_multi_day_v1';
const DAYS_AHEAD     = 7;
const MAX_CONCURRENT = 2;

type Timings      = Record<string, string>;
type DayStore     = Record<string, Timings>;       // "yyyy-MM-dd" → prayer timings
type MultiDayStore = Record<string, DayStore>;      // storeKey → day store

function localIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// "dd-MM-yyyy" format required by the Aladhan API
function aladhanDate(d: Date): string {
  return (
    String(d.getDate()).padStart(2, '0') + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    d.getFullYear()
  );
}

async function loadStore(): Promise<MultiDayStore> {
  try {
    const raw = await AsyncStorage.getItem(MULTI_DAY_KEY);
    return raw ? (JSON.parse(raw) as MultiDayStore) : {};
  } catch {
    return {};
  }
}

async function saveStore(store: MultiDayStore): Promise<void> {
  try {
    await AsyncStorage.setItem(MULTI_DAY_KEY, JSON.stringify(store));
  } catch {}
}

export interface VisitedEntryParams {
  locationKey:             string;
  displayName:             string;
  notificationDisplayName: string;
  lat:                     number;
  lng:                     number;
  method:                  number;
  school:                  number;
  source:                  'js_precise_location' | 'js_background';
}

/**
 * Upserts a visited prayer location with a 7-day rolling prayer time cache.
 *
 * Steps:
 *  1. Load JS-side multi-day AsyncStorage cache.
 *  2. Seed today + tomorrow from already-fetched timings (no network).
 *  3. Prune dates before today.
 *  4. Write immediately to App Group with what we have (at least today + tomorrow).
 *  5. Fetch any missing days 2–6 in batches of 2.
 *  6. Save updated JS-side cache.
 *  7. Write final App Group entry with all available days.
 *
 * Fire-and-forget — callers do not need to await.
 */
export async function refreshVisitedPlaceMultiDayCache(
  params:          VisitedEntryParams,
  todayTimings:    Timings,
  tomorrowTimings: Timings | null,
): Promise<void> {
  const today    = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const todayStr    = localIsoDate(today);
  const tomorrowStr = localIsoDate(tomorrow);
  const storeKey    = `${params.locationKey}_${params.method}_${params.school}`;

  const store    = await loadStore();
  const dayCache: DayStore = { ...(store[storeKey] ?? {}) };

  // Prune stale dates (before today)
  for (const k of Object.keys(dayCache)) {
    if (k < todayStr) delete dayCache[k];
  }

  // Seed from already-fetched data — no network needed for these two days
  if (Object.keys(todayTimings).length > 0)               dayCache[todayStr]    = todayTimings;
  if (tomorrowTimings && Object.keys(tomorrowTimings).length > 0) dayCache[tomorrowStr] = tomorrowTimings;

  const buildDailyDict = (): Record<string, Timings> => {
    const out: Record<string, Timings> = {};
    for (let i = 0; i < DAYS_AHEAD; i++) {
      const d  = new Date(today);
      d.setDate(d.getDate() + i);
      const ds = localIsoDate(d);
      if (dayCache[ds]) out[ds] = dayCache[ds];
    }
    return out;
  };

  const nowSec = () => Date.now() / 1000;

  // Immediate write: at minimum today + tomorrow
  await upsertVisitedPrayerLocation({
    ...params,
    date:             todayStr,
    tomorrowDate:     tomorrowStr,
    todayTimes:       todayTimings,
    tomorrowTimes:    tomorrowTimings,
    dailyTimesByDate: buildDailyDict(),
    updatedAt:        nowSec(),
    lastUsedAt:       nowSec(),
  });

  // Identify days 2–6 that are not yet cached
  const missing: Date[] = [];
  for (let i = 2; i < DAYS_AHEAD; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    if (!dayCache[localIsoDate(d)]) missing.push(d);
  }

  if (missing.length === 0) {
    store[storeKey] = dayCache;
    await saveStore(store);
    if (__DEV__) {
      console.log(`[VisitedMultiDay] ${params.displayName}: all ${DAYS_AHEAD} days cached`);
    }
    return;
  }

  if (__DEV__) {
    console.log(`[VisitedMultiDay] ${params.displayName}: fetching ${missing.length} missing day(s): ${missing.map(localIsoDate).join(', ')}`);
  }

  // Fetch missing days with limited concurrency
  for (let i = 0; i < missing.length; i += MAX_CONCURRENT) {
    const batch   = missing.slice(i, i + MAX_CONCURRENT);
    const results = await Promise.allSettled(
      batch.map(d => fetchPrayerTimes(params.lat, params.lng, aladhanDate(d), params.method, params.school)),
    );
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === 'fulfilled') {
        // Strip null values (e.g. Midnight: null) — Timings is Record<string, string>
        const raw = r.value.timings as Record<string, string | null>;
        dayCache[localIsoDate(batch[j])] = Object.fromEntries(
          Object.entries(raw).filter(([, v]) => v != null),
        ) as Timings;
      }
    }
  }

  // Persist JS-side cache
  store[storeKey] = dayCache;
  await saveStore(store);

  // Final write with all fetched days
  const finalDaily = buildDailyDict();
  await upsertVisitedPrayerLocation({
    ...params,
    date:             todayStr,
    tomorrowDate:     tomorrowStr,
    todayTimes:       todayTimings,
    tomorrowTimes:    tomorrowTimings,
    dailyTimesByDate: finalDaily,
    updatedAt:        nowSec(),
    lastUsedAt:       nowSec(),
  });

  if (__DEV__) {
    console.log(`[VisitedMultiDay] ${params.displayName}: ${Object.keys(finalDaily).length} days written`);
  }
}
