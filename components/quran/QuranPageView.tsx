import React, { useEffect, useState, useCallback, useRef, useMemo, memo } from 'react';
import {
  View, Animated, Text, StyleSheet, ActivityIndicator,
  TouchableOpacity, GestureResponderEvent,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import MushafRenderer from '../MushafRenderer';
import SvgIcon from '../SvgIcon';
import QuranVerseView from './QuranVerseView';
import { fetchComposedMushafPage, getComposedPageSync } from '../../services/mushafApi';
import type { ComposedMushafPage } from '../../services/mushafApi';
import { useTheme } from '../../context/ThemeContext';
import { useQuranContext, useActiveVerseKey } from '../../context/QuranContext';
import type { LongPressedVerse } from '../../context/QuranContext';
import SurahDetailSheet from './SurahDetailSheet';

// ── Types ─────────────────────────────────────────────────────────────────────

type Props = {
  pageNumber:      number;
  width:           number;
  height:          number;
  /** Visible viewport height. Equals height in portrait; smaller than height in landscape scroll mode. */
  viewportHeight?: number;
  /** Actual screen width (= portrait height in landscape). Used for font-size calibration. */
  screenWidth?:    number;
  isActive:        boolean;
};

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; page: ComposedMushafPage }
  | { status: 'error'; message: string };

// ── Slot layout constant ───────────────────────────────────────────────────────

const TOTAL_SLOTS = 15;

// ── Verse selection by touch position ─────────────────────────────────────────
//
// Arabic is RTL: verseKeys[0] sits on the RIGHT side of the line.
// locationX=0 is the LEFT screen edge; locationX=lineWidth is the RIGHT.
// rtlRatio maps touch position to a 0–1 value where 0 = right (start of RTL line)
// and 1 = left (end of RTL line). We then walk cumulative glyph proportions to find
// which verse the touch falls in.

function pickVerseByTouch(
  verseKeys: string[],
  glyphCounts: number[],
  locationX: number,
  lineWidth: number,
): string {
  if (verseKeys.length === 1) return verseKeys[0];
  const rtlRatio = 1 - Math.max(0, Math.min(1, locationX / lineWidth));
  const total = glyphCounts.reduce((a, b) => a + b, 0);
  if (total === 0) {
    // Equal-division fallback when glyph data unavailable
    return verseKeys[Math.min(Math.floor(rtlRatio * verseKeys.length), verseKeys.length - 1)];
  }
  let cumulative = 0;
  for (let i = 0; i < verseKeys.length; i++) {
    cumulative += glyphCounts[i] / total;
    if (rtlRatio <= cumulative) return verseKeys[i];
  }
  return verseKeys[verseKeys.length - 1];
}

// ── SlotZone ──────────────────────────────────────────────────────────────────

type SlotZoneProps = {
  verseKeys:           string[];   // all verse keys on this line (RTL: [0] = rightmost)
  glyphCounts:         number[];   // glyph count per verse, same order as verseKeys
  topY:                number;
  slotH:               number;
  lineWidth:           number;
  pageLastVerseKey:    string;
  setLongPressedVerse: (v: LongPressedVerse | null) => void;
  setPressedVerseKey:  (key: string | null) => void;
  toggleChrome:        () => void;
};

/**
 * Transparent touch zone over a single verse line.
 *
 * - pressIn  (immediate):  light haptic + pending highlight via setPressedVerseKey
 * - longPress (1 000 ms):  medium haptic + confirmed selection via setLongPressedVerse
 * - pressOut (early release): clears pending highlight
 *
 * Touch x-position is captured on pressIn and reused on longPress so the verse
 * selection reflects where the user actually touched, not a stale default.
 */
const SlotZone = memo(function SlotZone({
  verseKeys,
  glyphCounts,
  topY,
  slotH,
  lineWidth,
  pageLastVerseKey,
  setLongPressedVerse,
  setPressedVerseKey,
  toggleChrome,
}: SlotZoneProps) {
  const pressXRef = useRef(0);

  const handlePressIn = useCallback((event: GestureResponderEvent) => {
    pressXRef.current = event.nativeEvent.locationX;
  }, []);

  const handlePressOut = useCallback(() => {
    setPressedVerseKey(null);
  }, [setPressedVerseKey]);

  const handleLongPress = useCallback(() => {
    const key = pickVerseByTouch(verseKeys, glyphCounts, pressXRef.current, lineWidth);
    setPressedVerseKey(null);
    setLongPressedVerse({ verseKey: key, pageLastVerseKey });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  }, [verseKeys, glyphCounts, lineWidth, pageLastVerseKey, setLongPressedVerse, setPressedVerseKey]);

  return (
    <TouchableOpacity
      style={{ position: 'absolute', left: 0, right: 0, top: topY, height: slotH }}
      activeOpacity={1}
      delayLongPress={1000}
      onPress={toggleChrome}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onLongPress={handleLongPress}
    />
  );
});

