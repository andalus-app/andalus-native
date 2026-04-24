/**
 * quranPageFileStore.ts
 *
 * FileSystem-backed store for composed Mushaf page data.
 *
 * One JSON file per page under DocumentDirectory — iOS never purges
 * DocumentDirectory under storage pressure (unlike CacheDirectory).
 *
 * ── Read path ───────────────────────────────────────────────────────────────
 *
 *   1. Caller checks isPageCached() from quranOfflineManifest (O(1), sync).
 *   2. Cache hit  → readPage(n) → JSON.parse → ComposedMushafPage
 *   3. Cache miss → caller fetches from network → writePage(n, page)
 *                   writePage calls markPageDone() in the manifest.
 *
 * ── Backward compatibility ───────────────────────────────────────────────────
 *
 *   The AsyncStorage layer in mushafApi.ts (CACHE_KEY = andalus_mushaf_cache_v4_*)
 *   is NOT touched. It continues to serve as a fallback:
 *
 *     mushafApi.fetchComposedMushafPage(n)
 *       1. pageCache (LRU, in-memory)          ← new, quranPageLRU.ts
 *       2. quranPageFileStore.readPage(n)      ← new, this file
 *       3. AsyncStorage CACHE_KEY(n)           ← existing fallback, unchanged
 *       4. Network fetch                       ← existing fallback, unchanged
 *
 *   Layers 3 and 4 are only reached if neither layer 1 nor 2 has the page.
 *   After a successful layer-3 or layer-4 hit, the page is written into this
 *   store so subsequent opens use layer 1 or 2.
 *
 *   No existing AsyncStorage keys are deleted or renamed in this step.
 *   Migration will happen in a later step once the FileStore is verified.
 *
 * ── Quran text integrity ─────────────────────────────────────────────────────
 *
 *   code_v2 glyphs, verseKeys, and all Arabic text fields are serialised by
 *   JSON.stringify verbatim and read back by JSON.parse verbatim.
 *   This file never transforms, sanitises, or re-encodes any Quran text.
 */

import * as FileSystem from 'expo-file-system/legacy';
import type { ComposedMushafPage } from './mushafApi';
import { markPageDone, markPageFailed, MANIFEST_DIR } from './quranOfflineManifest';
import { qWarn } from './quranPerfLogger';

// ── Paths ─────────────────────────────────────────────────────────────────────

/** Directory where page JSON files live. */
export const PAGES_DIR = `${MANIFEST_DIR}pages/`;

/**
 * Full path for a page's JSON file.
 * Format: .../andalus/mushaf/pages/p001.json … p604.json
 */
export const pageFilePath = (n: number): string =>
  `${PAGES_DIR}p${String(n).padStart(3, '0')}.json`;

// ── Directory initialisation ──────────────────────────────────────────────────

let _dirReady          = false;
let _dirInitPromise: Promise<void> | null = null;

/**
 * Creates the pages directory if it does not exist.
 * Called lazily before the first write. Reads do not need it (if the file
 * doesn't exist, readAsStringAsync throws and we return null).
 */
async function ensureDir(): Promise<void> {
  if (_dirReady) return;
  if (_dirInitPromise) return _dirInitPromise;
  _dirInitPromise = FileSystem
    .makeDirectoryAsync(PAGES_DIR, { intermediates: true })
    .then(() => { _dirReady = true; })
    .catch(() => {
      // makeDirectoryAsync throws if the directory already exists on some
      // versions. Treat any error as success — the write will surface
      // the real problem if the directory genuinely cannot be created.
      _dirReady = true;
    });
  return _dirInitPromise;
}

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * Reads a composed page from disk.
 * Returns null if the file does not exist, cannot be read, or fails
 * the minimal integrity check (wrong pageNumber or empty slots array).
 *
 * Quran text is returned exactly as serialised — no post-processing.
 */
export async function readPage(
  pageNumber: number,
): Promise<ComposedMushafPage | null> {
  try {
    const raw  = await FileSystem.readAsStringAsync(pageFilePath(pageNumber));
    const page = JSON.parse(raw) as ComposedMushafPage;

    // Minimal integrity check: correct page number and non-empty slots.
    // We do NOT validate individual code_v2 values — that would require
    // re-fetching and would defeat the purpose of the cache.
    if (page.pageNumber !== pageNumber || !Array.isArray(page.slots) || page.slots.length === 0) {
      qWarn(`FileStore p${pageNumber}: integrity check failed — pageNumber or slots invalid`);
      return null;
    }

    return page;
  } catch {
    // File absent or JSON.parse error — caller falls through to network.
    return null;
  }
}

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * Writes a composed page to disk and records it in the manifest.
 *
 * Throws on write failure so the caller can decide whether to propagate
 * or swallow the error. markPageFailed() is called before throwing so
 * the manifest never incorrectly shows the page as 'done'.
 *
 * Quran text (code_v2, verseKey, glyph strings) is serialised verbatim
 * by JSON.stringify — no transformation is applied.
 */
export async function writePage(
  pageNumber: number,
  page: ComposedMushafPage,
): Promise<void> {
  await ensureDir();
  const path = pageFilePath(pageNumber);
  try {
    await FileSystem.writeAsStringAsync(path, JSON.stringify(page));
    markPageDone(pageNumber);
  } catch (e) {
    markPageFailed(pageNumber);
    qWarn(`FileStore p${pageNumber}: write failed: ${String(e)}`);
    throw e;
  }
}

// ── Deletion / invalidation ───────────────────────────────────────────────────

/**
 * Deletes a page's JSON file from disk.
 * Does NOT update the manifest — caller is responsible for calling
 * invalidatePage() from quranOfflineManifest if needed.
 */
export async function deletePage(pageNumber: number): Promise<void> {
  try {
    await FileSystem.deleteAsync(pageFilePath(pageNumber), { idempotent: true });
  } catch {
    // Idempotent delete — ignore errors
  }
}

// ── Diagnostics ───────────────────────────────────────────────────────────────

/**
 * Returns true if the page file physically exists on disk.
 * Independent of the manifest — use to detect manifest/disk divergence.
 * Not needed in hot paths; for diagnostics / integrity verification only.
 */
export async function pageFileExists(pageNumber: number): Promise<boolean> {
  const info = await FileSystem.getInfoAsync(pageFilePath(pageNumber));
  return info.exists;
}
