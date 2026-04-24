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

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  StatusBar,
  Animated,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { QuranProvider } from '../context/QuranContext';
import { getCachedLastPage } from '../services/quranLastPage';

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

// Serialize all orientation changes so lock/unlock always complete in issue order.
// Without this, a quick exit+re-enter can leave lockAsync resolving AFTER unlockAsync,
// permanently locking portrait until app restart.
let _orientationChain: Promise<void> = Promise.resolve();
function serialOrientation(fn: () => Promise<void>) {
  _orientationChain = _orientationChain.then(fn, fn);
}

// ── Inner screen (consumes context) ──────────────────────────────────────────

function QuranScreen() {
  const { isDark } = useTheme();
  const { chromeVisible } = useQuranContext();

  const chromeAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(chromeAnim, {
      toValue: chromeVisible ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [chromeVisible, chromeAnim]);

  return (
    <View style={styles.root}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor="transparent"
        translucent
      />

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

  // When a verseKey is provided we must use the word-level page_number from the
  // Quran Foundation API — the surah's firstPage (or any other approximation) will
  // be wrong for verses that are not at the start of their surah, causing
  // pendingVerseHighlight to never fire (QuranVerseView checks pageNumber equality).
  //
  // When there is no verseKey, fall back to the page param (Asmaul Husna etc.)
  // or the last-read page cache — both are synchronous and correct.
  const [resolvedPage, setResolvedPage] = useState<number | null>(() => {
    if (initialVerseKey) return null; // will be resolved async below
    if (params.page) return Math.max(1, Math.min(604, parseInt(params.page, 10)));
    return getCachedLastPage();
  });

  useEffect(() => {
    if (!initialVerseKey) return;

    const fallback = params.page
      ? Math.max(1, Math.min(604, parseInt(params.page, 10)))
      : getCachedLastPage();

    // Same fetch used by QuranSearchModal — word-level page_number is accurate,
    // verse-level field is not (see CLAUDE.md fixed bugs).
    fetch(
      `https://api.quran.com/api/v4/verses/by_key/${initialVerseKey}` +
      `?words=true&word_fields=code_v2,page_number&mushaf=1`,
    )
      .then((r) => r.json())
      .then((data: { verse?: { words?: Array<{ page_number?: number }> } }) => {
        const page = data?.verse?.words?.[0]?.page_number;
        setResolvedPage(typeof page === 'number' ? page : fallback);
      })
      .catch(() => setResolvedPage(fallback));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Hold render until the page is resolved (only applies to verseKey navigation).
  // Return a dark view matching the reader background — avoids white flash.
  if (resolvedPage === null) return <View style={{ flex: 1, backgroundColor: '#000' }} />;

  return (
    <QuranProvider
      initialPage={resolvedPage}
      initialVerseKey={initialVerseKey}
      initialReadingMode={initialVerseKey ? 'verse' : undefined}
    >
      <Stack.Screen options={{ gestureEnabled: false, fullScreenGestureEnabled: false }} />
      <QuranScreen />
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
