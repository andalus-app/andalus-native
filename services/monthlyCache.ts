import AsyncStorage from '@react-native-async-storage/async-storage';

export const SWEDISH_DAYS   = ['Sön','Mån','Tis','Ons','Tor','Fre','Lör'];
export const SWEDISH_MONTHS = ['Januari','Februari','Mars','April','Maj','Juni','Juli','Augusti','September','Oktober','November','December'];

export type DayRow = {
  date:    string;
  dayName: string;
  dayNum:  number;
  times:   string[];  // [Fajr, Sunrise, Dhuhr, Asr, Maghrib, Isha, Midnight]
};

export type PrayerTimesResult = {
  todayT: Record<string, string>;
  tomT:   Record<string, string> | null;
  hijri:  any | null;
};

// v3: city-based, rolling month structure
const CACHE_KEY       = 'andalus_yearly_cache_v3';
const DAILY_CACHE_KEY = 'andalus_prayer_cache';

// In-progress guard: prevents parallel buildYearlyCache runs
let buildInProgress = false;

const PRAYER_KEYS = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha', 'Midnight'] as const;

type CityCache = {
  cityKey: string;
  lat:     number;  // city-stable coordinates for API calls
  lng:     number;
  method:  number;
  school:  number;
  months:  Record<string, DayRow[]>;  // "YYYY-MM" → rows
};

// ── Private helpers ──────────────────────────────────────────────────────────

function stripTz(t: string) { return t ? t.replace(/\s*\(.*\)/, '').trim() : ''; }

function calcMidnight(maghrib: string, fajrNext: string): string {
  if (!maghrib || !fajrNext) return '--:--';
  const [mh, mm] = maghrib.split(':').map(Number);
  const [fh, fm] = fajrNext.split(':').map(Number);
  const m1  = mh * 60 + mm;
  const m2  = fh * 60 + fm + 24 * 60;
  const mid = (m1 + Math.ceil((m2 - m1) / 2)) % (24 * 60);
  return `${String(Math.floor(mid / 60)).padStart(2,'0')}:${String(mid % 60).padStart(2,'0')}`;
}

// "Kista, Stockholm" → "kista" — stable across GPS drift within same city area
/**
 * Extracts the municipality-level (effective prayer) city from a display string.
 * "Kista, Stockholm" → "Stockholm"   (last token = municipality)
 * "Stockholm"        → "Stockholm"   (no comma → unchanged)
 * Falls back to the full display string if splitting yields empty.
 */
export function getEffectivePrayerCity(displayCity: string): string {
  const trimmed = displayCity.trim();
  if (!trimmed) return '';
  const parts = trimmed.split(',');
  const city  = parts[parts.length - 1].trim();
  return city || trimmed;
}

function normalizeCity(city: string): string {
  return getEffectivePrayerCity(city).toLowerCase();
}

function makeCacheKey(city: string, method: number, school: number): string {
  return `${normalizeCity(city)}_${method}_${school}`;
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2,'0')}`;
}

// "2026-12" → "2027-01", handles year boundary correctly
function nextMonthKey(key: string): string {
  const [year, month] = key.split('-').map(Number);
  const d = new Date(year, month, 1);  // month (1-indexed) acts as next month in 0-indexed
  return monthKey(d.getFullYear(), d.getMonth() + 1);
}

// Returns 13 keys: current month + 12 ahead (12 data months + 1 anchor for midnight calc)
function requiredMonthKeys(): string[] {
  const keys: string[] = [];
  const now = new Date();
  for (let i = 0; i <= 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    keys.push(monthKey(d.getFullYear(), d.getMonth() + 1));
  }
  return keys;
}

function isCacheToday(dateStr: string): boolean {
  const n    = new Date();
  const dStr = `${String(n.getDate()).padStart(2,'0')}-${String(n.getMonth()+1).padStart(2,'0')}-${n.getFullYear()}`;
  return dateStr === dStr || dateStr === n.toDateString();
}

// Reads + validates yearly cache. Clears storage on corruption.
async function readCityCache(city: string, method: number, school: number): Promise<CityCache | null> {
  if (!city.trim()) return null;
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c: CityCache = JSON.parse(raw);
    if (typeof c.cityKey !== 'string' || !c.months || typeof c.months !== 'object') {
      await AsyncStorage.removeItem(CACHE_KEY);
      return null;
    }
    return c.cityKey === makeCacheKey(city, method, school) ? c : null;
  } catch {
    if (raw !== null) AsyncStorage.removeItem(CACHE_KEY).catch(() => {});
    return null;
  }
}

// Reads + validates daily cache. Returns null if stale or params mismatch.
async function readDailyCache(lat: number, lng: number, method: number, school: number): Promise<PrayerTimesResult | null> {
  try {
    const raw = await AsyncStorage.getItem(DAILY_CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (!isCacheToday(c.date)) return null;

    const key = `${lat.toFixed(4)},${lng.toFixed(4)},${method},${school}`;

    if ('key' in c && 'todayT' in c) {
      if (c.key !== key || !c.todayT) return null;
      return { todayT: c.todayT, tomT: c.tomT ?? null, hijri: c.hijri ?? null };
    }
    if (c.timings) {
      return { todayT: c.timings, tomT: c.tomorrowTimings ?? null, hijri: c.hijri ?? null };
    }
    return null;
  } catch { return null; }
}

function buildMonthRows(year: number, month: number, days: any[], anchorFajr: string): DayRow[] {
  return days.map((d: any, i: number) => {
    const t       = d.timings || {};
    const dateObj = new Date(year, month - 1, i + 1);
    const nextFajr = i < days.length - 1
      ? stripTz(days[i + 1]?.timings?.Fajr || '')
      : anchorFajr;
    return {
      date:    `${year}-${String(month).padStart(2,'0')}-${String(i + 1).padStart(2,'0')}`,
      dayName: SWEDISH_DAYS[dateObj.getDay()],
      dayNum:  i + 1,
      times: [
        stripTz(t.Fajr    || ''), stripTz(t.Sunrise || ''), stripTz(t.Dhuhr   || ''),
        stripTz(t.Asr     || ''), stripTz(t.Maghrib || ''), stripTz(t.Isha    || ''),
        calcMidnight(stripTz(t.Maghrib || ''), nextFajr),
      ],
    };
  });
}

async function fetchMonthDays(
  year: number, month: number, lat: number, lng: number, method: number, school: number,
): Promise<any[]> {
  const res  = await fetch(
    `https://api.aladhan.com/v1/calendar/${year}/${month}?latitude=${lat}&longitude=${lng}&method=${method}&school=${school}`,
  );
  const json = await res.json();
  return Array.isArray(json.data) ? json.data : [];
}

