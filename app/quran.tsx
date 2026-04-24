/**
 * app/quran.tsx
 *
 * Edge-to-edge Quran reader.
 *
 * Layout:
 *   - QuranPager fills the ENTIRE screen (position absolute, full W×H)
 *   - Chrome (header + player + page picker) is an Animated.View overlay
 *   - Single tap on the page toggles chrome visibility (Pressable in QuranPager)
 *   - All modal overlays (contents, settings, search, reciter) sit at higher z-indices
 */

import React, { useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  Animated,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { QuranProvider } from '../context/QuranContext';
import { getCachedLastPage } from '../services/quranLastPage';
import { SURAH_INDEX } from '../data/surahIndex';

import { useTheme } from '../context/ThemeContext';
import { useQuranContext } from '../context/QuranContext';
import QuranPager from '../components/quran/QuranPager';
import QuranHeader from '../components/quran/QuranHeader';
import QuranPagePicker from '../components/quran/QuranPagePicker';
import QuranAudioPlayer from '../components/quran/QuranAudioPlayer';
import QuranSettingsPanel from '../components/quran/QuranSettingsPanel';
import QuranContentsScreen from '../components/quran/QuranContentsScreen';
import QuranSearchModal from '../components/quran/QuranSearchModal';
import QuranReciterSelector from '../components/quran/QuranReciterSelector';
import VerseActionsMenu from '../components/quran/VerseActionsMenu';
import KhatmahQuickComplete from '../components/quran/KhatmahQuickComplete';

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Returns the first page of the surah containing verseKey — instant, no network.
 * Used as an immediate starting page while the API resolves the exact word-level page.
 */
function approxPageForVerseKey(verseKey: string): number {
  const [surahStr] = (verseKey ?? '').split(':');
  const surahId = parseInt(surahStr, 10);
  if (!isNaN(surahId)) {
    const surah = SURAH_INDEX.find((s) => s.id === surahId);
    if (surah?.firstPage) return surah.firstPage;
  }
  return getCachedLastPage();
}

// Serialize all orientation changes so lock/unlock always complete in issue order.
// Without this, a quick exit+re-enter can leave lockAsync resolving AFTER unlockAsync,
// permanently locking portrait until app restart.
let _orientationChain: Promise<void> = Promise.resolve();
function serialOrientation(fn: () => Promise<void>) {
  _orientationChain = _orientationChain.then(fn, fn);
}

// ── Inner screen (consumes context) ──────────────────────────────────────────

function QuranScreen({ deepLinkVerseKey }: { deepLinkVerseKey?: string }) {
  const { isDark } = useTheme();
  const { chromeVisible, goToVerse } = useQuranContext();

  const chromeAnim = useRef(new Animated.Value(1)).current;
  // Guard: only handle the deep-link once per mount.
  const deepLinkHandledRef = useRef(false);

  useEffect(() => {
    Animated.timing(chromeAnim, {
      toValue: chromeVisible ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [chromeVisible, chromeAnim]);

  // Resolve the exact Mushaf page for a deep-link verseKey, then navigate there.
  //
  // Runs inside QuranProvider so goToVerse() is available — this avoids the
  // blocking black screen that occurred when the same fetch was in QuranRoute
  // (outside the provider), which prevented rendering for 10+ seconds on slow networks.
  //
  // Word-level page_number (via code_v2 field) is accurate; verse-level field
  // is not — see CLAUDE.md "Previously Fixed Bugs / mushafTimingService.ts".
  //
  // If the network is unavailable or slow, the timeout aborts and the user stays
  // on the approximate page (surah's first page) with no error — they can scroll manually.
  useEffect(() => {
    if (!deepLinkVerseKey || deepLinkHandledRef.current) return;
    deepLinkHandledRef.current = true;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    fetch(
      `https://api.quran.com/api/v4/verses/by_key/${deepLinkVerseKey}` +
      `?words=true&word_fields=code_v2,page_number&mushaf=1`,
      { signal: controller.signal },
    )
      .then((r) => r.json())
      .then((data: { verse?: { words?: Array<{ page_number?: number }> } }) => {
        const page = data?.verse?.words?.[0]?.page_number;
        if (typeof page === 'number') {
          goToVerse(deepLinkVerseKey, page);
        }
      })
      .catch(() => {
        // Network error or 8 s timeout — user already sees the approximate page.
      });

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  // goToVerse is stable (useCallback in QuranContext); deepLinkVerseKey never changes after mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.root}>

      {/* Mushaf pager — fills absolute full screen */}
      <View style={StyleSheet.absoluteFill}>
        <QuranPager />
      </View>

      {/* Chrome overlay — fades in/out with single tap */}
      <Animated.View
        style={[styles.chromeOverlay, { opacity: chromeAnim }]}
        pointerEvents={chromeVisible ? 'box-none' : 'none'}
      >
        <QuranHeader />
        <QuranPagePicker />
        <KhatmahQuickComplete />
      </Animated.View>

      {/* Audio player — fades with chrome but has own pointerEvents so buttons stay tappable */}
      <Animated.View
        style={[StyleSheet.absoluteFill, { opacity: chromeAnim }]}
        pointerEvents={chromeVisible ? 'box-none' : 'none'}
      >
        <QuranAudioPlayer />
      </Animated.View>

      {/* Permanent overlays — always interactive regardless of chrome state */}
      <QuranContentsScreen />
      <QuranSettingsPanel />
      <QuranSearchModal />
      <QuranReciterSelector />
      <VerseActionsMenu />
    </View>
  );
}

// ── Entry point with provider ─────────────────────────────────────────────────

export default function QuranRoute() {
  const params = useLocalSearchParams<{ page?: string; verseKey?: string }>();
  const initialVerseKey = params.verseKey ?? undefined;

  // Determine the initial page immediately — no blocking network call:
  //   1. If a page param is provided, use it (e.g. navigating from Asmaul Husna).
  //   2. If a verseKey is present, use the surah's first page as a fast approximation.
  //      QuranScreen resolves the exact word-level page asynchronously via goToVerse().
  //   3. Otherwise restore the last-read page from cache.
  const initialPage = (() => {
    if (params.page) return Math.max(1, Math.min(604, parseInt(params.page, 10)));
    if (initialVerseKey) return approxPageForVerseKey(initialVerseKey);
    return getCachedLastPage();
  })();

  useEffect(() => {
    // Unlock rotation for the Quran reader (landscape mode support).
    // Serialized to prevent a quick exit+re-enter leaving lockAsync resolving after
    // unlockAsync, which would pin portrait until the user restarts the app.
    serialOrientation(() => ScreenOrientation.unlockAsync());
    return () => {
      serialOrientation(() =>
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP),
      );
    };
  }, []);

  return (
    <QuranProvider
      initialPage={initialPage}
      initialReadingMode={initialVerseKey ? 'verse' : undefined}
    >
      <Stack.Screen options={{ gestureEnabled: false, fullScreenGestureEnabled: false }} />
      <QuranScreen deepLinkVerseKey={initialVerseKey} />
    </QuranProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  chromeOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
    // pointerEvents managed via prop — box-none lets touches pass through to pager
  },
});
