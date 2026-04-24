/**
 * quranDownloadQueue.ts
 *
 * Priority-based background download queue for Mushaf page data.
 *
 * ── Design goals ────────────────────────────────────────────────────────────
 *
 *   • NEVER block the UI thread — every download runs asynchronously with a
 *     100 ms yield between items so the JS event loop has ~6 render cycles
 *     between Font.loadAsync calls.
 *   • Max CONCURRENCY (2) parallel downloads at any time.
 *   • Three priority levels:
 *       0 = current page           (download first)
 *       1 = current page ±2        (download second)
 *       2 = rest of Mushaf         (background)
 *   • Deduplication: a page can appear in at most one bucket at a time.
 *     Enqueuing an already-enqueued page promotes its priority; enqueuing
 *     an already-cached or in-flight page is a no-op.
 *   • Retry: up to MAX_RETRIES attempts per page with exponential back-off.
 *     Retried items re-enter the queue after their delay.
 *   • pause() / resume(): workers sleep at 100 ms ticks while paused.
 *     Call pause() from QuranPager.onScrollBeginDrag; resume() from
 *     onMomentumScrollEnd — mirrors the existing prefetch service pattern.
 *
 * ── Worker pool ──────────────────────────────────────────────────────────────
 *
 *   _launchWorkers() starts up to CONCURRENCY async _runWorker() loops.
 *   Each worker:
 *     1. Waits if paused (100 ms ticks)
 *     2. Dequeues the highest-priority item
 *     3. Downloads and saves it
 *     4. Yields YIELD_MS before the next item
 *     5. Exits when no items remain
 *
 *   Workers are re-launched whenever new items are enqueued or resume() fires.
 *   When all 604 pages are cached, the queue naturally drains and workers exit.
 *
 * ── No UI changes ────────────────────────────────────────────────────────────
 *
 *   This module has no imports from React or any UI component.
 *   It does not modify rendering, code_v2, or any Quran text.
 */

import { fetchComposedMushafPage, getComposedPageSync } from './mushafApi';
import { isPageCached }                                  from './quranOfflineManifest';
import { writePage }                                     from './quranPageFileStore';
import { pageCache }                                     from './quranPageLRU';
import { qLog, qWarn }                                   from './quranPerfLogger';

// ── Configuration ─────────────────────────────────────────────────────────────

/** Maximum parallel download workers. Kept at 2 to leave CPU headroom for UI. */
const CONCURRENCY     = 2;

/**
 * Yield between items — gives the JS thread ~6 render cycles (at 60 fps)
 * between Font.loadAsync / JSON.parse operations. Mirrors the existing
 * mushafPrefetchService.ts yield strategy.
 */
const YIELD_MS        = 100;

/** Maximum download attempts per page before marking as failed. */
const MAX_RETRIES     = 2;

/** Back-off delays before each retry attempt. */
const RETRY_DELAYS_MS = [5_000, 30_000] as const;

// ── Types ─────────────────────────────────────────────────────────────────────

export type QueuePriority = 0 | 1 | 2;

type QueueItem = {
  pageNumber: number;
  priority:   QueuePriority;
  retryCount: number;
};

// ── State ─────────────────────────────────────────────────────────────────────

// Three priority buckets — dequeue always picks from bucket 0 first.
const _buckets: [QueueItem[], QueueItem[], QueueItem[]] = [[], [], []];

// Pages currently present in any bucket. Prevents duplicate entries.
const _enqueued = new Set<number>();

// Pages currently being downloaded by a worker. Used to skip duplicate
// promotion attempts and for diagnostics.
const _inFlight = new Set<number>();

// Active async worker count.
let _workers = 0;

let _started = false;
let _stopped = false;
let _paused  = false;

// ── Internal helpers ──────────────────────────────────────────────────────────

const _sleep = (ms: number): Promise<void> =>
  new Promise<void>(r => setTimeout(r, ms));

