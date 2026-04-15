/**
 * SurahDetailSheet.tsx
 *
 * Full-screen modal showing surah metadata (number, revelation, verse count)
 * and a scrollable verse list rendered with KFC V2 QCF fonts — identical to
 * QuranVerseView: Svg + SvgText + loadQCFPageFont(pageNumber).
 *
 * Performance model: ALL required QCF page fonts are pre-loaded by the parent
 * before the FlatList is shown. VerseRow has zero internal state — it calls
 * qcfPagePsName(pageNumber) synchronously. This prevents the per-row setState
 * cascade that previously caused VirtualizedList "slow to update" warnings.
 *
 * Opened by long-pressing a surah header (mushaf mode) or bismillah card
 * (verse-by-verse mode). Tapping a verse navigates to its Mushaf page.
 */

import React, {
  useEffect,
  useState,
  useCallback,
  useRef,
  memo,
} from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  useWindowDimensions,
  type ListRenderItemInfo,
} from 'react-native';
import Svg, { Text as SvgText } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import { useQuranContext } from '../../context/QuranContext';
import SvgIcon from '../SvgIcon';
import {
  fetchSurahMeta,
  fetchSurahVerseList,
  type SurahMeta,
  type SurahVerseEntry,
} from '../../services/mushafApi';
import {
  loadQCFPageFont,
  qcfPagePsName,
} from '../../services/mushafFontManager';

// ── Types ─────────────────────────────────────────────────────────────────────

type Props = {
  surahId: number;
  onClose: () => void;
};

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; meta: SurahMeta; verses: SurahVerseEntry[] }
  | { status: 'error'; message: string };

// ── Constants ─────────────────────────────────────────────────────────────────

const ROW_H = 60;

// ── VerseRow ──────────────────────────────────────────────────────────────────
//
// Stateless — all QCF fonts are pre-loaded by SurahDetailSheet before this
// component is ever rendered. fontFamily is computed synchronously from
// qcfPagePsName(pageNumber); no useEffect, no setState, no cascade re-renders.

type VerseRowProps = {
  item:           SurahVerseEntry;
  fontFamily:     string;   // qcfPagePsName(item.pageNumber) — guaranteed loaded
  arabicColor:    string;
  borderColor:    string;
  muted:          string;
  isDark:         boolean;
  arabicAreaW:    number;
  arabicFontSize: number;
  onPress:        (item: SurahVerseEntry) => void;
};

const VerseRow = memo(function VerseRow({
  item,
  fontFamily,
  arabicColor,
  borderColor,
  muted,
  isDark,
  arabicAreaW,
  arabicFontSize,
  onPress,
}: VerseRowProps) {
  const handlePress = useCallback(() => onPress(item), [item, onPress]);

  // SVG dimensions — same proportions used in QuranVerseView (1.9× line height).
  const arabicLineH = Math.round(arabicFontSize * 1.9);
  const svgH        = arabicLineH + 8;
  const baselineY   = Math.round(arabicLineH - arabicLineH * 0.15);

  return (
    <TouchableOpacity
      style={[styles.row, { borderBottomColor: borderColor }]}
      onPress={handlePress}
      activeOpacity={0.65}
    >
      {/* Left: navigation chevron */}
      <View style={styles.chevronSlot}>
        <SvgIcon name="chevron-left" size={13} color={muted} />
      </View>

      {/* Center: QCF Arabic text — same Svg/SvgText pattern as QuranVerseView */}
      <View style={styles.arabicContainer}>
        <Svg width={arabicAreaW} height={svgH} overflow="visible">
          <SvgText
            x={arabicAreaW}
            y={baselineY}
            fontFamily={fontFamily}
            fontSize={arabicFontSize}
            textAnchor="end"
            fill={arabicColor}
          >
            {item.firstLineGlyph}
          </SvgText>
        </Svg>
      </View>

      {/* Right: verse number pill */}
      <View style={[styles.versePill, {
        backgroundColor: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.07)',
      }]}>
        <Text style={[styles.versePillText, { color: muted }]}>
          {item.verseNumber}
        </Text>
      </View>
    </TouchableOpacity>
  );
});

// ── SurahDetailSheet ──────────────────────────────────────────────────────────

