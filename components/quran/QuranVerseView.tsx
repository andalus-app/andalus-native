/**
 * QuranVerseView.tsx
 *
 * Verse-by-verse reading mode for a single Mushaf page.
 * - Arabic: QCF V2 page font (same as reading mode) via react-native-svg SvgText
 * - Translation: proven getPageTranslations() service (Swedish by default)
 * - Scroll: nestedScrollEnabled for vertical scroll inside horizontal FlatList
 */

import React, {
  useEffect,
  useState,
  useRef,
  useCallback,
  memo,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Animated,
  TouchableOpacity,
  Pressable,
} from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import Svg, { Text as SvgText, G, Path, Defs, ClipPath, Rect, Line as SvgLine } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import { useQuranContext } from '../../context/QuranContext';
import {
  fetchComposedMushafPage,
  type MushafSlot,
  type SurahMeta,
} from '../../services/mushafApi';
import {
  loadQCFPageFont,
  qcfPagePsName,
  loadBismillahFont,
  BISMILLAH_GLYPH,
} from '../../services/mushafFontManager';
import { SURAH_NAME_DATA } from '../../assets/images/surahNameData';
import {
  KNUT_CLIPS,
  KNUT_GROUPS,
  KNUT_VIEW_W,
  KNUT_VIEW_H,
} from '../../assets/images/bannerKnutData';
import {
  getPageTranslations,
  getBismillahTranslation,
  type TranslatedVerse,
} from '../../services/quranTranslationService';
import { surahForPage, juzForPage } from '../../data/surahIndex';
import SurahDetailSheet from './SurahDetailSheet';
import * as Haptics from 'expo-haptics';

// ── Types ─────────────────────────────────────────────────────────────────────

type Props = {
  pageNumber: number;
  width: number;
  height: number;
  isActive: boolean;
};

/** One word-level QCF V2 glyph for word-flow rendering. */
type WordGlyph = {
  glyph:    string;
  isMarker: boolean; // true = end-of-verse ornament / pause / sajdah / rab / hizb
};

