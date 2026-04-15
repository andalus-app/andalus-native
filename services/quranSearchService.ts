/**
 * quranSearchService.ts
 *
 * Grouped search returning separate buckets for sidor, suror, juz och vers.
 * Numeric queries (e.g. "1", "10", "604") match all three number-based categories.
 * Text queries match surah names only.
 * Verse-key queries ("2:1") return a single verse result.
 */

import { SURAH_INDEX, JUZ_INDEX, surahForPage, type SurahInfo, type JuzInfo } from '../data/surahIndex';

// ── Types ─────────────────────────────────────────────────────────────────────

export type VerseResult = {
  kind: 'verse';
  surahId: number;
  verseNumber: number;
  pageNumber: number;
  label: string;
};

export type PageResult = {
  kind: 'page';
  pageNumber: number;
  surahName: string;
};

export type SurahResult = {
  kind: 'surah';
  surah: SurahInfo;
};

export type JuzResult = {
  kind: 'juz';
  juz: JuzInfo;
  surahName: string;
};

export type SearchResult = VerseResult | PageResult | SurahResult | JuzResult;

/** One bucket per result category — empty arrays mean no matches for that category. */
export type SearchSections = {
  verses: VerseResult[];
  pages:  PageResult[];
  surahs: SurahResult[];
  juz:    JuzResult[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Normalize a surah name for fuzzy matching:
 * NFD + strip diacritics, lowercase, strip al-/an-/… prefixes, strip punctuation.
 */
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^a[dlnrst][- ']?/i, '')
    .replace(/['\-\s]/g, '');
}

/** "2:1", "2.1", "2 1" — exported so consumers can detect verse-key queries. */
export const VERSE_RE = /^(\d{1,3})[:\s.](\d{1,4})$/;

const MAX_PER_SECTION = 5;
const EMPTY: SearchSections = { verses: [], pages: [], surahs: [], juz: [] };

// ── Public API ────────────────────────────────────────────────────────────────

export function search(query: string): SearchSections {
  const q = query.trim();
  if (!q) return EMPTY;

  // Verse key e.g. "2:1"
  const vm = q.match(VERSE_RE);
  if (vm) {
    const surahId = parseInt(vm[1], 10);
    const verseNumber = parseInt(vm[2], 10);
    const surah = SURAH_INDEX.find((s) => s.id === surahId);
    if (surah && surahId >= 1 && surahId <= 114) {
      return {
        ...EMPTY,
        verses: [{
          kind: 'verse',
          surahId,
          verseNumber,
          pageNumber: surah.firstPage,
          label: `${surah.nameSimple} ${surahId}:${verseNumber}`,
        }],
      };
    }
    return EMPTY;
  }

  // Pure number → exact match across pages, surahs, juz
  if (/^\d+$/.test(q)) {
    const n = parseInt(q, 10);

    const pages: PageResult[] = (n >= 1 && n <= 604)
      ? [{ kind: 'page', pageNumber: n, surahName: surahForPage(n).nameSimple }]
      : [];

    const surah = SURAH_INDEX.find((s) => s.id === n);
    const surahs: SurahResult[] = surah ? [{ kind: 'surah', surah }] : [];

    const juzEntry = JUZ_INDEX.find((j) => j.id === n);
    const juz: JuzResult[] = juzEntry
      ? [{ kind: 'juz', juz: juzEntry, surahName: SURAH_INDEX.find((s) => s.id === juzEntry.surahId)?.nameSimple ?? '' }]
      : [];

    return { ...EMPTY, pages, surahs, juz };
  }

  // Text → surah name substring match
  const nq = normalize(q);
  if (!nq) return EMPTY;

  const surahs: SurahResult[] = SURAH_INDEX
    .filter((s) => normalize(s.nameSimple).includes(nq))
    .map((s) => ({ kind: 'surah', surah: s }));

  return { ...EMPTY, surahs };
}

/** Get the Mushaf page to navigate to for any result kind. */
export function pageForResult(result: SearchResult): number {
  switch (result.kind) {
    case 'verse': return result.pageNumber;
    case 'page':  return result.pageNumber;
    case 'surah': return result.surah.firstPage;
    case 'juz':   return result.juz.firstPage;
  }
}
