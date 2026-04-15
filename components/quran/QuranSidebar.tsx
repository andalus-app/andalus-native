import React, { useEffect, useRef, memo, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  Animated,
  StyleSheet,
  Dimensions,
  Platform,
  type ListRenderItemInfo,
} from 'react-native';
import { BlurView } from 'expo-blur';
import SvgIcon from '../SvgIcon';
import { useTheme } from '../../context/ThemeContext';
import { useQuranContext } from '../../context/QuranContext';
import { SURAH_INDEX, JUZ_INDEX, type SurahInfo, type JuzInfo } from '../../data/surahIndex';
import type { Bookmark } from '../../hooks/quran/useQuranBookmarks';

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = 'suror' | 'juz' | 'bokmärken';

// ── Constants ─────────────────────────────────────────────────────────────────

const { width: SCREEN_W } = Dimensions.get('window');
const SIDEBAR_W = Math.min(SCREEN_W * 0.82, 340);
const HEADER_H = Platform.OS === 'ios' ? 88 : 64;

// ── Component ─────────────────────────────────────────────────────────────────

function QuranSidebar() {
  const { theme: T, isDark } = useTheme();
  const {
    contentsMenuOpen: sidebarOpen,
    closeContentsMenu: closeSidebar,
    goToSurah,
    goToPage,
    currentPage,
    bookmarks,
    removeBookmark,
  } = useQuranContext();

  const [tab, setTab] = useState<Tab>('suror');
  const slideAnim = useRef(new Animated.Value(-SIDEBAR_W)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: sidebarOpen ? 0 : -SIDEBAR_W,
        duration: 260,
        useNativeDriver: true,
      }),
      Animated.timing(backdropAnim, {
        toValue: sidebarOpen ? 1 : 0,
        duration: 260,
        useNativeDriver: true,
      }),
    ]).start();
  }, [sidebarOpen, slideAnim, backdropAnim]);

  const renderSurah = useCallback(
    ({ item }: ListRenderItemInfo<SurahInfo>) => {
      const active = item.firstPage === currentPage ||
        (SURAH_INDEX[item.id] && SURAH_INDEX[item.id].firstPage > currentPage &&
          item.firstPage <= currentPage);
      return (
        <TouchableOpacity
          style={[
            styles.listRow,
            active && { backgroundColor: T.accentGlow },
          ]}
          onPress={() => goToSurah(item.id)}
          activeOpacity={0.7}
        >
          <View style={[styles.indexBadge, { backgroundColor: T.accentGlow }]}>
            <Text style={[styles.indexBadgeText, { color: T.accent }]}>
              {item.id}
            </Text>
          </View>
          <View style={styles.listRowText}>
            <Text style={[styles.listRowTitle, { color: T.text }]} numberOfLines={1}>
              {item.nameSimple}
            </Text>
            <Text style={[styles.listRowMeta, { color: T.textMuted }]}>
              {`${item.versesCount} ayah · ${item.revelationPlace === 'Makkah' ? 'Makkah' : 'Medina'}`}
            </Text>
          </View>
          <Text style={[styles.arabicName, { color: T.textSecondary }]}>
            {item.nameArabic}
          </Text>
        </TouchableOpacity>
      );
    },
    [currentPage, T, goToSurah],
  );

  const renderJuz = useCallback(
    ({ item }: ListRenderItemInfo<JuzInfo>) => (
      <TouchableOpacity
        style={styles.listRow}
        onPress={() => goToPage(item.firstPage)}
        activeOpacity={0.7}
      >
        <View style={[styles.indexBadge, { backgroundColor: T.accentGlow }]}>
          <Text style={[styles.indexBadgeText, { color: T.accent }]}>
            {item.id}
          </Text>
        </View>
        <View style={styles.listRowText}>
          <Text style={[styles.listRowTitle, { color: T.text }]}>
            {`Juz ${item.id}`}
          </Text>
          <Text style={[styles.listRowMeta, { color: T.textMuted }]}>
            {`Sida ${item.firstPage}`}
          </Text>
        </View>
      </TouchableOpacity>
    ),
    [T, goToPage],
  );

  const renderBookmark = useCallback(
    ({ item }: ListRenderItemInfo<Bookmark>) => (
      <TouchableOpacity
        style={styles.listRow}
        onPress={() => goToPage(item.pageNumber)}
        activeOpacity={0.7}
      >
        <View style={[styles.indexBadge, { backgroundColor: T.accentGlow }]}>
          <SvgIcon name="bookmark-fill" size={16} color={T.accent} />
        </View>
        <View style={styles.listRowText}>
          <Text style={[styles.listRowTitle, { color: T.text }]}>
            {`Sida ${item.pageNumber}`}
          </Text>
          {item.note ? (
            <Text style={[styles.listRowMeta, { color: T.textMuted }]} numberOfLines={1}>
              {item.note}
            </Text>
          ) : null}
        </View>
        <TouchableOpacity
          onPress={() => removeBookmark(item.id)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          activeOpacity={0.7}
        >
          <SvgIcon name="trash" size={18} color={T.textMuted} />
        </TouchableOpacity>
      </TouchableOpacity>
    ),
    [T, goToPage, removeBookmark],
  );

  return (
    <>
      {/* Backdrop */}
      <Animated.View
        style={[styles.backdrop, { opacity: backdropAnim }]}
        pointerEvents={sidebarOpen ? 'auto' : 'none'}
      >
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={closeSidebar} activeOpacity={1} />
      </Animated.View>

      {/* Sidebar panel */}
      <Animated.View
        style={[
          styles.panel,
          { width: SIDEBAR_W, transform: [{ translateX: slideAnim }] },
        ]}
      >
        <BlurView
          intensity={isDark ? 80 : 95}
          tint={isDark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: isDark ? 'rgba(10,10,10,0.75)' : 'rgba(248,248,252,0.75)' },
          ]}
        />

        {/* Header */}
        <View style={[styles.sidebarHeader, { paddingTop: HEADER_H }]}>
          <Text style={[styles.sidebarTitle, { color: T.text }]}>Innehåll</Text>
          <TouchableOpacity onPress={closeSidebar} activeOpacity={0.7}>
            <SvgIcon name="close" size={22} color={T.text} />
          </TouchableOpacity>
        </View>

        {/* Tabs */}
        <View style={[styles.tabRow, { borderBottomColor: T.separator }]}>
          {(['suror', 'juz', 'bokmärken'] as Tab[]).map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.tab, tab === t && styles.tabActive]}
              onPress={() => setTab(t)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: tab === t ? T.accent : T.textMuted },
                ]}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </Text>
              {tab === t && (
                <View style={[styles.tabIndicator, { backgroundColor: T.accent }]} />
              )}
            </TouchableOpacity>
          ))}
        </View>

        {/* Content */}
        {tab === 'suror' && (
          <FlatList
            data={SURAH_INDEX}
            renderItem={renderSurah}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            initialNumToRender={20}
            maxToRenderPerBatch={20}
            windowSize={5}
          />
        )}
        {tab === 'juz' && (
          <FlatList
            data={JUZ_INDEX}
            renderItem={renderJuz}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />
        )}
        {tab === 'bokmärken' && (
          bookmarks.length === 0 ? (
            <View style={styles.emptyState}>
              <SvgIcon name="bookmark" size={36} color={T.textMuted} />
              <Text style={[styles.emptyText, { color: T.textMuted }]}>
                Inga bokmärken ännu
              </Text>
            </View>
          ) : (
            <FlatList
              data={bookmarks}
              renderItem={renderBookmark}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
            />
          )
        )}
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    zIndex: 200,
  },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    zIndex: 201,
    overflow: 'hidden',
  },
  sidebarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  sidebarTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  tabRow: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginHorizontal: 16,
    marginBottom: 4,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
  },
  tabActive: {
    position: 'relative',
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
  },
  tabIndicator: {
    position: 'absolute',
    bottom: 0,
    left: '20%',
    right: '20%',
    height: 2,
    borderRadius: 1,
  },
  listContent: {
    paddingBottom: 120,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  indexBadge: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  indexBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  listRowText: {
    flex: 1,
  },
  listRowTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  listRowMeta: {
    fontSize: 11,
    marginTop: 1,
  },
  arabicName: {
    fontSize: 16,
    marginLeft: 8,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
  },
});

export default memo(QuranSidebar);
