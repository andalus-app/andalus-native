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

const GOLD_DARK = '#cab488';

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

export default function DagensKoranversCard() {
  const { theme: T, isDark } = useTheme();
  const router = useRouter();
  const [dateKey, setDateKey] = useState<string>(todayStr);
  const [expanded,  setExpanded]  = useState(false);
  const [truncated, setTruncated] = useState(false);
  const opacity = useRef(new Animated.Value(1)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dateKeyRef = useRef<string>(dateKey);

  const verse = useMemo(() => getDailyQuranVerse(new Date()), [dateKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const accentColor = isDark ? GOLD_DARK : T.accent;
  const verseColor  = isDark ? '#FFFFFF' : T.text;
  const borderSideColor = isDark ? 'rgba(202,180,136,0.18)' : 'rgba(36,100,93,0.18)';

  const fadeAndUpdate = useCallback(() => {
    Animated.timing(opacity, {
      toValue: 0,
      duration: 400,
      useNativeDriver: true,
    }).start(() => {
      const newKey = todayStr();
      dateKeyRef.current = newKey;
      setDateKey(newKey);
      setExpanded(false);
      setTruncated(false);
      Animated.timing(opacity, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }).start();
    });
  }, [opacity]);

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
      onPress={() => router.push(verse.navigationPath as any)}
      style={[
        styles.card,
        {
          backgroundColor: T.card,
          borderColor: borderSideColor,
          borderTopColor: accentColor,
          borderTopWidth: 3.5,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: isDark ? 0.08 : 0.16,
          shadowRadius: isDark ? 12 : 18,
        },
      ]}
    >
      <Animated.View style={{ opacity }}>
        <Text style={[styles.title, { color: accentColor }]}>Dagens Koranvers</Text>

        {/* Invisible measuring text — absolutely positioned, no height constraint.
            Parent height: 66 on verseContainer constrains the layout pass so
            onTextLayout there only reports 3 lines. This element has no such
            constraint and always reports the true line count. */}
        <Text
          style={[styles.swedish, styles.measuringText]}
          onTextLayout={e => setTruncated(e.nativeEvent.lines.length > 3)}
          accessible={false}
        >
          {verse.swedish}
        </Text>

        {/* Visible text — numberOfLines clips cleanly, container hides overflow */}
        <View style={expanded ? undefined : styles.verseContainer}>
          <Text
            style={[styles.swedish, { color: verseColor }]}
            numberOfLines={expanded ? undefined : 3}
          >
            {verse.swedish}
          </Text>
        </View>
        {truncated ? (
          // Large tap zone when the verse text is truncated: covers the Visa mer/Visa
          // mindre label + AccentDivider + reference text in one target.
          // paddingTop creates the "air gap" above the label so the user never
          // accidentally misses and opens the Quran app via the outer card press.
          // stopPropagation ensures the outer TouchableOpacity (navigate to Quran) is
          // suppressed whenever the user taps anywhere in this bottom section.
          <TouchableOpacity
            onPress={e => { e.stopPropagation?.(); setExpanded(v => !v); }}
            activeOpacity={0.7}
            style={styles.expandZone}
          >
            <Text style={[styles.visaMerLabel, { color: accentColor }]}>
              {expanded ? 'Visa mindre' : 'Visa mer'}
            </Text>
            <AccentDivider color={accentColor} small />
            <Text style={[styles.reference, { color: verseColor }]}>
              {verse.surahName} · {verse.surahNumber}:{verse.ayahNumber}
            </Text>
          </TouchableOpacity>
        ) : (
          <>
            <AccentDivider color={accentColor} small />
            <Text style={[styles.reference, { color: verseColor }]}>
              {verse.surahName} · {verse.surahNumber}:{verse.ayahNumber}
            </Text>
          </>
        )}
      </Animated.View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    borderWidth: 0.5,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 10,
    marginBottom: 12,
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
    left: 0,
    right: 0,
    top: 0,
  },
  verseContainer: {
    height: 66,
    overflow: 'hidden',
  },
  expandZone: {
    // paddingTop creates tap area in the "air" above the Visa mer label so the user
    // doesn't accidentally miss and trigger the outer card's Quran navigation.
    paddingTop: 4,
  },
  visaMerLabel: {
    fontSize: 12,
    textAlign: 'center',
    alignSelf: 'center',
    marginBottom: 0,
  },
  swedish: {
    fontSize: 14.5,
    lineHeight: 22,
    fontWeight: '400',
    textAlign: 'center',
    alignSelf: 'center',
    width: '94%',
  },
  reference: {
    fontSize: 13,
    fontWeight: '500',
    fontStyle: 'italic',
    textAlign: 'center',
    opacity: 0.62,
  },
});