function _pendingCount(): number {
  return _buckets[0].length + _buckets[1].length + _buckets[2].length;
}

/**
 * Removes and returns the highest-priority item.
 * Also removes the page from _enqueued (no longer queued, now dequeued).
 */
function _dequeue(): QueueItem | null {
  for (let p = 0; p <= 2; p++) {
    const bucket = _buckets[p as QueuePriority];
    if (bucket.length > 0) {
      const item = bucket.shift()!;
      _enqueued.delete(item.pageNumber);
      return item;
    }
  }
  return null;
}

/**
 * Moves a page from a lower-priority bucket to `newPriority`.
 * No-op if the page is already at newPriority or higher.
 */
function _promotePriority(pageNumber: number, newPriority: QueuePriority): void {
  for (let p = (newPriority + 1) as QueuePriority; p <= 2; p++) {
    const bucket = _buckets[p as QueuePriority];
    const idx    = bucket.findIndex(i => i.pageNumber === pageNumber);
    if (idx !== -1) {
      const [item] = bucket.splice(idx, 1);
      item.priority = newPriority;
      // Insert at front of new bucket — pick it up next
      _buckets[newPriority].unshift(item);
      qLog(`Queue p${pageNumber} promoted → priority ${newPriority}`);
      return;
    }
  }
}

// ── Worker pool ───────────────────────────────────────────────────────────────

/**
 * Starts up to CONCURRENCY workers. Each worker runs until the queue is empty.
 * Safe to call while workers are already running — the `_workers < CONCURRENCY`
 * guard prevents over-launching.
 */
function _launchWorkers(): void {
  while (_workers < CONCURRENCY && _pendingCount() > 0 && !_stopped) {
    _workers++;
    _runWorker()
      .catch(() => {})
      .finally(() => { _workers--; });
  }
}

async function _runWorker(): Promise<void> {
  while (!_stopped) {
    // ── Pause gate ─────────────────────────────────────────────────────────
    // Spin in 100 ms ticks while paused so we don't consume CPU.
    // This is the same pattern as mushafPrefetchService._run().
    while (_paused && !_stopped) {
      await _sleep(100);
    }
    if (_stopped) return;

    // ── Dequeue ────────────────────────────────────────────────────────────
    const item = _dequeue();
    if (!item) return; // queue is empty — this worker is done

    // ── Download ───────────────────────────────────────────────────────────
    _inFlight.add(item.pageNumber);
    await _downloadItem(item); // always resolves — errors handled internally
    _inFlight.delete(item.pageNumber);

    // ── Yield ──────────────────────────────────────────────────────────────
    // Give the JS thread a breath between downloads.
    if (!_stopped) await _sleep(YIELD_MS);
  }
}

/**
 * Downloads and caches one page. Never throws — errors are handled internally
 * and trigger a retry or final failure mark.
 */
