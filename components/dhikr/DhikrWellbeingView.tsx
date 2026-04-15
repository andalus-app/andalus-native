/**
 * DhikrWellbeingView.tsx
 *
 * Wellbeing tab for Dhikr & Du'a.
 * Displays mood chips → filtered dhikr recommendations.
 * Also provides an enriched free-text search bar (mood-aware).
 *
 * Data flow:
 *   WELLBEING_TAB / WELLBEING_MOODS  → mood chips
 *   getDhikrForMood(moodId)          → filtered + sorted dhikr
 *   searchDhikr(query)               → weighted text search
 *   onSelectDhikr                    → back to DhikrScreen for detail view
 */

import React, { useState, useMemo, useCallback, memo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  StyleSheet,
} from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { useTheme } from '../../context/ThemeContext';
import { WELLBEING_MOODS, type DhikrPost } from '../../data/dhikrRepository';
import { getDhikrForMood, searchDhikr, normalizeText, type DhikrSearchResult } from '../../services/wellbeingSearch';

// ── Mood icon map ─────────────────────────────────────────────────────────────

const MOOD_EMOJI: Record<string, string> = {
  nedstamd:   '😔',
  ledsen:     '😢',
  angslig:    '😰',
  orolig:     '😟',
  arg:        '😤',
  stressad:   '😫',
  radd:       '😨',
  hopplos:    '😞',
  tacksam:    '🤲',
  angerfull:  '😓',
};

// ── Sub-components ────────────────────────────────────────────────────────────

const MoodChip = memo(function MoodChip({
  mood,
  active,
  onPress,
  T,
}: {
  mood: { id: string; label: string };
  active: boolean;
  onPress: () => void;
  T: ReturnType<typeof useTheme>['theme'];
}) {
  const emoji = MOOD_EMOJI[mood.id] ?? '🤲';
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[
        styles.moodChip,
        {
          backgroundColor: active ? T.accent : T.card,
          borderColor: active ? T.accent : T.border,
        },
      ]}
    >
      <Text style={styles.moodEmoji}>{emoji}</Text>
      <Text
        style={[
          styles.moodLabel,
          { color: active ? '#fff' : T.text },
        ]}
      >
        {mood.label}
      </Text>
    </TouchableOpacity>
  );
});

const DhikrResultRow = memo(function DhikrResultRow({
  result,
  onPress,
  T,
  isDark,
}: {
  result: DhikrSearchResult;
  onPress: () => void;
  T: ReturnType<typeof useTheme>['theme'];
  isDark: boolean;
}) {
  const { dhikr } = result;
  const hasMoodTag  = (dhikr._wellbeing?.mood_tags?.length ?? 0) > 0;
  const hasAudio    = !!dhikr.mp3_url;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[styles.resultRow, { borderBottomColor: T.border }]}
    >
      <View style={styles.resultContent}>
        <Text style={[styles.resultTitle, { color: T.text }]} numberOfLines={2}>
          {dhikr.titel}
        </Text>
        <View style={styles.resultMeta}>
          <View style={[styles.metaBadge, { backgroundColor: T.accentGlow }]}>
            <Text style={[styles.metaBadgeText, { color: T.accent }]}>
              {dhikr._kategori}
            </Text>
          </View>
          <Text style={[styles.metaSep, { color: T.textMuted }]}>›</Text>
          <Text style={[styles.metaUnder, { color: T.textMuted }]} numberOfLines={1}>
            {dhikr._undersida}
          </Text>
        </View>
        {!!dhikr.arabisk_text && (
          <Text
            style={[styles.resultArabic, { color: T.textMuted }]}
            numberOfLines={1}
          >
            {dhikr.arabisk_text}
          </Text>
        )}
      </View>
      <View style={styles.resultTrailing}>
        {hasAudio && (
          <View style={[styles.audioDot, { backgroundColor: T.accent }]} />
        )}
        <Svg
          width={12}
          height={12}
          viewBox="0 0 24 24"
          fill="none"
          stroke={T.textMuted}
          strokeWidth={2.2}
          strokeLinecap="round"
        >
          <Path d="M9 18l6-6-6-6" />
        </Svg>
      </View>
    </TouchableOpacity>
  );
});

