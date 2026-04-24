/**
 * mushafApi.ts — QCF V2 Mushaf data pipeline and page composition model
 *
 * ═══════════════════════════════════════════════════════════════
 * TWO-LAYER PAGE MODEL
 * ═══════════════════════════════════════════════════════════════
 *
 * A complete Mushaf page is composed of two independent layers:
 *
 *   VERSE LAYER  — words with line_number from the verse API.
 *                  Every word has verse_key, position, char_type_name,
 *                  code_v2 (QCF glyph character). Grouped by line_number.
 *
 *   DECORATION LAYER — non-verse elements that occupy the remaining line
 *                  slots. Types: surah_header, bismillah, page_ornament.
 *                  Derived from chapter metadata + gap analysis (see below).
 *
 * Neither layer is inferred from the other. The verse API is authoritative
 * for line content. The decoration layer is authoritative for headers.
 *
 * ═══════════════════════════════════════════════════════════════
 * GAP ANALYSIS
 * ═══════════════════════════════════════════════════════════════
 *
 * Standard Mushaf: 15 line slots per page.
 * "Gap" = a slot number not occupied by any verse word.
 *
 * Gap classification (in slot order, from top):
 *   • Gap before first verse word: surah header for the surah whose
 *     first page matches this page number (one gap = header; two
 *     consecutive gaps = header + bismillah or header + ornament).
 *   • Gap after last verse word: decorative/ornamental content
 *     (end-of-page decoration, or surah-end + next-surah announcement).
 *   • Internal gap (between verse lines): surah transition — end of
 *     one surah + start of the next (header + bismillah).
 *
 * ═══════════════════════════════════════════════════════════════
 * QCF V2 CODE ENCODING
 * ═══════════════════════════════════════════════════════════════
 *
 * The Quran Foundation API returns code_v2 as Unicode characters directly
 * (not hex strings). Each character is a codepoint that the page-specific
 * QCF V2 font maps directly to a Mushaf glyph via cmap lookup.
 *
 * This bypasses Unicode shaping entirely:
 *   • No BiDi algorithm (visual order is already in API data)
 *   • No GSUB ligature substitution (glyphs are pre-composed)
 *   • No contextual substitution
 *   • Codepoint → glyph is a 1:1 cmap lookup in the QCF font
 *
 * Verse-end ornaments (char_type_name: "end") ARE included in line glyphs.
 * They occupy their own position in line_number and have their own code_v2.
 * Element counts in validation tables below include end ornaments.
 *
 * ═══════════════════════════════════════════════════════════════
 * VALIDATED LINE DATA (live API, 2026-03-31, mushaf=1)
 * ═══════════════════════════════════════════════════════════════
 *
 * PAGE 1 — Surah Al-Fatihah (complete page structure)
 *
 *   slot  1: SURAH_HEADER  — Al-Fatihah (surah 1, Makkia, 7 verses)
 *   slot  2: VERSE_LINE    — 1:1 [pos1 pos2 pos3 pos4 ENDpos5]  5 elements
 *   slot  3: VERSE_LINE    — 1:2 [pos1 pos2 pos3 pos4 ENDpos5]  5 elements
 *   slot  4: VERSE_LINE    — 1:3[pos1..END] + 1:4[pos1..END]   7 elements
 *            (1:3 = 2 words + END; 1:4 = 3 words + END; share one slot)
 *   slot  5: VERSE_LINE    — 1:5[pos1..END] + 1:6[pos1]        6 elements
 *            (1:5 = 4 words + END; 1:6 first word; share one slot)
 *   slot  6: VERSE_LINE    — 1:6[pos2..END] + 1:7[pos1..pos3]  6 elements
 *            (1:6 = 2 words + END; 1:7 first 3 words; share one slot)
 *   slot  7: VERSE_LINE    — 1:7[pos4..pos7]                   4 elements
 *   slot  8: VERSE_LINE    — 1:7[pos8..pos9..ENDpos10]         3 elements
 *            (word + word + verse-end ornament)
 *   slots 9-15: DECORATION — Al-Baqarah pre-announcement header + ornaments
 *            (Al-Baqarah verse content confirmed NOT on page 1;
 *             pages[0] for surah 2 = 2, confirmed via chapters API)
 *
 *   Total verse elements: 5+5+7+6+6+4+3 = 36 (includes 7 verse-end ornaments)
 *
 * PAGE 2 — Al-Baqarah (Mushaf page 2, surah 2 starts here)
 *
 *   slot  1: SURAH_HEADER  — Al-Baqarah (surah 2, Madania, 286 verses)
 *   slot  2: BISMILLAH     — standalone bismillah (bismillah_pre: true,
 *                            not a verse; appears before verse content)
 *   slot  3: VERSE_LINE    — 2:1[pos1 ENDpos2] + 2:2[pos1..pos6]  8 elements
 *            (2:1 = alif-lam-mim [1 word] + END; 2:2 first 6 words)
 *   slot  4: VERSE_LINE    — 2:2[pos7..ENDpos8] + 2:3[pos1..pos5]  7 elements
 *   slot  5: VERSE_LINE    — 2:3[pos6..ENDpos9] + 2:4[pos1..pos4]  8 elements
 *   slot  6: VERSE_LINE    — 2:4[pos5..ENDpos13]                   9 elements
 *   slot  7: VERSE_LINE    — 2:5[pos1..pos6]                       6 elements
 *   slot  8: VERSE_LINE    — 2:5[pos7..ENDpos9]                    3 elements
 *   slots 9-15: (not in verse API response for page 2 — ornamental or blank)
 *
 *   Note: page 2 API returned verses only up to line 8. Slots 9-15 appear
 *   to be bottom-page decorative elements.
 *
 * PAGE 3 — Al-Baqarah continued (Mushaf page 3)
 *
 *   slot  1: VERSE_LINE    — 2:6[pos1..pos9]                        9 elements
 *   slot  2: VERSE_LINE    — 2:6[pos10..ENDpos12] + 2:7[pos1..pos7] 10 elements
 *   slot  3: VERSE_LINE    — 2:7[pos8..ENDpos13] + 2:8[pos1..pos2]   8 elements
 *   slot  4: VERSE_LINE    — 2:8[pos3..ENDpos12]                    10 elements
 *   slot  5: VERSE_LINE    — 2:9[pos1..pos8]                         8 elements
 *   slot  6: VERSE_LINE    — 2:9[pos9..ENDpos11] + 2:10[pos1..pos6]  9 elements
 *   slot  7: VERSE_LINE    — 2:10[pos7..ENDpos13] + 2:11[pos1..pos3] 10 elements
 *   slot  8: VERSE_LINE    — 2:11[pos4..ENDpos12]                    9 elements
 *   slot  9: VERSE_LINE    — 2:12[pos1..ENDpos8] + 2:13[pos1..pos2] 10 elements
 *   slot 10: VERSE_LINE    — 2:13[pos3..pos12]                      10 elements
 *   slot 11: VERSE_LINE    — 2:13[pos13..ENDpos20] + 2:14[pos1..pos2] 10 elements
 *   slot 12: VERSE_LINE    — 2:14[pos3..pos12]                      10 elements
 *   slot 13: VERSE_LINE    — 2:14[pos13..ENDpos17] + 2:15[pos1..pos4] 9 elements
 *   slot 14: VERSE_LINE    — 2:15[pos5..ENDpos8] + 2:16[pos1..pos4]  8 elements
 *   slot 15: VERSE_LINE    — 2:16[pos5..ENDpos12]                    8 elements
 *
 *   Page 3: all 15 slots are verse lines. No decoration gaps.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { pageCache }           from './quranPageLRU';
import { isPageCached }        from './quranOfflineManifest';
import { readPage, writePage } from './quranPageFileStore';
import { qLog, qWarn }         from './quranPerfLogger';

// ── Constants ─────────────────────────────────────────────────────────────────

const API_BASE      = 'https://api.quran.com/api/v4';
const TOTAL_SLOTS   = 15;  // standard Mushaf page line count (Medina print)
// v4: includes overflow words from BOTH page N-1 and page N+1.
//
// Two classes of API anomaly exist in the Quran Foundation API (mushaf=1):
//
//   BACKWARD overflow (N-1): words have page_number===N but are ONLY returned
//     by verses/by_page/{N-1}. Example: 80:41-42 have page_number=586 but
//     appear only in the verses/by_page/585 response.
//
//   FORWARD overflow (N+1): words have page_number===N but are ONLY returned
//     by verses/by_page/{N+1}. Confirmed for 11 pages as of 2026-04-02:
//       p.120 → 5:77    p.121 → 5:83    p.122 → 5:90
//       p.531 → 55:17,55:18             p.532 → 55:41
//       p.533 → 55:68,55:69             p.564 → 68:16
//       p.567 → 69:35   p.569 → 70:40   p.575 → 74:18   p.583 → 79:16
//
// Fetching all three pages (N-1, N, N+1) and filtering by page_number===N
// guarantees complete verse coverage regardless of which endpoint returns them.
//
// Cache version bumped v3→v4 to invalidate old incomplete caches.
const CACHE_KEY     = (n: number) => `andalus_mushaf_cache_v4_${n}`;
const CH_CACHE_KEY  = (n: number) => `andalus_mushaf_chapter_v3_${n}`;

// ── In-memory cache for surah metadata ───────────────────────────────────────
//
// fetchSurahMeta is called multiple times per page and multiple times per
// session. Without an in-memory cache every call awaits AsyncStorage.getItem()
// (50–200ms on real devices) even for surahs already fetched this session.
// This Map short-circuits to a synchronously-resolved Promise for any surah
// fetched since app launch.
const _surahMetaCache = new Map<number, SurahMeta>();

// ── In-memory cache for composed pages ───────────────────────────────────────
//
// Previously an unbounded Map<number, ComposedMushafPage>. Replaced by pageCache
// (LRU, max 25 entries) from quranPageLRU.ts. The LRU bounds heap to ≈25 pages
// (≈1.25 MB) instead of accumulating all 604 during background prefetch (≈30 MB).
//
// Resolution order in fetchComposedMushafPage:
//   1. pageCache (LRU in-memory)    — < 1 ms, synchronous
//   2. quranPageFileStore (disk)    — ~2–5 ms async, offline-first
//   3. AsyncStorage (verse data)    — existing fallback, unchanged
//   4. Network fetch                — existing fallback, unchanged
//
// _composedPageInFlight deduplicates concurrent calls (e.g. pre-warm racing
// QuranPageView's own load) so only one FileStore/AsyncStorage/network round-trip
// fires for each page.
const _composedPageInFlight = new Map<number, Promise<ComposedMushafPage>>();

// ── In-flight deduplication for raw verse API responses ──────────────────────
//
// When QuranPager pre-warms pages N-3 to N+3 simultaneously (7 pages), each
// page's fetchMushafPageVerses fires overflow fetches for N-1 and N+1.
// Without deduplication, adjacent pre-warm calls hit the same URL 2-3 times:
//
//   fetchMushafPageVerses(5) fires: fetch(url(4)), fetch(url(5)), fetch(url(6))
//   fetchMushafPageVerses(6) fires: fetch(url(5)), fetch(url(6)), fetch(url(7))
//   → url(5) and url(6) each fire twice from this pair alone.
//
// _rawVersePageInFlight ensures each page URL is fetched at most once at a time.
// AbortSignal is intentionally NOT forwarded to overflow fetches — these are
// shared between callers and must not be cancelled when one caller unmounts.
// On network error the promise resolves to [] (non-fatal — same as before).
const _rawVersePageInFlight = new Map<number, Promise<ApiVerse[]>>();

/**
 * Synchronous cache probe — returns the composed page if already in memory,
 * or null if it hasn't been fetched yet. Use this to skip the idle→loading
 * state cycle in QuranPageView when the page was pre-warmed by QuranPager.
 */
