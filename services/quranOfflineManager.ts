/**
 * quranOfflineManager.ts
 *
 * Public API for the Mushaf offline system.
 *
 * This is the ONLY file that QuranPager and _layout.tsx need to import
 * from the offline system. All other modules (manifest, LRU, FileStore,
 * download queue, font manager) are internal implementation details.
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
 * ── Global startup cache ─────────────────────────────────────────────────────
 *
 *   startGlobalCache() is called once from app/_layout.tsx after storage
 *   initialises. It downloads all 604 page-data files AND all 606 fonts
 *   to the device's DocumentDirectory so that every Quran page opens
 *   instantly without any network request.
 *
 *   Downloads run in a low-concurrency background queue (2 workers) and
 *   pause automatically while the user swipes between pages. The manifest
 *   tracks progress across sessions, so interrupted downloads resume where
 *   they left off.
 *
 *   The queue NEVER stops once started globally — it persists across
 *   Quran-screen open/close cycles until all 604 pages are cached.
 *
 * ── AppState integration ─────────────────────────────────────────────────────
 *
 *   startGlobalCache() registers a single AppState listener that:
 *     • Flushes the manifest (saves debounced writes) on 'background'.
 *     • Resumes the queue and font downloads on 'active'.
 *
 * ── Backward compatibility ───────────────────────────────────────────────────
 *
 *   All existing AsyncStorage keys (andalus_mushaf_cache_v4_*, _chapter_v3_*)
 *   remain intact and continue to serve as fallbacks. No data is deleted.
 *
 * ── Quran text integrity ─────────────────────────────────────────────────────
 *
 *   code_v2 glyphs and all Arabic text pass through this module unmodified.
 *   getPage() returns the ComposedMushafPage exactly as produced by mushafApi.
 *   No transformation, sanitisation, or re-encoding is performed.
 */

