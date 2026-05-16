import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { rakahInfo } from '@/data/guides/prayerGuide';
import { useTheme } from '@/context/ThemeContext';

export default function RakAhSummaryCard() {
  const { theme: T, isDark } = useTheme();

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: T.card,
          borderColor: T.border,
          shadowColor: '#000',
          shadowOpacity: isDark ? 0.18 : 0.06,
        },
      ]}
    >
      <Text style={[styles.title, { color: T.textMuted }]}>
        Antal rak&#39;ah per bön
      </Text>
      <View style={styles.row}>
        {rakahInfo.map((item) => (
          <View
            key={item.prayerName}
            style={[
              styles.pill,
              {
                backgroundColor: isDark
                  ? 'rgba(255,255,255,0.05)'
                  : 'rgba(0,0,0,0.04)',
                borderColor: T.border,
              },
            ]}
          >
            <Text style={[styles.pillName, { color: T.textMuted }]}>
              {item.prayerName}
            </Text>
            <Text style={[styles.pillCount, { color: T.accent }]}>
              {item.rakahCount}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 0.5,
    padding: 14,
    marginBottom: 12,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 1,
  },
  title: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    borderRadius: 10,
    borderWidth: 0.5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignItems: 'center',
    minWidth: 56,
  },
  pillName: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.1,
  },
  pillCount: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.5,
    lineHeight: 26,
  },
});
