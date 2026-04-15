/**
 * quranTranslationService.ts
 *
 * Fetches Quran translations from the Quran Foundation API and caches them
 * per-page in AsyncStorage.
 *
 * API: GET /api/v4/verses/by_page/{pageNumber}?translations={id}&...
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { BERNSTROM_DATA, BERNSTROM_META } from '../data/bernstromTranslation';

// ── Types ─────────────────────────────────────────────────────────────────────

export type Translation = {
  id: number;
  name: string;          // Display name
  language: string;      // e.g. 'Swedish', 'English'
  authorName: string;
};

export type TranslatedVerse = {
  verseKey: string;       // e.g. '1:1'
  text: string;           // Translation text (may contain footnote markers)
};

// ── Local (offline) Bernström translation ─────────────────────────────────────

/**
 * Sentinel ID for the bundled Knut Bernström translation (offline-first).
 * Negative so it never collides with real Quran Foundation API translation IDs.
 */
export const LOCAL_BERNSTROM_ID = -1;

/**
 * Quran Foundation API translation ID for Bernström's Swedish translation.
 * We bundle our own copy locally, so this ID is filtered out of the API
 * translation list to avoid showing a duplicate Swedish Bernström entry.
 */
export const API_BERNSTROM_ID = 48;

/** Re-export attribution metadata for UI use */
export { BERNSTROM_META };

// Built once from the bundled JSON and reused for every page request.
let _localBernstromArray: TranslatedVerse[] | null = null;

function getLocalBernstromArray(): TranslatedVerse[] {
  if (!_localBernstromArray) {
    _localBernstromArray = Object.entries(BERNSTROM_DATA).map(([verseKey, text]) => ({
      verseKey,
      text,
    }));
  }
  return _localBernstromArray;
}

// ── Translation catalogue ─────────────────────────────────────────────────────

export const TRANSLATIONS: Translation[] = [
  { id: 131, name: 'Sahih International', language: 'English', authorName: 'Sahih International' },
  { id: 20,  name: 'Pickthall (English)', language: 'English', authorName: 'Muhammad Pickthall' },
  { id: 149, name: 'Yusuf Ali (English)', language: 'English', authorName: 'Abdullah Yusuf Ali' },
];

/**
 * Default translation is the bundled offline Bernström (LOCAL_BERNSTROM_ID = -1).
 * This replaces the former API-based default (ID 48) — no network required.
 */
export const DEFAULT_TRANSLATION_ID = LOCAL_BERNSTROM_ID;

// ── Cache key ─────────────────────────────────────────────────────────────────

// Do not change this prefix — it may be in use on devices.
const CACHE_PREFIX = 'andalus_quran_trans_v1_';

function cacheKey(translationId: number, pageNumber: number): string {
  return `${CACHE_PREFIX}${translationId}_${pageNumber}`;
}

// ── API ───────────────────────────────────────────────────────────────────────

const API_BASE = 'https://api.quran.com/api/v4';

interface ApiVerse {
  verse_key: string;
  translations: Array<{ text: string }>;
}

