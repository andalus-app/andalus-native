import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { PrayerPhrase } from '@/data/guides/guideTypes';
import { useTheme } from '@/context/ThemeContext';

type Props = {
  phrase: PrayerPhrase;
};

export default function PrayerPhraseBlock({ phrase }: Props) {
  const { theme: T, isDark } = useTheme();

  const hasContent =
    phrase.transliteration || phrase.meaning || phrase.repeat || phrase.arabic;
  if (!hasContent) return null;

  const blockBg = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)';
  const borderColor = isDark
    ? `${T.accent}44`
    : `${T.accent}33`;

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: blockBg, borderLeftColor: T.accent, borderColor },
      ]}
    >
      {phrase.arabic ? (
        <Text
          style={[styles.arabic, { color: isDark ? '#d4b896' : '#7a5c34' }]}
        >
          {phrase.arabic}
        </Text>
      ) : null}

      {phrase.transliteration ? (
        <Text
          style={[styles.transliteration, { color: T.text }]}
        >
          {phrase.transliteration}
        </Text>
      ) : null}

      {phrase.meaning ? (
        <Text style={[styles.meaning, { color: T.textMuted }]}>
          {phrase.meaning}
        </Text>
      ) : null}

      {phrase.repeat ? (
        <View style={[styles.repeatPill, { backgroundColor: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)' }]}>
          <Text style={[styles.repeatText, { color: T.accent }]}>
            {phrase.repeat}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 10,
    borderWidth: 0.5,
    borderLeftWidth: 2.5,
    padding: 12,
    marginTop: 10,
    gap: 4,
  },
  arabic: {
    fontSize: 18,
    fontWeight: '500',
    textAlign: 'right',
    lineHeight: 28,
    marginBottom: 4,
  },
  transliteration: {
    fontSize: 13,
    fontStyle: 'italic',
    lineHeight: 20,
    letterSpacing: 0.1,
  },
  meaning: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  repeatPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginTop: 6,
  },
  repeatText: {
    fontSize: 11,
    fontWeight: '600',
  },
});
