/**
 * MasjidOfflineBanner — premium iOS-style "no internet" banner, LOCAL to the
 * Närmaste masjid map feature (not a global/app-wide banner).
 *
 * Driven by the `online` flag the map WebView reports via MasjidMapView's
 * onConnectivity (see masjidMapHtml.ts → {type:'net'}). When connectivity drops
 * it slides down from above into view, just under the safe area (Dynamic Island /
 * status bar); when it returns it slides back up and unmounts. translateY +
 * opacity are native-driven; the wrapper is pointerEvents="none" so it never
 * blocks map interaction. Additive to the map's own skeleton/timeout/error/retry.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import { masjidOfflineColors } from './colors';

const ANIM_MS = 300;
// How far above its resting position the banner starts (off-screen).
const OFFSET = 120;

const log = (...args: unknown[]) => {
  if (__DEV__) console.log('[MasjidOfflineBanner]', ...args);
};

export default function MasjidOfflineBanner({ online }: { online: boolean }) {
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const palette = masjidOfflineColors(isDark);

  // Kept mounted through the slide-up dismissal, then unmounted on completion.
  const [mounted, setMounted] = useState(!online);
  const anim = useRef(new Animated.Value(online ? 0 : 1)).current;

  useEffect(() => {
    if (!online) {
      setMounted(true);
      log('offline banner shown');
      Animated.timing(anim, {
        toValue: 1,
        duration: ANIM_MS,
        easing: Easing.out(Easing.cubic), // no bounce
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(anim, {
        toValue: 0,
        duration: ANIM_MS,
        easing: Easing.in(Easing.cubic), // no bounce
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          setMounted(false);
          log('offline banner hidden');
        }
      });
    }
  }, [online, anim]);

  if (!mounted) return null;

  const translateY = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [-OFFSET, 0],
  });

  return (
    <View pointerEvents="none" style={[styles.wrap, { top: insets.top + 8 }]}>
      <Animated.View
        style={[
          styles.pill,
          { backgroundColor: palette.bg, opacity: anim, transform: [{ translateY }] },
        ]}
      >
        <Text style={[styles.text, { color: palette.text }]}>
          Ingen internetuppkoppling
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Full-width, centered, non-interactive → taps pass through to the map.
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 50 },
  // Content-sized premium pill.
  pill: {
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  text: { fontSize: 14, fontWeight: '600', letterSpacing: 0.1 },
});