/** Render data for one verse, a standalone bismillah header, or a surah name banner. */
type VerseItem = {
  verseKey:      string;       // e.g. "2:5", "BSMLLH_{id}", or "SURAHHEADER_{id}"
  words:         WordGlyph[];  // individual word glyphs in position order; empty for non-verse items
  translation:   string | null;
  isBismillah:   boolean;      // true = render QCF_BSML ligature, no badge; translation shown if set
  isSurahHeader: boolean;      // true = render surah name calligraphy banner
  surahMeta?:    SurahMeta;    // present when isSurahHeader === true
};

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; items: VerseItem[]; psName: string; bsmPsName: string }
  | { status: 'error'; message: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Strip HTML tags and footnote markers from translation text. */
function cleanTranslation(text: string): string {
  return text
    .replace(/<sup[^>]*>.*?<\/sup>/gs, '')
    .replace(/<[^>]+>/g, '')
    .trim();
}

/**
 * Build VerseItem[] from page slots and translations.
 *
 * Words are collected per verse in position order — Mushaf line boundaries are
 * intentionally ignored here. The VerseCard renders them as a flex word-flow
 * (row-reverse + wrap) so the card width controls natural line breaks, exactly
 * like quran.com. The end-of-verse ornament appears last in the flow and always
 * wraps to where it fits — it can never overflow the card.
 *
 * surah_header slots → isSurahHeader:true item (calligraphy banner, same visual as reading mode).
 * Bismillah slots → isBismillah:true item (no words, rendered with BSML font).
 * ornament / unknown → ignored.
 */
function buildVerseItems(
  slots:         MushafSlot[],
  translations:  TranslatedVerse[],
  bismillahText: string | null = null,
): VerseItem[] {
  const translationMap = new Map<string, string>();
  for (const t of translations) translationMap.set(t.verseKey, t.text);

  const result: VerseItem[] = [];

  // word buffer keyed by verseKey — order maintained by verseOrder
  type WordBuf = { glyph: string; charTypeName: string; position: number };
  let verseOrder: string[] = [];
  const verseWordsMap = new Map<string, WordBuf[]>();

  function flushVerses() {
    for (const verseKey of verseOrder) {
      const words: WordGlyph[] = verseWordsMap.get(verseKey)!
        .sort((a, b) => a.position - b.position)
        .map((w) => ({ glyph: w.glyph, isMarker: w.charTypeName !== 'word' }));
      const rawTranslation = translationMap.get(verseKey) ?? null;
      result.push({
        verseKey,
        words,
        translation: rawTranslation !== null ? cleanTranslation(rawTranslation) : null,
        isBismillah: false,
        isSurahHeader: false,
      });
    }
    verseOrder = [];
    verseWordsMap.clear();
  }

  for (const slot of slots) {
    if (slot.kind === 'surah_header') {
      flushVerses();
      result.push({
        verseKey: `SURAHHEADER_${slot.surah.id}`,
        words: [],
        translation: null,
        isBismillah: false,
        isSurahHeader: true,
        surahMeta: slot.surah,
      });
      // When bismillah is embedded in the header slot (only 1 gap existed on
      // the Mushaf page), emit a separate bismillah item so verse-by-verse
      // mode still shows it between the banner and verse 1.
      if (slot.bismillahEmbedded) {
        result.push({
          verseKey: `BSMLLH_${slot.surah.id}`,
          words: [],
          translation: bismillahText,
          isBismillah: true,
          isSurahHeader: false,
        });
      }
    } else if (slot.kind === 'bismillah') {
      flushVerses();
      result.push({
        verseKey: `BSMLLH_${slot.surahId}`,
        words: [],
        translation: bismillahText,
        isBismillah: true,
        isSurahHeader: false,
      });
    } else if (slot.kind === 'verse_line') {
      for (const word of slot.line.words) {
        if (!verseWordsMap.has(word.verseKey)) {
          verseOrder.push(word.verseKey);
          verseWordsMap.set(word.verseKey, []);
        }
        verseWordsMap.get(word.verseKey)!.push({
          glyph:        word.glyph,
          charTypeName: word.charTypeName,
          position:     word.position,
        });
      }
    }
    // ornament / unknown → skip
  }

  flushVerses();
  return result;
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Compute Arabic font size for verse-by-verse word-flow mode.
 *
 * Unlike reading (Mushaf page) mode, words wrap naturally at card boundaries
 * so we are NOT constrained by a fixed Mushaf line width. The font can be
 * larger — words that don't fit on one visual line simply wrap to the next.
 *
 * Formula: ~4.2 % of screen height, clamped to [28, 36] pt.
 *   iPhone SE  (667 h) → 28 pt  (min)
 *   iPhone 14 Pro (844 h) → 35 pt
 *   iPhone 15 Plus (932 h) → 36 pt  (max)
 *   iPad (1180 h+) → 36 pt  (max)
 */
function computeArabicFontSize(height: number): number {
  return Math.max(20, Math.min(26, Math.round(height * 0.030)));
}

// ── SurahHeaderCard ───────────────────────────────────────────────────────────
//
// Renders the surah name calligraphy banner — identical visual language to
// reading mode (MushafRenderer.renderSurahHeaderSlot).
//
// Perf: SurahNamePaths is a separate memo component keyed on surahId + color
// only. When cardInnerW changes (orientation), the <G transform> updates but
// the <Path> elements inside do NOT re-render — react-native-svg does not
// re-serialize path data if the Path props are unchanged.

// Memoized path elements — only re-render when surahId or color changes.
type SurahNamePathsProps = {
  paths:    string[];
  fillRule: 'nonzero' | 'evenodd';
  fill:     string;
};

const SurahNamePaths = memo(function SurahNamePaths({ paths, fillRule, fill }: SurahNamePathsProps) {
  return (
    <>
      {paths.map((d, i) => (
        <Path key={i} d={d} fillRule={fillRule} fill={fill} />
      ))}
    </>
  );
});

type SurahHeaderCardProps = {
  surahMeta:        SurahMeta;
  cardInnerW:       number;
  isDark:           boolean;
  verseKey:         string;
  verseYMapRef:     React.MutableRefObject<Record<string, number>>;
  // Stable ref — updated every QuranVerseView render, never causes SurahHeaderCard re-render.
  // Called from onLayout so we can scroll immediately on first mount without polling.
  surahScrollCbRef: React.MutableRefObject<((surahId: number, y: number) => void) | null>;
  onLongPress:      (surahId: number) => void;
};

// Height of the calligraphy SVG canvas inside the banner
const HEADER_SVG_H = 72;

// ── KnutBannerSvg ─────────────────────────────────────────────────────────────
// Isolated memo component for the knut ornament — 60 ClipPaths + 178 groups.
// Keyed on svgW + color so it only re-renders on actual dimension/theme changes,
// not on every SurahHeaderCard prop update.

type KnutBannerSvgProps = { svgW: number; color: string };

const KnutBannerSvg = memo(function KnutBannerSvg({ svgW, color }: KnutBannerSvgProps) {
  const bs = Math.min(svgW / KNUT_VIEW_W, HEADER_SVG_H / KNUT_VIEW_H);
  const bX = (svgW - KNUT_VIEW_W * bs) / 2;
  const bY = (HEADER_SVG_H - KNUT_VIEW_H * bs) / 2;
  const bannerTransform = `translate(${bX.toFixed(2)},${bY.toFixed(2)}) scale(${bs.toFixed(8)})`;

  return (
    <Svg width={svgW} height={HEADER_SVG_H} style={StyleSheet.absoluteFill}>
      <Defs>
        {KNUT_CLIPS.map((cp) => (
          <ClipPath key={cp.id} id={`knut-vv-${cp.id}`}>
            {cp.kind === 'path'
              ? <Path d={cp.d} />
              : <Rect x={cp.x} y={cp.y} width={cp.w} height={cp.h} />}
          </ClipPath>
        ))}
      </Defs>
      <G transform={bannerTransform}>
        {KNUT_GROUPS.map((g, gi) => {
          const clipProp = g.clip ? { clipPath: `url(#knut-vv-${g.clip})` } : {};
          return (
            <G key={gi} {...clipProp}>
              {g.children.map((c, ci) => {
                if (c.tag === 'path') return <Path key={ci} d={c.d} fill={color} fillOpacity={0.16} stroke={color} strokeOpacity={0.16} strokeWidth={0.12} />;
                if (c.tag === 'line') return <SvgLine key={ci} x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2} stroke={color} strokeOpacity={0.16} strokeWidth={0.12} strokeLinecap="round" strokeLinejoin="round" />;
                if (c.tag === 'rect') { const rProps = c.transform ? { transform: c.transform } : {}; return <Rect key={ci} x={parseFloat(c.x)} y={parseFloat(c.y)} width={parseFloat(c.w)} height={parseFloat(c.h)} fill={color} fillOpacity={0.16} {...rProps} />; }
                return null;
              })}
            </G>
          );
        })}
      </G>
    </Svg>
  );
});

const SurahHeaderCard = memo(function SurahHeaderCard({
  surahMeta,
  cardInnerW,
  isDark,
  verseKey,
  verseYMapRef,
  surahScrollCbRef,
  onLongPress,
}: SurahHeaderCardProps) {
  // Stable long-press handler — fires haptics then delegates to parent.
  // onLongPress is stable (useCallback), surahMeta.id never changes for this
  // card instance, so this useCallback never recreates.
  const onLongPressRef = useRef(onLongPress);
  onLongPressRef.current = onLongPress;
  const surahId = surahMeta.id;
  const stableOnLongPress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    onLongPressRef.current(surahId);
  }, [surahId]); // eslint-disable-line react-hooks/exhaustive-deps
  const { theme: T } = useTheme();

  const nameColor  = isDark ? '#FFFEF0' : '#1A1106';
  const bannerColor = nameColor;
  const metaColor  = isDark ? 'rgba(255,255,255,0.42)' : 'rgba(0,0,0,0.32)';
  const revelationLabel = surahMeta.revelationPlace === 'makkah' ? 'Meckansk' : 'Medinesisk';

  const entry = SURAH_NAME_DATA[surahMeta.id];

  // SVG canvas: surahHeaderCard has no padding (unlike VerseCard which has 14px each side).
  // cardInnerW subtracts 14*2=28px for VerseCard's padding — add it back, then subtract
  // only the banner's own margin (8*2=16px) to get the correct SVG coordinate width.
  // Without this the banner SVG is 28px narrower than its container, shifting the
  // ornament ~14px to the left of center.
  const svgW = Math.max(cardInnerW + 12, 1); // cardInnerW + 28 (card pad) - 16 (banner margin)

  // Scale calligraphy to fit — same formula as MushafRenderer.renderSurahHeaderSlot:
  // fill 65% of canvas height (or entry.heightFill override), cap at 80% of width.
  let transform: string | undefined;
  if (entry) {
    const hFill = entry.heightFill ?? 0.65;
    const s = Math.min(
      (HEADER_SVG_H * hFill) / entry.h,
      (svgW * 0.80) / entry.w,
    ) * 0.583;
    const tx = svgW / 2 - entry.cx * s;
    const ty = HEADER_SVG_H / 2 - entry.cy * s;
    transform = `translate(${tx.toFixed(2)}, ${ty.toFixed(2)}) scale(${s.toFixed(6)})`;
  }

  return (
    <TouchableOpacity
      activeOpacity={1}
      delayLongPress={1000}
      onLongPress={stableOnLongPress}
      onLayout={(e) => {
        const y = e.nativeEvent.layout.y;
        verseYMapRef.current[verseKey] = y;
        surahScrollCbRef.current?.(surahMeta.id, y);
      }}
      style={[styles.surahHeaderCard, { borderColor: T.border }]}
    >
      {/* Calligraphy banner — knut ornament (memoized) + surah name SVG on top */}
      <View style={[styles.surahHeaderBanner, { height: HEADER_SVG_H }]}>
        <KnutBannerSvg svgW={svgW} color={bannerColor} />
        <Svg width={svgW} height={HEADER_SVG_H} style={StyleSheet.absoluteFill}>
          {entry && transform && (
            <G transform={transform}>
              <SurahNamePaths
                paths={entry.paths}
                fillRule={entry.fillRule ?? 'nonzero'}
                fill={nameColor}
              />
            </G>
          )}
        </Svg>
      </View>

      {/* Surah info row */}
      <View style={styles.surahHeaderMeta}>
        <Text style={[styles.surahHeaderMetaText, { color: metaColor }]}>
          {surahMeta.nameSimple}
        </Text>
        <Text style={[styles.surahHeaderMetaText, { color: metaColor }]}>
          {`${surahMeta.versesCount} Ayah · ${revelationLabel}`}
        </Text>
      </View>
    </TouchableOpacity>
  );
});

