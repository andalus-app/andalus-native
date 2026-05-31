/**
 * MasjidAddTipBubble — small hint shown next to the "+" FAB on the masjid
 * screen the first time (and then weekly) so the user discovers the "Lägg
 * till en ny masjid" entry-point.
 *
 * Position-less by design: this component just renders the pill + right-caret
 * with an enter/exit animation. The CALLER is responsible for positioning
 * (e.g. via an absolutely-positioned wrapper anchored to the FAB itself).
 * This keeps the bubble glued to the + button regardless of how the bottom
 * sheet height changes, which would otherwise shift any container-relative
 * coordinates out from under it.
 *
 * The parent also owns the auto-dismiss timer (AppContext lifecycle rules
 * in CLAUDE.md — no timers inside reusable components without explicit
 * cleanup); this component only handles its own enter/exit transition.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../context/ThemeContext';

type Props = {
  visible: boolean;
  onDismiss: () => void;
};

export default function MasjidAddTipBubble({ visible, onDismiss }: Props) {
  const { theme: T, isDark } = useTheme();
  const opacity    = useRef(new Animated.Value(0)).current;
  const translateX = useRef(new Animated.Value(6)).current; // slide IN from the right

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: visible ? 1 : 0,
        duration: visible ? 220 : 180,
        useNativeDriver: true,
      }),
      Animated.timing(translateX, {
        toValue: visible ? 0 : 6,
        duration: visible ? 220 : 180,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, opacity, translateX]);

  // Render-gate so a hidden bubble can't intercept taps near the FAB.
  if (!visible) return null;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.row, { opacity, transform: [{ translateX }] }]}
    >
      <Pressable
        onPress={onDismiss}
        style={[
          styles.bubble,
          {
            backgroundColor: T.card,
            shadowColor: '#000',
            shadowOpacity: isDark ? 0.4 : 0.14,
            borderColor: T.border,
          },
        ]}
      >
        <Text style={[styles.text, { color: T.text }]} numberOfLines={1}>
          Lägg till en ny moské
        </Text>
      </Pressable>
      {/* Right-pointing caret — sits flush against the bubble's right edge and
          points toward the + FAB on the parent's right. */}
      <View style={[styles.caret, { borderLeftColor: T.card }]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  bubble: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 0.5,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
  },
  caret: {
    // CSS triangle pointing right: only the LEFT border is coloured, others transparent.
    width: 0,
    height: 0,
    borderTopWidth:    6,
    borderBottomWidth: 6,
    borderLeftWidth:   6,
    borderTopColor:    'transparent',
    borderBottomColor: 'transparent',
  },
  text: {
    fontSize: 13,
    fontWeight: '500',
  },
});
