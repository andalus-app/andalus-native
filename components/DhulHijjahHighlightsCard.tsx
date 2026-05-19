import React, { useMemo } from 'react';
import { View, Text, useWindowDimensions } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useApp } from '../context/AppContext';

const GOLD = '#c9a84c';

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

type CardState = 'today' | 'past' | 'upcoming';

type Props = { testMode?: boolean };

// ── date helpers ─────────────────────────────────────────────────────────────

function getDhulHijjahData(hijriDate: any, testMode: boolean) {
  const today = new Date();

  if (testMode) {
    const day1 = addDays(today, -1); // dag 2 → dag 1 var igår
    return { day1, day9: addDays(day1, 8), day10: addDays(day1, 9), currentDay: 2 };
  }

  if (!hijriDate || hijriDate.month?.number !== 12) return null;
  const d = parseInt(String(hijriDate.day), 10);
  if (isNaN(d) || d < 1 || d > 9) return null;

  // Anchor: today is day d, so day 1 was (d-1) days ago
  const day1 = addDays(today, -(d - 1));
  return { day1, day9: addDays(day1, 8), day10: addDays(day1, 9), currentDay: d };
}

// ── component ─────────────────────────────────────────────────────────────────

export default function DhulHijjahHighlightsCard({ testMode = false }: Props) {
  const { theme: T, isDark } = useTheme();
  const { hijriDate } = useApp();
  const { width: screenWidth } = useWindowDimensions();

  const data = useMemo(
    () => getDhulHijjahData(hijriDate, testMode),
    [hijriDate, testMode],
  );

  if (!data) return null;

  const { day1, day9, day10, currentDay } = data;

  const CARD_GAP = 8;
  const CARD_W   = Math.floor((screenWidth - 32 - CARD_GAP * 2) / 3);

  // Per-card accent definitions
  const tealAccent  = T.accent;
  const tealBg      = isDark ? 'rgba(102,132,104,0.14)' : 'rgba(36,100,93,0.08)';
  const tealBorder  = isDark ? 'rgba(102,132,104,0.32)' : 'rgba(36,100,93,0.22)';
  const goldBg      = isDark ? 'rgba(201,168,76,0.11)' : 'rgba(201,168,76,0.07)';
  const goldBorder  = 'rgba(201,168,76,0.32)';

  const entries = [
    {
      date: day1,       hijriDay: 1,
      hijriLabel: '1 Dhul Hijjah',
      description: 'Första dagen i månaden Dhul Hijjah',
      accent: tealAccent, accentBg: tealBg, accentBorder: tealBorder,
    },
    {
      date: day9,       hijriDay: 9,
      hijriLabel: '9 Dhul Hijjah',
      description: 'Arafah-dagen',
      accent: GOLD, accentBg: goldBg, accentBorder: goldBorder,
    },
    {
      date: day10,      hijriDay: 10,
      hijriLabel: '10 Dhul Hijjah',
      description: 'Eid Al-Adha',
      accent: GOLD, accentBg: goldBg, accentBorder: goldBorder,
    },
  ];

  return (
    <View style={{ marginTop: 4, marginBottom: 4 }}>
      <Text style={{
        fontSize: 12, fontWeight: '600', color: T.textMuted,
        letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 11,
      }}>
        Dhul Hijjah
      </Text>

      <View style={{ flexDirection: 'row', gap: CARD_GAP }}>
        {entries.map(({ date, hijriDay, hijriLabel, description, accent, accentBg, accentBorder }) => {
          const state: CardState =
            (testMode && hijriDay === 2) || currentDay === hijriDay ? 'today'
            : currentDay > hijriDay                                  ? 'past'
            : 'upcoming';
          const isToday = state === 'today';
          const isPast  = state === 'past';

          const weekday = capitalize(date.toLocaleDateString('sv-SE', { weekday: 'long' }));
          const dayNum  = date.getDate();
          const month   = capitalize(date.toLocaleDateString('sv-SE', { month: 'long' }));

          // Colors derived from state
          const cardBg         = isToday ? accentBg : T.card;
          const cardBorderClr  = isToday ? accentBorder : T.border;
          const topBorderClr   = isPast ? T.border : isToday ? accent : (accent + '70');
          const topBorderW     = isToday ? 2 : 1;
          const dayNumClr      = isPast ? T.textMuted : T.text;
          const labelClr       = isPast ? T.textMuted : accent;

          return (
            <View key={hijriDay} style={{ width: CARD_W }}>
              {/* Card */}
              <View style={{
                backgroundColor: cardBg,
                borderRadius: 14,
                borderWidth: 0.5,
                borderColor: cardBorderClr,
                borderTopWidth: topBorderW,
                borderTopColor: topBorderClr,
                paddingHorizontal: 8,
                paddingTop: 10,
                paddingBottom: 10,
                alignItems: 'center',
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 3 },
                shadowOpacity: isDark ? 0.05 : 0.09,
                shadowRadius: isDark ? 10 : 14,
                elevation: 2,
                marginBottom: 6,
              }}>
                {/* Glow dot — today indicator */}
                {isToday && (
                  <View style={{
                    position: 'absolute', top: 8, right: 8,
                    width: 5, height: 5, borderRadius: 3,
                    backgroundColor: accent,
                  }} />
                )}

                {/* Weekday */}
                <Text
                  style={{ fontSize: 10, fontWeight: '500', color: T.textMuted, textAlign: 'center', marginBottom: 2 }}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.65}
                >
                  {weekday}
                </Text>

                {/* Date number — focal point */}
                <Text style={{
                  fontSize: 36, fontWeight: '700', lineHeight: 42,
                  color: dayNumClr, textAlign: 'center',
                }}>
                  {dayNum}
                </Text>

                {/* Month */}
                <Text style={{ fontSize: 11, color: T.textMuted, textAlign: 'center', marginBottom: 7 }}>
                  {month}
                </Text>

                {/* Divider */}
                <View style={{
                  height: 0.5,
                  backgroundColor: isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.07)',
                  width: '100%', marginBottom: 7,
                }} />

                {/* Hijri label */}
                <Text
                  style={{ fontSize: 9.5, fontWeight: '700', color: labelClr, textAlign: 'center', letterSpacing: 0.1 }}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.68}
                >
                  {hijriLabel}
                </Text>
              </View>

              {/* Description — below card, wraps freely */}
              <Text style={{
                fontSize: 10, color: T.textMuted,
                textAlign: 'center', lineHeight: 14,
                paddingHorizontal: 2,
              }}>
                {description}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}