export function getComposedPageSync(pageNumber: number): ComposedMushafPage | null {
  return pageCache.get(pageNumber) ?? null;
}

// Surahs that do NOT have a bismillah prefix (Al-Fatihah has it as verse 1:1;
// At-Tawbah [surah 9] has no bismillah at all)
const NO_STANDALONE_BISMILLAH = new Set([1, 9]);

// ── Data model — Verse layer ──────────────────────────────────────────────────

/**
 * One word/glyph from the Quran verse API.
 *
 * char_type_name values and rendering:
 *   "word"   — a regular Quran word glyph
 *   "end"    — verse-end ornament (◌ circle or similar); still a QCF glyph
 *   "pause"  — tajweed pause marker; QCF glyph
 *   "sajdah" — prostration marker; QCF glyph
 *   "rab"    — specific recitation marker; QCF glyph
 *   "hizb"   — hizb marker; QCF glyph
 *
 * All types are included in lineGlyph — the QCF font encodes every type.
 * Filtering any type would produce an incorrect Mushaf rendering.
 */
export type MushafWord = {
  charTypeName: string;
  position:     number;
  verseKey:     string;    // "surah:ayah"
  lineNumber:   number;    // 1-based; authoritative from API
  pageNumber:   number;
  glyph:        string;    // code_v2 as returned — Unicode char(s), use as-is
  text:         string;    // text_uthmani — Arabic word text, used for highlight width estimation
};

