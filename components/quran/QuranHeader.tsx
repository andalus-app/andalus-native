/**
 * QuranHeader.tsx
 *
 * Ayah-style header: hamburger | search | [centered reading mode pill] | settings | close
 * Absolutely positioned overlay. BlurView background.
 */

import React, { memo, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SvgIcon from '../SvgIcon';
import { useTheme } from '../../context/ThemeContext';
import { useQuranContext } from '../../context/QuranContext';
import type { ReadingMode } from '../../hooks/quran/useQuranSettings';

// ── Reading mode pill ─────────────────────────────────────────────────────────

const PILL_W = 150;
const PILL_H = 32;

type PillProps = {
  mode:        ReadingMode;
  onSelect:    (m: ReadingMode) => void;
  accentColor: string;
  isDark:      boolean;
};

/**
 * ReadingModePill
 *
 * Single pill showing the current mode. On press the current label slides DOWN
 * off-screen and the new label slides in FROM THE TOP — both move simultaneously
 * on the native thread (useNativeDriver: true).
 *
 * Animation: spring with fast start / smooth landing / zero bounce.
 */
const ReadingModePill = memo(function ReadingModePill({
  mode, onSelect, accentColor, isDark,
}: PillProps) {
  // progress: 0 = page mode, 1 = verse mode.
  // Initialised to current mode so no animation fires on first mount.
  const progress = useRef(new Animated.Value(mode === 'page' ? 0 : 1)).current;
  const animRef  = useRef<Animated.CompositeAnimation | null>(null);

  // Interpolations created ONCE — never re-created, native node stays connected.
  const { pageTranslateY, verseTranslateY } = useRef({
    // "Läsning": sits at 0 in page mode, exits downward (+PILL_H) in verse mode
    pageTranslateY: progress.interpolate({
      inputRange:  [0, 1],
      outputRange: [0, PILL_H],
      extrapolate: 'clamp',
    }),
    // "Vers för vers": hidden above (-PILL_H) in page mode, enters to 0 in verse mode
    verseTranslateY: progress.interpolate({
      inputRange:  [0, 1],
      outputRange: [-PILL_H, 0],
      extrapolate: 'clamp',
    }),
  }).current;

  useEffect(() => {
    animRef.current?.stop();
    animRef.current = Animated.spring(progress, {
      toValue:         mode === 'page' ? 0 : 1,
      useNativeDriver: true,
      mass:            0.5,
      stiffness:       400,
      damping:         34,
    });
    animRef.current.start();
  }, [mode, progress]);

  const oppositeMode: ReadingMode = mode === 'page' ? 'verse' : 'page';
  // Dark: subtle semi-transparent green tint; Light: solid accent so white text is readable
  const pillBg = isDark
    ? (mode === 'page' ? 'rgba(102,132,104,0.28)' : 'rgba(102,132,104,0.34)')
    : accentColor;

  return (
    <TouchableOpacity
      style={[styles.pill, { backgroundColor: pillBg }]}
      onPress={() => onSelect(oppositeMode)}
      activeOpacity={0.7}
    >
      {/* "Läsning" — visible in page mode, slides down when switching to verse */}
      <Animated.View
        style={[styles.pillLabel, { transform: [{ translateY: pageTranslateY }] }]}
      >
        <SvgIcon name="book" size={13} color="#fff" />
        <Text style={styles.pillText}>Läsning</Text>
      </Animated.View>

      {/* "Vers för vers" — hidden above in page mode, slides in from top when switching */}
      <Animated.View
        style={[styles.pillLabel, { transform: [{ translateY: verseTranslateY }] }]}
      >
        <SvgIcon name="list" size={13} color="#fff" />
        <Text style={styles.pillText}>Vers för vers</Text>
      </Animated.View>
    </TouchableOpacity>
  );
});

// ── Component ─────────────────────────────────────────────────────────────────

function QuranHeader() {
  const { theme: T, isDark } = useTheme();
  const insets   = useSafeAreaInsets();
  const router   = useRouter();
  const {
    openContentsMenu,
    toggleSettingsPanel,
    openSearch,
    settings,
    updateSettings,
  } = useQuranContext();

  // Stable callback — only recreated if updateSettings reference changes (never in practice).
  // This is critical: a new lambda on every render would break ReadingModePill's memo.
  const handleModeSelect = useCallback(
    (m: ReadingMode) => updateSettings({ readingMode: m }),
    [updateSettings],
  );

  const paddingTop = insets.top + 6;

  return (
    <View style={[styles.wrapper, { height: paddingTop + 48 }]} pointerEvents="box-none">
      <BlurView
        intensity={isDark ? 60 : 80}
        tint={isDark ? 'dark' : 'light'}
        style={StyleSheet.absoluteFill}
      />
      <View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: isDark ? 'rgba(0,0,0,0.48)' : 'rgba(255,255,255,0.52)' },
        ]}
      />

      <View style={[styles.row, { paddingTop, paddingBottom: 6 }]}>
        {/* Left group */}
        <View style={styles.sideGroup}>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={openContentsMenu}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <SvgIcon name="menu" size={22} color={T.text} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={openSearch}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <SvgIcon name="search" size={20} color={T.text} />
          </TouchableOpacity>
        </View>

        {/* Center — pill */}
        <View style={styles.centerGroup}>
          <ReadingModePill
            mode={settings.readingMode}
            onSelect={handleModeSelect}
            accentColor={T.accent}
            isDark={isDark}
          />
        </View>

        {/* Right group */}
        <View style={styles.sideGroup}>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={toggleSettingsPanel}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <SvgIcon name="settings" size={20} color={T.text} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => router.back()}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <SvgIcon name="close" size={20} color={T.text} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    height: '100%',
  },
  sideGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  centerGroup: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtn: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // ── Pill ────────────────────────────────────────────────────────────────────
  pill: {
    width: PILL_W,
    height: PILL_H,
    borderRadius: PILL_H / 2,
    overflow: 'hidden',      // clips labels that slide out of view
  },
  pillLabel: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: PILL_H,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  pillText: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.1,
    color: '#fff',
  },
});

export default memo(QuranHeader);
