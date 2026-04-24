/**
 * quranOfflineManager.ts
 *
 * Public API for the Mushaf offline system.
 *
 * This is the ONLY file that QuranPager and QuranPageView need to import
 * from the offline system. All other modules (manifest, LRU, FileStore,
 * download queue) are internal implementation details.
 *
 * ── Resolution order for getPage(n) ─────────────────────────────────────────
 *
 *   1. LRU in-memory cache (quranPageLRU)      — < 1 ms, synchronous
 *   2. FileStore (disk)  (quranPageFileStore)   — ~2–5 ms async
 *   3. Existing mushafApi path (AsyncStorage + network fallback) — unchanged
 *
 * After a layer-3 hit, the result is written to FileStore and LRU so
 * subsequent accesses use the faster layers.
 *
 * ── Integration status ───────────────────────────────────────────────────────
 *
 *   QuranPager is NOT yet modified. This module runs in pure background mode:
 *   initOfflineManager() starts the download queue; QuranPageView continues
 *   to call fetchComposedMushafPage() directly. getPage() is ready to use
 *   once the integration step is verified.
 *
 * ── Backward compatibility ───────────────────────────────────────────────────
 *
 *   All existing AsyncStorage keys (andalus_mushaf_cache_v4_*, _chapter_v3_*)
 *   remain intact and continue to serve as fallbacks. No data is deleted.
 *   The offline system adds layers on top of the existing pipeline; it does
 *   not replace anything until the integration step is complete and verified.
 *
 * ── Quran text integrity ─────────────────────────────────────────────────────
 *
 *   code_v2 glyphs and all Arabic text pass through this module unmodified.
 *   getPage() returns the ComposedMushafPage exactly as produced by mushafApi.
 *   No transformation, sanitisation, or re-encoding is performed.
 */

import {
  initManifest,
  isPageCached,
  getMissingPages,
  getCachedPageCount,
} from './quranOfflineManifest';
import { pageCache }  from './quranPageLRU';
import { readPage, writePage } from './quranPageFileStore';
import {
  enqueuePages,
  startQueue,
  stopQueue,
  pauseQueue,
  resumeQueue,
  getQueueStats,
  type QueueStats,
} from './quranDownloadQueue';
import { fetchComposedMushafPage } from './mushafApi';
import type { ComposedMushafPage } from './mushafApi';

// ── Configuration ─────────────────────────────────────────────────────────────

/**
 * Delay before starting the background queue after mount (ms).
 *
 * Matches the existing mushafPrefetchService.ts delay. Prevents the queue's
 * Font.loadAsync / JSON work from competing with the JS thread during the
 * critical first-render window (initial page render + first swipe gesture).
 */
const STARTUP_DELAY_MS = 4_000;

// ── Module state ──────────────────────────────────────────────────────────────

let _initPromise:  Promise<void> | null = null;
let _startupTimer: ReturnType<typeof setTimeout> | null = null;

// ── Initialisation ────────────────────────────────────────────────────────────

/**
 * Initialises the offline system and starts the background download queue.
 *
 * Call once when the Quran screen mounts (QuranPager useEffect).
 * Safe to call multiple times — subsequent calls are no-ops until
 * stopOfflineManager() resets the state.
 *
 * Steps:
 *   1. Load the manifest from disk into memory.
 *   2. After STARTUP_DELAY_MS: enqueue all missing pages by priority.
 *   3. Start the download queue.
 *
 * @param currentPage - The page the user is viewing on mount.
 *                      Used to set initial queue priorities.
 */
export function initOfflineManager(currentPage: number): void {
  if (_initPromise) return;
  _initPromise = _init(currentPage).catch(() => {
    // Non-fatal — the app works without the offline manager.
    // Quran text is always available via the existing mushafApi fallback.
    if (__DEV__) console.warn('[OfflineManager] init failed — falling back to mushafApi');
  });
}

async function _init(currentPage: number): Promise<void> {
  await initManifest();

  if (__DEV__) {
    console.log(
      `[OfflineManager] manifest ready — ${getCachedPageCount()}/604 pages on disk`,
    );
  }

  // Delay queue start so it does not compete with the critical startup window.
  _startupTimer = setTimeout(() => {
    _startupTimer = null;
    _enqueueAllMissing(currentPage);
    startQueue();

    if (__DEV__) {
      const s = getQueueStats();
      console.log(
        `[OfflineManager] queue started — ${s.pending} pages enqueued`
        + ` (p0=${s.p0}, p1=${s.p1}, p2=${s.p2})`,
      );
    }
  }, STARTUP_DELAY_MS);
}

/**
 * Enqueues all pages that are not yet cached on disk, sorted by distance
 * from currentPage so nearby pages download first.
 */
function _enqueueAllMissing(currentPage: number): void {
  const missing = getMissingPages(); // pages where isPageCached(n) === false

  const p0: number[] = []; // current page
  const p1: number[] = []; // ±1 and ±2 pages
  const p2: number[] = []; // everything else

  for (const n of missing) {
    const dist = Math.abs(n - currentPage);
    if (dist === 0)      p0.push(n);
    else if (dist <= 2)  p1.push(n);
    else                 p2.push(n);
  }

  if (p0.length) enqueuePages(p0, 0);
  if (p1.length) enqueuePages(p1, 1);
  if (p2.length) enqueuePages(p2, 2);
}

