/**
 * components/NextPrayerCard.tsx
 *
 * "Nästa bön" / "Shuruq" / "Halva natten" card for the home screen.
 *
 * DATA SOURCE: reads exclusively from AppContext (useApp()) — the same single
 * source of truth as the prayer times tab. No new API calls, no new fetches.
 *
 * - Shows next prayer/time, its clock time, and live countdown (updates every 1 s).
 * - Circular progress ring (react-native-svg) shows time remaining in the
 *   current interval.
 * - Section label adapts:
 *     Regular prayers (Fajr, Dhuhr, Asr, Maghrib, Isha) → "NÄSTA BÖN"
 *     Sunrise                                            → "TID KVAR TILL SHURUQ"
 *     Half the night                                     → "TID KVAR TILL HALVA NATTEN"
 * - Location row at bottom-left uses the location.svg pin shape.
 * - Countdown format: "1t 12m" / "45m" / "50s" (Swedish: t = timmar, m = minuter, s = sekunder).
 * - When < 60 s remain, display switches to seconds so the user can see the exact
 *   moment the prayer switches. The 1 s interval guarantees the transition happens
 *   at the correct second and the ring refills immediately for the next prayer.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Easing, AppState, type AppStateStatus } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
import { useRouter } from 'expo-router';
import { useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';

// ── Internal constants ─────────────────────────────────────────────────────────

// Same order as Bönetider-fliken (index.tsx) — Midnight included in main loop
const PRAYER_ORDER = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha', 'Midnight'] as const;

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
  Sunrise:  'TID KVAR TILL',
  Dhuhr:    'NÄSTA BÖN',
  Asr:      'NÄSTA BÖN',
  Maghrib:  'NÄSTA BÖN',
  Isha:     'NÄSTA BÖN',
  Midnight: 'TID KVAR TILL',
};

const RING_SIZE    = 110;
const STROKE_W     = 10;
const RING_RADIUS  = (RING_SIZE - STROKE_W * 2) / 2;
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

/** "HH:MM" → minuter sedan midnatt (samma som index.tsx toMin) */
function toMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/** "HH:MM" → sekunder sedan midnatt */
function secsFromStr(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 3600 + m * 60;
}

/** Nuvarande tid i minuter (för jämförelse med bönetider) */
function nowMin(): number {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
}

/** Nuvarande tid i sekunder (för nedräkning med sekundprecision) */
function nowSecs(): number {
  const n = new Date();
  return n.getHours() * 3600 + n.getMinutes() * 60 + n.getSeconds();
}

type PrayerInfo = {
  key: string;
  timeStr: string;
  remainingSecs: number;
  progress: number; // 1 = interval just started, 0 = imminent
};

/**
 * Samma logik som getNextPrayer i index.tsx — itererar PRAYER_ORDER i ordning
 * och returnerar den första bönen som ännu inte trätt in.
 * Midnight hanteras i huvudloopen, inte som ett specialfall.
 */
