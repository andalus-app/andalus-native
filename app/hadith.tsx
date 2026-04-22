/**
 * app/hadith.tsx — Hadithsamling
 *
 * Full hadith browser with list + slide-in detail view + favorites.
 * Supports deep-linking from home: /hadith?hadithNr=1
 *
 * Navigation params:
 *   hadithNr (optional) — if present, opens the detail view for that hadith on mount.
 */

import React, {
  useState, useRef, useEffect, useCallback, useMemo,
} from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  Animated, Easing, PanResponder, Dimensions, StyleSheet,
  Share, Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack, useLocalSearchParams } from 'expo-router';
import BackButton from '../components/BackButton';
import Svg, { Path } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BlurView } from 'expo-blur';
import { useTheme } from '../context/ThemeContext';
import ArabicText from '../components/ArabicText';
import hadithData from '../data/hadithData.json';
import HadithShareCard, { type HadithShareCardRef } from '../components/HadithShareCard';

// ── Types ─────────────────────────────────────────────────────────────────────

type Hadith = {
  hadith_nr: number;
  arabiska: string;
  svenska: string;
  källa: string;
};

const ALL_HADITHS: Hadith[] = hadithData as Hadith[];
const SCREEN_W = Dimensions.get('window').width;

// Font size persistence
const HADITH_FS_ARABIC   = 'hadith-arabic-font-size-v1';
const HADITH_FS_SVENSKA  = 'hadith-svenska-font-size-v1';
const HADITH_FAVORITES_KEY = 'hadith_favorites_v1';
const HADITH_ARABIC_STEPS  = [14, 18, 22, 26, 32, 40, 50] as const; // default idx 1 (18px)
const HADITH_SVENSKA_STEPS = [11, 14, 16, 18, 22, 27, 32] as const; // default idx 2 (16px)

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalize(s: string): string {
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// ── Heart SVG ─────────────────────────────────────────────────────────────────

function HeartIcon({ filled, color, size = 22 }: { filled: boolean; color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
        fill={filled ? color : 'none'}
        stroke={color}
        strokeWidth={filled ? 0 : 1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// ── Slide screen hook ─────────────────────────────────────────────────────────

function useSlideIn(onClose: () => void) {
  const translateX = useRef(new Animated.Value(SCREEN_W)).current;

  useEffect(() => {
    Animated.timing(translateX, {
      toValue: 0,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, []);

  const edgePan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (evt, gs) =>
        evt.nativeEvent.pageX < 30 && gs.dx > 8 && gs.dx > Math.abs(gs.dy) * 2,
      onPanResponderMove: (_, gs) => {
        if (gs.dx > 0) translateX.setValue(gs.dx);
      },
      onPanResponderRelease: (_, gs) => {
        if (gs.dx > SCREEN_W * 0.35 || gs.vx > 0.5) {
          Animated.timing(translateX, {
            toValue: SCREEN_W, duration: 240,
            easing: Easing.in(Easing.cubic), useNativeDriver: true,
          }).start(onClose);
        } else {
          Animated.timing(translateX, {
            toValue: 0, duration: 280,
            easing: Easing.out(Easing.cubic), useNativeDriver: true,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.timing(translateX, {
          toValue: 0, duration: 280,
          easing: Easing.out(Easing.cubic), useNativeDriver: true,
        }).start();
      },
    })
  ).current;

  const goBack = useCallback(() => {
    Animated.timing(translateX, {
      toValue: SCREEN_W, duration: 240,
      easing: Easing.in(Easing.cubic), useNativeDriver: true,
    }).start(onClose);
  }, [onClose]);

  return { translateX, edgePan, goBack };
}

// ── Font size row ─────────────────────────────────────────────────────────────

function HadithFontSizeRow({ label, index, steps, onDecrease, onIncrease, T, last }: {
  label: string; index: number; steps: readonly number[];
  onDecrease: () => void; onIncrease: () => void;
  T: any; last?: boolean;
}) {
  const atMin = index === 0;
  const atMax = index === steps.length - 1;
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 16, paddingVertical: 9,
      borderBottomWidth: last ? 0 : 1, borderBottomColor: T.border,
    }}>
      <Text style={{ fontSize: 12, fontWeight: '600', color: T.textMuted, width: 72 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <TouchableOpacity onPress={onDecrease} disabled={atMin} activeOpacity={0.7}
          style={{ width: 28, height: 28, borderRadius: 7, borderWidth: 1, borderColor: T.border, backgroundColor: T.card, alignItems: 'center', justifyContent: 'center' }}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: atMin ? T.textMuted : T.text }}>A</Text>
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {steps.map((_, i) => (
            <View key={i} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: i <= index ? T.accent : T.border }} />
          ))}
        </View>
        <TouchableOpacity onPress={onIncrease} disabled={atMax} activeOpacity={0.7}
          style={{ width: 28, height: 28, borderRadius: 7, borderWidth: 1, borderColor: T.border, backgroundColor: T.card, alignItems: 'center', justifyContent: 'center' }}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
          <Text style={{ fontSize: 17, fontWeight: '700', color: atMax ? T.textMuted : T.text }}>A</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Detail view ───────────────────────────────────────────────────────────────

function HadithDetail({
  hadith,
  onClose,
  isFavorite,
  onToggleFavorite,
}: {
  hadith: Hadith;
  onClose: () => void;
  isFavorite: boolean;
  onToggleFavorite: (nr: number) => void;
}) {
  const { theme: T, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { translateX, edgePan, goBack } = useSlideIn(onClose);

  const [arabicIdx,      setArabicIdx]      = useState(1);
  const [svenskaIdx,     setSvenskaIdx]     = useState(2);
  const [showFontPanel,  setShowFontPanel]  = useState(false);
  const [showShareMenu,  setShowShareMenu]  = useState(false);
  const [sharingImage,   setSharingImage]   = useState(false);

  // Heart bounce animation
  const heartScale   = useRef(new Animated.Value(1)).current;
  // Share menu slide-up animation
  const menuSlideY   = useRef(new Animated.Value(160)).current;
  const menuOpacity  = useRef(new Animated.Value(0)).current;
  // Hidden WebView share card
  const shareCardRef = useRef<HadithShareCardRef>(null);

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(HADITH_FS_ARABIC),
      AsyncStorage.getItem(HADITH_FS_SVENSKA),
    ]).then(([a, s]) => {
      if (a !== null) { const n = parseInt(a, 10); if (!isNaN(n) && n >= 0 && n < HADITH_ARABIC_STEPS.length) setArabicIdx(n); }
      if (s !== null) { const n = parseInt(s, 10); if (!isNaN(n) && n >= 0 && n < HADITH_SVENSKA_STEPS.length) setSvenskaIdx(n); }
    });
  }, []);

  const decArabic  = useCallback(() => setArabicIdx(i => { const n = Math.max(0, i-1); AsyncStorage.setItem(HADITH_FS_ARABIC, String(n)); return n; }), []);
  const incArabic  = useCallback(() => setArabicIdx(i => { const n = Math.min(HADITH_ARABIC_STEPS.length-1, i+1); AsyncStorage.setItem(HADITH_FS_ARABIC, String(n)); return n; }), []);
  const decSvenska = useCallback(() => setSvenskaIdx(i => { const n = Math.max(0, i-1); AsyncStorage.setItem(HADITH_FS_SVENSKA, String(n)); return n; }), []);
  const incSvenska = useCallback(() => setSvenskaIdx(i => { const n = Math.min(HADITH_SVENSKA_STEPS.length-1, i+1); AsyncStorage.setItem(HADITH_FS_SVENSKA, String(n)); return n; }), []);

  const arabicFs  = HADITH_ARABIC_STEPS[arabicIdx];
  const svenskaFs = HADITH_SVENSKA_STEPS[svenskaIdx];

  // Open share menu with animation
  const openShareMenu = useCallback(() => {
    setShowShareMenu(true);
    menuSlideY.setValue(160);
    menuOpacity.setValue(0);
    Animated.parallel([
      Animated.timing(menuSlideY,  { toValue: 0,   duration: 280, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
      Animated.timing(menuOpacity, { toValue: 1,   duration: 200, useNativeDriver: true }),
    ]).start();
  }, []);

  const closeShareMenu = useCallback(() => {
    Animated.parallel([
      Animated.timing(menuSlideY,  { toValue: 160, duration: 220, useNativeDriver: true, easing: Easing.in(Easing.cubic) }),
      Animated.timing(menuOpacity, { toValue: 0,   duration: 180, useNativeDriver: true }),
    ]).start(() => setShowShareMenu(false));
  }, []);

  const handleShareText = useCallback(async () => {
    closeShareMenu();
    try {
      await Share.share({ message: `${hadith.svenska}\n\n— ${hadith.källa}` });
    } catch {}
  }, [hadith, closeShareMenu]);

  const handleShareImage = useCallback(async () => {
    closeShareMenu();
    setSharingImage(true);
    try {
      await shareCardRef.current?.capture({
        hadithNr: hadith.hadith_nr,
        arabiska: hadith.arabiska,
        svenska:  hadith.svenska,
        källa:    hadith.källa,
      });
    } finally {
      setSharingImage(false);
    }
  }, [hadith]);

  const handleToggleFavorite = useCallback(() => {
    Animated.sequence([
      Animated.timing(heartScale, { toValue: 1.4, duration: 110, useNativeDriver: true, easing: Easing.out(Easing.quad) }),
      Animated.timing(heartScale, { toValue: 1,   duration: 180, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
    ]).start();
    onToggleFavorite(hadith.hadith_nr);
  }, [hadith.hadith_nr, onToggleFavorite]);

  const heartColor = isFavorite ? '#FF3B30' : T.textMuted;

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, { backgroundColor: T.bg, transform: [{ translateX }] }]}
      {...edgePan.panHandlers}
    >
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={[styles.detailHeader, { paddingTop: insets.top + 8, borderBottomColor: T.border }]}>
        <TouchableOpacity
          onPress={goBack}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.backBtn}
        >
          <Svg width={9} height={15} viewBox="0 0 9 15" fill="none">
            <Path d="M8 1L1 7.5L8 14" stroke={T.text} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </TouchableOpacity>

        <Text style={[styles.detailHeaderTitle, { color: T.text }]}>
          Hadith {hadith.hadith_nr}
        </Text>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {/* Heart — favorite toggle */}
          <TouchableOpacity
            onPress={handleToggleFavorite}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Animated.View style={{ transform: [{ scale: heartScale }] }}>
              <HeartIcon filled={isFavorite} color={heartColor} size={22} />
            </Animated.View>
          </TouchableOpacity>

          {/* Gear — font size panel toggle */}
          <TouchableOpacity
            onPress={() => setShowFontPanel(p => !p)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none"
              stroke={showFontPanel ? T.accent : T.textMuted}
              strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <Path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
              <Path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </Svg>
          </TouchableOpacity>

          {/* Share — opens submenu */}
          <TouchableOpacity
            onPress={openShareMenu}
            disabled={sharingImage}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
              <Path
                d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13"
                stroke={sharingImage ? T.textMuted : T.accent}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          </TouchableOpacity>
        </View>
      </View>

      {/* Font size panel */}
      {showFontPanel && (
        <View style={{ borderBottomWidth: 1, borderBottomColor: T.border, backgroundColor: T.bg }}>
          <HadithFontSizeRow label="Arabisk" index={arabicIdx} steps={HADITH_ARABIC_STEPS} onDecrease={decArabic} onIncrease={incArabic} T={T} />
          <HadithFontSizeRow label="Svenska" index={svenskaIdx} steps={HADITH_SVENSKA_STEPS} onDecrease={decSvenska} onIncrease={incSvenska} T={T} last />
        </View>
      )}

      {/* Content */}
      <FlatList
        data={[hadith]}
        keyExtractor={() => String(hadith.hadith_nr)}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: insets.bottom + 120 }}
        showsVerticalScrollIndicator={false}
        renderItem={() => (
          <View style={{ gap: 20 }}>
            <View style={[styles.nrBadge, { backgroundColor: T.accent + '18' }]}>
              <Text style={[styles.nrBadgeText, { color: T.accent }]}>#{hadith.hadith_nr}</Text>
            </View>
            <View style={[styles.arabicCard, { backgroundColor: T.card, borderColor: T.border }]}>
              <ArabicText style={{ fontSize: arabicFs, lineHeight: Math.round(arabicFs * 1.8), fontWeight: '400', textAlign: 'right', writingDirection: 'rtl', color: T.text }}>
                {hadith.arabiska}
              </ArabicText>
            </View>
            <Text style={{ fontSize: svenskaFs, lineHeight: Math.round(svenskaFs * 1.6), fontWeight: '400', color: T.text }}>
              {hadith.svenska}
            </Text>
            <View style={[styles.sourceRow, { borderTopColor: T.border }]}>
              <Text style={[styles.sourceLabel, { color: T.textMuted }]}>Källa</Text>
              <Text style={[styles.sourceText, { color: T.textMuted }]}>{hadith.källa}</Text>
            </View>
          </View>
        )}
      />

      {/* Share menu overlay */}
      {showShareMenu && (
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={closeShareMenu}
        >
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: menuOpacity, backgroundColor: 'rgba(0,0,0,0.45)' }]} />
        </TouchableOpacity>
      )}
      {showShareMenu && (
        <Animated.View
          style={[
            styles.shareMenu,
            {
              bottom: insets.bottom + 24,
              transform: [{ translateY: menuSlideY }],
              opacity: menuOpacity,
            },
          ]}
          pointerEvents="box-none"
        >
          <View style={[styles.shareMenuCard, { borderColor: T.border }]}>
            <BlurView
              intensity={isDark ? 60 : 80}
              tint={isDark ? 'dark' : 'light'}
              style={StyleSheet.absoluteFill}
            />
            <View style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? 'rgba(28,28,30,0.7)' : 'rgba(255,255,255,0.7)', borderRadius: 16 }]} />

            {/* Bild */}
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={handleShareImage}
              style={[styles.shareMenuItem, { borderBottomWidth: 0.5, borderBottomColor: T.border }]}
            >
              <View style={[styles.shareMenuIcon, { backgroundColor: T.accent + '20' }]}>
                <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                  <Path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke={T.accent} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                  <Path d="M17 8l-5-5-5 5M12 3v12" stroke={T.accent} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.shareMenuLabel, { color: T.text }]}>Bild</Text>
                <Text style={[styles.shareMenuSub, { color: T.textMuted }]}>Dela som vacker bild</Text>
              </View>
              <Svg width={7} height={12} viewBox="0 0 7 12" fill="none">
                <Path d="M1 1l5 5-5 5" stroke={T.textMuted} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </TouchableOpacity>

            {/* Text */}
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={handleShareText}
              style={styles.shareMenuItem}
            >
              <View style={[styles.shareMenuIcon, { backgroundColor: T.accent + '20' }]}>
                <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                  <Path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke={T.accent} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.shareMenuLabel, { color: T.text }]}>Text</Text>
                <Text style={[styles.shareMenuSub, { color: T.textMuted }]}>Dela som textmeddelande</Text>
              </View>
              <Svg width={7} height={12} viewBox="0 0 7 12" fill="none">
                <Path d="M1 1l5 5-5 5" stroke={T.textMuted} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </TouchableOpacity>
          </View>
        </Animated.View>
      )}

      {/* Hidden share card — renders off-screen WebView when capturing */}
      <HadithShareCard ref={shareCardRef} />
    </Animated.View>
  );
}