export type MushafLine = {
  lineNumber:  number;
  words:       MushafWord[];
  lineGlyph:   string;   // concat of all word glyphs — pass to SvgText directly
  verseKeys:   string[]; // unique verse keys in order of appearance
  wordCount:   number;   // total elements including end ornaments
};

export type MushafPage = {
  pageNumber: number;
  lines:      MushafLine[];
  wordCount:  number;
};

// ── Data model — Decoration layer ─────────────────────────────────────────────

/** Chapter metadata needed for decoration layer composition */
export type SurahMeta = {
  id:              number;
  nameArabic:      string;   // e.g. "الفاتحة"
  nameSimple:      string;   // e.g. "Al-Fatihah"
  versesCount:     number;
  revelationPlace: 'makkah' | 'madinah';
  firstPage:       number;   // Mushaf page where verse content starts
  lastPage:        number;
  bismillahPre:    boolean;  // true = standalone bismillah precedes verse content
};

// ── Data model — Composed page (both layers merged) ───────────────────────────

/**
 * A single line slot on a Mushaf page — one of five possible types.
 *
 * verse_line   : rendered with QCF page font + lineGlyph
 * surah_header : decorated banner: surah name + verse count + revelation type
 * bismillah    : standalone bismillah line (not verse 1:1)
 * ornament     : decorative non-text element (page borders, surah dividers)
 * unknown      : gap slot whose type cannot be determined from available data
 *                (renders as blank space — never as guessed content)
 */
export type MushafSlot =
  | { kind: 'verse_line';   slotNumber: number; line: MushafLine }
  | {
      kind: 'surah_header';
      slotNumber: number;
      surah: SurahMeta;
      /**
       * true when no separate bismillah slot could be placed after this header
       * (only 1 gap slot existed for this surah transition). The renderer will
       * embed the bismillah ligature within the header slot's own space.
       */
      bismillahEmbedded: boolean;
    }
  | { kind: 'bismillah';    slotNumber: number; surahId: number }
  | { kind: 'ornament';     slotNumber: number; variant: 'inter_surah' | 'page_end' }
  | { kind: 'unknown';      slotNumber: number };

/**
 * A complete Mushaf page with all TOTAL_SLOTS accounted for.
 *
 * Every slot from 1 to TOTAL_SLOTS is present.
 * No slot is ever skipped — gaps default to 'unknown' until more data
 * is available.
 */
export type ComposedMushafPage = {
  pageNumber:  number;
  slots:       MushafSlot[];   // length === TOTAL_SLOTS (15)
  versePage:   MushafPage;     // the raw verse API data
  surahs:      SurahMeta[];    // surahs that appear on this page
};

// ── Chapter API ───────────────────────────────────────────────────────────────

type ApiChapter = {
  id:               number;
  name_arabic:      string;
  name_simple:      string;
  verses_count:     number;
  revelation_place: string;
  pages:            [number, number];
  bismillah_pre?:   boolean;
};

