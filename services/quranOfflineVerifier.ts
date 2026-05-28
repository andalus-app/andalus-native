/**
 * quranOfflineVerifier.ts
 *
 * Verifies that Quran pages are fully available offline (page data + font on disk).
 * All checks are O(1) — read from in-memory manifest Map + Font.isLoaded() / disk check.
 */

import { isPageCached, getCachedPageCount } from './quranOfflineManifest';
import { isQCFPageFontAvailableOffline } from './mushafFontManager';
import { getOfflineStats } from './quranOfflineManager';

/**
 * Returns true if page N is fully verified offline:
 * - Page JSON exists on disk and is marked 'done' in manifest
 * - Page font (TTF) exists on disk
 *
 * This is an async function because font availability check requires FileSystem.getInfoAsync.
 */
export async function isPageFullyVerified(pageNumber: number): Promise<boolean> {
  if (pageNumber < 1 || pageNumber > 604) return false;
  if (!isPageCached(pageNumber)) return false;
  return isQCFPageFontAvailableOffline(pageNumber);
}

/**
 * Returns true if all 604 pages are fully verified offline AND all 606 fonts are on disk.
 * This is the gate for complete offline readiness.
 * Uses the offline stats which polls in the background.
 */
export function isFullyOfflineReady(): boolean {
  const stats = getOfflineStats();
  if (!stats.fontsFullyCached) return false;
  return stats.cachedPages >= 604;
}

/**
 * Counts how many pages are currently verified offline (data + font both on disk).
 * Returns 0–604. This is async because each page requires a font file check.
 */
export async function countVerifiedPages(): Promise<number> {
  let count = 0;
  for (let p = 1; p <= 604; p++) {
    if (await isPageFullyVerified(p)) count++;
  }
  return count;
}

export type VerificationStatus = {
  verified: boolean;        // all 604 pages + 606 fonts
  cachedPages: number;      // 0-604
  fontsFullyCached: boolean;
  queuePending: number;
};

/**
 * Snapshot of current verification status.
 * Use for UI diagnostics and progress display.
 */
export function getVerificationStatus(): VerificationStatus {
  const stats = getOfflineStats();
  return {
    verified: stats.fontsFullyCached && stats.cachedPages >= 604,
    cachedPages: stats.cachedPages,
    fontsFullyCached: stats.fontsFullyCached,
    queuePending: stats.queuePending,
  };
}