async function _downloadItem(item: QueueItem): Promise<void> {
  const { pageNumber } = item;

  // Skip if already cached since enqueue (e.g. user navigated here first)
  if (isPageCached(pageNumber)) {
    return;
  }

  // Fast path: if the page is already in mushafApi's in-memory cache (loaded
  // this session by QuranPageView), write it straight to FileStore without
  // a network call. Migrates in-session data to disk transparently.
  const memPage = getComposedPageSync(pageNumber);
  if (memPage) {
    try {
      await writePage(pageNumber, memPage);
      pageCache.set(pageNumber, memPage);
    } catch {
      // Non-critical — page is still usable from memory
    }
    return;
  }

  // Slow path: fetch from network (or AsyncStorage if available there).
  // fetchComposedMushafPage handles its own deduplication — concurrent calls
  // for the same page share a single in-flight Promise.
  try {
    const page = await fetchComposedMushafPage(pageNumber);
    // Persist to FileStore + update LRU. Non-critical write — errors ignored.
    try {
      await writePage(pageNumber, page);
      pageCache.set(pageNumber, page);
    } catch {
      // File write failed — page is still accessible from memory / AsyncStorage
    }
  } catch {
    // Network or parse failure — schedule retry or give up
    if (!_stopped && item.retryCount < MAX_RETRIES) {
      const delayMs = RETRY_DELAYS_MS[item.retryCount] ?? 30_000;
      item.retryCount++;
      qLog(`Queue p${pageNumber} failed — retry ${item.retryCount}/${MAX_RETRIES} in ${delayMs / 1000}s`);
      setTimeout(() => {
        if (_stopped) return;
        if (!isPageCached(pageNumber)) {
          _enqueued.add(pageNumber);
          _buckets[item.priority].push(item);
          if (!_stopped && !_paused) _launchWorkers();
        }
      }, delayMs);
    } else {
      qWarn(`Queue p${pageNumber} failed after ${MAX_RETRIES} retries — giving up`);
      // markPageFailed is intentionally NOT called here — the queue's job is
      // background caching, not page delivery. The page remains 'missing' in
      // the manifest so the next session can retry it.
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Adds pages to the queue at the given priority.
 *
 * Rules:
 *   • Already-cached pages → skipped
 *   • In-flight pages → skipped (download already in progress)
 *   • Already-enqueued pages at lower priority → promoted
 *   • New pages → inserted at end of priority bucket
 *
 * Safe to call before start() — items accumulate and are processed when
 * start() is called.
 */
export function enqueuePages(pageNumbers: number[], priority: QueuePriority): void {
  let added = false;
  for (const n of pageNumbers) {
    if (n < 1 || n > 604) continue;
    if (_inFlight.has(n))    continue; // downloading right now
    if (isPageCached(n))     continue; // already on disk
    if (_enqueued.has(n)) {
      _promotePriority(n, priority);
      continue;
    }
    _enqueued.add(n);
    _buckets[priority].push({ pageNumber: n, priority, retryCount: 0 });
    added = true;
  }
  if (added && _started && !_stopped) _launchWorkers();
}

/**
 * Starts the worker pool. Call once after the queue is populated.
 * Safe to call multiple times — subsequent calls are no-ops unless
 * the queue was previously stopped.
 */
export function startQueue(): void {
  if (_started && !_stopped) return;
  _started = true;
  _stopped = false;
  _paused  = false;
  _launchWorkers();
}

/**
 * Stops the queue. Workers exit after their current item completes.
 * Clears _started so startQueue() can be called again on next mount.
 */
export function stopQueue(): void {
  _stopped = true;
  _started = false;
  _paused  = false;
}

/**
 * Pauses the queue at the next item boundary.
 * Workers keep running but sleep in 100 ms ticks until resume() is called.
 * Call from QuranPager.onScrollBeginDrag.
 */
export function pauseQueue(): void {
  if (_paused) return;
  _paused = true;
  qLog('Queue paused (scroll started)');
}

/**
 * Resumes the queue after a pause. Re-launches workers if needed.
 * Call from QuranPager.onMomentumScrollEnd.
 */
export function resumeQueue(): void {
  if (!_paused) return;
  _paused = false;
  qLog('Queue resumed (page settled)');
  if (_started && !_stopped) _launchWorkers();
}

// ── Diagnostics ───────────────────────────────────────────────────────────────

export type QueueStats = {
  pending:  number;
  inFlight: number;
  p0:       number;   // current-page bucket
  p1:       number;   // ±2 bucket
  p2:       number;   // background bucket
  workers:  number;
};

/** Returns a snapshot of the queue state. For dev logging and future progress UI. */
export function getQueueStats(): QueueStats {
  return {
    pending:  _pendingCount(),
    inFlight: _inFlight.size,
    p0:       _buckets[0].length,
    p1:       _buckets[1].length,
    p2:       _buckets[2].length,
    workers:  _workers,
  };
}
