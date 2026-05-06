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

export type HijriDateShape = { day: number; month: { number: number } };

// Fästa hadither per hijri-datum (månad 1-indexerad, Dhul Hijjah = 12)
const PINNED_HADITHS: Array<{ hijriMonth: number; hijriDay: number; hadithNr: number }> = [
  { hijriMonth: 9,  hijriDay: 1, hadithNr: 141 }, // Ramadan 1 — fasta med iman
  { hijriMonth: 9,  hijriDay: 2, hadithNr: 175 }, // Ramadan 2 — nattbön med iman
  { hijriMonth: 9,  hijriDay: 3, hadithNr: 107 }, // Ramadan 3 — islams fem pelare
  { hijriMonth: 9,  hijriDay: 4,  hadithNr: 70  }, // Ramadan 4 — kvinnan som ber, fastar och lyder
  { hijriMonth: 9,  hijriDay: 20, hadithNr: 140 }, // Ramadan 20 — Laylat ul-Qadr
  { hijriMonth: 9,  hijriDay: 22, hadithNr: 140 }, // Ramadan 22 — Laylat ul-Qadr
  { hijriMonth: 9,  hijriDay: 24, hadithNr: 140 }, // Ramadan 24 — Laylat ul-Qadr
  { hijriMonth: 9,  hijriDay: 26, hadithNr: 140 }, // Ramadan 26 — Laylat ul-Qadr
  { hijriMonth: 9,  hijriDay: 28, hadithNr: 140 }, // Ramadan 28 — Laylat ul-Qadr
  { hijriMonth: 12, hijriDay: 1, hadithNr: 80  }, // Dhul Hijjah 1 — de tio bästa dagarna
  { hijriMonth: 12, hijriDay: 2, hadithNr: 107 }, // Dhul Hijjah 2 — islams fem pelare
  { hijriMonth: 12, hijriDay: 3, hadithNr: 81  }, // Dhul Hijjah 3 — hajj utan synd
  { hijriMonth: 12, hijriDay: 4, hadithNr: 113 }, // Dhul Hijjah 4 — fajr i församling + duha
  { hijriMonth: 12, hijriDay: 8, hadithNr: 100 }, // Yawm at-Tarwiyah — Arafah-fasta
  { hijriMonth: 12, hijriDay: 9, hadithNr: 82  }, // Yawm Arafah — frigörelse från elden
];

/**
 * Returns today's hadith. Cycles through all hadiths daily.
 * Same date → same hadith, always.
 * Exceptions: pinned hadiths on specific Hijri dates (sourced from Aladhan via AppContext).
 */
export function getDailyHadith(date: Date, hijri?: HijriDateShape | null): HadithReminder {
  if (hijri) {
    const pin = PINNED_HADITHS.find(
      p => p.hijriMonth === hijri.month?.number && p.hijriDay === hijri.day,
    );
    if (pin) {
      const pinned = HADITH_POOL.find(h => h.hadith_nr === pin.hadithNr)!;
      return {
        type:           'hadith',
        hadithNr:       pinned.hadith_nr,
        arabiska:       pinned.arabiska,
        svenska:        pinned.svenska,
        kalla:          pinned.källa,
        navigationPath: `/hadith/${pinned.hadith_nr}`,
      };
    }
  }
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