// ── BismillahZone ────────────────────────────────────────────────────────────
// Touch zone for standalone bismillah slots. Long-press triggers the verse
// actions menu with a BSMLLH_{surahId} key so the user can play from bismillah.

type BismillahZoneProps = {
  topY:                number;
  slotH:               number;
  surahId:             number;
  pageLastVerseKey:    string;
  setLongPressedVerse: (v: LongPressedVerse | null) => void;
  setPressedVerseKey:  (key: string | null) => void;
  toggleChrome:        () => void;
};

const BismillahZone = memo(function BismillahZone({
  topY, slotH, surahId, pageLastVerseKey,
  setLongPressedVerse, setPressedVerseKey, toggleChrome,
}: BismillahZoneProps) {
  const bsmllhKey = `BSMLLH_${surahId}`;

  const handlePressIn = useCallback(() => {}, []);

  const handlePressOut = useCallback(() => {
    setPressedVerseKey(null);
  }, [setPressedVerseKey]);

  const handleLongPress = useCallback(() => {
    setPressedVerseKey(null);
    setLongPressedVerse({ verseKey: bsmllhKey, pageLastVerseKey });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  }, [bsmllhKey, pageLastVerseKey, setLongPressedVerse, setPressedVerseKey]);

  return (
    <TouchableOpacity
      style={{ position: 'absolute', left: 0, right: 0, top: topY, height: slotH }}
      activeOpacity={1}
      delayLongPress={1000}
      onPress={toggleChrome}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onLongPress={handleLongPress}
    />
  );
});

// ── SurahHeaderZone ───────────────────────────────────────────────────────────
// When bismillahEmbedded is true, the lower 40% of the header acts as a
// bismillah long-press zone and the upper 60% opens the surah detail sheet.

type SurahHeaderZoneProps = {
  topY:                number;
  slotH:               number;
  surahId:             number;
  bismillahEmbedded:   boolean;
  pageLastVerseKey:    string;
  onPress:             (id: number) => void;
  setPressedSurahId:   (id: number | null) => void;
  setLongPressedVerse: (v: LongPressedVerse | null) => void;
  setPressedVerseKey:  (key: string | null) => void;
  toggleChrome:        () => void;
};

const SurahHeaderZone = memo(function SurahHeaderZone({
  topY, slotH, surahId, bismillahEmbedded, pageLastVerseKey,
  onPress, setPressedSurahId, setLongPressedVerse, setPressedVerseKey, toggleChrome,
}: SurahHeaderZoneProps) {
  const handlePressIn = useCallback(() => {
    setPressedSurahId(surahId);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  }, [surahId, setPressedSurahId]);

  const handlePressOut = useCallback(() => {
    setPressedSurahId(null);
  }, [setPressedSurahId]);

  const handleLongPress = useCallback(() => {
    onPress(surahId);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  }, [surahId, onPress]);

  // Embedded bismillah: lower 40% of the header slot
  const bsmllhKey = `BSMLLH_${surahId}`;
  const handleBsmPressIn = useCallback(() => {
    setPressedVerseKey(bsmllhKey);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  }, [bsmllhKey, setPressedVerseKey]);

  const handleBsmPressOut = useCallback(() => {
    setPressedVerseKey(null);
  }, [setPressedVerseKey]);

  const handleBsmLongPress = useCallback(() => {
    setPressedVerseKey(null);
    setLongPressedVerse({ verseKey: bsmllhKey, pageLastVerseKey });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  }, [bsmllhKey, pageLastVerseKey, setLongPressedVerse, setPressedVerseKey]);

  if (bismillahEmbedded) {
    const headerH = Math.round(slotH * 0.60);
    const bsmH    = slotH - headerH;
    return (
      <>
        {/* Upper part: surah name banner — hold 1 s to open detail sheet */}
        <TouchableOpacity
          style={{ position: 'absolute', left: 0, right: 0, top: topY, height: headerH }}
          activeOpacity={1}
          delayLongPress={1000}
          onPress={toggleChrome}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          onLongPress={handleLongPress}
        />
        {/* Lower part: embedded bismillah — long-press to play from basmala */}
        <TouchableOpacity
          style={{ position: 'absolute', left: 0, right: 0, top: topY + headerH, height: bsmH }}
          activeOpacity={1}
          delayLongPress={1000}
          onPress={toggleChrome}
          onPressIn={handleBsmPressIn}
          onPressOut={handleBsmPressOut}
          onLongPress={handleBsmLongPress}
        />
      </>
    );
  }

  return (
    <TouchableOpacity
      style={{ position: 'absolute', left: 0, right: 0, top: topY, height: slotH }}
      activeOpacity={1}
      delayLongPress={1000}
      onPress={toggleChrome}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onLongPress={handleLongPress}
    />
  );
});

