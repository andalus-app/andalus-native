/**
 * QuranSearchModal.tsx
 *
 * Full-screen search with grouped results: Sidor / Suror / Juz / Vers.
 * - Numeric queries search across all three number categories simultaneously.
 * - Text queries match surah names.
 * - Verse-key queries ("2:1") navigate directly.
 * - Query persists across open/close; recent searches stored in AsyncStorage.
 */

import React, { useEffect, useRef, memo, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  StyleSheet,
  TextInput,
  ScrollView,
  Platform,
} from 'react-native';
import { BlurView } from 'expo-blur';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SvgIcon from '../SvgIcon';
import { useTheme } from '../../context/ThemeContext';
import { useQuranContext } from '../../context/QuranContext';
import { search, pageForResult, VERSE_RE, type SearchResult } from '../../services/quranSearchService';
import {
  searchTranslation,
  type TranslationMatch,
} from '../../services/quranTranslationService';

const RECENT_KEY = 'andalus_quran_searches_v1';
const MAX_RECENT = 5;

// ── Helpers ───────────────────────────────────────────────────────────────────

function keyForItem(item: SearchResult): string {
  switch (item.kind) {
    case 'verse': return `verse-${item.surahId}-${item.verseNumber}`;
    case 'page':  return `page-${item.pageNumber}`;
    case 'surah': return `surah-${item.surah.id}`;
    case 'juz':   return `juz-${item.juz.id}`;
  }
}

