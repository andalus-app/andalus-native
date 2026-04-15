/**
 * quranVerseService.ts
 *
 * Fetches verse-level data (Arabic text + optional translation) per Mushaf page.
 * Used exclusively by verse-by-verse reading mode.
 *
 * API: GET /api/v4/verses/by_page/{pageNumber}?fields=text_uthmani&translations={id}
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Types ─────────────────────────────────────────────────────────────────────

export type VerseData = {
  verseKey: string;      // e.g. '2:255'
  surahId: number;
  verseNumber: number;
  textUthmani: string;   // Unicode Arabic text (not QCF font)
  translation: string | null;
};

// ── Cache ─────────────────────────────────────────────────────────────────────

// Do not change this prefix — it may be in use on devices.
const CACHE_PREFIX = 'andalus_quran_verse_v1_';

function cacheKey(pageNumber: number, translationId: number | null): string {
  return `${CACHE_PREFIX}${pageNumber}_${translationId ?? 'none'}`;
}

// ── API ───────────────────────────────────────────────────────────────────────

const API_BASE = 'https://api.quran.com/api/v4';

interface ApiVerse {
  verse_key: string;
  text_uthmani: string;
  translations?: Array<{ text: string }>;
}

async function fetchFromApi(
  pageNumber: number,
  translationId: number | null,
  signal?: AbortSignal,
): Promise<VerseData[]> {
  let url =
    `${API_BASE}/verses/by_page/${pageNumber}` +
    `?per_page=50&fields=text_uthmani,verse_key`;
  if (translationId !== null) {
    url += `&translations=${translationId}`;
  }
  const resp = await fetch(url, { signal });
  if (!resp.ok) throw new Error(`Verse API ${resp.status}`);
  const json = await resp.json() as { verses: ApiVerse[] };

  return (json.verses ?? []).map((v) => {
    const [surahStr, verseStr] = v.verse_key.split(':');
    return {
      verseKey: v.verse_key,
      surahId: parseInt(surahStr, 10),
      verseNumber: parseInt(verseStr, 10),
      textUthmani: v.text_uthmani,
      translation:
        translationId !== null ? (v.translations?.[0]?.text ?? null) : null,
    };
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns verse data (Arabic + optional translation) for all verses on a page.
 * Cache-first: reads AsyncStorage, fetches from API on miss.
 */
export async function getPageVerseData(
  pageNumber: number,
  translationId: number | null,
  signal?: AbortSignal,
): Promise<VerseData[]> {
  const key = cacheKey(pageNumber, translationId);

  try {
    const cached = await AsyncStorage.getItem(key);
    if (cached) return JSON.parse(cached) as VerseData[];
  } catch {
    // Cache miss or corrupt — fall through to API
  }

  const verses = await fetchFromApi(pageNumber, translationId, signal);

  // Persist to cache (fire and forget)
  AsyncStorage.setItem(key, JSON.stringify(verses)).catch(() => undefined);

  return verses;
}
