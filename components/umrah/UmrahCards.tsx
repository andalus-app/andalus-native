/**
 * UmrahCards — all content card types for the Umrah Guide.
 *
 * Exports:
 *   SummaryCard, DuaCard, ImportantCard, WarningCard,
 *   NoteCard, SplitInfoCard, QuranRefCard, CelebrationCard, ReflectionCard
 *
 * Each card receives the local UmrahTheme (T) as a prop.
 * No global theme dependency — the guide manages its own light/dark state.
 */

import React, { memo, useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { UmrahTheme } from './umrahTheme';
import ArabicText from '@/components/ArabicText';
import SvgIcon from '@/components/SvgIcon';
import type {
  SummarySection,
  DuaSection,
  ImportantSection,
  WarningSection,
  NoteSection,
  HadithSection,
  SplitInfoSection,
  QuranReferenceSection,
  CelebrationSection,
  ReflectionSection,
  OverviewSection,
  TipsSection,
  ListSection,
  SpiritualIntroSection,
} from '@/data/umrahGuideData';
import { DUA_AUDIO_SOURCES } from '@/data/umrahGuideData';

// ── Shared helpers ────────────────────────────────────────────────────────────

const CARD_RADIUS = 14;
const CARD_PAD    = 16;

/** Scale a base font size by the theme's fontScale, rounded to integer. */
function fs(base: number, scale: number) { return Math.round(base * scale); }
/** Scale a base line-height proportionally. */
function lh(base: number, scale: number) { return Math.round(base * scale); }

function cardStyle(T: UmrahTheme, extra?: object) {
  return {
    backgroundColor: T.card,
    borderRadius:    CARD_RADIUS,
    borderWidth:     0.5,
    borderColor:     T.border,
    padding:         CARD_PAD,
    shadowColor:     T.shadow,
    shadowOffset:    { width: 0, height: 4 },
    shadowOpacity:   T.isDark ? 0.30 : 0.08,
    shadowRadius:    10,
    marginBottom:    12,
    ...extra,
  };
}

function SectionTitle({ T, text, color }: { T: UmrahTheme; text: string; color: string }) {
  return (
    <Text style={[styles.sectionTitle, { color, fontSize: fs(16, T.fontScale), lineHeight: lh(24, T.fontScale) }]}>
      {text}
    </Text>
  );
}

function Bullet({ T, text, color }: { T: UmrahTheme; text: string; color: string }) {
  return (
    <View style={styles.bulletRow}>
      <View style={[styles.bulletDot, { backgroundColor: color, marginTop: Math.round(9 * T.fontScale) }]} />
      <Text style={[styles.bulletText, { color, fontSize: fs(14, T.fontScale), lineHeight: lh(22, T.fontScale) }]}>
        {text}
      </Text>
    </View>
  );
}

// ── SummaryCard ───────────────────────────────────────────────────────────────

export const SummaryCard = memo(function SummaryCard({
  T, section,
}: { T: UmrahTheme; section: SummarySection | OverviewSection | TipsSection | ListSection }) {
  return (
    <View style={cardStyle(T)}>
      <SectionTitle T={T} text={section.title} color={T.text} />
      {'body' in section && section.body ? (
        <Text style={[styles.bodyText, { color: T.textSecondary, fontSize: fs(14, T.fontScale), lineHeight: lh(22, T.fontScale) }]}>
          {section.body}
        </Text>
      ) : null}
      {'arabic' in section && section.arabic ? (
        <ArabicText style={[styles.arabicText, { color: T.text, fontSize: fs(17, T.fontScale), lineHeight: lh(32, T.fontScale), marginTop: 6 }]}>
          {section.arabic}
        </ArabicText>
      ) : null}
      {section.items?.map((item, i) => (
        <Bullet key={i} T={T} text={item} color={T.textSecondary} />
      ))}
    </View>
  );
});

// ── SpiritualIntroCard ────────────────────────────────────────────────────────

export const SpiritualIntroCard = memo(function SpiritualIntroCard({
  T, section,
}: { T: UmrahTheme; section: SpiritualIntroSection }) {
  return (
    <View style={[
      cardStyle(T),
      {
        backgroundColor: T.accentSoft,
        borderColor:     T.accentBorder,
      },
    ]}>
      <SectionTitle T={T} text={section.title} color={T.accent} />
      <Text style={[styles.bodyText, styles.spiritualBody, { color: T.textSecondary, fontSize: fs(15, T.fontScale), lineHeight: lh(24, T.fontScale) }]}>
        {section.body}
      </Text>
    </View>
  );
});

// ── DuaCard ───────────────────────────────────────────────────────────────────

export const DuaCard = memo(function DuaCard({
  T, section,
}: { T: UmrahTheme; section: DuaSection }) {
  const audioSource = section.audioFile ? DUA_AUDIO_SOURCES[section.audioFile] : null;
  const playerRef   = useRef<AudioPlayer | null>(null);
  const [playing, setPlaying] = useState(false);

  // Release player on unmount
  useEffect(() => {
    return () => {
      try { playerRef.current?.remove(); } catch {}
      playerRef.current = null;
    };
  }, []);

  const handlePlayPause = useCallback(async () => {
    if (!audioSource) return;

    if (playing) {
      try { playerRef.current?.pause(); } catch {}
      setPlaying(false);
      return;
    }

    if (!playerRef.current) {
      await setAudioModeAsync({ playsInSilentModeIOS: true }).catch(() => {});
      const player = createAudioPlayer(audioSource);
      playerRef.current = player;
      player.addListener('playbackStatusUpdate', status => {
        if (status.didJustFinish) {
          setPlaying(false);
          try { playerRef.current?.remove(); } catch {}
          playerRef.current = null;
        }
      });
    }

    try { playerRef.current.play(); } catch {}
    setPlaying(true);
  }, [audioSource, playing]);

  return (
    <View style={[
      cardStyle(T),
      {
        borderColor: T.duaBorder,
        backgroundColor: T.cardWarm,
      },
    ]}>
      <View style={styles.duaHeader}>
        <Text style={[styles.sectionTitle, { color: T.dua, flex: 1, fontSize: fs(16, T.fontScale), lineHeight: lh(24, T.fontScale) }]}>
          {section.title}
        </Text>
        {audioSource != null && (
          <TouchableOpacity
            onPress={handlePlayPause}
            activeOpacity={0.7}
            style={[styles.audioBtn, { backgroundColor: T.accentSoft, borderColor: T.accentBorder }]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <SvgIcon name={playing ? 'pause' : 'play'} size={14} color={T.accent} />
          </TouchableOpacity>
        )}
      </View>

      {section.arabic ? (
        <ArabicText style={[styles.arabicText, { color: T.text, fontSize: fs(17, T.fontScale), lineHeight: lh(32, T.fontScale) }]}>
          {section.arabic}
        </ArabicText>
      ) : null}

      <View style={[styles.duaDivider, { backgroundColor: T.duaBorder }]} />

      <Text style={[styles.transliterationText, { color: T.dua, fontSize: fs(14, T.fontScale), lineHeight: lh(22, T.fontScale) }]}>
        {section.transliteration}
      </Text>

      <View style={[styles.duaDivider, { backgroundColor: T.separator }]} />

      <Text style={[styles.translationText, { color: T.textSecondary, fontSize: fs(14, T.fontScale), lineHeight: lh(22, T.fontScale) }]}>
        {section.translation}
      </Text>

      {section.reference ? (
        <View style={styles.duaRefRow}>
          <View style={[styles.duaRefBadge, { backgroundColor: T.dua + '22', borderColor: T.duaBorder, paddingHorizontal: Math.round(10 * T.fontScale), paddingVertical: Math.round(4 * T.fontScale) }]}>
            <Text style={[styles.duaRefText, { color: T.dua, fontSize: fs(12, T.fontScale) }]}>{section.reference}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
});

// ── ImportantCard ─────────────────────────────────────────────────────────────

export const ImportantCard = memo(function ImportantCard({
  T, section,
}: { T: UmrahTheme; section: ImportantSection }) {
  return (
    <View style={[
      cardStyle(T),
      {
        backgroundColor: T.importantBg,
        borderColor:     T.importantBorder,
        borderLeftWidth: 3,
        borderLeftColor: T.important,
      },
    ]}>
      <View style={styles.badgeRow}>
        <View style={[styles.badge, { backgroundColor: T.important, paddingHorizontal: Math.round(8 * T.fontScale), paddingVertical: Math.round(3 * T.fontScale) }]}>
          <Text style={[styles.badgeText, { fontSize: fs(10, T.fontScale) }]}>Viktigt</Text>
        </View>
        <SectionTitle T={T} text={section.title} color={T.important} />
      </View>
      {section.items.map((item, i) => (
        <Bullet key={i} T={T} text={item} color={T.important} />
      ))}
    </View>
  );
});

// ── WarningCard ───────────────────────────────────────────────────────────────

export const WarningCard = memo(function WarningCard({
  T, section,
}: { T: UmrahTheme; section: WarningSection }) {
  return (
    <View style={[
      cardStyle(T),
      {
        backgroundColor: T.warningBg,
        borderColor:     T.warningBorder,
        borderLeftWidth: 3,
        borderLeftColor: T.warning,
      },
    ]}>
      <View style={styles.badgeRow}>
        <View style={[styles.badge, { backgroundColor: T.warning, paddingHorizontal: Math.round(8 * T.fontScale), paddingVertical: Math.round(3 * T.fontScale) }]}>
          <Text style={[styles.badgeText, { fontSize: fs(10, T.fontScale) }]}>Undvik detta</Text>
        </View>
        <SectionTitle T={T} text={section.title} color={T.warning} />
      </View>
      {section.items.map((item, i) => (
        <Bullet key={i} T={T} text={item} color={T.warning} />
      ))}
    </View>
  );
});

// ── NoteCard ──────────────────────────────────────────────────────────────────

export const NoteCard = memo(function NoteCard({
  T, section,
}: { T: UmrahTheme; section: NoteSection }) {
  return (
    <View style={[
      cardStyle(T),
      {
        backgroundColor: T.noteBg,
        borderColor:     T.noteBorder,
        borderStyle:     'dashed',
      },
    ]}>
      <Text style={[styles.noteLabel, { color: T.note, fontSize: fs(11, T.fontScale) }]}>Obs</Text>
      <SectionTitle T={T} text={section.title} color={T.note} />
      <Text style={[styles.bodyText, { color: T.textMuted, fontSize: fs(14, T.fontScale), lineHeight: lh(22, T.fontScale) }]}>
        {section.body}
      </Text>
    </View>
  );
});

// ── HadithCard ────────────────────────────────────────────────────────────────

export const HadithCard = memo(function HadithCard({
  T, section,
}: { T: UmrahTheme; section: HadithSection }) {
  return (
    <View style={[
      cardStyle(T),
      {
        backgroundColor: T.duaBg,
        borderColor:     T.duaBorder,
        borderLeftWidth: 3,
        borderLeftColor: T.dua,
      },
    ]}>
      <Text style={[styles.hadithLabel, { color: T.dua, fontSize: fs(11, T.fontScale) }]}>Hadith</Text>
      <Text style={[styles.hadithBody, { color: T.textSecondary, fontSize: fs(14, T.fontScale), lineHeight: lh(22, T.fontScale) }]}>
        {section.body}
      </Text>
    </View>
  );
});

// ── SplitInfoCard ─────────────────────────────────────────────────────────────

export const SplitInfoCard = memo(function SplitInfoCard({
  T, section,
}: { T: UmrahTheme; section: SplitInfoSection }) {
  return (
    <View style={cardStyle(T)}>
      <SectionTitle T={T} text={section.title} color={T.text} />
      <View style={styles.splitRow}>
        {section.columns.map((col, ci) => (
          <View
            key={ci}
            style={[
              styles.splitCol,
              {
                backgroundColor: T.bgSecondary,
                borderColor:     T.border,
                marginLeft:      ci > 0 ? 8 : 0,
              },
            ]}
          >
            <Text style={[styles.splitColLabel, { color: T.accent, fontSize: fs(13, T.fontScale), lineHeight: lh(20, T.fontScale) }]}>
              {col.label}
            </Text>
            {col.items.map((item, i) => (
              <Text
                key={i}
                style={[styles.splitItem, { color: T.textSecondary, fontSize: fs(13, T.fontScale), lineHeight: lh(20, T.fontScale) }]}
              >
                {item}
              </Text>
            ))}
          </View>
        ))}
      </View>
    </View>
  );
});

// ── QuranRefCard ──────────────────────────────────────────────────────────────

export const QuranRefCard = memo(function QuranRefCard({
  T, section,
}: { T: UmrahTheme; section: QuranReferenceSection }) {
  return (
    <View style={[
      cardStyle(T),
      {
        backgroundColor: T.accentSoft,
        borderColor:     T.accentBorder,
      },
    ]}>
      {/* Title without badge — badge moves to bottom so it doesn't get clipped on large text */}
      <SectionTitle T={T} text={section.title} color={T.accent} />
      {section.arabic ? (
        <ArabicText style={[styles.arabicText, { color: T.text, fontSize: fs(17, T.fontScale), lineHeight: lh(32, T.fontScale) }]}>
          {section.arabic}
        </ArabicText>
      ) : null}
      <Text style={[styles.transliterationText, { color: T.accent, fontSize: fs(14, T.fontScale), lineHeight: lh(22, T.fontScale) }]}>
        {section.transliteration}
      </Text>
      <View style={[styles.duaDivider, { backgroundColor: T.separator }]} />
      <Text style={[styles.translationText, { color: T.textSecondary, fontSize: fs(14, T.fontScale), lineHeight: lh(22, T.fontScale) }]}>
        {section.translation}
      </Text>
      {/* Reference chip at the bottom so it's always visible regardless of text scale */}
      <View style={styles.refBadgeRow}>
        <View style={[styles.refBadge, { backgroundColor: T.accent, paddingHorizontal: Math.round(8 * T.fontScale), paddingVertical: Math.round(3 * T.fontScale) }]}>
          <Text style={[styles.refBadgeText, { fontSize: fs(11, T.fontScale) }]}>{section.reference}</Text>
        </View>
      </View>
    </View>
  );
});

// ── CelebrationCard ───────────────────────────────────────────────────────────

export const CelebrationCard = memo(function CelebrationCard({
  T, section,
}: { T: UmrahTheme; section: CelebrationSection }) {
  return (
    <View style={[
      cardStyle(T),
      {
        backgroundColor: T.accentSoft,
        borderColor:     T.accentBorder,
        alignItems:      'center',
        paddingVertical: 24,
      },
    ]}>
      <Text style={styles.celebrationEmoji}>🤲</Text>
      <Text style={[styles.celebrationTitle, { color: T.accent, fontSize: fs(22, T.fontScale), lineHeight: lh(30, T.fontScale) }]}>
        {section.title}
      </Text>
      <Text style={[styles.celebrationBody, { color: T.textSecondary, fontSize: fs(15, T.fontScale), lineHeight: lh(24, T.fontScale) }]}>
        {section.body}
      </Text>
    </View>
  );
});

// ── ReflectionCard ────────────────────────────────────────────────────────────

export const ReflectionCard = memo(function ReflectionCard({
  T, section,
}: { T: UmrahTheme; section: ReflectionSection }) {
  return (
    <View style={cardStyle(T)}>
      <SectionTitle T={T} text={section.title} color={T.text} />
      {section.items.map((item, i) => (
        <Bullet key={i} T={T} text={item} color={T.textSecondary} />
      ))}
    </View>
  );
});

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  sectionTitle: {
    fontSize:     16,
    fontWeight:   '600',
    marginBottom: 10,
    letterSpacing: -0.2,
  },
  bodyText: {
    fontSize:   14,
    lineHeight: 22,
    fontWeight: '400',
  },
  spiritualBody: {
    fontStyle:  'italic',
    lineHeight: 24,
    fontSize:   15,
  },
  bulletRow: {
    flexDirection:  'row',
    alignItems:     'flex-start',
    marginBottom:   7,
    paddingRight:   4,
  },
  bulletDot: {
    width:        5,
    height:       5,
    borderRadius: 3,
    marginTop:    9,
    marginRight:  10,
    flexShrink:   0,
  },
  bulletText: {
    fontSize:   14,
    lineHeight: 22,
    flex:       1,
  },
  duaHeader: {
    flexDirection:  'row',
    alignItems:     'flex-start',
    justifyContent: 'space-between',
    marginBottom:   2,
  },
  audioBtn: {
    width:          32,
    height:         32,
    borderRadius:   16,
    borderWidth:    0.5,
    alignItems:     'center',
    justifyContent: 'center',
    marginLeft:     8,
    marginTop:      -4,
    marginRight:    -4,
    flexShrink:     0,
  },
  arabicText: {
    fontSize:    17,
    textAlign:   'right',
    lineHeight:  32,
    marginBottom: 8,
    writingDirection: 'rtl',
  },
  transliterationText: {
    fontSize:    14,
    lineHeight:  22,
    fontStyle:   'italic',
    fontWeight:  '500',
    marginBottom: 6,
  },
  translationText: {
    fontSize:   14,
    lineHeight: 22,
    marginTop:  4,
  },
  duaDivider: {
    height:       StyleSheet.hairlineWidth,
    marginVertical: 10,
  },
  duaRefRow: {
    marginTop:  10,
    alignItems: 'flex-start',
  },
  duaRefBadge: {
    borderRadius: 20,
    borderWidth:  0.5,
    // padding set inline with T.fontScale
  },
  duaRefText: {
    fontWeight:    '600',
    letterSpacing: 0.2,
    // fontSize set inline with fs()
  },
  badgeRow: {
    marginBottom: 10,
  },
  badge: {
    alignSelf:    'flex-start',
    borderRadius: 6,
    marginBottom: 6,
    // padding set inline with T.fontScale so chip grows with text
  },
  badgeText: {
    color:         '#FFFFFF',
    fontWeight:    '700',
    letterSpacing: 0.4,
    // fontSize set inline with fs()
  },
  noteLabel: {
    fontSize:   11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  hadithLabel: {
    fontSize:      11,
    fontWeight:    '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom:  6,
  },
  hadithBody: {
    fontSize:   14,
    lineHeight: 22,
    fontStyle:  'italic',
  },
  splitRow: {
    flexDirection: 'row',
    marginTop:     4,
  },
  splitCol: {
    flex:         1,
    borderRadius: 10,
    borderWidth:  0.5,
    padding:      12,
  },
  splitColLabel: {
    fontSize:     13,
    fontWeight:   '700',
    marginBottom: 8,
    letterSpacing: 0.2,
  },
  splitItem: {
    fontSize:   13,
    lineHeight: 20,
    marginBottom: 5,
  },
  refBadgeRow: {
    marginTop:  10,
    alignItems: 'flex-start',
  },
  refBadge: {
    borderRadius: 8,
    flexShrink:   0,
    // padding set inline with T.fontScale
  },
  refBadgeText: {
    color:      '#FFFFFF',
    fontWeight: '700',
    // fontSize set inline with fs()
  },
  celebrationEmoji: {
    fontSize:     40,
    marginBottom: 12,
  },
  celebrationTitle: {
    fontSize:     22,
    fontWeight:   '700',
    marginBottom: 10,
    textAlign:    'center',
  },
  celebrationBody: {
    fontSize:   15,
    lineHeight: 24,
    textAlign:  'center',
    paddingHorizontal: 8,
  },
});
