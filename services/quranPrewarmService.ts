/**
 * quranPrewarmService.ts
 *
 * Lightweight pre-warm for the Dagens Koranvers deep-link target.
 *
 * Triggered from DagensKoranversCard after InteractionManager.runAfterInteractions
 * so it never competes with the home screen's own critical render.
 *
 * What it does:
 *   - Fetches the EXACT Mushaf page for the target verse via API (once per session)
 *   - Fetches composed Mushaf page data for exact page ±2 (fills LRU data cache)
 *   - Registers QCF V2 page fonts for the exact page ±2 (ready in Core Text)
 *   - Does NOT render any SVG or React tree — metadata + font only
 *
 * What it does NOT do:
 *   - No React rendering, no component mounting
 *   - No network calls beyond the Quran Foundation API (same as QuranPager)
 *   - No async blocking of the caller
 *
 * Session safety:
 *   - Once-per-session guard per target key (verseKey + date)
 *   - Date-based expiry: a new calendar date invalidates the cached target
 *   - All work is fire-and-forget; errors are silently swallowed
 *
 * Exact-page cache:
 *   - _exactPageCache maps verseKey → confirmed word-level page number
 *   - Populated by the prewarm API call and also by app/quran.tsx on first tap
 *   - getCachedExactPage() lets app/quran.tsx skip its own API fetch on retap
 */

import { InteractionManager } from 'react-native';
import { loadQCFPageFont, loadBismillahFont } from './mushafFontManager';
import { fetchComposedMushafPage } from './mushafApi';
import { SURAH_INDEX } from '../data/surahIndex';

// ── Session state ──────────────────────────────────────────────────────────────

// Key: "<verseKey>:<YYYY-MM-DD>" — unique per verse+date combination.
// Cleared when the app restarts (session-scoped, held only in memory).
const _warmedKeys = new Set<string>();

let _currentDateStr: string | null = null;

// Exact page cache: verseKey → confirmed word-level Mushaf page number.
// Populated after the prewarm API call resolves. Session-scoped (resets on restart).
// Allows app/quran.tsx to skip its own API fetch on repeated taps for the same verse.
const _exactPageCache = new Map<string, number>();

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function makeKey(verseKey: string): string {
  return `${verseKey}:${todayStr()}`;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Pre-warms fonts and page data for the Dagens Koranvers target.
 *
 * Safe to call multiple times with the same verseKey — the once-per-session
 * guard makes subsequent calls instant no-ops.
 *
 * @param verseKey  e.g. "2:255" — the verse that will be navigated to on tap
 */
export function prewarmDailyVerseTarget(verseKey: string): void {
  const today = todayStr();

  // Purge stale keys from a previous calendar day.
  if (_currentDateStr !== today) {
    _warmedKeys.clear();
    _exactPageCache.clear();
    _currentDateStr = today;
  }

  const key = makeKey(verseKey);
  if (_warmedKeys.has(key)) return; // already warmed this session
  _warmedKeys.add(key);

  // Resolve approximate page synchronously from surahIndex (no network).
  const [surahStr] = verseKey.split(':');
  const surahId = parseInt(surahStr, 10);
  const surah = isNaN(surahId) ? null : SURAH_INDEX.find((s) => s.id === surahId);
  const approxPage = surah?.firstPage ?? 1;

  // Defer all work until interactions/animations are complete.
  InteractionManager.runAfterInteractions(() => {
    _doPrewarm(verseKey, approxPage);
  });
}

/**
 * Returns the confirmed word-level Mushaf page for a verseKey, or null if not
 * yet resolved. Call this before navigating so app/quran.tsx can skip its own
 * API fetch and navigate directly to the correct page on the first tap.
 */
export function getCachedExactPage(verseKey: string): number | null {
  return _exactPageCache.get(verseKey) ?? null;
}

/**
 * Stores the exact page for a verseKey. Called by app/quran.tsx after its own
 * API fetch resolves so subsequent taps reuse the result without another request.
 */
export function setCachedExactPage(verseKey: string, page: number): void {
  _exactPageCache.set(verseKey, page);
}

/**
 * Returns true if the given verse key has already been pre-warmed today.
 * Used by QuranVerseView to skip the first-attempt polling if fonts/data
 * are already in the LRU cache.
 */
export function isPrewarmed(verseKey: string): boolean {
  const today = todayStr();
  if (_currentDateStr !== today) return false;
  return _warmedKeys.has(makeKey(verseKey));
}

// ── Internal ───────────────────────────────────────────────────────────────────

const TOTAL_PAGES = 604;
const PREWARM_RADIUS = 2; // pre-warm target ±2 pages

async function _doPrewarm(verseKey: string, approxPage: number): Promise<void> {
  // Step 1: always pre-warm the approx page range immediately (fast, no network
  // if the font/data is already cached from a previous session).
  _prewarmPageRange(approxPage);

  // Step 2: fetch the exact word-level page from the API (same call as app/quran.tsx).
  // This resolves ONCE per session and caches the result so that on the first tap
  // the user navigates directly to the correct page without an in-flight fetch.
  if (_exactPageCache.has(verseKey)) return; // already resolved

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(
      `https://api.quran.com/api/v4/verses/by_key/${verseKey}` +
      `?words=true&word_fields=code_v2,page_number&mushaf=1`,
      { signal: controller.signal },
    );
    clearTimeout(timeoutId);
    const data: { verse?: { words?: Array<{ page_number?: number }> } } = await res.json();
    const exactPage = data?.verse?.words?.[0]?.page_number;
    if (typeof exactPage === 'number' && exactPage !== approxPage) {
      _exactPageCache.set(verseKey, exactPage);
      // Also pre-warm the exact page range — fonts + data for correct page.
      _prewarmPageRange(exactPage);
    } else if (typeof exactPage === 'number') {
      _exactPageCache.set(verseKey, exactPage);
    }
  } catch {
    // Network error or timeout — approx page pre-warm is still useful.
  }
}

function _prewarmPageRange(pageNumber: number): void {
  const start = Math.max(1, pageNumber - PREWARM_RADIUS);
  const end   = Math.min(TOTAL_PAGES, pageNumber + PREWARM_RADIUS);

  // Load bismillah font once (shared across all pages).
  loadBismillahFont();

  // Fire all page data fetches and font loads concurrently — each is
  // internally deduplicated (no-op if already cached / loaded).
  for (let p = start; p <= end; p++) {
    fetchComposedMushafPage(p);
    loadQCFPageFont(p);
  }
}
