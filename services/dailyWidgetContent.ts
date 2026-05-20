/**
 * services/dailyWidgetContent.ts
 *
 * Builds today's daily widget payload (Allah name + Quran verse + Hadith) for
 * the App Group cache read by HidayahAllahNameWidget, HidayahDailyVerseWidget,
 * HidayahDailyVerseArabicWidget, and HidayahDailyHadithWidget.
 *
 * Uses the same deterministic algorithms as:
 *   - notifications.ts  (Allah name rotation, epoch 2025-01-01 UTC)
 *   - dailyReminder.ts  (Quran verse rotation, epoch 2024-01-01 UTC)
 *
 * So the widget always shows the same content as the rest of the app.
 * Call getDailyWidgetPayload() on every app open and pass the result to
 * updateDailyContent() from modules/WidgetData.
 */

import { getDailyQuranVerse, getDailyHadith } from './dailyReminder';

// Fixed epoch — must match notifications.ts (do not change)
const ALLAH_EPOCH_MS = new Date('2025-01-01T00:00:00Z').getTime();

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ALLAH_NAMES_DATA: {
  nr: number;
  arabic: string;
  transliteration: string;
  swedish: string;
  forklaring: string;
}[] = require('../app/asmaul_husna.json');

function todayAllahNameIndex(): number {
  const daysSinceEpoch = Math.floor((Date.now() - ALLAH_EPOCH_MS) / 86_400_000);
  return ((daysSinceEpoch % ALLAH_NAMES_DATA.length) + ALLAH_NAMES_DATA.length) % ALLAH_NAMES_DATA.length;
}

// ── Public types & payload builder ─────────────────────────────────────────────

export interface DailyWidgetPayload {
  date:      string;    // "yyyy-MM-dd"
  updatedAt: number;    // Unix seconds
  allahName: {
    nameNr:          number;
    arabic:          string;
    transliteration: string;
    swedish:         string;
    explanation:     string;
  };
  quranVerse: {
    swedish:     string;
    surahName:   string;
    surahNumber: number;
    ayahNumber:  number;
    reference:   string;
    arabic:      string;
  };
  hadith: {
    hadith_nr: number;
    arabic:    string;
    swedish:   string;
    source:    string;
  };
}

/**
 * Builds and writes a 30-day verse lookup cache to App Group.
 * Arabic text comes from the bundled UTHMANI_ARABIC map — no network needed.
 */
export async function updateVerse30DayCache(): Promise<void> {
  const { setVerse30DayCache } = await import('../modules/WidgetData');
  const today   = new Date();
  const dateStr = today.toISOString().slice(0, 10);
  const verses: Record<string, {
    swedish: string; arabic: string; surahName: string;
    surahNumber: number; ayahNumber: number; reference: string;
  }> = {};

  for (let i = 0; i < 30; i++) {
    const d     = new Date(today);
    d.setDate(d.getDate() + i);
    const ds    = d.toISOString().slice(0, 10);
    const verse = getDailyQuranVerse(d);
    verses[ds] = {
      swedish:     verse.swedish,
      arabic:      verse.arabic,
      surahName:   verse.surahName,
      surahNumber: verse.surahNumber,
      ayahNumber:  verse.ayahNumber,
      reference:   verse.displayRef,
    };
  }

  await setVerse30DayCache({ version: 1, writtenAt: dateStr, verses });
}

export function getDailyWidgetPayload(): DailyWidgetPayload {
  const idx    = todayAllahNameIndex();
  const name   = ALLAH_NAMES_DATA[idx];
  const verse  = getDailyQuranVerse(new Date());
  const hadith = getDailyHadith(new Date());
  const dateStr = new Date().toISOString().slice(0, 10);

  return {
    date:      dateStr,
    updatedAt: Date.now() / 1000,
    allahName: {
      nameNr:          name.nr,
      arabic:          name.arabic,
      transliteration: name.transliteration,
      swedish:         name.swedish,
      explanation:     name.forklaring,
    },
    quranVerse: {
      swedish:     verse.swedish,
      surahName:   verse.surahName,
      surahNumber: verse.surahNumber,
      ayahNumber:  verse.ayahNumber,
      reference:   verse.displayRef,
      arabic:      verse.arabic,
    },
    hadith: {
      hadith_nr: hadith.hadithNr,
      arabic:    hadith.arabiska,
      swedish:   hadith.svenska,
      source:    hadith.kalla,
    },
  };
}
