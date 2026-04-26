import React, {
  useState, useRef, useEffect, useCallback, useMemo,
} from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  Animated, Easing, PanResponder, Dimensions, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack, useFocusEffect } from 'expo-router';
import { usePreventRemove } from '@react-navigation/native';
import BackButton from '../../components/BackButton';
import Svg, { Path } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../context/ThemeContext';
import hadithData from '../../data/hadithData.json';

type Hadith = {
  hadith_nr: number;
  arabiska: string;
  svenska: string;
  källa: string;
};

const ALL_HADITHS: Hadith[] = hadithData as Hadith[];
const SCREEN_W = Dimensions.get('window').width;
const HADITH_FAVORITES_KEY = 'hadith_favorites_v1';

function normalize(s: string): string {
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

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

function useSlideIn(onClose: () => void) {
  const translateX = useRef(new Animated.Value(SCREEN_W)).current;

  useEffect(() => {
    Animated.timing(translateX, {
      toValue: 0, duration: 320,
      easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start();
  }, []);

  const edgePan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (evt, gs) =>
        evt.nativeEvent.pageX < 30 && gs.dx > 8 && gs.dx > Math.abs(gs.dy) * 2,
      onPanResponderMove: (_, gs) => { if (gs.dx > 0) translateX.setValue(gs.dx); },
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

// ── Favorites overlay ─────────────────────────────────────────────────────────

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
          <Text style={[styles.emptyText, { color: T.textMuted, marginTop: 16 }]}>Inga favoriter ännu</Text>
          <Text style={{ color: T.textMuted, fontSize: 13, textAlign: 'center', lineHeight: 20, opacity: 0.7, paddingHorizontal: 32, marginTop: 6 }}>
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
                <Text style={[styles.listSwedish, { color: T.text }]} numberOfLines={2}>{item.svenska}</Text>
                <Text style={[styles.listSource, { color: T.textMuted }]} numberOfLines={1}>{item.källa}</Text>
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

function HadithListItem({ hadith, onPress, T }: { hadith: Hadith; onPress: () => void; T: any }) {
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      style={[styles.listItem, { backgroundColor: T.card, borderColor: T.border }]}
    >
      <View style={[styles.listNrBadge, { backgroundColor: T.accent + '18' }]}>
        <Text style={[styles.listNrText, { color: T.accent }]}>{hadith.hadith_nr}</Text>
      </View>
      <View style={styles.listContent}>
        <Text style={[styles.listSwedish, { color: T.text }]} numberOfLines={2}>{hadith.svenska}</Text>
        <Text style={[styles.listSource, { color: T.textMuted }]} numberOfLines={1}>{hadith.källa}</Text>
      </View>
      <Svg width={7} height={12} viewBox="0 0 7 12" fill="none">
        <Path d="M1 1l5 5-5 5" stroke={T.textMuted} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </TouchableOpacity>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function HadithListScreen() {
  const { theme: T } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [query,         setQuery]         = useState('');
  const [showFavorites, setShowFavorites] = useState(false);
  const [favorites,     setFavorites]     = useState<Set<number>>(new Set());

  const showFavoritesRef = useRef(false);
  useEffect(() => { showFavoritesRef.current = showFavorites; }, [showFavorites]);

  const loadFavorites = useCallback(() => {
    AsyncStorage.getItem(HADITH_FAVORITES_KEY).then(raw => {
      if (raw) {
        try { setFavorites(new Set(JSON.parse(raw) as number[])); } catch {}
      }
    });
  }, []);

  useEffect(() => { loadFavorites(); }, [loadFavorites]);

  // Reload favorites when returning from a detail screen where user may have toggled one
  useFocusEffect(useCallback(() => { loadFavorites(); }, [loadFavorites]));

  const toggleFavorite = useCallback((hadithNr: number) => {
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(hadithNr)) next.delete(hadithNr); else next.add(hadithNr);
      AsyncStorage.setItem(HADITH_FAVORITES_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);

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

  const closeFavorites = useCallback(() => setShowFavorites(false), []);

  // Block native back when favorites overlay is open
  usePreventRemove(showFavorites, () => setShowFavorites(false));

  const hasFavorites = favorites.size > 0;

  return (
    <View style={[styles.root, { backgroundColor: T.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: T.border }]}>
        <BackButton onPress={() => router.back()} />
        <Text style={[styles.headerTitle, { color: T.text }]}>Hadithsamling</Text>
        <TouchableOpacity
          onPress={() => setShowFavorites(true)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={{ width: 32, alignItems: 'flex-end' }}
        >
          <HeartIcon filled={hasFavorites} color={hasFavorites ? '#FF3B30' : T.textMuted} size={22} />
        </TouchableOpacity>
      </View>

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

      <Text style={[styles.countLabel, { color: T.textMuted }]}>{filtered.length} hadither</Text>

      <FlatList
        data={filtered}
        keyExtractor={h => String(h.hadith_nr)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 120 }}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        renderItem={({ item }) => (
          <HadithListItem
            hadith={item}
            onPress={() => router.push(`/hadith/${item.hadith_nr}` as any)}
            T={T}
          />
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={[styles.emptyText, { color: T.textMuted }]}>Inga träffar för "{query}"</Text>
            <TouchableOpacity onPress={() => setQuery('')}>
              <Text style={[styles.emptyLink, { color: T.accent }]}>Rensa sökning</Text>
            </TouchableOpacity>
          </View>
        }
      />

      {showFavorites && (
        <HadithFavorites
          favorites={favorites}
          onClose={closeFavorites}
          onSelectHadith={(h) => {
            setShowFavorites(false);
            router.push(`/hadith/${h.hadith_nr}` as any);
          }}
          onToggleFavorite={toggleFavorite}
        />
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 0.5,
  },
  headerTitle: { fontSize: 17, fontWeight: '700', letterSpacing: 0.1 },
  searchRow: { paddingHorizontal: 16, paddingVertical: 10 },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 10, borderWidth: 0.5, paddingHorizontal: 12, paddingVertical: 8,
  },
  searchInput: { flex: 1, fontSize: 14, fontWeight: '400', padding: 0 },
  countLabel: { fontSize: 12, fontWeight: '500', paddingHorizontal: 20, paddingBottom: 8, opacity: 0.65 },
  listItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 12, borderWidth: 0.5, padding: 14,
  },
  listNrBadge: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  listNrText: { fontSize: 12, fontWeight: '700' },
  listContent: { flex: 1, gap: 4 },
  listSwedish: { fontSize: 13, lineHeight: 19, fontWeight: '400' },
  listSource: { fontSize: 11, fontWeight: '500', opacity: 0.65, fontStyle: 'italic' },
  emptyState: { alignItems: 'center', paddingVertical: 48, gap: 10 },
  emptyText: { fontSize: 14 },
  emptyLink: { fontSize: 14, fontWeight: '600' },
  detailHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 0.5,
  },
  backBtn: { width: 32, alignItems: 'flex-start' },
  detailHeaderTitle: { fontSize: 17, fontWeight: '700' },
});
