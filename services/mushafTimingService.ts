/**
 * mushafTimingService.ts
 *
 * Fetches per-verse timestamp data for verse-level audio synchronisation
 * during recitation playback.
 *
 * Data source: QuranCDN API
 *   GET https://api.qurancdn.com/api/qdc/audio/reciters/{id}/audio_files?chapter={surahId}&segments=1
 *   → verse_timings[].timestamp_from / timestamp_to (ms relative to full chapter audio)
 *
 * Page numbers: Quran.com API
 *   GET https://api.quran.com/api/v4/verses/by_chapter/{surahId}
 *       ?words=true&word_fields=code_v2,page_number&per_page=300&mushaf=1
 *   → word-level page_number per verse (for auto page advance)
 *
 * IMPORTANT: The verse-level `page_number` field returned by
 *   ?words=false&fields=page_number  is INCORRECT for some surahs.
 * Example: all 8 verses of surah 94 (As-Sharh) are returned with page_number=596,
 * but verses 94:3-8 physically appear on page 597. Including `code_v2` in
 * word_fields causes the API to return the correct QCF V2 word data, and crucially
 * also returns accurate word-level page_number values that reflect the physical
 * Mushaf page layout used by the renderer.
 *
 * Cache key: andalus_mushaf_timing_v3_{recitationId}_{surahId}
 * (v3 distinguishes from v2 caches that used the inaccurate verse-level page_number field)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const QDC_API  = 'https://api.qurancdn.com/api/qdc';
const QURAN_API = 'https://api.quran.com/api/v4';

const cacheKey = (recitationId: number, surahId: number) =>
  `andalus_mushaf_timing_v3_${recitationId}_${surahId}`;

// ── Types ─────────────────────────────────────────────────────────────────────

export type VerseTimestamp = {
  verseKey: string;      // e.g. "2:255"
  timestampFrom: number; // ms from start of chapter audio
  timestampTo: number;   // ms from start of chapter audio
  pageNumber: number;    // Mushaf page 1–604
};

// ── Binary search ─────────────────────────────────────────────────────────────

/**
 * Returns the verse being recited at positionMs.
 * Assumes timings are sorted ascending by timestampFrom.
 * Returns null if positionMs is before the first verse.
 */
export function findCurrentVerse(
  timings: VerseTimestamp[],
  positionMs: number,
): VerseTimestamp | null {
  if (!timings.length) return null;

  let lo = 0;
  let hi = timings.length - 1;

  // Find last entry where timestampFrom <= positionMs
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (timings[mid].timestampFrom <= positionMs) lo = mid;
    else hi = mid - 1;
  }

  return timings[lo].timestampFrom <= positionMs ? timings[lo] : null;
}

// ── API types ─────────────────────────────────────────────────────────────────

type QdcVerseTiming = {
  verse_key: string;
  timestamp_from: number;
  timestamp_to: number;
};

type QdcAudioFile = {
  verse_timings: QdcVerseTiming[];
};

type QdcResponse = {
  audio_files: QdcAudioFile[];
};

type QuranVerseWord = {
  code_v2:     string;
  page_number: number;
};

