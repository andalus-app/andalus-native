/**
 * mushafPrefetchService.ts
 *
 * Background pre-caching for all 604 Mushaf pages.
 *
 * Fetches page verse data → AsyncStorage and downloads QCF font files →
 * DocumentDir for every page that is not already cached. Controlled
 * concurrency keeps network usage reasonable without blocking the UI.
 *
 * Call startMushafPrefetch() once after the Quran screen mounts.
 * Subsequent calls in the same session are no-ops.
 *
 * Both fetchComposedMushafPage and loadQCFPageFont are cache-first, so
 * already-cached pages return immediately (in-memory or AsyncStorage/disk).
 * The service naturally resumes across sessions: only un-cached pages
 * incur network work.
 */

import { fetchComposedMushafPage } from './mushafApi';
import { loadQCFPageFont, loadBismillahFont } from './mushafFontManager';

const TOTAL_PAGES = 604;

// Number of pages fetched concurrently. Keep at 4–5 to avoid CDN throttling
// while still making good progress in the background.
const CONCURRENCY = 4;

let _started = false;

/**
 * Starts the background pre-cache pass. Safe to call multiple times —
 * only the first call in a session has any effect.
 */
export function startMushafPrefetch(): void {
  if (_started) return;
  _started = true;
  _run().catch(() => undefined);
}

async function _prefetchPage(page: number): Promise<void> {
  try {
    // Both are cache-first. Returns near-instantly for already-cached pages.
    await Promise.all([
      fetchComposedMushafPage(page),
      loadQCFPageFont(page),
    ]);
  } catch {
    // Ignore individual page failures — the page will load on demand instead.
  }
}

async function _run(): Promise<void> {
  // Bismillah font is shared across all pages — load once.
  loadBismillahFont().catch(() => undefined);

  // Process all 604 pages in sequential batches of CONCURRENCY.
  // A short yield (setTimeout 0) between batches hands control back to the JS
  // event loop so UI interactions (swipes, taps) are never starved by sustained
  // Font.loadAsync() calls even after the 4-second startup delay elapses.
  for (let i = 1; i <= TOTAL_PAGES; i += CONCURRENCY) {
    const batch: Promise<void>[] = [];
    for (let j = i; j < i + CONCURRENCY && j <= TOTAL_PAGES; j++) {
      batch.push(_prefetchPage(j));
    }
    await Promise.all(batch);
    // Yield to the JS event loop between every batch.
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}
