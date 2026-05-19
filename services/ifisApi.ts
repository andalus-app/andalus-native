import AsyncStorage from '@react-native-async-storage/async-storage';
import { calcMidnight } from './prayerApi';
import { SWEDISH_DAYS } from './monthlyCache';

const IFIS_BASE = 'https://api.xn--bnetider-n4a.nu/v1';

export const IFIS_METHOD_KEY = 'ifis' as const;
export const IFIS_METHOD_DISPLAY_NAME = 'Islamiska Förbundet i Sverige';

// Base mapping — expanded dynamically when fetchIfisCities() runs
const BASE_CITY_NAMES: Record<string, string> = {
  stockholm: 'Stockholm',
  goteborg:  'Göteborg',
  malmo:     'Malmö',
};

let IFIS_CITY_DISPLAY_NAMES: Record<string, string> = { ...BASE_CITY_NAMES };

export function getIfisCityDisplayNames(): Record<string, string> {
  return IFIS_CITY_DISPLAY_NAMES;
}

export function normalizeIfisCity(city: string): string {
  return city
    .trim()
    .toLowerCase()
    .replace(/[åä]/g, 'a')
    .replace(/ö/g, 'o');
}

export function getIfisCityDisplayName(city: string): string {
  return IFIS_CITY_DISPLAY_NAMES[city]
    ?? (city.charAt(0).toUpperCase() + city.slice(1));
}

export function getIfisSourceDisplayName(city: string): string {
  return `Islamiska Förbundet ${getIfisCityDisplayName(city)}`;
}

function minutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

type IfisPrayerMinuteArray = [number, number, number, number, number, number];

export type IfisYearCache = {
  city:     string;
  year:     number;
  cachedAt: string;
  source:   'ifis';
  version:  1;
  data:     unknown;
};

export type IfisDayRow = {
  date:    string;
  dayName: string;
  dayNum:  number;
  times:   string[];
};

function ifisStorageKey(city: string, year: number): string {
  return `ifis:${city}:${year}`;
}

function validateIfisArray(arr: unknown): arr is IfisPrayerMinuteArray {
  if (!Array.isArray(arr) || arr.length !== 6) return false;
  return arr.every(n => typeof n === 'number' && n >= 0 && n <= 1439);
}

function arrayToTimings(arr: IfisPrayerMinuteArray, nextFajrMin?: number): Record<string, string> {
  const [fajr, shorook, dhuhr, asr, maghrib, isha] = arr;
  const fajrStr    = minutesToHHMM(fajr);
  const maghribStr = minutesToHHMM(maghrib);
  const midnight   = nextFajrMin !== undefined
    ? (calcMidnight(maghribStr, minutesToHHMM(nextFajrMin)) ?? '')
    : '';
  return {
    Fajr:     fajrStr,
    Sunrise:  minutesToHHMM(shorook),
    Dhuhr:    minutesToHHMM(dhuhr),
    Asr:      minutesToHHMM(asr),
    Maghrib:  maghribStr,
    Isha:     minutesToHHMM(isha),
    Midnight: midnight,
  };
}

function localIsoDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return localIsoDate(d);
}

