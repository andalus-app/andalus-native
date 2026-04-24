/**
 * Ruqyah — Kategorisida
 *
 * Dedicerad landningssida per kategori med:
 * - Hero-bannerbild (samma bild som på startsidan)
 * - Kategorititel + beskrivning
 * - Alla artiklar i kategorin
 */

import React, { useMemo, useState, useCallback, memo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Image,
  Dimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SvgIcon from '../../../components/SvgIcon';
import RuqyahContentItem from '../../../components/ruqyah/RuqyahContentItem';
import {
  RO, RO_BG, RO_SURFACE, RO_BORDER, RO_BORDER_FAINT,
  RO_TEXT, RO_TEXT_ON, RO_TEXT_SEC, RO_TEXT_MUTED,
} from '../../../components/ruqyah/ruqyahColors';
import { RUQYAH_CATEGORIES, RUQYAH_ARTICLES } from '../../../data/ruqyahData';

// ── Category metadata ─────────────────────────────────────────────────────────

const CATEGORY_IMAGES: Record<string, ReturnType<typeof require>> = {
  ruqyah: require('../../../assets/images/ruqyah/ruqyah_banner.png'),
  jinn:   require('../../../assets/images/ruqyah/jinn_banner.png'),
  sihr:   require('../../../assets/images/ruqyah/sihr_banner.png'),
  ayn:    require('../../../assets/images/ruqyah/ayn_banner.png'),
};

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  ruqyah:
    'Lär dig om den islamiska metoden för andlig helning genom Koranen och autentiska du\'a. Upptäck hur ruqyah kan hjälpa vid olika andliga besvär.',
  ayn:
    'Förstå det onda ögats verkan enligt islamisk tradition. Lär dig att känna igen symtom och skydda dig genom bön och dhikr.',
  jinn:
    'Förstå den islamiska läran om jinn, deras natur och påverkan på människor. Lär dig skyddsmetoder och rätt tillvägagångssätt.',
  sihr:
    'Lär dig om islams syn på magi. Upptäck tecken på magi och islamiska metoder för skydd och befrielse.',
};

const CATEGORY_DISPLAY_NAMES: Record<string, string> = {
  ruqyah: 'Ruqyah',
  ayn:    "'Ayn (Onda Ögat)",
  jinn:   'Jinn',
  sihr:   'Sihr (Magi)',
};

// Image aspect ratio (~1430×574) — drives banner height so no empty space shows
const BANNER_RATIO = 1430 / 574;

// ── Component ─────────────────────────────────────────────────────────────────

function RuqyahCategoryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { slug } = useLocalSearchParams<{ slug: string }>();

  const category = useMemo(
    () => RUQYAH_CATEGORIES.find((c) => c.slug === slug),
    [slug],
  );

  const [filter, setFilter] = useState<'all' | 'lectures' | null>(null);

  const allArticles = useMemo(
    () => RUQYAH_ARTICLES.filter((a) => a.categorySlug === slug),
    [slug],
  );

  const lectureCount = useMemo(
    () => allArticles.filter((a) => a.isLecture).length,
    [allArticles],
  );

  const visibleArticles = useMemo(
    () => filter === 'lectures' ? allArticles.filter((a) => a.isLecture) : allArticles,
    [allArticles, filter],
  );

  const handleFilterAll = useCallback(
    () => setFilter((prev) => (prev === 'all' ? null : 'all')),
    [],
  );
  const handleFilterLectures = useCallback(
    () => setFilter((prev) => (prev === 'lectures' ? null : 'lectures')),
    [],
  );

  if (!category) {
    return (
      <View style={styles.notFound}>
        <Text style={styles.notFoundText}>Kategorin hittades inte</Text>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7}>
          <Text style={styles.backLink}>Gå tillbaka</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const image       = CATEGORY_IMAGES[slug ?? ''];
  const title       = CATEGORY_DISPLAY_NAMES[slug ?? ''] ?? category.name;
  const description = CATEGORY_DESCRIPTIONS[slug ?? ''] ?? '';

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Hero banner image ── */}
      <View style={styles.heroWrap}>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <Image
          source={image as any}
          style={styles.heroImage}
          resizeMode="cover"
        />
        {/* Back button overlaid on image */}
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.backBtn, { top: insets.top + 12 }]}
          activeOpacity={0.75}
        >
          <SvgIcon name="chevron-left" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* ── Title + description ── */}
      <View style={styles.headerSection}>
        <View style={styles.accentBar} />
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>

        {/* Filter chips */}
        <View style={styles.statsRow}>
          <TouchableOpacity
            onPress={handleFilterAll}
            activeOpacity={0.75}
            style={[styles.statChip, filter === 'all' && styles.statChipActive]}
          >
            <Text style={[styles.statNumber, filter === 'all' && styles.statNumberActive]}>
              {allArticles.length}
            </Text>
            <Text style={[styles.statLabel, filter === 'all' && styles.statLabelActive]}>
              artiklar
            </Text>
          </TouchableOpacity>

          {lectureCount > 0 && (
            <TouchableOpacity
              onPress={handleFilterLectures}
              activeOpacity={0.75}
              style={[styles.statChip, filter === 'lectures' && styles.statChipActive]}
            >
              <Text style={[styles.statNumber, filter === 'lectures' && styles.statNumberActive]}>
                {lectureCount}
              </Text>
              <Text style={[styles.statLabel, filter === 'lectures' && styles.statLabelActive]}>
                föreläsningar
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Divider ── */}
      <View style={styles.divider} />

      {/* ── Article list ── */}
      <View style={styles.articleSection}>
        <Text style={styles.sectionTitle}>
          {filter === 'lectures' ? 'Föreläsningar' : filter === 'all' ? 'Artiklar' : 'Alla artiklar'}
        </Text>
        {visibleArticles.map((a) => (
          <RuqyahContentItem
            key={a.slug}
            article={a}
            onPress={() => router.push(`/ruqyah/${a.slug}` as any)}
          />
        ))}
      </View>
    </ScrollView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: RO_BG,
  },

  // Hero
  heroWrap: {
    width: '100%',
    aspectRatio: BANNER_RATIO,
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  backBtn: {
    position: 'absolute',
    left: 16,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Header section
  headerSection: {
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 4,
  },
  accentBar: {
    width: 36,
    height: 3,
    borderRadius: 2,
    backgroundColor: RO,
    marginBottom: 14,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: RO_TEXT,
    letterSpacing: 0.2,
    marginBottom: 12,
    lineHeight: 34,
  },
  description: {
    fontSize: 15,
    lineHeight: 24,
    color: RO_TEXT_SEC,
    marginBottom: 20,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  statChip: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 5,
    backgroundColor: RO_SURFACE,
    borderWidth: 1,
    borderColor: RO_BORDER_FAINT,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
  },
  statChipActive: {
    backgroundColor: RO,
    borderColor: RO,
  },
  statNumber: {
    fontSize: 18,
    fontWeight: '800',
    color: RO,
  },
  statNumberActive: {
    color: RO_TEXT_ON,
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: RO_TEXT_MUTED,
  },
  statLabelActive: {
    color: RO_TEXT_ON,
  },

  // Divider
  divider: {
    height: 1,
    marginHorizontal: 20,
    marginTop: 24,
    marginBottom: 4,
    backgroundColor: RO_BORDER_FAINT,
  },

  // Articles
  articleSection: {
    paddingHorizontal: 16,
    paddingTop: 20,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: RO_TEXT,
    marginBottom: 12,
    letterSpacing: 0.1,
  },

  // Not found
  notFound: {
    flex: 1,
    backgroundColor: RO_BG,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  notFoundText: {
    fontSize: 16,
    color: RO_TEXT_MUTED,
  },
  backLink: {
    fontSize: 15,
    fontWeight: '600',
    color: RO,
  },
});

export default memo(RuqyahCategoryScreen);