export async function fetchSurahMeta(
  surahNumber: number,
  signal?:     AbortSignal,
): Promise<SurahMeta> {
  // ── In-memory hit: synchronous microtask, no I/O ───────────────────────
  const mem = _surahMetaCache.get(surahNumber);
  if (mem) return mem;

  const cacheKey = CH_CACHE_KEY(surahNumber);

  // ── AsyncStorage hit: disk cache from a previous session ──────────────
  try {
    const cached = await AsyncStorage.getItem(cacheKey);
    if (cached) {
      const meta = JSON.parse(cached) as SurahMeta;
      _surahMetaCache.set(surahNumber, meta);
      return meta;
    }
  } catch {
    // Cache miss or corrupt — fall through to network
  }

  // ── Fetch from network ─────────────────────────────────────────────────
  const res  = await fetch(`${API_BASE}/chapters/${surahNumber}`, { signal });
  if (!res.ok) throw new Error(`Chapters API HTTP ${res.status}`);
  const json = (await res.json()) as { chapter: ApiChapter };
  const ch   = json.chapter;

  const meta: SurahMeta = {
    id:              ch.id,
    nameArabic:      ch.name_arabic,
    nameSimple:      ch.name_simple,
    versesCount:     ch.verses_count,
    revelationPlace: ch.revelation_place === 'madinah' ? 'madinah' : 'makkah',
    firstPage:       ch.pages[0],
    lastPage:        ch.pages[1],
    // The /chapters/{id} endpoint may omit bismillah_pre entirely (undefined).
    // Fallback: every surah has a standalone bismillah except surah 1
    // (where it is verse 1:1 itself) and surah 9 (no bismillah at all).
    bismillahPre:    ch.bismillah_pre !== undefined
      ? ch.bismillah_pre === true
      : (ch.id !== 1 && ch.id !== 9),
  };

  _surahMetaCache.set(surahNumber, meta);
  AsyncStorage.setItem(cacheKey, JSON.stringify(meta)).catch(() => {});
  return meta;
}

// ── Verse API ─────────────────────────────────────────────────────────────────

type ApiWord = {
  position:       number;
  line_number:    number;
  page_number:    number;
  char_type_name: string;
  code_v2:        string;
  verse_key:      string;
  text_uthmani?:  string;
};

type ApiVerse = {
  verse_key: string;
  words:     ApiWord[];
};

function groupWordsByLine(words: MushafWord[]): MushafLine[] {
  const buckets = new Map<number, MushafWord[]>();
  for (const word of words) {
    const b = buckets.get(word.lineNumber);
    if (b) b.push(word);
    else   buckets.set(word.lineNumber, [word]);
  }

  const lines: MushafLine[] = [];
  for (const [lineNumber, lineWords] of buckets) {
    const seenKeys = new Set<string>();
    const verseKeys: string[] = [];
    for (const w of lineWords) {
      if (!seenKeys.has(w.verseKey)) {
        seenKeys.add(w.verseKey);
        verseKeys.push(w.verseKey);
      }
    }
    lines.push({
      lineNumber,
      words:     lineWords,
      lineGlyph: lineWords.map(w => w.glyph).join(''),
      verseKeys,
      wordCount: lineWords.length,
    });
  }

  lines.sort((a, b) => a.lineNumber - b.lineNumber);
  return lines;
}

// ── Verse API URL ─────────────────────────────────────────────────────────────
//
// Defined at module scope so fetchRawVersePage can use it without duplication.
const versesUrl = (n: number): string =>
  `${API_BASE}/verses/by_page/${n}` +
  `?words=true` +
  `&word_fields=code_v2,char_type_name,page_number,line_number,position,verse_key,text_uthmani` +
  `&mushaf=1` +
  `&per_page=300`;

/**
 * Fetches and parses the raw verse array for a given page number.
 * Concurrent calls for the same page share a single in-flight Promise —
 * the HTTP request fires exactly once regardless of how many callers race.
 *
 * Used for overflow pages (N-1 and N+1) only. The main page fetch (N) uses
 * the native fetch() directly so it can carry an AbortSignal.
 * Non-fatal on network error: returns [] so overflow words are simply absent.
 */
function fetchRawVersePage(n: number): Promise<ApiVerse[]> {
  const existing = _rawVersePageInFlight.get(n);
  if (existing) return existing;
  const p = fetch(versesUrl(n))
    .then((r): Promise<ApiVerse[]> => {
      if (!r.ok) return Promise.resolve([]);
      return (r.json() as Promise<{ verses?: ApiVerse[] }>)
        .then((j) => j.verses ?? [])
        .catch(() => []);
    })
    .catch((): ApiVerse[] => [])
    .finally(() => _rawVersePageInFlight.delete(n));
  _rawVersePageInFlight.set(n, p);
  return p;
}

