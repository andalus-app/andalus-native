/**
 * KhatmahQuickComplete
 *
 * Small pill button "Markera som klar" shown just below the Quran header
 * when khatmah is active and chrome is visible (single-tap on the page).
 *
 * Pressing it fires a strong haptic, shows the animated checkmark overlay,
 * then advances the khatmah to the next day and navigates to its first page —
 * exactly the same behaviour as the button inside the Khatmah side panel.
 *
 * This component is self-contained: it reads `khatmahRange` (from QuranContext,
 * to know whether khatmah is active) and calls `useKhatmah()` for the actual
 * state mutation.  It is rendered inside the chrome overlay so it fades
 * together with the header and audio player.
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useQuranContext } from '../../context/QuranContext';
import { useKhatmah } from '../../hooks/quran/useKhatmah';
import { fetchVersePage, getComposedPageSync } from '../../services/mushafApi';
import KhatmahCompleteAnimation from './KhatmahCompleteAnimation';

// ── Constants ─────────────────────────────────────────────────────────────────

// QuranHeader height = insets.top + paddingTop(6) + rowHeight(48) = insets.top + 54
const HEADER_HEIGHT_BELOW_INSET = 54;
const GAP_BELOW_HEADER          = 8;

// ── Component ─────────────────────────────────────────────────────────────────

export default function KhatmahQuickComplete() {
  const insets = useSafeAreaInsets();
  const { khatmahRange, setKhatmahRange, goToPage, chromeVisible, currentPage } = useQuranContext();
  const { khatmah, markCurrentDayComplete } = useKhatmah();

  const [showAnim, setShowAnim] = useState(false);

  // Only show the pill when the current page actually contains the end verse.
  // Uses the synchronous in-memory page cache — the displayed page is always
  // cached, so this is a zero-cost lookup with no async or state involved.
  const isOnEndPage = useMemo(() => {
    if (!khatmahRange) return false;
    const composed = getComposedPageSync(currentPage);
    if (!composed) return false;
    return composed.slots.some(
      (s) => s.kind === 'verse_line' &&
             s.line.verseKeys.includes(khatmahRange.endVerseKey),
    );
  }, [khatmahRange, currentPage]);

  const handlePress = useCallback(() => {
    if (!khatmah) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    setShowAnim(true);
  }, [khatmah]);

  const handleAnimDone = useCallback(async () => {
    setShowAnim(false);
    if (!khatmah) return;

    const nextDayNum = khatmah.currentDay + 1;
    const nextRange  = khatmah.dayRanges.find((r) => r.dayNumber === nextDayNum);

    await markCurrentDayComplete();

    if (nextRange && nextDayNum <= khatmah.totalDays) {
      setKhatmahRange({
        startVerseKey: `${nextRange.startSurahId}:${nextRange.startAyah}`,
        endVerseKey:   `${nextRange.endSurahId}:${nextRange.endAyah}`,
        dayNumber:     nextRange.dayNumber,
      });
      const startKey = `${nextRange.startSurahId}:${nextRange.startAyah}`;
      fetchVersePage(startKey, nextRange.startPage)
        .then((p) => goToPage(p))
        .catch(() => goToPage(nextRange.startPage));
    }
  }, [khatmah, markCurrentDayComplete, setKhatmahRange, goToPage]);

  // Only render when khatmah is active, chrome is visible,
  // and the current page is the one that contains the day's end verse.
  if (!khatmahRange || !chromeVisible || !isOnEndPage) return null;

  const pillTop = insets.top + HEADER_HEIGHT_BELOW_INSET + GAP_BELOW_HEADER;

  return (
    <>
      <View style={[styles.pillWrapper, { top: pillTop }]} pointerEvents="box-none">
        <TouchableOpacity
          style={styles.pill}
          onPress={handlePress}
          activeOpacity={0.82}
        >
          <Text style={styles.pillText}>Markera som klar</Text>
        </TouchableOpacity>
      </View>

      {showAnim && <KhatmahCompleteAnimation onDone={handleAnimDone} />}
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  pillWrapper: {
    position:       'absolute',
    left:           0,
    right:          0,
    alignItems:     'center',
    // pointerEvents box-none so touches outside the pill pass through
  },
  pill: {
    backgroundColor:  'rgba(102,132,104,0.92)',
    borderRadius:     20,
    paddingVertical:  9,
    paddingHorizontal: 20,
    shadowColor:     '#000',
    shadowOffset:    { width: 0, height: 3 },
    shadowOpacity:   0.28,
    shadowRadius:    8,
    elevation:       6,
  },
  pillText: {
    color:         '#FFFFFF',
    fontSize:      14,
    fontWeight:    '600',
    letterSpacing: 0.1,
  },
});
