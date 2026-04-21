/**
 * components/DagensHadithCard.tsx
 *
 * Displays today's hadith on the home screen.
 * One new hadith per day, deterministic — same date always returns same hadith.
 * Tapping navigates to the Hadithsamling detail screen for that exact hadith.
 */

import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@/context/ThemeContext';
import { getDailyHadith } from '@/services/dailyReminder';

export default function DagensHadithCard() {
  const { theme: T, isDark } = useTheme();
  const router = useRouter();
  const hadith = useMemo(() => getDailyHadith(new Date()), []);

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
        },
      ]}
    >
      <Text style={[styles.title, { color: T.text }]}>Dagens Hadith</Text>

      {/* Swedish hadith text */}
      <Text style={[styles.swedish, { color: T.text }]} numberOfLines={4}>
        {hadith.svenska}
      </Text>

      {/* Source */}
      <Text style={[styles.source, { color: T.textMuted }]}>
        {hadith.kalla}
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
  source: {
    fontSize: 12,
    fontWeight: '500',
    fontStyle: 'italic',
    opacity: 0.65,
  },
});