function SurahDetailSheet({ surahId, onClose }: Props) {
  const { theme: T, isDark } = useTheme();
  const { goToPage } = useQuranContext();
  const insets = useSafeAreaInsets();
  const { width: screenW, height: screenH } = useWindowDimensions();

  const mountedRef = useRef(true);
  const abortRef   = useRef<AbortController | null>(null);

  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoadState({ status: 'loading' });

    Promise.all([
      fetchSurahMeta(surahId, controller.signal),
      fetchSurahVerseList(surahId, controller.signal),
    ])
      .then(async ([meta, verses]) => {
        if (!mountedRef.current || controller.signal.aborted) return;

        // Pre-load every QCF page font required by this surah's verse list.
        // loadQCFPageFont deduplicates concurrent calls (one download per unique
        // page). Promise.allSettled ensures we proceed even if individual fonts
        // fail — those rows will render as empty glyphs (silent graceful degradation).
        const uniquePages = [...new Set(verses.map((v) => v.pageNumber).filter((p) => p > 0))];
        await Promise.allSettled(uniquePages.map((p) => loadQCFPageFont(p)));

        if (!mountedRef.current || controller.signal.aborted) return;
        setLoadState({ status: 'ready', meta, verses });
      })
      .catch((err) => {
        if (!mountedRef.current || controller.signal.aborted) return;
        setLoadState({
          status: 'error',
          message: err instanceof Error ? err.message : 'Kunde inte ladda sura',
        });
      });
  }, [surahId]);

  const handleVersePress = useCallback(
    (verse: SurahVerseEntry) => {
      goToPage(verse.pageNumber);
      onClose();
    },
    [goToPage, onClose],
  );

  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({
      length: ROW_H,
      offset: ROW_H * index,
      index,
    }),
    [],
  );

  const keyExtractor = useCallback((v: SurahVerseEntry) => v.verseKey, []);

  // ── Layout — Arabic area width + font size ─────────────────────────────
  //
  // arabicAreaW: row width minus chevron slot (20) + two gaps (10+10) +
  // verse pill (32) + horizontal padding (16+16).
  //
  // arabicFontSize: matches QuranVerseView's computeArabicFontSize formula —
  // derived from full-page slot height scaled to arabicAreaW/screenW ratio.
  const arabicAreaW    = screenW - 104; // 16+16+20+10+10+32
  const padV           = Math.round(screenH * 0.075);
  const slotH          = (screenH - padV * 2) / 15.5;
  const arabicFontSize = Math.round(slotH * 0.52 * (arabicAreaW / screenW));

  // Colors
  const sheetBg     = isDark ? '#1C1C1E' : '#F2F2F7';
  const cardBg      = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';
  const arabicColor = isDark ? '#FFFEF0' : '#1A1106';

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<SurahVerseEntry>) => (
      <VerseRow
        item={item}
        fontFamily={qcfPagePsName(item.pageNumber)}
        arabicColor={arabicColor}
        borderColor={T.border}
        muted={T.textMuted}
        isDark={isDark}
        arabicAreaW={arabicAreaW}
        arabicFontSize={arabicFontSize}
        onPress={handleVersePress}
      />
    ),
    [arabicColor, T.border, T.textMuted, isDark, arabicAreaW, arabicFontSize, handleVersePress],
  );

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.root, { backgroundColor: sheetBg, paddingTop: insets.top }]}>

        {/* ── Header ────────────────────────────────────────────────────── */}
        <View style={styles.header}>
          <View style={styles.headerSpacer} />
          <Text style={[styles.headerTitle, { color: T.text }]} numberOfLines={1}>
            {loadState.status === 'ready' ? loadState.meta.nameSimple : ''}
          </Text>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.7}>
            <SvgIcon name="close" size={14} color={T.textMuted} />
          </TouchableOpacity>
        </View>

        {/* ── Loading / font-prep (single spinner for both phases) ───────── */}
        {loadState.status === 'loading' && (
          <View style={styles.center}>
            <ActivityIndicator color={T.accent} />
          </View>
        )}

        {/* ── Error ──────────────────────────────────────────────────────── */}
        {loadState.status === 'error' && (
          <View style={styles.center}>
            <Text style={{ color: T.accentRed, fontSize: 14, textAlign: 'center', marginHorizontal: 24 }}>
              {loadState.message}
            </Text>
          </View>
        )}

        {/* ── Content — only shown after ALL fonts are pre-loaded ─────────── */}
        {loadState.status === 'ready' && (
          <>
            {/* Info cards row */}
            <View style={styles.infoRow}>
              <View style={[styles.infoCard, { backgroundColor: cardBg, borderColor: T.border }]}>
                <Text style={[styles.infoLabel, { color: T.textMuted }]}>NUMMER</Text>
                <Text style={[styles.infoValue, { color: T.text }]}>{loadState.meta.id}</Text>
              </View>
              <View style={[styles.infoCard, { backgroundColor: cardBg, borderColor: T.border }]}>
                <Text style={[styles.infoLabel, { color: T.textMuted }]}>UPPENBARELSE</Text>
                <Text style={[styles.infoValue, { color: T.text }]}>
                  {loadState.meta.revelationPlace === 'makkah' ? 'Meckansk' : 'Mediniansk'}
                </Text>
              </View>
              <View style={[styles.infoCard, { backgroundColor: cardBg, borderColor: T.border }]}>
                <Text style={[styles.infoLabel, { color: T.textMuted }]}>VERSRÄKNING</Text>
                <Text style={[styles.infoValue, { color: T.text }]}>{loadState.meta.versesCount}</Text>
              </View>
            </View>

            {/* Verses section header */}
            <Text style={[styles.sectionLabel, { color: T.textMuted }]}>VERSER</Text>

            {/* Verse list — renders once, all fonts already registered */}
            <FlatList
              data={loadState.verses}
              renderItem={renderItem}
              keyExtractor={keyExtractor}
              getItemLayout={getItemLayout}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
            />
          </>
        )}
      </View>
    </Modal>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  headerSpacer: {
    width: 36,
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(128,128,128,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Info cards
  infoRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 22,
  },
  infoCard: {
    flex: 1,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 14,
    paddingHorizontal: 6,
    alignItems: 'center',
    gap: 6,
  },
  infoLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.7,
    textAlign: 'center',
  },
  infoValue: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },

  // Section label
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1.0,
    paddingHorizontal: 20,
    marginBottom: 6,
  },

  // Verse rows
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: ROW_H,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  chevronSlot: {
    width: 20,
    alignItems: 'center',
  },
  arabicContainer: {
    flex: 1,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  versePill: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  versePillText: {
    fontSize: 12,
    fontWeight: '600',
  },
});

export default memo(SurahDetailSheet);