// ── Public API ───────────────────────────────────────────────────────────────

export function dayRowToTimings(row: DayRow): Record<string, string> {
  const out: Record<string, string> = {};
  PRAYER_KEYS.forEach((k, i) => { out[k] = row.times[i] ?? ''; });
  return out;
}

/**
 * Builds city-based rolling cache (current month + 12 ahead).
 * - Cache key: normalizedCity + method + school (NOT raw GPS coords)
 * - Only fetches missing months; reuses existing cached months
 * - Prunes months older than current month
 * - Stable per city: GPS drift within same city never triggers a rebuild
 */
export async function buildYearlyCache(
  city: string, lat: number, lng: number, method: number, school: number,
): Promise<void> {
  if (!city.trim() || buildInProgress) return;
  buildInProgress = true;

  try {
  const required = requiredMonthKeys();  // 13 keys (12 data + 1 anchor)

  const existing  = await readCityCache(city, method, school);
  // Reuse existing lat/lng for API consistency (city-stable coordinates)
  const cache: CityCache = existing
    ? { ...existing, months: { ...existing.months } }
    : { cityKey: makeCacheKey(city, method, school), lat, lng, method, school, months: {} };

  const dataMissing = required.slice(0, 12).filter(k => !cache.months[k]);
  if (!dataMissing.length) return;

  // Fetch anchor month (required[12]) only if needed for building required[11]
  const anchorKey     = required[12];
  const needAnchor    = dataMissing.includes(required[11]) && !cache.months[anchorKey];
  const toFetch       = needAnchor ? [...dataMissing, anchorKey] : dataMissing;

  const fetched: Record<string, any[]> = {};
  await Promise.all(
    toFetch.map(async (k) => {
      const [y, m] = k.split('-').map(Number);
      fetched[k]   = await fetchMonthDays(y, m, cache.lat, cache.lng, method, school);
    }),
  );

  let built = false;
  for (const k of dataMissing) {
    const [y, m]     = k.split('-').map(Number);
    const days       = fetched[k];
    if (!days?.length) continue;

    const nk          = nextMonthKey(k);
    const anchorFajr  = cache.months[nk]?.[0]?.times[0]
      ?? stripTz(fetched[nk]?.[0]?.timings?.Fajr ?? '');

    cache.months[k]  = buildMonthRows(y, m, days, anchorFajr);
    built            = true;
  }

  if (!built) return;

  // Prune months older than current month to keep cache lean
  const currentKey = required[0];
  for (const k of Object.keys(cache.months)) {
    if (k < currentKey) delete cache.months[k];
  }

  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } finally {
    buildInProgress = false;
  }
}

/**
 * Returns today's and tomorrow's timings from city-based yearly cache.
 * Handles month and year boundaries safely.
 */
export async function getTodayFromYearlyCache(
  city: string, method: number, school: number,
): Promise<{ todayT: Record<string, string>; tomT: Record<string, string> | null } | null> {
  const c = await readCityCache(city, method, school);
  if (!c) return null;

  const now   = new Date();
  const today = monthKey(now.getFullYear(), now.getMonth() + 1);
  const day   = now.getDate();

  const monthRows = c.months[today];
  if (!monthRows?.length || day > monthRows.length) return null;

  const todayRow = monthRows[day - 1];
  if (!todayRow) return null;

  const todayT = dayRowToTimings(todayRow);

  // Tomorrow: same month, or first day of next month (year boundary handled by nextMonthKey)
  let tomRow: DayRow | undefined;
  if (day < monthRows.length) {
    tomRow = monthRows[day];  // 0-indexed: index `day` = tomorrow
  } else {
    tomRow = c.months[nextMonthKey(today)]?.[0];
  }

  return { todayT, tomT: tomRow ? dayRowToTimings(tomRow) : null };
}

/**
 * Single entry point for local data resolution: daily cache → yearly cache.
 * Returns null only when both miss.
 */
export async function getPrayerTimesWithFallback(
  city: string, lat: number, lng: number, method: number, school: number,
): Promise<PrayerTimesResult | null> {
  const daily = await readDailyCache(lat, lng, method, school);
  if (daily) return daily;

  const yearly = await getTodayFromYearlyCache(city, method, school);
  if (!yearly) return null;

  return { todayT: yearly.todayT, tomT: yearly.tomT, hijri: null };
}

/**
 * Returns cached DayRow[] for a given month, or null on miss.
 * City-based lookup — pass the same city string used for buildYearlyCache.
 */
export async function getMonthFromCache(
  year: number, month: number, city: string, method: number, school: number,
): Promise<DayRow[] | null> {
  const c = await readCityCache(city, method, school);
  return c?.months[monthKey(year, month)] ?? null;
}
