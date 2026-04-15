/**
 * VerseHighlightOverlay.tsx
 *
 * Absolute-positioned overlay that highlights the Mushaf line(s) of the verse
 * currently being recited. Rendered on top of MushafRenderer's SVG canvas.
 *
 * Position arithmetic mirrors MushafRenderer's computeSlotLayouts() exactly.
 *
 * Slot-filtering and clipping rules:
 *
 *   1. PURE slot (only one verse):
 *      Full-width highlight rect.
 *
 *   2. LEAD + SHARED slot (verseKeys[0] === activeKey, length > 1):
 *      Proportional right-aligned rect. Since Arabic is RTL, the active verse
 *      words sit on the RIGHT portion of the line. We estimate the width ratio
 *      from glyph-character counts: activeGlyphs / totalGlyphs. This is an
 *      approximation (QCF glyphs vary in width) but is far better than a
 *      full-width rect that bleeds into the next verse's territory.
 *
 *   3. NON-LEAD slot (verseKeys[0] !== activeKey):
 *      Skip. The verse continues from a previous line — the previous line
 *      already carries the highlight.
 *
 * Animation:
 *   verse changes → snap opacity to 0 → fade in 220ms (useNativeDriver)
 *   verse clears  → fade out 180ms, then unmount
 */

import React, { useEffect, useRef, useState } from 'react';
import { Animated, View, StyleSheet } from 'react-native';
import type { MushafSlot } from '../../services/mushafApi';

// ── Layout arithmetic (mirrors MushafRenderer) ─────────────────────────────

const TOTAL_SLOTS = 15;

type SlotLayout = { top: number; slotHeight: number };

function computeHighlightLayouts(
  slots: MushafSlot[],
  height: number,
): SlotLayout[] {
  const contentSlots = slots.filter(
    (s) => s.kind === 'verse_line' || s.kind === 'surah_header' || s.kind === 'bismillah',
  );
  const isShortPage = contentSlots.length > 0 && contentSlots.length < TOTAL_SLOTS - 2;

  const padV    = Math.round(height * 0.075);
  const usableH = height - padV * 2;
  let verticalShift = 0;

  if (isShortPage) {
    const slotH    = usableH / TOTAL_SLOTS;
    const slotNums = contentSlots.map((s) => s.slotNumber);
    const first    = Math.min(...slotNums);
    const last     = Math.max(...slotNums);
    verticalShift  = Math.round(height / 2 - padV - ((first + last) / 2) * slotH);
    const topSlotY = padV + first * slotH + verticalShift;
    if (topSlotY < padV) verticalShift -= topSlotY - padV;
  }

  const slotH = usableH / (isShortPage ? TOTAL_SLOTS : TOTAL_SLOTS + 0.5);
  return Array.from({ length: TOTAL_SLOTS }, (_, i) => {
    const centerY = Math.round(padV + (i + 1) * slotH + verticalShift);
    return {
      top:        Math.round(centerY - slotH * 0.5),
      slotHeight: Math.round(slotH),
    };
  });
}

// ── Types ─────────────────────────────────────────────────────────────────────

type HighlightRect = {
  top:    number;
  height: number;
  left:   number;   // screen-left pixel
  width:  number;
};

// ── Component ─────────────────────────────────────────────────────────────────

type Props = {
  activeVerseKey: string | null;
  slots: MushafSlot[];
  width: number;
  height: number;
  isDark: boolean;
};

