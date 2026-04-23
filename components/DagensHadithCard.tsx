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
  const [dateKey, setDateKey] = useState<string>(todayStr);
  const opacity = useRef(new Animated.Value(1)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dateKeyRef = useRef<string>(dateKey);

  const [expanded,  setExpanded]  = useState(false);
  const [truncated, setTruncated] = useState(false);

  const hadith = useMemo(() => getDailyHadith(new Date()), [dateKey]); // eslint-disable-line react-hooks/exhaustive-deps

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

        <View style={expanded ? undefined : styles.textContainer}>
          <Text
            style={[styles.swedish, { color: T.text }]}
            numberOfLines={expanded ? undefined : 3}
            onTextLayout={e => { if (!expanded) setTruncated(e.nativeEvent.lines.length > 3); }}
          >
            {hadith.svenska}
          </Text>
        </View>
        {truncated && (
          <TouchableOpacity
            onPress={e => { e.stopPropagation?.(); setExpanded(v => !v); }}
            activeOpacity={0.7}
            style={styles.visaMerBtn}
          >
            <Text style={{ fontSize: 12, color: T.text }}>{expanded ? 'Visa mindre' : 'Visa mer'}</Text>
          </TouchableOpacity>
        )}

        <Text style={[styles.source, { color: T.textMuted }]}>
          {hadith.kalla}
        </Text>
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
  textContainer: {
    height: 63,
    overflow: 'hidden',
    marginBottom: 5,
  },
  visaMerBtn: {
    alignSelf: 'flex-start',
    marginTop: 2,
    marginBottom: 3,
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
