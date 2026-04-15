/**
 * QuranContentsScreen.tsx
 *
 * Full-screen contents overlay (replaces the sidebar drawer).
 * Tabs: Suror | Khatmah | Bokmärken
 * Slides in from the left; full-screen width.
 *
 * Suror tab has a vertical Juz picker (1–30) on the right edge.
 * Hold and drag the picker to jump to a Juz — each new Juz fires a Light haptic.
 * Active Juz is highlighted based on scroll position.
 */

import React, { useEffect, useRef, memo, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ScrollView,
  Animated,
  PanResponder,
  StyleSheet,
  useWindowDimensions,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
  type ListRenderItemInfo,
  type FlatList as FlatListType,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SvgIcon from '../SvgIcon';
import { useTheme } from '../../context/ThemeContext';
import { useQuranContext } from '../../context/QuranContext';
import {
  SURAH_INDEX,
  JUZ_INDEX,
  SURAH_JUZ_MAP,
  type SurahInfo,
} from '../../data/surahIndex';
import type { Bookmark } from '../../hooks/quran/useQuranBookmarks';
import KhatmahScreen from './KhatmahScreen';

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = 'suror' | 'khatmah' | 'bokmärken';

const TAB_LABELS: Record<Tab, string> = {
  suror:     'Suror',
  khatmah:   'Khatmah',
  bokmärken: 'Bokmärken',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function juzForSurah(surahId: number): number {
  return SURAH_JUZ_MAP[surahId] ?? 1;
}

function juzForPage(page: number): number {
  let juzId = 1;
  for (const j of JUZ_INDEX) {
    if (j.firstPage <= page) juzId = j.id;
    else break;
  }
  return juzId;
}

// ── Row height constants — must match StyleSheet values below ─────────────────
// SURAH_ROW_H   = paddingVertical:10×2=20 + max(badge:32px, text:~32px) = 52
// JUZ_HEADER_H  = paddingTop:14 + text:~13 + paddingBottom:4 + marginBottom:2 + border:~1 = 34

const SURAH_ROW_H = 52;
const JUZ_HEADER_H = 34;
const PICKER_W          = 28;
const PICKER_W_LANDSCAPE = 40;
const PICKER_ITEM_H      = 28; // fixed height per item in landscape — guarantees tap targets
const JUZ_NUMBERS = Array.from({ length: 30 }, (_, i) => i + 1);

// ── Pre-computed layout tables (module-level, computed once) ──────────────────

const SURAH_ITEM_HEIGHTS: number[] = SURAH_INDEX.map((item) => {
  const juzId = juzForSurah(item.id);
  const prevJuzId = item.id > 1 ? juzForSurah(item.id - 1) : -1;
  const hasHeader = item.id === 1 || juzId !== prevJuzId;
  return SURAH_ROW_H + (hasHeader ? JUZ_HEADER_H : 0);
});

// Cumulative offsets; starts at paddingTop=4 from listContent style.
const SURAH_ITEM_OFFSETS: number[] = (() => {
  const offsets: number[] = [];
  let acc = 4;
  for (const h of SURAH_ITEM_HEIGHTS) {
    offsets.push(acc);
    acc += h;
  }
  return offsets;
})();

/** Given a scroll y-offset, returns the currently active juz id. */
function activeJuzForOffset(y: number): number {
  let idx = 0;
  for (let i = 1; i < SURAH_ITEM_OFFSETS.length; i++) {
    if (SURAH_ITEM_OFFSETS[i] <= y) idx = i;
    else break;
  }
  return juzForSurah(SURAH_INDEX[idx].id);
}

// ── JuzPickerBar ──────────────────────────────────────────────────────────────
//
// Portrait: a single PanResponder View — tap OR hold-and-drag to select.
//   Each entry the finger crosses fires a Light haptic impact.
//   pageY is mapped linearly across the container height to juz 1–30.
// Landscape: a plain ScrollView (no drag picker — scroll is the interaction).

const JuzPickerBar = memo(function JuzPickerBar({
  activeJuz,
  onJuzTap,
  bottomInset,
}: {
  activeJuz: number;
  onJuzTap: (n: number) => void;
  bottomInset: number;
}) {
  const { theme: T } = useTheme();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  // Refs used inside PanResponder callbacks (must not be stale)
  const pickerRef      = useRef<View>(null);
  const pickerTopRef   = useRef(0);
  const pickerHRef     = useRef(0);
  const bottomInsetRef = useRef(bottomInset);
  const lastJuzRef     = useRef(activeJuz);
  const onTapRef       = useRef(onJuzTap);

  // Keep callback + last-known juz in sync with props
  useEffect(() => { onTapRef.current = onJuzTap; }, [onJuzTap]);
  useEffect(() => { lastJuzRef.current = activeJuz; }, [activeJuz]);
  useEffect(() => { bottomInsetRef.current = bottomInset; }, [bottomInset]);

  // Measure picker position after layout so pageY math is correct
  const measurePicker = () => {
    setTimeout(() => {
      pickerRef.current?.measure((_x, _y, _w, h, _px, py) => {
        pickerTopRef.current = py;
        pickerHRef.current   = h;
      });
    }, 0);
  };

  // Map an absolute pageY to a juz number (1–30).
  // Items have flex:1 so they fill [paddingTop … barH - paddingBottom].
  // We subtract both pads before computing the ratio so juz 1 and 30
  // are reachable at the very top and bottom of the item area.
  const getJuz = (pageY: number): number => {
    const TOP_PAD    = 4;
    const BOTTOM_PAD = bottomInsetRef.current + 4;
    const usableH    = pickerHRef.current - TOP_PAD - BOTTOM_PAD;
    if (usableH <= 0) return lastJuzRef.current;
    const relY  = pageY - pickerTopRef.current - TOP_PAD;
    const ratio = Math.max(0, Math.min(0.9999, relY / usableH));
    return Math.max(1, Math.min(30, Math.floor(ratio * 30) + 1));
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder:  () => true,
      onPanResponderGrant: (evt) => {
        const juz = getJuz(evt.nativeEvent.pageY);
        lastJuzRef.current = juz;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onTapRef.current(juz);
      },
      onPanResponderMove: (evt) => {
        const juz = getJuz(evt.nativeEvent.pageY);
        if (juz === lastJuzRef.current) return;
        lastJuzRef.current = juz;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onTapRef.current(juz);
      },
    })
  ).current;

  if (isLandscape) {
    // Landscape: fixed-height TouchableOpacity items in a ScrollView.
    // flex:1 on items is meaningless inside ScrollView — use PICKER_ITEM_H instead.
    // Wider column (PICKER_W_LANDSCAPE) gives comfortable tap targets.
    return (
      <ScrollView
        style={[pickerStyles.barScroll, { width: PICKER_W_LANDSCAPE }]}
        contentContainerStyle={[pickerStyles.barScrollContent, { paddingBottom: bottomInset + 4 }]}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {JUZ_NUMBERS.map((n) => {
          const isActive = n === activeJuz;
          return (
            <TouchableOpacity
              key={n}
              style={[pickerStyles.itemLandscape, { width: PICKER_W_LANDSCAPE }]}
              onPress={() => onJuzTap(n)}
              activeOpacity={0.6}
              hitSlop={{ top: 0, bottom: 0, left: 4, right: 4 }}
            >
              <View style={[pickerStyles.pillLandscape, isActive && { backgroundColor: T.accent }]}>
                <Text style={[pickerStyles.labelLandscape, { color: isActive ? '#fff' : T.textMuted }]}>
                  {n}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    );
  }

  const items = JUZ_NUMBERS.map((n) => {
    const isActive = n === activeJuz;
    return (
      <View key={n} style={pickerStyles.item}>
        <View style={[pickerStyles.pill, isActive && { backgroundColor: T.accent }]}>
          <Text style={[pickerStyles.label, { color: isActive ? '#fff' : T.textMuted }]}>
            {n}
          </Text>
        </View>
      </View>
    );
  });

  return (
    <View
      ref={pickerRef}
      style={[pickerStyles.bar, { paddingBottom: bottomInset + 4 }]}
      onLayout={measurePicker}
      {...panResponder.panHandlers}
    >
      {items}
    </View>
  );
});

const pickerStyles = StyleSheet.create({
  // Portrait: items use flex:1 so they fill the full bar height evenly.
  // No justifyContent — items distribute themselves from paddingTop to bottom.
  bar: {
    width: PICKER_W,
    flexShrink: 0,
    paddingTop: 4,
    paddingBottom: 4,
    alignItems: 'center',
  },
  // Landscape: ScrollView so all 30 numbers are reachable
  barScroll: {
    width: PICKER_W,
    flexShrink: 0,
    paddingTop: 4,
  },
  barScrollContent: {
    alignItems: 'center',
    paddingBottom: 4,
  },
  // Portrait items
  item: {
    flex: 1,
    width: PICKER_W,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    width: 20,
    height: 16,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    includeFontPadding: false,
    textAlign: 'center',
  },
  // Landscape items — fixed height, larger font, full-width tap target
  itemLandscape: {
    height: PICKER_ITEM_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillLandscape: {
    width: 28,
    height: 22,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelLandscape: {
    fontSize: 13,
    fontWeight: '600',
    includeFontPadding: false,
    textAlign: 'center',
  },
});

// ── Main Component ────────────────────────────────────────────────────────────

function QuranContentsScreen() {
  const { theme: T, isDark } = useTheme();
  const {
    contentsMenuOpen,
    closeContentsMenu,
    goToSurah,
    goToPage,
    goToBookmark,
    currentPage,
    bookmarks,
    removeBookmark,
  } = useQuranContext();
  const insets = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();

  const [tab, setTab] = useState<Tab>('suror');
  const [activeJuz, setActiveJuz] = useState<number>(() => juzForPage(currentPage));
  const activeJuzRef = useRef(juzForPage(currentPage));
  // Set to true while a programmatic scrollToIndex is animating so that
  // handleSurahScroll does not overwrite activeJuz with intermediate positions.
  const programmaticScrollRef = useRef(false);
  const programmaticScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Panel is parked here when idle (closed). Must be large enough that
  // (PANEL_IDLE_OFFSET + maxDeviceWidth) < 0 for any iOS device. 1200 > 430 (widest iPhone).
  const PANEL_IDLE_OFFSET = -1200;

  const slideAnim = useRef(new Animated.Value(PANEL_IDLE_OFFSET)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;
  const surahListRef = useRef<FlatListType<SurahInfo>>(null);
  const bookmarkListRef = useRef<FlatListType<Bookmark>>(null);

  // Keep a ref that's always current so animation callbacks can read screenW
  // without needing screenW in the effect deps (which would cause rotation flashes).
  const screenWRef = useRef(screenW);
  useEffect(() => { screenWRef.current = screenW; }, [screenW]);

  // ── Tab handling ────────────────────────────────────────────────────────────

  const handleTabPress = useCallback((t: Tab) => {
    if (t === tab) {
      if (t === 'suror') surahListRef.current?.scrollToOffset({ offset: 0, animated: true });
      else if (t === 'bokmärken') bookmarkListRef.current?.scrollToOffset({ offset: 0, animated: true });
    } else {
      setTab(t);
    }
  }, [tab]);

  // ── Slide animation ─────────────────────────────────────────────────────────
  //
  // The panel uses left:0, right:0 (not width:screenW) so it fills the screen
  // regardless of orientation. The idle close offset is -1200 — far enough
  // off-screen for every iOS device — so rotation never makes the panel visible.
  //
  // Open:  snap to -screenW (just off left edge), then animate to 0.
  // Close: animate from 0 to -screenW, then park at PANEL_IDLE_OFFSET.
  //        The park call only fires when the animation completes naturally
  //        (finished=true), so an interrupted close (user re-opens quickly)
  //        never parks a still-open panel.

  useEffect(() => {
    const sw = screenWRef.current;

    if (contentsMenuOpen) {
      // Position just off the left edge so the slide-in covers exactly one panel width.
      slideAnim.setValue(-sw);
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 280,
          useNativeDriver: true,
        }),
        Animated.timing(backdropAnim, {
          toValue: 1,
          duration: 280,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: -sw,
          duration: 280,
          useNativeDriver: true,
        }),
        Animated.timing(backdropAnim, {
          toValue: 0,
          duration: 280,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        // Park at guaranteed-off-screen offset. Only when the animation ran to
        // completion — if it was interrupted (user re-opened) finished=false
        // and we must NOT move the panel.
        if (finished) slideAnim.setValue(PANEL_IDLE_OFFSET);
      });
    }
  }, [contentsMenuOpen, slideAnim, backdropAnim]);
  // screenW intentionally NOT in deps — read via screenWRef to avoid rotation flashes.

  // When menu opens: sync activeJuz from currentPage and scroll list to active surah.
  useEffect(() => {
    if (!contentsMenuOpen) return;

    const juz = juzForPage(currentPage);
    activeJuzRef.current = juz;
    setActiveJuz(juz);

    // Find the last surah whose firstPage ≤ currentPage.
    let activeSurahIdx = 0;
    for (let i = 0; i < SURAH_INDEX.length; i++) {
      if (SURAH_INDEX[i].firstPage <= currentPage) activeSurahIdx = i;
      else break;
    }

    // Wait for slide animation to settle before scrolling.
    const t = setTimeout(() => {
      surahListRef.current?.scrollToIndex({
        index: activeSurahIdx,
        animated: false,
        viewPosition: 0,
      });
    }, 300);
    return () => clearTimeout(t);
  }, [contentsMenuOpen, currentPage]);

  // ── Surah list: getItemLayout for reliable scrollToIndex ───────────────────

  const getSurahItemLayout = useCallback(
    (_: unknown, index: number) => ({
      length: SURAH_ITEM_HEIGHTS[index] ?? SURAH_ROW_H,
      offset: SURAH_ITEM_OFFSETS[index] ?? 0,
      index,
    }),
    [],
  );

  const handleSurahScrollToIndexFailed = useCallback(
    ({ index }: { index: number; highestMeasuredFrameIndex: number; averageItemLength: number }) => {
      surahListRef.current?.scrollToOffset({
        offset: SURAH_ITEM_OFFSETS[index] ?? 0,
        animated: true,
      });
    },
    [],
  );

  // Track active juz from scroll position; only setState when juz actually changes.
  // Suppressed while a programmatic scrollToIndex is in flight to avoid flashing.
  const handleSurahScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (programmaticScrollRef.current) return;
      const y = e.nativeEvent.contentOffset.y;
      const newJuz = activeJuzForOffset(y);
      if (newJuz !== activeJuzRef.current) {
        activeJuzRef.current = newJuz;
        setActiveJuz(newJuz);
      }
    },
    [],
  );

  // ── Juz picker tap ──────────────────────────────────────────────────────────

  const handleJuzPickerTap = useCallback((juzNum: number) => {
    const juzEntry = JUZ_INDEX[juzNum - 1];
    if (!juzEntry) return;
    const listIndex = Math.max(0, juzEntry.surahId - 1);

    // Lock out scroll-driven updates for the duration of the animated scroll
    // so intermediate positions don't flash through the picker highlight.
    activeJuzRef.current = juzNum;
    setActiveJuz(juzNum);
    programmaticScrollRef.current = true;
    if (programmaticScrollTimer.current) clearTimeout(programmaticScrollTimer.current);
    programmaticScrollTimer.current = setTimeout(() => {
      programmaticScrollRef.current = false;
    }, 600);

    surahListRef.current?.scrollToIndex({
      index: listIndex,
      animated: true,
      viewPosition: 0,
    });
  }, []);

  // ── Render helpers ──────────────────────────────────────────────────────────

  const renderSurah = useCallback(
    ({ item }: ListRenderItemInfo<SurahInfo>) => {
      const isActive = item.firstPage === currentPage;
      const juzId = juzForSurah(item.id);
      const prevJuzId = item.id > 1 ? juzForSurah(item.id - 1) : juzId;
      const showJuzHeader = item.id === 1 || juzId !== prevJuzId;

      return (
        <>
          {showJuzHeader && (
            <View style={[styles.juzHeader, { borderBottomColor: T.separator }]}>
              <Text style={[styles.juzHeaderText, { color: T.textMuted }]}>
                {`JUZ ${juzId}`}
              </Text>
            </View>
          )}
          <TouchableOpacity
            style={[
              styles.listRow,
              isActive && { backgroundColor: T.accentGlow },
            ]}
            onPress={() => goToSurah(item.id)}
            activeOpacity={0.7}
          >
            <View style={[styles.indexBadge, { backgroundColor: T.border }]}>
              <Text style={[styles.indexText, { color: T.text }]}>{item.id}</Text>
            </View>
            <View style={styles.rowText}>
              <Text style={[styles.rowTitle, { color: T.text }]} numberOfLines={1}>
                {item.nameSimple}
              </Text>
              <Text style={[styles.rowMeta, { color: T.textMuted }]}>
                {`Sida ${item.firstPage} · ${item.versesCount} verser · ${item.revelationPlace === 'Makkah' ? 'Makkah' : 'Medina'}`}
              </Text>
            </View>
            <Text style={[styles.arabicName, { color: T.textSecondary }]}>
              {item.nameArabic}
            </Text>
          </TouchableOpacity>
        </>
      );
    },
    [currentPage, T, goToSurah],
  );

  const renderBookmark = useCallback(
    ({ item }: ListRenderItemInfo<Bookmark>) => {
      const surahInfo = item.verseKey
        ? SURAH_INDEX.find((s) => s.id === item.surahId)
        : null;
      const verseNumber = item.verseKey ? item.verseKey.split(':')[1] : null;
      const primaryLabel = surahInfo && verseNumber
        ? `${surahInfo.nameSimple} ${verseNumber}`
        : `Sida ${item.pageNumber}`;
      const subLabel = surahInfo && verseNumber
        ? `Sida ${item.pageNumber}`
        : item.note ?? null;

      return (
        <TouchableOpacity
          style={styles.listRow}
          onPress={() => goToBookmark(item.pageNumber, item.verseKey)}
          activeOpacity={0.7}
        >
          <View style={[styles.indexBadge, { backgroundColor: T.accentGlow }]}>
            <SvgIcon name="bookmark-fill" size={16} color={T.accent} />
          </View>
          <View style={styles.rowText}>
            <Text style={[styles.rowTitle, { color: T.text }]}>
              {primaryLabel}
            </Text>
            {subLabel ? (
              <Text style={[styles.rowMeta, { color: T.textMuted }]} numberOfLines={1}>
                {subLabel}
              </Text>
            ) : null}
          </View>
          <TouchableOpacity
            onPress={() => removeBookmark(item.id)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.7}
          >
            <SvgIcon name="trash" size={18} color={T.textMuted} />
          </TouchableOpacity>
        </TouchableOpacity>
      );
    },
    [T, goToBookmark, removeBookmark],
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Backdrop */}
      <Animated.View
        style={[styles.backdrop, { opacity: backdropAnim }]}
        pointerEvents={contentsMenuOpen ? 'auto' : 'none'}
      >
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          onPress={closeContentsMenu}
          activeOpacity={1}
        />
      </Animated.View>

      {/* Panel — fills full screen width via left:0/right:0 in stylesheet */}
      <Animated.View
        style={[
          styles.panel,
          { transform: [{ translateX: slideAnim }] },
        ]}
      >
        <BlurView
          intensity={isDark ? 80 : 95}
          tint={isDark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: isDark
                ? 'rgba(10,10,10,0.82)'
                : 'rgba(248,248,252,0.82)',
            },
          ]}
        />

        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + 12, paddingLeft: Math.max(18, insets.left + 10) }]}>
          <Text style={[styles.headerTitle, { color: T.text }]}>Innehåll</Text>
          <TouchableOpacity
            onPress={closeContentsMenu}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <SvgIcon name="close" size={22} color={T.text} />
          </TouchableOpacity>
        </View>

        {/* Tabs */}
        <View style={[styles.tabRow, { borderBottomColor: T.separator, marginLeft: Math.max(16, insets.left + 8) }]}>
          {(['suror', 'khatmah', 'bokmärken'] as Tab[]).map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.tab, tab === t && styles.tabActive]}
              onPress={() => handleTabPress(t)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: tab === t ? T.accent : T.textMuted },
                ]}
                numberOfLines={1}
              >
                {TAB_LABELS[t]}
              </Text>
              {tab === t && (
                <View style={[styles.tabIndicator, { backgroundColor: T.accent }]} />
              )}
            </TouchableOpacity>
          ))}
        </View>

        {/* Suror tab: FlatList + Juz picker bar side by side */}
        <View style={[styles.tabPane, { display: tab === 'suror' ? 'flex' : 'none' }]}>
          <FlatList
            ref={surahListRef}
            style={{ flex: 1 }}
            data={SURAH_INDEX}
            renderItem={renderSurah}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 100, paddingLeft: insets.left }]}
            showsVerticalScrollIndicator={false}
            getItemLayout={getSurahItemLayout}
            onScrollToIndexFailed={handleSurahScrollToIndexFailed}
            onScroll={handleSurahScroll}
            scrollEventThrottle={100}
            initialNumToRender={20}
            maxToRenderPerBatch={20}
            windowSize={5}
          />
          <JuzPickerBar activeJuz={activeJuz} onJuzTap={handleJuzPickerTap} bottomInset={insets.bottom} />
        </View>

        {/* Khatmah tab */}
        {tab === 'khatmah' && (
          <View style={{ flex: 1, paddingLeft: insets.left }}>
            <KhatmahScreen bottomInset={insets.bottom} />
          </View>
        )}

        {/* Bokmärken tab */}
        <View style={{ display: tab === 'bokmärken' ? 'flex' : 'none', flex: 1 }}>
          {bookmarks.length === 0 ? (
            <View style={[styles.emptyState, { paddingLeft: insets.left }]}>
              <SvgIcon name="bookmark" size={36} color={T.textMuted} />
              <Text style={[styles.emptyText, { color: T.textMuted }]}>
                Inga bokmärken ännu
              </Text>
            </View>
          ) : (
            <FlatList
              ref={bookmarkListRef}
              data={bookmarks}
              renderItem={renderBookmark}
              keyExtractor={(item) => item.id}
              contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 100, paddingLeft: insets.left }]}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>
      </Animated.View>
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    zIndex: 220,
  },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,  // fills full screen width; translateX hides it off-screen when closed
    zIndex: 221,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 14,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  tabRow: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginHorizontal: 16,
    marginBottom: 4,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
  },
  tabActive: {
    position: 'relative',
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
  },
  tabIndicator: {
    position: 'absolute',
    bottom: 0,
    left: '20%',
    right: '20%',
    height: 2,
    borderRadius: 1,
  },
  // Suror tab wrapper — row layout so picker bar sits beside the list
  tabPane: {
    flex: 1,
    flexDirection: 'row',
  },
  listContent: {
    paddingTop: 4,
  },
  juzHeader: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 2,
  },
  juzHeaderText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  indexBadge: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  indexText: {
    fontSize: 12,
    fontWeight: '700',
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  rowMeta: {
    fontSize: 11,
    marginTop: 1,
  },
  arabicName: {
    fontSize: 16,
    marginLeft: 8,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
  },
});

export default memo(QuranContentsScreen);
