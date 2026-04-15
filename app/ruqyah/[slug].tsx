/**
 * Ruqyah — Artikeldetaljer
 *
 * Visar en artikel med:
 * - Inline YouTube-spelare (om videon finns)
 * - Artikeltext
 * - Relaterat innehåll
 */

import React, { useMemo, memo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SvgIcon from '../../components/SvgIcon';
import RuqyahYouTubePlayer from '../../components/ruqyah/RuqyahYouTubePlayer';
import RuqyahChip from '../../components/ruqyah/RuqyahChip';
import RuqyahContentItem from '../../components/ruqyah/RuqyahContentItem';
import {
  RO, RO_DIM, RO_TEXT_ON, RO_BG, RO_SURFACE, RO_CHIP,
  RO_BORDER, RO_BORDER_FAINT, RO_TEXT, RO_TEXT_SEC, RO_TEXT_MUTED,
} from '../../components/ruqyah/ruqyahColors';
import { getRuqyahArticle, RUQYAH_ARTICLES } from '../../data/ruqyahData';

function RuqyahDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { slug } = useLocalSearchParams<{ slug: string }>();

  const article = useMemo(() => getRuqyahArticle(slug ?? ''), [slug]);

  // Related: same category, excluding current article, max 4
  const related = useMemo(() => {
    if (!article) return [];
    return RUQYAH_ARTICLES.filter(
      (a) => a.categorySlug === article.categorySlug && a.slug !== article.slug,
    ).slice(0, 4);
  }, [article]);

  if (!article) {
    return (
      <View style={styles.notFound}>
        <Text style={styles.notFoundText}>Artikeln hittades inte</Text>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7}>
          <Text style={styles.backLink}>Gå tillbaka</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const hasVideo = !!article.primaryYoutubeUrl;
  const bodyText = (article.landingPageText ?? '').trim();

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 120 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      {/* Nav bar */}
      <View style={styles.navBar}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.navBtn}
          activeOpacity={0.7}
        >
          <SvgIcon name="close" size={18} color={RO_TEXT} />
        </TouchableOpacity>
        <View style={styles.navCatBadge}>
          <Text style={styles.navCatText} numberOfLines={1}>
            {article.categoryName}
          </Text>
        </View>
        <View style={{ width: 38 }} />
      </View>

      {/* Title */}
      <Text style={styles.title}>{article.title}</Text>

      {/* Chips */}
      {article.chips.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipScroll}
        >
          {article.chips.map((c) => (
            <RuqyahChip key={c.slug} label={c.label} active={false} onPress={() => {}} />
          ))}
        </ScrollView>
      )}

      {/* Badges row */}
      {(article.isLecture || article.hasYoutube) && (
        <View style={styles.badgeRow}>
          {article.isLecture && (
            <View style={styles.badge}>
              <SvgIcon name="play" size={12} color={RO} />
              <Text style={styles.badgeText}>Föreläsning</Text>
            </View>
          )}
          {article.hasYoutube && !article.isLecture && (
            <View style={styles.badge}>
              <SvgIcon name="play" size={12} color={RO} />
              <Text style={styles.badgeText}>Video</Text>
            </View>
          )}
        </View>
      )}

      {/* Divider */}
      <View style={styles.divider} />

      {/* YouTube player */}
      {hasVideo && article.primaryYoutubeUrl && (
        <View style={styles.playerWrap}>
          <RuqyahYouTubePlayer youtubeUrl={article.primaryYoutubeUrl} />
          {article.youtubeUrls.length > 1 &&
            article.youtubeUrls.slice(1).map((url, i) => (
              <View key={url} style={styles.extraPlayer}>
                <Text style={styles.extraPlayerLabel}>Video {i + 2}</Text>
                <RuqyahYouTubePlayer youtubeUrl={url} />
              </View>
            ))}
        </View>
      )}

      {/* Article body */}
      {bodyText.length > 0 && (
        <Text style={styles.body}>{bodyText}</Text>
      )}

      {/* Related */}
      {related.length > 0 && (
        <>
          <View style={[styles.divider, { marginVertical: 24 }]} />
          <Text style={styles.relatedTitle}>Relaterat innehåll</Text>
          {related.map((a) => (
            <RuqyahContentItem
              key={a.slug}
              article={a}
              onPress={() => router.push(`/ruqyah/${a.slug}` as any)}
            />
          ))}
        </>
      )}
    </ScrollView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: RO_BG,
  },
  content: {
    paddingHorizontal: 16,
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  navBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: RO_BORDER,
    backgroundColor: RO_SURFACE,
  },
  navCatBadge: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    maxWidth: 220,
    backgroundColor: RO_DIM,
    borderWidth: 1,
    borderColor: RO_BORDER_FAINT,
  },
  navCatText: {
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    color: RO,
    letterSpacing: 0.3,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 30,
    marginBottom: 14,
    color: RO_TEXT,
  },
  chipScroll: {
    paddingRight: 16,
    marginBottom: 12,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    gap: 5,
    backgroundColor: RO_DIM,
    borderWidth: 1,
    borderColor: RO_BORDER_FAINT,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: RO,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 16,
    backgroundColor: RO_BORDER_FAINT,
  },
  playerWrap: {
    marginBottom: 20,
    gap: 12,
  },
  extraPlayer: {
    gap: 6,
  },
  extraPlayerLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: RO_TEXT_MUTED,
  },
  body: {
    fontSize: 15,
    lineHeight: 27,
    fontWeight: '400',
    color: RO_TEXT_SEC,
  },
  relatedTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
    color: RO_TEXT,
  },
  notFound: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: RO_BG,
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

export default memo(RuqyahDetailScreen);
