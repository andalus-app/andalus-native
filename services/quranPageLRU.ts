/**
 * quranPageLRU.ts
 *
 * Bounded in-memory LRU cache for composed Mushaf pages.
 *
 * Replaces the unbounded _composedPageCache Map in mushafApi.ts.
 * Capping at 25 pages keeps ~25 × ~50 KB = ~1.25 MB of heap in use,
 * while ensuring swipe-forward/back across the last ~12 pages is always
 * a synchronous hit (no disk read, no network).
 *
 * Implementation uses a single Map whose insertion order determines
 * recency. All operations are O(1):
 *   get  → delete + re-insert (promotes to MRU)
 *   set  → delete + insert (update or new); evict first key if full
 *   has  → Map.has (no promotion — use for existence checks)
 *
 * Thread safety: single-threaded JS — no locks needed.
 */

import type { ComposedMushafPage } from './mushafApi';

// ── Configuration ─────────────────────────────────────────────────────────────

const DEFAULT_MAX_SIZE = 25;

// ── Cache class ───────────────────────────────────────────────────────────────

class PageLRUCache {
  private readonly _map     = new Map<number, ComposedMushafPage>();
  private readonly _maxSize: number;

  constructor(maxSize = DEFAULT_MAX_SIZE) {
    this._maxSize = maxSize;
  }

  /**
   * Returns the cached page and promotes it to MRU position.
   * Returns undefined on cache miss.
   */
  get(pageNumber: number): ComposedMushafPage | undefined {
    const page = this._map.get(pageNumber);
    if (!page) return undefined;
    // Promote to MRU: delete from current position, re-insert at end
    this._map.delete(pageNumber);
    this._map.set(pageNumber, page);
    return page;
  }

  /**
   * Stores a page. If the cache is full, the LRU entry (first in map
   * iteration order) is evicted before inserting the new entry.
   */
  set(pageNumber: number, page: ComposedMushafPage): void {
    if (this._map.has(pageNumber)) {
      this._map.delete(pageNumber);
    } else if (this._map.size >= this._maxSize) {
      const lruKey = this._map.keys().next().value;
      if (lruKey !== undefined) {
        this._map.delete(lruKey);
        if (__DEV__) console.log(`[PageLRU] evicted p${lruKey}`);
      }
    }
    this._map.set(pageNumber, page);
  }

  /**
   * Returns true if the page is in cache. Does NOT promote to MRU.
   * Use this for existence checks without affecting recency order.
   */
  has(pageNumber: number): boolean {
    return this._map.has(pageNumber);
  }

  /**
   * Removes a page from cache (e.g. after manifest invalidation).
   */
  delete(pageNumber: number): void {
    this._map.delete(pageNumber);
  }

  /** Current number of cached entries. */
  get size(): number {
    return this._map.size;
  }

  /** Clears all entries (e.g. on logout or full cache reset). */
  clear(): void {
    this._map.clear();
  }

  /**
   * Returns the cached page numbers in LRU → MRU order (last = most recent).
   * Useful for dev logging; do not use in hot paths.
   */
  cachedPages(): number[] {
    return [...this._map.keys()];
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────
//
// Exported as a singleton so mushafApi.ts, quranPageFileStore.ts, and
// quranOfflineManager.ts all share the same cache instance.

export const pageCache = new PageLRUCache(DEFAULT_MAX_SIZE);