// ── Favorites screen ──────────────────────────────────────────────────────────

function HadithFavorites({
  favorites,
  onClose,
  onSelectHadith,
  onToggleFavorite,
}: {
  favorites: Set<number>;
  onClose: () => void;
  onSelectHadith: (h: Hadith) => void;
  onToggleFavorite: (nr: number) => void;
}) {
  const { theme: T } = useTheme();
  const insets = useSafeAreaInsets();
  const { translateX, edgePan, goBack } = useSlideIn(onClose);

  const favoriteHadiths = useMemo(
    () => ALL_HADITHS.filter(h => favorites.has(h.hadith_nr)),
    [favorites],
  );

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, { backgroundColor: T.bg, transform: [{ translateX }] }]}
      {...edgePan.panHandlers}
    >
      {/* Header */}
      <View style={[styles.detailHeader, { paddingTop: insets.top + 8, borderBottomColor: T.border }]}>
        <TouchableOpacity
          onPress={goBack}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.backBtn}
        >
          <Svg width={9} height={15} viewBox="0 0 9 15" fill="none">
            <Path d="M8 1L1 7.5L8 14" stroke={T.text} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </TouchableOpacity>
        <Text style={[styles.detailHeaderTitle, { color: T.text }]}>Favoriter</Text>
        <View style={{ width: 32 }} />
      </View>

      {favoriteHadiths.length === 0 ? (
        <View style={styles.emptyState}>
          <HeartIcon filled={false} color={T.textMuted} size={44} />
          <Text style={[styles.emptyText, { color: T.textMuted, marginTop: 16 }]}>
            Inga favoriter ännu
          </Text>
          <Text style={[{ color: T.textMuted, fontSize: 13, textAlign: 'center', lineHeight: 20, opacity: 0.7, paddingHorizontal: 32, marginTop: 6 }]}>
            Tryck på hjärtat i en hadith för att spara den här
          </Text>
        </View>
      ) : (
        <FlatList
          data={favoriteHadiths}
          keyExtractor={h => String(h.hadith_nr)}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: insets.bottom + 120 }}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          ListHeaderComponent={
            <Text style={[styles.countLabel, { color: T.textMuted, paddingHorizontal: 4, marginBottom: 4 }]}>
              {favoriteHadiths.length} {favoriteHadiths.length === 1 ? 'favorit' : 'favoriter'}
            </Text>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => onSelectHadith(item)}
              style={[styles.listItem, { backgroundColor: T.card, borderColor: T.border }]}
            >
              <View style={[styles.listNrBadge, { backgroundColor: T.accent + '18' }]}>
                <Text style={[styles.listNrText, { color: T.accent }]}>{item.hadith_nr}</Text>
              </View>
              <View style={styles.listContent}>
                <Text style={[styles.listSwedish, { color: T.text }]} numberOfLines={2}>
                  {item.svenska}
                </Text>
                <Text style={[styles.listSource, { color: T.textMuted }]} numberOfLines={1}>
                  {item.källa}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => onToggleFavorite(item.hadith_nr)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <HeartIcon filled color="#FF3B30" size={18} />
              </TouchableOpacity>
            </TouchableOpacity>
          )}
        />
      )}
    </Animated.View>
  );
}