// ── VerseCard ─────────────────────────────────────────────────────────────────
//
// Each card owns its Animated.Value so only the entering and leaving cards
// re-render on verse change — all other cards are fully memoized.
// Opacity runs on the native driver (zero JS-thread work during playback).

type VerseCardProps = {
  item: VerseItem;
  isHighlighted: boolean;
  // Khatmah day marker: 'start' = green overlay, 'end' = orange overlay, null = none.
  khatmahMarkerType: 'start' | 'end' | null;
  psName: string;
  bsmPsName: string;
  cardInnerW: number;
  arabicFontSize: number;
  arabicLineH: number;
  arabicColor: string;
  translationFontSize: number;
  translationLineH: number;
  hasTranslation: boolean;
  isDark: boolean;
  // Stable ref: same object across all parent re-renders → memo never sees
  // a new reference → no spurious re-renders from this prop.
  verseYMapRef: React.MutableRefObject<Record<string, number>>;
  // Called with this card's verseKey on long press (≥1 s hold).
  onLongPress: (verseKey: string) => void;
  // Called on short tap — forwards to chrome toggle (same as outer Pressable in QuranPager).
  onPress: () => void;
  // Flash: true when this card was just scrolled to from a deep-link.
  // Triggers a 2-cycle pulse animation then calls onFlashDone.
  shouldFlash: boolean;
  onFlashDone: () => void;
};

