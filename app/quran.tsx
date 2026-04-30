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
  Animated,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { getCachedLastPage } from '../services/quranLastPage';
import { SURAH_INDEX } from '../data/surahIndex';
import { getCachedExactPage, setCachedExactPage } from '../services/quranPrewarmService';

import { useTheme } from '../context/ThemeContext';
import { useQuranContext } from '../context/QuranContext';
import QuranPager from '../components/quran/QuranPager';
import QuranHeader from '../components/quran/QuranHeader';
import QuranPagePicker from '../components/quran/QuranPagePicker';
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

// Module-level exact-page fetch state.
// Kept outside the component so multiple retaps for the SAME verse share one
// fetch rather than aborting and restarting it. This is the primary fix for the
// intermittent "didn't scroll" bug: rapid taps used to abort the previous fetch,
// so the exact page was never resolved and the user stayed on the approx page.
let _inflightVerseKey: string | null = null;
let _inflightController: AbortController | null = null;
let _inflightTimeoutId: ReturnType<typeof setTimeout> | null = null;

// ── Lazy modal gate ──────────────────────────────────────────────────────────
//
// The Quran reader has five hidden overlays (contents, settings, search,
// reciter, verse-actions). They are not visible at tab entry, but each owns a
// non-trivial subtree (BlurView + 114-row FlatList for contents, full settings
// form, search index FlatList, reciter list, share/action sheet). Mounting all
// five during the Stack slide-in animation creates a perceptible frys on
// entry.
//
// LazyOverlay defers mounting until the overlay is opened for the FIRST time.
// After that it stays mounted (so reopens are instant and animation state is
// preserved). Closing does not unmount. This trades the modal's first-open
// cost — masked by its slide/fade-in animation — for a cheaper tab-entry path.
function LazyOverlay({ active, children }: { active: boolean; children: React.ReactNode }) {
  const [mounted, setMounted] = useState(active);
  useEffect(() => {
    if (active && !mounted) setMounted(true);
  }, [active, mounted]);
  if (!mounted) return null;
  return <>{children}</>;
}

// ── Inner screen (consumes context) ──────────────────────────────────────────