// ── Page access ───────────────────────────────────────────────────────────────

/**
 * Returns the composed Mushaf page for the given page number.
 *
 * Resolution order (fastest to slowest):
 *
 *   1. LRU in-memory cache — synchronous Map lookup, < 1 ms.
 *   2. FileStore (disk)    — async JSON read, ~2–5 ms.
 *      Available on second open after the background queue has cached the page.
 *   3. Existing mushafApi  — AsyncStorage then network, unchanged path.
 *      After a layer-3 hit, the result is written to FileStore and LRU
 *      so subsequent accesses hit layer 1 or 2.
 *
 * This function is NOT yet called from QuranPager/QuranPageView — they still
 * call fetchComposedMushafPage() directly. Integration happens in the next step.
 *
 * Quran text: the ComposedMushafPage is returned verbatim from whichever layer
 * supplies it. No transformation is applied to code_v2 or any Arabic text.
 */
export async function getPage(
  pageNumber: number,
): Promise<ComposedMushafPage> {
  // ── Layer 1: LRU ───────────────────────────────────────────────────────────
  const lruHit = pageCache.get(pageNumber);
  if (lruHit) return lruHit;

  // ── Layer 2: FileStore ─────────────────────────────────────────────────────
  if (isPageCached(pageNumber)) {
    const diskHit = await readPage(pageNumber);
    if (diskHit) {
      pageCache.set(pageNumber, diskHit);
      return diskHit;
    }
    // Manifest says cached but file is gone (e.g. device restored).
    // Fall through to re-fetch and rebuild the cache entry.
  }

  // ── Layer 3: mushafApi (AsyncStorage + network) — existing, unchanged ──────
  const page = await fetchComposedMushafPage(pageNumber);

  // Persist to FileStore for next session (non-blocking, fire-and-forget).
  writePage(pageNumber, page).catch(() => {});
  pageCache.set(pageNumber, page);

  return page;
}

// ── Priority management ───────────────────────────────────────────────────────

/**
 * Boosts the download priority of `currentPage` and its ±2 neighbours.
 *
 * Call this whenever currentPage changes (user swiped to a new page).
 * Already-cached or in-flight pages are ignored automatically by the queue.
 * In-queue pages are promoted to a higher priority bucket.
 *
 * Safe to call before initOfflineManager() — items are enqueued and will
 * be processed when the queue starts.
 */
export function prioritize(currentPage: number): void {
  // Current page → priority 0 (highest)
  enqueuePages([currentPage], 0);

  // ±1 and ±2 pages → priority 1
  const nearby: number[] = [];
  for (const delta of [-2, -1, 1, 2]) {
    const n = currentPage + delta;
    if (n >= 1 && n <= 604) nearby.push(n);
  }
  if (nearby.length) enqueuePages(nearby, 1);
}

// ── Queue lifecycle (called from QuranPager) ──────────────────────────────────

/**
 * Pauses the download queue.
 * Call from QuranPager's onScrollBeginDrag.
 */
export function pauseDownloads(): void {
  pauseQueue();
}

/**
 * Resumes the download queue after a pause.
 * Call from QuranPager's onMomentumScrollEnd.
 */
export function resumeDownloads(): void {
  resumeQueue();
}

/**
 * Stops the queue and clears the startup timer.
 * Call from QuranPager's unmount cleanup (useEffect return).
 *
 * Resets _initPromise so initOfflineManager() can be called again when
 * the user re-opens the Quran screen.
 */
export function stopOfflineManager(): void {
  if (_startupTimer !== null) {
    clearTimeout(_startupTimer);
    _startupTimer = null;
  }
  stopQueue();
  _initPromise = null;
}

// ── Diagnostics ───────────────────────────────────────────────────────────────

export type OfflineStats = {
  /** Pages with valid cached JSON on disk (from manifest). */
  cachedPages:   number;
  /** Pages in the download queue (not yet downloaded). */
  queuePending:  number;
  /** Pages currently being downloaded. */
  queueInFlight: number;
  /** Priority-0 queue length (current page). */
  queueP0:       number;
  /** Priority-1 queue length (±2 pages). */
  queueP1:       number;
  /** Priority-2 queue length (background). */
  queueP2:       number;
  /** Active parallel download workers. */
  queueWorkers:  number;
  /** Pages currently in the LRU in-memory cache. */
  lruSize:       number;
};

/**
 * Returns a snapshot of the offline system state.
 * Useful for dev logging, diagnostics, and a future progress indicator.
 */
export function getOfflineStats(): OfflineStats {
  const q: QueueStats = getQueueStats();
  return {
    cachedPages:   getCachedPageCount(),
    queuePending:  q.pending,
    queueInFlight: q.inFlight,
    queueP0:       q.p0,
    queueP1:       q.p1,
    queueP2:       q.p2,
    queueWorkers:  q.workers,
    lruSize:       pageCache.size,
  };
}