const VerseCard = memo(function VerseCard({
  item,
  isHighlighted,
  khatmahMarkerType,
  psName,
  bsmPsName,
  cardInnerW,
  arabicFontSize,
  arabicLineH,
  arabicColor,
  translationFontSize,
  translationLineH,
  hasTranslation,
  isDark,
  verseYMapRef,
  onLongPress,
  onPress,
  shouldFlash,
  onFlashDone,
}: VerseCardProps) {
  const { theme: T } = useTheme();

  // Native-driver opacity — no JS thread work during recitation.
  const highlightAnim = useRef(new Animated.Value(isHighlighted ? 1 : 0)).current;
  const animRef = useRef<Animated.CompositeAnimation | null>(null);
  // Stable refs so flash/longpress callbacks never become memo deps.
  const onFlashDoneRef = useRef(onFlashDone);
  onFlashDoneRef.current = onFlashDone;
  const onLongPressRef = useRef(onLongPress);
  onLongPressRef.current = onLongPress;
  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;
  const verseKeyRef = useRef(item.verseKey);
  verseKeyRef.current = item.verseKey;
  // Guard: skip the first-mount animation — Animated.Value is already initialised
  // to the correct value (isHighlighted ? 1 : 0), so running a 0→0 or 1→1
  // Animated.timing on mount needlessly creates native animation nodes across all
  // ~45 VerseCards in the 3-page window, without any visible effect. Skipping it
  // reduces native-thread work on every page visit.
  const didMountRef = useRef(false);

  const shouldShow = isHighlighted;

  useEffect(() => {
    // Cleanup: always stop the running animation when deps change or on unmount.
    // Without this, swipe-away while a flash/highlight animation is in progress
    // leaves orphaned native animation nodes alive on the UI thread. Over many
    // page swipes these accumulate and slow the entire native animation system.
    const cleanup = () => {
      animRef.current?.stop();
      animRef.current = null;
    };

    if (!didMountRef.current) {
      // First render: value already at the correct initial state — no animation needed.
      didMountRef.current = true;
      return cleanup;
    }

    animRef.current?.stop();
    if (shouldFlash) {
      // 2-cycle pulse: fade in → dim → in → dim → in (settle highlighted).
      // toValue 0.12 keeps the card barely visible between flashes.
      animRef.current = Animated.sequence([
        Animated.timing(highlightAnim, { toValue: 1,    duration: 280, useNativeDriver: true }),
        Animated.timing(highlightAnim, { toValue: 0.12, duration: 200, useNativeDriver: true }),
        Animated.timing(highlightAnim, { toValue: 1,    duration: 280, useNativeDriver: true }),
        Animated.timing(highlightAnim, { toValue: 0.12, duration: 200, useNativeDriver: true }),
        Animated.timing(highlightAnim, { toValue: 1,    duration: 280, useNativeDriver: true }),
      ]);
      animRef.current.start(({ finished }) => {
        if (finished) onFlashDoneRef.current();
      });
    } else {
      animRef.current = Animated.timing(highlightAnim, {
        toValue: shouldShow ? 1 : 0,
        duration: 180,
        useNativeDriver: true,
      });
      animRef.current.start();
    }
    return cleanup;
    // highlightAnim is a stable ref — safe to omit from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldShow, shouldFlash]);

  // Stable handlers — created once, read latest values through refs.
  // Using RN Pressable instead of RNGH GestureDetector because:
  // - Per-card GestureDetectors (20-30 per page × 3 pages = 60-90 total) add
  //   significant overhead to the native gesture recognizer chain during scroll
  //   and block the JS thread for ~10s on unmount as all 60+ deregister at once.
  // - onPress forwards short taps to toggleChrome (same effect as the outer
  //   Pressable in QuranPager), so chrome toggling works identically.
  // - onLongPress fires after 1000ms, then haptics + action menu open.
  const stableHandlePress = useRef(() => { onPressRef.current(); }).current;
  const stableHandleLongPress = useRef(() => {
    onLongPressRef.current(verseKeyRef.current);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  }).current;

  // Both modes: fully transparent card bg so only the highlight slab is visible.
  // Non-highlighted → invisible card (no border, no shadow).
  // Highlighted → charcoal (dark) or warm sand (light) slab fades in.
  const cardBorder = shouldShow
    ? (isDark ? 'transparent' : 'rgba(175,145,90,0.45)')
    : 'transparent';
  const highlightBg = isDark
    ? 'rgba(62,62,65,0.96)'     // charcoal — matches Ayah dark
    : 'rgba(175,145,90,0.20)';  // warm sand — matches Ayah light

  // Khatmah day marker — soft glow/halo effect.
  // Minimal background opacity so iOS shadow renders; shadow provides the visible halo.
  const khatmahGlowStyle = khatmahMarkerType === 'start'
    ? {
        backgroundColor: isDark ? 'rgba(36,180,130,0.07)' : 'rgba(36,100,93,0.05)',
        shadowColor:     '#668468',
        shadowOffset:    { width: 0, height: 0 } as const,
        shadowRadius:    14,
        shadowOpacity:   0.38,
      }
    : khatmahMarkerType === 'end'
    ? {
        backgroundColor: isDark ? 'rgba(255,149,0,0.09)' : 'rgba(232,144,10,0.06)',
        shadowColor:     '#E8900A',
        shadowOffset:    { width: 0, height: 0 } as const,
        shadowRadius:    14,
        shadowOpacity:   0.38,
      }
    : null;

  if (item.isBismillah) {
    // Bismillah header: QCF_BSML font, centered, no badge.
    // Translation is shown below when hasTranslation is true.
    const bsmSvgH = arabicLineH + 8;
    return (
      <Pressable
        onPress={stableHandlePress}
        onLongPress={stableHandleLongPress}
        delayLongPress={1000}
        onLayout={(e) => { verseYMapRef.current[item.verseKey] = e.nativeEvent.layout.y; }}
      >
        <Animated.View
          style={[styles.card, { backgroundColor: 'transparent', borderColor: cardBorder, borderWidth: isDark ? 0 : 0.5, shadowOpacity: 0 }]}
        >
          {/* Khatmah day marker — soft glow overlay, not animated */}
          {khatmahGlowStyle !== null && (
            <View
              style={[StyleSheet.absoluteFill, styles.highlightOverlay, khatmahGlowStyle]}
              pointerEvents="none"
            />
          )}
          <Animated.View
            style={[StyleSheet.absoluteFill, styles.highlightOverlay, { backgroundColor: highlightBg, opacity: highlightAnim }]}
            pointerEvents="none"
          />
          <Svg width={cardInnerW} height={bsmSvgH} overflow="visible">
            <SvgText
              x={cardInnerW / 2}
              y={Math.round(bsmSvgH * 0.72)}
              fontFamily={bsmPsName}
              fontSize={arabicFontSize}
              textAnchor="middle"
              fill={arabicColor}
            >
              {BISMILLAH_GLYPH}
            </SvgText>
          </Svg>
          {hasTranslation && item.translation !== null && item.translation.length > 0 && (
            <>
              <View style={[styles.divider, { backgroundColor: T.border }]} />
              <Text style={[styles.translation, { color: arabicColor, fontSize: translationFontSize, lineHeight: translationLineH }]}>
                {item.translation}
              </Text>
            </>
          )}
        </Animated.View>
      </Pressable>
    );
  }

  // Word-flow line height — extra room for Arabic diacritics above/below baseline
  const wordLineH = Math.round(arabicFontSize * 2.2);

  return (
    <Pressable
      onPress={stableHandlePress}
      onLongPress={stableHandleLongPress}
      delayLongPress={1000}
      onLayout={(e) => { verseYMapRef.current[item.verseKey] = e.nativeEvent.layout.y; }}
    >
      <Animated.View
        style={[
          styles.card,
          {
            backgroundColor: 'transparent',
            borderColor: cardBorder,
            borderWidth: isDark ? 0 : 0.5,
            shadowOpacity: 0,
          },
        ]}
      >
        {/* Khatmah day marker — soft glow overlay, not animated, below highlight */}
        {khatmahGlowStyle !== null && (
          <View
            style={[StyleSheet.absoluteFill, styles.highlightOverlay, khatmahGlowStyle]}
            pointerEvents="none"
          />
        )}

        {/* Highlight slab — native opacity fade, sits behind text */}
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            styles.highlightOverlay,
            { backgroundColor: highlightBg, opacity: highlightAnim },
          ]}
          pointerEvents="none"
        />

        {/* Verse key badge */}
        <View style={[
          styles.badge,
          { backgroundColor: isDark ? 'rgba(255,254,240,0.08)' : 'rgba(26,17,6,0.07)' },
        ]}>
          <Text style={[styles.badgeText, { color: arabicColor }]}>
            {item.verseKey}
          </Text>
        </View>

        {/* Arabic text — word-flow rendering (quran.com style).
            flexDirection:"row-reverse" + flexWrap:"wrap" gives natural RTL
            word wrapping: word[0] anchors to the far right, subsequent words
            fill leftward; when a row is full the next word wraps to the next
            row starting from the right again.
            The end-of-verse ornament (isMarker) is just another word in the
            flow — it sits naturally at the left end of the last row and can
            never overflow the card boundary. */}
        <View style={styles.arabicFlow}>
          {item.words.map((w, i) => (
            <Text
              key={i}
              style={{
                fontFamily: psName,
                fontSize:   arabicFontSize,
                lineHeight: wordLineH,
                color:      arabicColor,
                marginLeft: 2,   // inter-word gap (left = gap toward next RTL word)
              }}
            >
              {w.glyph}
            </Text>
          ))}
        </View>

        {/* Translation */}
        {hasTranslation && item.translation !== null && item.translation.length > 0 && (
          <>
            <View style={[styles.divider, { backgroundColor: T.border }]} />
            <Text style={[styles.translation, { color: arabicColor, fontSize: translationFontSize, lineHeight: translationLineH }]}>
              {item.translation}
            </Text>
          </>
        )}
      </Animated.View>
    </Pressable>
  );
});

