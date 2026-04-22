/**
 * VerseActionsMenu.tsx
 *
 * Floating action menu triggered by tapping or long-pressing a verse.
 *
 * Step 1 (main):
 *   Spela          → start playback from selected verse immediately
 *   Spela till     → navigate to step 2
 *   Bokmärk vers   → add/remove bookmark
 *
 * Step 2 (play-to):
 *   Quick options:
 *     Slutet av sidan  → play to last verse on current page
 *     Slutet av suran  → play to last verse in current surah
 *     Spela vidare     → continuous play (no stop)
 *   Segmented list (Vers | Sida | Surah):
 *     Vers  → remaining verses in current surah
 *     Sida  → pages from current page forward
 *     Surah → surahs from current surah forward
 *
 * Reads longPressedVerse from QuranContext; calls audioCommandsRef.loadAndPlayFromVerse.
 * Dismisses by setting longPressedVerse to null.
 */

import React, { useState, useCallback, useRef, memo } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Share,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { BlurView } from 'expo-blur';
// expo-clipboard requires native rebuild; use the deprecated but functional RN Clipboard instead
import { Clipboard } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { useQuranContext } from '../../context/QuranContext';
import { SURAH_INDEX, surahForPage } from '../../data/surahIndex';
import { getPageVerseData } from '../../services/quranVerseService';
import { LOCAL_BERNSTROM_ID } from '../../services/quranTranslationService';
import { getBernstromByKey } from '../../data/bernstromTranslation';
import { fetchVerseGlyphs } from '../../services/mushafApi';
import SvgIcon from '../SvgIcon';
import VerseShareCard, { type VerseShareCardRef, type VerseShareData } from './VerseShareCard';

type Step = 'main' | 'play-to' | 'share';
type Segment = 'vers' | 'sida' | 'surah';

