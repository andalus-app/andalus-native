/**
 * Shared last-page cache for the Quran reader.
 *
 * Pre-loads from AsyncStorage at import time so QuranRoute can read
 * synchronously (no flash). saveLastPage() keeps the in-memory value
 * in sync so the next navigation reads the correct page immediately.
 *
 * Also pre-warms the QCF font and page data for the last-visited page
 * as soon as the saved page is known. This ensures that when the user
 * opens the Quran tab, both Font.isLoaded() and _composedPageCache are
 * already populated → QuranPageView / MushafRenderer render instantly
 * with no black loading screen.
 *
 * Import this module as a side-effect in app/_layout.tsx so the pre-warm
 * starts at app startup, not only when /quran is first navigated to.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadQCFPageFont, loadBismillahFont } from './mushafFontManager';
import { fetchComposedMushafPage } from './mushafApi';

export const QURAN_LAST_PAGE_KEY = 'andalus_quran_last_page';

let _cache: number | null = null;

function prewarmPage(page: number): void {
  // Pre-warm the saved page and its immediate neighbors.
  // loadQCFPageFont: registers the font with Font.loadAsync so Font.isLoaded()
  //   returns true → MushafRenderer init starts in 'ready' state, no spinner.
  // fetchComposedMushafPage: populates _composedPageCache so QuranPageView
  //   receives a synchronously-resolved Promise → no loading state.
  const start = Math.max(1, page - 1);
  const end   = Math.min(604, page + 1);
  for (let p = start; p <= end; p++) {
    loadQCFPageFont(p).catch(() => undefined);
    fetchComposedMushafPage(p).catch(() => undefined);
  }
  loadBismillahFont().catch(() => undefined);
}

// Fire-and-forget pre-load — runs when the module is first imported (app start).
AsyncStorage.getItem(QURAN_LAST_PAGE_KEY)
  .then((raw) => {
    const n = raw ? parseInt(raw, 10) : 1;
    _cache = Number.isFinite(n) && n >= 1 && n <= 604 ? n : 1;
    prewarmPage(_cache);
  })
  .catch(() => { _cache = 1; });

/** Synchronous read — returns cached value or 1 if not yet loaded. */
export function getCachedLastPage(): number {
  return _cache ?? 1;
}

/**
 * Updates the in-memory cache immediately and persists to AsyncStorage.
 * Called by QuranContext on every (debounced) page change.
 */
export function saveLastPage(page: number): void {
  _cache = page;
  AsyncStorage.setItem(QURAN_LAST_PAGE_KEY, String(page)).catch(() => undefined);
}
