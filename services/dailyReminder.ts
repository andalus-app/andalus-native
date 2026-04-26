/**
 * services/dailyReminder.ts
 *
 * Generates the "Dagens påminnelse" (Daily Reminder) for the home screen.
 *
 * - Fully offline — all data comes from local JSON/TS files bundled with the app.
 * - Deterministic: same date always returns the same reminder.
 * - Rotates daily through three categories: Koranen → Dhikr → Allahs namn.
 * - Allah's names cycle sequentially through all 99 names.
 * - Each reminder carries a navigationPath for deep-linking from the card.
 *
 * Usage:
 *   import { getDailyReminder } from '@/services/dailyReminder';
 *   const reminder = getDailyReminder(new Date());
 */

import { BERNSTROM_DATA } from '@/data/bernstromTranslation';
import { SURAH_INDEX } from '@/data/surahIndex';
import { ALL_DHIKR, dhikrKey, type DhikrPost } from '@/data/dhikrRepository';
import asmaulData from '@/app/asmaul_husna.json';
import hadithData from '@/data/hadithData.json';

// ── Types ──────────────────────────────────────────────────────────────────────

export type QuranReminder = {
  type: 'quran';
  verseKey: string;      // "surah:ayah", e.g. "2:255"
  surahName: string;     // e.g. "Al-Baqarah"
  surahNumber: number;
  ayahNumber: number;
  swedish: string;       // exact text from BERNSTROM_DATA — never altered
  /** Expo Router path — push this to open the Quran reader at this verse */
  navigationPath: string;
};

export type DhikrReminder = {
  type: 'dhikr';
  titel: string;
  arabisk_text: string;
  translitteration: string;
  svensk_text: string;   // exact text from JSON — never altered
  kallhanvisning: string;
  kategori: string;
  undersida: string;
  /** Stable key used as URL param so dhikr.tsx can reopen this exact post */
  dhikrId: string;
  /** Expo Router path — push this to open the Dhikr screen at this post */
  navigationPath: string;
};

export type AsmaReminder = {
  type: 'asma';
  nr: number;
  arabic: string;        // exact text from JSON — never altered
  transliteration: string;
  swedish: string;
  forklaring: string;
  koranvers_svenska: string;
  sura_ayat: string;
  /** Expo Router path — push this to open the Asmaul Husna screen at this name */
  navigationPath: string;
};

export type HadithReminder = {
  type: 'hadith';
  hadithNr: number;
  arabiska: string; // exact text from JSON — never altered
  svenska: string;  // exact text from JSON — never altered
  kalla: string;
  /** Expo Router path — push this to open the Hadith screen at this hadith */
  navigationPath: string;
};

export type DailyReminder = QuranReminder | DhikrReminder | AsmaReminder;

// ── Internal data types ────────────────────────────────────────────────────────

type AsmaName = {
  nr: number;
  arabic: string;
  transliteration: string;
  swedish: string;
  forklaring: string;
  koranvers_arabiska: string;
  koranvers_svenska: string;
  sura_ayat: string;
  antal_i_koranen: number | null;
  hadith: string | null;
};

// ── Reference date for day counting ───────────────────────────────────────────
// Fixed anchor — never change this date or all historical selections shift.

const REF_DATE_MS = Date.UTC(2024, 0, 1); // 2024-01-01 UTC

function daysSinceRef(date: Date): number {
  const utcMs = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.floor((utcMs - REF_DATE_MS) / 86_400_000);
}

// ── Full Quran verse pool ─────────────────────────────────────────────────────
//
// Covers all 6 235 verses in the Bernström translation (one verse, 80:42, is
// absent from the source documents and is excluded automatically).
//
// The pool is built ONCE at module init via a seeded Fisher-Yates shuffle so
// that consecutive days land on verses from different surahs and the full
// Quran cycles over ~17 years before repeating.
//
// SHUFFLE_SEED — fixed constant. NEVER change this value: it is the anchor
// that keeps "same date → same verse" stable across all app versions.
const SHUFFLE_SEED = 0x414E4453; // "ANDS" in ASCII — stable forever

// Mulberry32 — fast seeded PRNG, no external dependency.
function _mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Builds the shuffled pool at module init. ~6 235 iterations < 1 ms on any device.
const QURAN_POOL: string[] = (() => {
  // 1. Generate every verse key that has a Bernström translation.
  const all: string[] = [];
  for (const surah of SURAH_INDEX) {
    for (let v = 1; v <= surah.versesCount; v++) {
      const key = `${surah.id}:${v}`;
      if (BERNSTROM_DATA[key] !== undefined) all.push(key);
    }
  }
  // 2. Fisher-Yates in-place shuffle with the fixed seed.
  const rand = _mulberry32(SHUFFLE_SEED);
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = all[i]; all[i] = all[j]; all[j] = tmp;
  }
  return all;
})();