function QuranScreen({ deepLinkVerseKey, deepLinkNonce }: { deepLinkVerseKey?: string; deepLinkNonce?: string }) {
  const { isDark } = useTheme();
  const {
    chromeVisible, goToVerse,
    contentsMenuOpen, settingsPanelOpen, searchOpen, reciterSelectorOpen,
    longPressedVerse,
  } = useQuranContext();

  const chromeAnim = useRef(new Animated.Value(1)).current;
  // Tracks the last-handled navigation key: "<verseKey>:<nonce>" or "<verseKey>:initial".
  // A new nonce on every tap means repeated taps on the same verse (even 20× in a row)
  // always re-trigger the deep-link fetch and re-set pendingVerseHighlight, regardless
  // of whether the QuranProvider was remounted or is being reused from the stack.
  const handledNavKeyRef = useRef('');

  // Guards goToVerse calls inside async fetch .then() so they don't fire after unmount.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

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
  // ── Rapid-tap fix ─────────────────────────────────────────────────────────────
  // Each tap from DagensKoranversCard carries a new nonce, re-triggering this
  // effect. The previous design aborted the API fetch on every retap (via effect
  // cleanup returning controller.abort()), which meant the exact page was never
  // resolved during rapid taps — the user stayed on approxPage (surah first page)
  // and the 1.6 s retry loop gave up without scrolling.
  //
  // Fix: the API fetch is managed by module-level state (_inflightController /
  // _inflightVerseKey) instead of the effect's cleanup return. This decouples the
  // fetch lifecycle from React's re-render cycle. Retaps for the SAME verseKey
  // reuse the in-flight fetch (priority 2 below) rather than aborting it.
  //
  // Priority chain on every tap:
  //   1. Exact page already in cache (prewarm or previous tap) → instant, no fetch
  //   2. Fetch for this verseKey already in flight → refresh approxPage highlight, wait
  //   3. First tap (or new verseKey) → start fetch, navigate to approxPage meanwhile
  useEffect(() => {
    if (!deepLinkVerseKey) return;

    // Build a unique key for this navigation event.
    // nonce present (DagensKoranvers): each tap has a unique timestamp → different key → re-runs.
    // nonce absent (other callers, e.g. Asmaul Husna): key = "<verseKey>:initial" → runs once per mount.
    const navKey = `${deepLinkVerseKey}:${deepLinkNonce ?? 'initial'}`;
    if (handledNavKeyRef.current === navKey) return;
    handledNavKeyRef.current = navKey;

    if (__DEV__) console.log('[QuranTargetScroll] received target', deepLinkVerseKey, 'nonce', deepLinkNonce);

    // ── Priority 1: cache hit ──────────────────────────────────────────────────
    // Populated by quranPrewarmService (runs on home screen) or a previous tap.
    // Skip the network entirely.
    const cached = getCachedExactPage(deepLinkVerseKey);
    if (cached) {
      if (__DEV__) console.log('[QuranTargetScroll] cache hit → page', cached);
      goToVerse(deepLinkVerseKey, cached);
      return;
    }

    // ── Priority 2: same verseKey fetch already in flight ─────────────────────
    // A previous tap started this fetch. Refresh the pending highlight so the
    // correct page view picks up the scroll when the fetch completes.
    if (_inflightVerseKey === deepLinkVerseKey) {
      if (__DEV__) console.log('[QuranTargetScroll] fetch in-flight, refreshing approxPage highlight');
      goToVerse(deepLinkVerseKey, approxPageForVerseKey(deepLinkVerseKey));
      return;
    }

    // ── Priority 3: start a new fetch ─────────────────────────────────────────
    // Abort any in-flight fetch for a DIFFERENT verse (user changed the target).
    if (_inflightController !== null) {
      _inflightController.abort();
      if (_inflightTimeoutId !== null) { clearTimeout(_inflightTimeoutId); _inflightTimeoutId = null; }
      _inflightController = null;
      _inflightVerseKey   = null;
    }

    // Navigate immediately to approx page (surah first page) while the exact
    // page resolves. Sets pendingVerseHighlight so the correct QuranVerseView
    // instance starts the scroll retry loop as soon as its fonts load.
    goToVerse(deepLinkVerseKey, approxPageForVerseKey(deepLinkVerseKey));

    const controller  = new AbortController();
    const timeoutId   = setTimeout(() => controller.abort(), 8000);
    _inflightController = controller;
    _inflightTimeoutId  = timeoutId;
    _inflightVerseKey   = deepLinkVerseKey;

    const fetchVerseKey = deepLinkVerseKey; // capture for async closure

    fetch(
      `https://api.quran.com/api/v4/verses/by_key/${fetchVerseKey}` +
      `?words=true&word_fields=code_v2,page_number&mushaf=1`,
      { signal: controller.signal },
    )
      .then((r) => r.json())
      .then((data: { verse?: { words?: Array<{ page_number?: number }> } }) => {
        const page = data?.verse?.words?.[0]?.page_number;
        if (typeof page === 'number') {
          setCachedExactPage(fetchVerseKey, page); // all future taps → instant
          if (mountedRef.current) {
            goToVerse(fetchVerseKey, page);
          }
        }
      })
      .catch(() => {
        // Network error or 8 s timeout — user stays on approxPage silently.
      })
      .finally(() => {
        if (_inflightVerseKey === fetchVerseKey) {
          _inflightController = null;
          _inflightTimeoutId  = null;
          _inflightVerseKey   = null;
        }
      });

    // No cleanup return — the fetch is NOT tied to React's re-render cycle.
    // Retap cleanup (nonce changes, same verseKey): effect returns early at
    // priority 2 on the next run, leaving this fetch alive.
    // Screen-unmount: mountedRef.current = false (set by the separate useEffect
    // above) prevents the stale goToVerse call in .then().
    // Different verseKey: priority 3 above aborts via _inflightController.

  // goToVerse is stable (useCallback in QuranContext) — safe to omit.
  // deepLinkNonce is the real trigger; deepLinkVerseKey is included for safety.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkVerseKey, deepLinkNonce]);

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

      {/* Audio player UI is mounted at app root (see app/_layout.tsx) so it
          survives leaving /quran for background playback. The component reads
          chromeVisible / pathname from context to position itself and fade
          with the Quran chrome only when the user is on /quran. */}

      {/* Lazy-mounted overlays — see LazyOverlay above for the rationale.
          Each stays mounted after the first time it opens, so reopens are instant. */}
      <LazyOverlay active={contentsMenuOpen}>
        <QuranContentsScreen />
      </LazyOverlay>
      <LazyOverlay active={settingsPanelOpen}>
        <QuranSettingsPanel />
      </LazyOverlay>
      <LazyOverlay active={searchOpen}>
        <QuranSearchModal />
      </LazyOverlay>
      <LazyOverlay active={reciterSelectorOpen}>
        <QuranReciterSelector />
      </LazyOverlay>
      <LazyOverlay active={longPressedVerse !== null}>
        <VerseActionsMenu />
      </LazyOverlay>
    </View>
  );
}

// ── Entry point with provider ─────────────────────────────────────────────────

export default function QuranRoute() {
  const params = useLocalSearchParams<{ page?: string; verseKey?: string; nonce?: string }>();
  const initialVerseKey = params.verseKey ?? undefined;
  const { goToPage } = useQuranContext();

  // QuranProvider lives at app root (above the Stack), so it does NOT remount
  // each time /quran is opened. Its currentPage state is whatever it was on the
  // last visit. If this open carries a `page` param (deep-link without verseKey),
  // apply it once here. With a verseKey, we leave the navigation to QuranScreen's
  // deep-link effect (it calls goToVerse with the exact word-level page once
  // resolved).
  const handledRef = useRef(false);
  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;
    if (initialVerseKey) return; // deep-link effect in QuranScreen handles it
    if (params.page) {
      const p = Math.max(1, Math.min(604, parseInt(params.page, 10)));
      goToPage(p);
    }
    // goToPage is stable; params resolved once per route entry.
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

  return (
    <>
      <Stack.Screen options={{ gestureEnabled: false, fullScreenGestureEnabled: false }} />
      <QuranScreen deepLinkVerseKey={initialVerseKey} deepLinkNonce={params.nonce} />
    </>
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
