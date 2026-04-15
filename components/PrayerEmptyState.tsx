/**
 * PrayerEmptyState
 *
 * Shown on the Prayer Times screen when:
 *   - autoLocation is OFF
 *   - AND no manual city has been saved
 *
 * Provides two paths forward:
 *   1. "Sök efter stad"  → CitySearchModal (reuses exact same component as Settings)
 *   2. "Använd min plats" → GPS permission + one-time location fetch (only on tap)
 *
 * Parent (index.tsx) owns the data-save and reload logic.
 * This component is pure UI + local modal state.
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, Animated,
  StyleSheet, ActivityIndicator,
} from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import CitySearchModal, { type CityResult } from './CitySearchModal';

interface Props {
  T: {
    text:         string;
    textSecondary?: string;
    textMuted:    string;
    accent:       string;
    accentGlow:   string;
    card:         string;
    border:       string;
    bg:           string;
    separator?:   string;
  };
  onCitySelected: (r: CityResult) => void;
  onUseGPS:       () => void;
  gpsLoading:     boolean;
}

export default function PrayerEmptyState({ T, onCitySelected, onUseGPS, gpsLoading }: Props) {
  const fadeAnim    = useRef(new Animated.Value(0)).current;
  const pulseAnim   = useRef(new Animated.Value(1)).current;
  const btnScale    = useRef(new Animated.Value(1)).current;
  const [cityModalOpen, setCityModal] = useState(false);

  // ── Fade in on mount ────────────────────────────────────────────────────────
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1, duration: 420, delay: 80, useNativeDriver: true,
    }).start();
  }, []);

  // ── Gentle pulse on icon glow ───────────────────────────────────────────────
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.22, duration: 1600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1.00, duration: 1600, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  // ── City selected ───────────────────────────────────────────────────────────
  const handleCitySelected = useCallback((r: CityResult) => {
    setCityModal(false);
    onCitySelected(r);
  }, [onCitySelected]);

  // ── Button press scale ──────────────────────────────────────────────────────
  const onPressIn  = useCallback(() => {
    Animated.spring(btnScale, { toValue: 0.97, useNativeDriver: true, friction: 5, tension: 180 }).start();
  }, []);
  const onPressOut = useCallback(() => {
    Animated.spring(btnScale, { toValue: 1.00, useNativeDriver: true, friction: 5, tension: 180 }).start();
  }, []);

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>

      {/* ── Icon with glow ─────────────────────────────────────────────────── */}
      <View style={styles.iconWrapper}>
        {/* Outer pulse ring */}
        <Animated.View
          style={[
            styles.glowRing,
            {
              backgroundColor: T.accentGlow,
              transform: [{ scale: pulseAnim }],
            },
          ]}
        />
        {/* Icon circle */}
        <View style={[styles.iconCircle, { backgroundColor: T.accentGlow }]}>
          <Svg width={38} height={38} viewBox="0 0 40 40" fill="none">
            <Path
              d="M20 3C12.27 3 6 9.27 6 17C6 27.5 20 37 20 37C20 37 34 27.5 34 17C34 9.27 27.73 3 20 3Z"
              fill={T.accent}
              fillOpacity={0.16}
            />
            <Path
              d="M20 3C12.27 3 6 9.27 6 17C6 27.5 20 37 20 37C20 37 34 27.5 34 17C34 9.27 27.73 3 20 3Z"
              stroke={T.accent}
              strokeWidth={1.6}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <Circle cx={20} cy={17} r={5} fill={T.accent} />
          </Svg>
        </View>
      </View>

      {/* ── Title ─────────────────────────────────────────────────────────── */}
      <Text style={[styles.title, { color: T.text }]}>
        Välj din plats för att{'\n'}se bönetider
      </Text>

      {/* ── Description ───────────────────────────────────────────────────── */}
      <Text style={[styles.description, { color: T.textSecondary ?? T.textMuted }]}>
        För att visa korrekta bönetider behöver vi din plats eller att du väljer en stad manuellt.
      </Text>

      {/* ── Primary button: Sök efter stad ───────────────────────────────── */}
      <Animated.View style={[styles.btnFull, { transform: [{ scale: btnScale }] }]}>
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: T.accent }]}
          onPress={() => setCityModal(true)}
          onPressIn={onPressIn}
          onPressOut={onPressOut}
          activeOpacity={1}
        >
          <Text style={styles.primaryBtnText}>Sök efter stad</Text>
        </TouchableOpacity>
      </Animated.View>

      {/* ── Secondary button: Använd min plats ───────────────────────────── */}
      <TouchableOpacity
        style={[styles.secondaryBtn, { borderColor: T.accent + '44' }]}
        onPress={onUseGPS}
        disabled={gpsLoading}
        activeOpacity={0.72}
      >
        {gpsLoading ? (
          <ActivityIndicator size="small" color={T.accent} />
        ) : (
          <Text style={[styles.secondaryBtnText, { color: T.accent }]}>
            Använd min plats
          </Text>
        )}
      </TouchableOpacity>

      {/* ── City search modal (identical to Settings) ─────────────────────── */}
      <CitySearchModal
        visible={cityModalOpen}
        onClose={() => setCityModal(false)}
        onSelect={handleCitySelected}
        T={T}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex:              1,
    alignItems:        'center',
    justifyContent:    'center',
    paddingHorizontal: 36,
    paddingBottom:     80,
  },
  iconWrapper: {
    width:           104,
    height:          104,
    alignItems:      'center',
    justifyContent:  'center',
    marginBottom:    32,
  },
  glowRing: {
    position:     'absolute',
    width:        96,
    height:       96,
    borderRadius: 48,
  },
  iconCircle: {
    width:           72,
    height:          72,
    borderRadius:    36,
    alignItems:      'center',
    justifyContent:  'center',
  },
  title: {
    fontSize:      23,
    fontWeight:    '600',
    textAlign:     'center',
    marginBottom:  12,
    lineHeight:    32,
    letterSpacing: -0.3,
  },
  description: {
    fontSize:          15,
    lineHeight:        23,
    textAlign:         'center',
    marginBottom:      40,
    maxWidth:          270,
  },
  btnFull: {
    width: '100%',
  },
  primaryBtn: {
    borderRadius:    16,
    paddingVertical: 15,
    alignItems:      'center',
    marginBottom:    12,
    shadowColor:     '#000',
    shadowOffset:    { width: 0, height: 4 },
    shadowOpacity:   0.18,
    shadowRadius:    12,
  },
  primaryBtnText: {
    color:         '#FFFFFF',
    fontSize:      16,
    fontWeight:    '600',
    letterSpacing: 0.1,
  },
  secondaryBtn: {
    borderRadius:    16,
    paddingVertical: 14,
    alignItems:      'center',
    justifyContent:  'center',
    borderWidth:     1,
    width:           '100%',
    minHeight:       50,
  },
  secondaryBtnText: {
    fontSize:   15,
    fontWeight: '500',
  },
});
