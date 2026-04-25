/**
 * quranPrewarmService.ts
 *
 * Lightweight pre-warm for the Dagens Koranvers deep-link target.
 *
 * Triggered from DagensKoranversCard after InteractionManager.runAfterInteractions
 * so it never competes with the home screen's own critical render.
 *
 * What it does:
 *   - Fetches composed Mushaf page data for target page ±2 (fills LRU data cache)
 *   - Registers QCF V2 page fonts for the same range (so they're ready in Core Text)
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
    _currentDateStr = today;
  }

  const key = makeKey(verseKey);
  if (_warmedKeys.has(key)) return; // already warmed this session
  _warmedKeys.add(key);

  // Resolve approximate page synchronously from surahIndex (no network).
  const [surahStr] = verseKey.split(':');
  const surahId = parseInt(surahStr, 10);
  const surah = isNaN(surahId) ? null : SURAH_INDEX.find((s) => s.id === surahId);
  const pageNumber = surah?.firstPage ?? 1;

  // Defer all work until interactions/animations are complete.
  InteractionManager.runAfterInteractions(() => {
    _doPrewarm(pageNumber);
  });
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

async function _doPrewarm(pageNumber: number): Promise<void> {
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