type QuranVerseEntry = {
  verse_key: string;
  words:     QuranVerseWord[];
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetches and caches verse timestamps for one surah of one reciter.
 *
 * Uses QuranCDN for chapter-relative verse timestamps, and Quran.com for
 * Mushaf page numbers (needed for auto page advance).
 *
 * Results are cached in AsyncStorage permanently — timing data is immutable
 * for a given reciter+surah combination.
 *
 * Throws on network failure when no cache exists.
 */
// ── Bismillah prepend ─────────────────────────────────────────────────────────

/**
 * Ensures the timings array starts with a synthetic `BSMLLH_{surahId}` entry
 * covering the silence/bismillah recitation that precedes verse content in all
 * surahs EXCEPT:
 *   • Surah 1  (Al-Fatihah) — verse 1:1 itself IS the bismillah recitation
 *   • Surah 9  (At-Tawbah)  — has no bismillah at all
 *
 * Applied to BOTH the cache path and the network path so old cached timing
 * data (stored before this entry was introduced) automatically gets it added
 * without requiring a full re-fetch.
 *
 * The entry is only injected if:
 *   • The surah is not 1 or 9
 *   • No entry with key `BSMLLH_{surahId}` already exists (idempotent)
 *
 * Always injected regardless of timestampFrom — even when verse 1 starts at
 * 0 ms (some reciters have no audible gap). The audio player's bismillah lock
 * (bismillahLockUntilMsRef) ensures the highlight persists for at least 3 s.
 */
function withBismillahEntry(timings: VerseTimestamp[], surahId: number): VerseTimestamp[] {
  if (surahId === 1 || surahId === 9) return timings;
  if (timings.length === 0) return timings;

  // Already present — nothing to do (handles both fresh fetches and old cache)
  if (timings[0].verseKey === `BSMLLH_${surahId}`) return timings;

  // Always inject — even when first.timestampFrom === 0 (some reciters have no
  // audible gap before verse 1). The bismillah lock in the audio player ensures
  // it stays highlighted for the correct duration regardless of the timestamp.
  const first = timings[0];

  return [
    {
      verseKey:      `BSMLLH_${surahId}`,
      timestampFrom: 0,
      timestampTo:   first.timestampFrom,
      pageNumber:    first.pageNumber,
    },
    ...timings,
  ];
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function fetchVerseTimings(
  recitationId: number,
  surahId: number,
): Promise<VerseTimestamp[]> {
  const key = cacheKey(recitationId, surahId);

  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as VerseTimestamp[];
      // Reject empty-array cache from old v1 data (defensive — v2 key is new).
      // Also reject caches where page numbers are missing or zero — these were
      // stored before the Quran.com page-number fetch was added (or if that fetch
      // silently failed). A cache with pageNumber=0 breaks auto page advance.
      // Exclude BSMLLH_ synthetic entries which derive pageNumber from verse 1.
      const verseEntries = parsed.filter(t => !t.verseKey.startsWith('BSMLLH_'));
      const hasValidPageNumbers =
        parsed.length > 0 &&
        verseEntries.length > 0 &&
        verseEntries.every(t => (t.pageNumber ?? 0) > 0);
      if (hasValidPageNumbers) return withBismillahEntry(parsed, surahId);
      // Cache is stale — fall through to re-fetch
    }
  } catch {
    // cache read failed — proceed to fetch
  }

  const [qdcRes, pagesRes] = await Promise.all([
    fetch(`${QDC_API}/audio/reciters/${recitationId}/audio_files?chapter=${surahId}&segments=1`),
    // word_fields=code_v2 is required: including code_v2 causes the API to return
    // accurate word-level page_number values that reflect the physical Mushaf layout.
    // Without code_v2, the API returns incorrect verse-level page numbers for some
    // surahs (e.g. all 8 verses of surah 94 are returned as page 596, but verses
    // 94:3-8 actually appear on page 597).
    fetch(`${QURAN_API}/verses/by_chapter/${surahId}?words=true&word_fields=code_v2,page_number&per_page=300&mushaf=1`),
  ]);

  if (!qdcRes.ok) throw new Error(`QDC API ${qdcRes.status} (reciter ${recitationId}, surah ${surahId})`);
  if (!pagesRes.ok) throw new Error(`Verses API ${pagesRes.status} (surah ${surahId})`);

  const qdcJson  = (await qdcRes.json())   as QdcResponse;
  const pagesJson = (await pagesRes.json()) as { verses: QuranVerseEntry[] };

  // Build page lookup: verse_key → page_number
  // Use the first word's page_number (word-level, accurate) rather than the
  // verse-level page_number field (which the API returns incorrectly for some surahs).
  const pageMap = new Map<string, number>();
  for (const v of pagesJson.verses) {
    const firstWord = v.words.find(w => w.code_v2 && (w.page_number ?? 0) > 0);
    if (firstWord) pageMap.set(v.verse_key, firstWord.page_number);
  }

  // QuranCDN returns an array with one entry per chapter audio file variant;
  // the first entry is always the primary one.
  const verseTimings = qdcJson.audio_files?.[0]?.verse_timings ?? [];

  const timings: VerseTimestamp[] = [];
  for (const t of verseTimings) {
    if (t.timestamp_from == null || t.timestamp_to == null) continue;
    timings.push({
      verseKey:      t.verse_key,
      timestampFrom: t.timestamp_from,
      timestampTo:   t.timestamp_to,
      pageNumber:    pageMap.get(t.verse_key) ?? 0,
    });
  }

  // Ensure sorted ascending by timestampFrom (API returns them in order, but guard anyway)
  timings.sort((a, b) => a.timestampFrom - b.timestampFrom);

  const finalTimings = withBismillahEntry(timings, surahId);

  try {
    await AsyncStorage.setItem(key, JSON.stringify(finalTimings));
  } catch {
    // cache write failed — non-fatal
  }

  return finalTimings;
}
