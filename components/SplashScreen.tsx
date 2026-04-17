/**
 * SplashScreen.tsx — Post-launch animated splash
 *
 * Renders as an absoluteFill overlay above the entire app.
 * Remains invisible (covered by native iOS splash — plain background color only,
 * no image) until isReady=true, at which point it hides the native splash and
 * animates the logo + text into view.
 *
 * Animation (total ≤ 700ms):
 *   0–400ms  Logo fades in (0→1) and scales up (0.85→1.0), glow fades in
 *   200–500ms Text fades in
 *   500–550ms Hold
 *   550–700ms Entire overlay fades to 0, onDone() called
 */

import React, { useEffect, useRef } from 'react';
import { Text, StyleSheet, useColorScheme, useWindowDimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import HidayahLogo from './HidayahLogo';
import * as NativeSplash from 'expo-splash-screen';

// ── Design tokens ─────────────────────────────────────────────────────────────

const ACCENT    = '#668468';
// Logo rendered at 110pt — prominent but not oversized at any screen width.
// The native splash uses imageWidth:220 which is the source asset width;
// the displayed visual weight at 110pt matches the native splash proportion.
const LOGO_SIZE = 110;


// ── Component ─────────────────────────────────────────────────────────────────

type Props = {
  /** Becomes true when fonts + storage are ready. Triggers hide + animation. */
  isReady: boolean;
  /** Called after the overlay has fully faded out. */
  onDone: () => void;
};

export default function SplashScreen({ isReady, onDone }: Props) {
  const scheme = useColorScheme();
  const isDark = scheme !== 'light';
  const { height: screenH } = useWindowDimensions();

  const bgColor   = isDark ? '#000000' : '#F2F2F7';
  const textColor = isDark ? '#FFFFFF' : '#000000';

  // Animation state
  const scale       = useSharedValue(0.85);
  const logoOp      = useSharedValue(0);
  const groupTransY = useSharedValue(0);
  const glowOp      = useSharedValue(0);
  const textOp      = useSharedValue(0);
  const overlayOp   = useSharedValue(1);

  // Prevent double-fire on StrictMode double-invoke
  const firedRef = useRef(false);

  useEffect(() => {
    if (!isReady || firedRef.current) return;
    firedRef.current = true;

    // Hide native iOS splash (instant — our overlay is already covering the screen)
    NativeSplash.hideAsync();

    // Phase 1 — logo animates in (0–400ms)
    scale.value       = withTiming(1.0,  { duration: 400, easing: Easing.out(Easing.cubic) });
    logoOp.value      = withTiming(1,    { duration: 400, easing: Easing.out(Easing.quad) });
    glowOp.value      = withTiming(1,    { duration: 400 });

    // Phase 2 — text fades in (200–500ms)
    textOp.value = withDelay(200, withTiming(1, { duration: 300, easing: Easing.out(Easing.quad) }));

    // Phase 3 — hold 50ms, then fade out (550–700ms)
    overlayOp.value = withDelay(
      550,
      withTiming(0, { duration: 150, easing: Easing.in(Easing.quad) }, (finished) => {
        if (finished) runOnJS(onDone)();
      }),
    );
  }, [isReady]);

  // Animated styles
  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlayOp.value }));

  // translateY on the whole content group so logo + text move together
  const groupStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: groupTransY.value }],
  }));

  // scale + opacity on logo
  const logoScaleStyle = useAnimatedStyle(() => ({
    opacity: logoOp.value,
    transform: [{ scale: scale.value }],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    // Cap glow at 14% opacity — very subtle accent halo
    opacity: glowOp.value * 0.14,
  }));

  const textStyle = useAnimatedStyle(() => ({ opacity: textOp.value }));

  // Position text directly below logo center, independent of flex layout.
  // This ensures the logo itself starts at exact screen center (matching native).
  const textTop = screenH / 2 + LOGO_SIZE / 2 + 20;

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.root, { backgroundColor: bgColor }, overlayStyle]}
      pointerEvents="none"
    >
      {/* Accent glow — elliptical halo centered behind logo */}
      <Animated.View style={[styles.glow, { backgroundColor: ACCENT }, glowStyle]} />

      {/* Logo + text group — animate vertically together */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.logoLayer, groupStyle]}>
        {/* Logo — scale animation only, centered */}
        <Animated.View style={logoScaleStyle}>
          <HidayahLogo size={LOGO_SIZE} />
        </Animated.View>
      </Animated.View>

      {/* Text — positioned below logo center, fades in independently */}
      <Animated.View style={[styles.textLayer, { top: textTop }, textStyle]}>
        <Text style={[styles.title, { color: textColor }]}>Hidayah</Text>
        <Text style={[styles.sub,   { color: ACCENT }]}>Din dagliga vägledning</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    zIndex: 9999,
  },
  glow: {
    position: 'absolute',
    // Centered via absolute + margin — does not affect layout
    alignSelf: 'center',
    top: '50%',
    marginTop: -(LOGO_SIZE * 0.36),    // visual center of ellipse aligns with logo center
    width:  LOGO_SIZE * 2.4,
    height: LOGO_SIZE * 1.3,
    borderRadius: LOGO_SIZE,
  },
  logoLayer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  textLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  title: {
    fontSize: 21,
    fontWeight: '700',
    letterSpacing: 5,
    textTransform: 'uppercase',
  },
  sub: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 5,
    marginTop: 6,
    textTransform: 'uppercase',
  },
});
