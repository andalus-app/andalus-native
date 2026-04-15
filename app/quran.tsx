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

  // If a page param is provided (deep-link from Asmaul Husna etc.), use it directly.
  // Otherwise read from the module-level cache which was populated at import time —
  // synchronous, no async wait, no flash. Falls back to page 1 on very first launch
  // before the cache has loaded (race window is typically < 50ms after app start).
  const [initialPage] = useState<number>(() => {
    if (params.page) return Math.max(1, Math.min(604, parseInt(params.page, 10)));
    return getCachedLastPage();
  });

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
