/**
 * QuranPager.tsx
 *
 * 604-page horizontal FlatList. getItemLayout for O(1) scrolling.
 * Each page is wrapped in a Pressable so taps toggle chrome visibility.
 *
 * RTL (Quran) convention:
 *   data = [604..1] — page 1 is at index 603 (rightmost), page 604 at index 0 (leftmost).
 *   Swipe RIGHT → lower index → higher page number (next page, toward left of Mushaf).
 *   Swipe LEFT  → higher index → lower page number (previous page).
 *
 * ── Landscape mode ────────────────────────────────────────────────────────────
 *
 * In Mushaf (page) reading mode, landscape must show the SAME full page as
 * portrait — same 15 line slots, same glyphs, same line structure — just at a
 * larger scale because the canvas is wider.
 *
 * How it works:
 *
 *   pageWidth  = landscapeScreenWidth  (fills the screen width)
 *   pageHeight = pageWidth * (pageWidth / landscapeScreenHeight)
 *              = pageWidth² / landscapeScreenHeight
 *
 * This is the height a standard portrait page would need if scaled so its
 * width equals the landscape screen width. It preserves the portrait aspect
 * ratio so MushafRenderer lays out the 15 slots with identical proportions
 * (same slot heights, same font size scaling, same inter-line spacing).
 *
 * Because pageHeight > landscapeScreenHeight, a vertical ScrollView inside
 * each pager item lets the user scroll down to see the lower part of the page.
 *
 * The outer horizontal FlatList (pagingEnabled) keeps page-to-page navigation
 * working exactly as in portrait (swipe left/right). The inner vertical
 * ScrollView and the outer horizontal FlatList scroll on perpendicular axes
 * so React Native's responder system disambiguates them without conflicts.
 *
 * Verse (verse-by-verse) mode is unchanged — QuranVerseView handles its own
 * scrolling and is not affected by this landscape logic.
 */

