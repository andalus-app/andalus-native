import AsyncStorage from '@react-native-async-storage/async-storage';

export const SWEDISH_DAYS   = ['Sön','Mån','Tis','Ons','Tor','Fre','Lör'];
export const SWEDISH_MONTHS = ['Januari','Februari','Mars','April','Maj','Juni','Juli','Augusti','September','Oktober','November','December'];

export type DayRow = {
  date:    string;
  dayName: string;
  dayNum:  number;
  times:   string[];
};

const CACHE_KEY = 'andalus_yearly_cache';

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

function makeCacheKey(
  year: number, lat: number, lng: number, method: number, school: number,
): string {
  return `${year}_${lat.toFixed(2)}_${lng.toFixed(2)}_${method}_${school}`;
}

/**
 * Fetches all 12 months of `year` (+ Jan of next year for December midnight)
 * in one parallel batch and persists to AsyncStorage.
 * Safe to call multiple times — skips if cache is already complete for these params.
 */
export async function buildYearlyCache(
  year: number, lat: number, lng: number, method: number, school: number,
): Promise<void> {
  const key = makeCacheKey(year, lat, lng, method, school);

  // Skip if already complete
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (raw) {
      const c = JSON.parse(raw);
      if (c.key === key && Object.keys(c.months).length === 12) return;
    }
  } catch {}

  // Fetch all 12 months + January of next year in one parallel batch
  const fetches = Array.from({ length: 13 }, (_, i) => {
    const m = i < 12 ? i + 1 : 1;
    const y = i < 12 ? year   : year + 1;
    return fetch(
      `https://api.aladhan.com/v1/calendar/${y}/${m}?latitude=${lat}&longitude=${lng}&method=${method}&school=${school}`,
    );
  });

  const results  = await Promise.all(fetches);
  const jsonData = await Promise.all(results.map(r => r.json()));
  const allData: any[][] = jsonData.map(j => (Array.isArray(j.data) ? j.data : []));

  const months: Record<number, DayRow[]> = {};

  for (let m = 1; m <= 12; m++) {
    const days         = allData[m - 1];       // current month's days
    const nextMonthDays = allData[m];           // next month (index m) for midnight calc

    months[m] = days.map((d: any, i: number) => {
      const t       = d.timings || {};
      const dateObj = new Date(year, m - 1, i + 1);
      const nextFajr =
        i < days.length - 1
          ? stripTz(days[i + 1]?.timings?.Fajr || '')
          : stripTz(nextMonthDays[0]?.timings?.Fajr || '');

      return {
        date:    `${year}-${String(m).padStart(2,'0')}-${String(i + 1).padStart(2,'0')}`,
        dayName: SWEDISH_DAYS[dateObj.getDay()],
        dayNum:  i + 1,
        times: [
          stripTz(t.Fajr    || ''), stripTz(t.Sunrise || ''), stripTz(t.Dhuhr || ''),
          stripTz(t.Asr     || ''), stripTz(t.Maghrib || ''), stripTz(t.Isha  || ''),
          calcMidnight(stripTz(t.Maghrib || ''), nextFajr),
        ],
      };
    });
  }

  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ key, year, months }));
}

/**
 * Returns cached DayRow[] for a given month, or null on miss.
 */
export async function getMonthFromCache(
  year: number, month: number, lat: number, lng: number, method: number, school: number,
): Promise<DayRow[] | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (c.key !== makeCacheKey(year, lat, lng, method, school)) return null;
    return (c.months[month] as DayRow[]) || null;
  } catch { return null; }
}
