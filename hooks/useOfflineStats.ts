/**
 * useOfflineStats.ts
 *
 * Hook for polling and consuming Quran offline status.
 * Polls getOfflineStats() on a 2-second interval and returns current status.
 */

import { useEffect, useState } from 'react';
import { getOfflineStats } from '../services/quranOfflineManager';

export type OfflineStatusForUI = {
  offlineReady: boolean;     // all 604 pages + 606 fonts verified
  cachedPages: number;
  fontsFullyCached: boolean;
  queuePending: number;
  queueInFlight: number;
};

/**
 * Polls offline status every 2 seconds and returns current snapshot.
 * Updates the UI whenever status changes.
 *
 * Used by QuranOfflineGate to show download progress and by other UI
 * components that need real-time awareness of offline readiness.
 */
export function useOfflineStats(): OfflineStatusForUI {
  const [status, setStatus] = useState<OfflineStatusForUI>(() => {
    const stats = getOfflineStats();
    return {
      offlineReady: stats.fontsFullyCached && stats.cachedPages >= 604,
      cachedPages: stats.cachedPages,
      fontsFullyCached: stats.fontsFullyCached,
      queuePending: stats.queuePending,
      queueInFlight: stats.queueInFlight,
    };
  });

  useEffect(() => {
    const interval = setInterval(() => {
      const stats = getOfflineStats();
      setStatus({
        offlineReady: stats.fontsFullyCached && stats.cachedPages >= 604,
        cachedPages: stats.cachedPages,
        fontsFullyCached: stats.fontsFullyCached,
        queuePending: stats.queuePending,
        queueInFlight: stats.queueInFlight,
      });
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  return status;
}

/**
 * Hook for checking if a single page is verified offline (data + font on disk).
 * Polls every 1 second until both conditions are met, then stops polling.
 */
export function usePageVerified(pageNumber: number): boolean {
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    // Poll until page is verified (both data on disk AND font on disk)
    const checkAndVerify = async () => {
      const { isPageCached } = await import('../services/quranOfflineManifest');
      const { isQCFPageFontAvailableOffline } = await import('../services/mushafFontManager');

      const dataReady = isPageCached(pageNumber);
      const fontReady = await isQCFPageFontAvailableOffline(pageNumber);

      if (dataReady && fontReady) {
        setVerified(true);
        // Stop polling once verified
        return true;
      }
      return false;
    };

    // Initial check
    checkAndVerify().catch(() => {});

    // If not verified, poll every 1 second
    if (!verified) {
      const interval = setInterval(() => {
        checkAndVerify()
          .then(isVerified => {
            if (isVerified) {
              // Verified — interval will be cleared by effect cleanup
            }
          })
          .catch(() => {});
      }, 1000);

      return () => clearInterval(interval);
    }
  }, [pageNumber, verified]);

  return verified;
}