// Year endpoint returns 3D array: data[monthIndex][dayIndex] = [fajr, shorook, ...]
// monthIndex is 0-based from January. cacheYear is the calendar year.
function extractDateEntry(
  data: unknown, dateStr: string, cacheYear: number,
): IfisPrayerMinuteArray | null {
  if (!Array.isArray(data)) return null;
  const parts = dateStr.split('-');
  if (parseInt(parts[0], 10) !== cacheYear) return null;
  const monthIdx = parseInt(parts[1], 10) - 1;
  const dayIdx   = parseInt(parts[2], 10) - 1;
  const monthData = (data as unknown[])[monthIdx];
  if (!Array.isArray(monthData) || dayIdx >= monthData.length) return null;
  const entry = (monthData as unknown[])[dayIdx];
  return validateIfisArray(entry) ? entry : null;
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function fetchIfisCities(): Promise<string[]> {
  const res = await fetch(`${IFIS_BASE}/method/ifis/cities`);
  if (!res.ok) return Object.keys(IFIS_CITY_DISPLAY_NAMES);
  const json = await res.json();
  if (!Array.isArray(json)) return Object.keys(IFIS_CITY_DISPLAY_NAMES);
  const cities = json
    .map((c: unknown) => typeof c === 'string' ? c.trim().toLowerCase() : '')
    .filter(Boolean) as string[];
  if (!cities.length) return Object.keys(IFIS_CITY_DISPLAY_NAMES);
  cities.forEach(city => {
    if (!IFIS_CITY_DISPLAY_NAMES[city]) {
      // Simple capitalization; cities like "goteborg" become "Goteborg" (display name)
      IFIS_CITY_DISPLAY_NAMES[city] = city.charAt(0).toUpperCase() + city.slice(1);
    }
  });
  return cities;
}

export async function fetchIfisYear(city: string): Promise<unknown> {
  const res = await fetch(`${IFIS_BASE}/method/ifis/city/${city}/times`);
  if (!res.ok) throw new Error(`IFIS year fetch failed (${city}): ${res.status}`);
  return res.json();
}

export async function fetchIfisDay(city: string, date: string): Promise<Record<string, string>> {
  const res = await fetch(`${IFIS_BASE}/method/ifis/city/${city}/times/${date}`);
  if (!res.ok) throw new Error(`IFIS day fetch failed (${city}/${date}): ${res.status}`);
  const json = await res.json();
  if (!validateIfisArray(json)) throw new Error(`Invalid IFIS response for ${city}/${date}`);
  return arrayToTimings(json);
}

export async function cacheIfisYear(city: string, year: number, data: unknown): Promise<void> {
  const entry: IfisYearCache = {
    city, year, source: 'ifis', version: 1,
    cachedAt: new Date().toISOString(),
    data,
  };
  await AsyncStorage.setItem(ifisStorageKey(city, year), JSON.stringify(entry));
}

export async function getCachedIfisYear(city: string, year: number): Promise<IfisYearCache | null> {
  try {
    const raw = await AsyncStorage.getItem(ifisStorageKey(city, year));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.source !== 'ifis' || parsed?.city !== city || parsed?.year !== year) return null;
    return parsed as IfisYearCache;
  } catch { return null; }
}

export async function getIfisTimesFromYearCache(
  city: string, date: string,
): Promise<Record<string, string> | null> {
  const year = parseInt(date.split('-')[0], 10);
  const cache = await getCachedIfisYear(city, year);
  if (!cache) return null;

  const arr = extractDateEntry(cache.data, date, year);
  if (!arr) return null;

  // Get tomorrow's Fajr for midnight calculation
  const tomorrow  = addDays(date, 1);
  const tomYear   = parseInt(tomorrow.split('-')[0], 10);
  let nextFajrMin: number | undefined;

  if (tomYear === year) {
    const tomArr = extractDateEntry(cache.data, tomorrow, year);
    if (tomArr) nextFajrMin = tomArr[0];
  } else {
    const nextCache = await getCachedIfisYear(city, tomYear);
    if (nextCache) {
      const tomArr = extractDateEntry(nextCache.data, tomorrow, tomYear);
      if (tomArr) nextFajrMin = tomArr[0];
    }
  }

  return arrayToTimings(arr, nextFajrMin);
}

export async function getIfisTimesForDate(city: string, date: string): Promise<Record<string, string>> {
  const fromCache = await getIfisTimesFromYearCache(city, date);
  if (fromCache) return fromCache;
  return fetchIfisDay(city, date);
}

export async function ensureIfisYearCache(city: string, year: number): Promise<void> {
  const existing = await getCachedIfisYear(city, year);
  if (existing) return;
  const data = await fetchIfisYear(city);
  await cacheIfisYear(city, year, data);
}

