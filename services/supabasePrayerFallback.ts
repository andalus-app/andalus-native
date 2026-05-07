import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SupabasePrayerDay = {
  date:                   string;  // DD-MM-YYYY
  fajr:                   string;
  sunrise:                string;
  dhuhr:                  string;
  asr:                    string;
  maghrib:                string;
  isha:                   string;
  imsak:                  string;
  sunset:                 string;
  midnight:               string;
  firstthird:             string;
  lastthird:              string;
  hijri_date:             string;
  hijri_day:              number;
  hijri_month_number:     number;
  hijri_month_en:         string;
  hijri_year:             number;
  gregorian_day:          number;
  gregorian_month_number: number;
  gregorian_month_en:     string;
  gregorian_year:         number;
};

export type SupabasePrayerMonthResponse = {
  location_id:        string;  // UUID
  location_name:      string;
  municipality_name:  string;
  county_name:        string;
  location_latitude:  number;
  location_longitude: number;
  distance_meters:    number;
  match_type:         string;
  year:               number;
  month:              number;
  days:               SupabasePrayerDay[];
  fetched_at:         string;
};

export type SupabasePrayerFallbackResult = {
  todayT:           Record<string, string>;
  tomT:             Record<string, string> | null;
  hijri:            { day: string; month: { number: string; en: string }; year: string } | null;
  source:           string;
  locationId:       string;  // UUID
  locationName:     string;
  municipalityName: string;
  countyName:       string;
  matchType:        string;
  distanceMeters:   number;
  year:             number;
  month:            number;
  fetchedAt:        string;
};