function VerseActionsMenu() {
  const { theme: T, isDark } = useTheme();
  const {
    longPressedVerse, setLongPressedVerse, audioCommandsRef,
    addBookmark, removeBookmark, bookmarks, currentPage,
  } = useQuranContext();
  const { height: screenH } = useWindowDimensions();
  const [step, setStep] = useState<Step>('main');
  const [segment, setSegment] = useState<Segment>('vers');
  const [shareLoading, setShareLoading] = useState(false);
  const shareCardRef = useRef<VerseShareCardRef>(null);

  const visible = longPressedVerse !== null;

  // BSMLLH_{surahId} keys use a different format than regular verse keys (surahId:verseNum).
  const isBismillahKey = longPressedVerse?.verseKey.startsWith('BSMLLH_') ?? false;

  const dismiss = useCallback(() => {
    setLongPressedVerse(null);
    setStep('main');
    setSegment('vers');
    setShareLoading(false);
  }, [setLongPressedVerse]);

  const play = useCallback(
    (stopAtVerseKey: string | null, continuous = false) => {
      if (!longPressedVerse) return;
      const surahId = isBismillahKey
        ? parseInt(longPressedVerse.verseKey.replace('BSMLLH_', ''), 10)
        : parseInt(longPressedVerse.verseKey.split(':')[0], 10);
      audioCommandsRef.current?.loadAndPlayFromVerse(
        surahId,
        longPressedVerse.verseKey,
        stopAtVerseKey,
        continuous,
      );
      dismiss();
    },
    [longPressedVerse, isBismillahKey, audioCommandsRef, dismiss],
  );

  const existingBookmark = bookmarks.find((b) => b.verseKey === longPressedVerse?.verseKey);
  const bookmarked = Boolean(existingBookmark);

  const handleBookmark = useCallback(() => {
    if (!longPressedVerse) return;
    const bkSurahId = isBismillahKey
      ? parseInt(longPressedVerse.verseKey.replace('BSMLLH_', ''), 10)
      : parseInt(longPressedVerse.verseKey.split(':')[0], 10);
    if (existingBookmark) {
      removeBookmark(existingBookmark.id);
    } else {
      addBookmark({ pageNumber: currentPage, surahId: bkSurahId, verseKey: longPressedVerse.verseKey });
    }
    dismiss();
  }, [longPressedVerse, isBismillahKey, existingBookmark, addBookmark, removeBookmark, currentPage, dismiss]);

  // ── Share ─────────────────────────────────────────────────────────────────
  const { settings } = useQuranContext();

  const fetchShareData = useCallback(async (): Promise<VerseShareData | null> => {
    if (!longPressedVerse || isBismillahKey) return null;
    const vk = longPressedVerse.verseKey;
    const [sId, vNum] = vk.split(':').map(Number);
    const s = SURAH_INDEX.find((x) => x.id === sId);
    if (!s) return null;

    try {
      const isLocalBernstrom = settings.translationId === LOCAL_BERNSTROM_ID;
      const apiTranslationId = isLocalBernstrom ? null : settings.translationId;

      // Fetch QCF V2 glyphs and translation concurrently
      const [qcfWords, verses] = await Promise.all([
        fetchVerseGlyphs(vk, currentPage),
        getPageVerseData(currentPage, apiTranslationId),
      ]);

      const found = verses.find((v) => v.verseKey === vk);

      // Resolve translation
      let translation: string | null = null;
      if (isLocalBernstrom) {
        translation = getBernstromByKey(vk) ?? null;
      } else if (found) {
        translation = found.translation;
      }

      return {
        verseKey: vk,
        translation,
        surahName: s.nameSimple,
        surahNameArabic: s.nameArabic,
        verseNumber: vNum,
        qcfWords,
      };
    } catch {
      return null;
    }
  }, [longPressedVerse, isBismillahKey, currentPage, settings.translationId]);

  const buildShareText = useCallback((data: VerseShareData): string => {
    const lines = [
      ...(data.translation ? [data.translation, ''] : []),
      `— Surah ${data.surahName} (${data.surahNameArabic}), ${data.verseKey}`,
      '',
      'Hidayah',
    ];
    return lines.join('\n');
  }, []);

  const handleShareText = useCallback(async () => {
    setShareLoading(true);
    try {
      const data = await fetchShareData();
      if (!data) return;
      await Share.share({ message: buildShareText(data) });
      dismiss();
    } finally {
      setShareLoading(false);
    }
  }, [fetchShareData, buildShareText, dismiss]);

  const handleCopyText = useCallback(async () => {
    setShareLoading(true);
    try {
      const data = await fetchShareData();
      if (!data) return;
      Clipboard.setString(buildShareText(data));
      dismiss();
    } finally {
      setShareLoading(false);
    }
  }, [fetchShareData, buildShareText, dismiss]);

  const handleShareImage = useCallback(async () => {
    setShareLoading(true);
    try {
      const data = await fetchShareData();
      if (!data) return;
      await shareCardRef.current?.capture(data);
      dismiss();
    } catch {
      // Capture failed or user cancelled share
    } finally {
      setShareLoading(false);
    }
  }, [fetchShareData, dismiss]);

  if (!visible || !longPressedVerse) return null;

  const surahId = isBismillahKey
    ? parseInt(longPressedVerse.verseKey.replace('BSMLLH_', ''), 10)
    : parseInt(longPressedVerse.verseKey.split(':')[0], 10);
  const verseNum = isBismillahKey ? 0 : parseInt(longPressedVerse.verseKey.split(':')[1], 10);
  const surah = SURAH_INDEX.find((s) => s.id === surahId);
  const surahLastVerseKey = surah ? `${surahId}:${surah.versesCount}` : longPressedVerse.verseKey;

  const separator = <View style={[styles.separator, { backgroundColor: T.border }]} />;

  // ── Play-to list data ──────────────────────────────────────────────────────

  // Vers: remaining verses in current surah (from next verse onward)
  const versItems = surah
    ? Array.from(
        { length: Math.max(0, surah.versesCount - verseNum) },
        (_, i) => verseNum + 1 + i,
      ).map((v) => ({
        key: `${surahId}:${v}`,
        label: `${surah.nameSimple}: ${v}`,
      }))
    : [];

  // Sida: pages from current page + 1 onward
  const sidaItems = Array.from(
    { length: Math.max(0, 604 - currentPage) },
    (_, i) => currentPage + 1 + i,
  ).map((p) => {
    const s = surahForPage(p);
    return {
      page: p,
      surahName: s.nameSimple,
      stopKey: `${s.id}:${s.versesCount}`,
    };
  });

  // Surah: surahs from current surah + 1 onward
  const currentSurahIndex = SURAH_INDEX.findIndex((s) => s.id === surahId);
  const surahItems = currentSurahIndex >= 0
    ? SURAH_INDEX.slice(currentSurahIndex + 1).map((s) => ({
        id: s.id,
        name: s.nameSimple,
        firstPage: s.firstPage,
        stopKey: `${s.id}:${s.versesCount}`,
      }))
    : [];

  // ── Render ─────────────────────────────────────────────────────────────────

  // Cap card height to 88% of current screen height so it fits in landscape too.
  const maxCardH = Math.floor(screenH * 0.88);

  return (
    <>
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={dismiss}
      statusBarTranslucent
      supportedOrientations={['portrait', 'portrait-upside-down', 'landscape', 'landscape-left', 'landscape-right']}
    >
      {/* Backdrop — tap outside to dismiss */}
      <Pressable style={styles.backdrop} onPress={dismiss}>
        {/* Menu card — tap inside does NOT dismiss */}
        <Pressable style={[styles.card, step === 'play-to' && { width: 320, height: maxCardH }]} onPress={() => {}}>
          {/* Blur + tint layer */}
          <BlurView
            intensity={isDark ? 72 : 88}
            tint={isDark ? 'dark' : 'light'}
            style={StyleSheet.absoluteFill}
          />
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: isDark ? 'rgba(18,18,20,0.62)' : 'rgba(252,252,255,0.62)' },
            ]}
          />

          {/* Verse key label */}
          <View style={styles.header}>
            <Text style={[styles.headerLabel, { color: T.textMuted }]}>
              {isBismillahKey ? `Basmala — ${surah?.nameSimple ?? ''}` : longPressedVerse.verseKey}
            </Text>
          </View>

          {step === 'main' ? (
            <>
              {/* Spela */}
              <TouchableOpacity
                style={[styles.row, styles.rowFirst]}
                onPress={() => play(null)}
                activeOpacity={0.7}
              >
                <View style={[styles.iconBadge, { backgroundColor: T.accentGlow }]}>
                  <SvgIcon name="play" size={16} color={T.accent} />
                </View>
                <Text style={[styles.rowText, { color: T.text }]}>Spela</Text>
              </TouchableOpacity>

              {separator}

              {/* Spela till → step 2 */}
              <TouchableOpacity
                style={styles.row}
                onPress={() => setStep('play-to')}
                activeOpacity={0.7}
              >
                <View style={[styles.iconBadge, { backgroundColor: T.accentGlow }]}>
                  <SvgIcon name="play" size={16} color={T.accent} />
                </View>
                <Text style={[styles.rowText, { color: T.text }]}>Spela till</Text>
                <Text style={[styles.chevron, { color: T.textMuted }]}>›</Text>
              </TouchableOpacity>

              {separator}

              {/* Bokmärk vers */}
              <TouchableOpacity
                style={styles.row}
                onPress={handleBookmark}
                activeOpacity={0.7}
              >
                <View style={[styles.iconBadge, { backgroundColor: T.accentGlow }]}>
                  <SvgIcon name={bookmarked ? 'bookmark-fill' : 'bookmark'} size={16} color={T.accent} />
                </View>
                <Text style={[styles.rowText, { color: T.text }]}>
                  {bookmarked ? 'Ta bort bokmärke' : 'Bokmärk vers'}
                </Text>
              </TouchableOpacity>

              {!isBismillahKey && (
                <>
                  {separator}

                  {/* Dela vers → share sub-step */}
                  <TouchableOpacity
                    style={[styles.row, styles.rowLast]}
                    onPress={() => setStep('share')}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.iconBadge, { backgroundColor: T.accentGlow }]}>
                      <SvgIcon name="share" size={16} color={T.accent} />
                    </View>
                    <Text style={[styles.rowText, { color: T.text }]}>Dela vers</Text>
                    <Text style={[styles.chevron, { color: T.textMuted }]}>›</Text>
                  </TouchableOpacity>
                </>
              )}
            </>
          ) : step === 'share' ? (
            // ── Share step ───────────────────────────────────────────────────
            <>
              <View style={styles.playToHeader}>
                <TouchableOpacity
                  style={styles.backBtn}
                  onPress={() => setStep('main')}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={[styles.backChevron, { color: T.accent }]}>‹</Text>
                </TouchableOpacity>
                <Text style={[styles.playToTitle, { color: T.text }]}>Dela vers</Text>
                <View style={styles.backBtn} />
              </View>

              {shareLoading ? (
                <View style={styles.shareLoadingRow}>
                  <ActivityIndicator color={T.accent} />
                </View>
              ) : (
                <>
                  {/* Dela — native share sheet */}
                  <TouchableOpacity
                    style={[styles.row, styles.rowFirst]}
                    onPress={handleShareText}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.iconBadge, { backgroundColor: T.accentGlow }]}>
                      <SvgIcon name="share" size={16} color={T.accent} />
                    </View>
                    <Text style={[styles.rowText, { color: T.text }]}>Dela</Text>
                  </TouchableOpacity>

                  {separator}

                  {/* Kopiera — copy to clipboard */}
                  <TouchableOpacity
                    style={styles.row}
                    onPress={handleCopyText}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.iconBadge, { backgroundColor: T.accentGlow }]}>
                      <SvgIcon name="copy" size={16} color={T.accent} />
                    </View>
                    <Text style={[styles.rowText, { color: T.text }]}>Kopiera</Text>
                  </TouchableOpacity>

                  {separator}

                  {/* Dela som bild — share as image */}
                  <TouchableOpacity
                    style={[styles.row, styles.rowLast]}
                    onPress={handleShareImage}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.iconBadge, { backgroundColor: T.accentGlow }]}>
                      <SvgIcon name="image" size={16} color={T.accent} />
                    </View>
                    <Text style={[styles.rowText, { color: T.text }]}>Dela som bild</Text>
                  </TouchableOpacity>
                </>
              )}
            </>
          ) : (
            // ── Play-to step ───────────────────────────────────────────────────
            <>
              {/* Back + title */}
              <View style={styles.playToHeader}>
                <TouchableOpacity
                  style={styles.backBtn}
                  onPress={() => setStep('main')}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={[styles.backChevron, { color: T.accent }]}>‹</Text>
                </TouchableOpacity>
                <Text style={[styles.playToTitle, { color: T.text }]}>Spela till</Text>
                <View style={styles.backBtn} />
              </View>

              {/* Quick options card */}
              <View style={[styles.quickCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', borderColor: T.border }]}>
                {/* Slutet av sidan */}
                <TouchableOpacity
                  style={styles.quickRow}
                  onPress={() => play(longPressedVerse.pageLastVerseKey)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.quickIconBox, { backgroundColor: T.accentGlow }]}>
                    <SvgIcon name="play" size={14} color={T.accent} />
                  </View>
                  <Text style={[styles.quickLabel, { color: T.text }]}>Slutet av sidan</Text>
                  <Text style={[styles.quickSub, { color: T.textMuted }]}>Sida {currentPage}</Text>
                </TouchableOpacity>

                <View style={[styles.quickSep, { backgroundColor: T.border }]} />

                {/* Slutet av suran */}
                <TouchableOpacity
                  style={styles.quickRow}
                  onPress={() => play(surahLastVerseKey)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.quickIconBox, { backgroundColor: T.accentGlow }]}>
                    <SvgIcon name="play" size={14} color={T.accent} />
                  </View>
                  <Text style={[styles.quickLabel, { color: T.text }]}>Slutet av suran</Text>
                  <Text style={[styles.quickSub, { color: T.textMuted }]} numberOfLines={1}>
                    {surah?.nameSimple ?? ''}
                  </Text>
                </TouchableOpacity>

                <View style={[styles.quickSep, { backgroundColor: T.border }]} />

                {/* Slutet av Koranen */}
                <TouchableOpacity
                  style={styles.quickRow}
                  onPress={() => play(null, true)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.quickIconBox, { backgroundColor: T.accentGlow }]}>
                    <SvgIcon name="play" size={14} color={T.accent} />
                  </View>
                  <Text style={[styles.quickLabel, { color: T.text }]}>Slutet av Koranen</Text>
                  <Text style={[styles.quickSub, { color: T.textMuted }]}>An-Nas</Text>
                </TouchableOpacity>

                <View style={[styles.quickSep, { backgroundColor: T.border }]} />

                {/* Spela vidare */}
                <TouchableOpacity
                  style={styles.quickRow}
                  onPress={() => play(null, true)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.quickIconBox, { backgroundColor: T.accentGlow }]}>
                    <Text style={[styles.infinityGlyph, { color: T.accent }]}>∞</Text>
                  </View>
                  <Text style={[styles.quickLabel, { color: T.text }]}>Spela vidare</Text>
                  <Text style={[styles.quickSub, { color: T.textMuted }]}>Kontinuerlig</Text>
                </TouchableOpacity>
              </View>

              {/* Segmented control */}
              <View style={[styles.segControl, { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' }]}>
                {(['vers', 'sida', 'surah'] as Segment[]).map((seg) => (
                  <TouchableOpacity
                    key={seg}
                    style={[
                      styles.segBtn,
                      segment === seg && [styles.segBtnActive, { backgroundColor: T.card }],
                    ]}
                    onPress={() => setSegment(seg)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.segText, { color: segment === seg ? T.text : T.textMuted }]}>
                      {seg === 'vers' ? 'Vers' : seg === 'sida' ? 'Sida' : 'Surah'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Scrollable list */}
              <ScrollView style={styles.listScroll} bounces={false} showsVerticalScrollIndicator={false}>
                {segment === 'vers' && (
                  versItems.length > 0 ? versItems.map((item) => (
                    <React.Fragment key={item.key}>
                      <TouchableOpacity
                        style={styles.listItem}
                        onPress={() => play(item.key)}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.listItemText, { color: T.text }]}>{item.label}</Text>
                      </TouchableOpacity>
                      <View style={[styles.listSep, { backgroundColor: T.border }]} />
                    </React.Fragment>
                  )) : (
                    <View style={styles.emptyRow}>
                      <Text style={[styles.emptyText, { color: T.textMuted }]}>Inga fler verser i suran</Text>
                    </View>
                  )
                )}

                {segment === 'sida' && (
                  sidaItems.length > 0 ? sidaItems.map((item) => (
                    <React.Fragment key={item.page}>
                      <TouchableOpacity
                        style={styles.listItem}
                        onPress={() => play(item.stopKey)}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.listItemText, { color: T.text }]}>Sida {item.page}</Text>
                        <Text style={[styles.listItemSub, { color: T.textMuted }]} numberOfLines={1}>
                          {item.surahName}
                        </Text>
                      </TouchableOpacity>
                      <View style={[styles.listSep, { backgroundColor: T.border }]} />
                    </React.Fragment>
                  )) : (
                    <View style={styles.emptyRow}>
                      <Text style={[styles.emptyText, { color: T.textMuted }]}>Sista sidan</Text>
                    </View>
                  )
                )}

                {segment === 'surah' && (
                  surahItems.length > 0 ? surahItems.map((item) => (
                    <React.Fragment key={item.id}>
                      <TouchableOpacity
                        style={styles.listItem}
                        onPress={() => play(item.stopKey)}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.listItemText, { color: T.text }]}>{item.name}</Text>
                        <Text style={[styles.listItemSub, { color: T.textMuted }]}>Sida {item.firstPage}</Text>
                      </TouchableOpacity>
                      <View style={[styles.listSep, { backgroundColor: T.border }]} />
                    </React.Fragment>
                  )) : (
                    <View style={styles.emptyRow}>
                      <Text style={[styles.emptyText, { color: T.textMuted }]}>Sista suran</Text>
                    </View>
                  )
                )}
              </ScrollView>

              <View style={styles.playToBottom} />
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
    <VerseShareCard ref={shareCardRef} />
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: 280,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 24,
    elevation: 12,
  },
  header: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 10,
  },
  headerLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.4,
    textAlign: 'center',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 14,
    gap: 12,
  },
  rowFirst: {},
  rowLast: {},
  iconBadge: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
  },
  chevron: {
    fontSize: 20,
    lineHeight: 22,
    fontWeight: '300',
  },
  backChevron: {
    fontSize: 22,
    lineHeight: 24,
    fontWeight: '300',
  },

  // ── Play-to step ──────────────────────────────────────────────────────────
  playToHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 6,
  },
  backBtn: {
    width: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playToTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },

  // Quick options card
  quickCard: {
    marginHorizontal: 12,
    marginBottom: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  quickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 10,
  },
  quickIconBox: {
    width: 28,
    height: 28,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
  },
  quickSub: {
    fontSize: 12,
    fontWeight: '500',
    maxWidth: 90,
    textAlign: 'right',
  },
  quickSep: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 14,
  },
  infinityGlyph: {
    fontSize: 18,
    lineHeight: 20,
    fontWeight: '600',
  },

  // Segmented control
  segControl: {
    flexDirection: 'row',
    marginHorizontal: 12,
    marginBottom: 6,
    borderRadius: 9,
    padding: 2,
    gap: 2,
  },
  segBtn: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segBtnActive: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  segText: {
    fontSize: 13,
    fontWeight: '600',
  },

  // List
  listScroll: {
    // flex:1 lets the list take remaining card height; the card's maxHeight
    // (88% of screen) is the actual constraint, which shrinks in landscape.
    flex: 1,
    marginHorizontal: 0,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 11,
    gap: 8,
  },
  listItemText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '400',
  },
  listItemSub: {
    fontSize: 12,
    fontWeight: '400',
    maxWidth: 80,
    textAlign: 'right',
  },
  listSep: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 18,
  },
  emptyRow: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 13,
    fontWeight: '400',
  },
  playToBottom: {
    height: 8,
  },
  shareLoadingRow: {
    paddingVertical: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default memo(VerseActionsMenu);