function getNextPrayerInfo(
  timings: Record<string, string>,
  tomorrowTimings: Record<string, string> | null,
): PrayerInfo {
  const nowM = nowMin();
  const nowS = nowSecs();
  const clamp = (v: number) => Math.max(0, Math.min(1, v));

  for (let i = 0; i < PRAYER_ORDER.length; i++) {
    const key = PRAYER_ORDER[i];
    if (!timings[key]) continue;
    const pMin = toMin(timings[key]);

    // Midnight kan vara tidig morgon (t.ex. "00:15" vintertid) — wraps past 00:00.
    // I Sverige på sommaren är den sen kväll (t.ex. "23:32") och hanteras av pMin > nowM.
    if (key === 'Midnight' && pMin < 12 * 60) {
      const ishaSecs = timings['Isha'] ? secsFromStr(timings['Isha']) : nowS;
      const remSecs  = pMin * 60 + 24 * 3600 - nowS;
      const total    = Math.max(1, pMin * 60 + 24 * 3600 - ishaSecs);
      return { key, timeStr: timings[key], remainingSecs: remSecs, progress: clamp(remSecs / total) };
    }

    if (pMin > nowM) {
      const prevKey  = i > 0 ? PRAYER_ORDER[i - 1] : null;
      const prevSecs = prevKey && timings[prevKey] ? secsFromStr(timings[prevKey]) : nowS - 3600;
      const remSecs  = pMin * 60 - nowS;
      const total    = Math.max(1, pMin * 60 - prevSecs);
      return { key, timeStr: timings[key], remainingSecs: remSecs, progress: clamp(remSecs / total) };
    }
  }

  // Alla bönetider passerade → imorgons Fajr
  const fajrStr  = tomorrowTimings?.['Fajr'] ?? timings['Fajr'];
  const fajrSecs = secsFromStr(fajrStr) + 24 * 3600;
  const ishaSecs = timings['Isha'] ? secsFromStr(timings['Isha']) : nowS;
  const remSecs  = fajrSecs - nowS;
  const total    = Math.max(1, fajrSecs - ishaSecs);
  return { key: 'Fajr', timeStr: fajrStr, remainingSecs: remSecs, progress: clamp(remSecs / total) };
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

  // ── Background CPU fix (cpulimit isolation, 2026-05-02) ────────────────────
  //
  // This card is mounted on the home tab and STAYS MOUNTED in the navigation
  // stack background when the user is on /quran. Without an AppState gate,
  // the 1-second tick + the per-tick `Animated.timing` with
  // `useNativeDriver: false` drove the SVG `<Circle>`'s `strokeDashoffset` at
  // 60 fps in the background — every frame cloned the RNSVGCircle shadow node,
  // triggered a Yoga layout cascade, and committed a new Fabric mount.
  //
  // Time Profiler trace 2026-05-02 confirmed this was the cpulimit cause for
  // Quran background audio (kill at ~1 min). Gate both the timer AND the
  // animation on AppState === 'active'. When backgrounded:
  //   • clearInterval stops the per-second tick
  //   • Animated.stopAnimation() halts the in-flight 950ms / 2500ms tween
  // On foreground return: the tick restarts and the next animation snaps the
  // ring to the current target with the regular 950ms tween.
  //
  // This card is purely a visual countdown — pausing it while the screen is
  // locked has zero functional cost. The user wakes up, the ring updates.
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      setAppActive(state === 'active');
    });
    return () => sub.remove();
  }, []);

  // 1-second interval — ensures prayer transitions happen at the exact second
  // and the seconds countdown (< 60 s) is always accurate. Paused when
  // backgrounded so we don't burn the audio-background CPU budget.
  useEffect(() => {
    if (!appActive) return;
    setInfo(computeState());
    const id = setInterval(() => setInfo(computeState()), 1_000);
    return () => clearInterval(id);
  }, [computeState, appActive]);

  // Animated dashOffset — smoothly interpolates the ring between 1-second ticks
  // so it moves continuously instead of jumping once per second (ticking effect).
  // When the prayer key changes (new interval starts), the ring plays a 2.5 s
  // fill-up animation from empty → full before settling into normal ticking.
  const dashOffsetAnim = useRef(new Animated.Value(0)).current;
  const dashOffsetInitialized = useRef(false);
  const prevPrayerKey = useRef<string | null>(null);

  useEffect(() => {
    // Background guard: stop any in-flight tween and skip starting a new one.
    // The animation will resume naturally on the next foreground tick.
    if (!appActive) {
      dashOffsetAnim.stopAnimation();
      return;
    }

    const target = info ? CIRCUMFERENCE * (1 - info.progress) : 0;

    if (!dashOffsetInitialized.current) {
      dashOffsetAnim.setValue(target);
      dashOffsetInitialized.current = true;
      prevPrayerKey.current = info?.key ?? null;
      return;
    }

    const prayerChanged = info?.key !== prevPrayerKey.current;
    prevPrayerKey.current = info?.key ?? null;

    if (prayerChanged) {
      // New prayer interval: start from an empty ring and fill up over 2.5 s
      dashOffsetAnim.stopAnimation();
      dashOffsetAnim.setValue(CIRCUMFERENCE);
      Animated.timing(dashOffsetAnim, {
        toValue: target,
        duration: 2500,
        useNativeDriver: false,
        easing: Easing.out(Easing.cubic),
      }).start();
    } else {
      // Normal per-second tick: animate smoothly to next position
      Animated.timing(dashOffsetAnim, {
        toValue: target,
        duration: 950,
        useNativeDriver: false,
        easing: Easing.linear,
      }).start();
    }
  }, [info, appActive, dashOffsetAnim]);

  // ── Derived display values ─────────────────────────────────────────────────

  const goldColor = isDark ? '#cab488' : T.accent;

  // Location: rawCity is already "subLocality, city" or just "city" from prayerApi.reverseGeocode.
  // Show both parts — ort first, then stad.
  const cityDisplay = app.location?.city ?? '';

  const dashOffset = info ? CIRCUMFERENCE * (1 - info.progress) : 0;

  const remainingSecs = info?.remainingSecs ?? 0;
  const ringHours = Math.floor(remainingSecs / 3600);
  const ringMins  = Math.floor((remainingSecs % 3600) / 60);

  // Countdown text: seconds when < 60 s remain, otherwise "Xh Ym" / "Ym"
  let countdownText: string;
  if (remainingSecs < 60) {
    countdownText = `${remainingSecs}s`;
  } else if (ringHours > 0) {
    countdownText = `${ringHours}t ${String(ringMins).padStart(2, '0')}m`;
  } else {
    countdownText = `${ringMins}m`;
  }

  const sectionLabel = info ? (SECTION_LABEL[info.key] ?? 'NÄSTA BÖN') : 'NÄSTA BÖN';
  const displayName  = info ? (DISPLAY_NAME[info.key]  ?? info.key)    : '…';

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!app.prayerTimes || !info) {
    return (
      <View style={[styles.card, styles.cardPlaceholder, { backgroundColor: T.card, borderColor: T.border }]} />
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
          shadowOpacity: isDark ? 0.10 : 0.18,
          shadowRadius: isDark ? 18 : 24,
        },
      ]}
    >
      {/* Section label */}
      <Text style={[styles.label, { color: T.textMuted }]}>{sectionLabel}</Text>

      {/* Main row: prayer info (left) + progress ring (right) */}
      <View style={styles.mainRow}>
        {/* Left: prayer name + time */}
        <View style={styles.rightCol}>
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
            <AnimatedCircle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              stroke={goldColor}
              strokeWidth={STROKE_W + 8}
              strokeOpacity={0.13}
              fill="none"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={dashOffsetAnim}
              strokeLinecap="round"
              transform={`rotate(-90, ${RING_SIZE / 2}, ${RING_SIZE / 2})`}
            />
            {/* Inner glow */}
            <AnimatedCircle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              stroke={goldColor}
              strokeWidth={STROKE_W + 3}
              strokeOpacity={0.28}
              fill="none"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={dashOffsetAnim}
              strokeLinecap="round"
              transform={`rotate(-90, ${RING_SIZE / 2}, ${RING_SIZE / 2})`}
            />
            {/* Main arc */}
            <AnimatedCircle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              stroke={goldColor}
              strokeWidth={STROKE_W}
              fill="none"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={dashOffsetAnim}
              strokeLinecap="round"
              transform={`rotate(-90, ${RING_SIZE / 2}, ${RING_SIZE / 2})`}
            />
          </Svg>
          <View style={styles.ringTextContainer}>
            <Text style={[styles.ringLine, { color: goldColor }]}>
              {countdownText}
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
    paddingHorizontal: 14,
    paddingTop: 0,
    paddingBottom: 0,
    marginBottom: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  cardPlaceholder: {
    height: 118,
    marginBottom: 12,
  },
  label: {
  fontSize: 10,
  fontWeight: '700',
  letterSpacing: 1.2,
  marginTop: 0,
  position: 'relative',
  top: 8,
  marginBottom: 0,
},
  mainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rightCol: {
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
  marginTop: -2,
},
  ringTextContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringLine: {
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 18,
  },
locationRow: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 4,
  position: 'relative',
  top: -8,
},
  locationText: {
    fontSize: 11,
    fontWeight: '700',
    opacity: 0.65,
  },
});
