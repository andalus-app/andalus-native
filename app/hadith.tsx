/**
 * app/hadith.tsx — Hadithsamling
 *
 * Full hadith browser with list + slide-in detail view.
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
  Share,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack, useLocalSearchParams } from 'expo-router';
import BackButton from '../components/BackButton';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../context/ThemeContext';
import ArabicText from '../components/ArabicText';
import hadithData from '../data/hadithData.json';

// ── Types ─────────────────────────────────────────────────────────────────────

type Hadith = {
  hadith_nr: number;
  arabiska: string;
  svenska: string;
  källa: string;
};

const ALL_HADITHS: Hadith[] = hadithData as Hadith[];
const SCREEN_W = Dimensions.get('window').width;

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalize(s: string): string {
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
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

// ── Detail view ───────────────────────────────────────────────────────────────

function HadithDetail({
  hadith,
  onClose,
}: {
  hadith: Hadith;
  onClose: () => void;
}) {
  const { theme: T, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { translateX, edgePan, goBack } = useSlideIn(onClose);

  const handleShare = useCallback(async () => {
    try {
      await Share.share({
        message: `${hadith.svenska}\n\n— ${hadith.källa}`,
      });
    } catch {}
  }, [hadith]);

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: T.bg, transform: [{ translateX }] },
      ]}
      {...edgePan.panHandlers}
    >
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View
        style={[
          styles.detailHeader,
          { paddingTop: insets.top + 8, borderBottomColor: T.border },
        ]}
      >
        <TouchableOpacity
          onPress={goBack}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.backBtn}
        >
          <Svg width={9} height={15} viewBox="0 0 9 15" fill="none">
            <Path
              d="M8 1L1 7.5L8 14"
              stroke={T.text}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </TouchableOpacity>
        <Text style={[styles.detailHeaderTitle, { color: T.text }]}>
          Hadith {hadith.hadith_nr}
        </Text>
        <TouchableOpacity
          onPress={handleShare}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.shareBtn}
        >
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
            <Path
              d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13"
              stroke={T.accent}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </TouchableOpacity>
      </View>

      {/* Content */}
      <FlatList
        data={[hadith]}
        keyExtractor={() => String(hadith.hadith_nr)}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 24,
          paddingBottom: insets.bottom + 120,
        }}
        showsVerticalScrollIndicator={false}
        renderItem={() => (
          <View style={{ gap: 20 }}>
            {/* Hadith number badge */}
            <View style={[styles.nrBadge, { backgroundColor: T.accent + '18' }]}>
              <Text style={[styles.nrBadgeText, { color: T.accent }]}>
                #{hadith.hadith_nr}
              </Text>
            </View>

            {/* Arabic text */}
            <View
              style={[
                styles.arabicCard,
                { backgroundColor: T.card, borderColor: T.border },
              ]}
            >
              <ArabicText style={[styles.arabicText, { color: T.text }]}>
                {hadith.arabiska}
              </ArabicText>
            </View>

            {/* Swedish text */}
            <Text style={[styles.swedishText, { color: T.text }]}>
              {hadith.svenska}
            </Text>

            {/* Source */}
            <View
              style={[
                styles.sourceRow,
                { borderTopColor: T.border },
              ]}
            >
              <Text style={[styles.sourceLabel, { color: T.textMuted }]}>
                Källa
              </Text>
              <Text style={[styles.sourceText, { color: T.textMuted }]}>
                {hadith.källa}
              </Text>
            </View>
          </View>
        )}
      />
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
        <Text
          style={[styles.listSwedish, { color: T.text }]}
          numberOfLines={2}
        >
          {hadith.svenska}
        </Text>
        <Text
          style={[styles.listSource, { color: T.textMuted }]}
          numberOfLines={1}
        >
          {hadith.källa}
        </Text>
      </View>
      <Svg width={7} height={12} viewBox="0 0 7 12" fill="none">
        <Path
          d="M1 1l5 5-5 5"
          stroke={T.textMuted}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
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

  const [query, setQuery] = useState('');
  const [selectedHadith, setSelectedHadith] = useState<Hadith | null>(null);

  // Deep-link: open detail directly if hadithNr param present
  useEffect(() => {
    if (params.hadithNr) {
      const nr = parseInt(params.hadithNr, 10);
      const found = ALL_HADITHS.find((h) => h.hadith_nr === nr);
      if (found) setSelectedHadith(found);
    }
  }, [params.hadithNr]);

  const filtered = useMemo(() => {
    if (!query.trim()) return ALL_HADITHS;
    const q = normalize(query);
    return ALL_HADITHS.filter((h) =>
      normalize(h.svenska).includes(q) ||
      normalize(h.källa).includes(q) ||
      normalize(h.arabiska).includes(q) ||
      String(h.hadith_nr).includes(q)
    );
  }, [query]);

  const closeDetail = useCallback(() => setSelectedHadith(null), []);

  return (
    <View style={[styles.root, { backgroundColor: T.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View
        style={[
          styles.header,
          { paddingTop: insets.top + 8, borderBottomColor: T.border },
        ]}
      >
        <BackButton onPress={() => router.back()} />
        <Text style={[styles.headerTitle, { color: T.text }]}>Hadithsamling</Text>
        <View style={{ width: 32 }} />
      </View>

      {/* Search */}
      <View style={[styles.searchRow, { borderBottomColor: T.border }]}>
        <View style={[styles.searchBox, { backgroundColor: T.card, borderColor: T.border }]}>
          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
            <Path
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              stroke={T.textMuted}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
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
        keyExtractor={(h) => String(h.hadith_nr)}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: insets.bottom + 120,
        }}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        renderItem={({ item }) => (
          <HadithListItem
            hadith={item}
            onPress={() => setSelectedHadith(item)}
            T={T}
          />
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

      {/* Detail overlay */}
      {selectedHadith && (
        <HadithDetail hadith={selectedHadith} onClose={closeDetail} />
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
  shareBtn: {
    width: 32,
    alignItems: 'flex-end',
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
  arabicText: {
    fontSize: 20,
    lineHeight: 36,
    fontWeight: '400',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  swedishText: {
    fontSize: 15,
    lineHeight: 24,
    fontWeight: '400',
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
});
