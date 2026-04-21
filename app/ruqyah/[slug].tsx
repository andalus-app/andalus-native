/**
 * Ruqyah — Artikeldetaljer
 *
 * Visar en artikel med:
 * - Inline YouTube-spelare (om videon finns)
 * - Artikeltext
 * - Relaterat innehåll
 */

import React, { useState, useEffect, useMemo, memo, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Path } from 'react-native-svg';
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

const RUQYAH_FS_KEY   = 'ruqyah-text-font-size-v1';
const RUQYAH_FS_STEPS = [11, 14, 16, 18, 22, 27, 32] as const; // default idx 2 (16px)

function RuqyahDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { slug } = useLocalSearchParams<{ slug: string }>();

  const article = useMemo(() => getRuqyahArticle(slug ?? ''), [slug]);

  const [fsIdx, setFsIdx] = useState(2);
  const [showFontPanel, setShowFontPanel] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(RUQYAH_FS_KEY).then(v => {
      if (v !== null) { const n = parseInt(v, 10); if (!isNaN(n) && n >= 0 && n < RUQYAH_FS_STEPS.length) setFsIdx(n); }
    });
  }, []);

  const decFs = useCallback(() => setFsIdx(i => { const n = Math.max(0, i-1); AsyncStorage.setItem(RUQYAH_FS_KEY, String(n)); return n; }), []);
  const incFs = useCallback(() => setFsIdx(i => { const n = Math.min(RUQYAH_FS_STEPS.length-1, i+1); AsyncStorage.setItem(RUQYAH_FS_KEY, String(n)); return n; }), []);
  const bodyFs = RUQYAH_FS_STEPS[fsIdx];

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
        <TouchableOpacity
          onPress={() => setShowFontPanel(p => !p)}
          style={[styles.navBtn, { borderColor: showFontPanel ? RO : RO_BORDER }]}
          activeOpacity={0.7}
        >
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none"
            stroke={showFontPanel ? RO : RO_TEXT_MUTED}
            strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
            <Path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </Svg>
        </TouchableOpacity>
      </View>

      {/* Font size panel */}
      {showFontPanel && (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, marginBottom: 8, backgroundColor: RO_SURFACE, borderRadius: 12, borderWidth: 1, borderColor: RO_BORDER_FAINT }}>
          <Text style={{ fontSize: 12, fontWeight: '600', color: RO_TEXT_MUTED }}>Textstorlek</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TouchableOpacity onPress={decFs} disabled={fsIdx === 0} activeOpacity={0.7}
              style={{ width: 28, height: 28, borderRadius: 7, borderWidth: 1, borderColor: RO_BORDER, backgroundColor: RO_BG, alignItems: 'center', justifyContent: 'center' }}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: fsIdx === 0 ? RO_TEXT_MUTED : RO_TEXT }}>A</Text>
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', gap: 4 }}>
              {RUQYAH_FS_STEPS.map((_, i) => (
                <View key={i} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: i <= fsIdx ? RO : RO_BORDER }} />
              ))}
            </View>
            <TouchableOpacity onPress={incFs} disabled={fsIdx === RUQYAH_FS_STEPS.length - 1} activeOpacity={0.7}
              style={{ width: 28, height: 28, borderRadius: 7, borderWidth: 1, borderColor: RO_BORDER, backgroundColor: RO_BG, alignItems: 'center', justifyContent: 'center' }}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: fsIdx === RUQYAH_FS_STEPS.length - 1 ? RO_TEXT_MUTED : RO_TEXT }}>A</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

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
        <Text style={[styles.body, { fontSize: bodyFs, lineHeight: Math.round(bodyFs * 1.8) }]}>{bodyText}</Text>
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