import { AppState } from 'react-native';
import {
  initManifest,
  isPageCached,
  getMissingPages,
  getCachedPageCount,
  flushManifest,
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
import { preWarmPageFonts, preWarmSharedFonts } from './mushafFontManager';
import { getCachedLastPage } from './quranLastPage';
import { qLog, qWarn } from './quranPerfLogger';

// ── Configuration ─────────────────────────────────────────────────────────────

/**
 * Delay before the GLOBAL background queue starts (ms).
 * Shorter than the QuranPager delay — when called at app startup the Quran
 * screen isn't even open, so we're not competing with any render work.
 */
const GLOBAL_STARTUP_DELAY_MS = 2_000;

/**
 * Delay before the QuranPager-triggered queue starts (ms).
 * Prevents competing with the critical first-render window.
 */
const PAGER_STARTUP_DELAY_MS = 4_000;

/**
 * Extra delay before font downloads begin (ms, measured from startGlobalCache call).
 * Fonts start after the page-data queue is already running so they don't
 * compete with the initial data fetch for the user's current page.
 */
const FONT_STARTUP_DELAY_MS = 5_000;

// ── Module state ──────────────────────────────────────────────────────────────

/** True once startGlobalCache() has been called. */
let _globallyStarted = false;

/** Ongoing init promise — set to null only when stopOfflineManager resets it. */
let _initPromise: Promise<void> | null = null;

/** Timer for the delayed queue start. */
let _startupTimer: ReturnType<typeof setTimeout> | null = null;

/** AppState subscription from startGlobalCache. */
let _appStateSub: ReturnType<typeof AppState.addEventListener> | null = null;

/** Ongoing font-download promise (null when idle or completed). */
let _fontPromise: Promise<void> | null = null;

/** True once all 606 fonts are verified on disk. */
let _fontsFullyCached = false;

/**
 * Mirrors the pause state set by pauseDownloads() / resumeDownloads().
 * Passed to preWarmPageFonts() so font file checks/downloads stop during
 * swipe gestures — exactly like the page-data download queue does.
 */
let _downloadsPaused = false;

// ── Global startup entry point ────────────────────────────────────────────────

/**
 * Starts the full offline Quran cache from app startup.
 *
 * Call ONCE from app/_layout.tsx after initStorage() resolves.
 * Subsequent calls are no-ops (idempotent).
 *
 * What this does:
 *  1. Loads the disk manifest into memory.
 *  2. After 2 s: starts the background download queue for all 604 page-data files.
 *  3. After 5 s: starts downloading all 606 QCF font files to disk.
 *  4. Registers an AppState listener that:
 *       – Pauses downloads and flushes the manifest when the app is backgrounded.
 *       – Resumes downloads when the app returns to the foreground.
 *
 * Downloads run with concurrency = 2 and pause during Mushaf swipe gestures.
 * All progress is persisted via the manifest so interrupted downloads resume
 * where they left off on the next app launch.
 */
export function startGlobalCache(): void {
  if (_globallyStarted) return;
  _globallyStarted = true;

  // Start page-data download
  if (!_initPromise) {
    _initPromise = _initWithDelay(GLOBAL_STARTUP_DELAY_MS).catch(() => {
      qWarn('GlobalCache page-data init failed — falling back to mushafApi');
    });
  }

  // Start font download (delayed further so it doesn't compete with data queue)
  _scheduleFontDownload();

  // AppState: flush manifest on background, resume on foreground.
  //
  // CRITICAL: must also toggle `_downloadsPaused` so the font pre-warm loop
  // (preWarmPageFonts in mushafFontManager) suspends. Without this the loop
  // keeps spinning every 100 ms while the screen is locked — every iteration
  // does FileSystem.getInfoAsync + potentially FileSystem.downloadAsync, which
  // counts as non-audio background work and contributes to iOS' jetsam pressure
  // signal on a memory-constrained device. Pausing only the page-data queue
  // (pauseQueue) is not enough; the font loop has its own pause flag.
  _appStateSub = AppState.addEventListener('change', (nextState) => {
    if (nextState === 'active') {
      _downloadsPaused = false;
      resumeQueue();
      _scheduleFontDownload(); // Re-schedule if interrupted while backgrounded
    } else {
      // 'background' or 'inactive' — freeze ALL background download work.
      _downloadsPaused = true;
      pauseQueue();
      flushManifest().catch(() => {}); // Persist debounced manifest writes
    }
  });

  qLog('GlobalCache started');
}

// ── QuranPager entry point ────────────────────────────────────────────────────

/**
 * Initialises the offline system when the Quran screen opens.
 *
 * If startGlobalCache() was already called (the normal case), this is a no-op
 * because _initPromise is already set. QuranPager's prioritize() calls handle
 * boosting the current page in the already-running queue.
 *
 * If somehow the global cache wasn't started (e.g. very early navigation),
 * this falls back to the original behaviour with the 4 s delay.
 *
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function initOfflineManager(currentPage: number): void {
  if (_initPromise) return;
  _initPromise = _initWithDelay(PAGER_STARTUP_DELAY_MS, currentPage).catch(() => {
    qWarn('OfflineManager init failed — falling back to mushafApi');
  });
}

// ── Shared init implementation ────────────────────────────────────────────────

/**
 * Loads the manifest then starts the download queue after `delayMs`.
 * When called globally (no currentPage), uses getCachedLastPage() inside
 * the timeout so the value is resolved after AsyncStorage has loaded.
 */
async function _initWithDelay(
  delayMs:      number,
  currentPage?: number,
): Promise<void> {
  await initManifest();

  const cachedCount = getCachedPageCount();
  qLog(`OfflineManager manifest ready — ${cachedCount}/604 pages on disk`);

  if (cachedCount === 604) {
    qLog('OfflineManager — all 604 pages already cached, skipping queue');
    return;
  }

  _startupTimer = setTimeout(() => {
    _startupTimer = null;
    // If no currentPage was supplied (global mode), read the last-visited page
    // now (inside the timeout) so AsyncStorage has had time to resolve.
    const priorityPage = currentPage ?? getCachedLastPage();
    _enqueueAllMissing(priorityPage);
    startQueue();

    const s = getQueueStats();
    qLog(
      `OfflineManager queue started — ${s.pending} pages enqueued`
      + ` (p0=${s.p0}, p1=${s.p1}, p2=${s.p2})`,
    );
  }, delayMs);
}

/**
 * Enqueues all pages that are not yet cached on disk, sorted by distance
 * from currentPage so nearby pages download first.
 */
function _enqueueAllMissing(currentPage: number): void {
  const missing = getMissingPages();

  const p0: number[] = [];
  const p1: number[] = [];
  const p2: number[] = [];

  for (const n of missing) {
    const dist = Math.abs(n - currentPage);
    if (dist === 0)     p0.push(n);
    else if (dist <= 2) p1.push(n);
    else                p2.push(n);
  }

  if (p0.length) enqueuePages(p0, 0);
  if (p1.length) enqueuePages(p1, 1);
  if (p2.length) enqueuePages(p2, 2);
}

// ── Font download ─────────────────────────────────────────────────────────────

/**
 * Starts the background font download if not already running or completed.
 * Called at startup and again when the app returns to the foreground.
 */
function _scheduleFontDownload(): void {
  if (_fontsFullyCached || _fontPromise) return;

  _fontPromise = _doFontDownload()
    .then(() => {
      _fontsFullyCached = true;
      _fontPromise = null;
      qLog('GlobalCache — all 606 QCF fonts downloaded to disk');
    })
    .catch(() => {
      _fontPromise = null; // Allow retry on next app foreground / explicit call
    });
}

async function _doFontDownload(): Promise<void> {
  // Wait for the page-data queue to start first
  await new Promise<void>(resolve => setTimeout(resolve, FONT_STARTUP_DELAY_MS));

  // Download shared fonts (surah names + bismillah) — small, download first
  await preWarmSharedFonts();

  // Download all 604 QCF page fonts with concurrency 2.
  // Pass _downloadsPaused so the loop suspends during swipe gestures — the same
  // pause/resume that governs the page-data queue (pauseDownloads / resumeDownloads).
  // Without this, font file I/O continued at full speed during swipes even while
  // the page-data queue was paused, competing with the animation frame budget.
  await preWarmPageFonts(1, 604, 2, () => _downloadsPaused);
}

// ── Page access ───────────────────────────────────────────────────────────────

/**
 * Returns the composed Mushaf page for the given page number.
 *
 * Resolution order (fastest to slowest):
 *
 *   1. LRU in-memory cache — synchronous Map lookup, < 1 ms.
 *   2. FileStore (disk)    — async JSON read, ~2–5 ms.
 *   3. Existing mushafApi  — AsyncStorage then network, unchanged path.
 *
 * Quran text: the ComposedMushafPage is returned verbatim. No transformation.
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
  }

  // ── Layer 3: mushafApi (AsyncStorage + network) — existing, unchanged ──────
  const page = await fetchComposedMushafPage(pageNumber);
  writePage(pageNumber, page).catch(() => {});
  pageCache.set(pageNumber, page);
  return page;
}

// ── Priority management ───────────────────────────────────────────────────────

/**
 * Boosts the download priority of `currentPage` and its ±2 neighbours.
 * Call whenever currentPage changes (user swiped to a new page).
 * Safe to call before initOfflineManager().
 */
export function prioritize(currentPage: number): void {
  enqueuePages([currentPage], 0);

  const nearby: number[] = [];
  for (const delta of [-2, -1, 1, 2]) {
    const n = currentPage + delta;
    if (n >= 1 && n <= 604) nearby.push(n);
  }
  if (nearby.length) enqueuePages(nearby, 1);
}

// ── Queue lifecycle ───────────────────────────────────────────────────────────

/** Pauses the download queue. Call from QuranPager's onScrollBeginDrag. */
export function pauseDownloads(): void {
  _downloadsPaused = true;
  pauseQueue();
}

/** Resumes the download queue. Call from QuranPager's onMomentumScrollEnd. */
export function resumeDownloads(): void {
  _downloadsPaused = false;
  resumeQueue();
}

/**
 * Stops the offline manager and resets its state.
 *
 * When startGlobalCache() has been called, this is a NO-OP — the global
 * download queue runs across screen navigations and must not be stopped
 * when QuranPager unmounts.
 *
 * Only has effect in the legacy path where initOfflineManager() was called
 * directly from QuranPager without a prior startGlobalCache() call.
 */
export function stopOfflineManager(): void {
  if (_globallyStarted) return; // Never stop the global cache

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
  cachedPages:       number;
  /** Whether the global startup cache is active. */
  globallyStarted:   boolean;
  /** Whether all 606 QCF fonts are downloaded to disk. */
  fontsFullyCached:  boolean;
  /** Pages in the download queue (not yet downloaded). */
  queuePending:      number;
  /** Pages currently being downloaded. */
  queueInFlight:     number;
  /** Priority-0 queue length (current page). */
  queueP0:           number;
  /** Priority-1 queue length (±2 pages). */
  queueP1:           number;
  /** Priority-2 queue length (background). */
  queueP2:           number;
  /** Active parallel download workers. */
  queueWorkers:      number;
  /** Pages currently in the LRU in-memory cache. */
  lruSize:           number;
};

export function getOfflineStats(): OfflineStats {
  const q: QueueStats = getQueueStats();
  return {
    cachedPages:      getCachedPageCount(),
    globallyStarted:  _globallyStarted,
    fontsFullyCached: _fontsFullyCached,
    queuePending:     q.pending,
    queueInFlight:    q.inFlight,
    queueP0:          q.p0,
    queueP1:          q.p1,
    queueP2:          q.p2,
    queueWorkers:     q.workers,
    lruSize:          pageCache.size,
  };
}
