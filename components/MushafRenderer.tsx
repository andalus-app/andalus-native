/**
 * MushafRenderer — deterministic native full-page Mushaf renderer
 *
 * ═══════════════════════════════════════════════════════════════
 * RENDERING MODEL
 * ═══════════════════════════════════════════════════════════════
 *
 * react-native-svg <Text> elements → on iOS: Core Text
 *   CTFontCreateWithName("QCFpNNN", fontSize, NULL)
 *   → cmap lookup for each QCF codepoint
 *   → CTLine advance-width measurement
 *   → CGContextShowGlyphsAtPositions
 *
 * No HTML. No layout engine. No browser. No approximation.
 * No System font anywhere in page content.
 *
 * ═══════════════════════════════════════════════════════════════
 * VERTICAL LAYOUT ARITHMETIC (deterministic)
 * ═══════════════════════════════════════════════════════════════
 *
 * Given: containerHeight H, totalSlots N (15), verticalPad P
 *
 *   usableH  = H - 2*P
 *   slotH    = usableH / (N + 1)
 *   slotY[i] = P + (i + 1) * slotH        where i is 0-based slot index
 *
 * Pure arithmetic. No font metrics, no layout engine, no reflow.
 * Same {H, N, P} → identical slot positions on every call and every device.
 *
 * ═══════════════════════════════════════════════════════════════
 * IMPLEMENTATION STATUS PER SLOT TYPE
 * ═══════════════════════════════════════════════════════════════
 *
 *   verse_line   ✓ IMPLEMENTED
 *                Font: QCF V2 page font ("QCFpNNN")
 *                Data: code_v2 glyphs from Quran Foundation API
 *
 *   surah_header ✓ IMPLEMENTED
 *                Font: surah_names.ttf — PostScript name "surah_names"
 *                      (see SURAH_NAME_PS_NAME in mushafFontManager.ts)
 *                Data: PUA codepoint from SURAH_NAME_CODEPOINTS table
 *                      (all 114 entries sourced from surah_names.svg)
 *                Note: If surah name glyphs appear blank on first test,
 *                      verify nameID 6 of surah_names.ttf in FontForge
 *                      and update SURAH_NAME_PS_NAME.
 *
 *   bismillah    ✓ IMPLEMENTED
 *                Font: QCF_BSML.TTF — PostScript name "QCF_BSML"
 *                      (confirmed: fontke.com + nuqayah/qpc-fonts)
 *                Data: U+FDFD — ARABIC LIGATURE BISMILLAH AR-RAHMAN AR-RAHEEM
 *
 *   ornament     ✓ IMPLEMENTED (pure SVG geometry)
 *                No font. Quran.com renders inter-surah dividers as CSS
 *                geometry, not font glyphs. SVG lines + polygon = correct.
 *                Verse-stream ornaments (end markers, sajdah etc.) are
 *                already in verse_line via code_v2 from the API.
 *
 *   unknown      → null (blank space — never fake content)
 *
 * ═══════════════════════════════════════════════════════════════
 * FONT LOADING STRATEGY
 * ═══════════════════════════════════════════════════════════════
 *
 * Three fonts may be needed per page:
 *   1. QCF page font  — always required (changes per page)
 *   2. Surah name font — required only if page has surah_header slot(s)
 *   3. Bismillah font  — required only if page has bismillah slot(s)
 *
 * All three are loaded in parallel. Fonts 2 and 3 are cached after first
 * load (Font.isLoaded → same session; DocumentDir → across restarts).
 *
 * See mushafFontManager.ts for the complete offline-first strategy.
 * NO FALLBACK: if any required font fails to load, an error is shown.
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, {
  Text as SvgText,
  Rect,
  Line as SvgLine,
  Polygon,
  G,
  Path,
  Defs,
  ClipPath,
} from 'react-native-svg';
import type { ComposedMushafPage, MushafSlot } from '../services/mushafApi';
import { surahForPage, juzForPage } from '../data/surahIndex';
import {
  loadQCFPageFont,
  qcfPagePsName,
  loadBismillahFont,
  isQCFPageFontLoaded,
  isBismillahFontLoaded,
  BISMILLAH_PS_NAME,
  BISMILLAH_GLYPH,
} from '../services/mushafFontManager';
import { SURAH_NAME_DATA } from '../assets/images/surahNameData';
import {
  KNUT_CLIPS,
  KNUT_GROUPS,
  KNUT_VIEW_W,
  KNUT_VIEW_H,
} from '../assets/images/bannerKnutData';

// ── Constants ─────────────────────────────────────────────────────────────────

const TOTAL_SLOTS = 15;

// ── Colour palette ────────────────────────────────────────────────────────────

const C = {
  dark: {
    pageBg:        '#000000',   // matches T.bg dark
    text:          '#FFFEF0',   // matches verse-by-verse arabicColor dark
    headerBg:      '#1C1C1E',   // matches T.card dark
    headerBorder:  '#3A3000',
    headerText:    '#FFFFFF',
    bismillahText: '#FFFEF0',
    ornamentLine:  '#2A2000',
  },
  light: {
    pageBg:        '#F2F2F7',   // matches T.bg light
    text:          '#1A1106',   // matches verse-by-verse arabicColor light
    headerBg:      '#FFFFFF',   // matches T.card light
    headerBorder:  '#C8A84B',
    headerText:    '#7B5900',
    bismillahText: '#7B5900',
    ornamentLine:  '#C8A84B',
  },
};

// ── Surah header banner (SVG overlay) ────────────────────────────────────────

/**
 * Renders the quran_banner3.svg in a positioned View overlay.
 *
 * Replaces the old rect+surah-name-glyph approach.
 * Dimensions match the previous banner box exactly (same padH, boxH formula)
 * so vertical spacing is unchanged.
 *
 * Dark mode : silver/metallic ornaments on #1C1C1E card background.
 * Light mode: same ornaments on #FFFFFF + subtle warm tint overlay to add
 *             golden warmth consistent with the app's #C8A84B border tone.
 */
// SurahHeaderBanner removed — surah headers are now rendered directly inside
// the main <Svg> canvas via renderSurahHeaderSlot, eliminating all z-ordering issues.

// ── Slot layout arithmetic ────────────────────────────────────────────────────

type SlotLayout = {
  centerY:    number;
  baselineY:  number;
  slotHeight: number;
};

/**
 * Compute the 15 slot positions for a given canvas height.
 *
 * padV = 7.5% of height — accounts for safe area inset only.
 * Chrome (header, player, page picker) overlays as a separate animated layer
 * so no extra clearance is needed here.
 *
 * On iPhone 15 Pro (852pt): padV ≈ 64pt ≈ safe_area_top(59) + 5pt.
 * On iPhone 14   (844pt): padV ≈ 63pt ≈ safe_area_top(47) + 16pt.
 * On iPhone SE   (667pt): padV ≈ 50pt ≈ safe_area_top(20) + 30pt.
 *
 * Full pages (15 content slots): divisor 15.5 — tight Mushaf packing.
 * Short pages (< 13 content slots, e.g. Al-Fatihah, Al-Baqarah p1):
 *   divisor 15.0 → slightly larger slotH for breathing room.
 *
 * verticalShift centres the actual content block on screen (height/2).
 */
function computeSlotLayouts(height: number, verticalShift = 0, shortPage = false, padVOverride?: number): SlotLayout[] {
  const padV    = padVOverride ?? Math.round(height * 0.075);
  const usableH = height - padV * 2;
  // Short pages get slightly looser line spacing; full pages stay packed.
  const slotH   = usableH / (shortPage ? TOTAL_SLOTS : TOTAL_SLOTS + 0.5);

  return Array.from({ length: TOTAL_SLOTS }, (_, i) => {
    const centerY   = Math.round(padV + (i + 1) * slotH + verticalShift);
    const baselineY = Math.round(centerY + slotH * 0.13);
    return { centerY, baselineY, slotHeight: slotH };
  });
}

// ── Slot renderers ────────────────────────────────────────────────────────────

function renderVerseLineSlot(
  slot:     Extract<MushafSlot, { kind: 'verse_line' }>,
  layout:   SlotLayout,
  width:    number,
  psName:   string,
  fontSize: number,
  palette:  typeof C.dark,
) {
  return (
    <SvgText
      key={`vl-${slot.slotNumber}`}
      x={Math.round(width / 2)}
      y={layout.baselineY}
      textAnchor="middle"
      fontFamily={psName}
      fontSize={fontSize}
      fill={palette.text}
    >
      {slot.line.lineGlyph}
    </SvgText>
  );
}

/**
 * surah_header — renders the decorative banner-quran.svg frame with the
 * calligraphy surah name centred inside it.
 *
 * UNIFORM contain scale: s = min(boxW/W, boxH/H).
 * quran-banner-knut.svg — viewBox 185.63×33.39 (~5.56:1), pure white ornament.
 * 60 clip-paths in Defs; 178 groups rendered inline.
 * All elements white; surah name drawn last (on top).
 */
