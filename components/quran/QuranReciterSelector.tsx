/**
 * QuranReciterSelector.tsx
 *
 * Bottom sheet modal for choosing a reciter.
 * Opens when user taps the reciter pill in QuranAudioPlayer.
 */

import React, { useEffect, useRef, memo, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  Animated,
  StyleSheet,
  TextInput,
  Platform,
  useWindowDimensions,
  type ListRenderItemInfo,
} from 'react-native';
import { BlurView } from 'expo-blur';
import SvgIcon from '../SvgIcon';
import { useTheme } from '../../context/ThemeContext';
import { useQuranContext } from '../../context/QuranContext';
import { RECITERS, type Reciter } from '../../services/quranAudioService';

// ── Component ─────────────────────────────────────────────────────────────────

function QuranReciterSelector() {
  const { theme: T, isDark } = useTheme();
  const { reciterSelectorOpen, closeReciterSelector, settings, updateSettings } =
    useQuranContext();
  const { height: screenH } = useWindowDimensions();

  const [query, setQuery] = useState('');

  // Idle (closed) offset: large enough that the sheet is always below the screen
  // regardless of orientation. 1400 > tallest iPhone (1005pt in portrait).
  const SHEET_IDLE_OFFSET = 1400;

  // screenH ref so animation callbacks can read the current height without
  // putting screenH in the effect deps (which would cause rotation flashes).
  const screenHRef = useRef(screenH);
  useEffect(() => { screenHRef.current = screenH; }, [screenH]);

  const slideAnim = useRef(new Animated.Value(SHEET_IDLE_OFFSET)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const sh = screenHRef.current;

    if (reciterSelectorOpen) {
      // The sheet uses height:'65%' — snap to sheet height below screen, then animate up.
      slideAnim.setValue(sh * 0.65);
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(backdropAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: sh * 0.65,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(backdropAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        // Park at guaranteed-off-screen offset after close completes.
        if (finished) slideAnim.setValue(SHEET_IDLE_OFFSET);
      });
      setQuery('');
    }
  }, [reciterSelectorOpen, slideAnim, backdropAnim]);
  // screenH intentionally NOT in deps — read via screenHRef to avoid rotation flashes.

  const norm = (s: string) =>
    s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  const filteredReciters = query.trim()
    ? RECITERS.filter((r) =>
        norm(r.name).includes(norm(query)) ||
        norm(r.style).includes(norm(query)),
      )
    : RECITERS;

  const handleSelect = useCallback(
    (reciter: Reciter) => {
      updateSettings({ reciterId: reciter.id });
      closeReciterSelector();
    },
    [updateSettings, closeReciterSelector],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Reciter>) => {
      const active = item.id === settings.reciterId;
      return (
        <TouchableOpacity
          style={[
            styles.reciterRow,
            active && { backgroundColor: T.accentGlow },
          ]}
          onPress={() => handleSelect(item)}
          activeOpacity={0.7}
        >
          <View style={styles.reciterInfo}>
            <Text style={[styles.reciterName, { color: T.text }]}>{item.name}</Text>
            <Text style={[styles.reciterStyle, { color: T.textMuted }]}>{item.style}</Text>
          </View>
          {active && (
            <View style={[styles.checkmark, { backgroundColor: T.accent }]}>
              <Text style={styles.checkmarkText}>✓</Text>
            </View>
          )}
        </TouchableOpacity>
      );
    },
    [settings.reciterId, T, handleSelect],
  );

  return (
    <>
      <Animated.View
        style={[styles.backdrop, { opacity: backdropAnim }]}
        pointerEvents={reciterSelectorOpen ? 'auto' : 'none'}
      >
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          onPress={closeReciterSelector}
          activeOpacity={1}
        />
      </Animated.View>

      <Animated.View
        style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}
      >
        <BlurView
          intensity={isDark ? 80 : 95}
          tint={isDark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: isDark
                ? 'rgba(10,10,10,0.8)'
                : 'rgba(248,248,252,0.8)',
            },
          ]}
        />

        {/* Handle */}
        <View style={styles.handleWrapper}>
          <View style={[styles.handle, { backgroundColor: T.textMuted }]} />
        </View>

        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.title, { color: T.text }]}>Recitator</Text>
          <TouchableOpacity onPress={closeReciterSelector} activeOpacity={0.7}>
            <SvgIcon name="close" size={22} color={T.text} />
          </TouchableOpacity>
        </View>

        {/* Search */}
        <View style={[styles.searchBar, { backgroundColor: T.cardSecondary, borderColor: T.border }]}>
          <SvgIcon name="search" size={16} color={T.textMuted} />
          <TextInput
            style={[styles.searchInput, { color: T.text }]}
            placeholder="Sök recitator…"
            placeholderTextColor={T.textMuted}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')} activeOpacity={0.7}>
              <SvgIcon name="close" size={16} color={T.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        {/* List */}
        <FlatList
          data={filteredReciters}
          renderItem={renderItem}
          keyExtractor={(r) => String(r.id)}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: Platform.OS === 'ios' ? 34 : 20 }}
        />
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
    zIndex: 260,
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '65%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
    zIndex: 261,
  },
  handleWrapper: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 6,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    opacity: 0.4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 0,
  },
  reciterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  reciterInfo: {
    flex: 1,
  },
  reciterName: {
    fontSize: 14,
    fontWeight: '600',
  },
  reciterStyle: {
    fontSize: 12,
    marginTop: 2,
  },
  checkmark: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmarkText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
});

export default memo(QuranReciterSelector);
