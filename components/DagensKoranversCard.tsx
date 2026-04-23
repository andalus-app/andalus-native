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
import { Animated, AppState, AppStateStatus, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@/context/ThemeContext';
import { getDailyQuranVerse } from '@/services/dailyReminder';

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
      // Schedule next midnight after updating
      scheduleMidnight();
    }, msUntilMidnight());
  }, [fadeAndUpdate]);

  useEffect(() => {
    scheduleMidnight();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [scheduleMidnight]);

  // Catch midnight crossings while app was in background
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
          borderColor: T.border,
          shadowColor: isDark ? '#000' : '#1a1a1a',
        },
      ]}
    >
      <Animated.View style={{ opacity }}>
        <Text style={[styles.title, { color: T.text }]}>Dagens Koranvers</Text>

        {/* Swedish verse text */}
        <Text
          style={[styles.swedish, { color: T.text }]}
          numberOfLines={expanded ? undefined : 3}
          onTextLayout={e => { if (!expanded) setTruncated(e.nativeEvent.lines.length > 3); }}
        >
          {verse.swedish}
        </Text>
        {!expanded && truncated && (
          <TouchableOpacity onPress={e => { e.stopPropagation?.(); setExpanded(true); }} activeOpacity={0.7} style={{ alignSelf: 'center', marginTop: -5 }}>
            <Text style={{ fontSize: 12, color: T.accent }}>Visa mer</Text>
          </TouchableOpacity>
        )}

        {/* Reference */}
        <Text style={[styles.reference, { color: T.textMuted }]}>
          {verse.surahName} · {verse.surahNumber}:{verse.ayahNumber}
        </Text>
      </Animated.View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 0.5,
    paddingHorizontal: 18,
paddingTop: 12,
paddingBottom: 12,
    marginBottom: 12,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.10,
    shadowRadius: 18,
    elevation: 3,
  },
 title: {
  fontSize: 15,
  fontWeight: '700',
  letterSpacing: 0.1,
  textAlign: 'center',
  marginBottom: 6,
},
  swedish: {
    fontSize: 14,
    lineHeight: 22,
    fontWeight: '400',
    marginBottom: 8,
    minHeight: 66, // 3 lines × lineHeight 22 — keeps card height static
  },
  reference: {
    fontSize: 12,
    fontWeight: '500',
    fontStyle: 'italic',
    opacity: 0.65,
  },
  hintRow: {
    alignItems: 'center',
    marginTop: 14,
  },
  hint: {
    fontSize: 11,
    fontWeight: '500',
    opacity: 0.45,
  },
});
