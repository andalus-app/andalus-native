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

// ── Curated Quran verse pool ───────────────────────────────────────────────────
// Well-known, self-contained short verses suitable for daily reminders.
// Keys in "surah:ayah" format — matches BERNSTROM_DATA and SURAH_INDEX.
//
// QURAN_POOL_PAGES — exact Mushaf page (1–604) for each pool verse.
// Fetched from the Quran Foundation API (verses/by_key/{key}?word_fields=page_number)
// on 2026-04-21. The Hafs Medina layout is fixed; these never change.
// Using firstPage of the surah would be wrong for verses mid-surah — the
// QuranVerseView pendingVerseHighlight check requires the EXACT page.

const QURAN_POOL_PAGES: Record<string, number> = {
  '1:1':1,'1:2':1,'1:3':1,'1:4':1,'1:5':1,
  '2:45':7,'2:152':23,'2:153':23,'2:155':24,'2:177':27,
  '2:255':42,'2:256':42,'2:285':49,'2:286':49,
  '3:8':50,'3:17':52,'3:26':53,'3:27':53,'3:102':63,'3:103':63,
  '3:110':64,'3:133':67,'3:139':67,'3:160':71,'3:173':72,'3:185':74,'3:200':76,
  '4:1':77,'4:36':84,'4:103':95,
  '6:54':134,
  '7:23':153,'7:43':155,'7:156':170,
  '9:51':195,'9:71':198,
  '10:62':216,'10:107':221,
  '14:7':256,'14:31':259,
  '17:23':284,'17:44':286,'17:80':290,
  '18:10':294,'18:39':298,
  '19:96':312,
  '20:8':312,'20:114':320,
  '21:87':329,'21:107':331,
  '23:1':342,'23:2':342,'23:3':342,
  '24:35':354,
  '25:70':366,'25:74':366,
  '27:19':378,
  '29:45':401,'29:69':404,
  '30:21':406,
  '31:13':412,'31:22':413,
  '36:58':444,
  '39:10':459,'39:53':464,
  '40:60':474,
  '42:19':485,
  '43:32':491,
  '49:10':516,'49:12':517,'49:13':517,
  '51:50':522,'51:56':523,
  '55:13':531,
  '56:77':537,'56:78':537,'56:79':537,
  '57:21':540,
  '59:22':548,'59:23':548,'59:24':548,
  '65:3':558,
  '67:1':562,'67:2':562,
  '71:10':570,
  '72:1':572,
  '73:8':574,
  '94:5':596,'94:6':596,
  '97:1':598,
  '99:7':599,'99:8':599,
  '103:1':601,'103:2':601,'103:3':601,
  '112:1':604,'112:2':604,'112:3':604,'112:4':604,
};

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
    navigationPath: `/hadith?hadithNr=${entry.hadith_nr}`,
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
  // Use the exact Mushaf page for this verse (not the surah's firstPage) so that
  // QuranVerseView's pendingVerseHighlight check fires on the right page, enabling
  // scroll-to and flash highlight of the correct verse in verse-by-verse mode.
  const page        = QURAN_POOL_PAGES[verseKey] ?? surahInfo?.firstPage ?? 1;

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