async function fetchFromApi(
  translationId: number,
  pageNumber: number,
  signal?: AbortSignal,
): Promise<TranslatedVerse[]> {
  const url =
    `${API_BASE}/verses/by_page/${pageNumber}` +
    `?translations=${translationId}&per_page=50&fields=verse_key`;
  const resp = await fetch(url, { signal });
  if (!resp.ok) throw new Error(`Translation API ${resp.status}`);
  const json = await resp.json() as { verses: ApiVerse[] };
  return (json.verses ?? []).map((v) => ({
    verseKey: v.verse_key,
    text: v.translations?.[0]?.text ?? '',
  }));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns translations for all verses on a page.
 * Reads from AsyncStorage cache first; fetches from API if missing.
 *
 * @param translationId - Translation ID from TRANSLATIONS catalogue
 * @param pageNumber    - Mushaf page number (1–604)
 * @param signal        - Optional AbortController signal for cancellation
 */
export async function getPageTranslations(
  translationId: number,
  pageNumber: number,
  signal?: AbortSignal,
): Promise<TranslatedVerse[]> {
  // Local bundled translation — no network, no AsyncStorage
  if (translationId === LOCAL_BERNSTROM_ID) {
    return getLocalBernstromArray();
  }

  const key = cacheKey(translationId, pageNumber);

  // Try cache first
  try {
    const cached = await AsyncStorage.getItem(key);
    if (cached) return JSON.parse(cached) as TranslatedVerse[];
  } catch {
    // Cache miss or corrupt — continue to fetch
  }

  const verses = await fetchFromApi(translationId, pageNumber, signal);

  // Persist to cache (fire and forget — don't block return)
  AsyncStorage.setItem(key, JSON.stringify(verses)).catch(() => undefined);

  return verses;
}

// ── Bismillah translation ─────────────────────────────────────────────────────

const BISMILLAH_CACHE_PREFIX = 'andalus_quran_basmala_v1_';

/**
 * Returns the translation of verse 1:1 (the Bismillah / Basmala) for a given
 * translation ID.
 *
 * - LOCAL_BERNSTROM_ID: reads directly from the bundled BERNSTROM_DATA — instant,
 *   no network, no AsyncStorage.
 * - API translations: fetches verse 1:1 from the Quran Foundation API and caches
 *   the result in AsyncStorage so subsequent calls are free.
 *
 * Returns null on any error (network failure, missing translation).
 */
export async function getBismillahTranslation(
  translationId: number,
  signal?: AbortSignal,
): Promise<string | null> {
  if (translationId === LOCAL_BERNSTROM_ID) {
    return BERNSTROM_DATA['1:1'] ?? null;
  }

  const key = `${BISMILLAH_CACHE_PREFIX}${translationId}`;
  try {
    const cached = await AsyncStorage.getItem(key);
    if (cached !== null) return cached;
  } catch { /* cache miss — continue to fetch */ }

  try {
    const url =
      `${API_BASE}/verses/by_key/1:1` +
      `?translations=${translationId}&fields=verse_key`;
    const resp = await fetch(url, { signal });
    if (!resp.ok) throw new Error(`Basmala API ${resp.status}`);
    const json = await resp.json() as { verse: { translations: Array<{ text: string }> } };
    const raw = json.verse?.translations?.[0]?.text ?? null;
    if (raw) {
      // Strip HTML/footnote markers the same way cleanTranslation() does.
      const text = raw.replace(/<sup[^>]*>.*?<\/sup>/gs, '').replace(/<[^>]+>/g, '').trim();
      AsyncStorage.setItem(key, text).catch(() => undefined);
      return text;
    }
    return null;
  } catch {
    return null;
  }
}

// ── All-translations catalogue ────────────────────────────────────────────────

export type ApiTranslation = {
  id: number;
  name: string;
  authorName: string;
  languageName: string; // lowercase English, e.g. 'swedish', 'turkish'
};

const ALL_TRANS_CACHE_KEY = 'andalus_quran_all_translations_v1';

interface RawApiTranslation {
  id: number;
  name: string;
  author_name: string;
  language_name: string;
}

/**
 * Returns all ~126 translations available on quran.com.
 * Cached permanently in AsyncStorage after first fetch.
 */
export async function fetchAllTranslations(): Promise<ApiTranslation[]> {
  try {
    const cached = await AsyncStorage.getItem(ALL_TRANS_CACHE_KEY);
    if (cached) return JSON.parse(cached) as ApiTranslation[];
  } catch { /* fall through */ }

  const resp = await fetch(`${API_BASE}/resources/translations`);
  if (!resp.ok) throw new Error(`Translations catalogue ${resp.status}`);
  const json = await resp.json() as { translations: RawApiTranslation[] };

  const result: ApiTranslation[] = json.translations.map((t) => ({
    id: t.id,
    name: t.name,
    authorName: t.author_name,
    languageName: t.language_name.toLowerCase(),
  }));

  AsyncStorage.setItem(ALL_TRANS_CACHE_KEY, JSON.stringify(result)).catch(() => undefined);
  return result;
}

// ── Translation search ────────────────────────────────────────────────────────

export type TranslationMatch = {
  verseKey: string;  // e.g. "2:255"
  surahId: number;
  text: string;      // full verse translation text
  matchStart: number;
  matchEnd: number;
};

/**
 * Searches translation text for a query string.
 * Bernström (LOCAL_BERNSTROM_ID) is searched entirely in memory — very fast (~10ms).
 * API translations are searched from AsyncStorage cache — only cached pages are searched.
 *
 * Returns at most `maxResults` matches, ordered by verse order.
 */
/**
 * Normalizes a string for diacritic-insensitive search.
 * NFD-decomposes each character into base + combining marks, then strips
 * all combining diacritical marks (U+0300–U+036F).
 *
 * Crucially, NFD + strip preserves character count: each source character
 * contributes exactly one base character to the result (e.g. Ṣ → S).
 * This means indexOf positions on the normalized text map 1:1 to positions
 * in the original text, so matchStart/matchEnd can be used directly on the
 * original verse text for UI highlighting without any re-mapping.
 *
 * Example: "AṢ-ṢAFA" → "as-safa", so "safa" matches at index 3.
 *          original.slice(3, 7) = "ṢAFA" → highlighted correctly.
 */
function normSearch(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export async function searchTranslation(
  query: string,
  translationId: number,
  maxResults = 60,
): Promise<TranslationMatch[]> {
  const q = normSearch(query);
  if (!q || q.length < 2) return [];
  const results: TranslationMatch[] = [];

  if (translationId === LOCAL_BERNSTROM_ID) {
    // All 6236 verses are in memory — synchronous scan, <15ms.
    for (const v of getLocalBernstromArray()) {
      if (results.length >= maxResults) break;
      const idx = normSearch(v.text).indexOf(q);
      if (idx !== -1) {
        const parts = v.verseKey.split(':');
        results.push({
          verseKey: v.verseKey,
          surahId: parseInt(parts[0], 10),
          text: v.text,
          matchStart: idx,
          matchEnd: idx + q.length,
        });
      }
    }
    return results;
  }

  // API translation: search pages cached in AsyncStorage.
  const allKeys = await AsyncStorage.getAllKeys();
  const prefix = `${CACHE_PREFIX}${translationId}_`;
  const pageKeys = allKeys.filter((k) => k.startsWith(prefix));

  for (const key of pageKeys) {
    if (results.length >= maxResults) break;
    try {
      const raw = await AsyncStorage.getItem(key);
      if (!raw) continue;
      const verses = JSON.parse(raw) as TranslatedVerse[];
      for (const v of verses) {
        if (results.length >= maxResults) break;
        const idx = normSearch(v.text).indexOf(q);
        if (idx !== -1) {
          const parts = v.verseKey.split(':');
          results.push({
            verseKey: v.verseKey,
            surahId: parseInt(parts[0], 10),
            text: v.text,
            matchStart: idx,
            matchEnd: idx + q.length,
          });
        }
      }
    } catch { /* corrupt cache entry — skip */ }
  }

  return results;
}

// ── Downloaded translations list ──────────────────────────────────────────────

/**
 * Stores the list of ApiTranslation objects the user has explicitly selected.
 * LOCAL_BERNSTROM_ID is always treated as downloaded (bundled), so it is never
 * stored here — it is injected at read time.
 */
const DOWNLOADED_TRANS_KEY = 'andalus_quran_downloaded_trans_v1';

export async function getDownloadedTranslations(): Promise<ApiTranslation[]> {
  try {
    const raw = await AsyncStorage.getItem(DOWNLOADED_TRANS_KEY);
    if (raw) return JSON.parse(raw) as ApiTranslation[];
  } catch { /* corrupt — return empty */ }
  return [];
}

/** Adds a translation to the downloaded list if not already present. */
export async function addDownloadedTranslation(tr: ApiTranslation): Promise<void> {
  if (tr.id === LOCAL_BERNSTROM_ID) return; // always present — no need to store
  const current = await getDownloadedTranslations();
  if (!current.find((t) => t.id === tr.id)) {
    current.push(tr);
    await AsyncStorage.setItem(DOWNLOADED_TRANS_KEY, JSON.stringify(current));
  }
}

/** Clears all cached translations for a given translation ID. */
export async function clearTranslationCache(translationId: number): Promise<void> {
  const allKeys = await AsyncStorage.getAllKeys();
  const prefix = `${CACHE_PREFIX}${translationId}_`;
  const matching = allKeys.filter((k) => k.startsWith(prefix));
  if (matching.length > 0) await AsyncStorage.multiRemove(matching);
}

/** Clears ALL cached translation pages across every translation ID. */
export async function clearAllTranslationCaches(): Promise<void> {
  const allKeys = await AsyncStorage.getAllKeys();
  const matching = allKeys.filter((k) => k.startsWith(CACHE_PREFIX));
  if (matching.length > 0) await AsyncStorage.multiRemove(matching);
}

/** Returns total number of cached translation pages across all translation IDs. */
export async function cachedTranslationPageCount(): Promise<number> {
  const allKeys = await AsyncStorage.getAllKeys();
  return allKeys.filter((k) => k.startsWith(CACHE_PREFIX)).length;
}
