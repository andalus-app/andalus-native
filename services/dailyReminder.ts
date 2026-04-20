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

// ── Curated Quran verse pool ───────────────────────────────────────────────────
// Well-known, self-contained short verses suitable for daily reminders.
// Keys in "surah:ayah" format — matches BERNSTROM_DATA and SURAH_INDEX.

const QURAN_POOL: string[] = [
  // Al-Fatihah
  '1:1', '1:2', '1:3', '1:4', '1:5',
  // Al-Baqarah
  '2:45', '2:152', '2:153', '2:155', '2:177', '2:255', '2:256', '2:285', '2:286',
  // Ali Imran
  '3:8', '3:17', '3:26', '3:27', '3:102', '3:103', '3:110', '3:133', '3:139', '3:160', '3:173', '3:185', '3:200',
  // An-Nisa
  '4:1', '4:36', '4:103',
  // Al-Anam
  '6:54',
  // Al-Araf
  '7:23', '7:43', '7:156',
  // At-Tawbah
  '9:51', '9:71',
  // Yunus
  '10:62', '10:107',
  // Ibrahim
  '14:7', '14:31',
  // Al-Isra
  '17:23', '17:44', '17:80',
  // Al-Kahf
  '18:10', '18:39',
  // Maryam
  '19:96',
  // Ta-Ha
  '20:8', '20:114',
  // Al-Anbiya
  '21:87', '21:107',
  // Al-Muminun
  '23:1', '23:2', '23:3',
  // An-Nur
  '24:35',
  // Al-Furqan
  '25:70', '25:74',
  // An-Naml
  '27:19',
  // Al-Ankabut
  '29:45', '29:69',
  // Ar-Rum
  '30:21',
  // Luqman
  '31:13', '31:22',
  // Ya-Sin
  '36:58',
  // Az-Zumar
  '39:10', '39:53',
  // Ghafir
  '40:60',
  // Ash-Shura
  '42:19',
  // Az-Zukhruf
  '43:32',
  // Al-Hujurat
  '49:10', '49:12', '49:13',
  // Adh-Dhariyat
  '51:50', '51:56',
  // Ar-Rahman
  '55:13',
  // Al-Waqia
  '56:77', '56:78', '56:79',
  // Al-Hadid
  '57:21',
  // Al-Hashr
  '59:22', '59:23', '59:24',
  // At-Talaq
  '65:3',
  // Al-Mulk
  '67:1', '67:2',
  // Nuh
  '71:10',
  // Al-Jinn
  '72:1',
  // Al-Muzammil
  '73:8',
  // Al-Inshirah
  '94:5', '94:6',
  // Al-Qadr
  '97:1',
  // Az-Zalzalah
  '99:7', '99:8',
  // Al-Asr
  '103:1', '103:2', '103:3',
  // Al-Ikhlas
  '112:1', '112:2', '112:3', '112:4',
];

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

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * Returns today's daily reminder based on the given date.
 * Same date → same result, always.
 */
export function getDailyReminder(date: Date): DailyReminder {
  const days     = daysSinceRef(date);
  const category = (days % 3) as 0 | 1 | 2;
  const slot     = Math.floor(days / 3);

  switch (category) {
    case 0: return buildQuranReminder(slot);
    case 1: return buildDhikrReminder(slot);
    case 2: return buildAsmaReminder(slot);
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
  const page        = surahInfo?.firstPage ?? 1;

  return {
    type:           'quran',
    verseKey,
    surahNumber,
    ayahNumber,
    surahName:      surahInfo?.nameSimple ?? `Surah ${surahNumber}`,
    swedish,
    navigationPath: `/quran?verseKey=${verseKey}&page=${page}`,
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
