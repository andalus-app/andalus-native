/**
 * QuranPagePicker.tsx (v5)
 *
 * Thumbnail-strip page picker — isolated, performant, glitch-free.
 *
 * Performance model
 * ─────────────────
 * setDisplayPage is guarded by displayPageRef — called only when the rounded
 * page index actually changes, not on every 16 ms scroll event. This cuts
 * re-renders during a swipe from ~60/s to ≤1 per page crossed.
 *
 * Verse-by-verse anti-fighting
 * ────────────────────────────
 * Audio playback (verse-by-verse mode) calls goToPage() up to once per verse.
 * Without a guard, the picker would fight the user: the user scrolls to page X,
 * audio immediately scrolls back to the playing page. Fix: after finalise(),
 * set suppressExternalScrollUntil for 3 seconds. External page changes during
 * this window are ignored by the follow-effect, so audio cannot override a
 * user-initiated scroll for 3 s.
 *
 * Double-finalise / stuck prevention
 * ───────────────────────────────────
 * scrollToOffset(animated:true) inside finalise() triggers onMomentumScrollEnd
 * again on iOS, causing a second finalise() call. finalisingRef blocks any
 * second call within 400 ms. onScrollBeginDrag resets finalisingRef so the
 * very next swipe always works.
 *
 * onScrollEndDrag timeout raised from 60 ms → 150 ms so that
 * onMomentumScrollBegin has time to fire before we decide there is no momentum.
 *
 * Scroll model
 * ────────────
 * decelerationRate="normal" — natural iOS physics, allows 100+ page flicks.
 * No snapToInterval — full momentum plays out; snap is programmatic in finalise().
 *
 * Haptics
 * ───────
 * Math.floor(offset/ITEM_W) tracked via hapticFloor ref.
 * Every boundary crossing fires selectionAsync(). Multi-page bursts spread
 * haptics evenly with setTimeout. Pure-ref path — zero setState, zero re-renders.
 * Silent during programmatic scrolls (isScrolling guard).
 *
 * Edge fade
 * ─────────
 * LinearGradient overlays on both sides, pointerEvents="none".
 * Colours adapt to dark/light mode.
 */

import React, {
  useRef, useEffect, useCallback, useState, useMemo, memo,
} from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, FlatList, StyleSheet, Platform,
  useWindowDimensions,
  type NativeSyntheticEvent, type NativeScrollEvent, type ListRenderItemInfo,
} from 'react-native';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../context/ThemeContext';
import { useQuranContext } from '../../context/QuranContext';
import { surahForPage, surahsOnPage } from '../../data/surahIndex';

// ── Constants ─────────────────────────────────────────────────────────────────

const TOTAL_PAGES   = 604;
const ITEM_W        = 34;   // total slot width per item (card + gap)
const THUMB_W       = 28;   // card width
const THUMB_H       = 36;   // card height
const THUMB_R       = 5;    // card corner radius
const CONTAINER_MX  = 8;    // left/right margin of the pill container
const FADE_W        = 48;   // width of each edge gradient overlay
const HAPTIC_MIN_MS = 14;   // minimum ms between successive haptics

// Suppress-window after user interaction (ms). Prevents audio page changes from
// fighting the picker during and after a user swipe.
const USER_SUPPRESS_MS = 3000;

// How long finalisingRef blocks re-entry into finalise() (ms).
const FINALISE_LOCK_MS = 400;

// Simulated page-content lines (header bar + body lines)
const LINE_ROWS: { w: number; op: number; h: number }[] = [
  { w: 0.58, op: 0.54, h: 3 },
  { w: 0.86, op: 0.28, h: 2 },
  { w: 0.76, op: 0.25, h: 2 },
  { w: 0.84, op: 0.22, h: 2 },
  { w: 0.66, op: 0.20, h: 2 },
  { w: 0.80, op: 0.17, h: 2 },
  { w: 0.70, op: 0.14, h: 2 },
];

// RTL order: index 0 = page 604, last index = page 1
const DATA = Array.from({ length: TOTAL_PAGES }, (_, i) => TOTAL_PAGES - i);

// ── Thumbnail card ────────────────────────────────────────────────────────────