// ── QuranVerseView ────────────────────────────────────────────────────────────

function QuranVerseView({ pageNumber, width, height, isActive }: Props) {
  const { theme: T, isDark } = useTheme();
  const {
    activeVerseKey, settings, longPressedVerse, setLongPressedVerse,
    pendingSurahScroll, clearPendingSurahScroll,
    pendingVerseHighlight, clearPendingVerseHighlight,
    khatmahRange, toggleChrome,
  } = useQuranContext();
  const insets = useSafeAreaInsets();

  const [selectedSurahId, setSelectedSurahId] = useState<number | null>(null);

  // Stable callbacks — created once, never change reference.
  // This ensures VerseCard and SurahHeaderCard memo() works correctly: only the
  // two cards whose isHighlighted/khatmahMarkerType changed re-render on
  // activeVerseKey updates, not all 20+ cards simultaneously.

  // pageLastVerseKey is computed at render time (from items, available later).
  // Use a ref so handleVerseLongPress always reads the current value without
  // being recreated whenever it changes.
  const pageLastVerseKeyRef = useRef('');

  const handleVerseLongPress = useCallback((verseKey: string) => {
    setLongPressedVerse({ verseKey, pageLastVerseKey: pageLastVerseKeyRef.current });
  }, [setLongPressedVerse]);

  const handleSurahLongPress = useCallback((surahId: number) => {
    setSelectedSurahId(surahId);
  }, []);

  // Clock — updates every minute (matches reading mode)
  const [time, setTime] = useState(() => formatTime(new Date()));
  useEffect(() => {
    const id = setInterval(() => setTime(formatTime(new Date())), 60_000);
    return () => clearInterval(id);
  }, []);

  const surahName = surahForPage(pageNumber).nameSimple;
  const juzId     = juzForPage(pageNumber).id;
  const metaColor = isDark ? 'rgba(255,255,255,0.42)' : 'rgba(0,0,0,0.32)';

  const [loadState, setLoadState] = useState<LoadState>({ status: 'idle' });
  const scrollRef       = useRef<ScrollView>(null);
  const verseYMap       = useRef<Record<string, number>>({});
  const mountedRef      = useRef(true);
  const abortRef        = useRef<AbortController | null>(null);
  // Scroll-position preservation across orientation changes
  const scrollYRef      = useRef(0);
  const restoreVerseRef = useRef<string | null>(null);
  const prevWidthRef    = useRef(width);
  const restoreTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const surahScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimerRef       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [flashingVerseKey, setFlashingVerseKey] = useState<string | null>(null);
  const clearFlashingVerse = useCallback(() => setFlashingVerseKey(null), []);
  // How many px to subtract from a verse's layout-Y when scrolling to it, so it
  // lands just below the floating meta bar overlay. Updated every render so it
  // always reflects the current orientation's insets.top.
  const scrollOffsetRef = useRef(80);
  scrollOffsetRef.current = Math.max(56, insets.top + 48) - 8;
  // Stable ref updated every render — lets SurahHeaderCard.onLayout fire the
  // scroll directly without polling. Captures current pendingSurahScroll so
  // the correct page instance handles it regardless of memo boundaries.
  const surahScrollCbRef = useRef<((surahId: number, y: number) => void) | null>(null);

  // Meta bar opacity — driven directly from scroll position via setValue() so
  // no setState / re-render occurs on every scroll event.
  // Fades from 1 (scrollY = 0) to 0 (scrollY ≥ META_FADE_END).
  const META_FADE_END   = 52; // px of scroll travel to reach full opacity=0
  const metaOpacityAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      if (restoreTimerRef.current) clearTimeout(restoreTimerRef.current);
      if (surahScrollTimerRef.current) clearTimeout(surahScrollTimerRef.current);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, []);

  // Track current scroll position so we can restore it after rotation.
  // Also drives meta bar opacity: visible at top, hidden once scrolled past META_FADE_END.
  // setValue() is a direct native-thread update — no setState, no re-render.
  const handleScroll = useCallback(
    (e: { nativeEvent: { contentOffset: { y: number } } }) => {
      const y = e.nativeEvent.contentOffset.y;
      scrollYRef.current = y;
      metaOpacityAnim.setValue(Math.max(0, 1 - y / META_FADE_END));
    },
    [metaOpacityAnim],
  );

  // On width change (rotation): capture the topmost visible verse, then after
  // layout settles (all onLayout callbacks have fired with new positions),
  // scroll back to that verse without animation so the user never sees a jump.
  useEffect(() => {
    if (prevWidthRef.current === width) return;
    prevWidthRef.current = width;

    // Find the verse with the largest layout-Y that is still at or above the
    // current viewport top (scrollY + 120 px headroom covers the meta overlay).
    const currentY = scrollYRef.current;
    let bestKey: string | null = null;
    let bestY = -Infinity;
    for (const [key, y] of Object.entries(verseYMap.current)) {
      if (y <= currentY + 120 && y > bestY) {
        bestY = y;
        bestKey = key;
      }
    }
    // Fallback: pick the verse whose Y is closest to currentY (handles edge cases
    // where the user has scrolled past all verses in the map).
    if (!bestKey) {
      let bestDist = Infinity;
      for (const [key, y] of Object.entries(verseYMap.current)) {
        const dist = Math.abs(y - currentY);
        if (dist < bestDist) { bestDist = dist; bestKey = key; }
      }
    }
    restoreVerseRef.current = bestKey;
    // Clear stale Y positions — they will be repopulated by onLayout after re-render.
    verseYMap.current = {};

    if (restoreTimerRef.current) clearTimeout(restoreTimerRef.current);
    // 600ms gives the banner SVG (expensive render) time to finish layout.
    restoreTimerRef.current = setTimeout(() => {
      restoreTimerRef.current = null;
      const targetKey = restoreVerseRef.current;
      if (!targetKey || !scrollRef.current) return;
      const newY = verseYMap.current[targetKey];
      if (newY !== undefined) {
        scrollRef.current.scrollTo({ y: Math.max(0, newY - scrollOffsetRef.current), animated: false });
      }
      restoreVerseRef.current = null;
    }, 600);
  }, [width]);


  // Re-create `load` when page or translation ID changes.
  // If we already have ready content, keep it visible while fetching the new page
  // (all sources are in-memory cached so this resolves in the same JS frame).
  // Only show the spinner when there is truly no content to show yet.
  const load = useCallback(async () => {
    if (!mountedRef.current) return;
    setLoadState(prev => prev.status === 'ready' ? prev : { status: 'loading' });

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const translationId = settings.translationId; // null = translation off

      // Parallel: page data, page font, bismillah font, translations, bismillah text
      const [page, psName, bsmPsName, translations, bismillahText] = await Promise.all([
        fetchComposedMushafPage(pageNumber),
        loadQCFPageFont(pageNumber).then(() => qcfPagePsName(pageNumber)),
        loadBismillahFont(),
        translationId !== null
          ? getPageTranslations(translationId, pageNumber, controller.signal)
          : Promise.resolve([]),
        translationId !== null
          ? getBismillahTranslation(translationId, controller.signal)
          : Promise.resolve(null),
      ]);

      if (!mountedRef.current || controller.signal.aborted) return;

      const items = buildVerseItems(page.slots, translations, bismillahText);
      setLoadState({ status: 'ready', items, psName, bsmPsName });
    } catch (err) {
      if (!mountedRef.current || controller.signal.aborted) return;
      setLoadState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Kunde inte ladda sidan',
      });
    }
  }, [pageNumber, settings.translationId]);

  // Trigger load when the page changes (load is recreated) or when this view
  // becomes active. Also reset meta bar opacity — new page always starts at top.
  // No idle reset: existing ready content stays visible until new content arrives,
  // eliminating the black-flash on cached page transitions.
  useEffect(() => {
    metaOpacityAnim.setValue(1);
    if (isActive) load();
  }, [isActive, load, metaOpacityAnim]);

  // Auto-scroll to the currently playing verse
  useEffect(() => {
    if (!activeVerseKey || !scrollRef.current) return;
    const y = verseYMap.current[activeVerseKey];
    if (y !== undefined) {
      scrollRef.current.scrollTo({ y: Math.max(0, y - scrollOffsetRef.current), animated: true });
    }
  }, [activeVerseKey]);

  // Scroll to the surah header when the user navigates via the contents menu.
  // pendingSurahScroll carries both the surahId and the target pageNumber.
  // The pageNumber guard ensures only the correct QuranVerseView instance acts;
  // pre-rendered sibling pages (wrong pageNumber) return early WITHOUT clearing
  // the state so the target page still receives it when it loads.
  useEffect(() => {
    if (!pendingSurahScroll || loadState.status !== 'ready' || !isActive) return;
    if (pendingSurahScroll.pageNumber !== pageNumber) return;
    const surahId = pendingSurahScroll.surahId;
    // Do NOT clear here — clear only after a successful scroll or giving up.
    // Clearing early would prevent the onLayout direct path from matching.
    if (surahScrollTimerRef.current) clearTimeout(surahScrollTimerRef.current);
    // Fallback retry loop: handles the case where SurahHeaderCard is already
    // mounted (pre-rendered by FlatList) so onLayout won't fire again.
    // Retry up to 10 times (every 60ms = up to 600ms total).
    const key = `SURAHHEADER_${surahId}`;
    let attempts = 0;
    const tryScroll = () => {
      surahScrollTimerRef.current = null;
      if (!mountedRef.current || !scrollRef.current) return;
      const y = verseYMap.current[key];
      if (y !== undefined) {
        // Offset -80 so the header lands below the fixed meta-bar overlay,
        // matching the offset used by rotation-restore and auto-scroll code.
        clearPendingSurahScroll(); // clear AFTER finding the position
        scrollRef.current.scrollTo({ y: Math.max(0, y - scrollOffsetRef.current), animated: false });
      } else if (attempts < 10) {
        attempts++;
        surahScrollTimerRef.current = setTimeout(tryScroll, 60);
      } else {
        clearPendingSurahScroll(); // give up — avoid stale state
      }
    };
    surahScrollTimerRef.current = setTimeout(tryScroll, 60);
    // Cleanup: if the effect re-runs (e.g. pendingSurahScroll cleared by the
    // onLayout direct path), cancel the pending retry so it doesn't double-scroll.
    return () => {
      if (surahScrollTimerRef.current) {
        clearTimeout(surahScrollTimerRef.current);
        surahScrollTimerRef.current = null;
      }
    };
  // clearPendingSurahScroll is stable (useCallback + no deps)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSurahScroll, loadState.status, isActive]);

  // Scroll to and flash the deep-link verse (e.g. navigated from Asmaul Husna).
  // Mirrors the pendingSurahScroll retry pattern: retry up to 15 times (every 80ms)
  // to wait for onLayout to populate verseYMap, then scroll + trigger flash.
  useEffect(() => {
    if (!pendingVerseHighlight || loadState.status !== 'ready' || !isActive) return;
    if (pendingVerseHighlight.pageNumber !== pageNumber) return;
    const verseKey = pendingVerseHighlight.verseKey;
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    let attempts = 0;
    const tryScrollAndFlash = () => {
      flashTimerRef.current = null;
      if (!mountedRef.current || !scrollRef.current) return;
      const verseY = verseYMap.current[verseKey];
      if (verseY !== undefined) {
        clearPendingVerseHighlight();
        scrollRef.current.scrollTo({ y: Math.max(0, verseY - scrollOffsetRef.current), animated: true });
        setFlashingVerseKey(verseKey);
      } else if (attempts < 15) {
        attempts++;
        flashTimerRef.current = setTimeout(tryScrollAndFlash, 80);
      } else {
        clearPendingVerseHighlight(); // give up
      }
    };
    flashTimerRef.current = setTimeout(tryScrollAndFlash, 80);
    return () => {
      if (flashTimerRef.current) {
        clearTimeout(flashTimerRef.current);
        flashTimerRef.current = null;
      }
    };
  // clearPendingVerseHighlight is stable — safe to omit
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingVerseHighlight, loadState.status, isActive]);

  // Updated every render (not in useEffect) so SurahHeaderCard.onLayout always
  // has a fresh closure over pendingSurahScroll and pageNumber.
  // Refs are mutable — updating .current during render is safe and intentional.
  surahScrollCbRef.current = (surahId: number, y: number) => {
    if (
      !pendingSurahScroll ||
      pendingSurahScroll.surahId !== surahId ||
      pendingSurahScroll.pageNumber !== pageNumber
    ) return;
    clearPendingSurahScroll();
    scrollRef.current?.scrollTo({ y: Math.max(0, y - scrollOffsetRef.current), animated: false });
  };

  // ── Render states ──────────────────────────────────────────────────────────

  if (loadState.status === 'idle' || loadState.status === 'loading') {
    return (
      <View style={[styles.center, { width, height, backgroundColor: T.bg }]}>
        <ActivityIndicator color={T.accent} />
      </View>
    );
  }

  if (loadState.status === 'error') {
    return (
      <View style={[styles.center, { width, height, backgroundColor: T.bg }]}>
        <Text style={[styles.errorText, { color: T.accentRed }]}>
          {loadState.message}
        </Text>
        <Text style={[styles.retryText, { color: T.accent }]} onPress={load}>
          Försök igen
        </Text>
      </View>
    );
  }

  const { items, psName, bsmPsName } = loadState;
  const hasTranslation = settings.translationId !== null;
  // Portrait: cards are edge-to-edge (no list padding); card has its own 14px inner padding.
  // Landscape: list adds insets.left/right + 4 px so cards stay clear of the Dynamic Island.
  const isLandscape  = width > height;
  const listPadLeft  = isLandscape ? insets.left  + 4 : 0;
  const listPadRight = isLandscape ? insets.right + 4 : 0;
  // cardInnerW = available width minus list horizontal padding minus card's own padding (14 × 2)
  const cardInnerW   = width - listPadLeft - listPadRight - 14 * 2;
  const arabicColor    = isDark ? '#FFFEF0' : '#1A1106';
  // Word-flow font size — verse-by-verse only.
  // settings.fontScale scales Arabic text; reading mode is unaffected.
  const arabicFontSize = Math.round(computeArabicFontSize(height) * settings.fontScale);
  // arabicLineH is only used for the bismillah SVG (single centred glyph)
  const arabicLineH    = Math.round(arabicFontSize * 1.9);
  // Translation font size — verse-by-verse only. Reading mode is unaffected.
  const translationFontSize = Math.round(14 * settings.translationFontScale);
  const translationLineH    = Math.round(translationFontSize * 1.6);

  // Selection highlight: long-press takes priority so the user always sees their
  // selected verse highlighted while the action menu is open; fall back to active audio verse.
  const highlightKey = longPressedVerse?.verseKey ?? activeVerseKey ?? null;

  // Last regular verse on this page (for "Till sidans slut") — excludes bismillah + surah headers
  const lastRegularItem = [...items].reverse().find((i) => !i.isBismillah && !i.isSurahHeader);
  const pageLastVerseKey = lastRegularItem?.verseKey ?? '';
  // Keep ref in sync so handleVerseLongPress always uses the current value.
  pageLastVerseKeyRef.current = pageLastVerseKey;

  return (
    <>
    <View style={{ width, height }}>
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1, backgroundColor: T.bg }}
        contentContainerStyle={[
          styles.listContent,
          {
            // Dynamic top padding — scales with insets.top so the meta overlay
            // never overlaps the first item in either portrait or landscape.
            paddingTop: Math.max(56, insets.top + 48),
          },
          // Landscape only: inset cards so they never overlap the Dynamic Island
          // (side notch). Portrait is fully edge-to-edge — no horizontal padding.
          isLandscape && {
            paddingLeft:  listPadLeft,
            paddingRight: listPadRight,
          },
        ]}
        onScroll={handleScroll}
        scrollEventThrottle={32}
        showsVerticalScrollIndicator={false}
      >
      {items.map((item) => {
        // Surah name banner — rendered outside VerseCard so it has no gesture
        // detector and doesn't interfere with the highlight / long-press system.
        if (item.isSurahHeader && item.surahMeta) {
          return (
            <SurahHeaderCard
              key={item.verseKey}
              verseKey={item.verseKey}
              surahMeta={item.surahMeta}
              cardInnerW={cardInnerW}
              isDark={isDark}
              verseYMapRef={verseYMap}
              surahScrollCbRef={surahScrollCbRef}
              onLongPress={handleSurahLongPress}
            />
          );
        }

        const khatmahMarkerType =
          khatmahRange?.startVerseKey === item.verseKey ? 'start' :
          khatmahRange?.endVerseKey   === item.verseKey ? 'end'   : null;

        return (
          <VerseCard
            key={item.verseKey}
            item={item}
            isHighlighted={highlightKey === item.verseKey}
            khatmahMarkerType={khatmahMarkerType}
            psName={psName}
            bsmPsName={bsmPsName}
            cardInnerW={cardInnerW}
            arabicFontSize={arabicFontSize}
            arabicLineH={arabicLineH}
            arabicColor={arabicColor}
            translationFontSize={translationFontSize}
            translationLineH={translationLineH}
            hasTranslation={hasTranslation}
            isDark={isDark}
            verseYMapRef={verseYMap}
            shouldFlash={flashingVerseKey === item.verseKey}
            onFlashDone={clearFlashingVerse}
            onLongPress={handleVerseLongPress}
            onPress={toggleChrome}
          />
        );
      })}
      </ScrollView>

      {/* Top meta bar — surah name (left) | clock (center) | juz (right)
          Fixed overlay (position:absolute) — never scrolls with content.
          Opacity driven by scroll position: visible at top (scrollY=0),
          hidden once scrolled past META_FADE_END px. */}
      <Animated.View
        style={[styles.metaOverlay, { paddingTop: insets.top + 6, opacity: metaOpacityAnim }]}
        pointerEvents="none"
      >
        <View style={styles.metaTop}>
          <Text style={[styles.metaText, styles.metaSide, { color: metaColor }]} numberOfLines={1}>
            {surahName}
          </Text>
          <Text style={[styles.metaText, styles.metaCenter, { color: metaColor }]}>
            {time}
          </Text>
          <Text style={[styles.metaText, styles.metaSide, styles.metaSideRight, { color: metaColor }]} numberOfLines={1}>
            {`Juz ${juzId}`}
          </Text>
        </View>
      </Animated.View>
    </View>

    {/* Surah detail sheet — opened by holding the surah banner for 1 second */}
    {selectedSurahId !== null && (
      <SurahDetailSheet
        surahId={selectedSurahId}
        onClose={() => setSelectedSurahId(null)}
      />
    )}
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

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
  listContent: {
    paddingBottom: 180,
    // No horizontal padding — portrait goes full-width edge-to-edge.
    // Landscape padding is applied dynamically via contentContainerStyle override.
  },
  surahHeaderCard: {
    marginBottom: 6,
    borderRadius: 14,
    borderWidth: 0.5,
    overflow: 'hidden',
  },
  surahHeaderBanner: {
    margin: 8,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  surahHeaderMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  surahHeaderMetaText: {
    fontSize: 11,
    fontWeight: '500',
  },
  card: {
    borderRadius: 14,
    borderWidth: 0.5,
    padding: 14,
    marginBottom: 10,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
  },
  highlightOverlay: {
    borderRadius: 14,
  },
  arabicFlow: {
    flexDirection: 'row-reverse',
    flexWrap:      'wrap',
    alignItems:    'flex-start',
    marginBottom:  4,
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginBottom: 10,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 10,
  },
  translation: {
    // fontSize and lineHeight are injected as inline props from settings.translationFontScale
    fontWeight: '400',
  },
  metaOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingBottom: 6,
  },
  metaTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metaText: {
    fontSize: 12,
    fontWeight: '400',
    fontFamily: Platform.OS === 'ios' ? 'System' : undefined,
  },
  metaSide: {
    flex: 1,
  },
  metaSideRight: {
    textAlign: 'right',
  },
  metaCenter: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
  },
});

export default memo(QuranVerseView);