import React, { useRef, useCallback, useEffect, memo } from 'react';
import {
  FlatList,
  InteractionManager,
  Pressable,
  ScrollView,
  useWindowDimensions,
  type ListRenderItemInfo,
  type ViewabilityConfig,
  type ViewToken,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import QuranPageView from './QuranPageView';
import { useQuranContext } from '../../context/QuranContext';
import { loadQCFPageFont, loadBismillahFont } from '../../services/mushafFontManager';
import { fetchComposedMushafPage } from '../../services/mushafApi';
import {
  initOfflineManager,
  prioritize as prioritizeOffline,
  pauseDownloads,
  resumeDownloads,
} from '../../services/quranOfflineManager';
import { qLog } from '../../services/quranPerfLogger';

// ── Constants ─────────────────────────────────────────────────────────────────

const TOTAL_PAGES = 604;
// RTL order: index 0 = page 604 (leftmost), index 603 = page 1 (rightmost).
// Matches QuranPagePicker's PICKER_DATA ordering.
const PAGE_DATA = Array.from({ length: TOTAL_PAGES }, (_, i) => TOTAL_PAGES - i);

// ── Memoized page item ───────────────────────────────────────────────────────
// Extracted so renderItem can be a STABLE function (no width/height deps).
// When orientation changes, FlatList's renderItem does NOT change → FlatList
// does NOT force a synchronous batch re-render of all mounted items.
// Each PageItem re-renders individually via its own useWindowDimensions hook,
// which avoids the 19-second JS thread block that caused the black flash.

type PageItemProps = {
  pageNumber: number;
  toggleChrome: () => void;
  readingMode: string;
};

const PageItem = memo(function PageItem({ pageNumber, toggleChrome, readingMode }: PageItemProps) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const isLandscape  = width > height;
  const isMushafMode = readingMode !== 'verse';
  const useLandscapeScroll = isLandscape && isMushafMode;

  const mushafInsetL = useLandscapeScroll ? insets.left  : 0;
  const mushafInsetR = useLandscapeScroll ? insets.right : 0;

  const pageWidth  = width - mushafInsetL - mushafInsetR;
  const pageHeight = useLandscapeScroll
    ? Math.round(pageWidth * width / height)
    : height;

  const pageView = (
    <QuranPageView
      pageNumber={pageNumber}
      width={pageWidth}
      height={pageHeight}
      viewportHeight={height}
      screenWidth={useLandscapeScroll ? width : undefined}
      isActive
    />
  );

  if (useLandscapeScroll) {
    return (
      <View style={{ width, height }}>
        <ScrollView
          style={{ width, height }}
          contentContainerStyle={{ width }}
          bounces
          bouncesZoom={false}
          showsVerticalScrollIndicator={false}
          directionalLockEnabled
          scrollEventThrottle={16}
        >
          <Pressable
            onPress={toggleChrome}
            style={{ width: pageWidth, height: pageHeight, marginLeft: mushafInsetL }}
          >
            {pageView}
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={{ width, height }}>
      <Pressable
        onPress={toggleChrome}
        style={{ width, height }}
      >
        {pageView}
      </Pressable>
    </View>
  );
});

// ── Component ─────────────────────────────────────────────────────────────────

function QuranPager() {
  const { width } = useWindowDimensions();
  const { currentPage, goToPage, toggleChrome, settings, clearExplicitSurah } = useQuranContext();
  const listRef    = useRef<FlatList<number>>(null);

  // Tracks the page the FlatList is currently showing (updated on swipe).
  // Used to detect external navigation (picker, contents) vs user swipe,
  // so we can scroll imperatively without creating a feedback loop.
  const visiblePageRef = useRef(currentPage);

  // Set to true while an external (programmatic) scroll is in progress.
  // Suppresses onViewableItemsChanged so intermediate pages during the scroll
  // animation don't trigger goToPage and cause a visible page-number jump.
  const isProgrammaticScrollRef = useRef(false);

  const isMushafMode = settings.readingMode !== 'verse';

  // ── Font and data pre-loading ─────────────────────────────────────────────
  // Pre-load fonts and page data for currentPage ±2.
  //
  // Current page: loads immediately so QuranVerseView / QuranPageView can render
  // without a loading spinner. Both functions are deduplicated (no-op if already
  // loaded) so rapid currentPage changes don't trigger redundant work.
  //
  // Adjacent pages (±1 and ±2): deferred via InteractionManager.runAfterInteractions
  // so they don't compete with the Font.loadAsync calls for the current page
  // during the critical first-render window. On Quran-screen open this avoids
  // up to 4 concurrent Font.loadAsync registrations blocking the JS thread while
  // the current page is still loading.
  //
  // windowSize=5 keeps ±2 pages mounted. Pre-loading ±2 ensures the LRU cache
  // is populated before adjacent pages mount so they start as 'ready'.
  useEffect(() => {
    // Current page — load immediately
    loadQCFPageFont(currentPage);
    fetchComposedMushafPage(currentPage);
    loadBismillahFont();

    // Adjacent pages — defer until animations/interactions complete
    const task = InteractionManager.runAfterInteractions(() => {
      const start = Math.max(1, currentPage - 2);
      const end   = Math.min(TOTAL_PAGES, currentPage + 2);
      for (let p = start; p <= end; p++) {
        if (p === currentPage) continue; // already loaded above
        loadQCFPageFont(p);
        fetchComposedMushafPage(p);
      }
      qLog(`Pager pre-warm adjacent p${start}–p${end}`);
    });
    return () => task.cancel();
  }, [currentPage]);

  // ── Full-Quran background pre-cache ──────────────────────────────────────
  // Runs once per session after mount. Downloads all 604 pages' verse data and
  // QCF font files in the background so subsequent page visits are instant.
  //
  // Delayed by 4 s so the prefetch worker does not compete with the JS thread
  // during the critical startup window (initial render + first swipe gesture).
  // Font.loadAsync() for bundled fonts is synchronous-heavy on the JS thread —
  // running 4 concurrent loads immediately on mount is what caused the 5-6 s
  // unresponsive period before first swipe worked.
  useEffect(() => {
    // initOfflineManager handles the startup delay (4 s) internally and manages
    // the background download queue. Replaces startMushafPrefetch/stopMushafPrefetch.
    // Pause/resume during scroll is handled by onScrollBeginDrag / onMomentumScrollEnd.
    initOfflineManager(currentPage);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── External navigation (picker / contents / bookmark) ───────────────────

  // Scroll to page when it changes from outside (picker, contents menu, bookmark).
  // Also boost download priority for the new page and its neighbours.
  useEffect(() => {
    prioritizeOffline(currentPage);
    if (visiblePageRef.current === currentPage) return;
    visiblePageRef.current = currentPage;
    // Mark as programmatic so onViewableItemsChanged ignores intermediate pages
    // during the animated scroll (prevents header from flickering 567→568→567).
    isProgrammaticScrollRef.current = true;
    const index = TOTAL_PAGES - currentPage;
    // Pause background font/data downloads so the scroll animation and the
    // target-page font loading (Font.loadAsync) have the full JS thread budget.
    // This prevents the JS-thread-heavy background pre-caching from competing
    // with the navigation animation and causing the "app feels sluggish" issue.
    pauseDownloads();
    listRef.current?.scrollToIndex({ index, animated: true });
    // Clear programmatic flag after animation window (≤ 400 ms).
    const programmaticTimer = setTimeout(() => { isProgrammaticScrollRef.current = false; }, 500);
    // Resume background downloads 200 ms after animation ends — gives the
    // target-page font loading (triggered by QuranVerseView) time to start and
    // register with Core Text before the background queue resumes.
    const resumeTimer = setTimeout(() => resumeDownloads(), 700);
    return () => {
      clearTimeout(programmaticTimer);
      clearTimeout(resumeTimer);
      resumeDownloads();
    };
  }, [currentPage]);

  // ── Re-align after rotation ───────────────────────────────────────────────
  // When the device rotates, `width` changes. The FlatList's getItemLayout
  // immediately returns new per-item sizes, but the native UICollectionView
  // still holds the old pixel offset. Without correction the wrong page is
  // shown and onViewableItemsChanged fires a bad goToPage call.
  //
  // Strategy: keep content VISIBLE throughout. A single rAF + immediate
  // scrollToOffset corrects the position within 1–2 frames — far less jarring
  // than hiding everything with opacity 0 for 300ms+.
  const prevWidthRef = useRef(width);
  const rotationRafRef   = useRef<number>(0);
  const rotationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (prevWidthRef.current === width) return;
    prevWidthRef.current = width;

    // Suppress onViewableItemsChanged during transition to prevent garbage
    // page numbers (stale offset / new item width → wrong page).
    isProgrammaticScrollRef.current = true;

    // Single rAF: on Fabric (Expo SDK 54) native layout is synchronous —
    // cells are already resized by the time useEffect runs. One rAF ensures
    // the commit is flushed before we snap the scroll offset.
    rotationRafRef.current = requestAnimationFrame(() => {
      const index = TOTAL_PAGES - visiblePageRef.current;
      listRef.current?.scrollToOffset({ offset: width * index, animated: false });

      // Short settle time for cells to finish layout, then re-enable viewability.
      rotationTimerRef.current = setTimeout(() => {
        rotationTimerRef.current = null;
        isProgrammaticScrollRef.current = false;
      }, 80);
    });

    return () => {
      cancelAnimationFrame(rotationRafRef.current);
      if (rotationTimerRef.current !== null) {
        clearTimeout(rotationTimerRef.current);
        rotationTimerRef.current = null;
      }
      isProgrammaticScrollRef.current = false;
    };
  }, [width]);

  // ── FlatList helpers ─────────────────────────────────────────────────────

  const getItemLayout = useCallback(
    (_: ArrayLike<number> | null | undefined, index: number) => ({
      // Each item occupies exactly `width` in the horizontal scroll direction.
      // This is always the screen width regardless of landscape/portrait.
      length: width,
      offset: width * index,
      index,
    }),
    [width],
  );

  const viewabilityConfig = useRef<ViewabilityConfig>({
    itemVisiblePercentThreshold: 50,
  }).current;

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      // Ignore viewability changes during programmatic scrolls — intermediate
      // pages becoming briefly visible should not update navigation state.
      if (isProgrammaticScrollRef.current) return;
      if (viewableItems.length > 0) {
        const page = viewableItems[0].item as number;
        const prevPage = visiblePageRef.current;
        // Update visiblePageRef BEFORE calling goToPage so the effect
        // sees visiblePageRef.current === currentPage and skips the scroll.
        visiblePageRef.current = page;
        // Boost download priority for the newly visible page and its neighbours.
        // prioritizeOffline is a module function — safe to call from a stable ref.
        prioritizeOffline(page);
        // Only clear the explicit surah override when the user manually
        // swiped to a DIFFERENT page. When the page hasn't changed (e.g.
        // viewability fires after a programmatic scroll settles on the same
        // page), keep the override so multi-surah pages (like 604 with
        // surahs 112-114) remember the intended surah for audio playback.
        if (page !== prevPage) {
          clearExplicitSurah();
        }
        goToPage(page);
      }
    },
  ).current;

  const onScrollToIndexFailed = useCallback(
    (info: { averageItemLength: number; index: number }) => {
      const offset = info.averageItemLength * info.index;
      listRef.current?.scrollToOffset({ offset, animated: false });
    },
    [],
  );

  // ── Prefetch pause/resume during swipe ───────────────────────────────────
  // Font.loadAsync() (called by the background prefetch) is JS-thread-heavy.
  // Pause it the moment the user begins a drag so the animation frame budget
  // is fully available for the swipe gesture and page transition.
  // Resume only when momentum fully ends (page has settled) — not on drag end,
  // because momentum still uses the JS thread after the finger lifts.
  const onScrollBeginDrag   = useCallback(() => { pauseDownloads(); },  []);
  const onMomentumScrollEnd = useCallback(() => { resumeDownloads(); }, []);

  // ── Item renderer ────────────────────────────────────────────────────────
  // STABLE across orientation changes — no width/height/pageWidth/pageHeight
  // in deps. Each PageItem reads dimensions internally via useWindowDimensions.
  // This prevents FlatList from force-re-rendering all mounted items in one
  // synchronous batch when orientation changes (which blocked JS thread 19s+).
  const readingMode = settings.readingMode;
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<number>) => (
      <PageItem
        pageNumber={item}
        toggleChrome={toggleChrome}
        readingMode={readingMode}
      />
    ),
    [toggleChrome, readingMode],
  );

  const keyExtractor = useCallback((item: number) => String(item), []);

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        ref={listRef}
        data={PAGE_DATA}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        // RTL: page 1 is at index 603 (TOTAL_PAGES - 1), rightmost position.
        initialScrollIndex={TOTAL_PAGES - currentPage}
        getItemLayout={getItemLayout}
        onScrollToIndexFailed={onScrollToIndexFailed}
        // ── Window strategy ────────────────────────────────────────────────
        // windowSize=5 keeps ±2 pages mounted in both Mushaf and Verse mode.
        //
        // Mushaf: ±2 SVG pages are already fully rendered before the user
        // swipes there — no mount lag, no spinner, instant page transition.
        // With Tier 2 font pre-warming (above), MushafRenderer at ±2 finds
        // its font already registered and skips the loading→ready setState.
        //
        // Verse: ±2 QuranVerseViews are in `ready` state before the gesture,
        // eliminating the mount-during-gesture lag and setState scroll jump.
        //
        // Memory: 5 full-page SVG trees in memory simultaneously (~5 × MushafRenderer).
        // This is bounded and acceptable on any iPhone supported by Expo SDK 54.
        // The LRU data cache (25 pages) is independent and unaffected.
        windowSize={5}
        maxToRenderPerBatch={2}
        initialNumToRender={1}
        // removeClippedSubviews intentionally omitted — it detaches and reattaches
        // native views as pages cross the clip boundary, which causes a visible
        // flash at the end of every swipe. For a fixed-size pager (each item is
        // exactly one screen) the memory saving is marginal and not worth the
        // rendering artefact.
        viewabilityConfig={viewabilityConfig}
        onViewableItemsChanged={onViewableItemsChanged}
        scrollEventThrottle={16}
        onScrollBeginDrag={onScrollBeginDrag}
        onMomentumScrollEnd={onMomentumScrollEnd}
      />
    </View>
  );
}

export default memo(QuranPager);
