/**
 * KhatmahMarkerOverlay.tsx
 *
 * Renders persistent start/end verse markers for the active Khatmah day.
 * Positioned as a React Native View overlay AFTER MushafRenderer so it
 * sits on top of the SVG canvas (which has a full-canvas background Rect).
 *
 * Position arithmetic mirrors VerseHighlightOverlay exactly:
 *   centerY = padV + slot.slotNumber * slotH + verticalShift
 *   top     = centerY − slotH × 0.5
 *   height  = slotH
 *
 * For multi-line verses ALL slots containing the verse are highlighted.
 *
 * For shared lines (N verses per row, RTL) the horizontal rect is derived
 * from per-verse word counts — same proxy used by pickVerseByTouch:
 *   lineRight = width − INSET_H
 *   sumBefore = words of verses to the right of this one (indices 0..i-1)
 *   prefix    = sumBefore + wordsI
 *   rectRight = lineRight − (sumBefore / total) × fullRectW
 *   rectLeft  = lineRight − (prefix    / total) × fullRectW
 */

import React, { memo } from 'react';
import { View } from 'react-native';
import type { MushafSlot } from '../../services/mushafApi';
import { useTheme } from '../../context/ThemeContext';

// ── Constants ─────────────────────────────────────────────────────────────────

const INSET_H  = 12;
const RECT_PAD = 1;  // minimal padding — shadow extends well beyond the rect

// Glow parameters — shadow without offset creates a symmetric halo.
// The background fill must be non-transparent (even slightly) for iOS to
// render the shadow; 7–9 % opacity is invisible against the Mushaf page
// but sufficient to activate the shadow layer.
const GLOW_SHADOW_RADIUS  = 14;
const GLOW_SHADOW_OPACITY = 0.38;

// Stop (end) marker — warm amber glow
const END_SHADOW_COLOR = '#E8900A';
const END_BG_LIGHT     = 'rgba(232,144,10,0.06)';
const END_BG_DARK      = 'rgba(255,149,0,0.09)';

// Start marker — app accent, kept more subtle than end
const START_SHADOW_COLOR = '#668468';
const START_BG_LIGHT     = 'rgba(102,132,104,0.05)';
const START_BG_DARK      = 'rgba(36,180,130,0.07)';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns ALL verse_line slots whose verseKeys include verseKey (multi-line support). */
function findSlots(slots: MushafSlot[], verseKey: string): MushafSlot[] {
  return slots.filter(
    (s) => s.kind === 'verse_line' && s.line.verseKeys.includes(verseKey),
  );
}

/**
 * Returns the vertical rect bounds for a slot.
 * Formula identical to VerseHighlightOverlay.
 */
function slotVertical(
  slot: MushafSlot,
  padV: number,
  slotH: number,
  verticalShift: number,
): { top: number; height: number } {
  const centerY = Math.round(padV + slot.slotNumber * slotH + verticalShift);
  const top     = Math.round(centerY - slotH * 0.5) + RECT_PAD;
  return { top, height: Math.round(slotH) - RECT_PAD * 2 };
}

/**
 * Returns the horizontal rect bounds for a verse within a slot.
 *
 * Pure line  → full usable width.
 * Shared line → proportional width from per-verse word counts (RTL).
 */
function slotHorizontal(
  slot: MushafSlot,
  verseKey: string,
  pageWidth: number,
): { left: number; width: number } {
  if (slot.kind !== 'verse_line') {
    return { left: INSET_H, width: pageWidth - INSET_H * 2 };
  }

  const { verseKeys, words } = slot.line;
  const fullRectW = pageWidth - INSET_H * 2;
  const lineRight = pageWidth - INSET_H;

  if (verseKeys.length <= 1) {
    return { left: INSET_H, width: fullRectW };
  }

  // Count words per verse in RTL order (verseKeys[0] = rightmost)
  const wordCounts = verseKeys.map((vk) => words.filter((w) => w.verseKey === vk).length);
  const total = wordCounts.reduce((a, b) => a + b, 0);

  if (total === 0) return { left: INSET_H, width: fullRectW };

  const idx = verseKeys.indexOf(verseKey);
  if (idx < 0) return { left: INSET_H, width: fullRectW };

  let sumBefore = 0;
  for (let i = 0; i < idx; i++) sumBefore += wordCounts[i];
  const prefixW = sumBefore + wordCounts[idx];

  const rectRight = lineRight - (sumBefore / total) * fullRectW;
  const rectLeft  = lineRight - (prefixW  / total) * fullRectW;
  return { left: rectLeft, width: rectRight - rectLeft };
}

// ── Component ─────────────────────────────────────────────────────────────────

type Props = {
  startVerseKey: string;
  endVerseKey:   string;
  slots:         MushafSlot[];
  width:         number;
  height:        number;
  padV:          number;
  slotH:         number;
  verticalShift: number;
};

export default memo(function KhatmahMarkerOverlay({
  startVerseKey,
  endVerseKey,
  slots,
  width,
  height,
  padV,
  slotH,
  verticalShift,
}: Props) {
  const { isDark } = useTheme();

  const startSlots = findSlots(slots, startVerseKey);
  const endSlots   = findSlots(slots, endVerseKey);

  if (startSlots.length === 0 && endSlots.length === 0) return null;

  return (
    <View
      style={{ position: 'absolute', top: 0, left: 0, width, height, overflow: 'visible' }}
      pointerEvents="none"
    >
      {/* ── Start verse — soft green glow ───────────────────────────── */}
      {startSlots.map((slot) => {
        const { top, height: h } = slotVertical(slot, padV, slotH, verticalShift);
        const { left, width: w } = slotHorizontal(slot, startVerseKey, width);
        return (
          <View
            key={`km-start-${slot.slotNumber}`}
            style={{
              position:      'absolute',
              left,
              width:         w,
              top,
              height:        h,
              borderRadius:  Math.round(h * 0.45),
              backgroundColor: isDark ? START_BG_DARK : START_BG_LIGHT,
              shadowColor:   START_SHADOW_COLOR,
              shadowOffset:  { width: 0, height: 0 },
              shadowRadius:  GLOW_SHADOW_RADIUS,
              shadowOpacity: GLOW_SHADOW_OPACITY,
            }}
          />
        );
      })}

      {/* ── End verse — soft amber glow (where to stop reading) ─────── */}
      {endSlots.map((slot) => {
        const { top, height: h } = slotVertical(slot, padV, slotH, verticalShift);
        const { left, width: w } = slotHorizontal(slot, endVerseKey, width);
        return (
          <View
            key={`km-end-${slot.slotNumber}`}
            style={{
              position:      'absolute',
              left,
              width:         w,
              top,
              height:        h,
              borderRadius:  Math.round(h * 0.45),
              backgroundColor: isDark ? END_BG_DARK : END_BG_LIGHT,
              shadowColor:   END_SHADOW_COLOR,
              shadowOffset:  { width: 0, height: 0 },
              shadowRadius:  GLOW_SHADOW_RADIUS,
              shadowOpacity: GLOW_SHADOW_OPACITY,
            }}
          />
        );
      })}
    </View>
  );
});