// ── QuranPageView ─────────────────────────────────────────────────────────────

function QuranPageView({ pageNumber, width, height, viewportHeight, screenWidth, isActive }: Props) {
  const { theme: T, isDark } = useTheme();
  const {
    settings, longPressedVerse, setLongPressedVerse,
    toggleChrome, khatmahRange, bookmarks,
  } = useQuranContext();
  const activeVerseKey = useActiveVerseKey();

  // Initialize synchronously from the in-memory composed-page cache when
  // available (pre-warmed by QuranPager). This skips the idle→loading→ready
  // cycle entirely for adjacent pages, eliminating the 1-frame blank flash
  // that was visible as a glitch when swiping between pages.
  const [loadState, setLoadState] = useState<LoadState>(() => {
    const cached = getComposedPageSync(pageNumber);
    return cached ? { status: 'ready', page: cached } : { status: 'idle' };
  });
  const [selectedSurahId, setSelectedSurahId] = useState<number | null>(null);
  // Verse key pressed but not yet confirmed as long-press — shows immediate pending highlight
  const [pressedVerseKey, setPressedVerseKey] = useState<string | null>(null);
  // Surah id being pressed — shows immediate banner highlight
  const [pressedSurahId, setPressedSurahId] = useState<number | null>(null);

  const openSurahSheet       = useCallback((id: number) => setSelectedSurahId(id), []);
  const setPressedSurahIdCb  = useCallback((id: number | null) => setPressedSurahId(id), []);
  const mountedRef       = useRef(true);
  const abortRef         = useRef<AbortController | null>(null);
  // Initialize to 1 so that when verse mode switches to mushaf mode, the
  // Animated.View mounts with full opacity instead of 0 (black screen).
  const fadeAnim         = useRef(new Animated.Value(1)).current;
  // Mirror readingMode in a ref so load() can read the current value without
  // becoming stale (load is a useCallback that outlives the render that created it).
  const readingModeRef   = useRef(settings.readingMode);
  readingModeRef.current = settings.readingMode;

  const setPressedVerseKeyCb = useCallback((key: string | null) => {
    setPressedVerseKey(key);
  }, []);

  const load = useCallback(async () => {
    if (!mountedRef.current) return;
    // Skip opacity reset + animation in verse mode — the Animated.View doesn't
    // exist there, so native-driven animation can't run and fadeAnim stays at 0.
    // If load() fires while in verse mode and the user later switches to mushaf,
    // the view mounts with opacity 0 → black screen.
    const isVerse = readingModeRef.current === 'verse';
    if (!isVerse) fadeAnim.setValue(0);
    setLoadState({ status: 'loading' });

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const page = await fetchComposedMushafPage(pageNumber);
      if (!mountedRef.current || controller.signal.aborted) return;
      setLoadState({ status: 'ready', page });
      if (!isVerse) {
        Animated.timing(fadeAnim, {
          toValue:         1,
          duration:        160,
          useNativeDriver: true,
        }).start();
      }
    } catch (err: unknown) {
      if (!mountedRef.current || controller.signal.aborted) return;
      const message =
        err instanceof Error ? err.message : 'Kunde inte ladda sidan';
      setLoadState({ status: 'error', message });
    }
  }, [pageNumber, fadeAnim]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  // Load when the page becomes active (or adjacent to active)
  useEffect(() => {
    if (isActive && loadState.status === 'idle') {
      load();
    }
  }, [isActive, loadState.status, load]);

  // ── All useMemo hooks must run before any conditional returns ────────────────

  // Bookmark indicator: does this page have any bookmarks?
  const pageHasBookmarks = useMemo(
    () => bookmarks.some((b) => b.pageNumber === pageNumber),
    [bookmarks, pageNumber],
  );

  // Bookmarked verse keys on this page — always highlighted
  const pageBookmarkVerseKeys = useMemo(
    () => bookmarks
      .filter((b) => b.pageNumber === pageNumber && b.verseKey)
      .map((b) => b.verseKey as string),
    [bookmarks, pageNumber],
  );

  // ── Slot layout arithmetic — must exactly mirror MushafRenderer ──────────────
  //
  // MushafRenderer distinguishes full pages (divisor 15.5) from short pages
  // (divisor 15.0 + verticalShift to centre content). If we use the wrong
  // formula here the touch zones are misaligned with the rendered glyphs.
  //
  // padVHeight: in portrait canvas === viewport so height works. In landscape scroll
  // mode the canvas is taller than the viewport — use viewportHeight so padV stays
  // proportional to what the user can see, not to the full scrollable canvas.
  const slotLayout = useMemo(() => {
    if (loadState.status !== 'ready') return null;
    const padVHeight = viewportHeight ?? height;
    const padV    = Math.round(padVHeight * 0.075);
    const usableH = height - padV * 2;

    const contentSlots = loadState.page.slots.filter(
      (s) => s.kind === 'verse_line' || s.kind === 'surah_header' || s.kind === 'bismillah',
    );
    const isShortPage = contentSlots.length > 0 && contentSlots.length < TOTAL_SLOTS - 2;

    let slotH         = usableH / (isShortPage ? TOTAL_SLOTS : TOTAL_SLOTS + 0.5);
    let verticalShift = 0;

    if (isShortPage) {
      const slotNums = contentSlots.map((s) => s.slotNumber);
      const first    = Math.min(...slotNums);
      const last     = Math.max(...slotNums);
      verticalShift  = Math.round(height / 2 - padV - ((first + last) / 2) * slotH);
      const topSlotY = padV + first * slotH + verticalShift;
      if (topSlotY < padV) verticalShift -= topSlotY - padV;
    }

    // Last verse on this page — passed to each SlotZone for "Till sidans slut".
    const verseLineSlots = loadState.page.slots.filter((s) => s.kind === 'verse_line');
    const lastVerseLine  = verseLineSlots[verseLineSlots.length - 1];
    const pageLastVerseKey =
      lastVerseLine && lastVerseLine.kind === 'verse_line'
        ? lastVerseLine.line.verseKeys[lastVerseLine.line.verseKeys.length - 1]
        : '';

    return { padV, slotH, verticalShift, pageLastVerseKey };
  }, [loadState, height, viewportHeight]);


  // ── Early returns after all hooks ─────────────────────────────────────────────

  if (loadState.status === 'idle' || loadState.status === 'loading') {
    return (
      <View style={{ width, height, backgroundColor: T.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={T.accent} />
      </View>
    );
  }

  if (loadState.status === 'error') {
    return (
      <View style={[styles.center, { width, height, backgroundColor: T.bg }]}>
        <Text style={[styles.errorText, { color: T.accentRed }]}>
          {loadState.message}
        </Text>
        <Text
          style={[styles.retryText, { color: T.accent }]}
          onPress={load}
        >
          Försök igen
        </Text>
      </View>
    );
  }

  // Verse-by-verse mode: delegate entirely to QuranVerseView (after all hooks)
  if (settings.readingMode === 'verse') {
    return (
      <QuranVerseView
        pageNumber={pageNumber}
        width={width}
        height={height}
        isActive={isActive}
      />
    );
  }

  if (!slotLayout) return <View style={{ width, height, backgroundColor: T.bg }} />;

  const { padV, slotH, verticalShift, pageLastVerseKey } = slotLayout;

  // Highlight priority: confirmed long-press > active audio > touch
  const highlightKey = longPressedVerse?.verseKey ?? activeVerseKey ?? null;
  const pendingKey   = !highlightKey ? (pressedVerseKey ?? null) : null;
  const surahKey     = !highlightKey && !pendingKey && pressedSurahId !== null
    ? `SURAH_${pressedSurahId}`
    : null;

  // Per-page highlight filter: only pass a non-null key to MushafRenderer when
  // the verse/key actually belongs to THIS page. For the 4 adjacent pages that
  // are mounted but not visible, this keeps activeVerseKey as null→null across
  // audio ticks so MushafRenderer's custom memo comparator blocks their re-renders.
  const rawKey = highlightKey ?? pendingKey ?? surahKey;
  const pageHighlightKey = (() => {
    if (!rawKey) return null;
    const slots = loadState.page.slots;
    if (rawKey.startsWith('BSMLLH_')) {
      const id = parseInt(rawKey.slice(7), 10);
      return slots.some(s =>
        (s.kind === 'bismillah' && s.surahId === id) ||
        (s.kind === 'surah_header' && s.surah.id === id && s.bismillahEmbedded),
      ) ? rawKey : null;
    }
    if (rawKey.startsWith('SURAH_')) {
      const id = parseInt(rawKey.slice(6), 10);
      return slots.some(s => s.kind === 'surah_header' && s.surah.id === id) ? rawKey : null;
    }
    return slots.some(s =>
      s.kind === 'verse_line' && s.line.verseKeys.includes(rawKey),
    ) ? rawKey : null;
  })();

  return (
    <Animated.View style={{ width, height, opacity: fadeAnim }}>
      <MushafRenderer
        page={loadState.page}
        width={width}
        height={height}
        viewportHeight={viewportHeight}
        screenWidth={screenWidth}
        isDark={isDark}
        activeVerseKey={pageHighlightKey}
        khatmahMarkers={khatmahRange
          ? { startVerseKey: khatmahRange.startVerseKey, endVerseKey: khatmahRange.endVerseKey }
          : null}
        bookmarkVerseKeys={pageBookmarkVerseKeys.length > 0 ? pageBookmarkVerseKeys : null}
      />
      {/* Transparent long-press zones over each verse line / surah header */}
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {loadState.page.slots.map((slot) => {
          // The rendered text center for slot N is at padV + N*slotH (MushafRenderer
          // formula: centerY = padV + (i+1)*slotH where i = slotNumber-1).
          // Touch zones must be centred on that position, not anchored at the top
          // of the slot area — otherwise every touch on the visual text falls into
          // the NEXT slot's zone, selecting the verse below the intended one.
          const topY = padV + (slot.slotNumber - 0.5) * slotH + verticalShift;

          if (slot.kind === 'verse_line') {
            // Compute per-verse glyph counts for precise touch-position verse selection.
            // This is stable per slot — slot data never changes after page load.
            const glyphCounts = slot.line.verseKeys.map((vk) =>
              slot.line.words
                .filter((w) => w.verseKey === vk)
                .reduce((sum, w) => sum + w.glyph.length, 0),
            );
            return (
              <SlotZone
                key={slot.slotNumber}
                verseKeys={slot.line.verseKeys}
                glyphCounts={glyphCounts}
                topY={topY}
                slotH={slotH}
                lineWidth={width}
                pageLastVerseKey={pageLastVerseKey}
                setLongPressedVerse={setLongPressedVerse}
                setPressedVerseKey={setPressedVerseKeyCb}
                toggleChrome={toggleChrome}
              />
            );
          }

          if (slot.kind === 'surah_header') {
            return (
              <SurahHeaderZone
                key={slot.slotNumber}
                topY={topY}
                slotH={slotH}
                surahId={slot.surah.id}
                bismillahEmbedded={slot.bismillahEmbedded ?? false}
                pageLastVerseKey={pageLastVerseKey}
                onPress={openSurahSheet}
                setPressedSurahId={setPressedSurahIdCb}
                setLongPressedVerse={setLongPressedVerse}
                setPressedVerseKey={setPressedVerseKeyCb}
                toggleChrome={toggleChrome}
              />
            );
          }

          if (slot.kind === 'bismillah') {
            return (
              <BismillahZone
                key={slot.slotNumber}
                topY={topY}
                slotH={slotH}
                surahId={slot.surahId}
                pageLastVerseKey={pageLastVerseKey}
                setLongPressedVerse={setLongPressedVerse}
                setPressedVerseKey={setPressedVerseKeyCb}
                toggleChrome={toggleChrome}
              />
            );
          }

          return null;
        })}
      </View>


      {/* Bookmark ribbon — visible whenever this page has bookmarks */}
      {pageHasBookmarks && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            right: 18,
            alignItems: 'center',
          }}
        >
          <View style={{
            width: 22,
            height: 30,
            backgroundColor: T.accent,
            borderBottomLeftRadius: 5,
            borderBottomRightRadius: 5,
            alignItems: 'center',
            justifyContent: 'flex-end',
            paddingBottom: 4,
          }}>
            <SvgIcon
              name="bookmark-fill"
              size={12}
              color="#fff"
            />
          </View>
        </View>
      )}

      {/* Surah detail sheet — opened by long-pressing a surah name banner */}
      {selectedSurahId !== null && (
        <SurahDetailSheet
          surahId={selectedSurahId}
          onClose={() => setSelectedSurahId(null)}
        />
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    fontSize: 14,
    textAlign: 'center',
    marginHorizontal: 24,
  },
  retryText: {
    marginTop: 12,
    fontSize: 14,
    fontWeight: '600',
  },
});

export default memo(QuranPageView);