type ThumbProps = {
  page:        number;
  isActive:    boolean;
  hasBookmark: boolean;
  isDark:      boolean;
  accent:      string;
  textMuted:   string;
  onPress:     (p: number) => void;
};

const PageThumb = memo(function PageThumb({
  page, isActive, hasBookmark, isDark, accent, textMuted, onPress,
}: ThumbProps) {
  const press    = useCallback(() => onPress(page), [page, onPress]);
  const thumbBg  = isDark ? 'rgba(56,56,62,0.92)'   : 'rgba(255,255,255,0.96)';
  const lineBase = isDark ? '255,255,255'             : '30,30,36';
  const dotColor = isDark ? 'rgba(255,255,255,0.90)' : 'rgba(30,30,36,0.75)';
  const bmColor  = isDark ? 'rgba(255,255,255,0.55)' : 'rgba(30,30,36,0.40)';

  return (
    <TouchableOpacity onPress={press} activeOpacity={0.75} style={styles.item}>
      <View style={[
        styles.thumb,
        { backgroundColor: thumbBg, borderColor: isActive ? accent : 'transparent' },
      ]}>
        <View style={styles.linesWrap}>
          {LINE_ROWS.map((l, i) => (
            <View
              key={i}
              style={{
                width:           Math.max(2, Math.round(THUMB_W * l.w) - 4),
                height:          l.h,
                borderRadius:    l.h / 2,
                backgroundColor: `rgba(${lineBase},${l.op})`,
                alignSelf:       'center',
              }}
            />
          ))}
        </View>
        {isActive && (
          <View style={[styles.dotActive, { backgroundColor: dotColor }]} />
        )}
        {hasBookmark && !isActive && (
          <View style={[styles.dotBookmark, { backgroundColor: bmColor }]} />
        )}
      </View>
      <Text style={[styles.pageNum, { color: isActive ? accent : textMuted }]}>
        {page}
      </Text>
    </TouchableOpacity>
  );
});

// ── EdgeFade — pure-RN horizontal fade, no native module needed ───────────────
// Approximates a linear gradient using 6 opacity steps.

