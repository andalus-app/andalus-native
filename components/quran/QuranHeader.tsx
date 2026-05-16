/**
 * QuranHeader.tsx
 *
 * Ayah-style header: hamburger | search | bookmark | [centered reading mode pill] | settings | close
 * Absolutely positioned overlay. BlurView background.
 */

import React, { memo, useRef, useEffect, useCallback, useState } from 'react';
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
import { SURAH_INDEX } from '../../data/surahIndex';
import type { ReadingMode } from '../../hooks/quran/useQuranSettings';

// ── Reading mode pill ─────────────────────────────────────────────────────────

const PILL_W = 118;
const PILL_H = 26;

type PillProps = {
  mode:        ReadingMode;
  onSelect:    (m: ReadingMode) => void;
  accentColor: string;
  isDark:      boolean;
};

const ReadingModePill = memo(function ReadingModePill({
  mode, onSelect, accentColor, isDark,
}: PillProps) {
  const progress = useRef(new Animated.Value(mode === 'page' ? 0 : 1)).current;
  const animRef  = useRef<Animated.CompositeAnimation | null>(null);

  const { pageTranslateY, verseTranslateY } = useRef({
    pageTranslateY: progress.interpolate({
      inputRange:  [0, 1],
      outputRange: [0, PILL_H],
      extrapolate: 'clamp',
    }),
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
  const pillBg = isDark
    ? (mode === 'page' ? 'rgba(102,132,104,0.28)' : 'rgba(102,132,104,0.34)')
    : accentColor;

  return (
    <TouchableOpacity
      style={[styles.pill, { backgroundColor: pillBg }]}
      onPress={() => onSelect(oppositeMode)}
      activeOpacity={0.7}
    >
      <Animated.View
        style={[styles.pillLabel, { transform: [{ translateY: pageTranslateY }] }]}
      >
        <SvgIcon name="book" size={12} color="#fff" />
        <Text style={styles.pillText}>Läsning</Text>
      </Animated.View>

      <Animated.View
        style={[styles.pillLabel, { transform: [{ translateY: verseTranslateY }] }]}
      >
        <SvgIcon name="list" size={12} color="#fff" />
        <Text style={styles.pillText}>Vers för vers</Text>
      </Animated.View>
    </TouchableOpacity>
  );
});

// ── Save toast ────────────────────────────────────────────────────────────────

type ToastData = { surahName: string; page: number };

function useSaveToast() {
  const [toastData, setToastData] = useState<ToastData | null>(null);
  const anim = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((data: ToastData) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToastData(data);
    anim.setValue(0);
    Animated.spring(anim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 120,
      friction: 10,
    }).start();
    timerRef.current = setTimeout(() => {
      Animated.timing(anim, { toValue: 0, duration: 280, useNativeDriver: true }).start(() => {
        setToastData(null);
      });
    }, 2200);
  }, [anim]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const opacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] });

  return { toastData, show, opacity, translateY };
}

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
    currentPage,
    currentSurahId,
    savedPages,
    savePage,
    removeSavedPage,
    isPageSaved,
  } = useQuranContext();

  const handleModeSelect = useCallback(
    (m: ReadingMode) => updateSettings({ readingMode: m }),
    [updateSettings],
  );

  const { toastData, show: showToast, opacity: toastOpacity, translateY: toastTranslateY } = useSaveToast();

  const handleBookmarkPress = useCallback(() => {
    if (isPageSaved(currentPage)) {
      const saved = savedPages.find((p) => p.pageNumber === currentPage);
      if (saved) removeSavedPage(saved.id);
    } else {
      const surah = SURAH_INDEX.find((s) => s.id === currentSurahId);
      savePage({
        pageNumber: currentPage,
        surahId: currentSurahId,
        surahName: surah?.nameSimple ?? '',
      });
      showToast({ surahName: surah?.nameSimple ?? '', page: currentPage });
    }
  }, [isPageSaved, currentPage, savedPages, removeSavedPage, savePage, currentSurahId, showToast]);

  const paddingTop = insets.top + 6;
  const isSaved = isPageSaved(currentPage);

  return (
    <>
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
          {/* Left group — 3 icons × 36px = 108px */}
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
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={handleBookmarkPress}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <SvgIcon
                name={isSaved ? 'bookmark-fill' : 'bookmark'}
                size={20}
                color={isSaved ? T.accent : T.text}
              />
            </TouchableOpacity>
          </View>

          {/* Center pill — flex:1 between equal-width side groups = true screen center */}
          <View style={styles.centerGroup}>
            <ReadingModePill
              mode={settings.readingMode}
              onSelect={handleModeSelect}
              accentColor={T.accent}
              isDark={isDark}
            />
          </View>

          {/* Right group — invisible spacer first keeps settings/close flush right */}
          <View style={styles.sideGroup}>
            {/* Invisible spacer: 1 icon width to match the 3 icons on the left */}
            <View style={styles.iconBtn} />
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

      {/* Save toast — absolutely positioned on screen, outside the overflow:hidden wrapper */}
      {toastData && (
        <Animated.View
          style={[
            styles.toast,
            {
              top: paddingTop + 52,
              opacity: toastOpacity,
              transform: [{ translateY: toastTranslateY }],
            },
          ]}
          pointerEvents="none"
        >
          <View style={styles.toastCheckCircle}>
            <SvgIcon name="check" size={14} color="#fff" />
          </View>
          <View style={styles.toastTextGroup}>
            <Text style={styles.toastTitle}>Sidan sparas i bokmärken</Text>
            <Text style={styles.toastSub}>{toastData.surahName} · Sida {toastData.page}</Text>
          </View>
        </Animated.View>
      )}
    </>
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
    width: 36,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // ── Pill ────────────────────────────────────────────────────────────────────
  pill: {
    width: PILL_W,
    height: PILL_H,
    borderRadius: PILL_H / 2,
    overflow: 'hidden',
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
    gap: 4,
  },
  pillText: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.1,
    color: '#fff',
  },
  // ── Toast ───────────────────────────────────────────────────────────────────
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 200,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(30,30,30,0.92)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  toastCheckCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#4a8f5c',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  toastTextGroup: {
    flex: 1,
  },
  toastTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  toastSub: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.65)',
    marginTop: 2,
  },
});

export default memo(QuranHeader);
