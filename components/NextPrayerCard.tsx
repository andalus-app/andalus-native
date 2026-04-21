/**
 * components/NextPrayerCard.tsx
 *
 * "Nästa bön" / "Shuruq" / "Halva natten" card for the home screen.
 *
 * DATA SOURCE: reads exclusively from AppContext (useApp()) — the same single
 * source of truth as the prayer times tab. No new API calls, no new fetches.
 *
 * - Shows next prayer/time, its clock time, and live countdown (updates every 60 s).
 * - Circular progress ring (react-native-svg) shows time remaining in the
 *   current interval.
 * - Section label adapts:
 *     Regular prayers (Fajr, Dhuhr, Asr, Maghrib, Isha) → "NÄSTA BÖN"
 *     Sunrise                                            → "TID KVAR TILL SHURUQ"
 *     Half the night                                     → "TID KVAR TILL HALVA NATTEN"
 * - Location row at bottom-left uses the location.svg pin shape.
 * - Countdown format: "1t 12m" / "45m" (Swedish: t = timmar, m = minuter).
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useRouter } from 'expo-router';
import { useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';

// ── Internal constants ─────────────────────────────────────────────────────────

// Ordered sequence within a day (Midnight handled separately — it wraps past 00:00)
const DAY_KEYS = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'] as const;

const DISPLAY_NAME: Record<string, string> = {
  Fajr:     'Fajr',
  Sunrise:  'Shuruq',
  Dhuhr:    'Dhuhr',
  Asr:      'Asr',
  Maghrib:  'Maghrib',
  Isha:     'Isha',
  Midnight: 'Halva natten',
};

const SECTION_LABEL: Record<string, string> = {
  Fajr:     'NÄSTA BÖN',
  Sunrise:  'TID KVAR TILL SHURUQ',
  Dhuhr:    'NÄSTA BÖN',
  Asr:      'NÄSTA BÖN',
  Maghrib:  'NÄSTA BÖN',
  Isha:     'NÄSTA BÖN',
  Midnight: 'TID KVAR TILL HALVA NATTEN',
};

const RING_SIZE   = 76;
const STROKE_W    = 5;
const RING_RADIUS = (RING_SIZE - STROKE_W * 2) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

// SVG path from /Downloads/location.svg (viewBox 0 0 24 24)
const LOCATION_PATH =
  'M12,2C8.7,2,6,4.7,6,8c0,5.2,6,11.1,6,11.1s6-6,6-11.1C18,4.7,15.3,2,12,2z ' +
  'M12,5.9c1.1,0,2.1,1,2.1,2.1c0,1.2-0.9,2.1-2.1,2.1S9.9,9.1,9.9,8C9.9,6.8,10.9,5.9,12,5.9z ' +
  'M6.8,15.1c-1.3,0.3-2.3,0.6-3.2,1c-0.4,0.2-0.8,0.5-1.1,0.8S2,17.8,2,18.3c0,0.8,0.5,1.4,1.1,1.8 ' +
  's1.3,0.7,2.2,1C7.1,21.7,9.4,22,12,22s4.9-0.3,6.7-0.8c0.9-0.3,1.6-0.6,2.2-1s1.1-1,1.1-1.8 ' +
  'c0-1-0.8-1.7-1.6-2.2c-0.8-0.5-1.9-0.8-3.2-1l-0.3,2c1.1,0.2,2,0.5,2.6,0.8c0.4,0.2,0.5,0.4,0.6,0.4 ' +
  'c0,0-0.1,0.1-0.2,0.2c-0.3,0.2-0.9,0.5-1.6,0.7C16.6,19.7,14.4,20,12,20s-4.6-0.3-6.1-0.8 ' +
  'c-0.7-0.2-1.3-0.5-1.6-0.7c-0.1-0.1-0.2-0.2-0.2-0.2c0.1-0.1,0.2-0.2,0.5-0.4c0.6-0.3,1.5-0.6,2.7-0.8L6.8,15.1z';

// ── Helpers ────────────────────────────────────────────────────────────────────

function minsFromStr(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function nowMins(): number {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
}

type PrayerInfo = {
  key: string;
  timeStr: string;
  remainingMins: number;
  progress: number; // 1 = interval just started, 0 = imminent
};

function getNextPrayerInfo(
  timings: Record<string, string>,
  tomorrowTimings: Record<string, string> | null,
): PrayerInfo {
  const now = nowMins();

  // Step 1: Find next among Fajr → Sunrise → Dhuhr → Asr → Maghrib → Isha
  for (let i = 0; i < DAY_KEYS.length; i++) {
    const key = DAY_KEYS[i];
    if (!timings[key]) continue;
    const pMins = minsFromStr(timings[key]);
    if (pMins > now) {
      const prevKey  = i > 0 ? DAY_KEYS[i - 1] : null;
      const prevMins = prevKey && timings[prevKey] ? minsFromStr(timings[prevKey]) : now - 60;
      const remaining = pMins - now;
      const total     = Math.max(1, pMins - prevMins);
      return {
        key,
        timeStr:       timings[key],
        remainingMins: remaining,
        progress:      Math.max(0, Math.min(1, remaining / total)),
      };
    }
  }

  // Step 2: Midnight (Halva natten) — typically early AM, comes after Isha.
  // aladhan returns Midnight as e.g. "00:15". Since it wraps past midnight we
  // add 24 h to its minutes so it sits after all daytime prayers in the ordering.
  if (timings['Midnight']) {
    const midRaw = minsFromStr(timings['Midnight']);
    if (midRaw < 12 * 60) {
      // Midnight is in early AM — it's still in the future relative to now (late PM)
      const remaining = midRaw + 24 * 60 - now;
      const ishaMins  = timings['Isha'] ? minsFromStr(timings['Isha']) : now;
      const total     = Math.max(1, midRaw + 24 * 60 - ishaMins);
      return {
        key:           'Midnight',
        timeStr:       timings['Midnight'],
        remainingMins: remaining,
        progress:      Math.max(0, Math.min(1, remaining / total)),
      };
    }
  }

  // Step 3: All times passed → next is tomorrow's Fajr
  const fajrStr  = tomorrowTimings?.['Fajr'] ?? timings['Fajr'];
  const fajrMins = minsFromStr(fajrStr) + 24 * 60;
  const ishaMins = timings['Isha'] ? minsFromStr(timings['Isha']) : now;
  const remaining = fajrMins - now;
  const total     = Math.max(1, fajrMins - ishaMins);
  return {
    key:           'Fajr',
    timeStr:       fajrStr,
    remainingMins: remaining,
    progress:      Math.max(0, Math.min(1, remaining / total)),
  };
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function NextPrayerCard() {
  const { theme: T, isDark } = useTheme();
  const app = useApp();
  const router = useRouter();

  const computeState = useCallback(() => {
    if (!app.prayerTimes) return null;
    return getNextPrayerInfo(app.prayerTimes, app.tomorrowTimes ?? null);
  }, [app.prayerTimes, app.tomorrowTimes]);

  const [info, setInfo] = useState<PrayerInfo | null>(() => computeState());

  useEffect(() => {
    setInfo(computeState());
    const id = setInterval(() => setInfo(computeState()), 60_000);
    return () => clearInterval(id);
  }, [computeState]);

  // ── Derived display values ─────────────────────────────────────────────────

  const goldColor = isDark ? '#cab488' : T.accent;

  const rawCity     = app.location?.city ?? '';
  const cityDisplay = rawCity.includes(', ')
    ? rawCity.split(', ').slice(1).join(', ')
    : rawCity;

  const dashOffset = info ? CIRCUMFERENCE * (1 - info.progress) : 0;
  const ringHours  = info ? Math.floor(info.remainingMins / 60) : 0;
  const ringMins   = info ? info.remainingMins % 60 : 0;

  const sectionLabel = info ? (SECTION_LABEL[info.key] ?? 'NÄSTA BÖN') : 'NÄSTA BÖN';
  const displayName  = info ? (DISPLAY_NAME[info.key]  ?? info.key)    : '…';

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!app.prayerTimes || !info) {
    return (
      <TouchableOpacity
        activeOpacity={0.75}
        onPress={() => router.push('/(tabs)/' as any)}
        style={[styles.card, { backgroundColor: T.card, borderColor: T.border }]}
      >
        <Text style={[styles.label, { color: T.textMuted }]}>NÄSTA BÖN</Text>
        <Text style={[styles.prayerName, { color: T.text, marginTop: 4 }]}>Laddar…</Text>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={() => router.push('/(tabs)/' as any)}
      style={[
        styles.card,
        {
          backgroundColor: T.card,
          borderColor: T.border,
          shadowColor: isDark ? '#000' : '#1a1a1a',
        },
      ]}
    >
      {/* Section label */}
      <Text style={[styles.label, { color: T.textMuted }]}>{sectionLabel}</Text>

      {/* Main row: prayer info (left) + progress ring (right) */}
      <View style={styles.mainRow}>
        {/* Left: prayer name + time */}
        <View style={styles.leftCol}>
          <Text style={[styles.prayerName, { color: goldColor }]}>
            {displayName}
          </Text>
          <Text style={[styles.prayerTime, { color: goldColor }]}>
            {info.timeStr}
          </Text>
        </View>

        {/* Right: SVG ring with countdown inside */}
        <View style={styles.ringContainer}>
          <Svg width={RING_SIZE} height={RING_SIZE} style={StyleSheet.absoluteFill}>
            {/* Track */}
            <Circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              stroke={T.accent + '28'}
              strokeWidth={STROKE_W}
              fill="none"
            />
            {/* Outer glow */}
            <Circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              stroke={goldColor}
              strokeWidth={STROKE_W + 7}
              strokeOpacity={0.13}
              fill="none"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              transform={`rotate(-90, ${RING_SIZE / 2}, ${RING_SIZE / 2})`}
            />
            {/* Inner glow */}
            <Circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              stroke={goldColor}
              strokeWidth={STROKE_W + 3}
              strokeOpacity={0.28}
              fill="none"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              transform={`rotate(-90, ${RING_SIZE / 2}, ${RING_SIZE / 2})`}
            />
            {/* Main arc */}
            <Circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              stroke={goldColor}
              strokeWidth={STROKE_W}
              fill="none"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              transform={`rotate(-90, ${RING_SIZE / 2}, ${RING_SIZE / 2})`}
            />
          </Svg>
          <View style={styles.ringTextContainer}>
            <Text style={[styles.ringLine, { color: goldColor }]}>
              {ringHours > 0
                ? `${ringHours}t ${String(ringMins).padStart(2, '0')}m`
                : `${ringMins}m`}
            </Text>
          </View>
        </View>
      </View>

      {/* Location row */}
      {cityDisplay ? (
        <View style={styles.locationRow}>
          <Svg width={11} height={11} viewBox="0 0 24 24">
            <Path d={LOCATION_PATH} fill={T.textMuted} />
          </Svg>
          <Text style={[styles.locationText, { color: T.textMuted }]}>
            {cityDisplay}
          </Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 0.5,
    padding: 14,
    marginBottom: 12,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.10,
    shadowRadius: 18,
    elevation: 3,
  },
  label: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  mainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  leftCol: {
    flex: 1,
    gap: 2,
  },
  prayerName: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  prayerTime: {
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  ringContainer: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringTextContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringLine: {
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 14,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
  },
  locationText: {
    fontSize: 11,
    fontWeight: '500',
    opacity: 0.65,
  },
});