export default function VerseHighlightOverlay({
  activeVerseKey,
  slots,
  width,
  height,
  isDark,
}: Props) {
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const animRef     = useRef<Animated.CompositeAnimation | null>(null);
  const [renderedVerseKey, setRenderedVerseKey] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    animRef.current?.stop();

    if (!activeVerseKey) {
      animRef.current = Animated.timing(opacityAnim, {
        toValue: 0, duration: 180, useNativeDriver: true,
      });
      animRef.current.start(({ finished }) => { if (finished) setVisible(false); });
      return;
    }

    opacityAnim.setValue(0);
    setRenderedVerseKey(activeVerseKey);
    setVisible(true);

    animRef.current = Animated.timing(opacityAnim, {
      toValue: 1, duration: 220, useNativeDriver: true,
    });
    animRef.current.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVerseKey]);

  if (!visible || !renderedVerseKey) return null;

  const slotLayouts  = computeHighlightLayouts(slots, height);
  const insetH       = 12;
  const fullRectW    = width - insetH * 2;
  const rects: HighlightRect[] = [];

  // ── Bismillah pseudo-key ───────────────────────────────────────────────────
  if (renderedVerseKey.startsWith('BSMLLH_')) {
    const surahId = parseInt(renderedVerseKey.slice(7), 10);
    for (const slot of slots) {
      // Standalone bismillah slot
      if (slot.kind === 'bismillah' && slot.surahId === surahId) {
        const layout = slotLayouts[slot.slotNumber - 1];
        if (!layout) continue;
        rects.push({
          top: layout.top + 2, height: layout.slotHeight - 4,
          left: insetH, width: fullRectW,
        });
      }
      // Embedded bismillah in surah header
      if (slot.kind === 'surah_header' && slot.bismillahEmbedded && slot.surah.id === surahId) {
        const layout = slotLayouts[slot.slotNumber - 1];
        if (!layout) continue;
        const bsmH = Math.round(layout.slotHeight * 0.40);
        rects.push({
          top: layout.top + layout.slotHeight - bsmH + 2,
          height: bsmH - 4,
          left: insetH,
          width: fullRectW,
        });
      }
    }
  } else {
    // ── Regular verse ──────────────────────────────────────────────────────
    for (const slot of slots) {
      if (slot.kind !== 'verse_line') continue;

      const verseKeys   = slot.line.verseKeys;
      const isLead      = verseKeys[0] === renderedVerseKey;
      const isTrailing  = !isLead && verseKeys.includes(renderedVerseKey);

      if (!isLead && !isTrailing) continue;

      const layout = slotLayouts[slot.slotNumber - 1];
      if (!layout) continue;

      const activeGlyphs = slot.line.words
        .filter((w) => w.verseKey === renderedVerseKey)
        .reduce((sum, w) => sum + w.glyph.length, 0);
      const totalGlyphs  = slot.line.lineGlyph.length;
      const ratio        = totalGlyphs > 0 ? activeGlyphs / totalGlyphs : 1;

      if (isLead && verseKeys.length === 1) {
        // PURE slot — entire line belongs to this verse.
        rects.push({
          top: layout.top + 2, height: layout.slotHeight - 4,
          left: insetH, width: fullRectW,
        });
      } else if (isLead) {
        // LEAD of a shared slot: active verse words sit on the RIGHT (RTL).
        const partialW    = Math.max(Math.round(fullRectW * ratio), 40);
        const partialLeft = width - insetH - partialW;
        rects.push({
          top: layout.top + 2, height: layout.slotHeight - 4,
          left: partialLeft, width: partialW,
        });
      } else {
        // TRAILING verse in shared slot: active verse words sit on the LEFT (RTL).
        const partialW = Math.max(Math.round(fullRectW * ratio), 40);
        rects.push({
          top: layout.top + 2, height: layout.slotHeight - 4,
          left: insetH, width: partialW,
        });
      }
    }
  }

  if (!rects.length) return null;

  const fillColor = isDark
    ? 'rgba(255,255,255,0.10)'
    : 'rgba(175,145,90,0.22)';

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, { opacity: opacityAnim }]}
      pointerEvents="none"
    >
      {rects.map((r, i) => (
        <View
          key={i}
          style={{
            position:        'absolute',
            left:            r.left,
            width:           r.width,
            top:             r.top,
            height:          r.height,
            borderRadius:    10,
            backgroundColor: fillColor,
          }}
        />
      ))}
    </Animated.View>
  );
}