async function fetchMushafPageVerses(
  pageNumber: number,
  signal?:    AbortSignal,
): Promise<MushafPage> {
  const cacheKey = CACHE_KEY(pageNumber);

  // ── Cache-first: return immediately if cached and valid ────────────────
  try {
    const cached = await AsyncStorage.getItem(cacheKey);
    if (cached) {
      const cachedPage = JSON.parse(cached) as MushafPage;
      // Validate: discard cache entries that contain words from the wrong page.
      // This auto-clears any previously cached pages that were stored before the
      // page_number filter was introduced (e.g. page 584 cached with 79:16 words).
      const hasWrongPageWords = cachedPage.lines.some(
        (line) => line.words.some((w) => w.pageNumber !== pageNumber),
      );
      if (!hasWrongPageWords) {
        qLog(`p${pageNumber}: AsyncStorage hit`);
        return cachedPage;
      }
      // Stale cache — delete it so next load fetches fresh data
      AsyncStorage.removeItem(cacheKey).catch(() => {});
    }
  } catch {
    // Cache miss or corrupt — fall through to network
  }

  // ── Fetch from network ─────────────────────────────────────────────────
  qLog(`p${pageNumber}: Network fetch`);
  //
  // Main page (N): fetched with AbortSignal so the request is cancelled if the
  // page view unmounts before the response arrives.
  //
  // Overflow pages (N-1, N+1): fetched via fetchRawVersePage which deduplicates
  // concurrent calls. The Quran Foundation API overflow anomaly requires us to
  // check adjacent pages for words whose page_number === N (see CACHE_KEY comment
  // for the full list). No AbortSignal — these fetches are shared between callers
  // and must not be cancelled when one caller's signal aborts.
  const [mainRes, prevVerses, nextVerses] = await Promise.all([
    fetch(versesUrl(pageNumber), { signal }),
    pageNumber > 1   ? fetchRawVersePage(pageNumber - 1) : Promise.resolve([] as ApiVerse[]),
    pageNumber < 604 ? fetchRawVersePage(pageNumber + 1) : Promise.resolve([] as ApiVerse[]),
  ]);

  if (!mainRes.ok) throw new Error(`Verse API HTTP ${mainRes.status} for page ${pageNumber}`);

  const json = (await mainRes.json()) as { verses: ApiVerse[] };
  if (!json.verses?.length) throw new Error(`Page ${pageNumber}: no verses`);

  const allWords: MushafWord[] = [];

  function extractWords(verses: ApiVerse[]) {
    for (const verse of verses) {
      for (const w of verse.words) {
        if (!w.code_v2 || w.page_number !== pageNumber) continue;
        allWords.push({
          charTypeName: w.char_type_name,
          position:     w.position,
          verseKey:     w.verse_key,
          lineNumber:   w.line_number,
          pageNumber:   w.page_number,
          glyph:        w.code_v2,
          text:         w.text_uthmani ?? '',
        });
      }
    }
  }

  // Main page words
  extractWords(json.verses);

  // Backward overflow: words with page_number===N that only appear in N-1 response
  extractWords(prevVerses);

  // Forward overflow: words with page_number===N that only appear in N+1 response
  extractWords(nextVerses);

  if (!allWords.length) throw new Error(`Page ${pageNumber}: no code_v2 words`);

  const page: MushafPage = {
    pageNumber,
    lines:     groupWordsByLine(allWords),
    wordCount: allWords.length,
  };

  AsyncStorage.setItem(cacheKey, JSON.stringify(page)).catch(() => {});
  return page;
}

// ── Page composition ──────────────────────────────────────────────────────────

/**
 * Merges the verse layer and decoration layer into a complete ComposedMushafPage.
 *
 * Algorithm:
 *   1. Collect all occupied slot numbers from verse line data.
 *   2. Identify which surahs START on this page (firstPage === pageNumber).
 *      These surahs have a header somewhere before their first verse line.
 *   3. Walk slot numbers 1 to TOTAL_SLOTS:
 *      - If occupied by verse data → verse_line
 *      - If a gap slot immediately before the first verse of a new surah →
 *        surah_header (first gap) + bismillah (second gap, if applicable)
 *      - If a gap slot after all verse content → ornament (page_end)
 *      - If a gap slot between two surah transitions (internal) → ornament
 *        (inter_surah)
 *      - Otherwise → unknown (rendered as blank space)
 *
 * Gaps at the start of a page (slots before first verse line, where a surah
 * starts on this page) are classified as surah_header + optional bismillah.
 * Gaps at the end of the page (after last verse line) are ornament:page_end.
 *
 * This is a best-effort classification from available API data.
 * It does NOT fabricate slot content. When uncertain → 'unknown'.
 */
