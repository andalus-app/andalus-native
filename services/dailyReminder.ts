/**
 * services/dailyReminder.ts
 *
 * Daily content for the home screen cards.
 *
 * - Fully offline — all data comes from local files bundled with the app.
 * - Deterministic: same date always returns the same result.
 *
 * Exports:
 *   getDailyQuranVerse — cycles through the 365-card curated dataset (DagensKoranversCard)
 *   getDailyHadith     — cycles through all hadiths daily
 */

import { BERNSTROM_DATA } from '@/data/bernstromTranslation';
import { SURAH_INDEX } from '@/data/surahIndex';
import { DAGENS_KORANVERS_CARDS } from '@/data/dagensKoranvers';
import hadithData from '@/data/hadithData.json';

// ── Types ──────────────────────────────────────────────────────────────────────

export type QuranReminder = {
  type: 'quran';
  verseKey: string;      // first verse key, e.g. "2:255" (used for navigation + prewarm)
  surahName: string;     // e.g. "Al-Baqarah"
  surahNumber: number;
  ayahNumber: number;
  swedish: string;       // exact text from BERNSTROM_DATA — verse texts joined with \n
  /** All verse keys in this card — one element for single-verse, multiple for grouped */
  refs: string[];
  /** Human-readable reference range, e.g. "2:255" or "2:155–157" */
  displayRef: string;
  /** Expo Router path — push this to open the Quran reader at this verse */
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

// ── Reference date for day counting ───────────────────────────────────────────
// Fixed anchor — never change this date or all historical selections shift.

const REF_DATE_MS = Date.UTC(2024, 0, 1); // 2024-01-01 UTC

function daysSinceRef(date: Date): number {
  const utcMs = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.floor((utcMs - REF_DATE_MS) / 86_400_000);
}

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
 * Returns today's Dagens Koranvers card from the curated dataset.
 * Cycles through all 365 cards daily — same date always returns same card.
 */
export function getDailyQuranVerse(date: Date): QuranReminder {
  return buildDagensKoranversReminder(daysSinceRef(date));
}

/**
 * Returns today's hadith. Cycles through all hadiths daily.
 * Same date → same hadith, always.
 */
export function getDailyHadith(date: Date): HadithReminder {
  const slot  = daysSinceRef(date);
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

// ── Builders ───────────────────────────────────────────────────────────────────

function buildDagensKoranversReminder(slot: number): QuranReminder {
  const card     = DAGENS_KORANVERS_CARDS[slot % DAGENS_KORANVERS_CARDS.length];
  const refs     = card.refs;
  const firstRef = refs[0];

  const [surahStr, ayahStr] = firstRef.split(':');
  const surahNumber = parseInt(surahStr, 10);
  const ayahNumber  = parseInt(ayahStr, 10);
  const surahInfo   = SURAH_INDEX.find((s) => s.id === surahNumber);

  const swedish = refs.map((r) => BERNSTROM_DATA[r] ?? '').join(' ');

  let displayRef: string;
  if (refs.length === 1) {
    displayRef = firstRef;
  } else {
    const allSameSurah = refs.every((r) => r.startsWith(`${surahNumber}:`));
    if (allSameSurah) {
      const lastAyah = parseInt(refs[refs.length - 1].split(':')[1], 10);
      displayRef = `${surahNumber}:${ayahNumber}–${lastAyah}`;
    } else {
      displayRef = refs.join(', ');
    }
  }

  return {
    type:           'quran',
    verseKey:       firstRef,
    surahNumber,
    ayahNumber,
    surahName:      surahInfo?.nameSimple ?? `Surah ${surahNumber}`,
    swedish,
    refs,
    displayRef,
    navigationPath: `/quran?verseKey=${firstRef}`,
  };
}