function renderSurahHeaderSlot(
  slot:    Extract<MushafSlot, { kind: 'surah_header' }>,
  layout:  SlotLayout,
  width:   number,
  palette: typeof C.dark,
  isDark:  boolean,
  fontSize: number,
) {
  // ── Box dimensions ────────────────────────────────────────────────
  const padH  = Math.round(width * 0.06);
  const boxW  = width - padH * 2;
  const embed = slot.bismillahEmbedded;
  const boxH  = Math.round(layout.slotHeight * (embed ? 0.54 : 0.82));
  const boxY  = embed
    ? Math.round(layout.centerY - layout.slotHeight * 0.5 + layout.slotHeight * 0.02)
    : Math.round(layout.centerY - boxH / 2);

  // ── Contain scale ─────────────────────────────────────────────────
  const s       = Math.min(boxW / KNUT_VIEW_W, boxH / KNUT_VIEW_H) * 1.32;
  const renderW = KNUT_VIEW_W * s;
  const renderH = KNUT_VIEW_H * s;
  const bannerX = padH + (boxW - renderW) / 2;
  const bannerY = boxY + (boxH - renderH) / 2;
  const bannerTransform = `translate(${bannerX.toFixed(2)},${bannerY.toFixed(2)}) scale(${s.toFixed(8)})`;

  // Banner uses the same color as the Arabic font at reduced opacity for subtlety
  const bannerColor = palette.text;  // #FFFEF0 dark / #1A1106 light
  const bannerOpacity = 0.16;
  const nameColor = palette.text;

  // ── Surah name — centred in the inner rectangular frame (~42% w, 70% h) ─
  const entry = SURAH_NAME_DATA[slot.surah.id];
  let nameTransform: string | undefined;
  if (entry) {
    const innerW = renderW * 0.42;
    const innerH = renderH * 0.70;
    const hFill  = entry.heightFill ?? 0.65;
    const ns = Math.min(
      (innerH * hFill) / entry.h,
      (innerW * 0.88) / entry.w,
    ) * 1.08;
    const tx = bannerX + renderW / 2 - entry.cx * ns;
    const ty = bannerY + renderH / 2 - entry.cy * ns;
    nameTransform = `translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${ns.toFixed(6)})`;
  }

  const bsmllhY = embed
    ? Math.round(boxY + boxH + (layout.slotHeight * 0.40) * 0.65)
    : 0;

  return (
    <G key={`sh-${slot.slotNumber}`}>
      {/* ── Banner ornament (clip-paths in root Defs) ────────────────── */}
      <G transform={bannerTransform}>
        {KNUT_GROUPS.map((g, gi) => {
          const clipProp = g.clip ? { clipPath: `url(#knut-${g.clip})` } : {};
          return (
            <G key={gi} {...clipProp}>
              {g.children.map((c, ci) => {
                if (c.tag === 'path') {
                  return <Path key={ci} d={c.d} fill={bannerColor} fillOpacity={bannerOpacity} stroke={bannerColor} strokeOpacity={bannerOpacity} strokeWidth={0.12} />;
                }
                if (c.tag === 'line') {
                  return <SvgLine key={ci} x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2} stroke={bannerColor} strokeOpacity={bannerOpacity} strokeWidth={0.12} strokeLinecap="round" strokeLinejoin="round" />;
                }
                if (c.tag === 'rect') {
                  const rProps = c.transform ? { transform: c.transform } : {};
                  return <Rect key={ci} x={parseFloat(c.x)} y={parseFloat(c.y)} width={parseFloat(c.w)} height={parseFloat(c.h)} fill={bannerColor} fillOpacity={bannerOpacity} {...rProps} />;
                }
                return null;
              })}
            </G>
          );
        })}
      </G>

      {/* ── Surah name calligraphy — on top of banner ───────────────── */}
      {entry && nameTransform && (
        <G transform={nameTransform} fill={nameColor}>
          {entry.paths.map((d, i) => (
            <Path key={i} d={d} fillRule={entry.fillRule ?? 'nonzero'} />
          ))}
        </G>
      )}

      {/* ── Embedded bismillah (mid-page surah transitions only) ─────── */}
      {embed && (
        <SvgText
          x={Math.round(width / 2)}
          y={bsmllhY}
          textAnchor="middle"
          fontFamily={BISMILLAH_PS_NAME}
          fontSize={fontSize * 0.92}
          fill={palette.bismillahText}
        >
          {BISMILLAH_GLYPH}
        </SvgText>
      )}
    </G>
  );
}

/**
 * bismillah — renders the QCF bismillah ligature.
 *
 * Font: QCF_BSML.TTF (BISMILLAH_PS_NAME = "QCF_BSML")
 * Glyph: U+FDFD (BISMILLAH_GLYPH)
 */
function renderBismillahSlot(
  slot:     Extract<MushafSlot, { kind: 'bismillah' }>,
  layout:   SlotLayout,
  width:    number,
  fontSize: number,
  palette:  typeof C.dark,
) {
  return (
    <SvgText
      key={`bm-${slot.slotNumber}`}
      x={Math.round(width / 2)}
      y={layout.baselineY}
      textAnchor="middle"
      fontFamily={BISMILLAH_PS_NAME}
      fontSize={fontSize * 0.98}
      fill={palette.bismillahText}
    >
      {BISMILLAH_GLYPH}
    </SvgText>
  );
}

/**
 * ornament — pure SVG geometry.
 *
 * No font. Quran.com renders inter-surah dividers as CSS geometry.
 * Verse-stream ornaments (end markers etc.) are in verse_line via code_v2.
 */