export async function warmIfisCache(city: string): Promise<void> {
  const now      = new Date();
  const thisYear = now.getFullYear();
  const nextYear = thisYear + 1;
  try { await ensureIfisYearCache(city, thisYear); } catch (e) {
    console.warn('[IFIS] warmup current year failed:', e instanceof Error ? e.message : String(e));
  }
  try { await ensureIfisYearCache(city, nextYear); } catch (e) {
    // Next year data may not be available yet — not a fatal error
    if (__DEV__) console.log('[IFIS] next year not available yet (expected early in year)');
  }
}

export async function getIfisTodayAndTomorrow(city: string): Promise<{
  todayT: Record<string, string>;
  tomT:   Record<string, string> | null;
}> {
  const now      = new Date();
  const todayStr = localIsoDate(now);
  const tomStr   = addDays(todayStr, 1);

  const [todayT, tomT] = await Promise.all([
    getIfisTimesForDate(city, todayStr),
    getIfisTimesForDate(city, tomStr).catch(() => null),
  ]);

  // Recalculate midnight now that tomT is available
  if (todayT && tomT?.Fajr && todayT.Maghrib) {
    todayT.Midnight = calcMidnight(todayT.Maghrib, tomT.Fajr) ?? '';
  }

  return { todayT, tomT };
}

export async function getIfisMonthRows(
  city: string, year: number, month: number,
): Promise<IfisDayRow[] | null> {
  const cache = await getCachedIfisYear(city, year);
  if (!cache) return null;

  const daysInMonth = new Date(year, month, 0).getDate();
  const rows: IfisDayRow[] = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const arr     = extractDateEntry(cache.data, dateStr, year);
    if (!arr) return null; // incomplete cache — caller re-fetches

    let nextFajrMin: number | undefined;
    if (day < daysInMonth) {
      const nextDate = `${year}-${String(month).padStart(2, '0')}-${String(day + 1).padStart(2, '0')}`;
      const nextArr  = extractDateEntry(cache.data, nextDate, year);
      if (nextArr) nextFajrMin = nextArr[0];
    } else {
      // Last day — first day of next month
      const nextM   = month === 12 ? 1  : month + 1;
      const nextY   = month === 12 ? year + 1 : year;
      const nextKey = `${nextY}-${String(nextM).padStart(2, '0')}-01`;
      if (nextY === year) {
        const nextArr = extractDateEntry(cache.data, nextKey, year);
        if (nextArr) nextFajrMin = nextArr[0];
      } else {
        const nextCache = await getCachedIfisYear(city, nextY);
        if (nextCache) {
          const nextArr = extractDateEntry(nextCache.data, nextKey, nextY);
          if (nextArr) nextFajrMin = nextArr[0];
        }
      }
    }

    const timings = arrayToTimings(arr, nextFajrMin);
    const dateObj = new Date(year, month - 1, day);
    rows.push({
      date:    dateStr,
      dayName: SWEDISH_DAYS[dateObj.getDay()],
      dayNum:  day,
      times: [
        timings.Fajr,
        timings.Sunrise,
        timings.Dhuhr,
        timings.Asr,
        timings.Maghrib,
        timings.Isha,
        timings.Midnight || '--:--',
      ],
    });
  }
  return rows;
}

export async function fetchIfisMonthRows(
  city: string, year: number, month: number,
): Promise<IfisDayRow[]> {
  let rows = await getIfisMonthRows(city, year, month);
  if (rows) return rows;

  // Cache miss — build year cache and retry
  await ensureIfisYearCache(city, year);
  if (month === 12) await ensureIfisYearCache(city, year + 1).catch(() => {});

  rows = await getIfisMonthRows(city, year, month);
  if (rows) return rows;

  throw new Error(`IFIS data unavailable for ${city} ${year}-${month}`);
}

export function matchIfisCity(geocodedCity: string, ifisCities: string[]): string | null {
  const normalized = normalizeIfisCity(geocodedCity);
  if (ifisCities.includes(normalized)) return normalized;
  const partial = ifisCities.find(c => normalized.includes(c) || c.includes(normalized));
  return partial ?? null;
}