function contentForItem(item: SearchResult, resolvedVersePage: number | null): { left: string; right: string } {
  switch (item.kind) {
    case 'verse': return {
      left: item.label,
      right: resolvedVersePage !== null ? `Sida ${resolvedVersePage}` : '…',
    };
    case 'page':  return { left: `Sida ${item.pageNumber}`,                    right: item.surahName };
    case 'surah': return { left: `${item.surah.id}. ${item.surah.nameSimple}`, right: `Sida ${item.surah.firstPage}` };
    case 'juz':   return { left: `Juz ${item.juz.id}`,                        right: `Sida ${item.juz.firstPage}` };
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

function QuranSearchModal() {
  const { theme: T, isDark } = useTheme();
  const { searchOpen, closeSearch, goToPage, goToSurah, goToVerse, settings } = useQuranContext();
  const insets = useSafeAreaInsets();

  const [query, setQuery] = useState('');
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const recentRef = useRef<string[]>([]);

  // Async-resolved page number for verse-key queries (e.g. 2:255 → page 42)
  const [resolvedVersePage, setResolvedVersePage] = useState<number | null>(null);
  const verseAbortRef = useRef<AbortController | null>(null);

  // Translation search results
  const [translationResults, setTranslationResults] = useState<TranslationMatch[]>([]);
  const transSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const slideAnim = useRef(new Animated.Value(50)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  // Build grouped sections from query
  const sections = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    const s = search(q);
    const result: Array<{ title: string; data: SearchResult[] }> = [];
    if (s.verses.length > 0) result.push({ title: 'Vers',  data: s.verses });
    if (s.pages.length  > 0) result.push({ title: 'Sidor', data: s.pages  });
    if (s.surahs.length > 0) result.push({ title: 'Sura',  data: s.surahs });
    if (s.juz.length    > 0) result.push({ title: 'Juz',   data: s.juz    });
    return result;
  }, [query]);

  const isEmpty     = query.trim().length === 0;
  const hasResults  = sections.length > 0 || translationResults.length > 0;

  // Load recent searches each time modal opens
  useEffect(() => {
    if (!searchOpen) return;
    AsyncStorage.getItem(RECENT_KEY).then((val) => {
      if (!val) return;
      try {
        const parsed = JSON.parse(val) as string[];
        recentRef.current = parsed;
        setRecentSearches(parsed);
      } catch {}
    });
  }, [searchOpen]);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: searchOpen ? 0 : 50,
        duration: 260,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: searchOpen ? 1 : 0,
        duration: 260,
        useNativeDriver: true,
      }),
    ]).start();
    // Query intentionally NOT cleared on close — persists for next open
  }, [searchOpen, slideAnim, opacityAnim]);

  // Fetch the real Mushaf page for a verse key (e.g. 2:255 → 42) from Quran.com API
  useEffect(() => {
    const vm = query.trim().match(VERSE_RE);
    if (!vm) {
      setResolvedVersePage(null);
      return;
    }

    setResolvedVersePage(null);
    if (verseAbortRef.current) verseAbortRef.current.abort();
    const ctrl = new AbortController();
    verseAbortRef.current = ctrl;

    fetch(
      `https://api.quran.com/api/v4/verses/by_key/${vm[1]}:${vm[2]}?words=false&fields=page_number`,
      { signal: ctrl.signal },
    )
      .then((r) => r.json())
      .then((data: { verse?: { page_number?: number } }) => {
        const page = data?.verse?.page_number;
        if (typeof page === 'number') setResolvedVersePage(page);
      })
      .catch(() => {}); // abort or network error → keep null, navigation falls back to surah firstPage

    return () => ctrl.abort();
  }, [query]);

  // Debounced translation search — only for text queries against the active translation.
  // Skipped for numeric queries (page/surah/juz) and verse-key queries (2:255),
  // since those are structural and never appear in translation text.
  useEffect(() => {
    const q = query.trim();
    const isStructural = /^\d+$/.test(q) || VERSE_RE.test(q);
    if (!searchOpen || settings.translationId === null || q.length < 2 || isStructural) {
      setTranslationResults([]);
      return;
    }
    if (transSearchRef.current) clearTimeout(transSearchRef.current);
    transSearchRef.current = setTimeout(async () => {
      const results = await searchTranslation(q, settings.translationId!);
      setTranslationResults(results);
    }, 300);
    return () => {
      if (transSearchRef.current) clearTimeout(transSearchRef.current);
    };
  }, [query, searchOpen, settings.translationId]);

  const saveRecentSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    const updated = [trimmed, ...recentRef.current.filter((r) => r !== trimmed)].slice(0, MAX_RECENT);
    recentRef.current = updated;
    setRecentSearches(updated);
    await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(updated));
  }, []);

  const removeRecent = useCallback(async (r: string) => {
    const updated = recentRef.current.filter((item) => item !== r);
    recentRef.current = updated;
    setRecentSearches(updated);
    await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(updated));
  }, []);

  const handleTranslationSelect = useCallback(
    (match: TranslationMatch) => {
      if (query.trim()) saveRecentSearch(query);
      closeSearch();
      // Fetch the exact Mushaf page using word-level page_number with mushaf=1.
      // mushaf=1 is mandatory — without it the API returns page numbers for a
      // different edition, causing navigation to a completely wrong surah.
      // verse-level page_number is also unreliable (see CLAUDE.md fixed bugs).
      const [surahPart, versePart] = match.verseKey.split(':');
      fetch(
        `https://api.quran.com/api/v4/verses/by_key/${surahPart}:${versePart}` +
        `?words=true&word_fields=code_v2,page_number&mushaf=1`,
      )
        .then((r) => r.json())
        .then((data: { verse?: { words?: Array<{ page_number?: number }> } }) => {
          const page = data?.verse?.words?.[0]?.page_number;
          if (typeof page === 'number') {
            // goToVerse: switches to verse mode, navigates to page, scrolls to the verse
            goToVerse(match.verseKey, page);
          }
        })
        .catch(() => {}); // network error — modal is already closed, nothing to undo
    },
    [goToVerse, closeSearch, saveRecentSearch, query],
  );

  const handleSelect = useCallback(
    (item: SearchResult) => {
      if (query.trim()) saveRecentSearch(query);
      if (item.kind === 'surah') {
        // goToSurah sets pendingSurahScroll so verse-by-verse mode scrolls to
        // the surah header, matching the hamburger menu behaviour.
        goToSurah(item.surah.id);
      } else if (item.kind === 'verse') {
        const page = resolvedVersePage !== null ? resolvedVersePage : pageForResult(item);
        // goToVerse sets pendingVerseHighlight so verse-by-verse mode scrolls to
        // the correct verse within the page, not just to the top of the page.
        goToVerse(`${item.surahId}:${item.verseNumber}`, page);
      } else {
        goToPage(pageForResult(item));
      }
      closeSearch();
    },
    [goToPage, goToSurah, goToVerse, closeSearch, saveRecentSearch, query, resolvedVersePage],
  );

  return (
    <Animated.View
      style={[
        styles.container,
        { opacity: opacityAnim, transform: [{ translateY: slideAnim }] },
      ]}
      pointerEvents={searchOpen ? 'auto' : 'none'}
    >
      <BlurView
        intensity={isDark ? 85 : 95}
        tint={isDark ? 'dark' : 'light'}
        style={StyleSheet.absoluteFill}
      />
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: isDark
              ? 'rgba(10,10,10,0.88)'
              : 'rgba(248,248,252,0.88)',
          },
        ]}
      />

      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={[styles.searchBar, { backgroundColor: T.cardSecondary, borderColor: T.border }]}>
          <SvgIcon name="search" size={16} color={T.textMuted} />
          <TextInput
            style={[styles.searchInput, { color: T.text }]}
            placeholder={
              settings.translationId !== null
                ? 'Sök sida, sura, juz, 2:255 eller svenska ord'
                : 'Sök sida, sura, juz eller 2:255'
            }
            placeholderTextColor={T.textMuted}
            value={query}
            onChangeText={setQuery}
            autoFocus={searchOpen}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')} activeOpacity={0.7}>
              <SvgIcon name="close" size={16} color={T.textMuted} />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity style={styles.cancelBtn} onPress={closeSearch} activeOpacity={0.7}>
          <Text style={[styles.cancelText, { color: T.accent }]}>Avbryt</Text>
        </TouchableOpacity>
      </View>

      {/* ── Empty query: recent searches + hints ── */}
      {isEmpty && (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 20 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {recentSearches.length > 0 && (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: T.textMuted }]}>Senaste sökningar</Text>
              {recentSearches.map((r) => (
                <View key={r} style={styles.recentRow}>
                  <TouchableOpacity style={styles.recentMain} onPress={() => setQuery(r)} activeOpacity={0.7}>
                    <SvgIcon name="search" size={14} color={T.textMuted} />
                    <Text style={[styles.recentText, { color: T.text }]}>{r}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => removeRecent(r)}
                    activeOpacity={0.7}
                    hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                  >
                    <SvgIcon name="close" size={14} color={T.textMuted} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          <View style={[
            styles.hints,
            recentSearches.length > 0 && { paddingTop: 20, marginTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.border },
          ]}>
            <Text style={[styles.hintTitle, { color: T.text }]}>Sökexempel</Text>
            <Text style={[styles.hint, { color: T.textMuted }]}>
              <Text style={{ color: T.accent }}>{'2:255'}</Text>{'  →  Vers (surah:vers)'}
            </Text>
            <Text style={[styles.hint, { color: T.textMuted }]}>
              <Text style={{ color: T.accent }}>{'Fatiha'}</Text>{'  →  Suranamn'}
            </Text>
            <Text style={[styles.hint, { color: T.textMuted }]}>
              <Text style={{ color: T.accent }}>{'18'}</Text>{'  →  Suranummer'}
            </Text>
            <Text style={[styles.hint, { color: T.textMuted }]}>
              <Text style={{ color: T.accent }}>{'604'}</Text>{'  →  Sidnummer'}
            </Text>
            {settings.translationId !== null && (
              <Text style={[styles.hint, { color: T.textMuted }]}>
                <Text style={{ color: T.accent }}>{'nåd'}</Text>{'  →  Sök i översättning'}
              </Text>
            )}
          </View>
        </ScrollView>
      )}

      {/* ── Results: grouped sections ── */}
      {!isEmpty && hasResults && (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 20 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {sections.map(({ title, data }) => (
            <View key={title} style={styles.resultSection}>
              <Text style={[styles.resultSectionTitle, { color: T.text }]}>{title}</Text>
              <View style={[styles.card, { backgroundColor: T.card, borderColor: T.border }]}>
                {data.map((item, index) => {
                  const { left, right } = contentForItem(item, resolvedVersePage);
                  return (
                    <React.Fragment key={keyForItem(item)}>
                      {index > 0 && (
                        <View style={[styles.rowSeparator, { backgroundColor: T.border }]} />
                      )}
                      <TouchableOpacity
                        style={styles.row}
                        onPress={() => handleSelect(item)}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.rowLeft, { color: T.text }]} numberOfLines={1}>
                          {left}
                        </Text>
                        <Text
                          style={[
                            styles.rowRight,
                            { color: T.textMuted },
                            item.kind === 'verse' && styles.rowRightSubtle,
                          ]}
                          numberOfLines={1}
                        >
                          {right}
                        </Text>
                      </TouchableOpacity>
                    </React.Fragment>
                  );
                })}
              </View>
            </View>
          ))}

          {/* ── Translation results ── */}
          {translationResults.length > 0 && (
            <View style={styles.resultSection}>
              <Text style={[styles.resultSectionTitle, { color: T.text }]}>Översättning</Text>
              <View style={[styles.card, { backgroundColor: T.card, borderColor: T.border }]}>
                {translationResults.map((match, index) => {
                  // Build a short excerpt around the match
                  const start = Math.max(0, match.matchStart - 28);
                  const end   = Math.min(match.text.length, match.matchEnd + 48);
                  const prefix = start > 0 ? '…' : '';
                  const suffix = end < match.text.length ? '…' : '';
                  const before = match.text.slice(start, match.matchStart);
                  const hit    = match.text.slice(match.matchStart, match.matchEnd);
                  const after  = match.text.slice(match.matchEnd, end);

                  return (
                    <React.Fragment key={`trans-${match.verseKey}`}>
                      {index > 0 && (
                        <View style={[styles.rowSeparator, { backgroundColor: T.border }]} />
                      )}
                      <TouchableOpacity
                        style={styles.transRow}
                        onPress={() => handleTranslationSelect(match)}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.transVerseKey, { color: T.accent }]}>
                          {match.verseKey}
                        </Text>
                        <Text style={[styles.transSnippet, { color: T.textSecondary }]} numberOfLines={2}>
                          {prefix}{before}
                          <Text style={{ color: T.accent, fontWeight: '600' }}>{hit}</Text>
                          {after}{suffix}
                        </Text>
                      </TouchableOpacity>
                    </React.Fragment>
                  );
                })}
              </View>
            </View>
          )}
        </ScrollView>
      )}

      {/* ── No results ── */}
      {!isEmpty && !hasResults && (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: T.textMuted }]}>Inga resultat</Text>
        </View>
      )}
    </Animated.View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 250,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 10,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 0,
  },
  cancelBtn: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '500',
  },

  // Shared scroll
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 4,
  },

  // Empty query state — recent searches
  section: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  recentMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  recentText: {
    fontSize: 14,
  },

  // Hints
  hints: {
    paddingHorizontal: 20,
    paddingTop: 24,
    gap: 10,
  },
  hintTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 4,
  },
  hint: {
    fontSize: 14,
  },

  // Result sections
  resultSection: {
    marginTop: 8,
  },
  resultSectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  card: {
    marginHorizontal: 16,
    borderRadius: 12,
    borderWidth: 0.5,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
  },
  rowLeft: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
  },
  rowRight: {
    fontSize: 14,
    flexShrink: 0,
  },
  rowRightSubtle: {
    fontSize: 12,
    opacity: 0.7,
  },
  rowSeparator: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 16,
  },

  // Translation result row
  transRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 4,
  },
  transVerseKey: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  transSnippet: {
    fontSize: 13,
    lineHeight: 18,
  },

  // No results
  empty: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 60,
  },
  emptyText: {
    fontSize: 15,
  },
});

export default memo(QuranSearchModal);