// ── Dhikr pool ─────────────────────────────────────────────────────────────────
// Entries from ALL_DHIKR that suit a daily reminder card.

const EXCLUDED_DHIKR_CATEGORIES = new Set([
  'Begravning & dödsrelaterat',
  'Vid besök av den sjuke',
]);

const DHIKR_POOL: DhikrPost[] = ALL_DHIKR.filter((post) => {
  if (!post.svensk_text || post.svensk_text.trim().length < 5) return false;
  if (EXCLUDED_DHIKR_CATEGORIES.has(post._kategori)) return false;
  if (!post.titel || post.titel.trim().length < 3) return false;
  return true;
});

// ── Allah's names ──────────────────────────────────────────────────────────────

const ASMA_POOL: AsmaName[] = asmaulData as AsmaName[];

// ── Hadith pool ────────────────────────────────────────────────────────────────

type HadithEntry = {
  hadith_nr: number;
  arabiska: string;
  svenska: string;
  källa: string;
};

const HADITH_POOL: HadithEntry[] = hadithData as HadithEntry[];

// ── Main exports ───────────────────────────────────────────────────────────────

/**
 * Returns a Quran verse for today. Always Quran — cycles through QURAN_POOL
 * daily (independent of the 3-day dhikr/asma rotation).
 * Same date → same verse, always.
 */
export function getDailyQuranVerse(date: Date): QuranReminder {
  return buildQuranReminder(daysSinceRef(date));
}

/**
 * Returns today's hadith. Cycles through all hadiths daily, independent of
 * other daily content rotations. Same date → same hadith, always.
 */
export function getDailyHadith(date: Date): HadithReminder {
  const slot = daysSinceRef(date);
  const entry = HADITH_POOL[slot % HADITH_POOL.length];
  return {
    type:           'hadith',
    hadithNr:       entry.hadith_nr,
    arabiska:       entry.arabiska,
    svenska:        entry.svenska,
    kalla:          entry.källa,
    navigationPath: `/hadith/${entry.hadith_nr}`,
  };
}

/**
 * Returns today's daily reminder based on the given date.
 * Same date → same result, always.
 */
export function getDailyReminder(date: Date): DailyReminder {
  const days     = daysSinceRef(date);
  const category = days % 2;
  const slot     = Math.floor(days / 2);

  switch (category) {
    case 0: return buildQuranReminder(slot);
    default: return buildAsmaReminder(slot);
  }
}

// ── Builders ───────────────────────────────────────────────────────────────────

function buildQuranReminder(slot: number): QuranReminder {
  const verseKey    = QURAN_POOL[slot % QURAN_POOL.length];
  const swedish     = BERNSTROM_DATA[verseKey] ?? '';
  const [surahStr, ayahStr] = verseKey.split(':');
  const surahNumber = parseInt(surahStr, 10);
  const ayahNumber  = parseInt(ayahStr, 10);
  const surahInfo   = SURAH_INDEX.find((s) => s.id === surahNumber);
  return {
    type:           'quran',
    verseKey,
    surahNumber,
    ayahNumber,
    surahName:      surahInfo?.nameSimple ?? `Surah ${surahNumber}`,
    swedish,
    // No page param — quran.tsx resolves the exact Mushaf page via API when
    // verseKey is present (word-level page_number, same as QuranSearchModal).
    navigationPath: `/quran?verseKey=${verseKey}`,
  };
}

function buildDhikrReminder(slot: number): DhikrReminder {
  const post = DHIKR_POOL[slot % DHIKR_POOL.length];
  const id   = dhikrKey(post);

  return {
    type:             'dhikr',
    titel:            post.titel,
    arabisk_text:     post.arabisk_text,
    translitteration: post.translitteration,
    svensk_text:      post.svensk_text,
    kallhanvisning:   post.kallhanvisning,
    kategori:         post._kategori,
    undersida:        post._undersida,
    dhikrId:          id,
    navigationPath:   `/dhikr?dhikrId=${encodeURIComponent(id)}`,
  };
}

function buildAsmaReminder(slot: number): AsmaReminder {
  const name = ASMA_POOL[slot % ASMA_POOL.length];

  return {
    type:              'asma',
    nr:                name.nr,
    arabic:            name.arabic,
    transliteration:   name.transliteration,
    swedish:           name.swedish,
    forklaring:        name.forklaring,
    koranvers_svenska: name.koranvers_svenska,
    sura_ayat:         name.sura_ayat,
    navigationPath:    `/asmaul?nameNr=${name.nr}`,
  };
}
