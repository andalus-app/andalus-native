/**
 * components/DagensKoranversCard.tsx
 *
 * Always shows a Quran verse (Bernström translation) on the home screen.
 * One new verse per day, deterministic — same date always returns same verse.
 * Tapping navigates to the Quran reader at the exact verse + page.
 *
 * Automatically updates at midnight with a fade-out/fade-in transition,
 * even when the app stays open across midnight.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, AppState, AppStateStatus, Text, TouchableOpacity, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@/context/ThemeContext';
import { getDailyQuranVerse } from '@/services/dailyReminder';
import { prewarmDailyVerseTarget } from '@/services/quranPrewarmService';

const GOLD_DARK = '#cab488';
const COLLAPSED_HEIGHT = 78; // 3 lines × lineHeight(24) + 6px buffer

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function msUntilMidnight(): number {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight.getTime() - now.getTime();
}

function AccentDivider({ color, small }: { color: string; small?: boolean }) {
  return (
    <View style={[styles.dividerRow, small && styles.dividerRowSmall]}>
      <View style={[styles.dividerLine, { backgroundColor: color }]} />
      <Text style={[styles.dividerDot, { color }]}>◆</Text>
      <View style={[styles.dividerLine, { backgroundColor: color }]} />
    </View>
  );
}

function DagensKoranversCard() {
  const { theme: T, isDark } = useTheme();
  const router = useRouter();
  const [dateKey, setDateKey] = useState<string>(todayStr);
  const [expanded,   setExpanded]   = useState(false);
  const [truncated,  setTruncated]  = useState(false);
  const [fullHeight, setFullHeight] = useState(0);

  // Height animation — useNativeDriver:false required for layout properties
  const animHeight = useRef(new Animated.Value(COLLAPSED_HEIGHT)).current;
  const expandedRef = useRef(false);

  const opacity = useRef(new Animated.Value(1)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dateKeyRef = useRef<string>(dateKey);

  const verse = useMemo(() => getDailyQuranVerse(new Date()), [dateKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-warm Quran page fonts + data for today's verse so the reader opens
  // instantly. Fires once per day (date-keyed session guard in the service),
  // deferred via InteractionManager so it never blocks the home screen render.
  useEffect(() => {
    prewarmDailyVerseTarget(verse.verseKey);
  }, [verse.verseKey]);

  const accentColor = isDark ? GOLD_DARK : T.accent;
  const verseColor  = isDark ? '#FFFFFF' : T.text;
  const borderSideColor = isDark ? 'rgba(202,180,136,0.18)' : 'rgba(36,100,93,0.18)';

  // Toggle expand/collapse with spring animation
  const toggleExpanded = useCallback(() => {
    const next = !expandedRef.current;
    expandedRef.current = next;
    setExpanded(next);
    Animated.spring(animHeight, {
      toValue: next ? fullHeight : COLLAPSED_HEIGHT,
      useNativeDriver: false,
      damping: 18,
      stiffness: 120,
      mass: 0.8,
    }).start();
  }, [animHeight, fullHeight]);

  // When fullHeight becomes known (after first measure), keep anim in sync
  useEffect(() => {
    if (fullHeight > 0 && !expandedRef.current) {
      animHeight.setValue(COLLAPSED_HEIGHT);
    }
  }, [fullHeight, animHeight]);

  const fadeAndUpdate = useCallback(() => {
    Animated.timing(opacity, {
      toValue: 0,
      duration: 400,
      useNativeDriver: true,
    }).start(() => {
      const newKey = todayStr();
      dateKeyRef.current = newKey;
      setDateKey(newKey);
      expandedRef.current = false;
      setExpanded(false);
      setTruncated(false);
      animHeight.setValue(COLLAPSED_HEIGHT);
      Animated.timing(opacity, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }).start();
    });
  }, [opacity, animHeight]);

  const scheduleMidnight = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      fadeAndUpdate();
      scheduleMidnight();
    }, msUntilMidnight());
  }, [fadeAndUpdate]);

  useEffect(() => {
    scheduleMidnight();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [scheduleMidnight]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        const current = todayStr();
        if (current !== dateKeyRef.current) {
          fadeAndUpdate();
          scheduleMidnight();
        }
      }
    });
    return () => sub.remove();
  }, [fadeAndUpdate, scheduleMidnight]);

  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={() => router.push(`${verse.navigationPath}&nonce=${Date.now()}` as any)}
      style={[
        styles.card,
        {
          backgroundColor: T.card,
          borderColor: borderSideColor,
          borderTopColor: isDark ? 'rgba(201,168,76,0.78)' : T.accent,
          borderTopWidth: 1,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 3 },
          shadowOpacity: isDark ? 0.05 : 0.09,
          shadowRadius: isDark ? 10 : 14,
        },
      ]}
    >
      <Animated.View style={{ opacity }}>
        <Text style={[styles.title, { color: accentColor }]}>Dagens Koranvers</Text>

        {/* Hidden full-height measurer — absolutely positioned, no clipping.
            Reports true line count AND full natural height for the animation. */}
        <Text
          style={[styles.swedish, styles.measuringText]}
          onTextLayout={e => {
            const lines = e.nativeEvent.lines;
            setTruncated(lines.length > 3);
            if (lines.length > 0) {
              const last = lines[lines.length - 1];
              const measured = Math.ceil(last.y + last.height);
              if (measured > COLLAPSED_HEIGHT) setFullHeight(measured);
            }
          }}
          accessible={false}
        >
          {verse.swedish}
        </Text>

        {/* Animated height container — clips text only when truncated */}
        <Animated.View
          style={truncated ? [styles.verseContainerTruncated, { height: animHeight }] : undefined}
        >
          <Text
            style={[styles.swedish, { color: verseColor }]}
            numberOfLines={truncated && !expanded ? 3 : undefined}
          >
            {verse.swedish}
          </Text>
        </Animated.View>

        {truncated ? (
          // Large tap zone when the verse text is truncated: covers the Visa mer/Visa
          // mindre label + AccentDivider + reference text in one target.
          // stopPropagation ensures the outer TouchableOpacity (navigate to Quran) is
          // suppressed whenever the user taps anywhere in this bottom section.
          <TouchableOpacity
            onPress={e => { e.stopPropagation?.(); toggleExpanded(); }}
            activeOpacity={0.7}
            style={styles.expandZone}
          >
            <Text style={[styles.visaMerLabel, { color: accentColor }]}>
              {expanded ? 'Visa mindre' : 'Visa mer'}
            </Text>
            <Text style={[styles.reference, { color: verseColor }]}>
              {verse.surahName} · {verse.displayRef}
            </Text>
          </TouchableOpacity>
        ) : (
          <Text style={[styles.reference, { color: verseColor }]}>
            {verse.surahName} · {verse.surahNumber}:{verse.ayahNumber}
          </Text>
        )}
      </Animated.View>
    </TouchableOpacity>
  );
}
export default React.memo(DagensKoranversCard);

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    borderWidth: 0.5,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 8,
    marginBottom: 16,
    elevation: 2,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 7,
  },
  dividerRowSmall: {
    marginTop: 4,
    marginBottom: 4,
    alignSelf: 'center',
    width: '50%',
  },
  dividerLine: {
    flex: 1,
    height: 0.5,
    opacity: 0.55,
  },
  dividerDot: {
    fontSize: 7,
    marginHorizontal: 6,
    opacity: 0.85,
  },
  title: {
    fontSize: 19,
    fontWeight: '700',
    letterSpacing: 0.2,
    textAlign: 'center',
    marginBottom: 6,
  },
  measuringText: {
    position: 'absolute',
    opacity: 0,
    top: 0,
    pointerEvents: 'none',
  },
  verseContainerTruncated: {
    overflow: 'hidden',
  },
  expandZone: {
    marginTop: -6,
  },
  visaMerLabel: {
    fontSize: 12,
    textAlign: 'center',
    alignSelf: 'center',
    marginBottom: 0,
  },
  swedish: {
    fontSize: 14.5,
    lineHeight: 24,
    fontWeight: '400',
    textAlign: 'center',
  },
  reference: {
    fontSize: 12,
    fontWeight: '500',
    fontStyle: 'italic',
    textAlign: 'center',
    opacity: 0.70,
  },
});
