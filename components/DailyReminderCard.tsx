/**
 * components/DailyReminderCard.tsx
 *
 * "Dagens påminnelse" card for the home screen.
 *
 * - Fully offline, no network calls.
 * - Text is displayed EXACTLY as-is from the data — no normalization, trimming,
 *   case changes or any other transformation applied to content strings.
 * - Tapping the card navigates to the correct screen (Quran / Dhikr / Asmaul Husna).
 */

import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@/context/ThemeContext';
import { getDailyReminder, type DailyReminder } from '@/services/dailyReminder';

// ── Per-type UI strings ────────────────────────────────────────────────────────

const CARD_TITLE: Record<DailyReminder['type'], string> = {
  quran: 'Dagens Koranvers',
  dhikr: 'Dagens påminnelse',
  asma:  'Allahs Namn',
};

const TYPE_LABEL: Record<DailyReminder['type'], string> = {
  quran: 'KORANEN',
  dhikr: 'DHIKR',
  asma:  'ALLAHS NAMN',
};

// ── Content sub-components ─────────────────────────────────────────────────────

function QuranContent({
  reminder,
}: {
  reminder: Extract<DailyReminder, { type: 'quran' }>;
}) {
  const { theme: T } = useTheme();
  return (
    <View style={styles.contentBlock}>
      <Text style={[styles.mainText, { color: T.text }]} numberOfLines={5}>
        {reminder.swedish}
      </Text>
      <Text style={[styles.reference, { color: T.textMuted }]}>
        {reminder.surahName} · {reminder.surahNumber}:{reminder.ayahNumber}
      </Text>
    </View>
  );
}

function DhikrContent({
  reminder,
}: {
  reminder: Extract<DailyReminder, { type: 'dhikr' }>;
}) {
  const { theme: T } = useTheme();
  const hasArabic = reminder.arabisk_text.trim().length > 0;

  return (
    <View style={styles.contentBlock}>
      <Text style={[styles.titleText, { color: T.text }]} numberOfLines={2}>
        {reminder.titel}
      </Text>
      {hasArabic && (
        <Text
          style={[styles.arabicText, { color: T.text }]}
          numberOfLines={2}
        >
          {reminder.arabisk_text}
        </Text>
      )}
      <Text
        style={[styles.mainText, { color: T.textMuted }]}
        numberOfLines={3}
      >
        {reminder.svensk_text}
      </Text>
      {reminder.kallhanvisning.trim().length > 0 && (
        <Text style={[styles.reference, { color: T.textMuted }]}>
          {reminder.kallhanvisning}
        </Text>
      )}
    </View>
  );
}

function AsmaContent({
  reminder,
}: {
  reminder: Extract<DailyReminder, { type: 'asma' }>;
}) {
  const { theme: T } = useTheme();

  return (
    <View style={styles.contentBlock}>
      <View style={styles.asmaNameRow}>
        <Text style={[styles.asmaArabic, { color: T.text }]}>
          {reminder.arabic}
        </Text>
        <View style={styles.asmaNameRight}>
          <Text style={[styles.asmaTranslit, { color: T.accent }]}>
            {reminder.transliteration}
          </Text>
          <Text style={[styles.asmaSwedish, { color: T.text }]}>
            {reminder.swedish}
          </Text>
        </View>
      </View>
      <Text
        style={[styles.mainText, { color: T.textMuted }]}
        numberOfLines={3}
      >
        {reminder.forklaring}
      </Text>
      {reminder.koranvers_svenska.trim().length > 0 && (
        <Text style={[styles.reference, { color: T.textMuted }]}>
          {reminder.koranvers_svenska.length > 90
            ? reminder.koranvers_svenska.slice(0, 90) + '…'
            : reminder.koranvers_svenska}
          {reminder.sura_ayat ? ` (${reminder.sura_ayat})` : ''}
        </Text>
      )}
    </View>
  );
}

// ── Main card ──────────────────────────────────────────────────────────────────

export default function DailyReminderCard() {
  const { theme: T, isDark } = useTheme();
  const router = useRouter();

  const reminder  = useMemo(() => getDailyReminder(new Date()), []);
  const cardTitle = CARD_TITLE[reminder.type];
  const typeLabel = TYPE_LABEL[reminder.type];

  const handlePress = () => {
    router.push(reminder.navigationPath as any);
  };

  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={handlePress}
      style={[
        styles.card,
        {
          backgroundColor: T.card,
          borderColor: T.border,
          shadowColor: isDark ? '#000' : '#1a1a1a',
        },
      ]}
    >
      {/* Header — centered title + label badge */}
      <View style={styles.header}>
        <Text style={[styles.cardTitle, { color: T.text }]}>{cardTitle}</Text>
        <View style={[styles.typeBadge, { backgroundColor: T.accent + '1A' }]}>
          <Text style={[styles.typeBadgeText, { color: T.accent }]}>
            {typeLabel}
          </Text>
        </View>
      </View>

      {/* Content */}
      {reminder.type === 'quran' && <QuranContent reminder={reminder} />}
      {reminder.type === 'dhikr' && <DhikrContent reminder={reminder} />}
      {reminder.type === 'asma'  && <AsmaContent  reminder={reminder} />}

      {/* Subtle chevron hint */}
      <View style={styles.chevronRow}>
        <Text style={[styles.chevronHint, { color: T.textMuted }]}>
          Tryck för att öppna
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

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

  // ── Header ──
  header: {
    alignItems: 'center',
    marginBottom: 14,
    gap: 8,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.1,
    textAlign: 'center',
  },
  typeBadge: {
    borderRadius: 6,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  typeBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
  },

  // ── Content ──
  contentBlock: {
    gap: 8,
  },
  titleText: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 22,
  },
  mainText: {
    fontSize: 14,
    lineHeight: 22,
    fontWeight: '400',
  },
  arabicText: {
    fontSize: 19,
    lineHeight: 32,
    fontWeight: '500',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  reference: {
    fontSize: 12,
    fontWeight: '500',
    opacity: 0.65,
    fontStyle: 'italic',
  },

  // ── Asmaul Husna ──
  asmaNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  asmaArabic: {
    fontSize: 34,
    fontWeight: '400',
    writingDirection: 'rtl',
    flexShrink: 0,
  },
  asmaNameRight: {
    flex: 1,
    gap: 3,
  },
  asmaTranslit: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  asmaSwedish: {
    fontSize: 14,
    fontWeight: '500',
  },

  // ── Footer ──
  chevronRow: {
    alignItems: 'center',
    marginTop: 14,
  },
  chevronHint: {
    fontSize: 11,
    fontWeight: '500',
    opacity: 0.45,
  },
});