function renderOrnamentSlot(
  slot:    Extract<MushafSlot, { kind: 'ornament' }>,
  layout:  SlotLayout,
  width:   number,
  palette: typeof C.dark,
) {
  const padH    = Math.round(width * 0.08);
  const lineY   = layout.centerY;
  const isInter = slot.variant === 'inter_surah';

  const diamondHalf = 4;
  const cx          = Math.round(width / 2);
  const diamondPts  =
    `${cx},${lineY - diamondHalf} ` +
    `${cx + diamondHalf},${lineY} ` +
    `${cx},${lineY + diamondHalf} ` +
    `${cx - diamondHalf},${lineY}`;

  return (
    <G key={`orn-${slot.slotNumber}`} opacity={isInter ? 0.8 : 0.35}>
      <SvgLine
        x1={padH}
        y1={lineY}
        x2={isInter ? cx - diamondHalf - 2 : width - padH}
        y2={lineY}
        stroke={palette.ornamentLine}
        strokeWidth={isInter ? 1.2 : 0.6}
      />
      {isInter && (
        <>
          <SvgLine
            x1={cx + diamondHalf + 2}
            y1={lineY}
            x2={width - padH}
            y2={lineY}
            stroke={palette.ornamentLine}
            strokeWidth={1.2}
          />
          <Polygon points={diamondPts} fill={palette.ornamentLine} />
        </>
      )}
    </G>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(d: Date): string {
  return d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// ── State types ───────────────────────────────────────────────────────────────

type FontState =
  | { status: 'loading' }
  | { status: 'ready'; pagePsName: string }
  | { status: 'error'; message: string };

// ── Component props ───────────────────────────────────────────────────────────

export type MushafRendererProps = {
  page:             ComposedMushafPage;
  width:            number;
  height:           number;
  /**
   * Height of the visible viewport (screen height). Equals `height` in portrait.
   * In landscape scroll mode the canvas is taller than the viewport (pageHeight ≫ screen height).
   * padV must scale with the viewport — not the canvas — so the first line clears
   * the overlay header rather than being buried 130 pt below the top of a 1700 pt canvas.
   */
  viewportHeight?:  number;
  /**
   * Actual device screen width (before Dynamic Island insets are subtracted).
   * Provided only in landscape scroll mode. Used for font-size calibration:
   * screenWidth ≈ portrait height → portrait slotH → scale by (pageWidth / portrait_width).
   * Without this the font is derived from the tall canvas height, yielding ~56 pt
   * instead of the correct ~49 pt, causing lines to overflow the canvas edges.
   */
  screenWidth?:     number;
  isDark:           boolean;
  activeVerseKey?:  string | null;
  /** Persistent start/end verse markers for the active Khatmah day. */
  khatmahMarkers?:  { startVerseKey: string; endVerseKey: string } | null;
  fontSize?:        number;
  onReady?:         () => void;
  onError?:         (msg: string) => void;
};

// ── Component ─────────────────────────────────────────────────────────────────

// ── Highlight rect type ───────────────────────────────────────────────────────

type HighlightRect = { x: number; y: number; w: number; h: number };

// ── Component ─────────────────────────────────────────────────────────────────

export default function MushafRenderer({
  page,
  width,
  height,
  viewportHeight,
  screenWidth,
  isDark,
  activeVerseKey,
  khatmahMarkers,
  fontSize = 27,
  onReady,
  onError,
}: MushafRendererProps) {
  // padV is the vertical inset from the canvas edge to the first/last slot.
  // In portrait, canvas === viewport, so height works perfectly.
  // In landscape scroll mode the canvas is much taller than the viewport
  // (e.g. 1719 pt vs 393 pt viewport).  Using the full canvas height gives
  // padV ≈ 129 pt, which pushes the first verse ~223 pt below the viewport
  // top — a blank gap that spans more than half the visible screen.
  // Using the viewport height (393 pt) instead gives padV ≈ 29 pt, so
  // content starts near the top where the reader expects it.
  const padVHeight = viewportHeight ?? height;
  // Lazy init: if the parent (QuranPager) has pre-loaded this page's font,
  // start in 'ready' immediately — no loading spinner, no async setState.
  const [fontState, setFontState] = useState<FontState>(() => {
    const needsBismillah = page.slots.some(
      s => s.kind === 'bismillah' || (s.kind === 'surah_header' && s.bismillahEmbedded),
    );
    if (
      isQCFPageFontLoaded(page.pageNumber) &&
      (!needsBismillah || isBismillahFontLoaded())
    ) {
      return { status: 'ready', pagePsName: qcfPagePsName(page.pageNumber) };
    }
    return { status: 'loading' };
  });
  const mountedRef = useRef(true);
  const palette    = isDark ? C.dark : C.light;
  const insets     = useSafeAreaInsets();

  // ── getBBox measurement — two-pass pipeline ───────────────────────────────
  //
  // Keeping fragment elements out of the initial render avoids extra Core Text
  // work during page transitions (when the page font is first loaded and laid
  // out). Fragment elements are only added AFTER pass-1 full-line measurements
  // complete, which happens off the critical path of the initial page render.
  //
  // PASS 1: full-line hidden elements (always present when activeVerseKey set).
  //   getBBox gives absolute ink span of each full line (x, width).
  //   For PURE slots: rect is complete from fullBbox alone → stored immediately.
  //   For SHARED slots: need fragment width → result stored in lineBboxes state
  //     → triggers re-render that adds phase-2 elements.
  //
  // PASS 2: fragment hidden elements (rendered only when lineBboxes !== null).
  //   TWO SvgText elements per shared slot:
  //     fragRef    — active verse glyphs only → fragBbox.width = rect width
  //     prefixRef  — glyphs of all verseKeys[0..activeIdx] → prefixBbox.width
  //                  used to derive rectX = lineRight - prefixWidth
  //
  //   This generalises the two-case (lead/trailing) logic to N verses per line:
  //     v1 (lead):   prefix = frag       → rectX = lineRight - fragWidth         ✓
  //     vN (last):   prefix = full line  → rectX = lineRight - fullWidth = lineLeft ✓
  //     vI (middle): prefix = v1…vI      → rectX = lineRight - prefixWidth       ✓
  //
  //   react-native-svg getBBox() uses LTR semantics: fragBbox.x / prefixBbox.x
  //   are both unreliable for absolute positioning; only .width values are used.
  //
  // Ref clearing: do NOT clear fullLineRefs / fragRefs / prefixRefs / bsmRefs in effects.
  //   React ref callbacks fire during commit (before effects). Clearing in an
  //   effect wipes refs that React just set, causing "no fullBbox" misses.
  //   Stale entries are harmless — effects only read slots containing activeVerseKey.
  //
  type LineBbox = { x: number; width: number };
  // lineBboxes carries the verseKey it was computed for so pass-2 can reject
  // stale results. Problem: activeVerseKey and lineBboxes are separate deps —
  // pass-2 (deps: [lineBboxes, activeVerseKey, ...]) fires whenever EITHER
  // changes, so it can see a combination where lineBboxes is from verse A
  // but activeVerseKey is already B. Tagging with verseKey lets pass-2 detect
  // and bail on mismatches before looking up fragment refs that don't exist yet.
  type LineBboxState = { verseKey: string; pageNumber: number; bboxes: Record<number, LineBbox> };

  const slotLayoutsRef  = useRef<SlotLayout[]>([]);
  const fullLineRefs    = useRef<Record<number, any>>({});   // slot.slotNumber → SvgText ref
  const fragRefs        = useRef<Record<string, any>>({});   // `${slotNum}_${verseKey}` → ref (active verse only)
  const prefixRefs      = useRef<Record<string, any>>({});   // `${slotNum}_${verseKey}` → ref (v1…activeVerse prefix)
  const bsmRefs         = useRef<Record<number, any>>({});   // slot.slotNumber → bismillah ref

  // pass-1 results: full-line bboxes tagged with the verse+page they were measured for
  const [lineBboxes, setLineBboxes]       = useState<LineBboxState | null>(null);
  // pass-2 results: final highlight rects
  const [measuredRects, setMeasuredRects] = useState<HighlightRect[] | null>(null);

  // ── Khatmah marker refs + state (separate namespace from audio refs) ────────
  const kmStartFullLineRefs = useRef<Record<number, any>>({});
  const kmStartFragRefs     = useRef<Record<string, any>>({});
  const kmStartPrefixRefs   = useRef<Record<string, any>>({});
  const kmEndFullLineRefs   = useRef<Record<number, any>>({});
  const kmEndFragRefs       = useRef<Record<string, any>>({});
  const kmEndPrefixRefs     = useRef<Record<string, any>>({});

  const [kmStartLineBboxes, setKmStartLineBboxes] = useState<LineBboxState | null>(null);
  const [kmStartRects,      setKmStartRects]      = useState<HighlightRect[] | null>(null);
  const [kmEndLineBboxes,   setKmEndLineBboxes]   = useState<LineBboxState | null>(null);
  const [kmEndRects,        setKmEndRects]         = useState<HighlightRect[] | null>(null);

  // Clear measurement state on verse/page change.
  // Do NOT clear ref maps — see comment above.
  useEffect(() => {
    setLineBboxes(null);
    setMeasuredRects(null);
  }, [activeVerseKey, page.pageNumber]);

  useEffect(() => { setKmStartLineBboxes(null); setKmStartRects(null); },
    [khatmahMarkers?.startVerseKey, page.pageNumber]);
  useEffect(() => { setKmEndLineBboxes(null); setKmEndRects(null); },
    [khatmahMarkers?.endVerseKey, page.pageNumber]);

  // ── PASS 1: measure full lines + bismillah ─────────────────────────────────
  useEffect(() => {
    if (!activeVerseKey || fontState.status !== 'ready') return;

    let cancelled = false;

    const timer = setTimeout(async () => {
      if (cancelled || !mountedRef.current) return;

      const getBBox = async (el: any): Promise<{ x: number; width: number } | null> => {
        if (!el || typeof el.getBBox !== 'function') return null;
        try {
          const r = el.getBBox();
          const b = (r instanceof Promise ? await r : r) as { x: number; width: number };
          return (b && b.width > 4) ? b : null;
        } catch { return null; }
      };

      const layouts = slotLayoutsRef.current;
      const slotTopY = (l: SlotLayout) => Math.round(l.centerY - l.slotHeight / 2);
      const isDebug = __DEV__ && (page.pageNumber === 1 || page.pageNumber === 2);

      // ── Bismillah: single-pass ────────────────────────────────────────────
      if (activeVerseKey.startsWith('BSMLLH_')) {
        const rects: HighlightRect[] = [];
        const surahId = parseInt(activeVerseKey.slice(7), 10);
        for (const slot of page.slots) {
          if (slot.kind === 'bismillah' && slot.surahId === surahId) {
            const layout = layouts[slot.slotNumber - 1];
            if (!layout) continue;
            const bbox = await getBBox(bsmRefs.current[slot.slotNumber]);
            if (!cancelled && bbox) {
              rects.push({ x: bbox.x, y: slotTopY(layout) + 2, w: bbox.width, h: layout.slotHeight - 4 });
            }
          }
          if (slot.kind === 'surah_header' && slot.bismillahEmbedded && slot.surah.id === surahId) {
            const layout = layouts[slot.slotNumber - 1];
            if (!layout) continue;
            const bsmH = Math.round(layout.slotHeight * 0.40);
            const bsmY = slotTopY(layout) + layout.slotHeight - bsmH;
            rects.push({ x: 2, y: bsmY + 2, w: width - 4, h: bsmH - 4 });
          }
        }
        if (!cancelled && mountedRef.current) setMeasuredRects(rects.length > 0 ? rects : null);
        return;
      }

      // ── Surah header: full-width rect ─────────────────────────────────────
      if (activeVerseKey.startsWith('SURAH_')) {
        const rects: HighlightRect[] = [];
        const surahId = parseInt(activeVerseKey.slice(6), 10);
        for (const slot of page.slots) {
          if (slot.kind !== 'surah_header' || slot.surah.id !== surahId) continue;
          const layout = layouts[slot.slotNumber - 1];
          if (!layout) continue;
          rects.push({ x: 2, y: slotTopY(layout) + 2, w: width - 4, h: layout.slotHeight - 4 });
        }
        if (!cancelled && mountedRef.current) setMeasuredRects(rects.length > 0 ? rects : null);
        return;
      }

      // ── Verse lines: pass 1 — measure full-line bboxes ────────────────────
      //
      // During page transitions the native Core Text layer may not have
      // finished rendering the new page font when this setTimeout fires at 0ms.
      // If ALL relevant slots miss (getBBox returns null), retry once after
      // 50ms to let the native render stabilise. Individual misses (partial)
      // are not retried — they indicate a genuine slot exclusion, not latency.
      const measureFullLines = async (): Promise<Record<number, LineBbox>> => {
        const result: Record<number, LineBbox> = {};
        for (const slot of page.slots) {
          if (slot.kind !== 'verse_line') continue;
          if (!slot.line.verseKeys.includes(activeVerseKey)) continue;
          const bbox = await getBBox(fullLineRefs.current[slot.slotNumber]);
          if (cancelled) return result;
          if (bbox) result[slot.slotNumber] = bbox;
        }
        return result;
      };

      let bboxes = await measureFullLines();
      if (cancelled) return;

      // Count how many slots we expected to measure.
      const expectedSlots = page.slots.filter(
        s => s.kind === 'verse_line' && s.line.verseKeys.includes(activeVerseKey),
      ).length;

      if (expectedSlots > 0 && Object.keys(bboxes).length === 0) {
        // All bboxes failed — native font rendering not ready yet. Retry once.
        if (isDebug) console.log(`[HL] p1 all-miss for ${activeVerseKey} — retrying in 50ms`);
        await new Promise<void>(r => setTimeout(r, 50));
        if (cancelled || !mountedRef.current) return;
        bboxes = await measureFullLines();
        if (cancelled) return;
      }

      if (isDebug) {
        for (const slot of page.slots) {
          if (slot.kind !== 'verse_line') continue;
          if (!slot.line.verseKeys.includes(activeVerseKey)) continue;
          if (!bboxes[slot.slotNumber]) {
            console.log(`[HL] p1 miss ${activeVerseKey} slot=${slot.slotNumber} — no fullBbox`);
          }
        }
      }

      if (!cancelled && mountedRef.current) {
        // Tag with the verse+page so pass-2 can reject stale results.
        setLineBboxes({ verseKey: activeVerseKey, pageNumber: page.pageNumber, bboxes });
      }
    }, 0);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [activeVerseKey, page.pageNumber, fontState.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── PASS 2: measure per-verse fragment widths ──────────────────────────────
  useEffect(() => {
    // Reject stale lineBboxes computed for a different verse or page.
    // This guards against pass-2 firing with old lineBboxes while activeVerseKey
    // has already advanced — in that case the fragment refs are keyed for the
    // old verse and the new fragKey lookups would silently return null.
    if (
      !lineBboxes ||
      lineBboxes.verseKey !== activeVerseKey ||
      lineBboxes.pageNumber !== page.pageNumber ||
      !activeVerseKey ||
      fontState.status !== 'ready'
    ) return;
    if (activeVerseKey.startsWith('BSMLLH_') || activeVerseKey.startsWith('SURAH_')) return;

    let cancelled = false;

    const timer = setTimeout(async () => {
      if (cancelled || !mountedRef.current) return;

      const getBBox = async (el: any): Promise<{ x: number; width: number } | null> => {
        if (!el || typeof el.getBBox !== 'function') return null;
        try {
          const r = el.getBBox();
          const b = (r instanceof Promise ? await r : r) as { x: number; width: number };
          return (b && b.width > 4) ? b : null;
        } catch { return null; }
      };

      const layouts = slotLayoutsRef.current;
      const rects: HighlightRect[] = [];
      const isDebug = __DEV__ && (page.pageNumber === 1 || page.pageNumber === 2 || page.pageNumber === 604);

      for (const slot of page.slots) {
        if (slot.kind !== 'verse_line') continue;
        if (!slot.line.verseKeys.includes(activeVerseKey)) continue;

        const layout = layouts[slot.slotNumber - 1];
        if (!layout) continue;

        const y = Math.round(layout.centerY - layout.slotHeight / 2) + 2;
        const h = layout.slotHeight - 4;
        const fullBbox = lineBboxes.bboxes[slot.slotNumber];

        if (!fullBbox) {
          if (isDebug) console.log(`[HL] p2 skip ${activeVerseKey} slot=${slot.slotNumber} — no fullBbox`);
          continue;
        }

        if (slot.line.verseKeys.length === 1) {
          rects.push({ x: fullBbox.x, y, w: fullBbox.width, h });
          if (isDebug) console.log(`[HL] ${activeVerseKey} slot=${slot.slotNumber} PURE x=${fullBbox.x.toFixed(1)} w=${fullBbox.width.toFixed(1)}`);
          continue;
        }

        // Shared slot: use TWO measurements for precise RTL positioning.
        //
        // fragBbox.width  = physical advance width of the active verse only (rect width).
        // prefixBbox.width = physical advance width of glyphs(v1…activeVerse) (for rectX).
        //
        // In RTL layout the line reads right→left: v1 (rightmost) … vN (leftmost).
        // The left edge of verse vI is exactly `lineRight - prefixWidth(v1…vI)`.
        //
        //   Lead   (I=1): prefix = frag → rectX = lineRight - fragWidth              ✓
        //   Last   (I=N): prefix = full line → rectX = lineRight - fullWidth = lineLeft ✓
        //   Middle (I=k): rectX = lineRight - prefixWidth(v1…vk)                     ✓
        //
        // fragBbox.x and prefixBbox.x are both discarded — LTR getBBox semantics.
        //
        // Fallback: if fragBbox is unavailable, use fullBbox for the whole line.
        const activeIdx = slot.line.verseKeys.indexOf(activeVerseKey);
        const isLead    = activeIdx === 0;
        const lineLeft  = fullBbox.x;
        const lineRight = fullBbox.x + fullBbox.width;

        const fragKey   = `${slot.slotNumber}_${activeVerseKey}`;
        const fragBbox  = await getBBox(fragRefs.current[fragKey]);
        if (cancelled) return;

        if (!fragBbox) {
          // Fall back to the full line bbox — a wider rect is better than no highlight.
          rects.push({ x: fullBbox.x, y, w: fullBbox.width, h });
          if (isDebug) {
            console.log(
              `[HL] ${activeVerseKey} slot=${slot.slotNumber} idx=${activeIdx}/${slot.line.verseKeys.length - 1}` +
              ` no fragBbox — FALLBACK to fullBbox x=${fullBbox.x.toFixed(1)} w=${fullBbox.width.toFixed(1)}`,
            );
          }
          continue;
        }

        let rectX: number;

        if (isLead) {
          // Lead verse: prefix = frag, no extra measurement needed.
          rectX = lineRight - fragBbox.width;
        } else {
          // Non-lead: measure the prefix (v1…activeVerse) to find the correct x.
          const prefixKey  = `prefix_${slot.slotNumber}_${activeVerseKey}`;
          const prefixBbox = await getBBox(prefixRefs.current[prefixKey]);
          if (cancelled) return;

          if (prefixBbox) {
            rectX = lineRight - prefixBbox.width;
          } else {
            // prefixBbox unavailable — fall back to lineLeft (old behaviour, only
            // correct for the last verse but avoids a blank highlight).
            rectX = lineLeft;
            if (isDebug) {
              console.log(
                `[HL] ${activeVerseKey} slot=${slot.slotNumber} idx=${activeIdx}/${slot.line.verseKeys.length - 1}` +
                ` no prefixBbox — fallback rectX=lineLeft`,
              );
            }
          }
        }

        rects.push({ x: rectX, y, w: fragBbox.width, h });

        if (isDebug) {
          console.log(
            `[HL] ${activeVerseKey} slot=${slot.slotNumber} idx=${activeIdx}/${slot.line.verseKeys.length - 1}` +
            ` segments=${slot.line.verseKeys.length}` +
            ` fragWidth=${fragBbox.width.toFixed(1)}` +
            ` line=[${lineLeft.toFixed(1)},${lineRight.toFixed(1)}]` +
            ` rectX=${rectX.toFixed(1)}`,
          );
        }
      }

      if (!cancelled && mountedRef.current) {
        setMeasuredRects(rects.length > 0 ? rects : null);
      }
    }, 0);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [lineBboxes, activeVerseKey, page.pageNumber, fontState.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Khatmah: shared getBBox helper ────────────────────────────────────────
  //
  // Identical logic to the audio pipeline, including the 50ms retry when all
  // getBBox calls return null (font not yet painted on first render).
  // Key prefix `ks_` = khatmah-start, `ke_` = khatmah-end — never collides
  // with the audio pipeline keys (`${slotNum}_${verseKey}` / `prefix_${...}`).

  // ── Khatmah pass-1: start verse ───────────────────────────────────────────
  //
  // Initial 50ms delay: khatmah pass-1 hidden elements are newly added in the
  // same re-render that triggers this effect (when khatmahMarkers changes).
  // setTimeout(0) fires before native has committed those elements — getBBox
  // returns null for all slots, which wastes the first attempt and relies
  // entirely on the retry. Using 50ms upfront matches the pass-2 pattern and
  // gives native time to commit before the first measurement.
  //
  // Retry: fires when measured slots < expected slots (not just when all are
  // missing), so partially-failed measurements are re-attempted too.
  useEffect(() => {
    const verseKey = khatmahMarkers?.startVerseKey;
    if (!verseKey || fontState.status !== 'ready') return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled || !mountedRef.current) return;

      const getBBox = async (el: any): Promise<{ x: number; width: number } | null> => {
        if (!el || typeof el.getBBox !== 'function') return null;
        try {
          const r = el.getBBox();
          const b = (r instanceof Promise ? await r : r) as { x: number; width: number };
          return (b && b.width > 4) ? b : null;
        } catch { return null; }
      };

      const measureFull = async (): Promise<Record<number, LineBbox>> => {
        const result: Record<number, LineBbox> = {};
        for (const slot of page.slots) {
          if (slot.kind !== 'verse_line') continue;
          if (!slot.line.verseKeys.includes(verseKey)) continue;
          const bbox = await getBBox(kmStartFullLineRefs.current[slot.slotNumber]);
          if (cancelled) return result;
          if (bbox) result[slot.slotNumber] = bbox;
        }
        return result;
      };

      const expectedSlots = page.slots.filter(
        s => s.kind === 'verse_line' && s.line.verseKeys.includes(verseKey),
      ).length;

      let bboxes = await measureFull();
      if (cancelled) return;

      if (expectedSlots > 0 && Object.keys(bboxes).length < expectedSlots) {
        await new Promise<void>(r => setTimeout(r, 50));
        if (cancelled || !mountedRef.current) return;
        const retry = await measureFull();
        if (cancelled) return;
        // Merge: keep any slots that were already measured, fill in newly measured ones
        bboxes = { ...bboxes, ...retry };
      }

      if (!cancelled && mountedRef.current) {
        setKmStartLineBboxes({ verseKey, pageNumber: page.pageNumber, bboxes });
      }
    }, 50);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [khatmahMarkers?.startVerseKey, page.pageNumber, fontState.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Khatmah pass-1: end verse ─────────────────────────────────────────────
  //
  // Same 50ms initial delay + improved retry as start verse above.
  useEffect(() => {
    const verseKey = khatmahMarkers?.endVerseKey;
    if (!verseKey || fontState.status !== 'ready') return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled || !mountedRef.current) return;

      const getBBox = async (el: any): Promise<{ x: number; width: number } | null> => {
        if (!el || typeof el.getBBox !== 'function') return null;
        try {
          const r = el.getBBox();
          const b = (r instanceof Promise ? await r : r) as { x: number; width: number };
          return (b && b.width > 4) ? b : null;
        } catch { return null; }
      };

      const measureFull = async (): Promise<Record<number, LineBbox>> => {
        const result: Record<number, LineBbox> = {};
        for (const slot of page.slots) {
          if (slot.kind !== 'verse_line') continue;
          if (!slot.line.verseKeys.includes(verseKey)) continue;
          const bbox = await getBBox(kmEndFullLineRefs.current[slot.slotNumber]);
          if (cancelled) return result;
          if (bbox) result[slot.slotNumber] = bbox;
        }
        return result;
      };

      const expectedSlots = page.slots.filter(
        s => s.kind === 'verse_line' && s.line.verseKeys.includes(verseKey),
      ).length;

      let bboxes = await measureFull();
      if (cancelled) return;

      if (expectedSlots > 0 && Object.keys(bboxes).length < expectedSlots) {
        await new Promise<void>(r => setTimeout(r, 50));
        if (cancelled || !mountedRef.current) return;
        const retry = await measureFull();
        if (cancelled) return;
        bboxes = { ...bboxes, ...retry };
      }

      if (!cancelled && mountedRef.current) {
        setKmEndLineBboxes({ verseKey, pageNumber: page.pageNumber, bboxes });
      }
    }, 50);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [khatmahMarkers?.endVerseKey, page.pageNumber, fontState.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Khatmah pass-2: start verse fragment widths ───────────────────────────
  //
  // Initial 50ms delay: pass-2 hidden elements are added in the re-render
  // triggered by setKmStartLineBboxes. Native may not have committed the new
  // views before useEffect fires with setTimeout(0) — the 50ms gap ensures the
  // native layer has rendered before we call getBBox.
  //
  // Retry: if fragBbox is still null after the first try (native slow commit),
  // wait another 50ms and re-measure. Only falls back to full-line on second miss.
  useEffect(() => {
    const verseKey = khatmahMarkers?.startVerseKey;
    if (!kmStartLineBboxes || kmStartLineBboxes.verseKey !== verseKey ||
        kmStartLineBboxes.pageNumber !== page.pageNumber || !verseKey ||
        fontState.status !== 'ready') return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled || !mountedRef.current) return;

      const getBBox = async (el: any): Promise<{ x: number; width: number } | null> => {
        if (!el || typeof el.getBBox !== 'function') return null;
        try {
          const r = el.getBBox();
          const b = (r instanceof Promise ? await r : r) as { x: number; width: number };
          return (b && b.width > 4) ? b : null;
        } catch { return null; }
      };

      const measureKmStart = async (): Promise<{ rects: HighlightRect[]; needRetry: boolean }> => {
        const layouts = slotLayoutsRef.current;
        const rects: HighlightRect[] = [];
        let needRetry = false;

        for (const slot of page.slots) {
          if (slot.kind !== 'verse_line') continue;
          if (!slot.line.verseKeys.includes(verseKey)) continue;
          const layout   = layouts[slot.slotNumber - 1];
          if (!layout) continue;
          const fullBbox = kmStartLineBboxes.bboxes[slot.slotNumber];
          if (!fullBbox) continue;

          const y = Math.round(layout.centerY - layout.slotHeight / 2) + 2;
          const h = layout.slotHeight - 4;

          if (slot.line.verseKeys.length === 1) {
            rects.push({ x: fullBbox.x, y, w: fullBbox.width, h });
            continue;
          }

          const activeIdx = slot.line.verseKeys.indexOf(verseKey);
          const isLead    = activeIdx === 0;
          const lineRight = fullBbox.x + fullBbox.width;

          const fragBbox = await getBBox(kmStartFragRefs.current[`ks_${slot.slotNumber}_${verseKey}`]);
          if (cancelled) return { rects, needRetry };

          if (!fragBbox) { needRetry = true; continue; } // retry — don't use full-line fallback

          let rectX: number;
          if (isLead) {
            rectX = lineRight - fragBbox.width;
          } else {
            const prefixBbox = await getBBox(kmStartPrefixRefs.current[`ks_pfx_${slot.slotNumber}_${verseKey}`]);
            if (cancelled) return { rects, needRetry };
            rectX = prefixBbox ? lineRight - prefixBbox.width : fullBbox.x;
          }
          rects.push({ x: rectX, y, w: fragBbox.width, h });
        }

        return { rects, needRetry };
      };

      let { rects, needRetry } = await measureKmStart();
      if (cancelled || !mountedRef.current) return;

      if (needRetry) {
        await new Promise<void>(r => setTimeout(r, 50));
        if (cancelled || !mountedRef.current) return;
        const retry = await measureKmStart();
        if (cancelled) return;
        rects = retry.rects;
      }

      if (!cancelled && mountedRef.current) setKmStartRects(rects.length > 0 ? rects : null);
    }, 50);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [kmStartLineBboxes, khatmahMarkers?.startVerseKey, page.pageNumber, fontState.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Khatmah pass-2: end verse fragment widths ─────────────────────────────
  //
  // Same timing fix as start verse above — 50ms initial delay + retry on null fragBbox.
  useEffect(() => {
    const verseKey = khatmahMarkers?.endVerseKey;
    if (!kmEndLineBboxes || kmEndLineBboxes.verseKey !== verseKey ||
        kmEndLineBboxes.pageNumber !== page.pageNumber || !verseKey ||
        fontState.status !== 'ready') return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled || !mountedRef.current) return;

      const getBBox = async (el: any): Promise<{ x: number; width: number } | null> => {
        if (!el || typeof el.getBBox !== 'function') return null;
        try {
          const r = el.getBBox();
          const b = (r instanceof Promise ? await r : r) as { x: number; width: number };
          return (b && b.width > 4) ? b : null;
        } catch { return null; }
      };

      const measureKmEnd = async (): Promise<{ rects: HighlightRect[]; needRetry: boolean }> => {
        const layouts = slotLayoutsRef.current;
        const rects: HighlightRect[] = [];
        let needRetry = false;

        for (const slot of page.slots) {
          if (slot.kind !== 'verse_line') continue;
          if (!slot.line.verseKeys.includes(verseKey)) continue;
          const layout   = layouts[slot.slotNumber - 1];
          if (!layout) continue;
          const fullBbox = kmEndLineBboxes.bboxes[slot.slotNumber];
          if (!fullBbox) continue;

          const y = Math.round(layout.centerY - layout.slotHeight / 2) + 2;
          const h = layout.slotHeight - 4;

          if (slot.line.verseKeys.length === 1) {
            rects.push({ x: fullBbox.x, y, w: fullBbox.width, h });
            continue;
          }

          const activeIdx = slot.line.verseKeys.indexOf(verseKey);
          const isLead    = activeIdx === 0;
          const lineRight = fullBbox.x + fullBbox.width;

          const fragBbox = await getBBox(kmEndFragRefs.current[`ke_${slot.slotNumber}_${verseKey}`]);
          if (cancelled) return { rects, needRetry };

          if (!fragBbox) { needRetry = true; continue; } // retry — don't use full-line fallback

          let rectX: number;
          if (isLead) {
            rectX = lineRight - fragBbox.width;
          } else {
            const prefixBbox = await getBBox(kmEndPrefixRefs.current[`ke_pfx_${slot.slotNumber}_${verseKey}`]);
            if (cancelled) return { rects, needRetry };
            rectX = prefixBbox ? lineRight - prefixBbox.width : fullBbox.x;
          }
          rects.push({ x: rectX, y, w: fragBbox.width, h });
        }

        return { rects, needRetry };
      };

      let { rects, needRetry } = await measureKmEnd();
      if (cancelled || !mountedRef.current) return;

      if (needRetry) {
        await new Promise<void>(r => setTimeout(r, 50));
        if (cancelled || !mountedRef.current) return;
        const retry = await measureKmEnd();
        if (cancelled) return;
        rects = retry.rects;
      }

      if (!cancelled && mountedRef.current) setKmEndRects(rects.length > 0 ? rects : null);
    }, 50);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [kmEndLineBboxes, khatmahMarkers?.endVerseKey, page.pageNumber, fontState.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clock — updates every minute
  const [time, setTime] = useState(() => formatTime(new Date()));
  useEffect(() => {
    const id = setInterval(() => setTime(formatTime(new Date())), 60_000);
    return () => clearInterval(id);
  }, []);

  // Page metadata
  const surahName  = surahForPage(page.pageNumber).nameSimple;
  const juzId      = juzForPage(page.pageNumber).id;
  const isEvenPage = page.pageNumber % 2 === 0;
  const metaColor  = isDark ? 'rgba(255,255,255,0.42)' : 'rgba(0,0,0,0.32)';

  useEffect(() => {
    mountedRef.current = true;

    // Only load surah/bismillah fonts when this page actually needs them.
    // These fonts are shared across all pages — Font.isLoaded() ensures
    // they are only downloaded/registered once.
    const needsBismillahFont = page.slots.some(
      s => s.kind === 'bismillah' || (s.kind === 'surah_header' && s.bismillahEmbedded),
    );

    // If fonts are already registered (pre-loaded by QuranPager before this
    // component mounted), skip the loading→ready transition entirely. The lazy
    // useState init already set fontState to 'ready', so no setState is needed.
    // This prevents FlatList from measuring a late state update and avoids the
    // VirtualizedList "slow to update" warning.
    if (
      isQCFPageFontLoaded(page.pageNumber) &&
      (!needsBismillahFont || isBismillahFontLoaded())
    ) {
      onReady?.();
      return () => { mountedRef.current = false; };
    }

    setFontState({ status: 'loading' });

    Promise.all([
      loadQCFPageFont(page.pageNumber),
      needsBismillahFont ? loadBismillahFont() : Promise.resolve(''),
    ])
      .then(([pagePsName]) => {
        if (!mountedRef.current) return;
        setFontState({ status: 'ready', pagePsName });
        onReady?.();
      })
      .catch((err: Error) => {
        if (!mountedRef.current) return;
        const msg =
          `Font load failed — page ${page.pageNumber}, ` +
          `expected page font "${qcfPagePsName(page.pageNumber)}". ` +
          `Error: ${err?.message ?? String(err)}. ` +
          `No fallback font will be used.`;
        setFontState({ status: 'error', message: msg });
        onError?.(msg);
      });

    return () => { mountedRef.current = false; };
  }, [page.pageNumber]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Error ────────────────────────────────────────────────────────────────
  if (fontState.status === 'error') {
    return (
      <View style={[styles.root, { width, height, backgroundColor: palette.pageBg }]}>
        <View style={styles.errorBox}>
          <Text style={styles.errorTitle}>Font ej tillgänglig</Text>
          <Text style={styles.errorBody} numberOfLines={8}>
            {fontState.message}
          </Text>
        </View>
      </View>
    );
  }

  // ── Loading ──────────────────────────────────────────────────────────────
  if (fontState.status === 'loading') {
    return (
      <View style={[styles.root, { width, height, backgroundColor: palette.pageBg }]}>
        <ActivityIndicator color={isDark ? '#666' : '#999'} />
      </View>
    );
  }

  // ── Ready ────────────────────────────────────────────────────────────────
  const { pagePsName } = fontState;

  // Vertical centering: for short pages (< 13 content slots, e.g. Al-Fatihah,
  // Al-Baqarah p1) shift all slots so the content block is centred on screen.
  // Target: height/2 (true screen centre), not the grid centre.
  // Also activates looser line spacing (+1.4px/line) via shortPage flag.
  let verticalShift = 0;
  let isShortPage   = false;
  {
    // Ornament slots (page_end / page_start decorations) fill slots 9-15
    // on short pages — excluding them here is critical. If included, the
    // count always reaches 15 and the centering condition never triggers.
    const contentSlots = page.slots.filter(
      (s) =>
        s.kind === 'verse_line' ||
        s.kind === 'surah_header' ||
        s.kind === 'bismillah',
    );
    if (contentSlots.length > 0 && contentSlots.length < TOTAL_SLOTS - 2) {
      isShortPage = true;
      const padV    = Math.round(padVHeight * 0.075);
      const usableH = height - padV * 2;
      // Use short-page slotH (divisor 15) — same as computeSlotLayouts(shortPage=true)
      const slotH   = usableH / TOTAL_SLOTS;

      const slotNums = contentSlots.map((s) => s.slotNumber);
      const first    = Math.min(...slotNums);
      const last     = Math.max(...slotNums);
      // Centre content block on true screen centre (height/2).
      // contentCenterAbs = padV + (first+last)/2 * slotH + verticalShift = height/2
      verticalShift = Math.round(height / 2 - padV - ((first + last) / 2) * slotH);
      // Clamp: top slot must not rise above padV (chrome clearance)
      const topSlotY = padV + first * slotH + verticalShift;
      if (topSlotY < padV) verticalShift -= topSlotY - padV;
    }
  }

  // ── Landscape scroll mode: pull content up toward the visible top ─────────
  // In landscape the canvas is much taller than the viewport (e.g. 1655pt vs
  // 393pt). slotH ≈ 103pt, so without a shift the first slot sits at
  // padV + slotH ≈ 132pt — 78pt below the 54pt chrome header.
  // Apply a negative shift so the first line appears just below the chrome.
  // Target: insets.top + 58pt (≈ safe-area + header height + 4pt breathing room).
  //
  // Applies to BOTH full pages and short pages (Al-Fatihah, Al-Baqarah p1 etc.).
  // For short pages the short-page centering shift is overridden — centering a
  // content block on a 1655pt canvas is meaningless; pulling it to the top is
  // the correct behaviour for a scrollable landscape reader.
  if (viewportHeight && height > viewportHeight * 1.2) {
    const padV   = Math.round(padVHeight * 0.075);
    // Use the same divisor as computeSlotLayouts will use for this page type.
    const slotH  = (height - padV * 2) / (isShortPage ? TOTAL_SLOTS : TOTAL_SLOTS + 0.5);
    // For short pages find the first actual content slot number (may not be 1).
    const firstSlot = isShortPage
      ? Math.min(...page.slots
          .filter(s => s.kind === 'verse_line' || s.kind === 'surah_header' || s.kind === 'bismillah')
          .map(s => s.slotNumber))
      : 1;
    const firstSlotY = padV + firstSlot * slotH;
    const targetY    = insets.top + 72;
    verticalShift    = Math.round(targetY - firstSlotY);
  }

  const slotLayouts = computeSlotLayouts(height, verticalShift, isShortPage, Math.round(padVHeight * 0.075));

  // Keep ref in sync so the async measurement effect always reads current layout.
  slotLayoutsRef.current = slotLayouts;

  // Font size is derived from the full-page slotH (divisor 15.5).
  //
  // Multipliers are calibrated for padV = 7.5% of height (reduced from 10.8%
  // so that content fills the safe-area-adjusted screen with no wasted space).
  //
  //   Full pages (15 dense verse lines):
  //     Multiplier 0.52 → ~24pt on 844px screen. Dense lines (8-10 words)
  //     fill ~89% of screen width — no overflow. Do NOT exceed 0.54.
  //
  //   Short pages (Al-Fatihah, Al-Baqarah p1, etc.):
  //     Multiplier 0.56 → ~27pt on 844px screen. Short lines can handle
  //     the larger size without overflow.
  const fullPageSlotH = (height - Math.round(padVHeight * 0.075) * 2) / (TOTAL_SLOTS + 0.5);
  // In landscape scroll mode, screenWidth ≈ portrait height (the shorter screen dimension).
  // The canvas is tall (portrait-equivalent) but the font size must fit the canvas WIDTH.
  // Calibrate font size against portrait-equivalent dimensions then scale by canvas width ratio.
  let effectiveFontSize: number;
  if (screenWidth) {
    // screenWidth = actual screen width in landscape = portrait height
    // viewportHeight = actual screen height in landscape = portrait width
    const portraitH       = screenWidth;
    const portraitPadV    = Math.round(portraitH * 0.075);
    const portraitSlotH   = (portraitH - portraitPadV * 2) / (TOTAL_SLOTS + 0.5);
    const portraitFontSz  = portraitSlotH * (isShortPage ? 0.56 : 0.52);
    const portraitW       = viewportHeight ?? height;
    effectiveFontSize = Math.round(portraitFontSz * (width / portraitW));
  } else {
    effectiveFontSize = Math.round(fullPageSlotH * (isShortPage ? 0.56 : 0.52));
  }

  // Use getBBox-measured rects when available (set async, one frame after render).
  // No proportional fallback — approximations cause highlight bleeding into adjacent ayahs.
  const highlightRects = measuredRects ?? [];
  // Subtle highlight: the rect sits BEHIND the QCF text (SVG draw order).
  // Dark mode: faint white wash on black — readable, not a solid box.
  // Light mode: warm sand, matching Ayah app.
  const highlightColor = isDark ? 'rgba(255,255,255,0.28)' : 'rgba(175,145,90,0.34)';

  return (
    <View style={[styles.root, { width, height }]}>
      <Svg width={width} height={height}>
        {/* ClipPath defs for quran-banner-knut ornament */}
        <Defs>
          {KNUT_CLIPS.map((cp) => (
            <ClipPath key={cp.id} id={`knut-${cp.id}`}>
              {cp.kind === 'path'
                ? <Path d={cp.d} />
                : <Rect x={cp.x} y={cp.y} width={cp.w} height={cp.h} />}
            </ClipPath>
          ))}
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill={palette.pageBg} />

        {/* Khatmah start — green, behind text */}
        {kmStartRects?.map((r, i) => (
          <Rect key={`km-s-${i}`} x={r.x} y={r.y} width={r.w} height={r.h}
            fill={isDark ? 'rgba(36,180,130,0.32)' : 'rgba(36,100,93,0.25)'} rx={10} />
        ))}
        {/* Khatmah end — orange, behind text */}
        {kmEndRects?.map((r, i) => (
          <Rect key={`km-e-${i}`} x={r.x} y={r.y} width={r.w} height={r.h}
            fill={isDark ? 'rgba(255,149,0,0.32)' : 'rgba(255,149,0,0.22)'} rx={10} />
        ))}

        {/* Highlight rects — rendered before text so glyphs draw on top */}
        {highlightRects.map((r, i) => (
          <Rect
            key={`hl-${i}`}
            x={r.x} y={r.y}
            width={r.w} height={r.h}
            fill={highlightColor}
            rx={10}
          />
        ))}

        {page.slots.map((slot, i) => {
          const layout = slotLayouts[slot.slotNumber - 1] ?? slotLayouts[i];

          switch (slot.kind) {
            case 'verse_line':
              return renderVerseLineSlot(slot, layout, width, pagePsName, effectiveFontSize * 0.98, palette);

            case 'surah_header':
              return renderSurahHeaderSlot(slot, layout, width, palette, isDark, effectiveFontSize);

            case 'bismillah':
              return renderBismillahSlot(slot, layout, width, effectiveFontSize, palette);

            case 'ornament':
              return renderOrnamentSlot(slot, layout, width, palette);

            case 'unknown':
              return null;

            default:
              return null;
          }
        })}

        {/*
         * ── Phase 1 hidden elements: full lines + bismillah ─────────────────
         * Rendered whenever activeVerseKey is set (font must be ready).
         * getBBox on these gives the absolute ink span of each full line,
         * which is used as the RTL anchor for phase-2 fragment elements.
         *
         * Keys use fullLineRefs[slotNumber] and bsmRefs[slotNumber].
         * opacity=0.004: react-native-svg on iOS only calls getBBox correctly
         * when the element is painted (opacity 0 → skip paint → no bbox).
         */}
        {activeVerseKey && page.slots.map((slot) => {
          // ── bismillah: phase 1 — measure the glyph bbox ───────────────────
          if (slot.kind === 'bismillah' && activeVerseKey.startsWith('BSMLLH_')) {
            const surahId = parseInt(activeVerseKey.slice(7), 10);
            if (slot.surahId !== surahId) return null;
            const layout = slotLayouts[slot.slotNumber - 1];
            if (!layout) return null;
            return (
              <SvgText
                key={`p1-bsm-${slot.slotNumber}`}
                ref={(el: any) => { bsmRefs.current[slot.slotNumber] = el; }}
                x={Math.round(width / 2)}
                y={layout.baselineY}
                textAnchor="middle"
                fontFamily={BISMILLAH_PS_NAME}
                fontSize={effectiveFontSize * 0.98}
                fill={palette.pageBg}
                opacity={0.004}
              >
                {BISMILLAH_GLYPH}
              </SvgText>
            );
          }

          // ── verse_line: phase 1 — measure the full lineGlyph ─────────────
          if (slot.kind !== 'verse_line') return null;
          if (!slot.line.verseKeys.includes(activeVerseKey)) return null;

          const layout = slotLayouts[slot.slotNumber - 1];
          if (!layout) return null;

          return (
            <SvgText
              key={`p1-full-${slot.slotNumber}`}
              ref={(el: any) => { fullLineRefs.current[slot.slotNumber] = el; }}
              x={Math.round(width / 2)}
              y={layout.baselineY}
              textAnchor="middle"
              fontFamily={pagePsName}
              fontSize={effectiveFontSize * 0.98}
              fill={palette.pageBg}
              opacity={0.004}
            >
              {slot.line.lineGlyph}
            </SvgText>
          );
        })}

        {/*
         * ── Phase 2: fragment + prefix elements — per-verse measurement ────────
         * Rendered ONLY after pass-1 lineBboxes are available.
         *
         * fragRef   — active verse glyphs only → fragBbox.width = rect width
         * prefixRef — glyphs of verseKeys[0..activeIdx] → prefixBbox.width used
         *             to compute rectX = lineRight - prefixWidth (RTL position).
         *
         * For the lead verse (activeIdx === 0) the prefix equals the fragment, so
         * no prefixRef is rendered — pass-2 uses fragBbox.width directly.
         *
         * Pure slots (verseKeys.length === 1) are skipped — fullBbox suffices.
         */}
        {activeVerseKey && lineBboxes?.verseKey === activeVerseKey && lineBboxes?.pageNumber === page.pageNumber && page.slots.map((slot) => {
          if (slot.kind !== 'verse_line') return null;
          if (slot.line.verseKeys.length === 1) return null; // pure: no fragment needed
          if (!slot.line.verseKeys.includes(activeVerseKey)) return null;
          if (!lineBboxes!.bboxes[slot.slotNumber]) return null; // pass-1 missed this slot

          const layout = slotLayouts[slot.slotNumber - 1];
          if (!layout) return null;

          const activeIdx = slot.line.verseKeys.indexOf(activeVerseKey);
          const isLead = activeIdx === 0;

          // Fragment: active verse glyphs only (for rect width)
          const activeGlyphs = slot.line.words
            .filter((w) => w.verseKey === activeVerseKey)
            .map((w) => w.glyph)
            .join('');
          if (!activeGlyphs) return null;

          const fragKey   = `${slot.slotNumber}_${activeVerseKey}`;

          // Prefix: glyphs of all verses from v1 up to and including active verse.
          // Only needed for non-lead verses (lead: prefix = frag, no extra element).
          const prefixKey = `prefix_${slot.slotNumber}_${activeVerseKey}`;
          const prefixGlyphs = isLead ? null : slot.line.words
            .filter((w) => slot.line.verseKeys.indexOf(w.verseKey) <= activeIdx)
            .map((w) => w.glyph)
            .join('');

          const sharedProps = {
            x: Math.round(width / 2),
            y: layout.baselineY,
            textAnchor: 'middle' as const,
            fontFamily: pagePsName,
            fontSize: effectiveFontSize * 0.98,
            fill: palette.pageBg,
            opacity: 0.004,
          };

          return (
            <React.Fragment key={`p2-${slot.slotNumber}`}>
              <SvgText
                key={`p2-frag-${slot.slotNumber}`}
                ref={(el: any) => { fragRefs.current[fragKey] = el; }}
                {...sharedProps}
              >
                {activeGlyphs}
              </SvgText>
              {!isLead && prefixGlyphs ? (
                <SvgText
                  key={`p2-prefix-${slot.slotNumber}`}
                  ref={(el: any) => { prefixRefs.current[prefixKey] = el; }}
                  {...sharedProps}
                >
                  {prefixGlyphs}
                </SvgText>
              ) : null}
            </React.Fragment>
          );
        })}

        {/* ── Khatmah hidden elements: phase-1 full lines ─────────────────── */}
        {khatmahMarkers?.startVerseKey && page.slots.map((slot) => {
          if (slot.kind !== 'verse_line') return null;
          if (!slot.line.verseKeys.includes(khatmahMarkers.startVerseKey)) return null;
          const layout = slotLayouts[slot.slotNumber - 1];
          if (!layout) return null;
          return (
            <SvgText key={`km-s-p1-${slot.slotNumber}`}
              ref={(el: any) => { kmStartFullLineRefs.current[slot.slotNumber] = el; }}
              x={Math.round(width / 2)} y={layout.baselineY} textAnchor="middle"
              fontFamily={pagePsName} fontSize={effectiveFontSize * 0.98}
              fill={palette.pageBg} opacity={0.004}>
              {slot.line.lineGlyph}
            </SvgText>
          );
        })}
        {khatmahMarkers?.endVerseKey && page.slots.map((slot) => {
          if (slot.kind !== 'verse_line') return null;
          if (!slot.line.verseKeys.includes(khatmahMarkers.endVerseKey)) return null;
          const layout = slotLayouts[slot.slotNumber - 1];
          if (!layout) return null;
          return (
            <SvgText key={`km-e-p1-${slot.slotNumber}`}
              ref={(el: any) => { kmEndFullLineRefs.current[slot.slotNumber] = el; }}
              x={Math.round(width / 2)} y={layout.baselineY} textAnchor="middle"
              fontFamily={pagePsName} fontSize={effectiveFontSize * 0.98}
              fill={palette.pageBg} opacity={0.004}>
              {slot.line.lineGlyph}
            </SvgText>
          );
        })}

        {/* ── Khatmah hidden elements: phase-2 frag+prefix ────────────────── */}
        {khatmahMarkers?.startVerseKey && kmStartLineBboxes?.verseKey === khatmahMarkers.startVerseKey && kmStartLineBboxes?.pageNumber === page.pageNumber && page.slots.map((slot) => {
          if (slot.kind !== 'verse_line' || slot.line.verseKeys.length === 1) return null;
          const vk = khatmahMarkers.startVerseKey;
          if (!slot.line.verseKeys.includes(vk) || !kmStartLineBboxes!.bboxes[slot.slotNumber]) return null;
          const layout = slotLayouts[slot.slotNumber - 1]; if (!layout) return null;
          const activeIdx = slot.line.verseKeys.indexOf(vk); const isLead = activeIdx === 0;
          const activeGlyphs = slot.line.words.filter(w => w.verseKey === vk).map(w => w.glyph).join('');
          if (!activeGlyphs) return null;
          const prefixGlyphs = isLead ? null : slot.line.words.filter(w => slot.line.verseKeys.indexOf(w.verseKey) <= activeIdx).map(w => w.glyph).join('');
          const sp = { x: Math.round(width / 2), y: layout.baselineY, textAnchor: 'middle' as const, fontFamily: pagePsName, fontSize: effectiveFontSize * 0.98, fill: palette.pageBg, opacity: 0.004 };
          return (
            <React.Fragment key={`km-s-p2-${slot.slotNumber}`}>
              <SvgText ref={(el: any) => { kmStartFragRefs.current[`ks_${slot.slotNumber}_${vk}`] = el; }} {...sp}>{activeGlyphs}</SvgText>
              {!isLead && prefixGlyphs ? <SvgText ref={(el: any) => { kmStartPrefixRefs.current[`ks_pfx_${slot.slotNumber}_${vk}`] = el; }} {...sp}>{prefixGlyphs}</SvgText> : null}
            </React.Fragment>
          );
        })}
        {khatmahMarkers?.endVerseKey && kmEndLineBboxes?.verseKey === khatmahMarkers.endVerseKey && kmEndLineBboxes?.pageNumber === page.pageNumber && page.slots.map((slot) => {
          if (slot.kind !== 'verse_line' || slot.line.verseKeys.length === 1) return null;
          const vk = khatmahMarkers.endVerseKey;
          if (!slot.line.verseKeys.includes(vk) || !kmEndLineBboxes!.bboxes[slot.slotNumber]) return null;
          const layout = slotLayouts[slot.slotNumber - 1]; if (!layout) return null;
          const activeIdx = slot.line.verseKeys.indexOf(vk); const isLead = activeIdx === 0;
          const activeGlyphs = slot.line.words.filter(w => w.verseKey === vk).map(w => w.glyph).join('');
          if (!activeGlyphs) return null;
          const prefixGlyphs = isLead ? null : slot.line.words.filter(w => slot.line.verseKeys.indexOf(w.verseKey) <= activeIdx).map(w => w.glyph).join('');
          const sp = { x: Math.round(width / 2), y: layout.baselineY, textAnchor: 'middle' as const, fontFamily: pagePsName, fontSize: effectiveFontSize * 0.98, fill: palette.pageBg, opacity: 0.004 };
          return (
            <React.Fragment key={`km-e-p2-${slot.slotNumber}`}>
              <SvgText ref={(el: any) => { kmEndFragRefs.current[`ke_${slot.slotNumber}_${vk}`] = el; }} {...sp}>{activeGlyphs}</SvgText>
              {!isLead && prefixGlyphs ? <SvgText ref={(el: any) => { kmEndPrefixRefs.current[`ke_pfx_${slot.slotNumber}_${vk}`] = el; }} {...sp}>{prefixGlyphs}</SvgText> : null}
            </React.Fragment>
          );
        })}
      </Svg>

      {/* Surah headers are rendered inside <Svg> via renderSurahHeaderSlot */}

      {/* ── Page metadata overlay ── */}
      <View
        style={[
          styles.overlay,
          { paddingTop: insets.top + 6, paddingBottom: insets.bottom + 4 },
        ]}
        pointerEvents="none"
      >
        {/* Top row: surah name (left) | time (absolute center) | juz (right) */}
        <View style={styles.metaTop}>
          <Text style={[styles.metaText, styles.metaSide, { color: metaColor, fontSize: screenWidth ? 16 : 12 }]} numberOfLines={1}>
            {surahName}
          </Text>
          <Text style={[styles.metaText, styles.metaCenter, { color: metaColor, fontSize: screenWidth ? 16 : 12 }]}>
            {time}
          </Text>
          <Text style={[styles.metaText, styles.metaSide, styles.metaSideRight, { color: metaColor, fontSize: screenWidth ? 16 : 12 }]} numberOfLines={1}>
            {`Juz ${juzId}`}
          </Text>
        </View>

        {/* Bottom row: page number pill — left on even pages, right on odd pages */}
        <View style={isEvenPage ? styles.metaBottomLeft : styles.metaBottomRight}>
          <View style={[styles.pageNumPill, { borderColor: metaColor }]}>
            <Text style={[styles.pageNumText, { color: metaColor }]}>
              {page.pageNumber}
            </Text>
          </View>
        </View>
      </View>

      {/*
       * Debug traceability badge — opacity:0 in production.
       * Set to 1 to verify page number, slot count, word count, font name.
       * Example: p2 · 15slots · 64w · QCFp002
       */}
      <View style={styles.debugBadge} pointerEvents="none">
        <Text style={styles.debugText}>
          {`p${page.pageNumber} · ${page.slots.length}slots · ${page.versePage.wordCount}w · ${pagePsName}`}
        </Text>
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    overflow: 'hidden',
  },
  errorBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 10,
  },
  errorTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FF3B30',
    textAlign: 'center',
  },
  errorBody: {
    fontSize: 11,
    color: '#8E8E93',
    textAlign: 'center',
    lineHeight: 17,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'column',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
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
  metaBottomLeft: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
  },
  metaBottomRight: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  pageNumPill: {
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 5,
    minWidth: 46,
    alignItems: 'center',
  },
  pageNumText: {
    fontSize: 13 * 0.98,
    fontWeight: '400',
  },
  debugBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    opacity: 0,
  },
  debugText: {
    fontSize: 9,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: '#00FF00',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 3,
  },
});
