/**
 * components/DagensHadithCard.tsx
 *
 * Displays today's hadith on the home screen.
 * One new hadith per day, deterministic — same date always returns same hadith.
 * Tapping navigates to the Hadithsamling detail screen for that exact hadith.
 *
 * Automatically updates at midnight with a fade-out/fade-in transition,
 * even when the app stays open across midnight.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, AppState, AppStateStatus, Text, TouchableOpacity, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@/context/ThemeContext';
import { getDailyHadith } from '@/services/dailyReminder';

const GOLD_DARK = '#cab488';
const COLLAPSED_HEIGHT = 63;

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

export default function DagensHadithCard() {
  const { theme: T, isDark } = useTheme();
  const router = useRouter();
  const accentColor = isDark ? GOLD_DARK : T.accent;
  const [dateKey, setDateKey] = useState<string>(todayStr);
  const opacity = useRef(new Animated.Value(1)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dateKeyRef = useRef<string>(dateKey);

  const [expanded,   setExpanded]   = useState(false);
  const [truncated,  setTruncated]  = useState(false);
  const [fullHeight, setFullHeight] = useState(0);

  // Height animation — useNativeDriver:false required for layout properties
  const animHeight  = useRef(new Animated.Value(COLLAPSED_HEIGHT)).current;
  const expandedRef = useRef(false);

  const hadith = useMemo(() => getDailyHadith(new Date()), [dateKey]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // When fullHeight becomes known, ensure anim starts at collapsed
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
      onPress={() => router.push(hadith.navigationPath as any)}
      style={[
        styles.card,
        {
          backgroundColor: T.card,
          borderColor: T.border,
          shadowColor: isDark ? '#000' : '#1a1a1a',
          shadowOpacity: isDark ? 0.08 : 0.16,
          shadowRadius: isDark ? 12 : 18,
        },
      ]}
    >
      <Animated.View style={{ opacity }}>
        <Text style={[styles.title, { color: T.text }]}>Dagens Hadith</Text>

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
          {hadith.svenska}
        </Text>

        {/* Animated height container — clips text during animation */}
        <Animated.View style={[styles.textContainer, truncated && { height: animHeight }]}>
          <Text
            style={[styles.swedish, { color: T.text }]}
            numberOfLines={truncated && !expanded ? 3 : undefined}
          >
            {hadith.svenska}
          </Text>
        </Animated.View>

        {truncated ? (
          // Large tap zone: covers Visa mer/mindre label + source text so the user
          // can tap anywhere at the bottom of the card. stopPropagation prevents the
          // outer TouchableOpacity (navigate to Hadithsamling) from firing.
          <TouchableOpacity
            onPress={e => { e.stopPropagation?.(); toggleExpanded(); }}
            activeOpacity={0.7}
            style={styles.expandZone}
          >
            <Text style={[styles.visaMerLabel, { color: accentColor }]}>
              {expanded ? 'Visa mindre' : 'Visa mer'}
            </Text>
            <Text style={[styles.source, { color: T.textMuted }]}>
              {hadith.kalla}
            </Text>
          </TouchableOpacity>
        ) : (
          <Text style={[styles.source, { color: T.textMuted }]}>
            {hadith.kalla}
          </Text>
        )}
      </Animated.View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 0.5,
    paddingHorizontal: 16,
    paddingTop: 11,
    paddingBottom: 11,
    marginBottom: 11,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.1,
    textAlign: 'left',
    marginBottom: 5,
  },
  measuringText: {
    position: 'absolute',
    opacity: 0,
    left: 0,
    right: 0,
    top: 0,
    pointerEvents: 'none',
  },
  textContainer: {
    overflow: 'hidden',
    height: COLLAPSED_HEIGHT,
  },
  expandZone: {
    paddingTop: 4,
  },
  visaMerLabel: {
    fontSize: 12,
    textAlign: 'center',
    alignSelf: 'center',
    marginBottom: 4,
  },
  swedish: {
    fontSize: 13,
    lineHeight: 21,
    fontWeight: '400',
    textAlign: 'left',
  },
  source: {
    fontSize: 12,
    fontWeight: '500',
    fontStyle: 'italic',
    textAlign: 'left',
    opacity: 0.6,
  },
});