export type SupabasePrayerFallbackParams = {
  latitude:    number;
  longitude:   number;
  date:        Date;
  profileKey?: string;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const FALLBACK_CACHE_KEY  = 'andalus_supabase_prayer_fallback_v1';
const DEFAULT_PROFILE_KEY = 'aladhan_mwl_shafi_sweden_angle_based';

// ── Private helpers ───────────────────────────────────────────────────────────

// Supabase day dates are DD-MM-YYYY — never parse as MM-DD-YYYY.
function parseDdMmYyyy(dateStr: string): { day: number; month: number; year: number } | null {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return null;
  const day   = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const year  = parseInt(parts[2], 10);
  if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
  return { day, month, year };
}

function matchesDate(dayObj: SupabasePrayerDay, date: Date): boolean {
  const p = parseDdMmYyyy(dayObj.date);
  if (!p) return false;
  return p.day === date.getDate() && p.month === date.getMonth() + 1 && p.year === date.getFullYear();
}

function mapDayToTimings(day: SupabasePrayerDay): Record<string, string> {
  return {
    Fajr:     day.fajr     || '',
    Sunrise:  day.sunrise  || '',
    Dhuhr:    day.dhuhr    || '',
    Asr:      day.asr      || '',
    Maghrib:  day.maghrib  || '',
    Isha:     day.isha     || '',
    Midnight: day.midnight || '',
  };
}

function mapMatchTypeToSource(matchType: string): string {
  switch (matchType) {
    case 'inside_boundary':  return 'supabase_inside_boundary';
    case 'nearest_boundary': return 'supabase_nearest_boundary';
    case 'nearest_centroid': return 'supabase_nearest_centroid';
    default:                 return `supabase_${matchType}`;
  }
}

// Final stored month key — stable once locationId (UUID) is known.
function makeMonthCacheKey(profileKey: string, locationId: string, year: number, month: number): string {
  return `prayer_month:${profileKey}:${locationId}:${year}:${month}`;
}

// Pointer key: maps rounded lat/lng → locationId (UUID) for pre-RPC cache lookup.
// toFixed(3) ≈ 111 m resolution — fine enough to stay inside a tätort boundary.
// Used only for the lookup step; month data is stored under makeMonthCacheKey.
function makePointerKey(profileKey: string, year: number, month: number, lat: number, lng: number): string {
  return `ptr:${profileKey}:${year}:${month}:${lat.toFixed(3)}:${lng.toFixed(3)}`;
}

// ── Cache r/w ─────────────────────────────────────────────────────────────────

// Reads the store once, resolves lat/lng pointer → locationId → month data.
async function lookupCache(
  ptrKey: string, profileKey: string, year: number, month: number,
): Promise<{ monthData: SupabasePrayerMonthResponse; monthKey: string } | null> {
  try {
    const raw = await AsyncStorage.getItem(FALLBACK_CACHE_KEY);
    if (!raw) return null;
    const store = JSON.parse(raw) as Record<string, unknown>;
    const locationId = store[ptrKey];
    if (typeof locationId !== 'string' || !locationId) return null;
    const monthKey  = makeMonthCacheKey(profileKey, locationId, year, month);
    const monthData = store[monthKey];
    if (!monthData || typeof monthData !== 'object') return null;
    return { monthData: monthData as SupabasePrayerMonthResponse, monthKey };
  } catch {
    return null;
  }
}

// Writes pointer + month data atomically in a single AsyncStorage round-trip.
async function writeToCache(
  ptrKey: string, locationId: string,
  monthKey: string, data: SupabasePrayerMonthResponse,
): Promise<void> {
  try {
    const raw   = await AsyncStorage.getItem(FALLBACK_CACHE_KEY);
    const store = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    store[ptrKey]   = locationId;
    store[monthKey] = data;
    await AsyncStorage.setItem(FALLBACK_CACHE_KEY, JSON.stringify(store));
  } catch {}
}

// ── RPC fetch ─────────────────────────────────────────────────────────────────

async function fetchMonthFromRpc(
  lat: number, lng: number, year: number, month: number, profileKey: string,
): Promise<SupabasePrayerMonthResponse | null> {
  const { data, error } = await supabase.rpc('get_prayer_month_by_position', {
    input_lat:         lat,
    input_lng:         lng,
    input_year:        year,
    input_month:       month,
    input_profile_key: profileKey,
  });
  if (error || !data) return null;
  // RPC may return a single object or a single-element array depending on Postgres function type.
  const raw: SupabasePrayerMonthResponse = Array.isArray(data) ? data[0] : data;
  if (!raw?.days?.length) return null;
  return raw;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Last-resort prayer time fallback via Supabase SCB polygon resolution.
 * Only called when daily cache, yearly cache, and Aladhan API have all failed.
 * Returns today + tomorrow timings, or null if Supabase is also unreachable.
 */
export async function getPrayerMonthFromSupabaseFallback(
  params: SupabasePrayerFallbackParams,
): Promise<SupabasePrayerFallbackResult | null> {
  const { latitude, longitude, date, profileKey = DEFAULT_PROFILE_KEY } = params;

  const year  = date.getFullYear();
  const month = date.getMonth() + 1;

  // 1. Try local fallback cache: pointer (lat/lng → locationId) → month data
  const ptrKey = makePointerKey(profileKey, year, month, latitude, longitude);
  const cached = await lookupCache(ptrKey, profileKey, year, month);
  let monthData: SupabasePrayerMonthResponse | null = cached?.monthData ?? null;

  // 2. Cache miss — call Supabase RPC, then store by stable locationId key
  if (!monthData) {
    monthData = await fetchMonthFromRpc(latitude, longitude, year, month, profileKey);
    if (!monthData) return null;
    const monthKey = makeMonthCacheKey(profileKey, monthData.location_id, year, month);
    await writeToCache(ptrKey, monthData.location_id, monthKey, monthData);
  }

  // 3. Find today inside the returned days array
  const todayDay = monthData.days.find(d => matchesDate(d, date));
  if (!todayDay) return null;
  const todayT = mapDayToTimings(todayDay);

  // 4. Tomorrow — try same month first, then fetch next month if at boundary
  const tomorrow     = new Date(date);
  tomorrow.setDate(date.getDate() + 1);
  const tomSameMonth = monthData.days.find(d => matchesDate(d, tomorrow));
  let   tomT: Record<string, string> | null = null;

  if (tomSameMonth) {
    tomT = mapDayToTimings(tomSameMonth);
  } else {
    // Last day of the month — fetch next month (one extra Supabase call, inside fallback path only)
    const nextYear    = tomorrow.getFullYear();
    const nextMonth   = tomorrow.getMonth() + 1;
    const nextPtrKey  = makePointerKey(profileKey, nextYear, nextMonth, latitude, longitude);
    const cachedNext  = await lookupCache(nextPtrKey, profileKey, nextYear, nextMonth);
    let   nextData: SupabasePrayerMonthResponse | null = cachedNext?.monthData ?? null;

    if (!nextData) {
      nextData = await fetchMonthFromRpc(latitude, longitude, nextYear, nextMonth, profileKey);
      if (nextData) {
        const nextMonthKey = makeMonthCacheKey(profileKey, nextData.location_id, nextYear, nextMonth);
        await writeToCache(nextPtrKey, nextData.location_id, nextMonthKey, nextData);
      }
    }

    if (nextData) {
      const tomNextDay = nextData.days.find(d => matchesDate(d, tomorrow));
      if (tomNextDay) tomT = mapDayToTimings(tomNextDay);
    }
  }

  // 5. Map hijri to Aladhan-compatible shape so existing widget + notification code works unchanged
  const hijri = {
    day:   String(todayDay.hijri_day),
    month: { number: String(todayDay.hijri_month_number), en: todayDay.hijri_month_en },
    year:  String(todayDay.hijri_year),
  };

  return {
    todayT,
    tomT,
    hijri,
    source:           mapMatchTypeToSource(monthData.match_type),
    locationId:       monthData.location_id,
    locationName:     monthData.location_name,
    municipalityName: monthData.municipality_name,
    countyName:       monthData.county_name,
    matchType:        monthData.match_type,
    distanceMeters:   monthData.distance_meters,
    year:             monthData.year,
    month:            monthData.month,
    fetchedAt:        monthData.fetched_at,
  };
}