// ── Main component ────────────────────────────────────────────────────────────

type Props = {
  onSelectDhikr: (d: DhikrPost, siblings: DhikrPost[]) => void;
};

function DhikrWellbeingView({ onSelectDhikr }: Props) {
  const { theme: T, isDark } = useTheme();

  const [activeMood, setActiveMood] = useState<string | null>(null);
  const [searchQ,    setSearchQ]    = useState('');

  const isSearching = searchQ.trim().length >= 2;

  // Mood results
  const moodResults = useMemo<DhikrSearchResult[]>(() => {
    if (!activeMood) return [];
    return getDhikrForMood(activeMood, 40);
  }, [activeMood]);

  // Text search results
  const searchResults = useMemo<DhikrSearchResult[]>(() => {
    if (!isSearching) return [];
    return searchDhikr(searchQ, 60);
  }, [searchQ, isSearching]);

  const displayResults = isSearching ? searchResults : moodResults;
  const showResults    = isSearching || !!activeMood;

  const handleMoodPress = useCallback((moodId: string) => {
    setActiveMood((prev) => (prev === moodId ? null : moodId));
    setSearchQ('');
  }, []);

  const handleSearchChange = useCallback((text: string) => {
    setSearchQ(text);
    if (text.trim().length > 0) setActiveMood(null);
  }, []);

  const handleClear = useCallback(() => {
    setSearchQ('');
    setActiveMood(null);
  }, []);

  const handleSelectResult = useCallback(
    (result: DhikrSearchResult) => {
      onSelectDhikr(result.dhikr, []);
    },
    [onSelectDhikr],
  );

  const activeMoodLabel = activeMood
    ? WELLBEING_MOODS.find((m) => m.id === activeMood)?.label
    : null;

  const searchBg    = isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.06)';

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: 120 }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {/* ── Intro header ── */}
      <View style={[styles.intro, { borderBottomColor: T.border }]}>
        <View style={[styles.introBadge, { backgroundColor: T.accentGlow }]}>
          <Text style={[styles.introBadgeText, { color: T.accent }]}>Välmående</Text>
        </View>
        <Text style={[styles.introTitle, { color: T.text }]}>
          Hur mår du just nu?
        </Text>
        <Text style={[styles.introSub, { color: T.textMuted }]}>
          Välj ett känsloläge eller sök fritt — vi visar dhikr och du'a anpassat till dig.
        </Text>
      </View>

      {/* ── Search bar ── */}
      <View
        style={[
          styles.searchBar,
          {
            backgroundColor: searchBg,
            borderColor: T.border,
          },
        ]}
      >
        <Svg
          width={15}
          height={15}
          viewBox="0 0 24 24"
          fill="none"
          stroke={T.textMuted}
          strokeWidth={2.2}
          strokeLinecap="round"
        >
          <Path d="M21 21l-4.35-4.35" />
          <Path d="M11 19A8 8 0 1 0 11 3a8 8 0 0 0 0 16z" />
        </Svg>
        <TextInput
          value={searchQ}
          onChangeText={handleSearchChange}
          placeholder="Sök efter känsla, problem eller dhikr…"
          placeholderTextColor={T.textMuted}
          style={[styles.searchInput, { color: T.text }]}
          autoCorrect={false}
          returnKeyType="search"
        />
        {(searchQ.length > 0 || activeMood) && (
          <TouchableOpacity onPress={handleClear} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={[styles.clearBtn, { color: T.textMuted }]}>×</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Mood chips ── */}
      {!isSearching && (
        <>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: T.textMuted }]}>KÄNSLOLÄGE</Text>
          </View>
          <View style={styles.moodGrid}>
            {WELLBEING_MOODS.map((mood) => (
              <MoodChip
                key={mood.id}
                mood={mood}
                active={activeMood === mood.id}
                onPress={() => handleMoodPress(mood.id)}
                T={T}
              />
            ))}
          </View>
        </>
      )}

      {/* ── Active mood label ── */}
      {activeMoodLabel && !isSearching && (
        <View style={styles.activeFilterRow}>
          <View style={[styles.activeFilter, { backgroundColor: T.accentGlow, borderColor: T.accent }]}>
            <Text style={[styles.activeFilterText, { color: T.accent }]}>
              {MOOD_EMOJI[activeMood!]} {activeMoodLabel}
            </Text>
            <TouchableOpacity onPress={() => setActiveMood(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={T.accent} strokeWidth={2.5} strokeLinecap="round">
                <Path d="M18 6L6 18M6 6l12 12" />
              </Svg>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Results ── */}
      {showResults && (
        <>
          <View style={[styles.resultsHeader, { borderBottomColor: T.border }]}>
            <Text style={[styles.resultsTitle, { color: T.text }]}>
              {isSearching ? 'Sökresultat' : `Rekommenderat för "${activeMoodLabel}"`}
            </Text>
            <Text style={[styles.resultsCount, { color: T.textMuted }]}>
              {displayResults.length} dhikr
            </Text>
          </View>

          {displayResults.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={[styles.emptyIcon, { color: T.textMuted }]}>🔍</Text>
              <Text style={[styles.emptyTitle, { color: T.text }]}>Inga träffar</Text>
              <Text style={[styles.emptySub, { color: T.textMuted }]}>
                Prova ett annat ord eller välj ett annat känsloläge.
              </Text>
            </View>
          ) : (
            displayResults.map((result, i) => (
              <DhikrResultRow
                key={result.dhikr.url || result.dhikr.titel + i}
                result={result}
                onPress={() => handleSelectResult(result)}
                T={T}
                isDark={isDark}
              />
            ))
          )}
        </>
      )}

      {/* ── Empty home state (no mood, no search) ── */}
      {!showResults && (
        <View style={styles.homeEmpty}>
          <Text style={[styles.homeEmptyText, { color: T.textMuted }]}>
            Välj ett känsloläge ovan eller skriv i sökrutan för att hitta dhikr.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  intro: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  introBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
    marginBottom: 10,
  },
  introBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  introTitle: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  introSub: {
    fontSize: 13,
    lineHeight: 20,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 14,
    marginTop: 14,
    marginBottom: 6,
    paddingHorizontal: 13,
    paddingVertical: 11,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    padding: 0,
  },
  clearBtn: {
    fontSize: 20,
    lineHeight: 22,
  },
  sectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 10,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  moodGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    gap: 8,
  },
  moodChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 24,
    borderWidth: 1,
  },
  moodEmoji: {
    fontSize: 16,
  },
  moodLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  activeFilterRow: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 4,
  },
  activeFilter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  activeFilterText: {
    fontSize: 13,
    fontWeight: '600',
  },
  resultsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  resultsTitle: {
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
    marginRight: 8,
  },
  resultsCount: {
    fontSize: 12,
    fontWeight: '500',
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  resultContent: {
    flex: 1,
    minWidth: 0,
  },
  resultTitle: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 20,
    marginBottom: 5,
  },
  resultMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'wrap',
  },
  metaBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 20,
  },
  metaBadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  metaSep: {
    fontSize: 11,
  },
  metaUnder: {
    fontSize: 11,
    flex: 1,
  },
  resultArabic: {
    fontSize: 13,
    marginTop: 4,
    textAlign: 'right',
  },
  resultTrailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  audioDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 40,
    paddingBottom: 24,
    paddingHorizontal: 32,
  },
  emptyIcon: {
    fontSize: 40,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  emptySub: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
  },
  homeEmpty: {
    paddingHorizontal: 24,
    paddingTop: 32,
    alignItems: 'center',
  },
  homeEmptyText: {
    fontSize: 13,
    lineHeight: 21,
    textAlign: 'center',
  },
});

export default memo(DhikrWellbeingView);
