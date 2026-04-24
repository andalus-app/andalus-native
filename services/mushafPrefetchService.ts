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

// Number of pages fetched concurrently.
// Reduced from 4 to 2: each Font.loadAsync() call is JS-thread-heavy
// (parses TTF, registers with Core Text). Running 4 in parallel saturated
// the JS thread during the 16ms window, blocking swipe gestures and taps.
// 2 concurrent loads keep the JS thread 50–60% lighter between yields.
const CONCURRENCY = 2;

let _started = false;
let _stopped = false;
// When true, _run() waits at each batch boundary until resumed.
// Set by pauseMushafPrefetch() at scroll start; cleared by resumeMushafPrefetch().
let _paused  = false;

/**
 * Starts the background pre-cache pass. Safe to call multiple times —
 * only the first call while running has any effect.
 */
export function startMushafPrefetch(): void {
  if (_started && !_stopped) return;
  _started = true;
  _stopped = false;
  _paused  = false;
  _run().catch(() => undefined);
}

/**
 * Stops the background pre-cache pass after the current batch finishes.
 * Also resets _started so startMushafPrefetch() can be called again (e.g.
 * when the user re-opens the Quran screen after navigating away).
 *
 * Call this from the Quran screen's unmount cleanup to avoid keeping
 * Font.loadAsync() (JS-thread-heavy in bundled mode) alive after the
 * user has navigated away.
 */
export function stopMushafPrefetch(): void {
  _stopped = true;
  _started = false;
  _paused  = false;
}

/**
 * Pauses the background pre-cache at the next batch boundary.
 * Call from QuranPager when a swipe gesture begins so prefetch Font.loadAsync()
 * calls do not compete with the JS thread during page transitions.
 */
export function pauseMushafPrefetch(): void {
  if (_paused) return; // already paused — skip log spam on rapid drag events
  _paused = true;
  if (__DEV__) console.log('[Prefetch] paused (swipe started)');
}

/**
 * Resumes the background pre-cache after a pause.
 * Call from QuranPager when momentum scroll ends (page has fully settled).
 */
export function resumeMushafPrefetch(): void {
  if (!_paused) return; // already running — skip log spam
  _paused = false;
  if (__DEV__) console.log('[Prefetch] resumed (page settled)');
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
  // Between every batch:
  //   1. If a swipe is in progress (_paused), wait in 100ms ticks until resumed.
  //   2. Yield 100ms (up from 16ms) so the JS event loop gets ~6 full render
  //      cycles between Font.loadAsync() batches instead of just 1. This keeps
  //      swipe and touch response crisp even mid-prefetch.
  for (let i = 1; i <= TOTAL_PAGES; i += CONCURRENCY) {
    if (_stopped) return;

    // Pause at batch boundary while the user is swiping pages. Font.loadAsync()
    // is JS-thread-heavy; running it during a swipe gesture competes with the
    // animation frame budget and causes visible jank.
    if (_paused) {
      if (__DEV__) console.log(`[Prefetch] waiting at page ${i} (swipe in progress)`);
      while (_paused && !_stopped) {
        await new Promise<void>((r) => setTimeout(r, 100));
      }
      if (__DEV__ && !_stopped) console.log(`[Prefetch] resuming from page ${i}`);
    }
    if (_stopped) return;

    const batch: Promise<void>[] = [];
    for (let j = i; j < i + CONCURRENCY && j <= TOTAL_PAGES; j++) {
      batch.push(_prefetchPage(j));
    }
    await Promise.all(batch);

    // Yield between batches — 100ms gives the JS thread ~6 render cycles
    // to process swipes, taps, and audio position callbacks without competition.
    await new Promise<void>((r) => setTimeout(r, 100));
  }
}
