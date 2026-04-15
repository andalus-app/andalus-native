/**
 * Ruqyah — Hem
 *
 * Islamisk andlig läkedom. Kategorier, sökfunktion och innehållslista.
 * Navigerar till /ruqyah/[slug] för artikel-detaljer.
 */

import React, { useState, useMemo, useCallback, useRef, memo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
  Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SvgIcon from '../../components/SvgIcon';
import BackButton from '../../components/BackButton';
import RuqyahSearchBar from '../../components/ruqyah/RuqyahSearchBar';
import RuqyahChip from '../../components/ruqyah/RuqyahChip';
import RuqyahCategoryCard from '../../components/ruqyah/RuqyahCategoryCard';
import RuqyahContentItem from '../../components/ruqyah/RuqyahContentItem';
import RuqyahHeroHeader from '../../components/ruqyah/RuqyahHeroHeader';
import {
  RO, RO_DIM, RO_BG, RO_SURFACE, RO_CHIP, RO_BORDER, RO_BORDER_FAINT,
  RO_TEXT, RO_TEXT_SEC, RO_TEXT_MUTED,
} from '../../components/ruqyah/ruqyahColors';
import {
  RUQYAH_CATEGORIES,
  RUQYAH_ARTICLES,
  type RuqyahArticle,
} from '../../data/ruqyahData';

// ── All chips across all categories (deduped) ─────────────────────────────────

const LECTURE_CHIP = { label: 'Föreläsning', slug: '__forelasning__' };

const ALL_CHIPS = (() => {
  const seen = new Set<string>();
  const result: { label: string; slug: string }[] = [LECTURE_CHIP];
  for (const cat of RUQYAH_CATEGORIES) {
    for (const chip of cat.chips) {
      if (chip.slug !== 'alla-artiklar' && !seen.has(chip.slug)) {
        seen.add(chip.slug);
        result.push(chip);
      }
    }
  }
  return result;
})();

// ── Component ─────────────────────────────────────────────────────────────────

function RuqyahScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);

  const [query, setQuery] = useState('');
  const [activeChip, setActiveChip] = useState<string | null>(null);

  const isSearching = query.trim().length > 0;
  const isFiltering = activeChip !== null;

  // ── filtered articles ──────────────────────────────────────────────────────

  const filteredArticles = useMemo<RuqyahArticle[]>(() => {
    let list = RUQYAH_ARTICLES;

    if (activeChip) {
      if (activeChip === LECTURE_CHIP.slug) {
        list = list.filter((a) => a.isLecture);
      } else {
        list = list.filter((a) => a.chipSlugs.includes(activeChip));
      }
    }
    if (isSearching) {
      // Normalize both query and fields: NFD-decompose then strip all combining
      // diacritical marks (U+0300–U+036F). This makes e.g. "safa" match "AṢ-ṢAFA"
      // because Ṣ (U+1E62) decomposes to S + U+0323 (combining dot below) which
      // is then removed, leaving plain "S".
      const norm = (s: string) =>
        s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const q = norm(query);
      list = list.filter(
        (a) =>
          norm(a.title).includes(q) ||
          norm(a.excerpt ?? '').includes(q) ||
          norm(a.landingPageText ?? '').includes(q) ||
          norm(a.categoryName).includes(q) ||
          a.labels.some((l) => norm(l).includes(q)) ||
          a.chips.some((c) => norm(c.label).includes(q)),
      );
    }
    return list;
  }, [query, activeChip, isSearching]);

  // ── handlers ───────────────────────────────────────────────────────────────

  const handleArticlePress = useCallback(
    (slug: string) => router.push(`/ruqyah/${slug}` as any),
    [router],
  );

  const handleCategoryPress = useCallback(
    (slug: string) => router.push(`/ruqyah/category/${slug}` as any),
    [router],
  );

  const handleChipPress = useCallback((slug: string) => {
    setActiveChip((prev) => (prev === slug ? null : slug));
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, []);

  const handleClear = useCallback(() => {
    setQuery('');
    setActiveChip(null);
  }, []);

  const showCategories = !isSearching && !isFiltering;
  const showContent = isSearching || isFiltering;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: RO_BG }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 120 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <BackButton onPress={() => router.back()} />
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Ruqyah</Text>
            <Text style={styles.headerSub}>Islamisk andlig läkedom</Text>
          </View>
          <View style={{ width: 38 }} />
        </View>

        {/* Search bar */}
        <View style={styles.searchWrap}>
          <RuqyahSearchBar
            value={query}
            onChangeText={setQuery}
            onClear={handleClear}
          />
        </View>

        {/* Active chip filter pill */}
        {activeChip && (
          <View style={styles.activeFilterRow}>
            <View style={styles.activeFilter}>
              <Text style={styles.activeFilterText}>
                {ALL_CHIPS.find((c) => c.slug === activeChip)?.label}
              </Text>
              <TouchableOpacity
                onPress={() => setActiveChip(null)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <SvgIcon name="close" size={12} color={RO} />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── HOME VIEW: categories + featured ── */}
        {showCategories && (
          <>
            {/* Hero — bismillah + titel + brödtext */}
            <RuqyahHeroHeader />

            {/* Categories grid — 2 columns */}
            <Text style={styles.sectionTitle}>Kategorier</Text>
            <View style={styles.categoryGrid}>
              {RUQYAH_CATEGORIES.map((cat) => (
                <RuqyahCategoryCard
                  key={cat.slug}
                  category={cat}
                  onPress={() => handleCategoryPress(cat.slug)}
                />
              ))}
            </View>

            {/* Filter chips */}
            <Text style={styles.sectionTitle}>Ämnen</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipScroll}
            >
              {ALL_CHIPS.map((chip) => (
                <RuqyahChip
                  key={chip.slug}
                  label={chip.label}
                  active={activeChip === chip.slug}
                  onPress={() => handleChipPress(chip.slug)}
                />
              ))}
            </ScrollView>

            {/* Featured — articles with video */}
            {(() => {
              const featured = RUQYAH_ARTICLES.filter((a) => a.isLecture).slice(0, 5);
              if (featured.length === 0) return null;
              return (
                <>
                  <Text style={styles.sectionTitle}>Föreläsningar</Text>
                  {featured.map((a) => (
                    <RuqyahContentItem
                      key={a.slug}
                      article={a}
                      onPress={() => handleArticlePress(a.slug)}
                    />
                  ))}
                </>
              );
            })()}

            {/* All articles */}
            <View style={styles.allHeader}>
              <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>Alla artiklar</Text>
              <Text style={styles.allCount}>{RUQYAH_ARTICLES.length}</Text>
            </View>
            {RUQYAH_ARTICLES.map((a) => (
              <RuqyahContentItem
                key={a.slug}
                article={a}
                onPress={() => handleArticlePress(a.slug)}
              />
            ))}

            {/* Footer */}
            <View style={styles.footer}>
              <View style={styles.footerDivider} />
              <Text style={styles.footerBody}>
                Vårt mål är att förmedla autentisk islamisk kunskap om andlig läkedom och skydd baserat på vägledning från Koranen och Sunna.
              </Text>
              <TouchableOpacity
                onPress={() => Linking.openURL('https://ruqyah.nu')}
                activeOpacity={0.7}
              >
                <Text style={styles.footerCopy}>© Ruqyah.nu</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* ── SEARCH / FILTER RESULTS ── */}
        {showContent && (
          <>
            <View style={styles.resultsHeader}>
              <Text style={styles.resultsTitle}>
                {isSearching ? 'Sökresultat' : 'Filtrerat'}
              </Text>
              <Text style={styles.resultsCount}>{filteredArticles.length} träffar</Text>
            </View>

            {filteredArticles.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyEmoji}>🔍</Text>
                <Text style={styles.emptyTitle}>Inga träffar</Text>
                <Text style={styles.emptyBody}>
                  Prova ett annat sökord eller rensa filtret.
                </Text>
                <TouchableOpacity
                  onPress={handleClear}
                  style={[styles.clearFilterBtn, { backgroundColor: RO_DIM, borderColor: RO }]}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.clearFilterText, { color: RO }]}>Rensa sökning</Text>
                </TouchableOpacity>
              </View>
            ) : (
              filteredArticles.map((a) => (
                <RuqyahContentItem
                  key={a.slug}
                  article={a}
                  onPress={() => handleArticlePress(a.slug)}
                />
              ))
            )}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: RO_TEXT,
  },
  headerSub: {
    fontSize: 12,
    fontWeight: '400',
    marginTop: 1,
    color: RO_TEXT_MUTED,
  },
  searchWrap: {
    marginBottom: 16,
  },
  activeFilterRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  activeFilter: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    gap: 6,
    backgroundColor: RO_DIM,
    borderColor: RO_BORDER,
  },
  activeFilterText: {
    fontSize: 13,
    fontWeight: '600',
    color: RO,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 12,
    marginTop: 4,
    color: RO_TEXT,
    letterSpacing: 0.1,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 8,
  },
  chipScroll: {
    paddingRight: 16,
    marginBottom: 20,
  },
  allHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    marginTop: 4,
  },
  allCount: {
    fontSize: 12,
    fontWeight: '600',
    color: RO_TEXT_MUTED,
    backgroundColor: RO_CHIP,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 10,
    overflow: 'hidden',
  },
  resultsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  resultsTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: RO_TEXT,
  },
  resultsCount: {
    fontSize: 13,
    color: RO_TEXT_MUTED,
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 48,
    paddingBottom: 24,
  },
  emptyEmoji: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
    color: RO_TEXT,
  },
  emptyBody: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 20,
    paddingHorizontal: 24,
    color: RO_TEXT_MUTED,
  },
  clearFilterBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: RO_BORDER,
    backgroundColor: RO_DIM,
  },
  clearFilterText: {
    fontSize: 14,
    fontWeight: '600',
    color: RO,
  },
  footer: {
    alignItems: 'center',
    paddingTop: 32,
    paddingBottom: 8,
    paddingHorizontal: 8,
  },
  footerDivider: {
    width: 40,
    height: 1,
    borderRadius: 1,
    backgroundColor: RO_BORDER_FAINT,
    marginBottom: 20,
  },
  footerBody: {
    fontSize: 13,
    lineHeight: 21,
    textAlign: 'center',
    color: RO_TEXT_SEC,
    marginBottom: 12,
  },
  footerCopy: {
    fontSize: 12,
    fontWeight: '500',
    color: RO_TEXT_SEC,
  },
});

export default memo(RuqyahScreen);