function EdgeFade({ color, direction, style }: {
  color: string;
  direction: 'left' | 'right'; // 'left' = opaque→transparent, 'right' = transparent→opaque
  style: any;
}) {
  const steps = [0.08, 0.2, 0.38, 0.58, 0.78, 1.0];
  const opacities = direction === 'right' ? steps : [...steps].reverse();
  return (
    <View style={[style, { flexDirection: 'row' }]} pointerEvents="none">
      {opacities.map((op, i) => (
        <View key={i} style={{ flex: 1, backgroundColor: color, opacity: op }} />
      ))}
    </View>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

function QuranPagePicker() {
  const { theme: T, isDark }                 = useTheme();
  const { currentPage, currentSurahId, goToPage, goToSurah, audioCommandsRef, bookmarks } = useQuranContext();
  const { width: screenW }                   = useWindowDimensions();

  const [displayPage, setDisplayPage] = useState(currentPage);
  const [isActivelyScrolling, setIsActivelyScrolling] = useState(false);

  const listRef     = useRef<FlatList<number>>(null);
  const isScrolling = useRef(false);
  const hasMomentum = useRef(false);
  const prevPage    = useRef(currentPage);

  // Captured once on mount — FlatList's initialScrollIndex must not change.
  const initialScrollIndex = useRef(TOTAL_PAGES - currentPage);

  // Replaces single-use skipEffect. After the user scrolls, external page
  // changes (audio, etc.) are suppressed until this timestamp.
  const suppressExternalScrollUntil = useRef(0);

  // Prevents double-finalise: scrollToOffset(animated) inside finalise()
  // triggers onMomentumScrollEnd again on iOS. Block re-entry for FINALISE_LOCK_MS.
  const finalisingRef = useRef(false);

  // True only when the scroll that led to finalise() was user-initiated (drag).
  // When finalise() is triggered by the follow-effect (programmatic scrollToOffset
  // that tracks an audio-driven currentPage change), this stays false so that
  // goToPage() — which sets userPageOverrideRef=true in QuranContext — is NOT called.
  // Calling goToPage() for every audio-driven page advance would alternate the
  // override flag, causing every other interval-repeat verse-6 page advance to be
  // silently blocked (odd loops fail, even loops pass).
  const wasUserScrollRef = useRef(false);

  // Guards setDisplayPage — only call when the rounded page actually changes,
  // not on every 16 ms scroll event.
  const displayPageRef = useRef(currentPage);

  // Floor-index for haptic tracking — never setState
  const hapticFloor = useRef(TOTAL_PAGES - currentPage);

  const containerW = screenW - CONTAINER_MX * 2;
  const paddingH   = Math.max(0, Math.floor((containerW - ITEM_W) / 2));

  // All surahs present on the displayed page.
  // When idle: authoritative currentPage; when scrolling: displayPage for real-time preview.
  const pageSurahs = useMemo(
    () => surahsOnPage(isActivelyScrolling ? displayPage : currentPage),
    [isActivelyScrolling, displayPage, currentPage],
  );

  // Which surah to highlight — current playing surah when idle, page surah when scrolling.
  const activeSurahId = isActivelyScrolling
    ? surahForPage(displayPage).id
    : currentSurahId;

  const bookmarkedPages = useMemo(
    () => new Set(bookmarks.map((b) => b.pageNumber)),
    [bookmarks],
  );

  // Gradient colours match the BlurView overlay — dark and light variants
  const fadeColors = isDark
    ? (['transparent', 'rgba(10,10,14,0.86)']   as const)
    : (['transparent', 'rgba(246,246,250,0.88)'] as const);

  // ── Follow external page changes ──────────────────────────────────────────
  // Suppressed for USER_SUPPRESS_MS after any user interaction so that audio
  // playback (verse-by-verse mode) cannot fight the user's scroll selection.

  useEffect(() => {
    if (prevPage.current === currentPage) return;
    prevPage.current = currentPage;
    if (isScrolling.current) return;
    if (Date.now() < suppressExternalScrollUntil.current) return;

    displayPageRef.current = currentPage;
    setDisplayPage(currentPage);
    listRef.current?.scrollToOffset({
      offset:   (TOTAL_PAGES - currentPage) * ITEM_W,
      animated: true,
    });
  }, [currentPage]);

  // ── Scroll handlers ───────────────────────────────────────────────────────

  const onScrollBeginDrag = useCallback(() => {
    isScrolling.current  = true;
    hasMomentum.current  = false;
    // Reset so this new swipe can always finalise regardless of the previous one.
    finalisingRef.current = false;
    // Extend the suppress window from the moment the user touches the strip.
    suppressExternalScrollUntil.current = Date.now() + USER_SUPPRESS_MS;
    wasUserScrollRef.current = true;
    setIsActivelyScrolling(true);
  }, []);

  const onMomentumScrollBegin = useCallback(() => {
    hasMomentum.current = true;
  }, []);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offset       = e.nativeEvent.contentOffset.x;
      const currentFloor = Math.floor(offset / ITEM_W);
      const prevFloor    = hapticFloor.current;

      if (isScrolling.current && currentFloor !== prevFloor) {
        const crossed = Math.abs(currentFloor - prevFloor);
        hapticFloor.current = currentFloor;

        if (crossed === 1) {
          Haptics.selectionAsync();
        } else {
          // Multiple pages crossed in one 16 ms event — spread haptics evenly.
          const spacing = Math.max(HAPTIC_MIN_MS, Math.round(16 / crossed));
          for (let i = 0; i < crossed; i++) {
            setTimeout(() => Haptics.selectionAsync(), i * spacing);
          }
        }
      }

      // Guard: only setState when the rounded page actually changes.
      // Without this, setDisplayPage fires 60×/s causing constant re-renders.
      const page = Math.max(1, Math.min(TOTAL_PAGES, TOTAL_PAGES - Math.round(offset / ITEM_W)));
      if (page !== displayPageRef.current) {
        displayPageRef.current = page;
        setDisplayPage(page);
      }
    },
    [],
  );

  // Programmatic snap to nearest page after scroll settles.
  // finalisingRef prevents the snap animation from triggering a second finalise
  // via onMomentumScrollEnd (iOS behaviour when scrollToOffset animated:true).
  const finalise = useCallback(
    (rawOffset: number) => {
      if (finalisingRef.current) return;
      finalisingRef.current = true;
      setTimeout(() => { finalisingRef.current = false; }, FINALISE_LOCK_MS);

      const idx     = Math.round(rawOffset / ITEM_W);
      const page    = Math.max(1, Math.min(TOTAL_PAGES, TOTAL_PAGES - idx));
      const snapped = idx * ITEM_W;

      isScrolling.current = false;
      hasMomentum.current = false;
      setIsActivelyScrolling(false);

      if (Math.abs(rawOffset - snapped) > 0.5) {
        listRef.current?.scrollToOffset({ offset: snapped, animated: true });
      }

      displayPageRef.current = page;
      setDisplayPage(page);

      // Only call goToPage (which sets userPageOverrideRef=true in QuranContext) and
      // extend the suppress window when this finalise() was triggered by a USER drag.
      // When triggered by the follow-effect (programmatic scrollToOffset after an
      // audio-driven currentPage change), goToPage must NOT be called — doing so
      // alternates userPageOverrideRef between true/false and blocks every other
      // audio-driven page advance during interval repeat (odd loops fail, even pass).
      if (wasUserScrollRef.current) {
        wasUserScrollRef.current = false;
        suppressExternalScrollUntil.current = Date.now() + USER_SUPPRESS_MS;
        goToPage(page);
      }
    },
    [goToPage],
  );

  const onMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) =>
      finalise(e.nativeEvent.contentOffset.x),
    [finalise],
  );

  // Raised from 60 ms → 150 ms so onMomentumScrollBegin has time to fire
  // before we decide there is no momentum (low-velocity drag fallback path).
  const onScrollEndDrag = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offset = e.nativeEvent.contentOffset.x;
      setTimeout(() => {
        if (hasMomentum.current) return;
        finalise(offset);
      }, 150);
    },
    [finalise],
  );

  // ── FlatList helpers ──────────────────────────────────────────────────────

  // offset intentionally omits paddingH.
  // Centering math throughout this component assumes contentOffset.x = idx * ITEM_W.
  // The contentContainerStyle paddingHorizontal makes that offset visually center
  // item `idx`, and initialScrollIndex + scrollToOffset both use this formula.
  // Including paddingH here would shift initialScrollIndex by ~5 pages and cause
  // goToPage / saveLastPage to record the wrong page number.
  const getItemLayout = useCallback(
    (_: ArrayLike<number> | null | undefined, idx: number) => ({
      length: ITEM_W,
      offset: ITEM_W * idx,
      index:  idx,
    }),
    [],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<number>) => (
      <PageThumb
        page={item}
        isActive={item === currentPage}
        hasBookmark={bookmarkedPages.has(item)}
        isDark={isDark}
        accent={T.accent}
        textMuted={T.textMuted}
        onPress={goToPage}
      />
    ),
    [currentPage, bookmarkedPages, isDark, T.accent, T.textMuted, goToPage],
  );

  const keyExtractor = useCallback((n: number) => String(n), []);

  const contentContainerStyle = useMemo(
    () => ({ paddingHorizontal: paddingH }),
    [paddingH],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
    <View style={[
      styles.containerClip,
      isDark && { borderWidth: 1, borderColor: 'rgba(0,255,150,0.10)' },
    ]}>
      <BlurView
        intensity={isDark ? 72 : 90}
        tint={isDark ? 'dark' : 'light'}
        style={StyleSheet.absoluteFill}
      />
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: isDark
              ? 'rgba(15,31,26,0.88)'
              : 'rgba(246,246,250,0.88)',
          },
        ]}
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsContent}
        style={styles.chipsScroll}
      >
        {[...pageSurahs].reverse().map((s) => {
          const active = s.id === activeSurahId;
          return (
            <TouchableOpacity
              key={s.id}
              activeOpacity={0.7}
              onPress={() => {
                // goToSurah sets the explicit surah override (fixes marking when
                // multiple surahs share the same page, e.g. 112/113/114 on 604)
                suppressExternalScrollUntil.current = 0;
                goToSurah(s.id);
                listRef.current?.scrollToOffset({
                  offset: (TOTAL_PAGES - s.firstPage) * ITEM_W,
                  animated: true,
                });
                // If audio is active, switch playback to the selected surah
                audioCommandsRef.current?.loadAndPlay(s.id);
                Haptics.selectionAsync();
              }}
              style={[
                styles.chip,
                active && {
                  borderColor: T.accent,
                  backgroundColor: isDark ? 'rgba(102,132,104,0.18)' : 'rgba(36,100,93,0.10)',
                },
                !active && { borderColor: 'transparent' },
              ]}
            >
              <Text
                style={[styles.chipText, { color: active ? T.accent : (isDark ? '#FFFFFF' : T.textMuted) }]}
                numberOfLines={1}
              >
                {s.nameSimple}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <FlatList
        ref={listRef}
        data={DATA}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="normal"
        contentContainerStyle={contentContainerStyle}
        getItemLayout={getItemLayout}
        initialScrollIndex={initialScrollIndex.current}
        onScrollBeginDrag={onScrollBeginDrag}
        onMomentumScrollBegin={onMomentumScrollBegin}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onMomentumScrollEnd={onMomentumScrollEnd}
        onScrollEndDrag={onScrollEndDrag}
        windowSize={5}
        maxToRenderPerBatch={8}
        initialNumToRender={14}
        updateCellsBatchingPeriod={40}
        removeClippedSubviews={Platform.OS === 'android'}
      />

      {/* Left edge fade */}
      <EdgeFade color={isDark ? 'rgba(15,31,26,0.88)' : 'rgba(246,246,250,0.88)'} direction="left" style={styles.fadeLeft} />

      {/* Right edge fade */}
      <EdgeFade color={isDark ? 'rgba(15,31,26,0.88)' : 'rgba(246,246,250,0.88)'} direction="right" style={styles.fadeRight} />
    </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    position:      'absolute',
    bottom:        Platform.OS === 'ios' ? 36 : 20,
    left:          CONTAINER_MX,
    right:         CONTAINER_MX,
    borderRadius:  20,
    overflow:      'visible',
    zIndex:        140,
    shadowColor:   '#000',
    shadowOffset:  { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius:  12,
    elevation:     8,
  },
  containerClip: {
    borderRadius:  20,
    overflow:      'hidden',
    paddingTop:    10,
    paddingBottom: Platform.OS === 'ios' ? 10 : 8,
  },
  chipsScroll: {
    maxHeight:    34,
    marginBottom: 8,
  },
  chipsContent: {
    paddingHorizontal: 12,
    gap:               6,
    flexGrow:          1,
    justifyContent:    'center',
    alignItems:        'center',
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical:   5,
    borderRadius:      10,
    borderWidth:       1,
  },
  chipText: {
    fontSize:      13,
    fontWeight:    '600',
    letterSpacing: -0.1,
  },
  item: {
    width:      ITEM_W,
    alignItems: 'center',
  },
  thumb: {
    width:        THUMB_W,
    height:       THUMB_H,
    borderRadius: THUMB_R,
    borderWidth:  1.5,
    overflow:     'hidden',
  },
  linesWrap: {
    flex:            1,
    paddingVertical: 4,
    justifyContent:  'space-between',
    alignItems:      'center',
  },
  dotActive: {
    position:     'absolute',
    width:        5,
    height:       5,
    borderRadius: 2.5,
    bottom:       '36%',
    left:         '36%',
  },
  dotBookmark: {
    position:     'absolute',
    width:        4,
    height:       4,
    borderRadius: 2,
    top:          3,
    right:        3,
  },
  pageNum: {
    fontSize:      9,
    fontWeight:    '600',
    marginTop:     3,
    letterSpacing: 0.2,
  },
  fadeLeft: {
    position: 'absolute',
    left:     0,
    top:      0,
    bottom:   0,
    width:    FADE_W,
  },
  fadeRight: {
    position: 'absolute',
    right:    0,
    top:      0,
    bottom:   0,
    width:    FADE_W,
  },
});

export default memo(QuranPagePicker);