// ── List item ─────────────────────────────────────────────────────────────────

function HadithListItem({
  hadith,
  onPress,
  T,
}: {
  hadith: Hadith;
  onPress: () => void;
  T: any;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      style={[styles.listItem, { backgroundColor: T.card, borderColor: T.border }]}
    >
      <View style={[styles.listNrBadge, { backgroundColor: T.accent + '18' }]}>
        <Text style={[styles.listNrText, { color: T.accent }]}>
          {hadith.hadith_nr}
        </Text>
      </View>
      <View style={styles.listContent}>
        <Text style={[styles.listSwedish, { color: T.text }]} numberOfLines={2}>
          {hadith.svenska}
        </Text>
        <Text style={[styles.listSource, { color: T.textMuted }]} numberOfLines={1}>
          {hadith.källa}
        </Text>
      </View>
      <Svg width={7} height={12} viewBox="0 0 7 12" fill="none">
        <Path d="M1 1l5 5-5 5" stroke={T.textMuted} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </TouchableOpacity>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function HadithScreen() {
  const { theme: T } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ hadithNr?: string }>();

  const [query,           setQuery]           = useState('');
  const [selectedHadith,  setSelectedHadith]  = useState<Hadith | null>(null);
  const [showFavorites,   setShowFavorites]   = useState(false);
  const [favorites,       setFavorites]       = useState<Set<number>>(new Set());

  // Load favorites from AsyncStorage on mount
  useEffect(() => {
    AsyncStorage.getItem(HADITH_FAVORITES_KEY).then(raw => {
      if (raw) {
        try {
          const arr: number[] = JSON.parse(raw);
          setFavorites(new Set(arr));
        } catch {}
      }
    });
  }, []);

  // Toggle a hadith as favorite and persist
  const toggleFavorite = useCallback((hadithNr: number) => {
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(hadithNr)) {
        next.delete(hadithNr);
      } else {
        next.add(hadithNr);
      }
      AsyncStorage.setItem(HADITH_FAVORITES_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);

  // Deep-link: open detail directly if hadithNr param present
  useEffect(() => {
    if (params.hadithNr) {
      const nr = parseInt(params.hadithNr, 10);
      const found = ALL_HADITHS.find(h => h.hadith_nr === nr);
      if (found) setSelectedHadith(found);
    }
  }, [params.hadithNr]);

  const filtered = useMemo(() => {
    if (!query.trim()) return ALL_HADITHS;
    const q = normalize(query);
    return ALL_HADITHS.filter(h =>
      normalize(h.svenska).includes(q) ||
      normalize(h.källa).includes(q) ||
      normalize(h.arabiska).includes(q) ||
      String(h.hadith_nr).includes(q)
    );
  }, [query]);

  const closeDetail    = useCallback(() => setSelectedHadith(null), []);
  const closeFavorites = useCallback(() => setShowFavorites(false), []);

  const hasFavorites = favorites.size > 0;

  return (
    <View style={[styles.root, { backgroundColor: T.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: T.border }]}>
        <BackButton onPress={() => router.back()} />
        <Text style={[styles.headerTitle, { color: T.text }]}>Hadithsamling</Text>
        {/* Heart — opens favorites */}
        <TouchableOpacity
          onPress={() => setShowFavorites(true)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={{ width: 32, alignItems: 'flex-end' }}
        >
          <HeartIcon filled={hasFavorites} color={hasFavorites ? '#FF3B30' : T.textMuted} size={22} />
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={[styles.searchRow, { borderBottomColor: T.border }]}>
        <View style={[styles.searchBox, { backgroundColor: T.card, borderColor: T.border }]}>
          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
            <Path
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              stroke={T.textMuted} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
            />
          </Svg>
          <TextInput
            style={[styles.searchInput, { color: T.text }]}
            placeholder="Sök i hadither…"
            placeholderTextColor={T.textMuted}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Svg width={16} height={16} viewBox="0 0 24 24" fill={T.textMuted}>
                <Path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
              </Svg>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Count */}
      <Text style={[styles.countLabel, { color: T.textMuted }]}>
        {filtered.length} hadither
      </Text>

      {/* List */}
      <FlatList
        data={filtered}
        keyExtractor={h => String(h.hadith_nr)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 120 }}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        renderItem={({ item }) => (
          <HadithListItem hadith={item} onPress={() => setSelectedHadith(item)} T={T} />
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={[styles.emptyText, { color: T.textMuted }]}>
              Inga träffar för "{query}"
            </Text>
            <TouchableOpacity onPress={() => setQuery('')}>
              <Text style={[styles.emptyLink, { color: T.accent }]}>Rensa sökning</Text>
            </TouchableOpacity>
          </View>
        }
      />

      {/* Favorites overlay */}
      {showFavorites && (
        <HadithFavorites
          favorites={favorites}
          onClose={closeFavorites}
          onSelectHadith={setSelectedHadith}
          onToggleFavorite={toggleFavorite}
        />
      )}

      {/* Detail overlay — renders on top of everything including favorites */}
      {selectedHadith && (
        <HadithDetail
          hadith={selectedHadith}
          onClose={closeDetail}
          isFavorite={favorites.has(selectedHadith.hadith_nr)}
          onToggleFavorite={toggleFavorite}
        />
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 0.5,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  searchRow: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    borderWidth: 0.5,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: '400',
    padding: 0,
  },
  countLabel: {
    fontSize: 12,
    fontWeight: '500',
    paddingHorizontal: 20,
    paddingBottom: 8,
    opacity: 0.65,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 12,
    borderWidth: 0.5,
    padding: 14,
  },
  listNrBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  listNrText: {
    fontSize: 12,
    fontWeight: '700',
  },
  listContent: {
    flex: 1,
    gap: 4,
  },
  listSwedish: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '400',
  },
  listSource: {
    fontSize: 11,
    fontWeight: '500',
    opacity: 0.65,
    fontStyle: 'italic',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
    gap: 10,
  },
  emptyText: {
    fontSize: 14,
  },
  emptyLink: {
    fontSize: 14,
    fontWeight: '600',
  },
  // Detail view
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 0.5,
  },
  backBtn: {
    width: 32,
    alignItems: 'flex-start',
  },
  detailHeaderTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  nrBadge: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  nrBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  arabicCard: {
    borderRadius: 12,
    borderWidth: 0.5,
    padding: 18,
  },
  sourceRow: {
    borderTopWidth: 0.5,
    paddingTop: 16,
    gap: 4,
  },
  sourceLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    opacity: 0.55,
  },
  sourceText: {
    fontSize: 13,
    fontWeight: '500',
    fontStyle: 'italic',
    opacity: 0.75,
  },
  // Share menu
  shareMenu: {
    position: 'absolute',
    left: 16,
    right: 16,
  },
  shareMenuCard: {
    borderRadius: 16,
    borderWidth: 0.5,
    overflow: 'hidden',
  },
  shareMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  shareMenuIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  shareMenuLabel: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  shareMenuSub: {
    fontSize: 12,
    fontWeight: '400',
    opacity: 0.7,
  },
});