function composePage(
  page:   MushafPage,
  surahs: SurahMeta[],
): MushafSlot[] {
  // Map slot number → verse line
  const verseLineBySlot = new Map<number, MushafLine>();
  for (const line of page.lines) {
    verseLineBySlot.set(line.lineNumber, line);
  }

  // Which surahs start (first verse) on this page?
  const surahsStartingHere = surahs.filter(s => s.firstPage === page.pageNumber);

  // First slot with verse content
  const firstVerseSlot = page.lines.length > 0
    ? Math.min(...page.lines.map(l => l.lineNumber))
    : TOTAL_SLOTS + 1;

  // Last slot with verse content
  const lastVerseSlot = page.lines.length > 0
    ? Math.max(...page.lines.map(l => l.lineNumber))
    : 0;

  // Identify internal gap positions (between verse lines, inside the page)
  // and their associated surahs. If the surah that starts after the gap has
  // firstPage === this page, those gap slots become surah_header + bismillah.
  const surahTransitionSlots = new Set<number>();
  // Map each internal gap slot → the SurahMeta that starts after it (or null)
  const internalGapSlotSurah = new Map<number, SurahMeta | null>();

  if (page.lines.length > 1) {
    for (let i = 0; i < page.lines.length - 1; i++) {
      const currSlot = page.lines[i].lineNumber;
      const nextSlot = page.lines[i + 1].lineNumber;
      if (nextSlot - currSlot > 1) {
        // Identify which surah starts on the line immediately after this gap
        const nextLine = page.lines[i + 1];
        let newSurah: SurahMeta | null = null;
        if (nextLine.verseKeys.length > 0) {
          const nextSurahNum = parseInt(nextLine.verseKeys[0].split(':')[0], 10);
          const meta = surahs.find(s => s.id === nextSurahNum);
          if (meta && meta.firstPage === page.pageNumber) {
            newSurah = meta;
          }
        }
        // Mark all gap slots in this cluster
        for (let s = currSlot + 1; s < nextSlot; s++) {
          surahTransitionSlots.add(s);
          internalGapSlotSurah.set(s, newSurah);
        }
      }
    }
  }

  // Build the complete slot list
  const slots: MushafSlot[] = [];

  // Track which starting surahs have been assigned headers
  // (consumed in order as we encounter pre-verse gaps)
  const pendingHeaders = [...surahsStartingHere];

  for (let slotNum = 1; slotNum <= TOTAL_SLOTS; slotNum++) {
    const verseLine = verseLineBySlot.get(slotNum);

    if (verseLine) {
      slots.push({ kind: 'verse_line', slotNumber: slotNum, line: verseLine });
      continue;
    }

    // Gap slot — classify
    if (slotNum < firstVerseSlot) {
      // Pre-verse gap: assign surah header or bismillah for surahs starting here
      if (pendingHeaders.length > 0) {
        const surah = pendingHeaders[0];
        const headerAlreadyPlaced = slots.some(
          s => s.kind === 'surah_header' && s.surah.id === surah.id,
        );

        if (!headerAlreadyPlaced) {
          // First gap slot for this surah → placeholder header (bismillahEmbedded
          // will be resolved in the post-processing pass below)
          slots.push({ kind: 'surah_header', slotNumber: slotNum, surah, bismillahEmbedded: false });
        } else if (
          surah.bismillahPre &&
          !NO_STANDALONE_BISMILLAH.has(surah.id) &&
          !slots.some(s => s.kind === 'bismillah' && s.surahId === surah.id)
        ) {
          slots.push({ kind: 'bismillah', slotNumber: slotNum, surahId: surah.id });
          pendingHeaders.shift(); // header + bismillah both placed
        } else {
          // Header already placed + bismillah placed (or not needed) → extra gap
          slots.push({ kind: 'unknown', slotNumber: slotNum });
          pendingHeaders.shift();
        }
      } else {
        // Pre-verse gap with no surah starting here — blank space
        slots.push({ kind: 'unknown', slotNumber: slotNum });
      }

    } else if (slotNum > lastVerseSlot) {
      // Post-verse gap
      slots.push({ kind: 'ornament', slotNumber: slotNum, variant: 'page_end' });

    } else if (surahTransitionSlots.has(slotNum)) {
      // Internal gap — may be a surah transition requiring header + bismillah
      const newSurah = internalGapSlotSurah.get(slotNum) ?? null;

      if (newSurah) {
        const headerAlreadyPlaced = slots.some(
          s => s.kind === 'surah_header' && s.surah.id === newSurah.id,
        );

        if (!headerAlreadyPlaced) {
          slots.push({ kind: 'surah_header', slotNumber: slotNum, surah: newSurah, bismillahEmbedded: false });
        } else if (
          newSurah.bismillahPre &&
          !NO_STANDALONE_BISMILLAH.has(newSurah.id) &&
          !slots.some(s => s.kind === 'bismillah' && s.surahId === newSurah.id)
        ) {
          slots.push({ kind: 'bismillah', slotNumber: slotNum, surahId: newSurah.id });
        } else {
          slots.push({ kind: 'ornament', slotNumber: slotNum, variant: 'inter_surah' });
        }
      } else {
        slots.push({ kind: 'ornament', slotNumber: slotNum, variant: 'inter_surah' });
      }

    } else {
      // Gap type cannot be determined
      slots.push({ kind: 'unknown', slotNumber: slotNum });
    }
  }

  // ── Post-processing: resolve bismillahEmbedded ────────────────────────────
  //
  // For each surah_header whose surah needs a standalone bismillah:
  //   • If a separate bismillah slot already follows it → bismillahEmbedded stays false
  //   • If no bismillah slot was placed (only 1 gap slot existed) →
  //     set bismillahEmbedded=true so the renderer draws both within the header slot
  for (const slot of slots) {
    if (slot.kind !== 'surah_header') continue;
    const needsBismillah =
      slot.surah.bismillahPre && !NO_STANDALONE_BISMILLAH.has(slot.surah.id);
    if (!needsBismillah) continue;
    const hasSeparateBismillah = slots.some(
      s => s.kind === 'bismillah' && s.surahId === slot.surah.id,
    );
    if (!hasSeparateBismillah) {
      slot.bismillahEmbedded = true;
    }
  }

  return slots;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetches a complete Mushaf page: verse data + chapter metadata + composition.
 *
 * The returned ComposedMushafPage has exactly TOTAL_SLOTS (15) slots,
 * every one of which is classified and renderable.
 *
 * Parallel fetching: verse data and chapter metadata are fetched concurrently.
 * Chapter data is cached after first fetch — subsequent pages from the same
 * surah incur no additional chapter API calls.
 */

// ── Surah verse list (for SurahDetailSheet) ───────────────────────────────────

/**
 * One verse entry used by SurahDetailSheet.
 *
 * firstLineGlyph: the QCF V2 glyph string for the first Mushaf line of this
 * verse (words on the first line of the verse's first page, sorted by position,
 * code_v2 concatenated). Rendered with loadQCFPageFont(pageNumber) exactly as
 * QuranVerseView renders verse lines — no Unicode Arabic, no system font.
 */
export type SurahVerseEntry = {
  verseKey:       string;
  verseNumber:    number;
  pageNumber:     number;
  firstLineGlyph: string;
};

// v2: switched from text_uthmani to QCF V2 firstLineGlyph — invalidates v1 cache.
const VERSE_LIST_CACHE_KEY = (n: number) => `andalus_mushaf_verselist_v2_${n}`;

/**
 * Fetches and caches the full verse list for a surah.
 *
 * Each entry carries the QCF V2 glyph string for the verse's first Mushaf line,
 * extracted from word-level code_v2 data (words=true). The glyph is built the
 * same way MushafLine.lineGlyph is built in groupWordsByLine — sorted by position,
 * code_v2 concatenated — so it renders correctly with loadQCFPageFont(pageNumber).
 */
export async function fetchSurahVerseList(
  surahId: number,
  signal?:  AbortSignal,
): Promise<SurahVerseEntry[]> {
  const key = VERSE_LIST_CACHE_KEY(surahId);
  try {
    const cached = await AsyncStorage.getItem(key);
    if (cached) return JSON.parse(cached) as SurahVerseEntry[];
  } catch {}

  const url =
    `${API_BASE}/verses/by_chapter/${surahId}` +
    `?words=true&word_fields=code_v2,line_number,page_number,position&per_page=300&mushaf=1`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Verses API HTTP ${res.status}`);

  const json = await res.json() as {
    verses: Array<{
      verse_key:    string;
      verse_number: number;
      words: Array<{
        position:    number;
        line_number: number;
        page_number: number;
        code_v2:     string;
      }>;
    }>;
  };

  const entries: SurahVerseEntry[] = json.verses.map((v) => {
    const words = v.words.filter((w) => w.code_v2);
    if (!words.length) {
      return { verseKey: v.verse_key, verseNumber: v.verse_number, pageNumber: 0, firstLineGlyph: '' };
    }

    // The verse's first page = smallest page_number across its words.
    const firstPage = Math.min(...words.map((w) => w.page_number));

    // The first line on that page = smallest line_number among words on firstPage.
    const wordsOnFirstPage = words.filter((w) => w.page_number === firstPage);
    const firstLineNum = Math.min(...wordsOnFirstPage.map((w) => w.line_number));

    // Collect the first-line words, sort by position, build glyph string.
    const firstLineGlyph = wordsOnFirstPage
      .filter((w) => w.line_number === firstLineNum)
      .sort((a, b) => a.position - b.position)
      .map((w) => w.code_v2)
      .join('');

    return {
      verseKey:    v.verse_key,
      verseNumber: v.verse_number,
      pageNumber:  firstPage,
      firstLineGlyph,
    };
  });

  AsyncStorage.setItem(key, JSON.stringify(entries)).catch(() => {});
  return entries;
}

export function fetchComposedMushafPage(
  pageNumber: number,
  signal?:    AbortSignal,
): Promise<ComposedMushafPage> {
  // ── Layer 1: LRU in-memory cache ──────────────────────────────────────────
  // pageCache.get() promotes the entry to MRU — correct for frequently accessed pages.
  const memCached = pageCache.get(pageNumber);
  if (memCached) {
    qLog(`p${pageNumber}: LRU hit`);
    return Promise.resolve(memCached);
  }

  // ── In-flight deduplication ────────────────────────────────────────────────
  // Join an existing fetch rather than firing a duplicate I/O round-trip.
  const existing = _composedPageInFlight.get(pageNumber);
  if (existing) return existing;

  // ── Layers 2–4: FileStore → AsyncStorage → Network ────────────────────────
  const promise = _fetchWithFileStoreFallback(pageNumber, signal).then((result) => {
    // Cache in LRU regardless of which layer supplied the result.
    pageCache.set(pageNumber, result);
    return result;
  });
  _composedPageInFlight.set(pageNumber, promise);
  promise.finally(() => _composedPageInFlight.delete(pageNumber));
  return promise;
}

/**
 * Layer 2: FileStore (disk, offline-first).
 * Layer 3+4: existing _fetchComposedMushafPageImpl (AsyncStorage + network).
 *
 * The FileStore layer is skipped if:
 *   • initManifest() has not been called yet (manifest not loaded — isPageCached
 *     returns false immediately, falling through to existing path), OR
 *   • the page is not yet cached on disk.
 *
 * After a network hit, the result is written to FileStore so subsequent opens
 * use layer 2 instead of hitting the network again.
 *
 * Quran text: ComposedMushafPage is returned verbatim from whichever layer
 * supplies it. code_v2 and all Arabic text are never transformed here.
 */
async function _fetchWithFileStoreFallback(
  pageNumber: number,
  signal?:    AbortSignal,
): Promise<ComposedMushafPage> {
  // ── Layer 2: FileStore ─────────────────────────────────────────────────────
  // isPageCached() is O(1) — reads from the in-memory manifest Map.
  // Returns false if initManifest() has not completed yet, which gracefully
  // falls through to the existing AsyncStorage + network path.
  if (isPageCached(pageNumber)) {
    const diskPage = await readPage(pageNumber);
    if (diskPage) {
      qLog(`p${pageNumber}: FileStore hit`);
      return diskPage;
    }
    // File is gone despite manifest saying cached (e.g. device restore).
    // Fall through to re-fetch and rebuild the cache entry below.
    qWarn(`p${pageNumber}: manifest=cached but file missing — re-fetching`);
  }

  // ── Layers 3+4: existing path (AsyncStorage + network) ────────────────────
  // _fetchComposedMushafPageImpl is unchanged — it reads from AsyncStorage
  // (andalus_mushaf_cache_v4_*) and falls back to the network if not cached.
  // This path is the exact same behavior as before this integration.
  const result = await _fetchComposedMushafPageImpl(pageNumber, signal);

  // Persist to FileStore for future sessions (non-blocking, fire-and-forget).
  // If writePage throws (disk full, etc.) we swallow the error — the page is
  // still usable from memory / AsyncStorage on this session and next.
  qLog(`p${pageNumber}: writing to FileStore`);
  writePage(pageNumber, result).catch(() => {});

  return result;
}

async function _fetchComposedMushafPageImpl(
  pageNumber: number,
  signal?:    AbortSignal,
): Promise<ComposedMushafPage> {
  // ── Step 1: fetch verse data ────────────────────────────────────────────
  const versePage = await fetchMushafPageVerses(pageNumber, signal);

  // ── Step 2: identify unique surahs on this page ────────────────────────
  const surahNumbersOnPage = new Set<number>();
  for (const line of versePage.lines) {
    for (const verseKey of line.verseKeys) {
      const surahNum = parseInt(verseKey.split(':')[0], 10);
      if (!isNaN(surahNum)) surahNumbersOnPage.add(surahNum);
    }
  }

  // ── Step 3: fetch chapter metadata for each surah (parallel) ──────────
  const surahMetas = await Promise.all(
    Array.from(surahNumbersOnPage).map(n => fetchSurahMeta(n, signal)),
  );

  // ── Step 4: also fetch metadata for surahs whose firstPage = pageNumber
  //           even if they have no verse words on this page yet (e.g.,
  //           a surah header appearing before its first verse line) ────────
  // This requires knowing which surah comes next — which we can derive from
  // the maximum surah number in our verse data + 1. This covers the common
  // case where a surah header appears in the gap slots above verse content.
  const maxSurahOnPage = surahNumbersOnPage.size > 0
    ? Math.max(...surahNumbersOnPage)
    : 0;

  // Look ahead at the immediately following surah (might start on this page
  // in header-only form, with its verses beginning on the next page)
  const candidateNextSurah = maxSurahOnPage + 1;
  if (candidateNextSurah <= 114) {
    try {
      const nextMeta = await fetchSurahMeta(candidateNextSurah, signal);
      // Include this surah if its firstPage is THIS page (header appears here)
      // This handles: Al-Baqarah header on page 1 (even though 2:1 is on page 2)
      //
      // NOTE: Al-Baqarah has firstPage=2, so it does NOT appear in page 1's
      // surahMetas. Lines 9-15 of page 1 are ornament:page_end.
      // If you verify that a surah's header IS on a different page than its
      // first verse (the "pre-announcement" pattern), update firstPage logic here.
      if (nextMeta.firstPage === pageNumber) {
        surahMetas.push(nextMeta);
      }
    } catch {
      // Non-fatal — chapter lookup for lookahead failed; proceed without it
    }
  }

  // ── Step 5: compose ─────────────────────────────────────────────────────
  const slots = composePage(versePage, surahMetas);

  return {
    pageNumber,
    slots,
    versePage,
    surahs: surahMetas,
  };
}

// Re-export for callers that only need raw verse data (e.g., performance test)
export { fetchMushafPageVerses };

/**
 * Finds the actual Mushaf page number for a given verse key by fetching a
 * narrow window of pages around `hintPage`.
 *
 * Scans [hintPage-2 .. hintPage+5] (8 pages max). Pages already in the
 * in-memory cache resolve instantly; uncached pages are fetched from
 * AsyncStorage / network.
 *
 * Returns the first page that contains the verse, or `hintPage` as fallback
 * if the verse is not found in the scanned window.
 */
export async function fetchVersePage(
  verseKey: string,
  hintPage: number,
): Promise<number> {
  const from = Math.max(1, hintPage - 2);
  const to   = Math.min(604, hintPage + 5);
  for (let p = from; p <= to; p++) {
    try {
      const composed = await fetchComposedMushafPage(p);
      for (const slot of composed.slots) {
        if (slot.kind === 'verse_line' && slot.line.verseKeys.includes(verseKey)) {
          return p;
        }
      }
    } catch {
      // skip pages that fail to load
    }
  }
  return hintPage; // fallback to estimate
}

/**
 * Fetches the QCF V2 code_v2 glyph words for a single verse.
 *
 * Scans hintPage-1, hintPage, and hintPage+1 to handle the N-1/N+1 overflow
 * anomalies documented in the CLAUDE.md Previously Fixed Bugs section.
 * Pages already in the in-memory cache resolve instantly.
 *
 * Returns words in reading order (position 1 first = visually rightmost in RTL).
 */
export async function fetchVerseGlyphs(
  verseKey: string,
  hintPage: number,
): Promise<Array<{ code_v2: string; pageNumber: number }>> {
  const pages = Array.from(
    new Set([Math.max(1, hintPage - 1), hintPage, Math.min(604, hintPage + 1)]),
  );

  const allWords: MushafWord[] = [];
  const seen = new Set<string>(); // dedupe by lineNumber_position

  await Promise.all(
    pages.map(async (p) => {
      try {
        const composed = await fetchComposedMushafPage(p);
        for (const line of composed.versePage.lines) {
          for (const word of line.words) {
            if (word.verseKey !== verseKey) continue;
            const key = `${word.lineNumber}_${word.position}`;
            if (seen.has(key)) continue;
            seen.add(key);
            allWords.push(word);
          }
        }
      } catch { /* skip pages that fail */ }
    }),
  );

  allWords.sort((a, b) =>
    a.lineNumber !== b.lineNumber ? a.lineNumber - b.lineNumber : a.position - b.position,
  );

  return allWords.map((w) => ({ code_v2: w.glyph, pageNumber: w.pageNumber }));
}
