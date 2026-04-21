/**
 * components/DagensKoranversCard.tsx
 *
 * Always shows a Quran verse (Bernström translation) on the home screen.
 * One new verse per day, deterministic — same date always returns same verse.
 * Tapping navigates to the Quran reader at the exact verse + page.
 */

import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@/context/ThemeContext';
import { getDailyQuranVerse } from '@/services/dailyReminder';

export default function DagensKoranversCard() {
  const { theme: T, isDark } = useTheme();
  const router = useRouter();
  const verse = useMemo(() => getDailyQuranVerse(new Date()), []);

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
      <Text style={[styles.title, { color: T.text }]}>Dagens Koranvers</Text>

      {/* Swedish verse text */}
      <Text style={[styles.swedish, { color: T.text }]} numberOfLines={5}>
        {verse.swedish}
      </Text>

      {/* Reference */}
      <Text style={[styles.reference, { color: T.textMuted }]}>
        {verse.surahName} · {verse.surahNumber}:{verse.ayahNumber}
      </Text>

    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 0.5,
    padding: 18,
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
    marginBottom: 14,
  },
  swedish: {
    fontSize: 14,
    lineHeight: 22,
    fontWeight: '400',
    marginBottom: 8,
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
