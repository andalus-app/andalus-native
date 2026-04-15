/**
 * UmrahCounter — large, clear round/leg counter for Tawaf and Sa'i.
 * Haptic feedback on each increment. Obvious completion state.
 */

import React, { memo, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, Animated, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { UmrahTheme } from './umrahTheme';
import type { CounterConfig } from '@/data/umrahGuideData';

type Props = {
  T:       UmrahTheme;
  config:  CounterConfig;
  value:   number;
  onChange: (newValue: number) => void;
};

function UmrahCounter({ T, config, value, onChange }: Props) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const isComplete = value > config.maxValue;

  const label = isComplete
    ? config.completionMessage
    : config.currentLabelTemplate.replace('{current}', String(value));

  const handleIncrement = useCallback(() => {
    if (value > config.maxValue) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Pulse animation
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.92, duration: 80, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, bounciness: 8, useNativeDriver: true }),
    ]).start();

    onChange(Math.min(value + 1, config.maxValue + 1));
  }, [value, config.maxValue, scaleAnim, onChange]);

  const handleDecrement = useCallback(() => {
    if (value <= config.minValue) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onChange(Math.max(value - 1, config.minValue));
  }, [value, config.minValue, onChange]);

  const handleReset = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    onChange(config.startValue);
  }, [config.startValue, onChange]);

  const bgColor = isComplete ? T.important : T.counterBg;

  return (
    <View style={[styles.card, { backgroundColor: T.card, borderColor: T.border }]}>
      <Text style={[styles.counterTitle, { color: T.textMuted, fontSize: Math.round(12 * T.fontScale) }]}>
        {config.title}
      </Text>

      {/* Counter display */}
      <Animated.View
        style={[
          styles.counterCircle,
          { backgroundColor: bgColor, transform: [{ scale: scaleAnim }] },
        ]}
      >
        {isComplete ? (
          <Text style={styles.checkMark}>✓</Text>
        ) : (
          <Text style={styles.counterNumber}>{value}</Text>
        )}
        <Text style={styles.counterOf}>av {config.maxValue}</Text>
      </Animated.View>

      {/* Status label */}
      <Text style={[
        styles.statusLabel,
        { color: isComplete ? T.important : T.text, fontSize: Math.round(16 * T.fontScale), lineHeight: Math.round(22 * T.fontScale) },
      ]}>
        {label}
      </Text>

      {/* Dot progress */}
      {!isComplete && (
        <View style={styles.dotsRow}>
          {Array.from({ length: config.maxValue }, (_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                {
                  backgroundColor: i < value - 1
                    ? T.progressFill
                    : i === value - 1
                      ? T.progressFill
                      : T.progressTrack,
                  width: i === value - 1 ? 14 : 8,
                  opacity: i < value - 1 ? 1 : i === value - 1 ? 1 : 0.4,
                },
              ]}
            />
          ))}
        </View>
      )}

      {/* Buttons */}
      <View style={styles.btnRow}>
        {!isComplete ? (
          <>
            <TouchableOpacity
              onPress={handleDecrement}
              activeOpacity={0.7}
              style={[
                styles.secondaryBtn,
                {
                  borderColor: T.border,
                  opacity: value <= config.minValue ? 0.3 : 1,
                },
              ]}
            >
              <Text style={[styles.secondaryBtnText, { color: T.text }]}>
                −
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleIncrement}
              activeOpacity={0.7}
              style={[styles.primaryBtn, { backgroundColor: T.counterBtn }]}
            >
              <Text style={[styles.primaryBtnText, { color: T.counterBtnText, fontSize: Math.round(16 * T.fontScale) }]}>
                {config.incrementButtonLabel}
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            onPress={handleReset}
            activeOpacity={0.7}
            style={[styles.resetBtn, { borderColor: T.border }]}
          >
            <Text style={[styles.resetBtnText, { color: T.textMuted, fontSize: Math.round(14 * T.fontScale) }]}>
              Börja om
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius:   16,
    borderWidth:    0.5,
    padding:        20,
    alignItems:     'center',
    marginBottom:   12,
    shadowOffset:   { width: 0, height: 4 },
    shadowOpacity:  0.10,
    shadowRadius:   12,
  },
  counterTitle: {
    fontSize:     12,
    fontWeight:   '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 20,
  },
  counterCircle: {
    width:        120,
    height:       120,
    borderRadius: 60,
    alignItems:   'center',
    justifyContent: 'center',
    marginBottom: 18,
    shadowOffset:  { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius:  14,
  },
  counterNumber: {
    color:        '#FFFFFF',
    fontSize:     52,
    fontWeight:   '700',
    letterSpacing: -2,
    lineHeight:   58,
    marginBottom: -4,
  },
  counterOf: {
    color:      'rgba(255,255,255,0.65)',
    fontSize:   12,
    fontWeight: '500',
  },
  checkMark: {
    color:      '#FFFFFF',
    fontSize:   52,
    fontWeight: '700',
  },
  statusLabel: {
    fontSize:     16,
    fontWeight:   '600',
    textAlign:    'center',
    marginBottom: 16,
    letterSpacing: -0.2,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems:    'center',
    marginBottom:  20,
    gap:           6,
  },
  dot: {
    height:       8,
    borderRadius: 4,
  },
  btnRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           10,
    width:         '100%',
  },
  primaryBtn: {
    flex:          1,
    height:        50,
    borderRadius:  14,
    alignItems:    'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    fontSize:   16,
    fontWeight: '600',
  },
  secondaryBtn: {
    width:         50,
    height:        50,
    borderRadius:  14,
    borderWidth:   0.5,
    alignItems:    'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    fontSize:   22,
    lineHeight: 26,
    fontWeight: '400',
  },
  resetBtn: {
    flex:          1,
    height:        44,
    borderRadius:  12,
    borderWidth:   0.5,
    alignItems:    'center',
    justifyContent: 'center',
  },
  resetBtnText: {
    fontSize:   14,
    fontWeight: '500',
  },
});

export default memo(UmrahCounter);
