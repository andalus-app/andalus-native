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

// ── Geographic proximity matching ────────────────────────────────────────────

// Max distance (km) for auto-selecting a nearby IFIS city.
// Beyond this threshold we return null so the caller can warn the user.
export const IFIS_MAX_DISTANCE_KM = 80;

// Coordinates for every city in the IFIS city list (lat, lng).
const IFIS_CITY_COORDS: Record<string, [number, number]> = {
  alingsas:      [57.931,  12.533],
  amal:          [59.052,  12.706],
  angelholm:     [56.243,  12.859],
  avesta:        [60.144,  16.168],
  bengtsfors:    [59.033,  12.233],
  boden:         [65.825,  21.689],
  bollnas:       [61.348,  16.393],
  boras:         [57.721,  12.940],
  borlange:      [60.486,  15.437],
  eksjo:         [57.667,  14.967],
  enkoping:      [59.635,  17.077],
  eskilstuna:    [59.371,  16.509],
  eslov:         [55.838,  13.304],
  falkenberg:    [56.906,  12.491],
  falkoping:     [58.170,  13.549],
  filipstad:     [59.712,  14.163],
  flen:          [59.058,  16.588],
  gallivare:     [67.133,  20.657],
  gavle:         [60.675,  17.141],
  gislaved:      [57.305,  13.538],
  gnosjo:        [57.358,  13.742],
  goteborg:      [57.709,  11.975],
  halmstad:      [56.675,  12.858],
  haparanda:     [65.835,  24.138],
  harnosand:     [62.633,  17.933],
  hassleholm:    [56.158,  13.767],
  helsingborg:   [56.047,  12.695],
  hogsby:        [57.167,  16.017],
  horby:         [55.857,  13.662],
  hudiksvall:    [61.728,  17.107],
  hultsfred:     [57.488,  15.848],
  jokkmokk:      [66.607,  19.828],
  jonkoping:     [57.783,  14.162],
  kalmar:        [56.663,  16.357],
  kalrshamn:     [56.171,  14.863], // API slug for Karlshamn
  karlskoga:     [59.326,  14.524],
  karlskrona:    [56.161,  15.587],
  karlstad:      [59.379,  13.504],
  katrineholm:   [58.995,  16.207],
  kiruna:        [67.856,  20.225],
  koping:        [59.514,  15.997],
  kristianstad:  [56.029,  14.157],
  kristinehamn:  [59.312,  14.107],
  laholm:        [56.514,  13.046],
  landskrona:    [55.871,  12.830],
  lessebo:       [56.752,  15.265],
  lidkoping:     [58.505,  13.158],
  linkoping:     [58.411,  15.621],
  ludvika:       [60.148,  15.188],
  lulea:         [65.585,  22.157],
  lund:          [55.705,  13.191],
  lysekil:       [58.274,  11.436],
  malmo:         [55.605,  13.004],
  mariestad:     [58.709,  13.826],
  marsta:        [59.621,  17.858],
  mellerud:      [58.701,  12.458],
  mjolby:        [58.327,  15.129],
  monsteras:     [57.042,  16.442],
  munkedal:      [58.469,  11.669],
  nassjo:        [57.653,  14.694],
  norrkoping:    [58.588,  16.192],
  norrtalje:     [59.758,  18.706],
  nybro:         [56.746,  15.909],
  nykoping:      [58.753,  17.008],
  nynashamn:     [58.903,  17.946],
  orebro:        [59.274,  15.207],
  ornskoldsvik:  [63.291,  18.717],
  oskarshamn:    [57.265,  16.448],
  ostersund:     [63.179,  14.636],
  oxelosund:     [58.670,  17.100],
  pajala:        [67.212,  23.398],
  pitea:         [65.317,  21.480],
  ronneby:       [56.208,  15.276],
  saffle:        [59.132,  12.925],
  sala:          [59.919,  16.604],
  savsjo:        [57.403,  14.669],
  simrishamn:    [55.557,  14.358],
  skara:         [58.387,  13.438],
  skelleftea:    [64.750,  20.950],
  skovde:        [58.389,  13.844],
  soderhamn:     [61.302,  17.056],
  sodertalje:    [59.195,  17.625],
  solleftea:     [63.167,  17.267],
  solvesborg:    [56.052,  14.574],
  stockholm:     [59.329,  18.069],
  strangnas:     [59.378,  17.031],
  sundsvall:     [62.391,  17.307],
  tierp:         [60.342,  17.517],
  tranemo:       [57.483,  13.350],
  trelleborg:    [55.376,  13.157],
  trollhattan:   [58.284,  12.289],
  uddevalla:     [58.349,  11.938],
  ulricehamn:    [57.792,  13.421],
  umea:          [63.826,  20.263],
  uppsala:       [59.859,  17.639],
  vanersborg:    [58.381,  12.323],
  varberg:       [57.106,  12.250],
  varnamo:       [57.184,  14.044],
  vasteras:      [59.610,  16.545],
  vastervik:     [57.758,  16.637],
  vaxjo:         [56.878,  14.809],
  vetlanda:      [57.429,  15.078],
  vimmerby:      [57.666,  15.855],
  visby:         [57.635,  18.295],
  ystad:         [55.430,  13.820],
};

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2
             + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
             * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export type NearestIfisCity = { city: string; distanceKm: number };

/** Returns the closest IFIS city within IFIS_MAX_DISTANCE_KM, or null if none qualifies. */
export function findNearestIfisCity(
  latitude: number,
  longitude: number,
  ifisCities: string[],
): NearestIfisCity | null {
  let best: NearestIfisCity | null = null;
  for (const city of ifisCities) {
    const coords = IFIS_CITY_COORDS[city];
    if (!coords) continue;
    const distanceKm = haversineKm(latitude, longitude, coords[0], coords[1]);
    if (!best || distanceKm < best.distanceKm) best = { city, distanceKm };
  }
  if (!best || best.distanceKm > IFIS_MAX_DISTANCE_KM) return null;
  return best;
}

export function matchIfisCity(
  geocodedCity: string,
  ifisCities: string[],
  coords?: { latitude: number; longitude: number },
): string | null {
  const normalized = normalizeIfisCity(geocodedCity);
  if (ifisCities.includes(normalized)) return normalized;
  const partial = ifisCities.find(c => normalized.includes(c) || c.includes(normalized));
  if (partial) return partial;
  if (coords) return findNearestIfisCity(coords.latitude, coords.longitude, ifisCities)?.city ?? null;
  return null;
}
