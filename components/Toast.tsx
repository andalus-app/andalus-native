/**
 * Top-of-screen toast pill — renders just below the Dynamic Island.
 *
 * Mounted ONCE per screen at the root (sibling of the ScrollView) so the pill
 * always overlays content at the screen level and never scrolls. Crucially it
 * does NOT use a Modal — Modals on iOS install their own UIWindow which can
 * absorb taps in subtle ways. By rendering as a plain `position:'absolute'`
 * `pointerEvents="none"` overlay we guarantee zero touch interception.
 *
 * Queue state machine:
 *   hidden → entering → visible → exiting → hidden ...
 *
 * Behaviour when `showToast()` is called:
 *   • `hidden`            → start enter with new label
 *   • `entering`/`visible`→ store as "pending" and start exit; the pending
 *                           label flushes into a fresh enter once exit finishes
 *   • `exiting`           → overwrite the pending label so only the latest
 *                           click's text is shown next
 *
 * Result: rapid clicks always have an immediate effect — the old pill exits
 * cleanly and the latest pill appears next. The user never has to wait for an
 * animation to complete to retrigger the toast.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { subscribeToast } from '../services/toastService';
import type { Theme } from '../theme/colors';

type Phase = 'hidden' | 'entering' | 'visible' | 'exiting';

const ENTER_OFFSET = -110; // px above resting position
const EXIT_OFFSET  = -120; // a hair farther so the exit feels deliberate
const VISIBLE_MS   = 1500;

export default function Toast({ T }: { T: Theme }) {
  const insets    = useSafeAreaInsets();
  const translate = useRef(new Animated.Value(ENTER_OFFSET)).current;
  const opacity   = useRef(new Animated.Value(0)).current;

  const [label, setLabel]     = useState('');
  const [mounted, setMounted] = useState(false);

  // Refs hold the live state machine — they don't trigger re-renders and are
  // always up-to-date inside async animation callbacks.
  const phaseRef        = useRef<Phase>('hidden');
  const pendingLabelRef = useRef<string | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animRef         = useRef<Animated.CompositeAnimation | null>(null);

  const clearDismissTimer = () => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  };

  const runExit = useCallback(() => {
    clearDismissTimer();
    if (animRef.current) { animRef.current.stop(); animRef.current = null; }
    phaseRef.current = 'exiting';
    const anim = Animated.parallel([
      Animated.timing(translate, { toValue: EXIT_OFFSET, duration: 260, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(opacity,   { toValue: 0,           duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
    ]);
    animRef.current = anim;
    anim.start(({ finished }) => {
      if (!finished) return;
      animRef.current = null;
      const pending = pendingLabelRef.current;
      pendingLabelRef.current = null;
      if (pending !== null) {
        // Inline enter — keep call sites simple. We can't call runEnter()
        // directly because of the cyclic dep with useCallback; runEnter is
        // defined below and the runtime closure picks up the latest version
        // via runEnterRef.
        runEnterRef.current?.(pending);
      } else {
        phaseRef.current = 'hidden';
        setMounted(false);
      }
    });
  }, [translate, opacity]);

  const runEnter = useCallback((nextLabel: string) => {
    if (animRef.current) { animRef.current.stop(); animRef.current = null; }
    setLabel(nextLabel);
    setMounted(true);
    translate.setValue(ENTER_OFFSET);
    opacity.setValue(0);
    phaseRef.current = 'entering';
    const anim = Animated.parallel([
      Animated.spring(translate, { toValue: 0, useNativeDriver: true, tension: 80, friction: 14 }),
      Animated.timing(opacity,   { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]);
    animRef.current = anim;
    anim.start(({ finished }) => {
      if (!finished) return;
      animRef.current = null;
      phaseRef.current = 'visible';
      dismissTimerRef.current = setTimeout(() => {
        dismissTimerRef.current = null;
        runExit();
      }, VISIBLE_MS);
    });
  }, [translate, opacity, runExit]);

  // Forward declaration so runExit (defined above) can call into the latest
  // runEnter once the cyclic dependency is resolved at run time.
  const runEnterRef = useRef<((msg: string) => void) | null>(null);
  runEnterRef.current = runEnter;

  useEffect(() => {
    return subscribeToast(message => {
      const phase = phaseRef.current;
      if (phase === 'hidden') {
        runEnter(message);
        return;
      }
      // Pill is currently in-flight or fully shown — queue the new label and
      // make sure we're heading toward exit. The queued label always reflects
      // the LATEST click, so rapid taps coalesce to "show the latest text".
      pendingLabelRef.current = message;
      if (phase !== 'exiting') runExit();
    });
  }, [runEnter, runExit]);

  useEffect(() => {
    return () => {
      clearDismissTimer();
      if (animRef.current) animRef.current.stop();
    };
  }, []);

  if (!mounted) return null;

  // High-contrast pill: dark in light mode, light in dark mode. White text in
  // both so it's always immediately legible against any background.
  const pillBg = T.isDark
    ? 'rgba(72,72,74,0.96)'
    : 'rgba(28,28,30,0.96)';

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.wrap,
        { top: insets.top + 6, opacity, transform: [{ translateY: translate }] },
      ]}
    >
      <View style={[styles.pill, { backgroundColor: pillBg }]}>
        <Text style={styles.text} numberOfLines={1}>{label}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 9999,
    elevation: 9999,
  },
  pill: {
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 10,
    maxWidth: '88%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 16,
    elevation: 10,
  },
  text: {
    fontSize: 13.5,
    fontWeight: '600',
    letterSpacing: 0.1,
    color: '#FFFFFF',
  },
});
