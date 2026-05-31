/**
 * MasjidTipBubble — small first-run hint shown beneath the masjid icon in the
 * prayer-times topbar. Says "Hitta närmaste masjid", fades in/out, dismisses on
 * tap, and auto-hides after 10 seconds (timer owned by the parent so the AppContext
 * lifecycle rules in CLAUDE.md still hold).
 *
 * Positioning: the bubble anchors to `right: 20` (same as the topbar padding) and
 * the caret sits 96px from the bubble's right edge — lined up with the masjid
 * icon's horizontal center (see app/(tabs)/index.tsx for the math).
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../context/ThemeContext';

// Horizontal distance from the bubble's right edge to the caret center.
// Matches the masjid icon's center: right_padding(20) + settings(19) + gap(18)
// + calendar(28) + gap(18) + masjid/2(13) = 116 from screen right; bubble's
// right edge is at 20, so caret sits at 116 - 20 = 96.
const CARET_RIGHT = 96;

type Props = {
  visible: boolean;
  /** Distance from the top of the parent container to the bubble's top edge. */
  top: number;
  onDismiss: () => void;
};

export default function MasjidTipBubble({ visible, top, onDismiss }: Props) {
  const { theme: T, isDark } = useTheme();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-4)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: visible ? 1 : 0,
        duration: visible ? 220 : 180,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: visible ? 0 : -4,
        duration: visible ? 220 : 180,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, opacity, translateY]);

  // Render-gate so the bubble doesn't intercept taps when fully hidden.
  if (!visible) return null;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        { top, opacity, transform: [{ translateY }] },
      ]}
    >
      {/* Upward caret pointing at the masjid icon */}
      <View
        style={[
          styles.caret,
          { borderBottomColor: T.card, right: CARET_RIGHT - 6 /* caret half-width */ },
        ]}
      />
      <Pressable
        onPress={onDismiss}
        style={[
          styles.bubble,
          {
            backgroundColor: T.card,
            shadowColor: isDark ? '#000' : '#000',
            shadowOpacity: isDark ? 0.4 : 0.12,
          },
        ]}
      >
        <Text style={[styles.text, { color: T.text }]} numberOfLines={1}>
          Hitta närmaste moské
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    right: 20,
    // left intentionally unset → bubble shrinks to its content
    alignItems: 'flex-end',
    zIndex: 50,
    elevation: 50,
  },
  caret: {
    position: 'absolute',
    top: -6,
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderBottomWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  bubble: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    // Subtle shadow per UI rules (no hardcoded colours — shadowColor comes from theme)
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
  },
  text: {
    fontSize: 13,
    fontWeight: '500',
  },
});
