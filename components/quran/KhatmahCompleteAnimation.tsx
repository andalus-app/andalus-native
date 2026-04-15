/**
 * KhatmahCompleteAnimation
 *
 * Full-screen animated checkmark overlay.
 * Fades in → draws checkmark → holds → fades out → calls onDone().
 *
 * Shared between KhatmahScreen and KhatmahQuickComplete.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, TouchableOpacity } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

// ── Constants ─────────────────────────────────────────────────────────────────

const AnimatedSvgPath = Animated.createAnimatedComponent(Path);

const CHECK_PATH   = 'M 22 52 L 40 70 L 78 32';
const CHECK_LENGTH = 80;

// ── Component ─────────────────────────────────────────────────────────────────

export default function KhatmahCompleteAnimation({ onDone }: { onDone: () => void }) {
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const drawProgress   = useRef(new Animated.Value(0)).current;
  const onDoneRef      = useRef(onDone);
  onDoneRef.current    = onDone;

  useEffect(() => {
    // 1. Fade in overlay (180ms)
    Animated.timing(overlayOpacity, {
      toValue: 1, duration: 180, useNativeDriver: true,
    }).start(() => {
      // 2. Draw checkmark (440ms, ease-out cubic)
      Animated.timing(drawProgress, {
        toValue: 1, duration: 440,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start(() => {
        // 3. Hold 280ms, then fade out (220ms)
        setTimeout(() => {
          Animated.timing(overlayOpacity, {
            toValue: 0, duration: 220, useNativeDriver: true,
          }).start(() => onDoneRef.current());
        }, 280);
      });
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const strokeDashoffset = drawProgress.interpolate({
    inputRange:  [0, 1],
    outputRange: [CHECK_LENGTH, 0],
  });

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        styles.overlay,
        { opacity: overlayOpacity },
      ]}
    >
      {/* Absorb all touches so the user can't interact during animation */}
      <TouchableOpacity activeOpacity={1} onPress={() => {}} style={StyleSheet.absoluteFill} />
      <Svg width={148} height={148} viewBox="0 0 100 100">
        {/* Glow circle */}
        <Circle cx={50} cy={50} r={44} fill="rgba(102,132,104,0.28)" />
        {/* Accent ring */}
        <Circle cx={50} cy={50} r={44} fill="none" stroke="#668468" strokeWidth={1.5} />
        {/* Animated checkmark */}
        <AnimatedSvgPath
          d={CHECK_PATH}
          stroke="#FFFFFF"
          strokeWidth={6}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          strokeDasharray={CHECK_LENGTH}
          strokeDashoffset={strokeDashoffset}
        />
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    backgroundColor: 'rgba(0,0,0,0.60)',
    alignItems:      'center',
    justifyContent:  'center',
    zIndex:          9999,
  },
});
