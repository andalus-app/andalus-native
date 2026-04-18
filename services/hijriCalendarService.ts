/**
 * Hijri calendar utilities — AlAdhan API.
 *
 * Fetches Hijri ↔ Gregorian conversions from AlAdhan (same source used for
 * prayer times). All functions are async and throw on network or parse errors.
 * Callers are responsible for catching errors.
 */

const ALADHAN_BASE = 'https://api.aladhan.com/v1';

export type HijriDate = {
  day: number;
  month: number;
  monthName: string; // English transliteration (Muharram, Safar, …)
  year: number;
};

/** Standard English transliterations for all 12 Hijri months. */
export const HIJRI_MONTH_NAMES: Record<number, string> = {
  1:  'Muharram',
  2:  'Safar',
  3:  'Rabi al-Awwal',
  4:  'Rabi al-Thani',
  5:  'Jumada al-Awwal',
  6:  'Jumada al-Thani',
  7:  'Rajab',
  8:  'Shaban',
  9:  'Ramadan',
  10: 'Shawwal',
  11: 'Dhul-Qadah',
  12: 'Dhul-Hijjah',
};

/** Convert a Gregorian date (DD-MM-YYYY string) to a HijriDate. */
export async function gregorianToHijri(
  ddmmyyyy: string,
  signal?: AbortSignal,
): Promise<HijriDate> {
  const res = await fetch(`${ALADHAN_BASE}/gToH?date=${ddmmyyyy}`, { signal });
  if (!res.ok) throw new Error(`AlAdhan gToH HTTP ${res.status}`);
  const json = await res.json();
  const h = json?.data?.hijri;
  if (!h) throw new Error('AlAdhan gToH: unexpected response shape');
  return {
    day:       parseInt(h.day, 10),
    month:     parseInt(h.month.number, 10),
    monthName: HIJRI_MONTH_NAMES[parseInt(h.month.number, 10)] ?? h.month.en,
    year:      parseInt(h.year, 10),
  };
}

/** Get today's Hijri date from AlAdhan. */
export async function getTodayHijri(signal?: AbortSignal): Promise<HijriDate> {
  const now = new Date();
  const dd   = String(now.getDate()).padStart(2, '0');
  const mm   = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = String(now.getFullYear());
  return gregorianToHijri(`${dd}-${mm}-${yyyy}`, signal);
}

/**
 * Convert a Hijri (day, month, year) to a Gregorian Date object.
 * Returns midnight local time on that day.
 */
export async function hijriToGregorian(
  day: number,
  month: number,
  year: number,
  signal?: AbortSignal,
): Promise<Date> {
  const res = await fetch(`${ALADHAN_BASE}/hToG/${day}/${month}/${year}`, { signal });
  if (!res.ok) throw new Error(`AlAdhan hToG HTTP ${res.status}`);
  const json = await res.json();
  const g = json?.data?.gregorian;
  if (!g) throw new Error('AlAdhan hToG: unexpected response shape');
  // API returns "DD-MM-YYYY" in gregorian.date
  const [d, m, y] = (g.date as string).split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/**
 * Find the next Gregorian Date for a given Hijri (day, month) combination.
 *
 * Algorithm:
 *   - If the target day/month is still ahead this Hijri year → use current year.
 *   - Otherwise → use current year + 1.
 *
 * Returns midnight local time on the resulting Gregorian date.
 */
export async function nextGregorianForHijri(
  hijriDay: number,
  hijriMonth: number,
  currentHijri: HijriDate,
  signal?: AbortSignal,
): Promise<Date> {
  const isAhead =
    hijriMonth > currentHijri.month ||
    (hijriMonth === currentHijri.month && hijriDay >= currentHijri.day);

  const targetYear = isAhead ? currentHijri.year : currentHijri.year + 1;
  return hijriToGregorian(hijriDay, hijriMonth, targetYear, signal);
}
